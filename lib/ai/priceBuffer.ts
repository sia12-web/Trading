/**
 * Price History Buffer
 * Circular buffer for storing recent price history per level
 * Auto-trims to stay within memory bounds
 */

import type { Instrument } from '@/types/price-feed'
import type { PriceDataPoint, PriceHistoryBufferData } from './types'

/**
 * Circular buffer for price history
 * Automatically trims oldest prices when buffer reaches 90% capacity
 * Minimum 5 prices needed for reliable reversal detection (isInitialized = true)
 */
export class PriceHistoryBuffer {
  private level: number
  private instrument: Instrument
  private prices: PriceDataPoint[] = []
  private maxSize: number
  private lastUpdate: Date = new Date()

  constructor(level: number, instrument: Instrument, maxSize: number = 200) {
    this.level = level
    this.instrument = instrument
    this.maxSize = maxSize
  }

  /**
   * Add a price point to the buffer
   * Automatically trims if buffer exceeds 90% capacity
   */
  addPrice(price: number, volume?: number, timestamp?: Date): void {
    const now = timestamp ?? new Date()

    this.prices.push({
      price,
      volume,
      timestamp: now,
    })

    this.lastUpdate = now

    // Trim if buffer is getting full
    this.checkAndTrim()
  }

  /**
   * Get all prices in the buffer
   * Returns a copy to prevent external mutation
   */
  getPrices(): PriceDataPoint[] {
    return [...this.prices]
  }

  /**
   * Get the number of prices in the buffer
   */
  size(): number {
    return this.prices.length
  }

  /**
   * Check if buffer has enough data for reliable analysis
   * Returns true if at least 5 candles available
   */
  isInitialized(): boolean {
    return this.prices.length >= 5
  }

  /**
   * Get state of this buffer
   */
  getState(): PriceHistoryBufferData {
    return {
      level: this.level,
      instrument: this.instrument,
      prices: [...this.prices],
      maxSize: this.maxSize,
      lastUpdate: this.lastUpdate,
      isInitialized: this.isInitialized(),
    }
  }

  /**
   * Clear all prices from buffer
   */
  clear(): void {
    this.prices = []
  }

  /**
   * Check if trim is needed and execute if required
   * Trims when buffer reaches 90% of maxSize
   */
  private checkAndTrim(): void {
    const trimThreshold = Math.floor(this.maxSize * 0.9)

    if (this.prices.length >= trimThreshold) {
      this.trim()
    }
  }

  /**
   * Trim the oldest prices from the buffer
   * Removes ~10% of buffer when called
   */
  private trim(): void {
    const trimAmount = Math.floor(this.maxSize * 0.1) || 1 // At least 1

    if (this.prices.length > trimAmount) {
      this.prices = this.prices.slice(trimAmount)
    }
  }
}
