/**
 * Regime detection engine for market analysis
 * Scores instruments based on gap, OHLC, news sentiment, and level break confidence
 */

import { logger } from '@/lib/utils/logger'
import type {
  Instrument,
  Regime,
  RegimeData,
  OvernightOHLC,
  NewsHeadline,
  ScoringBreakdown,
} from '@/types/trading'

interface MarketData {
  instrument: Instrument
  gap_percent: number
  overnight_ohlc: OvernightOHLC
  news_headlines: NewsHeadline[]
  news_sentiment_score: number
  best_level_break_confidence: number | null
  best_break_level: number | null
}

export class RegimeDetector {
  /**
   * Detect regime for all instruments and return comprehensive data
   */
  detectRegimes(marketData: MarketData[]): RegimeData[] {
    logger.debug('[RegimeDetector] Starting regime detection for', marketData.length, 'instruments')

    const regimes: RegimeData[] = marketData.map((data) => {
      const breakdown = this.calculateScores(data)
      const recommendationConfidence = this.calculateFinalScore(breakdown)
      const regime = this.classifyRegime(recommendationConfidence)
      const regimeConfidence = Math.abs(recommendationConfidence - 50) // 0-50 scale

      const dateStr = new Date().toISOString().split('T')[0] || ''

      const regimeData: RegimeData = {
        id: '', // Will be set by database
        instrument: data.instrument,
        date: dateStr,
        gap_percent: data.gap_percent,
        overnight_ohlc: data.overnight_ohlc,
        regime,
        regime_confidence: regimeConfidence,
        news_headlines: data.news_headlines,
        news_sentiment_score: data.news_sentiment_score,
        best_level_break_confidence: data.best_level_break_confidence,
        best_break_level: data.best_break_level,
        recommendation_confidence: recommendationConfidence,
        scoring_breakdown: breakdown,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      logger.debug(
        `[RegimeDetector] ${data.instrument}: confidence=${recommendationConfidence}, regime=${regime}, gap=${data.gap_percent}%`
      )

      return regimeData
    })

    return regimes
  }

  /**
   * Calculate individual scores for each factor
   */
  private calculateScores(data: MarketData): ScoringBreakdown {
    const gapScore = this.calculateGapScore(data.gap_percent)
    const ohlcScore = this.calculateOHLCScore(data.overnight_ohlc)
    const newsScore = this.calculateNewsScore(data.news_sentiment_score)
    const levelScore = this.calculateLevelScore(data.best_level_break_confidence)

    logger.debug(
      `[RegimeDetector] ${data.instrument} scores: gap=${gapScore}, ohlc=${ohlcScore}, news=${newsScore}, level=${levelScore}`
    )

    return {
      gap_score: gapScore,
      ohlc_score: ohlcScore,
      news_score: newsScore,
      level_score: levelScore,
    }
  }

  /**
   * Gap analysis: (-20 to +20 points)
   * Gap direction and size indicate directional strength
   */
  private calculateGapScore(gapPercent: number): number {
    const absGap = Math.abs(gapPercent)

    if (absGap > 2.0) {
      return gapPercent > 0 ? 20 : -20 // Strong directional signal
    } else if (absGap > 1.5) {
      return gapPercent > 0 ? 18 : -18
    } else if (absGap > 1.0) {
      return gapPercent > 0 ? 16 : -16
    } else if (absGap > 0.5) {
      return gapPercent > 0 ? 12 : -12
    } else if (absGap > 0.2) {
      return gapPercent > 0 ? 8 : -8
    } else if (absGap > -0.2) {
      return 0 // Neutral
    } else if (absGap < -0.5) {
      return gapPercent < 0 ? -12 : 12
    } else if (absGap < -1.0) {
      return gapPercent < 0 ? -16 : 16
    } else if (absGap < -1.5) {
      return gapPercent < 0 ? -20 : 20
    }

    return 0
  }

  /**
   * OHLC analysis: (-15 to +15 points)
   * Close > Open indicates bullish, body strength and range matter
   */
  private calculateOHLCScore(ohlc: OvernightOHLC): number {
    let score = 0

    // Body direction and strength
    const bodyStrength = ((ohlc.close - ohlc.open) / ohlc.open) * 100

    if (ohlc.close > ohlc.open) {
      // Bullish
      if (bodyStrength > 1.5) {
        score += 12
      } else if (bodyStrength > 0.5) {
        score += 6
      } else {
        score += 3
      }
    } else if (ohlc.close < ohlc.open) {
      // Bearish
      score -= 6
    } else {
      // Neutral (doji-like)
      score += 1
    }

    // Range indicates volatility (good for day trading)
    const range = ((ohlc.high - ohlc.low) / ohlc.low) * 100
    if (range > 2.0) {
      score += 3 // Good volatility for entry
    }

    return Math.max(-15, Math.min(15, score))
  }

  /**
   * News sentiment analysis: (-10 to +10 points)
   * Sum of headline sentiments, clamped and converted to score
   */
  private calculateNewsScore(newsSentimentScore: number): number {
    // newsSentimentScore is -30 to +30 (sum of individual headline sentiments)
    // Convert to -10 to +10 scale

    if (newsSentimentScore > 15) {
      return 10
    } else if (newsSentimentScore > 5) {
      return 5
    } else if (newsSentimentScore > -5) {
      return 0
    } else if (newsSentimentScore < -15) {
      return -10
    } else {
      return -5
    }
  }

  /**
   * Level break confidence: (0 to +5 points)
   * If we have a recent high-confidence level break, boost score
   */
  private calculateLevelScore(bestLevelBreakConfidence: number | null): number {
    if (bestLevelBreakConfidence === null || bestLevelBreakConfidence === undefined) {
      return 0
    }

    if (bestLevelBreakConfidence >= 85) {
      return 5
    } else if (bestLevelBreakConfidence >= 75) {
      return 3
    } else if (bestLevelBreakConfidence >= 65) {
      return 1
    }

    return 0
  }

  /**
   * Calculate final recommendation confidence (0-100)
   * Base 50 (neutral) + all scores
   */
  private calculateFinalScore(breakdown: ScoringBreakdown): number {
    const base = 50
    const total = base + breakdown.gap_score + breakdown.ohlc_score + breakdown.news_score + breakdown.level_score

    // Clamp to 0-100
    return Math.max(0, Math.min(100, total))
  }

  /**
   * Classify regime based on final score
   * Bullish (>60), Bearish (<40), Choppy (40-60)
   */
  private classifyRegime(score: number): Regime {
    if (score > 60) {
      return 'bullish'
    } else if (score < 40) {
      return 'bearish'
    } else {
      return 'choppy'
    }
  }
}

// Singleton instance
let regimeDetectorInstance: RegimeDetector | null = null

export function getRegimeDetector(): RegimeDetector {
  if (!regimeDetectorInstance) {
    regimeDetectorInstance = new RegimeDetector()
  }
  return regimeDetectorInstance
}
