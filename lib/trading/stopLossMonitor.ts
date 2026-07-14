/**
 * Stop Loss Monitor
 * Monitors real-time prices and detects stop loss hits
 * Handles first 45 minutes (2 hits allowed) vs after 10:15 AM (auto-close on any hit)
 */

import { logger } from '@/lib/utils/logger'
import { getWindowManager } from './windowManager'
import type { Instrument, TradePosition, EntryDirection } from '@/types/trading'

export interface StopLossHit {
  position_id: string
  instrument: Instrument
  hit_time: Date
  current_price: number
  stop_loss_price: number
  hit_number: number // 1 or 2 during first 45 min
  in_first_45_min: boolean
  should_disable_market: boolean
  should_close_position: boolean
}

export class StopLossMonitor {
  private windowManager = getWindowManager()
  private activeListeners: Map<string, boolean> = new Map()

  /**
   * Check if a price hits the stop loss level
   * For LONG: price <= stop_loss_price
   * For SHORT: price >= stop_loss_price
   */
  checkStopLossHit(
    position: TradePosition,
    currentPrice: number
  ): StopLossHit | null {
    if (currentPrice <= 0) {
      logger.error('StopLossMonitor: Invalid price', { currentPrice })
      return null
    }

    // Check if price touches stop loss based on direction
    let stopHit = false

    if (position.entry_direction === 'LONG') {
      // LONG: stop loss triggered when price <= stop_loss_price
      stopHit = currentPrice <= position.stop_loss_price
    } else {
      // SHORT: stop loss triggered when price >= stop_loss_price
      stopHit = currentPrice >= position.stop_loss_price
    }

    if (!stopHit) {
      return null
    }

    const now = new Date()
    const inFirst45Min = !this.windowManager.areEntryWindowsClosed(now)
    const hitNumber = position.stop_loss_hit_count + 1

    // Determine if we should disable market and close position
    let shouldDisableMarket = false
    let shouldClosePosition = false

    if (inFirst45Min) {
      // During first 45 minutes (9:30-10:15)
      if (hitNumber >= 2) {
        // Second hit: disable market and close position
        shouldDisableMarket = true
        shouldClosePosition = true
      }
      // First hit: just increment counter, position stays open
    } else {
      // After 10:15 AM: any hit closes position
      shouldClosePosition = true
    }

    logger.log('StopLossMonitor: Stop loss hit detected', {
      position_id: position.id,
      instrument: position.instrument,
      currentPrice,
      stopLossPrice: position.stop_loss_price,
      direction: position.entry_direction,
      hitNumber,
      inFirst45Min,
      shouldDisableMarket,
      shouldClosePosition,
    })

    return {
      position_id: position.id,
      instrument: position.instrument,
      hit_time: now,
      current_price: currentPrice,
      stop_loss_price: position.stop_loss_price,
      hit_number: hitNumber,
      in_first_45_min: inFirst45Min,
      should_disable_market: shouldDisableMarket,
      should_close_position: shouldClosePosition,
    }
  }

  /**
   * Determine action after stop loss hit
   */
  determineAction(
    position: TradePosition,
    currentPrice: number
  ): {
    increment_counter: boolean
    close_position: boolean
    disable_market: boolean
    reason: string
  } | null {
    const hit = this.checkStopLossHit(position, currentPrice)
    if (!hit) {
      return null
    }

    return {
      increment_counter: true,
      close_position: hit.should_close_position,
      disable_market: hit.should_disable_market,
      reason: hit.in_first_45_min
        ? `Stop loss hit #${hit.hit_number} during entry window`
        : 'Stop loss hit after entry windows closed',
    }
  }

  /**
   * Validate stop loss price for a position
   */
  validateStopLossPrice(
    entryPrice: number,
    stopLossPrice: number,
    direction: EntryDirection
  ): boolean {
    if (entryPrice <= 0 || stopLossPrice <= 0) {
      logger.error('StopLossMonitor: Invalid prices', { entryPrice, stopLossPrice })
      return false
    }

    if (direction === 'LONG') {
      // For LONG: stop loss must be below entry
      if (stopLossPrice >= entryPrice) {
        logger.error('StopLossMonitor: LONG stop loss must be below entry', {
          entryPrice,
          stopLossPrice,
        })
        return false
      }
    } else {
      // For SHORT: stop loss must be above entry
      if (stopLossPrice <= entryPrice) {
        logger.error('StopLossMonitor: SHORT stop loss must be above entry', {
          entryPrice,
          stopLossPrice,
        })
        return false
      }
    }

    return true
  }

  /**
   * Calculate P&L on stop loss exit
   * CRITICAL: Guard against division by zero
   */
  calculateStopLossPnL(
    entryPrice: number,
    exitPrice: number,
    positionSize: number,
    direction: EntryDirection
  ): { profit_loss: number; profit_loss_percent: number } {
    // CRITICAL FIX: Prevent division by zero
    if (entryPrice <= 0 || positionSize <= 0) {
      logger.error('StopLossMonitor.calculateStopLossPnL: Invalid parameters', {
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

    const profitLossPercent = ((profitLoss / (entryPrice * positionSize)) * 100)

    return {
      profit_loss: Math.round(profitLoss * 100) / 100,
      profit_loss_percent: Math.round(profitLossPercent * 100) / 100,
    }
  }

  /**
   * Register position listener for real-time monitoring
   */
  registerListener(position_id: string): void {
    this.activeListeners.set(position_id, true)
    logger.debug('StopLossMonitor: Registered listener', { position_id })
  }

  /**
   * Unregister position listener
   */
  unregisterListener(position_id: string): void {
    this.activeListeners.delete(position_id)
    logger.debug('StopLossMonitor: Unregistered listener', { position_id })
  }

  /**
   * Check if position is actively monitored
   */
  isMonitored(position_id: string): boolean {
    return this.activeListeners.has(position_id)
  }
}

// Singleton instance
let stopLossMonitorInstance: StopLossMonitor | null = null

export function getStopLossMonitor(): StopLossMonitor {
  if (!stopLossMonitorInstance) {
    stopLossMonitorInstance = new StopLossMonitor()
  }
  return stopLossMonitorInstance
}
