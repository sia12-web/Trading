/**
 * Session high/low ranges for NY desk charts.
 * Drawn as time-bounded overlays (not full-width price lines) so they never
 * mix with BUY/SHORT level lines.
 */

import type { UTCTimestamp } from 'lightweight-charts'

/**
 * Session fills on the light chart pane.
 * `color` = default high→low box (previous look, slightly richer).
 * `colorFull` + `column` = Sessions button: wallpaper + saturated range box.
 */
export const SESSION_STYLES = {
  Asia: {
    color: 'rgba(41, 98, 255, 0.12)',
    colorFull: 'rgba(41, 98, 255, 0.18)',
    column: 'rgba(41, 98, 255, 0.07)',
    zIndex: 1,
    line: '#2962FF',
    short: 'Tokyo',
  },
  London: {
    color: 'rgba(255, 152, 0, 0.12)',
    colorFull: 'rgba(255, 152, 0, 0.18)',
    column: 'rgba(255, 152, 0, 0.07)',
    zIndex: 2,
    line: '#FF9800',
    short: 'London',
  },
  'New York': {
    color: 'rgba(8, 153, 129, 0.12)',
    colorFull: 'rgba(8, 153, 129, 0.18)',
    column: 'rgba(8, 153, 129, 0.07)',
    zIndex: 3,
    line: '#089981',
    short: 'New York',
  },
} as const

export type SessionName = keyof typeof SESSION_STYLES

/**
 * Desk session windows in America/New_York.
 * London (03:00 → 11:30) and New York (09:30 → 16:00) overlap between 09:30 and 11:30.
 * New York ends at cash close (16:00). Asia starts at 18:00 ET.
 * 16:00–18:00 is intentionally uncolored (not Asia) so post-RTH bars
 * are not mistaken for the Asian session.
 */
export const SESSION_WINDOWS = {
  Asia: { tz: 'America/New_York', start: 18, end: 3 }, // 18:00 → 03:00 (crosses midnight)
  London: { tz: 'America/New_York', start: 3, end: 11.5 }, // 03:00 → 11:30 (LSE cash close)
  'New York': { tz: 'America/New_York', start: 9.5, end: 16 }, // 09:30 → 16:00
} as const

/**
 * Classify a bar into Asia / London / NY, or null when between sessions
 * (post–cash-close dead zone — no paint).
 * All supported instruments (DOW, NASDAQ, GOLD, CRUDE) use America/New_York.
 */
export function nyDeskSessionAt(unix: number): SessionName | null {
  const h = hourInTz(unix, 'America/New_York')
  // Post–NY cash close before Asia: uncolored dead zone (16:00–18:00)
  if (h >= SESSION_WINDOWS['New York'].end && h < SESSION_WINDOWS.Asia.start) {
    return null
  }
  if (h >= SESSION_WINDOWS.Asia.start || h < SESSION_WINDOWS.Asia.end) return 'Asia'
  if (h < SESSION_WINDOWS['New York'].start) return 'London'
  return 'New York'
}

/**
 * All active desk sessions at unix time.
 * Supports concurrent active sessions (e.g. London + NY overlap from 09:30 to 11:30).
 */
export function activeDeskSessionsAt(unix: number): SessionName[] {
  const h = hourInTz(unix, 'America/New_York')
  // Post–NY cash close dead zone (16:00–18:00)
  if (h >= SESSION_WINDOWS['New York'].end && h < SESSION_WINDOWS.Asia.start) {
    return []
  }
  const active: SessionName[] = []
  if (h >= SESSION_WINDOWS.Asia.start || h < SESSION_WINDOWS.Asia.end) {
    active.push('Asia')
  }
  if (h >= SESSION_WINDOWS.London.start && h < SESSION_WINDOWS.London.end) {
    active.push('London')
  }
  if (h >= SESSION_WINDOWS['New York'].start && h < SESSION_WINDOWS['New York'].end) {
    active.push('New York')
  }
  return active
}

/** @deprecated Kept for test-file compat — all live instruments use nyDeskSessionAt. */
export const tokyoDeskSessionAt = nyDeskSessionAt

/** Per-instrument session paint clock — always NY desk. */
export function deskSessionAt(
  unix: number,
  _instrument?: string | null
): SessionName | null {
  return nyDeskSessionAt(unix)
}

/**
 * Return session name and unique instance key (e.g. 2026-09-07_New York).
 * Ensures sessions on different days or across gaps never merge or duplicate.
 */
export function sessionInstanceKeyAt(
  unix: number,
  _instrument?: string | null
): { name: SessionName; key: string } | null {
  const sess = nyDeskSessionAt(unix)
  if (!sess) return null
  return {
    name: sess,
    key: sessionInstanceKeyFor(unix, sess),
  }
}

/** Unique key for any specific session instance on a date. */
export function sessionInstanceKeyFor(
  unix: number,
  name: SessionName
): string {
  const ymd = dayFormatter('America/New_York').format(new Date(unix * 1000))
  const h = hourInTz(unix, 'America/New_York')
  let sessionDate = ymd
  // Asia session starts at 18:00 on day D and ends at 03:00 on day D+1.
  // 00:00–03:00 belongs to the Asia session that started the previous evening.
  if (name === 'Asia' && h < 3) {
    sessionDate = dayFormatter('America/New_York').format(new Date((unix - 86400) * 1000))
  }
  return `${sessionDate}_${name}`
}

/**
 * Current active session and its scheduled start unix timestamp.
 * E.g., at 22:00 ET, returns { name: 'Asia', startUnix: <18:00 ET unix> }.
 */
export function currentActiveSessionInfo(now: Date = new Date()): {
  name: SessionName
  startUnix: number
  scheduledEndUnix: number
} | null {
  const nowUnix = Math.floor(now.getTime() / 1000)
  const active = activeDeskSessionsAt(nowUnix)
  if (active.length === 0) return null

  const name: SessionName = active.includes('Asia')
    ? 'Asia'
    : active.includes('London')
    ? 'London'
    : active[0]!

  const w = SESSION_WINDOWS[name]
  const h = hourInTz(nowUnix, w.tz)
  const ymd = dayFormatter(w.tz).format(now)

  let startYmd = ymd
  if (name === 'Asia' && h < 3) {
    startYmd = dayFormatter(w.tz).format(new Date((nowUnix - 86400) * 1000))
  }
  const startUnix = zonedCivilToUnix(startYmd, w.start, w.tz)
  const endYmd =
    name === 'Asia' && h >= 18
      ? dayFormatter(w.tz).format(new Date((nowUnix + 86400) * 1000))
      : ymd
  const scheduledEndUnix = zonedCivilToUnix(endYmd, w.end, w.tz)

  return { name, startUnix, scheduledEndUnix }
}

export const SESSION_RANGE_ORDER: SessionName[] = ['Asia', 'London', 'New York']

/** Display name for a session — displays Asia as 'Tokyo' matching TradingView. */
export function sessionLegendLabel(name: SessionName | string, _instrument?: string | null): string {
  if (name === 'Asia') return 'Tokyo'
  return name
}

/** Legend swatch order — Asia / London / New York. */
export function sessionLegendOrder(_instrument?: string | null): SessionName[] {
  return SESSION_RANGE_ORDER
}

export interface SessionHighlightRect {
  name: SessionName
  displayName?: string
  color: string
  lineColor?: string
  left: number
  width: number
  /** Y of session high (price-bounded) or 0 for a full-height time column */
  top: number
  /** Height from session high → low, or pane height for a time column */
  height: number
  zIndex: number
  range?: number
  avg?: number
  yAvg?: number | null
  isColumn?: boolean
  /** True for the last (currently active/in-progress) session — rendered with bolder borders. */
  isCurrent?: boolean
  borderColor?: string
  borderLeftWidth?: number
  borderTopWidth?: number
  borderBottomWidth?: number
}

/** TradingView Anchored VWAP Style tab: blue VWAP, green/olive/teal σ bands. */
export const VWAP_COLORS = {
  vwap: '#2962FF',
  band1: '#4CAF50',
  band2: '#827717',
  band3: '#00695C',
  fill1: 'rgba(76, 175, 80, 0.12)',
  /** @deprecated use band1–band3 */
  band: '#4CAF50',
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
  const hasAsOf = asOfUnix != null && Number.isFinite(asOfUnix)
  const now = hasAsOf ? (asOfUnix as number) : Infinity

  const bars = candles.filter((c) => (hasAsOf ? c.time <= now : true))
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

      // Only draw range after the session has fully finished (if asOf provided)
      if (hasAsOf && now < scheduledEnd) continue
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
  displayName?: string
  /** First bar open in session */
  startT: number
  /** Right edge = last bar open + bar duration (covers full last candle) */
  endT: number
  /** Exact wick high of bars in this session */
  high: number
  /** Exact wick low of bars in this session */
  low: number
  range?: number
  avg?: number
  /** True for the last (currently active/in-progress) span — gets a bolder visual. */
  isCurrent?: boolean
}

const DESK_BAR_SECONDS = 300

/**
 * Expensive once: paint contiguous session columns from every bar’s clock.
 * DOW / NASDAQ use America/New_York Asia/London/NY windows.
 * NIKKEI uses Asia/Tokyo for cash open, but New York paint follows US RTH
 * (09:30–16:00 ET) only — post–US-close until Tokyo open stays uncolored.
 * Bars in dead zones (null session) get NO color.
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
  const hasAsOf = args.asOfUnix != null && Number.isFinite(args.asOfUnix)
  const asOf = hasAsOf ? (args.asOfUnix as number) : Infinity

  const bars = candles
    .filter((c) => (hasAsOf ? c.time <= asOf : true) && Number.isFinite(c.high) && Number.isFinite(c.low) && c.high >= c.low)
    .sort((a, b) => a.time - b.time)
  if (bars.length === 0) return { spans: [], candleTimes: [] }

  const candleTimes = bars.map((c) => c.time)
  const spanMap = new Map<string, SessionHighlightSpan>()

  for (const c of bars) {
    const activeSessions = activeDeskSessionsAt(c.time)
    const barEnd = c.time + barSec

    for (const name of activeSessions) {
      const key = sessionInstanceKeyFor(c.time, name)
      const existing = spanMap.get(key)
      if (!existing) {
        spanMap.set(key, {
          name,
          displayName: sessionLegendLabel(name, args.instrument),
          startT: c.time,
          endT: barEnd,
          high: c.high,
          low: c.low,
        })
      } else {
        existing.endT = Math.max(existing.endT, barEnd)
        if (c.high > existing.high) existing.high = c.high
        if (c.low < existing.low) existing.low = c.low
      }
    }
  }

  const spans: SessionHighlightSpan[] = []
  for (const span of spanMap.values()) {
    if (span.high >= span.low && span.endT > span.startT) {
      span.range = Number((span.high - span.low).toFixed(2))
      span.avg = Number(((span.high + span.low) / 2).toFixed(2))
      spans.push(span)
    }
  }

  // Sort by startT ascending, then by zIndex
  spans.sort((a, b) => {
    if (a.startT !== b.startT) return a.startT - b.startT
    return (SESSION_STYLES[a.name]?.zIndex ?? 0) - (SESSION_STYLES[b.name]?.zIndex ?? 0)
  })

  // Mark currently active span(s) (including overlaps like London + NY) so they render bolder
  const lastBarTime = bars[bars.length - 1]!.time
  let matchedActive = false
  for (const span of spans) {
    if (lastBarTime >= span.startT && lastBarTime < span.endT) {
      span.isCurrent = true
      matchedActive = true
    }
  }
  if (!matchedActive && spans.length > 0) {
    spans[spans.length - 1]!.isCurrent = true
  }

  return { spans, candleTimes }
}

/**
 * Map cached spans → pixel rects.
 * `range` (default): previous high→low boxes only.
 * `full`: screenshot mode — full-height time columns + saturated range boxes.
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
  /** @deprecated Use sessionPaint. true → 'full' */
  fullHeight?: boolean
  /** range = default boxes; full = columns + rich boxes; columns = pure time columns only */
  sessionPaint?: 'range' | 'full' | 'columns'
  /** @deprecated Ignored */
  visiblePriceRange?: { from: number; to: number } | null
} ): { rects: SessionHighlightRect[]; paneHeight: number } {
  const { spans, candleTimes, timeScale, priceToY } = args
  const chartH = Math.max(args.containerHeight, 0)
  const paneW = Math.max(args.containerWidth - args.priceScaleWidth, 0)
  const paint: 'range' | 'full' | 'columns' =
    args.sessionPaint ?? (args.fullHeight === true ? 'full' : 'range')
  const showColumns = paint === 'full' || paint === 'columns'
  const showRanges = paint !== 'columns'
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
    if ((x1 == null || !Number.isFinite(x1)) && x2 != null && Number.isFinite(x2)) x1 = x2 - 2
    if ((x2 == null || !Number.isFinite(x2)) && x1 != null && Number.isFinite(x1)) x2 = x1 + 2
    if (x1 == null || x2 == null || !Number.isFinite(x1) || !Number.isFinite(x2)) continue

    const left = Math.max(Math.min(x1, x2), 0)
    const right = Math.min(Math.max(x1, x2), paneW)
    const width = right - left
    if (width < 1) continue

    const style = SESSION_STYLES[span.name]
    const labelName = span.displayName ?? span.name
    if (showColumns) {
      rects.push({
        name: span.name,
        displayName: labelName,
        left,
        width,
        top: 0,
        height: chartH,
        color: style.column,
        lineColor: style.line,
        zIndex: style.zIndex,
        isColumn: true,
      })
    }

    if (!showRanges) continue

    const yHigh = priceToY(span.high)
    const yLow = priceToY(span.low)
    const spanAvg = span.avg ?? (span.high + span.low) / 2
    const yAvg = priceToY(spanAvg)
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
    if (rawBottom < 0 || rawTop > chartH) continue

    let top = Math.max(rawTop, 0)
    const bottom = Math.min(rawBottom, chartH)
    let height = bottom - top
    if (height < 3) {
      const mid = (top + bottom) / 2
      top = Math.max(mid - 1.5, 0)
      height = Math.min(3, chartH - top)
    }
    if (height < 2) continue

    rects.push({
      name: span.name,
      displayName: labelName,
      left,
      width,
      top,
      height,
      color: span.isCurrent ? style.colorFull : style.color,
      lineColor: style.line,
      zIndex: style.zIndex + 10,
      range: span.range ?? Number((span.high - span.low).toFixed(2)),
      avg: Number(spanAvg.toFixed(2)),
      yAvg: yAvg != null && Number.isFinite(yAvg) ? yAvg : top + height / 2,
      isColumn: false,
      isCurrent: span.isCurrent === true,
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
  sessionPaint?: 'range' | 'full'
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
    sessionPaint: args.sessionPaint,
    fullHeight: args.fullHeight,
    visiblePriceRange: args.visiblePriceRange,
  })
}

/** Paint session bands without React — keeps chart pan/zoom at 60fps. */
export function paintSessionHighlightOverlay(
  host: HTMLElement | null,
  rects: SessionHighlightRect[],
  opts?: { keepPreviousIfEmpty?: boolean; paintKey?: string; hideLabels?: boolean }
): void {
  if (!host) return
  if (opts?.paintKey && host.dataset.paintKey !== opts.paintKey) {
    host.dataset.paintKey = opts.paintKey
  } else if (rects.length === 0 && opts?.keepPreviousIfEmpty && host.childElementCount > 0) {
    return
  }
  if (opts?.paintKey) host.dataset.paintKey = opts.paintKey
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
    d.style.top = `${s.top}px`
    d.style.height = `${Math.max(0, s.height)}px`
    d.style.bottom = 'auto'
    d.style.right = 'auto'
    d.style.backgroundColor = s.color
    d.style.zIndex = String(s.zIndex)
    d.title = `${s.displayName ?? s.name} session`

    if (s.isColumn || opts?.hideLabels) {
      d.style.borderLeft = 'none'
      d.style.borderRight = 'none'
      d.style.borderTop = 'none'
      d.style.borderBottom = 'none'
      d.innerHTML = ''
      continue
    }

    const lineColor = s.lineColor ?? s.borderColor ?? '#2962FF'

    d.style.borderLeft = 'none'
    d.style.borderRight = 'none'
    d.style.borderTop = 'none'
    d.style.borderBottom = 'none'

    // If the session box has scrolled mostly off-screen to the left (small visible width), don't stack labels on the margin
    if (s.width < 45 || s.left + s.width < 40) {
      d.innerHTML = ''
      continue
    }

    // Clean label metadata (Range / Avg / Session) without dashed lines covering the high/low
    const rangeStr =
      s.range != null
        ? Number.isInteger(s.range)
          ? s.range.toString()
          : s.range.toFixed(2)
        : ''
    const avgStr =
      s.avg != null
        ? Number.isInteger(s.avg)
          ? s.avg.toString()
          : s.avg.toFixed(2)
        : ''
    const sessName = s.displayName ?? (s.name === 'Asia' ? 'Tokyo' : s.name)

    const labelTop = s.height + 6
    d.innerHTML = `
      <div style="position:absolute;left:8px;top:${labelTop}px;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:11px;font-weight:500;line-height:1.35;color:${lineColor};pointer-events:none;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,0.4);">
        ${rangeStr ? `<div>Range: ${rangeStr}</div>` : ''}
        ${avgStr ? `<div>Avg: ${avgStr}</div>` : ''}
        <div style="font-weight:600;">${sessName}</div>
      </div>
    `
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
  cashOpenHour: 9.0,
  overnightStartHour: 15,
  openLabel: 'Tokyo 9:00',
}

/** Returns the desk clock for instruments (DOW, NASDAQ, GOLD, CRUDE use NY, NIKKEI uses Tokyo). */
export function deskClockFor(instrument?: string | null): DeskClock {
  if (instrument === 'NIKKEI') {
    return {
      timeZone: 'Asia/Tokyo',
      cashOpenHour: 9.0,
      overnightStartHour: 15,
      openLabel: 'Tokyo 9:00',
    }
  }
  return NY_DESK_CLOCK
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

/**
 * Computes Good Friday date for a given year using Meeus/Jones/Butcher Easter algorithm.
 */
function getGoodFridayYmd(y: number): string {
  const a = y % 19
  const b = Math.floor(y / 100)
  const c = y % 100
  const dVal = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - dVal - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const mVal = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * mVal + 114) / 31)
  const day = ((h + l - 7 * mVal + 114) % 31) + 1

  const easterUtc = Date.UTC(y, month - 1, day, 12, 0, 0)
  const gfDate = new Date(easterUtc - 2 * 86400 * 1000)
  const mStr = String(gfDate.getUTCMonth() + 1).padStart(2, '0')
  const dStr = String(gfDate.getUTCDate()).padStart(2, '0')
  return `${y}-${mStr}-${dStr}`
}

/**
 * Detect official US Stock & Futures Market Holidays (America/New_York).
 * Skips low-participation/zero-RTH volume holiday sessions (Labor Day, Memorial Day, MLK, Thanksgiving, Christmas, etc.)
 * so short-term reference points anchor to the prior full active trading day.
 */
export function isUsMarketHoliday(ymd: string): boolean {
  const [yStr, mStr, dStr] = ymd.split('-')
  const y = parseInt(yStr ?? '0', 10)
  const m = parseInt(mStr ?? '0', 10)
  const d = parseInt(dStr ?? '0', 10)
  if (!y || !m || !d) return false

  // Day of week in UTC noon (0 = Sun, 1 = Mon, ..., 4 = Thu, 5 = Fri, 6 = Sat)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const dow = dt.getUTCDay()

  // 1. New Year's Day (Jan 1)
  if (m === 1 && d === 1) return true
  if (m === 12 && d === 31 && dow === 5) return true // Observed Friday Dec 31 if Jan 1 is Sat
  if (m === 1 && d === 2 && dow === 1) return true // Observed Monday Jan 2 if Jan 1 is Sun

  // 2. Martin Luther King Jr. Day (3rd Monday in Jan)
  if (m === 1 && dow === 1 && d >= 15 && d <= 21) return true

  // 3. Washington's Birthday / Presidents' Day (3rd Monday in Feb)
  if (m === 2 && dow === 1 && d >= 15 && d <= 21) return true

  // 4. Good Friday
  if (ymd === getGoodFridayYmd(y)) return true

  // 5. Memorial Day (Last Monday in May)
  if (m === 5 && dow === 1 && d >= 25) return true

  // 6. Juneteenth (June 19)
  if (m === 6 && d === 19) return true
  if (m === 6 && d === 18 && dow === 5) return true
  if (m === 6 && d === 20 && dow === 1) return true

  // 7. Independence Day (July 4)
  if (m === 7 && d === 4) return true
  if (m === 7 && d === 3 && dow === 5) return true
  if (m === 7 && d === 5 && dow === 1) return true

  // 8. Labor Day (1st Monday in Sept)
  if (m === 9 && dow === 1 && d <= 7) return true

  // 9. Thanksgiving Day (4th Thursday in Nov)
  if (m === 11 && dow === 4 && d >= 22 && d <= 28) return true

  // 10. Christmas Day (Dec 25)
  if (m === 12 && d === 25) return true
  if (m === 12 && d === 24 && dow === 5) return true
  if (m === 12 && d === 26 && dow === 1) return true

  return false
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
    // n trading days total → idx - (n - 1)
    startDay = sorted[Math.max(0, idx - Math.max(1, n - 1))]!
  } else {
    startDay = nthTradingDayBefore(sessionDay, Math.max(0, n - 1), clock.timeZone)
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
