/**
 * Range-box clicks past the last candle, and time-scale mapping.
 * Run: npx tsx __tests__/draw_time.test.ts
 */

import assert from 'node:assert/strict'
import { unixFromLogical, logicalFromPixel, timeToX } from '../lib/chart/sessionVwap'

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
  const lastIdx = 10
  const barW = 12
  const lastX = lastIdx * barW
  const ts = {
    coordinateToLogical: (x: number) => Math.min(lastIdx, Math.max(0, x / barW)),
    logicalToCoordinate: (logical: number) => logical * barW,
  }
  // API clamps to last bar; helper must still count extra pixels as future slots.
  assert.equal(logicalFromPixel(ts, lastX, lastIdx + 1), lastIdx)
  assert.equal(logicalFromPixel(ts, lastX + 3 * barW, lastIdx + 1), lastIdx + 3)
  assert.equal(logicalFromPixel(ts, -2 * barW, lastIdx + 1), -2)
}

{
  const t0 = 1_700_000_000
  const times = [t0, t0 + 300, t0 + 600]
  const ts = {
    timeToCoordinate: (t: number) => {
      const i = times.indexOf(t)
      return i >= 0 ? i * 12 : 24 // clamp unknown times to last bar
    },
  }
  const future = t0 + 600 + 5 * 300
  assert.equal(timeToX(ts, future, times, false, 300), 24 + 5 * 12)
}

{
  assert.equal(unixFromLogical(0, [], 300), null)
  assert.equal(unixFromLogical(1, [100], 0), null)
}

console.log('draw_time: all passed')
