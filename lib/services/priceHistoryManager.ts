/**
 * Price History Manager
 * Manages circular buffer of recent prices for real-time chart display
 */

import type { Instrument } from '@/types/price-feed'

export interface PricePoint {
  time: number  // Unix timestamp in seconds (lightweight-charts format)
  value: number // Price value
}

interface PriceBuffer {
  prices: PricePoint[]
  lastTimestamp: string | null
}

export class PriceHistoryManager {
  private history: Map<Instrument, PriceBuffer> = new Map()
  private readonly maxPoints: number = 200 // Keep last 200 price points (~3-5 min at 1sec intervals)

  /**
   * Add a price to the history buffer
   * Deduplicates by timestamp to prevent stale data
   */
  addPrice(instrument: Instrument, price: number, timestamp: Date): void {
    if (price <= 0) {
      return // Ignore invalid prices
    }

    const isoTimestamp = timestamp.toISOString()
    let buffer = this.history.get(instrument)

    if (!buffer) {
      buffer = { prices: [], lastTimestamp: null }
      this.history.set(instrument, buffer)
    }

    // Deduplicate: don't add if we already have a price for this exact timestamp
    if (buffer.lastTimestamp === isoTimestamp) {
      return
    }

    // Convert to Unix timestamp in seconds (lightweight-charts format)
    const unixTimeSeconds = Math.floor(timestamp.getTime() / 1000)

    // Add new price point
    buffer.prices.push({
      time: unixTimeSeconds,
      value: price,
    })

    buffer.lastTimestamp = isoTimestamp

    // Trim buffer if it exceeds max points (keep most recent)
    if (buffer.prices.length > this.maxPoints) {
      buffer.prices = buffer.prices.slice(-this.maxPoints)
    }
  }

  /**
   * Get all price history for an instrument
   */
  getHistory(instrument: Instrument): PricePoint[] {
    const buffer = this.history.get(instrument)
    return buffer ? [...buffer.prices] : [] // Return copy to prevent external mutation
  }

  /**
   * Get most recent price point
   */
  getLatestPrice(instrument: Instrument): PricePoint | null {
    const buffer = this.history.get(instrument)
    if (!buffer || buffer.prices.length === 0) return null
    return buffer.prices[buffer.prices.length - 1]!
  }

  /**
   * Get price history size
   */
  getSize(instrument: Instrument): number {
    const buffer = this.history.get(instrument)
    return buffer ? buffer.prices.length : 0
  }

  /**
   * Clear history for a specific instrument
   */
  clear(instrument: Instrument): void {
    this.history.delete(instrument)
  }

  /**
   * Clear all history
   */
  reset(): void {
    this.history.clear()
  }
}

// Singleton instance
let priceHistoryManagerInstance: PriceHistoryManager | null = null

export function getPriceHistoryManager(): PriceHistoryManager {
  if (!priceHistoryManagerInstance) {
    priceHistoryManagerInstance = new PriceHistoryManager()
  }
  return priceHistoryManagerInstance
}
