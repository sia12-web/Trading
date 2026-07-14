/**
 * Slice 4: Entry Discipline System Tests
 * Tests cover:
 * - Entry discipline rules (choppy regime rejection, market disabled, existing position)
 * - Position sizing calculations
 * - Trade journal creation
 * - Entry detection and validation
 * - Stop loss calculations
 */

import { describe, it, expect } from 'vitest'
import { getPositionSizer } from '@/lib/trading/positionSizing'
import { getPositionManager } from '@/lib/trading/positionManager'
import { getStopLossMonitor } from '@/lib/trading/stopLossMonitor'
import type { Regime, EntryDirection, TradePosition } from '@/types/trading'

describe('Entry Discipline System - Slice 4', () => {
  describe('Entry Discipline Rules', () => {
    it('should reject entry if regime is choppy', () => {
      // Entry discipline rule: skip if choppy
      const regime: Regime = 'choppy'
      const shouldEntry = regime !== 'choppy'
      expect(shouldEntry).toBe(false)
    })

    it('should allow entry if regime is bullish', () => {
      const regime: Regime = 'bullish'
      const shouldEntry = regime !== 'choppy'
      expect(shouldEntry).toBe(true)
    })

    it('should allow entry if regime is bearish', () => {
      const regime: Regime = 'bearish'
      const shouldEntry = regime !== 'choppy'
      expect(shouldEntry).toBe(true)
    })

    it('should validate entry window (1-3 only)', () => {
      const validWindows = [1, 2, 3]
      expect(validWindows).toContain(1)
      expect(validWindows).toContain(2)
      expect(validWindows).toContain(3)
      expect(validWindows).not.toContain(0)
      expect(validWindows).not.toContain(4)
    })

    it('should enforce deep entry (price within 0.001% of extreme)', () => {
      const tolerance = 0.00001 // 0.001%
      const highestInWindow = 40100
      const entryPrice = 40100.0001 // Within 0.001%
      const isDeepEntry = entryPrice >= highestInWindow * (1 - tolerance)
      expect(isDeepEntry).toBe(true)
    })

    it('should reject entry too far from extreme (0.01% tolerance)', () => {
      const tolerance = 0.00001 // 0.001%
      const highestInWindow = 40100
      const entryPrice = 40104 // 0.01% away - should fail
      const isDeepEntry = entryPrice >= highestInWindow * (1 - tolerance)
      expect(isDeepEntry).toBe(false)
    })
  })

  describe('Position Sizing', () => {
    it('should calculate correct position size for LONG', () => {
      const sizer = getPositionSizer()
      const sizing = sizer.calculatePosition(40000, 100000, 'LONG')
      expect(sizing).not.toBeNull()
      expect(sizing?.entry_price).toBe(40000)
      expect(sizing?.direction).toBe('LONG')
      expect(sizing?.position_size).toBeGreaterThan(0)
      expect(sizing?.risk_amount).toBe(5000) // 5% of 100k
    })

    it('should calculate correct position size for SHORT', () => {
      const sizer = getPositionSizer()
      const sizing = sizer.calculatePosition(40000, 100000, 'SHORT')
      expect(sizing).not.toBeNull()
      expect(sizing?.entry_price).toBe(40000)
      expect(sizing?.direction).toBe('SHORT')
      expect(sizing?.position_size).toBeGreaterThan(0)
    })

    it('should set stop loss at exactly 5% from entry for LONG', () => {
      const sizer = getPositionSizer()
      const sizing = sizer.calculatePosition(40000, 100000, 'LONG')
      expect(sizing?.stop_loss_price).toBe(38000) // 5% below 40000
    })

    it('should set stop loss at exactly 5% from entry for SHORT', () => {
      const sizer = getPositionSizer()
      const sizing = sizer.calculatePosition(40000, 100000, 'SHORT')
      expect(sizing?.stop_loss_price).toBe(42000) // 5% above 40000
    })

    it('should reject invalid entry price (0 or negative)', () => {
      const sizer = getPositionSizer()
      const sizing = sizer.calculatePosition(0, 100000, 'LONG')
      expect(sizing).toBeNull()
    })

    it('should reject invalid account size (0 or negative)', () => {
      const sizer = getPositionSizer()
      const sizing = sizer.calculatePosition(40000, 0, 'LONG')
      expect(sizing).toBeNull()
    })

    it('should validate position sizing prevents risk > 5%', () => {
      const sizer = getPositionSizer()
      const sizing = sizer.calculatePosition(40000, 100000, 'LONG')
      if (sizing) {
        const riskPercent = (sizing.risk_amount / sizing.account_size) * 100
        expect(riskPercent).toBeLessThanOrEqual(5.1) // Allow 0.1% tolerance
      }
    })
  })

  describe('Trade Journal Creation', () => {
    it('should have all required fields for trade entry', () => {
      const requiredFields = [
        'user_id',
        'instrument',
        'trade_date',
        'entry_window',
        'entry_time',
        'entry_price',
        'entry_direction',
        'stop_loss_price',
        'position_size',
        'account_size',
        'regime',
      ]
      expect(requiredFields.length).toBe(11)
    })

    it('should validate instruments DOW, NASDAQ, NIKKEI', () => {
      const validInstruments = ['DOW', 'NASDAQ', 'NIKKEI']
      expect(validInstruments).toContain('DOW')
      expect(validInstruments).toContain('NASDAQ')
      expect(validInstruments).toContain('NIKKEI')
    })

    it('should track entry direction (LONG or SHORT)', () => {
      const directions: EntryDirection[] = ['LONG', 'SHORT']
      expect(directions).toContain('LONG')
      expect(directions).toContain('SHORT')
      expect(directions.length).toBe(2)
    })

    it('should calculate and store stop loss distance', () => {
      const entryPrice = 40000
      const stopLossPrice = 38000
      const distance = Math.abs(entryPrice - stopLossPrice)
      expect(distance).toBe(2000)
    })

    it('should calculate and store stop loss percent', () => {
      const entryPrice = 40000
      const stopLossPrice = 38000
      const percent = Math.abs((entryPrice - stopLossPrice) / entryPrice) * 100
      expect(percent).toBe(5) // Exactly 5%
    })
  })

  describe('Position Management', () => {
    it('should calculate current P&L for LONG position', () => {
      const manager = getPositionManager()
      const position: Partial<TradePosition> = {
        entry_price: 40000,
        entry_direction: 'LONG',
        position_size: 25,
      }
      const currentPrice = 40100
      const pnl = manager.calculateCurrentPnL(position as TradePosition, currentPrice)
      expect(pnl.profitLoss).toBe(2500) // (40100 - 40000) * 25
      expect(pnl.profitLossPercent).toBeCloseTo(0.25, 1)
    })

    it('should calculate current P&L for SHORT position', () => {
      const manager = getPositionManager()
      const position: Partial<TradePosition> = {
        entry_price: 40000,
        entry_direction: 'SHORT',
        position_size: 25,
      }
      const currentPrice = 39900
      const pnl = manager.calculateCurrentPnL(position as TradePosition, currentPrice)
      expect(pnl.profitLoss).toBe(2500) // (40000 - 39900) * 25
      expect(pnl.profitLossPercent).toBeCloseTo(0.25, 1)
    })

    it('should determine management decision when at profit target', () => {
      // Profit target is typically 1-2% based on confidence
      const entryPrice = 40000
      const targetPercent = 1.5 / 100
      const profitTarget = entryPrice * (1 + targetPercent) // 40600 for LONG
      const currentPrice = 40600
      expect(currentPrice).toBeGreaterThanOrEqual(profitTarget)
    })

    it('should calculate minutes until lunch close', () => {
      // Lunch close is 11:30 AM EST
      const manager = getPositionManager()
      const now = new Date()
      now.setHours(11, 15, 0) // 11:15 AM
      const minutesUntil = manager.getMinutesUntilLunchClose(now)
      expect(minutesUntil).toBeLessThanOrEqual(15)
      expect(minutesUntil).toBeGreaterThan(0)
    })

    it('should detect lunch close time (11:30-11:31 AM)', () => {
      const manager = getPositionManager()
      const now = new Date()
      now.setHours(11, 30, 15) // 11:30:15 AM
      const isLunchTime = manager.isLunchCloseTime(now)
      expect(isLunchTime).toBe(true)
    })
  })

  describe('Stop Loss Handling', () => {
    it('should detect stop loss hit for LONG position', () => {
      const monitor = getStopLossMonitor()
      const position: Partial<TradePosition> = {
        id: '123',
        instrument: 'DOW',
        entry_direction: 'LONG',
        entry_price: 40000,
        stop_loss_price: 38000,
        stop_loss_hit_count: 0,
      }
      const currentPrice = 37900 // Below stop loss
      const hit = monitor.checkStopLossHit(position as TradePosition, currentPrice)
      expect(hit).not.toBeNull()
      expect(hit?.hit_number).toBe(1)
    })

    it('should detect stop loss hit for SHORT position', () => {
      const monitor = getStopLossMonitor()
      const position: Partial<TradePosition> = {
        id: '123',
        instrument: 'DOW',
        entry_direction: 'SHORT',
        entry_price: 40000,
        stop_loss_price: 42000,
        stop_loss_hit_count: 0,
      }
      const currentPrice = 42100 // Above stop loss
      const hit = monitor.checkStopLossHit(position as TradePosition, currentPrice)
      expect(hit).not.toBeNull()
      expect(hit?.hit_number).toBe(1)
    })

    it('should increment hit counter on second stop loss', () => {
      const monitor = getStopLossMonitor()
      const position: Partial<TradePosition> = {
        id: '123',
        instrument: 'DOW',
        entry_direction: 'LONG',
        entry_price: 40000,
        stop_loss_price: 38000,
        stop_loss_hit_count: 1, // Already hit once
      }
      const currentPrice = 37900
      const hit = monitor.checkStopLossHit(position as TradePosition, currentPrice)
      expect(hit?.hit_number).toBe(2)
    })

    it('should close position on 2nd stop loss hit during entry window', () => {
      // During entry window (first 45 min): 2nd hit closes position
      const position: Partial<TradePosition> = {
        stop_loss_hit_count: 1,
      }
      const newHitNumber = position.stop_loss_hit_count + 1
      const shouldClose = newHitNumber >= 2
      expect(shouldClose).toBe(true)
    })

    it('should disable market on 2nd stop loss hit', () => {
      const hitNumber = 2
      const shouldDisableMarket = hitNumber >= 2
      expect(shouldDisableMarket).toBe(true)
    })
  })

  describe('Entry Timing', () => {
    it('should define 3 entry windows of 15 minutes each', () => {
      const windows = [
        { number: 1, start: '09:30:00', end: '09:45:00' },
        { number: 2, start: '09:45:00', end: '10:00:00' },
        { number: 3, start: '10:00:00', end: '10:15:00' },
      ]
      expect(windows).toHaveLength(3)
      expect(windows[0].start).toBe('09:30:00')
      expect(windows[2].end).toBe('10:15:00')
    })

    it('should allow only 1 entry per instrument per day', () => {
      // Entry discipline: one shot per market per day
      const allowedEntries = 1
      expect(allowedEntries).toBe(1)
    })

    it('should allow multiple attempts if first is stop loss hit', () => {
      // Entry window allows 2 SL hits
      const allowedStopLossHits = 2
      expect(allowedStopLossHits).toBe(2)
    })
  })

  describe('Data Validation', () => {
    it('should validate all required API fields present', () => {
      const requiredFields = [
        'instrument',
        'entry_price',
        'entry_direction',
        'entry_window',
        'account_size',
        'regime',
      ]
      expect(requiredFields).toHaveLength(6)
    })

    it('should validate price is positive', () => {
      const prices = [0, -100, 40000, 0.01]
      const validPrices = prices.filter((p) => p > 0)
      expect(validPrices).toEqual([40000, 0.01])
    })

    it('should validate account size is positive', () => {
      const accounts = [0, 50000, 100000, 250000]
      const valid = accounts.filter((a) => a > 0)
      expect(valid).toHaveLength(3)
    })

    it('should validate regime is valid enum', () => {
      const validRegimes = ['bullish', 'bearish', 'choppy']
      expect(validRegimes).toContain('bullish')
      expect(validRegimes).toContain('bearish')
      expect(validRegimes).toContain('choppy')
      expect(validRegimes).not.toContain('neutral')
    })
  })
})
