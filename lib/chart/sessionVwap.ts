/**
 * Session high/low ranges for NY desk charts.
 * Drawn as time-bounded overlays (not full-width price lines) so they never
 * mix with BUY/SHORT level lines.
 */

import type { UTCTimestamp } from 'lightweight-charts'

export const SESSION_STYLES = {
  Asia: {
    color: 'rgba(56, 189, 248, 0.18)',
    zIndex: 1,
    line: '#38bdf8',
    short: 'Asia',
  },
  London: {
    color: 'rgba(250, 204, 21, 0.16)',
    zIndex: 2,
    line: '#facc15',
    short: 'Lon',
  },
  'New York': {
    color: 'rgba(74, 222, 128, 0.16)',
    zIndex: 3,
    line: '#4ade80',
    short: 'NY',
  },
} as const

export type SessionName = keyof typeof SESSION_STYLES

/**
 * Desk session windows in America/New_York (works with Yahoo RTH + overnight gaps).
 * Asia = overnight: prior 18:00 → 03:00 into the cash day, AND day 18:00 → next 03:00
 * after the cash close (live post-NY bars must still get the Asia highlight).
 */
export const SESSION_WINDOWS = {
  Asia: { tz: 'America/New_York', start: 18, end: 3 }, // 18:00 → 03:00 (crosses midnight)
  London: { tz: 'America/New_York', start: 3, end: 9.5 }, // 03:00 → 09:30
  'New York': { tz: 'America/New_York', start: 9.5, end: 16 }, // 09:30 → 16:00
} as const

export interface SessionHighlightRect {
  name: SessionName
  color: string
  left: number
  width: number
  /** Y of session high (price-bounded box, not full pane) */
  top: number
  /** Height from session high → low */
  height: number
  zIndex: number
}

export const VWAP_COLORS = {
  vwap: '#b8a04a',
  band: '#3d8f7a',
} as const

export const SESSION_RANGE_ORDER: SessionName[] = ['Asia', 'London', 'New York']

export interface SessionBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SessionRange {
  name: SessionName
  high: number
  low: number
  /** First bar time in session */
  startT: number
  /** Last bar time in session so far */
  endT: number
  /** Scheduled session close (local window end) — range hidden until this passes */
  scheduledEndT: number
  color: string
  shortLabel: string
  /** Bar times inside this session — range lines only exist on these */
  barTimes: number[]
}

/** Pixel bracket for one session range (top + bottom edge only). */
export interface SessionRangeOverlay {
  name: SessionName
  color: string
  left: number
  width: number
  top: number
  height: number
  zIndex: number
}

export function isSessionTradingDay(
  dayUnix: number,
  market: 'US' | 'ASIA' = 'US'
): boolean {
  const dow = new Date(dayUnix * 1000).getUTCDay()
  if (market === 'ASIA') return dow !== 6
  return dow !== 0 && dow !== 6
}

export function hourInTz(unix: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(unix * 1000))
  let hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  if (hour === 24) hour = 0
  return hour + minute / 60
}

export function sessionEdgeUnix(
  dayUnix: number,
  decimalHour: number,
  tz: string
): number {
  let guess = dayUnix + decimalHour * 3600
  for (let pass = 0; pass < 2; pass++) {
    let diff = decimalHour - hourInTz(guess, tz)
    if (diff > 12) diff -= 24
    if (diff < -12) diff += 24
    if (diff === 0) break
    guess += diff * 3600
  }
  return guess
}

export function timeToX(
  timeScale: { timeToCoordinate: (t: UTCTimestamp) => number | null },
  t: number,
  candleTimes: number[]
): number | null {
  const direct = timeScale.timeToCoordinate(t as UTCTimestamp)
  if (direct !== null) return direct
  if (candleTimes.length === 0) return null

  const first = candleTimes[0]!
  const last = candleTimes[candleTimes.length - 1]!
  if (t <= first) return timeScale.timeToCoordinate(first as UTCTimestamp)
  if (t >= last) return timeScale.timeToCoordinate(last as UTCTimestamp)

  let lo = 0
  let hi = candleTimes.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (candleTimes[mid]! <= t) lo = mid
    else hi = mid
  }
  const t0 = candleTimes[lo]!
  const t1 = candleTimes[hi]!
  const x0 = timeScale.timeToCoordinate(t0 as UTCTimestamp)
  const x1 = timeScale.timeToCoordinate(t1 as UTCTimestamp)
  if (x0 === null && x1 === null) return null
  if (x0 === null) return x1
  if (x1 === null) return x0
  const f = (t - t0) / (t1 - t0 || 1)
  return x0 + (x1 - x0) * f
}

/**
 * Latest finished Asia / London / NY session ranges from bars that exist.
 * Current in-progress session is excluded until its scheduled end (live + sim).
 * Yahoo index data is often RTH-only — Asia may be absent; London overlap + NY still show.
 */
export function computeLatestSessionRanges(
  candles: SessionBar[],
  asOfUnix?: number
): SessionRange[] {
  const now =
    asOfUnix != null && Number.isFinite(asOfUnix)
      ? asOfUnix
      : Math.floor(Date.now() / 1000)

  const bars = candles.filter((c) => c.time <= now)
  if (bars.length === 0) return []

  const firstBarT = bars[0]!.time
  const lastBarT = bars[bars.length - 1]!.time

  const daySet = new Set<number>()
  for (const c of bars) {
    daySet.add(Math.floor(c.time / 86400) * 86400)
  }
  const expanded = new Set<number>()
  for (const d of daySet) {
    expanded.add(d - 86400)
    expanded.add(d)
    expanded.add(d + 86400)
  }

  const latest = new Map<SessionName, SessionRange>()

  for (const dayUnix of Array.from(expanded).sort((a, b) => a - b)) {
    for (const name of Object.keys(SESSION_WINDOWS) as SessionName[]) {
      const w = SESSION_WINDOWS[name]
      if (name === 'Asia') {
        if (!isSessionTradingDay(dayUnix, 'ASIA')) continue
      } else if (!isSessionTradingDay(dayUnix, 'US')) {
        continue
      }

      const scheduledStart = sessionEdgeUnix(dayUnix, w.start, w.tz)
      const scheduledEnd = sessionEdgeUnix(dayUnix, w.end, w.tz)

      // Only draw range after the session has fully finished
      if (now < scheduledEnd) continue
      if (scheduledEnd <= firstBarT || scheduledStart >= lastBarT) continue

      const inSession: SessionBar[] = []
      let high = -Infinity
      let low = Infinity
      for (const c of bars) {
        if (c.time < scheduledStart || c.time > scheduledEnd) continue
        inSession.push(c)
        if (c.high > high) high = c.high
        if (c.low < low) low = c.low
      }
      if (inSession.length < 2 || !Number.isFinite(high) || !Number.isFinite(low) || high < low) {
        continue
      }

      const style = SESSION_STYLES[name]
      const range: SessionRange = {
        name,
        high,
        low,
        startT: inSession[0]!.time,
        endT: inSession[inSession.length - 1]!.time,
        scheduledEndT: scheduledEnd,
        color: style.line,
        shortLabel: style.short,
        barTimes: inSession.map((c) => c.time),
      }
      const prev = latest.get(name)
      if (!prev || range.scheduledEndT >= prev.scheduledEndT) latest.set(name, range)
    }
  }

  return Array.from(latest.values()).sort((a, b) => a.startT - b.startT)
}

/**
 * One point per session bar — horizontal H/L that cannot extend past the session.
 */
export function sessionRangeLinePoints(range: SessionRange): {
  high: { time: number; value: number }[]
  low: { time: number; value: number }[]
} {
  const times =
    range.barTimes.length >= 2
      ? range.barTimes
      : [range.startT, range.endT]

  return {
    high: times.map((time) => ({ time, value: range.high })),
    low: times.map((time) => ({ time, value: range.low })),
  }
}

/**
 * Session color boxes: horizontal span = session time.
 * Vertical: full pane by default so Asia/London stay visible when the price
 * scale is zoomed to NY (price-bounded boxes used to collapse to height 0).
 * Needs 24h bars (OANDA) for Asia/London to have candles inside those windows.
 */
export function computeSessionHighlightRects(args: {
  candles: SessionBar[]
  timeScale: {
    timeToCoordinate: (t: UTCTimestamp) => number | null
    height: () => number
  }
  priceToY: (price: number) => number | null
  priceScaleWidth: number
  containerWidth: number
  containerHeight: number
  /** Live = now; sim = sim clock */
  asOfUnix?: number
  /** DOW/NASDAQ → NY windows; NIKKEI → Tokyo windows */
  instrument?: string | null
  /**
   * true (default): full-pane height columns (session always visible on X).
   * false: box only covers session high→low (can vanish when price zoomed away).
   */
  fullHeight?: boolean
}): { rects: SessionHighlightRect[]; paneHeight: number } {
  const { candles, timeScale, priceToY } = args
  if (candles.length === 0) return { rects: [], paneHeight: 0 }

  const now =
    args.asOfUnix != null && Number.isFinite(args.asOfUnix)
      ? args.asOfUnix
      : Math.floor(Date.now() / 1000)

  const bars = candles.filter((c) => c.time <= now)
  if (bars.length === 0) return { rects: [], paneHeight: 0 }

  const candleTimes = bars.map((c) => c.time)
  const firstBarT = candleTimes[0]!
  const lastBarT = candleTimes[candleTimes.length - 1]!

  const paneW = Math.max(args.containerWidth - args.priceScaleWidth, 0)
  const timeAxisH = timeScale.height() || 28
  const paneHeight = Math.max(args.containerHeight - timeAxisH, 0)
  const useFullHeight = args.fullHeight !== false
  const isTokyo = args.instrument === 'NIKKEI'
  const clockTz = isTokyo ? 'Asia/Tokyo' : 'America/New_York'

  const dayKeys = new Set<string>()
  for (const c of bars) {
    dayKeys.add(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: clockTz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(c.time * 1000))
    )
  }

  const rects: SessionHighlightRect[] = []

  const pushSpan = (name: SessionName, startT: number, endT: number) => {
    if (endT <= firstBarT || startT >= lastBarT) return
    const clipEnd = Math.min(endT, Math.max(now, startT))
    if (clipEnd <= startT) return

    let high = -Infinity
    let low = Infinity
    let count = 0
    for (const c of bars) {
      if (c.time < startT || c.time > clipEnd) continue
      if (c.high > high) high = c.high
      if (c.low < low) low = c.low
      count++
    }
    // Need real bars in the window (OANDA 24h supplies Asia/London)
    if (count < 2 || !Number.isFinite(high) || !Number.isFinite(low) || high < low) return

    const x1 = timeToX(timeScale, Math.max(startT, firstBarT), candleTimes)
    const x2 = timeToX(timeScale, Math.min(clipEnd, lastBarT), candleTimes)
    if (x1 == null || x2 == null) return

    const left = Math.max(Math.min(x1, x2), 0)
    const right = Math.min(Math.max(x1, x2), paneW)
    const width = right - left
    if (width < 2) return

    let top = 0
    let height = paneHeight

    if (!useFullHeight) {
      const yHigh = priceToY(high)
      const yLow = priceToY(low)
      if (yHigh == null || yLow == null) return
      top = Math.max(Math.min(yHigh, yLow), 0)
      const bottom = Math.min(Math.max(yHigh, yLow), paneHeight)
      height = bottom - top
      // Price zoom moved this session's range off-screen — keep a time column
      if (height < 2) {
        top = 0
        height = paneHeight
      }
    }

    if (height < 2) return

    rects.push({
      name,
      left,
      width,
      top,
      height,
      color: SESSION_STYLES[name].color,
      zIndex: SESSION_STYLES[name].zIndex,
    })
  }

  const seen = new Set<string>()
  const pushOnce = (name: SessionName, startT: number, endT: number) => {
    const key = `${name}:${startT}:${endT}`
    if (seen.has(key)) return
    seen.add(key)
    pushSpan(name, startT, endT)
  }

  for (const dayStr of Array.from(dayKeys).sort()) {
    const [y, m, d] = dayStr.split('-').map(Number)
    const dayAnchor = Math.floor(Date.UTC(y!, m! - 1, d!, 12, 0, 0) / 1000)
    const dow = new Date(`${dayStr}T12:00:00Z`).getUTCDay()
    const isCashDay = dow !== 0 && dow !== 6

    if (isTokyo) {
      // Tokyo desk: overnight (prior 15:00 → 09:00), morning (09:00 → 11:30),
      // afternoon window exists but live candles clip it — still label if bars exist.
      if (!isCashDay) continue
      const overnightStart = sessionEdgeUnix(dayAnchor - 86400, 15, clockTz)
      const cashOpen = sessionEdgeUnix(dayAnchor, 9, clockTz)
      const lunch = sessionEdgeUnix(dayAnchor, 11.5, clockTz)
      const close = sessionEdgeUnix(dayAnchor, 15, clockTz)
      pushOnce('Asia', overnightStart, cashOpen)
      pushOnce('London', cashOpen, lunch)
      pushOnce('New York', lunch, close)
      continue
    }

    // Asia INTO this civil day (prev 18:00 → day 03:00) — always for weekdays
    if (isCashDay) {
      const asiaInStart = sessionEdgeUnix(
        dayAnchor - 86400,
        SESSION_WINDOWS.Asia.start,
        'America/New_York'
      )
      const asiaInEnd = sessionEdgeUnix(
        dayAnchor,
        SESSION_WINDOWS.Asia.end,
        'America/New_York'
      )
      pushOnce('Asia', asiaInStart, asiaInEnd)
    }

    // Asia AFTER this civil day (day 18:00 → next 03:00).
    if (isCashDay || dow === 0) {
      const asiaOutStart = sessionEdgeUnix(
        dayAnchor,
        SESSION_WINDOWS.Asia.start,
        'America/New_York'
      )
      const asiaOutEnd = sessionEdgeUnix(
        dayAnchor + 86400,
        SESSION_WINDOWS.Asia.end,
        'America/New_York'
      )
      pushOnce('Asia', asiaOutStart, asiaOutEnd)
    }

    if (!isCashDay) continue

    const lonStart = sessionEdgeUnix(dayAnchor, SESSION_WINDOWS.London.start, 'America/New_York')
    const lonEnd = sessionEdgeUnix(dayAnchor, SESSION_WINDOWS.London.end, 'America/New_York')
    pushOnce('London', lonStart, lonEnd)

    const nyStart = sessionEdgeUnix(
      dayAnchor,
      SESSION_WINDOWS['New York'].start,
      'America/New_York'
    )
    const nyEnd = sessionEdgeUnix(
      dayAnchor,
      SESSION_WINDOWS['New York'].end,
      'America/New_York'
    )
    pushOnce('New York', nyStart, nyEnd)
  }

  rects.sort((a, b) => a.zIndex - b.zIndex)
  return { rects, paneHeight }
}

/** Desk clock — same pipeline for every index; only TZ + cash open differ. */
export type DeskClock = {
  timeZone: string
  /** Cash open as decimal hours in that TZ (NY 9.5, Tokyo 9.0) */
  cashOpenHour: number
  /** Overnight lead-in start (decimal hour) on the day before first kept session */
  overnightStartHour: number
  openLabel: string
}

export const NY_DESK_CLOCK: DeskClock = {
  timeZone: 'America/New_York',
  cashOpenHour: 9.5,
  overnightStartHour: 18,
  openLabel: 'NY 9:30',
}

export const TOKYO_DESK_CLOCK: DeskClock = {
  timeZone: 'Asia/Tokyo',
  cashOpenHour: 9,
  overnightStartHour: 15, // prior TSE close → next cash open
  openLabel: 'Tokyo 9:00',
}

export function deskClockFor(instrument: string | null | undefined): DeskClock {
  return instrument === 'NIKKEI' ? TOKYO_DESK_CLOCK : NY_DESK_CLOCK
}

/**
 * Keep last N cash weekdays of bars, including overnight lead-in before the
 * first kept day. Same rule for DOW/NASDAQ/NIKKEI — only the desk clock changes.
 */
export function lastNTradingSessions(
  candles: SessionBar[],
  n: number,
  clock: DeskClock = NY_DESK_CLOCK
): SessionBar[] {
  if (candles.length === 0) return candles

  const dayKey = (unix: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: clock.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(unix * 1000))

  const days = Array.from(new Set(candles.map((c) => dayKey(c.time))))
    .filter((d) => {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
      return dow !== 0 && dow !== 6
    })
    .sort()

  if (days.length === 0) return candles

  const kept = days.slice(-n)
  const first = kept[0]!
  const [y, m, d] = first.split('-').map(Number)
  const dayAnchor = Math.floor(Date.UTC(y!, m! - 1, d!, 12, 0, 0) / 1000)
  const cutoff = sessionEdgeUnix(
    dayAnchor - 86400,
    clock.overnightStartHour,
    clock.timeZone
  )

  return candles.filter((c) => c.time >= cutoff)
}

function hourMinuteInTz(
  unix: number,
  timeZone: string
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(unix * 1000))
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  return { hour: hour === 24 ? 0 : hour, minute }
}

/**
 * Anchored VWAP from cash open of the first bar in the series.
 * Same math for every index — pass deskClockFor(instrument) for timing.
 */
export function computeAnchoredVwap(
  candles: SessionBar[],
  clock: DeskClock = NY_DESK_CLOCK
): {
  vwap: { time: UTCTimestamp; value: number }[]
  upper1: { time: UTCTimestamp; value: number }[]
  lower1: { time: UTCTimestamp; value: number }[]
  upper2: { time: UTCTimestamp; value: number }[]
  lower2: { time: UTCTimestamp; value: number }[]
  upper3: { time: UTCTimestamp; value: number }[]
  lower3: { time: UTCTimestamp; value: number }[]
} | null {
  if (candles.length === 0) return null

  const openH = Math.floor(clock.cashOpenHour)
  const openM = Math.round((clock.cashOpenHour - openH) * 60)

  let startIdx = 0
  for (let i = 0; i < candles.length; i++) {
    const { hour, minute } = hourMinuteInTz(candles[i]!.time, clock.timeZone)
    if (hour > openH || (hour === openH && minute >= openM)) {
      startIdx = i
      break
    }
  }

  let sumPV = 0
  let sumV = 0
  let sumP2V = 0
  const vwap: { time: UTCTimestamp; value: number }[] = []
  const upper1: { time: UTCTimestamp; value: number }[] = []
  const lower1: { time: UTCTimestamp; value: number }[] = []
  const upper2: { time: UTCTimestamp; value: number }[] = []
  const lower2: { time: UTCTimestamp; value: number }[] = []
  const upper3: { time: UTCTimestamp; value: number }[] = []
  const lower3: { time: UTCTimestamp; value: number }[] = []

  for (let i = startIdx; i < candles.length; i++) {
    const c = candles[i]!
    const price = (c.high + c.low + c.close) / 3
    const vol = c.volume > 0 ? c.volume : 1
    sumPV += price * vol
    sumP2V += price * price * vol
    sumV += vol
    if (sumV <= 0) continue
    const v = sumPV / sumV
    const variance = Math.max(0, sumP2V / sumV - v * v)
    const std = Math.sqrt(variance)
    const t = c.time as UTCTimestamp
    vwap.push({ time: t, value: v })
    upper1.push({ time: t, value: v + std })
    lower1.push({ time: t, value: v - std })
    upper2.push({ time: t, value: v + 2 * std })
    lower2.push({ time: t, value: v - 2 * std })
    upper3.push({ time: t, value: v + 3 * std })
    lower3.push({ time: t, value: v - 3 * std })
  }

  return vwap.length
    ? { vwap, upper1, lower1, upper2, lower2, upper3, lower3 }
    : null
}
