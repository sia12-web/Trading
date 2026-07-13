/**
 * Type definitions for AI Level Break Scoring Engine
 * Defines all interfaces used in the scoring algorithm
 */

import type { Instrument } from '@/types/price-feed'

/**
 * A single price point from recent history
 * Used to detect reversals and confirm closes
 */
export interface PricePoint {
  time: Date
  close: number
  volume?: number // Optional: volume for that candle
}

/**
 * Input data for evaluating a potential level break
 * Contains all information needed to calculate break confidence
 */
export interface BreakEvaluationInput {
  // Current market state
  currentPrice: number // Current price (either tick or candle close)
  levelPrice: number // Support/resistance level price
  instrument: Instrument // DOW, NASDAQ, NIKKEI
  timestamp: Date // Current time (used for blackout/timezone checks)

  // Volume data (optional, gracefully degraded if missing)
  currentVolume?: number
  averageVolume?: number // Average volume over lookback period

  // Price history (required for reversals and gap detection)
  recentPriceHistory: PricePoint[] // Last 10-20 candles for analysis

  // Context
  priceClosedBeyondLevel: boolean // Did price CLOSE beyond level or just touch on wick?
  closingPrice?: number // Final price if different from currentPrice
}

/**
 * Output of break evaluation
 * Returns confidence score and reasoning
 */
export interface BreakConfidenceScore {
  isBreak: boolean // True if this qualifies as a break alert
  confidence: number // 0-100 confidence score
  reasoning: string // Human-readable explanation of the score
  scoreBreakdown: ScoreBreakdown // Details of how score was calculated
}

/**
 * Detailed breakdown of how the score was calculated
 * Useful for debugging and understanding the algorithm
 */
export interface ScoreBreakdown {
  baseLevelBroken: number // +40 if price closed beyond level
  closeConfirmation: number // +30 if confirmed by close (not just wick)
  volumeBonus: number // +15 if volume above average
  reversalProtection: number // +15 if no reversal in 2 min, -20 if reversal
  edgeCaseAdjustment: number // -100 if gap, blackout, or other edge case
  factors: {
    gapDetected: boolean
    blackoutPeriod: boolean
    missingVolume: boolean
    missingHistory: boolean
    priceReversed: boolean
    timeInMarketSeconds: number
  }
}

/**
 * Configuration for scoring rules
 * Can be tuned for backtesting
 */
export interface ScoringConfig {
  // Point values
  levelBrokenPoints: number // Default: 40
  closeConfirmationPoints: number // Default: 30
  volumeAboveAveragePoints: number // Default: 15
  noReversalPoints: number // Default: 15

  // Thresholds
  confidenceThreshold: number // Minimum confidence to fire alert (Default: 65)
  reversalLookbackMinutes: number // How far back to check for reversals (Default: 2)
  volumeMultiplier: number // Volume must be > average * this (Default: 1.2x)

  // Penalties
  gapPenalty: number // Penalty for gap detection (Default: -100)
  blackoutPenalty: number // Penalty for blackout period (Default: -100)
  reversalPenalty: number // Penalty if price reversed (Default: -20)
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: ScoringConfig = {
  levelBrokenPoints: 40,
  closeConfirmationPoints: 30,
  volumeAboveAveragePoints: 15,
  noReversalPoints: 15,
  confidenceThreshold: 65,
  reversalLookbackMinutes: 2,
  volumeMultiplier: 1.2,
  gapPenalty: -100,
  blackoutPenalty: -100,
  reversalPenalty: -20,
}

// ============================================
// DETECTOR SERVICE TYPES (Slice 2)
// ============================================

/**
 * Level definition with metadata
 * Source: Supabase levels table or pre-loaded configuration
 */
export interface LevelDefinition {
  level: number
  instrument: Instrument
  type: 'support' | 'resistance'
  status: 'unvisited' | 'approached' | 'touched' | 'broken' | 'bounced'
  createdAt: Date
  lastTouched?: Date
  breakCount: number
  bounceCount: number
}

/**
 * Price data point stored in detector buffer
 */
export interface PriceDataPoint {
  price: number
  volume?: number
  timestamp: Date
  bid?: number
  ask?: number
}

/**
 * Break event emitted when confident level break detected
 */
export interface BreakEvent {
  id: string
  instrument: Instrument
  level: number
  direction: 'up' | 'down'
  confidence: number
  entryPrice: number
  breakPrice: number
  volume?: number
  timestamp: Date
  reasoning: string
  scoreBreakdown: ScoreBreakdown
}

/**
 * Circuit breaker state per instrument
 * Prevents alert spam: Max 10 alerts per hour
 */
export interface CircuitBreakerStateData {
  instrument: Instrument
  alertTimestamps: Date[]
  alertCount: number
  lastReset: Date
  isTripped: boolean
  nextResetAt: Date
}

/**
 * Circular buffer for storing recent prices per level
 */
export interface PriceHistoryBufferData {
  level: number
  instrument: Instrument
  prices: PriceDataPoint[]
  maxSize: number
  lastUpdate: Date
  isInitialized: boolean
}

/**
 * Detector configuration
 */
export interface DetectorConfig {
  maxAlertsPerHour: number
  alertWindowMs: number
  maxPricesPerLevel: number
  trimThreshold: number
  reconnectMaxRetries: number
  reconnectInitialDelayMs: number
  reconnectMaxDelayMs: number
  scoringConfig: ScoringConfig
  debug: boolean
}

/**
 * Default detector configuration
 */
export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  maxAlertsPerHour: 10,
  alertWindowMs: 3600000, // 1 hour
  maxPricesPerLevel: 200,
  trimThreshold: 0.9, // Trim when 90% full
  reconnectMaxRetries: 5,
  reconnectInitialDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  scoringConfig: DEFAULT_CONFIG,
  debug: false,
}

/**
 * Event subscription callback types
 */
export type BreakEventCallback = (event: BreakEvent) => void
export type CircuitBreakerCallback = (state: CircuitBreakerStateData) => void
export type ErrorCallback = (instrument: Instrument, error: Error) => void

/**
 * Detector service interface
 */
export interface ILevelBreakDetector {
  initialize(levels: LevelDefinition[]): Promise<void>
  destroy(): Promise<void>
  updateLevels(levels: LevelDefinition[]): void
  onPriceUpdate(
    instrument: Instrument,
    price: number,
    volume?: number,
    timestamp?: Date
  ): Promise<void>
  onBreakDetected(callback: BreakEventCallback): () => void
  onCircuitBreakerTriggered(callback: CircuitBreakerCallback): () => void
  onError(callback: ErrorCallback): () => void
  getCircuitBreakerState(instrument: Instrument): CircuitBreakerStateData | null
  getPriceHistory(instrument: Instrument, level: number): PriceDataPoint[]
  getLevels(): LevelDefinition[]
}
