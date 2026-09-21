/**
 * Range-box clicks past the last candle, and time-scale mapping.
 * Run: npx tsx __tests__/draw_time.test.ts
 */

import assert from 'node:assert/strict'
import { unixFromLogical } from '../lib/chart/sessionVwap'

{
  const t0 = 1_700_000_000
  const times = [t0, t0 + 300, t0 + 600]
  assert.equal(unixFromLogical(0, times, 300), t0)
  assert.equal(unixFromLogical(2, times, 300), t0 + 600)
  assert.equal(unixFromLogical(1.5, times, 300), t0 + 450)
  // Empty slots after the last print — 3 bars of whitespace at 5m.
  assert.equal(unixFromLogical(5, times, 300), t0 + 600 + 3 * 300)
  // Empty slots before the first print.
  assert.equal(unixFromLogical(-2, times, 300), t0 - 2 * 300)
}

{
  assert.equal(unixFromLogical(0, [], 300), null)
  assert.equal(unixFromLogical(1, [100], 0), null)
}

console.log('draw_time: all passed')
