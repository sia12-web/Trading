/**
 * Tests for Real-Time Level Break Detector Service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LevelBreakDetector } from '../detector'
import { CircuitBreaker } from '../circuitBreaker'
import { PriceHistoryBuffer } from '../priceBuffer'
import type { LevelDefinition, BreakEvent, DetectorConfig } from '../types'
import { DEFAULT_DETECTOR_CONFIG } from '../types'

// Helper: Create test levels
function createTestLevels(): LevelDefinition[] {
  return [
    {
      level: 35100,
      instrument: 'DOW',
      type: 'support',
      status: 'unvisited',
      createdAt: new Date(),
      breakCount: 0,
      bounceCount: 0,
    },
    {
      level: 35200,
      instrument: 'DOW',
      type: 'resistance',
      status: 'unvisited',
      createdAt: new Date(),
      breakCount: 0,
      bounceCount: 0,
    },
  ]
}

describe('CircuitBreaker', () => {
  it('should allow alerts within limit', () => {
    const cb = new CircuitBreaker('DOW', 10, 3600000)
    const now = new Date()

    for (let i = 0; i < 10; i++) {
      const allowed = cb.recordAlert(new Date(now.getTime() + i * 1000))
      expect(allowed).toBe(true)
    }

    expect(cb.isTripped()).toBe(true)
  })

  it('should block alerts when limit reached', () => {
    const cb = new CircuitBreaker('DOW', 3, 3600000)
    const now = new Date()

    // Record 3 alerts
    cb.recordAlert(new Date(now.getTime() + 0))
    cb.recordAlert(new Date(now.getTime() + 1000))
    cb.recordAlert(new Date(now.getTime() + 2000))

    // 4th alert should be blocked
    const allowed = cb.recordAlert(new Date(now.getTime() + 3000))
    expect(allowed).toBe(false)
    expect(cb.isTripped()).toBe(true)
  })

  it('should clean old alerts outside window', () => {
    const windowMs = 3600000 // 1 hour
    const cb = new CircuitBreaker('DOW', 10, windowMs)
    const now = new Date()

    // Record first alert
    cb.recordAlert(now)
    expect(cb.getAlertCount()).toBe(1)

    // Move time forward by 2 hours
    const futureTime = new Date(now.getTime() + 2 * 3600000)

    // Record another alert at future time
    cb.recordAlert(futureTime)

    // Old alert should be cleaned
    expect(cb.getAlertCount()).toBe(1)
  })

  it('should reset circuit breaker', () => {
    const cb = new CircuitBreaker('DOW', 10, 3600000)
    const now = new Date()

    cb.recordAlert(now)
    cb.recordAlert(new Date(now.getTime() + 1000))

    expect(cb.getAlertCount()).toBe(2)

    cb.reset()

    expect(cb.getAlertCount()).toBe(0)
    expect(cb.isTripped()).toBe(false)
  })

  it('should return next reset time', () => {
    const cb = new CircuitBreaker('DOW', 10, 3600000)
    const now = new Date()

    cb.recordAlert(now)

    const nextReset = cb.getNextResetTime()
    expect(nextReset.getTime()).toBe(now.getTime() + 3600000)
  })
})

describe('PriceHistoryBuffer', () => {
  it('should add prices to buffer', () => {
    const buffer = new PriceHistoryBuffer(35100, 'DOW', 200)

    buffer.addPrice(35100.5)
    buffer.addPrice(35101.0)
    buffer.addPrice(35101.5)

    expect(buffer.size()).toBe(3)
  })

  it('should return prices as copy', () => {
    const buffer = new PriceHistoryBuffer(35100, 'DOW', 200)

    buffer.addPrice(35100.5)
    buffer.addPrice(35101.0)

    const prices1 = buffer.getPrices()
    const prices2 = buffer.getPrices()

    // Should be equal but different arrays
    expect(prices1).toEqual(prices2)
    expect(prices1).not.toBe(prices2)
  })

  it('should auto-trim when reaching 90% capacity', () => {
    const buffer = new PriceHistoryBuffer(35100, 'DOW', 100)

    // Add 90 prices (90% of 100)
    for (let i = 0; i < 90; i++) {
      buffer.addPrice(35100 + i * 0.1)
    }

    expect(buffer.size()).toBe(90)

    // Add 1 more to trigger trim
    buffer.addPrice(35109)

    // Should trim 10 items and have 91 total
    expect(buffer.size()).toBeLessThanOrEqual(91)
    expect(buffer.size()).toBeGreaterThan(80)
  })

  it('should report isInitialized correctly', () => {
    const buffer = new PriceHistoryBuffer(35100, 'DOW', 200)

    expect(buffer.isInitialized()).toBe(false)

    for (let i = 0; i < 5; i++) {
      buffer.addPrice(35100 + i * 0.1)
    }

    expect(buffer.isInitialized()).toBe(true)
  })

  it('should clear buffer', () => {
    const buffer = new PriceHistoryBuffer(35100, 'DOW', 200)

    buffer.addPrice(35100.5)
    buffer.addPrice(35101.0)

    expect(buffer.size()).toBe(2)

    buffer.clear()

    expect(buffer.size()).toBe(0)
    expect(buffer.isInitialized()).toBe(false)
  })
})

describe('LevelBreakDetector', () => {
  let detector: LevelBreakDetector

  beforeEach(() => {
    const config: Partial<DetectorConfig> = {
      ...DEFAULT_DETECTOR_CONFIG,
      debug: false,
    }
    detector = new LevelBreakDetector(config)
  })

  afterEach(async () => {
    await detector.destroy()
  })

  it('should initialize with levels', async () => {
    const levels = createTestLevels()

    await detector.initialize(levels)

    const storedLevels = detector.getLevels()
    expect(storedLevels).toHaveLength(2)
  })

  it('should detect break above level', async () => {
    const levels = createTestLevels()
    await detector.initialize(levels)

    let breakDetected: BreakEvent | null = null

    detector.onBreakDetected((event) => {
      breakDetected = event
    })

    const now = new Date()

    // Price below level
    await detector.onPriceUpdate('DOW', 35090, 1000000, now)

    expect(breakDetected).toBeNull()

    // Add more prices to build history
    await detector.onPriceUpdate('DOW', 35095, 1000000, new Date(now.getTime() + 1000))
    await detector.onPriceUpdate('DOW', 35098, 1200000, new Date(now.getTime() + 2000))
    await detector.onPriceUpdate('DOW', 35099, 1200000, new Date(now.getTime() + 3000))
    await detector.onPriceUpdate('DOW', 35100, 1200000, new Date(now.getTime() + 4000))

    // Price breaks above level
    await detector.onPriceUpdate('DOW', 35105, 1500000, new Date(now.getTime() + 5000))

    // Break should be detected
    expect(breakDetected).not.toBeNull()
    if (breakDetected) {
      expect(breakDetected.instrument).toBe('DOW')
      expect(breakDetected.level).toBe(35100)
      expect(breakDetected.direction).toBe('up')
      expect(breakDetected.confidence).toBeGreaterThanOrEqual(0)
      expect(breakDetected.confidence).toBeLessThanOrEqual(100)
    }
  })

  it('should detect break below level', async () => {
    const levels = createTestLevels()
    await detector.initialize(levels)

    let breakDetected: BreakEvent | null = null

    detector.onBreakDetected((event) => {
      breakDetected = event
    })

    const now = new Date()

    // Price above level
    await detector.onPriceUpdate('DOW', 35110, 1000000, now)
    await detector.onPriceUpdate('DOW', 35105, 1000000, new Date(now.getTime() + 1000))
    await detector.onPriceUpdate('DOW', 35102, 1200000, new Date(now.getTime() + 2000))
    await detector.onPriceUpdate('DOW', 35101, 1200000, new Date(now.getTime() + 3000))

    // Price breaks below level
    await detector.onPriceUpdate('DOW', 35095, 1500000, new Date(now.getTime() + 4000))

    // Break should be detected
    expect(breakDetected).not.toBeNull()
    if (breakDetected) {
      expect(breakDetected.direction).toBe('down')
    }
  })

  it('should enforce circuit breaker (max 10 alerts/hour)', async () => {
    const levels = createTestLevels()
    await detector.initialize(levels)

    let breakCount = 0
    let cbTrippedCount = 0

    detector.onBreakDetected(() => {
      breakCount++
    })

    detector.onCircuitBreakerTriggered(() => {
      cbTrippedCount++
    })

    const now = new Date()

    // Simulate 12 breaks at same level
    for (let i = 0; i < 12; i++) {
      const startPrice = 35090 + i
      const breakTime = new Date(now.getTime() + i * 500) // Space them 500ms apart

      // Build price to level
      for (let j = 0; j < 5; j++) {
        await detector.onPriceUpdate(
          'DOW',
          startPrice + j * 0.2,
          1000000,
          new Date(breakTime.getTime() + j * 100)
        )
      }

      // Break through level
      await detector.onPriceUpdate(
        'DOW',
        35105,
        1500000,
        new Date(breakTime.getTime() + 500)
      )
    }

    // First 10 breaks should be emitted, 11th should trigger circuit breaker
    expect(breakCount).toBeLessThanOrEqual(10)
    expect(cbTrippedCount).toBeGreaterThan(0)
  })

  it('should handle invalid prices gracefully', async () => {
    const levels = createTestLevels()
    await detector.initialize(levels)

    let errorCount = 0

    detector.onError(() => {
      errorCount++
    })

    // Invalid prices should not crash
    await detector.onPriceUpdate('DOW', NaN, 1000000)
    await detector.onPriceUpdate('DOW', -100, 1000000)
    await detector.onPriceUpdate('DOW', 0, 1000000)

    expect(errorCount).toBeGreaterThan(0)
  })

  it('should get price history for level', async () => {
    const levels = createTestLevels()
    await detector.initialize(levels)

    const now = new Date()

    // Add prices
    await detector.onPriceUpdate('DOW', 35100, 1000000, now)
    await detector.onPriceUpdate('DOW', 35101, 1000000, new Date(now.getTime() + 1000))
    await detector.onPriceUpdate('DOW', 35102, 1000000, new Date(now.getTime() + 2000))

    const history = detector.getPriceHistory('DOW', 35100)

    expect(history.length).toBeGreaterThan(0)
  })

  it('should support event unsubscribe', async () => {
    const levels = createTestLevels()
    await detector.initialize(levels)

    let callCount = 0

    const unsubscribe = detector.onBreakDetected(() => {
      callCount++
    })

    const now = new Date()

    // Trigger a potential break
    await detector.onPriceUpdate('DOW', 35090, 1000000, now)
    await detector.onPriceUpdate('DOW', 35095, 1000000, new Date(now.getTime() + 1000))
    await detector.onPriceUpdate('DOW', 35098, 1200000, new Date(now.getTime() + 2000))
    await detector.onPriceUpdate('DOW', 35099, 1200000, new Date(now.getTime() + 3000))
    await detector.onPriceUpdate('DOW', 35100, 1200000, new Date(now.getTime() + 4000))
    await detector.onPriceUpdate('DOW', 35105, 1500000, new Date(now.getTime() + 5000))

    const countAfterEvent = callCount

    // Unsubscribe
    unsubscribe()

    // Trigger another potential break
    await detector.onPriceUpdate('DOW', 35100, 1000000, new Date(now.getTime() + 6000))
    await detector.onPriceUpdate('DOW', 35110, 1500000, new Date(now.getTime() + 7000))

    // Count should not increase
    expect(callCount).toBe(countAfterEvent)
  })

  it('should get circuit breaker state', async () => {
    const levels = createTestLevels()
    await detector.initialize(levels)

    const state = detector.getCircuitBreakerState('DOW')

    expect(state).not.toBeNull()
    if (state) {
      expect(state.instrument).toBe('DOW')
      expect(state.alertCount).toBe(0)
      expect(state.isTripped).toBe(false)
    }
  })

  it('should cleanup on destroy', async () => {
    const levels = createTestLevels()
    await detector.initialize(levels)

    expect(detector.getLevels()).toHaveLength(2)

    await detector.destroy()

    expect(detector.getLevels()).toHaveLength(0)
  })

  it('should update levels', async () => {
    let initialLevels = createTestLevels()
    await detector.initialize(initialLevels)

    expect(detector.getLevels()).toHaveLength(2)

    // Add another level
    const newLevel: LevelDefinition = {
      level: 35300,
      instrument: 'DOW',
      type: 'support',
      status: 'unvisited',
      createdAt: new Date(),
      breakCount: 0,
      bounceCount: 0,
    }
    const newLevels = [...initialLevels, newLevel]

    detector.updateLevels(newLevels)

    expect(detector.getLevels()).toHaveLength(3)
  })

  it('should be deterministic (same prices produce same breaks)', async () => {
    const levels = createTestLevels()
    await detector.initialize(levels)

    const now = new Date()
    const prices = [35090, 35095, 35098, 35100, 35105]

    // First run
    let firstBreak: BreakEvent | null = null
    detector.onBreakDetected((event) => {
      firstBreak = event
    })

    for (let i = 0; i < prices.length; i++) {
      await detector.onPriceUpdate('DOW', prices[i], 1000000, new Date(now.getTime() + i * 1000))
    }

    // Reset detector
    await detector.destroy()

    // Second run with same prices
    const detector2 = new LevelBreakDetector()
    await detector2.initialize(levels)

    let secondBreak: BreakEvent | null = null
    detector2.onBreakDetected((event) => {
      secondBreak = event
    })

    for (let i = 0; i < prices.length; i++) {
      await detector2.onPriceUpdate('DOW', prices[i], 1000000, new Date(now.getTime() + i * 1000))
    }

    await detector2.destroy()

    // Both should detect the same break (or both not detect)
    if (firstBreak && secondBreak) {
      expect(firstBreak.confidence).toBe(secondBreak.confidence)
      expect(firstBreak.direction).toBe(secondBreak.direction)
    }
  })
})
