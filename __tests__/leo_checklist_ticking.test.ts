import test from 'node:test'
import assert from 'node:assert'
import {
  normalizeArmedRule,
  type ArmedRule,
  type RuleConditionProgress,
} from '../lib/trading/leoRules'
import { detectCandlestickPatterns, type Candle } from '../lib/trading/candlestickPatterns'

test('Leo Condition Checklist - Normalizes and preserves conditionProgress', () => {
  const raw = {
    id: 'test-rule-1',
    type: 'MARKET_SITUATION',
    description: 'BUY 1x NASDAQ on Bullish Engulfing @ 21,500',
    instrument: 'NASDAQ',
    direction: 'LONG',
    conditions: {
      targetPrice: 21500,
      pattern: 'BULLISH_ENGULFING',
      entryTimeframe: '5',
      cvdDivergence: true,
      requireHighVolume: true,
      stopLossMode: 'BELOW_CANDLE_LOW',
      takeProfitMode: '1:2',
    },
    conditionProgress: {
      levelReached: true,
      levelReachedAt: 1700000000000,
      levelReachedPrice: 21498.5,
      patternConfirmed: false,
      cvdConfirmed: true,
      volumeConfirmed: false,
      timeframeConfirmed: true,
      sessionConfirmed: true,
    },
  }

  const normalized = normalizeArmedRule(raw, 'NASDAQ')
  assert.strictEqual(normalized.instrument, 'NASDAQ')
  assert.strictEqual(normalized.conditions.targetPrice, 21500)
  assert.strictEqual(normalized.conditions.pattern, 'BULLISH_ENGULFING')
  assert.strictEqual(normalized.conditions.entryTimeframe, '5')
  assert.strictEqual(normalized.conditions.cvdDivergence, true)

  assert.ok(normalized.conditionProgress)
  assert.strictEqual(normalized.conditionProgress?.levelReached, true)
  assert.strictEqual(normalized.conditionProgress?.levelReachedPrice, 21498.5)
  assert.strictEqual(normalized.conditionProgress?.patternConfirmed, false)
  assert.strictEqual(normalized.conditionProgress?.cvdConfirmed, true)
  assert.strictEqual(normalized.conditionProgress?.volumeConfirmed, false)
})

test('Leo Condition Checklist - Evaluates sequential condition ticking from price to pattern', () => {
  const rule: ArmedRule = normalizeArmedRule({
    id: 'rule-seq-1',
    instrument: 'DOW',
    direction: 'LONG',
    conditions: {
      targetPrice: 52800,
      pattern: 'HAMMER',
    },
  }, 'DOW')

  const targetPx = rule.conditions.targetPrice!
  let curPrice = 52850
  const touchTol = 4.0

  // 1. Initial State: Level not reached
  let isLevelReached = Math.abs(curPrice - targetPx) <= touchTol || curPrice <= targetPx
  assert.strictEqual(isLevelReached, false)

  // 2. Price dips into level
  curPrice = 52799
  isLevelReached = Math.abs(curPrice - targetPx) <= touchTol || curPrice <= targetPx
  assert.strictEqual(isLevelReached, true)

  // 3. Hammer Pattern forms on 5m bar
  const bars: Candle[] = [
    { time: 1000, open: 52820, high: 52830, low: 52795, close: 52800, volume: 100 },
    { time: 1300, open: 52800, high: 52815, low: 52760, close: 52810, volume: 150 }, // Hammer
  ]

  const pat = detectCandlestickPatterns(bars, 1)
  assert.strictEqual(pat.hammer, true)

  const progress: RuleConditionProgress = {
    levelReached: isLevelReached,
    levelReachedPrice: curPrice,
    patternConfirmed: pat.hammer,
    patternName: 'HAMMER',
    timeframeConfirmed: true,
    sessionConfirmed: true,
  }

  assert.strictEqual(progress.levelReached, true)
  assert.strictEqual(progress.patternConfirmed, true)
  assert.strictEqual(progress.patternName, 'HAMMER')
})
