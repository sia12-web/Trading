/**
 * Low-latency Yahoo last price for index symbols (no API key).
 */

import type { Instrument } from '@/types/price-feed'

const YAHOO_SYMBOLS: Record<Instrument, string> = {
  DOW: '^DJI',
  NASDAQ: '^IXIC',
  NIKKEI: '^N225',
}

export type YahooQuote = {
  symbol: string
  price: number
  change: number
  change_pct: number
  previous_close: number
  timestamp: number
  /** Session open / day range when Yahoo meta provides them */
  open: number | null
  high: number | null
  low: number | null
}

export async function getYahooQuote(instrument: Instrument): Promise<YahooQuote | null> {
  const symbol = YAHOO_SYMBOLS[instrument]
  if (!symbol) return null

  // 1m chart slice is light and includes regularMarketPrice + day OHLC meta
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1m&range=1d&includePrePost=false`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradePulse/1.0)',
      Accept: 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    console.error(`[Yahoo] Quote HTTP ${response.status} for ${symbol}`)
    return null
  }

  const json = await response.json()
  const result = json?.chart?.result?.[0]
  const meta = result?.meta
  if (!meta) return null

  const previous =
    typeof meta.chartPreviousClose === 'number'
      ? meta.chartPreviousClose
      : typeof meta.previousClose === 'number'
        ? meta.previousClose
        : null

  // Prefer live mark price; fall back to newest 1m close only if mark missing
  let lastBarClose: number | null = null
  const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close || []
  for (let i = closes.length - 1; i >= 0; i--) {
    const c = closes[i]
    if (c != null && Number.isFinite(c)) {
      lastBarClose = c
      break
    }
  }

  const mark =
    typeof meta.regularMarketPrice === 'number' && meta.regularMarketPrice > 0
      ? meta.regularMarketPrice
      : null
  const live = mark ?? lastBarClose
  if (live == null || !Number.isFinite(live) || live <= 0) return null

  const prev = previous ?? live
  const change = live - prev
  const change_pct = prev ? (change / prev) * 100 : 0

  // Wall-clock for bar rollover when market is open (bar timestamps lag)
  const exchangeTs =
    typeof meta.regularMarketTime === 'number' && meta.regularMarketTime > 0
      ? meta.regularMarketTime
      : Math.floor(Date.now() / 1000)

  return {
    symbol,
    price: live,
    change,
    change_pct,
    previous_close: prev,
    timestamp: exchangeTs,
    open: typeof meta.regularMarketOpen === 'number' ? meta.regularMarketOpen : null,
    high: typeof meta.regularMarketDayHigh === 'number' ? meta.regularMarketDayHigh : null,
    low: typeof meta.regularMarketDayLow === 'number' ? meta.regularMarketDayLow : null,
  }
}
