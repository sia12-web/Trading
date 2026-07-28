/**
 * Finnhub API client for fetching market data
 */

import { logger } from '@/lib/utils/logger'
import type { FinnhubQuoteResponse, FinnhubNewsItem, Instrument } from '@/types/trading'

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'
const API_TIMEOUT = 5000 // 5 seconds

interface FinnhubQuote {
  symbol: string
  current: number
  open: number
  high: number
  low: number
  previousClose: number
  timestamp: number
}

interface FinnhubNews {
  headlines: Array<{
    headline: string
    source: string
    sentiment: number
    timestamp: string
  }>
}

export class FinnhubClient {
  private apiKey: string

  constructor() {
    this.apiKey = process.env.FINNHUB_API_KEY || ''
    if (!this.apiKey) {
      logger.error('[FinnhubClient] FINNHUB_API_KEY not configured - all API calls will fail. Set FINNHUB_API_KEY environment variable.')
    }
  }

  /**
   * Fetch quote data for an instrument with exponential backoff retry
   * Maps instrument symbol to Finnhub symbol: DOW -> ^DJI, NASDAQ -> ^NDX, NIKKEI -> ^N225
   */
  async getQuote(instrument: Instrument): Promise<FinnhubQuote | null> {
    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const symbol = this.getSymbol(instrument)
        const url = `${FINNHUB_BASE_URL}/quote?symbol=${symbol}&token=${this.apiKey}`

        logger.debug(`[FinnhubClient] Fetching quote for ${instrument} (${symbol}) - attempt ${attempt + 1}/${maxRetries}`)

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)

        const response = await fetch(url, {
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`)
          lastError = error

          if (attempt < maxRetries - 1) {
            const delayMs = Math.pow(2, attempt) * 1000
            logger.warn(
              `[FinnhubClient] Quote fetch failed for ${instrument}: ${response.status}, retrying in ${delayMs}ms`
            )
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            continue
          } else {
            logger.error(`[FinnhubClient] Quote fetch failed for ${instrument}: HTTP ${response.status} (final attempt)`)
            return null
          }
        }

        const data = (await response.json()) as FinnhubQuoteResponse

        logger.debug(
          `[FinnhubClient] Successfully fetched quote for ${instrument}: open=${data.o}, close=${data.pc}`
        )

        return {
          symbol: instrument,
          current: data.c,
          open: data.o,
          high: data.h,
          low: data.l,
          previousClose: data.pc,
          timestamp: data.t,
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            logger.warn(
              `[FinnhubClient] Quote fetch timeout for ${instrument} - attempt ${attempt + 1}/${maxRetries}`
            )
          } else {
            logger.warn(
              `[FinnhubClient] Quote fetch error for ${instrument}: ${error.message} - attempt ${attempt + 1}/${maxRetries}`
            )
          }
        }

        if (attempt < maxRetries - 1) {
          const delayMs = Math.pow(2, attempt) * 1000
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    }

    logger.error(`[FinnhubClient] Quote fetch failed after ${maxRetries} attempts for ${instrument}`, {
      lastError: lastError?.message,
    })
    return null
  }

  /**
   * Fetch news for an instrument with exponential backoff retry
   */
  async getNews(instrument: Instrument): Promise<FinnhubNews['headlines'] | null> {
    const rich = await this.getCompanyNewsItems(instrument)
    if (!rich) return null
    return rich.map((item) => ({
      headline: item.headline,
      source: item.source || 'Finnhub',
      sentiment: item.sentiment,
      timestamp: new Date(item.datetime * 1000).toISOString(),
    }))
  }

  /**
   * Rich company-news rows (keeps Finnhub source + url) for desk news UI.
   */
  async getCompanyNewsItems(
    instrument: Instrument
  ): Promise<
    Array<{
      headline: string
      source: string
      datetime: number
      url: string | null
      summary: string | null
      related: string | null
      origin: string
      sentiment: number
    }> | null
  > {
    if (!this.apiKey) return null
    const maxRetries = 3
    let lastError: Error | null = null
    const symbol = this.getSymbol(instrument)

    // Soft-fail path: 2 tries max — desk news must not block the session
    const newsRetries = Math.min(maxRetries, 2)
    for (let attempt = 0; attempt < newsRetries; attempt++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)
      try {
        const today = new Date()
        const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
        const fromDate = oneWeekAgo.toISOString().split('T')[0]
        const toDate = today.toISOString().split('T')[0]
        const url =
          `${FINNHUB_BASE_URL}/company-news?` +
          `symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}&token=${this.apiKey}`

        const response = await fetch(url, { signal: controller.signal })

        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`)
          // Auth / forbidden — retrying won't help
          if (response.status === 401 || response.status === 403) return null
          if (attempt < newsRetries - 1) {
            await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000))
            continue
          }
          return null
        }

        const newsItems = (await response.json()) as FinnhubNewsItem[]
        if (!Array.isArray(newsItems)) return []

        const seen = new Set<string>()
        const rows = newsItems
          .map((item) => {
            const headline = (item.headline || '').trim()
            const lower = headline.toLowerCase()
            let sentiment = 0
            for (const k of ['rally', 'surge', 'bullish', 'gains', 'rise', 'strong']) {
              if (lower.includes(k)) sentiment += 2
            }
            for (const k of ['fall', 'crash', 'bearish', 'loss', 'decline', 'drop']) {
              if (lower.includes(k)) sentiment -= 2
            }
            sentiment = Math.max(-10, Math.min(10, sentiment))
            return {
              headline,
              source: (item.source || 'Finnhub').trim(),
              datetime: Number(item.datetime) || 0,
              url: item.url || null,
              summary: item.summary || null,
              related: item.related || null,
              origin: symbol,
              sentiment,
            }
          })
          .filter((h) => {
            if (!h.headline || !h.datetime) return false
            const key = h.headline.toLowerCase()
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          .slice(0, 20)

        return rows
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < newsRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000))
        }
      } finally {
        clearTimeout(timeoutId)
      }
    }

    logger.error(`[FinnhubClient] Company news failed for ${instrument}`, {
      lastError: lastError?.message,
    })
    return null
  }

  /** General / forex market news (not symbol-scoped). */
  async getMarketNews(
    category: 'general' | 'forex' | 'merger' = 'general'
  ): Promise<
    Array<{
      headline: string
      source: string
      datetime: number
      url: string | null
      summary: string | null
      related: string | null
      origin: string
    }> | null
  > {
    if (!this.apiKey) return null
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)
    try {
      const url = `${FINNHUB_BASE_URL}/news?category=${category}&token=${this.apiKey}`
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        logger.warn(`[FinnhubClient] Market news ${category} HTTP ${response.status}`)
        return null
      }
      const items = (await response.json()) as FinnhubNewsItem[]
      if (!Array.isArray(items)) return []
      return items
        .slice(0, 40)
        .map((item) => ({
          headline: (item.headline || '').trim(),
          source: (item.source || 'Finnhub').trim(),
          datetime: Number(item.datetime) || 0,
          url: item.url || null,
          summary: item.summary || null,
          related: item.related || null,
          origin: `market:${category}`,
        }))
        .filter((h) => h.headline && h.datetime)
    } catch (error) {
      logger.warn('[FinnhubClient] Market news error', {
        err: error instanceof Error ? error.message : String(error),
      })
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /** Economic calendar (from/to YYYY-MM-DD). Soft-fails to []. */
  async getEconomicCalendar(
    fromYmd: string,
    toYmd: string
  ): Promise<
    Array<{
      time: string
      country: string
      event: string
      impact: string
      actual?: string | number | null
      estimate?: string | number | null
      prev?: string | number | null
    }>
  > {
    if (!this.apiKey) return []
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)
    try {
      const url =
        `${FINNHUB_BASE_URL}/calendar/economic?` +
        `from=${encodeURIComponent(fromYmd)}&to=${encodeURIComponent(toYmd)}&token=${this.apiKey}`
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        logger.warn(`[FinnhubClient] Economic calendar HTTP ${response.status}`)
        return []
      }
      const data = (await response.json()) as {
        economicCalendar?: Array<Record<string, unknown>>
      }
      const rows = Array.isArray(data?.economicCalendar) ? data.economicCalendar : []
      return rows.map((r) => ({
        time: String(r.time || r.date || ''),
        country: String(r.country || ''),
        event: String(r.event || ''),
        impact: String(r.impact || ''),
        actual: (r.actual as string | number | null | undefined) ?? null,
        estimate: (r.estimate as string | number | null | undefined) ?? null,
        prev: (r.prev as string | number | null | undefined) ?? null,
      }))
    } catch (error) {
      logger.warn('[FinnhubClient] Economic calendar error', {
        err: error instanceof Error ? error.message : String(error),
      })
      return []
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Map instrument name to Finnhub symbol
   */
  private getSymbol(instrument: Instrument): string {
    const symbolMap: Record<Instrument, string> = {
      DOW: 'DIA', // SPDR Dow ETF (free-tier candle access; ^DJI returns 403)
      NASDAQ: 'QQQ', // Invesco QQQ (Nasdaq-100 proxy)
      NIKKEI: 'EWJ', // iShares MSCI Japan ETF
    }
    const symbol = symbolMap[instrument]
    if (!symbol) {
      const error = new Error(`FinnhubClient: Unknown instrument "${instrument}"`)
      logger.error('[FinnhubClient] Invalid instrument', { instrument })
      throw error
    }
    return symbol
  }
}

// Singleton instance
let finnhubClientInstance: FinnhubClient | null = null

export function getFinnhubClient(): FinnhubClient {
  if (!finnhubClientInstance) {
    finnhubClientInstance = new FinnhubClient()
  }
  return finnhubClientInstance
}
