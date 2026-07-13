/**
 * Trading types and interfaces for Day Trading Strategy Engine
 */

export type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI'
export type Regime = 'bullish' | 'bearish' | 'choppy'

export interface OvernightOHLC {
  open: number
  high: number
  low: number
  close: number
}

export interface NewsHeadline {
  headline: string
  source: string
  sentiment: number // -10 to +10 (negative to positive)
  timestamp: string
}

export interface ScoringBreakdown {
  gap_score: number // -20 to +20
  ohlc_score: number // -15 to +15
  news_score: number // -10 to +10
  level_score: number // 0 to +5
}

export interface RegimeData {
  id: string
  instrument: Instrument
  date: string // YYYY-MM-DD
  gap_percent: number // e.g., 1.25 for 1.25% gap
  overnight_ohlc: OvernightOHLC
  regime: Regime
  regime_confidence: number // 0-100
  news_headlines: NewsHeadline[]
  news_sentiment_score: number // -30 to +30
  best_level_break_confidence: number | null // 0-100 from level_breaks detector
  best_break_level: number | null
  recommendation_confidence: number // 0-100 (final score)
  scoring_breakdown: ScoringBreakdown
  created_at: string
  updated_at: string
}

export interface MarketRecommendation {
  instrument: Instrument
  regime: Regime
  regime_confidence: number
  recommendation_confidence: number
  gap_percent: number
  overnight_ohlc: OvernightOHLC
  news_summary: string
  news_headlines: NewsHeadline[]
  best_level_break_confidence: number | null
  ready: boolean // true if recommendation_confidence >= 65%
  message: string // Human-readable explanation
  all_regimes: Array<{
    instrument: Instrument
    regime: Regime
    confidence: number
  }>
}

export interface MarketOpenResponse {
  success: boolean
  recommendation: MarketRecommendation | null
  error?: string
  fallback?: boolean // true if using fallback logic
  processed_at: string
}

export interface MarketRecommendationResponse {
  recommendation: MarketRecommendation | null
  processed_at: string | null
  market_disabled_instruments: Instrument[] // Instruments disabled from previous stops
  locked_instrument: Instrument | null // Instrument trader selected
  message?: string
  ready?: boolean
}

export interface FinnhubQuoteResponse {
  c: number // current price
  o: number // open price
  h: number // high price
  l: number // low price
  pc: number // previous close
  t: number // timestamp
}

export interface FinnhubNewsItem {
  headline: string
  source: string
  datetime: number
}
