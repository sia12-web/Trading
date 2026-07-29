/**
 * Per-range ATR advice unit tests.
 * Run: npx tsx __tests__/range_atr.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildRangeAtrSnapshot,
  computeAtrWilder,
  formatRangeAtrAdviceLine,
  formatRangeAtrChip,
  suggestStopPadPoints,
  suggestTrailStepPoints,
  trueRange,
} from '../lib/trading/rangeAtr'

{
  assert.equal(trueRange({ high: 10, low: 8, close: 9 }, null), 2)
  assert.equal(trueRange({ high: 12, low: 9, close: 10 }, 8), 4) // max(3, 4, 1)
}

{
  // Synthetic flat then expanding bars — enough for ATR(14)
  const bars: Array<{ high: number; low: number; close: number }> = []
  let c = 100
  for (let i = 0; i < 40; i++) {
    const range = 2 + (i % 5)
    const high = c + range / 2
    const low = c - range / 2
    const close = c + ((i % 2) - 0.5)
    bars.push({ high, low, close })
    c = close
  }
  const atr = computeAtrWilder(bars, 14)
  assert.ok(atr != null && atr > 0)
  assert.equal(computeAtrWilder(bars.slice(0, 10), 14), null, 'need length+1 bars')
}

{
  assert.equal(suggestStopPadPoints(null), 10)
  assert.equal(suggestStopPadPoints(20), 10) // 0.35*20=7 → floor 10
  assert.equal(suggestStopPadPoints(100), 35)

  const quiet = suggestTrailStepPoints(40, 1.2)
  assert.equal(quiet.wide, false)
  assert.equal(quiet.trailStep, 10) // 0.25*40=10

  const wide = suggestTrailStepPoints(40, 2.5)
  assert.equal(wide.wide, true)
  assert.equal(wide.trailStep, 20) // 0.5*40
}

{
  const bars: Array<{ high: number; low: number; close: number }> = []
  let c = 40000
  for (let i = 0; i < 50; i++) {
    bars.push({ high: c + 30, low: c - 30, close: c + 5 })
    c += 5
  }
  const snap = buildRangeAtrSnapshot({
    rangeLabel: 'OR30',
    high: 40120,
    low: 40000,
    bars,
  })
  assert.ok(snap)
  assert.equal(snap!.height, 120)
  assert.ok(snap!.atr != null && snap!.atr > 0)
  assert.match(formatRangeAtrChip(snap!), /OR30 · Hgt 120 · ATR/)
  assert.match(formatRangeAtrAdviceLine(snap!), /suggest stop pad/)
  assert.match(formatRangeAtrAdviceLine(snap!), /trail/)
}

{
  assert.equal(
    buildRangeAtrSnapshot({ rangeLabel: 'IB', high: 100, low: 100, bars: [] }),
    null
  )
}

console.log('range_atr: all passed')
