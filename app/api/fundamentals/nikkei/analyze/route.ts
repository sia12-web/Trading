import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { evaluateNikkeiEvent } from '@/lib/fundamentals/nikkeiAnalystEngine'
import { getNikkeiFundamentalState, peekNikkeiFundamentalState } from '@/lib/fundamentals/nikkeiStateStore'
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

    const liveState = await getNikkeiFundamentalState()
    const evaluation = await evaluateNikkeiEvent({
      rawText: body.rawText.trim(),
      sourceHint: body.sourceHint?.trim(),
      forcedTelemetry: liveState.nikkeiTelemetry,
      autoCommitIfMaterial: body.autoCommitIfMaterial !== false,
    })

    const updatedState = peekNikkeiFundamentalState()
    const out = evaluation.structuredOutput

    return NextResponse.json({
      ok: true,
      timestamp: evaluation.timestamp,
      market: 'CME_NKD',
      event: out.event,
      importance: out.importance,
      confidence: out.confidence,
      market_stance: out.market_stance,
      transmission_channels: out.transmission_channels,
      market_reaction: out.market_reaction,
      abnormal_behavior: out.abnormal_behavior,
      estimated_nkd_point_impact: out.estimated_nkd_point_impact,
      summary: out.summary,
      actionable_takeaway: out.actionable_takeaway,
      structured: out,
      evaluation,
      state: updatedState,
    })
  } catch (err) {
    logger.error('[Nikkei Fundamentals Analyze API] Evaluation failed', err)
    return NextResponse.json({ error: 'Internal evaluation error' }, { status: 500 })
  }
}
