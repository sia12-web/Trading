/**
 * Level Finder Agent Types
 * Interfaces for price action analysis and level identification
 */

export interface Candle {
  open: number
  high: number
  low: number
  close: number
  volume: number
  timestamp: string  // ISO 8601
}

export interface AnalysisRequest {
  session_id: string
  candles_4h: Candle[]
  candles_daily: Candle[]
  candles_h1: Candle[]
  symbol: string
  index: 'DOW' | 'NASDAQ' | 'NIKKEI'
  current_price: number
}

export interface LevelIdentification {
  level: number
  type: 'support' | 'resistance' | 'vwap'
  conviction: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  reasoning: string
  timeframe: 'D' | '4H' | 'H1'
}

export interface ValidationResult extends LevelIdentification {
  is_duplicate: boolean
  duplicate_distance_pips?: number
}

export interface StoredLevel extends ValidationResult {
  id: string
  created_at: string
}

export interface ClaudeUsage {
  input_tokens: number
  output_tokens: number
  provider?: string
  model?: string
}

export interface AnalysisResponse {
  levels: ValidationResult[]
  session_id: string
  analysis_timestamp: string
  claude_usage: ClaudeUsage
  error?: string
}

// Historical Level Memory Types
export interface LevelHistory {
  id: string
  user_id: string
  session_id: string
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  level: number
  type: 'support' | 'resistance' | 'vwap'
  conviction: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  reasoning: string
  timeframe: 'D' | '4H' | 'H1'
  tested_count: number
  success_count: number
  success_rate: number // Calculated: success_count / tested_count * 100
  last_tested_date: string | null
  created_at: string
  days_ago: number // Calculated: days since created_at
}

export interface ArchiveRequest {
  session_id: string
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  levels: Array<{
    level: number
    type: 'support' | 'resistance' | 'vwap'
    conviction: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
    reasoning: string
    timeframe: 'D' | '4H' | 'H1'
  }>
}

export interface ArchiveResponse {
  archived_count: number
  duplicate_count: number
  level_history_ids: string[]
}

export interface HistoryResponse {
  levels: LevelHistory[]
  total_count: number
  query_params: {
    instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
    days: number
    limit: number
  }
}

// Claude Integration - Historical Context Types
export interface HistoricalLevelData {
  level: number
  type: 'support' | 'resistance' | 'vwap'
  conviction: number
  reasoning: string
  timeframe: 'D' | '4H' | 'H1'
  tested_count: number
  success_count: number
  success_rate: number  // 0.00 to 1.00
  last_tested_date: string | null
}

export interface ContextSummary {
  total_levels: number
  avg_conviction: number
  avg_success_rate: number
  most_reliable_type: 'support' | 'resistance' | 'vwap' | null
  successful_levels: HistoricalLevelData[]  // success_rate >= 0.60
  unreliable_levels: HistoricalLevelData[]  // success_rate < 0.40
}

export interface HistoricalContext {
  levels: HistoricalLevelData[]
  summary: ContextSummary
}

// Extend AnalysisRequest to include optional historical context
export interface AnalysisRequestWithContext extends AnalysisRequest {
  historicalContext?: HistoricalContext
}

// Analytics Dashboard Types
export interface AnalyticsResponse {
  summary: AnalyticsSummary
  by_type: TypeMetrics[]
  by_timeframe: TimeframeMetrics[]
  top_performers: LevelPerformance[]
  reliability_ranking: ReliabilityRanking
}

export interface AnalyticsSummary {
  total_levels: number
  total_tests: number
  total_successes: number
  avg_conviction: number
  overall_success_rate: number
}

export interface TypeMetrics {
  type: 'support' | 'resistance' | 'vwap'
  count: number
  avg_conviction: number
  success_rate: number
  tested_count: number
  success_count: number
}

export interface TimeframeMetrics {
  timeframe: 'D' | '4H' | 'H1'
  count: number
  avg_conviction: number
  success_rate: number
}

export interface LevelPerformance {
  level: number
  type: 'support' | 'resistance' | 'vwap'
  conviction: number
  success_rate: number
  tested_count: number
  success_count: number
}

export interface ReliabilityRanking {
  most_reliable_type: 'support' | 'resistance' | 'vwap' | null
  least_reliable_type: 'support' | 'resistance' | 'vwap' | null
  most_reliable_timeframe: 'D' | '4H' | 'H1' | null
}
