/**
 * Live/sim chart visual-quality contracts.
 * Run: npx tsx __tests__/chart_visual_quality.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DESK_VISIBLE_BARS,
  deskBarSpacing,
  deskVisibleBarCount,
  deskVisibleLogicalRange,
} from '../lib/trading/deskInstrumentPreference'
import {
  DESK_BAR_SPACING,
  DESK_CANDLE_DOWN,
  DESK_CANDLE_UP,
  DESK_CHART_THEME,
} from '../lib/chart/deskChartTheme'

const root = process.cwd()
const src = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

assert.ok(DESK_VISIBLE_BARS >= 70 && DESK_VISIBLE_BARS <= 110, 'readable default context')
const range = deskVisibleLogicalRange(3000)
assert.ok(range.to - range.from <= 120, 'live does not fit multi-day history')
assert.equal(deskVisibleBarCount(1160, 3000), 90)
assert.ok(deskVisibleBarCount(1600, 3000) > deskVisibleBarCount(1160, 3000))
assert.equal(deskBarSpacing(1200, 3000), DESK_BAR_SPACING)
assert.ok(DESK_BAR_SPACING >= 12, 'desktop candles remain individually readable')

assert.equal(DESK_CANDLE_UP, '#089981')
assert.equal(DESK_CANDLE_DOWN, '#f23645')
assert.equal(DESK_CHART_THEME.timeScale.lockVisibleTimeRangeOnResize, true)
assert.equal(DESK_CHART_THEME.timeScale.rightBarStaysOnScroll, true)
assert.equal(DESK_CHART_THEME.timeScale.barSpacing, DESK_BAR_SPACING)
assert.ok(DESK_CHART_THEME.timeScale.minBarSpacing <= 0.5, 'wheel zoom-out can show ~5 days')
assert.ok(DESK_CHART_THEME.timeScale.minBarSpacing > 0)
assert.equal(DESK_CHART_THEME.rightPriceScale.entireTextOnly, true)
assert.equal(DESK_CHART_THEME.rightPriceScale.alignLabels, true)
assert.equal(DESK_CHART_THEME.rightPriceScale.scaleMargins.top, DESK_CHART_THEME.rightPriceScale.scaleMargins.bottom)
assert.ok(DESK_CHART_THEME.rightPriceScale.scaleMargins.top >= 0.12)

const sim = src('app/dashboard/simulation/replay/desk/page.tsx')
assert.ok(sim.includes('deskVisibleLogicalRange(endIdx + 1, width)'), 'sim viewport matches live')
assert.ok(sim.includes('const list = visibleCandlesRef.current'), 'sim scales replay slice')
assert.ok(!sim.includes('const list = allCandlesRef.current'), 'sim does not scale fetched week')
assert.ok(sim.includes('const ignoreScale'), 'sim studies excluded from candle scale')
assert.ok(!sim.includes('autoscaleInfoProvider: undefined'), 'sim host cannot reopen default scale')
assert.ok(sim.includes('const extendTo = Math.max(tip, simT)'), 'sim adds no future close point')

const live = src('app/dashboard/chart/components/TradingChart.tsx')
assert.ok(live.includes('sessionFocusHighLow'), 'live Y-axis follows current session')
assert.ok(!live.includes('fitContent()'), 'live Reset scale does not zoom to full history')
assert.ok(live.includes('deskVisibleLogicalRange(ordered.length, width)'), 'live bar count follows pane width')
assert.ok(live.includes('loadDeskViewport(instrument, ordered.length, width)'), 'refresh restores pan/zoom')
assert.ok(live.includes('resolveClockedChartInstrument'), 'clocked name wins over remembered DOW tab')
assert.ok(live.includes('ibLineSeriesData(ib, tipUnix)'), 'live IB ends at latest bar')
assert.ok(!live.includes('Math.max(tipUnix, closeUnix)'), 'live IB adds no future close point')
assert.ok(
  live.includes('late clock-in still has a calculated OR30'),
  'OR30 lock survives skipped/missed window'
)
assert.ok(
  live.includes("OR30 {or30Locked ? 'locked' : or30Shaped ? 'forming' : showOr30 ? 'waiting' : 'off'}"),
  'legend reports locked OR30 even when R is off'
)
assert.ok(sim.includes('setOr30Locked(!!or30?.complete)'), 'sim locks OR30 from bars, not R toggle')

console.log('chart_visual_quality.test.ts: all passed')
