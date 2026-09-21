/**
 * Yahoo Finance chart candles (no API key).
 * Live desk uses CME futures (MYM / MNQ / NKD / MGC / CL) so IB matches Tradovate, not OANDA CFDs.
 */

import type { Instrument } from '@/types/price-feed'
import { YAHOO_SYMBOLS } from '@/lib/yahoo/symbols'

const INTERVAL_MAP: Record<string, string> = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '30': '5m', // Yahoo's native 30m futures feed drops 85% of bars and rejects period1/2. We fetch 5m and aggregate to 30m.
  '60': '60m',
  '240': '60m', // fetch 60m then aggregate to 4H
  D: '1d',
  '1D': '1d',
  '1d': '1d',
}

export type YahooCandle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Aggregate 5m bars into 30m bars (UTC epoch buckets aligned to 1800s). */
function aggregateTo30m(candles: YahooCandle[]): YahooCandle[] {
  const BUCKET = 1800
  if (candles.length === 0) return []
  const out: YahooCandle[] = []
  let cur: YahooCandle | null = null
  let bucketStart = -1

  for (const c of candles) {
    const start = Math.floor(c.time / BUCKET) * BUCKET
    if (!cur || start !== bucketStart) {
      if (cur) out.push(cur)
      bucketStart = start
      cur = { time: start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }
    } else {
      cur.high = Math.max(cur.high, c.high)
      cur.low = Math.min(cur.low, c.low)
      cur.close = c.close
      cur.volume += c.volume
    }
  }
  if (cur) out.push(cur)
  return out
}

/** Aggregate 60m bars into 4H bars (UTC epoch buckets — fine for desk structure). */
function aggregateTo4H(candles: YahooCandle[]): YahooCandle[] {
  const BUCKET = 4 * 3600
  if (candles.length === 0) return []
  const out: YahooCandle[] = []
  let cur: YahooCandle | null = null
  let bucketStart = -1

  for (const c of candles) {
    const start = Math.floor(c.time / BUCKET) * BUCKET
    if (!cur || start !== bucketStart) {
      if (cur) out.push(cur)
      bucketStart = start
      cur = { time: start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }
    } else {
      cur.high = Math.max(cur.high, c.high)
      cur.low = Math.min(cur.low, c.low)
      cur.close = c.close
      cur.volume += c.volume
    }
  }
  if (cur) out.push(cur)
  return out
}

function dedupeSort(candles: YahooCandle[]): YahooCandle[] {
  candles.sort((a, b) => a.time - b.time)
  const deduped: YahooCandle[] = []
  for (const c of candles) {
    const prev = deduped[deduped.length - 1]
    if (prev && prev.time === c.time) {
      deduped[deduped.length - 1] = c
    } else if (!prev || c.time > prev.time) {
      deduped.push(c)
    }
  }
  return deduped
}

/**
 * This is the primary intraday bar source, so it needs a deadline: without one a stalled
 * Yahoo connection holds the candles route open indefinitely instead of failing over to
 * Databento. `unreachable` lets the caller skip its second attempt when the first was a
 * transport failure rather than an empty result.
 */
const YAHOO_CHART_TIMEOUT_MS = 4_000

const UNREACHABLE = Symbol('yahoo-unreachable')
type ChartResult = YahooCandle[] | null | typeof UNREACHABLE

async function fetchYahooChart(
  symbol: string,
  interval: string,
  query: string
): Promise<ChartResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&${query}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradePulse/1.0)',
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(YAHOO_CHART_TIMEOUT_MS),
    })
  } catch (err) {
    console.error(`[Yahoo] Candle fetch failed for ${symbol}:`, (err as Error)?.message)
    return UNREACHABLE
  }

  if (!response.ok) {
    console.error(`[Yahoo] Candle HTTP ${response.status} for ${symbol}`)
    return response.status >= 500 ? UNREACHABLE : null
  }

  const json = await response.json()
  const result = json?.chart?.result?.[0]
  const timestamps: number[] = result?.timestamp || []
  const quote = result?.indicators?.quote?.[0]
  if (!timestamps.length || !quote) {
    return null
  }

  const candles: YahooCandle[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open?.[i]
    const high = quote.high?.[i]
    const low = quote.low?.[i]
    const close = quote.close?.[i]
    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      !Number.isFinite(open) ||
      !Number.isFinite(close)
    ) {
      continue
    }
    candles.push({
      time: timestamps[i]!,
      open,
      high,
      low,
      close,
      volume: quote.volume?.[i] ?? 0,
    })
  }

  return dedupeSort(candles)
}

export async function getYahooCandles(
  instrument: Instrument,
  resolution: string,
  days: number
): Promise<{ candles: YahooCandle[]; symbol: string } | null> {
  const symbol = YAHOO_SYMBOLS[instrument]
  if (!symbol) return null

  const interval = INTERVAL_MAP[resolution] || '5m'
  const is1m = resolution === '1' || interval === '1m'
  const is30m = resolution === '30'
  const is4H = resolution === '240'
  const fetchDays = is1m
    ? Math.min(days, 8)
    : is4H || is30m
      ? Math.max(days, 10)
      : days
  const range =
    is1m
      ? fetchDays <= 5
        ? '5d'
        : '7d'
      : fetchDays <= 1
        ? '1d'
        : fetchDays <= 5
          ? '5d'
          : fetchDays <= 30
            ? '1mo'
            : fetchDays <= 100
              ? '3mo'
              : fetchDays <= 200
                ? '6mo'
                : fetchDays <= 400
                  ? '1y'
                  : fetchDays <= 800
                    ? '2y'
                    : '5y'

  // Intraday CME futures: explicit period1/period2 returns denser 5m history than
  // coarse range=1mo (Yahoo often truncates *=F intraday under range=).
  const nowSec = Math.floor(Date.now() / 1000)
  const period1 = is1m
    ? nowSec - fetchDays * 24 * 3600
    : nowSec - Math.max(fetchDays, 5) * 24 * 3600
  const first =
    interval === '1d'
      ? await fetchYahooChart(symbol, interval, `range=${range}`)
      : await fetchYahooChart(
          symbol,
          interval,
          `period1=${period1}&period2=${nowSec}`
        )
  // Retry the coarser range= form only when Yahoo answered but had nothing useful.
  // Retrying after a timeout just doubles the wait before failing over to Databento.
  let candles: YahooCandle[] | null = first === UNREACHABLE ? null : first
  if (first !== UNREACHABLE && !candles?.length) {
    const retry = await fetchYahooChart(symbol, interval, `range=${range}`)
    candles = retry === UNREACHABLE ? null : retry
  }
  if (!candles?.length) return null
  if (resolution === '240') candles = aggregateTo4H(candles)
  if (resolution === '30') candles = aggregateTo30m(candles)
  return { candles, symbol }
}

/**
 * Intraday candles for a pinned UTC range (simulation / historical desk).
 * period1/period2 are unix seconds.
 */
export async function getYahooCandlesRange(
  instrument: Instrument,
  resolution: string,
  period1: number,
  period2: number
): Promise<{ candles: YahooCandle[]; symbol: string } | null> {
  const symbol = YAHOO_SYMBOLS[instrument]
  if (!symbol) return null

  const interval = INTERVAL_MAP[resolution] || '5m'
  const fetched = await fetchYahooChart(
    symbol,
    interval,
    `period1=${Math.floor(period1)}&period2=${Math.floor(period2)}`
  )
  if (!fetched || fetched === UNREACHABLE) return null
  let candles: YahooCandle[] = fetched
  if (resolution === '240') candles = aggregateTo4H(candles)
  if (resolution === '30') candles = aggregateTo30m(candles)
  // Keep only bars inside the requested window
  candles = candles.filter((c) => c.time >= period1 && c.time <= period2)
  return { candles, symbol }
}
