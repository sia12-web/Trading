/**
 * Position Manager
 * Manages open positions during trading day (10:15 AM - 11:30 AM)
 * Applies rule-based management decisions based on level break confidence
 * Handles automatic lunch close at 11:30 AM
 * All times are in EST (America/New_York timezone)
 */

import { logger } from '@/lib/utils/logger'
import { getESTTimeString, parseTimeToSeconds } from '@/lib/utils/timeUtils'
import type { TradePosition, ManagementDecision } from '@/types/trading'

export interface ManagementRules {
  profitTarget: number // Percentage (e.g., 2.0 for +2%)
  stopLossAdjustment: number // How tight to adjust stop loss
  takePartialAt?: number // First exit percentage
  holdPercentage?: number // Remainder to hold
}

export interface ManagementDecisionResult {
  decision: ManagementDecision
  reason: string
  profitTargetPrice: number | null
  recommendedAction: string
}

export class PositionManager {
  private readonly LUNCH_CLOSE_TIME = '11:30:00'
  private readonly LUNCH_CLOSE_GRACE_MINUTES = 1

  /**
   * Get management rules based on level break confidence
   */
  getManagementRules(confidence: number): ManagementRules {
    if (confidence > 85) {
      return {
        profitTarget: 2.0,
        stopLossAdjustment: 2.0,
        takePartialAt: 50, // Take 50% at 1%
        holdPercentage: 50, // Hold 50% for 2%
      }
    }

    if (confidence > 75) {
      return {
        profitTarget: 1.5,
        stopLossAdjustment: 2.5,
        takePartialAt: 50,
        holdPercentage: 50,
      }
    }

    if (confidence > 65) {
      return {
        profitTarget: 1.0,
        stopLossAdjustment: 2.5,
        takePartialAt: 50,
        holdPercentage: 50,
      }
    }

    if (confidence > 50) {
      return {
        profitTarget: 0.7,
        stopLossAdjustment: 5.0,
      }
    }

    // <50% confidence
    return {
      profitTarget: 0.5,
      stopLossAdjustment: 5.0,
    }
  }

  /**
   * Calculate current P&L for a position
   * CRITICAL: Guard against division by zero
   */
  calculateCurrentPnL(
    position: TradePosition,
    currentPrice: number
  ): { profitLoss: number; profitLossPercent: number } {
    if (currentPrice <= 0) {
      logger.error('PositionManager: Invalid current price', { currentPrice })
      return { profitLoss: 0, profitLossPercent: 0 }
    }

    // CRITICAL FIX: Prevent division by zero
    if (position.entry_price <= 0 || position.position_size <= 0) {
      logger.error('PositionManager: Invalid position parameters', {
        entry_price: position.entry_price,
        position_size: position.position_size,
      })
      return { profitLoss: 0, profitLossPercent: 0 }
    }

    let profitLoss: number

    if (position.entry_direction === 'LONG') {
      profitLoss = (currentPrice - position.entry_price) * position.position_size
    } else {
      profitLoss = (position.entry_price - currentPrice) * position.position_size
    }

    // Account value at entry = entry_price * position_size
    // P&L percent = (profitLoss / accountValueAtEntry) * 100
    const accountValueAtEntry = position.entry_price * position.position_size
    const profitLossPercent = (profitLoss / accountValueAtEntry) * 100

    return {
      profitLoss: Math.round(profitLoss * 100) / 100,
      profitLossPercent: Math.round(profitLossPercent * 100) / 100,
    }
  }

  /**
   * Calculate profit target price based on rules
   */
  calculateProfitTargetPrice(
    position: TradePosition,
    rules: ManagementRules
  ): number {
    const targetPercent = rules.profitTarget / 100

    if (position.entry_direction === 'LONG') {
      return position.entry_price * (1 + targetPercent)
    } else {
      return position.entry_price * (1 - targetPercent)
    }
  }

  /**
   * Determine management decision based on current price and rules
   */
  determineManagementDecision(
    position: TradePosition,
    currentPrice: number,
    confidence: number
  ): ManagementDecisionResult {
    const rules = this.getManagementRules(confidence)
    const pnl = this.calculateCurrentPnL(position, currentPrice)
    const targetPrice = this.calculateProfitTargetPrice(position, rules)

    let decision: ManagementDecision = 'HOLD'
    let reason = ''
    let recommendedAction = ''

    if (position.entry_direction === 'LONG') {
      // LONG position logic
      if (currentPrice >= targetPrice) {
        decision = 'TAKE_PROFIT'
        reason = `Price reached target of $${targetPrice.toFixed(2)}`
        recommendedAction = rules.takePartialAt
          ? `Take 50% profit, hold 50% for more gains`
          : `Exit entire position`
      } else if (currentPrice >= position.entry_price * 1.01) {
        // Within 1% of target
        decision = 'MONITOR'
        reason = `Approaching profit target ($${targetPrice.toFixed(2)}), monitor closely`
        recommendedAction = 'Watch for reversal or target hit'
      } else if (currentPrice < position.stop_loss_price * 1.05) {
        // Near stop loss
        decision = 'ADJUST'
        reason = 'Price near stop loss, consider adjusting'
        recommendedAction = 'Tighten stop or prepare to exit'
      } else {
        decision = 'HOLD'
        reason = `Position at ${pnl.profitLossPercent.toFixed(2)}% P&L, holding for target`
        recommendedAction = 'Continue holding'
      }
    } else {
      // SHORT position logic
      if (currentPrice <= targetPrice) {
        decision = 'TAKE_PROFIT'
        reason = `Price reached target of $${targetPrice.toFixed(2)}`
        recommendedAction = rules.takePartialAt
          ? `Take 50% profit, hold 50% for more gains`
          : `Exit entire position`
      } else if (currentPrice <= position.entry_price * 0.99) {
        // Within 1% of target
        decision = 'MONITOR'
        reason = `Approaching profit target ($${targetPrice.toFixed(2)}), monitor closely`
        recommendedAction = 'Watch for reversal or target hit'
      } else if (currentPrice > position.stop_loss_price * 0.95) {
        // Near stop loss
        decision = 'ADJUST'
        reason = 'Price near stop loss, consider adjusting'
        recommendedAction = 'Tighten stop or prepare to exit'
      } else {
        decision = 'HOLD'
        reason = `Position at ${pnl.profitLossPercent.toFixed(2)}% P&L, holding for target`
        recommendedAction = 'Continue holding'
      }
    }

    logger.debug('PositionManager: Management decision', {
      position_id: position.id,
      decision,
      current_price: currentPrice,
      target_price: targetPrice,
      p_l_percent: pnl.profitLossPercent,
    })

    return {
      decision,
      reason,
      profitTargetPrice: targetPrice,
      recommendedAction,
    }
  }

  /**
   * Check if position should be auto-closed soon (within 5 minutes of lunch)
   */
  shouldAutoCloseSoon(now: Date = new Date()): boolean {
    const timeStr = getESTTimeString(now)
    const lunchTime = parseTimeToSeconds(this.LUNCH_CLOSE_TIME)
    const currentTime = parseTimeToSeconds(timeStr)
    const minutesToLunch = (lunchTime - currentTime) / 60

    return minutesToLunch <= 5 && minutesToLunch >= 0
  }

  /**
   * Check if it's time for lunch close (11:30 AM - 11:31 AM)
   */
  isLunchCloseTime(now: Date = new Date()): boolean {
    const timeStr = getESTTimeString(now)
    const lunchStartTime = parseTimeToSeconds(this.LUNCH_CLOSE_TIME)
    const lunchEndTime = lunchStartTime + this.LUNCH_CLOSE_GRACE_MINUTES * 60
    const currentTime = parseTimeToSeconds(timeStr)

    return currentTime >= lunchStartTime && currentTime < lunchEndTime
  }

  /**
   * Get minutes until lunch close
   */
  getMinutesUntilLunchClose(now: Date = new Date()): number | null {
    const timeStr = getESTTimeString(now)
    const currentTime = parseTimeToSeconds(timeStr)
    const lunchTime = parseTimeToSeconds(this.LUNCH_CLOSE_TIME)

    if (currentTime >= lunchTime) {
      return null // Already past lunch time
    }

    return Math.round((lunchTime - currentTime) / 60)
  }

  /**
   * Validate position is open and within management hours (10:15 AM - 11:30 AM)
   */
  isWithinManagementHours(now: Date = new Date()): boolean {
    // Management hours: after entry windows (10:15 AM) and before lunch (11:30 AM)
    const entriesClosedTime = parseTimeToSeconds('10:15:00')
    const lunchCloseTime = parseTimeToSeconds(this.LUNCH_CLOSE_TIME)
    const currentTime = parseTimeToSeconds(getESTTimeString(now))

    return currentTime > entriesClosedTime && currentTime < lunchCloseTime
  }

}

// Singleton instance
let positionManagerInstance: PositionManager | null = null

export function getPositionManager(): PositionManager {
  if (!positionManagerInstance) {
    positionManagerInstance = new PositionManager()
  }
  return positionManagerInstance
}
