/**
 * Real-Time Level Break Detector Service
 * Monitors price streams and evaluates level breaks in real-time
 * Emits events for downstream consumers
 */

import type { Instrument } from '@/types/price-feed'
import type {
  LevelDefinition,
  BreakEvent,
  BreakEventCallback,
  CircuitBreakerCallback,
  ErrorCallback,
  DetectorConfig,
  CircuitBreakerStateData,
  PriceDataPoint,
  ILevelBreakDetector,
} from './types'
import { DEFAULT_DETECTOR_CONFIG } from './types'
import { scoreBreak } from './scoreBreak'
import type { BreakEvaluationInput } from './types'
import { CircuitBreaker } from './circuitBreaker'
import { PriceHistoryBuffer } from './priceBuffer'
import { logger } from '@/lib/utils/logger'

/**
 * Generate a simple UUID v4-like string
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Real-time level break detector
 *
 * Responsibilities:
 * 1. Subscribe to Supabase Realtime price updates
 * 2. Maintain price history buffers per level
 * 3. Evaluate breaks using scoreBreak() from Slice 1
 * 4. Enforce circuit breaker (10 alerts/hour max)
 * 5. Emit events for downstream consumers
 * 6. Handle errors and cleanup gracefully
 */
export class LevelBreakDetector implements ILevelBreakDetector {
  private levels: Map<string, LevelDefinition> = new Map() // Key: "DOW:35100.50"
  private priceBuffers: Map<string, PriceHistoryBuffer> = new Map()
  private circuitBreakers: Map<Instrument, CircuitBreaker> = new Map()
  private lastPrices: Map<Instrument, PriceDataPoint> = new Map()

  private config: DetectorConfig

  // Event listeners
  private breakEventListeners: Set<BreakEventCallback> = new Set()
  private circuitBreakerListeners: Set<CircuitBreakerCallback> = new Set()
  private errorListeners: Set<ErrorCallback> = new Set()

  constructor(config: Partial<DetectorConfig> = {}) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config }
  }

  /**
   * Initialize detector with level definitions
   * Sets up price buffers and circuit breakers
   */
  async initialize(levels: LevelDefinition[]): Promise<void> {
    // Store levels with unique keys
    for (const level of levels) {
      const key = this.getLevelKey(level.instrument, level.level)
      this.levels.set(key, level)

      // Create price buffer for this level
      const buffer = new PriceHistoryBuffer(
        level.level,
        level.instrument,
        this.config.maxPricesPerLevel
      )
      this.priceBuffers.set(key, buffer)
    }

    // Initialize circuit breakers for each instrument
    const instruments: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']
    for (const instrument of instruments) {
      this.circuitBreakers.set(
        instrument,
        new CircuitBreaker(instrument, this.config.maxAlertsPerHour, this.config.alertWindowMs)
      )
    }

    if (this.config.debug) {
      logger.debug(`[Detector] Initialized with ${levels.length} levels`)
    }
  }

  /**
   * Update level definitions
   * Useful for syncing level changes from database
   */
  updateLevels(levels: LevelDefinition[]): void {
    for (const level of levels) {
      const key = this.getLevelKey(level.instrument, level.level)
      this.levels.set(key, level)
    }

    if (this.config.debug) {
      logger.debug(`[Detector] Updated ${levels.length} levels`)
    }
  }

  /**
   * Handle incoming price update from Realtime
   * Evaluates all levels for this instrument
   */
  async onPriceUpdate(
    instrument: Instrument,
    price: number,
    volume?: number,
    timestamp?: Date
  ): Promise<void> {
    const now = timestamp ?? new Date()

    // Validate price
    if (price <= 0 || isNaN(price)) {
      this.emitError(instrument, new Error(`Invalid price: ${price}`))
      return
    }

    // Store current price
    const priceDataPoint: PriceDataPoint = { price, volume, timestamp: now }
    this.lastPrices.set(instrument, priceDataPoint)

    // Get all levels for this instrument
    const levelsForInstrument = Array.from(this.levels.values()).filter(
      (l) => l.instrument === instrument
    )

    // Evaluate each level for breaks
    for (const level of levelsForInstrument) {
      try {
        const breakEvent = await this.evaluateBreak(level, price, volume, now)

        if (breakEvent) {
          // Check circuit breaker
          const cb = this.circuitBreakers.get(instrument)
          if (cb && cb.recordAlert(now)) {
            this.emitBreakEvent(breakEvent)
          } else if (cb) {
            // Circuit breaker tripped
            this.emitCircuitBreakerEvent(cb.getState())
          }
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        this.emitError(instrument, err)
      }
    }
  }

  /**
   * Register callback for break detected events
   * Returns unsubscribe function
   */
  onBreakDetected(callback: BreakEventCallback): () => void {
    this.breakEventListeners.add(callback)
    return () => {
      this.breakEventListeners.delete(callback)
    }
  }

  /**
   * Register callback for circuit breaker triggered events
   * Returns unsubscribe function
   */
  onCircuitBreakerTriggered(callback: CircuitBreakerCallback): () => void {
    this.circuitBreakerListeners.add(callback)
    return () => {
      this.circuitBreakerListeners.delete(callback)
    }
  }

  /**
   * Register callback for errors
   * Returns unsubscribe function
   */
  onError(callback: ErrorCallback): () => void {
    this.errorListeners.add(callback)
    return () => {
      this.errorListeners.delete(callback)
    }
  }

  /**
   * Get circuit breaker state for an instrument
   */
  getCircuitBreakerState(instrument: Instrument): CircuitBreakerStateData | null {
    const cb = this.circuitBreakers.get(instrument)
    return cb ? cb.getState() : null
  }

  /**
   * Get price history for a specific level
   */
  getPriceHistory(instrument: Instrument, level: number): PriceDataPoint[] {
    const key = this.getLevelKey(instrument, level)
    const buffer = this.priceBuffers.get(key)
    return buffer ? buffer.getPrices() : []
  }

  /**
   * Get all levels
   */
  getLevels(): LevelDefinition[] {
    return Array.from(this.levels.values())
  }

  /**
   * Cleanup and shutdown
   */
  async destroy(): Promise<void> {
    this.breakEventListeners.clear()
    this.circuitBreakerListeners.clear()
    this.errorListeners.clear()
    this.levels.clear()
    this.priceBuffers.clear()
    this.circuitBreakers.clear()
    this.lastPrices.clear()

    if (this.config.debug) {
      console.debug('[Detector] Destroyed')
    }
  }

  /**
   * Evaluate a potential break at a single level
   * Returns BreakEvent if break detected, null otherwise
   */
  private async evaluateBreak(
    level: LevelDefinition,
    currentPrice: number,
    volume: number | undefined,
    timestamp: Date
  ): Promise<BreakEvent | null> {
    const key = this.getLevelKey(level.instrument, level.level)
    const buffer = this.priceBuffers.get(key)

    if (!buffer) {
      return null
    }

    // Add current price to buffer
    buffer.addPrice(currentPrice, volume, timestamp)

    // Get price history
    const priceHistory = buffer.getPrices()

    // Need at least some history to evaluate
    if (priceHistory.length < 2) {
      return null
    }

    // Get previous price to detect break direction
    const previousPrice = priceHistory[priceHistory.length - 2]!.price

    // Check for break condition
    let direction: 'up' | 'down' | null = null
    let priceClosedBeyond = false

    if (previousPrice <= level.level && currentPrice > level.level) {
      direction = 'up'
      priceClosedBeyond = true
    } else if (previousPrice >= level.level && currentPrice < level.level) {
      direction = 'down'
      priceClosedBeyond = true
    }

    // No break detected
    if (!direction || !priceClosedBeyond) {
      return null
    }

    // Build evaluation input for scoring
    const evaluationInput: BreakEvaluationInput = {
      currentPrice,
      levelPrice: level.level,
      instrument: level.instrument,
      timestamp,
      currentVolume: volume,
      averageVolume: this.calculateAverageVolume(priceHistory),
      recentPriceHistory: priceHistory.map((p) => ({
        time: p.timestamp,
        close: p.price,
        volume: p.volume,
      })),
      priceClosedBeyondLevel: priceClosedBeyond,
      closingPrice: currentPrice,
    }

    // Score the break
    const score = scoreBreak(evaluationInput, this.config.scoringConfig)

    // Check if confidence meets threshold
    if (!score.isBreak || score.confidence < this.config.scoringConfig.confidenceThreshold) {
      return null
    }

    // Create break event
    const breakEvent: BreakEvent = {
      id: generateId(),
      instrument: level.instrument,
      level: level.level,
      direction,
      confidence: score.confidence,
      entryPrice: previousPrice,
      breakPrice: currentPrice,
      volume,
      timestamp,
      reasoning: score.reasoning,
      scoreBreakdown: score.scoreBreakdown,
    }

    return breakEvent
  }

  /**
   * Calculate average volume from price history
   */
  private calculateAverageVolume(prices: PriceDataPoint[]): number | undefined {
    const withVolume = prices.filter((p) => p.volume !== undefined && p.volume! > 0)

    if (withVolume.length === 0) {
      return undefined
    }

    const sum = withVolume.reduce((acc, p) => acc + (p.volume ?? 0), 0)
    return sum / withVolume.length
  }

  /**
   * Emit break detected event to all listeners
   */
  private emitBreakEvent(event: BreakEvent): void {
    try {
      this.breakEventListeners.forEach((callback) => {
        try {
          callback(event)
        } catch (error) {
          console.error('[Detector] Error in break event callback:', error)
        }
      })
    } catch (error) {
      console.error('[Detector] Error emitting break event:', error)
    }
  }

  /**
   * Emit circuit breaker triggered event
   */
  private emitCircuitBreakerEvent(state: CircuitBreakerStateData): void {
    try {
      this.circuitBreakerListeners.forEach((callback) => {
        try {
          callback(state)
        } catch (error) {
          console.error('[Detector] Error in circuit breaker callback:', error)
        }
      })
    } catch (error) {
      console.error('[Detector] Error emitting circuit breaker event:', error)
    }
  }

  /**
   * Emit error event
   */
  private emitError(instrument: Instrument, error: Error): void {
    try {
      this.errorListeners.forEach((callback) => {
        try {
          callback(instrument, error)
        } catch (callbackError) {
          console.error('[Detector] Error in error callback:', callbackError)
        }
      })
    } catch (error) {
      console.error('[Detector] Error emitting error event:', error)
    }
  }

  /**
   * Create a unique key for level storage
   */
  private getLevelKey(instrument: Instrument, level: number): string {
    return `${instrument}:${level}`
  }
}
