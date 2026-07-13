/**
 * Finnhub API Client
 * Fetches real-time market price data
 */

import type { FinnhubQuoteResponse, Instrument, PriceData } from '@/types/price-feed'

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'

// Mapping from our instrument names to Finnhub symbols
const INSTRUMENT_SYMBOLS: Record<Instrument, string> = {
  DOW: '^GSPC',      // S&P 500 as proxy for DOW
  NASDAQ: '^IXIC',   // Nasdaq Composite
  NIKKEI: '^N225',   // Nikkei 225
}

interface RateLimitState {
  calls: number
  resetTime: number
}

export class FinnhubClient {
  private apiKey: string
  private rateLimitState: RateLimitState = { calls: 0, resetTime: Date.now() }
  private lastPrices: Map<Instrument, number> = new Map()

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Finnhub API key is required')
    }
    this.apiKey = apiKey
  }

  /**
   * Fetch a single quote from Finnhub
   */
  async getQuote(instrument: Instrument): Promise<PriceData | null> {
    try {
      const symbol = INSTRUMENT_SYMBOLS[instrument]
      if (!symbol) {
        console.error(`[Finnhub] Unknown instrument: ${instrument}`)
        return null
      }

      const url = new URL(`${FINNHUB_BASE_URL}/quote`)
      url.searchParams.append('symbol', symbol)

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Finnhub-Token': this.apiKey,
        },
      })

      if (!response.ok) {
        if (response.status === 429) {
          console.warn('[Finnhub] Rate limited (429)')
          this.handleRateLimit()
        }
        console.error(`[Finnhub] API error: ${response.status} ${response.statusText}`)
        return null
      }

      const data: FinnhubQuoteResponse = await response.json()

      // Validate response
      if (!data.c || typeof data.c !== 'number' || data.c <= 0) {
        console.error('[Finnhub] Invalid quote response:', data)
        return null
      }

      // Calculate bid/ask (approximate, since Finnhub free tier doesn't provide)
      const spread = data.c * 0.0001 // 0.01% spread
      const bid = parseFloat((data.c - spread).toFixed(4))
      const ask = parseFloat((data.c + spread).toFixed(4))
      const change = parseFloat((data.c - data.pc).toFixed(2))
      const changePct = parseFloat(((change / data.pc) * 100).toFixed(4))

      return {
        price: data.c,
        bid,
        ask,
        change,
        change_pct: changePct,
        volume: data.v,
        timestamp: new Date(data.t * 1000).toISOString(),
      }
    } catch (error) {
      console.error('[Finnhub] Error fetching quote:', error)
      return null
    }
  }

  /**
   * Fetch multiple quotes in parallel
   */
  async getQuotes(instruments: Instrument[]): Promise<Map<Instrument, PriceData>> {
    const results = new Map<Instrument, PriceData>()

    // Fetch all in parallel
    const promises = instruments.map(async (instrument) => {
      const data = await this.getQuote(instrument)
      if (data) {
        results.set(instrument, data)
      }
    })

    await Promise.all(promises)
    return results
  }

  /**
   * Handle rate limiting by backing off
   */
  private handleRateLimit(): void {
    const now = Date.now()
    const resetTime = now + 60000 // 60 second backoff
    this.rateLimitState = { calls: 60, resetTime }
    console.warn(`[Finnhub] Rate limit backoff until ${new Date(resetTime).toISOString()}`)
  }

  /**
   * Check if currently rate limited
   */
  isRateLimited(): boolean {
    const now = Date.now()
    if (now >= this.rateLimitState.resetTime) {
      this.rateLimitState = { calls: 0, resetTime: now + 60000 }
      return false
    }
    return this.rateLimitState.calls >= 60
  }

  /**
   * Store last known price for deduplication
   */
  setLastPrice(instrument: Instrument, price: number): void {
    this.lastPrices.set(instrument, price)
  }

  /**
   * Get last known price
   */
  getLastPrice(instrument: Instrument): number | undefined {
    return this.lastPrices.get(instrument)
  }
}

// Singleton instance
let finnhubInstance: FinnhubClient | null = null

export function getFinnhubClient(): FinnhubClient {
  if (!finnhubInstance) {
    const apiKey = process.env.FINNHUB_API_KEY
    if (!apiKey) {
      throw new Error('FINNHUB_API_KEY environment variable not set')
    }
    finnhubInstance = new FinnhubClient(apiKey)
  }
  return finnhubInstance
}
