import { fillCandleGaps } from '@/lib/chart/candleGapFiller'

export type FormingBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export const DESK_LIVE_BAR_SEC = 300
/** Fill up to 30 missing slots (~30m on 1m, 2.5h on 5m) from last close to ensure unbroken continuum. */
export const LIVE_MAX_GAP_FILLS = 30
/** If the packet stamp is older than this, bucket from wall clock. */
export const LIVE_STALE_QUOTE_SEC = 120
/** Reject a live tip only if it represents an impossible scale glitch (e.g. unshifted CFD vs CME). */
export const LIVE_MAX_TIP_JUMP_PCT = 0.08
/**
 * Hard ceiling on single 5m bar range to filter scale glitches without
 * dropping genuine institutional fast-market breakouts (London / NYC open).
 */
export const DESK_MAX_5M_RANGE: Record<string, number> = {
  DOW: 2500,
  NASDAQ: 1200,
  NIKKEI: 2000,
  GOLD: 300,
  CRUDE: 25,
}

/**
 * Realistic single-tick velocity thresholds per instrument.
 * Protects real-time forming bars from rogue ticks, cross-feed scale blips,
 * or unconfirmed outliers from creating false massive wicks/tails.
 */
export const MAX_SINGLE_TICK_PTS: Record<string, number> = {
  DOW: 150,
  NASDAQ: 80,
  NIKKEI: 150,
  GOLD: 15,
  CRUDE: 1.5,
}

/**
 * Live CME print vs the vendor book we are overlaying. A calendar-front
 * contract after the volume roll (e.g. CLV6 ~97 vs CLX6 / CL=F ~93) trips this;
 * a delayed Yahoo last of a few ticks does not.
 */
export function liveTipDisagreesWithBook(
  liveClose: number,
  bookClose: number,
  instrument?: string | null
): boolean {
  if (!(liveClose > 0) || !(bookClose > 0)) return false
  const maxPts = instrument
    ? (MAX_SINGLE_TICK_PTS[instrument] ?? bookClose * 0.025)
    : bookClose * 0.025
  return Math.abs(liveClose - bookClose) > maxPts * 2
}

/**
 * Contract/scale guard for two prints that represent approximately the same
 * exchange time. Never compare Databento now with Yahoo's ~10-minute-delayed
 * print: a real fast-market move would be mistaken for the wrong contract and
 * the live stream would freeze until Yahoo caught up.
 */
export function liveQuoteDisagreesWithReference(
  liveClose: number,
  liveUnix: number,
  referenceClose: number,
  referenceUnix: number,
  instrument?: string | null,
  maxSeparationSec: number = LIVE_STALE_QUOTE_SEC
): boolean {
  if (!(liveUnix > 0) || !(referenceUnix > 0)) return false
  if (Math.abs(liveUnix - referenceUnix) > maxSeparationSec) return false
  return liveTipDisagreesWithBook(liveClose, referenceClose, instrument)
}

/**
 * Per-tick guard. Official raw-contract Databento prints are trusted up to the
 * hard scale-glitch ceiling; proxy/fallback feeds keep tighter point limits.
 */
export function isPlausibleRealtimeTick(
  lastClose: number,
  price: number,
  instrument?: string | null,
  trustedExchange: boolean = false
): boolean {
  if (!(price > 0)) return false
  if (!(lastClose > 0)) return true
  if (trustedExchange) {
    return Math.abs(price - lastClose) / lastClose <= LIVE_MAX_TIP_JUMP_PCT
  }
  const maxPts = instrument
    ? (MAX_SINGLE_TICK_PTS[instrument] ?? lastClose * 0.025)
    : lastClose * 0.05
  return Math.abs(price - lastClose) <= maxPts
}

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
  barSec: number = DESK_LIVE_BAR_SEC,
  instrument?: string | null,
  trustedExchange: boolean = false
): { last: FormingBar; rolled: boolean; gapFills: FormingBar[] } {
  const lastT = last.time
  const bucket = deskBarOpenUnix(quoteUnix, barSec)
  if (!(price > 0) || !(bucket > 0)) {
    return { last, rolled: false, gapFills: [] }
  }

  // Reconnect replay and network reordering can deliver an older completed
  // bucket after the chart has advanced. Never fold that price into the
  // current candle; REST/Databento bar reconciliation owns older buckets.
  if (bucket < lastT) {
    return { last, rolled: false, gapFills: [] }
  }

  if (bucket === lastT) {
    // Outlier guard within forming bar: prevent rogue multi-hundred point jumps from creating phantom tails
    if (!isPlausibleRealtimeTick(last.close, price, instrument, trustedExchange)) {
      return { last, rolled: false, gapFills: [] }
    }

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
    const maxJump = timeframe === '30m' ? 0.15 : 0.08
    if (prev && !isPlausibleDeskTick(prev.close, bar.close, maxJump)) continue
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
  live: T | null | undefined,
  timeframe: string = '5m',
  instrument?: string | null
): T[] {
  if (!live || history.length === 0) return history
  const step =
    timeframe === '1m'
      ? 60
      : timeframe === '30m'
      ? 1800
      : timeframe === '1D'
      ? 86400
      : 300
  const liveT = timeframe === '1D' ? live.time : Math.floor(live.time / step) * step
  const alignedLive: T = { ...live, time: liveT }
  const last = history[history.length - 1]!
  const lastT = last.time
  // Same-bar only: delayed Yahoo close vs live *now* is a real move, not a
  // wrong-month contract. Comparing across timestamps skipped the tape and
  // left the chart on delayed bars with a hole to the live tip.
  if (liveT === lastT && liveTipDisagreesWithBook(alignedLive.close, last.close, instrument)) {
    return history
  }
  if (liveT > lastT) {
    if (!isPlausibleDeskTick(last.close, alignedLive.close, 0.08)) return history
    // Do not invent flat zero-volume bars across the vendor lag window.
    // Real 1m CME prints for that span come from the Databento overlay.
    return [...history, alignedLive]
  }
  if (liveT < lastT) return history
  if (!isPlausibleDeskTick(last.close, alignedLive.close, 0.08)) return history
  const close = alignedLive.close
  const next: T = {
    ...last,
    open: alignedLive.open > 0 ? alignedLive.open : last.open,
    high: Math.max(last.high, alignedLive.high, close),
    low: Math.min(last.low, alignedLive.low, close),
    close,
  }
  const out = history.slice()
  out[out.length - 1] = next
  return fillCandleGaps(out, timeframe)
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
