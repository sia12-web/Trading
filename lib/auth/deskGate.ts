/**
 * Desk gate session — shared site password + signed HttpOnly cookie.
 * Edge-safe (Web Crypto) so Slice 2 middleware can verify the same token.
 */

export const DESK_GATE_COOKIE = 'desk_gate'

const DEFAULT_TTL_DAYS = 7

export function getGateTtlSeconds(): number {
  const raw = process.env.DESK_AUTH_TTL_DAYS?.trim()
  const days = raw ? Number(raw) : DEFAULT_TTL_DAYS
  if (!Number.isFinite(days) || days <= 0 || days > 90) return DEFAULT_TTL_DAYS * 86_400
  return Math.floor(days * 86_400)
}

export function getGatePassword(): string | null {
  const p = process.env.DESK_GATE_PASSWORD
  if (typeof p !== 'string' || !p.length) return null
  return p
}

export function getGateSigningSecret(): string | null {
  const s = process.env.DESK_AUTH_SECRET?.trim()
  if (s && s.length >= 16) return s
  // Dev fallback only — production must set DESK_AUTH_SECRET
  const pw = getGatePassword()
  if (pw && process.env.NODE_ENV !== 'production') {
    return `desk-gate-dev:${pw}`
  }
  return s && s.length > 0 ? s : null
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!)
  const b64 = btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Fresh ArrayBuffer copy — required by SubtleCrypto in Node + Edge. */
function bytesToArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength)
  copy.set(u8)
  return copy.buffer
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return b64url(sig)
}

async function hmacVerify(secret: string, message: string, sigB64: string): Promise<boolean> {
  try {
    const key = await importHmacKey(secret)
    const sig = b64urlDecode(sigB64)
    return await crypto.subtle.verify(
      'HMAC',
      key,
      bytesToArrayBuffer(sig),
      new TextEncoder().encode(message)
    )
  } catch {
    return false
  }
}

async function sha256Bytes(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return new Uint8Array(digest)
}

/** Timing-safe password check (hash both sides so lengths need not match). */
export async function verifyGatePassword(password: string): Promise<boolean> {
  const expected = getGatePassword()
  if (!expected) return false
  if (typeof password !== 'string') return false
  const [a, b] = await Promise.all([sha256Bytes(password), sha256Bytes(expected)])
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/** Mint signed token: v1.<expUnix>.<hmac> */
export async function mintGateToken(nowMs: number = Date.now()): Promise<string | null> {
  const secret = getGateSigningSecret()
  if (!secret) return null
  const exp = Math.floor(nowMs / 1000) + getGateTtlSeconds()
  const body = `v1.${exp}`
  const sig = await hmacSign(secret, body)
  return `${body}.${sig}`
}

export async function verifyGateToken(
  token: string | null | undefined,
  nowMs: number = Date.now()
): Promise<boolean> {
  if (!token || typeof token !== 'string') return false
  const secret = getGateSigningSecret()
  if (!secret) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [ver, expStr, sig] = parts
  if (ver !== 'v1' || !expStr || !sig) return false
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return false
  const body = `v1.${expStr}`
  return hmacVerify(secret, body, sig)
}

export function parseCookieHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    if (k !== name) continue
    return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}

export async function isGateAuthenticatedFromCookieHeader(
  cookieHeader: string | null
): Promise<boolean> {
  const token = parseCookieHeader(cookieHeader, DESK_GATE_COOKIE)
  return verifyGateToken(token)
}

export type GateCookieAttrs = {
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  sameSite: 'lax'
  path: string
  maxAge: number
}

export function buildGateCookie(token: string, maxAge = getGateTtlSeconds()): GateCookieAttrs {
  return {
    name: DESK_GATE_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  }
}

export function buildClearGateCookie(): GateCookieAttrs {
  return {
    name: DESK_GATE_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  }
}

export function gateConfigured(): { ok: boolean; reason?: string } {
  if (!getGatePassword()) {
    return { ok: false, reason: 'DESK_GATE_PASSWORD is not set' }
  }
  if (!getGateSigningSecret()) {
    return {
      ok: false,
      reason: 'DESK_AUTH_SECRET is not set (required in production, min 16 chars)',
    }
  }
  return { ok: true }
}
