/**
 * Price Feeder Service
 * Handles price fetching, validation, and broadcasting
 */

import { getFinnhubClient } from '@/lib/finnhub/client'
import { broadcastPrice, broadcastLevelStatus } from '@/lib/realtime/channels'
import { getLevelStatusManager } from '@/lib/services/levelStatusManager'
import { getConnectionManager } from '@/lib/services/connectionManager'
import type { Instrument, PriceUpdate, BroadcastResult } from '@/types/price-feed'

const STALE_DATA_THRESHOLD_MS = 5000 // 5 seconds
const PRICE_CHANGE_THRESHOLD = 0.01 // Only broadcast if price changed by at least 0.01

interface PriceFeedState {
  lastBroadcast: Map<Instrument, { price: number; timestamp: string }>
}

export class PriceFeeder {
  private finnhubClient = getFinnhubClient()
  private state: PriceFeedState = {
    lastBroadcast: new Map(),
  }

  /**
   * Fetch latest prices for instruments from Finnhub
   */
  async fetchLatestPrices(instruments: Instrument[]): Promise<Map<Instrument, PriceUpdate>> {
    const priceUpdates = new Map<Instrument, PriceUpdate>()

    try {
      // Fetch all prices in parallel
      const priceDataMap = await this.finnhubClient.getQuotes(instruments)

      for (const [instrument, priceData] of priceDataMap.entries()) {
        // Validate data before creating update
        if (this.isStaleData(priceData.timestamp)) {
          console.warn(`[PriceFeeder] Stale data for ${instrument}: ${priceData.timestamp}`)
          continue
        }

        // Check if price actually changed (avoid duplicates)
        if (this.isDuplicate(instrument, priceData.price)) {
          console.debug(`[PriceFeeder] Duplicate price for ${instrument}: ${priceData.price}`)
          continue
        }

        // Determine market session
        const session = this.determineMarketSession()

        const priceUpdate: PriceUpdate = {
          instrument,
          price: priceData.price,
          bid: priceData.bid,
          ask: priceData.ask,
          change: priceData.change,
          change_pct: priceData.change_pct,
          volume: priceData.volume,
          timestamp: priceData.timestamp,
          session,
        }

        priceUpdates.set(instrument, priceUpdate)
        this.finnhubClient.setLastPrice(instrument, priceData.price)
      }

      return priceUpdates
    } catch (error) {
      console.error('[PriceFeeder] Error fetching prices:', error)
      return new Map()
    }
  }

  /**
   * Broadcast prices to Realtime channels
   */
  async broadcastPrices(prices: Map<Instrument, PriceUpdate>): Promise<BroadcastResult> {
    const result: BroadcastResult = {
      broadcasted: [],
      failed: [],
      timestamp: new Date().toISOString(),
    }

    const levelStatusManager = getLevelStatusManager()
    const connectionManager = getConnectionManager()

    for (const [instrument, priceUpdate] of prices.entries()) {
      try {
        await broadcastPrice(instrument, priceUpdate)
        result.broadcasted.push(instrument)

        // Store last broadcast for deduplication
        this.state.lastBroadcast.set(instrument, {
          price: priceUpdate.price,
          timestamp: priceUpdate.timestamp,
        })

        console.debug(`[PriceFeeder] Broadcasted ${instrument}: ${priceUpdate.price}`)

        // Update level status for this price
        try {
          const changedLevels = levelStatusManager.updateForPrice(
            instrument,
            priceUpdate.price
          )

          // Broadcast level status if any levels changed
          if (changedLevels.length > 0) {
            const statusUpdate = {
              instrument,
              currentPrice: priceUpdate.price,
              changedLevels: changedLevels.map((level) => ({
                level: level.level,
                status: level.status,
                previousStatus: level.previousDistance ? 'previous' : 'unvisited',
                proximity: level.currentDistance.proximity,
                distance: level.currentDistance.distance,
              })),
              timestamp: new Date(),
            }

            await broadcastLevelStatus(statusUpdate)
          }
        } catch (statusError) {
          console.error(
            `[PriceFeeder] Error updating/broadcasting level status for ${instrument}:`,
            statusError
          )
          // Don't fail the entire broadcast if level status update fails
        }
      } catch (error) {
        console.error(`[PriceFeeder] Failed to broadcast ${instrument}:`, error)
        result.failed.push(instrument)
        // Notify connection manager of broadcast failure
        connectionManager.markFailed(
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }

    return result
  }

  /**
   * Check if data is stale (older than threshold)
   */
  isStaleData(timestamp: string): boolean {
    try {
      const dataTime = new Date(timestamp).getTime()
      const now = Date.now()
      const age = now - dataTime

      if (age > STALE_DATA_THRESHOLD_MS) {
        console.warn(`[PriceFeeder] Data is stale: ${age}ms old`)
        return true
      }

      return false
    } catch (error) {
      console.error('[PriceFeeder] Error parsing timestamp:', timestamp)
      return true
    }
  }

  /**
   * Check if price is a duplicate (hasn't changed enough)
   */
  isDuplicate(instrument: Instrument, newPrice: number): boolean {
    const lastUpdate = this.state.lastBroadcast.get(instrument)
    if (!lastUpdate) {
      return false // First time, not a duplicate
    }

    const priceDiff = Math.abs(newPrice - lastUpdate.price)
    return priceDiff < PRICE_CHANGE_THRESHOLD
  }

  /**
   * Determine current market session
   */
  private determineMarketSession(): 'market' | 'pre' | 'after' | 'closed' {
    const now = new Date()
    const hour = now.getUTCHours()
    const dayOfWeek = now.getUTCDay()

    // Weekend or holiday (simplified - doesn't account for US holidays)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return 'closed'
    }

    // US Market hours (EST/EDT)
    // Pre-market: 4 AM - 9:30 AM EST
    // Regular: 9:30 AM - 4 PM EST
    // After-hours: 4 PM - 8 PM EST
    // Closed: 8 PM - 4 AM EST

    if (hour >= 8 && hour < 13) {
      // Pre-market (4 AM - 9:30 AM EST)
      return 'pre'
    } else if (hour >= 13 && hour < 20) {
      // Market hours (9:30 AM - 4 PM EST)
      return 'market'
    } else if (hour >= 20 && hour < 24) {
      // After-hours (4 PM - 8 PM EST)
      return 'after'
    } else {
      // Closed (8 PM - 4 AM EST)
      return 'closed'
    }
  }

  /**
   * Get last broadcast state for debugging
   */
  getLastBroadcast(instrument: Instrument): { price: number; timestamp: string } | undefined {
    return this.state.lastBroadcast.get(instrument)
  }
}

// Singleton instance
let priceFeederInstance: PriceFeeder | null = null

export function getPriceFeeder(): PriceFeeder {
  if (!priceFeederInstance) {
    priceFeederInstance = new PriceFeeder()
  }
  return priceFeederInstance
}
