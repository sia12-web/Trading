/**
 * Time / value acceptance — while a book is open, score whether price is still
 * auctioning toward TP or building value AT ENTRY.
 *
 * Pure (no I/O). Pocket is fill ± 0.3R (R = |entry − SL|), not the ±10 playbook
 * filter. Time since FILL only ramps confidence; there is no 15:00 cliff.
 * Advise only — never flatten, never trail SL/TP.
 */

export const VALUE_ACCEPTANCE_POCKET_R = 0.3
export const VALUE_ACCEPTANCE_EXTENSION_R = 0.5
/** Elapsed time below this never yields `looking_accepted`. */
export const VALUE_ACCEPTANCE_RAMP_START_MS = 8 * 60 * 1000
/** Stuck-in-pocket duration that supports a high-confidence accepted read. */
export const VALUE_ACCEPTANCE_RAMP_FULL_MS = 20 * 60 * 1000
/** BE-like / degenerate stop — too tight to call “value at entry”. */
export const VALUE_ACCEPTANCE_MIN_R = 2
export const VALUE_ACCEPTANCE_ACCEPTED_MESSAGE =
  'price is building value at entry — not confirming.'

export type ValueAcceptanceState =
  | 'still_auctioning'
  | 'looking_balanced'
  | 'looking_accepted'

export type ValueAcceptanceSide = 'LONG' | 'SHORT' | 'long' | 'short'

export type ValueAcceptanceBar = {
  high: number
  low: number
}

export type ValueAcceptanceInput = {
  side: ValueAcceptanceSide
  entry: number
  stopLoss: number
  takeProfit?: number | null
  /** Epoch ms */
  nowMs: number
  /** Fill time, epoch ms (or unix seconds — see {@link toEpochMs}) */
  filledAtMs: number
  lastPrice: number
  /** Optional 5m (or any) OHLC for overlap / max favorable excursion */
  recentBars?: readonly ValueAcceptanceBar[] | null
}

export type ValueAcceptanceResult = {
  state: ValueAcceptanceState
  /** 0–1 */
  confidence: number
  message: string
  pocketLow: number
  pocketHigh: number
  /** Signed R toward TP at lastPrice (negative = against) */
  rProgress: number
  elapsedMs: number
  maxFavorableR: number
}

export function toEpochMs(
  value: string | number | Date | null | undefined
): number | null {
  if (value == null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    return value < 1e12 ? Math.round(value * 1000) : value
  }
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isFinite(t) && t > 0 ? t : null
  }
  const t = Date.parse(String(value))
  return Number.isFinite(t) && t > 0 ? t : null
}

export function isLongSide(side: ValueAcceptanceSide | string): boolean {
  const d = String(side || '').toUpperCase()
  return d === 'LONG' || d === 'BUY'
}

export function riskR(entry: number, stopLoss: number): number {
  const r = Math.abs(Number(entry) - Number(stopLoss))
  return Number.isFinite(r) && r > 0 ? r : 0
}

export function entryPocketBounds(entry: number, stopLoss: number): {
  pocketLow: number
  pocketHigh: number
  r: number
} {
  const r = riskR(entry, stopLoss)
  const half = r * VALUE_ACCEPTANCE_POCKET_R
  return {
    r,
    pocketLow: entry - half,
    pocketHigh: entry + half,
  }
}

/** Signed R toward TP. */
export function rTowardTp(args: {
  side: ValueAcceptanceSide | string
  entry: number
  r: number
  price: number
}): number {
  if (!(args.r > 0) || !Number.isFinite(args.price)) return 0
  const move = isLongSide(args.side) ? args.price - args.entry : args.entry - args.price
  return move / args.r
}

export function timeRamp(elapsedMs: number): number {
  if (!(elapsedMs >= VALUE_ACCEPTANCE_RAMP_START_MS)) return 0
  const span = VALUE_ACCEPTANCE_RAMP_FULL_MS - VALUE_ACCEPTANCE_RAMP_START_MS
  if (!(span > 0)) return 1
  return Math.max(
    0,
    Math.min(1, (elapsedMs - VALUE_ACCEPTANCE_RAMP_START_MS) / span)
  )
}

export function valueAcceptanceLabel(state: ValueAcceptanceState): string {
  if (state === 'looking_accepted') return 'Looking accepted'
  if (state === 'looking_balanced') return 'Looking balanced'
  return 'Still auctioning'
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function barOverlapsBand(bar: ValueAcceptanceBar, low: number, high: number): boolean {
  return Number(bar.low) <= high && Number(bar.high) >= low
}

function auctioningResult(
  partial: Omit<ValueAcceptanceResult, 'state' | 'message'> & {
    message?: string
    confidence?: number
  }
): ValueAcceptanceResult {
  return {
    state: 'still_auctioning',
    confidence: clamp01(partial.confidence ?? 0.35),
    message: partial.message ?? 'Price is still auctioning toward the target.',
    pocketLow: partial.pocketLow,
    pocketHigh: partial.pocketHigh,
    rProgress: partial.rProgress,
    elapsedMs: partial.elapsedMs,
    maxFavorableR: partial.maxFavorableR,
  }
}

/**
 * Score whether the open book is still auctioning or building value at entry.
 * Prefer not calling `looking_accepted` when tape vs level is ambiguous.
 */
export function scoreValueAcceptance(input: ValueAcceptanceInput): ValueAcceptanceResult {
  const entry = Number(input.entry)
  const stopLoss = Number(input.stopLoss)
  const lastPrice = Number(input.lastPrice)
  const nowMs = Number(input.nowMs)
  const filledAtMs = Number(input.filledAtMs)
  const { r, pocketLow, pocketHigh } = entryPocketBounds(entry, stopLoss)
  const elapsedMs =
    Number.isFinite(nowMs) && Number.isFinite(filledAtMs) ? Math.max(0, nowMs - filledAtMs) : 0
  const rProgress = rTowardTp({ side: input.side, entry, r, price: lastPrice })

  const empty = {
    pocketLow,
    pocketHigh,
    rProgress,
    elapsedMs,
    maxFavorableR: rProgress,
  }

  if (
    !Number.isFinite(entry) ||
    !(entry > 0) ||
    !Number.isFinite(stopLoss) ||
    !(stopLoss > 0) ||
    !Number.isFinite(lastPrice) ||
    !(lastPrice > 0) ||
    !(r > 0) ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(filledAtMs) ||
    filledAtMs <= 0
  ) {
    return auctioningResult({
      ...empty,
      confidence: 0,
      message: 'Need a live quote and fill to read value at entry.',
    })
  }

  const long = isLongSide(input.side)
  let maxFavorableR = rProgress
  let leftPocketTowardTp = long ? lastPrice > pocketHigh : lastPrice < pocketLow
  let barsOverlapPocket = false
  const bars = input.recentBars

  if (Array.isArray(bars) && bars.length > 0) {
    for (const bar of bars) {
      const hi = Number(bar.high)
      const lo = Number(bar.low)
      if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue
      const fav = long ? hi : lo
      const favR = rTowardTp({ side: input.side, entry, r, price: fav })
      if (favR > maxFavorableR) maxFavorableR = favR
      if (long ? hi > pocketHigh : lo < pocketLow) leftPocketTowardTp = true
      if (barOverlapsBand(bar, pocketLow, pocketHigh)) barsOverlapPocket = true
    }
  }

  const insidePocket = lastPrice >= pocketLow && lastPrice <= pocketHigh
  const againstBeyondPocket = long ? lastPrice < pocketLow : lastPrice > pocketHigh
  const ramp = timeRamp(elapsedMs)
  const extended = maxFavorableR >= VALUE_ACCEPTANCE_EXTENSION_R || leftPocketTowardTp

  // Pause after ~0.5R (or after leaving the pocket) is a different event.
  if (maxFavorableR >= VALUE_ACCEPTANCE_EXTENSION_R) {
    return auctioningResult({
      ...empty,
      maxFavorableR,
      confidence: clamp01(0.45 + Math.min(0.4, maxFavorableR * 0.2)),
      message: 'Trade already made ~0.5R — a pause here is not entry accepted.',
    })
  }

  if (leftPocketTowardTp || rProgress > VALUE_ACCEPTANCE_POCKET_R) {
    return auctioningResult({
      ...empty,
      maxFavorableR,
      confidence: clamp01(0.4 + Math.min(0.35, Math.max(0, rProgress) * 0.4)),
      message: 'Price left the entry pocket — still auctioning toward the target.',
    })
  }

  if (againstBeyondPocket) {
    return auctioningResult({
      ...empty,
      maxFavorableR,
      confidence: 0.25,
      message: 'Price is away from entry against the book — not a value-at-entry read.',
    })
  }

  if (r < VALUE_ACCEPTANCE_MIN_R) {
    return auctioningResult({
      ...empty,
      maxFavorableR,
      confidence: 0.2,
      message: 'Stop is too tight to call value at entry.',
    })
  }

  // Progress toward TP while still inside the pocket — auction still live.
  if (rProgress >= 0.15 && elapsedMs < VALUE_ACCEPTANCE_RAMP_FULL_MS) {
    return auctioningResult({
      ...empty,
      maxFavorableR,
      confidence: clamp01(0.35 + rProgress * 0.4),
      message: 'Price is still auctioning toward the target.',
    })
  }

  const overlapOk =
    !bars || bars.length === 0 ? insidePocket : barsOverlapPocket || insidePocket
  const stuckInPocket = insidePocket && !extended && overlapOk
  const base = {
    pocketLow,
    pocketHigh,
    rProgress,
    elapsedMs,
    maxFavorableR,
  }

  if (!stuckInPocket) {
    return auctioningResult({
      ...base,
      confidence: 0.3,
      message: 'Cannot tell tape from level — not calling accepted.',
    })
  }

  // Before ~8 minutes: never looking_accepted. Young fill is still auctioning.
  if (elapsedMs < VALUE_ACCEPTANCE_RAMP_START_MS) {
    return auctioningResult({
      ...base,
      confidence: clamp01(0.15 + (elapsedMs / VALUE_ACCEPTANCE_RAMP_START_MS) * 0.15),
      message: 'Still early after the fill — price has not left the entry pocket.',
    })
  }

  // 8–20 min: overlapping / balanced. Time only ramps confidence.
  if (elapsedMs < VALUE_ACCEPTANCE_RAMP_FULL_MS || ramp < 1) {
    return {
      state: 'looking_balanced',
      confidence: clamp01(0.35 + ramp * 0.35),
      message: 'Overlapping near entry — value not accepted yet.',
      ...base,
    }
  }

  const extra =
    (elapsedMs - VALUE_ACCEPTANCE_RAMP_FULL_MS) / VALUE_ACCEPTANCE_RAMP_FULL_MS
  return {
    state: 'looking_accepted',
    confidence: clamp01(0.75 + 0.25 * extra),
    message: VALUE_ACCEPTANCE_ACCEPTED_MESSAGE,
    ...base,
  }
}
