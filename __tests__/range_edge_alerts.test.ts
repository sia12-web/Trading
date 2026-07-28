/**
 * Range-edge desk alerts (chart ±10 band).
 * Run: npx tsx __tests__/range_edge_alerts.test.ts
 */

import assert from 'node:assert/strict'
import {
  formatRangeEdgeAlertMessage,
  rangeEdgeProximity,
  shouldFireRangeEdgeAlert,
} from '../lib/trading/rangeEdgeAlerts'

const range = { high: 42010, low: 41900, label: 'OR30' }

assert.equal(rangeEdgeProximity(41950, range), null, 'mid-range not in ±10')
assert.equal(rangeEdgeProximity(42005, range)?.edge, 'high', 'near high')
assert.equal(rangeEdgeProximity(41905, range)?.edge, 'low', 'near low')
assert.equal(shouldFireRangeEdgeAlert(false, true), true, 'rising edge')
assert.equal(shouldFireRangeEdgeAlert(true, true), false, 'already in')
assert.equal(shouldFireRangeEdgeAlert(true, false), false, 'leaving')

const msg = formatRangeEdgeAlertMessage({
  instrument: 'DOW',
  proximity: { edge: 'high', center: 42010, label: 'OR30' },
  livePrice: 42005,
  mode: 'either',
})
assert.match(msg.title, /DOW/)
assert.match(msg.telegram, /TradePulse/)

console.log('range_edge_alerts: all passed')
