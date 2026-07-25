/**
 * Mind Over Markets — Asian Session NYC/US Range Breakout & Rejection.
 * Port of the Pine overlay for NIKKEI live charts only (not Dow/Nasdaq).
 *
 * Tracks the US session high/low (default UTC 13:30–20:00), then during the
 * Asian session (default UTC 00:00–09:00 ≈ 09:00–18:00 JST) flags:
 *   - US BRK: close crosses US H/L with optional RVOL filter
 *   - REJ: wick beyond US H/L, close back inside
 *
 * Separate from Initial Balance (Tokyo cash first hour) and from the NY lunch
 * range overlay (Dow/Nasdaq only).
 */

import { hourInTz } from '@/lib/chart/sessionVwap'

export const NIKKEI_US_RANGE_COLORS = {
  high: '#ef4444',
  low: '#ef4444',
  brkLong: '#22c55e',
  brkShort: '#ef4444',
  rejHigh: '#f97316',
  rejLow: '#a855f7',
} as const

/** Pine defaults — Session Times group, timezone UTC */
export const US_SESSION_UTC = { startHour: 13.5, endHour: 20 } as const
export const ASIA_SESSION_UTC = { startHour: 0, endHour: 9 } as const

export const DEFAULT_RVOL = {
  useVol: true,
  thresh: 1.2,
  lookback: 20,
} as const

export type NikkeiUsRangeBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type UsRangeSignalType =
  | 'US_BRK_LONG'
  | 'US_BRK_SHORT'
  | 'US_REJ_HIGH'
  | 'US_REJ_LOW'

export type UsRangeSignalMarker = {
  time: number
  type: UsRangeSignalType
  price: number
  text: string
  color: string
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown'
}

export type NikkeiUsRangeResult = {
  /** Latest US range high/low (locked after US ends until next US open) */
  high: number
  low: number
  /** First bar of the US session that formed this range */
  fromTime: number
  /** Last bar where lines should plot (in US or following Asia) */
  toTime: number
  /** True when tip is inside US or Asia and a range exists */
  visible: boolean
  signals: UsRangeSignalMarker[]
}

export function isNikkeiUsRangeInstrument(
  instrument: string | null | undefined
): boolean {
  return instrument === 'NIKKEI'
}

export function inUsSessionUtc(unix: number): boolean {
  const h = hourInTz(unix, 'UTC')
  return h >= US_SESSION_UTC.startHour && h < US_SESSION_UTC.endHour
}

export function inAsiaSessionUtc(unix: number): boolean {
  const h = hourInTz(unix, 'UTC')
  return h >= ASIA_SESSION_UTC.startHour && h < ASIA_SESSION_UTC.endHour
}

/**
 * Walk candles once: track US H/L, emit Asia-session breakout/rejection
 * markers, and return the latest range for line series.
 */
export function computeNikkeiUsRangeBreakout(
  candles: NikkeiUsRangeBar[],
  opts?: {
    useVol?: boolean
    volThresh?: number
    volLen?: number
  }
): NikkeiUsRangeResult | null {
  if (candles.length === 0) return null

  const useVol = opts?.useVol ?? DEFAULT_RVOL.useVol
  const volThresh = opts?.volThresh ?? DEFAULT_RVOL.thresh
  const volLen = Math.max(1, opts?.volLen ?? DEFAULT_RVOL.lookback)

  let usH: number | null = null
  let usL: number | null = null
  let usFrom: number | null = null
  let visibleTo: number | null = null
  let prevInUs = false

  const signals: UsRangeSignalMarker[] = []

  // Rolling volume sum for SMA
  let volSum = 0
  const volQ: number[] = []

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!
    const inUs = inUsSessionUtc(c.time)
    const inAsia = inAsiaSessionUtc(c.time)
    const isUsStart = inUs && !prevInUs

    // Volume SMA (Pine ta.sma — needs full lookback before RVOL gates)
    volQ.push(c.volume)
    volSum += c.volume
    if (volQ.length > volLen) volSum -= volQ.shift()!
    const avgVol = volQ.length >= volLen ? volSum / volLen : NaN
    const rvolOk =
      !useVol || (Number.isFinite(avgVol) && avgVol > 0 && c.volume > avgVol * volThresh)

    if (isUsStart) {
      usH = c.high
      usL = c.low
      usFrom = c.time
    } else if (inUs && usH != null && usL != null) {
      if (c.high > usH) usH = c.high
      if (c.low < usL) usL = c.low
    }

    if ((inUs || inAsia) && usH != null && usL != null) {
      visibleTo = c.time
    }

    // Signals only during Asia with a formed US range
    if (inAsia && usH != null && usL != null && i > 0) {
      const prev = candles[i - 1]!
      const crossUp = prev.close <= usH && c.close > usH
      const crossDn = prev.close >= usL && c.close < usL
      const rejectH = c.high > usH && c.close < usH
      const rejectL = c.low < usL && c.close > usL

      if (crossUp && rvolOk) {
        signals.push({
          time: c.time,
          type: 'US_BRK_LONG',
          price: c.low,
          text: 'US BRK',
          color: NIKKEI_US_RANGE_COLORS.brkLong,
          position: 'belowBar',
          shape: 'arrowUp',
        })
      } else if (crossDn && rvolOk) {
        signals.push({
          time: c.time,
          type: 'US_BRK_SHORT',
          price: c.high,
          text: 'US BRK',
          color: NIKKEI_US_RANGE_COLORS.brkShort,
          position: 'aboveBar',
          shape: 'arrowDown',
        })
      } else if (rejectH) {
        signals.push({
          time: c.time,
          type: 'US_REJ_HIGH',
          price: c.high,
          text: 'REJ',
          color: NIKKEI_US_RANGE_COLORS.rejHigh,
          position: 'aboveBar',
          shape: 'arrowDown',
        })
      } else if (rejectL) {
        signals.push({
          time: c.time,
          type: 'US_REJ_LOW',
          price: c.low,
          text: 'REJ',
          color: NIKKEI_US_RANGE_COLORS.rejLow,
          position: 'belowBar',
          shape: 'arrowUp',
        })
      }
    }

    prevInUs = inUs
  }

  if (usH == null || usL == null || usFrom == null || visibleTo == null) {
    return null
  }
  if (!(usH >= usL) || !Number.isFinite(usH) || !Number.isFinite(usL)) {
    return null
  }

  const tip = candles[candles.length - 1]!.time
  const visible = inUsSessionUtc(tip) || inAsiaSessionUtc(tip)

  return {
    high: Math.round(usH * 100) / 100,
    low: Math.round(usL * 100) / 100,
    fromTime: usFrom,
    toTime: visibleTo,
    visible,
    signals,
  }
}

/** US H/L line segment — plotted while US or Asia session is active (Pine plot_cond). */
export function nikkeiUsRangeLineSeriesData(
  range: NikkeiUsRangeResult
): {
  high: { time: number; value: number }[]
  low: { time: number; value: number }[]
} {
  if (!range.visible) {
    return { high: [], low: [] }
  }
  const start = range.fromTime
  const end = Math.max(start + 60, range.toTime)
  return {
    high: [
      { time: start, value: range.high },
      { time: end, value: range.high },
    ],
    low: [
      { time: start, value: range.low },
      { time: end, value: range.low },
    ],
  }
}
