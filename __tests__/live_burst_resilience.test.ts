/**
 * Fast-market regression: exchange bursts stay current without O(history)
 * allocations, delayed-vendor vetoes, or unbounded SSE queues.
 * Run: npx tsx __tests__/live_burst_resilience.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyTickToFormingBar,
  liveQuoteDisagreesWithReference,
} from '../lib/chart/liveFormingBar'

const root = path.resolve(__dirname, '..')
const chartSrc = fs.readFileSync(
  path.join(root, 'app/dashboard/chart/components/TradingChart.tsx'),
  'utf8'
)
const chartPageSrc = fs.readFileSync(
  path.join(root, 'app/dashboard/chart/page.tsx'),
  'utf8'
)
const streamSrc = fs.readFileSync(
  path.join(root, 'app/api/trading/quote/stream/route.ts'),
  'utf8'
)
const sidecarSrc = fs.readFileSync(
  path.join(root, 'scripts/databento_live_sidecar.py'),
  'utf8'
)

const t0 = 1_800_000_000 - (1_800_000_000 % 300)
let bar = {
  time: t0,
  open: 29_400,
  high: 29_400,
  low: 29_400,
  close: 29_400,
  volume: 0,
}

let expectedHigh = bar.high
let expectedLow = bar.low
for (let i = 0; i < 50_000; i++) {
  const price = 29_400 + Math.sin(i / 17) * 125
  expectedHigh = Math.max(expectedHigh, price)
  expectedLow = Math.min(expectedLow, price)
  const stepped = applyTickToFormingBar(
    bar,
    price,
    t0 + (i % 299),
    300,
    'NASDAQ',
    true
  )
  assert.equal(stepped.rolled, false)
  bar = { ...stepped.last, volume: stepped.last.volume ?? 0 }
}

assert.ok(Math.abs(bar.high - expectedHigh) < 1e-9, 'burst high is preserved')
assert.ok(Math.abs(bar.low - expectedLow) < 1e-9, 'burst low is preserved')

const rolled = applyTickToFormingBar(
  bar,
  29_510,
  t0 + 300,
  300,
  'NASDAQ',
  true
)
assert.equal(rolled.rolled, true, 'next timestamp prints the next bar immediately')
assert.equal(rolled.last.time, t0 + 300)

assert.equal(
  liveQuoteDisagreesWithReference(29_700, t0 + 600, 29_400, t0, 'NASDAQ'),
  false,
  '10-minute-delayed Yahoo cannot veto current Databento'
)

assert.ok(
  chartSrc.includes('next[next.length - 1] = {'),
  'same-bar tick updates the imperative tail in place'
)
assert.ok(
  !chartSrc.includes('[...next.slice(0, -1)'),
  'same-bar tick does not copy multi-day history'
)
assert.ok(
  chartPageSrc.includes('pendingFillTickRef.current(price)'),
  'working limits inspect every tick without rendering the whole page every tick'
)
assert.ok(
  streamSrc.includes('controller.desiredSize'),
  'SSE path applies backpressure instead of building an unbounded stale queue'
)
assert.ok(
  streamSrc.includes("feed?: 'databento'") &&
    streamSrc.includes("'databento'"),
  'direct exchange frames are identified for the trusted fast path'
)
assert.ok(
  sidecarSrc.includes('SSE_TICK_QUEUE_MAX = 128') &&
    sidecarSrc.includes('payload["bar"]'),
  'sidecar bounds queued prints and carries exact forming OHLCV'
)

console.log('live_burst_resilience: all passed')
