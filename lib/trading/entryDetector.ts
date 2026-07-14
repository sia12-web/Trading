/**
 * Entry detection system
 * Monitors price during entry windows and detects deep entry triggers
 * Deep entry = lowest (SHORT) or highest (LONG) price touched within window
 */

import { logger } from '@/lib/utils/logger'
import type { EntryWindow, EntryDirection, Regime, EntryDetectionEvent } from '@/types/trading'
import { getWindowManager } from './windowManager'

interface WindowPriceState {
  lowestPrice: number | null
  highestPrice: number | null
  lowestTime: Date | null
  highestTime: Date | null
}

export class EntryDetector {
  private windowPriceStates: Map<EntryWindow, WindowPriceState> = new Map()
  private currentWindow: EntryWindow | null = null
  private entryDetectedInWindow: Set<EntryWindow> = new Set()
  private windowManager = getWindowManager()
  // Track when entry was detected to prevent duplicate signals within 1 second
  private lastEntryDetectionTime: Map<EntryWindow, number> = new Map()

  /**
   * Track a price point within the current window
   */
  trackPrice(price: number, timestamp: Date = new Date()): EntryDetectionEvent | null {
    if (price <= 0) {
      logger.error('EntryDetector: Invalid price', { price })
      return null
    }

    // Check if we've moved to a new window
    const window = this.windowManager.getCurrentWindow(timestamp)
    if (window && window !== this.currentWindow) {
      this.resetForNewWindow(window)
    }

    if (!window) {
      logger.debug('EntryDetector: Outside trading windows')
      return null
    }

    // Skip if entry already detected in this window
    if (this.entryDetectedInWindow.has(window)) {
      return null
    }

    // Update price state for current window
    const state = this.getOrCreateWindowState(window)
    this.updateWindowState(state, price, timestamp)

    return null // Entry detection happens separately based on regime
  }

  /**
   * Detect entry trigger based on regime and current prices
   * For LONG (bullish): Trigger when price touches highest in window
   * For SHORT (bearish): Trigger when price touches lowest in window
   * NOTE: Single-user system - concurrent requests are not expected
   */
  detectEntryTrigger(
    price: number,
    regime: Regime,
    direction: EntryDirection,
    timestamp: Date = new Date()
  ): EntryDetectionEvent | null {
    const window = this.windowManager.getCurrentWindow(timestamp)
    if (!window) return null

    // Check if entry already detected in this window
    if (this.entryDetectedInWindow.has(window)) {
      // Safety check: prevent duplicate signals within 1 second
      const lastDetectionTime = this.lastEntryDetectionTime.get(window)
      if (lastDetectionTime && Date.now() - lastDetectionTime < 1000) {
        return null // Duplicate signal within 1 second, skip
      }
    }

    const state = this.windowPriceStates.get(window)
    if (!state) return null

    // Skip entry if regime is choppy
    if (regime === 'choppy') {
      logger.debug('EntryDetector: Choppy regime, skipping entry', { window })
      return null
    }

    let entryTriggered = false
    let reason = ''

    // CRITICAL FIX: Tighten tolerance to 0.001% (was 0.01% which is too loose)
    // Price must be extremely close to extreme to trigger entry
    const ENTRY_TOLERANCE = 0.00001 // 0.001% tolerance

    if (direction === 'LONG' && state.highestPrice !== null) {
      // For LONG: Trigger when price reaches (touches) the highest in window
      // Must be within 0.001% of highest
      if (price >= state.highestPrice * (1 - ENTRY_TOLERANCE)) {
        entryTriggered = true
        reason = `Highest price ${state.highestPrice} reached in window`
      }
    } else if (direction === 'SHORT' && state.lowestPrice !== null) {
      // For SHORT: Trigger when price reaches (touches) the lowest in window
      // Must be within 0.001% of lowest
      if (price <= state.lowestPrice * (1 + ENTRY_TOLERANCE)) {
        entryTriggered = true
        reason = `Lowest price ${state.lowestPrice} reached in window`
      }
    }

    if (entryTriggered) {
      this.entryDetectedInWindow.add(window)
      this.lastEntryDetectionTime.set(window, Date.now())
      logger.log('EntryDetector: Deep entry detected', {
        window,
        price,
        direction,
        regime,
        reason,
      })

      return {
        instrument: 'DOW', // Will be set by caller
        window_number: window,
        entry_time: timestamp.toISOString(),
        entry_price: price,
        direction,
        detected_at: new Date().toISOString(),
        reason,
      }
    }

    return null
  }

  /**
   * Get current price state for a window
   */
  getWindowPriceState(window: EntryWindow): WindowPriceState | null {
    return this.windowPriceStates.get(window) || null
  }

  /**
   * Get lowest price in window
   */
  getLowestInWindow(window: EntryWindow): number | null {
    return this.windowPriceStates.get(window)?.lowestPrice || null
  }

  /**
   * Get highest price in window
   */
  getHighestInWindow(window: EntryWindow): number | null {
    return this.windowPriceStates.get(window)?.highestPrice || null
  }

  /**
   * Check if entry already detected in window
   */
  isEntryDetectedInWindow(window: EntryWindow): boolean {
    return this.entryDetectedInWindow.has(window)
  }

  /**
   * Reset detector for new window
   */
  private resetForNewWindow(window: EntryWindow): void {
    if (this.currentWindow && this.currentWindow !== window) {
      logger.debug('EntryDetector: Moving to new window', { from: this.currentWindow, to: window })
    }

    this.currentWindow = window

    // Clear detected flags for new window
    if (!this.entryDetectedInWindow.has(window)) {
      this.windowPriceStates.set(window, {
        lowestPrice: null,
        highestPrice: null,
        lowestTime: null,
        highestTime: null,
      })
    }
  }

  /**
   * Get or create price state for window
   */
  private getOrCreateWindowState(window: EntryWindow): WindowPriceState {
    let state = this.windowPriceStates.get(window)
    if (!state) {
      state = {
        lowestPrice: null,
        highestPrice: null,
        lowestTime: null,
        highestTime: null,
      }
      this.windowPriceStates.set(window, state)
    }
    return state
  }

  /**
   * Update price state with new price point
   */
  private updateWindowState(state: WindowPriceState, price: number, timestamp: Date): void {
    // Update lowest
    if (state.lowestPrice === null || price < state.lowestPrice) {
      state.lowestPrice = price
      state.lowestTime = timestamp
    }

    // Update highest
    if (state.highestPrice === null || price > state.highestPrice) {
      state.highestPrice = price
      state.highestTime = timestamp
    }
  }
}

// Singleton instance
let entryDetectorInstance: EntryDetector | null = null

export function getEntryDetector(): EntryDetector {
  if (!entryDetectorInstance) {
    entryDetectorInstance = new EntryDetector()
  }
  return entryDetectorInstance
}
