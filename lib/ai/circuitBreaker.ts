/**
 * Circuit Breaker for level break alerts
 * Enforces maximum alerts per hour to prevent alert spam
 */

import type { Instrument } from '@/types/price-feed'
import type { CircuitBreakerStateData } from './types'

/**
 * Circuit breaker implementation
 * Tracks alert count in a rolling 1-hour window
 * Max 10 alerts per hour per instrument
 */
export class CircuitBreaker {
  private alertTimestamps: Date[] = []
  private instrument: Instrument
  private maxAlerts: number
  private windowMs: number

  constructor(instrument: Instrument, maxAlerts: number = 10, windowMs: number = 3600000) {
    this.instrument = instrument
    this.maxAlerts = maxAlerts
    this.windowMs = windowMs
  }

  /**
   * Record an alert attempt
   * Returns true if alert is allowed, false if circuit breaker is tripped
   */
  recordAlert(timestamp: Date): boolean {
    this.cleanOldAlerts(timestamp)

    // Check if at limit
    if (this.alertTimestamps.length >= this.maxAlerts) {
      return false // Circuit breaker tripped
    }

    // Record this alert
    this.alertTimestamps.push(timestamp)
    return true
  }

  /**
   * Check if circuit breaker is currently tripped
   */
  isTripped(): boolean {
    this.cleanOldAlerts(new Date())
    return this.alertTimestamps.length >= this.maxAlerts
  }

  /**
   * Get the state of the circuit breaker
   */
  getState(): CircuitBreakerStateData {
    this.cleanOldAlerts(new Date())

    const nextResetAt =
      this.alertTimestamps.length > 0
        ? new Date(this.alertTimestamps[0]!.getTime() + this.windowMs)
        : new Date()

    return {
      instrument: this.instrument,
      alertTimestamps: [...this.alertTimestamps],
      alertCount: this.alertTimestamps.length,
      lastReset: new Date(),
      isTripped: this.alertTimestamps.length >= this.maxAlerts,
      nextResetAt,
    }
  }

  /**
   * Get the next time an alert can be sent
   */
  getNextResetTime(): Date {
    if (this.alertTimestamps.length === 0) {
      return new Date()
    }

    return new Date(this.alertTimestamps[0]!.getTime() + this.windowMs)
  }

  /**
   * Reset the circuit breaker (clear all alerts)
   */
  reset(): void {
    this.alertTimestamps = []
  }

  /**
   * Remove alerts older than the window
   */
  private cleanOldAlerts(now: Date): void {
    const cutoffTime = now.getTime() - this.windowMs

    // Keep only alerts within the window
    this.alertTimestamps = this.alertTimestamps.filter((ts) => ts.getTime() > cutoffTime)
  }

  /**
   * Get current alert count
   */
  getAlertCount(): number {
    this.cleanOldAlerts(new Date())
    return this.alertTimestamps.length
  }
}
