/**
 * Yahoo last for CME micros (MYM / MNQ / NKD).
 * v7 quote is often 401; v8 chart meta is the working path.
 * CME prints are delayed ~10 minutes — never treat them as a live Tradovate last.
 */

import type { Instrument } from '@/types/price-feed'
import { YAHOO_SYMBOLS } from '@/lib/yahoo/symbols'

export type YahooQuote = {
  symbol: string
  price: number
  change: number
  change_pct: number
  previous_close: number
  /** Unix seconds of the futures print. 0 = unknown (not usable for basis). */
  timestamp: number
  open: number | null
  high: number | null
  low: number | null
  /** Advertised exchange delay in seconds (Yahoo CBOT/CME = 600). */
  delayedBySec: number
}

/** Yahoo documents CBOT/CME futures as 10-minute delayed. */
export const YAHOO_CME_DECLARED_DELAY_SEC = 600

/** Reject a print older than advertised delay by more than this (stuck feed). */
export const YAHOO_PRINT_MAX_OVERAGE_SEC = 90

/** A print this fresh could be paired with the live OANDA mid. Yahoo CME never is. */
export const YAHOO_LIVE_MAX_AGE_SEC = 5

const YAHOO_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const quoteCache = new Map<string, { at: number; quote: YahooQuote }>()
/** Keep short — desk polls ~400ms; stale cache was a major lag source */
const QUOTE_TTL_MS = 200

export function yahooPrintAgeSec(
  quote: Pick<YahooQuote, 'timestamp'>,
  nowMs: number = Date.now()
): number | null {
  if (!(quote.timestamp > 0)) return null
  return nowMs / 1000 - quote.timestamp
}

/**
 * Delayed CME last may still derive a basis when paired with a same-age OANDA
 * mid. Reject unknown timestamps and prints older than delay + slack.
 */
export function isYahooPrintUsableForBasis(
  quote: Pick<YahooQuote, 'timestamp' | 'delayedBySec' | 'price'>,
  nowMs: number = Date.now()
): boolean {
  if (!(quote.price > 0)) return false
  const age = yahooPrintAgeSec(quote, nowMs)
  if (age == null) return false
  if (age < -5) return false
  const delay = quote.delayedBySec > 0 ? quote.delayedBySec : YAHOO_CME_DECLARED_DELAY_SEC
  return age <= delay + YAHOO_PRINT_MAX_OVERAGE_SEC
}

/** True only if the print is fresh enough to stand in for a live last. */
export function isYahooPrintLiveGrade(
  quote: Pick<YahooQuote, 'timestamp' | 'price'>,
  nowMs: number = Date.now()
): boolean {
  if (!(quote.price > 0)) return false
  const age = yahooPrintAgeSec(quote, nowMs)
  if (age == null) return false
  return age >= -1 && age <= YAHOO_LIVE_MAX_AGE_SEC
}

function delayedBySecFromRow(row: {
  exchangeDataDelayedBy?: unknown
  sourceInterval?: unknown
}): number {
  const advertised = Number(row.exchangeDataDelayedBy)
  if (Number.isFinite(advertised) && advertised >= 0) {
    return Math.round(advertised * 60)
  }
  const interval = Number(row.sourceInterval)
  if (Number.isFinite(interval) && interval > 0) {
    return Math.round(interval * 60)
  }
  return YAHOO_CME_DECLARED_DELAY_SEC
}

function buildQuote(
  symbol: string,
  row: {
    regularMarketPrice?: unknown
    regularMarketPreviousClose?: unknown
    chartPreviousClose?: unknown
    previousClose?: unknown
    regularMarketChange?: unknown
    regularMarketChangePercent?: unknown
    regularMarketTime?: unknown
    regularMarketOpen?: unknown
    regularMarketDayHigh?: unknown
    regularMarketDayLow?: unknown
    exchangeDataDelayedBy?: unknown
    sourceInterval?: unknown
  }
): YahooQuote | null {
  const live = Number(row.regularMarketPrice)
  if (!(live > 0)) return null
  const prev =
    Number(row.regularMarketPreviousClose) ||
    Number(row.chartPreviousClose) ||
    Number(row.previousClose) ||
    live
  const change = Number(row.regularMarketChange) || live - prev
  const change_pct =
    Number(row.regularMarketChangePercent) || (prev ? (change / prev) * 100 : 0)
  const ts =
    typeof row.regularMarketTime === 'number' && row.regularMarketTime > 0
      ? row.regularMarketTime
      : 0
  return {
    symbol,
    price: live,
    change,
    change_pct,
    previous_close: prev,
    timestamp: ts,
    open: Number(row.regularMarketOpen) || null,
    high: Number(row.regularMarketDayHigh) || null,
    low: Number(row.regularMarketDayLow) || null,
    delayedBySec: delayedBySecFromRow(row),
  }
}

export async function getYahooQuote(instrument: Instrument): Promise<YahooQuote | null> {
  const symbol = YAHOO_SYMBOLS[instrument]
  if (!symbol) return null

  const cached = quoteCache.get(instrument)
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) {
    return cached.quote
  }

  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': YAHOO_UA,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    })

    if (response.ok) {
      const json = await response.json()
      const row = json?.quoteResponse?.result?.[0]
      const quote = row ? buildQuote(symbol, row) : null
      if (quote) {
        quoteCache.set(instrument, { at: Date.now(), quote })
        return quote
      }
    }
  } catch {
    /* v7 is often 401 — chart meta is the working path */
  }

  return (await getYahooQuoteFromChart(instrument, symbol, cached?.quote)) ?? null
}

const dayPrevClose = new Map<Instrument, number>()
const prevCloseInFlight = new Set<Instrument>()

export function setDayPreviousClose(instrument: Instrument, value: number): void {
  if (value > 0) dayPrevClose.set(instrument, value)
}

/** Background refresh — deduped so a tick burst cannot fan out into Yahoo calls. */
export function refreshDayPreviousClose(instrument: Instrument): void {
  if (prevCloseInFlight.has(instrument)) return
  prevCloseInFlight.add(instrument)
  void getYahooQuote(instrument)
    .then((q) => {
      if (q?.previous_close && q.previous_close > 0) {
        dayPrevClose.set(instrument, q.previous_close)
      }
    })
    .catch(() => {})
    .finally(() => prevCloseInFlight.delete(instrument))
}

/**
 * Session previous close for day change%. Never blocks: falls back to the cached
 * quote and kicks a background refresh when the session value is still unknown.
 */
export function getDayPreviousClose(instrument: Instrument): number | null {
  const held = dayPrevClose.get(instrument)
  if (held && held > 0) return held

  const cached = quoteCache.get(instrument)?.quote
  if (cached?.previous_close && cached.previous_close > 0) {
    dayPrevClose.set(instrument, cached.previous_close)
    return cached.previous_close
  }

  refreshDayPreviousClose(instrument)
  return null
}

async function getYahooQuoteFromChart(
  instrument: Instrument,
  symbol: string,
  fallback: YahooQuote | null | undefined
): Promise<YahooQuote | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1m&range=1h&includePrePost=false`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': YAHOO_UA,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(3_500),
    })
    if (!response.ok) return fallback ?? null
    const json = await response.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta) return fallback ?? null
    const quote = buildQuote(symbol, meta)
    if (!quote) return fallback ?? null
    quoteCache.set(instrument, { at: Date.now(), quote })
    return quote
  } catch {
    return fallback ?? null
  }
}
