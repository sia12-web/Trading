/**
 * Session autoscale must fold Context 5-5 VWAP / FRVP levels onto the Y-axis.
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
    sigma1Upper: 30316,
    sigma1Lower: 27724,
    poc5d: 29400,
  })
  const session = paddedCandlePriceRange(
    29480,
    29620,
    overlayPricesForVisibleScale(29480, 29620, extras)
  )
  assert.ok(session)
  assert.ok(session.priceRange.minValue < 29020, 'Y-axis includes 5M VWAP')
  assert.ok(session.priceRange.maxValue > 29400, 'Y-axis includes 5D POC')
  assert.ok(session.priceRange.minValue > 27724, '5M −1σ does not flatten NASDAQ candles')
  assert.ok(session.priceRange.maxValue < 30316, '5M +1σ does not flatten NASDAQ candles')
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
