/**
 * Main scoring function for level break detection
 * Orchestrates all rules and edge case validation
 */

import type { BreakEvaluationInput, BreakConfidenceScore, ScoringConfig } from './types'
import { DEFAULT_CONFIG } from './types'
import {
  validateInputComprehensive,
  isInBlackoutPeriod,
  detectGap,
  hasUsableVolumeData,
  getTimeInMarketSeconds,
} from './validators'
import {
  scoreLevelBroken,
  scoreCloseConfirmation,
  scoreVolume,
  scoreNoReversal,
  getEdgeCaseAdjustment,
  calculateTotalScore,
} from './scoringRules'

/**
 * Main entry point: Evaluate if a level break should trigger an alert
 *
 * Algorithm flow:
 * 1. Validate input comprehensively
 * 2. Check edge cases (gap, blackout)
 * 3. If edge case detected, return isBreak: false with full reasoning
 * 4. Score each rule independently
 * 5. Sum points and apply edge case penalties
 * 6. Return confidence score and isBreak boolean
 *
 * @param input - Price, level, and market context
 * @param config - Optional scoring configuration (uses defaults if not provided)
 * @returns Break confidence score with detailed reasoning
 */
export function scoreBreak(
  input: BreakEvaluationInput,
  config: ScoringConfig = DEFAULT_CONFIG
): BreakConfidenceScore {
  // Step 1: Validate input
  const validation = validateInputComprehensive(input)

  if (!validation.isValid) {
    return {
      isBreak: false,
      confidence: 0,
      reasoning: `Invalid input: ${validation.error}`,
      scoreBreakdown: {
        baseLevelBroken: 0,
        closeConfirmation: 0,
        volumeBonus: 0,
        reversalProtection: 0,
        edgeCaseAdjustment: -100,
        factors: {
          gapDetected: false,
          blackoutPeriod: false,
          missingVolume: false,
          missingHistory: false,
          priceReversed: false,
          timeInMarketSeconds: 0,
        },
      },
    }
  }

  // Step 2: Check edge cases
  const gapDetected = detectGap(input)
  const inBlackout = isInBlackoutPeriod(input.timestamp)
  const timeInMarket = getTimeInMarketSeconds(input.timestamp)

  // If gap or blackout, short-circuit the evaluation
  if (gapDetected || inBlackout) {
    const reasonParts: string[] = []

    if (gapDetected) {
      reasonParts.push('Gap detected (possible overnight open)')
    }
    if (inBlackout) {
      reasonParts.push('Blackout period (market open 9:30-9:35 or close 3:55-4:00 ET)')
    }

    return {
      isBreak: false,
      confidence: 0,
      reasoning: `Break skipped: ${reasonParts.join('; ')}`,
      scoreBreakdown: {
        baseLevelBroken: 0,
        closeConfirmation: 0,
        volumeBonus: 0,
        reversalProtection: 0,
        edgeCaseAdjustment: -100,
        factors: {
          gapDetected,
          blackoutPeriod: inBlackout,
          missingVolume: !hasUsableVolumeData(input),
          missingHistory: !input.recentPriceHistory || input.recentPriceHistory.length < 3,
          priceReversed: false,
          timeInMarketSeconds: timeInMarket,
        },
      },
    }
  }

  // Step 3: Score each rule
  const levelBrokenScore = scoreLevelBroken(input, config)
  const closeConfirmScore = scoreCloseConfirmation(input, config)
  const volumeScore = scoreVolume(input, config)
  const noReversalScore = scoreNoReversal(input, config)
  const edgeCaseAdj = getEdgeCaseAdjustment(gapDetected, inBlackout, config)

  // Step 4: Calculate total score
  const totalScore = calculateTotalScore(
    levelBrokenScore,
    closeConfirmScore,
    volumeScore,
    noReversalScore,
    edgeCaseAdj
  )

  // Step 5: Determine if this qualifies as a break alert
  const isBreak = totalScore >= config.confidenceThreshold

  // Step 6: Build detailed reasoning
  const reasoningParts: string[] = []

  if (levelBrokenScore > 0) {
    reasoningParts.push(`Level broken (+${levelBrokenScore})`)
  } else {
    reasoningParts.push('Price not closed beyond level')
  }

  if (closeConfirmScore > 0) {
    reasoningParts.push(`Close confirmed (+${closeConfirmScore})`)
  } else if (closeConfirmScore < 0) {
    reasoningParts.push(`Reversal detected (${closeConfirmScore})`)
  }

  if (volumeScore > 0) {
    reasoningParts.push(`High volume (+${volumeScore})`)
  } else if (!hasUsableVolumeData(input)) {
    reasoningParts.push('Volume data unavailable (skipped)')
  }

  if (noReversalScore > 0) {
    reasoningParts.push(`No reversal in ${config.reversalLookbackMinutes}min (+${noReversalScore})`)
  } else if (noReversalScore < 0) {
    reasoningParts.push(`Reversal detected within ${config.reversalLookbackMinutes}min`)
  }

  const reasoning = `${isBreak ? '✓' : '✗'} Confidence: ${totalScore}% — ${reasoningParts.join(' | ')}`

  // Step 7: Determine if price reversed
  const hasReversed = closeConfirmScore < 0 || noReversalScore < 0

  // Return complete break confidence score
  return {
    isBreak,
    confidence: totalScore,
    reasoning,
    scoreBreakdown: {
      baseLevelBroken: levelBrokenScore,
      closeConfirmation: closeConfirmScore,
      volumeBonus: volumeScore,
      reversalProtection: noReversalScore,
      edgeCaseAdjustment: edgeCaseAdj,
      factors: {
        gapDetected,
        blackoutPeriod: inBlackout,
        missingVolume: !hasUsableVolumeData(input),
        missingHistory: !input.recentPriceHistory || input.recentPriceHistory.length < 3,
        priceReversed: hasReversed,
        timeInMarketSeconds: timeInMarket,
      },
    },
  }
}

/**
 * Batch evaluate multiple level breaks
 * Useful for checking all levels at once
 */
export function scoreMultipleBreaks(
  inputs: BreakEvaluationInput[],
  config?: ScoringConfig
): BreakConfidenceScore[] {
  return inputs.map((input) => scoreBreak(input, config))
}

/**
 * Filter breaks that qualify for alerting
 * Returns only breaks above the confidence threshold
 */
export function filterQualifyingBreaks(
  scores: BreakConfidenceScore[]
): BreakConfidenceScore[] {
  return scores.filter((score) => score.isBreak && score.confidence >= 65)
}
