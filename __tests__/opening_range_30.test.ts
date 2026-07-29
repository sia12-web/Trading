/**
 * Opening range 30m — DOW/NASDAQ (09:30–10:00 ET) vs NIKKEI (09:00–09:30 JST).
 */
import assert from 'node:assert/strict'
import {
  OR30_MINUTES,
  computeOr30Range,
  isOr30Instrument,
  or30LineSeriesData,
  or30WindowLabel,
} from '../lib/chart/openingRange30'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '../lib/utils/dateUtils'

assert.equal(isOr30Instrument('NIKKEI'), true)
assert.equal(isOr30Instrument('DOW'), true)
assert.equal(isOr30Instrument('NASDAQ'), true)
assert.equal(isOr30Instrument('FOO'), false)
assert.equal(OR30_MINUTES, 30)
assert.equal(or30WindowLabel('DOW'), '09:30–10:00 Montreal')
assert.match(or30WindowLabel('NIKKEI'), /Montreal/)
// Summer EDT: Tokyo 09:00–09:30 → 20:00–20:30 Montreal
assert.match(
  or30WindowLabel('NIKKEI', new Date('2026-07-27T12:00:00.000Z')),
  /20:00–20:30 Montreal/
)

function barsAround(open: number) {
  return [
    { time: open + 0 * 60, open: 100, high: 102, low: 99, close: 101, volume: 1 },
    { time: open + 5 * 60, open: 101, high: 105, low: 100, close: 104, volume: 1 },
    { time: open + 15 * 60, open: 104, high: 106, low: 103, close: 105, volume: 1 },
    { time: open + 25 * 60, open: 105, high: 107, low: 98, close: 99, volume: 1 },
    { time: open + 35 * 60, open: 99, high: 110, low: 97, close: 108, volume: 1 },
  ]
}

// Nikkei — 09:00 JST
const nikkeiOpen = tokyoDateTimeToUnix('2026-07-16', 9, 0)
const nikkeiBars = barsAround(nikkeiOpen)
assert.equal(computeOr30Range(nikkeiBars, nikkeiOpen, nikkeiOpen - 60), null)
const nikkeiForming = computeOr30Range(nikkeiBars, nikkeiOpen, nikkeiOpen + 20 * 60)
assert.ok(nikkeiForming)
assert.equal(nikkeiForming!.high, 106)
const nikkeiShaped = computeOr30Range(nikkeiBars, nikkeiOpen, nikkeiOpen + 35 * 60)
assert.ok(nikkeiShaped)
assert.equal(nikkeiShaped!.high, 107)
assert.equal(nikkeiShaped!.low, 98)
assert.equal(nikkeiShaped!.endUnix - nikkeiOpen, 30 * 60)

// DOW — 09:30 ET (different clock than Nikkei)
const dowOpen = nyDateTimeToUnix('2026-07-16', 9, 30)
assert.notEqual(dowOpen, nikkeiOpen, 'NY and Tokyo cash opens differ')
const dowBars = barsAround(dowOpen)
const dowShaped = computeOr30Range(dowBars, dowOpen, dowOpen + 35 * 60)
assert.ok(dowShaped)
assert.equal(dowShaped!.high, 107)
assert.equal(dowShaped!.openUnix, dowOpen)
assert.equal(dowShaped!.endUnix, dowOpen + 30 * 60)

const pts = or30LineSeriesData(dowShaped!, dowOpen + 90 * 60)
assert.equal(pts.high.length, 2)
assert.equal(pts.high[1]!.time, dowOpen + 90 * 60)

console.log('✅ opening_range_30: DOW/NASDAQ 09:30 ET + NIKKEI 09:00 JST OK')
