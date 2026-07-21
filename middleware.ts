import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  DESK_GATE_COOKIE,
  getGatePassword,
  verifyGateToken,
} from '@/lib/auth/deskGate'

/**
 * Force Next.js to inline these into the Edge middleware bundle.
 * Without this, Node login can mint with DESK_AUTH_SECRET while Edge
 * middleware falls back to a different secret → eternal login loop.
 */
const EDGE_GATE_PASSWORD = process.env.DESK_GATE_PASSWORD
const EDGE_GATE_SECRET = process.env.DESK_AUTH_SECRET
void EDGE_GATE_PASSWORD
void EDGE_GATE_SECRET

/**
 * Public paths — no desk_gate cookie required.
 * Cron routes still need Bearer CRON_SECRET (checked below when gated).
 */
const PUBLIC_EXACT = new Set([
  '/login',
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
])

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  if (pathname.startsWith('/_next/')) return true
  if (pathname === '/favicon.ico') return true
  if (pathname.startsWith('/icons/')) return true
  // Chrome DevTools probe — ignore without polluting login redirects
  if (pathname.startsWith('/.well-known/')) return true
  return false
}

function hasCronBearer(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${cronSecret}`
}

function loginRedirect(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  const next = request.nextUrl.pathname + request.nextUrl.search
  if (next && next !== '/login' && !next.startsWith('/.well-known')) {
    url.searchParams.set('next', next)
  } else {
    url.searchParams.delete('next')
  }
  return NextResponse.redirect(url)
}

/**
 * Attach request IDs, API access logs, and desk-gate session enforcement.
 */
export async function middleware(request: NextRequest) {
  const requestId =
    request.headers.get('x-request-id') ||
    request.headers.get('x-railway-request-id') ||
    crypto.randomUUID()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api/')

  if (isApi) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        msg: 'api.request',
        service: 'trading-desk',
        method: request.method,
        path: pathname,
        requestId,
      })
    )
  }

  // Prefer Edge-inlined env; getGatePassword still reads process.env as fallback
  const gateOn = Boolean(EDGE_GATE_PASSWORD || getGatePassword())
  if (gateOn) {
    const token = request.cookies.get(DESK_GATE_COOKIE)?.value
    const authed = await verifyGateToken(token)

    if (process.env.NODE_ENV !== 'production' && token && !authed) {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          msg: 'desk_gate.verify_failed',
          path: pathname,
          hasToken: true,
          hasSecret: Boolean(EDGE_GATE_SECRET || process.env.DESK_AUTH_SECRET),
          requestId,
        })
      )
    }

    // Already signed in → skip login page
    if (authed && pathname === '/login') {
      const res = NextResponse.redirect(new URL('/dashboard', request.url))
      res.headers.set('x-request-id', requestId)
      return res
    }

    if (!isPublicPath(pathname)) {
      const cronOk = isApi && hasCronBearer(request)
      if (!cronOk && !authed) {
        if (isApi) {
          const res = NextResponse.json(
            { error: 'Unauthorized', success: false },
            { status: 401 }
          )
          res.headers.set('x-request-id', requestId)
          return res
        }
        const res = loginRedirect(request)
        res.headers.set('x-request-id', requestId)
        return res
      }
    }
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('x-request-id', requestId)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
