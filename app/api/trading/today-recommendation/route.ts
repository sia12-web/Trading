/**
 * GET /api/trading/today-recommendation
 * Fetch today's market recommendation for dashboard display
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getESTDateString } from '@/lib/utils/timeUtils'
import type { MarketRecommendationResponse, Instrument } from '@/types/trading'

export async function GET(_request: NextRequest): Promise<NextResponse<MarketRecommendationResponse>> {
  try {
    const supabase = await createClient()

    const today = getESTDateString()

    logger.debug('[Recommendation] Fetching today recommendation for', today)

    // Fetch all regimes for today
    const { data: regimes, error: regimesError } = await supabase
      .from('regime_cache')
      .select('*')
      .eq('date', today)

    if (regimesError) {
      logger.error('[Recommendation] Error fetching regimes:', regimesError)
      // Table missing or schema cache lag — soft-fail so chart desk stays usable
      const missing = regimesError.code === 'PGRST205'
      return NextResponse.json(
        {
          recommendation: null,
          processed_at: null,
          market_disabled_instruments: [],
          locked_instrument: null,
          message: missing
            ? 'Waiting for market open analysis (regime tables not ready)'
            : 'Error fetching recommendation',
          ready: false,
        },
        { status: missing ? 200 : 500 }
      )
    }

    // If no regimes for today, recommendation not ready yet
    if (!regimes || regimes.length === 0) {
      logger.debug('[Recommendation] No recommendation available yet')
      return NextResponse.json(
        {
          recommendation: null,
          processed_at: null,
          market_disabled_instruments: [],
          locked_instrument: null,
          message: 'Waiting for market open analysis (runs at 9:20 AM EST)',
          ready: false,
        },
        { status: 200 }
      )
    }

    // Find best recommendation (highest confidence)
    const bestRegime = regimes.reduce((best: any, current: any) => {
      return current.recommendation_confidence > best.recommendation_confidence ? current : best
    })

    // Convert database format to MarketRecommendation
    const recommendation = {
      instrument: bestRegime.instrument as Instrument,
      regime: bestRegime.regime,
      regime_confidence: bestRegime.regime_confidence,
      recommendation_confidence: bestRegime.recommendation_confidence,
      gap_percent: bestRegime.gap_percent,
      overnight_ohlc: {
        open: bestRegime.overnight_open,
        high: bestRegime.overnight_high,
        low: bestRegime.overnight_low,
        close: bestRegime.overnight_close,
      },
      news_summary: bestRegime.news_headlines
        ? bestRegime.news_headlines
            .slice(0, 3)
            .map((h: any) => h.headline)
            .join(' | ')
        : 'No significant news',
      news_headlines: bestRegime.news_headlines || [],
      best_level_break_confidence: bestRegime.best_level_break_confidence,
      ready: bestRegime.recommendation_confidence >= 65,
      message: `${bestRegime.instrument} showing ${bestRegime.regime.toUpperCase()} setup (Gap ${Math.abs(bestRegime.gap_percent).toFixed(2)}%, Confidence ${bestRegime.recommendation_confidence}%)`,
      all_regimes: regimes.map((r: any) => ({
        instrument: r.instrument,
        regime: r.regime,
        confidence: r.recommendation_confidence,
      })),
    }

    // Get market disabled instruments (from previous stops)
    // TODO: Implement when Slice 3 adds market_disabled table
    const market_disabled_instruments: Instrument[] = []

    logger.debug('[Recommendation] Returning', recommendation.instrument, 'recommendation')

    return NextResponse.json(
      {
        recommendation,
        processed_at: bestRegime.created_at,
        market_disabled_instruments,
        locked_instrument: null,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('[Recommendation] Unexpected error:', error)
    return NextResponse.json(
      {
        recommendation: null,
        processed_at: null,
        market_disabled_instruments: [],
        locked_instrument: null,
        message: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
