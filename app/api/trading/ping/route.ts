import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * High-precision, zero-payload ping endpoint for browser RTT & internet latency benchmarking.
 */
export async function GET() {
  return new NextResponse('pong', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'X-Server-Time': Date.now().toString(),
    },
  })
}

export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'X-Server-Time': Date.now().toString(),
    },
  })
}
