/**
 * Low-latency Yahoo last price for index symbols (no API key).
 * Uses the lightweight quote endpoint — not a full candle chart slice.
 */

import type { Instrument } from '@/types/price-feed'

const YAHOO_SYMBOLS: Record<Instrument, string> = {
  DOW: '^DJI',
  NASDAQ: '^NDX',
  NIKKEI: '^N225',
}

export type YahooQuote = {
  symbol: string
  price: number
  change: number
  change_pct: number
  previous_close: number
  timestamp: number
  open: number | null
  high: number | null
  low: number | null
}

const quoteCache = new Map<string, { at: number; quote: YahooQuote }>()
/** Keep short — desk polls ~400ms; stale cache was a major lag source */
const QUOTE_TTL_MS = 200

export async function getYahooQuote(instrument: Instrument): Promise<YahooQuote | null> {
  const symbol = YAHOO_SYMBOLS[instrument]
  if (!symbol) return null

  const cached = quoteCache.get(instrument)
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) {
    return cached.quote
  }

  // v7 quote is much lighter than chart?interval=1m&range=1h
  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradePulse/1.0)',
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(3_500),
    })

    if (!response.ok) {
      // Fallback: tiny chart meta (older path)
      return (await getYahooQuoteFromChart(instrument, symbol, cached?.quote)) ?? null
    }

    const json = await response.json()
    const row = json?.quoteResponse?.result?.[0]
    if (!row) {
      return (await getYahooQuoteFromChart(instrument, symbol, cached?.quote)) ?? null
    }

    const live = Number(row.regularMarketPrice)
    if (!(live > 0)) {
      return (await getYahooQuoteFromChart(instrument, symbol, cached?.quote)) ?? null
    }

    const prev = Number(row.regularMarketPreviousClose) || live
    const change = Number(row.regularMarketChange) || live - prev
    const change_pct =
      Number(row.regularMarketChangePercent) || (prev ? (change / prev) * 100 : 0)
    const ts =
      typeof row.regularMarketTime === 'number' && row.regularMarketTime > 0
        ? row.regularMarketTime
        : Math.floor(Date.now() / 1000)

    const quote: YahooQuote = {
      symbol,
      price: live,
      change,
      change_pct,
      previous_close: prev,
      timestamp: ts,
      open: Number(row.regularMarketOpen) || null,
      high: Number(row.regularMarketDayHigh) || null,
      low: Number(row.regularMarketDayLow) || null,
    }
    quoteCache.set(instrument, { at: Date.now(), quote })
    return quote
  } catch {
    return (await getYahooQuoteFromChart(instrument, symbol, cached?.quote)) ?? null
  }
}

async function getYahooQuoteFromChart(
  instrument: Instrument,
  symbol: string,
  fallback: YahooQuote | null | undefined
): Promise<YahooQuote | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1m&range=1d&includePrePost=false`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradePulse/1.0)',
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(3_500),
    })
    if (!response.ok) return fallback ?? null
    const json = await response.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta) return fallback ?? null
    const live = Number(meta.regularMarketPrice)
    if (!(live > 0)) return fallback ?? null
    const prev =
      Number(meta.chartPreviousClose) || Number(meta.previousClose) || live
    const change = live - prev
    const quote: YahooQuote = {
      symbol,
      price: live,
      change,
      change_pct: prev ? (change / prev) * 100 : 0,
      previous_close: prev,
      timestamp:
        typeof meta.regularMarketTime === 'number' && meta.regularMarketTime > 0
          ? meta.regularMarketTime
          : Math.floor(Date.now() / 1000),
      open: Number(meta.regularMarketOpen) || null,
      high: Number(meta.regularMarketDayHigh) || null,
      low: Number(meta.regularMarketDayLow) || null,
    }
    quoteCache.set(instrument, { at: Date.now(), quote })
    return quote
  } catch {
    return fallback ?? null
  }
}
