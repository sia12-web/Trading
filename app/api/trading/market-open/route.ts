/**
 * POST /api/trading/market-open
 * Internal endpoint for market open analysis (runs at 9:20 AM)
 * Fetches market data, calculates regimes, stores recommendations
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { getRegimeDetector } from '@/lib/trading/regimeDetector'
import { getRecommendationEngine } from '@/lib/trading/recommendationEngine'
import type { Instrument, MarketOpenResponse, OvernightOHLC } from '@/types/trading'

const INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']

export async function POST(_request: NextRequest): Promise<NextResponse<MarketOpenResponse>> {
  try {
    logger.debug('[Market Open] Starting market open analysis')

    const supabase = await createClient()
    const finnhub = getFinnhubClient()
    const regimeDetector = getRegimeDetector()
    const recommendationEngine = getRecommendationEngine()

    // Fetch market data from Finnhub for all instruments
    logger.debug('[Market Open] Fetching quote data from Finnhub')

    const quotePromises = INSTRUMENTS.map((inst) => finnhub.getQuote(inst))
    const newsPromises = INSTRUMENTS.map((inst) => finnhub.getNews(inst))

    const quotes = await Promise.all(quotePromises)
    const newsData = await Promise.all(newsPromises)

    // Check if we got any data
    const hasData = quotes.some((q) => q !== null)
    if (!hasData) {
      logger.error('[Market Open] Failed to fetch any quote data from Finnhub')
      return handleFallback(supabase, recommendationEngine)
    }

    // Fetch level break data from our database
    logger.debug('[Market Open] Querying level breaks for best confidence per instrument')

    const { data: levelBreaks, error: levelBreaksError } = await supabase
      .from('level_breaks')
      .select('instrument, confidence, level')
      .order('confidence', { ascending: false })

    if (levelBreaksError) {
      logger.error('[Market Open] Error fetching level breaks:', levelBreaksError)
    }

    // Build market data for regime detection
    const marketDataArray = INSTRUMENTS.map((instrument, index) => {
      const quote = quotes[index]
      const news = newsData[index]

      if (!quote) {
        logger.warn(`[Market Open] No quote data for ${instrument}, using fallback`)
        return null
      }

      // Calculate overnight OHLC
      const overnight_ohlc: OvernightOHLC = {
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.previousClose,
      }

      // Calculate gap
      const gap_percent = ((quote.open - quote.previousClose) / quote.previousClose) * 100

      // Process news headlines
      const news_headlines = news || []
      const news_sentiment_score = news_headlines.reduce((sum, h) => sum + h.sentiment, 0)

      // Find best level break for this instrument
      const instrumentBreaks = levelBreaks?.filter((b) => b.instrument === instrument) || []
      const bestBreak = instrumentBreaks[0] // Already sorted by confidence descending

      return {
        instrument,
        gap_percent,
        overnight_ohlc,
        news_headlines,
        news_sentiment_score,
        best_level_break_confidence: bestBreak?.confidence || null,
        best_break_level: bestBreak?.level || null,
      }
    })

    // Filter out nulls
    const validMarketData = marketDataArray.filter((d) => d !== null)

    if (validMarketData.length === 0) {
      logger.error('[Market Open] No valid market data available')
      return handleFallback(supabase, recommendationEngine)
    }

    // Detect regimes
    logger.debug('[Market Open] Detecting regimes')
    const regimes = regimeDetector.detectRegimes(validMarketData as Parameters<typeof regimeDetector.detectRegimes>[0])

    // Get best recommendation
    logger.debug('[Market Open] Selecting best recommendation')
    const recommendation = recommendationEngine.selectBestRecommendation(regimes)

    if (!recommendation) {
      logger.error('[Market Open] Failed to generate recommendation')
      return handleFallback(supabase, recommendationEngine)
    }

    // Store all regimes in database
    logger.debug('[Market Open] Storing regimes in database')

    const today = new Date().toISOString().split('T')[0]

    const regimesToInsert = regimes.map((r) => ({
      instrument: r.instrument,
      date: today,
      gap_percent: r.gap_percent,
      overnight_open: r.overnight_ohlc.open,
      overnight_high: r.overnight_ohlc.high,
      overnight_low: r.overnight_ohlc.low,
      overnight_close: r.overnight_ohlc.close,
      regime: r.regime,
      regime_confidence: r.regime_confidence,
      news_headlines: r.news_headlines,
      news_sentiment_score: r.news_sentiment_score,
      best_level_break_confidence: r.best_level_break_confidence,
      best_break_level: r.best_break_level,
      recommendation_confidence: r.recommendation_confidence,
      gap_score: r.scoring_breakdown.gap_score,
      ohlc_score: r.scoring_breakdown.ohlc_score,
      news_score: r.scoring_breakdown.news_score,
      level_score: r.scoring_breakdown.level_score,
    }))

    const { error: insertError } = await supabase.from('regime_cache').upsert(regimesToInsert, {
      onConflict: 'instrument,date',
    })

    if (insertError) {
      logger.error('[Market Open] Error storing regimes:', insertError)
      // Don't fail, return recommendation anyway
    }

    // Store recommendation choice record
    const { error: recError } = await supabase.from('market_recommendations').insert({
      date: today,
      recommended_instrument: recommendation.instrument,
      recommendation_confidence: recommendation.recommendation_confidence,
      all_recommendations: JSON.stringify(recommendation.all_regimes),
    })

    if (recError) {
      logger.warn('[Market Open] Error storing recommendation record:', recError)
      // Don't fail
    }

    logger.debug('[Market Open] Market open analysis complete')

    return NextResponse.json(
      {
        success: true,
        recommendation,
        processed_at: new Date().toISOString(),
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('[Market Open] Unexpected error:', error)
    return NextResponse.json(
      {
        success: false,
        recommendation: null,
        error: 'Internal server error',
        processed_at: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

/**
 * Fallback handler when live data unavailable
 * Uses previous day's recommendation or neutral regime
 */
async function handleFallback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recommendationEngine: ReturnType<typeof getRecommendationEngine>
): Promise<NextResponse<MarketOpenResponse>> {
  try {
    logger.warn('[Market Open] Falling back to previous recommendation')

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    // Try to find yesterday's regime cache
    const { data: previousRegimes } = await supabase
      .from('regime_cache')
      .select('*')
      .eq('date', yesterdayStr)

    if (previousRegimes && previousRegimes.length > 0) {
      logger.debug('[Market Open] Using previous day regime as fallback')

      // Convert database format to RegimeData
      const fallbackRegimes = previousRegimes.map((r: any) => ({
        id: r.id,
        instrument: r.instrument,
        date: r.date,
        gap_percent: r.gap_percent,
        overnight_ohlc: {
          open: r.overnight_open,
          high: r.overnight_high,
          low: r.overnight_low,
          close: r.overnight_close,
        },
        regime: r.regime,
        regime_confidence: r.regime_confidence,
        news_headlines: r.news_headlines || [],
        news_sentiment_score: r.news_sentiment_score || 0,
        best_level_break_confidence: r.best_level_break_confidence,
        best_break_level: r.best_break_level,
        recommendation_confidence: r.recommendation_confidence,
        scoring_breakdown: {
          gap_score: r.gap_score,
          ohlc_score: r.ohlc_score,
          news_score: r.news_score,
          level_score: r.level_score,
        },
        created_at: r.created_at,
        updated_at: r.updated_at,
      }))

      const recommendation = recommendationEngine.selectBestRecommendation(fallbackRegimes)

      return NextResponse.json(
        {
          success: true,
          recommendation,
          fallback: true,
          error: 'Finnhub API unavailable. Using previous recommendation.',
          processed_at: new Date().toISOString(),
        },
        { status: 200 }
      )
    }

    // No previous data, return neutral
    logger.warn('[Market Open] No previous regime data available, returning neutral')

    return NextResponse.json(
      {
        success: true,
        recommendation: null,
        fallback: true,
        error: 'Market data unavailable. System requires live data from Finnhub.',
        processed_at: new Date().toISOString(),
      },
      { status: 200 }
    )
  } catch (fallbackError) {
    logger.error('[Market Open] Fallback handler error:', fallbackError)

    return NextResponse.json(
      {
        success: false,
        recommendation: null,
        error: 'Failed to process market data',
        processed_at: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
