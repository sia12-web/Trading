/**
 * Gap detection for smart Databento/Yahoo reprint.
 * Run: npx tsx __tests__/candle_gaps.test.ts
 */

import assert from 'node:assert/strict'
import {
  findMissingBarTimes,
  countNearTipGaps,
  tipLagSlots,
  needsCandleReprint,
} from '../lib/chart/candleGaps'
import { DESK_SESSION_GAP_SEC } from '../lib/chart/liveFormingBar'

{
  const t0 = 1_700_000_000
  const bars = [
    { time: t0 },
    { time: t0 + 300 },
    { time: t0 + 900 }, // missing t0+600
    { time: t0 + 1200 },
  ]
  assert.deepEqual(findMissingBarTimes(bars), [t0 + 600])
}

{
  const t0 = 1_700_000_000
  const bars = [
    { time: t0 },
    { time: t0 + DESK_SESSION_GAP_SEC + 300 },
  ]
  assert.deepEqual(findMissingBarTimes(bars), [], 'weekend/session halt is not a gap')
}

{
  const t0 = 1_700_000_000
  const bars = Array.from({ length: 20 }, (_, i) => ({ time: t0 + i * 300 }))
  bars.splice(18, 0) // no-op
  // Drop bar at index 17 (create a hole near tip)
  const gapped = bars.filter((_, i) => i !== 17)
  assert.equal(countNearTipGaps(gapped, 10), 1)
  assert.equal(needsCandleReprint({ bars: gapped, nearTipLookback: 10 }), true)
}

{
  const last = 1_700_000_000
  assert.equal(tipLagSlots(last, last + 50), 0)
  assert.equal(tipLagSlots(last, last + 700), 2)
  assert.equal(
    needsCandleReprint({
      bars: [{ time: last }, { time: last + 300 }],
      wallUnix: last + 300 + 700,
      maxTipLagSlots: 2,
    }),
    true
  )
}

console.log('candle_gaps.test.ts: all passed')
