/**
 * Position sizing calculator
 * Desk (AI/structure) levels: 5% account risk.
 * Manual chart/ticket entries: 1% account risk — size adapts to stop distance.
 * Formula: position_size = risk_amount / |entry - stop|
 */

import { logger } from '@/lib/utils/logger'
import { snapProfitToRound } from '@/lib/trading/deskLevels'
import type { PositionSizing, EntryDirection } from '@/types/trading'

/** AI / structure desk levels */
export const DESK_RISK_PERCENT = 5
/** Manual limit orders — always 1% of account */
export const MANUAL_RISK_PERCENT = 1
const MAX_LOSS_PERCENT = 0.05 // 5% max loss per trade (default disaster stop)
/** With tight zone stops, cap exposure so risk-per-point can't blow up notional */
const MAX_NOTIONAL_MULT = 5

export type DeskEntrySource = 'ai' | 'structure' | 'manual'

export function riskPercentForEntrySource(source?: DeskEntrySource | string | null): number {
  return source === 'manual' ? MANUAL_RISK_PERCENT : DESK_RISK_PERCENT
}

const MIN_ACCOUNT = 5_000
const MAX_ACCOUNT = 1_000_000

/**
 * Prefer server DESK_ACCOUNT_SIZE when set; otherwise clamp client value.
 * Prevents inflated account_size from inflating dollar risk (Sentinel M1).
 */
export function resolveDeskAccountSize(clientSize?: number | null): number | null {
  const envRaw = process.env.DESK_ACCOUNT_SIZE
  if (envRaw != null && String(envRaw).trim() !== '') {
    const envSize = Number(envRaw)
    if (Number.isFinite(envSize) && envSize >= MIN_ACCOUNT && envSize <= MAX_ACCOUNT) {
      return envSize
    }
  }
  if (typeof clientSize !== 'number' || !Number.isFinite(clientSize)) return null
  if (clientSize < MIN_ACCOUNT || clientSize > MAX_ACCOUNT) return null
  return clientSize
}

export function normalizeEntrySource(
  raw?: string | null,
  fallback: DeskEntrySource = 'ai'
): DeskEntrySource {
  if (raw === 'manual' || raw === 'structure' || raw === 'ai') return raw
  if (raw === 'chart_level') return 'ai'
  return fallback
}

export class PositionSizer {
  /**
   * Calculate position sizing from entry price and account size.
   * Default stop is ±5% from entry; pass `stopLossPrice` for a zone-based
   * stop (beyond the level's zone edge) — risk amount stays the same, the
   * position size adapts to the true stop distance.
   * Position size = risk_amount / (entry_price - stop_loss_price)
   */
  calculatePosition(
    entryPrice: number,
    accountSize: number,
    direction: EntryDirection,
    stopLossPrice?: number,
    riskPercent: number = DESK_RISK_PERCENT
  ): PositionSizing | null {
    // Validate inputs
    if (entryPrice <= 0) {
      logger.error('PositionSizer: Invalid entry price', { entryPrice })
      return null
    }

    if (accountSize <= 0) {
      logger.error('PositionSizer: Invalid account size', { accountSize })
      return null
    }

    const riskPct =
      Number.isFinite(riskPercent) && riskPercent > 0 ? riskPercent : DESK_RISK_PERCENT
    const riskAmount = accountSize * (riskPct / 100)

    // Stop: custom (zone-based) if valid for the direction, else default ±5%
    const customStopValid =
      stopLossPrice != null &&
      stopLossPrice > 0 &&
      (direction === 'LONG' ? stopLossPrice < entryPrice : stopLossPrice > entryPrice)

    const stopLossPriceFinal = customStopValid
      ? stopLossPrice!
      : direction === 'LONG'
        ? entryPrice * (1 - MAX_LOSS_PERCENT)
        : entryPrice * (1 + MAX_LOSS_PERCENT)

    // Ensure stop loss is different from entry
    if (Math.abs(stopLossPriceFinal - entryPrice) < 0.01) {
      logger.error('PositionSizer: Stop loss too close to entry', {
        entryPrice,
        stopLossPrice: stopLossPriceFinal,
      })
      return null
    }

    // Calculate position size (capped so tight stops can't create runaway notional)
    const priceDistance = Math.abs(entryPrice - stopLossPriceFinal)
    let positionSize = riskAmount / priceDistance
    const maxSize = (accountSize * MAX_NOTIONAL_MULT) / entryPrice
    if (positionSize > maxSize) positionSize = maxSize

    // Validate position size
    if (positionSize <= 0 || !isFinite(positionSize)) {
      logger.error('PositionSizer: Invalid position size calculation', {
        riskAmount,
        priceDistance,
        positionSize,
      })
      return null
    }

    // Verify risk doesn't exceed max
    const maxRisk = positionSize * priceDistance
    const riskPercentActual = (maxRisk / accountSize) * 100

    if (riskPercentActual > riskPct + 0.1) {
      // Allow 0.1% tolerance for rounding
      logger.error('PositionSizer: Risk exceeds maximum', {
        riskPercent: riskPercentActual,
        maxRisk,
        accountSize,
        riskPct,
      })
      return null
    }

    logger.debug('PositionSizer: Position calculated', {
      entryPrice,
      stopLossPrice: stopLossPriceFinal,
      positionSize,
      riskAmount,
      riskPercent: riskPct,
      direction,
    })

    return {
      account_size: accountSize,
      risk_percent: riskPct,
      risk_amount: riskAmount,
      entry_price: entryPrice,
      stop_loss_price: stopLossPriceFinal,
      position_size: positionSize,
      direction,
    }
  }

  /**
   * Validate position sizing parameters
   */
  validatePositionSize(position: PositionSizing): boolean {
    if (position.account_size <= 0) {
      logger.error('PositionSizer: Invalid account size', { size: position.account_size })
      return false
    }

    if (position.entry_price <= 0) {
      logger.error('PositionSizer: Invalid entry price', { price: position.entry_price })
      return false
    }

    if (position.stop_loss_price <= 0) {
      logger.error('PositionSizer: Invalid stop loss', { price: position.stop_loss_price })
      return false
    }

    if (position.position_size <= 0) {
      logger.error('PositionSizer: Invalid position size', { size: position.position_size })
      return false
    }

    if (position.risk_amount <= 0) {
      logger.error('PositionSizer: Invalid risk amount', { amount: position.risk_amount })
      return false
    }

    // Verify stop loss is on correct side
    if (position.direction === 'LONG' && position.stop_loss_price >= position.entry_price) {
      logger.error('PositionSizer: LONG stop loss must be below entry')
      return false
    }

    if (position.direction === 'SHORT' && position.stop_loss_price <= position.entry_price) {
      logger.error('PositionSizer: SHORT stop loss must be above entry')
      return false
    }

    // Verify risk doesn't exceed account
    const maxRisk = position.position_size * Math.abs(position.entry_price - position.stop_loss_price)
    if (maxRisk > position.account_size) {
      logger.error('PositionSizer: Risk exceeds account size', { maxRisk, account: position.account_size })
      return false
    }

    return true
  }

  /**
   * Calculate P&L for closed position
   * CRITICAL: Guard against division by zero
   */
  calculatePnL(
    entryPrice: number,
    exitPrice: number,
    positionSize: number,
    direction: EntryDirection
  ): { profitLoss: number; profitLossPercent: number } {
    // CRITICAL FIX: Prevent division by zero
    if (entryPrice <= 0 || positionSize <= 0) {
      logger.error('PositionSizer.calculatePnL: Invalid parameters', {
        entryPrice,
        positionSize,
      })
      throw new Error(`Invalid parameters for P&L calculation: entryPrice=${entryPrice}, positionSize=${positionSize}`)
    }

    let profitLoss: number

    if (direction === 'LONG') {
      profitLoss = (exitPrice - entryPrice) * positionSize
    } else {
      profitLoss = (entryPrice - exitPrice) * positionSize
    }

    // Account value at entry = entryPrice * positionSize
    // P&L percent = (profitLoss / accountValueAtEntry) * 100
    const accountValueAtEntry = entryPrice * positionSize
    const profitLossPercent = (profitLoss / accountValueAtEntry) * 100

    return {
      profitLoss: Math.round(profitLoss * 100) / 100, // Round to 2 decimals
      profitLossPercent: Math.round(profitLossPercent * 100) / 100,
    }
  }
}

// Singleton instance
let positionSizerInstance: PositionSizer | null = null

export function getPositionSizer(): PositionSizer {
  if (!positionSizerInstance) {
    positionSizerInstance = new PositionSizer()
  }
  return positionSizerInstance
}

/**
 * Client-safe preview of the same sizing used by open-route.
 * Pass `stopLossPrice` (e.g. beyond the level's zone edge) for zone-based
 * risk — same risk amount, size adapts to the true stop distance.
 */
export function previewPositionSizing(
  entryPrice: number,
  accountSize: number,
  direction: EntryDirection,
  stopLossPrice?: number,
  riskPercent: number = DESK_RISK_PERCENT
): {
  stop_loss_price: number
  position_size: number
  risk_amount: number
  risk_percent: number
  notional: number
  profit_target_price: number
} | null {
  if (entryPrice <= 0 || accountSize <= 0) return null
  const riskPct =
    Number.isFinite(riskPercent) && riskPercent > 0 ? riskPercent : DESK_RISK_PERCENT
  const risk_amount = accountSize * (riskPct / 100)

  const customStopValid =
    stopLossPrice != null &&
    stopLossPrice > 0 &&
    (direction === 'LONG' ? stopLossPrice < entryPrice : stopLossPrice > entryPrice)

  const stop_loss_price = customStopValid
    ? stopLossPrice!
    : direction === 'LONG'
      ? entryPrice * (1 - MAX_LOSS_PERCENT)
      : entryPrice * (1 + MAX_LOSS_PERCENT)

  const priceDistance = Math.abs(entryPrice - stop_loss_price)
  if (priceDistance < 0.01) return null
  let position_size = risk_amount / priceDistance
  const maxSize = (accountSize * MAX_NOTIONAL_MULT) / entryPrice
  if (position_size > maxSize) position_size = maxSize
  if (!Number.isFinite(position_size) || position_size <= 0) return null
  // Target: with a zone stop use 2R (risk-symmetric, min 0.5% move);
  // with the default disaster stop keep the classic 1% day-trade target
  const rewardDistance = customStopValid
    ? Math.max(priceDistance * 2, entryPrice * 0.005)
    : entryPrice * 0.01
  const rawTarget =
    direction === 'LONG' ? entryPrice + rewardDistance : entryPrice - rewardDistance
  const profit_target_price = snapProfitToRound(
    entryPrice,
    stop_loss_price,
    rawTarget,
    direction
  )
  return {
    stop_loss_price,
    position_size,
    risk_amount: position_size * priceDistance,
    risk_percent: riskPct,
    notional: position_size * entryPrice,
    profit_target_price,
  }
}
