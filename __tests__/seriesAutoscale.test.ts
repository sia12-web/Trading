/**
 * Session autoscale must fold nearby FRVP POCs onto the Y-axis without
 * stretching to 5-month ±σ (that flattens NASDAQ candles into a hairline).
 * Run: npx tsx __tests__/seriesAutoscale.test.ts
 */

import assert from 'node:assert/strict'
import {
  context55ScalePrices,
  overlayPricesForVisibleScale,
  paddedCandlePriceRange,
} from '../lib/chart/seriesAutoscale'
import {
  profileXOnPaneOrSticky,
  stickyLeftX,
  CONTEXT55_FRVP_5D_W,
} from '../lib/chart/context55Paint'

{
  const extras = context55ScalePrices({
    vwap: 29020,
    poc5d: 29400,
  })
  assert.equal(extras.always.includes(29020), false, '5M VWAP is nearby-only, not always')
  assert.deepEqual(extras.nearby, [29020])
  const session = paddedCandlePriceRange(
    29480,
    29620,
    overlayPricesForVisibleScale(29480, 29620, extras)
  )
  assert.ok(session)
  assert.ok(session.priceRange.minValue < 29020, 'Y-axis includes nearby 5M VWAP')
  assert.ok(session.priceRange.maxValue > 29400, 'Y-axis includes 5D POC')
  assert.ok(session.priceRange.minValue > 27724, '5M −1σ does not flatten NASDAQ candles')
  assert.ok(session.priceRange.maxValue < 30316, '5M +1σ does not flatten NASDAQ candles')
  assert.ok(
    session.priceRange.maxValue - session.priceRange.minValue < 1200,
    'session pane stays on the order of the session, not ±2σ'
  )
}

{
  const extras = context55ScalePrices({
    vwap: 25000,
    poc5d: 29400,
  })
  const session = paddedCandlePriceRange(
    29480,
    29620,
    overlayPricesForVisibleScale(29480, 29620, extras)
  )
  assert.ok(session)
  assert.ok(session.priceRange.minValue > 28000, 'a drifted 5M VWAP must not stretch the session')
}

{
  assert.equal(stickyLeftX(0), 6)
  assert.ok(stickyLeftX(1) > stickyLeftX(0) + CONTEXT55_FRVP_5D_W)
  assert.equal(profileXOnPaneOrSticky(-400, 900, 160, 6), 6, 'off-screen left parks sticky')
  assert.equal(profileXOnPaneOrSticky(2000, 900, 160, 6), 6, 'off-screen right parks sticky')
  assert.equal(profileXOnPaneOrSticky(120, 900, 160, 6), 120, 'on-pane keeps session X')
  assert.equal(profileXOnPaneOrSticky(null, 900, 160, 6), 6)
}

console.log('seriesAutoscale.test.ts: all passed')
