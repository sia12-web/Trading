/**
 * POST /api/client-error — record a browser exception in the deploy log.
 * The desk cookie is required (middleware). Body is truncated and not stored.
 */
import { NextResponse } from 'next/server'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    const parsed = await request.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    body = {}
  }
  const message = String(body.message || 'unknown').slice(0, 500)
  const stack = String(body.stack || '').slice(0, 2000)
  const label = String(body.label || 'client').slice(0, 80)
  const href = String(body.href || '').slice(0, 300)
  logger.error('client.exception', { message, stack, label, href })
  return NextResponse.json({ ok: true })
}
