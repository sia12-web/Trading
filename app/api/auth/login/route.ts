import { NextResponse } from 'next/server'
import {
  buildGateCookie,
  gateConfigured,
  mintGateToken,
  verifyGatePassword,
} from '@/lib/auth/deskGate'

export const dynamic = 'force-dynamic'

/** Simple in-memory rate limit (per instance). Key = IP. */
const attempts = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 15 * 60_000
const MAX_FAILS = 8

function clientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  )
}

function checkRateLimit(key: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now()
  const row = attempts.get(key)
  if (!row || now >= row.resetAt) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS })
    return { ok: true }
  }
  if (row.count >= MAX_FAILS) {
    return { ok: false, retryAfterSec: Math.ceil((row.resetAt - now) / 1000) }
  }
  return { ok: true }
}

function recordFailure(key: string) {
  const now = Date.now()
  const row = attempts.get(key)
  if (!row || now >= row.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  row.count += 1
}

function clearFailures(key: string) {
  attempts.delete(key)
}

/**
 * POST /api/auth/login
 * Body: { password: string }
 * Sets HttpOnly desk_gate cookie on success.
 */
export async function POST(request: Request) {
  const cfg = gateConfigured()
  if (!cfg.ok) {
    console.error('[auth/login]', cfg.reason)
    return NextResponse.json(
      { error: 'Login is not configured on this server' },
      { status: 503 }
    )
  }

  const key = clientKey(request)
  const limited = checkRateLimit(key)
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many attempts — try again later' },
      {
        status: 429,
        headers: limited.retryAfterSec
          ? { 'Retry-After': String(limited.retryAfterSec) }
          : undefined,
      }
    )
  }

  let password = ''
  try {
    const body = (await request.json()) as { password?: unknown }
    if (typeof body?.password === 'string') password = body.password
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!password) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 })
  }

  const ok = await verifyGatePassword(password)
  if (!ok) {
    recordFailure(key)
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  clearFailures(key)
  const token = await mintGateToken()
  if (!token) {
    return NextResponse.json({ error: 'Could not create session' }, { status: 500 })
  }

  const cookie = buildGateCookie(token)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge: cookie.maxAge,
  })
  return res
}
