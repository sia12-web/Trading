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
import { VWAP_COLORS } from '../lib/chart/sessionVwap'

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

const live = src('app/dashboard/chart/components/TradingChart.tsx')
const simGone = src('app/dashboard/simulation/replay/desk/page.tsx')
assert.ok(simGone.includes("redirect('/dashboard/chart')"), 'simulation desk is removed')
assert.ok(live.includes('DESK_CANDLE_SERIES_COLORS'), 'live uses shared green/red on every market')
assert.ok(!live.includes('upColor: meta.color'), 'live does not paint GOLD/DOW accent as up-candles')
assert.equal(VWAP_COLORS.vwap, '#2962FF')
assert.equal(VWAP_COLORS.band1, '#4CAF50')
assert.ok(VWAP_COLORS.fill1.includes('0.05'), 'σ fill stays subtle')
assert.equal(VWAP_COLORS.band2, '#827717')
assert.equal(VWAP_COLORS.band3, '#00695C')
assert.ok(live.includes("title: 'VWAP'"), 'live reprints 5-month VWAP from CME daily bars')
assert.ok(live.includes('VWAP_COLORS.vwap'), 'VWAP uses the TradingView blue')
assert.ok(live.includes("title: '+3σ'"), '±3σ is a persistent line series')
assert.ok(live.includes("title: '-3σ'"), '−3σ is a persistent line series')
{
  const i = live.indexOf('Anchored VWAP — TradingView')
  const j = live.indexOf('Initial Balance — right-scale')
  assert.ok(i > 0 && j > i, 'VWAP series are created on the live chart')
  const vwapCreate = live.slice(i, j)
  assert.ok(vwapCreate.includes('...ignoreScale'), 'VWAP series do not flatten session candles')
  assert.ok(vwapCreate.includes('lastValueVisible: false'), 'σ / VWAP labels must not pull the Y-axis')
}
assert.ok(live.includes('avwapFetchDoneRef'), '5-month dailies load before the first VWAP paint')
assert.ok(live.includes('paintAnchoredVwapSigmaFill'), 'Background #1 fills between ±1σ')
assert.ok(live.includes('rangePocLineX'), 'POC spans the profiled range, not the thin histogram')
assert.ok(live.includes('desk-cooldown'), 'NYC close reprint is armed from the live chart')
assert.ok(live.includes('isOvernightInventoryWindow'), 'inventory FRVP keeps updating until 09:30')
assert.ok(live.includes('compute5MonthAnchoredVwapPath'), '5M VWAP is a running path, not a flat level')
assert.ok(!live.includes('seriesOf(avwap5mBenchmark.vwap)'), 'live does not stamp one daily VWAP on every 5m bar')
assert.ok(!live.includes("title: '5M +2σ'"), '5M ±σ must not be price-line axis labels')
assert.ok(!live.includes("title: '5M +1σ'"), '5M ±1σ must not be price-line axis labels')
assert.ok(!live.includes("title: '5M -2σ'"), '5M −2σ must not be price-line axis labels')
assert.ok(live.includes('paintAnchoredProfile'), 'FRVP histograms sit at each range open')
assert.ok(live.includes('frvp5d.startUnix'), '5-day FRVP is anchored at the 5-day range start')
assert.ok(live.includes('yesterdayNyc.openUnix'), 'yesterday FRVP is anchored at yesterday cash open')
assert.ok(live.includes('compactProfileWidth'), 'FRVP width stays a thin column at the range open')
assert.ok(live.includes('profileIntersectsPane'), 'off-screen FRVP waits until you scroll to the range')
assert.ok(!live.includes('stickyLeftX'), 'FRVP is not glued to the visible left edge')
assert.ok(live.includes('scaleOverlayPricesRef'), 'FRVP/POC extras stay off the candle autoscale helper')
assert.ok(!live.includes("title: '5D POC'"), '5D POC is canvas, not a scale-stretching price line')
assert.ok(!live.includes("title: '5D VAH'"), '5D VAH is not a price-line axis tag')
assert.ok(!live.includes("title: 'Y-High'"), 'Y-High is not a price-line axis tag')
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
assert.ok(live.includes('paintSierraNumberBars'), 'Footprint paints Sierra/Tradovate number bars')
assert.ok(live.includes('FOOTPRINT_RECENT_BARS'), 'Footprint is recent prints only')
assert.ok(live.includes('lineWidth: 3'), '5M VWAP center is the thicker middle band')
assert.ok(live.includes('reprint=1'), 'chart requests gap reprint when slots are missing')
assert.ok(live.includes('marketBookCacheRef'), 'market tabs paint from an in-memory book cache')
assert.ok(live.includes('skipGapReprintOnceRef'), 'timeframe switch does not invent gaps via reprint')
assert.ok(live.includes('bookMatchesBarSec'), 'gap reprint waits until held book matches TF')
assert.ok(candlesApi.includes('needsCandleReprint'), 'candles API reprints Databento+Yahoo on gaps')
assert.ok(candlesApi.includes('invalidateDatabentoCandleCache'), 'gap reprint bypasses Databento cache')
assert.ok(candlesApi.includes('Promise.all'), 'Databento and Yahoo stitch load in parallel')
assert.ok(!live.includes('fitContent()'), 'live Reset scale does not zoom to full history')
assert.ok(live.includes('deskVisibleLogicalRange(ordered.length, width)'), 'live bar count follows pane width')
assert.ok(live.includes('loadDeskViewport'), 'refresh restores pan/zoom')
assert.ok(live.includes('timeframeRef.current'), 'viewport save is TF-scoped')
assert.ok(
  /loadDeskViewport\(\s*instrument,\s*ordered\.length,\s*width,\s*timeframe\s*\)/.test(live),
  'viewport restore passes timeframe'
)
assert.ok(live.includes('resolveClockedChartInstrument'), 'clocked name wins over remembered DOW tab')
assert.ok(live.includes('ibLineSeriesData(ib, tipUnix)'), 'live IB ends at latest bar')
assert.ok(live.includes('axisLabelSeriesData'), 'live range H/L is right-scale only')
assert.ok(live.includes('lineVisible: false'), 'live ±10 bands are axis labels only')
assert.ok(live.includes("color: 'rgba(0,0,0,0)'"), 'live range ±10 stroke is invisible')
assert.ok(live.includes('axisLabelColor: s.color'), 'live range ±10 keeps the right-scale tag')
assert.ok(!live.includes('entryLive ? 3 : 1'), 'live IB ±10 is not a thick spanning line')
assert.ok(live.includes('keepDeskBarSpacing'), 'range unlock does not shrink candle width')
assert.ok(live.includes('if (interactingRef.current) return'), 'candle refresh does not yank viewport mid-pan')
assert.equal(DESK_CHART_THEME.handleScale.mouseWheel, false, 'plain wheel pans; Ctrl+wheel / pinch zoom')
assert.equal(DESK_CHART_THEME.kineticScroll.mouse, false, 'no mouse kinetic rubber-band while panning history')
assert.ok(live.includes('Ctrl/Meta + wheel'), 'Ctrl+wheel still zooms candle width')
assert.ok(live.includes("title: 'OR15 H'"), 'live range tags are one H/L/mid label')
assert.ok(!live.includes('Math.max(tipUnix, closeUnix)'), 'live IB adds no future close point')
assert.ok(
  live.includes('late clock-in still has a calculated OR30'),
  'OR30 lock survives skipped/missed window'
)
assert.ok(
  live.includes('Lock is independent of R'),
  'OR30 lock is independent of the R overlay toggle'
)
assert.ok(live.includes('const CANDLE_REFRESH_MS = 15_000'), 'history refetch is not a 3s CPU loop')
assert.ok(live.includes('applyTickToFormingBar'), 'live ticks roll 5m bars without a fake open')
assert.ok(live.includes('mergeHistoryWithLiveTip'), 'REST cannot repaint forming-bar color')
assert.ok(!live.includes('applyOverlayLayout(), 150'), 'overlay layout is not a 150ms idle loop')

console.log('chart_visual_quality.test.ts: all passed')

assert.ok(src('lib/chart/context55Paint.ts').includes('paneH * 0.75'), 'σ fill skips when bands span the pane')
assert.ok(src('app/dashboard/chart/components/TradingChart.tsx').includes('deskCvdSessionStartUnix'), 'CVD is Globex-session scoped')
assert.ok(src('app/dashboard/chart/components/TradingChart.tsx').includes('applySigmaBands'), 'σ bands use session-sized stdev')
