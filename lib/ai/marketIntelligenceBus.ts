/**
 * Shared market-intelligence bus.
 *
 * Specialists publish normalized snapshots. Chart Leo consumes a compact
 * desk brief. Agents do not call each other.
 *
 * This process-local bus is the runtime seam. Append-only history is kept
 * in memory; the matching tables live in
 * supabase/migrations/20261004_market_intelligence_bus.sql.
 */

import { canonicalMarketMeta, resolveCanonicalMarketId, type CanonicalMarketId } from '@/lib/ai/canonicalMarkets'

export type DirectionalStance = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED' | 'UNKNOWN'

export type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

export type SnapshotSource = 'evaluated' | 'baseline-seed'

export type MarketIntelligenceSnapshot = {
  market: CanonicalMarketId
  timestamp: string
  source: SnapshotSource
  fundamental: {
    intraday: DirectionalStance
    shortTerm: DirectionalStance
    mediumTerm: DirectionalStance
    confidence: number | null
    confidenceLabel: ConfidenceLabel
  }
  primaryDriver: string | null
  catalyst: {
    type: string | null
    surprise: string | null
    magnitude: string | null
  }
  marketConfirmation: {
    status: 'CONFIRMED' | 'PARTIAL' | 'REJECTED' | 'INCONCLUSIVE' | null
  }
  abnormalBehavior: {
    detected: boolean
    type: string | null
  }
  upcoming: string | null
  whatChanged: string | null
  invalidation: string | null
  /** Age of the underlying specialist state at publish time, in seconds. */
  stateAgeSec: number | null
}

type BusEntry = {
  current: MarketIntelligenceSnapshot
  history: MarketIntelligenceSnapshot[]
}

const HISTORY_LIMIT = 200
const bus = new Map<CanonicalMarketId, BusEntry>()

export function clearMarketIntelligenceBusForTests(): void {
  bus.clear()
}

export function normalizeConfidence(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null
  if (raw > 1 && raw <= 100) return Math.round(raw) / 100
  if (raw < 0) return null
  return Math.round(Math.min(1, raw) * 100) / 100
}

export function confidenceLabel(confidence: number | null): ConfidenceLabel {
  if (confidence == null) return 'UNKNOWN'
  if (confidence >= 0.75) return 'HIGH'
  if (confidence >= 0.5) return 'MEDIUM'
  return 'LOW'
}

export function normalizeStance(raw?: string | null): DirectionalStance {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
  if (s === 'BULLISH' || s === 'BEARISH' || s === 'NEUTRAL' || s === 'MIXED') return s
  if (s.includes('BULL')) return 'BULLISH'
  if (s.includes('BEAR')) return 'BEARISH'
  if (s.includes('MIX')) return 'MIXED'
  if (s.includes('NEUT')) return 'NEUTRAL'
  return 'UNKNOWN'
}

function fingerprint(snap: MarketIntelligenceSnapshot): string {
  return JSON.stringify({
    source: snap.source,
    fundamental: snap.fundamental,
    primaryDriver: snap.primaryDriver,
    catalyst: snap.catalyst,
    marketConfirmation: snap.marketConfirmation,
    abnormalBehavior: snap.abnormalBehavior,
    upcoming: snap.upcoming,
    whatChanged: snap.whatChanged,
  })
}

/** Publish a snapshot. Unchanged fingerprints do not append history. */
export function publishMarketSnapshot(snap: MarketIntelligenceSnapshot): MarketIntelligenceSnapshot {
  const prev = bus.get(snap.market)
  if (prev && fingerprint(prev.current) === fingerprint(snap)) {
    return prev.current
  }
  const history = prev ? [prev.current, ...prev.history].slice(0, HISTORY_LIMIT) : []
  bus.set(snap.market, { current: snap, history })
  return snap
}

export function readMarketSnapshot(rawMarket?: string | null): MarketIntelligenceSnapshot | null {
  const id = resolveCanonicalMarketId(rawMarket)
  if (!id) return null
  return bus.get(id)?.current ?? null
}

export function readMarketSnapshotHistory(rawMarket?: string | null): MarketIntelligenceSnapshot[] {
  const id = resolveCanonicalMarketId(rawMarket)
  if (!id) return []
  const entry = bus.get(id)
  if (!entry) return []
  return [entry.current, ...entry.history]
}

/**
 * Compact block injected into Chart Leo.
 * Baseline seeds are named as such — Leo must not treat them as a live read.
 * Evaluated snapshots are a desk brief, not a trade signal.
 */
export function formatDeskBriefForInstrument(rawMarket?: string | null): string {
  const meta = canonicalMarketMeta(rawMarket)
  const label = meta?.displayName ?? String(rawMarket || 'UNKNOWN')
  const id = meta?.id ?? '—'
  const snap = readMarketSnapshot(rawMarket)

  if (!snap || snap.source !== 'evaluated') {
    return `[DESK BRIEF — ${label} / ${id}]
No evaluated fundamental snapshot is on the market intelligence bus.
Baseline specialist seeds are not a live read.
Do not invent a fundamental regime, catalyst, or confidence.
Execute only from verified chart structure (profile, AVWAP, CVD, location, invalidation, runway).`
  }

  const age =
    snap.stateAgeSec == null
      ? 'unknown'
      : snap.stateAgeSec < 90
        ? `${snap.stateAgeSec}s`
        : snap.stateAgeSec < 3600
          ? `${Math.round(snap.stateAgeSec / 60)}m`
          : `${Math.round(snap.stateAgeSec / 3600)}h`

  const lines = [
    `[DESK BRIEF — ${label} / ${id}]`,
    `Generated: ${snap.timestamp}`,
    `Fundamental state age: ${age}`,
    `Source: specialist evaluation (not a trade signal)`,
    ``,
    `Fundamental regime:`,
    `INTRADAY ${snap.fundamental.intraday}`,
    `SHORT TERM ${snap.fundamental.shortTerm}`,
    `MEDIUM TERM ${snap.fundamental.mediumTerm}`,
    ``,
    `Primary driver: ${snap.primaryDriver || 'unspecified'}`,
    `Upcoming: ${snap.upcoming || 'none stated'}`,
    `What changed: ${snap.whatChanged || 'none stated'}`,
    `Invalidation: ${snap.invalidation || 'none stated'}`,
    `Catalyst: ${snap.catalyst.type || 'none'} / surprise ${snap.catalyst.surprise || 'n/a'} / magnitude ${snap.catalyst.magnitude || 'n/a'}`,
    `Market confirmation: ${snap.marketConfirmation.status || 'not calculated'}`,
    `Abnormal behavior: ${snap.abnormalBehavior.detected ? snap.abnormalBehavior.type || 'detected' : 'none stated'}`,
    `Fundamental confidence: ${snap.fundamental.confidenceLabel}${
      snap.fundamental.confidence != null ? ` (${snap.fundamental.confidence})` : ''
    }`,
    ``,
    `Do not infer trade direction from this brief.`,
    `Wait for chart confirmation: location, effort vs result, structural invalidation, and room for 2R.`,
  ]
  return lines.join('\n')
}
