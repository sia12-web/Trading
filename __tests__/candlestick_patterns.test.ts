import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectCandlestickPatterns,
  evaluateLvnBullishEngulfingSetup,
  type Candle,
} from '../lib/trading/candlestickPatterns'

test('detectCandlestickPatterns - Doji', () => {
  const bars: Candle[] = [
    { time: 1, open: 100, high: 105, low: 95, close: 100.1, volume: 100 },
  ]
  const res = detectCandlestickPatterns(bars, 0)
  assert.equal(res.doji, true)
})

test('detectCandlestickPatterns - Bullish Engulfing', () => {
  const bars: Candle[] = [
    { time: 1, open: 110, high: 112, low: 100, close: 105, volume: 100 },
    { time: 2, open: 104, high: 115, low: 102, close: 112, volume: 150 }, // Bullish Engulfing
  ]
  const res = detectCandlestickPatterns(bars, 1)
  assert.equal(res.bullEng, true)
})

test('detectCandlestickPatterns - Bearish Engulfing', () => {
  const bars: Candle[] = [
    { time: 1, open: 100, high: 106, low: 99, close: 105, volume: 100 },
    { time: 2, open: 106, high: 107, low: 95, close: 98, volume: 150 }, // Bearish Engulfing
  ]
  const res = detectCandlestickPatterns(bars, 1)
  assert.equal(res.bearEng, true)
})

test('evaluateLvnBullishEngulfingSetup - Valid LVN Setup', () => {
  const bars: Candle[] = [
    { time: 1000, open: 21520, high: 21525, low: 21490, close: 21495, volume: 500 },
    { time: 1300, open: 21492, high: 21545, low: 21485, close: 21540, volume: 800 }, // Bullish Engulfing (Low: 21485, Close: 21540)
  ]

  const setup = evaluateLvnBullishEngulfingSetup({
    bars,
    lvnLevels: [21490],
    ydayProfile: { vah: 21600, val: 21500, poc: 21550 },
    index: 1,
  })

  assert.notEqual(setup, null)
  assert.equal(setup?.direction, 'BUY')
  assert.equal(setup?.entryPrice, 21540)
  assert.equal(setup?.stopLoss, 21483) // 21485 - 2 = 21483
  assert.equal(setup?.riskPoints, 57)
  assert.equal(setup?.tp1, 21625.5)
})
