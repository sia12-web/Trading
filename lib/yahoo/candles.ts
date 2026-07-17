/**
 * Yahoo Finance chart candles (no API key).
 * Primary source for NY desk index OHLC (^DJI / ^IXIC) — same scale as live quotes.
 */

import type { Instrument } from '@/types/price-feed'

const YAHOO_SYMBOLS: Record<Instrument, string> = {
  DOW: '^DJI',
  NASDAQ: '^IXIC',
  NIKKEI: '^N225',
}

const INTERVAL_MAP: Record<string, string> = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '60': '60m',
  '240': '60m', // fetch 60m then aggregate to 4H
  D: '1d',
}

export type YahooCandle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
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

async function fetchYahooChart(
  symbol: string,
  interval: string,
  query: string
): Promise<YahooCandle[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&${query}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradePulse/1.0)',
      Accept: 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    console.error(`[Yahoo] Candle HTTP ${response.status} for ${symbol}`)
    return null
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
  const fetchDays = resolution === '240' ? Math.max(days, 10) : days
  const range =
    fetchDays <= 1 ? '1d' : fetchDays <= 5 ? '5d' : fetchDays <= 30 ? '1mo' : '3mo'

  let candles = await fetchYahooChart(symbol, interval, `range=${range}`)
  if (!candles) return null
  if (resolution === '240') candles = aggregateTo4H(candles)
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
  let candles = await fetchYahooChart(
    symbol,
    interval,
    `period1=${Math.floor(period1)}&period2=${Math.floor(period2)}`
  )
  if (!candles) return null
  if (resolution === '240') candles = aggregateTo4H(candles)
  // Keep only bars inside the requested window
  candles = candles.filter((c) => c.time >= period1 && c.time <= period2)
  return { candles, symbol }
}
