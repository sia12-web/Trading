/**
 * Chart tip latency: React live-price state stays on a 100ms cadence, and a
 * healthy SSE forming bar is not rolled back by the 15s REST history refresh.
 * Run: npx tsx __tests__/chart_tip_latency.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const chartSrc = fs.readFileSync(
  path.join(root, 'app/dashboard/chart/components/TradingChart.tsx'),
  'utf8'
)

assert.ok(
  chartSrc.includes('const PRICE_STATE_MS = 100'),
  'PRICE_STATE_MS is 100 so live price state updates at least every 100ms'
)
assert.ok(
  chartSrc.includes('const PRICE_TICKER_MS = 32') ||
    chartSrc.includes('const PRICE_TICKER_MS = 50'),
  'PRICE_TICKER_MS stays throttled at 32ms or 50ms'
)
assert.ok(
  !chartSrc.includes('const PRICE_STATE_MS = 0') &&
    !chartSrc.includes('const PRICE_TICKER_MS = 0'),
  'price state and ticker are not setState on every raw tick'
)

const refreshStart = chartSrc.indexOf('const refreshCandles = async')
assert.ok(refreshStart >= 0, 'refreshCandles exists')
const refreshEnd = chartSrc.indexOf('void pollQuote()', refreshStart)
assert.ok(refreshEnd > refreshStart, 'refreshCandles body is bounded')
const refreshBody = chartSrc.slice(refreshStart, refreshEnd)

const mergeAt = refreshBody.indexOf('mergeHistoryWithLiveTip')
assert.ok(mergeAt >= 0, 'refreshCandles still merges REST history with the live tip')
const protectAt = refreshBody.indexOf('lastSseMessageAt', mergeAt)
assert.ok(
  protectAt > mergeAt,
  'refreshCandles mentions lastSseMessageAt when applying the live tip over REST'
)
assert.ok(
  refreshBody.includes('sseHealthy') && refreshBody.includes('liveTip.close'),
  'a healthy SSE tip overwrites the same-bucket REST close'
)
assert.ok(
  refreshBody.includes('lastSseQuoteTs'),
  'refreshCandles only protects the forming bucket after an SSE quote was applied'
)

const onMessageAt = chartSrc.indexOf('es.onmessage')
assert.ok(onMessageAt >= 0, 'SSE EventSource onmessage remains')
const onMessageBody = chartSrc.slice(onMessageAt, onMessageAt + 1800)
assert.ok(
  onMessageBody.includes('lastSseMessageAt = Date.now()') &&
    onMessageBody.includes('lastSseQuoteTs'),
  'last SSE quote unix seconds is recorded where lastSseMessageAt is set'
)

assert.ok(
  chartSrc.includes('const CANDLE_REFRESH_MS = 15_000'),
  'history refresh interval stays at 15s'
)
assert.ok(chartSrc.includes('new EventSource('), 'SSE EventSource is still the primary tip')

console.log('chart_tip_latency: all passed')
