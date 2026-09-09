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
assert.ok(live.includes('DESK_CANDLE_SERIES_COLORS'), 'live uses shared green/red on every market')
assert.ok(!live.includes('upColor: meta.color'), 'live does not paint GOLD/DOW accent as up-candles')
assert.ok(live.includes("title: '5M VWAP'"), 'live reprints 5-month VWAP from CME daily bars')
assert.ok(live.includes('compute5MonthAnchoredVwapPath'), '5M VWAP is a running path, not a flat level')
assert.ok(!live.includes('seriesOf(avwap5mBenchmark.vwap)'), 'live does not stamp one daily VWAP on every 5m bar')
assert.ok(!live.includes("title: '5M +2σ'"), '5M ±σ must not be price-line axis labels')
assert.ok(!live.includes("title: '5M +1σ'"), '5M ±1σ must not be price-line axis labels')
assert.ok(!live.includes("title: '5M -2σ'"), '5M −2σ must not be price-line axis labels')
assert.ok(live.includes('stickyLeftX(0)'), '5-day FRVP is sticky on the visible pane')
assert.ok(!live.includes('NON-STICKY'), '5-day FRVP no longer scrolls off the default 90-bar view')
assert.ok(live.includes('scaleOverlayPricesRef'), 'Y-axis folds nearby Context 5-5 levels onto the session')
assert.ok(live.includes("title: '5D POC'"), '5D POC stays as a durable price line')
assert.ok(sim.includes('DESK_CANDLE_SERIES_COLORS'), 'sim uses the same green/red candles')
const candlesApi = src('app/api/trading/candles/route.ts')
assert.ok(
  candlesApi.includes("source !== 'databento'"),
  'Databento CME book is not mixed with OANDA CFD mids'
)
assert.ok(
  candlesApi.includes('Yahoo live-tail stitch'),
  'Databento hist delay is filled with Yahoo CME 5m so FRVP has yesterday bars'
)
const databentoClient = src('lib/databento/client.ts')
assert.ok(databentoClient.includes('mergeCandleSeries'), 'live Databento fills archive holes')
assert.ok(databentoClient.includes('parseDatabentoPx'), 'Databento prices handle decimal and 1e-9')
assert.ok(live.includes('sessionFocusHighLow'), 'live Y-axis follows current session')
assert.ok(!live.includes('fitContent()'), 'live Reset scale does not zoom to full history')
assert.ok(live.includes('deskVisibleLogicalRange(ordered.length, width)'), 'live bar count follows pane width')
assert.ok(live.includes('loadDeskViewport(instrument, ordered.length, width)'), 'refresh restores pan/zoom')
assert.ok(live.includes('resolveClockedChartInstrument'), 'clocked name wins over remembered DOW tab')
assert.ok(live.includes('ibLineSeriesData(ib, tipUnix)'), 'live IB ends at latest bar')
assert.ok(live.includes('axisLabelSeriesData'), 'live range H/L is right-scale only')
assert.ok(sim.includes('axisLabelSeriesData'), 'sim range H/L is right-scale only')
assert.ok(live.includes('lineVisible: false'), 'live ±10 bands are axis labels only')
assert.ok(sim.includes('lineVisible: false'), 'sim ±10 bands are axis labels only')
assert.ok(live.includes("color: 'rgba(0,0,0,0)'"), 'live range ±10 stroke is invisible')
assert.ok(live.includes('axisLabelColor: s.color'), 'live range ±10 keeps the right-scale tag')
assert.ok(!live.includes('entryLive ? 3 : 1'), 'live IB ±10 is not a thick spanning line')
assert.ok(live.includes('keepDeskBarSpacing'), 'range unlock does not shrink candle width')
assert.ok(live.includes("title: 'OR15 H'"), 'live range tags are one H/L/mid label')
assert.ok(sim.includes('paintRanges: overlays'), 'sim ±10 paint is toggle-gated')
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
assert.ok(live.includes('const CANDLE_REFRESH_MS = 15_000'), 'history refetch is not a 3s CPU loop')
assert.ok(live.includes('applyTickToFormingBar'), 'live ticks roll 5m bars without a fake open')
assert.ok(live.includes('mergeHistoryWithLiveTip'), 'REST cannot repaint forming-bar color')
assert.ok(!live.includes('applyOverlayLayout(), 150'), 'overlay layout is not a 150ms idle loop')

console.log('chart_visual_quality.test.ts: all passed')
