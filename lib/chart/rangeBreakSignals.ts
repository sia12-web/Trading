/**
 * Shared range breakout / rejection signals for IB, OR30, Lunch, and US Range.
 *
 * Rules (desk grill):
 *   - BRK = close beyond range H/L with RVOL (default 1.2× / 20). First
 *     RVOL-ok bar while beyond counts (sticky) — not only the edge-cross bar.
 *   - REJ = wick beyond H/L with close back inside — price-only (no volume gate)
 *   - Once per side per range walk (anti-spam)
 *   - If the feed has no usable volume history, BRK falls back to price-only
 *     so CFD/index desks still paint breakouts.
 *   - OANDA futures/CFD tick counts (~6–10k) look like “volume” but never
 *     spike on breakdowns, so they are treated as unusable (same fallback).
 */

export const DEFAULT_RANGE_RVOL = {
  useVol: true,
  thresh: 1.2,
  lookback: 20,
} as const

/** Cash-index volume is millions; CFD tick counts sit well below this. */
export const INDEX_RVOL_FLOOR = 100_000

export type RangeBreakBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type RangeBreakSignalType =
  | 'BRK_LONG'
  | 'BRK_SHORT'
  | 'REJ_HIGH'
  | 'REJ_LOW'

export type RangeBreakSignal = {
  time: number
  type: RangeBreakSignalType
  price: number
  text: string
  color: string
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown'
}

export type RangeBreakColors = {
  brkLong: string
  brkShort: string
  rejHigh: string
  rejLow: string
}

/** Rolling average volume tracker for RVOL checks. */
export function createRvolTracker(lookback: number) {
  const len = Math.max(1, lookback)
  let sum = 0
  const q: number[] = []
  return {
    /** Mean of the prior lookback bars already pushed (excludes current). */
    avg(): number {
      return q.length >= len && len > 0 ? sum / len : NaN
    },
    push(volume: number): number {
      const v = Number.isFinite(volume) ? Math.max(0, volume) : 0
      q.push(v)
      sum += v
      if (q.length > len) sum -= q.shift()!
      return this.avg()
    },
    /**
     * RVOL gate vs prior lookback average.
     * Call BEFORE push(current) so the current bar is not in the average.
     * Missing / zero volume history → allow (price-only BRK fallback).
     */
    ok(volume: number, useVol: boolean, thresh: number): boolean {
      if (!useVol) return true
      const avg = this.avg()
      if (!Number.isFinite(avg) || avg <= 0) return true
      if (avg < INDEX_RVOL_FLOOR) return true
      const v = Number.isFinite(volume) ? Math.max(0, volume) : 0
      return v > avg * thresh
    },
  }
}

/**
 * Walk bars after `signalAfterUnix` and emit BRK/REJ vs fixed range H/L.
 */
export function computeRangeBreakRejectSignals(
  candles: RangeBreakBar[],
  range: { high: number; low: number },
  opts: {
    labelPrefix: string
    colors: RangeBreakColors
    signalAfterUnix: number
    useVol?: boolean
    volThresh?: number
    volLen?: number
    inSignalWindow?: (unix: number) => boolean
    /** Default true — first BRK/REJ per side only */
    oncePerSide?: boolean
  }
): RangeBreakSignal[] {
  if (candles.length < 2) return []
  if (!(range.high > range.low)) return []

  const useVol = opts.useVol ?? DEFAULT_RANGE_RVOL.useVol
  const volThresh = opts.volThresh ?? DEFAULT_RANGE_RVOL.thresh
  const volLen = opts.volLen ?? DEFAULT_RANGE_RVOL.lookback
  const once = opts.oncePerSide !== false
  const rvol = createRvolTracker(volLen)

  const signals: RangeBreakSignal[] = []
  let firedBrkLong = false
  let firedBrkShort = false
  let firedRejHigh = false
  let firedRejLow = false

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!
    // RVOL vs prior bars only — then fold this bar into the window
    const rvolOk = rvol.ok(c.volume, useVol, volThresh)
    rvol.push(c.volume)

    if (c.time < opts.signalAfterUnix) continue
    if (opts.inSignalWindow && !opts.inSignalWindow(c.time)) continue
    if (i === 0) continue

    // BRK = first RVOL-confirmed close beyond H/L (sticky while beyond).
    // Edge-cross-only missed forever when the first beyond bar failed RVOL.
    const beyondH = c.close > range.high
    const beyondL = c.close < range.low
    const rejectH = c.high > range.high && c.close < range.high
    const rejectL = c.low < range.low && c.close > range.low

    if (beyondH && rvolOk && (!once || !firedBrkLong)) {
      firedBrkLong = true
      signals.push({
        time: c.time,
        type: 'BRK_LONG',
        price: c.low,
        text: `${opts.labelPrefix} BRK`,
        color: opts.colors.brkLong,
        position: 'belowBar',
        shape: 'arrowUp',
      })
    } else if (beyondL && rvolOk && (!once || !firedBrkShort)) {
      firedBrkShort = true
      signals.push({
        time: c.time,
        type: 'BRK_SHORT',
        price: c.high,
        text: `${opts.labelPrefix} BRK`,
        color: opts.colors.brkShort,
        position: 'aboveBar',
        shape: 'arrowDown',
      })
    } else if (rejectH && (!once || !firedRejHigh)) {
      firedRejHigh = true
      signals.push({
        time: c.time,
        type: 'REJ_HIGH',
        price: c.high,
        text: `${opts.labelPrefix} REJ`,
        color: opts.colors.rejHigh,
        position: 'aboveBar',
        shape: 'arrowDown',
      })
    } else if (rejectL && (!once || !firedRejLow)) {
      firedRejLow = true
      signals.push({
        time: c.time,
        type: 'REJ_LOW',
        price: c.low,
        text: `${opts.labelPrefix} REJ`,
        color: opts.colors.rejLow,
        position: 'belowBar',
        shape: 'arrowUp',
      })
    }
  }

  return signals
}
