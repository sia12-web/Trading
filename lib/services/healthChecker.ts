/**
 * Health Checker
 * Periodic health monitoring to detect stale data and connection issues
 */

import type { Instrument } from '@/types/price-feed'
import { validateHealthCheckResponse } from '@/lib/utils/validation'
import { logger } from '@/lib/utils/logger'

export interface HealthCheckResult {
  instrument: Instrument
  healthy: boolean
  dataAge: number
  isStale: boolean
  lastError: Error | null
}

interface HealthCheckConfig {
  intervalMs: number
  staleThresholdMs: number
  timeoutMs: number
  maxConsecutiveFailures: number
}

const DEFAULT_CONFIG: HealthCheckConfig = {
  intervalMs: 30000, // 30 seconds
  staleThresholdMs: 60000, // 1 minute
  timeoutMs: 5000, // 5 seconds
  maxConsecutiveFailures: 3,
}

export class HealthChecker {
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private lastHealthyTime: Map<Instrument, Date> = new Map()
  private failureCount: Map<Instrument, number> = new Map()
  private lastDataAge: Map<Instrument, number> = new Map()
  private healthCheckCallbacks: Set<(result: HealthCheckResult) => void> = new Set()
  private failureCallbacks: Set<(instrument: Instrument) => void> = new Set()
  private config: HealthCheckConfig = DEFAULT_CONFIG

  /**
   * Register callback for health check results
   */
  onHealthCheck(callback: (result: HealthCheckResult) => void): () => void {
    this.healthCheckCallbacks.add(callback)
    return () => this.healthCheckCallbacks.delete(callback)
  }

  /**
   * Register callback for health check failures
   */
  onFailure(callback: (instrument: Instrument) => void): () => void {
    this.failureCallbacks.add(callback)
    return () => this.failureCallbacks.delete(callback)
  }

  /**
   * Start periodic health checks
   */
  start(): void {
    if (this.checkInterval) return

    logger.debug('[HealthChecker] Starting health checks every', this.config.intervalMs, 'ms')

    // Delay first check by one full interval to give Realtime time to establish.
    // Running immediately on mount would always flag data as stale on first load.
    this.checkInterval = setInterval(() => this.runChecks(), this.config.intervalMs)
  }

  /**
   * Run health checks for all instruments
   */
  private async runChecks(): Promise<void> {
    const instruments: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']

    for (const instrument of instruments) {
      await this.checkInstrument(instrument)
    }
  }

  /**
   * Check health for a specific instrument
   */
  private async checkInstrument(instrument: Instrument): Promise<void> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)

      const res = await fetch(`/api/levels/status?instruments=${instrument}`, {
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const rawData = await res.json()

      // Validate response structure
      const data = validateHealthCheckResponse(rawData)

      if (!data.data || data.data.length === 0) {
        throw new Error('No data in response')
      }

      const instrumentData = data.data[0]!
      const timestamp = new Date(instrumentData.timestamp)
      if (isNaN(timestamp.getTime())) {
        throw new Error('Invalid timestamp format')
      }

      const dataAge = Date.now() - timestamp.getTime()
      const isStale = dataAge > this.config.staleThresholdMs

      this.lastDataAge.set(instrument, dataAge)

      if (isStale) {
        logger.warn(
          `[HealthChecker] Stale data for ${instrument}: ${Math.round(dataAge / 1000)}s old`
        )
        this.recordFailure(instrument)
      } else {
        this.recordSuccess(instrument)
      }

      this.notifyHealthCheck({
        instrument,
        healthy: !isStale,
        dataAge,
        isStale,
        lastError: null,
      })
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error(`[HealthChecker] Health check failed for ${instrument}:`, err.message)

      this.recordFailure(instrument)

      this.notifyHealthCheck({
        instrument,
        healthy: false,
        dataAge: this.lastDataAge.get(instrument) || 0,
        isStale: true,
        lastError: err,
      })
    }
  }

  /**
   * Record successful health check
   */
  private recordSuccess(instrument: Instrument): void {
    this.lastHealthyTime.set(instrument, new Date())
    this.failureCount.set(instrument, 0)
  }

  /**
   * Record failed health check
   */
  private recordFailure(instrument: Instrument): void {
    const failures = (this.failureCount.get(instrument) || 0) + 1
    this.failureCount.set(instrument, failures)

    if (failures >= this.config.maxConsecutiveFailures) {
      logger.error(
        `[HealthChecker] Too many failures for ${instrument} (${failures}/${this.config.maxConsecutiveFailures})`
      )
      this.failureCallbacks.forEach((cb) => cb(instrument))
    }
  }

  /**
   * Get last known data age for an instrument
   */
  getDataAge(instrument: Instrument): number {
    return this.lastDataAge.get(instrument) || 0
  }

  /**
   * Stop health checks
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
      logger.debug('[HealthChecker] Health checks stopped')
    }
  }

  /**
   * Notify health check listeners
   */
  private notifyHealthCheck(result: HealthCheckResult): void {
    this.healthCheckCallbacks.forEach((cb) => cb(result))
  }

  /**
   * Reset health state
   */
  reset(): void {
    this.stop()
    this.lastHealthyTime.clear()
    this.failureCount.clear()
    this.lastDataAge.clear()
  }
}

// Singleton instance
let healthCheckerInstance: HealthChecker | null = null

export function getHealthChecker(): HealthChecker {
  if (!healthCheckerInstance) {
    healthCheckerInstance = new HealthChecker()
  }
  return healthCheckerInstance
}
