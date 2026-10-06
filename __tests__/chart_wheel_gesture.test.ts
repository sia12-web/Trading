/**
 * Chart wheel ownership and cash-open React cadence.
 * Run: npx tsx __tests__/chart_wheel_gesture.test.ts
 */

import assert from 'node:assert/strict'
import { chartOwnsWheel, livePriceStateGapMs } from '../lib/chart/chartWheel'

const plot = { tag: 'plot' }
const outside = { tag: 'header' }
const chartRoot = {
  contains(node: unknown) {
    return node === plot || node === chartRoot
  },
}

assert.equal(chartOwnsWheel(plot as unknown as Node, chartRoot as unknown as Node), true)
assert.equal(chartOwnsWheel(outside as unknown as Node, chartRoot as unknown as Node), false)
assert.equal(chartOwnsWheel(null, chartRoot as unknown as Node), false)
assert.equal(chartOwnsWheel(plot as unknown as Node, null), false)

assert.equal(livePriceStateGapMs(1, 100, 400), 100)
assert.equal(livePriceStateGapMs(12, 100, 400), 100)
assert.equal(livePriceStateGapMs(13, 100, 400), 400)
assert.equal(livePriceStateGapMs(80, 100, 400), 400)
assert.equal(livePriceStateGapMs(80, 0, 400), 400)

console.log('chart_wheel_gesture.test.ts: all passed')
