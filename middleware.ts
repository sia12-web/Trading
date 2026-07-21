import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  DESK_GATE_COOKIE,
  getGatePassword,
  verifyGateToken,
} from '@/lib/auth/deskGate'

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
  if (next && next !== '/login') {
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

  // Gate only when password is configured (local/prod with DESK_GATE_PASSWORD)
  const gateOn = Boolean(getGatePassword())
  if (gateOn) {
    const token = request.cookies.get(DESK_GATE_COOKIE)?.value
    const authed = await verifyGateToken(token)

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
    /*
     * All app routes except static files Next already excludes via patterns.
     * Include pages + APIs so the desk gate covers both.
     */
    '/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
