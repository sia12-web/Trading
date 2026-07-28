/**
 * Range-edge tail detector tests.
 * Run: npx tsx __tests__/range_edge_tails.test.ts
 */
import assert from 'node:assert/strict'
import {
  TAIL_RATIO_GOOD,
  TAIL_RATIO_LIGHT,
  TAIL_RATIO_STRONG,
  candleWickMetrics,
  computeRangeEdgeTails,
  latestQualityTail,
  preferLevelsWithRangeEdgeTail,
} from '../lib/chart/rangeEdgeTails'

{
  assert.equal(TAIL_RATIO_LIGHT, 0.25)
  assert.equal(TAIL_RATIO_GOOD, 0.4)
  assert.equal(TAIL_RATIO_STRONG, 0.5)
}

{
  // Upper wick 20, body 40 → ratio 0.5 strong
  const m = candleWickMetrics({
    time: 1,
    open: 100,
    high: 160,
    low: 100,
    close: 140,
  })
  assert.equal(m.bodyPts, 40)
  assert.equal(m.upperWickPts, 20)
  assert.ok(Math.abs(m.upperRatio - 0.5) < 1e-9)
}

{
  const range = {
    high: 40000,
    low: 39900,
    label: 'IB',
    complete: true,
    lockedUnix: 1000,
  }
  const bars = [
    // Before lock — ignored
    {
      time: 900,
      open: 40000,
      high: 40040,
      low: 39990,
      close: 40005,
    },
    // High-edge strong upper tail (wick 20, body 40)
    {
      time: 1100,
      open: 39995,
      high: 40055,
      low: 39990,
      close: 40035,
    },
    // Mid-range — no band touch for meaningful tail
    {
      time: 1400,
      open: 39950,
      high: 39960,
      low: 39940,
      close: 39955,
    },
    // Low-edge good lower tail (wick 16, body 40 → 0.4)
    {
      time: 1700,
      open: 39920,
      high: 39925,
      low: 39864,
      close: 39880,
    },
  ]

  const incomplete = computeRangeEdgeTails(bars, { ...range, complete: false })
  assert.equal(incomplete.length, 0, 'forming range → no tails')

  const tails = computeRangeEdgeTails(bars, range)
  assert.ok(tails.length >= 2, `expected high+low tails got ${tails.length}`)
  const high = tails.find((t) => t.edge === 'high')
  const low = tails.find((t) => t.edge === 'low')
  assert.ok(high, 'high-edge tail')
  assert.equal(high!.tier, 'strong')
  assert.ok(low, 'low-edge tail')
  assert.equal(low!.tier, 'good')
  assert.match(high!.text, /IB TAIL H/)

  const latest = latestQualityTail(tails, 'good')
  assert.ok(latest)
  assert.equal(latest!.edge, 'low')
}

{
  const range = { high: 100, low: 90, label: 'OR30' }
  const levels = [
    { price: 95, conviction: 6 },
    { price: 100, conviction: 5 },
    { price: 90, conviction: 5 },
  ]
  const tails = [
    {
      time: Math.floor(Date.now() / 1000) - 60,
      edge: 'high' as const,
      tier: 'strong' as const,
      ratio: 0.6,
      wickPts: 12,
      bodyPts: 20,
      price: 105,
      text: 'OR30 TAIL H · 0.5',
      color: '#f59e0b',
      position: 'aboveBar' as const,
      shape: 'arrowDown' as const,
      label: 'OR30',
    },
  ]
  const ranked = preferLevelsWithRangeEdgeTail(levels, range, tails)
  assert.equal(ranked[0]!.price, 100, 'high-edge level boosted to front')
  assert.ok((ranked[0]!.conviction ?? 0) > 5)
}

console.log('range_edge_tails: all passed')
