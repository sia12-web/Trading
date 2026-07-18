/**
 * Session high/low ranges for NY desk charts.
 * Drawn as time-bounded overlays (not full-width price lines) so they never
 * mix with BUY/SHORT level lines.
 */

import type { UTCTimestamp } from 'lightweight-charts'

export const SESSION_STYLES = {
  Asia: {
    color: 'rgba(56, 189, 248, 0.28)',
    zIndex: 1,
    line: '#38bdf8',
    short: 'Asia',
  },
  London: {
    color: 'rgba(250, 204, 21, 0.26)',
    zIndex: 2,
    line: '#facc15',
    short: 'Lon',
  },
  'New York': {
    color: 'rgba(74, 222, 128, 0.26)',
    zIndex: 3,
    line: '#4ade80',
    short: 'NY',
  },
} as const

export type SessionName = keyof typeof SESSION_STYLES

/**
 * Desk session windows in America/New_York — contiguous, no dead zone.
 * Asia starts at cash close (16:00) so post-NY bars are never uncolored
 * (old 18:00 start left a 16:00–18:00 gap that looked like “broken extension”).
 */
export const SESSION_WINDOWS = {
  Asia: { tz: 'America/New_York', start: 16, end: 3 }, // 16:00 → 03:00 (crosses midnight)
  London: { tz: 'America/New_York', start: 3, end: 9.5 }, // 03:00 → 09:30
  'New York': { tz: 'America/New_York', start: 9.5, end: 16 }, // 09:30 → 16:00
} as const

/** Classify a bar into Asia / London / NY — every clock hour maps to exactly one session. */
export function nyDeskSessionAt(unix: number): SessionName {
  const h = hourInTz(unix, 'America/New_York')
  if (h >= SESSION_WINDOWS.Asia.start || h < SESSION_WINDOWS.Asia.end) return 'Asia'
  if (h < SESSION_WINDOWS.London.end) return 'London'
  return 'New York'
}

export const SESSION_RANGE_ORDER: SessionName[] = ['Asia', 'London', 'New York']

/** Shared legend — Asia / London / New York for every desk instrument. */
export function sessionLegendLabel(name: SessionName, _instrument?: string | null): string {
  return name
}

/** Legend swatch order — identical for DOW, NASDAQ, and NIKKEI. */
export function sessionLegendOrder(_instrument?: string | null): SessionName[] {
  return SESSION_RANGE_ORDER
}

export interface SessionHighlightRect {
  name: SessionName
  color: string
  left: number
  width: number
  /** Y of session high (price-bounded) */
  top: number
  /** Height from session high → low */
  height: number
  zIndex: number
}

export const VWAP_COLORS = {
  vwap: '#b8a04a',
  band: '#3d8f7a',
} as const

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
  if (t >= last) {
    // Extrapolate past tip so endT = lastOpen + barSec covers the full last candle
    const xLast = timeScale.timeToCoordinate(last as UTCTimestamp)
    if (xLast == null) return null
    if (candleTimes.length >= 2) {
      const prev = candleTimes[candleTimes.length - 2]!
      const xPrev = timeScale.timeToCoordinate(prev as UTCTimestamp)
      if (xPrev != null && prev < last) {
        return xLast + (xLast - xPrev) * ((t - last) / (last - prev))
      }
    }
    return xLast
  }

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

/** Precomputed session column in unix time — cheap to re-project on pan/zoom. */
export type SessionHighlightSpan = {
  name: SessionName
  /** First bar open in session */
  startT: number
  /** Right edge = last bar open + bar duration (covers full last candle) */
  endT: number
  /** Exact wick high of bars in this session */
  high: number
  /** Exact wick low of bars in this session */
  low: number
}

const DESK_BAR_SECONDS = 300

/**
 * Expensive once: paint contiguous session columns from every bar’s clock.
 * Uses America/New_York Asia/London/NY windows for DOW, NASDAQ, and NIKKEI
 * (JP225 trades during NYC hours — same color language as the NY desk).
 * Walks bars (not calendar windows) so post-cash / overnight / tip never go uncolored.
 * Call again only when candle tip / as-of clock changes — not on every pan frame.
 */
export function computeSessionHighlightSpans(args: {
  candles: SessionBar[]
  asOfUnix?: number
  /** Kept for API compat — coloring always uses NY desk ET windows */
  instrument?: string | null
  barSeconds?: number
}): { spans: SessionHighlightSpan[]; candleTimes: number[] } {
  const { candles } = args
  if (candles.length === 0) return { spans: [], candleTimes: [] }

  const barSec = args.barSeconds && args.barSeconds > 0 ? args.barSeconds : DESK_BAR_SECONDS
  const now =
    args.asOfUnix != null && Number.isFinite(args.asOfUnix)
      ? args.asOfUnix
      : Math.floor(Date.now() / 1000)

  const bars = candles
    .filter((c) => c.time <= now && Number.isFinite(c.high) && Number.isFinite(c.low) && c.high >= c.low)
    .sort((a, b) => a.time - b.time)
  if (bars.length === 0) return { spans: [], candleTimes: [] }

  const candleTimes = bars.map((c) => c.time)
  // Real Asia / London / NY (ET) for every instrument — including NIKKEI JP225
  // during NYC hours. Tokyo clock still drives trading gates + AVWAP anchor.
  const sessionAt = nyDeskSessionAt

  const spans: SessionHighlightSpan[] = []
  let runName: SessionName | null = null
  let runStart = 0
  let runEnd = 0
  let runHigh = -Infinity
  let runLow = Infinity

  const flush = () => {
    if (runName == null || !(runHigh >= runLow) || runEnd <= runStart) return
    spans.push({
      name: runName,
      startT: runStart,
      endT: runEnd,
      high: runHigh,
      low: runLow,
    })
  }

  for (const c of bars) {
    const name = sessionAt(c.time)
    const barEnd = Math.min(c.time + barSec, now + barSec)
    if (runName === null) {
      runName = name
      runStart = c.time
      runEnd = barEnd
      runHigh = c.high
      runLow = c.low
      continue
    }
    // Only split on session change — keep one column through feed holes so
    // timeToX stretches color across the gap (no black strips between bars).
    if (name !== runName) {
      flush()
      runName = name
      runStart = c.time
      runEnd = barEnd
      runHigh = c.high
      runLow = c.low
      continue
    }
    runEnd = Math.max(runEnd, barEnd)
    if (c.high > runHigh) runHigh = c.high
    if (c.low < runLow) runLow = c.low
  }
  flush()

  // Seal abutting sessions so pixel columns never leave a 1px gutters
  for (let i = 0; i < spans.length - 1; i++) {
    const cur = spans[i]!
    const next = spans[i + 1]!
    if (next.startT > cur.endT) cur.endT = next.startT
  }

  return { spans, candleTimes }
}

/**
 * Map cached spans → pixel rects.
 * Default: horizontal = full session hours (bar run), vertical = session high→low only
 * (never wallpaper above/below where price never traded).
 */
export function projectSessionHighlightRects(args: {
  spans: SessionHighlightSpan[]
  candleTimes: number[]
  timeScale: {
    timeToCoordinate: (t: UTCTimestamp) => number | null
    height: () => number
  }
  priceToY: (price: number) => number | null
  priceScaleWidth: number
  containerWidth: number
  containerHeight: number
  /**
   * false (default): box = session high→low × session hours.
   * true: full-pane wallpaper (legacy — avoid).
   */
  fullHeight?: boolean
  /** @deprecated Ignored */
  visiblePriceRange?: { from: number; to: number } | null
}): { rects: SessionHighlightRect[]; paneHeight: number } {
  const { spans, candleTimes, timeScale, priceToY } = args
  const chartH = Math.max(args.containerHeight, 0)
  const paneW = Math.max(args.containerWidth - args.priceScaleWidth, 0)
  const useFullHeight = args.fullHeight === true
  if (spans.length === 0 || candleTimes.length === 0 || chartH < 2) {
    return { rects: [], paneHeight: chartH }
  }

  const rects: SessionHighlightRect[] = []

  for (const span of spans) {
    if (!(span.high >= span.low) || !Number.isFinite(span.high) || !Number.isFinite(span.low)) {
      continue
    }

    const x1 = timeToX(timeScale, span.startT, candleTimes)
    const x2 = timeToX(timeScale, span.endT, candleTimes)
    if (x1 == null || x2 == null || !Number.isFinite(x1) || !Number.isFinite(x2)) continue

    const left = Math.max(Math.min(x1, x2), 0)
    const right = Math.min(Math.max(x1, x2), paneW)
    const width = right - left
    if (width < 2) continue

    let top = 0
    let height = chartH

    if (!useFullHeight) {
      const yHigh = priceToY(span.high)
      const yLow = priceToY(span.low)
      if (
        yHigh == null ||
        yLow == null ||
        !Number.isFinite(yHigh) ||
        !Number.isFinite(yLow)
      ) {
        continue
      }

      const rawTop = Math.min(yHigh, yLow)
      const rawBottom = Math.max(yHigh, yLow)
      // Fully off-screen (zoomed away) — skip, do not stretch into wallpaper
      if (rawBottom < 0 || rawTop > chartH) continue

      top = Math.max(rawTop, 0)
      const bottom = Math.min(rawBottom, chartH)
      height = bottom - top
      // Flat session — keep a thin stripe at that price, never full pane
      if (height < 3) {
        const mid = (top + bottom) / 2
        top = Math.max(mid - 1.5, 0)
        height = Math.min(3, chartH - top)
      }
    }

    if (height < 2) continue

    rects.push({
      name: span.name,
      left,
      width,
      top,
      height,
      color: SESSION_STYLES[span.name].color,
      zIndex: SESSION_STYLES[span.name].zIndex,
    })
  }

  rects.sort((a, b) => a.zIndex - b.zIndex)
  return { rects, paneHeight: chartH }
}

/**
 * Session color boxes: horizontal = hours price traded in that session,
 * vertical = exact session high→low.
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
  /** Kept for API compat — coloring always uses NY desk ET windows */
  instrument?: string | null
  /** true = full-pane wallpaper; default false = high→low only */
  fullHeight?: boolean
  visiblePriceRange?: { from: number; to: number } | null
}): { rects: SessionHighlightRect[]; paneHeight: number } {
  const { spans, candleTimes } = computeSessionHighlightSpans({
    candles: args.candles,
    asOfUnix: args.asOfUnix,
    instrument: args.instrument,
  })
  return projectSessionHighlightRects({
    spans,
    candleTimes,
    timeScale: args.timeScale,
    priceToY: args.priceToY,
    priceScaleWidth: args.priceScaleWidth,
    containerWidth: args.containerWidth,
    containerHeight: args.containerHeight,
    fullHeight: args.fullHeight,
    visiblePriceRange: args.visiblePriceRange,
  })
}

/** Paint session bands without React — keeps chart pan/zoom at 60fps. */
export function paintSessionHighlightOverlay(
  host: HTMLElement | null,
  rects: SessionHighlightRect[]
): void {
  if (!host) return
  while (host.childElementCount < rects.length) {
    const d = document.createElement('div')
    d.className = 'pointer-events-none absolute'
    d.style.position = 'absolute'
    d.style.margin = '0'
    d.style.padding = '0'
    d.style.boxSizing = 'border-box'
    host.appendChild(d)
  }
  while (host.childElementCount > rects.length) {
    host.removeChild(host.lastElementChild!)
  }
  for (let i = 0; i < rects.length; i++) {
    const s = rects[i]!
    const d = host.children[i] as HTMLElement
    d.style.position = 'absolute'
    d.style.left = `${s.left}px`
    d.style.width = `${Math.max(0, s.width)}px`
    // Price-bounded: exact high→low pixels (not full pane)
    d.style.top = `${s.top}px`
    d.style.height = `${Math.max(0, s.height)}px`
    d.style.bottom = 'auto'
    d.style.right = 'auto'
    d.style.backgroundColor = s.color
    d.style.zIndex = String(s.zIndex)
    d.title = `${s.name} session (high→low)`
  }
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
  overnightStartHour: 16, // cash close → Asia continuum (matches SESSION_WINDOWS)
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
