/**
 * Pane-relative SL/TP pointer math — zoom / fullscreen must not drift.
 * Run: npx tsx __tests__/chart_pointer_price.test.ts
 */

import {
  clampClientYToPane,
  overlayYOffset,
  riskBoxDollarPreview,
  seriesLayoutKey,
} from '../lib/chart/chartPointerPrice'
import { takeProfitFromStopR } from '../lib/trading/positionSizing'
import { snapDeskPrice, snapStopToTick, snapTargetToTick } from '../lib/trading/instrumentTicks'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

{
  assert(clampClientYToPane(100, 400, 100) === 0, 'top of pane → 0')
  assert(clampClientYToPane(100, 400, 300) === 200, 'mid pane')
  assert(clampClientYToPane(100, 400, 80) === 0, 'above pane clamps')
  assert(clampClientYToPane(100, 400, 600) === 400, 'below pane / time axis clamps')
}

{
  assert(overlayYOffset(80, 80) === 0, 'aligned overlay')
  assert(overlayYOffset(96, 80) === 16, 'pane below overlay chrome')
  assert(overlayYOffset(80, 96) === -16, 'overlay below pane')
}

{
  const entry = 40000
  const stop = 39800
  const tp = takeProfitFromStopR({ entry, stop, direction: 'LONG' })
  assert(tp === 40300, `1.5R TP got ${tp}`)
  const dollars = riskBoxDollarPreview({
    entry,
    stop,
    target: tp,
    riskDollars: 400,
  })
  assert(dollars.lossDollars === 400, `loss ${dollars.lossDollars}`)
  assert(dollars.profitDollars === 600, `1.5R profit ${dollars.profitDollars}`)
}

{
  const entry = snapDeskPrice('DOW', 44821.4)
  const stop = snapStopToTick('DOW', entry, 44710.6, 'LONG')
  const rawTp = takeProfitFromStopR({ entry, stop, direction: 'LONG' })
  const tp = snapTargetToTick('DOW', entry, rawTp, 'LONG')
  const r = Math.abs(tp - entry) / Math.abs(entry - stop)
  assert(Math.abs(r - 1.5) < 1e-9, `snapped R ${r}`)
}

{
  const series = {
    priceToCoordinate: (p: number) => (p === 100 ? 40 : p === 90 ? 80 : null),
  }
  assert(seriesLayoutKey(series, [100, 90]) === '40|80', 'layout key')
  const zoomed = {
    priceToCoordinate: (p: number) => (p === 100 ? 10 : p === 90 ? 200 : null),
  }
  assert(seriesLayoutKey(zoomed, [100, 90]) !== seriesLayoutKey(series, [100, 90]), 'zoom changes key')
}

console.log('chart_pointer_price: ok')
