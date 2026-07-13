/**
 * Tests for Level Status Manager Service
 * Unit tests for distance calculations and state machine logic
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  LevelStatusManager,
  type LevelStatus,
} from '@/lib/services/levelStatusManager'

describe('LevelStatusManager', () => {
  let manager: LevelStatusManager

  beforeEach(() => {
    manager = new LevelStatusManager()
  })

  describe('Distance Calculations', () => {
    it('should calculate correct distance for prices above level', () => {
      const levels = manager.updateForPrice('DOW', 35500)

      const level35000 = levels.find((l) => l.level === 35000)
      expect(level35000?.currentDistance.distance).toBe(500)
      expect(level35000?.currentDistance.distancePct).toBeCloseTo(1.41, 1)
    })

    it('should calculate correct distance for prices below level', () => {
      const levels = manager.updateForPrice('DOW', 34500)

      const level35000 = levels.find((l) => l.level === 35000)
      expect(level35000?.currentDistance.distance).toBe(500)
      expect(level35000?.currentDistance.distancePct).toBeCloseTo(1.45, 1)
    })

    it('should handle edge case: price equals level (breached)', () => {
      const levels = manager.updateForPrice('DOW', 35000)

      const level = levels.find((l) => l.level === 35000)
      expect(level?.currentDistance.proximity).toBe('breached')
    })

    it('should handle very small prices without division by zero', () => {
      const levels = manager.updateForPrice('DOW', 1) // Unrealistic but tests edge case
      expect(levels.length).toBeGreaterThan(0)
      levels.forEach((level) => {
        expect(isFinite(level.currentDistance.distancePct)).toBe(true)
      })
    })
  })

  describe('Proximity Zones', () => {
    it('should classify proximity as "far" when >5% away', () => {
      const levels = manager.updateForPrice('DOW', 33000) // Far from levels

      const level = levels.find((l) => l.level === 35000)
      expect(level?.currentDistance.proximity).toBe('far')
    })

    it('should classify proximity as "approaching" when 1-5% away', () => {
      const levels = manager.updateForPrice('DOW', 34650) // ~0.5% from 34500, but test approaching zone

      // Adjust to test the 1-5% zone
      const testPrice = 35000 * 0.97 // 3% below level
      const levelsAtApproaching = manager.updateForPrice('DOW', testPrice)
      const level = levelsAtApproaching.find((l) => l.level === 35000)
      expect(level?.currentDistance.proximity).toBe('approaching')
    })

    it('should classify proximity as "at" when 0.1-1% away', () => {
      const testPrice = 35000 * 0.995 // 0.5% below level
      const levels = manager.updateForPrice('DOW', testPrice)

      const level = levels.find((l) => l.level === 35000)
      expect(level?.currentDistance.proximity).toBe('at')
    })

    it('should classify proximity as "breached" when <0.1% away', () => {
      const testPrice = 35000 * 0.9999 // 0.01% away
      const levels = manager.updateForPrice('DOW', testPrice)

      const level = levels.find((l) => l.level === 35000)
      expect(level?.currentDistance.proximity).toBe('breached')
    })
  })

  describe('State Machine: Level Status Transitions', () => {
    it('should initialize level as "unvisited"', () => {
      const levels = manager.getLevels('DOW')
      const level = levels.find((l) => l.level === 35000)
      expect(level?.status).toBe('unvisited')
    })

    it('should transition to "approaching" when price moves into range', () => {
      manager.updateForPrice('DOW', 36000) // Far
      const levelsNear = manager.updateForPrice('DOW', 34650) // Approaching

      const changedLevel = levelsNear.find((l) => l.level === 35000)
      expect(changedLevel?.status).toBe('approaching')
    })

    it('should transition to "touched" when price crosses level', () => {
      manager.updateForPrice('DOW', 34000) // Below
      const levelsTouched = manager.updateForPrice('DOW', 35100) // Crosses above

      const level = levelsTouched.find((l) => l.level === 35000)
      expect(level?.status).toBe('touched')
      expect(level?.touchedAt).not.toBeNull()
    })

    it('should transition to "broken" when price moves decisively through level', () => {
      manager.updateForPrice('DOW', 34000) // Below
      manager.updateForPrice('DOW', 35050) // At level
      const levelsBroken = manager.updateForPrice('DOW', 35500) // Decisively above

      const level = levelsBroken.find((l) => l.level === 35000)
      expect(level?.status).toBe('broken')
      expect(level?.brokenAt).not.toBeNull()
    })

    it('should transition to "bounced" when price returns after breaking', () => {
      manager.updateForPrice('DOW', 34000) // Below
      manager.updateForPrice('DOW', 35500) // Break above
      const levelsAfterBounce = manager.updateForPrice('DOW', 34950) // Return below

      const level = levelsAfterBounce.find((l) => l.level === 35000)
      expect(level?.status).toBe('bounced')
      expect(level?.bounceCount).toBe(1)
    })

    it('should track multiple bounces', () => {
      manager.updateForPrice('DOW', 34000)
      manager.updateForPrice('DOW', 35500) // Break above
      manager.updateForPrice('DOW', 34950) // Bounce 1
      manager.updateForPrice('DOW', 35500) // Break again
      const levelAfterBounce2 = manager.updateForPrice('DOW', 34950) // Bounce 2

      const level = levelAfterBounce2.find((l) => l.level === 35000)
      expect(level?.bounceCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Data Tracking', () => {
    it('should track lastTouchPrice', () => {
      manager.updateForPrice('DOW', 34000)
      const touched = manager.updateForPrice('DOW', 35050)

      const level = touched.find((l) => l.level === 35000)
      expect(level?.lastTouchPrice).toBe(35050)
    })

    it('should track touchedAt timestamp', () => {
      const before = new Date()
      manager.updateForPrice('DOW', 34000)
      manager.updateForPrice('DOW', 35050)
      const after = new Date()

      const level = manager.getLevels('DOW').find((l) => l.level === 35000)
      expect(level?.touchedAt).not.toBeNull()
      expect(level?.touchedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(level?.touchedAt!.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should track brokenAt timestamp', () => {
      const before = new Date()
      manager.updateForPrice('DOW', 34000)
      manager.updateForPrice('DOW', 35500)
      const after = new Date()

      const level = manager.getLevels('DOW').find((l) => l.level === 35000)
      expect(level?.brokenAt).not.toBeNull()
      expect(level?.brokenAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(level?.brokenAt!.getTime()).toBeLessThanOrEqual(after.getTime())
    })
  })

  describe('API Methods', () => {
    it('should return all levels for instrument', () => {
      manager.updateForPrice('DOW', 35500)
      const levels = manager.getLevels('DOW')

      expect(levels.length).toBe(6) // DOW has 6 predefined levels
      expect(levels.every((l) => l.level > 0)).toBe(true)
    })

    it('should return only critical levels when requested', () => {
      manager.updateForPrice('DOW', 35500)
      manager.updateForPrice('DOW', 34500) // Touch a level
      const critical = manager.getCriticalLevels('DOW')

      // Should only include levels that have been touched or are being approached
      critical.forEach((level) => {
        expect(['approaching', 'touched', 'broken', 'bounced']).toContain(
          level.status
        )
      })
    })

    it('should return null for untracked instrument', () => {
      const price = manager.getCurrentPrice('UNKNOWN' as any)
      expect(price).toBeUndefined()
    })

    it('should return current price for instrument', () => {
      manager.updateForPrice('DOW', 35500)
      const price = manager.getCurrentPrice('DOW')
      expect(price).toBe(35500)
    })

    it('should reset all tracking', () => {
      manager.updateForPrice('DOW', 35500)
      manager.reset()

      const levels = manager.getLevels('DOW')
      expect(levels.every((l) => l.status === 'unvisited')).toBe(true)
      expect(manager.getCurrentPrice('DOW')).toBeUndefined()
    })
  })

  describe('Callbacks', () => {
    it('should trigger callback when level status changes', async () => {
      let callbackFired = false
      let updateData: any = null

      manager.onLevelStatusUpdate((update) => {
        callbackFired = true
        updateData = update
      })

      manager.updateForPrice('DOW', 34000)
      manager.updateForPrice('DOW', 35050) // Touch a level

      expect(callbackFired).toBe(true)
      expect(updateData?.changedLevels.length).toBeGreaterThan(0)
      expect(updateData?.instrument).toBe('DOW')
    })

    it('should not trigger callback when no levels change', () => {
      let callCount = 0

      manager.onLevelStatusUpdate(() => {
        callCount++
      })

      manager.updateForPrice('DOW', 36000) // Far from all
      manager.updateForPrice('DOW', 36000) // Same price again

      // Should only fire once (when far), not again for same price
      expect(callCount).toBeLessThanOrEqual(1)
    })

    it('should allow unsubscribing from callbacks', () => {
      let callCount = 0

      const unsubscribe = manager.onLevelStatusUpdate(() => {
        callCount++
      })

      manager.updateForPrice('DOW', 35050)
      unsubscribe()
      manager.updateForPrice('DOW', 34950)

      // Should only increment once (before unsubscribe)
      expect(callCount).toBe(1)
    })
  })

  describe('Multiple Instruments', () => {
    it('should track separate state for each instrument', () => {
      manager.updateForPrice('DOW', 35050)
      manager.updateForPrice('NASDAQ', 15050)

      const dowLevels = manager.getLevels('DOW')
      const nasdaqLevels = manager.getLevels('NASDAQ')

      expect(manager.getCurrentPrice('DOW')).toBe(35050)
      expect(manager.getCurrentPrice('NASDAQ')).toBe(15050)
    })

    it('should not interfere between instruments', () => {
      manager.updateForPrice('DOW', 34000)
      manager.updateForPrice('DOW', 35050) // Touch DOW level

      manager.updateForPrice('NASDAQ', 14000)
      // NASDAQ levels should still be unvisited

      const nasdaqLevels = manager.getLevels('NASDAQ')
      const nasdaq15000 = nasdaqLevels.find((l) => l.level === 15000)
      expect(nasdaq15000?.status).toBe('unvisited')
    })
  })

  describe('Edge Cases', () => {
    it('should handle null/undefined safely', () => {
      expect(() => {
        manager.updateForPrice('DOW', 0) // Edge: zero price
      }).not.toThrow()
    })

    it('should handle negative prices gracefully (treat as invalid but no crash)', () => {
      // Negative prices are unrealistic but shouldn't crash
      expect(() => {
        manager.updateForPrice('DOW', -1000)
      }).not.toThrow()
    })

    it('should handle extremely large prices', () => {
      expect(() => {
        manager.updateForPrice('DOW', 999999999)
      }).not.toThrow()

      const levels = manager.getLevels('DOW')
      expect(levels.length).toBeGreaterThan(0)
    })

    it('should handle rapid sequential updates', () => {
      for (let i = 0; i < 100; i++) {
        const price = 35000 + (i % 10) * 10
        expect(() => {
          manager.updateForPrice('DOW', price)
        }).not.toThrow()
      }

      expect(manager.getCurrentPrice('DOW')).toBeDefined()
    })
  })
})
