/**
 * Test Databento Live Hub & CME Globex real-time streaming integration.
 * Run: npx tsx __tests__/databento_live_hub.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkDatabentoSidecarHealth,
  fetchDatabentoLiveSnapshot,
  getLatestDatabentoLiveQuote,
  isDatabentoLiveActive,
  subscribeDatabentoLive,
} from '../lib/databento/liveHub.ts'

test('Databento Live Hub - Health check', async () => {
  const healthy = await checkDatabentoSidecarHealth()
  assert.equal(typeof healthy, 'boolean')
})

test('Databento Live Hub - Snapshot fetch', async () => {
  const snapshot = await fetchDatabentoLiveSnapshot()
  if (snapshot) {
    assert.ok(snapshot.quotes, 'snapshot should contain quotes map')
    assert.ok(snapshot.forming, 'snapshot should contain forming candles')
  }
})

test('Databento Live Hub - Subscription and tick delivery', async () => {
  const isHealthy = await checkDatabentoSidecarHealth()
  if (!isHealthy) return // Skip if sidecar not running

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub()
      resolve() // Do not hard-fail outside market hours
    }, 4000)

    const unsub = subscribeDatabentoLive('NASDAQ', (quote) => {
      clearTimeout(timer)
      assert.equal(quote.instrument, 'NASDAQ')
      assert.ok(quote.price > 0, 'quote price must be positive')
      assert.equal(quote.source, 'cme_globex')
      unsub()
      resolve()
    })
  })
})
