/**
 * Candle-only price scale — current session sits in the middle of the pane.
 * Run: npx tsx __tests__/series_autoscale.test.ts
 */

import assert from 'node:assert/strict'
import {
  paddedCandlePriceRange,
  sessionFocusHighLow,
} from '../lib/chart/seriesAutoscale'
import { zonedCivilToUnix } from '../lib/chart/sessionVwap'

const candles = paddedCandlePriceRange(30080, 30140)
assert.ok(candles)
assert.ok(candles.priceRange.minValue < 30080)
assert.ok(candles.priceRange.maxValue > 30140)
assert.ok(candles.priceRange.maxValue - candles.priceRange.minValue < 200)

const withStop = paddedCandlePriceRange(30080, 30140, [30050, 30200])
assert.ok(withStop)
assert.ok(withStop.priceRange.minValue < 30050)
assert.ok(withStop.priceRange.maxValue > 30200)

const farSigma = paddedCandlePriceRange(30080, 30140)
assert.ok(farSigma)
assert.ok(farSigma.priceRange.minValue > 29900, '−3σ at 29250 must not be in candle window')

assert.equal(paddedCandlePriceRange(Number.NaN, 30100), null)
assert.equal(paddedCandlePriceRange(10, 10), null)

function barsAt(ymd: string, hour: number, high: number, low: number, count: number) {
  const start = zonedCivilToUnix(ymd, hour, 'America/New_York')
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * 300,
    high,
    low,
  }))
}

const overnight = barsAt('2026-08-13', 20, 29200, 29100, 20)
const ny = barsAt('2026-08-14', 10, 30150, 30080, 20)
const mixed = [...overnight, ...ny]
const focus = sessionFocusHighLow(mixed, 'NASDAQ')
assert.ok(focus)
assert.ok(focus.min >= 30080, `NY session low ${focus.min}`)
assert.ok(focus.max <= 30150, `NY session high ${focus.max}`)
assert.ok(focus.min > 29200, 'overnight Asia must not pull NY to the top')

const week = [...barsAt('2026-08-10', 20, 29200, 29100, 200), ...ny]
const wide = sessionFocusHighLow(week, 'NASDAQ')
assert.ok(wide)
assert.ok(wide.min <= 29100, '5-day zoom-out includes the full visible range')
assert.ok(wide.max >= 30150)

const onlyOvernight = sessionFocusHighLow(overnight, 'NASDAQ')
assert.ok(onlyOvernight)
assert.ok(onlyOvernight.max <= 29200)
assert.ok(onlyOvernight.min >= 29100)

assert.equal(sessionFocusHighLow([], 'NASDAQ'), null)

console.log('series_autoscale.test.ts: all passed')
