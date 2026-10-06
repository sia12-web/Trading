/**
 * Live/sim chart visual-quality contracts.
 * Run: npx tsx __tests__/chart_visual_quality.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DESK_VISIBLE_BARS,
  decodeDeskViewport,
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
assert.equal(deskVisibleBarCount(1160, 3000), DESK_VISIBLE_BARS)
assert.ok(deskVisibleBarCount(1600, 3000) > deskVisibleBarCount(1160, 3000))
assert.equal(deskBarSpacing(1200, 3000), DESK_BAR_SPACING)
assert.ok(DESK_BAR_SPACING >= 12, 'desktop candles remain individually readable')

// 30m timeframe specific assertions
assert.equal(deskBarSpacing(1200, 3000, '30m'), 16, '30m gets DESK_30M_BAR_SPACING for solid candles')
assert.ok(deskVisibleBarCount(1160, 3000, '30m') <= 70, '30m visible bar count avoids squishing')
const resetViewport = decodeDeskViewport({ fromEnd: 100, span: 90 }, 3000, 1160, '30m')
assert.ok(resetViewport.to - resetViewport.from <= 60, 'squished 30m span from old cache is reset')

assert.equal(DESK_CANDLE_UP, '#089981')
assert.equal(DESK_CANDLE_DOWN, '#f23645')
assert.equal(DESK_CHART_THEME.timeScale.lockVisibleTimeRangeOnResize, true)
assert.equal(DESK_CHART_THEME.timeScale.rightBarStaysOnScroll, false)
assert.equal(DESK_CHART_THEME.timeScale.barSpacing, DESK_BAR_SPACING)
assert.ok(DESK_CHART_THEME.timeScale.minBarSpacing <= 0.5, 'wheel zoom-out can show ~5 days')
assert.ok(DESK_CHART_THEME.timeScale.minBarSpacing > 0)
assert.equal(DESK_CHART_THEME.rightPriceScale.entireTextOnly, true)
assert.equal(DESK_CHART_THEME.rightPriceScale.alignLabels, true)
assert.ok(DESK_CHART_THEME.rightPriceScale.scaleMargins.top <= 0.12, 'top scale margin leaves headroom')
assert.ok(DESK_CHART_THEME.rightPriceScale.scaleMargins.bottom >= 0.15, 'bottom scale margin leaves room for volume/indicators')

const sim = src('app/dashboard/simulation/replay/desk/page.tsx')
assert.ok(sim.includes('deskVisibleLogicalRange(endIdx + 1, width)'), 'sim viewport matches live')
assert.ok(sim.includes('const list = visibleCandlesRef.current'), 'sim scales replay slice')
assert.ok(!sim.includes('const list = allCandlesRef.current'), 'sim does not scale fetched week')
assert.ok(sim.includes('const ignoreScale'), 'sim studies excluded from candle scale')
assert.ok(!sim.includes('autoscaleInfoProvider: undefined'), 'sim host cannot reopen default scale')
assert.ok(sim.includes('const extendTo = Math.max(tip, simT)'), 'sim adds no future close point')

assert.ok(DESK_CHART_THEME.rightPriceScale.minimumWidth >= 75, 'price scale has aligned minimum width to prevent sub-pixel time scale drift')

const live = src('app/dashboard/chart/components/TradingChart.tsx')
assert.ok(live.includes('sessionFocusHighLow'), 'live Y-axis follows current session')
assert.ok(!live.includes('fitContent()'), 'live Reset scale does not zoom to full history')
assert.ok(live.includes('deskVisibleLogicalRange(ordered.length, width'), 'live bar count follows pane width')
assert.ok(live.includes('loadDeskViewport(instrument, ordered.length, width'), 'refresh restores pan/zoom')
assert.ok(live.includes('resolveClockedChartInstrument'), 'clocked name wins over remembered DOW tab')
assert.ok(live.includes('ibLineSeriesData(ib, tipUnix)'), 'live IB ends at latest bar')
assert.ok(live.includes('axisLabelSeriesData'), 'live range H/L is right-scale only')
assert.ok(sim.includes('axisLabelSeriesData'), 'sim range H/L is right-scale only')
assert.ok(live.includes('lineVisible: false'), 'live ±10 bands are axis labels only')
assert.ok(sim.includes('lineVisible: false'), 'sim ±10 bands are axis labels only')
assert.ok(live.includes("color: 'rgba(0,0,0,0)'"), 'live range ±10 stroke is invisible')
assert.ok(live.includes('lastValueVisible: true'), 'live range ±10 keeps the right-scale tag')
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
  live.includes('or30Locked'),
  'legend reports locked OR30 even when R is off'
)
assert.ok(sim.includes('setOr30Locked(!!or30?.complete)'), 'sim locks OR30 from bars, not R toggle')
assert.ok(live.includes('const CANDLE_REFRESH_MS = 15_000'), 'history refetch is not a 3s CPU loop')
assert.ok(live.includes('applyTickToFormingBar'), 'live ticks roll 5m bars without a fake open')
assert.ok(live.includes('mergeHistoryWithLiveTip'), 'REST cannot repaint forming-bar color')
assert.ok(!live.includes('applyOverlayLayout(), 150'), 'overlay layout is not a 150ms idle loop')
assert.ok(live.includes('borderVisible: false'), 'live candles render solid filled bodies')
assert.ok(sim.includes('borderVisible: false'), 'sim candles render solid filled bodies')
assert.ok(live.includes('rangesDiffer'), 'CVD time scale sync guards sub-pixel ping-pong oscillation')
assert.ok(live.includes('syncCvdFromMainRef'), 'CVD pane follows the price chart zoom instead of drifting ahead')
assert.ok(live.includes('syncMainFromCvdRef'), 'CVD pane and price chart stay 1:1 in bidirectional lockstep')
assert.ok(live.includes('logicalFromPixel'), 'range boxes use pixel time so they can be drawn past the last print')
assert.ok(
  live.includes('const loadLevelsRef = useRef(loadLevels)'),
  'level-state refreshes do not blindly reload delayed candles'
)
assert.ok(
  live.includes('lastSseMessageAt'),
  'stale SSE connections trigger the REST safety path'
)
assert.ok(
  !live.includes('rightOffset: futurePad'),
  'selecting a drawing tool must not change rightOffset (that snaps the camera to the far right)'
)
assert.ok(live.includes('paintOverlaysSinglePassRef'), 'live tick overlay updates use single-pass throttled painter')
assert.ok(live.includes('chartOwnsWheel'), 'plot wheel is not zoomed a second time on top of Lightweight Charts')
assert.ok(live.includes('livePriceStateGapMs'), 'cash-open tick bursts stretch React badge commits')
assert.ok(!live.includes('updateCvdUnderCursor'), 'scroll does not setState a CVD legend')
const wheelAt = live.indexOf('const onChartWheel')
const wheelBody = live.slice(wheelAt, live.indexOf('const wrapperEl', wheelAt))
assert.ok(wheelBody.indexOf('if (onPlot)') < wheelBody.indexOf('setVisibleLogicalRange'), 'toolbar zoom runs only when the pointer is outside the plot')
const pokeAt = live.indexOf('const pokeOverlayLayout = useCallback')
const pokeBody = live.slice(pokeAt, live.indexOf('const pokeOverlayLayoutRef', pokeAt))
assert.equal(pokeBody.split('paintOverlaysSinglePassRef').length - 1, 1, 'scroll paints overlays once per frame')
assert.ok(!pokeBody.includes('paintFrvpHistogramRef'), 'volume profile is not drawn again beside the single pass')
assert.ok(!live.includes('closedChanged || !streamLive'), 'refreshCandles does not force full setData when market is static')

console.log('chart_visual_quality.test.ts: all passed')
