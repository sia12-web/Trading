/**
 * Fallback Manager
 * Handles fallback strategies: Realtime → Polling → Cached Data
 */

import type { Instrument } from '@/types/price-feed'
import { validateCachedData } from '@/lib/utils/validation'
import { logger } from '@/lib/utils/logger'

export type FallbackMode = 'realtime' | 'polling' | 'cached' | 'error'

export interface FallbackStatus {
  mode: FallbackMode
  dataAge: Map<Instrument, number> // milliseconds since last update
  isStale: Map<Instrument, boolean> // true if older than threshold
  lastError: Error | null
  pollingActive: boolean
}

interface FallbackConfig {
  pollingIntervalMs: number
  cacheExpiryMs: number
  staleThresholdMs: number
}

const DEFAULT_CONFIG: FallbackConfig = {
  pollingIntervalMs: 3000, // 3 seconds
  cacheExpiryMs: 2 * 60 * 1000, // 2 minutes
  staleThresholdMs: 60 * 1000, // 1 minute
}

interface CachedInstrumentData {
  data: Record<string, unknown>
  timestamp: Date
}

export class FallbackManager {
  private mode: FallbackMode = 'realtime'
  private pollingInterval: ReturnType<typeof setInterval> | null = null
  private cachedData: Map<Instrument, CachedInstrumentData> = new Map()
  private lastError: Error | null = null
  private statusCallbacks: Set<(status: FallbackStatus) => void> = new Set()
  private watchedInstruments: Set<Instrument> = new Set(['DOW', 'NASDAQ', 'NIKKEI'])
  private config: FallbackConfig = DEFAULT_CONFIG

  /**
   * Set which instruments are being monitored
   */
  setWatchedInstruments(instruments: Instrument[]): void {
    this.watchedInstruments = new Set(instruments)
  }

  /**
   * Register callback for status changes
   */
  onStatusChange(callback: (status: FallbackStatus) => void): () => void {
    this.statusCallbacks.add(callback)
    return () => this.statusCallbacks.delete(callback)
  }

  /**
   * Get current fallback status
   */
  getStatus(): FallbackStatus {
    const dataAge = new Map<Instrument, number>()
    const isStale = new Map<Instrument, boolean>()

    for (const [instrument, cached] of this.cachedData) {
      const age = Date.now() - cached.timestamp.getTime()
      dataAge.set(instrument, age)
      isStale.set(instrument, age > this.config.staleThresholdMs)
    }

    return {
      mode: this.mode,
      dataAge,
      isStale,
      lastError: this.lastError,
      pollingActive: this.pollingInterval !== null,
    }
  }

  /**
   * Activate polling fallback when Realtime fails
   */
  activatePolling(reason: string): void {
    logger.warn(`[FallbackManager] Activating polling fallback: ${reason}`)

    if (this.mode === 'realtime' || this.mode === 'error') {
      this.stopPolling()
      this.startPolling()
      this.mode = 'polling'
      this.lastError = null
      this.notifyStatusChange()
    }
  }

  /**
   * Activate cached data mode when polling fails
   */
  activateCached(reason: string): void {
    logger.warn(`[FallbackManager] Activating cached data fallback: ${reason}`)

    if (this.mode !== 'cached' && this.mode !== 'error') {
      this.stopPolling()
      this.mode = 'cached'
      this.lastError = new Error(reason)
      this.notifyStatusChange()
    }
  }

  /**
   * Activate error mode when all fallbacks fail
   */
  activateError(error: Error): void {
    logger.error(`[FallbackManager] All fallbacks exhausted: ${error.message}`)

    this.stopPolling()
    this.mode = 'error'
    this.lastError = error
    this.notifyStatusChange()
  }

  /**
   * Start polling fallback
   */
  private startPolling(): void {
    if (this.pollingInterval) return

    logger.debug('[FallbackManager] Starting polling every', this.config.pollingIntervalMs, 'ms')

    // Poll immediately
    this.poll()

    // Then poll on interval
    this.pollingInterval = setInterval(() => this.poll(), this.config.pollingIntervalMs)
  }

  /**
   * Single polling attempt
   */
  private async poll(): Promise<void> {
    try {
      const instrumentsList = Array.from(this.watchedInstruments).join(',')
      const res = await fetch(`/api/levels/status?instruments=${instrumentsList}`, {
        signal: AbortSignal.timeout(5000), // 5 second timeout
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const data = await res.json()

      // Validate response structure
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid response format: missing data array')
      }

      for (const item of data.data) {
        // Validate instrument
        if (!item.instrument || !['DOW', 'NASDAQ', 'NIKKEI'].includes(item.instrument)) {
          logger.warn('[FallbackManager] Invalid instrument in poll response:', item.instrument)
          continue
        }
        // Validate levels exist
        if (!item.levels || !Array.isArray(item.levels)) {
          logger.warn('[FallbackManager] Invalid levels for', item.instrument)
          continue
        }

        // Validate data before caching
        try {
          const validatedData = validateCachedData(item)
          this.cachedData.set(item.instrument, {
            data: validatedData,
            timestamp: new Date(),
          })
        } catch (error) {
          logger.error(`[FallbackManager] Invalid cached data for ${item.instrument}:`, error)
          continue
        }
      }

      // If we were in error mode, try to recover
      if (this.mode === 'error' || this.mode === 'cached') {
        this.mode = 'polling'
        this.lastError = null
        this.notifyStatusChange()
      }
    } catch (error) {
      logger.error('[FallbackManager] Polling error:', error)
      // Continue polling, don't fail immediately
    }
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
      logger.debug('[FallbackManager] Polling stopped')
    }
  }

  /**
   * Cache data from Realtime updates
   */
  cacheData(instrument: Instrument, data: unknown): void {
    try {
      const validatedData = validateCachedData(data)
      this.cachedData.set(instrument, {
        data: validatedData,
        timestamp: new Date(),
      })
    } catch (error) {
      logger.error(`[FallbackManager] Invalid data for ${instrument}:`, error)
      // Don't cache invalid data
    }
  }

  /**
   * Get cached data for an instrument
   */
  getCachedData(instrument: Instrument): { data: unknown; age: number; isStale: boolean } | null {
    const cached = this.cachedData.get(instrument)

    if (!cached) {
      return null
    }

    const age = Date.now() - cached.timestamp.getTime()
    const isStale = age > this.config.staleThresholdMs

    // Check if cache is completely expired
    if (age > this.config.cacheExpiryMs) {
      this.cachedData.delete(instrument)
      return null
    }

    // Validate cached data before returning
    try {
      const validatedData = validateCachedData(cached.data)
      return {
        data: validatedData,
        age,
        isStale,
      }
    } catch (error) {
      logger.error(`[FallbackManager] Cached data corrupted for ${instrument}:`, error)
      this.cachedData.delete(instrument)
      return null
    }
  }

  /**
   * Recover to Realtime mode
   */
  recoverToRealtime(): void {
    logger.debug('[FallbackManager] Recovering to Realtime mode')

    if (this.mode === 'polling' || this.mode === 'cached') {
      this.stopPolling()
      this.mode = 'realtime'
      this.lastError = null
      this.notifyStatusChange()
    }
  }

  /**
   * Get current mode
   */
  getMode(): FallbackMode {
    return this.mode
  }

  /**
   * Notify all listeners
   */
  private notifyStatusChange(): void {
    const status = this.getStatus()
    this.statusCallbacks.forEach((cb) => cb(status))
  }

  /**
   * Reset fallback state
   */
  reset(): void {
    this.stopPolling()
    this.mode = 'realtime'
    this.cachedData.clear()
    this.lastError = null
  }
}

// Singleton instance
let fallbackManagerInstance: FallbackManager | null = null

export function getFallbackManager(): FallbackManager {
  if (!fallbackManagerInstance) {
    fallbackManagerInstance = new FallbackManager()
  }
  if (!fallbackManagerInstance) {
    throw new Error('Failed to initialize FallbackManager')
  }
  return fallbackManagerInstance
}
