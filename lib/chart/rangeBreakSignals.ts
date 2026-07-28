/**
 * Shared range breakout / rejection signals for IB, OR30, Lunch, and US Range.
 *
 * Rules (desk grill):
 *   - BRK = close crosses beyond range H/L, requires RVOL (default 1.2× / 20)
 *   - REJ = wick beyond H/L with close back inside — price-only (no volume gate)
 *   - Once per side per range walk (anti-spam)
 */

export const DEFAULT_RANGE_RVOL = {
  useVol: true,
  thresh: 1.2,
  lookback: 20,
} as const

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
    push(volume: number): number {
      q.push(volume)
      sum += volume
      if (q.length > len) sum -= q.shift()!
      return q.length >= len && len > 0 ? sum / len : NaN
    },
    ok(volume: number, useVol: boolean, thresh: number): boolean {
      if (!useVol) return true
      const avg = q.length >= len && len > 0 ? sum / len : NaN
      return Number.isFinite(avg) && avg > 0 && volume > avg * thresh
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
    const avgReady = rvol.push(c.volume)
    void avgReady

    if (c.time < opts.signalAfterUnix) continue
    if (opts.inSignalWindow && !opts.inSignalWindow(c.time)) continue
    if (i === 0) continue

    const prev = candles[i - 1]!
    const rvolOk = rvol.ok(c.volume, useVol, volThresh)

    const crossUp = prev.close <= range.high && c.close > range.high
    const crossDn = prev.close >= range.low && c.close < range.low
    const rejectH = c.high > range.high && c.close < range.high && !crossUp
    const rejectL = c.low < range.low && c.close > range.low && !crossDn

    if (crossUp && rvolOk && (!once || !firedBrkLong)) {
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
    } else if (crossDn && rvolOk && (!once || !firedBrkShort)) {
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
