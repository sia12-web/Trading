/**
 * Individual scoring rules for break detection
 * Each rule contributes points toward the final confidence score
 */

import type { BreakEvaluationInput, ScoringConfig } from './types'
import { isCloseBeyondLevel, detectReversal, hasUsableVolumeData } from './validators'

/**
 * RULE 1: Level Broken
 * Base scoring rule: Did price actually close beyond the level?
 *
 * Returns:
 * - +40 if price closed beyond level
 * - 0 if price hasn't closed beyond level
 *
 * This is the primary signal. Without this, there's no break.
 */
export function scoreLevelBroken(input: BreakEvaluationInput, config: ScoringConfig): number {
  if (isCloseBeyondLevel(input)) {
    return config.levelBrokenPoints
  }
  return 0
}

/**
 * RULE 2: Close Confirmation
 * Verify the break is confirmed by a clean close, not just a wick
 *
 * Returns:
 * - +30 if price closed beyond level (not just touched)
 * - 0 if only touched on wick
 * - -20 if price quickly reversed after breaking (fake break)
 *
 * Rationale:
 * - A confirmed close is more reliable than just touching on a wick
 * - If price reverses quickly (within 2 minutes), it's likely a fake break
 */
export function scoreCloseConfirmation(
  input: BreakEvaluationInput,
  config: ScoringConfig
): number {
  // Must have closed beyond level
  if (!isCloseBeyondLevel(input)) {
    return 0
  }

  // Check for reversal - if price came back, it's a fake break
  const hasReversal = detectReversal(input, input.levelPrice, config.reversalLookbackMinutes)

  if (hasReversal) {
    return config.reversalPenalty // e.g., -20
  }

  // No reversal, close is confirmed
  return config.closeConfirmationPoints // e.g., +30
}

/**
 * RULE 3: Volume Above Average
 * Higher volume on the break increases confidence
 *
 * Returns:
 * - +15 if current volume > average volume * multiplier (e.g., 1.2x)
 * - 0 if volume is not available or below threshold
 *
 * Rationale:
 * - Breaks on high volume are more likely to sustain
 * - If volume is missing, we gracefully skip this bonus (no penalty)
 */
export function scoreVolume(input: BreakEvaluationInput, config: ScoringConfig): number {
  // Can't score volume if we don't have the data
  if (!hasUsableVolumeData(input)) {
    return 0 // Graceful degradation - no penalty, just no bonus
  }

  const { currentVolume, averageVolume } = input

  // Check if current volume exceeds average by multiplier
  if (currentVolume! > averageVolume! * config.volumeMultiplier) {
    return config.volumeAboveAveragePoints // e.g., +15
  }

  return 0
}

/**
 * RULE 4: No Reversal in Lookback Period
 * If price hasn't reversed within the lookback period, the break is holding
 *
 * Returns:
 * - +15 if price has not reversed within lookback period
 * - 0 if insufficient history to check
 * - -20 if price has reversed
 *
 * Rationale:
 * - A break that holds is more likely to continue
 * - Reversals indicate weak breaks (already scored in rule 2)
 */
export function scoreNoReversal(
  input: BreakEvaluationInput,
  config: ScoringConfig
): number {
  // Not enough history to reliably check reversals
  if (!input.recentPriceHistory || input.recentPriceHistory.length < 3) {
    return 0 // Graceful degradation
  }

  const hasReversal = detectReversal(input, input.levelPrice, config.reversalLookbackMinutes)

  if (hasReversal) {
    return config.reversalPenalty // e.g., -20 (penalize reversals)
  }

  return config.noReversalPoints // e.g., +15
}

/**
 * Helper: Apply edge case penalties
 *
 * Edge cases that should disqualify or heavily penalize a break:
 * - Overnight gap: Exclude (price jumped without hitting intermediate levels)
 * - Blackout period: Exclude (market open/close chaos)
 * - Missing critical data: Gracefully degrade (skip bonus rules only)
 *
 * Returns:
 * - -100 (or worse) if major edge case detected (gap, blackout)
 * - 0 if no edge cases
 * - Partial penalty if data is degraded
 */
export function getEdgeCaseAdjustment(
  detectedGap: boolean,
  inBlackout: boolean,
  _config: ScoringConfig
): number {
  // Gap overnight: Skip the entire evaluation
  if (detectedGap) {
    return -100 // Disqualify
  }

  // Blackout period (9:30-9:35 AM, 3:55-4:00 PM ET): Skip
  if (inBlackout) {
    return -100 // Disqualify
  }

  // No edge cases
  return 0
}

/**
 * Calculate total score from all rules
 * Returns the final confidence percentage (0-100, capped)
 *
 * Scoring algorithm:
 * 1. Apply each rule independently
 * 2. Sum all points
 * 3. Apply edge case penalties
 * 4. Cap at 100%
 * 5. Return final score
 */
export function calculateTotalScore(
  levelBroken: number,
  closeConfirm: number,
  volume: number,
  noReversal: number,
  edgeCaseAdj: number
): number {
  // Sum all component scores
  const totalScore = levelBroken + closeConfirm + volume + noReversal + edgeCaseAdj

  // Cap at 0-100 range
  const finalScore = Math.max(0, Math.min(100, totalScore))

  return finalScore
}
