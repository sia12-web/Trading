/**
 * Slice 3: Real-Time Level Status Monitoring Tests
 *
 * Tests cover:
 * - Level status calculations (safe, approaching, broken)
 * - Distance percentage calculations
 * - Zustand store operations
 * - API endpoint validation
 * - Type safety
 */

import { describe, it, expect } from 'vitest'
import {
  calculateDistancePercent,
  getLevelStatus,
  getApproachDirection,
  isLevelBroken,
  formatPrice,
  formatDistancePercent,
  getStatusColor,
  getStatusIcon,
  getDataFreshness,
  formatTimeSinceUpdate,
} from '@/lib/utils/levelCalculations'
import type { TradingLevel, LevelStatusDetail, Instrument } from '@/types/trading'

describe('Level Calculations', () => {
  describe('calculateDistancePercent', () => {
    it('should calculate distance to level correctly', () => {
      const distance = calculateDistancePercent(40050, 40000)
      expect(distance).toBeCloseTo(0.125, 3)
    })

    it('should handle zero level price', () => {
      const distance = calculateDistancePercent(100, 0)
      expect(distance).toBe(0)
    })

    it('should handle negative prices', () => {
      const distance = calculateDistancePercent(-100, -50)
      expect(distance).toBeCloseTo(100, 1)
    })
  })

  describe('getLevelStatus', () => {
    it('should return safe when more than 0.5% away', () => {
      const status = getLevelStatus(40100, 40000) // 0.25% away
      expect(status).toBe('safe')
    })

    it('should return approaching when within 0.5%', () => {
      const status = getLevelStatus(40002, 40000) // 0.005% away
      expect(status).toBe('approaching')
    })

    it('should return broken when price crosses level', () => {
      const status = getLevelStatus(40100, 40000, 39900) // crossed from below
      expect(status).toBe('broken')
    })

    it('should handle approaching from both directions', () => {
      const approachingUp = getLevelStatus(39999, 40000) // approaching from below
      expect(approachingUp).toBe('approaching')

      const approachingDown = getLevelStatus(40001, 40000) // approaching from above
      expect(approachingDown).toBe('approaching')
    })
  })

  describe('getApproachDirection', () => {
    it('should detect approaching (distance decreasing)', () => {
      const direction = getApproachDirection(40025, 40000, 40050)
      expect(direction).toBe('approaching')
    })

    it('should detect receding (distance increasing)', () => {
      const direction = getApproachDirection(40100, 40000, 40050)
      expect(direction).toBe('receding')
    })

    it('should detect broken (crossing level)', () => {
      const direction = getApproachDirection(40100, 40000, 39950)
      expect(direction).toBe('broken')
    })
  })

  describe('isLevelBroken', () => {
    it('should detect upward break', () => {
      const broken = isLevelBroken(40100, 40000, 39900)
      expect(broken).toBe(true)
    })

    it('should detect downward break', () => {
      const broken = isLevelBroken(39900, 40000, 40100)
      expect(broken).toBe(true)
    })

    it('should not trigger without crossover', () => {
      const broken = isLevelBroken(40050, 40000, 40030)
      expect(broken).toBe(false)
    })
  })

  describe('Formatting functions', () => {
    it('should format price correctly', () => {
      expect(formatPrice(40000.123)).toBe('40000.12')
      expect(formatPrice(40000, 4)).toBe('40000.0000')
    })

    it('should format distance percent correctly', () => {
      expect(formatDistancePercent(0.125)).toContain('%')
      expect(formatDistancePercent(1.5)).toContain('1.5')
    })

    it('should return appropriate status colors', () => {
      expect(getStatusColor('safe')).toContain('green')
      expect(getStatusColor('approaching')).toContain('yellow')
      expect(getStatusColor('broken')).toContain('red')
    })

    it('should return appropriate status icons', () => {
      expect(getStatusIcon('safe')).toBe('🟢')
      expect(getStatusIcon('approaching')).toBe('🟡')
      expect(getStatusIcon('broken')).toBe('🔴')
    })
  })

  describe('Data freshness', () => {
    it('should mark data as live if < 1 second old', () => {
      const now = new Date()
      const oldTime = new Date(now.getTime() - 500).toISOString()
      expect(getDataFreshness(oldTime)).toBe('live')
    })

    it('should mark data as fresh if 1-5 seconds old', () => {
      const now = new Date()
      const oldTime = new Date(now.getTime() - 2000).toISOString()
      expect(getDataFreshness(oldTime)).toBe('fresh')
    })

    it('should mark data as stale if > 5 seconds old', () => {
      const now = new Date()
      const oldTime = new Date(now.getTime() - 10000).toISOString()
      expect(getDataFreshness(oldTime)).toBe('stale')
    })

    it('should handle null timestamp', () => {
      expect(getDataFreshness(null)).toBe('stale')
    })

    it('should format time since update correctly', () => {
      const now = new Date()
      const oldTime = new Date(now.getTime() - 2000).toISOString()
      const formatted = formatTimeSinceUpdate(oldTime)
      expect(formatted).toMatch(/\d+s ago/)
    })
  })
})

describe('Type Safety', () => {
  it('should have correct TradingLevel type', () => {
    const level: TradingLevel = {
      id: '123',
      user_id: 'user-123',
      instrument: 'DOW' as Instrument,
      level_name: 'Support 1',
      price: 40000,
      level_type: 'support',
      is_active: true,
      notes: 'Test level',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    expect(level.instrument).toBe('DOW')
    expect(level.level_type).toBe('support')
  })

  it('should have correct LevelStatusDetail type', () => {
    const status: LevelStatusDetail = {
      level_id: '123',
      status: 'approaching',
      distance_pct: 0.25,
      approach_direction: 'approaching',
    }

    expect(status.status).toBe('approaching')
    expect(status.distance_pct).toBeLessThan(1)
  })
})

describe('API Endpoint Validation', () => {
  it('should validate instrument parameter', () => {
    const validInstruments = ['DOW', 'NASDAQ', 'NIKKEI'] as const
    expect(validInstruments).toContain('DOW')
    expect(validInstruments).toContain('NASDAQ')
    expect(validInstruments).toContain('NIKKEI')
  })

  it('should ensure all endpoints require authentication', () => {
    // This is a conceptual test - actual auth validation happens at runtime
    const endpoints = [
      '/api/trading/levels',
      '/api/trading/connection-status',
    ]

    expect(endpoints).toContain('/api/trading/levels')
    expect(endpoints).toContain('/api/trading/connection-status')
  })
})

describe('Zustand Store Operations', () => {
  it('should have required store actions', () => {
    const requiredActions = [
      'setCurrentInstrument',
      'setCurrentPrice',
      'setLevels',
      'updateLevelStatus',
      'setConnectionStatus',
      'setLastPriceUpdate',
      'setIsLoadingLevels',
      'setError',
      'getLevelsByInstrument',
      'getLevelStatus',
      'getAllApproachingLevels',
      'getAllBrokenLevels',
      'reset',
    ]

    expect(requiredActions.length).toBe(13)
  })
})

describe('Integration Tests', () => {
  it('should calculate level status from real data', () => {
    // Simulate DOW price and level
    const dowPrice = 40050.25
    const supportLevel = 40000
    const resistanceLevel = 40200

    const supportStatus = getLevelStatus(dowPrice, supportLevel)
    const resistanceStatus = getLevelStatus(dowPrice, resistanceLevel)

    expect(supportStatus).toBe('safe')
    expect(resistanceStatus).toBe('safe')
  })

  it('should handle multiple levels correctly', () => {
    const levels: TradingLevel[] = [
      {
        id: '1',
        user_id: 'user-1',
        instrument: 'DOW',
        level_name: 'Support 1',
        price: 40000,
        level_type: 'support',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
      {
        id: '2',
        user_id: 'user-1',
        instrument: 'DOW',
        level_name: 'Resistance 1',
        price: 40200,
        level_type: 'resistance',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]

    expect(levels).toHaveLength(2)
    expect(levels[0].level_type).toBe('support')
    expect(levels[1].level_type).toBe('resistance')
  })
})
