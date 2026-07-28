/**
 * Strategy-aware SL / TP for AI & structure limit entries.
 *
 * Position management (breakeven / trail) still runs after fill — this sets the
 * *initial* protective stop and target from the desk’s three-range playbook:
 *
 *   Range H/L = retail bait. Entry is in the stop pool beyond bait.
 *   SL  = beyond the active range edge (past the hunt), never tighter than zone.
 *         Stop-pool entries (beyond bait) usually land on the zone floor because
 *         it is wider than a thin liquidity pad — that is intentional.
 *   TP  = opposing range edge / mid / AVWAP / POC when RR ≥ 1.5; else 2R fallback.
 */

import {
  LEVEL_ZONE_PCT,
  LIQUIDITY_OFFSET_PCT,
  LIQUIDITY_RANGE_FRAC,
  ZONE_STOP_BUFFER_PCT,
  extendStopPastRound,
  snapProfitToRound,
  zoneStopPrice,
} from '@/lib/trading/deskLevels'

export type StrategyRangeEdges = {
  label: string
  high: number
  low: number
}

export type StrategyRiskMagnets = {
  avwap?: number | null
  poc?: number | null
  /** Extra opposing magnets (other range H/L, etc.) */
  extras?: number[]
}

export type StrategyStopSource = 'range' | 'zone'

/** Unextended zone stop — extend once at the end (never double-extend). */
function zoneStopRaw(entry: number, direction: 'LONG' | 'SHORT'): number {
  const half = entry * LEVEL_ZONE_PCT
  const buffer = entry * ZONE_STOP_BUFFER_PCT
  return direction === 'LONG'
    ? entry - half - buffer
    : entry + half + buffer
}

function mid(r: StrategyRangeEdges): number {
  return (r.high + r.low) / 2
}

function rangePad(entry: number, range: StrategyRangeEdges): number {
  const width = Math.max(0, range.high - range.low)
  return Math.max(
    entry * LIQUIDITY_OFFSET_PCT,
    width * LIQUIDITY_RANGE_FRAC * 0.25
  )
}

/**
 * Protective stop for strategy entries.
 * LONG → beyond active range low (and zone floor).
 * SHORT → beyond active range high (and zone ceiling).
 * Falls back to zoneStopPrice when no range is shaped, or entry is on the
 * wrong side of the range for the direction.
 */
export function strategyStopPrice(args: {
  entry: number
  direction: 'LONG' | 'SHORT'
  activeRange?: StrategyRangeEdges | null
}): number {
  return strategyStopDetail(args).stop
}

export function strategyStopDetail(args: {
  entry: number
  direction: 'LONG' | 'SHORT'
  activeRange?: StrategyRangeEdges | null
}): { stop: number; source: StrategyStopSource } {
  const { entry, direction } = args
  const zone = zoneStopPrice(entry, direction)
  const range = args.activeRange
  if (!range || !(range.high > range.low) || !(entry > 0)) {
    return { stop: zone, source: 'zone' }
  }

  const pad = rangePad(entry, range)
  const rawZone = zoneStopRaw(entry, direction)

  if (direction === 'LONG') {
    // Long above range high = wrong side for bait thesis → zone only
    if (entry > range.high) return { stop: zone, source: 'zone' }

    const beyondBait = range.low - pad
    let structural: number
    if (entry <= range.low) {
      // Stop-pool: SL must sit below entry (past the hunt)
      structural = beyondBait < entry ? beyondBait : entry - pad
    } else {
      // Inside range: SL beyond bait low
      structural = beyondBait
    }
    if (!(structural < entry)) return { stop: zone, source: 'zone' }

    // Never tighter than zone (further = smaller price for longs)
    const raw = Math.min(rawZone, structural)
    const stop = extendStopPastRound(raw, 'LONG', entry)
    const source: StrategyStopSource =
      Math.abs(stop - zone) <= entry * 1e-9 ? 'zone' : 'range'
    return { stop, source }
  }

  // SHORT below range low = wrong side → zone
  if (entry < range.low) return { stop: zone, source: 'zone' }

  const beyondBait = range.high + pad
  let structural: number
  if (entry >= range.high) {
    structural = beyondBait > entry ? beyondBait : entry + pad
  } else {
    structural = beyondBait
  }
  if (!(structural > entry)) return { stop: zone, source: 'zone' }

  const raw = Math.max(rawZone, structural)
  const stop = extendStopPastRound(raw, 'SHORT', entry)
  const source: StrategyStopSource =
    Math.abs(stop - zone) <= entry * 1e-9 ? 'zone' : 'range'
  return { stop, source }
}

function rewardOk(
  entry: number,
  stop: number,
  target: number,
  direction: 'LONG' | 'SHORT',
  minR: number
): boolean {
  const risk = Math.abs(entry - stop)
  if (!(risk > 0)) return false
  const reward =
    direction === 'LONG' ? target - entry : entry - target
  return reward >= risk * minR
}

/**
 * Initial take-profit from strategy magnets, then 2R fallback.
 * Soft-snaps to rounds without shrinking below 1.5R.
 */
export function strategyTakeProfitPrice(args: {
  entry: number
  stop: number
  direction: 'LONG' | 'SHORT'
  activeRange?: StrategyRangeEdges | null
  magnets?: StrategyRiskMagnets | null
}): number {
  const { entry, stop, direction } = args
  const risk = Math.abs(entry - stop)
  const fallbackDist = Math.max(risk * 2, entry * 0.005)
  const fallback =
    direction === 'LONG' ? entry + fallbackDist : entry - fallbackDist

  const candidates: { price: number; priority: number }[] = []
  const range = args.activeRange
  if (range && range.high > range.low) {
    // Opposing range edge = primary strategy target
    candidates.push({
      price: direction === 'LONG' ? range.high : range.low,
      priority: 0,
    })
    candidates.push({ price: mid(range), priority: 2 })
  }

  const m = args.magnets
  if (m?.avwap != null && m.avwap > 0) {
    candidates.push({ price: m.avwap, priority: 1 })
  }
  if (m?.poc != null && m.poc > 0) {
    candidates.push({ price: m.poc, priority: 1 })
  }
  for (const x of m?.extras ?? []) {
    if (x > 0) candidates.push({ price: x, priority: 3 })
  }

  const valid = candidates
    .filter((c) =>
      direction === 'LONG' ? c.price > entry : c.price < entry
    )
    .filter((c) => rewardOk(entry, stop, c.price, direction, 1.5))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      // Prefer closer valid magnet (realistic day-trade target)
      return Math.abs(a.price - entry) - Math.abs(b.price - entry)
    })

  const chosen = valid[0]?.price ?? fallback
  return snapProfitToRound(entry, stop, chosen, direction)
}

/** Full initial SL + TP for an AI/structure limit at `entry`. */
export function strategyEntryRisk(args: {
  entry: number
  direction: 'LONG' | 'SHORT'
  activeRange?: StrategyRangeEdges | null
  magnets?: StrategyRiskMagnets | null
}): {
  stop: number
  target: number
  rangeLabel: string | null
  stopSource: StrategyStopSource
} {
  const { stop, source } = strategyStopDetail(args)
  const target = strategyTakeProfitPrice({
    entry: args.entry,
    stop,
    direction: args.direction,
    activeRange: args.activeRange,
    magnets: args.magnets,
  })
  return {
    stop,
    target,
    rangeLabel: args.activeRange?.label ?? null,
    stopSource: source,
  }
}

/** Pick which named range is the active bait for the current playbook mode. */
export function activeRangeForPlaybook(args: {
  playbookMode: string
  instrument: string
  or30?: { high: number; low: number } | null
  ib?: { high: number; low: number } | null
  usRange?: { high: number; low: number } | null
  lunchRange?: { high: number; low: number } | null
}): StrategyRangeEdges | null {
  const tokyo = args.instrument === 'NIKKEI'
  const mode = args.playbookMode
  const pick = (
    label: string,
    r: { high: number; low: number } | null | undefined
  ): StrategyRangeEdges | null =>
    r && r.high > r.low ? { label, high: r.high, low: r.low } : null

  if (mode === 'us_range') return pick('US Range', args.usRange)
  if (mode === 'lunch_range') return pick('Lunch-range', args.lunchRange)
  if (mode === 'ib') {
    return tokyo
      ? pick('Tokyo IB', args.ib)
      : pick('IB', args.ib)
  }
  if (mode === 'lunch_break') {
    // Prep for next slot — use the next range if formed, else prior
    return tokyo
      ? pick('Tokyo IB', args.ib) ?? pick('US Range', args.usRange) ?? pick('OR30', args.or30)
      : pick('Lunch-range', args.lunchRange) ?? pick('IB', args.ib) ?? pick('OR30', args.or30)
  }
  // morning / done / default → OR30, then IB/US as fallback magnets for SL structure
  return (
    pick('OR30', args.or30) ??
    (tokyo ? pick('US Range', args.usRange) : pick('IB', args.ib))
  )
}
