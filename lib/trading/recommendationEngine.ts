/**
 * Recommendation engine that selects the best market setup
 */

import { logger } from '@/lib/utils/logger'
import type { RegimeData, MarketRecommendation, Instrument } from '@/types/trading'

export class RecommendationEngine {
  /**
   * Select the single best recommendation from all regimes
   */
  selectBestRecommendation(regimes: RegimeData[]): MarketRecommendation | null {
    if (!regimes || regimes.length === 0) {
      logger.warn('[RecommendationEngine] No regimes provided')
      return null
    }

    // Find instrument with highest confidence
    const bestRegime = regimes.reduce((best, current) => {
      return current.recommendation_confidence > best.recommendation_confidence ? current : best
    })

    logger.debug(
      `[RecommendationEngine] Best recommendation: ${bestRegime.instrument} (${bestRegime.recommendation_confidence}%)`
    )

    return this.formatRecommendation(bestRegime, regimes)
  }

  /**
   * Format regime data into human-readable recommendation
   */
  private formatRecommendation(best: RegimeData, allRegimes: RegimeData[]): MarketRecommendation {
    const ready = best.recommendation_confidence >= 65

    // Generate news summary
    const newsSummary = this.generateNewsSummary(best.news_headlines)

    // Build all_regimes array for comparison
    const allRegimesArray = allRegimes.map((r) => ({
      instrument: r.instrument as Instrument,
      regime: r.regime,
      confidence: r.recommendation_confidence,
    }))

    // Generate human-readable message
    const message = this.generateMessage(best, ready)

    return {
      instrument: best.instrument as Instrument,
      regime: best.regime,
      regime_confidence: best.regime_confidence,
      recommendation_confidence: best.recommendation_confidence,
      gap_percent: best.gap_percent,
      overnight_ohlc: best.overnight_ohlc,
      news_summary: newsSummary,
      news_headlines: best.news_headlines,
      best_level_break_confidence: best.best_level_break_confidence,
      ready,
      message,
      all_regimes: allRegimesArray,
    }
  }

  /**
   * Generate news summary from headlines
   */
  private generateNewsSummary(headlines: RegimeData['news_headlines']): string {
    if (!headlines || headlines.length === 0) {
      return 'No significant news'
    }

    // Get top positive and negative headlines
    const topHeadlines = headlines
      .sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment))
      .slice(0, 3)

    if (topHeadlines.length === 0) {
      return 'No significant news'
    }

    return topHeadlines.map((h) => h.headline).join(' | ')
  }

  /**
   * Generate human-readable recommendation message
   */
  private generateMessage(best: RegimeData, ready: boolean): string {
    const parts: string[] = []

    // Regime and confidence
    parts.push(`${best.regime.toUpperCase()} setup (${best.regime_confidence}% regime strength)`)

    // Gap
    const gapDirection = best.gap_percent > 0 ? 'up' : 'down'
    parts.push(`Gap ${gapDirection} ${Math.abs(best.gap_percent).toFixed(2)}%`)

    // Level break confidence if available
    if (best.best_level_break_confidence && best.best_level_break_confidence > 0) {
      parts.push(`Level break confidence ${best.best_level_break_confidence}%`)
    }

    // Ready status
    if (!ready) {
      parts.push(`(Confidence ${best.recommendation_confidence}% - waiting for stronger signal)`)
    }

    return `${best.instrument} showing ${parts.join(', ')}`
  }
}

// Singleton instance
let recommendationEngineInstance: RecommendationEngine | null = null

export function getRecommendationEngine(): RecommendationEngine {
  if (!recommendationEngineInstance) {
    recommendationEngineInstance = new RecommendationEngine()
  }
  return recommendationEngineInstance
}
