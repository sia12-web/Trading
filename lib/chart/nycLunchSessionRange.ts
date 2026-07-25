/**
 * Mind Over Markets — NYC Lunch Session Range (12:00–13:30 ET).
 * Port of the Pine overlay for DOW / NASDAQ live charts only (not Nikkei).
 *
 * Distinct from desk lunch flatten (11:30 ET): this is the afternoon lunch
 * range used as PM session levels (high / low / 50% half-back).
 */

import { nyDateTimeToUnix } from '@/lib/utils/dateUtils'
import { NY_INSTRUMENTS, type DeskInstrument } from '@/lib/trading/sessionGate'

export const NYC_LUNCH_COLORS = {
  high: '#ef4444',
  low: '#22c55e',
  mid: '#9ca3af',
  endMarker: '#a855f7',
} as const

/** Default window — America/New_York wall clock */
export const NYC_LUNCH_START_HMS = '12:00:00'
export const NYC_LUNCH_END_HMS = '13:30:00'

export type NycLunchBar = {
  time: number
  high: number
  low: number
}

export type NycLunchRange = {
  high: number
  low: number
  mid: number
  lunchStartUnix: number
  lunchEndUnix: number
  /** First bar inside the lunch window */
  fromTime: number
  /** Last bar inside the lunch window so far */
  toTime: number
  /** True once wall clock is past 13:30 ET (range locked) */
  complete: boolean
}

export function isNycLunchInstrument(
  instrument: string | null | undefined
): instrument is DeskInstrument {
  return (
    instrument === 'DOW' ||
    instrument === 'NASDAQ' ||
    (NY_INSTRUMENTS as string[]).includes(String(instrument))
  )
}

function parseHms(hms: string): { h: number; m: number } {
  const [h, m] = hms.split(':').map(Number)
  return { h: h || 0, m: m || 0 }
}

/**
 * Running (or locked) lunch high/low/mid for a NY calendar day.
 * Returns null before any lunch bar prints, or if instrument day has no bars.
 */
export function computeNycLunchRange(
  candles: NycLunchBar[],
  dayYmd: string,
  nowUnix: number = Math.floor(Date.now() / 1000),
  opts?: {
    lunchStartHms?: string
    lunchEndHms?: string
  }
): NycLunchRange | null {
  if (!dayYmd || candles.length === 0) return null

  const start = parseHms(opts?.lunchStartHms ?? NYC_LUNCH_START_HMS)
  const end = parseHms(opts?.lunchEndHms ?? NYC_LUNCH_END_HMS)
  const lunchStartUnix = nyDateTimeToUnix(dayYmd, start.h, start.m)
  const lunchEndUnix = nyDateTimeToUnix(dayYmd, end.h, end.m)
  if (!(lunchEndUnix > lunchStartUnix)) return null

  // Nothing to show before lunch opens
  if (nowUnix < lunchStartUnix) return null

  const lunchBars = candles.filter(
    (c) => c.time >= lunchStartUnix && c.time < lunchEndUnix
  )
  if (lunchBars.length === 0) return null

  let hi = -Infinity
  let lo = Infinity
  for (const c of lunchBars) {
    if (c.high > hi) hi = c.high
    if (c.low < lo) lo = c.low
  }
  if (!(hi >= lo) || !Number.isFinite(hi) || !Number.isFinite(lo)) return null

  const high = Math.round(hi * 100) / 100
  const low = Math.round(lo * 100) / 100
  const mid = Math.round(((high + low) / 2) * 100) / 100
  const fromTime = lunchBars[0]!.time
  const toTime = lunchBars[lunchBars.length - 1]!.time

  return {
    high,
    low,
    mid,
    lunchStartUnix,
    lunchEndUnix,
    fromTime,
    toTime,
    complete: nowUnix >= lunchEndUnix,
  }
}

/**
 * H / L / mid line points. Levels lock after lunch; with `extendToUnix`
 * (cash close / tip) lines continue into the PM session (Pine default).
 */
export function nycLunchLineSeriesData(
  range: NycLunchRange,
  extendToUnix?: number,
  opts?: { showMid?: boolean }
): {
  high: { time: number; value: number }[]
  low: { time: number; value: number }[]
  mid: { time: number; value: number }[]
} {
  const showMid = opts?.showMid !== false
  const start = range.fromTime
  const end = Math.max(
    start + 60,
    range.toTime,
    range.complete
      ? Number.isFinite(extendToUnix)
        ? (extendToUnix as number)
        : range.lunchEndUnix
      : range.toTime
  )

  const high = [
    { time: start, value: range.high },
    { time: end, value: range.high },
  ]
  const low = [
    { time: start, value: range.low },
    { time: end, value: range.low },
  ]
  const mid = showMid
    ? [
        { time: start, value: range.mid },
        { time: end, value: range.mid },
      ]
    : []

  return { high, low, mid }
}

export type NycLunchEndMarker = {
  time: number
  text: string
  color: string
  position: 'aboveBar' | 'belowBar'
  shape: 'circle' | 'arrowDown'
}

/** Vertical “1:30 PM / PM SESSION OPEN” cue at lunch end (Pine end markers). */
export function nycLunchEndMarkers(range: NycLunchRange): NycLunchEndMarker[] {
  if (!range.complete) return []
  // Anchor on last lunch bar (or scheduled end if no bar landed exactly)
  const t = range.toTime > 0 ? range.toTime : range.lunchEndUnix - 1
  return [
    {
      time: t,
      text: '1:30 PM',
      color: NYC_LUNCH_COLORS.endMarker,
      position: 'aboveBar',
      shape: 'arrowDown',
    },
  ]
}
