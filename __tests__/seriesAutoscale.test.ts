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
  profileIntersectsPane,
  compactProfileWidth,
  CONTEXT55_FRVP_5D_W,
  paintAnchoredVwapSigmaFill,
  rangePocLineX,
} from '../lib/chart/context55Paint'
import { VWAP_COLORS } from '../lib/chart/sessionVwap'

{
  const extras = context55ScalePrices({
    vwap: 29020,
    vwapUpper1: 30219,
    vwapLower1: 27724,
    poc5d: 29400,
    vah5d: 30316,
    yPoc: 29500,
  })
  assert.deepEqual(extras.always, [])
  assert.ok(extras.nearby.includes(29020))
  assert.ok(extras.nearby.includes(30219))
  const session = paddedCandlePriceRange(
    29480,
    29620,
    overlayPricesForVisibleScale(29480, 29620, extras)
  )
  assert.ok(session)
  assert.ok(session.priceRange.minValue > 27724, '5M −1σ does not flatten NASDAQ candles')
  assert.ok(session.priceRange.maxValue < 30316, '5M +1σ does not flatten NASDAQ candles')
  assert.ok(session.priceRange.maxValue - session.priceRange.minValue < 900, 'pane stays on the session')
}

{
  const extras = context55ScalePrices({
    vwap: 51470,
    vwapUpper1: 54000,
    vwapLower1: 49000,
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
  assert.ok(session.priceRange.minValue > 52000, 'far 5M VWAP / −1σ must not pull DOW to 49,000')
  assert.ok(session.priceRange.maxValue < 53000, '5D VAH/POC must not pull the ceiling to 53,816')
}

{
  assert.equal(profileIntersectsPane(-40, CONTEXT55_FRVP_5D_W, 900), true, 'partially off-screen left still paints')
  assert.equal(profileIntersectsPane(-400, CONTEXT55_FRVP_5D_W, 900), false, 'fully off-screen left does not stick')
  assert.equal(profileIntersectsPane(2000, CONTEXT55_FRVP_5D_W, 900), false, 'off-screen right does not stick')
  assert.equal(profileIntersectsPane(120, CONTEXT55_FRVP_5D_W, 900), true, 'on-pane range start paints')
  assert.equal(profileIntersectsPane(null, CONTEXT55_FRVP_5D_W, 900), false)
  assert.ok(compactProfileWidth(800, 56) <= 56)
  assert.ok(compactProfileWidth(120, 56) < 30, 'zoomed-out session does not stretch the histogram')
  assert.equal(compactProfileWidth(null, 56), 56)
}

{
  assert.deepEqual(rangePocLineX(100, 500, 800), { x0: 100, x1: 500 })
  assert.ok(rangePocLineX(-40, 900, 800), 'POC still draws when the range start is off-screen left')
  assert.equal(rangePocLineX(-400, -200, 800), null)
  assert.ok(rangePocLineX(100, null, 800))
}

{
  let fillStyle = ''
  let filled = false
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      filled = true
    },
    set fillStyle(value: string) {
      fillStyle = value
    },
    get fillStyle() {
      return fillStyle
    },
  } as unknown as CanvasRenderingContext2D
  paintAnchoredVwapSigmaFill(ctx, {
    upper: [
      { time: 1, value: 100 },
      { time: 2, value: 110 },
    ],
    lower: [
      { time: 1, value: 80 },
      { time: 2, value: 90 },
    ],
    paneW: 400,
    paneH: 300,
    timeToX: (t) => t * 10,
    priceToY: (p) => 200 - p,
    fill: VWAP_COLORS.fill1,
  })
  assert.equal(filled, true)
  assert.equal(fillStyle, VWAP_COLORS.fill1)
}

console.log('seriesAutoscale.test.ts: all passed')
