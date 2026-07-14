/**
 * Trading types and interfaces for Day Trading Strategy Engine
 */

export type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI'
export type Regime = 'bullish' | 'bearish' | 'choppy'
export type EntryDirection = 'LONG' | 'SHORT'
export type EntryWindow = 1 | 2 | 3
export type ExitReason = 'stop_hit' | 'manual' | 'lunch_close' | 'ai_signal'

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

// Slice 2: Entry Window Detection & Position Opening

export interface WindowDefinition {
  window_number: EntryWindow
  start_time: string // HH:MM:SS
  end_time: string // HH:MM:SS
  duration_minutes: number
}

export interface PriceLevels {
  current: number
  lowest_in_window: number | null
  highest_in_window: number | null
}

export interface PositionSizing {
  account_size: number
  risk_percent: number // 5% for MVP
  risk_amount: number
  entry_price: number
  stop_loss_price: number
  position_size: number
  direction: EntryDirection
}

export interface TradePosition {
  id: string
  user_id: string // CRITICAL FIX: Track which user owns this trade
  instrument: Instrument
  trade_date: string // YYYY-MM-DD
  entry_window: EntryWindow
  entry_timestamp: string
  entry_price: number
  entry_direction: EntryDirection
  stop_loss_price: number
  stop_loss_hit_at: string | null
  stop_loss_hit_count: number
  position_size: number
  risk_amount: number
  account_size: number
  exit_timestamp: string | null
  exit_price: number | null
  exit_reason: ExitReason | null
  profit_loss: number | null
  profit_loss_percent: number | null
  regime: Regime
  regime_confidence: number
  best_level_break_confidence: number | null
  best_break_level: number | null
  created_at: string
  updated_at: string
}

export interface EntryDetectionEvent {
  instrument: Instrument
  window_number: EntryWindow
  entry_time: string
  entry_price: number
  direction: EntryDirection
  detected_at: string
  reason: string
}

export interface PositionOpenResponse {
  success: boolean
  position_id: string
  instrument: Instrument
  entry_price: number
  stop_loss_price: number
  position_size: number
  risk_amount: number
  entry_direction: EntryDirection
  entry_window: EntryWindow
  message: string
}

export interface CurrentPositionResponse {
  position: TradePosition | null
  locked_instrument: Instrument | null
  entry_window_active: EntryWindow | null
  next_entry_window: EntryWindow | null
  market_disabled: boolean
  message: string
}

export interface EntryWindowStatus {
  window: EntryWindow
  active: boolean
  start_time: string
  end_time: string
  time_remaining_seconds: number | null
  lowest_price: number | null
  highest_price: number | null
  entry_target: number | null
}

// Slice 3: Stop Loss Tracking & Market Disabling

export interface MarketStatusResponse {
  instrument: Instrument
  market_disabled: boolean
  disabled_reason: string | null
  stop_loss_hit_count: number | null
  disabled_at: string | null
}

// Slice 5: Position Management & Decision Buttons

export type DecisionType = 'HOLD' | 'TAKE_PROFIT' | 'ADJUST'

export interface ManagementDecisionRecord {
  id: string
  user_id: string
  position_id: string
  instrument: Instrument
  trade_date: string
  decision_type: DecisionType
  notes: string | null
  created_at: string
}

export interface ManagementDecisionResponse {
  success: boolean
  decision: ManagementDecisionRecord
  message: string
}

// Legacy: Position Management & Lunch Close (keeping for compatibility)

export type ManagementDecision = 'HOLD' | 'TAKE_PROFIT' | 'ADJUST' | 'MONITOR'

export interface ManagementDecisionAuditRecord {
  id: string
  position_id: string
  instrument: Instrument
  trade_date: string
  decision: ManagementDecision
  decision_price: number
  decision_time: string
  reason: string
  confidence_at_decision: number
  current_p_l: number | null
  current_p_l_percent: number | null
  created_at: string
}

export interface ManagePositionRequest {
  position_id: string
  instrument: Instrument
  current_price: number
  decision: ManagementDecision
  reason: string
  confidence: number
}

export interface ManagePositionResponse {
  success: boolean
  decision_id: string
  position_id: string
  decision: string
  current_price: number
  current_p_l: number
  current_p_l_percent: number
  message: string
}

export interface ClosePositionRequest {
  position_id: string
  instrument: Instrument
  exit_price: number
  exit_reason: ExitReason
  reason?: string
}

export interface ClosePositionResponse {
  success: boolean
  position_id: string
  instrument: string
  exit_price: number
  entry_price: number
  position_size: number
  profit_loss: number
  profit_loss_percent: number
  exit_reason: string
  message: string
}

export interface ManagementStatusResponse {
  position: TradePosition | null
  current_price: number | null
  current_p_l: number | null
  current_p_l_percent: number | null
  profit_target_price: number | null
  management_decisions: ManagementDecisionRecord[]
  time_to_lunch_close_minutes: number | null
  should_auto_close_soon: boolean
  message: string
}

// Slice 5: Historical Market Replay

export type PlaybackSpeed = 1 | 2 | 4 | 16

export interface SimulationReplay {
  id: string  // UUID
  user_id: string  // UUID
  instrument: Instrument
  replay_date: string  // YYYY-MM-DD
  playback_speed: PlaybackSpeed
  final_pnl: number | null  // Dollars, null while replay in progress
  final_pnl_percent: number | null  // Percentage, null while in progress
  trades_count: number
  replay_duration_seconds: number | null  // null while in progress
  notes: string | null
  created_at: string  // ISO timestamp
  updated_at: string  // ISO timestamp
}

export interface CreateReplaySessionRequest {
  instrument: Instrument
  replay_date: string  // YYYY-MM-DD
  playback_speed: PlaybackSpeed
}

export interface CreateReplaySessionResponse {
  id: string
  user_id: string
  instrument: Instrument
  replay_date: string
  playback_speed: PlaybackSpeed
  final_pnl: null
  final_pnl_percent: null
  trades_count: 0
  replay_duration_seconds: null
  notes: null
  created_at: string
  updated_at: string
}

export interface ListReplaySessionsResponse {
  sessions: SimulationReplay[]
  total: number
  limit: number
  offset: number
}

export interface GetReplaySessionResponse extends SimulationReplay {}

export interface UpdateReplaySessionRequest {
  final_pnl?: number
  final_pnl_percent?: number
  trades_count?: number
  replay_duration_seconds?: number
  notes?: string
}

// Slice 2: Date Picker & Replay Mode Toggle

export type TradingMode = 'live' | 'replay'

export interface AvailableDate {
  date: string // YYYY-MM-DD
  is_available: boolean
  has_session: boolean // true if user has existing session for this date
}

export interface AvailableDatesResponse {
  instrument: Instrument
  available_dates: AvailableDate[]
  total_available: number
  total_checked: number
}

export interface ReplayModeState {
  mode: TradingMode
  selectedDate: string | null
  selectedInstrument: Instrument
  availableDates: AvailableDate[]
  isLoadingDates: boolean
  lastFetchedInstrument: Instrument | null
}

// Slice 3: Real-Time Level Status Monitoring

export type LevelType = 'support' | 'resistance' | 'pivot'
export type LevelStatus = 'safe' | 'approaching' | 'broken' | 'recovered'
export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface TradingLevel {
  id: string
  user_id: string
  instrument: Instrument
  level_name: string
  price: number
  level_type: LevelType
  is_active: boolean
  notes?: string
  created_at: string
  updated_at: string
}

export interface LevelStatusDetail {
  level_id: string
  status: LevelStatus
  distance_pct: number
  approach_direction: 'approaching' | 'receding' | 'broken'
}

export interface PriceUpdateEvent {
  instrument: Instrument
  price: number
  timestamp: string
  source: 'finnhub'
  levels_approach: LevelStatusDetail[]
}

export interface ConnectionStatusResponse {
  overall_status: ConnectionStatus
  instruments: Record<
    string,
    {
      connection_status: ConnectionStatus
      last_price: number | null
      last_price_update: string | null
      data_freshness: 'live' | 'fresh' | 'stale'
      reconnect_attempts: number
    }
  >
}

export interface LevelsResponse {
  instrument: Instrument
  levels: TradingLevel[]
  total_active: number
}

// Slice 4: Entry Discipline System

export interface PendingEntry {
  price: number
  direction: EntryDirection
  window: EntryWindow
  time: Date
}

export interface OpenPositionRequest {
  instrument: Instrument
  entry_price: number
  entry_direction: EntryDirection
  entry_window: EntryWindow
  entry_time: string // ISO timestamp
  account_size: number
  current_price: number
  regime: Regime
  regime_confidence: number
}

export interface EntryDisciplineState {
  instrument: Instrument | null
  currentWindow: EntryWindow | null
  entryDetected: boolean
  pendingEntry: PendingEntry | null
  openPosition: TradePosition | null
  currentRegime: Regime | null
  regimeConfidence: number | null
  marketDisabled: boolean
  windowHighest: number | null
  windowLowest: number | null
  windowHighestTime: Date | null
  windowLowestTime: Date | null
  isLoadingEntry: boolean
  entryError: string | null
}

// Slice 5.3: Stop Loss Auto-Close Logic

export interface StopLossHitRequest {
  position_id: string
  current_price: number
  hit_timestamp: string // ISO timestamp
}

export interface StopLossHitResponse {
  success: boolean
  position_id: string
  exit_price: number
  profit_loss: number
  profit_loss_percent: number
  stop_loss_hit_count: number
  market_disabled: boolean
  message: string
}
