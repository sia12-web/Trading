import type { DeskEntrySource } from '@/lib/trading/positionSizing'
import type { StrategyRangeEdges } from '@/lib/trading/strategyRiskGeometry'

export type Direction = 'LONG' | 'SHORT'

/** Working limit order definition. */
export interface PendingLimitOrder {
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI' | 'GOLD' | 'CRUDE' | 'SILVER'
  level: number
  levelType?: string
  entryReason?: string
  /** How the limit was chosen */
  entrySource: DeskEntrySource
  direction: Direction
  stopLoss: number
  profitTarget: number
  positionSize: number
  riskAmount: number
  riskPercent: number
  accountSize: number
  entryWindow: 1 | 2 | 3
  regime: 'bullish' | 'bearish' | 'choppy'
  regimeConfidence: number
  placedAt: number
  riskProfile?: string
  /** Durable trades_journal row — required for TP amend while working */
  workingId?: string
  /** Active playbook range for ±10 entry gate (API + fill) */
  strategyRange?: StrategyRangeEdges | null
  /** Auction entrance — skip CALL ±10 */
  auctionTicket?: boolean
}

/** Filled position handed to MANAGE. */
export interface FilledOrder {
  position_id: string
  entry_price: number
  stop_loss_price: number
  position_size: number
  risk_amount: number
  entry_direction: Direction
  profit_target_price: number
  entry_source?: DeskEntrySource
}

/** True when live price / bar would fill a resting limit. */
export function limitWouldFill(
  direction: Direction,
  level: number,
  price: number
): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(level) || price <= 0) return false
  // Buy limit fills at or below; sell/short limit fills at or above
  return direction === 'LONG' ? price <= level : price >= level
}

/** True when a candle's range touches the limit. */
export function barTouchesLimit(
  bar: { high: number; low: number },
  level: number
): boolean {
  return bar.low <= level && bar.high >= level
}

export type { DeskEntrySource }
