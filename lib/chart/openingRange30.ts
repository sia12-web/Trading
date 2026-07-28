/**
 * Opening range — first 30 minutes of cash open (distinct from 60m IB).
 *
 *   DOW / NASDAQ: 09:30 → 10:00 ET
 *   NIKKEI:       09:00 → 09:30 JST (≈ 20:00–20:30 ET Montreal in summer)
 */

import {
  computeInitialBalance,
  ibLineSeriesData,
  type DeskBar,
  type InitialBalanceRange,
} from '@/lib/trading/deskLevels'

export const OR30_MINUTES = 30

/** @deprecated use OR30_MINUTES */
export const NIKKEI_OR30_MINUTES = OR30_MINUTES

export const OR30_COLORS = {
  high: '#14b8a6', // teal — distinct from IB blue + US red
  low: '#14b8a6',
} as const

/** @deprecated use OR30_COLORS */
export const NIKKEI_OR30_COLORS = OR30_COLORS

export type Or30Range = InitialBalanceRange

/** @deprecated use Or30Range */
export type NikkeiOr30Range = Or30Range

export function isOr30Instrument(
  instrument: string | null | undefined
): boolean {
  return instrument === 'DOW' || instrument === 'NASDAQ' || instrument === 'NIKKEI'
}

/** @deprecated use isOr30Instrument */
export function isNikkeiOr30Instrument(
  instrument: string | null | undefined
): boolean {
  return instrument === 'NIKKEI'
}

/** Short schedule hint for tooltips / legend. */
export function or30WindowLabel(
  instrument: string | null | undefined
): string {
  return instrument === 'NIKKEI'
    ? '09:00–09:30 JST · 20:00–20:30 ET'
    : '09:30–10:00 ET'
}

/**
 * First 30m H/L from cash open (pass the desk’s open unix).
 * Forms live once ≥2 bars exist; locks after the 30m window.
 */
export function computeOr30Range(
  candles: DeskBar[],
  openUnix: number,
  nowUnix: number = Math.floor(Date.now() / 1000)
): Or30Range | null {
  if (!openUnix || candles.length === 0) return null
  if (nowUnix < openUnix) return null

  const endUnix = openUnix + OR30_MINUTES * 60
  const bars = candles.filter(
    (c) => c.time >= openUnix && c.time < endUnix && c.time <= nowUnix
  )

  if (bars.length < 2) {
    return nowUnix >= endUnix
      ? computeInitialBalance(candles, openUnix, nowUnix, OR30_MINUTES)
      : null
  }

  let hi = -Infinity
  let lo = Infinity
  for (const c of bars) {
    if (c.high > hi) hi = c.high
    if (c.low < lo) lo = c.low
  }
  if (!(hi > lo) || !Number.isFinite(hi) || !Number.isFinite(lo)) return null

  const fromTime = bars[0]!.time as number
  const toTime = bars[bars.length - 1]!.time as number
  if (!(toTime > fromTime)) return null

  return {
    high: Math.round(hi * 100) / 100,
    low: Math.round(lo * 100) / 100,
    openUnix,
    endUnix,
    fromTime,
    toTime,
  }
}

/** @deprecated use computeOr30Range */
export function computeNikkeiOr30Range(
  candles: DeskBar[],
  openUnix: number,
  nowUnix: number = Math.floor(Date.now() / 1000)
): Or30Range | null {
  return computeOr30Range(candles, openUnix, nowUnix)
}

/** IB-style 2-point H/L extended to tip. */
export function or30LineSeriesData(
  range: Or30Range,
  extendToUnix?: number
): {
  high: { time: number; value: number }[]
  low: { time: number; value: number }[]
} {
  return ibLineSeriesData(range, extendToUnix)
}

/** @deprecated use or30LineSeriesData */
export function nikkeiOr30LineSeriesData(
  range: Or30Range,
  extendToUnix?: number
): {
  high: { time: number; value: number }[]
  low: { time: number; value: number }[]
} {
  return or30LineSeriesData(range, extendToUnix)
}
