/**
 * Adapts in-memory Fundamentals specialist state onto the market intelligence bus.
 * Does not refresh network feeds. Leo consumes the bus; it does not call the agents.
 */

import { peekDowFundamentalState } from '@/lib/fundamentals/dowStateStore'
import { peekGoldFundamentalState } from '@/lib/fundamentals/goldStateStore'
import { peekNasdaqFundamentalState } from '@/lib/fundamentals/nasdaqStateStore'
import { peekNikkeiFundamentalState } from '@/lib/fundamentals/nikkeiStateStore'
import { peekOilFundamentalState } from '@/lib/fundamentals/oilStateStore'
import type { CanonicalMarketId } from '@/lib/ai/canonicalMarkets'
import {
  confidenceLabel,
  normalizeConfidence,
  normalizeStance,
  publishMarketSnapshot,
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
  upcoming_catalysts?: string
  top_catalysts?: string[]
  what_changed_since_yesterday?: string
  what_would_invalidate_this_view?: string
  what_would_invalidate_the_current_interpretation?: string
  updatedAt?: string
  updated_at?: string
}

function ageSec(iso: string | undefined, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round((now.getTime() - t) / 1000))
}

function buildSnapshot(args: {
  market: CanonicalMarketId
  today: TodayLike
  updatedAt?: string
  evaluated: boolean
  now: Date
}): MarketIntelligenceSnapshot {
  const today = args.today
  const generatedAt = today.updatedAt || today.updated_at || args.updatedAt || args.now.toISOString()
  const confidence = normalizeConfidence(today.confidence)
  const source: SnapshotSource = args.evaluated ? 'evaluated' : 'baseline-seed'
  const upcoming = today.upcoming_catalysts || (today.top_catalysts || []).join('; ') || null
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
    primaryDriver:
      today.main_current_market_driver ||
      today.main_current_driver ||
      today.primary_current_driver ||
      null,
    catalyst: { type: null, surprise: null, magnitude: null },
    marketConfirmation: { status: null },
    abnormalBehavior: { detected: false, type: null },
    upcoming,
    whatChanged: today.what_changed_since_yesterday || null,
    invalidation:
      today.what_would_invalidate_this_view ||
      today.what_would_invalidate_the_current_interpretation ||
      null,
    stateAgeSec: ageSec(generatedAt, args.now),
  }
}

/** Copy current specialist memory onto the bus. Safe to call on every Leo turn. */
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
      updatedAt: oil.updatedAt,
      evaluated: oil.recentEvents.length > 0,
      now,
    })
  )
  publishMarketSnapshot(
    buildSnapshot({
      market: 'GC',
      today: gold.today,
      updatedAt: gold.updatedAt,
      evaluated: gold.recentEvents.length > 0,
      now,
    })
  )
  publishMarketSnapshot(
    buildSnapshot({
      market: 'NQ',
      today: nasdaq.today,
      updatedAt: nasdaq.updatedAt,
      evaluated: nasdaq.recentEvents.length > 0,
      now,
    })
  )
  publishMarketSnapshot(
    buildSnapshot({
      market: 'YM',
      today: dow.today,
      updatedAt: dow.updatedAt,
      evaluated: dow.recentEvents.length > 0,
      now,
    })
  )
  publishMarketSnapshot(
    buildSnapshot({
      market: 'NK225',
      today: nikkei.today,
      updatedAt: nikkei.updatedAt,
      evaluated: nikkei.recentEvents.length > 0,
      now,
    })
  )
}
