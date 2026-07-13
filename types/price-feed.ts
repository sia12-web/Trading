/**
 * Price Feed Types
 * Real-time market price data structures and types
 */

export type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI'
export type MarketSession = 'market' | 'pre' | 'after' | 'closed'

/**
 * Raw price data from Finnhub API
 */
export interface FinnhubQuoteResponse {
  c: number          // Current price
  h: number          // Daily high
  l: number          // Daily low
  o: number          // Open price
  pc: number         // Previous close
  t: number          // Timestamp (Unix)
  v?: number         // Volume (optional)
}

/**
 * Processed price data ready for broadcast
 */
export interface PriceData {
  price: number
  bid: number
  ask: number
  change: number     // Absolute change from previous close
  change_pct: number // Percentage change
  volume?: number
  timestamp: string  // ISO 8601
}

/**
 * Price update message for Realtime broadcast
 */
export interface PriceUpdate {
  instrument: Instrument
  price: number
  bid: number
  ask: number
  change: number
  change_pct: number
  volume?: number
  timestamp: string
  session: MarketSession
}

/**
 * Result of broadcasting prices
 */
export interface BroadcastResult {
  broadcasted: Instrument[]
  failed: Instrument[]
  timestamp: string
}

/**
 * Price feed update response
 */
export interface PriceFeedResponse {
  success: boolean
  prices: Partial<Record<Instrument, PriceUpdate>>
  last_update: string
  next_update: string
  error?: string
}

/**
 * Changed level in status update
 */
export interface ChangedLevel {
  level: number
  status: string
  previousStatus: string
  proximity: string
  distance: number
}
