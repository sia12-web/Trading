/**
 * Unit test suite for Databento CME continuous candle gap-filling and feed latency selector.
 * Run: npx tsx __tests__/databento_gap_latency.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fillCandleGaps,
  isCmeMarketHalt,
  type BaseCandle,
} from '../lib/chart/candleGapFiller'
import {
  getBestFeed,
  getFeedMetricsSnapshot,
  recordFeedTick,
} from '../lib/databento/feedLatencySelector'

test('Candle Gap Filler - Identifies CME daily halt vs active trading hours', () => {
  // Monday 17:30 ET (17:30 is maintenance break)
  // 2026-09-14 17:30 EDT = 2026-09-14 21:30 UTC = 1789421400
  const mondayHalt = 1789421400
  assert.equal(isCmeMarketHalt(mondayHalt), true, '17:30 ET should be CME maintenance halt')

  // Monday 10:00 ET (regular trading hours)
  // 2026-09-14 10:00 EDT = 2026-09-14 14:00 UTC = 1789394400
  const mondayTrading = 1789394400
  assert.equal(isCmeMarketHalt(mondayTrading), false, '10:00 ET should be open trading hours')

  // Saturday 12:00 ET (weekend close)
  // 2026-09-19 12:00 EDT = 2026-09-19 16:00 UTC = 1789833600
  const saturdayHalt = 1789833600
  assert.equal(isCmeMarketHalt(saturdayHalt), true, 'Saturday should be weekend halt')
})

test('Candle Gap Filler - Fills missing 5m timeframe bars with carry-forward prices', () => {
  // Base timestamp: Monday 10:00 AM ET (1789394400)
  const baseT = 1789394400
  const step = 300 // 5 minutes

  // Input candles with a 15-minute gap (2 missing 5m bars)
  const inputCandles: BaseCandle[] = [
    { time: baseT, open: 21500, high: 21520, low: 21490, close: 21510, volume: 150 },
    // Missing: baseT + 300 (10:05), baseT + 600 (10:10)
    { time: baseT + 900, open: 21515, high: 21540, low: 21510, close: 21535, volume: 200 },
  ]

  const filled = fillCandleGaps(inputCandles, '5m', 'NASDAQ')

  assert.equal(filled.length, 4, 'Should fill 2 missing bars for a total of 4 continuous 5m candles')

  // Verify second candle (first gap fill at 10:05)
  assert.equal(filled[1]!.time, baseT + 300)
  assert.equal(filled[1]!.open, 21510, 'Gap bar open should carry forward previous close')
  assert.equal(filled[1]!.close, 21510, 'Gap bar close should carry forward previous close')
  assert.equal(filled[1]!.volume, 0, 'Gap bar volume should be 0')

  // Verify third candle (second gap fill at 10:10)
  assert.equal(filled[2]!.time, baseT + 600)
  assert.equal(filled[2]!.close, 21510)

  // Verify fourth candle (original second input candle at 10:15)
  assert.equal(filled[3]!.time, baseT + 900)
  assert.equal(filled[3]!.close, 21535)
})

test('Candle Gap Filler - Handles duplicate timestamps by updating OHLC', () => {
  const baseT = 1789394400
  const inputCandles: BaseCandle[] = [
    { time: baseT, open: 21500, high: 21520, low: 21490, close: 21510, volume: 100 },
    { time: baseT, open: 21510, high: 21550, low: 21505, close: 21540, volume: 50 },
  ]

  const filled = fillCandleGaps(inputCandles, '5m', 'NASDAQ')

  assert.equal(filled.length, 1, 'Duplicate timestamps should be merged into 1 candle')
  assert.equal(filled[0]!.high, 21550, 'High should be max of high prices')
  assert.equal(filled[0]!.low, 21490, 'Low should be min of low prices')
  assert.equal(filled[0]!.close, 21540, 'Close should be latest close price')
  assert.equal(filled[0]!.volume, 150, 'Volume should be aggregated')
})

test('Feed Latency Selector - Benchmarks latency and selects best zero-gap feed', () => {
  // Record fresh low-latency tick for databento_live (10ms RTT)
  recordFeedTick('databento_live', 10, false)
  // Record higher latency tick for yahoo (300ms RTT)
  recordFeedTick('yahoo', 300, true)

  const best = getBestFeed('NASDAQ')
  assert.equal(best.source, 'databento_live', 'Databento Live should be selected as best feed')
  assert.ok(best.qualityScore > 80, 'Databento Live quality score should be high')

  const snap = getFeedMetricsSnapshot()
  assert.equal(snap.activeFeed.source, 'databento_live')
  assert.equal(snap.zeroGapActive, true, 'Zero gap active indicator should be true when primary feed is healthy')
})
