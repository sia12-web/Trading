/**
 * Wrap App Router handlers so every response (and thrown error) is logged
 * with method, path, status, and duration — for Railway diagnosis.
 */
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/utils/logger'

type Handler<T extends NextRequest | Request = NextRequest> = (
  request: T,
  context?: { params?: Record<string, string | string[]> }
) => Promise<NextResponse> | NextResponse

function requestPath(request: NextRequest | Request): string {
  try {
    if ('nextUrl' in request && request.nextUrl) return request.nextUrl.pathname
    return new URL(request.url).pathname
  } catch {
    return 'unknown'
  }
}

export function withApiLog<T extends NextRequest | Request>(
  routeName: string,
  handler: Handler<T>
): Handler<T> {
  return (async (request: T, context?: { params?: Record<string, string | string[]> }) => {
    const started = Date.now()
    const requestId =
      request.headers.get('x-request-id') ||
      request.headers.get('x-railway-request-id') ||
      crypto.randomUUID()
    const method = request.method
    const path = requestPath(request)

    try {
      const response = await handler(request, context)
      const ms = Date.now() - started
      const status = response.status

      const fields = {
        route: routeName,
        method,
        path,
        status,
        ms,
        requestId,
      }

      if (status >= 500) logger.error('api.response', fields)
      else if (status >= 400) logger.warn('api.response', fields)
      else logger.info('api.response', fields)

      response.headers.set('x-request-id', requestId)
      return response
    } catch (err) {
      logger.error('api.unhandled', {
        route: routeName,
        method,
        path,
        ms: Date.now() - started,
        requestId,
        err,
      })
      throw err
    }
  }) as Handler<T>
}
