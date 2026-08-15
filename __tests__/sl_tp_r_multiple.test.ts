/**
 * When the trader adjusts stop loss, take profit must track R × |entry − SL|.
 * Initial ticket and SL edits re-lock to DEFAULT_TAKE_PROFIT_R (1.5).
 * Run: npx tsx __tests__/sl_tp_r_multiple.test.ts
 */

import assert from 'node:assert/strict'
import {
  DEFAULT_TAKE_PROFIT_R,
  previewPositionSizing,
  takeProfitFromStopR,
} from '../lib/trading/positionSizing'

function approxEqual(a: number, b: number, tol: number, msg: string) {
  assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ${b}, got ${a} (tol ${tol})`)
}

assert.equal(DEFAULT_TAKE_PROFIT_R, 1.5, 'product default reward multiple is 1.5R')

const entry = 40000

// ─── LONG: tighten SL → TP moves closer ──────────────────────────────────────

const wideStopLong = 39600 // 400 pt risk
const tightStopLong = 39800 // 200 pt risk
const wideTpLong = takeProfitFromStopR({
  entry,
  stop: wideStopLong,
  direction: 'LONG',
})
const tightTpLong = takeProfitFromStopR({
  entry,
  stop: tightStopLong,
  direction: 'LONG',
})

assert.ok(wideTpLong > entry, 'LONG TP above entry')
assert.ok(tightTpLong > entry, 'LONG TP above entry after tighten')
assert.ok(
  tightTpLong < wideTpLong,
  `tighter SL → closer TP (got tight=${tightTpLong} wide=${wideTpLong})`
)
approxEqual(wideTpLong - entry, Math.abs(entry - wideStopLong) * 1.5, 1e-9, 'wide LONG = 1.5R')
approxEqual(tightTpLong - entry, Math.abs(entry - tightStopLong) * 1.5, 1e-9, 'tight LONG = 1.5R')

// ─── LONG: widen SL → TP moves farther ───────────────────────────────────────

const widerStopLong = 39400 // 600 pt risk
const widerTpLong = takeProfitFromStopR({
  entry,
  stop: widerStopLong,
  direction: 'LONG',
})
assert.ok(widerTpLong > wideTpLong, 'wider SL → farther TP')
approxEqual(
  (widerTpLong - entry) / Math.abs(entry - widerStopLong),
  DEFAULT_TAKE_PROFIT_R,
  1e-9,
  'widen LONG distance ratio ≈ R'
)

// ─── SHORT: tighten / widen ──────────────────────────────────────────────────

const wideStopShort = 40400
const tightStopShort = 40200
const wideTpShort = takeProfitFromStopR({
  entry,
  stop: wideStopShort,
  direction: 'SHORT',
})
const tightTpShort = takeProfitFromStopR({
  entry,
  stop: tightStopShort,
  direction: 'SHORT',
})

assert.ok(wideTpShort < entry, 'SHORT TP below entry')
assert.ok(
  tightTpShort > wideTpShort,
  `tighter SHORT SL → TP closer to entry (tight=${tightTpShort} wide=${wideTpShort})`
)
approxEqual(entry - wideTpShort, Math.abs(entry - wideStopShort) * 1.5, 1e-9, 'wide SHORT = 1.5R')
approxEqual(entry - tightTpShort, Math.abs(entry - tightStopShort) * 1.5, 1e-9, 'tight SHORT = 1.5R')

const widerStopShort = 40600
const widerTpShort = takeProfitFromStopR({
  entry,
  stop: widerStopShort,
  direction: 'SHORT',
})
assert.ok(widerTpShort < wideTpShort, 'wider SHORT SL → TP farther')
approxEqual(
  (entry - widerTpShort) / Math.abs(entry - widerStopShort),
  DEFAULT_TAKE_PROFIT_R,
  1e-9,
  'widen SHORT distance ratio ≈ R'
)

// ─── previewPositionSizing stays in sync with takeProfitFromStopR ────────────

const prev = previewPositionSizing(entry, 100_000, 'LONG', tightStopLong, 2)!
assert.ok(prev, 'preview returns')
const expectedRaw = takeProfitFromStopR({
  entry,
  stop: tightStopLong,
  direction: 'LONG',
})
// preview may soft-snap to rounds but must stay ≈ 1.5R (not sticky magnet)
approxEqual(
  (prev.profit_target_price - entry) / Math.abs(entry - tightStopLong),
  DEFAULT_TAKE_PROFIT_R,
  0.15,
  'preview TP ≈ 1.5R of stop (allow soft round snap)'
)
assert.ok(
  Math.abs(prev.profit_target_price - expectedRaw) / entry < 0.003,
  'preview TP near raw 1.5R helper'
)

// lowercase direction accepted (chart overlay uses 'long'/'short')
approxEqual(
  takeProfitFromStopR({ entry, stop: tightStopLong, direction: 'long' }),
  tightTpLong,
  1e-9,
  'lowercase long matches LONG'
)

console.log('sl_tp_r_multiple.test.ts: all assertions passed')
