/**
 * Session high/low ranges for NY desk charts.
 * Drawn as time-bounded overlays (not full-width price lines) so they never
 * mix with BUY/SHORT level lines.
 */

import type { UTCTimestamp } from 'lightweight-charts'

/** Soft pastel fills for light chart panes (TradingView-like). */
export const SESSION_STYLES = {
  Asia: {
    color: 'rgba(147, 197, 253, 0.32)',
    zIndex: 1,
    line: '#2563eb',
    short: 'Asia',
  },
  London: {
    color: 'rgba(250, 204, 21, 0.30)',
    zIndex: 2,
    line: '#ca8a04',
    short: 'Lon',
  },
  'New York': {
    color: 'rgba(74, 222, 128, 0.30)',
    zIndex: 3,
    line: '#16a34a',
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

/**
 * Nikkei morning desk — Asia/Tokyo clock so cash open (09:00) is the Asia start,
 * not mid-NYC “Asia” that began at 05:00 JST. Same three legend names.
 */
export const TOKYO_SESSION_WINDOWS = {
  Asia: { tz: 'Asia/Tokyo', start: 9, end: 15 }, // Tokyo cash 09:00 → 15:00
  London: { tz: 'Asia/Tokyo', start: 15, end: 22.5 }, // post-cash → US open
  'New York': { tz: 'Asia/Tokyo', start: 22.5, end: 9 }, // US hours → next Tokyo open
} as const

/** Classify a bar into Asia / London / NY — every clock hour maps to exactly one session. */
export function nyDeskSessionAt(unix: number): SessionName {
  const h = hourInTz(unix, 'America/New_York')
  if (h >= SESSION_WINDOWS.Asia.start || h < SESSION_WINDOWS.Asia.end) return 'Asia'
  if (h < SESSION_WINDOWS.London.end) return 'London'
  return 'New York'
}

/** Nikkei: Tokyo cash open starts Asia — overnight US is New York until 09:00 JST. */
export function tokyoDeskSessionAt(unix: number): SessionName {
  const h = hourInTz(unix, 'Asia/Tokyo')
  if (h >= TOKYO_SESSION_WINDOWS.Asia.start && h < TOKYO_SESSION_WINDOWS.Asia.end) {
    return 'Asia'
  }
  if (h >= TOKYO_SESSION_WINDOWS.London.start && h < TOKYO_SESSION_WINDOWS.London.end) {
    return 'London'
  }
  return 'New York'
}

/** Per-instrument session paint clock. */
export function deskSessionAt(
  unix: number,
  instrument?: string | null
): SessionName {
  return instrument === 'NIKKEI' ? tokyoDeskSessionAt(unix) : nyDeskSessionAt(unix)
}

export const SESSION_RANGE_ORDER: SessionName[] = ['Asia', 'London', 'New York']

/** Shared legend — Asia / London / New York for every desk instrument. */
export function sessionLegendLabel(name: SessionName, instrument?: string | null): string {
  if (instrument === 'NIKKEI' && name === 'Asia') return 'Tokyo'
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

/** Reuse Intl formatters — constructing one per bar freezes the chart (~3k bars). */
const hourFmtCache = new Map<string, Intl.DateTimeFormat>()
const dayFmtCache = new Map<string, Intl.DateTimeFormat>()
const weekdayFmtCache = new Map<string, Intl.DateTimeFormat>()
/** Memo: `${ymd}|${decimalHour}|${tz}` → unix */
const zonedCivilCache = new Map<string, number>()
/** Memo: `${ymd}|${tz}` → weekday */
const weekdayYmdCache = new Map<string, boolean>()

function hourFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = hourFmtCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    hourFmtCache.set(timeZone, fmt)
  }
  return fmt
}

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dayFmtCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dayFmtCache.set(timeZone, fmt)
  }
  return fmt
}

function weekdayFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = weekdayFmtCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
    })
    weekdayFmtCache.set(timeZone, fmt)
  }
  return fmt
}

export function hourInTz(unix: number, timeZone: string): number {
  const parts = hourFormatter(timeZone).formatToParts(new Date(unix * 1000))
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
 * DOW / NASDAQ use America/New_York Asia/London/NY windows.
 * NIKKEI uses Asia/Tokyo so cash open (09:00) starts Asia — not mid-NYC Asia.
 * Walks bars (not calendar windows) so post-cash / overnight / tip never go uncolored.
 * Call again only when candle tip / as-of clock changes — not on every pan frame.
 */
export function computeSessionHighlightSpans(args: {
  candles: SessionBar[]
  asOfUnix?: number
  /** NIKKEI → Tokyo session clock; others → NYC ET */
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
  const sessionAt = (t: number) => deskSessionAt(t, args.instrument)
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

    let x1 = timeToX(timeScale, span.startT, candleTimes)
    let x2 = timeToX(timeScale, span.endT, candleTimes)
    // Mid-pan the scale can briefly return null for one edge — recover from the other.
    if ((x1 == null || !Number.isFinite(x1)) && x2 != null && Number.isFinite(x2)) x1 = x2 - 2
    if ((x2 == null || !Number.isFinite(x2)) && x1 != null && Number.isFinite(x1)) x2 = x1 + 2
    if (x1 == null || x2 == null || !Number.isFinite(x1) || !Number.isFinite(x2)) continue

    const left = Math.max(Math.min(x1, x2), 0)
    const right = Math.min(Math.max(x1, x2), paneW)
    const width = right - left
    if (width < 1) continue

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
        // Mid-pan priceToY is often null — skip this span (keepPreviousIfEmpty
        // retains last good paint) instead of flashing full-pane wallpaper.
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
  rects: SessionHighlightRect[],
  opts?: { keepPreviousIfEmpty?: boolean }
): void {
  if (!host) return
  // Mid-pan projection can briefly return [] — keep last good paint instead of blanking.
  if (rects.length === 0 && opts?.keepPreviousIfEmpty && host.childElementCount > 0) {
    return
  }
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
  cashOpenHour: 9, // Nikkei / TSE cash open — not NY 9:30
  overnightStartHour: 15, // TSE cash close
  openLabel: 'Nikkei 9:00 JST',
}

export function deskClockFor(instrument: string | null | undefined): DeskClock {
  return instrument === 'NIKKEI' ? TOKYO_DESK_CLOCK : NY_DESK_CLOCK
}

/** How many trading days before the tip session AVWAP is anchored (cash open). */
export const AVWAP_LOOKBACK_TRADING_DAYS = 5

/**
 * Calendar days of candle history required so `lastNTradingSessions(…, 5)` can
 * actually reach the 5th prior RTH day. A plain `days=5` fetch from a weekend
 * tip only covers ~4 RTH sessions (Yahoo `5d` / OANDA wall-clock), so the
 * anchor day is missing and AVWAP starts too late.
 */
export const AVWAP_CANDLE_FETCH_CALENDAR_DAYS = AVWAP_LOOKBACK_TRADING_DAYS + 7 // 12

function dayKeyInTz(unix: number, timeZone: string): string {
  return dayFormatter(timeZone).format(new Date(unix * 1000))
}

function addCalendarDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta, 12, 0, 0))
  return dt.toISOString().slice(0, 10)
}

/** Weekday in the desk TZ for a civil YYYY-MM-DD date. */
export function isWeekdayYmd(ymd: string, timeZone: string): boolean {
  const cacheKey = `${ymd}|${timeZone}`
  const hit = weekdayYmdCache.get(cacheKey)
  if (hit != null) return hit
  const noon = zonedCivilToUnix(ymd, 12, timeZone)
  const dow = weekdayFormatter(timeZone).format(new Date(noon * 1000))
  const ok = dow !== 'Sat' && dow !== 'Sun'
  weekdayYmdCache.set(cacheKey, ok)
  return ok
}

/** Cash-open unix for a civil date in the desk clock (TZ-correct for ET and JST). */
export function cashOpenUnixForYmd(ymd: string, clock: DeskClock): number {
  return zonedCivilToUnix(ymd, clock.cashOpenHour, clock.timeZone)
}

/**
 * Convert a civil YYYY-MM-DD + decimal hour in `timeZone` to unix seconds.
 * Binary-searches so Asia/Tokyo (UTC+9) and America/New_York both land on the
 * intended local calendar day (UTC-noon seeding fails east of UTC).
 */
export function zonedCivilToUnix(
  ymd: string,
  decimalHour: number,
  timeZone: string
): number {
  const cacheKey = `${ymd}|${decimalHour}|${timeZone}`
  const cached = zonedCivilCache.get(cacheKey)
  if (cached != null) return cached

  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return 0
  const targetMin = Math.round(decimalHour * 60)
  // Search window: day-before → day-after in UTC (covers all offsets)
  let lo = Math.floor(Date.UTC(y, m - 1, d - 1, 0, 0, 0) / 1000)
  let hi = Math.floor(Date.UTC(y, m - 1, d + 2, 0, 0, 0) / 1000)

  for (let i = 0; i < 48 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2)
    const key = dayKeyInTz(mid, timeZone)
    const mins = Math.round(hourInTz(mid, timeZone) * 60)
    if (key < ymd || (key === ymd && mins < targetMin)) lo = mid
    else hi = mid
  }
  zonedCivilCache.set(cacheKey, hi)
  return hi
}

/**
 * Civil date that is `n` trading days before `ymd` (weekends skipped in desk TZ).
 * n=1 → previous weekday; n=5 → five trading days prior.
 */
export function nthTradingDayBefore(ymd: string, n: number, timeZone: string): string {
  let cur = ymd
  let left = Math.max(0, n)
  while (left > 0) {
    cur = addCalendarDaysYmd(cur, -1)
    if (isWeekdayYmd(cur, timeZone)) left--
  }
  return cur
}

function sessionTradingDayYmd(unix: number, clock: DeskClock): string {
  let day = dayKeyInTz(unix, clock.timeZone)
  // Weekend tip → last weekday (Friday for Sat/Sun)
  let guard = 0
  while (!isWeekdayYmd(day, clock.timeZone) && guard++ < 14) {
    day = addCalendarDaysYmd(day, -1)
  }
  return day
}

/**
 * Bars from cash open of (tip − n trading sessions) through the tip session.
 *
 * NY (DOW/NASDAQ): America/New_York, anchor = 09:30 ET.
 * NIKKEI: Asia/Tokyo, anchor = Nikkei cash open 09:00 JST — never NY 9:30.
 *
 * Prefer days that actually have RTH prints so exchange holidays do not count
 * as a “session.” Falls back to weekday calendar when history is sparse.
 *
 * @param asOfUnix — session tip (live = now; sim = replay cash open). Defaults to last bar.
 */
export function lastNTradingSessions(
  candles: SessionBar[],
  n: number = AVWAP_LOOKBACK_TRADING_DAYS,
  clock: DeskClock = NY_DESK_CLOCK,
  asOfUnix?: number
): SessionBar[] {
  if (candles.length === 0) return candles

  const tipUnix =
    asOfUnix != null && Number.isFinite(asOfUnix)
      ? asOfUnix
      : candles[candles.length - 1]!.time

  const sessionDay = sessionTradingDayYmd(tipUnix, clock)

  // Days with at least one bar inside cash open → cash close (desk RTH)
  const rthDays = new Set<string>()
  const dayBounds = new Map<string, { openU: number; closeU: number } | null>()
  for (const c of candles) {
    const day = dayKeyInTz(c.time, clock.timeZone)
    let bounds = dayBounds.get(day)
    if (bounds === undefined) {
      if (!isWeekdayYmd(day, clock.timeZone)) {
        dayBounds.set(day, null)
        continue
      }
      bounds = {
        openU: cashOpenUnixForYmd(day, clock),
        closeU: zonedCivilToUnix(day, clock.overnightStartHour, clock.timeZone),
      }
      dayBounds.set(day, bounds)
    }
    if (!bounds) continue
    if (c.time >= bounds.openU && c.time < bounds.closeU) rthDays.add(day)
  }

  let startDay: string
  if (rthDays.size > 0) {
    const sorted = Array.from(rthDays)
    if (!rthDays.has(sessionDay)) sorted.push(sessionDay)
    sorted.sort()
    const tipIdx = sorted.lastIndexOf(sessionDay)
    const idx = tipIdx >= 0 ? tipIdx : sorted.length - 1
    // n trading days prior to tip → sorted[idx - n]
    startDay = sorted[Math.max(0, idx - n)]!
  } else {
    startDay = nthTradingDayBefore(sessionDay, n, clock.timeZone)
  }

  const cutoff = cashOpenUnixForYmd(startDay, clock)
  return candles.filter((c) => c.time >= cutoff)
}

/**
 * Anchored VWAP from cash open of the first RTH trading day in the series.
 * Overnight / post-close bars (hour ≥ cash close) must not become the anchor —
 * previously `hour >= 9:30` matched 16:00 and started AVWAP a day early.
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

  // First bar inside cash session (open → close) defines the anchor day.
  let anchorUnix: number | null = null
  const dayBounds = new Map<string, { openU: number; closeU: number } | null>()
  for (const c of candles) {
    const day = dayKeyInTz(c.time, clock.timeZone)
    let bounds = dayBounds.get(day)
    if (bounds === undefined) {
      if (!isWeekdayYmd(day, clock.timeZone)) {
        dayBounds.set(day, null)
        continue
      }
      bounds = {
        openU: cashOpenUnixForYmd(day, clock),
        closeU: zonedCivilToUnix(day, clock.overnightStartHour, clock.timeZone),
      }
      dayBounds.set(day, bounds)
    }
    if (!bounds) continue
    if (c.time >= bounds.openU && c.time < bounds.closeU) {
      anchorUnix = bounds.openU
      break
    }
  }

  if (anchorUnix == null) return null

  const startIdx = candles.findIndex((c) => c.time >= anchorUnix!)
  if (startIdx < 0) return null

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
