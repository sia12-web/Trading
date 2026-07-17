import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Attach request IDs and emit a lightweight API access line for Railway logs.
 * Full status/duration logging is done in withApiLog / route handlers.
 */
export function middleware(request: NextRequest) {
  const requestId =
    request.headers.get('x-request-id') ||
    request.headers.get('x-railway-request-id') ||
    crypto.randomUUID()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('x-request-id', requestId)

  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Edge-safe one-liner (JSON) — searchable in Railway
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        msg: 'api.request',
        service: 'trading-desk',
        method: request.method,
        path: request.nextUrl.pathname,
        requestId,
      })
    )
  }

  return response
}

export const config = {
  matcher: ['/api/:path*'],
}
