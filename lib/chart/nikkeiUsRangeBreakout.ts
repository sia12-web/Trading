/**
 * Mind Over Markets — Asian Session NYC/US Range Breakout & Rejection.
 * Port of the Pine overlay for NIKKEI live charts only (not Dow/Nasdaq).
 *
 *   - Build US H/L in **NY cash RTH** (09:30 → 16:00 ET) — traders in Nikkei
 *     during the US day session
 *   - Emit US BRK / REJ only in **Tokyo/Asia** cash (JST 09:00 → 15:00)
 *   - Chart H/L lines draw only across current Tokyo cash (not through London/NY)
 *
 * Separate from Initial Balance (Tokyo cash first hour) and OR30.
 */

import {
  hourInTz,
  tokyoDeskSessionAt,
  zonedCivilToUnix,
} from '@/lib/chart/sessionVwap'
import {
  DEFAULT_RANGE_RVOL,
  createRvolTracker,
} from '@/lib/chart/rangeBreakSignals'

export const NIKKEI_US_RANGE_COLORS = {
  high: '#dc2626',
  low: '#dc2626',
  brkLong: '#22c55e',
  brkShort: '#ef4444',
  rejHigh: '#f97316',
  rejLow: '#a855f7',
} as const

/**
 * @deprecated Desk-aligned New York band replaces hard-coded UTC.
 * Kept for docs / older call sites — prefer `inNikkeiUsBuildSession`.
 */
export const US_SESSION_UTC = { startHour: 13.5, endHour: 20 } as const
/**
 * @deprecated Desk-aligned Tokyo cash replaces hard-coded UTC Asia.
 * Prefer `inNikkeiUsSignalSession`.
 */
export const ASIA_SESSION_UTC = { startHour: 0, endHour: 9 } as const

export const DEFAULT_RVOL = {
  useVol: DEFAULT_RANGE_RVOL.useVol,
  thresh: DEFAULT_RANGE_RVOL.thresh,
  lookback: DEFAULT_RANGE_RVOL.lookback,
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
  /** Latest US range high/low (locked after NY ends until next NY open) */
  high: number
  low: number
  /** First bar of the US session that formed this range */
  fromTime: number
  /** Last bar where lines should plot (in NY or following Tokyo cash) */
  toTime: number
  /** True when tip is inside New York or Tokyo cash and a range exists */
  visible: boolean
  signals: UsRangeSignalMarker[]
}

export function isNikkeiUsRangeInstrument(
  instrument: string | null | undefined
): boolean {
  return instrument === 'NIKKEI'
}

/** Form US H/L — NY cash RTH 09:30–16:00 ET (Nikkei traders in the US day). */
export function inNikkeiUsBuildSession(unix: number): boolean {
  const h = hourInTz(unix, 'America/New_York')
  return h >= 9.5 && h < 16
}

/** US BRK / REJ — Tokyo cash Asia band only (09:00–15:00 JST). */
export function inNikkeiUsSignalSession(unix: number): boolean {
  return tokyoDeskSessionAt(unix) === 'Asia'
}

/** @deprecated use inNikkeiUsBuildSession — aligned to chart New York band */
export function inUsSessionUtc(unix: number): boolean {
  return inNikkeiUsBuildSession(unix)
}

/** @deprecated use inNikkeiUsSignalSession — aligned to chart Tokyo cash */
export function inAsiaSessionUtc(unix: number): boolean {
  return inNikkeiUsSignalSession(unix)
}

/** True when a long hole between two NY bars left the New York band (new session). */
function nySessionGapRestart(prevTime: number, curTime: number): boolean {
  if (curTime - prevTime <= 3 * 3600) return false
  // Mid-gap still in NY (e.g. sparse bars overnight) → same session
  if (inNikkeiUsBuildSession(Math.floor((prevTime + curTime) / 2))) return false
  for (let t = prevTime + 3600; t < curTime; t += 3600) {
    if (!inNikkeiUsBuildSession(t)) return true
  }
  return false
}

/**
 * Walk candles once: track NY H/L, emit Tokyo-cash breakout/rejection
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
  let prevBar: NikkeiUsRangeBar | null = null

  const signals: UsRangeSignalMarker[] = []
  const rvol = createRvolTracker(volLen)
  let firedBrkLong = false
  let firedBrkShort = false
  let firedRejHigh = false
  let firedRejLow = false

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!
    const inUs = inNikkeiUsBuildSession(c.time)
    const inTokyoCash = inNikkeiUsSignalSession(c.time)
    const gapNewSession =
      inUs &&
      prevInUs &&
      prevBar != null &&
      nySessionGapRestart(prevBar.time, c.time)
    const isUsStart = (inUs && !prevInUs) || gapNewSession

    // RVOL vs prior bars only — then fold this bar into the window
    const rvolOk = rvol.ok(c.volume, useVol, volThresh)
    rvol.push(c.volume)

    if (isUsStart) {
      usH = c.high
      usL = c.low
      usFrom = c.time
      firedBrkLong = firedBrkShort = firedRejHigh = firedRejLow = false
    } else if (inUs && usH != null && usL != null) {
      if (c.high > usH) usH = c.high
      if (c.low < usL) usL = c.low
    }

    // Visible while NY is building or Tokyo cash is reacting
    if ((inUs || inTokyoCash) && usH != null && usL != null) {
      visibleTo = c.time
    }

    // Signals only during Tokyo cash — BRK needs RVOL; REJ price-only; once/side.
    // BRK = first RVOL-confirmed close beyond H/L (sticky while beyond) so a quiet
    // first beyond bar does not permanently suppress the short/long marker.
    if (inTokyoCash && usH != null && usL != null && i > 0) {
      const beyondH = c.close > usH
      const beyondL = c.close < usL
      const rejectH = c.high > usH && c.close < usH
      const rejectL = c.low < usL && c.close > usL

      if (beyondH && rvolOk && !firedBrkLong) {
        firedBrkLong = true
        signals.push({
          time: c.time,
          type: 'US_BRK_LONG',
          price: c.low,
          text: 'US BRK',
          color: NIKKEI_US_RANGE_COLORS.brkLong,
          position: 'belowBar',
          shape: 'arrowUp',
        })
      } else if (beyondL && rvolOk && !firedBrkShort) {
        firedBrkShort = true
        signals.push({
          time: c.time,
          type: 'US_BRK_SHORT',
          price: c.high,
          text: 'US BRK',
          color: NIKKEI_US_RANGE_COLORS.brkShort,
          position: 'aboveBar',
          shape: 'arrowDown',
        })
      } else if (rejectH && !firedRejHigh) {
        firedRejHigh = true
        signals.push({
          time: c.time,
          type: 'US_REJ_HIGH',
          price: c.high,
          text: 'US REJ',
          color: NIKKEI_US_RANGE_COLORS.rejHigh,
          position: 'aboveBar',
          shape: 'arrowDown',
        })
      } else if (rejectL && !firedRejLow) {
        firedRejLow = true
        signals.push({
          time: c.time,
          type: 'US_REJ_LOW',
          price: c.low,
          text: 'US REJ',
          color: NIKKEI_US_RANGE_COLORS.rejLow,
          position: 'belowBar',
          shape: 'arrowUp',
        })
      }
    }

    prevInUs = inUs
    prevBar = c
  }

  if (usH == null || usL == null || usFrom == null || visibleTo == null) {
    return null
  }
  if (!(usH >= usL) || !Number.isFinite(usH) || !Number.isFinite(usL)) {
    return null
  }

  const tip = candles[candles.length - 1]!.time
  const visible =
    inNikkeiUsBuildSession(tip) || inNikkeiUsSignalSession(tip)

  return {
    high: Math.round(usH * 100) / 100,
    low: Math.round(usL * 100) / 100,
    fromTime: usFrom,
    toTime: visibleTo,
    visible,
    signals,
  }
}

export type NikkeiUsSessionRange = {
  high: number
  low: number
  open: number
  close: number
  fromTime: number
  toTime: number
  complete: boolean
  rangePts: number
}

/**
 * Collect each chart New York session range for Nikkei (JP225 bars).
 */
export function listNikkeiUsSessionRanges(
  candles: NikkeiUsRangeBar[]
): NikkeiUsSessionRange[] {
  const out: NikkeiUsSessionRange[] = []
  let high: number | null = null
  let low: number | null = null
  let open: number | null = null
  let close: number | null = null
  let fromTime: number | null = null
  let toTime: number | null = null
  let prevInUs = false
  let prevBar: NikkeiUsRangeBar | null = null

  const flush = (complete: boolean) => {
    if (
      high == null ||
      low == null ||
      open == null ||
      close == null ||
      fromTime == null ||
      toTime == null
    ) {
      return
    }
    if (!(high >= low) || !Number.isFinite(high) || !Number.isFinite(low)) return
    out.push({
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      open: Math.round(open * 100) / 100,
      close: Math.round(close * 100) / 100,
      fromTime,
      toTime,
      complete,
      rangePts: Math.round((high - low) * 100) / 100,
    })
  }

  const startSession = (c: NikkeiUsRangeBar) => {
    high = c.high
    low = c.low
    open = c.open
    close = c.close
    fromTime = c.time
    toTime = c.time
  }

  for (const c of candles) {
    const inUs = inNikkeiUsBuildSession(c.time)
    const gapNewSession =
      inUs &&
      prevInUs &&
      prevBar != null &&
      nySessionGapRestart(prevBar.time, c.time)
    const isUsStart = (inUs && !prevInUs) || gapNewSession

    if (isUsStart) {
      if (high != null) flush(true)
      startSession(c)
    } else if (inUs && high != null && low != null) {
      if (c.high > high) high = c.high
      if (c.low < low) low = c.low
      close = c.close
      toTime = c.time
    } else if (!inUs && prevInUs && high != null) {
      flush(true)
      high = low = open = close = fromTime = toTime = null
    }

    prevInUs = inUs
    prevBar = c
  }

  if (high != null && prevInUs) {
    flush(false)
  } else if (high != null) {
    flush(true)
  }

  return out
}

/**
 * Last NYC/US session range for Nikkei (chart New York band).
 */
export function lastNikkeiUsSessionRange(
  candles: NikkeiUsRangeBar[],
  opts?: { preferCompleted?: boolean }
): NikkeiUsSessionRange | null {
  const sessions = listNikkeiUsSessionRanges(candles)
  if (sessions.length === 0) return null
  const preferCompleted = opts?.preferCompleted !== false
  if (preferCompleted) {
    for (let i = sessions.length - 1; i >= 0; i--) {
      if (sessions[i]!.complete) return sessions[i]!
    }
  }
  return sessions[sessions.length - 1]!
}

function tokyoDayKey(unix: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000))
}

function addCalendarDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta, 12, 0, 0))
  return dt.toISOString().slice(0, 10)
}

/**
 * Tokyo cash open (09:00 JST) that trades this NY range.
 * NY runs 22:30 → 09:00; the Asia session that follows starts that morning at 09:00.
 */
export function tokyoCashOpenForUsRange(
  range: Pick<NikkeiUsSessionRange, 'fromTime' | 'toTime'>
): number {
  const t = range.toTime
  const h = hourInTz(t, 'Asia/Tokyo')
  let ymd = tokyoDayKey(t)
  // Evening NY / London on calendar day D → cash open is next morning (D+1)
  if (h >= 17) {
    ymd = addCalendarDaysYmd(ymd, 1)
  }
  return zonedCivilToUnix(ymd, 9, 'Asia/Tokyo')
}

function tokyoCashCloseUnix(openUnix: number): number {
  return zonedCivilToUnix(tokyoDayKey(openUnix), 15, 'Asia/Tokyo')
}

/**
 * Chart US H/L — last NYC levels, drawn only across the current Tokyo cash
 * session (09:00 → tip, capped at 15:00). Empty outside Tokyo cash so lines
 * never paint through London / prior NY bands.
 */
export function nikkeiUsRangeLineSeriesData(
  range: Pick<NikkeiUsSessionRange, 'high' | 'low' | 'fromTime' | 'toTime'> | NikkeiUsRangeResult,
  extendToUnix?: number
): {
  high: { time: number; value: number }[]
  low: { time: number; value: number }[]
} {
  const tip = extendToUnix ?? range.toTime
  if (!inNikkeiUsSignalSession(tip)) {
    return { high: [], low: [] }
  }
  const start = tokyoCashOpenForUsRange(range)
  const asiaClose = tokyoCashCloseUnix(start)
  if (tip < start) {
    return { high: [], low: [] }
  }
  const end = Math.max(start + 60, Math.min(tip, asiaClose))
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

/**
 * Chart overlay: last completed NYC range during Tokyo cash only.
 * Hidden overnight / London / dead zone — those sessions must not show US H/L.
 */
export function currentNikkeiUsRangeForChart(
  candles: NikkeiUsRangeBar[],
  nowUnix: number = Math.floor(Date.now() / 1000)
): NikkeiUsSessionRange | null {
  if (!inNikkeiUsSignalSession(nowUnix)) {
    return null
  }
  return lastNikkeiUsSessionRange(candles, { preferCompleted: true })
}
