/**
 * Analytics types for level performance dashboard
 */

export type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI'
export type LevelType = 'support' | 'resistance' | 'vwap'
export type Timeframe = 'D' | '4H' | 'H1'

export interface AnalyticsSummary {
  total_levels: number
  total_tests: number
  total_successes: number
  avg_conviction: number
  overall_success_rate: number
}

export interface TypeMetrics {
  type: LevelType
  count: number
  avg_conviction: number
  success_rate: number
  tested_count: number
  success_count: number
}

export interface TimeframeMetrics {
  timeframe: Timeframe
  count: number
  avg_conviction: number
  success_rate: number
}

export interface LevelPerformance {
  level: number
  type: LevelType
  conviction: number
  success_rate: number
  tested_count: number
  success_count: number
}

export interface ReliabilityRanking {
  most_reliable_type: LevelType | null
  least_reliable_type: LevelType | null
  most_reliable_timeframe: Timeframe | null
}

export interface AnalyticsResponse {
  summary: AnalyticsSummary
  by_type: TypeMetrics[]
  by_timeframe: TimeframeMetrics[]
  top_performers: LevelPerformance[]
  reliability_ranking: ReliabilityRanking
}

export interface FilterState {
  instrument: Instrument
  days: number
}

export interface AnalyticsError {
  code: 'UNAUTHORIZED' | 'INVALID_PARAMS' | 'FETCH_ERROR' | 'UNKNOWN'
  message: string
}

/**
 * Record shape from level_history table
 * Used for type-safe analytics calculations
 */
export interface LevelHistoryRecord {
  level: number
  type: LevelType
  conviction: number
  tested_count: number
  success_count: number
  timeframe: Timeframe
}
