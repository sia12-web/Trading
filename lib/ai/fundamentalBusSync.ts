/**
 * Adapts in-memory Fundamentals specialist state onto the market intelligence bus.
 * Does not refresh network feeds. Leo and Desk News consume the bus; they do not call the agents directly.
 */

import { peekDowFundamentalState } from '@/lib/fundamentals/dowStateStore'
import { peekGoldFundamentalState } from '@/lib/fundamentals/goldStateStore'
import { peekNasdaqFundamentalState } from '@/lib/fundamentals/nasdaqStateStore'
import { peekNikkeiFundamentalState } from '@/lib/fundamentals/nikkeiStateStore'
import { peekOilFundamentalState } from '@/lib/fundamentals/oilStateStore'
import { CANONICAL_MARKET_IDS, canonicalMarketMeta, type CanonicalMarketId } from '@/lib/ai/canonicalMarkets'
import {
  confidenceLabel,
  normalizeConfidence,
  normalizeStance,
  publishMarketSnapshot,
  readMarketSnapshot,
  type MarketIntelligenceSnapshot,
  type SnapshotSource,
} from '@/lib/ai/marketIntelligenceBus'

type TodayLike = {
  bias?: string
  confidence?: number
  intraday_bias?: string
  short_term_bias?: string
  medium_term_bias?: string
  main_current_market_driver?: string
  main_current_driver?: string
  primary_current_driver?: string
  boj_policy_stance?: string
  fx_regime?: string
  upcoming_catalysts?: string
  top_catalysts?: string[]
  what_changed_since_yesterday?: string
  summary_narrative?: string
  what_would_invalidate_this_view?: string
  what_would_invalidate_the_current_interpretation?: string
  key_risks?: string[]
  updatedAt?: string
  updated_at?: string
}

type AnyEvaluatedEvent = {
  title?: string
  event?: string
  timestamp?: string
  evaluatedAt?: string
  structured?: {
    event?: string
    importance?: string
    confidence?: number
    summary?: string
    market_confirmation?: {
      confirmation?: string
    }
    drivers?: Array<{ factor?: string; actual?: unknown; consensus?: unknown }>
  }
  structuredOutput?: {
    event?: string
    category?: string
    importance?: string
    confidence?: number
    summary?: string
    event_analysis?: {
      category?: string
      surprise?: string
      magnitude?: string
    }
    market_response?: {
      gold_response_quality?: string
      nq_response_quality?: string
      confirmation?: string
    }
    market_confirmation?: {
      confirmation?: string
    }
    market_reaction?: {
      nkd_5m_continuation?: string
    }
    abnormal_behavior?: {
      detected?: boolean
      type?: string | null
    }
    unified_protocol?: {
      catalyst?: string
      magnitude?: string
      confidence?: number
      market_confirmation?: string
    }
  }
  step4_scheduled_data_comparison?: {
    surpriseDelta?: string | null
    isSurprise?: boolean
  } | null
  step9_market_confirmation?: {
    verdict?: string
  }
}

function ageSec(iso: string | undefined, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round((now.getTime() - t) / 1000))
}

function normalizeMarketConfirmationStatus(
  raw?: string | null
): 'CONFIRMED' | 'PARTIAL' | 'REJECTED' | 'INCONCLUSIVE' | null {
  if (!raw) return null
  const u = raw.trim().toUpperCase()
  if (u === 'CONFIRMED' || u === 'STRONG' || u === 'CONTINUING') return 'CONFIRMED'
  if (u === 'PARTIAL' || u === 'PARTIAL_CONFIRMATION' || u === 'PARTIALLY_CONFIRMED' || u === 'MODERATE') {
    return 'PARTIAL'
  }
  if (
    u === 'REJECTED' ||
    u === 'COMPLETE_REJECTION' ||
    u === 'PARTIAL_REJECTION' ||
    u === 'CONTRADICTED' ||
    u === 'REVERSING'
  ) {
    return 'REJECTED'
  }
  if (u === 'INCONCLUSIVE' || u === 'WEAK' || u === 'DIVERGENT' || u === 'UNCONFIRMED' || u === 'STALLED') {
    return 'INCONCLUSIVE'
  }
  return null
}

function extractEventMetadata(latestEvent?: AnyEvaluatedEvent | null): {
  eventConfidence: number | null
  eventSummary: string | null
  catalyst: { type: string | null; surprise: string | null; magnitude: string | null }
  marketConfirmation: { status: 'CONFIRMED' | 'PARTIAL' | 'REJECTED' | 'INCONCLUSIVE' | null }
  abnormalBehavior: { detected: boolean; type: string | null }
} {
  if (!latestEvent) {
    return {
      eventConfidence: null,
      eventSummary: null,
      catalyst: { type: null, surprise: null, magnitude: null },
      marketConfirmation: { status: null },
      abnormalBehavior: { detected: false, type: null },
    }
  }

  const out = latestEvent.structuredOutput
  const oilStruct = latestEvent.structured
  const rawConf = out?.confidence ?? oilStruct?.confidence ?? null
  const eventConfidence = normalizeConfidence(rawConf)
  const eventSummary = out?.summary || oilStruct?.summary || null

  const catType =
    out?.event_analysis?.category ||
    out?.category ||
    out?.unified_protocol?.catalyst ||
    out?.event ||
    oilStruct?.event ||
    latestEvent.event ||
    latestEvent.title ||
    null

  const catSurprise =
    out?.event_analysis?.surprise ||
    latestEvent.step4_scheduled_data_comparison?.surpriseDelta ||
    null

  const catMagnitude =
    out?.event_analysis?.magnitude ||
    out?.importance ||
    oilStruct?.importance ||
    out?.unified_protocol?.magnitude ||
    null

  const rawConfirm =
    out?.unified_protocol?.market_confirmation ||
    out?.market_response?.gold_response_quality ||
    out?.market_response?.nq_response_quality ||
    out?.market_response?.confirmation ||
    out?.market_confirmation?.confirmation ||
    oilStruct?.market_confirmation?.confirmation ||
    latestEvent.step9_market_confirmation?.verdict ||
    out?.market_reaction?.nkd_5m_continuation ||
    null

  const ab = out?.abnormal_behavior
  const abDetected = Boolean(ab?.detected && ab?.type && ab.type !== 'NONE')
  const abType = abDetected ? ab?.type ?? null : null

  return {
    eventConfidence,
    eventSummary,
    catalyst: {
      type: catType ? String(catType) : null,
      surprise: catSurprise ? String(catSurprise) : null,
      magnitude: catMagnitude ? String(catMagnitude) : null,
    },
    marketConfirmation: {
      status: normalizeMarketConfirmationStatus(rawConfirm),
    },
    abnormalBehavior: {
      detected: abDetected,
      type: abType,
    },
  }
}

function buildSnapshot(args: {
  market: CanonicalMarketId
  today: TodayLike
  overallConfidence?: number
  latestEvent?: AnyEvaluatedEvent | null
  updatedAt?: string
  evaluated: boolean
  now: Date
}): MarketIntelligenceSnapshot {
  const today = args.today
  const generatedAt =
    args.latestEvent?.timestamp ||
    args.latestEvent?.evaluatedAt ||
    today.updatedAt ||
    today.updated_at ||
    args.updatedAt ||
    args.now.toISOString()

  const evMeta = extractEventMetadata(args.evaluated ? args.latestEvent : null)
  const confidence =
    evMeta.eventConfidence ??
    normalizeConfidence(today.confidence ?? args.overallConfidence)

  const source: SnapshotSource = args.evaluated ? 'evaluated' : 'baseline-seed'
  const upcoming = today.upcoming_catalysts || (today.top_catalysts || []).join('; ') || null

  const nikkeiDriver =
    today.boj_policy_stance && today.fx_regime
      ? `BoJ ${today.boj_policy_stance} / FX ${today.fx_regime}`
      : null

  const primaryDriver =
    today.main_current_market_driver ||
    today.main_current_driver ||
    today.primary_current_driver ||
    nikkeiDriver ||
    null

  const whatChanged =
    today.what_changed_since_yesterday ||
    evMeta.eventSummary ||
    today.summary_narrative ||
    null

  const invalidation =
    today.what_would_invalidate_this_view ||
    today.what_would_invalidate_the_current_interpretation ||
    (Array.isArray(today.key_risks) && today.key_risks.length > 0 ? today.key_risks.join('; ') : null) ||
    null

  return {
    market: args.market,
    timestamp: args.now.toISOString(),
    source,
    fundamental: {
      intraday: normalizeStance(today.intraday_bias || today.bias),
      shortTerm: normalizeStance(today.short_term_bias || today.bias),
      mediumTerm: normalizeStance(today.medium_term_bias || today.bias),
      confidence,
      confidenceLabel: confidenceLabel(confidence),
    },
    primaryDriver,
    catalyst: evMeta.catalyst,
    marketConfirmation: evMeta.marketConfirmation,
    abnormalBehavior: evMeta.abnormalBehavior,
    upcoming,
    whatChanged,
    invalidation,
    stateAgeSec: ageSec(generatedAt, args.now),
  }
}

/** Copy current specialist memory onto the bus. Safe to call on every Leo turn or specialist evaluation. */
export function syncFundamentalBusFromStores(now = new Date()): void {
  const oil = peekOilFundamentalState()
  const gold = peekGoldFundamentalState()
  const nasdaq = peekNasdaqFundamentalState()
  const dow = peekDowFundamentalState()
  const nikkei = peekNikkeiFundamentalState()

  publishMarketSnapshot(
    buildSnapshot({
      market: 'CL',
      today: oil.today,
      overallConfidence: oil.overallConfidence,
      latestEvent: oil.recentEvents[0] ?? null,
      updatedAt: oil.updatedAt,
      evaluated: oil.recentEvents.length > 0,
      now,
    })
  )
  publishMarketSnapshot(
    buildSnapshot({
      market: 'GC',
      today: gold.today,
      overallConfidence: gold.overallConfidence,
      latestEvent: gold.recentEvents[0] ?? null,
      updatedAt: gold.updatedAt,
      evaluated: gold.recentEvents.length > 0,
      now,
    })
  )
  publishMarketSnapshot(
    buildSnapshot({
      market: 'NQ',
      today: nasdaq.today,
      overallConfidence: nasdaq.overallConfidence,
      latestEvent: nasdaq.recentEvents[0] ?? null,
      updatedAt: nasdaq.updatedAt,
      evaluated: nasdaq.recentEvents.length > 0,
      now,
    })
  )
  publishMarketSnapshot(
    buildSnapshot({
      market: 'YM',
      today: dow.today,
      overallConfidence: dow.overallConfidence,
      latestEvent: dow.recentEvents[0] ?? null,
      updatedAt: dow.updatedAt,
      evaluated: dow.recentEvents.length > 0,
      now,
    })
  )
  publishMarketSnapshot(
    buildSnapshot({
      market: 'NK225',
      today: nikkei.today,
      overallConfidence: nikkei.overallConfidence,
      latestEvent: nikkei.recentEvents[0] ?? null,
      updatedAt: nikkei.updatedAt,
      evaluated: nikkei.recentEvents.length > 0,
      now,
    })
  )
}

/**
 * Formats a concise cross-market summary of all 5 Fundamental Specialist stances on the bus.
 * Used by Desk News Agent and Chart Leo to maintain full multi-agent situational awareness.
 */
export function formatAllMarketsDeskBriefSummary(): string {
  const rows: string[] = []
  for (const id of CANONICAL_MARKET_IDS) {
    const meta = canonicalMarketMeta(id)
    const snap = readMarketSnapshot(id)
    if (!snap || !meta) continue
    const statusTag = snap.source === 'evaluated' ? 'EVALUATED' : 'BASELINE_SEED'
    const confStr =
      snap.fundamental.confidence != null
        ? `${snap.fundamental.confidenceLabel} (${Math.round(snap.fundamental.confidence * 100)}%)`
        : snap.fundamental.confidenceLabel
    const catStr = snap.catalyst.type
      ? ` | Catalyst: ${snap.catalyst.type}${snap.catalyst.surprise ? ` (${snap.catalyst.surprise})` : ''}`
      : ''
    const confirmStr = snap.marketConfirmation.status
      ? ` | Confirmation: ${snap.marketConfirmation.status}`
      : ''
    rows.push(
      `- **${meta.displayName} (${meta.id} — ${meta.fundamentalsAgent})** [${statusTag}]: Intraday=${snap.fundamental.intraday} | Short-Term=${snap.fundamental.shortTerm} | Confidence=${confStr} | Driver: ${snap.primaryDriver || 'unspecified'}${catStr}${confirmStr}`
    )
  }
  return rows.length > 0
    ? rows.join('\n')
    : 'No specialist snapshots registered on the Market Intelligence Bus.'
}
