/**
 * Live 5m forming-bar rules for Trade Pulse.
 *
 * Tick delay must not invent a new open (that flips green/red). Short SSE
 * dropouts must not leave a hole on the time axis. Overnight / long gaps are
 * left for REST history — do not fabricate hours of flat bars.
 */

export type FormingBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export const DESK_LIVE_BAR_SEC = 300
/** Fill at most ~15 minutes of missing slots from last close (scales with bar size). */
export const LIVE_MAX_GAP_FILL_SEC = 15 * 60
/** @deprecated Prefer LIVE_MAX_GAP_FILL_SEC — kept for 5m (= 3 slots). */
export const LIVE_MAX_GAP_FILLS = 3

export function maxLiveGapFills(barSec: number = DESK_LIVE_BAR_SEC): number {
  if (!(barSec > 0)) return LIVE_MAX_GAP_FILLS
  return Math.max(LIVE_MAX_GAP_FILLS, Math.ceil(LIVE_MAX_GAP_FILL_SEC / barSec))
}
/** If the packet stamp is older than this, bucket from wall clock. */
export const LIVE_STALE_QUOTE_SEC = 120
/** Reject a live tip that would paint a fake dump/spike vs the CME history close. */
export const LIVE_MAX_TIP_JUMP_PCT = 0.015
/** Drop history bars whose body is larger than a real 5m on that market. */
export const DESK_MAX_5M_RANGE: Record<string, number> = {
  DOW: 400,
  NASDAQ: 200,
  NIKKEI: 400,
  GOLD: 80,
  CRUDE: 4,
}
/** Weekend / daily Globex halt — do not treat the reopen print as a glitch bar. */
export const DESK_SESSION_GAP_SEC = 3 * 3600

export function deskBarOpenUnix(
  unix: number,
  barSec: number = DESK_LIVE_BAR_SEC
): number {
  if (!(unix > 0) || !(barSec > 0)) return 0
  return Math.floor(unix / barSec) * barSec
}

export function quoteUnixForBucket(
  quoteUnix: number,
  wallUnix: number = Math.floor(Date.now() / 1000)
): number {
  if (!(quoteUnix > 0)) return wallUnix
  if (wallUnix - quoteUnix > LIVE_STALE_QUOTE_SEC) return wallUnix
  if (quoteUnix - wallUnix > 5) return wallUnix
  return quoteUnix
}

export function applyTickToFormingBar(
  last: FormingBar,
  price: number,
  quoteUnix: number,
  barSec: number = DESK_LIVE_BAR_SEC
): { last: FormingBar; rolled: boolean; gapFills: FormingBar[] } {
  const lastT = last.time
  const bucket = deskBarOpenUnix(quoteUnix, barSec)
  if (!(price > 0) || !(bucket > 0)) {
    return { last, rolled: false, gapFills: [] }
  }

  if (bucket <= lastT) {
    return {
      last: {
        ...last,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
      },
      rolled: false,
      gapFills: [],
    }
  }

  const skipped = Math.round((bucket - lastT) / barSec) - 1
  if (skipped > maxLiveGapFills(barSec)) {
    const bar: FormingBar = {
      time: bucket,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
    }
    return { last: bar, rolled: true, gapFills: [] }
  }

  const gapFills: FormingBar[] = []
  let prevClose = last.close
  for (let t = lastT + barSec; t < bucket; t += barSec) {
    gapFills.push({
      time: t,
      open: prevClose,
      high: prevClose,
      low: prevClose,
      close: prevClose,
      volume: 0,
    })
  }

  const open = prevClose
  const bar: FormingBar = {
    time: bucket,
    open,
    high: Math.max(open, price),
    low: Math.min(open, price),
    close: price,
    volume: 0,
  }
  return { last: bar, rolled: true, gapFills }
}

export function isPlausibleDeskTick(
  lastClose: number,
  price: number,
  maxJumpPct: number = LIVE_MAX_TIP_JUMP_PCT
): boolean {
  if (!(price > 0)) return false
  if (!(lastClose > 0)) return true
  return Math.abs(price - lastClose) / lastClose <= maxJumpPct
}

/** Strip Yahoo/OANDA glitch bars (e.g. a session candle stuffed into 5m gold). */
export function dropImplausibleDeskBars<T extends FormingBar>(
  bars: T[],
  instrument?: string | null,
  timeframe?: string | null
): T[] {
  if (bars.length === 0) return bars
  const baseRange = instrument ? DESK_MAX_5M_RANGE[instrument] : undefined
  const mult = timeframe === '30m' ? 3 : timeframe === '15m' ? 1.8 : 1
  const maxRange = baseRange != null ? baseRange * mult : undefined
  const out: T[] = []
  for (const bar of bars) {
    if (!(bar.close > 0) || !(bar.open > 0)) continue
    const range = bar.high - bar.low
    if (maxRange != null && range > maxRange) continue
    const prev = out[out.length - 1]
    const maxJump = timeframe === '30m' ? 0.08 : 0.04
    const sessionGap =
      prev != null && bar.time - prev.time >= DESK_SESSION_GAP_SEC
    if (prev && !sessionGap && !isPlausibleDeskTick(prev.close, bar.close, maxJump)) continue
    out.push(bar)
  }
  return out.length > 0 ? out : bars
}

/**
 * REST history owns closed bars. The tick tip owns the forming bar's open + close
 * so a delayed Yahoo/OANDA 5m print cannot repaint green vs red.
 */
export function mergeHistoryWithLiveTip<T extends FormingBar>(
  history: T[],
  live: T | null | undefined
): T[] {
  if (!live || history.length === 0) return history
  const liveT = live.time
  const last = history[history.length - 1]!
  const lastT = last.time
  if (liveT > lastT) {
    if (!isPlausibleDeskTick(last.close, live.close)) return history
    return [...history, live]
  }
  if (liveT < lastT) return history
  if (!isPlausibleDeskTick(last.close, live.close)) return history
  const close = live.close
  const next: T = {
    ...last,
    open: live.open,
    high: Math.max(last.high, live.high, close),
    low: Math.min(last.low, live.low, close),
    close,
  }
  const out = history.slice()
  out[out.length - 1] = next
  return out
}

/**
 * True when REST closed bars (everything except the forming tip) changed OHLC
 * vs what the chart is holding — e.g. Yahoo replaced gap-fill flats, or a
 * Databento reprint filled missing 5m slots deeper than the last dozen bars.
 */
export function closedHistoryOhlcChanged<T extends FormingBar>(
  prev: readonly T[],
  next: readonly T[],
  tipOwned: boolean
): boolean {
  if (prev.length !== next.length) return true
  if (prev.length === 0) return false
  const tipSkip = tipOwned && prev.length > 0 && next.length > 0
  const end = tipSkip ? prev.length - 1 : prev.length
  // Compare enough of the tip window that a mid-session gap fill is not ignored.
  const start = Math.max(0, end - 96)
  for (let i = start; i < end; i++) {
    const a = prev[i]!
    const b = next[i]!
    if (a.time !== b.time) return true
    if (
      Math.abs(a.open - b.open) > 0.1 ||
      Math.abs(a.high - b.high) > 0.1 ||
      Math.abs(a.low - b.low) > 0.1 ||
      Math.abs(a.close - b.close) > 0.1
    ) {
      return true
    }
  }
  if (!tipSkip) return false
  const aTip = prev[prev.length - 1]!
  const bTip = next[next.length - 1]!
  return aTip.time !== bTip.time
}
