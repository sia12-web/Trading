/**
 * Session autoscale must follow candles only — Context 5-5 VWAP / FRVP
 * overlays cannot stretch NASDAQ/DOW into a hairline.
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
    vah5d: 30316,
    yPoc: 29500,
  })
  assert.deepEqual(extras, { always: [], nearby: [] })
  const session = paddedCandlePriceRange(
    29480,
    29620,
    overlayPricesForVisibleScale(29480, 29620, extras)
  )
  assert.ok(session)
  assert.ok(session.priceRange.minValue > 29020, '5M VWAP does not stretch NASDAQ')
  assert.ok(session.priceRange.maxValue - session.priceRange.minValue < 250, 'pane is the session ± pad')
  assert.ok(session.priceRange.minValue > 27724, '5M −1σ does not flatten NASDAQ candles')
  assert.ok(session.priceRange.maxValue < 30316, '5M +1σ does not flatten NASDAQ candles')
}

{
  const extras = context55ScalePrices({
    vwap: 51470,
    poc5d: 53760,
    vah5d: 53816,
    val5d: 52896,
    yPoc: 52872,
    yHigh: 53072,
    yLow: 52758,
    onPoc: 52816,
  })
  const session = paddedCandlePriceRange(
    52380,
    52600,
    overlayPricesForVisibleScale(52380, 52600, extras)
  )
  assert.ok(session)
  assert.ok(session.priceRange.minValue > 52000, 'DOW 5M VWAP must not pull the floor to 51,470')
  assert.ok(session.priceRange.maxValue < 53000, 'DOW 5D VAH/POC must not pull the ceiling to 53,816')
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
