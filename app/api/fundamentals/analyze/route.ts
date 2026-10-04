import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { evaluateOilEvent } from '@/lib/fundamentals/oilAnalystEngine'
import { getOilFundamentalState } from '@/lib/fundamentals/oilStateStore'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      rawText?: string
      sourceHint?: string
      timestampHint?: string
      autoCommitIfMaterial?: boolean
    }

    if (!body.rawText || !body.rawText.trim()) {
      return NextResponse.json({ error: 'Event rawText is required' }, { status: 400 })
    }

    const evaluation = await evaluateOilEvent({
      rawText: body.rawText.trim(),
      sourceHint: body.sourceHint?.trim(),
      timestampHint: body.timestampHint?.trim(),
      autoCommitIfMaterial: body.autoCommitIfMaterial !== false,
    })

    const updatedState = await getOilFundamentalState()

    // Expose the machine-readable structured JSON directly at top level for other trading agents
    return NextResponse.json({
      ok: true,
      timestamp: evaluation.structured.timestamp,
      market: evaluation.structured.market,
      event: evaluation.structured.event,
      importance: evaluation.structured.importance,
      fundamental_effect: evaluation.structured.fundamental_effect,
      drivers: evaluation.structured.drivers,
      market_confirmation: evaluation.structured.market_confirmation,
      confidence: evaluation.structured.confidence,
      summary: evaluation.structured.summary,

      structured: evaluation.structured,
      evaluation,
      state: updatedState,
    })
  } catch (err) {
    logger.error('[Fundamentals Analyze API] Evaluation failed', err)
    return NextResponse.json({ error: 'Internal evaluation error' }, { status: 500 })
  }
}
