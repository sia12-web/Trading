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
  bookMatchesBarSec,
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

{
  // 30m bars must not look like five missing 5m slots
  const t0 = 1_700_000_000
  const bars30 = [
    { time: t0 },
    { time: t0 + 1800 },
    { time: t0 + 3600 },
  ]
  assert.deepEqual(findMissingBarTimes(bars30, 1800), [])
  assert.equal(
    needsCandleReprint({
      bars: bars30,
      barSec: 1800,
      nearTipLookback: 10,
      wallUnix: t0 + 3600 + 60,
    }),
    false,
    '30m spacing is not a gap when barSec=1800'
  )
  assert.equal(
    needsCandleReprint({
      bars: bars30,
      barSec: 300,
      nearTipLookback: 10,
      wallUnix: t0 + 3600 + 60,
    }),
    true,
    'wrong barSec false-triggers reprint — client must pass TF seconds'
  )
}

{
  const t0 = 1_700_000_000
  const bars5 = Array.from({ length: 20 }, (_, i) => ({ time: t0 + i * 300 }))
  assert.equal(bookMatchesBarSec(bars5, 300), true)
  assert.equal(bookMatchesBarSec(bars5, 60), false, '5m book must not match 1m barSec')
  assert.equal(bookMatchesBarSec(bars5, 1800), false, '5m book must not match 30m barSec')
  const bars1 = Array.from({ length: 20 }, (_, i) => ({ time: t0 + i * 60 }))
  assert.equal(bookMatchesBarSec(bars1, 60), true)
  assert.equal(bookMatchesBarSec(bars1, 300), false)
}

console.log('candle_gaps.test.ts: all passed')
