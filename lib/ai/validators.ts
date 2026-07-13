/**
 * Validators for edge cases in break detection
 * Handles gaps, blackout periods, timezone conversion, and data validation
 */

import type { BreakEvaluationInput } from './types'

/**
 * Get current market hour in Eastern Time
 * Used for blackout period checks
 */
function getMarketHourET(timestamp: Date): number {
  // Create a formatter for ET timezone
  const etTime = new Date(timestamp.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return etTime.getHours()
}

/**
 * Get current minute in Eastern Time
 */
function getMarketMinuteET(timestamp: Date): number {
  const etTime = new Date(timestamp.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return etTime.getMinutes()
}

/**
 * Check if we're in a blackout period where we should not evaluate breaks
 * Blackout periods:
 * - 9:30-9:35 AM ET (market open chaos)
 * - 3:55-4:00 PM ET (market close chaos)
 */
export function isInBlackoutPeriod(timestamp: Date): boolean {
  const hour = getMarketHourET(timestamp)
  const minute = getMarketMinuteET(timestamp)

  // 9:30-9:35 AM ET (hour = 9, minute 30-59)
  if (hour === 9 && minute >= 30) {
    return true
  }

  // 3:55-4:00 PM ET (hour = 15, minute 55-59, or hour = 16 minute 0)
  if ((hour === 15 && minute >= 55) || (hour === 16 && minute === 0)) {
    return true
  }

  return false
}

/**
 * Check if a gap opened overnight or between sessions
 * Gap is detected if current price is significantly different from previous close
 *
 * Gap detection heuristic:
 * - If no history available, assume no gap (graceful degradation)
 * - If first price in history is far from current, assume gap
 * - Threshold: gap if price moved >2% without intermediate prices
 */
export function detectGap(input: BreakEvaluationInput): boolean {
  // Not enough history to detect gap
  if (!input.recentPriceHistory || input.recentPriceHistory.length === 0) {
    return false // Gracefully assume no gap
  }

  // Get the oldest price in history
  const oldestPoint = input.recentPriceHistory[0]
  if (!oldestPoint) {
    return false
  }

  // Calculate percentage change from oldest to current
  const priceChange = Math.abs(input.currentPrice - oldestPoint.close)
  const percentChange = priceChange / oldestPoint.close

  // If gap is >2% and it happened at the start of our history, likely an overnight gap
  // This is a heuristic - a true gap would require checking previous session close
  const isLikelyGap = percentChange > 0.02 && input.recentPriceHistory.length <= 3

  return isLikelyGap
}

/**
 * Check if price reversed (moved back below level) within the lookback period
 * Used to filter out fake breaks
 *
 * Reversal detection:
 * - If price broke level, but then came back, it's a reversal
 * - Lookback period defined in config (default: 2 minutes = 2 candles at 1min)
 */
export function detectReversal(
  input: BreakEvaluationInput,
  levelPrice: number,
  lookbackMinutes: number
): boolean {
  if (!input.recentPriceHistory || input.recentPriceHistory.length < 2) {
    return false // Not enough history to detect reversal
  }

  // Convert lookback minutes to candle count (assuming 1-minute candles)
  const lookbackCandles = lookbackMinutes

  // Get recent prices within lookback window
  const recentCandles = input.recentPriceHistory.slice(-lookbackCandles)

  // Check if any recent candle closed on the OTHER side of level
  for (const candle of recentCandles) {
    // If price originally broke ABOVE level, reversal is closing BELOW level
    if (input.currentPrice > levelPrice && candle.close < levelPrice) {
      return true // Price reversed back below level
    }

    // If price originally broke BELOW level, reversal is closing ABOVE level
    if (input.currentPrice < levelPrice && candle.close > levelPrice) {
      return true // Price reversed back above level
    }
  }

  return false // No reversal detected
}

/**
 * Validate that input has all required fields
 * Returns error message if invalid, null if valid
 */
export function validateInput(input: BreakEvaluationInput): string | null {
  if (input.currentPrice <= 0) {
    return 'Current price must be positive'
  }

  if (input.levelPrice <= 0) {
    return 'Level price must be positive'
  }

  if (!input.instrument || !['DOW', 'NASDAQ', 'NIKKEI'].includes(input.instrument)) {
    return `Invalid instrument: ${input.instrument}`
  }

  if (!input.timestamp || isNaN(input.timestamp.getTime())) {
    return 'Invalid timestamp'
  }

  if (!Array.isArray(input.recentPriceHistory)) {
    return 'recentPriceHistory must be an array'
  }

  // Volume can be optional, so don't require it
  if (input.currentVolume !== undefined && input.currentVolume < 0) {
    return 'Current volume cannot be negative'
  }

  if (input.averageVolume !== undefined && input.averageVolume < 0) {
    return 'Average volume cannot be negative'
  }

  return null // Input is valid
}

/**
 * Check if volume data is available and usable
 */
export function hasUsableVolumeData(input: BreakEvaluationInput): boolean {
  return (
    input.currentVolume !== undefined &&
    input.currentVolume > 0 &&
    input.averageVolume !== undefined &&
    input.averageVolume > 0
  )
}

/**
 * Check if price actually closed beyond the level
 * (Not just touched on a wick)
 *
 * Confirmation rules:
 * - Must have a closing price
 * - Closing price must be beyond level
 */
export function isCloseBeyondLevel(input: BreakEvaluationInput): boolean {
  if (!input.priceClosedBeyondLevel) {
    return false
  }

  const closePrice = input.closingPrice ?? input.currentPrice

  // Check if close is actually beyond level (not just current price)
  if (input.currentPrice > input.levelPrice) {
    return closePrice > input.levelPrice
  }

  if (input.currentPrice < input.levelPrice) {
    return closePrice < input.levelPrice
  }

  return false // Price is exactly at level (rare)
}

/**
 * Time since market open (in seconds)
 * Used to understand market context
 */
export function getTimeInMarketSeconds(timestamp: Date): number {
  const etTime = new Date(timestamp.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const marketOpen = new Date(etTime)
  marketOpen.setHours(9, 30, 0, 0) // 9:30 AM ET

  const currentMs = etTime.getTime()
  const openMs = marketOpen.getTime()

  if (currentMs < openMs) {
    return -1 // Market not open yet
  }

  return Math.floor((currentMs - openMs) / 1000) // Return seconds
}

/**
 * Check if market is in regular trading hours
 * (Ignoring blackout periods, just checking if it's during market hours)
 */
export function isMarketHours(timestamp: Date): boolean {
  const hour = getMarketHourET(timestamp)

  // Market open: 9:30 AM - 4:00 PM ET
  // Hours 9-15 (3:59 PM) are during market, hour 16+ is after
  return hour >= 9 && hour < 16
}

/**
 * Validate an entire evaluation input and return structured errors/warnings
 */
export interface ValidationResult {
  isValid: boolean
  error: string | null
  warnings: string[]
  degradedCapabilities: string[] // Features that are degraded due to missing data
}

export function validateInputComprehensive(input: BreakEvaluationInput): ValidationResult {
  const warnings: string[] = []
  const degradedCapabilities: string[] = []

  // Critical validation
  const error = validateInput(input)
  if (error) {
    return {
      isValid: false,
      error,
      warnings,
      degradedCapabilities,
    }
  }

  // Warn about missing optional data
  if (!hasUsableVolumeData(input)) {
    warnings.push('No volume data available - volume bonus will not be applied')
    degradedCapabilities.push('volumeBonus')
  }

  if (input.recentPriceHistory.length < 3) {
    warnings.push('Limited price history - reversal detection may be unreliable')
    degradedCapabilities.push('reversalDetection')
  }

  if (!isMarketHours(input.timestamp)) {
    warnings.push('Outside market hours - evaluation may be unreliable')
    degradedCapabilities.push('marketContext')
  }

  return {
    isValid: true,
    error: null,
    warnings,
    degradedCapabilities,
  }
}
