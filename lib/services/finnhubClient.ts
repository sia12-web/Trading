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
      logger.warn('[FinnhubClient] FINNHUB_API_KEY not set in environment')
    }
  }

  /**
   * Fetch quote data for an instrument
   * Maps instrument symbol to Finnhub symbol: DOW -> ^DJI, NASDAQ -> ^IXIC, NIKKEI -> ^N225
   */
  async getQuote(instrument: Instrument): Promise<FinnhubQuote | null> {
    try {
      const symbol = this.getSymbol(instrument)
      const url = `${FINNHUB_BASE_URL}/quote?symbol=${symbol}&token=${this.apiKey}`

      logger.debug(`[FinnhubClient] Fetching quote for ${instrument} (${symbol})`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)

      const response = await fetch(url, {
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        logger.error(
          `[FinnhubClient] Quote fetch failed for ${instrument}: HTTP ${response.status}`
        )
        return null
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
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          logger.error(`[FinnhubClient] Quote fetch timeout for ${instrument}`)
        } else {
          logger.error(`[FinnhubClient] Quote fetch error for ${instrument}: ${error.message}`)
        }
      }
      return null
    }
  }

  /**
   * Fetch news for an instrument (optional for MVP)
   */
  async getNews(instrument: Instrument): Promise<FinnhubNews['headlines'] | null> {
    try {
      const symbol = this.getSymbol(instrument)
      const today = new Date()
      const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

      const fromDate = oneWeekAgo.toISOString().split('T')[0]
      const toDate = today.toISOString().split('T')[0]

      const url =
        `${FINNHUB_BASE_URL}/company-news?` +
        `symbol=${symbol}&from=${fromDate}&to=${toDate}&limit=20&token=${this.apiKey}`

      logger.debug(`[FinnhubClient] Fetching news for ${instrument}`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)

      const response = await fetch(url, {
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        logger.error(
          `[FinnhubClient] News fetch failed for ${instrument}: HTTP ${response.status}`
        )
        return null
      }

      // Finnhub returns array directly
      const newsItems = (await response.json()) as FinnhubNewsItem[]

      // Transform to our format
      const headlines = newsItems
        .map((item) => {
          // Simple sentiment analysis based on keywords
          const headline = item.headline.toLowerCase()
          let sentiment = 0

          const bullishKeywords = [
            'rally',
            'up',
            'surge',
            'bullish',
            'gains',
            'recovery',
            'strong',
            'rise',
          ]
          const bearishKeywords = [
            'fall',
            'down',
            'crash',
            'bearish',
            'loss',
            'decline',
            'weak',
            'drop',
          ]

          bullishKeywords.forEach((keyword) => {
            if (headline.includes(keyword)) sentiment += 2
          })
          bearishKeywords.forEach((keyword) => {
            if (headline.includes(keyword)) sentiment -= 2
          })

          sentiment = Math.max(-10, Math.min(10, sentiment)) // Clamp to -10 to +10

          return {
            headline: item.headline,
            source: 'Finnhub',
            sentiment,
            timestamp: new Date(item.datetime * 1000).toISOString(),
          }
        })
        .slice(0, 10) // Top 10 headlines

      logger.debug(`[FinnhubClient] Successfully fetched ${headlines.length} news items for ${instrument}`)

      return headlines
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          logger.error(`[FinnhubClient] News fetch timeout for ${instrument}`)
        } else {
          logger.error(`[FinnhubClient] News fetch error for ${instrument}: ${error.message}`)
        }
      }
      return null
    }
  }

  /**
   * Map instrument name to Finnhub symbol
   */
  private getSymbol(instrument: Instrument): string {
    const symbolMap: Record<Instrument, string> = {
      DOW: '^DJI', // Dow Jones Industrial Average
      NASDAQ: '^IXIC', // NASDAQ Composite
      NIKKEI: '^N225', // Nikkei 225
    }
    return symbolMap[instrument]
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
