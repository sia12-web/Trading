/**
 * Low-latency Yahoo last price for index symbols (no API key).
 * Uses a tiny chart slice (1h/1m) so live polling stays fast.
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

/** In-process cache — live desk polls ~1–2s; Yahoo meta is enough at ~800ms TTL */
const quoteCache = new Map<string, { at: number; quote: YahooQuote }>()
const QUOTE_TTL_MS = 750

export async function getYahooQuote(instrument: Instrument): Promise<YahooQuote | null> {
  const symbol = YAHOO_SYMBOLS[instrument]
  if (!symbol) return null

  const cached = quoteCache.get(instrument)
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) {
    return cached.quote
  }

  // 1h of 1m bars is enough for meta.regularMarketPrice — far lighter than full 1d
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1m&range=1h&includePrePost=false`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradePulse/1.0)',
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(6_000),
  })

  if (!response.ok) {
    console.error(`[Yahoo] Quote HTTP ${response.status} for ${symbol}`)
    return cached?.quote ?? null
  }

  const json = await response.json()
  const result = json?.chart?.result?.[0]
  const meta = result?.meta
  if (!meta) return cached?.quote ?? null

  const previous =
    typeof meta.chartPreviousClose === 'number'
      ? meta.chartPreviousClose
      : typeof meta.previousClose === 'number'
        ? meta.previousClose
        : null

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
  if (live == null || !Number.isFinite(live) || live <= 0) return cached?.quote ?? null

  const prev = previous ?? live
  const change = live - prev
  const change_pct = prev ? (change / prev) * 100 : 0

  const exchangeTs =
    typeof meta.regularMarketTime === 'number' && meta.regularMarketTime > 0
      ? meta.regularMarketTime
      : Math.floor(Date.now() / 1000)

  const quote: YahooQuote = {
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

  quoteCache.set(instrument, { at: Date.now(), quote })
  return quote
}
