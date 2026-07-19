/**
 * Position Management Types
 * Types for position display, P&L tracking, and management decisions
 */

import type { Instrument, EntryDirection, Regime } from './trading'

export interface PriceUpdate {
  instrument: Instrument
  price: number
  timestamp: string
}

export interface PositionStatus {
  id: string
  user_id: string
  instrument: Instrument
  trade_date: string

  // Entry details
  entry_price: number
  entry_direction: EntryDirection
  entry_timestamp: string
  entry_window: 1 | 2 | 3

  // Position sizing
  position_size: number
  account_size: number
  risk_amount: number

  // Stop loss
  stop_loss_price: number
  stop_loss_distance: number
  stop_loss_percent: number

  // Regime info
  regime: Regime
  regime_confidence: number

  // Computed fields (calculated by API)
  profit_target_price: number
  stop_loss_hit_count: number
  /** ai | structure | manual */
  entry_source?: 'ai' | 'structure' | 'manual' | null
  entry_reason?: string | null
}

export interface PositionStatusResponse {
  success: boolean
  position: PositionStatus | null
  current_time: string
  lunch_close_time: string
  message: string
}

export interface PositionWithLivePnL {
  position: PositionStatus
  currentPrice: number
  profitLoss_dollars: number
  profitLoss_percent: number
  distanceToStopLoss_percent: number
  distanceToProfitTarget_percent: number
  isConnected: boolean
}
