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
/** Fill at most 3 missing 5m slots (~15m) from last close. */
export const LIVE_MAX_GAP_FILLS = 3
/** If the packet stamp is older than this, bucket from wall clock. */
export const LIVE_STALE_QUOTE_SEC = 120

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
  if (skipped > LIVE_MAX_GAP_FILLS) {
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
  if (liveT > lastT) return [...history, live]
  if (liveT < lastT) return history
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
 * vs what the chart is holding — e.g. Yahoo replaced gap-fill flats.
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
  const start = Math.max(0, end - 12)
  for (let i = start; i < end; i++) {
    const a = prev[i]!
    const b = next[i]!
    if (a.time !== b.time) return true
    if (a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close) {
      return true
    }
  }
  if (!tipSkip) return false
  const aTip = prev[prev.length - 1]!
  const bTip = next[next.length - 1]!
  return aTip.time !== bTip.time
}
