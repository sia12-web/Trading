/**
 * Stop loss guard — reject entry±1 corruption.
 * Run: npx tsx __tests__/stop_loss_guard.test.ts
 */
import assert from 'node:assert/strict'
import { assertProtectiveStop } from '../lib/trading/stopLossGuard'

{
  // NIKKEI bug pattern: limit clamped to 61955, planned SL 61985 → snapped to 61954
  const bad = assertProtectiveStop({
    instrument: 'NIKKEI',
    entry: 61955,
    stop: 61985.29,
    direction: 'LONG',
    plannedStop: 61985.29,
  })
  assert.equal(bad.ok, false)
  if (!bad.ok) {
    assert.match(bad.message, /below limit/i)
  }

  const snappedBad = assertProtectiveStop({
    instrument: 'NIKKEI',
    entry: 61955,
    stop: 61954,
    direction: 'LONG',
    plannedStop: 61985.29,
  })
  assert.equal(snappedBad.ok, false)

  const good = assertProtectiveStop({
    instrument: 'NIKKEI',
    entry: 62203,
    stop: 61985.29,
    direction: 'LONG',
    plannedStop: 61985.29,
  })
  assert.equal(good.ok, true)
  if (good.ok) {
    assert.ok(good.distance >= 10)
  }
}

console.log('stop_loss_guard: all passed')
