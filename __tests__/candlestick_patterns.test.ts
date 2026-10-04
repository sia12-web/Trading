import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectCandlestickPatterns,
  evaluateLvnBullishEngulfingSetup,
  type Candle,
} from '../lib/trading/candlestickPatterns.ts'

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

test('detectCandlestickPatterns - Buying Excess Tail', () => {
  const bars: Candle[] = [
    { time: 0, open: 105, high: 107, low: 100, close: 104, volume: 100 },
    { time: 1, open: 105, high: 106, low: 95, close: 104, volume: 200 },
  ]
  const res = detectCandlestickPatterns(bars, 1)
  assert.equal(res.buyingExcess, true)
  assert.equal(res.sellingExcess, false)
})

test('detectCandlestickPatterns - Selling Excess Tail', () => {
  const bars: Candle[] = [
    { time: 0, open: 96, high: 100, low: 94, close: 97, volume: 100 },
    { time: 1, open: 96, high: 106, low: 95, close: 97, volume: 200 },
  ]
  const res = detectCandlestickPatterns(bars, 1)
  assert.equal(res.sellingExcess, true)
  assert.equal(res.buyingExcess, false)
})

test('detectCandlestickPatterns - Shared Zone POC & Structural Confluence Rules', () => {
  // Bullish Engulfing bar at price ~112 (Low: 102, Close: 112)
  const barsBull: Candle[] = [
    { time: 1, open: 110, high: 112, low: 100, close: 105, volume: 100 },
    { time: 2, open: 104, high: 115, low: 102, close: 112, volume: 150 },
  ]

  // 1. Single POC 120 (price 112 is BELOW POC) -> Bullish pattern KEPT
  const resBelowPoc = detectCandlestickPatterns(barsBull, 1, 5, 0.05, [120])
  assert.equal(resBelowPoc.bullEng, true)

  // 2. Single POC 100 (price 112 is ABOVE POC) -> Bullish pattern FILTERED OUT
  const resAbovePoc = detectCandlestickPatterns(barsBull, 1, 5, 0.05, [100])
  assert.equal(resAbovePoc.bullEng, false)

  // 3. Shared Zone Multiple POCs: POCs [105, 120, 130]. Price 112 is ABOVE 105 -> FILTERED OUT because price is above minPoc
  const resSharedZoneAboveOnePoc = detectCandlestickPatterns(barsBull, 1, 5, 0.05, [105, 120, 130])
  assert.equal(resSharedZoneAboveOnePoc.bullEng, false)

  // 4. Shared Zone Multiple POCs: POCs [120, 125, 130]. Price 112 is BELOW ALL POCs -> KEPT
  const resSharedZoneBelowAllPocs = detectCandlestickPatterns(barsBull, 1, 5, 0.05, [120, 125, 130])
  assert.equal(resSharedZoneBelowAllPocs.bullEng, true)

  // 5. Important Places Confluence: Price 112 with POCs [120] and importantLevels: [112] (at Yesterday VAL 112) -> KEPT
  const resAtImportantLevel = detectCandlestickPatterns(barsBull, 1, 5, 0.05, {
    pocs: [120],
    importantLevels: [112],
  })
  assert.equal(resAtImportantLevel.bullEng, true)

  // 6. Important Places Confluence Rejection: Price 112 with POCs [120] and importantLevels: [50] (far from any structural level) -> FILTERED OUT
  const resNotAtImportantLevel = detectCandlestickPatterns(barsBull, 1, 5, 0.05, {
    pocs: [120],
    importantLevels: [50],
  })
  assert.equal(resNotAtImportantLevel.bullEng, false)

  // Bearish Engulfing bar at price ~98
  const barsBear: Candle[] = [
    { time: 1, open: 100, high: 106, low: 99, close: 105, volume: 100 },
    { time: 2, open: 106, high: 107, low: 95, close: 98, volume: 150 },
  ]

  // Shared Zone Bearish: POCs [80, 90, 95]. Price 98 is ABOVE ALL POCs -> KEPT
  const resBearAboveAllPocs = detectCandlestickPatterns(barsBear, 1, 5, 0.05, [80, 90, 95])
  assert.equal(resBearAboveAllPocs.bearEng, true)

  // Shared Zone Bearish: POCs [80, 90, 105]. Price 98 is BELOW 105 -> FILTERED OUT because price is below maxPoc
  const resBearBelowOnePoc = detectCandlestickPatterns(barsBear, 1, 5, 0.05, [80, 90, 105])
  assert.equal(resBearBelowOnePoc.bearEng, false)
})

