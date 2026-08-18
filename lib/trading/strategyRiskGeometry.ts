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
 *   TP  = 1.5R of the protective stop (trader can drag after). Magnets do not
 *         override the initial 1:1.5 display.
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
import { takeProfitFromStopR } from '@/lib/trading/positionSizing'
import {
  bucketForRangeLabel,
  deskClockSeconds,
  isBucketWindowOpen,
} from '@/lib/trading/attemptLadder'
import {
  deskMarketFor,
  isOr30MorningEntryWindowOpen,
} from '@/lib/trading/sessionGate'

/** Whether a painted overlay label is the current playbook's tradeable range. */
function isActivePlaybookOverlayLabel(
  mode: string,
  label: string,
  instrument: string
): boolean {
  const tokyo = instrument === 'NIKKEI'
  if (mode === 'morning') return label === 'OR30'
  if (mode === 'us_range') return label === 'US Range'
  if (mode === 'ib') return label === (tokyo ? 'Tokyo IB' : 'IB')
  if (mode === 'lunch_range') return label === 'Lunch-range'
  return false
}

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

/**
 * Initial take-profit is always 1.5R of |entry − stop|.
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
  const raw = takeProfitFromStopR({ entry, stop, direction })
  return snapProfitToRound(entry, stop, raw, direction)
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
/**
 * All four painted ranges, independently resolved to their shaped H/L
 * (or null while forming/absent) — used both by {@link activeRangeForPlaybook}
 * (single sequential pick) and by callers that need to attribute a specific
 * clicked price to its OWN range (IB vs Lunch vs OR30 vs US Range), never
 * just the current sequential pick.
 */
export function shapedPlaybookRanges(args: {
  instrument: string
  or30?: { high: number; low: number; complete?: boolean } | null
  ib?: { high: number; low: number; complete?: boolean } | null
  usRange?: { high: number; low: number; complete?: boolean } | null
  lunchRange?: { high: number; low: number; complete?: boolean } | null
}): {
  or30: StrategyRangeEdges | null
  ib: StrategyRangeEdges | null
  usRange: StrategyRangeEdges | null
  lunchRange: StrategyRangeEdges | null
} {
  const tokyo = args.instrument === 'NIKKEI'
  const pick = (
    label: string,
    r: { high: number; low: number; complete?: boolean } | null | undefined,
    opts?: { /** When true, require complete === true (forming ranges blocked). */ mustBeComplete?: boolean }
  ): StrategyRangeEdges | null => {
    if (!r || !(r.high > r.low)) return null
    if (opts?.mustBeComplete && r.complete !== true) return null
    return { label, high: r.high, low: r.low }
  }

  return {
    // IB from computeInitialBalance is only returned after the hour locks → always shaped.
    ib: pick(tokyo ? 'Tokyo IB' : 'IB', args.ib),
    // Prior NYC session for Nikkei — only when that US cash day is complete.
    usRange: pick('US Range', args.usRange, { mustBeComplete: true }),
    or30: pick('OR30', args.or30, { mustBeComplete: true }),
    lunchRange: pick('Lunch-range', args.lunchRange, { mustBeComplete: true }),
  }
}

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

  const {
    or30: or30Shaped,
    ib: ibShaped,
    usRange: usShaped,
    lunchRange: lunchShaped,
  } = shapedPlaybookRanges(args)

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
 * Every returned range uses the shared gate: ±10 of **H / L**
 * (DOW · NASDAQ · NIKKEI — OR30, IB/Tokyo IB, Lunch-range, US Range).
 * 50% mid is never a legal entry (see {@link rangeEdgeBands}).
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
 * Painted ±10 bands (right-scale tags). Drag/click snap still uses
 * {@link studyEntrySnapRanges} with the locked playbook range even when the
 * matching study toggle is off.
 *
 * Entry ±10 paint requires the matching study toggle for every range:
 * - **OR30:** R toggle + morning playbook + OR30 entry window still open.
 * - **Lunch-range:** N toggle + shaped lunch, and either active playbook or
 *   open lunch bucket.
 * - **IB / Tokyo IB:** B toggle — never auto-paints from the playbook clock.
 * - **US Range (Nikkei):** U toggle — never auto-paints from the playbook clock.
 *
 * Tokyo IB ±10 also waits until first-hour lock (10:00 desk / 21:00 Montreal).
 *
 * Band geometry is H + L via {@link rangeEdgeBands} for every playbook
 * range. **50% mid is never an entry.**
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
  const shaped = shapedPlaybookRanges(args)
  const market = deskMarketFor(args.instrument)
  const timeSec = deskClockSeconds(args.instrument, now)

  const isEntryClockEligible = (r: StrategyRangeEdges): boolean => {
    if (r.label === 'OR30') {
      return !!args.showOr30 && mode === 'morning' && or30Open
    }
    // Every study is toggle-gated — playbook / bucket clock never auto-paints ±10.
    if (r.label === 'US Range' && !args.showUsRange) {
      return false
    }
    if ((r.label === 'IB' || r.label === 'Tokyo IB') && !args.showIb) {
      return false
    }
    if (r.label === 'Lunch-range' && !args.showLunchRange) {
      return false
    }
    // Active playbook still highlights among toggled studies.
    if (isActivePlaybookOverlayLabel(mode, r.label, args.instrument)) {
      return true
    }
    // Otherwise only while that range's own entry bucket is clock-open
    // (leftover probes — never paint a future window like Tokyo IB before 10:00 lock).
    const bucket = bucketForRangeLabel(args.instrument, r.label)
    if (!bucket || bucket === 'morning' || bucket === 'other') return false
    return isBucketWindowOpen(market, bucket, timeSec)
  }

  // Toggled studies ∩ clock. Shaped extras only when that study is ON.
  const byKey = new Map<string, StrategyRangeEdges>()
  const push = (r: StrategyRangeEdges | null | undefined) => {
    if (!r || !(r.high > r.low) || !isEntryClockEligible(r)) return
    byKey.set(`${r.label}:${r.high}:${r.low}`, r)
  }
  for (const r of toggled) push(r)
  if (args.showOr30) push(shaped.or30)
  if (args.showIb) push(shaped.ib)
  if (args.showUsRange) push(shaped.usRange)
  if (args.showLunchRange) push(shaped.lunchRange)
  return [...byKey.values()]
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
