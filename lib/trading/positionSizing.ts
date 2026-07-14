/**
 * Position sizing calculator
 * Calculates position size based on 5% account risk
 * Formula: position_size = risk_amount / (entry_price - stop_loss_price)
 */

import { logger } from '@/lib/utils/logger'
import type { PositionSizing, EntryDirection } from '@/types/trading'

const RISK_PERCENT = 5 // 5% of account
const MAX_LOSS_PERCENT = 0.05 // 5% max loss per trade

export class PositionSizer {
  /**
   * Calculate position sizing from entry price and account size
   * Stop loss is fixed at ±5% from entry price
   * Position size = risk_amount / (entry_price - stop_loss_price)
   */
  calculatePosition(
    entryPrice: number,
    accountSize: number,
    direction: EntryDirection
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

    // Calculate stop loss price
    let stopLossPrice: number
    if (direction === 'LONG') {
      // For LONG: stop loss is 5% below entry
      stopLossPrice = entryPrice * (1 - MAX_LOSS_PERCENT)
    } else {
      // For SHORT: stop loss is 5% above entry
      stopLossPrice = entryPrice * (1 + MAX_LOSS_PERCENT)
    }

    // Ensure stop loss is different from entry
    if (Math.abs(stopLossPrice - entryPrice) < 0.01) {
      logger.error('PositionSizer: Stop loss too close to entry', {
        entryPrice,
        stopLossPrice,
      })
      return null
    }

    // Calculate position size
    const priceDistance = Math.abs(entryPrice - stopLossPrice)
    const positionSize = riskAmount / priceDistance

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
      stopLossPrice,
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
      stop_loss_price: stopLossPrice,
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
