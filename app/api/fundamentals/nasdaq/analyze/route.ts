import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { evaluateNasdaqEvent } from '@/lib/fundamentals/nasdaqAnalystEngine'
import { getNasdaqFundamentalState } from '@/lib/fundamentals/nasdaqStateStore'
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

    const evaluation = await evaluateNasdaqEvent({
      rawText: body.rawText.trim(),
      sourceHint: body.sourceHint?.trim(),
      timestampHint: body.timestampHint?.trim(),
      autoCommitIfMaterial: body.autoCommitIfMaterial !== false,
    })

    const updatedState = await getNasdaqFundamentalState()
    const out = evaluation.structuredOutput

    // Return exact machine-readable JSON conforming to Item 34, 35, & 39
    return NextResponse.json({
      ok: true,
      timestamp: out.timestamp,
      market: out.market,
      event: out.event,
      importance: out.importance,
      event_analysis: out.event_analysis,
      transmission: out.transmission,
      fundamental_state: out.fundamental_state,
      market_response: out.market_response,
      abnormal_behavior: out.abnormal_behavior,
      confidence: out.confidence,
      summary: out.summary,
      unified_protocol: out.unified_protocol,

      structured: out,
      evaluation,
      state: updatedState,
    })
  } catch (err) {
    logger.error('[Nasdaq Fundamentals Analyze API] Evaluation failed', err)
    return NextResponse.json({ error: 'Internal evaluation error' }, { status: 500 })
  }
}
