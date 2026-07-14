/**
 * Level Status Manager
 * Tracks distance from current price to key support/resistance levels
 * Maintains level status (unvisited, approaching, touched, broken, bounced)
 */

import type { Instrument } from '@/types/price-feed'

export interface LevelDistance {
  level: number
  currentPrice: number
  distance: number // absolute price difference
  distancePct: number // percentage from current price
  proximity: 'far' | 'approaching' | 'at' | 'breached'
}

export interface LevelStatus {
  level: number
  currentDistance: LevelDistance
  previousDistance: LevelDistance | null
  status: 'unvisited' | 'approaching' | 'touched' | 'broken' | 'bounced' | 'rejected'
  touchedAt: Date | null
  brokenAt: Date | null
  bounceCount: number
  lastTouchPrice: number | null
}

export interface LevelStatusUpdate {
  instrument: Instrument
  currentPrice: number
  changedLevels: Array<{
    level: number
    status: string
    previousStatus: string
    proximity: string
    distance: number
  }>
  timestamp: Date
}

// Predefined levels for each instrument (support/resistance, round numbers)
const PREDEFINED_LEVELS: Record<Instrument, number[]> = {
  DOW: [33000, 34000, 35000, 36000, 37000, 38000],
  NASDAQ: [13000, 14000, 15000, 16000, 17000, 18000],
  NIKKEI: [26000, 27000, 28000, 29000, 30000, 31000],
}

/**
 * Calculate distance from current price to a level
 * CRITICAL: Guard against division by zero
 */
function calculateDistance(currentPrice: number, level: number): LevelDistance {
  // CRITICAL FIX: Prevent division by zero
  if (currentPrice <= 0) {
    throw new Error(`Invalid price in calculateDistance: ${currentPrice}. Price must be > 0.`)
  }

  const distance = Math.abs(currentPrice - level)
  const distancePct = (distance / currentPrice) * 100

  let proximity: 'far' | 'approaching' | 'at' | 'breached'

  if (distance < currentPrice * 0.001) {
    // Within 0.1% of level (at/breached)
    proximity = 'breached'
  } else if (distance < currentPrice * 0.01) {
    // Within 1% of level
    proximity = 'at'
  } else if (distance < currentPrice * 0.05) {
    // Within 5% of level (approaching)
    proximity = 'approaching'
  } else {
    proximity = 'far'
  }

  return {
    level,
    currentPrice,
    distance,
    distancePct,
    proximity,
  }
}

/**
 * Update level status based on price movement
 */
function updateLevelStatus(
  current: LevelStatus,
  newDistance: LevelDistance,
  previousPrice: number | null
): LevelStatus {
  const currentPrice = newDistance.currentPrice

  // Determine if level was "touched" (price crossed it)
  const touched =
    previousPrice !== null &&
    ((previousPrice < current.level && currentPrice >= current.level) ||
      (previousPrice > current.level && currentPrice <= current.level))

  // Determine if level was "broken" (price moved beyond it decisively)
  const broken = newDistance.proximity === 'breached' && current.status !== 'broken'

  let newStatus = current.status

  if (broken) {
    newStatus = 'broken'
  } else if (touched) {
    // When price touches a level after breaking through it, it's a bounce
    if (current.status === 'broken') {
      newStatus = 'bounced'
    } else {
      newStatus = 'touched'
    }
  } else if (newDistance.proximity === 'approaching') {
    if (current.status === 'unvisited') {
      newStatus = 'approaching'
    }
  }

  return {
    ...current,
    currentDistance: newDistance,
    previousDistance: current.currentDistance,
    status: newStatus,
    touchedAt: touched ? new Date() : current.touchedAt,
    brokenAt: broken ? new Date() : current.brokenAt,
    // Increment bounceCount on every touch after a break (current.status is 'broken' OR 'bounced')
    bounceCount:
      touched && (current.status === 'broken' || current.status === 'bounced')
        ? current.bounceCount + 1
        : current.bounceCount,
    lastTouchPrice: touched ? currentPrice : current.lastTouchPrice,
  }
}

export class LevelStatusManager {
  private levelStates: Map<Instrument, Map<number, LevelStatus>> = new Map()
  private lastPrices: Map<Instrument, number> = new Map()
  private updateCallbacks: Set<(update: LevelStatusUpdate) => void> = new Set()

  /**
   * Register callback for level status updates
   */
  onLevelStatusUpdate(
    callback: (update: LevelStatusUpdate) => void
  ): () => void {
    this.updateCallbacks.add(callback)
    return () => this.updateCallbacks.delete(callback)
  }

  /**
   * Update level statuses based on new price
   * Returns levels that changed status
   */
  updateForPrice(instrument: Instrument, currentPrice: number): LevelStatus[] {
    const levels = PREDEFINED_LEVELS[instrument] || []
    const previousPrice = this.lastPrices.get(instrument)

    if (!this.levelStates.has(instrument)) {
      this.levelStates.set(instrument, new Map())
    }

    const instrumentLevels = this.levelStates.get(instrument)!
    const changedStatuses: LevelStatus[] = []

    for (const level of levels) {
      const distance = calculateDistance(currentPrice, level)
      let status = instrumentLevels.get(level)

      if (!status) {
        // Initialize new level
        status = {
          level,
          currentDistance: distance,
          previousDistance: null,
          status: 'unvisited',
          touchedAt: null,
          brokenAt: null,
          bounceCount: 0,
          lastTouchPrice: null,
        }
      } else {
        // Update existing level
        const previousStatus = status.status
        status = updateLevelStatus(status, distance, previousPrice ?? currentPrice)

        // Track if status actually changed
        if (previousStatus !== status.status) {
          changedStatuses.push(status)
        }
      }

      instrumentLevels.set(level, status)
    }

    this.lastPrices.set(instrument, currentPrice)

    // Emit update event if anything changed
    if (changedStatuses.length > 0) {
      const update: LevelStatusUpdate = {
        instrument,
        currentPrice,
        changedLevels: changedStatuses.map((s) => ({
          level: s.level,
          status: s.status,
          previousStatus: s.previousDistance ? 'previous' : 'unvisited',
          proximity: s.currentDistance.proximity,
          distance: s.currentDistance.distance,
        })),
        timestamp: new Date(),
      }

      this.updateCallbacks.forEach((callback) => callback(update))
    }

    return changedStatuses
  }

  /**
   * Get all levels for an instrument
   */
  getLevels(instrument: Instrument): LevelStatus[] {
    return Array.from(this.levelStates.get(instrument)?.values() || [])
  }

  /**
   * Get only critical levels (not unvisited or far)
   */
  getCriticalLevels(instrument: Instrument): LevelStatus[] {
    const statuses = this.getLevels(instrument)
    return statuses.filter(
      (s) => s.status !== 'unvisited' && s.currentDistance.proximity !== 'far'
    )
  }

  /**
   * Get current price for an instrument
   */
  getCurrentPrice(instrument: Instrument): number | undefined {
    return this.lastPrices.get(instrument)
  }

  /**
   * Reset all tracking (for testing)
   */
  reset(): void {
    this.levelStates.clear()
    this.lastPrices.clear()
  }
}

// Singleton instance
let levelStatusManagerInstance: LevelStatusManager | null = null

export function getLevelStatusManager(): LevelStatusManager {
  if (!levelStatusManagerInstance) {
    levelStatusManagerInstance = new LevelStatusManager()
  }
  if (!levelStatusManagerInstance) {
    throw new Error('Failed to initialize LevelStatusManager')
  }
  return levelStatusManagerInstance
}
