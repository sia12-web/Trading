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
import { isOr30MorningEntryWindowOpen } from '@/lib/trading/sessionGate'

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

/** Pick which named range is the active bait for the current playbook mode.
 *  ±10 entries require the range to be fully shaped (locked):
 *    DOW/NASDAQ: OR30 after 30m · IB after first hour · Lunch after 13:30 ET
 *    NIKKEI:     OR30 after 30m · prior NYC US Range (already complete) · Tokyo IB after first hour
 *
 *  OR30 sits inside the first-hour IB and is optional — never forced.
 *  When IB is shaped and morning had 0 fills, OR30 is finished and bait hands off to IB
 *  (Nikkei: morning playbook keeps locked OR30 ±10; US Range only after playbookMode is us_range,
 *  or as a preview while OR30 is still forming).
 */
export function activeRangeForPlaybook(args: {
  playbookMode: string
  instrument: string
  or30?: { high: number; low: number; complete?: boolean } | null
  ib?: { high: number; low: number; complete?: boolean } | null
  usRange?: { high: number; low: number; complete?: boolean } | null
  lunchRange?: { high: number; low: number; complete?: boolean } | null
  /** Filled morning/OR30 attempts today — 0 means OR30 was skipped. */
  morningAttempts?: number
}): StrategyRangeEdges | null {
  const tokyo = args.instrument === 'NIKKEI'
  const mode = args.playbookMode
  const morningFills = Math.max(0, Math.floor(args.morningAttempts ?? 0))
  const or30Skipped = morningFills === 0

  const pick = (
    label: string,
    r: { high: number; low: number; complete?: boolean } | null | undefined,
    opts?: { /** When true, require complete === true (forming ranges blocked). */ mustBeComplete?: boolean }
  ): StrategyRangeEdges | null => {
    if (!r || !(r.high > r.low)) return null
    if (opts?.mustBeComplete && r.complete !== true) return null
    return { label, high: r.high, low: r.low }
  }

  // IB from computeInitialBalance is only returned after the hour locks → always shaped.
  const ibShaped = pick(tokyo ? 'Tokyo IB' : 'IB', args.ib)
  // Prior NYC session for Nikkei — only when that US cash day is complete.
  const usShaped = pick('US Range', args.usRange, { mustBeComplete: true })
  const or30Shaped = pick('OR30', args.or30, { mustBeComplete: true })
  const lunchShaped = pick('Lunch-range', args.lunchRange, { mustBeComplete: true })

  if (mode === 'us_range') return usShaped
  if (mode === 'lunch_range') return lunchShaped
  if (mode === 'ib') return ibShaped
  if (mode === 'lunch_break') {
    // Prep for next slot — only shaped next/prior ranges (never a forming lunch/OR30).
    return tokyo
      ? ibShaped ?? usShaped ?? or30Shaped
      : lunchShaped ?? ibShaped ?? or30Shaped
  }

  // morning / done / default
  // OR30 is optional. Once the overlapping first-hour IB is locked and OR30 was
  // never traded, finish OR30 and hand off to IB (NY). Nikkei: while morning
  // playbook owns the optional OR30 probe (locked), prefer OR30 ±10 — do not let
  // prior NYC US Range steal the highlight. Preview US Range only while OR30 is
  // still forming/absent; once playbookMode is us_range, US owns the bands.
  if (tokyo) {
    if (or30Shaped) return or30Shaped
    if (usShaped) return usShaped
    return null
  }
  if (or30Skipped && ibShaped) {
    return ibShaped
  }
  return or30Shaped
}

/**
 * Chart overlay ±10 candidates: every shaped range whose script/toggle is ON.
 * Does not apply the OR30 dead-window exception — use
 * {@link entryEligibleOverlayRanges} for paint / snap.
 *
 * IB / Tokyo IB: pass `showIb: true` when IB H/L overlay is visible (same as BRK/REJ toggle).
 *
 * Every returned range uses the shared gate: ±10 of **H / 50% mid / L**
 * (DOW · NASDAQ · NIKKEI — OR30, US Range, IB/Tokyo IB, Lunch-range alike).
 */
export function visibleOverlayEntryRanges(args: {
  instrument: string
  showOr30?: boolean
  showIb?: boolean
  showUsRange?: boolean
  showLunchRange?: boolean
  or30?: { high: number; low: number; complete?: boolean } | null
  ib?: { high: number; low: number; complete?: boolean } | null
  usRange?: { high: number; low: number; complete?: boolean } | null
  lunchRange?: { high: number; low: number; complete?: boolean } | null
}): StrategyRangeEdges[] {
  const tokyo = args.instrument === 'NIKKEI'
  const out: StrategyRangeEdges[] = []

  const push = (
    label: string,
    r: { high: number; low: number; complete?: boolean } | null | undefined,
    show: boolean | undefined,
    mustBeComplete: boolean
  ) => {
    if (!show) return
    if (!r || !(r.high > r.low)) return
    if (mustBeComplete && r.complete !== true) return
    out.push({ label, high: r.high, low: r.low })
  }

  // OR30 / US / lunch require an explicit lock; IB is only present after the hour locks.
  push('OR30', args.or30, args.showOr30, true)
  push('US Range', args.usRange, args.showUsRange && tokyo, true)
  push(tokyo ? 'Tokyo IB' : 'IB', args.ib, args.showIb, false)
  push('Lunch-range', args.lunchRange, args.showLunchRange && !tokyo, true)
  return out
}

/**
 * Painted ±10 bands + drag/click snap targets.
 *
 * Unified toggle rule — never paint a range when its script toggle is OFF:
 * - **OR30:** toggle ON + morning OR30 entry window still open (no ±10 after entryClose).
 * - **US / IB / Lunch:** toggle ON + shaped (chart dims when not the live entry window).
 *
 * Band geometry is always H + **50% mid** + L via {@link rangeEdgeBands} for every
 * desk instrument (DOW / NASDAQ / NIKKEI) and every slot range.
 *
 * Place-order legality still uses {@link activeRangeForPlaybook} + session gates.
 * `morningAttempts` is accepted for API stability (unused here).
 */
export function entryEligibleOverlayRanges(args: {
  playbookMode: string
  instrument: string
  now?: Date
  showOr30?: boolean
  showIb?: boolean
  showUsRange?: boolean
  showLunchRange?: boolean
  or30?: { high: number; low: number; complete?: boolean } | null
  ib?: { high: number; low: number; complete?: boolean } | null
  usRange?: { high: number; low: number; complete?: boolean } | null
  lunchRange?: { high: number; low: number; complete?: boolean } | null
  morningAttempts?: number
}): StrategyRangeEdges[] {
  const mode = args.playbookMode
  const now = args.now ?? new Date()
  const or30Open = isOr30MorningEntryWindowOpen(args.instrument, now)
  const toggled = visibleOverlayEntryRanges(args)

  return toggled.filter((r) => {
    if (r.label === 'OR30') {
      return mode === 'morning' && or30Open
    }
    // US / IB / Tokyo IB / Lunch: shaped + toggle already enforced by visibleOverlayEntryRanges.
    return true
  })
}

/**
 * Limit drag / open-box snap targets from the painted overlay set
 * (see {@link entryEligibleOverlayRanges}). Optionally include `active` when the
 * caller already confirmed it is among the visible bands. Dedupes by label+H/L.
 * Place-order legality still uses {@link activeRangeForPlaybook} alone.
 */
export function studyEntrySnapRanges(args: {
  active: StrategyRangeEdges | null | undefined
  overlays: StrategyRangeEdges[]
}): StrategyRangeEdges[] {
  const out: StrategyRangeEdges[] = []
  const seen = new Set<string>()
  const push = (r: StrategyRangeEdges | null | undefined) => {
    if (!r || !(r.high > r.low)) return
    const key = `${r.label}:${r.high}:${r.low}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(r)
  }
  push(args.active ?? null)
  for (const o of args.overlays) push(o)
  return out
}
