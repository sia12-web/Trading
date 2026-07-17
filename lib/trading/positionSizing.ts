/**
 * Position sizing calculator
 * Calculates position size based on 5% account risk
 * Formula: position_size = risk_amount / (entry_price - stop_loss_price)
 */

import { logger } from '@/lib/utils/logger'
import type { PositionSizing, EntryDirection } from '@/types/trading'

const RISK_PERCENT = 5 // 5% of account
const MAX_LOSS_PERCENT = 0.05 // 5% max loss per trade (default disaster stop)
/** With tight zone stops, cap exposure so risk-per-point can't blow up notional */
const MAX_NOTIONAL_MULT = 5

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
    stopLossPrice?: number
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

    // Calculate risk amount (5% of account)
    const riskAmount = accountSize * (RISK_PERCENT / 100)

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
    const riskPercent = (maxRisk / accountSize) * 100

    if (riskPercent > RISK_PERCENT + 0.1) {
      // Allow 0.1% tolerance for rounding
      logger.error('PositionSizer: Risk exceeds maximum', {
        riskPercent,
        maxRisk,
        accountSize,
      })
      return null
    }

    logger.debug('PositionSizer: Position calculated', {
      entryPrice,
      stopLossPrice: stopLossPriceFinal,
      positionSize,
      riskAmount,
      riskPercent,
      direction,
    })

    return {
      account_size: accountSize,
      risk_percent: RISK_PERCENT,
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
  stopLossPrice?: number
): {
  stop_loss_price: number
  position_size: number
  risk_amount: number
  risk_percent: number
  notional: number
  profit_target_price: number
} | null {
  if (entryPrice <= 0 || accountSize <= 0) return null
  const risk_amount = accountSize * (RISK_PERCENT / 100)

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
  const profit_target_price =
    direction === 'LONG' ? entryPrice + rewardDistance : entryPrice - rewardDistance
  return {
    stop_loss_price,
    position_size,
    risk_amount: position_size * priceDistance,
    risk_percent: RISK_PERCENT,
    notional: position_size * entryPrice,
    profit_target_price,
  }
}
