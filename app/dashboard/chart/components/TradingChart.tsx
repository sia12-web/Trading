'use client'

/**
 * TradingChart – full-featured interactive candlestick chart
 * Uses lightweight-charts v4 (TradingView's open-source charting library)
 *
 * Features:
 * - Candlestick series with real-time tick updates
 * - Volume histogram overlay
 * - Support/resistance level lines (from LevelStatusManager)
 * - Multi-instrument tabs: DOW · NASDAQ (NY desk)
 * - Fixed 5m timeframe (desk standard — live and simulation)
 * - Crosshair OHLCV tooltip panel
 * - Live price ticker + price change badge
 * - ResizeObserver for responsive width
 * - Real Finnhub candles via /api/trading/candles (synthetic fallback)
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  createChart,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type CandlestickData,
  type UTCTimestamp,
  type Time,
} from 'lightweight-charts'
import {
  AVWAP_CANDLE_FETCH_CALENDAR_DAYS,
  computeSessionHighlightSpans,
  projectSessionHighlightRects,
  paintSessionHighlightOverlay,
  timeToX,
  unixFromLogical,
  logicalFromPixel,
  deskClockFor,
  deskSessionAt,
  nyDeskSessionAt,
  isWeekdayYmd,
  zonedCivilToUnix,
  computeAnchoredVwap,
  lastNTradingSessions as trimDeskCandles,
  type SessionBar,
} from '@/lib/chart/sessionVwap'
import { parseCalendarEventMs } from '@/lib/trading/deskNewsHazard'
import AtrSubPane from './AtrSubPane'
import type { DeskCalendarEvent } from '@/lib/trading/deskNews'
import { computeNewsCatalystVwap } from '@/lib/chart/newsCatalystVwap'
import {
  detect5DaySessionExtremes,
  detectDailyExtremes,
  detectSpikes,
  detectDistributionReferences,
  detectEmotionalNewsMoves,
  shouldAnchorVwapToNews,
  isVeryImportantMacroEvent,
  type EmotionalNewsMove,
  type SessionExtreme,
} from '@/lib/chart/excesses'
import {
  applyTickToFormingBar,
  dropImplausibleDeskBars,
  mergeHistoryWithLiveTip,
  closedHistoryOhlcChanged,
  isPlausibleRealtimeTick,
  quoteUnixForBucket,
} from '@/lib/chart/liveFormingBar'
import { fillCandleGaps } from '@/lib/chart/candleGapFiller'
import {
  compute5MonthAnchoredVwap,
  compute5DayFixedRangeVolumeProfile,
  computeYesterdayNycSession,
  computeOvernightInventoryAndSessions,
  classifyMarketDayType,
  type FixedRangeVolumeProfile5D,
  type DayTypeEvaluation,
  type AnchoredVwapBenchmark5M,
  type YesterdayNycSession,
  type OvernightInventoryEvaluation,
  type ContextBar,
} from '@/lib/chart/context55'
import { fixedRangeFreezeAsOf, fixedRangePhase } from '@/lib/chart/structureClock'
import {
  formatChartClock,
  formatChartDate,
  mapTimesToChart,
  toChartTime,
  unixToBusinessDay,
  snapDailyUnix,
  chartTimeToUnix,
  isBusinessDay,
  isSameChartTime,
} from '@/lib/chart/chartTime'
import {
  TRADER_DISPLAY_LABEL,
  TRADER_DISPLAY_TZ,
} from '@/lib/chart/traderDisplayTz'
import { takeProfitFromStopR } from '@/lib/trading/positionSizing'
import {
  aiLevelsUrl,
  resolveDeskLevels,
  resolveAfternoonDeskLevels,
  computeInitialBalance,
  computeIbSignals,
  ibLineSeriesData,
  axisLabelSeriesData,
  snapProfitToRound,
  type InitialBalanceRange,
} from '@/lib/trading/deskLevels'
import {
  computeYesterdayProfile,
  resolveYesterdayAsOfUnix,
  yesterdayProfileBadgeText,
  yesterdayProfilePaintKey,
} from '@/lib/trading/yesterdayProfile'
import {
  computeOpeningActivity,
  openingActivityBadgeText,
  openingActivityPaintKey,
  resolveOpeningAsOfUnix,
} from '@/lib/trading/openingActivity'
import {
  computeMarketControl,
  marketControlBadgeText,
  marketControlPaintKey,
  resolveMarketControlAsOfUnix,
  type MarketControl,
} from '@/lib/trading/marketControl'
import {
  computeDeskCall,
  deskCallBadgeText,
  deskCallHoverText,
  resolveDeskCallAsOfUnix,
  assertDeskTicketEntry,
  ticketAllowedEdges,
  type DeskCall,
} from '@/lib/trading/deskCall'
import { deskCallModeHoverPrefix } from '@/lib/trading/deskCallMode'
import { SYSTEMATIC_LIVE_DESK } from '@/lib/trading/systematicDesk'
import {
  computeSessionExit,
  parseFillUnix,
  type SessionExitRead,
} from '@/lib/trading/sessionExit'
import { persistQuietDeskPerfLtar } from '@/lib/trading/ltarStore'
import {
  formatCallSetupTelegram,
  isNyCallSetup,
} from '@/lib/trading/nyDeskStrategy'
const AUCTION_COLORS: any = { high: '#3b82f6', low: '#ef4444', mid: '#eab308', buy: '#3b82f6', sell: '#ef4444' }
const auctionOverlayBadgeText = (..._args: any[]) => ''
const auctionOverlayPaintKey = (..._args: any[]) => ''
const computeAuctionOverlay = (..._args: any[]): any => null
const isAuctionInstrument = (..._args: any[]) => false
const resolveAuctionAsOfUnix = (..._args: any[]) => 0
type AuctionHud = any
type AuctionOverlaySignal = any
import { LeoAssistantPanel } from './LeoAssistantPanel'
import type { LeoChatContext, LeoDataPoint, LeoActivePosition } from '@/lib/ai/leoAssistant'
import {
  type UserTrendline,
  type UserRangeBox,
  type UserManualFRVP,
  type UserMeasure,
  computeCustomFixedRangeVolumeProfile,
  computeTrendlineMetrics,
  computeRangeMetrics,
  formatEtTime,
} from '@/lib/trading/userDrawings'
import { compareMultipleRanges } from '@/lib/trading/rangeVolumeComparison'
import { playTradingViewChime } from '@/lib/chart/soundEffects'
import {
  type LeoLongTermMemory,
  loadLongTermMemories,
  saveLongTermMemory,
  recordMemoryNotification,
  evaluatePriceAgainstMemories,
} from '@/lib/trading/leoLongTermMemory'
import { detectCandlestickPatterns, type Candle } from '@/lib/trading/candlestickPatterns'
import { isUsMarketHoliday } from '@/lib/chart/sessionVwap'
import {
  loadRulesForMarket,
  saveRulesForMarket,
  MARKET_DEFAULT_PARAMS,
  listenToRuleUpdates,
  isEntrySituationRule,
  type ArmedRule,
  type MarketInstrument,
} from '@/lib/trading/leoRules'
import {
  computeOrderFlowCvd,
  computeCvdCandleBars,
  type OrderFlowSummary,
} from '@/lib/trading/orderFlowDelta'
import {
  evaluateHorizontalRunway,
  calculateEmpiricalSpeedlines,
} from '@/lib/trading/trendlineStrategy'
import {
  evaluateWyckoffSetup,
  evaluateSpringOrUpthrustTrendline,
  type WyckoffBar,
  type WyckoffChartContext,
} from '@/lib/trading/wyckoffStrategy'
import {
  evaluatePriceQuestioning,
  isPriceQuestioningSessionActive,
  type PriceCritiqueEvaluation,
  type CritiqueSessionStart,
} from '@/lib/trading/priceQuestioning'

const DOW_15M_FAIL_COLORS: any = { high: '#3b82f6', low: '#ef4444', mid: '#eab308', buy: '#3b82f6', sell: '#ef4444' }
const computeDow15mFailOverlay = (..._args: any[]): any => null
const dow15mFailBadgeText = (..._args: any[]) => ''
const dow15mFailPaintKey = (..._args: any[]) => ''
const isDowVolumeBarInstrument = (..._args: any[]) => false
type Dow15mFailHud = any
type Dow15mFailSignal = any

const applyIbLiquiditySwingToRange = (r?: any, ..._args: any[]) => r
const applyIbLiquiditySwingToRanges = (r?: any, ..._args: any[]) => r
const computeIbExtendAdvice = (..._args: any[]): any => ({
  chip: '—',
  message: '',
  entryAdvice: null,
  stopAdvice: null,
  swing: null,
  regime: null,
  ibComplete: false,
})
const findIbLiquiditySwing = (..._args: any[]): any => null
const ibExtendAlertKind = (..._args: any[]) => ''
type IbExtendAdvice = any

import { quoteBelongsToBook } from '@/lib/trading/deskExitGuard'
import { nyDateTimeToUnix } from '@/lib/utils/dateUtils'
import { DraggableDeskWidget } from '@/app/dashboard/components/DraggableDeskWidget'

const LiveVoicePanel = (_props: any): any => null
const AuctionHudPanel = (_props: any): any => null
const Dow15mFailHudPanel = (_props: any): any => null
import {
  DESK_BAR_SPACING,
  DESK_CANDLE_DOWN,
  DESK_CANDLE_UP,
  DESK_CHART_THEME,
  getDeskChartThemeOptions,
} from '@/lib/chart/deskChartTheme'
import {
  lockToCandleAutoscale,
  paddedCandlePriceRange,
  sessionFocusHighLow,
} from '@/lib/chart/seriesAutoscale'
import {
  isDeskInstrument,
  isLiveBarsAllowed,
  isChartStreamAllowed,
  isLiveTipStreamAllowed,
  isLevelPaintAllowed,
  isAfternoonWatchWindow,
  isLiveTradingPageOpen,
  liveVisibleInstruments,
  sessionFor,
  deskMarketFor,
  isNycSessionActive,
} from '@/lib/trading/sessionGate'
import type { AsiaDeskOverlay } from '@/lib/trading/asiaDesk'
import {
  resolveDeskPlaybookMode,
  deskPlaybookAnalysisMode,
  deskPlaybookHint,
  deskPlaybookUsesAfternoonLevels,
  deskPlaybookPanelTitle,
  isDeskEntryWindowActive,
  isDeskWatchOnlyPlaybook,
} from '@/lib/trading/deskPlaybookMode'
import {
  attemptLadderFromCounts,
  assertBucketEntryEligible,
  deskClockSeconds,
} from '@/lib/trading/attemptLadder'
import {
  activeRangeForPlaybook,
  entryEligibleOverlayRanges,
  studyEntrySnapRanges,
  strategyEntryRisk,
  type StrategyRangeEdges,
  type StrategyRiskMagnets,
} from '@/lib/trading/strategyRiskGeometry'
const snapEntryToNearestOpenBandCenter = (..._args: any[]): any => null
const clampPriceToRangeEdgeEnvelope = (px: number, ..._args: any[]) => px
const filterLevelsInRangeEdgeBand = (levels: any[], ..._args: any[]) => levels
const attributePlaybookBandEntry = (..._args: any[]): any => null
const NO_IN_BAND_LEVELS_MESSAGE = ''
const RANGE_EDGE_OFF_BAND_MESSAGE = 'Entry restricted'

const computeRangeEdgeTails = (..._args: any[]): any[] => []
const latestQualityTail = (..._args: any[]): any => null
const preferLevelsWithRangeEdgeTail = (levels?: any[], ..._args: any[]) => levels ?? []
type RangeEdgeTail = any
type ShapedRangeForTails = any

import {
  formatRangeShapedNote,
  claimDeskNoteOnce,
  deskNoteClaimKey,
  hasDeskNoteClaim,
} from '@/lib/notify/deskSessionNotes'
const rangeEdgeProximity = (..._args: any[]): any => null

export type RangeAtrSnapshot = {
  height: number
  atr: number | null
  stopPad: number
  trailStep: number
  wide: boolean
  rangeLabel?: string
  ratio?: number
  label?: string
} | null
const buildRangeAtrSnapshot = (..._args: any[]): RangeAtrSnapshot => null
const formatRangeAtrAdviceLine = (..._args: any[]): string | null => null

type RangeSeriesPts = { high: { time: number; value: number }[]; low: { time: number; value: number }[] }
const OR15_COLORS: any = { high: '#3b82f6', low: '#ef4444', mid: '#eab308', buy: '#3b82f6', sell: '#ef4444' }
const computeOr15Range = (..._args: any[]): any => null
const computeOr15Signals = (..._args: any[]): any[] => []
const isOr15Instrument = (..._args: any[]) => false
const or15LineSeriesData = (..._args: any[]): RangeSeriesPts => ({ high: [], low: [] })
type Or15Range = any

const NIKKEI_US_RANGE_COLORS: any = { high: '#3b82f6', low: '#ef4444' }
const computeNikkeiUsRangeBreakout = (..._args: any[]): any => null
const isNikkeiUsRangeInstrument = (..._args: any[]) => false
const nikkeiUsRangeLineSeriesData = (..._args: any[]): any => ({ high: [], low: [] })

const OR30_COLORS: any = { high: '#3b82f6', low: '#ef4444', mid: '#eab308', buy: '#3b82f6', sell: '#ef4444' }
const computeOr30Range = (..._args: any[]): any => null
const computeOr30Signals = (..._args: any[]): any[] => []
const isOr30Instrument = (..._args: any[]) => false
const or30LineSeriesData = (..._args: any[]): RangeSeriesPts => ({ high: [], low: [] })
type Or30Range = any
import {
  setDeskInstrumentPreference,
  deskVisibleLogicalRange,
  deskBarSpacing,
  loadDeskViewport,
  saveDeskViewport,
  loadDeskOverlayToggles,
  saveDeskOverlayToggles,
} from '@/lib/trading/deskInstrumentPreference'
import {
  liveDeskContractLabel,
  liveDeskIndexHint,
  resolveClockedChartInstrument,
} from '@/lib/trading/liveDeskBook'
import { snapDeskPrice, snapStopToTick, snapTargetToTick } from '@/lib/trading/instrumentTicks'
import { deskBookLines } from '@/lib/trading/tradovateMirror'
import {
  overlayTopFromPrice,
  priceFromClientY,
  riskBoxDollarPreview,
} from '@/lib/chart/chartPointerPrice'
import {
  OVERLAY_NODE_SELECTOR,
  OV_BOX_PRICE,
  OV_BOX_TIME,
  OV_DY,
  OV_PRICE,
  OV_SPAN,
  OVERLAY_HIDDEN_TRANSFORM,
  overlayHide,
  overlayNumbers,
  overlayPlace,
} from '@/lib/chart/overlayLayout'
import { resolveTradeifyPlace } from '@/lib/trading/tradeifyGrowth50k'
import {
  didPriceTouchAlert,
  formatPriceTouchAlert,
  hasPriceLeftAlert,
  loadStoredPriceAlert,
  saveStoredPriceAlert,
  type StoredPriceAlert,
} from '@/lib/trading/priceTouchAlert'

/** How long client-cached bars may be painted to cover an instrument/timeframe switch. */
const CANDLE_CACHE_FRESH_MS = 300_000
/**
 * A cached last price may only be republished this recently. It marks open positions, so
 * an older value must surface as "no price" rather than as a stale live quote.
 */
const CACHED_PRICE_FRESH_MS = 15_000

/** Header ticker repaint cadence — the readout subtree only. */
const PRICE_TICKER_MS = 50
/** Cadence for the React state that feeds badges / proximity / alert effects. */
const PRICE_STATE_MS = 500
/** REST reconcile spacing while the SSE push stream is still delivering ticks.
 * Kept at 2 s so the chart keeps updating during low-volatility Asian/overnight
 * sessions even when OANDA emits no price ticks for several seconds. */
const RECONCILE_HEALTHY_MS = 2_000

/** Candle width before range overlays / last-value tags relayout the pane. */
function readDeskBarSpacing(chart: { timeScale: () => { options: () => { barSpacing: number } } } | null): number {
  try {
    const n = chart?.timeScale().options().barSpacing
    return typeof n === 'number' && n > 0 ? n : DESK_BAR_SPACING
  } catch {
    return DESK_BAR_SPACING
  }
}

/** Squared distance from point (px, py) to line segment (x1, y1) - (x2, y2) */
function distToSegmentSquared(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)
  if (l2 === 0) return (px - x1) * (px - x1) + (py - y1) * (py - y1)
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2
  t = Math.max(0, Math.min(1, t))
  const projX = x1 + t * (x2 - x1)
  const projY = y1 + t * (y2 - y1)
  return (px - projX) * (px - projX) + (py - projY) * (py - projY)
}

/** Range unlock must not shrink candle barSpacing — restore after LWC relayout. */
function keepDeskBarSpacing(
  chart: { timeScale: () => { applyOptions: (o: { barSpacing: number }) => void } } | null,
  spacing: number
) {
  if (!chart || !(spacing > 0)) return
  const apply = () => {
    try {
      chart.timeScale().applyOptions({ barSpacing: spacing })
    } catch {
      /* ignore */
    }
  }
  apply()
  requestAnimationFrame(apply)
}

const HIGHLIGHT_COLOR_PALETTES = [
  {
    border: 'border-violet-500',
    bg: 'bg-violet-500/15',
    text: 'text-violet-200',
    pillBorder: 'border-violet-500/40',
    pillBg: 'bg-[#161b22]/90',
    badgeText: 'text-violet-300',
  },
  {
    border: 'border-cyan-400',
    bg: 'bg-cyan-500/15',
    text: 'text-cyan-200',
    pillBorder: 'border-cyan-400/40',
    pillBg: 'bg-[#161b22]/90',
    badgeText: 'text-cyan-300',
  },
  {
    border: 'border-emerald-400',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-200',
    pillBorder: 'border-emerald-400/40',
    pillBg: 'bg-[#161b22]/90',
    badgeText: 'text-emerald-300',
  },
  {
    border: 'border-amber-400',
    bg: 'bg-amber-500/15',
    text: 'text-amber-200',
    pillBorder: 'border-amber-400/40',
    pillBg: 'bg-[#161b22]/90',
    badgeText: 'text-amber-300',
  },
  {
    border: 'border-rose-400',
    bg: 'bg-rose-500/15',
    text: 'text-rose-200',
    pillBorder: 'border-rose-400/40',
    pillBg: 'bg-[#161b22]/90',
    badgeText: 'text-rose-300',
  },
  {
    border: 'border-indigo-400',
    bg: 'bg-indigo-500/15',
    text: 'text-indigo-200',
    pillBorder: 'border-indigo-400/40',
    pillBg: 'bg-[#161b22]/90',
    badgeText: 'text-indigo-300',
  },
]

function getHighlightTheme(index: number, isUnsent: boolean) {
  if (isUnsent) {
    return {
      border: 'border-amber-400 animate-pulse',
      bg: 'bg-amber-400/15',
      text: 'text-amber-200',
      pillBorder: 'border-amber-400/40',
      pillBg: 'bg-[#161b22]/90',
      badgeText: 'text-amber-300',
    }
  }
  const theme = HIGHLIGHT_COLOR_PALETTES[index % HIGHLIGHT_COLOR_PALETTES.length]!
  return theme
}

type DeskChartFmt = {
  formatTime: (unix: number, withSeconds?: boolean) => string
  formatDate: (unix: number, style?: 'day' | 'month' | 'year') => string
  tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => string
  timeFormatter: (time: Time) => string
  tzLabel: string
}

function getTradingSessionDate(unix: number, timeZone: string): Date {
  const d = new Date(unix * 1000)
  const fmtHour = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false })
  const hour = parseInt(fmtHour.format(d), 10)

  // Overnight/Asia session starts at 18:00 (6 PM ET) on the previous calendar day
  const dateOffset = hour >= 18 ? 1 : 0

  const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
  const parts = fmtDate.formatToParts(d)
  const getVal = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value)

  return new Date(getVal('year'), getVal('month') - 1, getVal('day') + dateOffset)
}

function getRelativeTradingDayLabel(unix: number, nowUnix: number, timeZone: string): string {
  const tDate = getTradingSessionDate(unix, timeZone)
  const nowDate = getTradingSessionDate(nowUnix, timeZone)

  const diffMs = nowDate.getTime() - tDate.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays} trading days ago`
}

function describeTimeHighlightSpan(
  label: string,
  startUnix: number,
  endUnix: number,
  priceStart: number,
  priceEnd: number,
  instrument: Instrument
): string {
  const startSess = deskSessionAt(startUnix, instrument) || 'Overnight'
  const endSess = deskSessionAt(endUnix, instrument) || 'Overnight'

  const nowUnix = Date.now() / 1000
  const timeZone = TRADER_DISPLAY_TZ

  const startDateStr = getRelativeTradingDayLabel(startUnix, nowUnix, timeZone)
  const endDateStr = getRelativeTradingDayLabel(endUnix, nowUnix, timeZone)

  const diffPts = priceEnd - priceStart
  const pct = priceStart > 0 ? (diffPts / priceStart) * 100 : 0
  const moveStr = `${diffPts >= 0 ? '+' : ''}${diffPts.toFixed(2)} pts (${diffPts >= 0 ? '+' : ''}${pct.toFixed(2)}%)`

  const startDetail = `${priceStart.toLocaleString()} (${startDateStr} ${startSess})`
  const endDetail = `${priceEnd.toLocaleString()} (${endDateStr} ${endSess})`

  if (startDateStr === endDateStr && startSess === endSess) {
    return `${label}: Move Details: 1st Click Start @ ${priceStart.toLocaleString()} -> 2nd Click Finish @ ${priceEnd.toLocaleString()} (${moveStr}) in ${startDateStr}'s ${startSess} Session`
  }
  return `${label}: Move Details: 1st Click Start @ ${startDetail} -> 2nd Click Finish @ ${endDetail}, Net Move: ${moveStr}`
}

/**
 * Axis / crosshair formatters for desk-shifted chart times.
 * Candle setData uses toChartTime() so UTC comps == Montreal wall clock;
 * labels therefore read UTC getters (not a second TZ conversion).
 */
function makeDeskChartFormatters(_instrument: Instrument, timeframe: DeskTimeframe = '5m'): DeskChartFmt {
  const tzLabel = TRADER_DISPLAY_LABEL
  const toUnix = (time: Time) => chartTimeToUnix(time)

  const formatTime = (chartUnix: number, withSeconds = false) =>
    formatChartClock(chartUnix, withSeconds)
  const formatDate = (chartUnix: number, style: 'day' | 'month' | 'year' = 'day') =>
    formatChartDate(chartUnix, style)

  const isDaily = timeframe === '1D'

  return {
    formatTime,
    formatDate,
    tzLabel,
    tickMarkFormatter: (time, tickMarkType) => {
      const unix = toUnix(time)
      if (!Number.isFinite(unix)) return ''
      if (isDaily) {
        switch (tickMarkType) {
          case TickMarkType.Year:
            return formatDate(unix, 'year')
          case TickMarkType.Month:
            return formatDate(unix, 'month')
          default:
            return formatDate(unix, 'day')
        }
      }
      switch (tickMarkType) {
        case TickMarkType.Year:
          return formatDate(unix, 'year')
        case TickMarkType.Month:
          return formatDate(unix, 'month')
        case TickMarkType.DayOfMonth:
          return formatDate(unix, 'day')
        case TickMarkType.TimeWithSeconds:
          return formatTime(unix, true)
        case TickMarkType.Time:
        default:
          return formatTime(unix)
      }
    },
    timeFormatter: (time) => {
      const unix = toUnix(time)
      if (!Number.isFinite(unix)) return ''
      if (isDaily) {
        const d = new Date(unix * 1000)
        return d.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })
      }
      return `${formatDate(unix, 'day')} ${formatTime(unix)} ${tzLabel}`
    },
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Instrument = 'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE' | 'NIKKEI'

export type DeskTimeframe = '1m' | '5m' | '30m' | '1D'
export const DESK_TIMEFRAMES: DeskTimeframe[] = ['1m', '5m', '30m', '1D']

export function barSecondsForTimeframe(tf: DeskTimeframe): number {
  return tf === '1m' ? 60 : tf === '30m' ? 1800 : tf === '1D' ? 86400 : 300
}

/** Desk charts default to 5m — 1m and 30m available on demand. */
export const DESK_TIMEFRAME = '5m' as const
export const DESK_BAR_SECONDS = 300

/** Keep re-placing overlays this long after the last pan/zoom/resize event. */
const OVERLAY_SETTLE_MS = 320
/** Plain useLayoutEffect warns during SSR; the chart pane is browser-only. */
const useOverlayLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

interface OHLCV {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface LevelLine {
  price: number
  type: 'support' | 'resistance' | 'vwap' | string
  /** Playbook side — drives Limit Buy vs Limit Short on click */
  side?: 'BUY' | 'SHORT'
  status: string
  label?: string
  conviction?: number
  reasoning?: string
  source?: 'ai' | 'status' | 'structure'
  marketVerdict?: 'respected' | 'contested' | 'broken' | 'untested'
  marketOutcome?: 'held' | 'broke' | 'untested'
  testedCount?: number
  successCount?: number
}

interface TooltipData {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  change: number
  changePct: number
  cvd?: number
  barDelta?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INSTRUMENT_META: Record<Instrument, { label: string; symbol: string; color: string; basePrice: number }> = {
  DOW: { label: 'Micro Dow · MYM', symbol: 'MYM', color: '#1d4ed8', basePrice: 52500 },
  NASDAQ: { label: 'Micro Nasdaq · MNQ', symbol: 'MNQ', color: '#0f766e', basePrice: 29500 },
  GOLD: { label: 'Micro Gold · MGC', symbol: 'MGC', color: '#ca8a04', basePrice: 4350 },
  CRUDE: { label: 'Crude · CL', symbol: 'CL', color: '#78716c', basePrice: 104 },
  NIKKEI: { label: 'Nikkei 225 · NKD', symbol: 'NKD', color: '#dc2626', basePrice: 38900 },
}

/** Exchange-native axis precision keeps labels clean like TradingView. */
function deskCandlePriceFormat(instrument: Instrument) {
  if (instrument === 'DOW') {
    return { type: 'price' as const, precision: 0, minMove: 1 }
  }
  if (instrument === 'NIKKEI') {
    return { type: 'price' as const, precision: 0, minMove: 5 }
  }
  if (instrument === 'GOLD') {
    return { type: 'price' as const, precision: 1, minMove: 0.1 }
  }
  if (instrument === 'NASDAQ') {
    return { type: 'price' as const, precision: 2, minMove: 0.25 }
  }
  return { type: 'price' as const, precision: 2, minMove: 0.01 }
}

function paintPositionBandOverlay(
  host: HTMLElement | null,
  bands: Array<{ top: number; height: number; color: string; border: string; title: string }>,
  opts?: { keepPreviousIfEmpty?: boolean }
) {
  if (!host) return
  if (bands.length === 0 && opts?.keepPreviousIfEmpty && host.childElementCount > 0) return
  while (host.childElementCount < bands.length) {
    const d = document.createElement('div')
    d.className = 'pointer-events-none absolute'
    d.style.position = 'absolute'
    d.style.left = '0'
    d.style.right = '0'
    d.style.margin = '0'
    d.style.padding = '0'
    d.style.boxSizing = 'border-box'
    host.appendChild(d)
  }
  while (host.childElementCount > bands.length) {
    host.removeChild(host.lastElementChild!)
  }
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]!
    const d = host.children[i] as HTMLElement
    d.style.top = `${b.top}px`
    d.style.height = `${Math.max(0, b.height)}px`
    d.style.backgroundColor = b.color
    d.style.borderLeft = `4px solid ${b.border}`
    d.style.zIndex = '1'
    d.title = b.title
  }
}


/** Map rule-grader verdict → chart status (drives line color + panel badge). */
function reactionStatus(
  verdict?: string | null,
  outcome?: string | null
): string {
  if (verdict === 'respected') return 'respected'
  if (verdict === 'broken') return 'broken'
  if (verdict === 'contested') return 'contested'
  if (outcome === 'held') return 'held'
  if (outcome === 'broke') return 'broken'
  return 'untested'
}

function reactionLabel(l: LevelLine): string | null {
  const v = l.marketVerdict || l.status
  if (!v || v === 'untested' || v === 'ai' || v === 'structure') return null
  const tests = l.testedCount ?? 0
  const holds = l.successCount ?? 0
  if (v === 'respected' || v === 'held' || v === 'bounced') {
    return tests > 0 ? `held ${holds}/${tests}` : 'held'
  }
  if (v === 'broken' || v === 'rejected') {
    return tests > 0 ? `broke ${tests - holds}/${tests}` : 'broke'
  }
  if (v === 'contested' || v === 'touched') {
    return tests > 0 ? `mixed ${holds}/${tests}` : 'mixed'
  }
  return null
}

// Chart light theme (TradingView-style near-white pane)
const CHART_THEME = DESK_CHART_THEME

/** Desk window: from cash open of 5 trading days prior to tip through now. */
function toDeskCandles(
  candles: OHLCV[],
  instrument: Instrument = 'DOW',
  timeframe: DeskTimeframe = '5m'
): OHLCV[] {
  if (timeframe === '1D') {
    return candles
  }
  const trimmed = trimDeskCandles(
    candles.map((c) => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    })),
    5,
    deskClockFor(instrument)
  )
  if (trimmed.length === 0) return candles
  const sane = dropImplausibleDeskBars(trimmed, instrument, timeframe)
  const rows = sane.length > 0 ? sane : trimmed
  return rows.map((c) => ({
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))
}

/**
 * lightweight-charts requires strictly ascending unique times.
 * Yahoo (and merges) can return duplicates or slightly out-of-order bars.
 */
function normalizeCandleTimes(candles: OHLCV[], tf: DeskTimeframe = '5m'): OHLCV[] {
  if (!Array.isArray(candles) || candles.length === 0) return []
  const step = barSecondsForTimeframe(tf)
  const sorted = [...candles].sort(
    (a, b) => (a.time as number) - (b.time as number)
  )
  const out: OHLCV[] = []
  for (const c of sorted) {
    if (!c) continue
    const rawT = Number(c.time)
    const o = Number(c.open)
    const h = Number(c.high)
    const l = Number(c.low)
    const cl = Number(c.close)
    if (!Number.isFinite(rawT) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(cl)) continue
    // Daily bars: NY session date at UTC midnight. Yahoo stamps some days at 13:00/14:00 UTC
    // (shortened sessions) which would otherwise plot as a second candle on the same day.
    const t = tf === '1D' ? snapDailyUnix(rawT) : Math.floor(rawT / step) * step
    const safeCandle: OHLCV = {
      time: t as UTCTimestamp,
      open: o,
      high: Math.max(o, h, l, cl),
      low: Math.min(o, h, l, cl),
      close: cl,
      volume: Number.isFinite(c.volume) ? Number(c.volume) : 0,
    }
    const prev = out[out.length - 1]
    if (prev && (prev.time as number) === t) {
      out[out.length - 1] = {
        ...prev,
        high: Math.max(prev.high, safeCandle.high),
        low: Math.min(prev.low, safeCandle.low),
        close: safeCandle.close,
        volume: (prev.volume || 0) + (safeCandle.volume || 0),
      }
      continue
    }
    if (prev && t <= (prev.time as number)) continue
    out.push(safeCandle)
  }
  const filled = tf === '1D' ? out : fillCandleGaps(out.map((c) => ({ ...c, time: c.time as number })), tf)
  return filled.map((c) => ({ ...c, time: c.time as UTCTimestamp }))
}

/** Series time: equally-spaced BusinessDay on 1D, Montreal-shifted unix otherwise. */
function toSeriesTime(unixSec: number, timeframe: DeskTimeframe, tz: string): Time {
  if (timeframe === '1D') return unixToBusinessDay(unixSec)
  return toChartTime(unixSec, tz) as UTCTimestamp
}

function toDailyLinePoints(
  rows: Array<{ time: number; value: number }>
): Array<{ time: Time; value: number }> {
  const out: Array<{ time: Time; value: number }> = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!Number.isFinite(row.time) || !Number.isFinite(row.value)) continue
    const day = unixToBusinessDay(row.time)
    const key = `${day.year}-${day.month}-${day.day}`
    if (seen.has(key)) {
      out[out.length - 1] = { time: day, value: row.value }
      continue
    }
    seen.add(key)
    out.push({ time: day, value: row.value })
  }
  return out
}

/**
 * Ensures any data array passed to lightweight-charts has strictly ascending unique timestamps.
 * Prevents runtime errors and blank charts from out-of-order or duplicate bars.
 */
function sanitizeChartPoints<T extends { time: number | UTCTimestamp; value: number }>(rows: T[]): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const sorted = [...rows].sort((a, b) => (a.time as number) - (b.time as number))
  const out: T[] = []
  for (const item of sorted) {
    const t = Math.floor(Number(item.time))
    if (!Number.isFinite(t) || !Number.isFinite(item.value)) continue
    const prev = out[out.length - 1]
    if (prev && (prev.time as number) === t) {
      out[out.length - 1] = { ...item, time: t as UTCTimestamp }
      continue
    }
    if (prev && t <= (prev.time as number)) continue
    out.push({ ...item, time: t as UTCTimestamp })
  }
  return out
}

const VWAP_COLORS = {
  vwap: '#b8a04a',
  band: '#3d8f7a',
} as const

// ─── Generate realistic synthetic OHLCV candles (last 5 trading days) ────────

function generateCandles(basePrice: number, tfSeconds: number): OHLCV[] {
  // 5 days of bars, capped at 1500 so 1m doesn't explode
  const count = Math.min(Math.ceil(5 * 24 * 3600 / tfSeconds), 1500)
  const candles: OHLCV[] = []
  const now = Math.floor(Date.now() / 1000)
  const start = now - tfSeconds * count

  let price = basePrice
  const volatility = basePrice * 0.0008  // 0.08% per candle

  for (let i = 0; i < count; i++) {
    const t = (start + i * tfSeconds) as UTCTimestamp

    const open = price
    const move = (Math.random() - 0.48) * volatility * 2
    const close = open + move
    const wick = Math.random() * volatility
    const high = Math.max(open, close) + wick
    const low = Math.min(open, close) - wick * 0.7
    const volume = Math.floor(50000 + Math.random() * 200000)

    candles.push({ time: t, open, high, low, close, volume })
    price = close
  }

  return candles
}

// ─── OHLCV tooltip component ──────────────────────────────────────────────────

function OHLCVTooltip({ data, color }: { data: TooltipData | null; color: string }) {
  if (!data) {
    return (
      <div className="flex items-center flex-nowrap whitespace-nowrap gap-x-3.5 text-xs price-mono select-none pointer-events-none opacity-0 invisible" aria-hidden="true">
        <span className="text-gray-600">00:00:00</span>
        <span className="text-gray-500">O <span className="text-gray-300">00,000.00</span></span>
        <span className="text-gray-500">H <span className="text-green-400">00,000.00</span></span>
        <span className="text-gray-500">L <span className="text-red-400">00,000.00</span></span>
        <span className="text-gray-500">C <span style={{ color }}>00,000.00</span></span>
        <span className="text-gray-500">V <span className="text-cyan-400 font-semibold">0.0k</span></span>
        <span className="text-gray-500">CVD <span className="font-semibold text-cyan-400">+0.0k</span></span>
        <span className="text-green-400">▲ 0.00%</span>
      </div>
    )
  }

  const isUp = data.change >= 0

  return (
    <div className="flex items-center flex-nowrap whitespace-nowrap gap-x-3.5 text-xs price-mono select-none pointer-events-none">
      <span className="text-gray-600">{data.time}</span>
      <span className="text-gray-500">O <span className="text-gray-300">{data.open.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
      <span className="text-gray-500">H <span className="text-green-400">{data.high.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
      <span className="text-gray-500">L <span className="text-red-400">{data.low.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
      <span className="text-gray-500">C <span style={{ color }}>{data.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
      {data.volume > 0 && (
        <span className="text-gray-500">
          V <span className="text-cyan-400 font-semibold">{data.volume >= 1000 ? `${(data.volume / 1000).toFixed(1)}k` : data.volume.toLocaleString()}</span>
        </span>
      )}
      {data.cvd !== undefined && (
        <span className="text-gray-500">
          CVD <span className={`font-semibold ${data.cvd >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
            {data.cvd >= 0 ? '+' : ''}{Math.abs(data.cvd) >= 1000 ? `${(data.cvd / 1000).toFixed(1)}k` : data.cvd.toLocaleString()}
          </span>
          {data.barDelta !== undefined && (
            <span className={`text-[10px] ml-1 ${data.barDelta >= 0 ? 'text-cyan-300' : 'text-rose-300'}`}>
              (Δ {data.barDelta >= 0 ? '+' : ''}{Math.abs(data.barDelta) >= 1000 ? `${(data.barDelta / 1000).toFixed(1)}k` : data.barDelta.toLocaleString()})
            </span>
          )}
        </span>
      )}
      <span className={isUp ? 'text-green-400' : 'text-red-400'}>
        {isUp ? '▲' : '▼'} {Math.abs(data.changePct).toFixed(2)}%
      </span>
    </div>
  )
}

// ─── Live price ticker (isolated from the chart's own render) ─────────────────

type LivePriceTick = { price: number; changePct: number }

type LivePriceStore = {
  tick: LivePriceTick | null
  subs: Set<() => void>
}

/**
 * Header readout only. Subscribing here keeps a ~20 Hz price print from
 * re-rendering the whole chart component.
 */
const LivePriceTicker = memo(function LivePriceTicker({
  subscribe,
  getTick,
  instrument,
  barCountdown,
  timeframe,
}: {
  subscribe: (onChange: () => void) => () => void
  getTick: () => LivePriceTick | null
  instrument: Instrument
  barCountdown: string
  timeframe?: string
}) {
  const tick = useSyncExternalStore(subscribe, getTick, getTick)
  if (!tick || !tick.price) return null
  const isUp = tick.changePct >= 0
  return (
    <div className="flex flex-col items-end leading-tight">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500" title={liveDeskIndexHint(instrument)}>
          {INSTRUMENT_META[instrument].label}
        </span>
        <span
          className="price-mono text-xl font-extrabold transition-colors duration-300"
          style={{ color: INSTRUMENT_META[instrument].color }}
          title={
            liveDeskIndexHint(instrument) ||
            'OANDA mid (bid+ask)/2 — compare TradingView to the same index (MNQ vs MYM are different markets)'
          }
        >
          {tick.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${isUp ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
          }`}>
          {isUp ? '▲' : '▼'} {Math.abs(tick.changePct).toFixed(2)}
        </span>
      </div>
      {barCountdown && (
        <div
          className="flex items-center gap-1.5 font-mono text-xs font-bold text-emerald-400 mt-0.5"
          title={`Time remaining in current ${timeframe || '5-minute'} candle`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-300 font-extrabold tracking-widest">{barCountdown}</span>
        </div>
      )}
    </div>
  )
})

// ─── TradingChart props ───────────────────────────────────────────────────────

interface PositionOverlay {
  positionId?: string
  entryPrice: number
  stopLoss: number
  profitTarget: number
  direction: 'long' | 'short'
  /** Contract/units size — used for $ P&L on SL/TP drag pills */
  positionSize?: number
  /** Session risk $ — sizes MYM/MNQ on the chart to match the TradingView ticket */
  riskDollars?: number
  /** ISO or unix fill time — session STAY/EXIT clock */
  entryTimestamp?: string | number | null
}

interface PendingLimitOverlay {
  price: number
  direction: 'long' | 'short'
  stopLoss: number
  profitTarget: number
  riskDollars?: number
}

/** Live manage AI — shown on the chart canvas while in a filled position */
export interface ChartAiVerdict {
  verdict: string
  confidence: number
  reason: string
}

interface TradingChartProps {
  onInstrumentChange?: (i: Instrument) => void
  /** Gate/lock view sync — must not persist preference */
  onInstrumentSync?: (i: Instrument) => void
  onPriceUpdate?: (price: number) => void   // called every tick
  /** Fired with unix seconds whenever a live quote lands */
  onQuoteTick?: (unixSec: number) => void
  onDataModeChange?: (mode: 'live' | 'synthetic') => void
  positionOverlay?: PositionOverlay | null     // filled position Entry/SL/TP
  /** Working limit — not filled yet; does not enter MANAGE */
  pendingLimit?: PendingLimitOverlay | null
  /** Asia overnight dual working stops (GOLD/DOW) — visible on Trade Pulse */
  asiaOco?: AsiaDeskOverlay | null
  /** Cancel the working limit (chart toolbar + parent bar) */
  onCancelPending?: () => void
  /**
   * After fill: drag SL/TP on the chart → parent syncs OANDA + journal.
   * Entry stays fixed. Working limits: TP only (SL locked at place).
   */
  onAdjustBrackets?: (update: {
    stopLoss?: number
    profitTarget?: number
  }) => void | Promise<void>
  /** Working limit — TP amend only; SL frozen at place */
  onAdjustWorkingBrackets?: (update: { profitTarget?: number }) => void | Promise<void>
  /** Parent feedback while a bracket save is in flight */
  bracketAdjustStatus?: 'idle' | 'saving' | 'error' | null
  bracketAdjustError?: string | null
  workingBracketAdjustStatus?: 'idle' | 'saving' | 'error' | null
  workingBracketAdjustError?: string | null
  /** AI manage verdict (hold / take profit / reversal) drawn on the chart */
  aiVerdict?: ChartAiVerdict | null
  jumpToPriceRef?: React.MutableRefObject<((price: number) => void) | null>
  /** First paint name — clock lock / preference. Avoids a DOW candle flash. */
  initialInstrument?: Instrument
  /** Lock tabs to day's recommended desk instrument */
  lockedInstrument?: Instrument | null
  /**
   * LIVE focus tabs only (session market ± clock-in lock).
   * Simulation must never pass this — leave undefined to show all three.
   */
  allowedInstruments?: Instrument[] | null
  /** When user clicks a level price (from panel or highlight) */
  onLevelSelect?: (
    price: number,
    meta?: {
      type?: string
      reasoning?: string
      source?: 'ai' | 'structure' | 'manual'
      side?: 'BUY' | 'SHORT'
      preferredDirection?: 'LONG' | 'SHORT'
      orderType?: 'LIMIT'
      stopLoss?: number
      profitTarget?: number
      /** Active playbook range for strategy SL/TP (AI/structure) */
      strategyRange?: StrategyRangeEdges | null
      strategyMagnets?: StrategyRiskMagnets | null
    }
  ) => void
  /** Morning session: allow placing limits from the chart */
  canPlaceOrder?: boolean
  /** Active attempt-ladder strategy from session gate */
  rangeStrategy?: 'or30' | 'ib' | 'us_range' | null
  attemptsUsed?: number
  stopHits?: number
  morningAttempts?: number
  ibAttempts?: number
  lunchAttempts?: number
  /**
   * Live desk: paint playbook/levels only when clocked in or attended this market today.
   * Between sessions / other desk tabs → false (clear stale NY levels off NIKKEI).
   */
  deskLevelsActive?: boolean
  /**
   * Same-day attendance (clocked in or attended) — unlocks afternoon tip after lunch.
   * Morning focus tip (−30m→lunch) does not require this.
   */
  deskAttended?: boolean
  /** Currently clocked in — enables Live Voice panel entry */
  clockedIn?: boolean
  /**
   * Live desk always passes `true` (CALL-legal ±10).
   * `false` / `null` remain for Simulation until Slice 5.
   */
  useCall?: boolean | null
  /** Bump to force a levels reload after SL/TP (system memory updated) */
  levelsRefreshKey?: number
  /** Rising-edge desk alerts (range ±10 band while entries unlocked) */
  onDeskAlert?: (alert: {
    kind: string
    title: string
    body: string
    telegram: string
    dedupeKey?: string
    instrument?: string
  }) => void
  /** Active playbook range ATR snapshot (advise-only pad/trail) */
  onRangeAtr?: (snap: RangeAtrSnapshot | null) => void
  /** Perf chip + open-book LEAVE (advise only; never auto-flatten) */
  onDeskPerf?: (p: {
    grade: string
    badgeText: string
    leaveBook: boolean
    playLine: string
    vetoCall: boolean
    sitBadge?: string
    sitHold?: boolean
    sitPlayLine?: string
    regionBadge?: string
    regionPlayLine?: string
  }) => void
  /** Open-book STAY/EXIT (advise only; never auto-flatten) */
  onSessionExit?: (
    read: {
      word: 'STAY' | 'EXIT'
      line: string
      hover: string
    } | null
  ) => void
  /** Close position execution callback from Leo or desk */
  onClosePosition?: (reason: string) => Promise<boolean | void>
  /** Order placement callback from Leo AI or desk controls */
  onPlaceOrder?: (order: {
    instrument: string
    direction: 'LONG' | 'SHORT'
    price: number
    stopLoss: number
    profitTarget: number
    reason: string
    size?: number
  }) => Promise<{ success: boolean; message?: string; position_id?: string }>
}

export interface RenderedSessionExtremeHit {
  extreme: SessionExtreme
  x: number
  y: number
  session: 'Asia' | 'London' | 'New York'
  price: number
  type: 'HIGH' | 'LOW'
  volume: number
  volStr: string
  isRetested: boolean
  retestVolumeRatio?: number
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
}

// ─── Main TradingChart component ──────────────────────────────────────────────

export function TradingChart({
  onInstrumentChange,
  onInstrumentSync,
  onPriceUpdate,
  onQuoteTick,
  onDataModeChange,
  positionOverlay,
  pendingLimit = null,
  asiaOco = null,
  onCancelPending = () => {},
  onAdjustBrackets,
  onAdjustWorkingBrackets,
  bracketAdjustStatus = null,
  bracketAdjustError = null,
  workingBracketAdjustStatus = null,
  workingBracketAdjustError = null,
  aiVerdict = null,
  jumpToPriceRef,
  initialInstrument,
  lockedInstrument,
  allowedInstruments = null,
  onLevelSelect,
  canPlaceOrder = false,
  rangeStrategy = null,
  attemptsUsed = 0,
  stopHits = 0,
  morningAttempts = 0,
  ibAttempts = 0,
  lunchAttempts = 0,
  deskLevelsActive = false,
  deskAttended = false,
  clockedIn = false,
  useCall: useCallProp,
  levelsRefreshKey = 0,
  onDeskAlert,
  onRangeAtr,
  onDeskPerf,
  onSessionExit,
  onClosePosition,
  onPlaceOrder,
}: TradingChartProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartFrameRef = useRef<HTMLDivElement>(null)
  const chartHeaderRef = useRef<HTMLDivElement>(null)
  const outerWrapperRef = useRef<HTMLDivElement>(null)
  const renderedSessionExtremesRef = useRef<RenderedSessionExtremeHit[]>([])
  const sessionOverlayRef = useRef<HTMLDivElement>(null)
  const positionBandOverlayRef = useRef<HTMLDivElement>(null)
  const frvpHistogramCanvasRef = useRef<HTMLCanvasElement>(null)
  const excessesCanvasRef = useRef<HTMLCanvasElement>(null)
  const userDrawingsCanvasRef = useRef<HTMLCanvasElement>(null)
  const newsMarkersOverlayRef = useRef<HTMLDivElement>(null)
  const [newsEvents, setNewsEvents] = useState<DeskCalendarEvent[]>([])
  const [activeNewsTooltip, setActiveNewsTooltip] = useState<{
    event: DeskCalendarEvent
    x: number
    y: number
  } | null>(null)
  const paintFrvpHistogramRef = useRef<() => void>(() => {})
  const paintExcessesAndRoundedRef = useRef<() => void>(() => {})
  const paintNewsMarkersRef = useRef<() => void>(() => {})
  const paintUserDrawingsRef = useRef<() => void>(() => {})

  // ── High-Performance Precomputed Analytics & Cache ─────────────────────────
  const candleCacheRef = useRef<Map<string, {
    candles: OHLCV[]
    source: string
    livePrice: number | null
    changePct: number
    timestamp: number
  }>>(new Map())
  const candleTimesRef = useRef<any[]>([])
  const rawBarsRef = useRef<ContextBar[]>([])
  const sessionExtremesRef = useRef<any[]>([])
  const spikesRef = useRef<any[]>([])
  const distRefsRef = useRef<any[]>([])
  const newsMovesRef = useRef<EmotionalNewsMove[]>([])
  const confirmedBreakoutsRef = useRef<Map<string, {
    p1Time: number
    p1Price: number
    p2Time: number
    p2Price: number
    breakoutCandle: Candle
    breakoutIndex: number
    entryPrice: number
    defaultStopLoss: number
    defaultTakeProfitFixed50: number
  }>>(new Map())

  // ── User Interactive Drawing Tools (Wyckoff Structure Line, Range, Manual FRVP, Measure) ────────
  type DrawingToolType = 'NONE' | 'TRENDLINE' | 'RANGE' | 'FRVP' | 'MEASURE'
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingToolType>('NONE')
  const [trendlines, setTrendlines] = useState<UserTrendline[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem('trading_desk_trendlines_v1')
      if (!saved) return []
      return JSON.parse(saved)
    } catch {
      return []
    }
  })
  const [selectedTrendlineId, setSelectedTrendlineId] = useState<string | null>(null)
  const selectedTrendlineIdRef = useRef<string | null>(null)
  selectedTrendlineIdRef.current = selectedTrendlineId
  const hoveredHandleRef = useRef<{ id: string; type: 'p1' | 'p2' | 'body' | 'mid' } | null>(null)
  const activeDraggingTlRef = useRef<{
    id: string
    p1: { time: number; price: number }
    p2: { time: number; price: number }
    direction?: 'BEARISH' | 'BULLISH'
  } | null>(null)
  const [rangeBoxes, setRangeBoxes] = useState<UserRangeBox[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem('trading_desk_ranges_v1')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [manualFrvps, setManualFrvps] = useState<UserManualFRVP[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem('trading_desk_frvps_v1')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [measures, setMeasures] = useState<UserMeasure[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem('trading_desk_measures_v1')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const measureBadgeHitsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map())

  // ── Leo Long-Term Memory Architecture & TradingView Alarms ────────────────
  const [memories, setMemories] = useState<LeoLongTermMemory[]>(() => loadLongTermMemories())
  const [memoryModalOpen, setMemoryModalOpen] = useState(false)
  const [targetMemoryRange, setTargetMemoryRange] = useState<{
    id: string
    priceLow: number
    priceHigh: number
    purpose: string
  } | null>(null)
  const [activeTradingViewAlarm, setActiveTradingViewAlarm] = useState<{
    memory: LeoLongTermMemory
    price: number
  } | null>(null)

  useEffect(() => {
    const onMems = () => setMemories(loadLongTermMemories())
    window.addEventListener('leo-memories-updated', onMems)
    return () => window.removeEventListener('leo-memories-updated', onMems)
  }, [])

  // Auto-save drawings to localStorage on change
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem('trading_desk_trendlines_v1', JSON.stringify(trendlines))
      localStorage.setItem('trading_desk_ranges_v1', JSON.stringify(rangeBoxes))
      localStorage.setItem('trading_desk_frvps_v1', JSON.stringify(manualFrvps))
      localStorage.setItem('trading_desk_measures_v1', JSON.stringify(measures))
    } catch (e) {
      console.warn('Failed to save user drawings to localStorage:', e)
    }
  }, [trendlines, rangeBoxes, manualFrvps, measures])
  const [drawingDraft, setDrawingDraft] = useState<{
    time: number
    price: number
    x?: number
    y?: number
  } | null>(null)
  const draftMousePosRef = useRef<{ time: number; price: number; x: number; y: number } | null>(null)
  const [drawingsPanelOpen, setDrawingsPanelOpen] = useState(false)
  const [drawingToast, setDrawingToast] = useState<{
    type: 'TRENDLINE' | 'RANGE' | 'FRVP' | 'AVWAP_5M'
    id: string
    label: string
    summary: string
  } | null>(null)
  // Draggable tool rail position (px from top-left of chart container)
  const [railPos, setRailPos] = useState<{ x: number; y: number }>({ x: 10, y: 10 })
  const railDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const railContainerRef = useRef<HTMLDivElement | null>(null)
  const [showCandlestickPatterns, setShowCandlestickPatterns] = useState(false)
  const [positionHudMinimized, setPositionHudMinimized] = useState(false)


  useEffect(() => {
    if (!drawingToast) return
    const t = setTimeout(() => {
      setDrawingToast(null)
    }, 8000)
    return () => clearTimeout(t)
  }, [drawingToast])

  const sessionSpansRef = useRef<any | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markerHashRef = useRef<string | null>(null)
  const vwapSeriesRef = useRef<{
    vwap: ISeriesApi<'Line'>
    upper1: ISeriesApi<'Line'>
    lower1: ISeriesApi<'Line'>
    upper2: ISeriesApi<'Line'>
    lower2: ISeriesApi<'Line'>
    upper3: ISeriesApi<'Line'>
    lower3: ISeriesApi<'Line'>
  } | null>(null)
  const newsVwapSeriesRef = useRef<{
    vwap: ISeriesApi<'Line'>
    upper1: ISeriesApi<'Line'>
    lower1: ISeriesApi<'Line'>
    upper2: ISeriesApi<'Line'>
    lower2: ISeriesApi<'Line'>
    upper3: ISeriesApi<'Line'>
    lower3: ISeriesApi<'Line'>
  } | null>(null)
  /** Short blue IB high/low segments (first hour only — not full-width lines) */
  const ibSeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const ibRangeRef = useRef<InitialBalanceRange | null>(null)
  const [ibShaped, setIbShaped] = useState(false)
  /** Mirrored IB H/L for ±10 band effect deps (refs alone do not re-render). */
  const [ibLevels, setIbLevels] = useState<{ high: number; low: number } | null>(null)
  /** IB H/L + BRK/REJ markers + ±10 bands — remembered across refresh. */
  const [showIbBreakouts] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().ib
  )
  /** Open range (first 15m) H/L + volume BRK/REJ */
  const or15SeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const or15RangeRef = useRef<Or15Range | null>(null)
  const [, setOr15Shaped] = useState(false)
  const [or15Locked, setOr15Locked] = useState(false)
  const [showOr15, setShowOr15] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().or15
  )
  /** US session range H/L + Asia BRK/REJ — NIKKEI only */
  const usRangeSeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const usRangeRef = useRef<any | null>(null)
  const showUsRange = false
  const usRangeShaped = false
  const setUsRangeShaped = useCallback((_v: boolean) => {}, [])
  const refreshSessionHighlightsRef = useRef<() => void>(() => {})
  /** Stable paint hook for tip-stream refresh (avoids restarting SSE on marker deps). */
  const paintDeskMarkersRef = useRef<(bars?: OHLCV[]) => void>(() => { })
  const syncDeskPlaybookRangesRef = useRef<(bars: OHLCV[]) => void>(() => { })
  const paintYesterdayProfileRef = useRef<() => void>(() => { })
  const paintOpeningActivityRef = useRef<() => void>(() => { })
  const paintMarketControlRef = useRef<() => void>(() => { })
  const paintDeskCallRef = useRef<() => void>(() => { })
  const deskCallRef = useRef<DeskCall | null>(null)
  const marketControlRef = useRef<MarketControl | null>(null)
  const resolvedUseCall: boolean | null = useCallProp === undefined ? false : useCallProp
  const useCallRef = useRef<boolean | null>(resolvedUseCall)
  useCallRef.current = resolvedUseCall
  /** First 30m opening range — NY 09:30–10:00 ET / Tokyo 09:00–09:30 JST */
  const or30SeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const or30RangeRef = useRef<Or30Range | null>(null)
  const [, setOr30Shaped] = useState(false)
  const [or30Locked, setOr30Locked] = useState(false)
  const [showOr30, setShowOr30] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().or30
  )
  const [showYesterdayProfile, setShowYesterdayProfile] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().yday
  )
  const [showSessionBands, setShowSessionBands] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().sessions
  )
  const ydayLinesRef = useRef<IPriceLine[]>([])
  const ydayPaintKeyRef = useRef('')
  const [, setYesterdayBadge] = useState('Yday off')
  const [showOpeningActivity] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().opening
  )
  const openingLinesRef = useRef<IPriceLine[]>([])
  const openingPaintKeyRef = useRef('')
  const [openingBadge, setOpeningBadge] = useState('WAIT')
  const [frvp5d, setFrvp5d] = useState<FixedRangeVolumeProfile5D | null>(null)
  const frvpLinesRef = useRef<IPriceLine[]>([])
  /** Sticky snapshot so fixed maps do not chase the tape outside 08:30–cash open. */
  const frvpSnapRef = useRef('')
  const ydaySnapRef = useRef('')
  const paintFrvp5dRef = useRef<(overrideBars?: OHLCV[]) => void>(() => { })
  const [avwap5mBenchmark, setAvwap5mBenchmark] = useState<AnchoredVwapBenchmark5M | null>(null)
  const [show5mAvwapOnChart, setShow5mAvwapOnChart] = useState(false)
  useEffect(() => {
    try {
      if (window.localStorage.getItem('desk.avwap5m.open.v1') === '1') setShow5mAvwapOnChart(true)
    } catch {}
  }, [])
  const [avwap5mBandCount] = useState<2 | 3>(3) // 2 or 3 standard deviation bands
  const [showNewsOnChart, setShowNewsOnChart] = useState(true) // News markers on chart time-axis (default ON)
  const [showSdBands] = useState(true) // Standard Deviation bands enabled with AVWAP
  const avwap5mLinesRef = useRef<IPriceLine[]>([])
  const paint5mAvwapBenchmarkRef = useRef<() => void>(() => { })
  const [_currentVwap, setCurrentVwap] = useState<{ vwap: number; upper1: number; lower1: number } | null>(null)
  const latestVwapBandsRef = useRef<any>(null)

  // News Catalyst Anchored VWAP (News AVWAP) state
  const [showNewsAvwap, setShowNewsAvwap] = useState(false)
  const [newsAvwapBandCount, setNewsAvwapBandCount] = useState<2 | 3>(3)

  useEffect(() => {
    try {
      const storedNews = window.localStorage.getItem('desk.showNewsOnChart.v1')
      if (storedNews === '0') setShowNewsOnChart(false)
      else if (storedNews === '1') setShowNewsOnChart(true)

      if (window.localStorage.getItem('desk.newsAvwap.open.v1') === '1') setShowNewsAvwap(true)
      const storedBands = window.localStorage.getItem('desk.newsAvwap.bandCount.v1')
      if (storedBands === '2' || storedBands === '3') setNewsAvwapBandCount(Number(storedBands) as 2 | 3)
    } catch {}
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('desk.showNewsOnChart.v1', showNewsOnChart ? '1' : '0')
    } catch {}
  }, [showNewsOnChart])

  useEffect(() => {
    try {
      window.localStorage.setItem('desk.newsAvwap.open.v1', showNewsAvwap ? '1' : '0')
    } catch {}
  }, [showNewsAvwap])

  useEffect(() => {
    try {
      window.localStorage.setItem('desk.newsAvwap.bandCount.v1', String(newsAvwapBandCount))
    } catch {}
  }, [newsAvwapBandCount])

  const [showCvdSubPane, setShowCvdSubPane] = useState(false)
  const showCvdSubPaneRef = useRef(showCvdSubPane)
  showCvdSubPaneRef.current = showCvdSubPane
  const [cvdSubPaneHeight, setCvdSubPaneHeight] = useState(185)
  // ATR (Average True Range) sub-pane — TradingView built-in ATR, persisted on/off
  const [showAtrSubPane, setShowAtrSubPane] = useState(false)
  useEffect(() => {
    try {
      if (window.localStorage.getItem('desk.atr.paneOpen.v1') === '1') setShowAtrSubPane(true)
    } catch {}
  }, [])
  useEffect(() => {
    try {
      window.localStorage.setItem('desk.atr.paneOpen.v1', showAtrSubPane ? '1' : '0')
    } catch {}
  }, [showAtrSubPane])
  const closeAtrSubPane = useCallback(() => setShowAtrSubPane(false), [])
  const cvdContainerRef = useRef<HTMLDivElement>(null)
  const cvdChartRef = useRef<IChartApi | null>(null)
  const cvdCandleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const cachedCvdBarsRef = useRef<any[]>([])
  const cvdTimeSyncingRef = useRef(false)
  const syncCvdFromMainRef = useRef<() => void>(() => {})
  const syncMainFromCvdRef = useRef<() => void>(() => {})
  const detachCvdFromPriceRef = useRef<() => void>(() => {})
  const relinkCvdToPriceRef = useRef<() => void>(() => {})
  const [syncCrosshair, setSyncCrosshair] = useState<{ x: number; timeStr: string } | null>(null)
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null)

  const rangesDiffer = (
    r1: { from: number; to: number } | null,
    r2: { from: number; to: number } | null,
    eps = 0.05
  ) => {
    if (!r1 || !r2) return true
    return Math.abs(r1.from - r2.from) >= eps || Math.abs(r1.to - r2.to) >= eps
  }

  // 1:1 Bidirectional lockstep zoom & pan between main price chart and CVD sub-pane
  syncCvdFromMainRef.current = () => {
    if (!showCvdSubPaneRef.current || cvdTimeSyncingRef.current) return
    const main = chartRef.current
    const cvd = cvdChartRef.current
    if (!main || !cvd) return
    const range = main.timeScale().getVisibleLogicalRange()
    if (!range) return
    const current = cvd.timeScale().getVisibleLogicalRange()
    if (!rangesDiffer(current, range)) return
    cvdTimeSyncingRef.current = true
    try {
      cvd.timeScale().setVisibleLogicalRange(range)
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => {
      cvdTimeSyncingRef.current = false
    })
  }

  syncMainFromCvdRef.current = () => {
    if (!showCvdSubPaneRef.current || cvdTimeSyncingRef.current) return
    const main = chartRef.current
    const cvd = cvdChartRef.current
    if (!main || !cvd) return
    const range = cvd.timeScale().getVisibleLogicalRange()
    if (!range) return
    const current = main.timeScale().getVisibleLogicalRange()
    if (!rangesDiffer(current, range)) return
    cvdTimeSyncingRef.current = true
    try {
      main.timeScale().setVisibleLogicalRange(range)
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => {
      cvdTimeSyncingRef.current = false
    })
  }

  detachCvdFromPriceRef.current = () => {
    // Keep 1:1 lockstep intact — never allow accidental horizontal detachment
  }

  relinkCvdToPriceRef.current = () => {
    requestAnimationFrame(() => syncCvdFromMainRef.current())
  }
  const cvdSessionOverlayRef = useRef<HTMLDivElement>(null)
  const [currentCvdLegend, setCurrentCvdLegend] = useState<{ open: number; high: number; low: number; close: number } | null>(null)
  const [yesterdayNyc, setYesterdayNyc] = useState<YesterdayNycSession | null>(null)
  const [showYesterdayNyc] = useState(true)
  const yesterdayNycLinesRef = useRef<IPriceLine[]>([])
  const paintYesterdayNycRef = useRef<(overrideBars?: OHLCV[]) => void>(() => { })
  const [overnightInventory, setOvernightInventory] = useState<OvernightInventoryEvaluation | null>(null)
  const [showInventorySessions] = useState(true)
  const inventoryLinesRef = useRef<IPriceLine[]>([])
  const paintInventorySessionsRef = useRef<() => void>(() => { })
  const [ydayProfile, setYdayProfile] = useState<{ vah?: number; val?: number; poc?: number } | null>(null)
  const [showMarketControl] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().control
  )
  const [showAuction] = useState(() => loadDeskOverlayToggles().auction)
  const auctionLinesRef = useRef<IPriceLine[]>([])
  const auctionPaintKeyRef = useRef('')
  const auctionSignalsRef = useRef<AuctionOverlaySignal[]>([])
  const paintAuctionOverlayRef = useRef<() => void>(() => { })
  const [, setAuctionBadge] = useState('off')
  const [auctionHud, setAuctionHud] = useState<AuctionHud | null>(null)
  const [showDow15mFail] = useState(
    () => loadDeskOverlayToggles().dow15mFail
  )
  const dow15mFailLinesRef = useRef<IPriceLine[]>([])
  const dow15mFailPaintKeyRef = useRef('')
  const dow15mFailSignalsRef = useRef<Dow15mFailSignal[]>([])
  const paintDow15mFailOverlayRef = useRef<() => void>(() => { })
  const [, setDow15mFailBadge] = useState('off')
  const [dow15mFailHud, setDow15mFailHud] = useState<Dow15mFailHud | null>(null)
  const controlLinesRef = useRef<IPriceLine[]>([])
  const controlPaintKeyRef = useRef('')
  const [controlBadge, setControlBadge] = useState('RF WAIT')
  const [callBadge, setCallBadge] = useState('WAIT')
  const [, setCallHover] = useState(
    'CALL WAIT — no ticket\n\nTicket stays 1.5R. No Leo. No Level Finder fills.'
  )
  const [, setPerfBadge] = useState('WAIT')
  const [, setPerfHover] = useState(
    'PERF WAIT — not enough letters for a developing value area. Drive may still CALL. Ticket stays 1.5R.'
  )
  const [, setSitBadge] = useState('NONE')
  const [, setSitHover] = useState(
    'SIT NONE — no special situation. CALL side unchanged. Ticket stays 1.5R.'
  )
  const [, setRegionBadge] = useState('WAIT')
  const [, setRegionHover] = useState(
    'REGION WAIT — not enough completed cash days for a 5-day TPO body. CALL unchanged. Ticket stays 1.5R.'
  )
  const [, setStayOutBadge] = useState('—')
  const [, setStayOutHover] = useState(
    'OUT — not a stay-out day. CALL hunts legal ±10. Ticket stays 1.5R.'
  )
  const spikeLinesRef = useRef<IPriceLine[]>([])
  const spikePaintKeyRef = useRef('')
  const regionLinesRef = useRef<IPriceLine[]>([])
  const regionPaintKeyRef = useRef('')
  const quietLtarKeyRef = useRef('')
  const onDeskPerfRef = useRef(onDeskPerf)
  onDeskPerfRef.current = onDeskPerf
  const onSessionExitRef = useRef(onSessionExit)
  onSessionExitRef.current = onSessionExit
  const sessionExitKeyRef = useRef('')
  const [ibExtendBadge, setIbExtendBadge] = useState('—')
  const [, setIbExtendHover] = useState(
    'IB extend vs revert — advice only after IB locks. First tag is not the entry.'
  )
  const ibExtendRef = useRef<IbExtendAdvice | null>(null)
  const ibLiqLinesRef = useRef<IPriceLine[]>([])
  const paintIbExtendRef = useRef<() => void>(() => { })
  /** Live count of BRK/REJ markers currently painted (for toolbar status). */
  const [, setRangeSignalSummary] = useState<{
    ib: number
    or30: number
    lunch: number
    us: number
  }>({ ib: 0, or30: 0, lunch: 0, us: 0 })
  const [, setLatestTailStatus] = useState<{
    edge: 'high' | 'low'
    tier: 'light' | 'good' | 'strong'
    label: string
  } | null>(null)
  const rangeTailsRef = useRef<RangeEdgeTail[]>([])
  /** Latest session AVWAP print — strategy TP magnet */
  const avwapLastRef = useRef<number | null>(null)
  const levelLinesRef = useRef<any[]>([])
  /** Host for level/SL/TP price lines — seeded once; candle setData must not touch it */
  const priceLineHostRef = useRef<ISeriesApi<'Line'> | null>(null)
  const priceLineHostSeededRef = useRef(false)
  /** Volume histogram series overlay */
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  /** ±10 allowed-entry band lines around active playbook H/L */
  const entryBandLinesRef = useRef<IPriceLine[]>([])
  /** Signature of the painted ±10 tags — repaint only when the tags would differ */
  const entryBandPaintKeyRef = useRef<string | null>(null)
  const entryBandPaintHostRef = useRef<ISeriesApi<'Line'> | null>(null)
  const [, setRangeAtrSnap] = useState<RangeAtrSnapshot | null>(null)
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const candleRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastCandleRef = useRef<OHLCV | null>(null)
  const quoteInFlightRef = useRef(false)
  const candleFetchGenRef = useRef(0)
  const didFitRef = useRef(false)
  /** True while user is dragging/zooming — pause React work for TV-smooth pan */
  const interactingRef = useRef(false)
  /** Arm live stream once we have bars — avoid restarting intervals on every new print */
  const [streamArmed, setStreamArmed] = useState(false)

  const [instrument, setInstrumentState] = useState<Instrument>(
    () => initialInstrument ?? lockedInstrument ?? 'DOW'
  )

  const activeTrendlines = useMemo(
    () => trendlines.filter((t) => t.instrument === instrument),
    [trendlines, instrument]
  )
  const activeRangeBoxes = useMemo(
    () => rangeBoxes.filter((r) => r.instrument === instrument),
    [rangeBoxes, instrument]
  )
  const activeManualFrvps = useMemo(
    () => manualFrvps.filter((f) => f.instrument === instrument),
    [manualFrvps, instrument]
  )
  const activeMeasures = useMemo(
    () => measures.filter((m) => !m.instrument || m.instrument === instrument),
    [measures, instrument]
  )


  const [hideTrendlineBadges, setHideTrendlineBadges] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('hide_trendline_badges') === 'true'
    } catch {
      return false
    }
  })

  const [chartThemeMode, setChartThemeMode] = useState<'dark' | 'light'>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('desk_chart_theme_mode')
        if (saved === 'light' || saved === 'dark') return saved
      }
    } catch {}
    return 'dark'
  })

  useEffect(() => {
    const opts = getDeskChartThemeOptions(chartThemeMode)
    if (chartRef.current) {
      chartRef.current.applyOptions(opts)
    }
    if (cvdChartRef.current) {
      cvdChartRef.current.applyOptions(opts)
    }
  }, [chartThemeMode])

  const [candles, setCandles] = useState<OHLCV[]>([])
  const [armedSituations, setArmedSituations] = useState<ArmedRule[]>([])

  useEffect(() => {
    const reload = () => {
      try {
        const inst = instrument as MarketInstrument
        if (['DOW', 'NASDAQ', 'GOLD', 'CRUDE', 'NIKKEI'].includes(inst)) {
          const rules = loadRulesForMarket(inst)
          setArmedSituations(rules.filter((r) => isEntrySituationRule(r.type) && r.status === 'ARMED'))
        } else {
          setArmedSituations([])
        }
      } catch {
        setArmedSituations([])
      }
    }
    reload()
    const unsub = listenToRuleUpdates((market) => {
      if (!market || market === instrument) {
        reload()
      }
    })
    return unsub
  }, [instrument])
  const sessionOrderFlow = useMemo<OrderFlowSummary | null>(() => {
    if (!candles || candles.length === 0) return null
    const now = new Date()
    const nowYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const sessStart = nyDateTimeToUnix(nowYmd, 9, 30)
    return computeOrderFlowCvd(
      candles.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      sessStart
    )
  }, [candles])
  const [levels, setLevels] = useState<LevelLine[]>([])
  const [noInBandLevelsMessage, setNoInBandLevelsMessage] = useState<string | null>(null)
  const levelsRef = useRef<LevelLine[]>([])
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [timeframe, setTimeframe] = useState<DeskTimeframe>('5m')
  const barSeconds = barSecondsForTimeframe(timeframe)
  const [barCountdown, setBarCountdown] = useState<string>('')
  const priceTickStoreRef = useRef<LivePriceStore>({ tick: null, subs: new Set() })
  const subscribePriceTick = useCallback((onChange: () => void) => {
    const store = priceTickStoreRef.current
    store.subs.add(onChange)
    return () => {
      store.subs.delete(onChange)
    }
  }, [])
  const getPriceTick = useCallback(() => priceTickStoreRef.current.tick, [])
  const publishPriceTick = useCallback((price: number | null, changePct: number) => {
    const store = priceTickStoreRef.current
    const next =
      price != null && Number.isFinite(price) && price > 0 ? { price, changePct } : null
    const prev = store.tick
    if (prev == null && next == null) return
    if (prev && next && prev.price === next.price && prev.changePct === next.changePct) return
    store.tick = next
    for (const onChange of store.subs) onChange()
  }, [])
  useEffect(() => {
    const updateCountdown = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      const nowSec = Math.floor(Date.now() / 1000)
      const barSec = barSeconds
      const rem = barSec - (nowSec % barSec)
      const mins = Math.floor(rem / 60)
      const secs = rem % 60
      setBarCountdown(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`)

      // Immediate 5-minute bar close detection: trigger user drawings repaint the very second a 5m bar finishes
      if (nowSec % 300 === 0 || rem === barSec) {
        paintUserDrawingsRef.current?.()
      }
    }
    updateCountdown()
    const timer = setInterval(updateCountdown, 1000)
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) updateCountdown()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [barSeconds])

  const [showLevels, setShowLevels] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? false : loadDeskOverlayToggles().levels
  )
  useEffect(() => {
    saveDeskOverlayToggles({
      levels: showLevels,
      or30: showOr30,
      ib: showIbBreakouts,
      or15: showOr15,
      lunch: false,
      us: showUsRange,
      yday: showYesterdayProfile,
      opening: showOpeningActivity,
      control: showMarketControl,
      sessions: showSessionBands,
      auction: showAuction,
      dow15mFail: showDow15mFail,
    })
  }, [
    showLevels,
    showOr30,
    showIbBreakouts,
    showOr15,
    showUsRange,
    showYesterdayProfile,
    showOpeningActivity,
    showMarketControl,
    showSessionBands,
    showAuction,
    showDow15mFail,
  ])
  /** Floating morning playbook — closed by default on chart refresh; open via Playbook (P). */
  const [playbookOpen, setPlaybookOpen] = useState(false)

  /** Single marker channel — IB + OR30 + Lunch + Nikkei US-range + range-edge tails. */
  const paintDeskMarkers = useCallback((bars?: OHLCV[]) => {
    const candleSeries = candleRef.current
    if (!candleSeries) return
    if (timeframe === '1D') {
      try { candleSeries.setMarkers([]) } catch {}
      return
    }
    const list = bars ?? candlesRef.current
    const deskBars = list.map((c) => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Math.max(0, Number(c.volume) || 0),
    }))

    type Mk = {
      time: UTCTimestamp
      position: 'aboveBar' | 'belowBar'
      color: string
      shape: 'arrowUp' | 'arrowDown' | 'circle'
      text: string
    }
    const markers: Mk[] = []
    let ibCount = 0
    let or30Count = 0
    let lunchCount = 0
    let usCount = 0

    if (showIbBreakouts && ibRangeRef.current && deskBars.length > 0) {
      for (const s of computeIbSignals(deskBars, ibRangeRef.current)) {
        ibCount += 1
        markers.push({
          time: s.time as UTCTimestamp,
          position: s.position,
          color: s.color,
          shape: s.shape,
          text: s.text,
        })
      }
      const swing = findIbLiquiditySwing(deskBars, ibRangeRef.current)
      if (swing) {
        markers.push({
          time: swing.time as UTCTimestamp,
          position: swing.kind === 'high' ? 'aboveBar' : 'belowBar',
          color: '#eab308',
          shape: 'circle',
          text: swing.kind === 'high' ? 'LIQ H' : 'LIQ L',
        })
      }
    }

    if (showOr30 && or30RangeRef.current && deskBars.length > 0) {
      for (const s of computeOr30Signals(deskBars, or30RangeRef.current)) {
        or30Count += 1
        markers.push({
          time: s.time as UTCTimestamp,
          position: s.position,
          color: s.color,
          shape: s.shape,
          text: s.text,
        })
      }
    }

    if (showOr15 && or15RangeRef.current && deskBars.length > 0) {
      for (const s of computeOr15Signals(deskBars, or15RangeRef.current)) {
        lunchCount += 1
        markers.push({
          time: s.time as UTCTimestamp,
          position: s.position,
          color: s.color,
          shape: s.shape,
          text: s.text,
        })
      }
    }

    if (
      showUsRange &&
      isNikkeiUsRangeInstrument(instrument) &&
      deskBars.length > 0
    ) {
      const us = computeNikkeiUsRangeBreakout(deskBars)
      if (us) {
        for (const s of us.signals) {
          usCount += 1
          markers.push({
            time: s.time as UTCTimestamp,
            position: s.position,
            color: s.color,
            shape: s.shape,
            text: s.text,
          })
        }
      }
    }

    if (showAuction && isAuctionInstrument(instrument)) {
      for (const s of auctionSignalsRef.current) {
        markers.push({
          time: s.time as UTCTimestamp,
          position: s.side === 'LONG' ? 'belowBar' : 'aboveBar',
          color: s.side === 'LONG' ? AUCTION_COLORS.buy : AUCTION_COLORS.sell,
          shape: s.side === 'LONG' ? 'arrowUp' : 'arrowDown',
          text: s.side === 'LONG' ? 'BUY' : 'SELL',
        })
      }
    }

    if (showDow15mFail && isDowVolumeBarInstrument(instrument)) {
      for (const s of dow15mFailSignalsRef.current) {
        markers.push({
          time: s.time as UTCTimestamp,
          position: s.side === 'LONG' ? 'belowBar' : 'aboveBar',
          color: s.side === 'LONG' ? DOW_15M_FAIL_COLORS.buy : DOW_15M_FAIL_COLORS.sell,
          shape: s.side === 'LONG' ? 'arrowUp' : 'arrowDown',
          text: s.side === 'LONG' ? 'BUY' : 'SELL',
        })
      }
    }

    // Range-edge tails on the active shaped playbook bait (±10 band)
    const playbookModeForTails = resolveDeskPlaybookMode({
      instrument,
      rangeStrategy,
      ladder: attemptLadderFromCounts({
        morningAttempts,
        ibAttempts,
        lunchAttempts,
        morningStopHits: stopHits,
      }),
    })
    const strategyRangeForTails = activeRangeForPlaybook({
      playbookMode: playbookModeForTails,
      instrument,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      or15: or15RangeRef.current,
      morningAttempts,
    })
    let shapedForTails: ShapedRangeForTails | null = null
    if (strategyRangeForTails) {
      const or30 = or30RangeRef.current
      const ib = ibRangeRef.current
      const lunch = or15RangeRef.current
      const us = usRangeRef.current
      if (
        showOr30 &&
        or30?.complete &&
        or30.high === strategyRangeForTails.high &&
        or30.low === strategyRangeForTails.low
      ) {
        shapedForTails = {
          ...strategyRangeForTails,
          complete: true,
          lockedUnix: or30.endUnix,
        }
      } else if (
        showIbBreakouts &&
        ib &&
        ib.high === strategyRangeForTails.high &&
        ib.low === strategyRangeForTails.low
      ) {
        shapedForTails = {
          ...strategyRangeForTails,
          complete: true,
          lockedUnix: ib.endUnix,
        }
      } else if (
        showOr15 &&
        lunch?.complete &&
        lunch.high === strategyRangeForTails.high &&
        lunch.low === strategyRangeForTails.low
      ) {
        shapedForTails = {
          ...strategyRangeForTails,
          complete: true,
          lockedUnix: lunch.endUnix,
        }
      } else if (
        showUsRange &&
        us?.complete &&
        us.high === strategyRangeForTails.high &&
        us.low === strategyRangeForTails.low
      ) {
        shapedForTails = {
          ...strategyRangeForTails,
          complete: true,
          lockedUnix: us.toTime,
        }
      }
    }

    const tails =
      shapedForTails && deskBars.length > 0
        ? computeRangeEdgeTails(deskBars, shapedForTails)
        : []
    rangeTailsRef.current = tails
    for (const t of tails) {
      markers.push({
        time: t.time as UTCTimestamp,
        position: t.position,
        color: t.color,
        shape: t.shape,
        text: t.text,
      })
    }
    const qualityTail = latestQualityTail(tails, 'good')
    const nextTail = qualityTail
      ? {
        edge: qualityTail.edge,
        tier: qualityTail.tier,
        label: qualityTail.label,
      }
      : null
    setLatestTailStatus((prev) => {
      if (
        prev?.edge === nextTail?.edge &&
        prev?.tier === nextTail?.tier &&
        prev?.label === nextTail?.label
      ) {
        return prev
      }
      return nextTail
    })

    setRangeSignalSummary((prev) =>
      prev.ib === ibCount &&
        prev.or30 === or30Count &&
        prev.lunch === lunchCount &&
        prev.us === usCount
        ? prev
        : { ib: ibCount, or30: or30Count, lunch: lunchCount, us: usCount }
    )

    try {
      const mapped = mapTimesToChart(
        markers.map((m) => ({ ...m, time: m.time as number })),
        chartTzRef.current
      ).map((m) => ({ ...m, time: m.time as UTCTimestamp }))
      mapped.sort((a, b) => (a.time as number) - (b.time as number))
      // setMarkers forces a full series repaint — skip identical rebuilds
      const hash = mapped
        .map((m) => `${m.time}|${m.position}|${m.shape}|${m.color}|${m.text ?? ''}`)
        .join('~')
      if (hash !== markerHashRef.current) {
        markerHashRef.current = hash
        candleSeries.setMarkers(mapped)
      }
    } catch {
      /* ignore */
    }
  }, [
    showIbBreakouts,
    showOr15,
    showOr30,
    showUsRange,
    showAuction,
    showDow15mFail,
    instrument,
    rangeStrategy,
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    stopHits,
    timeframe,
  ])

  useEffect(() => {
    paintDeskMarkersRef.current = paintDeskMarkers
  }, [paintDeskMarkers])

  useEffect(() => {
    paintDeskMarkers()
  }, [showIbBreakouts, showOr15, showOr30, showUsRange, showAuction, showDow15mFail, paintDeskMarkers])

  /** Apply / clear IB first-hour H/L (blue). Off until user toggles IB BRK/REJ (B). */
  const paintIbLines = useCallback(() => {
    const series = ibSeriesRef.current
    if (!series) return
    const ib = ibRangeRef.current
    if (!showIbBreakouts || !ib) {
      try {
        series.high.setData([])
        series.low.setData([])
      } catch {
        /* ignore */
      }
      setIbShaped(false)
      setIbLevels(null)
      return
    }
    const tipUnix = candlesRef.current.length
      ? (candlesRef.current[candlesRef.current.length - 1]!.time as number)
      : Math.floor(Date.now() / 1000)
    // Do not add a future cash-close point: it reserves blank chart space.
    // Last point only — right-scale label, no spanning H/L line.
    const pts = ibLineSeriesData(ib, tipUnix)
    const tz = chartTzRef.current
    const savedSpacing = readDeskBarSpacing(chartRef.current)
    try {
      series.high.setData(
        mapTimesToChart(
          axisLabelSeriesData(pts.high).map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      )
      series.low.setData(
        mapTimesToChart(
          axisLabelSeriesData(pts.low).map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      )
      setIbShaped(true)
      setIbLevels({ high: ib.high, low: ib.low })
      keepDeskBarSpacing(chartRef.current, savedSpacing)
    } catch {
      series.high.setData([])
      series.low.setData([])
      setIbShaped(false)
      setIbLevels(null)
    }
  }, [showIbBreakouts, instrument])

  /** Apply / clear Open-range (first 15m) H/L from cached range. */
  const paintOr15Lines = useCallback(() => {
    const series = or15SeriesRef.current
    if (!series) return
    const range = or15RangeRef.current
    const allowed = isOr15Instrument(instrument)
    setOr15Locked(!!(allowed && range?.complete))

    if (!showOr15 || !range || !allowed) {
      try {
        series.high.setData([])
        series.low.setData([])
      } catch {
        /* ignore */
      }
      setOr15Shaped(false)
      return
    }
    const tipUnix = candlesRef.current.length
      ? (candlesRef.current[candlesRef.current.length - 1]!.time as number)
      : Math.floor(Date.now() / 1000)
    const pts = or15LineSeriesData(range, tipUnix)
    const savedSpacing = readDeskBarSpacing(chartRef.current)
    try {
      const tz = chartTzRef.current
      series.high.setData(
        mapTimesToChart(
          axisLabelSeriesData(pts.high).map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      series.low.setData(
        mapTimesToChart(
          axisLabelSeriesData(pts.low).map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      setOr15Shaped(true)
      keepDeskBarSpacing(chartRef.current, savedSpacing)
    } catch {
      series.high.setData([])
      series.low.setData([])
      setOr15Shaped(false)
    }
  }, [showOr15, instrument])

  /** Apply / clear Nikkei US-range H/L (IB-style: current session, 2 red lines). */
  const paintUsRangeLines = useCallback(() => {
    const series = usRangeSeriesRef.current
    if (!series) return
    const usRange = usRangeRef.current
    if (!showUsRange || !usRange || !isNikkeiUsRangeInstrument(instrument)) {
      try {
        series.high.setData([])
        series.low.setData([])
      } catch {
        /* ignore */
      }
      setUsRangeShaped(false)
      return
    }
    const tipUnix = candlesRef.current.length
      ? (candlesRef.current[candlesRef.current.length - 1]!.time as number)
      : Math.floor(Date.now() / 1000)
    const pts = nikkeiUsRangeLineSeriesData(usRange, tipUnix)
    const savedSpacing = readDeskBarSpacing(chartRef.current)
    try {
      const tz = chartTzRef.current
      series.high.setData(
        mapTimesToChart(
          axisLabelSeriesData(pts.high).map((p: any) => ({ time: p.time, value: p.value })),
          tz
        ).map((p: any) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      series.low.setData(
        mapTimesToChart(
          axisLabelSeriesData(pts.low).map((p: any) => ({ time: p.time, value: p.value })),
          tz
        ).map((p: any) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      setUsRangeShaped(pts.high.length > 0)
      keepDeskBarSpacing(chartRef.current, savedSpacing)
    } catch {
      series.high.setData([])
      series.low.setData([])
      setUsRangeShaped(false)
    }
  }, [showUsRange, instrument])

  /** Apply / clear first-30m opening range H/L (teal, IB-style).
   *  Lock is independent of R — late clock-in still has a calculated OR30. */
  const paintOr30Lines = useCallback(() => {
    const series = or30SeriesRef.current
    if (!series) return
    const range = or30RangeRef.current
    const allowed = isOr30Instrument(instrument)
    setOr30Locked(!!(allowed && range?.complete))

    if (!showOr30 || !range || !allowed) {
      try {
        series.high.setData([])
        series.low.setData([])
      } catch {
        /* ignore */
      }
      setOr30Shaped(false)
      return
    }
    const tipUnix = candlesRef.current.length
      ? (candlesRef.current[candlesRef.current.length - 1]!.time as number)
      : Math.floor(Date.now() / 1000)
    const pts = or30LineSeriesData(range, tipUnix)
    const savedSpacing = readDeskBarSpacing(chartRef.current)
    try {
      const tz = chartTzRef.current
      series.high.setData(
        mapTimesToChart(
          axisLabelSeriesData(pts.high).map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      series.low.setData(
        mapTimesToChart(
          axisLabelSeriesData(pts.low).map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      setOr30Shaped(pts.high.length > 0)
      keepDeskBarSpacing(chartRef.current, savedSpacing)
    } catch {
      series.high.setData([])
      series.low.setData([])
      setOr30Shaped(false)
    }
  }, [showOr30, instrument])

  const syncDeskPlaybookRanges = useCallback((bars: OHLCV[]) => {
    if (!bars.length) return
    const inst = instrumentRef.current
    const ohlcv = bars.map((c) => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))
    const tipUnix = ohlcv[ohlcv.length - 1]!.time
    const nowUnix = Math.max(tipUnix, Math.floor(Date.now() / 1000))

    if (ibSeriesRef.current) {
      const sess = sessionFor(inst)
      const tipDay = new Intl.DateTimeFormat('en-CA', {
        timeZone: sess.tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(tipUnix * 1000))
      const [oh, om] = sess.marketOpen.split(':').map(Number)
      const openUnix = nyDateTimeToUnix(tipDay, oh!, om || 0)
      ibRangeRef.current = computeInitialBalance(ohlcv, openUnix, nowUnix)
      paintIbLines()
    }

    if (or15SeriesRef.current) {
      if (isOr15Instrument(inst)) {
        const sess = sessionFor(inst)
        const tipDay = new Intl.DateTimeFormat('en-CA', {
          timeZone: sess.tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(tipUnix * 1000))
        const [oh, om] = sess.marketOpen.split(':').map(Number)
        const openUnix = nyDateTimeToUnix(tipDay, oh!, om || 0)
        or15RangeRef.current = computeOr15Range(ohlcv, openUnix, nowUnix)
      } else {
        or15RangeRef.current = null
      }
      paintOr15Lines()
    }

    if (usRangeSeriesRef.current) {
      usRangeRef.current = null
      paintUsRangeLines()
    }

    if (or30SeriesRef.current) {
      if (isOr30Instrument(inst)) {
        const sess = sessionFor(inst)
        const tipDay = new Intl.DateTimeFormat('en-CA', {
          timeZone: sess.tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(tipUnix * 1000))
        const [oh, om] = sess.marketOpen.split(':').map(Number)
        const openUnix = nyDateTimeToUnix(tipDay, oh!, om || 0)
        or30RangeRef.current = computeOr30Range(ohlcv, openUnix, nowUnix)
      } else {
        or30RangeRef.current = null
      }
      paintOr30Lines()
    }
  }, [paintIbLines, paintOr15Lines, paintUsRangeLines, paintOr30Lines])

  useEffect(() => {
    syncDeskPlaybookRangesRef.current = syncDeskPlaybookRanges
  }, [syncDeskPlaybookRanges])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      const list = candlesRef.current
      if (list.length) syncDeskPlaybookRangesRef.current(list)
    }, 4000)
    return () => window.clearInterval(id)
  }, [])

  const paintYesterdayProfile = useCallback(() => {
    const host = priceLineHostRef.current
    if (timeframe === '1D') {
      setYesterdayBadge('Yday off')
      setYdayProfile(null)
      ydayPaintKeyRef.current = ''
      for (const line of ydayLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      ydayLinesRef.current = []
      return
    }
    const list = candlesRef.current
    const lastBar = list.length ? (list[list.length - 1]!.time as number) : null
    const asOfUnix = resolveYesterdayAsOfUnix(
      instrument,
      lastBar,
      Math.floor(Date.now() / 1000)
    )
    const profile = computeYesterdayProfile({
      instrument,
      candles: list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      asOfUnix,
    })
    const badge = showYesterdayProfile
      ? yesterdayProfileBadgeText(profile)
      : 'Yday off'
    setYesterdayBadge((prev) => (prev === badge ? prev : badge))
    setYdayProfile(profile ? { vah: profile.vah, val: profile.val, poc: profile.poc } : null)
    const key = yesterdayProfilePaintKey(showYesterdayProfile, profile)
    if (key === ydayPaintKeyRef.current) return
    ydayPaintKeyRef.current = key
    for (const line of ydayLinesRef.current) {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    }
    ydayLinesRef.current = []
  }, [showYesterdayProfile, instrument, timeframe])

  const paintOpeningActivity = useCallback(() => {
    const host = priceLineHostRef.current
    if (timeframe === '1D') {
      setOpeningBadge('WAIT')
      openingPaintKeyRef.current = ''
      for (const line of openingLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      openingLinesRef.current = []
      return
    }
    const list = candlesRef.current
    const lastBar = list.length ? (list[list.length - 1]!.time as number) : null
    const asOfUnix = resolveOpeningAsOfUnix(
      instrument,
      lastBar,
      Math.floor(Date.now() / 1000)
    )
    const activity = computeOpeningActivity({
      instrument,
      candles: list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      asOfUnix,
    })
    const badge = openingActivityBadgeText(activity)
    setOpeningBadge((prev) => (prev === badge ? prev : badge))
    const key = openingActivityPaintKey(showOpeningActivity, activity)
    if (key === openingPaintKeyRef.current) return
    openingPaintKeyRef.current = key
    for (const line of openingLinesRef.current) {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    }
    openingLinesRef.current = []
  }, [showOpeningActivity, instrument, timeframe])

  const paintFrvp5d = useCallback((overrideBars?: OHLCV[]) => {
    const host = priceLineHostRef.current
    if (timeframe === '1D') {
      setFrvp5d(null)
      for (const line of frvpLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      frvpLinesRef.current = []
      return
    }
    const list = overrideBars || candlesRef.current
    if (!list || list.length === 0) return
    const phase = fixedRangePhase(instrument)
    const snap =
      phase === 'holding'
        ? `${instrument}:${timeframe}:held`
        : phase === 'frozen'
          ? `${instrument}:${timeframe}:frozen`
          : ''
    if (snap && frvpSnapRef.current === snap) return
    const asOf = phase === 'frozen' ? fixedRangeFreezeAsOf(instrument).fiveDayUnix : undefined
    const profile = compute5DayFixedRangeVolumeProfile(
      list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      instrument,
      asOf
    )
    frvpSnapRef.current = snap
    setFrvp5d(profile)
    for (const line of frvpLinesRef.current) {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    }
    frvpLinesRef.current = []
  }, [instrument, timeframe])

  const paintYesterdayNyc = useCallback((overrideBars?: OHLCV[]) => {
    const host = priceLineHostRef.current
    if (timeframe === '1D') {
      setYesterdayNyc(null)
      setOvernightInventory(null)
      for (const line of yesterdayNycLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      yesterdayNycLinesRef.current = []
      return
    }
    const list = overrideBars || candlesRef.current
    if (!list || list.length === 0) return
    const phase = fixedRangePhase(instrument)
    const snap =
      phase === 'holding'
        ? `${instrument}:${timeframe}:held`
        : phase === 'frozen'
          ? `${instrument}:${timeframe}:frozen`
          : ''
    if (snap && ydaySnapRef.current === snap) return
    const bars: ContextBar[] = list.map((c) => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))
    const lastBarTime = bars[bars.length - 1]?.time
    const clock = deskClockFor(instrument)
    const asOf =
      phase === 'frozen' ? fixedRangeFreezeAsOf(instrument).inventoryUnix : lastBarTime
    const yday = computeYesterdayNycSession(bars, asOf, clock)
    ydaySnapRef.current = snap
    setYesterdayNyc(yday)

    if (yday) {
      const inv = computeOvernightInventoryAndSessions({
        bars,
        yesterday: yday,
        asOfUnix: asOf,
        clock,
      })
      setOvernightInventory(inv)
    } else {
      setOvernightInventory(null)
    }

    for (const line of yesterdayNycLinesRef.current) {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    }
    yesterdayNycLinesRef.current = []
  }, [timeframe])

  const paintInventorySessions = useCallback(() => {
    const host = priceLineHostRef.current
    for (const line of inventoryLinesRef.current) {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    }
    inventoryLinesRef.current = []
  }, [])

  const paint5mAvwapBenchmark = useCallback(() => {
    const host = priceLineHostRef.current
    for (const line of avwap5mLinesRef.current) {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    }
    avwap5mLinesRef.current = []
    // Keep 5-Month AVWAP and bands invisible on chart unless user explicitly turns it on
    if (!show5mAvwapOnChart) return

    const bm = avwap5mBenchmark
    const fallbackPrice =
      timeframe === '1D' && latestVwapBandsRef.current?.lastVwap ? latestVwapBandsRef.current.lastVwap : null
    const price = bm?.vwap ?? fallbackPrice
    if (!host || !price) return

    try {
      // 1. Central 5-Month Anchored VWAP (Macro Benchmark)
      const vwapLine = host.createPriceLine({
        price: Number(price.toFixed(2)),
        color: '#10b981',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `5M AVWAP ${price.toLocaleString()}`,
      })
      avwap5mLinesRef.current.push(vwapLine)

      // 2. Standard Deviation Bands (±1σ, ±2σ, and optional ±3σ)
      if (bm && showSdBands) {
        // ±1σ Bands (68% Value Area)
        if (Number.isFinite(bm.sigma1Upper)) {
          const u1 = host.createPriceLine({
            price: Number(bm.sigma1Upper.toFixed(2)),
            color: '#34d399',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `5M +1σ ${bm.sigma1Upper.toLocaleString()}`,
          })
          avwap5mLinesRef.current.push(u1)
        }
        if (Number.isFinite(bm.sigma1Lower)) {
          const l1 = host.createPriceLine({
            price: Number(bm.sigma1Lower.toFixed(2)),
            color: '#34d399',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `5M -1σ ${bm.sigma1Lower.toLocaleString()}`,
          })
          avwap5mLinesRef.current.push(l1)
        }

        // ±2σ Bands (95% Value Area / Exhaustion Extremes)
        if (Number.isFinite(bm.sigma2Upper)) {
          const u2 = host.createPriceLine({
            price: Number(bm.sigma2Upper.toFixed(2)),
            color: '#06b6d4',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `5M +2σ ${bm.sigma2Upper.toLocaleString()}`,
          })
          avwap5mLinesRef.current.push(u2)
        }
        if (Number.isFinite(bm.sigma2Lower)) {
          const l2 = host.createPriceLine({
            price: Number(bm.sigma2Lower.toFixed(2)),
            color: '#06b6d4',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `5M -2σ ${bm.sigma2Lower.toLocaleString()}`,
          })
          avwap5mLinesRef.current.push(l2)
        }

        // ±3σ Bands (99.7% Tail Extreme - rendered in 3-band mode)
        if (avwap5mBandCount === 3) {
          if (bm.sigma3Upper && Number.isFinite(bm.sigma3Upper)) {
            const u3 = host.createPriceLine({
              price: Number(bm.sigma3Upper.toFixed(2)),
              color: '#818cf8',
              lineWidth: 1,
              lineStyle: LineStyle.LargeDashed,
              axisLabelVisible: true,
              title: `5M +3σ ${bm.sigma3Upper.toLocaleString()}`,
            })
            avwap5mLinesRef.current.push(u3)
          }
          if (bm.sigma3Lower && Number.isFinite(bm.sigma3Lower)) {
            const l3 = host.createPriceLine({
              price: Number(bm.sigma3Lower.toFixed(2)),
              color: '#818cf8',
              lineWidth: 1,
              lineStyle: LineStyle.LargeDashed,
              axisLabelVisible: true,
              title: `5M -3σ ${bm.sigma3Lower.toLocaleString()}`,
            })
            avwap5mLinesRef.current.push(l3)
          }
        }
      }
    } catch {
      /* ignore */
    }
  }, [timeframe, avwap5mBenchmark, show5mAvwapOnChart, showSdBands, avwap5mBandCount])

  // ── Precompute Overlay Analytics (Offload from scroll/zoom hot path) ──────────
  useEffect(() => {
    const list = candlesRef.current || []
    const tz = chartTzRef.current
    candleTimesRef.current =
      timeframe === '1D'
        ? list.map((c) => c.time as number)
        : list.map((c) => toChartTime(c.time as number, tz))

    const rawBars: ContextBar[] = list.map((c) => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))
    rawBarsRef.current = rawBars

    if (rawBars.length === 0) {
      sessionExtremesRef.current = []
      spikesRef.current = []
      distRefsRef.current = []
      newsMovesRef.current = []
      return
    }

    const yesterdayStartUnix = yesterdayNyc
      ? yesterdayNyc.openUnix - 16 * 3600
      : (list.length > 0 ? (list[list.length - 1]!.time as number) - 86400 * 2 : undefined)

    sessionExtremesRef.current =
      timeframe === '1D'
        ? detectDailyExtremes(rawBars, 24)
        : detect5DaySessionExtremes(rawBars, instrument, yesterdayStartUnix)

    if (timeframe !== '1D') {
      spikesRef.current = detectSpikes(rawBars, instrument, yesterdayStartUnix)
      distRefsRef.current = detectDistributionReferences(rawBars, instrument, yesterdayStartUnix)
      const allNews = detectEmotionalNewsMoves(
        rawBars,
        newsEvents,
        instrument,
        yesterdayStartUnix,
        undefined,
        false // Routine 2x ATR bars are NOT breaking news! No more routine spike clutter!
      )
      // Keep ONLY the single latest most significant Tier-1 macro news move within active trading (last 36h)
      const nowSec = Math.floor(Date.now() / 1000)
      const significant = allNews.filter(
        (m) =>
          !m.eventName.includes('Breaking News Volatility Spike') &&
          (isVeryImportantMacroEvent(m.eventName, m.country) || m.impact === 'High') &&
          nowSec - m.reactionEndTime <= 36 * 3600
      )
      newsMovesRef.current = significant.length > 0 ? [significant[significant.length - 1]!] : []
    } else {
      spikesRef.current = []
      distRefsRef.current = []
      newsMovesRef.current = []
    }

    // Trigger fast canvas repaints with newly calculated analytics
    paintFrvpHistogramRef.current?.()
    paintExcessesAndRoundedRef.current?.()
    paintUserDrawingsRef.current?.()
    paintNewsMarkersRef.current?.()
  }, [candles, timeframe, instrument, yesterdayNyc, newsEvents])

  // ─── Multi-Timeframe Money Fixed Range Volume Profiles (Canvas) ─────────────
  const paintFrvpHistogram = useCallback(() => {
    const canvas = frvpHistogramCanvasRef.current
    const chart = chartRef.current
    const series = candleRef.current
    const list = candlesRef.current
    if (!canvas || !chart || !series || !containerRef.current || list.length === 0) {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const paneW = containerRef.current.clientWidth
    const paneH = containerRef.current.clientHeight
    if (paneW < 10 || paneH < 10) return

    const dpr = window.devicePixelRatio || 1
    const targetW = Math.round(paneW * dpr)
    const targetH = Math.round(paneH * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
      canvas.style.width = `${paneW}px`
      canvas.style.height = `${paneH}px`
    }

    let priceAxisW = 82
    try {
      priceAxisW = chart.priceScale('right').width() || priceAxisW
    } catch {}
    const timeAxisH = 26
    const plotW = Math.max(0, paneW - priceAxisW)
    const plotH = Math.max(0, paneH - timeAxisH)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, paneW, paneH)

    // Clip strictly to plot canvas: never bleed into right price scale or bottom time scale
    ctx.beginPath()
    ctx.rect(0, 0, plotW, plotH)
    ctx.clip()

    if (timeframe === '1D') {
      ctx.restore()
      return
    }

    const tz = chartTzRef.current
    const candleTimes =
      candleTimesRef.current.length === list.length
        ? candleTimesRef.current
        : list.map((c) => toChartTime(c.time as number, tz))

    // 1. Intermediate-Term Money: 5-Day Fixed Range Volume Profile
    if (frvp5d && frvp5d.bins && frvp5d.bins.length > 0) {
      const anchorChartT = toChartTime(frvp5d.startUnix, tz)
      const rawXAnchor = timeToX(chart.timeScale(), anchorChartT, candleTimes)
      const xAnchor = rawXAnchor != null && Number.isFinite(rawXAnchor) ? rawXAnchor : 0
      const maxHistW = 160
      const halfBucket = (frvp5d.bucketSize || 1) * 0.5
      const maxBinVol = Math.max(...frvp5d.bins.map((b) => b.volume), 1)

      // Draw volume bars if within visible screen bounds - unpinned so it scrolls off naturally
      if (xAnchor + maxHistW >= 0 && xAnchor <= plotW && rawXAnchor != null) {
        for (const bin of frvp5d.bins) {
          const yTop = series.priceToCoordinate(bin.price + halfBucket)
          const yBottom = series.priceToCoordinate(bin.price - halfBucket)
          if (yTop == null || yBottom == null) continue

          const barY = Math.min(yTop, yBottom)
          const barH = Math.max(1.5, Math.abs(yBottom - yTop) - 0.5)
          if (barY + barH < 0 || barY > plotH) continue

          const totalBarW = (bin.volume / maxBinVol) * maxHistW
          if (totalBarW < 1) continue

          const buyVol = bin.buyVolume ?? (bin.volume * 0.5)
          const buyRatio = bin.volume > 0 ? Math.max(0, Math.min(1, buyVol / bin.volume)) : 0.5
          const buyW = totalBarW * buyRatio
          const sellW = totalBarW - buyW

          // Buy volume (cyan) - soft TradingView opacity
          ctx.fillStyle = bin.inValueArea ? 'rgba(6, 182, 212, 0.65)' : 'rgba(6, 182, 212, 0.28)'
          ctx.fillRect(xAnchor, barY, buyW, barH)

          // Sell volume (magenta)
          ctx.fillStyle = bin.inValueArea ? 'rgba(236, 72, 153, 0.65)' : 'rgba(236, 72, 153, 0.28)'
          ctx.fillRect(xAnchor + buyW, barY, sellW, barH)
        }
      }

      // IT: 5D POC Line — extends only till the last candle (never into price axis)
      const yPoc = series.priceToCoordinate(frvp5d.poc)
      if (yPoc != null && Number.isFinite(yPoc) && yPoc >= 0 && yPoc <= plotH) {
        const lineStart = Math.max(0, xAnchor)
        const lastCandle = list[list.length - 1]
        const rawXLast = lastCandle
          ? timeToX(chart.timeScale(), toChartTime(lastCandle.time as number, tz), candleTimes)
          : null
        const lineEnd =
          rawXLast != null && Number.isFinite(rawXLast)
            ? Math.min(plotW, Math.max(lineStart, rawXLast))
            : Math.min(plotW, lineStart + 160)

        if (lineEnd > lineStart) {
          ctx.strokeStyle = '#38bdf8'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(lineStart, Math.round(yPoc) + 0.5)
          ctx.lineTo(lineEnd, Math.round(yPoc) + 0.5)
          ctx.stroke()

          ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = '#38bdf8'
          ctx.fillText(`5D POC ${frvp5d.poc.toLocaleString()}`, lineStart + 6, yPoc - 4)
        }
      }
    }

    // 2. Short-Term Money: Yesterday Fixed Range Profile
    if (showYesterdayNyc && yesterdayNyc && yesterdayNyc.bins && yesterdayNyc.bins.length > 0) {
      const yAnchorChartT = toChartTime(yesterdayNyc.openUnix, tz)
      const rawXYAnchor = timeToX(chart.timeScale(), yAnchorChartT, candleTimes)
      const rawXYEnd = timeToX(chart.timeScale(), toChartTime(yesterdayNyc.closeUnix, tz), candleTimes)
      if (rawXYAnchor != null && Number.isFinite(rawXYAnchor)) {
        const yAnchor = rawXYAnchor
        const yEnd = rawXYEnd ?? (yAnchor + 140)
        const availableW = Math.max(0, yEnd - yAnchor)
        const histWYday = Math.min(130, Math.max(30, availableW > 30 ? availableW * 0.75 : availableW))
        const halfBucket = (yesterdayNyc.bucketSize || 1) * 0.5
        const maxBinVolYday = Math.max(...yesterdayNyc.bins.map((b) => b.volume), 1)

        // Draw volume bars for yesterday - bounded so it never overlaps with overnight
        if (yAnchor + histWYday >= 0 && yAnchor <= plotW && availableW > 5) {
          for (const bin of yesterdayNyc.bins) {
            const yTop = series.priceToCoordinate(bin.price + halfBucket)
            const yBottom = series.priceToCoordinate(bin.price - halfBucket)
            if (yTop == null || yBottom == null) continue

            const barY = Math.min(yTop, yBottom)
            const barH = Math.max(1.5, Math.abs(yBottom - yTop) - 0.5)
            if (barY + barH < 0 || barY > plotH) continue

            const totalBarW = Math.min(availableW, (bin.volume / maxBinVolYday) * histWYday)
            if (totalBarW < 1) continue

            const buyVol = bin.buyVolume ?? (bin.volume * 0.5)
            const buyRatio = bin.volume > 0 ? Math.max(0, Math.min(1, buyVol / bin.volume)) : 0.5
            const buyW = totalBarW * buyRatio
            const sellW = totalBarW - buyW

            // Buy volume: warm amber
            ctx.fillStyle = bin.inValueArea ? 'rgba(245, 158, 11, 0.70)' : 'rgba(245, 158, 11, 0.30)'
            ctx.fillRect(yAnchor, barY, buyW, barH)

            // Sell volume: warm coral/rose
            ctx.fillStyle = bin.inValueArea ? 'rgba(244, 63, 94, 0.70)' : 'rgba(244, 63, 94, 0.30)'
            ctx.fillRect(yAnchor + buyW, barY, sellW, barH)
          }
        }

        // ST: Y-POC Line — stays inside yesterday's session, bounded cleanly
        const yPocYday = series.priceToCoordinate(yesterdayNyc.poc)
        if (yPocYday != null && Number.isFinite(yPocYday) && yPocYday >= 0 && yPocYday <= plotH && yAnchor <= plotW) {
          const lineStart = Math.max(0, yAnchor)
          const lineEnd = Math.min(plotW, Math.max(lineStart, yEnd))
          if (lineEnd > lineStart) {
            ctx.strokeStyle = '#d97706'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(lineStart, Math.round(yPocYday) + 0.5)
            ctx.lineTo(lineEnd, Math.round(yPocYday) + 0.5)
            ctx.stroke()

            ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace'
            ctx.fillStyle = '#d97706'
            ctx.fillText(`Y-POC ${yesterdayNyc.poc.toLocaleString()}`, lineStart + 6, yPocYday - 4)
          }
        }
      }
    }

    // 3. Short-Term Money: Overnight Fixed Range Profile
    const on = overnightInventory?.overnight
    if (showInventorySessions && on && on.bins && on.bins.length > 0) {
      const onBins = on.bins
      const onAnchorChartT = toChartTime(on.startUnix, tz)
      const rawXOnAnchor = timeToX(chart.timeScale(), onAnchorChartT, candleTimes)
      const rawXOnEnd = timeToX(chart.timeScale(), toChartTime(on.endUnix, tz), candleTimes)
      if (rawXOnAnchor != null && Number.isFinite(rawXOnAnchor)) {
        const onAnchor = rawXOnAnchor
        const onEnd = rawXOnEnd ?? (onAnchor + 140)
        const availableW = Math.max(0, onEnd - onAnchor)
        const histWOn = Math.min(130, Math.max(30, availableW > 30 ? availableW * 0.75 : availableW))
        const halfBucket = (on.bucketSize || 1) * 0.5
        const maxBinVolOn = Math.max(...onBins.map((b) => b.volume), 1)

        // Draw volume bars for overnight - bounded cleanly
        if (onAnchor + histWOn >= 0 && onAnchor <= plotW && availableW > 5) {
          for (const bin of onBins) {
            const yTop = series.priceToCoordinate(bin.price + halfBucket)
            const yBottom = series.priceToCoordinate(bin.price - halfBucket)
            if (yTop == null || yBottom == null) continue

            const barY = Math.min(yTop, yBottom)
            const barH = Math.max(1.5, Math.abs(yBottom - yTop) - 0.5)
            if (barY + barH < 0 || barY > plotH) continue

            const totalBarW = Math.min(availableW, (bin.volume / maxBinVolOn) * histWOn)
            if (totalBarW < 1) continue

            const buyVol = bin.buyVolume ?? (bin.volume * 0.5)
            const buyRatio = bin.volume > 0 ? Math.max(0, Math.min(1, buyVol / bin.volume)) : 0.5
            const buyW = totalBarW * buyRatio
            const sellW = totalBarW - buyW

            // Buy volume: sky-blue
            ctx.fillStyle = bin.inValueArea ? 'rgba(14, 165, 233, 0.70)' : 'rgba(14, 165, 233, 0.30)'
            ctx.fillRect(onAnchor, barY, buyW, barH)

            // Sell volume: violet
            ctx.fillStyle = bin.inValueArea ? 'rgba(139, 92, 246, 0.70)' : 'rgba(139, 92, 246, 0.30)'
            ctx.fillRect(onAnchor + buyW, barY, sellW, barH)
          }
        }

        // ST: ON-POC Line — extends till the last minute before NYC opens (9:29 AM)
        const yPocOn = series.priceToCoordinate(on.poc)
        if (yPocOn != null && Number.isFinite(yPocOn) && yPocOn >= 0 && yPocOn <= plotH && onAnchor <= plotW) {
          const lineStart = Math.max(0, onAnchor)
          const lineEnd = Math.min(plotW, Math.max(lineStart, onEnd))
          if (lineEnd > lineStart) {
            ctx.strokeStyle = '#0284c7'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(lineStart, Math.round(yPocOn) + 0.5)
            ctx.lineTo(lineEnd, Math.round(yPocOn) + 0.5)
            ctx.stroke()

            ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace'
            ctx.fillStyle = '#0284c7'
            ctx.fillText(`ON-POC ${on.poc.toLocaleString()}`, lineStart + 6, yPocOn - 4)
          }
        }
      }
    }

    ctx.restore()
  }, [frvp5d, yesterdayNyc, overnightInventory, avwap5mBenchmark, showYesterdayNyc, showInventorySessions])

  useEffect(() => {
    paintFrvpHistogramRef.current = paintFrvpHistogram
  }, [paintFrvpHistogram])

  useEffect(() => {
    paintFrvpHistogram()
  }, [paintFrvpHistogram])

  // ─── User Interactive Drawings (Canvas) ─────────────────────────────────────
  const paintUserDrawings = useCallback(() => {
    const canvas = userDrawingsCanvasRef.current
    const chart = chartRef.current
    const series = candleRef.current
    const list = candlesRef.current
    if (!canvas || !chart || !series || !containerRef.current || list.length === 0) {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const paneW = containerRef.current.clientWidth
    const paneH = containerRef.current.clientHeight
    if (paneW < 10 || paneH < 10) return

    const dpr = window.devicePixelRatio || 1
    const targetW = Math.round(paneW * dpr)
    const targetH = Math.round(paneH * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
      canvas.style.width = `${paneW}px`
      canvas.style.height = `${paneH}px`
    }

    let priceAxisW = 82
    try {
      priceAxisW = chart.priceScale('right').width() || priceAxisW
    } catch {}
    const timeAxisH = 26
    const plotW = Math.max(0, paneW - priceAxisW)
    const plotH = Math.max(0, paneH - timeAxisH)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, paneW, paneH)

    ctx.beginPath()
    ctx.rect(0, 0, plotW, plotH)
    ctx.clip()

    const tz = chartTzRef.current
    const candleTimes =
      candleTimesRef.current.length === list.length
        ? candleTimesRef.current
        : list.map((c) => toChartTime(c.time as number, tz))

    // 1. Render Manual FRVPs
    for (const f of activeManualFrvps) {
      const anchorChartT = toChartTime(f.timeStart, tz)
      const endChartT = toChartTime(f.timeEnd, tz)
      const rawXAnchor = timeToX(chart.timeScale(), anchorChartT, candleTimes)
      const rawXEnd = timeToX(chart.timeScale(), endChartT, candleTimes)
      if (rawXAnchor != null && Number.isFinite(rawXAnchor)) {
        const startX = Math.min(rawXAnchor, rawXEnd ?? rawXAnchor)
        const endX = Math.max(rawXAnchor, rawXEnd ?? (rawXAnchor + 120))
        const spanW = Math.max(50, endX - startX)
        const maxHistW = Math.min(spanW * 0.85, 180)
        const halfBucket = (f.bucketSize || 1) * 0.5
        const maxBinVol = Math.max(...f.bins.map((b) => b.volume), 1)

        // Draw volume bars
        if (startX + maxHistW >= 0 && startX <= plotW) {
          for (const bin of f.bins) {
            const yTop = series.priceToCoordinate(bin.price + halfBucket)
            const yBottom = series.priceToCoordinate(bin.price - halfBucket)
            if (yTop == null || yBottom == null) continue

            const barY = Math.min(yTop, yBottom)
            const barH = Math.max(1.5, Math.abs(yBottom - yTop) - 0.5)
            if (barY + barH < 0 || barY > plotH) continue

            const totalBarW = (bin.volume / maxBinVol) * maxHistW
            if (totalBarW < 1) continue

            const buyVol = bin.buyVolume ?? (bin.volume * 0.5)
            const buyRatio = bin.volume > 0 ? Math.max(0, Math.min(1, buyVol / bin.volume)) : 0.5
            const buyW = totalBarW * buyRatio
            const sellW = totalBarW - buyW

            // Buy volume
            ctx.fillStyle = bin.inValueArea ? 'rgba(245, 158, 11, 0.85)' : 'rgba(245, 158, 11, 0.35)'
            ctx.fillRect(startX, barY, buyW, barH)

            // Sell volume
            ctx.fillStyle = bin.inValueArea ? 'rgba(244, 63, 94, 0.85)' : 'rgba(244, 63, 94, 0.35)'
            ctx.fillRect(startX + buyW, barY, sellW, barH)
          }
        }

        // POC line across profile span
        const yPoc = series.priceToCoordinate(f.poc)
        if (yPoc != null && Number.isFinite(yPoc) && yPoc >= 0 && yPoc <= plotH) {
          const clampedEndX = Math.min(plotW, endX)
          ctx.strokeStyle = '#f59e0b'
          ctx.lineWidth = 2
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(startX, Math.round(yPoc) + 0.5)
          ctx.lineTo(clampedEndX, Math.round(yPoc) + 0.5)
          ctx.stroke()

          ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = '#f59e0b'
          ctx.fillText(`Manual POC ${f.poc.toLocaleString()}`, startX + 4, yPoc - 4)
        }

        // VAH line
        const yVah = series.priceToCoordinate(f.vah)
        if (yVah != null && Number.isFinite(yVah) && yVah >= 0 && yVah <= plotH) {
          const clampedEndX = Math.min(plotW, endX)
          ctx.strokeStyle = '#10b981'
          ctx.lineWidth = 1.5
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(startX, Math.round(yVah) + 0.5)
          ctx.lineTo(clampedEndX, Math.round(yVah) + 0.5)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = '#10b981'
          ctx.fillText(`VAH ${f.vah.toLocaleString()}`, startX + 4, yVah - 3)
        }

        // VAL line
        const yVal = series.priceToCoordinate(f.val)
        if (yVal != null && Number.isFinite(yVal) && yVal >= 0 && yVal <= plotH) {
          const clampedEndX = Math.min(plotW, endX)
          ctx.strokeStyle = '#ef4444'
          ctx.lineWidth = 1.5
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(startX, Math.round(yVal) + 0.5)
          ctx.lineTo(clampedEndX, Math.round(yVal) + 0.5)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = '#ef4444'
          ctx.fillText(`VAL ${f.val.toLocaleString()}`, startX + 4, yVal + 11)
        }

        // Profile boundary box and header badge
        const yTopExt = series.priceToCoordinate(f.high)
        const yBotExt = series.priceToCoordinate(f.low)
        if (yTopExt != null && yBotExt != null) {
          const bY = Math.min(yTopExt, yBotExt)
          const bH = Math.abs(yBotExt - yTopExt)
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)'
          ctx.lineWidth = 1
          ctx.strokeRect(startX, bY, spanW, bH)

          // Header
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
          ctx.fillRect(startX, Math.max(0, bY - 18), 170, 16)
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = '#fcd34d'
          ctx.fillText(`📊 ${f.label || 'Manual FRVP'} (${f.totalVolume.toLocaleString()})`, startX + 4, Math.max(12, bY - 6))
        }
      }
    }

    // 2. Render Range Boxes
    for (const r of activeRangeBoxes) {
      const x1 = timeToX(chart.timeScale(), toChartTime(r.p1.time, tz), candleTimes, false, barSeconds)
      const x2 = timeToX(chart.timeScale(), toChartTime(r.p2.time, tz), candleTimes, false, barSeconds)
      const y1 = series.priceToCoordinate(r.p1.price)
      const y2 = series.priceToCoordinate(r.p2.price)
      if (x1 != null && x2 != null && y1 != null && y2 != null) {
        const minX = Math.min(x1, x2)
        const maxX = Math.max(x1, x2)
        const topY = Math.min(y1, y2)
        const botY = Math.max(y1, y2)
        const boxW = Math.max(4, maxX - minX)
        const boxH = Math.max(4, botY - topY)

        const isMem = Boolean(r.isMemory)
        const memFill = isMem ? 'rgba(245, 158, 11, 0.18)' : 'rgba(168, 85, 247, 0.16)'
        const memBorder = isMem ? 'rgba(245, 158, 11, 0.95)' : 'rgba(168, 85, 247, 0.85)'

        // Shaded fill
        ctx.fillStyle = memFill
        ctx.fillRect(minX, topY, boxW, boxH)

        // Border
        ctx.strokeStyle = memBorder
        ctx.lineWidth = isMem ? 2 : 1.5
        ctx.setLineDash(isMem ? [] : [4, 4])
        ctx.strokeRect(minX, topY, boxW, boxH)
        ctx.setLineDash([])

        const highP = Math.max(r.p1.price, r.p2.price)
        const lowP = Math.min(r.p1.price, r.p2.price)
        const spanPts = Math.round(highP - lowP)

        if (isMem) {
          // Top line Memory badge
          ctx.fillStyle = 'rgba(20, 14, 5, 0.92)'
          const headerText = `🧠 LEO MEMORY: ${r.memoryPurpose ? r.memoryPurpose.slice(0, 32) : 'Level Observation'} [🔔 ALARM ACTIVE]`
          ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace'
          const textW = Math.min(boxW, Math.max(160, ctx.measureText(headerText).width + 12))
          ctx.fillRect(minX, Math.max(0, topY - 16), textW, 16)
          ctx.strokeStyle = '#f59e0b'
          ctx.lineWidth = 1
          ctx.strokeRect(minX, Math.max(0, topY - 16), textW, 16)
          ctx.fillStyle = '#fbbf24'
          ctx.fillText(headerText, minX + 5, Math.max(11, topY - 4))

          // Bottom line Low badge
          ctx.fillStyle = 'rgba(20, 14, 5, 0.92)'
          ctx.fillRect(minX, botY, 150, 14)
          ctx.fillStyle = '#fcd34d'
          ctx.fillText(`Zone: ${lowP.toLocaleString()} – ${highP.toLocaleString()} (${spanPts} pts)`, minX + 4, botY + 11)
        } else {
          // Top line High badge
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
          ctx.fillRect(minX, Math.max(0, topY - 14), 115, 14)
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = '#c084fc'
          ctx.fillText(`Range High: ${highP.toLocaleString()}`, minX + 4, Math.max(10, topY - 3))

          // Bottom line Low badge
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
          ctx.fillRect(minX, botY, 115, 14)
          ctx.fillStyle = '#c084fc'
          ctx.fillText(`Range Low: ${lowP.toLocaleString()}`, minX + 4, botY + 11)

          // Center span pill
          const midY = (topY + botY) / 2
          ctx.fillStyle = 'rgba(88, 28, 135, 0.9)'
          ctx.fillRect(minX + 4, midY - 8, 95, 16)
          ctx.fillStyle = '#f3e8ff'
          ctx.fillText(`⬛ ${spanPts} pts (${r.label || 'Range'})`, minX + 6, midY + 4)
        }
      }
    }

    // Helper to paint a measurement box, diagonal line, endpoints, and floating metrics badge
    const paintMeasureOverlay = (
      p1: { time: number; price: number; x?: number; y?: number },
      p2: { time: number; price: number; x?: number; y?: number },
      id?: string,
      isDraft: boolean = false
    ) => {
      const x1 = timeToX(chart.timeScale(), toChartTime(p1.time, tz), candleTimes, false, barSeconds) ?? p1.x
      const x2 = timeToX(chart.timeScale(), toChartTime(p2.time, tz), candleTimes, false, barSeconds) ?? p2.x
      const y1 = series.priceToCoordinate(p1.price) ?? p1.y
      const y2 = series.priceToCoordinate(p2.price) ?? p2.y
      if (x1 == null || x2 == null || y1 == null || y2 == null) return

      const minX = Math.min(x1, x2)
      const maxX = Math.max(x1, x2)
      const minY = Math.min(y1, y2)
      const maxY = Math.max(y1, y2)
      const boxW = Math.max(2, maxX - minX)
      const boxH = Math.max(2, maxY - minY)

      const dPrice = p2.price - p1.price
      const isUp = dPrice >= 0
      const dPriceAbs = Math.abs(dPrice)
      const pctChange = p1.price !== 0 ? (dPrice / p1.price) * 100 : 0
      const sign = isUp ? '+' : '-'
      const arrow = isUp ? '▲' : '▼'

      // TradingView styling: emerald green for bullish/upward measurement, rose red for bearish/downward
      const fillColor = isUp ? 'rgba(16, 185, 129, 0.14)' : 'rgba(244, 63, 94, 0.14)'
      const strokeColor = isUp ? 'rgba(16, 185, 129, 0.85)' : 'rgba(244, 63, 94, 0.85)'
      const accentColor = isUp ? '#34d399' : '#fb7185'

      // 1. Shaded area box
      ctx.fillStyle = fillColor
      ctx.fillRect(minX, minY, boxW, boxH)

      // 2. Dashed boundary rectangle
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = isDraft ? 1.5 : 1.2
      ctx.setLineDash([4, 3])
      ctx.strokeRect(minX, minY, boxW, boxH)

      // 3. Diagonal vector line from anchor p1 to target p2
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = 1.5
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])

      // 4. Anchor dots
      ctx.fillStyle = accentColor
      ctx.beginPath()
      ctx.arc(x1, y1, 4, 0, 2 * Math.PI)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x2, y2, 4, 0, 2 * Math.PI)
      ctx.fill()

      // 5. Calculate bar count, time span, and volume across measured range
      const minTime = Math.min(p1.time, p2.time)
      const maxTime = Math.max(p1.time, p2.time)
      const measuredCandles = list.filter((c) => {
        const ct = Number(c.time)
        return ct >= minTime && ct <= maxTime
      })
      const barsCount = Math.max(1, measuredCandles.length)
      const deltaSec = Math.abs(p2.time - p1.time)
      let timeStr = ''
      if (deltaSec >= 86400) {
        const days = Math.floor(deltaSec / 86400)
        const hours = Math.floor((deltaSec % 86400) / 3600)
        timeStr = `${days}d ${hours}h`
      } else if (deltaSec >= 3600) {
        const hours = Math.floor(deltaSec / 3600)
        const mins = Math.floor((deltaSec % 3600) / 60)
        timeStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
      } else {
        const mins = Math.max(1, Math.round(deltaSec / 60))
        timeStr = `${mins}m`
      }

      let totalVol = 0
      for (const c of measuredCandles) {
        if (typeof c.volume === 'number') totalVol += c.volume
      }
      let volStr = ''
      if (totalVol > 0) {
        if (totalVol >= 1_000_000) volStr = ` · Vol ${(totalVol / 1_000_000).toFixed(2)}M`
        else if (totalVol >= 1_000) volStr = ` · Vol ${(totalVol / 1_000).toFixed(1)}K`
        else volStr = ` · Vol ${Math.round(totalVol)}`
      }

      // 6. Floating High-Precision Badge
      const ptsFormatted = dPriceAbs >= 1000
        ? dPriceAbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : dPriceAbs.toFixed(2)
      const line1 = `${arrow} ${sign}${ptsFormatted} pts (${sign}${Math.abs(pctChange).toFixed(2)}%)`
      const line2 = `${barsCount} bar${barsCount > 1 ? 's' : ''}, ${timeStr}${volStr}`

      ctx.font = 'bold 11px ui-monospace, SFMono-Regular, monospace'
      const textW1 = ctx.measureText(line1).width
      ctx.font = '9.5px ui-monospace, SFMono-Regular, monospace'
      const textW2 = ctx.measureText(line2).width
      const badgeW = Math.max(textW1, textW2) + (isDraft ? 24 : 38)
      const badgeH = 38

      let badgeX = (minX + maxX) / 2 - badgeW / 2
      let badgeY = isUp ? minY - badgeH - 8 : maxY + 8
      badgeX = Math.max(4, Math.min(plotW - badgeW - 4, badgeX))
      if (badgeY < 4) badgeY = maxY + 8
      if (badgeY + badgeH > plotH - 4) badgeY = Math.max(4, minY - badgeH - 8)

      // Rounded container
      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)'
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = 1.2
      const r = 6
      ctx.beginPath()
      ctx.moveTo(badgeX + r, badgeY)
      ctx.lineTo(badgeX + badgeW - r, badgeY)
      ctx.quadraticCurveTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + r)
      ctx.lineTo(badgeX + badgeW, badgeY + badgeH - r)
      ctx.quadraticCurveTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - r, badgeY + badgeH)
      ctx.lineTo(badgeX + r, badgeY + badgeH)
      ctx.quadraticCurveTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - r)
      ctx.lineTo(badgeX, badgeY + r)
      ctx.quadraticCurveTo(badgeX, badgeY, badgeX + r, badgeY)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Badge texts
      ctx.font = 'bold 11px ui-monospace, SFMono-Regular, monospace'
      ctx.fillStyle = accentColor
      ctx.fillText(line1, badgeX + 10, badgeY + 16)

      ctx.font = '9.5px ui-monospace, SFMono-Regular, monospace'
      ctx.fillStyle = '#cbd5e1'
      ctx.fillText(line2, badgeX + 10, badgeY + 31)

      // Dismiss button on pinned badge
      if (!isDraft && id) {
        measureBadgeHitsRef.current.set(id, { x: badgeX, y: badgeY, w: badgeW, h: badgeH })
        const closeX = badgeX + badgeW - 16
        const closeY = badgeY + 15
        ctx.font = 'bold 11px system-ui, sans-serif'
        ctx.fillStyle = '#94a3b8'
        ctx.fillText('✕', closeX, closeY)
      }
    }

    // Render Pinned Measures
    measureBadgeHitsRef.current.clear()
    for (const m of activeMeasures) {
      paintMeasureOverlay(m.p1, m.p2, m.id, false)
    }

    // Helper: given two points, compute where the infinite line exits the canvas rect (extended past latest bar)
    const extendedLine = (ax: number, ay: number, bx: number, by: number): [number, number, number, number] => {
      if (ax === bx) return [ax, -2000, bx, paneH + 2000]
      const slope = (by - ay) / (bx - ax)
      const minX = -2000
      const maxX = Math.max(paneW + 4000, Math.max(ax, bx) + 4000)
      const yAtLeft  = ay + slope * (minX - ax)
      const yAtRight = ay + slope * (maxX - ax)
      return [minX, yAtLeft, maxX, yAtRight]
    }

    // Collision-avoidance registry to guarantee badges never overlap on the canvas
    const drawnBadges: { x: number; y: number; w: number; h: number }[] = []

    const allocateBadgePos = (
      prefX: number,
      prefY: number,
      w: number,
      h: number,
      preferAbove = true
    ): { x: number; y: number } => {
      let curX = Math.max(6, Math.min(paneW - w - 6, prefX))
      let curY = Math.max(6, Math.min(paneH - h - 6, prefY))

      for (let attempt = 0; attempt < 8; attempt++) {
        const col = drawnBadges.find(
          (b) =>
            curX < b.x + b.w + 6 &&
            curX + w + 6 > b.x &&
            curY < b.y + b.h + 4 &&
            curY + h + 4 > b.y
        )
        if (!col) break
        if (preferAbove) {
          curY = col.y - h - 6
          if (curY < 6) {
            curY = col.y + col.h + 6
            preferAbove = false
          }
        } else {
          curY = col.y + col.h + 6
          if (curY + h > paneH - 6) {
            curY = col.y - h - 6
            preferAbove = true
          }
        }
      }
      drawnBadges.push({ x: curX, y: curY, w, h })
      return { x: curX, y: curY }
    }

    for (const rawTl of activeTrendlines) {
      const isDraggingThis = activeDraggingTlRef.current?.id === rawTl.id
      const tl = isDraggingThis && activeDraggingTlRef.current
        ? {
            ...rawTl,
            p1: activeDraggingTlRef.current.p1,
            p2: activeDraggingTlRef.current.p2,
            direction: activeDraggingTlRef.current.direction || rawTl.direction,
          }
        : rawTl

      const x1 = timeToX(chart.timeScale(), toChartTime(tl.p1.time, tz), candleTimes)
      const x2 = timeToX(chart.timeScale(), toChartTime(tl.p2.time, tz), candleTimes)
      const y1 = series.priceToCoordinate(tl.p1.price)
      const y2 = series.priceToCoordinate(tl.p2.price)
      if (x1 != null && x2 != null && y1 != null && y2 != null) {
        const [ex1, ey1, ex2, ey2] = extendedLine(x1, y1, x2, y2)

        const isSupplyLine = Boolean(tl.label?.includes('Supply') || tl.p2.price < tl.p1.price)
        const tlColor = isSupplyLine ? '#f59e0b' : (tl.color || '#38bdf8')
        const isSelected = selectedTrendlineIdRef.current === tl.id
        const isHovered = hoveredHandleRef.current?.id === tl.id
        const p1Hovered = isHovered && hoveredHandleRef.current?.type === 'p1'
        const p2Hovered = isHovered && hoveredHandleRef.current?.type === 'p2'
        const midHovered = isHovered && (hoveredHandleRef.current?.type === 'mid' || hoveredHandleRef.current?.type === 'body')

        // Selection glow / halo along the line (TradingView style)
        if (isSelected) {
          ctx.save()
          ctx.strokeStyle = isSupplyLine ? 'rgba(245, 158, 11, 0.32)' : 'rgba(56, 189, 248, 0.32)'
          ctx.lineWidth = 8
          ctx.beginPath()
          ctx.moveTo(ex1, ey1)
          ctx.lineTo(ex2, ey2)
          ctx.stroke()
          ctx.restore()
        }

        // Extended line
        ctx.strokeStyle = tlColor
        ctx.lineWidth = 2.5
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(ex1, ey1)
        ctx.lineTo(ex2, ey2)
        ctx.stroke()

        // P1 handle (TradingView interactive anchor: white circle, colored ring, drop shadow)
        const r1 = p1Hovered ? 8 : (isSelected ? 7 : 5)
        ctx.save()
        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
        ctx.shadowBlur = 4
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(x1, y1, r1, 0, 2 * Math.PI)
        ctx.fill()
        ctx.strokeStyle = p1Hovered ? '#ffffff' : tlColor
        ctx.lineWidth = p1Hovered ? 3 : 2
        ctx.stroke()
        ctx.fillStyle = tlColor
        ctx.beginPath()
        ctx.arc(x1, y1, Math.max(2, r1 - 3), 0, 2 * Math.PI)
        ctx.fill()
        ctx.restore()

        // P2 handle (TradingView interactive anchor)
        const r2 = p2Hovered ? 8 : (isSelected ? 7 : 5)
        ctx.save()
        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
        ctx.shadowBlur = 4
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(x2, y2, r2, 0, 2 * Math.PI)
        ctx.fill()
        ctx.strokeStyle = p2Hovered ? '#ffffff' : tlColor
        ctx.lineWidth = p2Hovered ? 3 : 2
        ctx.stroke()
        ctx.fillStyle = tlColor
        ctx.beginPath()
        ctx.arc(x2, y2, Math.max(2, r2 - 3), 0, 2 * Math.PI)
        ctx.fill()
        ctx.restore()

        // Midpoint handle (TradingView translation handle)
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        if (isSelected || isHovered) {
          ctx.save()
          ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
          ctx.shadowBlur = 3
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(mx, my, midHovered ? 6 : 4, 0, 2 * Math.PI)
          ctx.fill()
          ctx.strokeStyle = tlColor
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.fillStyle = tlColor
          ctx.beginPath()
          ctx.arc(mx, my, Math.max(1.5, (midHovered ? 6 : 4) - 2), 0, 2 * Math.PI)
          ctx.fill()
          ctx.restore()
        }

        // Live coordinate readout tooltip while dragging anchor handle (TradingView style)
        if (isDraggingThis) {
          const dragHandle = hoveredHandleRef.current?.type
          const tooltipX = dragHandle === 'p1' ? x1 : x2
          const tooltipY = dragHandle === 'p1' ? y1 : y2
          const targetPx = dragHandle === 'p1' ? tl.p1.price : tl.p2.price
          const readout = `${targetPx.toFixed(2)}`
          ctx.save()
          ctx.font = 'bold 10px ui-monospace, SFMono-Regular, monospace'
          const tw = ctx.measureText(readout).width + 12
          const th = 18
          const bx = Math.min(paneW - tw - 6, tooltipX + 12)
          const by = Math.max(6, tooltipY - 24)
          ctx.fillStyle = 'rgba(15, 23, 42, 0.94)'
          ctx.fillRect(bx, by, tw, th)
          ctx.strokeStyle = tlColor
          ctx.lineWidth = 1.5
          ctx.strokeRect(bx, by, tw, th)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(readout, bx + 6, by + 12)
          ctx.restore()
        }

        // ── Wyckoff Structure Line Engine (Supply / Demand, Spring, Upthrust, JAC Breakout, CVD & 2R Check) ──
        const wyckoffBars: WyckoffBar[] = list.map((c: any) => ({
          time: typeof c.time === 'number' ? c.time : 0,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume || 1),
          cvd: typeof c.cvd === 'number' ? c.cvd : undefined,
        }))

        const wyckoffCtx: WyckoffChartContext = {
          yesterday: yesterdayNyc,
          overnight: overnightInventory,
          frvp5d,
          avwap5m: avwap5mBenchmark,
        }

        // ── Wyckoff Spring / Upthrust Evaluation & Factor Scoring Engine (0-100 pts) ──
        const springUpthrust = evaluateSpringOrUpthrustTrendline(tl, wyckoffBars, wyckoffCtx)
        const isSpring = springUpthrust.originType === 'SPRING'
        const isSupply = !isSpring

        const wyckoffSetup = evaluateWyckoffSetup(tl, wyckoffBars, wyckoffCtx)

        // Midpoint badge render
        const labelText = `📐 Trendline · ${springUpthrust.originType} (${springUpthrust.totalScore}/100 pts · Grade ${springUpthrust.grade}) | Stop: ${springUpthrust.stopLoss.toFixed(1)} | Tgt: ${springUpthrust.targetPrice.toFixed(1)} (${springUpthrust.rrRatio}R)`

        if (!hideTrendlineBadges) {
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
          const textW = ctx.measureText(labelText).width
          const badgeW = textW + 12
          const badgeH = 16
          const { x: midBx, y: midBy } = allocateBadgePos(mx - badgeW / 2, my - 18, badgeW, badgeH, true)

          ctx.fillStyle = isSupply ? 'rgba(30, 20, 5, 0.94)' : 'rgba(15, 23, 42, 0.90)'
          ctx.fillRect(midBx, midBy, badgeW, badgeH)
          ctx.strokeStyle = springUpthrust.color
          ctx.lineWidth = 1.2
          ctx.strokeRect(midBx, midBy, badgeW, badgeH)

          ctx.fillStyle = isSupply ? '#fef08a' : '#7dd3fc'
          ctx.fillText(labelText, midBx + 6, midBy + 11)
        }

        // Render Stop Loss level (dashed red/rose) from Spring / Upthrust Evaluation
        const hasStop = springUpthrust.stopLoss && Number.isFinite(springUpthrust.stopLoss)
        const hasTarget = springUpthrust.targetPrice && Number.isFinite(springUpthrust.targetPrice)
        const yStop = hasStop ? series.priceToCoordinate(springUpthrust.stopLoss) : null
        const yTgt = hasTarget ? series.priceToCoordinate(springUpthrust.targetPrice) : null

        if (yStop != null && Number.isFinite(yStop)) {
          ctx.strokeStyle = '#f43f5e'
          ctx.lineWidth = 1.3
          ctx.setLineDash([4, 3])
          ctx.beginPath()
          ctx.moveTo(ex1, Math.round(yStop) + 0.5)
          ctx.lineTo(ex2, Math.round(yStop) + 0.5)
          ctx.stroke()
          ctx.setLineDash([])

          if (!hideTrendlineBadges) {
            ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
            const slText = `🛑 Stop (${isSpring ? 'Spring Low' : 'Upthrust High'}): ${springUpthrust.stopLoss.toFixed(1)} [${springUpthrust.riskPoints.toFixed(1)}pts]`
            const slW = ctx.measureText(slText).width + 10
            ctx.fillStyle = 'rgba(76, 5, 25, 0.94)'
            ctx.fillRect(ex2 - slW - 10, yStop - 16, slW, 15)
            ctx.strokeStyle = '#f43f5e'
            ctx.strokeRect(ex2 - slW - 10, yStop - 16, slW, 15)
            ctx.fillStyle = '#fecdd3'
            ctx.fillText(slText, ex2 - slW - 5, yStop - 5)
          }
        }

        // Render Target level (dashed emerald) from Spring / Upthrust Evaluation
        if (yTgt != null && Number.isFinite(yTgt)) {
          ctx.strokeStyle = '#10b981'
          ctx.lineWidth = 1.3
          ctx.setLineDash([4, 3])
          ctx.beginPath()
          ctx.moveTo(ex1, Math.round(yTgt) + 0.5)
          ctx.lineTo(ex2, Math.round(yTgt) + 0.5)
          ctx.stroke()
          ctx.setLineDash([])

          if (!hideTrendlineBadges) {
            ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
            const tgtText = `🎯 Target (${springUpthrust.targetZoneLabel}): ${springUpthrust.targetPrice.toFixed(1)} [${springUpthrust.rewardPoints.toFixed(1)}pts · ${springUpthrust.rrRatio}R] ${springUpthrust.is2RValid ? '✅' : '⚠️ <2R'}`
            const tgtW = ctx.measureText(tgtText).width + 10
            ctx.fillStyle = 'rgba(6, 78, 59, 0.94)'
            ctx.fillRect(ex2 - tgtW - 10, yTgt - 16, tgtW, 15)
            ctx.strokeStyle = '#10b981'
            ctx.strokeRect(ex2 - tgtW - 10, yTgt - 16, tgtW, 15)
            ctx.fillStyle = '#a7f3d0'
            ctx.fillText(tgtText, ex2 - tgtW - 5, yTgt - 5)
          }
        }

        // On-Chart Factor Points Breakdown Card (renders when trendline is hovered or selected)
        if ((isSelected || isHovered) && !hideTrendlineBadges) {
          ctx.save()
          const cardW = 340
          const cardH = 224
          const cardX = Math.min(paneW - cardW - 12, Math.max(12, mx + 16))
          const cardY = Math.min(paneH - cardH - 12, Math.max(12, my - cardH / 2))

          // Card Background & Drop Shadow
          ctx.shadowColor = 'rgba(0, 0, 0, 0.75)'
          ctx.shadowBlur = 12
          ctx.fillStyle = 'rgba(10, 15, 30, 0.96)'
          ctx.beginPath()
          if (typeof (ctx as any).roundRect === 'function') {
            ;(ctx as any).roundRect(cardX, cardY, cardW, cardH, 8)
          } else {
            ctx.rect(cardX, cardY, cardW, cardH)
          }
          ctx.fill()
          ctx.shadowBlur = 0

          // Card Border
          ctx.strokeStyle = springUpthrust.color
          ctx.lineWidth = 1.5
          ctx.stroke()

          // Header Bar
          ctx.fillStyle = isSpring ? 'rgba(6, 78, 59, 0.4)' : 'rgba(136, 19, 55, 0.4)'
          ctx.beginPath()
          if (typeof (ctx as any).roundRect === 'function') {
            ;(ctx as any).roundRect(cardX, cardY, cardW, 28, [8, 8, 0, 0])
          } else {
            ctx.rect(cardX, cardY, cardW, 28)
          }
          ctx.fill()

          // Header Text
          ctx.font = 'bold 11px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = '#ffffff'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(`📐 Trendline · Wyckoff ${springUpthrust.originType} (${springUpthrust.totalScore}/100 pts · Grade ${springUpthrust.grade})`, cardX + 10, cardY + 14)

          // Subtitle / Quick status
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = springUpthrust.is2RValid ? '#34d399' : '#fbbf24'
          ctx.textAlign = 'right'
          ctx.fillText(springUpthrust.is2RValid ? 'QUALIFIED >= 2R' : 'FILTERED (< 2R)', cardX + cardW - 10, cardY + 14)

          // Factor Rows
          const fList = [
            springUpthrust.factors.location,
            springUpthrust.factors.volumeEffortVsResult,
            springUpthrust.factors.candleExcess,
            springUpthrust.factors.cvdAbsorption,
            springUpthrust.factors.avwap5m,
            springUpthrust.factors.roundNumber,
            springUpthrust.factors.rewardRisk,
          ]

          let curY = cardY + 42
          for (const f of fList) {
            ctx.textAlign = 'left'
            ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
            ctx.fillStyle = '#cbd5e1'
            ctx.fillText(f.name, cardX + 10, curY)

            // Factor score on right
            const scoreStr = `${f.score}/${f.maxScore} pts`
            ctx.textAlign = 'right'
            ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
            ctx.fillStyle = f.score >= f.maxScore * 0.7 ? '#34d399' : f.score >= f.maxScore * 0.4 ? '#fbbf24' : '#f87171'
            ctx.fillText(scoreStr, cardX + cardW - 10, curY)

            // Factor detail summary
            ctx.textAlign = 'left'
            ctx.font = '8px ui-monospace, SFMono-Regular, monospace'
            ctx.fillStyle = '#94a3b8'
            const detailText = f.details.length > 58 ? f.details.slice(0, 56) + '…' : f.details
            ctx.fillText(detailText, cardX + 10, curY + 11)

            curY += 21
          }

          // Bottom Trade Plan strip
          ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'
          ctx.fillRect(cardX, cardY + cardH - 24, cardW, 24)
          ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)'
          ctx.beginPath()
          ctx.moveTo(cardX, cardY + cardH - 24)
          ctx.lineTo(cardX + cardW, cardY + cardH - 24)
          ctx.stroke()

          ctx.font = 'bold 8.5px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = '#e2e8f0'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(`Stop: ${springUpthrust.stopLoss.toFixed(1)} (${springUpthrust.riskPoints.toFixed(1)}pts) | Tgt: ${springUpthrust.targetZoneLabel} ${springUpthrust.targetPrice.toFixed(1)} (${springUpthrust.rewardPoints.toFixed(1)}pts · ${springUpthrust.rrRatio}R)`, cardX + 8, cardY + cardH - 12)

          ctx.restore()
        }

          // Draw Setup Alert Pill at the trigger candle
          if (!hideTrendlineBadges && wyckoffSetup.triggerTime) {
            const trigX = timeToX(chart.timeScale(), toChartTime(wyckoffSetup.triggerTime, tz), candleTimes)
            const trigY = series.priceToCoordinate(wyckoffSetup.entryPrice)
            if (trigX != null && trigY != null && Number.isFinite(trigX) && Number.isFinite(trigY)) {
              // Glow marker on trigger candle
              ctx.fillStyle = wyckoffSetup.color
              ctx.beginPath()
              ctx.arc(trigX, trigY, 4, 0, Math.PI * 2)
              ctx.fill()

              ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace'
              const bText = wyckoffSetup.badgeText
              const bW = ctx.measureText(bText).width + 16
              const bH = 18
              const bX = Math.max(10, Math.min(paneW - bW - 10, trigX - bW / 2))
              const bY = isSupply ? trigY - 26 : trigY + 12

              ctx.fillStyle = 'rgba(15, 23, 42, 0.95)'
              ctx.beginPath()
              if (typeof (ctx as any).roundRect === 'function') {
                (ctx as any).roundRect(bX, bY, bW, bH, 6)
              } else {
                ctx.rect(bX, bY, bW, bH)
              }
              ctx.fill()

              ctx.strokeStyle = wyckoffSetup.color
              ctx.lineWidth = 1.3
              ctx.stroke()

              ctx.fillStyle = wyckoffSetup.is2RValid ? '#f8fafc' : '#fef08a'
              ctx.textAlign = 'left'
              ctx.textBaseline = 'middle'
              ctx.fillText(bText, bX + 8, bY + bH * 0.5)
            }
          }
        }
      }

    // 4. In-progress Drawing Draft Preview
    if (drawingDraft && draftMousePosRef.current) {
      const p1 = drawingDraft
      const p2 = draftMousePosRef.current
      const x1 = timeToX(chart.timeScale(), toChartTime(p1.time, tz), candleTimes, false, barSeconds) ?? p1.x
      const x2 = timeToX(chart.timeScale(), toChartTime(p2.time, tz), candleTimes, false, barSeconds) ?? p2.x
      const y1 = series.priceToCoordinate(p1.price) ?? p1.y
      const y2 = series.priceToCoordinate(p2.price) ?? p2.y

      if (x1 != null && x2 != null && y1 != null && y2 != null) {
        if (activeDrawingTool === 'TRENDLINE') {
          const isSupplyDraft = p2.price <= p1.price
          const draftColor = isSupplyDraft ? '#f59e0b' : '#38bdf8'
          const roleDraft = isSupplyDraft ? 'Supply (Creek)' : 'Demand (Ice)'
          const [dex1, dey1, dex2, dey2] = extendedLine(x1, y1, x2, y2)
          ctx.strokeStyle = draftColor
          ctx.lineWidth = 2
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          ctx.moveTo(dex1, dey1)
          ctx.lineTo(dex2, dey2)
          ctx.stroke()
          ctx.setLineDash([])

          ctx.fillStyle = draftColor
          ctx.beginPath()
          ctx.arc(x1, y1, 5, 0, 2 * Math.PI)
          ctx.fill()
          ctx.beginPath()
          ctx.arc(x2, y2, 5, 0, 2 * Math.PI)
          ctx.fill()

          ctx.font = 'bold 10px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = isSupplyDraft ? '#fef08a' : '#bae6fd'
          ctx.fillText(`📐 Wyckoff ${roleDraft} P1: ${p1.price.toLocaleString()}`, x1 + 8, y1 - 4)
          ctx.fillText(`📐 P2: ${p2.price.toLocaleString()} (${p2.price >= p1.price ? '+' : ''}${(p2.price - p1.price).toFixed(1)} pts)`, x2 + 8, y2 - 4)
        } else if (activeDrawingTool === 'RANGE') {
          const minX = Math.min(x1, p2.x)
          const maxX = Math.max(x1, p2.x)
          const topY = Math.min(y1, y2)
          const botY = Math.max(y1, y2)
          const boxW = Math.max(4, maxX - minX)
          const boxH = Math.max(4, botY - topY)

          ctx.fillStyle = 'rgba(168, 85, 247, 0.2)'
          ctx.fillRect(minX, topY, boxW, boxH)
          ctx.strokeStyle = '#c084fc'
          ctx.lineWidth = 2
          ctx.setLineDash([4, 4])
          ctx.strokeRect(minX, topY, boxW, boxH)
          ctx.setLineDash([])

          const highP = Math.max(p1.price, p2.price)
          const lowP = Math.min(p1.price, p2.price)
          ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = '#f3e8ff'
          ctx.fillText(`Range High: ${highP.toLocaleString()} (${Math.round(highP - lowP)} pts)`, minX + 6, topY - 4)
          ctx.fillText(`Range Low: ${lowP.toLocaleString()} (Click to lock)`, minX + 6, botY + 12)
        } else if (activeDrawingTool === 'FRVP') {
          const minX = Math.min(x1, x2)
          const maxX = Math.max(x1, x2)
          ctx.fillStyle = 'rgba(245, 158, 11, 0.15)'
          ctx.fillRect(minX, 0, Math.max(4, maxX - minX), paneH)
          ctx.strokeStyle = '#f59e0b'
          ctx.lineWidth = 1.5
          ctx.setLineDash([4, 4])
          ctx.strokeRect(minX, 0, Math.max(4, maxX - minX), paneH)
          ctx.setLineDash([])

          ctx.font = 'bold 10px ui-monospace, SFMono-Regular, monospace'
          ctx.fillStyle = '#fef3c7'
          ctx.fillText(`FRVP Start: ${formatEtTime(Math.min(p1.time, p2.time))}`, minX + 6, 24)
          ctx.fillText(`FRVP End: ${formatEtTime(Math.max(p1.time, p2.time))} (Click to compute)`, maxX + 6, 40)
        } else if (activeDrawingTool === 'MEASURE') {
          paintMeasureOverlay(p1, p2, undefined, true)
        }
      }
    }

    // 5. Candlestick Pattern Markers
    if (showCandlestickPatterns && list.length > 0) {
      const candleBars = list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }))

      const totalBars = candleBars.length
      const startIdx = Math.max(0, totalBars - 120)

      const activePocs = [
        yesterdayNyc?.poc,
        ydayProfile?.poc,
        overnightInventory?.overnight?.poc,
        overnightInventory?.asia?.poc,
        overnightInventory?.london?.poc,
        frvp5d?.poc,
      ].filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0)

      const importantLevels = [
        yesterdayNyc?.yh,
        yesterdayNyc?.yl,
        yesterdayNyc?.vah,
        yesterdayNyc?.val,
        ydayProfile?.vah,
        ydayProfile?.val,
        overnightInventory?.overnight?.high,
        overnightInventory?.overnight?.low,
        overnightInventory?.overnight?.vah,
        overnightInventory?.overnight?.val,
        overnightInventory?.asia?.high,
        overnightInventory?.asia?.low,
        overnightInventory?.asia?.vah,
        overnightInventory?.asia?.val,
        overnightInventory?.london?.high,
        overnightInventory?.london?.low,
        overnightInventory?.london?.vah,
        overnightInventory?.london?.val,
        frvp5d?.high,
        frvp5d?.low,
        frvp5d?.vah,
        frvp5d?.val,
        ...(frvp5d?.hvn || []),
        ...(frvp5d?.lvn || []),
      ].filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0)

      for (let i = startIdx; i < totalBars; i++) {
        const bar = candleBars[i]!
        const chartT = toChartTime(bar.time, tz)
        const x = timeToX(chart.timeScale(), chartT, candleTimes)
        const yHigh = series.priceToCoordinate(bar.high)
        const yLow = series.priceToCoordinate(bar.low)

        if (x == null || !Number.isFinite(x) || x < -30 || x > paneW + 30) continue

        const patterns = detectCandlestickPatterns(candleBars, i, 5, 0.05, {
          pocs: activePocs,
          importantLevels,
        })

        const badges: Array<{ text: string; bg: string; fg: string; pos: 'ABOVE' | 'BELOW' | 'MID' }> = []

        if (patterns.bullEng) badges.push({ text: '▲ Bull Engulfing', bg: 'rgba(16, 185, 129, 0.92)', fg: '#ffffff', pos: 'BELOW' })
        if (patterns.bearEng) badges.push({ text: '▼ Bear Engulfing', bg: 'rgba(239, 68, 68, 0.92)', fg: '#ffffff', pos: 'ABOVE' })
        if (patterns.buyingExcess) badges.push({ text: '▲ Excess Tail', bg: 'rgba(5, 150, 105, 0.95)', fg: '#ffffff', pos: 'BELOW' })
        if (patterns.sellingExcess) badges.push({ text: '▼ Excess Tail', bg: 'rgba(220, 38, 38, 0.95)', fg: '#ffffff', pos: 'ABOVE' })
        if (patterns.hammer) badges.push({ text: '▲ Hammer', bg: 'rgba(56, 189, 248, 0.92)', fg: '#0f172a', pos: 'BELOW' })
        if (patterns.invHammer) badges.push({ text: '▲ Inv Hammer', bg: 'rgba(20, 184, 166, 0.92)', fg: '#ffffff', pos: 'BELOW' })
        if (patterns.shootingStar) badges.push({ text: '▼ Shooting Star', bg: 'rgba(245, 158, 11, 0.92)', fg: '#0f172a', pos: 'ABOVE' })
        if (patterns.hangingMan) badges.push({ text: '▼ Hanging Man', bg: 'rgba(249, 115, 22, 0.92)', fg: '#ffffff', pos: 'ABOVE' })
        if (patterns.morningStar) badges.push({ text: '▲ Morning Star', bg: 'rgba(34, 197, 94, 0.92)', fg: '#ffffff', pos: 'BELOW' })
        if (patterns.eveningStar) badges.push({ text: '▼ Evening Star', bg: 'rgba(225, 29, 72, 0.92)', fg: '#ffffff', pos: 'ABOVE' })
        if (patterns.bullHarami) badges.push({ text: '▲ Bull Harami', bg: 'rgba(16, 185, 129, 0.85)', fg: '#ffffff', pos: 'BELOW' })
        if (patterns.bearHarami) badges.push({ text: '▼ Bear Harami', bg: 'rgba(239, 68, 68, 0.85)', fg: '#ffffff', pos: 'ABOVE' })
        if (patterns.bullKick) badges.push({ text: '▲ Bull Kicker', bg: 'rgba(16, 185, 129, 0.92)', fg: '#ffffff', pos: 'BELOW' })
        if (patterns.bearKick) badges.push({ text: '▼ Bear Kicker', bg: 'rgba(239, 68, 68, 0.92)', fg: '#ffffff', pos: 'ABOVE' })
        if (patterns.doji && badges.length === 0) badges.push({ text: '• Doji', bg: 'rgba(168, 85, 247, 0.85)', fg: '#ffffff', pos: 'MID' })

        ctx.font = 'bold 8.5px ui-monospace, SFMono-Regular, monospace'

        let aboveOffset = 14
        let belowOffset = 14

        for (const b of badges) {
          const textW = ctx.measureText(b.text).width
          const padX = 3
          const badgeW = textW + padX * 2
          const badgeH = 12

          const badgeX = x - badgeW / 2
          let badgeY = 0

          if (b.pos === 'ABOVE' && yHigh != null) {
            badgeY = yHigh - aboveOffset
            aboveOffset += 14
          } else if (b.pos === 'BELOW' && yLow != null) {
            badgeY = yLow + belowOffset
            belowOffset += 14
          } else if (yHigh != null && yLow != null) {
            badgeY = (yHigh + yLow) / 2 - badgeH / 2
          } else continue

          if (badgeY < 0 || badgeY > paneH) continue

          ctx.fillStyle = b.bg
          ctx.fillRect(badgeX, badgeY, badgeW, badgeH)
          ctx.fillStyle = b.fg
          ctx.fillText(b.text, badgeX + padX, badgeY + 9)
        }
      }
    }

    ctx.restore()
  }, [activeTrendlines, activeRangeBoxes, activeManualFrvps, activeMeasures, drawingDraft, activeDrawingTool, showCandlestickPatterns, hideTrendlineBadges, barSeconds, yesterdayNyc, ydayProfile, overnightInventory, frvp5d])

  useEffect(() => {
    paintUserDrawingsRef.current = paintUserDrawings
  }, [paintUserDrawings])

  useEffect(() => {
    paintUserDrawings()
  }, [paintUserDrawings])

  // ─── 5-Day Excesses & Rounded Numbers (Canvas) ──────────────────────────────
  const paintExcessesAndRounded = useCallback(() => {
    const canvas = excessesCanvasRef.current
    const chart = chartRef.current
    const series = candleRef.current
    const list = candlesRef.current
    if (!canvas || !chart || !series || !containerRef.current || list.length === 0) {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const paneW = containerRef.current.clientWidth
    const paneH = containerRef.current.clientHeight
    if (paneW < 10 || paneH < 10) return

    const dpr = window.devicePixelRatio || 1
    const targetW = Math.round(paneW * dpr)
    const targetH = Math.round(paneH * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
      canvas.style.width = `${paneW}px`
      canvas.style.height = `${paneH}px`
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, paneW, paneH)

    const tz = chartTzRef.current
    const daily = timeframe === '1D'
    const candleTimes =
      candleTimesRef.current.length === list.length
        ? candleTimesRef.current
        : list.map((c) => (daily ? (c.time as number) : toChartTime(c.time as number, tz)))
    const xAt = (unix: number) =>
      timeToX(
        chart.timeScale(),
        daily ? unix : toChartTime(unix, tz),
        candleTimes,
        daily
      )

    // 2. Draw Extremes (Precomputed from analytics cache — zero CPU waste on scroll)
    const sessionExtremes = sessionExtremesRef.current

    renderedSessionExtremesRef.current = []
    for (const ex of sessionExtremes) {
      const x = xAt(ex.time)
      const y = series.priceToCoordinate(ex.price)
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue
      if (x < -40 || x > paneW + 40 || y < 0 || y > paneH) continue

      const volStr =
        ex.volume >= 1000
          ? `${(ex.volume / 1000).toFixed(1)}k`
          : String(Math.round(ex.volume))
      const retestStr = ex.isRetested
        ? ex.retestVolumeRatio
          ? ` [Retest ${ex.retestVolumeRatio}x]`
          : ' [Retest]'
        : ''
      const labelText = `(${volStr})${retestStr}`

      renderedSessionExtremesRef.current.push({
        extreme: ex,
        x,
        y,
        session: ex.session,
        price: ex.price,
        type: ex.type,
        volume: ex.volume,
        volStr,
        isRetested: ex.isRetested,
        retestVolumeRatio: ex.retestVolumeRatio,
        bounds: {
          minX: x - 15,
          maxX: x + 115,
          minY: ex.type === 'HIGH' ? y - 18 : y - 4,
          maxY: ex.type === 'HIGH' ? y + 4 : y + 20,
        },
      })

      if (ex.type === 'HIGH') {
        // Downward rose triangle above high wick
        ctx.fillStyle = '#f43f5e'
        ctx.beginPath()
        ctx.moveTo(x - 5, y - 11)
        ctx.lineTo(x + 5, y - 11)
        ctx.lineTo(x, y - 4)
        ctx.closePath()
        ctx.fill()

        // Horizontal shelf extending to the end of the session
        const xEnd = ex.sessionEndTime != null
          ? (xAt(ex.sessionEndTime) ?? (x + 130))
          : (x + 130)
        const shelfRight = Math.min(paneW, Math.max(x + 50, xEnd))

        if (shelfRight > x + 6) {
          ctx.strokeStyle = ex.isRetested ? 'rgba(244, 63, 94, 0.4)' : 'rgba(244, 63, 94, 0.85)'
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(x, Math.round(y) + 0.5)
          ctx.lineTo(shelfRight, Math.round(y) + 0.5)
          ctx.stroke()
          ctx.setLineDash([])
        }

        // Volume & Retest label at session high (no high/low sentence)
        ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
        ctx.fillStyle = '#f43f5e'
        ctx.fillText(labelText, x + 6, y - 4)
      } else if (ex.type === 'LOW') {
        // Upward emerald triangle below low wick
        ctx.fillStyle = '#10b981'
        ctx.beginPath()
        ctx.moveTo(x - 5, y + 11)
        ctx.lineTo(x + 5, y + 11)
        ctx.lineTo(x, y + 4)
        ctx.closePath()
        ctx.fill()

        // Horizontal shelf extending to the end of the session
        const xEnd = ex.sessionEndTime != null
          ? (xAt(ex.sessionEndTime) ?? (x + 130))
          : (x + 130)
        const shelfRight = Math.min(paneW, Math.max(x + 50, xEnd))

        if (shelfRight > x + 6) {
          ctx.strokeStyle = ex.isRetested ? 'rgba(16, 185, 129, 0.4)' : 'rgba(16, 185, 129, 0.85)'
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(x, Math.round(y) + 0.5)
          ctx.lineTo(shelfRight, Math.round(y) + 0.5)
          ctx.stroke()
          ctx.setLineDash([])
        }

        // Volume & Retest label at session low (no high/low sentence)
        ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace'
        ctx.fillStyle = '#10b981'
        ctx.fillText(labelText, x + 6, y + 12)
      }
    }

    if (timeframe !== '1D') {
      // 3. Draw Late-Session Spikes (Precomputed from analytics cache)
      const spikes = spikesRef.current

      for (const sp of spikes) {
        const chartT = toChartTime(sp.startTime, tz)
        const xStart = timeToX(chart.timeScale(), chartT, candleTimes)
        if (xStart == null || !Number.isFinite(xStart)) continue
        const shelfW = Math.min(160, paneW - xStart)
        if (shelfW <= 10) continue

        const yH = series.priceToCoordinate(sp.spikeHigh)
        const yL = series.priceToCoordinate(sp.spikeLow)
        const yBase = series.priceToCoordinate(sp.spikeBase)

        ctx.setLineDash([4, 3])
        ctx.lineWidth = 1

        // Draw Spike Peak (High or Low)
        const peakY = sp.direction === 'UP' ? yH : yL
        if (peakY != null && Number.isFinite(peakY) && peakY >= 0 && peakY <= paneH) {
          ctx.strokeStyle = 'rgba(192, 132, 252, 0.85)' // Purple
          ctx.beginPath()
          ctx.moveTo(xStart, Math.round(peakY) + 0.5)
          ctx.lineTo(xStart + shelfW, Math.round(peakY) + 0.5)
          ctx.stroke()
        }

        // Draw Spike Base (acceptance reference)
        if (yBase != null && Number.isFinite(yBase) && yBase >= 0 && yBase <= paneH) {
          ctx.strokeStyle = 'rgba(236, 72, 153, 0.85)' // Pink/magenta
          ctx.beginPath()
          ctx.moveTo(xStart, Math.round(yBase) + 0.5)
          ctx.lineTo(xStart + shelfW, Math.round(yBase) + 0.5)
          ctx.stroke()
        }
        ctx.setLineDash([])
      }

      // 4. Draw Dalton Distribution Reference Points (Precomputed from analytics cache)
      const distRefs = distRefsRef.current

      for (const ref of distRefs) {
        const xStart = ref.startTime != null
          ? (timeToX(chart.timeScale(), toChartTime(ref.startTime, tz), candleTimes) ?? 0)
          : 0
        const xEnd = ref.endTime != null
          ? (timeToX(chart.timeScale(), toChartTime(ref.endTime, tz), candleTimes) ?? paneW)
          : paneW

        if (xEnd < -20 || xStart > paneW + 20) continue
        const lineLeft = Math.max(0, xStart)
        const lineRight = Math.min(paneW, Math.max(xStart + 60, xEnd))

        if (ref.dayType === 'DOUBLE_DISTRIBUTION' && ref.separationLevel != null) {
          const ySep = series.priceToCoordinate(ref.separationLevel)
          if (ySep != null && Number.isFinite(ySep) && ySep >= 0 && ySep <= paneH) {
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)' // Amber/Gold
            ctx.setLineDash([4, 4])
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.moveTo(lineLeft, Math.round(ySep) + 0.5)
            ctx.lineTo(lineRight, Math.round(ySep) + 0.5)
            ctx.stroke()
            ctx.setLineDash([])
          }
        } else if ((ref.dayType === 'TREND_BULL' || ref.dayType === 'TREND_BEAR') && ref.trendMidpoint != null) {
          const yMid = series.priceToCoordinate(ref.trendMidpoint)
          if (yMid != null && Number.isFinite(yMid) && yMid >= 0 && yMid <= paneH) {
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)' // Sky Blue
            ctx.setLineDash([5, 3])
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.moveTo(lineLeft, Math.round(yMid) + 0.5)
            ctx.lineTo(lineRight, Math.round(yMid) + 0.5)
            ctx.stroke()
            ctx.setLineDash([])
          }
        }
      }

      // 5. Draw Abnormal News Moves & Highlight Reaction Bars (2-3 bars) with Sentence Badges (Clean desk: only when toggled ON)
      if (showNewsOnChart) {
        const newsMoves = newsMovesRef.current
        const nowSec = Math.floor(Date.now() / 1000)

        for (const move of newsMoves) {
        const xStart = timeToX(chart.timeScale(), toChartTime(move.reactionStartTime, tz), candleTimes)
        if (xStart == null || !Number.isFinite(xStart) || xStart > paneW + 80) continue

        const xEnd = timeToX(chart.timeScale(), toChartTime(move.reactionEndTime, tz), candleTimes) ?? xStart
        if (Math.max(xStart, xEnd) < -80) continue

        const yH = series.priceToCoordinate(move.newsHigh)
        const yL = series.priceToCoordinate(move.newsLow)
        const yBase = series.priceToCoordinate(move.basePrice)
        if (yH == null || yL == null || !Number.isFinite(yH) || !Number.isFinite(yL)) continue

        // Measure candle width on current zoom level so the highlight encapsulates all reaction bars cleanly
        const barSpan = candleTimes.length >= 2
          ? Math.abs(
              (timeToX(chart.timeScale(), candleTimes[Math.min(candleTimes.length - 1, 1)]!, candleTimes) ?? 0) -
              (timeToX(chart.timeScale(), candleTimes[0]!, candleTimes) ?? 0)
            )
          : 12
        const halfBar = Math.max(4, Math.min(26, barSpan * 0.55))
        const minX = Math.min(xStart, xEnd) - halfBar
        const maxX = Math.max(xStart, xEnd) + halfBar
        const corridorW = Math.max(16, maxX - minX)

        const topY = Math.min(yH, yL) - 4
        const botY = Math.max(yH, yL) + 4
        const corridorH = Math.max(14, botY - topY)

        // Directional styling: Emerald for Bullish Drive, Rose for Bearish Flush, Purple for Whipsaw
        const isBull = move.direction === 'BULLISH_DRIVE'
        const isBear = move.direction === 'BEARISH_DRIVE'
        const themeColor = isBull ? '#10b981' : isBear ? '#f43f5e' : '#a855f7'
        const bgFill = isBull ? 'rgba(16, 185, 129, 0.14)' : isBear ? 'rgba(244, 63, 94, 0.14)' : 'rgba(168, 85, 247, 0.14)'
        const borderStroke = isBull ? 'rgba(16, 185, 129, 0.65)' : isBear ? 'rgba(244, 63, 94, 0.65)' : 'rgba(168, 85, 247, 0.65)'
        const textFill = isBull ? '#6ee7b7' : isBear ? '#fda4af' : '#e9d5ff'

        ctx.save()

        // ── A. Highlight the 2–3 Reaction Bars (Luminous column + dashed boundary)
        ctx.fillStyle = bgFill
        ctx.beginPath()
        if (typeof (ctx as any).roundRect === 'function') {
          (ctx as any).roundRect(minX, topY, corridorW, corridorH, 5)
        } else {
          ctx.rect(minX, topY, corridorW, corridorH)
        }
        ctx.fill()

        ctx.strokeStyle = borderStroke
        ctx.lineWidth = 1.3
        ctx.setLineDash([4, 3])
        ctx.stroke()
        ctx.setLineDash([])

        // News High Wick Bracket
        ctx.strokeStyle = themeColor
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(minX, Math.round(topY + 4) + 0.5)
        ctx.lineTo(maxX, Math.round(topY + 4) + 0.5)
        ctx.stroke()

        // News Low Wick Bracket
        ctx.beginPath()
        ctx.moveTo(minX, Math.round(botY - 4) + 0.5)
        ctx.lineTo(maxX, Math.round(botY - 4) + 0.5)
        ctx.stroke()

        // ── B. Small Sentence Badge Up To Those Bars
        if (!hideTrendlineBadges) {
          const sentence =
            move.headlineSentence ||
            `⚡ ${move.eventName} (${isBull ? '▲Surge' : isBear ? '▼Flush' : '±Whip'} ${move.moveRange.toFixed(1)}pts in ${move.barCount || 2} bars)`
          ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace'
          const metrics = ctx.measureText(sentence)
          const pillW = metrics.width + 16
          const pillH = 18

          // Position directly above the high of the reaction bars (clamped to pane top)
          const badgeY = Math.max(14, topY - pillH - 6)
          const badgeX = Math.max(6, Math.min(paneW - pillW - 6, (minX + maxX) * 0.5 - pillW * 0.5))

          // Dark slate pill background with colored border
          ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'
          ctx.beginPath()
          if (typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(badgeX, badgeY, pillW, pillH, 9)
          } else {
            ctx.rect(badgeX, badgeY, pillW, pillH)
          }
          ctx.fill()

          ctx.strokeStyle = borderStroke
          ctx.lineWidth = 1.2
          ctx.stroke()

          // Dotted connector from pill down to the candle wicks if there is gap
          if (topY - (badgeY + pillH) >= 4) {
            ctx.strokeStyle = borderStroke
            ctx.lineWidth = 1
            ctx.setLineDash([2, 2])
            ctx.beginPath()
            ctx.moveTo((minX + maxX) * 0.5, badgeY + pillH)
            ctx.lineTo((minX + maxX) * 0.5, topY + 2)
            ctx.stroke()
            ctx.setLineDash([])
          }

          // Sentence text
          ctx.fillStyle = textFill
          ctx.fillText(sentence, badgeX + 8, badgeY + 13)
        }

        // ── C. Active Reaction Shelf Lines (Only for current day / active setups)
        const isBroken = move.status === 'BROKEN_ABOVE' || move.status === 'BROKEN_BELOW'
        const isActive = !isBroken && nowSec - move.reactionEndTime <= 24 * 3600

        if (isActive) {
          const shelfRight = Math.min(paneW, Math.max(maxX + 80, maxX + 200))
          if (shelfRight > maxX + 10) {
            // News High Shelf
            ctx.strokeStyle = '#f43f5e'
            ctx.lineWidth = 1.3
            ctx.setLineDash([4, 3])
            ctx.beginPath()
            ctx.moveTo(maxX, Math.round(yH) + 0.5)
            ctx.lineTo(shelfRight, Math.round(yH) + 0.5)
            ctx.stroke()

            // News Low Shelf
            ctx.strokeStyle = '#10b981'
            ctx.beginPath()
            ctx.moveTo(maxX, Math.round(yL) + 0.5)
            ctx.lineTo(shelfRight, Math.round(yL) + 0.5)
            ctx.stroke()
            ctx.setLineDash([])

            // Pre-News Base Line
            if (yBase != null && Number.isFinite(yBase) && yBase >= 0 && yBase <= paneH) {
              ctx.strokeStyle = 'rgba(192, 132, 252, 0.5)'
              ctx.lineWidth = 1
              ctx.setLineDash([2, 2])
              ctx.beginPath()
              ctx.moveTo(maxX, Math.round(yBase) + 0.5)
              ctx.lineTo(maxX + 80, Math.round(yBase) + 0.5)
              ctx.stroke()
              ctx.setLineDash([])
            }
          }
        }

        // ── D. Tier-1 News-Anchored VWAP (AVWAP) with ±1σ Bands & Acceptance/Rejection Status
        if (
          move.avwapPoints &&
          move.avwapPoints.length >= 2 &&
          shouldAnchorVwapToNews(move) &&
          nowSec - move.reactionEndTime <= 48 * 3600
        ) {
          const vwapCoords: Array<{ x: number; y: number; yUp: number; yLow: number; time: number; vwap: number }> = []
          for (const pt of move.avwapPoints) {
            const px = xAt(pt.time)
            const py = series.priceToCoordinate(pt.vwap)
            const pyUp = series.priceToCoordinate(pt.upper1)
            const pyLow = series.priceToCoordinate(pt.lower1)
            if (px != null && py != null && Number.isFinite(px) && Number.isFinite(py)) {
              vwapCoords.push({
                x: px,
                y: py,
                yUp: pyUp != null && Number.isFinite(pyUp) ? pyUp : py,
                yLow: pyLow != null && Number.isFinite(pyLow) ? pyLow : py,
                time: pt.time,
                vwap: pt.vwap,
              })
            }
          }

          if (vwapCoords.length >= 2) {
            // Anchor Symbol ⚓ at the News Catalyst Candle
            ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            ctx.fillStyle = '#f59e0b'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText('⚓', vwapCoords[0]!.x, vwapCoords[0]!.y - 6)

            // ±1σ Standard Deviation Fill Band
            ctx.beginPath()
            ctx.moveTo(vwapCoords[0]!.x, vwapCoords[0]!.yUp)
            for (let i = 1; i < vwapCoords.length; i++) {
              ctx.lineTo(vwapCoords[i]!.x, vwapCoords[i]!.yUp)
            }
            for (let i = vwapCoords.length - 1; i >= 0; i--) {
              ctx.lineTo(vwapCoords[i]!.x, vwapCoords[i]!.yLow)
            }
            ctx.closePath()
            ctx.fillStyle = 'rgba(245, 158, 11, 0.05)'
            ctx.fill()

            // ±1σ Standard Deviation Dashed Envelope
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.40)'
            ctx.lineWidth = 1
            ctx.setLineDash([3, 3])
            ctx.beginPath()
            ctx.moveTo(vwapCoords[0]!.x, vwapCoords[0]!.yUp)
            for (let i = 1; i < vwapCoords.length; i++) {
              ctx.lineTo(vwapCoords[i]!.x, vwapCoords[i]!.yUp)
            }
            ctx.stroke()

            ctx.beginPath()
            ctx.moveTo(vwapCoords[0]!.x, vwapCoords[0]!.yLow)
            for (let i = 1; i < vwapCoords.length; i++) {
              ctx.lineTo(vwapCoords[i]!.x, vwapCoords[i]!.yLow)
            }
            ctx.stroke()
            ctx.setLineDash([])

            // Central News AVWAP Line (Warm Amber)
            ctx.strokeStyle = '#f59e0b'
            ctx.lineWidth = 1.8
            ctx.beginPath()
            ctx.moveTo(vwapCoords[0]!.x, vwapCoords[0]!.y)
            for (let i = 1; i < vwapCoords.length; i++) {
              ctx.lineTo(vwapCoords[i]!.x, vwapCoords[i]!.y)
            }
            ctx.stroke()

            // Real-Time Acceptance / Rejection Status Badge at the developing tip
            if (!hideTrendlineBadges) {
              const lastPt = vwapCoords[vwapCoords.length - 1]!
              const latestCandle = list[list.length - 1]
              const currentPrice = latestCandle ? latestCandle.close : lastPt.vwap
              const diff = currentPrice - lastPt.vwap
              const isBullAcceptance = diff >= 0
              const statusColor = isBullAcceptance ? '#10b981' : '#f43f5e'
              const statusText = isBullAcceptance
                ? `▲ Bull Acceptance (+${diff.toFixed(1)}pts)`
                : `▼ Bear Rejection (-${Math.abs(diff).toFixed(1)}pts)`

              const cleanEvent = move.eventName
                .replace(/\s*\([^)]*\)/g, '')
                .replace(/\s*m\/m|\s*y\/y|\s*q\/q/gi, '')
                .replace('Breaking News Volatility Spike', 'Spike')
                .trim()

              const statusBadgeText = `⚓ ${cleanEvent} AVWAP: ${lastPt.vwap.toFixed(1)} · ${statusText}`

              ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace'
              const m = ctx.measureText(statusBadgeText)
              const badgeW = m.width + 16
              const badgeH = 18

              let badgeX = lastPt.x + 8
              if (badgeX + badgeW > paneW - 8) {
                badgeX = Math.max(8, lastPt.x - badgeW - 8)
              }
              const badgeY = Math.max(12, Math.min(paneH - 24, lastPt.y - badgeH * 0.5))

              ctx.fillStyle = 'rgba(15, 23, 42, 0.94)'
              ctx.beginPath()
              if (typeof (ctx as any).roundRect === 'function') {
                (ctx as any).roundRect(badgeX, badgeY, badgeW, badgeH, 6)
              } else {
                ctx.rect(badgeX, badgeY, badgeW, badgeH)
              }
              ctx.fill()

              ctx.strokeStyle = statusColor
              ctx.lineWidth = 1.2
              ctx.stroke()

              ctx.fillStyle = '#f8fafc'
              ctx.textAlign = 'left'
              ctx.textBaseline = 'middle'
              ctx.fillText(statusBadgeText, badgeX + 8, badgeY + badgeH * 0.5)

              // Glowing indicator dot at terminal AVWAP coordinate
              ctx.fillStyle = statusColor
              ctx.beginPath()
              ctx.arc(lastPt.x, lastPt.y, 3, 0, Math.PI * 2)
              ctx.fill()
            }
          }
        }

        ctx.restore()
      }
    }
  }

    ctx.restore()
  }, [instrument, frvp5d, newsEvents, timeframe, hideTrendlineBadges, showNewsOnChart])

  useEffect(() => {
    paintExcessesAndRoundedRef.current = paintExcessesAndRounded
  }, [paintExcessesAndRounded])

  useEffect(() => {
    paintExcessesAndRounded()
  }, [paintExcessesAndRounded])

  // ─── Economic News Markers on Time Axis ─────────────────────────────────────
  const paintNewsMarkers = useCallback(() => {
    const host = newsMarkersOverlayRef.current
    const chart = chartRef.current
    const list = candlesRef.current
    if (!host || !chart || !containerRef.current || list.length === 0 || timeframe === '1D' || !showNewsOnChart) {
      if (host) host.innerHTML = ''
      return
    }

    const paneW = containerRef.current.clientWidth
    const tz = chartTzRef.current
    const candleTimes =
      candleTimesRef.current.length === list.length
        ? candleTimesRef.current
        : list.map((c) => toChartTime(c.time as number, tz))
    const nowMs = Date.now()

    const firstCandleSec = (list[0]!.time as number) - 3600
    const lastCandleSec = (list[list.length - 1]!.time as number) + 48 * 3600

    const visibleItems: Array<{ event: DeskCalendarEvent; x: number }> = []
    const seenX = new Set<number>()

    for (const e of newsEvents) {
      const ms = parseCalendarEventMs(e.time, nowMs)
      if (!ms || !Number.isFinite(ms)) continue

      const sec = Math.floor(ms / 1000)
      if (sec < firstCandleSec || sec > lastCandleSec) continue

      const chartT = toChartTime(sec, tz)
      const x = timeToX(chart.timeScale(), chartT, candleTimes, false, barSeconds)
      if (x != null && Number.isFinite(x) && x >= 12 && x <= paneW - 14) {
        const rx = Math.round(x)
        if (!seenX.has(rx)) {
          seenX.add(rx)
          visibleItems.push({ event: e, x: rx })
        }
      }
    }

    // Fallback: If no calendar events match visible range, plot detected emotional news moves
    if (visibleItems.length === 0 && newsMovesRef.current && newsMovesRef.current.length > 0) {
      for (const m of newsMovesRef.current) {
        const sec = m.reactionStartTime
        const chartT = toChartTime(sec, tz)
        const x = timeToX(chart.timeScale(), chartT, candleTimes, false, barSeconds)
        if (x != null && Number.isFinite(x) && x >= 12 && x <= paneW - 14) {
          const rx = Math.round(x)
          if (!seenX.has(rx)) {
            seenX.add(rx)
            const fallbackEv: DeskCalendarEvent = {
              id: `move-${sec}-${m.eventName}`,
              time: new Date(sec * 1000).toISOString(),
              country: m.country || 'US',
              event: m.eventName,
              impact: m.impact || 'High',
              instruments: [instrument],
              isReleased: true,
              deskNote: `${m.eventName} · Volatility active`,
            }
            visibleItems.push({ event: fallbackEv, x: rx })
          }
        }
      }
    }

    while (host.childElementCount < visibleItems.length) {
      const el = document.createElement('div')
      el.className = 'pointer-events-auto absolute cursor-pointer select-none'
      host.appendChild(el)
    }
    while (host.childElementCount > visibleItems.length) {
      host.removeChild(host.lastElementChild!)
    }

    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i]!
      const el = host.children[i] as HTMLElement
      el.style.position = 'absolute'
      el.style.left = `${item.x - 11}px`
      el.style.bottom = '3px'
      el.style.zIndex = '25'
      el.onclick = (ev) => {
        ev.stopPropagation()
        const rect = el.getBoundingClientRect()
        const frameRect = chartFrameRef.current?.getBoundingClientRect()
        const px = frameRect ? rect.left - frameRect.left + 11 : item.x
        const py = frameRect ? rect.top - frameRect.top - 10 : 300
        setActiveNewsTooltip((prev) => (prev?.event.id === item.event.id ? null : { event: item.event, x: px, y: py }))
      }
      el.onmouseenter = () => {
        const rect = el.getBoundingClientRect()
        const frameRect = chartFrameRef.current?.getBoundingClientRect()
        const px = frameRect ? rect.left - frameRect.left + 11 : item.x
        const py = frameRect ? rect.top - frameRect.top - 10 : 300
        setActiveNewsTooltip({ event: item.event, x: px, y: py })
      }

      const itemMs = parseCalendarEventMs(item.event.time, nowMs) ?? 0
      const isPast = itemMs <= nowMs
      const isReleased = !!(
        item.event.isReleased ||
        (item.event.actual != null && String(item.event.actual).trim() !== '' && String(item.event.actual).trim().toLowerCase() !== 'null')
      )
      const isHigh = item.event.impact?.toLowerCase().includes('high')
      const bg = isReleased
        ? (isHigh ? '#059669' : '#0284c7')
        : (isHigh ? '#7c3aed' : '#6d28d9')

      const statusTag = isReleased ? '🎯 RELEASED' : isPast ? '⌛ RECENT' : '⏳ UPCOMING'
      const actualStr = item.event.actual != null ? ` | Act: ${item.event.actual}` : ''
      const estStr = item.event.estimate != null ? ` | Exp: ${item.event.estimate}` : ''
      const prevStr = item.event.prev != null ? ` | Prev: ${item.event.prev}` : ''
      const tooltip = `${statusTag}: ${item.event.event} (${item.event.country}) - ${(item.event.impact || 'MEDIUM').toUpperCase()}${actualStr}${estStr}${prevStr}`

      el.innerHTML = `
        <div style="
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: ${bg};
          border: 1.5px solid rgba(255, 255, 255, 0.9);
          box-shadow: 0 2px 6px rgba(0,0,0,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-size: 11px;
          line-height: 1;
        " title="${tooltip}">
          ⚡
        </div>
      `
    }
  }, [newsEvents, timeframe, showNewsOnChart, barSeconds, instrument])

  useEffect(() => {
    paintNewsMarkersRef.current = paintNewsMarkers
  }, [paintNewsMarkers])

  useEffect(() => {
    paintNewsMarkers()
    const timer = setInterval(() => {
      paintNewsMarkers()
    }, 10_000)
    return () => clearInterval(timer)
  }, [paintNewsMarkers])

  // Poll high/medium impact calendar news events for the bottom time axis markers
  useEffect(() => {
    let cancelled = false
    let timerId: number | null = null

    const schedule = (ms: number) => {
      if (cancelled) return
      if (timerId != null) window.clearTimeout(timerId)
      timerId = window.setTimeout(() => void loadNews(), ms)
    }

    const loadNews = async () => {
      try {
        const res = await fetch(
          `/api/trading/desk-news?window=120&desk=${encodeURIComponent(instrument)}&session=0&calendarOnly=1&_=${Date.now()}`,
          { cache: 'no-store' }
        )
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean
          calendar?: DeskCalendarEvent[]
        } | null
        if (!cancelled && json?.ok && Array.isArray(json.calendar)) {
          setNewsEvents(json.calendar)
          const hasRecent = json.calendar.some((e) => {
            if (!e.impact?.toLowerCase().includes('high')) return false
            const ms = Date.parse(e.time)
            return !Number.isNaN(ms) && Math.abs(ms - Date.now()) <= 30 * 60 * 1000
          })
          schedule(hasRecent ? 15_000 : 60_000)
        } else {
          schedule(60_000)
        }
      } catch {
        schedule(60_000)
      }
    }
    void loadNews()
    return () => {
      cancelled = true
      if (timerId != null) window.clearTimeout(timerId)
    }
  }, [instrument])

  const canonicalIntradayBarsRef = useRef<OHLCV[] | null>(null)
  const [dayTypeOverride, setDayTypeOverride] = useState<DayTypeEvaluation | null>(null)

  useEffect(() => {
    setDayTypeOverride(null)
    canonicalIntradayBarsRef.current = null
  }, [instrument])

  if (timeframe !== '1D' && candles && candles.length > 0) {
    canonicalIntradayBarsRef.current = candles
  }

  const dayTypeEval: DayTypeEvaluation = useMemo(() => {
    const list =
      timeframe === '1D' && canonicalIntradayBarsRef.current && canonicalIntradayBarsRef.current.length > 0
        ? canonicalIntradayBarsRef.current
        : candles || []
    if (!list.length) {
      return {
        type: 'WAITING',
        badgeText: 'WAIT',
        title: 'Evaluating Auction',
        description: 'Waiting for cash session bars to evaluate day structure.',
      }
    }
    return classifyMarketDayType({
      todayBars: list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      instrument,
      ydayVah: yesterdayNyc?.vah ?? ydayProfile?.vah,
      ydayVal: yesterdayNyc?.val ?? ydayProfile?.val,
      overnightInventory,
      controlLabel: controlBadge,
      overrideDayType: dayTypeOverride,
    })
  }, [candles, timeframe, instrument, yesterdayNyc, ydayProfile, overnightInventory, controlBadge, dayTypeOverride])

  const emotionalNewsMoves: EmotionalNewsMove[] = useMemo(() => {
    const list = candles || []
    if (!list.length || timeframe === '1D') return []
    return detectEmotionalNewsMoves(
      list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      newsEvents,
      instrument,
      undefined,
      undefined,
      true
    )
  }, [candles, newsEvents, instrument, timeframe])

  // ── Leo AI Desk Assistant Live State & Telemetry Context ──────────────────
  const [leoPanelOpen, setLeoPanelOpen] = useState(false)
  const [leoExternalPoints, setLeoExternalPoints] = useState<LeoDataPoint[]>([])
  const [leoAutoPrompt, setLeoAutoPrompt] = useState<string | null>(null)
  const [showQuestioningModal, setShowQuestioningModal] = useState(false)

  // ── Auction Price Critique & "Questioning" Engine Evaluation ───────────────
  const [critiqueStartOption, setCritiqueStartOption] = useState<CritiqueSessionStart>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('trading_critique_start_time')
      if (saved === '09:15' || saved === '09:00') return saved
    }
    return '09:00'
  })
  const critiqueStartOptionRef = useRef<CritiqueSessionStart>(critiqueStartOption)
  useEffect(() => {
    critiqueStartOptionRef.current = critiqueStartOption
  }, [critiqueStartOption])

  const [isCritiqueSessionActiveState, setIsCritiqueSessionActiveState] = useState<boolean>(() =>
    isPriceQuestioningSessionActive(Date.now(), critiqueStartOption)
  )

  useEffect(() => {
    const checkActive = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      const active = isPriceQuestioningSessionActive(Date.now(), critiqueStartOptionRef.current)
      setIsCritiqueSessionActiveState(active)
      if (!active) {
        setShowQuestioningModal(false)
      }
    }
    checkActive()
    const id = setInterval(checkActive, 5000)
    return () => clearInterval(id)
  }, [critiqueStartOption])

  const livePriceCritique = useMemo<PriceCritiqueEvaluation | null>(() => {
    if (!isCritiqueSessionActiveState) return null
    const list = candles || []
    const lastBar = list.length ? list[list.length - 1] : null
    const curPrice = livePrice ?? lastBar?.close ?? null
    if (curPrice == null) return null
    const now = new Date()
    const nowEtStr =
      now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + ' ET'

    return evaluatePriceQuestioning({
      currentPrice: curPrice,
      instrument,
      currentTimeEt: nowEtStr,
      now: now.getTime(),
      sessionStart: critiqueStartOption,
      yesterday: yesterdayNyc
        ? {
            poc: yesterdayNyc.poc,
            high: yesterdayNyc.yh,
            low: yesterdayNyc.yl,
            vah: yesterdayNyc.vah,
            val: yesterdayNyc.val,
          }
        : null,
      overnight: overnightInventory
        ? {
            overnight: {
              poc: overnightInventory.overnight?.poc,
              high: overnightInventory.overnight?.high,
              low: overnightInventory.overnight?.low,
            },
            asia: {
              poc: overnightInventory.asia?.poc,
              high: overnightInventory.asia?.high,
              low: overnightInventory.asia?.low,
            },
            london: {
              poc: overnightInventory.london?.poc,
              high: overnightInventory.london?.high,
              low: overnightInventory.london?.low,
            },
            biasLabel: overnightInventory.biasLabel,
            pctLong: overnightInventory.pctLong,
            pctShort: overnightInventory.pctShort,
          }
        : null,
      frvp5d: frvp5d
        ? {
            poc: frvp5d.poc,
            vah: frvp5d.vah,
            val: frvp5d.val,
            high: frvp5d.high,
            low: frvp5d.low,
          }
        : null,
      avwap5m: avwap5mBenchmark
        ? {
            vwap: avwap5mBenchmark.vwap,
            sigma1Upper: avwap5mBenchmark.sigma1Upper,
            sigma1Lower: avwap5mBenchmark.sigma1Lower,
            sigma2Upper: avwap5mBenchmark.sigma2Upper,
            sigma2Lower: avwap5mBenchmark.sigma2Lower,
          }
        : null,
      orderFlow: sessionOrderFlow
        ? {
            sessionCvd: sessionOrderFlow.sessionCvd,
            trend: sessionOrderFlow.trend,
            divergence: sessionOrderFlow.divergence,
          }
        : null,
      lastCandle: lastBar
        ? {
            open: lastBar.open,
            high: lastBar.high,
            low: lastBar.low,
            close: lastBar.close,
            volume: lastBar.volume,
            isBullish: lastBar.close >= lastBar.open,
          }
        : null,
    })
  }, [
    livePrice,
    candles,
    instrument,
    yesterdayNyc,
    overnightInventory,
    frvp5d,
    avwap5mBenchmark,
    sessionOrderFlow,
    isCritiqueSessionActiveState,
    critiqueStartOption,
  ])

  const leoContext: LeoChatContext = useMemo(() => {
    const list = candles || []
    const lastBar = list.length ? list[list.length - 1] : null
    const curPrice = livePrice ?? lastBar?.close ?? null
    const now = new Date()
    const nowEtStr =
      now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + ' ET'

    // NY Session calculation
    const nyDateStr = now.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    const nyTimeParts = now.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).split(':').map(Number)
    const nyDec = (nyTimeParts[0] || 0) + (nyTimeParts[1] || 0) / 60

    let sessionName = 'Pre-market / Overnight'
    let sessionPhase = 'Overnight Flow'
    let sessionElapsedMinutes = 0
    let nextCheckpoint = '09:30 ET NYC Cash Open'

    if (nyDec >= 9.5 && nyDec < 16) {
      sessionName = 'NYC Cash Session (RTH)'
      sessionElapsedMinutes = Math.floor((nyDec - 9.5) * 60)
      if (nyDec < 10.5) {
        sessionPhase = 'Initial Balance (IB)'
        nextCheckpoint = `${Math.floor((10.5 - nyDec) * 60)}m to IB Close (10:30 ET)`
      } else if (nyDec < 12) {
        sessionPhase = 'Morning Trend / Extension'
        nextCheckpoint = `${Math.floor((12 - nyDec) * 60)}m to NY Lunch (12:00 ET)`
      } else if (nyDec < 13.5) {
        sessionPhase = 'NY Lunch Window (Chop Caution)'
        nextCheckpoint = `${Math.floor((13.5 - nyDec) * 60)}m to Afternoon Session (13:30 ET)`
      } else if (nyDec < 15.5) {
        sessionPhase = 'Afternoon Trend / Rebalance'
        nextCheckpoint = `${Math.floor((15.5 - nyDec) * 60)}m to Cash Close MOC (16:00 ET)`
      } else {
        sessionPhase = 'Market On Close (MOC)'
        nextCheckpoint = `${Math.floor((16 - nyDec) * 60)}m to Cash Settlement`
      }
    } else if (nyDec >= 18 || nyDec < 2) {
      sessionName = 'Asia Session'
      sessionPhase = 'Tokyo / Hong Kong Cash Open'
      sessionElapsedMinutes = nyDec >= 18 ? Math.floor((nyDec - 18) * 60) : Math.floor((nyDec + 6) * 60)
      nextCheckpoint = '03:00 ET London Open'
    } else if (nyDec >= 3 && nyDec < 9.5) {
      sessionName = 'London Session'
      sessionPhase = 'European Cash Session'
      sessionElapsedMinutes = Math.floor((nyDec - 3) * 60)
      nextCheckpoint = `${Math.floor((9.5 - nyDec) * 60)}m to NYC Cash Open (09:30 ET)`
    } else if (nyDec >= 16 && nyDec < 18) {
      sessionName = 'Post-Close Settlement'
      sessionPhase = 'Futures Maintenance'
      nextCheckpoint = '18:00 ET Globex / Asia Open'
    }

    const ymdToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const isHoliday = isUsMarketHoliday(ymdToday)

    // Active position telemetry
    let activePos: LeoActivePosition | null = null
    if (positionOverlay) {
      const entryTimeMs = positionOverlay.entryTimestamp
        ? new Date(positionOverlay.entryTimestamp).getTime()
        : Date.now()
      const durationMin = Math.max(0, (Date.now() - entryTimeMs) / 60000)
      const dir = (positionOverlay.direction || 'long').toUpperCase() as 'LONG' | 'SHORT'
      const entryPx = positionOverlay.entryPrice
      const pnlPts =
        curPrice != null
          ? dir === 'LONG'
            ? curPrice - entryPx
            : entryPx - curPrice
          : 0
      const size = positionOverlay.positionSize ?? 1
      const multiplier = instrument === 'NASDAQ' ? 2 : instrument === 'DOW' ? 5 : 1
      const pnlCad = pnlPts * size * multiplier

      activePos = {
        positionId: positionOverlay.positionId ?? 'active-pos',
        instrument,
        direction: dir,
        entryPrice: entryPx,
        positionSize: size,
        stopLoss: positionOverlay.stopLoss ?? 0,
        profitTarget: positionOverlay.profitTarget ?? 0,
        entryTimestamp: positionOverlay.entryTimestamp ?? entryTimeMs,
        durationMinutes: durationMin,
        unrealizedPnlPoints: Number(pnlPts.toFixed(1)),
        unrealizedPnlCad: Number(pnlCad.toFixed(2)),
        isInProfit: pnlPts > 0,
      }
    }

    // Order Flow & CVD Telemetry for active session
    let orderFlowContext: LeoChatContext['orderFlow'] = null
    const flow = sessionOrderFlow
    if (flow) {
      orderFlowContext = {
        sessionCvd: flow.sessionCvd,
        latestBarDelta: flow.latestBarDelta,
        latestBuyVolume: flow.latestBuyVolume,
        latestSellVolume: flow.latestSellVolume,
        latestBuyRatio: flow.latestBuyRatio,
        trend: flow.trend,
        divergence: flow.divergence,
        description: flow.description,
      }
    }

    // User Range Boxes with full volume profiling
    const computedRanges = activeRangeBoxes.map((r) => {
      const m = computeRangeMetrics(r.p1, r.p2, curPrice, candles)
      return {
        id: r.id,
        label: r.label,
        priceHigh: m.priceHigh,
        priceLow: m.priceLow,
        midPrice: m.midPrice,
        heightPts: m.heightPts,
        startTimeEt: formatEtTime(m.timeStart),
        endTimeEt: formatEtTime(m.timeEnd),
        durationMin: m.durationMin,
        positionPct: m.positionPct,
        priceRelation: m.priceRelation,
        totalVolume: m.totalVolume,
        volumeRatePerMin: m.volumeRatePerMin,
        buyVolume: m.buyVolume,
        sellVolume: m.sellVolume,
        delta: m.delta,
        buyRatioPct: m.buyRatioPct,
        poc: m.poc,
      }
    })

    return {
      instrument,
      currentPrice: curPrice,
      currentTimeEt: nowEtStr,
      dayType: isNycSessionActive()
        ? (dayTypeEval?.badgeText ?? null)
        : (dayTypeEval?.badgeText ? `${dayTypeEval.badgeText} (FINAL / SESSION CLOSED)` : 'Session Closed (Final Day Type)'),
      openingType: isNycSessionActive()
        ? (openingBadge ?? null)
        : (openingBadge ? `${openingBadge} (FINAL / COMPLETED)` : 'Session Closed'),
      sessionDetails: {
        sessionName,
        sessionPhase,
        sessionElapsedMinutes,
        timeToNextCheckpoint: nextCheckpoint,
        candleTimeframe: '5m',
        barCountdown: barCountdown || undefined,
        calendarDate: nyDateStr,
        isHoliday,
        holidayName: isHoliday ? 'US Exchange Holiday' : undefined,
      },
      activePosition: activePos,
      orderFlow: orderFlowContext,
      longTermMoney: avwap5mBenchmark
        ? {
            avwap5m: avwap5mBenchmark.vwap,
            sigma1Upper: avwap5mBenchmark.sigma1Upper,
            sigma1Lower: avwap5mBenchmark.sigma1Lower,
            sigma2Upper: avwap5mBenchmark.sigma2Upper,
            sigma2Lower: avwap5mBenchmark.sigma2Lower,
            distancePts:
              curPrice != null ? Number((curPrice - avwap5mBenchmark.vwap).toFixed(1)) : null,
          }
        : null,
      intermediateMoney: frvp5d
        ? {
            poc5d: frvp5d.poc,
            vah5d: frvp5d.vah,
            val5d: frvp5d.val,
            high5d: frvp5d.high,
            low5d: frvp5d.low,
            distancePts: curPrice != null ? Number((curPrice - frvp5d.poc).toFixed(1)) : null,
          }
        : null,
      shortTermMoney: yesterdayNyc
        ? {
            sessionDate: yesterdayNyc.sessionDate,
            ypoc: yesterdayNyc.poc,
            yhigh: yesterdayNyc.yh,
            ylow: yesterdayNyc.yl,
            yvah: yesterdayNyc.vah,
            yval: yesterdayNyc.val,
            onpoc: overnightInventory?.overnight?.poc ?? null,
            onhigh: overnightInventory?.overnight?.high ?? null,
            onlow: overnightInventory?.overnight?.low ?? null,
            overnightBias: overnightInventory?.biasLabel ?? null,
            distanceYpocPts:
              curPrice != null ? Number((curPrice - yesterdayNyc.poc).toFixed(1)) : null,
            distanceOnpocPts:
              curPrice != null && overnightInventory?.overnight?.poc != null
                ? Number((curPrice - overnightInventory.overnight.poc).toFixed(1))
                : null,
          }
        : null,
      activeExcesses: (renderedSessionExtremesRef.current || []).map((r) => ({
        type: r.type === 'HIGH' ? 'SELLING_EXCESS' : 'BUYING_EXCESS',
        price: r.price,
        session: r.session,
        volumeStr: r.volStr,
        retestRatio: r.retestVolumeRatio,
        isRetested: r.isRetested,
      })),
      userDrawings: {
        trendlines: activeTrendlines.map((t) => {
          const nowSec = Math.floor(Date.now() / 1000)
          const m = computeTrendlineMetrics(t.p1, t.p2, curPrice, nowSec)
          const isLongSetup = t.isReactionTrendline ? t.p2.price >= t.p1.price : t.p2.price < t.p1.price
          const setupDir: 'LONG' | 'SHORT' = isLongSetup ? 'LONG' : 'SHORT'
          const tlMockChartCtx: any = {
            yesterday: yesterdayNyc ? { poc: yesterdayNyc.poc, high: yesterdayNyc.yh, low: yesterdayNyc.yl, vah: yesterdayNyc.vah, val: yesterdayNyc.val } : null,
            overnight: overnightInventory ? {
              overnight: { poc: overnightInventory.overnight?.poc, high: overnightInventory.overnight?.high, low: overnightInventory.overnight?.low },
              asia: { poc: overnightInventory.asia?.poc, high: overnightInventory.asia?.high, low: overnightInventory.asia?.low },
              london: { poc: overnightInventory.london?.poc, high: overnightInventory.london?.high, low: overnightInventory.london?.low },
            } : null,
            frvp5d: frvp5d ? { poc: frvp5d.poc, vah: frvp5d.vah, val: frvp5d.val, high: frvp5d.high, low: frvp5d.low } : null,
            avwap5m: avwap5mBenchmark ? {
              vwap: avwap5mBenchmark.vwap,
              sigma1Upper: avwap5mBenchmark.sigma1Upper,
              sigma1Lower: avwap5mBenchmark.sigma1Lower,
              sigma2Upper: avwap5mBenchmark.sigma2Upper,
              sigma2Lower: avwap5mBenchmark.sigma2Lower,
            } : null,
          }
          const basePx = curPrice ?? t.p2.price
          const runway = evaluateHorizontalRunway({
            entryPrice: basePx,
            stopLossPrice: setupDir === 'LONG' ? basePx - 10 : basePx + 10,
            direction: setupDir,
            chartContext: tlMockChartCtx,
          })
          const speedlines = calculateEmpiricalSpeedlines({
            origin: t.p1,
            breakout: t.p2,
            currentPrice: basePx,
            currentTime: nowSec,
            direction: setupDir,
          })

          return {
            id: t.id,
            label: t.label,
            startPrice: t.p1.price,
            endPrice: t.p2.price,
            startTimeEt: formatEtTime(t.p1.time),
            endTimeEt: formatEtTime(t.p2.time),
            slopePtsPerMin: m.slopePtsPerMin,
            slopePtsPer5mBar: m.slopePtsPer5mBar,
            slopeDirection: m.direction,
            projectedPrice: m.projectedPrice,
            distancePts: m.distancePts,
            priceRelation: m.priceRelation,
            direction: t.direction,
            sessionOrigin: t.sessionOrigin,
            isCarriedFromOvernight: t.isCarriedFromOvernight,
            breakCountOvernight: t.breakCountOvernight,
            isActionTrendline: t.isActionTrendline,
            isReactionTrendline: t.isReactionTrendline,
            actionBreakoutConfirmed: t.actionBreakoutConfirmed,
            isInitialOvernight: t.isInitialOvernight,
            p1: t.p1,
            p2: t.p2,
            horizontalRunway: {
              runwayPts: runway.runwayPts,
              runwayRatio: runway.runwayRatio,
              quality: runway.quality,
              nearestTargetLabel: runway.nearestResistance?.label,
              nearestTargetPrice: runway.nearestResistance?.price,
              summary: runway.summary,
            },
            empiricalVelocity: {
              baseVelocityPtsPer5m: speedlines.baseVelocityPtsPer5m,
              velocityState: speedlines.currentVelocityState,
              equilibriumPrice: speedlines.projectedEquilibriumPrice,
              climaxPrice: speedlines.projectedClimaxPrice,
              retestFloorPrice: speedlines.projectedRetestFloorPrice,
              summary: speedlines.summary,
            },
          }
        }),
        ranges: computedRanges,
        frvps: activeManualFrvps.map((f) => {
          let priceRel: 'AT_POC' | 'INSIDE_VALUE' | 'ABOVE_VAH' | 'BELOW_VAL' = 'INSIDE_VALUE'
          let distPoc: number | null = null
          if (curPrice != null) {
            distPoc = Number((curPrice - f.poc).toFixed(2))
            if (Math.abs(distPoc) <= 3) {
              priceRel = 'AT_POC'
            } else if (curPrice > f.vah) {
              priceRel = 'ABOVE_VAH'
            } else if (curPrice < f.val) {
              priceRel = 'BELOW_VAL'
            } else {
              priceRel = 'INSIDE_VALUE'
            }
          }
          const totalV = f.totalVolume || 1
          const buyPct = Math.round(((f.buyVolume || 0) / totalV) * 100)
          return {
            id: f.id,
            label: f.label,
            startTimeEt: formatEtTime(f.timeStart),
            endTimeEt: formatEtTime(f.timeEnd),
            poc: f.poc,
            vah: f.vah,
            val: f.val,
            high: f.high,
            low: f.low,
            totalVolume: f.totalVolume,
            buyRatioPct: buyPct,
            distancePocPts: distPoc,
            priceRelation: priceRel,
          }
        }),
      },
      candlestickPatterns: candles.length > 0 ? {
        activePatterns: (() => {
          const bars = rawBarsRef.current.length === candles.length ? rawBarsRef.current : candles.map((c) => ({
            time: c.time as number,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          }))
          const active: Array<{
            pattern: string
            type: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
            candleTimeEt: string
            candlePrice: number
            barIndex: number
          }> = []
          const activePocs = [
            yesterdayNyc?.poc,
            ydayProfile?.poc,
            overnightInventory?.overnight?.poc,
            overnightInventory?.asia?.poc,
            overnightInventory?.london?.poc,
            frvp5d?.poc,
          ].filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0)
          const importantLevels = [
            yesterdayNyc?.yh,
            yesterdayNyc?.yl,
            yesterdayNyc?.vah,
            yesterdayNyc?.val,
            ydayProfile?.vah,
            ydayProfile?.val,
            overnightInventory?.overnight?.high,
            overnightInventory?.overnight?.low,
            overnightInventory?.overnight?.vah,
            overnightInventory?.overnight?.val,
            overnightInventory?.asia?.high,
            overnightInventory?.asia?.low,
            overnightInventory?.asia?.vah,
            overnightInventory?.asia?.val,
            overnightInventory?.london?.high,
            overnightInventory?.london?.low,
            overnightInventory?.london?.vah,
            overnightInventory?.london?.val,
            frvp5d?.high,
            frvp5d?.low,
            frvp5d?.vah,
            frvp5d?.val,
            ...(frvp5d?.hvn || []),
            ...(frvp5d?.lvn || []),
          ].filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0)
          const startIdx = Math.max(0, bars.length - 60)
          for (let i = startIdx; i < bars.length; i++) {
            const res = detectCandlestickPatterns(bars, i, 5, 0.05, {
              pocs: activePocs,
              importantLevels,
            })
            const bar = bars[i]!
            const timeEt = formatEtTime(bar.time)
            if (res.bullEng) active.push({ pattern: 'Bullish Engulfing', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.bearEng) active.push({ pattern: 'Bearish Engulfing', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.hammer) active.push({ pattern: 'Hammer', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.invHammer) active.push({ pattern: 'Inverted Hammer', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.shootingStar) active.push({ pattern: 'Shooting Star', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.hangingMan) active.push({ pattern: 'Hanging Man', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.morningStar) active.push({ pattern: 'Morning Star', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.eveningStar) active.push({ pattern: 'Evening Star', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.bullHarami) active.push({ pattern: 'Bullish Harami', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.bearHarami) active.push({ pattern: 'Bearish Harami', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.bullKick) active.push({ pattern: 'Bullish Kicker', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.bearKick) active.push({ pattern: 'Bearish Kicker', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
            if (res.buyingExcess) active.push({ pattern: 'Buying Excess Tail', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: bar.low, barIndex: i })
            if (res.sellingExcess) active.push({ pattern: 'Selling Excess Tail', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: bar.high, barIndex: i })
            if (res.doji && active.every(a => a.barIndex !== i)) active.push({ pattern: 'Doji', type: 'NEUTRAL', candleTimeEt: timeEt, candlePrice: bar.close, barIndex: i })
          }
          return active
        })()
      } : undefined,
      longTermMemories: memories.map((m) => ({
        id: m.id,
        instrument: m.instrument,
        timeframe: m.timeframe,
        priceLow: m.priceLow,
        priceHigh: m.priceHigh,
        purpose: m.purpose,
        notes: m.notes,
        status: m.status,
        lastTriggeredAt: m.lastTriggeredAt,
      })),
      recentCandles: (candles || []).slice(-100).map((c) => ({
        time: typeof c.time === 'number' ? c.time : Math.floor(new Date(c.time).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 1,
      })),
      priceQuestioning: livePriceCritique || undefined,
      rangeComparisons: compareMultipleRanges(computedRanges as any, curPrice),
    }
  }, [
    instrument,
    livePrice,
    candles,
    livePriceCritique,
    dayTypeEval,
    openingBadge,
    avwap5mBenchmark,
    frvp5d,
    yesterdayNyc,
    overnightInventory,
    positionOverlay,
    barCountdown,
    activeTrendlines,
    activeRangeBoxes,
    activeManualFrvps,
    showCandlestickPatterns,
    memories,
  ])

  // Direct chart canvas click handler for session extreme arrows and labels
  // ONLY active when user has first opened Leo
  const handleChartFrameClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!leoPanelOpen) return
    const frame = chartFrameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    // Check if clicked within any session extreme hit-box
    const hit = renderedSessionExtremesRef.current.find((item) => {
      const distToApex = Math.hypot(clickX - item.x, clickY - item.y)
      if (distToApex <= 20) return true
      return (
        clickX >= item.bounds.minX &&
        clickX <= item.bounds.maxX &&
        clickY >= item.bounds.minY &&
        clickY <= item.bounds.maxY
      )
    })

    if (hit) {
      const ex = hit.extreme
      const label = `${hit.session} ${hit.type === 'HIGH' ? 'High' : 'Low'}`
      setLeoExternalPoints([
        {
          id: `arrow-${ex.id || ex.time}-${ex.price}`,
          label,
          value: hit.price,
          tier: 'IT',
          category: 'EXCESS',
          session: hit.session,
          volume: hit.volStr,
          retestRatio: hit.retestVolumeRatio,
          isRetested: hit.isRetested,
          description: `${hit.session} ${hit.type === 'HIGH' ? 'High' : 'Low'} at ${hit.price} (${hit.volStr}) ${
            hit.isRetested
              ? `[Retested with ${hit.retestVolumeRatio ?? 1}x volume]`
              : '[Fresh / Untested]'
          }`,
        },
      ])
    }
  }, [leoPanelOpen])

  const handleChartFrameMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const frame = chartFrameRef.current
    if (!frame) return
    if (!leoPanelOpen) {
      if (frame.style.cursor === 'pointer') frame.style.cursor = ''
      return
    }
    const rect = frame.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const hit = renderedSessionExtremesRef.current.some((item) => {
      const dist = Math.hypot(mouseX - item.x, mouseY - item.y)
      if (dist <= 20) return true
      return (
        mouseX >= item.bounds.minX &&
        mouseX <= item.bounds.maxX &&
        mouseY >= item.bounds.minY &&
        mouseY <= item.bounds.maxY
      )
    })

    frame.style.cursor = hit ? 'pointer' : ''
  }, [leoPanelOpen])

  // ── Ask Leo about a user-drawn tool (Trendline, Range, FRVP) ───────────────
  const handleAskLeoAboutDrawing = useCallback(
    (type: 'TRENDLINE' | 'RANGE' | 'FRVP' | 'AVWAP_5M', id: string) => {
      const curPrice =
        livePrice ??
        lastCandleRef.current?.close ??
        candlesRef.current[candlesRef.current.length - 1]?.close ??
        0
      const curTime = Math.floor(Date.now() / 1000)

      if (type === 'AVWAP_5M') {
        const p = curPrice
        const v = avwap5mBenchmark?.vwap ?? 0
        const diff = (p - v).toFixed(2)
        setLeoExternalPoints([
          {
            id: '5m-avwap-benchmark',
            label: `5M AVWAP (${instrument})`,
            value: `${v.toLocaleString()} (Delta: ${diff})`,
            tier: 'LT',
            category: 'VWAP',
            description: `5-Month CME Globex Anchored VWAP is ${v.toLocaleString()}. Current Price is ${p.toLocaleString()} (${Number(diff) >= 0 ? '+' : ''}${diff} pts vs AVWAP). Bands: +1σ ${avwap5mBenchmark?.sigma1Upper?.toLocaleString() ?? 'N/A'}, -1σ ${avwap5mBenchmark?.sigma1Lower?.toLocaleString() ?? 'N/A'}, +2σ ${avwap5mBenchmark?.sigma2Upper?.toLocaleString() ?? 'N/A'}, -2σ ${avwap5mBenchmark?.sigma2Lower?.toLocaleString() ?? 'N/A'}, +3σ ${avwap5mBenchmark?.sigma3Upper?.toLocaleString() ?? 'N/A'}, -3σ ${avwap5mBenchmark?.sigma3Lower?.toLocaleString() ?? 'N/A'}.`,
          },
        ])
        setLeoPanelOpen(true)
        return
      }

      if (type === 'TRENDLINE') {
        const tl = trendlines.find((t) => t.id === id)
        if (!tl) return
        const m = computeTrendlineMetrics(tl.p1, tl.p2, curPrice, curTime)
        const isLongSetup = tl.isReactionTrendline ? tl.p2.price >= tl.p1.price : tl.p2.price < tl.p1.price
        const setupDir: 'LONG' | 'SHORT' = isLongSetup ? 'LONG' : 'SHORT'
        const tlMockChartCtx: any = {
          yesterday: yesterdayNyc ? { poc: yesterdayNyc.poc, high: yesterdayNyc.yh, low: yesterdayNyc.yl, vah: yesterdayNyc.vah, val: yesterdayNyc.val } : null,
          overnight: overnightInventory ? {
            overnight: { poc: overnightInventory.overnight?.poc, high: overnightInventory.overnight?.high, low: overnightInventory.overnight?.low },
            asia: { poc: overnightInventory.asia?.poc, high: overnightInventory.asia?.high, low: overnightInventory.asia?.low },
            london: { poc: overnightInventory.london?.poc, high: overnightInventory.london?.high, low: overnightInventory.london?.low },
          } : null,
          frvp5d: frvp5d ? { poc: frvp5d.poc, vah: frvp5d.vah, val: frvp5d.val, high: frvp5d.high, low: frvp5d.low } : null,
          avwap5m: avwap5mBenchmark ? {
            vwap: avwap5mBenchmark.vwap,
            sigma1Upper: avwap5mBenchmark.sigma1Upper,
            sigma1Lower: avwap5mBenchmark.sigma1Lower,
            sigma2Upper: avwap5mBenchmark.sigma2Upper,
            sigma2Lower: avwap5mBenchmark.sigma2Lower,
          } : null,
        }
        const runway = evaluateHorizontalRunway({
          entryPrice: curPrice,
          stopLossPrice: setupDir === 'LONG' ? curPrice - 10 : curPrice + 10,
          direction: setupDir,
          chartContext: tlMockChartCtx,
        })
        const speedlines = calculateEmpiricalSpeedlines({
          origin: tl.p1,
          breakout: tl.p2,
          currentPrice: curPrice,
          currentTime: curTime,
          direction: setupDir,
        })

        const tlTypeLabel = tl.isReactionTrendline
          ? 'Reaction Trendline'
          : tl.actionBreakoutConfirmed
          ? 'Action Trendline (Breakout Confirmed)'
          : 'Action Trendline'

        const runwayStr = `Horizontal S/R Runway: ${runway.runwayPts.toFixed(1)} pts (${runway.runwayRatio}:1 R:R, ${runway.quality}). Nearest target: ${runway.nearestResistance ? `${runway.nearestResistance.label} @ ${runway.nearestResistance.price.toFixed(1)}` : 'None'}.`
        const velocityStr = `Empirical Velocity: ${speedlines.currentVelocityState} (Equilibrium: ${speedlines.projectedEquilibriumPrice.toFixed(1)}, Climax 1.5x: ${speedlines.projectedClimaxPrice.toFixed(1)}, Retest 0.5x: ${speedlines.projectedRetestFloorPrice.toFixed(1)}). ${speedlines.summary}`

        setLeoExternalPoints([
          {
            id: tl.id,
            label: tl.label || tlTypeLabel,
            value: `${m.direction} (${m.slopePtsPer5mBar >= 0 ? '+' : ''}${m.slopePtsPer5mBar} pts/5m)`,
            tier: 'DRAWING',
            category: 'TRENDLINE',
            description: `${tlTypeLabel}: From ${tl.p1.price.toLocaleString()} (${formatEtTime(tl.p1.time)}) to ${tl.p2.price.toLocaleString()} (${formatEtTime(tl.p2.time)}). Projected: ${m.projectedPrice.toLocaleString()}. Price is ${m.priceRelation} (${m.distancePts != null ? `${m.distancePts} pts` : 'N/A'}). ${runwayStr} ${velocityStr}`,
          },
        ])
        setLeoPanelOpen(true)
      } else if (type === 'RANGE') {
        const rb = rangeBoxes.find((r) => r.id === id)
        if (!rb) return
        const m = computeRangeMetrics(rb.p1, rb.p2, curPrice, candles)
        const volDesc =
          m.totalVolume != null
            ? ` | Vol: ${m.totalVolume.toLocaleString()} (${m.volumeRatePerMin ?? 0} vol/min, ${m.buyRatioPct ?? 50}% buy, delta ${m.delta != null && m.delta >= 0 ? '+' : ''}${m.delta?.toLocaleString() ?? 0}, POC: ${m.poc ?? m.midPrice})`
            : ''
        setLeoExternalPoints([
          {
            id: rb.id,
            label: rb.label || 'Range Box',
            value: `${m.heightPts} pts (${m.priceHigh.toLocaleString()} – ${m.priceLow.toLocaleString()})`,
            tier: 'DRAWING',
            category: 'RANGE',
            volume: m.totalVolume,
            description: `User Range Box: High ${m.priceHigh.toLocaleString()}, Low ${m.priceLow.toLocaleString()}, Mid ${m.midPrice.toLocaleString()}. Position: ${m.priceRelation} (${m.positionPct}%). Height: ${m.heightPts} pts. Duration: ${m.durationMin}m.${volDesc}`,
          },
        ])
        setLeoPanelOpen(true)
      } else if (type === 'FRVP') {
        const fp = manualFrvps.find((f) => f.id === id)
        if (!fp) return
        const buyDeltaPct = Math.round((fp.buyVolume / (fp.totalVolume || 1)) * 100)
        setLeoExternalPoints([
          {
            id: fp.id,
            label: fp.label || 'Manual FRVP',
            value: `POC ${fp.poc.toLocaleString()} | VAH ${fp.vah.toLocaleString()} | VAL ${fp.val.toLocaleString()}`,
            tier: 'DRAWING',
            category: 'FRVP',
            volume: fp.totalVolume.toLocaleString(),
            description: `Manual Fixed Range Volume Profile: POC ${fp.poc.toLocaleString()}, VAH ${fp.vah.toLocaleString()}, VAL ${fp.val.toLocaleString()}. Total Vol: ${fp.totalVolume.toLocaleString()}, Buy Delta: ${buyDeltaPct}%. Range: ${formatEtTime(fp.timeStart)} to ${formatEtTime(fp.timeEnd)}.`,
          },
        ])
        setLeoPanelOpen(true)
      }
    },
    [trendlines, rangeBoxes, manualFrvps, livePrice, instrument, avwap5mBenchmark]
  )

  const handleAskLeoAboutMemory = useCallback(
    (mem: LeoLongTermMemory, price: number) => {
      setLeoExternalPoints([
        {
          id: mem.id,
          label: `🧠 Leo Memory: ${mem.purpose}`,
          value: `Zone ${mem.priceLow.toFixed(2)} – ${mem.priceHigh.toFixed(2)} (Current: ${price.toFixed(2)})`,
          tier: 'LT',
          category: 'RANGE',
          description: `Higher Timeframe Daily Long-Term Memory on ${mem.instrument}. Purpose: "${mem.purpose}". Price is currently visiting this level. Analyze whether this zone acts as support or resistance, verify order flow absorption/exhaustion, and outline action plan.`,
        },
      ])
      setLeoPanelOpen(true)
    },
    []
  )

  // ── Monitor Live Price Against Leo Long-Term Memories & Play Chime ────────
  const prevLivePriceRef = useRef<number | null>(null)
  useEffect(() => {
    if (livePrice == null || !Number.isFinite(livePrice)) return
    const { triggered } = evaluatePriceAgainstMemories({
      instrument,
      currentPrice: livePrice,
      previousPrice: prevLivePriceRef.current,
      cooldownSeconds: 90,
    })
    prevLivePriceRef.current = livePrice

    for (const mem of triggered) {
      if (mem.alarmSoundEnabled) {
        playTradingViewChime()
      }
      recordMemoryNotification({
        memoryId: mem.id,
        instrument: mem.instrument,
        price: livePrice,
        priceLow: mem.priceLow,
        priceHigh: mem.priceHigh,
        purpose: mem.purpose,
      })
      setActiveTradingViewAlarm({
        memory: mem,
        price: livePrice,
      })
    }
  }, [livePrice, instrument])

  const handleDeleteTrendline = useCallback((id: string) => {
    setTrendlines((prev) => prev.filter((t) => t.id !== id))
    confirmedBreakoutsRef.current.delete(id)
    requestAnimationFrame(() => paintUserDrawingsRef.current())
  }, [])

  const handleDeleteRangeBox = useCallback((id: string) => {
    setRangeBoxes((prev) => prev.filter((r) => r.id !== id))
    requestAnimationFrame(() => paintUserDrawingsRef.current())
  }, [])

  const handleDeleteManualFrvp = useCallback((id: string) => {
    setManualFrvps((prev) => prev.filter((f) => f.id !== id))
    requestAnimationFrame(() => paintUserDrawingsRef.current())
  }, [])

  const handleDeleteMeasure = useCallback((id: string) => {
    setMeasures((prev) => prev.filter((m) => m.id !== id))
    measureBadgeHitsRef.current.delete(id)
    requestAnimationFrame(() => paintUserDrawingsRef.current())
  }, [])

  const handleClearAllDrawings = useCallback(() => {
    setTrendlines([])
    setRangeBoxes([])
    setManualFrvps([])
    setMeasures([])
    setDrawingDraft(null)
    draftMousePosRef.current = null
    measureBadgeHitsRef.current.clear()
    confirmedBreakoutsRef.current.clear()
    try {
      localStorage.removeItem('trading_desk_measures_v1')
    } catch {}
    requestAnimationFrame(() => paintUserDrawingsRef.current())
  }, [])

  const paintAuctionOverlay = useCallback(() => {
    const host = priceLineHostRef.current
    if (timeframe === '1D') {
      setAuctionBadge('off')
      setAuctionHud(null)
      auctionSignalsRef.current = []
      auctionPaintKeyRef.current = ''
      for (const line of auctionLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      auctionLinesRef.current = []
      paintDeskMarkersRef.current()
      return
    }
    const list = candlesRef.current
    const lastBar = list.length ? (list[list.length - 1]!.time as number) : null
    const asOfUnix = resolveAuctionAsOfUnix(lastBar, Math.floor(Date.now() / 1000))
    const overlay = isAuctionInstrument(instrument)
      ? computeAuctionOverlay({
          instrument,
          candles: list.map((c) => ({
            time: c.time as number,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
          asOfUnix,
        })
      : null
    const visible = showAuction && !!overlay
    const badge = auctionOverlayBadgeText(overlay, showAuction)
    setAuctionBadge((prev) => (prev === badge ? prev : badge))
    const hud = visible && overlay ? overlay.hud : null
    setAuctionHud((prev: any) => {
      if (!hud && !prev) return prev
      if (!hud) return null
      if (
        prev &&
        prev.rangeTag === hud.rangeTag &&
        prev.windowLabel === hud.windowLabel &&
        prev.openType === hud.openType &&
        prev.bias === hud.bias &&
        prev.dailySignals === hud.dailySignals &&
        prev.canTradeWindow === hud.canTradeWindow &&
        prev.isLunch === hud.isLunch
      ) {
        return prev
      }
      return hud
    })
    auctionSignalsRef.current = visible && overlay ? overlay.signals : []
    const key = auctionOverlayPaintKey(visible, overlay)
    if (key === auctionPaintKeyRef.current) return
    auctionPaintKeyRef.current = key
    for (const line of auctionLinesRef.current) {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    }
    auctionLinesRef.current = []
    paintDeskMarkersRef.current()
  }, [showAuction, instrument, timeframe])

  const paintDow15mFailOverlay = useCallback(() => {
    const host = priceLineHostRef.current
    if (timeframe === '1D') {
      setDow15mFailBadge('off')
      setDow15mFailHud(null)
      dow15mFailSignalsRef.current = []
      dow15mFailPaintKeyRef.current = ''
      for (const line of dow15mFailLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      dow15mFailLinesRef.current = []
      paintDeskMarkersRef.current()
      return
    }
    const list = candlesRef.current
    const lastBar = list.length ? (list[list.length - 1]!.time as number) : null
    const asOfUnix = resolveAuctionAsOfUnix(lastBar, Math.floor(Date.now() / 1000))
    const overlay = isDowVolumeBarInstrument(instrument)
      ? computeDow15mFailOverlay({
          instrument,
          candles: list.map((c) => ({
            time: c.time as number,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
          asOfUnix,
        })
      : null
    const visible = showDow15mFail && !!overlay
    const badge = dow15mFailBadgeText(overlay, showDow15mFail)
    setDow15mFailBadge((prev) => (prev === badge ? prev : badge))
    const hud = visible && overlay ? overlay.hud : null
    setDow15mFailHud((prev: any) => {
      if (!hud && !prev) return prev
      if (!hud) return null
      if (
        prev &&
        prev.rangeStatus === hud.rangeStatus &&
        prev.setupText === hud.setupText &&
        prev.dailySignals === hud.dailySignals &&
        prev.rangeArm === hud.rangeArm &&
        prev.setupOn === hud.setupOn
      ) {
        return prev
      }
      return hud
    })
    dow15mFailSignalsRef.current = visible && overlay ? overlay.signals : []
    const key = dow15mFailPaintKey(visible, overlay)
    if (key === dow15mFailPaintKeyRef.current) return
    dow15mFailPaintKeyRef.current = key
    for (const line of dow15mFailLinesRef.current) {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    }
    dow15mFailLinesRef.current = []
    paintDeskMarkersRef.current()
  }, [showDow15mFail, instrument, timeframe])

  const paintMarketControl = useCallback(() => {
    const host = priceLineHostRef.current
    if (timeframe === '1D') {
      setControlBadge('RF WAIT')
      marketControlRef.current = null
      controlPaintKeyRef.current = ''
      for (const line of controlLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      controlLinesRef.current = []
      return
    }
    const list = candlesRef.current
    const lastBar = list.length ? (list[list.length - 1]!.time as number) : null
    const asOfUnix = resolveMarketControlAsOfUnix(
      instrument,
      lastBar,
      Math.floor(Date.now() / 1000)
    )
    const control = computeMarketControl({
      instrument,
      candles: list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      asOfUnix,
    })
    const badge = marketControlBadgeText(control)
    setControlBadge((prev) => (prev === badge ? prev : badge))
    marketControlRef.current = control
    const key = marketControlPaintKey(showMarketControl, control)
    if (key === controlPaintKeyRef.current) return
    controlPaintKeyRef.current = key
    for (const line of controlLinesRef.current) {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    }
    controlLinesRef.current = []
  }, [showMarketControl, instrument, timeframe])

  const paintDeskCall = useCallback(() => {
    const list = candlesRef.current
    const lastBar = list.length ? (list[list.length - 1]!.time as number) : null
    const nowUnix = Math.floor(Date.now() / 1000)
    const asOfUnix = resolveDeskCallAsOfUnix(instrument, lastBar, nowUnix)
    const playbookMode = resolveDeskPlaybookMode({
      instrument,
      rangeStrategy,
      ladder: attemptLadderFromCounts({
        morningAttempts,
        ibAttempts,
        lunchAttempts,
        morningStopHits: stopHits,
        now: new Date(),
        instrument,
      }),
    })
    const call = computeDeskCall({
      instrument,
      candles: list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      asOfUnix,
      playbookMode,
      attemptsUsed,
      bookLocked:
        attemptsUsed >= 3 || !!positionOverlay || !!pendingLimit,
      control: marketControlRef.current,
    })
    const badge = deskCallBadgeText(call)
    setCallBadge((prev) => (prev === badge ? prev : badge))
    const hover = `${deskCallModeHoverPrefix(useCallRef.current)}${deskCallHoverText(call)}`
    setCallHover((prev) => (prev === hover ? prev : hover))
    const nextPerf = call.perfBadge ?? 'WAIT'
    setPerfBadge((prev) => (prev === nextPerf ? prev : nextPerf))
    const nextPerfHover =
      call.perfPlayLine ??
      'PERF WAIT — not enough letters for a developing value area. Drive may still CALL. Ticket stays 1.5R.'
    setPerfHover((prev) => (prev === nextPerfHover ? prev : nextPerfHover))
    const nextSit = call.sitBadge ?? 'NONE'
    setSitBadge((prev) => (prev === nextSit ? prev : nextSit))
    const nextSitHover =
      call.sitPlayLine ??
      'SIT NONE — no special situation. CALL side unchanged. Ticket stays 1.5R.'
    setSitHover((prev) => (prev === nextSitHover ? prev : nextSitHover))
    const nextRegion = call.regionBadge ?? 'WAIT'
    setRegionBadge((prev) => (prev === nextRegion ? prev : nextRegion))
    const nextRegionHover =
      call.regionPlayLine ??
      'REGION WAIT — not enough completed cash days for a 5-day TPO body. CALL unchanged. Ticket stays 1.5R.'
    setRegionHover((prev) => (prev === nextRegionHover ? prev : nextRegionHover))
    const nextOut = call.stayOutBadge ?? '—'
    setStayOutBadge((prev) => (prev === nextOut ? prev : nextOut))
    const nextOutHover =
      call.stayOutPlayLine ??
      'OUT — not a stay-out day. CALL hunts legal ±10. Ticket stays 1.5R.'
    setStayOutHover((prev) => (prev === nextOutHover ? prev : nextOutHover))
    deskCallRef.current = call
    onDeskPerfRef.current?.({
      grade: call.perfGrade ?? 'WAIT',
      badgeText: nextPerf,
      leaveBook: call.perfLeave === true,
      playLine: nextPerfHover,
      vetoCall: call.perfVeto === true,
      sitBadge: nextSit,
      sitHold: call.sitHold === true,
      sitPlayLine: nextSitHover,
      regionBadge: nextRegion,
      regionPlayLine: nextRegionHover,
    })
    const clock = deskClockFor(instrument)
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: clock.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(asOfUnix * 1000))
    if (isWeekdayYmd(ymd, clock.timeZone)) {
      const closeU = zonedCivilToUnix(ymd, clock.overnightStartHour, clock.timeZone)
      if (asOfUnix >= closeU) {
        const key = `${ymd}_${instrument}`
        if (quietLtarKeyRef.current !== key) {
          quietLtarKeyRef.current = key
          persistQuietDeskPerfLtar({
            instrument,
            date: ymd,
            attempted:
              call.controlLabel === 'ONE-TF BUY'
                ? 'HIGHER'
                : call.controlLabel === 'ONE-TF SELL'
                  ? 'LOWER'
                  : 'NEUTRAL',
            grade: call.perfGrade ?? 'WAIT',
            volumeRel: call.perfVolumeRel ?? null,
            placement: call.perfPlacement ?? null,
            vaWidth: call.perfVaWidth ?? null,
            playLine: [nextPerfHover, nextSitHover, nextRegionHover]
              .filter(Boolean)
              .join(' '),
          })
        }
      }
    }
    const host = priceLineHostRef.current
    const spikeKey = `${instrument}_${call.spikeHigh ?? ''}_${call.spikeLow ?? ''}_${nextSit}`
    if (spikeKey !== spikePaintKeyRef.current) {
      spikePaintKeyRef.current = spikeKey
      for (const line of spikeLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      spikeLinesRef.current = []
    }
    const regionKey = `${instrument}_${call.regionHigh ?? ''}_${call.regionLow ?? ''}_${nextRegion}`
    if (regionKey !== regionPaintKeyRef.current) {
      regionPaintKeyRef.current = regionKey
      for (const line of regionLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      regionLinesRef.current = []
    }
  }, [
    instrument,
    rangeStrategy,
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    stopHits,
    attemptsUsed,
    positionOverlay,
    pendingLimit,
    resolvedUseCall,
  ])

  const paintIbExtend = useCallback(() => {
    const host = priceLineHostRef.current
    const list = candlesRef.current
    const ib = ibRangeRef.current
    const nowUnix = Math.floor(Date.now() / 1000)
    const last = list.length ? list[list.length - 1] : null
    const call = deskCallRef.current
    const advice = computeIbExtendAdvice({
      instrument,
      ib,
      candles: list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
      nowUnix: Math.max(nowUnix, last ? (last.time as number) : nowUnix),
      useCall: useCallRef.current,
      callSide: call?.side ?? 'WAIT',
      lastPrice: last?.close ?? null,
    })
    ibExtendRef.current = advice
    if (!advice) {
      setIbExtendBadge('—')
      return
    }
    const chip = advice.chip || '—'
    setIbExtendBadge((prev) => (prev === chip ? prev : chip))
    const hover = `${advice.message || ''}${advice.entryAdvice != null && advice.stopAdvice != null
      ? `\nPullback ~${advice.entryAdvice} · stop ~${advice.stopAdvice} (advise only — you place on TradingView).`
      : ''
      }\nAdvice only. Does not place. CALL ON still gates tickets.`
    setIbExtendHover((prev) => (prev === hover ? prev : hover))

    for (const line of ibLiqLinesRef.current) {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    }
    ibLiqLinesRef.current = []

    const alertKind = advice.regime ? ibExtendAlertKind(advice.regime) : null
    if (
      alertKind &&
      advice.ibComplete &&
      isDeskInstrument(instrument) &&
      claimDeskNoteOnce(alertKind, instrument)
    ) {
      const quote = last?.close
      const pivot = advice.swing?.price ?? advice.entryAdvice
      if (
        quote != null &&
        pivot != null &&
        !quoteBelongsToBook({
          instrument,
          entry: pivot,
          quote,
        })
      ) {
        return
      }
      onDeskAlert?.({
        kind: alertKind,
        title: advice.chip,
        body: advice.message,
        telegram: '',
        dedupeKey: deskNoteClaimKey(alertKind, instrument),
        instrument,
      })
    }
  }, [instrument, onDeskAlert, resolvedUseCall])

  useEffect(() => {
    paintIbLines()
  }, [paintIbLines])

  useEffect(() => {
    paintOr15Lines()
  }, [paintOr15Lines])

  useEffect(() => {
    paintUsRangeLines()
  }, [paintUsRangeLines])

  useEffect(() => {
    paintOr30Lines()
  }, [paintOr30Lines])

  useEffect(() => {
    paintYesterdayProfileRef.current = paintYesterdayProfile
  }, [paintYesterdayProfile])

  useEffect(() => {
    paintYesterdayProfile()
  }, [paintYesterdayProfile])

  useEffect(() => {
    paintOpeningActivityRef.current = paintOpeningActivity
  }, [paintOpeningActivity])

  useEffect(() => {
    paintOpeningActivity()
  }, [paintOpeningActivity])

  useEffect(() => {
    paintAuctionOverlayRef.current = paintAuctionOverlay
  }, [paintAuctionOverlay])

  useEffect(() => {
    paintAuctionOverlay()
  }, [paintAuctionOverlay])

  useEffect(() => {
    paintDow15mFailOverlayRef.current = paintDow15mFailOverlay
  }, [paintDow15mFailOverlay])

  useEffect(() => {
    paintDow15mFailOverlay()
  }, [paintDow15mFailOverlay])

  useEffect(() => {
    paintMarketControlRef.current = paintMarketControl
  }, [paintMarketControl])

  useEffect(() => {
    paintMarketControl()
  }, [paintMarketControl])

  useEffect(() => {
    paintDeskCallRef.current = paintDeskCall
  }, [paintDeskCall])

  useEffect(() => {
    paintDeskCall()
  }, [paintDeskCall])

  useEffect(() => {
    paintFrvp5dRef.current = paintFrvp5d
  }, [paintFrvp5d])

  useEffect(() => {
    paintFrvp5d()
  }, [paintFrvp5d])

  useEffect(() => {
    paintYesterdayNycRef.current = paintYesterdayNyc
  }, [paintYesterdayNyc])

  useEffect(() => {
    paintYesterdayNyc()
  }, [paintYesterdayNyc])

  useEffect(() => {
    paintInventorySessionsRef.current = paintInventorySessions
  }, [paintInventorySessions])

  useEffect(() => {
    paintInventorySessions()
  }, [paintInventorySessions])

  useEffect(() => {
    paint5mAvwapBenchmarkRef.current = paint5mAvwapBenchmark
  }, [paint5mAvwapBenchmark])

  useEffect(() => {
    paint5mAvwapBenchmark()
  }, [paint5mAvwapBenchmark])

  useEffect(() => {
    let cancelled = false
    async function load5mAvwap() {
      try {
        const res = await fetch(`/api/trading/context-55?instrument=${instrument}`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.ok && data.avwap5m) {
          setAvwap5mBenchmark(data.avwap5m)
        }
      } catch {
        /* ignore */
      }
    }
    void load5mAvwap()
    const pollId = window.setInterval(load5mAvwap, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(pollId)
    }
  }, [instrument])

  useEffect(() => {
    if (!SYSTEMATIC_LIVE_DESK) return
    const publish = () => {
      if (!positionOverlay) {
        if (sessionExitKeyRef.current !== '') {
          sessionExitKeyRef.current = ''
          onSessionExitRef.current?.(null)
        }
        return
      }
      const fillUnix = parseFillUnix(positionOverlay.entryTimestamp)
      const list = candlesRef.current
      const live =
        livePrice != null && Number.isFinite(livePrice) && livePrice > 0
          ? livePrice
          : list.at(-1)?.close ?? positionOverlay.entryPrice
      const read: SessionExitRead = computeSessionExit({
        direction: positionOverlay.direction,
        entry: positionOverlay.entryPrice,
        stop: positionOverlay.stopLoss,
        fillUnix,
        nowUnix: Math.floor(Date.now() / 1000),
        bars: list.map((c) => ({
          time: c.time as number,
          close: c.close,
        })),
        livePrice: live,
        or30Locked,
        perfLeave: deskCallRef.current?.perfLeave === true,
      })
      const key = `${read.word}|${read.line}`
      if (key === sessionExitKeyRef.current) return
      sessionExitKeyRef.current = key
      onSessionExitRef.current?.({
        word: read.word,
        line: read.line,
        hover: read.hover,
      })
    }
    publish()
    const id = window.setInterval(publish, 15_000)
    return () => window.clearInterval(id)
  }, [
    positionOverlay,
    livePrice,
    or30Locked,
    instrument,
  ])

  useEffect(() => {
    paintIbExtendRef.current = paintIbExtend
  }, [paintIbExtend])

  useEffect(() => {
    paintIbExtend()
  }, [paintIbExtend])


  const playbookUserClosedRef = useRef(false)

  const togglePlaybook = useCallback(() => {
    setPlaybookOpen((prev) => {
      const next = !prev
      playbookUserClosedRef.current = !next
      return next
    })
  }, [])

  useEffect(() => {
    playbookUserClosedRef.current = false
    setLivePrice(null)
    publishPriceTick(null, 0)
  }, [instrument, publishPriceTick])
  const [voiceOpen, setVoiceOpen] = useState(false)
  // Draw Zone tool — drag on chart to draw a rectangle zone for Leo
  const [drawZoneActive, setDrawZoneActive] = useState(false)
  const [drawnZone, setDrawnZone] = useState<{ priceHigh: number; priceLow: number } | null>(null)
  const [drawnZoneSide, setDrawnZoneSide] = useState<'BUY' | 'SHORT'>('BUY')
  const [drawnZoneSending, setDrawnZoneSending] = useState(false)
  const [drawnZoneCounter, setDrawnZoneCounter] = useState(1)
  const drawZoneLinesRef = useRef<any[]>([])
  const drawZoneOverlayRef = useRef<HTMLDivElement | null>(null)

  // Highlight Time Range tool — drag 2D zone to highlight multi-session time & price for Leo
  const [drawTimeActive, setDrawTimeActive] = useState(false)
  const [drawnTime, setDrawnTime] = useState<{
    startUnix: number
    endUnix: number
    priceHigh: number
    priceLow: number
    priceStart: number
    priceEnd: number
    rangeHigh: number
    rangeLow: number
    candleStartOpen: number
    candleEndClose: number
    candleCount: number
    netMovePts: number
    netMovePct: number
    label: string
  } | null>(null)
  const [drawnTimeCounter, setDrawnTimeCounter] = useState(1)
  const [drawnTimeSending, setDrawnTimeSending] = useState(false)
  const drawTimeOverlayRef = useRef<HTMLDivElement | null>(null)

  // Saved Time Highlights for recall list
  const [savedHighlights, setSavedHighlights] = useState<Array<{
    id: string
    label: string
    startUnix: number
    endUnix: number
    priceHigh: number
    priceLow: number
    priceStart: number
    priceEnd: number
    rangeHigh: number
    rangeLow: number
    candleStartOpen: number
    candleEndClose: number
    candleCount: number
    netMovePts: number
    netMovePct: number
    sessionSpanStr: string
    visible: boolean
  }>>([])
  const [highlightsListOpen, setHighlightsListOpen] = useState(false)
  const loadedInstrumentRef = useRef<string | null>(null)

  // Load saved highlights when instrument changes
  useEffect(() => {
    try {
      const key = `desk_saved_highlights_${instrument}`
      const saved = localStorage.getItem(key)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          setSavedHighlights(parsed)
          loadedInstrumentRef.current = instrument
          return
        }
      }
    } catch { /* ignore */ }
    setSavedHighlights([])
    loadedInstrumentRef.current = instrument
  }, [instrument])

  // Save highlights to localStorage when updated for current instrument
  useEffect(() => {
    if (loadedInstrumentRef.current !== instrument) return
    try {
      const key = `desk_saved_highlights_${instrument}`
      localStorage.setItem(key, JSON.stringify(savedHighlights))
    } catch { /* ignore */ }
  }, [savedHighlights, instrument])

  // TradingView-style Interactive Risk/Reward Limit Order Tool (O key / toolbar)
  const [riskBoxActive, setRiskBoxActive] = useState(false)
  const [riskBox, setRiskBox] = useState<{
    direction: 'LONG' | 'SHORT'
    orderType: 'LIMIT'
    entryPrice: number
    stopLoss: number
    profitTarget: number
    /** Band book from click/snap — confirm must not re-bill US H/L as Tokyo IB mid. */
    preferRangeLabel?: string | null
  } | null>(null)
  const riskBoxRef = useRef(riskBox)
  riskBoxRef.current = riskBox
  const riskBoxLinesRef = useRef<any[]>([])

  // Draggable chart price alert — Telegram on touch (A key / toolbar)
  const [priceAlert, setPriceAlert] = useState<StoredPriceAlert | null>(null)
  const priceAlertLineRef = useRef<IPriceLine | null>(null)
  const draggingPriceAlertRef = useRef(false)
  const prevLivePriceForAlertRef = useRef<number | null>(null)
  const priceAlertPrimedRef = useRef(false)
  const priceAlertInstrumentRef = useRef(instrument)

  /** Local draft of filled overlay so SL/TP can drag before API confirms */
  const [editableOverlay, setEditableOverlay] = useState<PositionOverlay | null>(null)
  const editableOverlayRef = useRef<PositionOverlay | null>(null)
  const draggingBracketRef = useRef<'SL' | 'TP' | null>(null)
  const ignorePriceFromPointerUntilRef = useRef(0)
  const bracketDragStartRef = useRef<{ stopLoss: number; profitTarget: number } | null>(null)
  const onAdjustBracketsRef = useRef(onAdjustBrackets)
  onAdjustBracketsRef.current = onAdjustBrackets
  const onAdjustWorkingBracketsRef = useRef(onAdjustWorkingBrackets)
  onAdjustWorkingBracketsRef.current = onAdjustWorkingBrackets
  editableOverlayRef.current = editableOverlay

  /** Local draft of working limit — TP draggable; SL locked */
  const [editablePending, setEditablePending] = useState<PendingLimitOverlay | null>(null)
  const editablePendingRef = useRef<PendingLimitOverlay | null>(null)
  const draggingWorkingBracketRef = useRef<'TP' | null>(null)
  const workingBracketDragStartRef = useRef<number | null>(null)
  editablePendingRef.current = editablePending

  useEffect(() => {
    if (draggingWorkingBracketRef.current) return
    setEditablePending(pendingLimit ?? null)
  }, [pendingLimit])

  useEffect(() => {
    if (draggingBracketRef.current) return
    setEditableOverlay(positionOverlay ?? null)
    if (positionOverlay && chartRef.current) {
      try {
        chartRef.current.priceScale('right').applyOptions({ autoScale: true })
      } catch {
        /* ignore */
      }
    }
  }, [positionOverlay])

  const workingBook = useMemo(() => {
    const pend = editablePending ?? pendingLimit
    if (!pend) return null
    return deskBookLines({
      instrument,
      direction: pend.direction,
      entry: pend.price,
      stop: pend.stopLoss,
      target: pend.profitTarget,
      riskDollars: pend.riskDollars,
    })
  }, [editablePending, pendingLimit, instrument])

  const filledBook = useMemo(() => {
    const ov = editableOverlay ?? positionOverlay
    if (!ov) return null
    return deskBookLines({
      instrument,
      direction: ov.direction,
      entry: ov.entryPrice,
      stop: ov.stopLoss,
      target: ov.profitTarget,
      riskDollars: ov.riskDollars,
    })
  }, [editableOverlay, positionOverlay, instrument])

  const bookBandRef = useRef<{ entry: number; stop: number; target: number } | null>(null)
  {
    const ov = editableOverlay ?? positionOverlay
    bookBandRef.current = ov
      ? {
        entry: filledBook?.entry ?? ov.entryPrice,
        stop: filledBook?.stop ?? ov.stopLoss,
        target: filledBook?.target ?? ov.profitTarget,
      }
      : null
  }



  // Fullscreen mode (F key / Esc / button)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = useCallback(() => {
    if (!isFullscreen) {
      const elem = outerWrapperRef.current || containerRef.current?.parentElement || document.documentElement
      if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(() => null)
      }
      setIsFullscreen(true)
    } else {
      if (document.exitFullscreen && document.fullscreenElement) {
        document.exitFullscreen().catch(() => null)
      }
      setIsFullscreen(false)
    }
    requestAnimationFrame(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.resize(containerRef.current.clientWidth, containerRef.current.clientHeight)
      }
      if (cvdContainerRef.current && cvdChartRef.current) {
        cvdChartRef.current.resize(cvdContainerRef.current.clientWidth, cvdContainerRef.current.clientHeight)
      }
      refreshSessionHighlightsRef.current()
    })
  }, [isFullscreen])

  // Hotkey Q: Toggle Auction Price Critique & "Questioning" Desk
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (e.key === 'q' || e.key === 'Q') {
        if (!isPriceQuestioningSessionActive(Date.now(), critiqueStartOptionRef.current)) {
          return
        }
        setShowQuestioningModal((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Voice stays closed on refresh / clock-in — user opens via toolbar (V).
  const showLevelsRef = useRef(false)
  const [chartReady, setChartReady] = useState(false)

  /**
   * Overlay pills / brackets / highlight boxes are placed imperatively so a pan
   * frame never has to re-render this component. Every coordinate is read
   * before any style is written, so one pass costs a single layout flush.
   */
  const applyOverlayLayout = useCallback(() => {
    const host = chartFrameRef.current
    const chart = chartRef.current
    const series = candleRef.current
    if (!host || !chart || !series) return
    const nodes = host.querySelectorAll<HTMLElement>(OVERLAY_NODE_SELECTOR)
    if (nodes.length === 0) return
    const container = containerRef.current
    const timeScale = chart.timeScale()

    const placed: Array<{
      el: HTMLElement
      x: number
      y: number
      w?: number
      h?: number
    }> = []
    const hidden: HTMLElement[] = []

    nodes.forEach((el) => {
      const dy = Number(el.getAttribute(OV_DY) ?? 0)

      const priceAttr = el.getAttribute(OV_PRICE)
      if (priceAttr != null) {
        const y = overlayTopFromPrice(series, Number(priceAttr), host, container)
        if (y == null) hidden.push(el)
        else placed.push({ el, x: 0, y: y + dy })
        return
      }

      const spanAttr = el.getAttribute(OV_SPAN)
      if (spanAttr != null) {
        let top = Infinity
        let bottom = -Infinity
        let ok = false
        for (const price of overlayNumbers(spanAttr)) {
          const y = overlayTopFromPrice(series, price, host, container)
          if (y == null) {
            ok = false
            break
          }
          ok = true
          top = Math.min(top, y)
          bottom = Math.max(bottom, y)
        }
        if (!ok) hidden.push(el)
        else placed.push({ el, x: 0, y: top + dy, h: bottom - top })
        return
      }

      const boxPrices = overlayNumbers(el.getAttribute(OV_BOX_PRICE))
      const boxTimes = overlayNumbers(el.getAttribute(OV_BOX_TIME))
      const [priceHigh, priceLow] = boxPrices
      const [timeFrom, timeTo] = boxTimes
      if (priceHigh == null || priceLow == null || timeFrom == null || timeTo == null) {
        hidden.push(el)
        return
      }
      const topCoord = series.priceToCoordinate(priceHigh)
      const bottomCoord = series.priceToCoordinate(priceLow)
      const leftCoord = timeScale.timeToCoordinate(timeFrom as UTCTimestamp)
      const rightCoord = timeScale.timeToCoordinate(timeTo as UTCTimestamp)
      if (topCoord == null || bottomCoord == null || leftCoord == null || rightCoord == null) {
        hidden.push(el)
        return
      }
      placed.push({
        el,
        x: Math.min(leftCoord, rightCoord),
        y: Math.min(topCoord, bottomCoord),
        w: Math.abs(rightCoord - leftCoord),
        h: Math.abs(bottomCoord - topCoord),
      })
    })

    for (const el of hidden) overlayHide(el)
    for (const p of placed) overlayPlace(p.el, p.x, p.y, p.w, p.h)
  }, [])

  const paintOverlaysSinglePass = useCallback(() => {
    applyOverlayLayout()
    paintFrvpHistogramRef.current?.()
    paintExcessesAndRoundedRef.current?.()
    paintUserDrawingsRef.current?.()
    paintNewsMarkersRef.current?.()
  }, [applyOverlayLayout])

  const paintOverlaysSinglePassRef = useRef(paintOverlaysSinglePass)
  paintOverlaysSinglePassRef.current = paintOverlaysSinglePass

  const overlayRafRef = useRef(0)
  const overlaySampleUntilRef = useRef(0)

  /** Place now, then keep sampling each frame for a beat so kinetic scroll and
   * autoscale animations stay glued to the candles without a perpetual loop. */
  const pokeOverlayLayout = useCallback(() => {
    paintOverlaysSinglePass()
    paintFrvpHistogramRef.current?.()
    paintExcessesAndRoundedRef.current?.()
    paintUserDrawingsRef.current?.()
    paintNewsMarkersRef.current?.()
    overlaySampleUntilRef.current = Date.now() + OVERLAY_SETTLE_MS
    if (overlayRafRef.current) return
    const loop = () => {
      paintOverlaysSinglePass()
      paintFrvpHistogramRef.current?.()
      paintExcessesAndRoundedRef.current?.()
      paintUserDrawingsRef.current?.()
      paintNewsMarkersRef.current?.()
      if (Date.now() < overlaySampleUntilRef.current) {
        overlayRafRef.current = requestAnimationFrame(loop)
      } else {
        overlayRafRef.current = 0
      }
    }
    overlayRafRef.current = requestAnimationFrame(loop)
  }, [paintOverlaysSinglePass])

  const pokeOverlayLayoutRef = useRef(pokeOverlayLayout)
  pokeOverlayLayoutRef.current = pokeOverlayLayout

  useOverlayLayoutEffect(() => {
    applyOverlayLayout()
  }, [applyOverlayLayout])

  useEffect(() => {
    const host = chartFrameRef.current
    const poke = () => pokeOverlayLayoutRef.current()
    // Price-axis drags rescale vertically without emitting a logical-range change.
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons !== 0) poke()
    }
    const listen = { passive: true } as const
    host?.addEventListener('pointerdown', poke, listen)
    host?.addEventListener('pointermove', onPointerMove, listen)
    window.addEventListener('pointerup', poke, listen)
    document.addEventListener('fullscreenchange', poke)
    // Streaming candles poke overlay after a throttled tip paint — not a 150ms loop.
    return () => {
      host?.removeEventListener('pointerdown', poke)
      host?.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', poke)
      document.removeEventListener('fullscreenchange', poke)
      if (overlayRafRef.current) cancelAnimationFrame(overlayRafRef.current)
      overlayRafRef.current = 0
    }
  }, [applyOverlayLayout])

  const candlesRef = useRef<OHLCV[]>([])
  const instrumentRef = useRef<Instrument>(instrument)

  // Ensure candlestick series colors always stay consistent institutional green/red across all markets
  useEffect(() => {
    if (!candleRef.current) return
    try {
      candleRef.current.applyOptions({
        upColor: DESK_CANDLE_UP,
        downColor: DESK_CANDLE_DOWN,
        borderUpColor: DESK_CANDLE_UP,
        borderDownColor: DESK_CANDLE_DOWN,
        wickUpColor: DESK_CANDLE_UP,
        wickDownColor: DESK_CANDLE_DOWN,
        priceFormat: deskCandlePriceFormat(instrument),
      })
    } catch {
      /* ignore */
    }
  }, [instrument])
  /** LIVE = real Yahoo data; SYNTHETIC = random fallback (never trade off this) */
  const [dataMode, setDataModeState] = useState<'live' | 'synthetic'>('live')
  /** Candle history feed — databento = official CME Globex MDP 3.0 exchange feed */
  const [candleFeed, setCandleFeed] = useState<'databento' | 'oanda' | 'yahoo' | 'empty'>('databento')
  const setDataMode = useCallback(
    (mode: 'live' | 'synthetic') => {
      setDataModeState(mode)
      onDataModeChange?.(mode)
    },
    [onDataModeChange]
  )
  const positionLinesRef = useRef<any[]>([])
  /** Hover preview of entry/SL/TP for the nearest visible AI/structure level */
  const hoverPreviewLinesRef = useRef<any[]>([])
  const hoverPreviewKeyRef = useRef<string | null>(null)
  /** Axis / tooltip clocks — Montreal for every desk */
  const chartFmtRef = useRef<DeskChartFmt>(makeDeskChartFormatters('DOW'))
  /** Trader TZ for toChartTime — always America/Toronto */
  const chartTzRef = useRef(TRADER_DISPLAY_TZ)

  const clearHoverPreview = useCallback(() => {
    const host = priceLineHostRef.current
    hoverPreviewLinesRef.current.forEach((line) => {
      try {
        host?.removePriceLine(line)
      } catch {
        /* ignore */
      }
    })
    hoverPreviewLinesRef.current = []
    hoverPreviewKeyRef.current = null
  }, [])

  /** Active playbook range + magnets for strategy SL/TP (reads live range refs). */
  const getStrategyRiskBundle = useCallback((): {
    strategyRange: StrategyRangeEdges | null
    /** Locked playbook ±10 plus eligible overlays — CALL filters the edge. */
    snapRanges: StrategyRangeEdges[]
    ladder: ReturnType<typeof attemptLadderFromCounts>
    strategyMagnets: StrategyRiskMagnets
    call: DeskCall
  } => {
    const playbookMode = resolveDeskPlaybookMode({
      instrument,
      rangeStrategy,
      ladder: attemptLadderFromCounts({
        morningAttempts,
        ibAttempts,
        lunchAttempts,
        morningStopHits: stopHits,
        now: new Date(),
        instrument,
      }),
    })
    const swing = ibExtendRef.current?.swing ?? null
    let strategyRange = activeRangeForPlaybook({
      playbookMode,
      instrument,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      or15: or15RangeRef.current,
      morningAttempts,
    })
    if (strategyRange) {
      strategyRange = applyIbLiquiditySwingToRange(strategyRange, swing)
    }
    const eligible = applyIbLiquiditySwingToRanges(
      entryEligibleOverlayRanges({
        playbookMode,
        instrument,
        showOr30,
        showIb: showIbBreakouts,
        showUsRange,
        showOr15,
        or30: or30RangeRef.current,
        ib: ibLevels ?? ibRangeRef.current,
        usRange: usRangeRef.current,
        or15: or15RangeRef.current,
        morningAttempts,
      }),
      swing
    )
    // Always snap the locked playbook range — do not require OR30/IB/Lunch/US toggles.
    // ±10 right-scale tags still require the matching study (R / B / N / U).
    const snapRanges = studyEntrySnapRanges({
      active: strategyRange,
      overlays: eligible,
    })
    const ladder = attemptLadderFromCounts({
      morningAttempts,
      ibAttempts,
      lunchAttempts,
      morningStopHits: stopHits,
      now: new Date(),
      instrument,
    })
    const extras: number[] = []
    for (const r of [
      or30RangeRef.current,
      ibRangeRef.current,
      usRangeRef.current,
      or15RangeRef.current,
    ]) {
      if (!r || !(r.high > r.low)) continue
      if (
        strategyRange &&
        r.high === strategyRange.high &&
        r.low === strategyRange.low
      ) {
        continue
      }
      extras.push(r.high, r.low)
    }
    const list = candlesRef.current
    const lastBar = list.length ? (list[list.length - 1]!.time as number) : null
    const nowUnix = Math.floor(Date.now() / 1000)
    const call = computeDeskCall({
      instrument,
      candles: list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      asOfUnix: resolveDeskCallAsOfUnix(instrument, lastBar, nowUnix),
      playbookMode,
      attemptsUsed,
      bookLocked:
        attemptsUsed >= 3 || !!positionOverlay || !!pendingLimit,
      control: marketControlRef.current,
    })
    deskCallRef.current = call
    return {
      strategyRange,
      snapRanges,
      ladder,
      strategyMagnets: {
        avwap: avwapLastRef.current,
        extras,
      },
      call,
    }
  }, [
    instrument,
    rangeStrategy,
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    stopHits,
    showOr30,
    showIbBreakouts,
    showUsRange,
    showOr15,
    ibLevels,
    attemptsUsed,
    positionOverlay,
    pendingLimit,
  ])
  const getStrategyRiskBundleRef = useRef(getStrategyRiskBundle)
  getStrategyRiskBundleRef.current = getStrategyRiskBundle

  /** Open Limit risk box with entry locked to a painted ±10 band center. */
  const openRiskBox = useCallback(
    (
      preferredPrice?: number,
      opts?: {
        direction?: 'LONG' | 'SHORT'
        /**
         * Click-on-band: keep that painted edge center (H / L).
         * Prevents re-attribution from flipping a high/low click onto mid
         * when ranges overlap.
         */
        lockHit?: {
          center: number
          edge: 'high' | 'low' | 'mid'
          range: StrategyRangeEdges
        }
      }
    ) => {
      const { strategyRange, snapRanges, ladder, call, strategyMagnets } = getStrategyRiskBundle()
      const wait = assertDeskTicketEntry({
        useCall: useCallRef.current,
        call,
      })
      if (!wait.ok) {
        onDeskAlert?.({
          kind: 'entry_band_deny',
          title: 'CALL WAIT',
          body: wait.message,
          telegram: '',
          instrument,
        })
        return
      }
      const liveOk = (range: { label: string; high: number; low: number }) => {
        if (range.label === 'OR30') {
          return (
            !!strategyRange &&
            strategyRange.label === range.label &&
            strategyRange.high === range.high &&
            strategyRange.low === range.low
          )
        }
        return assertBucketEntryEligible({
          instrument,
          market: deskMarketFor(instrument),
          timeSec: deskClockSeconds(instrument),
          ladder,
          rangeLabel: range.label,
        }).ok
      }

      if (opts?.lockHit) {
        const { center, edge, range } = opts.lockHit
        if (!liveOk(range)) {
          const bucketCheck = assertBucketEntryEligible({
            instrument,
            market: deskMarketFor(instrument),
            timeSec: deskClockSeconds(instrument),
            ladder,
            rangeLabel: range.label,
          })
          onDeskAlert?.({
            kind: 'entry_band_deny',
            title: `${range.label || 'range'} entry closed`,
            body:
              range.label === 'OR15' || range.label === 'OR30'
                ? 'Open-range / OR30 ±10 window is closed — enter on the live next-range playbook when unlocked.'
                : bucketCheck.ok
                  ? RANGE_EDGE_OFF_BAND_MESSAGE
                  : bucketCheck.message,
            telegram: '',
            instrument,
          })
          return
        }
        const gated = assertDeskTicketEntry({
          useCall: useCallRef.current,
          call,
          edge,
        })
        if (!gated.ok) {
          onDeskAlert?.({
            kind: 'entry_band_deny',
            title: 'CALL blocks this edge',
            body: gated.message,
            telegram: '',
            instrument,
          })
          return
        }
        const entry = snapDeskPrice(instrument, center)
        const dir = gated.side
        const strat = strategyEntryRisk({
          entry,
          direction: dir,
          activeRange: range,
          magnets: strategyMagnets,
        })
        setRiskBox({
          direction: dir,
          orderType: 'LIMIT',
          entryPrice: entry,
          stopLoss: snapDeskPrice(instrument, strat.stop),
          profitTarget: snapDeskPrice(instrument, strat.target),
          preferRangeLabel: range.label ?? strategyRange?.label ?? null,
        })
        setRiskBoxActive(true)
        return
      }

      const rawPx =
        preferredPrice != null && Number.isFinite(preferredPrice) && preferredPrice > 0
          ? preferredPrice
          : livePrice || (candles.length > 0 ? candles[candles.length - 1]!.close : 67000)
      // Limit / place-near: snap to nearest live band center (in-band → that center).
      const snapped = snapEntryToNearestOpenBandCenter({
        entry: Number(rawPx),
        candidates: snapRanges,
        preferLabel: strategyRange?.label ?? null,
        liveOk,
      })
      if (!snapped) {
        // Prefer bucket / unlock copy over generic off-band when bands exist but aren't live.
        const hit = attributePlaybookBandEntry({
          entry: Number(rawPx),
          candidates: snapRanges,
          preferLabel: strategyRange?.label ?? null,
          liveOk,
        })
        let body = RANGE_EDGE_OFF_BAND_MESSAGE
        let title = 'Off-band entry'
        if (snapRanges.length === 0) {
          title = 'No entry bands'
          body = 'No live ±10 entry bands — wait for OR30 / IB to unlock.'
        } else if (hit) {
          if (hit.range.label === 'OR15' || hit.range.label === 'OR30') {
            title = `${hit.range.label} entry closed`
            body = 'Open-range / OR30 ±10 window is closed — enter on the live next-range playbook when unlocked.'
          } else {
            const bucketCheck = assertBucketEntryEligible({
              instrument,
              market: deskMarketFor(instrument),
              timeSec: deskClockSeconds(instrument),
              ladder,
              rangeLabel: hit.range.label,
            })
            if (!bucketCheck.ok) {
              title = `${hit.range.label} entry closed`
              body = bucketCheck.message
            }
          }
        }
        onDeskAlert?.({
          kind: 'entry_band_deny',
          title,
          body,
          telegram: '',
          instrument,
        })
        return
      }
      const gated = assertDeskTicketEntry({
        useCall: useCallRef.current,
        call,
        edge: snapped.hit.edge,
      })
      if (!gated.ok) {
        onDeskAlert?.({
          kind: 'entry_band_deny',
          title: 'CALL blocks this edge',
          body: gated.message,
          telegram: '',
          instrument,
        })
        return
      }
      const entry = snapDeskPrice(instrument, snapped.price)
      const dir = gated.side
      const strat = strategyEntryRisk({
        entry,
        direction: dir,
        activeRange: snapped.hit.range,
        magnets: strategyMagnets,
      })
      setRiskBox({
        direction: dir,
        orderType: 'LIMIT',
        entryPrice: entry,
        stopLoss: snapDeskPrice(instrument, strat.stop),
        profitTarget: snapDeskPrice(instrument, strat.target),
        preferRangeLabel: snapped.hit.range.label ?? strategyRange?.label ?? null,
      })
      setRiskBoxActive(true)
    },
    [livePrice, candles, instrument, getStrategyRiskBundle, onDeskAlert]
  )

  useEffect(() => {
    priceAlertInstrumentRef.current = instrument
    priceAlertPrimedRef.current = false
    prevLivePriceForAlertRef.current = null
    setPriceAlert(loadStoredPriceAlert(instrument))
  }, [instrument])

  useEffect(() => {
    if (priceAlertInstrumentRef.current !== instrument) return
    saveStoredPriceAlert(instrument, priceAlert)
  }, [priceAlert, instrument])

  const clearPriceAlertLine = useCallback(() => {
    const host = priceLineHostRef.current
    if (host && priceAlertLineRef.current) {
      try {
        host.removePriceLine(priceAlertLineRef.current)
      } catch {
        /* silent */
      }
    }
    priceAlertLineRef.current = null
  }, [])

  const dismissPriceAlert = useCallback(() => {
    setPriceAlert(null)
    clearPriceAlertLine()
    priceAlertPrimedRef.current = false
    prevLivePriceForAlertRef.current = null
  }, [clearPriceAlertLine])

  const openPriceAlert = useCallback(() => {
    const rawPx =
      livePrice != null && Number.isFinite(livePrice) && livePrice > 0
        ? livePrice
        : candles.length > 0
          ? candles[candles.length - 1]!.close
          : null
    if (rawPx == null || !Number.isFinite(Number(rawPx)) || Number(rawPx) <= 0) return
    const price = snapDeskPrice(instrument, Number(rawPx))
    priceAlertPrimedRef.current = false
    prevLivePriceForAlertRef.current = null
    // Always pendingAway on create — place-at-spot must not fire until price leaves.
    setPriceAlert({ price, armed: true, pendingAway: true })
  }, [livePrice, candles, instrument])

  const togglePriceAlert = useCallback(() => {
    if (priceAlert) {
      dismissPriceAlert()
    } else {
      openPriceAlert()
    }
  }, [priceAlert, dismissPriceAlert, openPriceAlert])

  // Recompute focus tabs on a short clock so NY names update at open − 30m without refresh.
  // Clock-gated UI must NOT run during the hydrate render (Railway TZ ≠ browser → React #418).
  const [focusTick, setFocusTick] = useState(0)
  const [clockReady, setClockReady] = useState(false)
  const [, setDeskSessionLive] = useState(false)
  const [visibleInstruments, setVisibleInstruments] = useState<Instrument[]>(() => {
    if (allowedInstruments && allowedInstruments.length > 0) {
      return allowedInstruments as Instrument[]
    }
    return ['DOW', 'NASDAQ', 'GOLD', 'CRUDE', 'NIKKEI']
  })

  useEffect(() => {
    const id = window.setInterval(() => setFocusTick((n) => n + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const now = new Date()
    setClockReady(true)
    setDeskSessionLive(isLiveTradingPageOpen(now))
    const live = [
      ...liveVisibleInstruments(now, {
        lockedInstrument,
        clockedIn: deskAttended,
        attendedToday: deskAttended,
      }),
      'NIKKEI',
    ] as Instrument[]
    if (allowedInstruments && allowedInstruments.length > 0) {
      const fromGate = allowedInstruments.filter((i) => live.includes(i as Instrument)) as Instrument[]
      setVisibleInstruments(fromGate.length > 0 ? fromGate : live)
      return
    }
    setVisibleInstruments(live)
  }, [allowedInstruments, lockedInstrument, focusTick, deskAttended])

  /** Tip/SSE: pre-open focus free; after open / afternoon only if attended */
  const tipStreamActive = useMemo(() => {
    if (!clockReady) return false
    void focusTick
    return isLiveTipStreamAllowed(instrument, new Date(), {
      attendedToday: deskAttended,
      clockedIn: deskAttended,
    }).open
  }, [instrument, deskAttended, focusTick, clockReady])

  const setInstrument = useCallback((inst: Instrument) => {
    if (!visibleInstruments.includes(inst)) return
    setInstrumentState(inst)
    // Free-switch: remember any board tab (indexes + gold/crude/nikkei).
    if (
      inst === 'DOW' ||
      inst === 'NASDAQ' ||
      inst === 'GOLD' ||
      inst === 'CRUDE' ||
      inst === 'NIKKEI'
    ) {
      setDeskInstrumentPreference(inst)
    }
    onInstrumentChange?.(inst)
  }, [onInstrumentChange, visibleInstruments])

  useEffect(() => {
    setInstrumentState((prev) => {
      const next = resolveClockedChartInstrument({
        locked: lockedInstrument,
        viewing: prev,
        visible: visibleInstruments,
      }) as Instrument
      if (next !== prev) onInstrumentSync?.(next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedInstrument, visibleInstruments.join('|')])

  const jumpMarkerRef = useRef<any | null>(null)

  // Register jumpToPrice so level clicks can scroll/highlight on the chart.
  // Do NOT open the order ticket here — that must carry BUY/SHORT meta.
  useEffect(() => {
    if (!jumpToPriceRef) return
    jumpToPriceRef.current = (price: number) => {
      if (!candleRef.current) return
      try {
        if (jumpMarkerRef.current) {
          try {
            candleRef.current.removePriceLine(jumpMarkerRef.current)
          } catch {
            /* ignore */
          }
          jumpMarkerRef.current = null
        }
        const marker = candleRef.current.createPriceLine({
          price,
          color: '#ffffff40',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '→ ' + price.toLocaleString('en-US', { minimumFractionDigits: 0 }),
        })
        jumpMarkerRef.current = marker
        setTimeout(() => {
          try {
            if (jumpMarkerRef.current === marker) {
              candleRef.current?.removePriceLine(marker)
              jumpMarkerRef.current = null
            }
          } catch { }
        }, 3000)
      } catch { }
    }
    return () => {
      jumpToPriceRef.current = null
    }
  }, [jumpToPriceRef])

  const meta = INSTRUMENT_META[instrument]

  // ── Load levels — SAME pipeline as the simulation desk (shared deskLevels) ───
  const loadLevels = useCallback(async (inst: Instrument, freshCandles?: OHLCV[]) => {
    // No attendance / wrong desk / outside that instrument's level window → clear (never keep NY paint on NIKKEI)
    if (!deskLevelsActive || !isLevelPaintAllowed(new Date(), inst).open) {
      if (instrumentRef.current === inst) {
        setLevels([])
        setPlaybookOpen(false)
      }
      return
    }
    if (SYSTEMATIC_LIVE_DESK) {
      if (instrumentRef.current === inst) {
        setLevels([])
        setPlaybookOpen(false)
      }
      return
    }

    const playbookMode = resolveDeskPlaybookMode({
      instrument: inst,
      rangeStrategy,
      ladder: attemptLadderFromCounts({
        morningAttempts,
        ibAttempts,
        lunchAttempts,
        morningStopHits: stopHits,
      }),
    })
    const useAfternoonLevels = deskPlaybookUsesAfternoonLevels(playbookMode)
    const byPrice = new Map<number, LevelLine>()

    let aiRows: unknown[] = []
    let afternoonCandidates: unknown[] = []

    const aiPromise = fetch(aiLevelsUrl(inst))
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.levels) aiRows = json.levels
      })
      .catch(() => {})

    const afternoonPromise = useAfternoonLevels
      ? fetch(`/api/trading/afternoon-playbook?instrument=${encodeURIComponent(inst)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (Array.isArray(json?.candidates)) afternoonCandidates = json.candidates
          })
          .catch(() => {})
      : Promise.resolve()

    await Promise.all([aiPromise, afternoonPromise])

    // Structure / IB anchored at this market's cash open (yesterday range)
    const sess = sessionFor(inst)
    const todayLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: sess.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const [oh, om] = sess.marketOpen.split(':').map(Number)
    const openUnix = nyDateTimeToUnix(todayLocal, oh!, om || 0)
    const barsForFallback = (freshCandles ?? candlesRef.current).map((c) => ({
      ...c,
      time: c.time as number,
    }))
    const tip =
      lastCandleRef.current?.close ??
      (barsForFallback.length
        ? barsForFallback[barsForFallback.length - 1]!.close
        : null)

    // Morning: conviction rank. IB / lunch-break / lunch-range / watch: afternoon merge (+ IB H/L).
    const resolved = useAfternoonLevels
      ? resolveAfternoonDeskLevels(
        aiRows,
        afternoonCandidates,
        barsForFallback,
        openUnix,
        sess.tz,
        tip
      )
      : resolveDeskLevels(aiRows, barsForFallback, openUnix, sess.tz, 'none')

    for (const l of resolved.levels) {
      const side: 'BUY' | 'SHORT' =
        l.side === 'BUY' || l.side === 'SHORT'
          ? l.side
          : String(l.type).toLowerCase().includes('resist')
            ? 'SHORT'
            : 'BUY'
      const isRes = side === 'SHORT'
      const stars = Math.max(1, Math.min(5, Math.round((l.conviction || 5) / 2)))
      const starLabel = `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`
      const rank = l.rank === 'watch' ? 'WATCH' : 'PRIMARY'
      const status = reactionStatus(l.marketVerdict, l.marketOutcome)
      const watchTag =
        playbookMode === 'us_range'
          ? 'US · '
          : playbookMode === 'or30'
            ? '30 · '
            : playbookMode === 'ib' || playbookMode === 'lunch_break'
              ? 'IB · '
              : ''
      byPrice.set(l.level, {
        price: l.level,
        type: isRes ? 'resistance' : 'support',
        side,
        status,
        conviction: l.conviction,
        reasoning: l.reasoning,
        source: l.source,
        marketVerdict: l.marketVerdict,
        marketOutcome: l.marketOutcome,
        testedCount: l.testedCount,
        successCount: l.successCount,
        label: `${watchTag}${rank} ${side} ${starLabel} · ${l.level.toLocaleString()}`,
      })
    }

    // Keep playbook order (primary focus first), not price sort
    // Ignore stale responses after the user switched instruments
    if (instrumentRef.current !== inst) return

    const strategyRangeRaw = activeRangeForPlaybook({
      playbookMode,
      instrument: inst,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      or15: or15RangeRef.current,
      morningAttempts,
    })
    const strategyRange = strategyRangeRaw
      ? applyIbLiquiditySwingToRange(strategyRangeRaw, ibExtendRef.current?.swing)
      : null
    const built = resolved.levels
      .map((l) => byPrice.get(l.level)!)
      .filter(Boolean) as LevelLine[]

    let actionable = built
    let bandMsg: string | null = null
    if (strategyRange) {
      const inBand = filterLevelsInRangeEdgeBand(built, strategyRange)
      if (built.length > 0 && inBand.length === 0) {
        bandMsg = NO_IN_BAND_LEVELS_MESSAGE
        actionable = []
      } else {
        actionable = preferLevelsWithRangeEdgeTail(
          inBand,
          strategyRange,
          rangeTailsRef.current
        )
      }
    }

    setLevels(actionable)
    setNoInBandLevelsMessage(bandMsg)
    // Playbook / level cards stay closed until the trader hits Playbook (P).
    // Still refresh the book in the background.
  }, [deskLevelsActive, rangeStrategy, morningAttempts, ibAttempts, lunchAttempts, stopHits])

  // Candle loading must not restart whenever level-attempt state changes and
  // recreates loadLevels. Keep the latest level loader behind a stable ref.
  const loadLevelsRef = useRef(loadLevels)
  useEffect(() => {
    loadLevelsRef.current = loadLevels
  }, [loadLevels])

  // Chart axis / tooltips always Montreal — desk logic stays on instrument clock.
  // Candle setData shifts unix → chart time; tickMarkFormatter reads UTC comps.
  useEffect(() => {
    chartFmtRef.current = makeDeskChartFormatters(instrument, timeframe)
    chartTzRef.current = TRADER_DISPLAY_TZ
    const chart = chartRef.current
    if (!chart) return
    const width = containerRef.current?.clientWidth ?? 900
    const spacing = deskBarSpacing(width, candlesRef.current.length, timeframe)
    chart.applyOptions({
      localization: {
        timeFormatter: (time: Time) =>
          chartFmtRef.current.timeFormatter(time),
      },
      timeScale: {
        timeVisible: timeframe !== '1D',
        secondsVisible: false,
        barSpacing: spacing,
      },
    })
  }, [instrument, timeframe])

  // Grade market reaction into level_history, then reload playbook (no LLM).
  // If a level breaks/contests, force a Level Finder refresh (throttled) so AI
  // levels adapt — does not consume attempt-ladder slots.
  const reactionRefreshAtRef = useRef(0)
  const gradeLevels = useCallback(async (inst: Instrument) => {
    if (!deskLevelsActive || !isLevelPaintAllowed(new Date(), inst).open) {
      if (instrumentRef.current === inst) {
        setLevels([])
        setPlaybookOpen(false)
      }
      return
    }
    let needsAiRefresh = false
    try {
      const res = await fetch('/api/levels/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument: inst,
          trigger: isAfternoonWatchWindow(new Date(), inst)
            ? 'afternoon'
            : 'cadence',
        }),
      })
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as {
          verdicts?: Array<{ verdict?: string }>
        } | null
        const verdicts = json?.verdicts ?? []
        needsAiRefresh = verdicts.some(
          (v) => v.verdict === 'broken' || v.verdict === 'contested'
        )
      }
    } catch {
      /* non-fatal — still try to paint last known verdicts */
    }

    if (needsAiRefresh) {
      const nowMs = Date.now()
      // At most one Opus refresh every 5 minutes per chart session
      if (nowMs - reactionRefreshAtRef.current >= 5 * 60_000) {
        reactionRefreshAtRef.current = nowMs
        const playbookMode = resolveDeskPlaybookMode({
          instrument: inst,
          rangeStrategy,
          ladder: attemptLadderFromCounts({
            morningAttempts,
            ibAttempts,
            lunchAttempts,
            morningStopHits: stopHits,
          }),
        })
        const mode = deskPlaybookAnalysisMode(playbookMode, inst)
        try {
          await fetch(
            `/api/trading/auto-levels?instrument=${encodeURIComponent(inst)}&force=1&mode=${encodeURIComponent(mode)}`,
            { method: 'POST' }
          )
        } catch {
          /* non-fatal */
        }
      }
    }

    await loadLevels(inst)
  }, [
    loadLevels,
    deskLevelsActive,
    rangeStrategy,
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    stopHits,
  ])

  // ── Initialize chart ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const themeOpts = getDeskChartThemeOptions(chartThemeMode)
    const chart = createChart(containerRef.current, {
      ...CHART_THEME,
      ...themeOpts,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      localization: {
        timeFormatter: (time: Time) =>
          chartFmtRef.current.timeFormatter(time),
      },
      timeScale: {
        ...CHART_THEME.timeScale,
        tickMarkFormatter: (
          time: Time,
          tickMarkType: TickMarkType,
        ) => chartFmtRef.current.tickMarkFormatter(time, tickMarkType),
      },
    })

    // ─── 1. Candlestick series on the main 'right' price scale ────────────────
    // Autoscale from VISIBLE candles on screen ONLY — distantly historical bars or orphan level lines
    // must never flatten candles to tiny micro-lines.
    // lightweight-charts re-asks for this on every render pass; recomputing the
    // visible-bar scan each time is the single biggest allocator during a pan.
    let scaleCacheList: OHLCV[] | null = null
    let scaleCacheKey = ''
    let scaleCacheBounds: { min: number; max: number } | null = null

    const candleAutoscale = () => {
      const list = candlesRef.current
      if (!list.length) return null

      let startIndex = 0
      let endIndex = list.length - 1
      try {
        const range = chart.timeScale().getVisibleLogicalRange()
        if (range) {
          startIndex = Math.max(0, Math.floor(range.from))
          endIndex = Math.min(list.length - 1, Math.ceil(range.to))
        } else {
          startIndex = Math.max(0, list.length - 60)
        }
      } catch {
        startIndex = Math.max(0, list.length - 60)
      }

      const edge = list[endIndex]
      const cacheKey =
        `${startIndex}|${endIndex}|${list.length}|${instrumentRef.current}` +
        `|${edge ? `${edge.time}:${edge.high}:${edge.low}` : ''}`
      if (scaleCacheList === list && scaleCacheKey === cacheKey && scaleCacheBounds) {
        return paddedCandlePriceRange(scaleCacheBounds.min, scaleCacheBounds.max)
      }

      let min = Infinity
      let max = -Infinity
      const visibleBars: Array<{ time: number; high: number; low: number }> = []
      for (let i = startIndex; i <= endIndex; i++) {
        const c = list[i]
        if (c) {
          visibleBars.push({ time: c.time as number, high: c.high, low: c.low })
          if (Number.isFinite(c.low) && c.low > 0) min = Math.min(min, c.low)
          if (Number.isFinite(c.high) && c.high > 0) max = Math.max(max, c.high)
        }
      }

      if (timeframe !== '1D') {
        const session = sessionFocusHighLow(visibleBars, instrumentRef.current)
        if (session) {
          min = session.min
          max = session.max
        }
      }

      scaleCacheList = list
      scaleCacheKey = cacheKey
      scaleCacheBounds = { min, max }
      return paddedCandlePriceRange(min, max)
    }

    const candleSeries = chart.addCandlestickSeries({
      upColor: DESK_CANDLE_UP,
      downColor: DESK_CANDLE_DOWN,
      borderUpColor: DESK_CANDLE_UP,
      borderDownColor: DESK_CANDLE_DOWN,
      wickUpColor: DESK_CANDLE_UP,
      wickDownColor: DESK_CANDLE_DOWN,
      borderVisible: false,
      wickVisible: true,
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dotted,
      priceFormat: deskCandlePriceFormat(instrumentRef.current),
      autoscaleInfoProvider: candleAutoscale,
    })

    const ignoreScale = lockToCandleAutoscale(candleAutoscale)

    const priceLineHost = chart.addLineSeries({
      color: 'rgba(0,0,0,0)',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceScaleId: 'right',
      ...ignoreScale,
    })

    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.78,   // bars occupy bottom 22% of chart (was 18%)
        bottom: 0,
      },
      visible: true,
      borderVisible: false,
      textColor: 'rgba(180, 180, 180, 0.65)',
    })
    volumeSeriesRef.current = volumeSeries

    // Anchored VWAP + ±1/±2/±3σ bands (from NY 9:30 of 5 trading days ago)
    const bandOpts = {
      color: VWAP_COLORS.band,
      lineWidth: 1 as const,
      priceLineVisible: false,
      lastValueVisible: false,
      pointMarkersVisible: false,
      crosshairMarkerVisible: false,
      ...ignoreScale,
    }
    const vwapSeries = {
      upper3: chart.addLineSeries({
        ...bandOpts,
        lineStyle: LineStyle.Dashed,
        color: 'rgba(239, 68, 68, 0.35)',
        title: '+3σ Ext',
      }),
      upper2: chart.addLineSeries({
        ...bandOpts,
        color: 'rgba(59, 130, 246, 0.5)',
        title: '+2σ',
      }),
      upper1: chart.addLineSeries({ ...bandOpts, color: '#3b82f6', lineWidth: 2, lastValueVisible: false, title: '+1σ' }),
      vwap: chart.addLineSeries({
        color: '#10b981',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        pointMarkersVisible: false,
        crosshairMarkerVisible: false,
        title: 'AVWAP',
        ...ignoreScale,
      }),
      lower1: chart.addLineSeries({ ...bandOpts, color: '#b8a04a', lineWidth: 2, lastValueVisible: false, title: '-1σ' }),
      lower2: chart.addLineSeries({
        ...bandOpts,
        color: 'rgba(184, 160, 74, 0.5)',
        title: '-2σ',
      }),
      lower3: chart.addLineSeries({
        ...bandOpts,
        lineStyle: LineStyle.Dashed,
        color: 'rgba(16, 185, 129, 0.35)',
        title: '-3σ Ext',
      }),
    }

    // News Catalyst Anchored VWAP + ±1/±2/±3σ bands
    const newsBandOpts = {
      lineWidth: 1 as const,
      priceLineVisible: false,
      lastValueVisible: true,
      pointMarkersVisible: false,
      crosshairMarkerVisible: false,
      ...ignoreScale,
    }
    const newsVwapSeries = {
      upper3: chart.addLineSeries({
        ...newsBandOpts,
        lineStyle: LineStyle.LargeDashed,
        color: 'rgba(244, 63, 94, 0.85)',
        title: 'News +3σ',
      }),
      upper2: chart.addLineSeries({
        ...newsBandOpts,
        lineStyle: LineStyle.Dashed,
        color: 'rgba(251, 146, 60, 0.85)',
        title: 'News +2σ',
      }),
      upper1: chart.addLineSeries({
        ...newsBandOpts,
        lineStyle: LineStyle.Dashed,
        color: 'rgba(250, 204, 21, 0.9)',
        title: 'News +1σ',
      }),
      vwap: chart.addLineSeries({
        ...newsBandOpts,
        color: '#f59e0b',
        lineWidth: 2 as const,
        lineStyle: LineStyle.Solid,
        title: 'News AVWAP',
      }),
      lower1: chart.addLineSeries({
        ...newsBandOpts,
        lineStyle: LineStyle.Dashed,
        color: 'rgba(250, 204, 21, 0.9)',
        title: 'News -1σ',
      }),
      lower2: chart.addLineSeries({
        ...newsBandOpts,
        lineStyle: LineStyle.Dashed,
        color: 'rgba(251, 146, 60, 0.85)',
        title: 'News -2σ',
      }),
      lower3: chart.addLineSeries({
        ...newsBandOpts,
        lineStyle: LineStyle.LargeDashed,
        color: 'rgba(244, 63, 94, 0.85)',
        title: 'News -3σ',
      }),
    }

    // Initial Balance — right-scale H/L labels hidden
    const ibLineOpts = {
      color: '#3b82f6',
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      lineVisible: false,
      pointMarkersVisible: false,
      crosshairMarkerVisible: false,
      ...ignoreScale,
    }
    const ibSeries = {
      high: chart.addLineSeries({ ...ibLineOpts, title: '' }),
      low: chart.addLineSeries({ ...ibLineOpts, title: '' }),
    }

    // Open range (first 15m) — amber H/L
    const or15LineOpts = {
      color: OR15_COLORS.high,
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      lineVisible: false,
      pointMarkersVisible: false,
      crosshairMarkerVisible: false,
      ...ignoreScale,
    }
    const lunchSeries = {
      high: chart.addLineSeries({ ...or15LineOpts, title: 'OR15 H' }),
      low: chart.addLineSeries({ ...or15LineOpts, title: 'OR15 L' }),
    }

    // Nikkei — US session range H/L (Asia breakout / rejection script)
    const usRangeLineOpts = {
      color: NIKKEI_US_RANGE_COLORS.high,
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      lineVisible: false,
      pointMarkersVisible: false,
      crosshairMarkerVisible: false,
      ...ignoreScale,
    }
    const usRangeSeries = {
      high: chart.addLineSeries({ ...usRangeLineOpts, title: 'US H' }),
      low: chart.addLineSeries({ ...usRangeLineOpts, title: 'US L' }),
    }

    // Opening range 30m H/L — NY 09:30–10:00 ET / Tokyo 09:00–09:30 JST
    const or30LineOpts = {
      color: OR30_COLORS.high,
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      lineVisible: false,
      pointMarkersVisible: false,
      crosshairMarkerVisible: false,
      ...ignoreScale,
    }
    const or30Series = {
      high: chart.addLineSeries({ ...or30LineOpts, title: 'OR30 H' }),
      low: chart.addLineSeries({ ...or30LineOpts, title: 'OR30 L' }),
    }

    // Full chart height — no volume so no bottom margin needed
    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: DESK_CHART_THEME.rightPriceScale.scaleMargins,
      borderVisible: true,
    })

    // ─── 2. Crosshair tooltip — skip entirely while panning (React setState kills FPS)
    let tipRaf = 0
    let tipPending: TooltipData | null | undefined
    chart.subscribeCrosshairMove((param) => {
      if (interactingRef.current) {
        if (tipPending !== null) {
          tipPending = null
          if (!tipRaf) {
            tipRaf = requestAnimationFrame(() => {
              tipRaf = 0
              setTooltip(null)
            })
          }
        }
        return
      }
      if (!param?.seriesData?.size || param.point === undefined) {
        tipPending = null
        setSyncCrosshair(null)
        if (cachedCvdBarsRef.current.length > 0) {
          const lastCvd = cachedCvdBarsRef.current[cachedCvdBarsRef.current.length - 1]
          if (lastCvd) {
            setCurrentCvdLegend({
              open: Math.round(lastCvd.open),
              high: Math.round(lastCvd.high),
              low: Math.round(lastCvd.low),
              close: Math.round(lastCvd.close),
            })
          }
        }
      } else {
        const candle = param.seriesData.get(candleSeries) as CandlestickData | undefined
        if (!candle) {
          tipPending = null
          setSyncCrosshair(null)
        } else {
          const open = (candle as any).open ?? 0
          const close = (candle as any).close ?? 0
          const change = close - open
          const fmt = chartFmtRef.current
          const barTime = param.time
          const barUnix = chartTimeToUnix(barTime)
          const list = candlesRef.current
          const tz = chartTzRef.current
          const matchedBar =
            timeframe === '1D'
              ? list.find((b) => snapDailyUnix(b.time as number) === snapDailyUnix(barUnix))
              : list.find((b) => toChartTime(b.time as number, tz) === barUnix)
          const barVol = matchedBar?.volume ?? (candle as any).volume ?? 0

          // Lookup matching CVD bar for this exact candle timestamp (supports BusinessDay on 1D)
          const matchingCvd = cachedCvdBarsRef.current.find((b) => isSameChartTime(b.time, param.time))
          const cvdClose = matchingCvd ? Math.round(matchingCvd.close) : undefined
          const cvdOpen = matchingCvd ? Math.round(matchingCvd.open) : undefined
          const cvdDelta = cvdClose != null && cvdOpen != null ? cvdClose - cvdOpen : undefined

          if (matchingCvd) {
            setCurrentCvdLegend({
              open: cvdOpen!,
              high: Math.round(matchingCvd.high),
              low: Math.round(matchingCvd.low),
              close: cvdClose!,
            })
          }

          const timeStr = param.time
            ? (timeframe === '1D'
                ? `${fmt.formatDate(barUnix, 'day')}`
                : `${fmt.formatTime(barUnix)} ${fmt.tzLabel}`)
            : ''

          tipPending = {
            time: timeStr,
            open: (candle as any).open,
            high: (candle as any).high,
            low: (candle as any).low,
            close: (candle as any).close,
            volume: barVol,
            change,
            changePct: open !== 0 ? (change / open) * 100 : 0,
            cvd: cvdClose,
            barDelta: cvdDelta,
          }

          if (param.point) {
            setSyncCrosshair({
              x: param.point.x,
              timeStr,
            })
          }
        }
      }
      if (tipRaf) return
      tipRaf = requestAnimationFrame(() => {
        tipRaf = 0
        setTooltip(tipPending === undefined ? null : tipPending)
        tipPending = undefined
      })
    })

    chartRef.current = chart
    candleRef.current = candleSeries
    priceLineHostRef.current = priceLineHost
    vwapSeriesRef.current = vwapSeries
    newsVwapSeriesRef.current = newsVwapSeries
    ibSeriesRef.current = ibSeries
    or15SeriesRef.current = lunchSeries
    usRangeSeriesRef.current = usRangeSeries
    or30SeriesRef.current = or30Series
    setChartReady(true)

    const updateCvdUnderCursor = () => {
      if (lastPointerPosRef.current && containerRef.current && chartRef.current && candleRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const x = lastPointerPosRef.current.x - rect.left
        if (x >= 0 && x <= rect.width) {
          const logical = chartRef.current.timeScale().coordinateToLogical(x)
          if (logical != null) {
            const candle = candleRef.current.dataByIndex(Math.round(logical)) as CandlestickData | null
            if (candle && candle.time) {
              const matchingCvd = cachedCvdBarsRef.current.find((b) => isSameChartTime(b.time, candle.time))
              if (matchingCvd) {
                const cClose = Math.round((matchingCvd as any).close ?? 0)
                const cOpen = Math.round((matchingCvd as any).open ?? 0)
                setCurrentCvdLegend({
                  open: cOpen,
                  high: Math.round((matchingCvd as any).high ?? 0),
                  low: Math.round((matchingCvd as any).low ?? 0),
                  close: cClose,
                })
              }
            }
          }
        }
      }
    }

    // Sync overlay coordinates on chart scroll/zoom — immediate execution for 0-lag 60fps tracking
    const onScroll = () => {
      pokeOverlayLayoutRef.current()
      syncCvdFromMainRef.current()
      paintFrvpHistogramRef.current?.()
      paintExcessesAndRoundedRef.current?.()
      paintUserDrawingsRef.current?.()
      paintNewsMarkersRef.current?.()
      updateCvdUnderCursor()
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onScroll)

    // Responsive resize — re-stick SL/TP after zoom / fullscreen
    let lastRoWidth = 0
    let lastRoHeight = 0
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        const w = containerRef.current.clientWidth
        const h = containerRef.current.clientHeight
        if (Math.abs(w - lastRoWidth) < 1 && Math.abs(h - lastRoHeight) < 1) {
          return
        }
        lastRoWidth = w
        lastRoHeight = h
        const dragging =
          draggingRiskLineRef.current ||
          draggingBracketRef.current ||
          draggingWorkingBracketRef.current
        if (!dragging) {
          ignorePriceFromPointerUntilRef.current = Date.now() + 80
        }
        chartRef.current.resize(w, h)
        pokeOverlayLayoutRef.current()
        paintFrvpHistogramRef.current?.()
        paintExcessesAndRoundedRef.current?.()
        paintUserDrawingsRef.current?.()
        paintNewsMarkersRef.current?.()
        refreshSessionHighlights()
      }
    })
    ro.observe(containerRef.current)

    // Intercept wheel events across the entire chart wrapper (toolbar, main chart, volume bars at bottom, time scale, sub-panes)
    // to prevent browser page bounce/shaking and zoom the chart time scale seamlessly
    const onChartWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!chartRef.current) return
      const delta = e.deltaY
      if (Math.abs(delta) < 1) return
      const ts = chartRef.current.timeScale()
      try {
        const range = ts.getVisibleLogicalRange()
        if (range) {
          const factor = delta > 0 ? 0.08 : -0.08
          const width = range.to - range.from
          const change = width * factor
          const newFrom = range.from - change / 2
          const newTo = range.to + change / 2
          if (newTo - newFrom > 2) {
            ts.setVisibleLogicalRange({ from: newFrom, to: newTo })
            pokeOverlayLayoutRef.current()
            relinkCvdToPriceRef.current()
            paintFrvpHistogramRef.current?.()
            paintExcessesAndRoundedRef.current?.()
            paintUserDrawingsRef.current?.()
            paintNewsMarkersRef.current?.()
            updateCvdUnderCursor()
          }
        }
      } catch {
        /* ignore */
      }
    }

    const wrapperEl = outerWrapperRef.current
    const headerEl = chartHeaderRef.current
    const frameEl = chartFrameRef.current

    wrapperEl?.addEventListener('wheel', onChartWheel, { passive: false })
    headerEl?.addEventListener('wheel', onChartWheel, { passive: false })
    frameEl?.addEventListener('wheel', onChartWheel, { passive: false })

    const onPricePointer = () => {
      relinkCvdToPriceRef.current()
      pokeOverlayLayoutRef.current()
    }
    const onPointerMove = (e: MouseEvent) => {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY }
    }
    const onPointerLeave = () => {
      lastPointerPosRef.current = null
    }
    containerRef.current.addEventListener('mousemove', onPointerMove, { passive: true })
    containerRef.current.addEventListener('mouseleave', onPointerLeave)
    containerRef.current.addEventListener('mousedown', onPricePointer)

    return () => {
      ro.disconnect()
      wrapperEl?.removeEventListener('wheel', onChartWheel)
      headerEl?.removeEventListener('wheel', onChartWheel)
      frameEl?.removeEventListener('wheel', onChartWheel)
      containerRef.current?.removeEventListener('mousemove', onPointerMove)
      containerRef.current?.removeEventListener('mouseleave', onPointerLeave)
      containerRef.current?.removeEventListener('mousedown', onPricePointer)
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onScroll)
      } catch { }
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeSeriesRef.current = null
      priceLineHostRef.current = null
      priceLineHostSeededRef.current = false
      vwapSeriesRef.current = null
      newsVwapSeriesRef.current = null
      ibSeriesRef.current = null
      or15SeriesRef.current = null
      usRangeSeriesRef.current = null
      or30SeriesRef.current = null
      levelLinesRef.current = []
      positionLinesRef.current = []
      setIbShaped(false)
      setIbLevels(null)
      setOr15Shaped(false)
      setOr15Locked(false)
      setUsRangeShaped(false)
      setOr30Shaped(false)
      setOr30Locked(false)
    }
  }, []) // initialize once only

  // ── Initialize CVD Sub-Chart Pane (Created once, instantly toggled via CSS) ──────────
  useEffect(() => {
    if (!cvdContainerRef.current) return

    const cvdContainer = cvdContainerRef.current
    if (!cvdChartRef.current) {
      const themeOpts = getDeskChartThemeOptions(chartThemeMode)
      const cvdChart = createChart(cvdContainer, {
        ...CHART_THEME,
        ...themeOpts,
        width: cvdContainer.clientWidth || 800,
        height: cvdSubPaneHeight,
        layout: {
          background: { color: '#0b0e14' },
          textColor: '#94a3b8',
        },
        grid: {
          vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
          horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        // Same timezone-aware formatters as the main price chart — prevents the CVD
        // time axis from displaying raw UTC while the price chart shows desk wall clock.
        localization: {
          timeFormatter: (time: Time) =>
            chartFmtRef.current.timeFormatter(time),
        },
        timeScale: {
          ...CHART_THEME.timeScale,
          visible: true,
          timeVisible: true,
          secondsVisible: false,
          borderVisible: true,
          borderColor: '#1e293b',
          tickMarkFormatter: (
            time: Time,
            tickMarkType: TickMarkType,
          ) => chartFmtRef.current.tickMarkFormatter(time, tickMarkType),
        },
        rightPriceScale: {
          borderVisible: true,
          borderColor: '#1e293b',
          autoScale: true,
          minimumWidth: 82, // EXACT MATCH TO MAIN PRICE CHART AXIS WIDTH (82px)
          scaleMargins: {
            top: 0.15,
            bottom: 0.15,
          },
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: { time: true, price: true },
          axisDoubleClickReset: { time: true, price: true },
          mouseWheel: true,
          pinch: true,
        },
      })
      cvdChartRef.current = cvdChart

      // High-Contrast Vivid Cumulative Volume Delta Candlesticks with Crisp Borders
      const cvdSeries = cvdChart.addCandlestickSeries({
        upColor: '#06b6d4',          // Vibrant Cyan (Aggressive Buyer Delta)
        downColor: '#f43f5e',        // Vivid Rose (Aggressive Seller Delta)
        borderVisible: true,
        borderUpColor: '#22d3ee',    // Bright Crisp Cyan Border
        borderDownColor: '#fb7185',  // Bright Crisp Rose Border
        wickUpColor: '#67e8f9',      // Luminous Cyan Wick
        wickDownColor: '#fda4af',    // Luminous Rose Wick
        priceFormat: {
          type: 'volume',
          precision: 0,
        },
      })
      cvdCandleSeriesRef.current = cvdSeries

      try {
        cvdSeries.createPriceLine({
          price: 0,
          color: 'rgba(56, 189, 248, 0.55)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '0 Δ (Baseline)',
        })
      } catch {}

      const onCrosshairMove = (param: any) => {
        if (!param || !param.point || !param.time) {
          setSyncCrosshair(null)
          return
        }
        const priceData = (param.seriesData?.get(cvdSeries) ?? param.seriesPrices?.get(cvdSeries)) as CandlestickData | undefined
        const matchingCvd = priceData ?? cachedCvdBarsRef.current.find((b) => isSameChartTime(b.time, param.time))
        if (matchingCvd && typeof matchingCvd === 'object') {
          const cClose = Math.round((matchingCvd as any).close ?? 0)
          const cOpen = Math.round((matchingCvd as any).open ?? 0)
          setCurrentCvdLegend({
            open: cOpen,
            high: Math.round((matchingCvd as any).high ?? 0),
            low: Math.round((matchingCvd as any).low ?? 0),
            close: cClose,
          })
        }

        // Match price candle and sync main chart tooltip & crosshair position!
        const barUnix = chartTimeToUnix(param.time)
        const tz = chartTzRef.current
        const matchedPriceBar =
          timeframe === '1D'
            ? candlesRef.current.find((b) => snapDailyUnix(b.time as number) === snapDailyUnix(barUnix))
            : candlesRef.current.find((b) => toChartTime(b.time as number, tz) === barUnix)
        if (matchedPriceBar) {
          const fmt = chartFmtRef.current
          const open = matchedPriceBar.open
          const close = matchedPriceBar.close
          const change = close - open
          const cvdClose = matchingCvd ? Math.round((matchingCvd as any).close ?? 0) : undefined
          const cvdOpen = matchingCvd ? Math.round((matchingCvd as any).open ?? 0) : undefined
          const cvdDelta = cvdClose != null && cvdOpen != null ? cvdClose - cvdOpen : undefined
          setTooltip({
            time: timeframe === '1D'
              ? `${fmt.formatDate(barUnix, 'day')}`
              : `${fmt.formatTime(barUnix)} ${fmt.tzLabel}`,
            open,
            high: matchedPriceBar.high,
            low: matchedPriceBar.low,
            close,
            volume: matchedPriceBar.volume,
            change,
            changePct: open !== 0 ? (change / open) * 100 : 0,
            cvd: cvdClose,
            barDelta: cvdDelta,
          })
        }
        setSyncCrosshair({
          x: param.point.x,
          timeStr: param.time ? String(param.time) : '',
        })
      }
      cvdChart.subscribeCrosshairMove(onCrosshairMove)

      // Lockstep bidirectional scroll/pan with main price chart
      cvdChart.timeScale().subscribeVisibleLogicalRangeChange(() => syncMainFromCvdRef.current())

      let lastCvdRoWidth = 0
      let lastCvdRoHeight = 0
      const ro = new ResizeObserver(() => {
        if (cvdContainerRef.current && cvdChartRef.current && showCvdSubPane) {
          const w = cvdContainerRef.current.clientWidth
          const h = cvdContainerRef.current.clientHeight
          if (Math.abs(w - lastCvdRoWidth) < 1 && Math.abs(h - lastCvdRoHeight) < 1) {
            return
          }
          lastCvdRoWidth = w
          lastCvdRoHeight = h
          cvdChartRef.current.resize(w, h)
        }
      })
      ro.observe(cvdContainer)
    }

    // Set data immediately if cached or from candles
    let barsToSet = cachedCvdBarsRef.current
    if (barsToSet.length === 0 && candlesRef.current.length > 0) {
      const ordered = normalizeCandleTimes(candlesRef.current, timeframe)
      const cvdBars = computeCvdCandleBars(
        ordered.map((c) => ({
          time: c.time as number,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
      )
      const tz = chartTzRef.current
      const cvdByUnix = new Map<number, (typeof cvdBars)[number]>()
      for (const b of cvdBars) cvdByUnix.set(b.time, b)
      const seenTimes = new Set<string>()
      const shifted: CandlestickData[] = []
      for (const c of ordered) {
        const t = toSeriesTime(c.time as number, timeframe, tz)
        const key = isBusinessDay(t) ? `${t.year}-${t.month}-${t.day}` : String(t)
        if (!seenTimes.has(key)) {
          seenTimes.add(key)
          const d = cvdByUnix.get(c.time as number)
          shifted.push({
            time: t,
            open: d?.open ?? 0,
            high: d?.high ?? 0,
            low: d?.low ?? 0,
            close: d?.close ?? 0,
          })
        }
      }
      shifted.sort((a, b) => chartTimeToUnix(a.time) - chartTimeToUnix(b.time))
      barsToSet = shifted
      cachedCvdBarsRef.current = barsToSet
    }

    if (barsToSet.length > 0 && cvdCandleSeriesRef.current) {
      cvdCandleSeriesRef.current.setData(barsToSet)
      const lastCvd = barsToSet[barsToSet.length - 1]
      if (lastCvd) {
        setCurrentCvdLegend({
          open: Math.round(lastCvd.open),
          high: Math.round(lastCvd.high),
          low: Math.round(lastCvd.low),
          close: Math.round(lastCvd.close),
        })
      }
    }

    if (showCvdSubPane && cvdChartRef.current && cvdContainerRef.current) {
      requestAnimationFrame(() => {
        if (cvdChartRef.current && cvdContainerRef.current) {
          cvdChartRef.current.resize(
            cvdContainerRef.current.clientWidth,
            cvdSubPaneHeight
          )
          const mainRange = chartRef.current?.timeScale().getVisibleLogicalRange()
          if (mainRange) {
            try {
              cvdChartRef.current.timeScale().setVisibleLogicalRange(mainRange)
            } catch {}
          }
          syncCvdFromMainRef.current()
        }
      })
    }
  }, [showCvdSubPane, cvdSubPaneHeight])

  // ── Draggable Resizer Handle for CVD Sub-Pane (TradingView Style) ────────────
  const handleCvdResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const startY = e.clientY
    const startHeight = cvdSubPaneHeight

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY
      const newHeight = Math.max(90, Math.min(550, startHeight + deltaY))
      setCvdSubPaneHeight(newHeight)

      requestAnimationFrame(() => {
        if (chartRef.current && containerRef.current) {
          chartRef.current.resize(containerRef.current.clientWidth, containerRef.current.clientHeight)
        }
        if (cvdChartRef.current && cvdContainerRef.current) {
          cvdChartRef.current.resize(cvdContainerRef.current.clientWidth, cvdContainerRef.current.clientHeight)
        }
        refreshSessionHighlightsRef.current?.()
      })
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [cvdSubPaneHeight])

  // ── Load candle data when instrument or timeframe changes ───────────────────────
  useEffect(() => {
    if (!chartReady) return
    // Free-switch NY board: load CME bars for the viewed book even if clock preference differs.
    let cancelled = false

    const load = async () => {
      const meta = INSTRUMENT_META[instrument]
      const tfSec = barSeconds
      const tradeLive = isLiveBarsAllowed(instrument)

      const cacheKey = `${instrument}:${timeframe}`
      const cached = candleCacheRef.current.get(cacheKey)
      // Instant switch: display cached bars immediately if fresh
      if (cached && Date.now() - cached.timestamp < CANDLE_CACHE_FRESH_MS && cached.candles.length > 0) {
        setCandles(cached.candles)
        candlesRef.current = cached.candles
        setDataMode('live')
        setCandleFeed(cached.source as any)
        if (cached.livePrice != null && Date.now() - cached.timestamp < CACHED_PRICE_FRESH_MS) {
          setLivePrice(cached.livePrice)
          publishPriceTick(cached.livePrice, cached.changePct)
        }
        loadLevelsRef.current(instrument, cached.candles)
      }

      // Full continuum including afternoon — clipAfternoonBars is a no-op while freeze is off
      try {
        // Must cover cash open of 5 trading days prior (weekends truncate a plain 5d fetch; 1m is 3d — enough for 5 sessions Mon-Fri while keeping candle count low; 1D is 730d / 2 years)
        const days = timeframe === '1D' ? 730 : timeframe === '1m' ? 3 : AVWAP_CANDLE_FETCH_CALENDAR_DAYS
        const res = await fetch(
          `/api/trading/candles?instrument=${instrument}&timeframe=${timeframe}&days=${days}`
        )
        const json = await res.json()
        if (!cancelled && Array.isArray(json.candles) && json.candles.length > 0) {
          const mapped: OHLCV[] = json.candles.map((c: any) => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? 0,
          }))
          const trimmed = normalizeCandleTimes(toDeskCandles(mapped, instrument, timeframe), timeframe)
          setCandles(trimmed)
          candlesRef.current = trimmed
          const feedSource =
            json.source === 'databento'
              ? 'databento'
              : json.source === 'yahoo'
              ? 'yahoo'
              : json.source === 'oanda'
              ? 'oanda'
              : 'empty'
          setDataMode('live')
          setCandleFeed(feedSource)
          const last = mapped[mapped.length - 1]
          const loadedPrice = json.quote?.price ?? last?.close ?? null
          setLivePrice(loadedPrice)
          publishPriceTick(loadedPrice, json.quote?.change_pct ?? 0)
          loadLevelsRef.current(instrument, trimmed)

          // Store in client-side candle cache for instant switching
          candleCacheRef.current.set(cacheKey, {
            candles: trimmed,
            source: feedSource,
            livePrice: loadedPrice,
            changePct: json.quote?.change_pct ?? 0,
            timestamp: Date.now(),
          })
          return
        }
      } catch {
        // fall through
      }

      if (cancelled) return
      // Never wipe existing candles on temporary fetch drops or outside market hours
      if (!tradeLive.open || process.env.NODE_ENV === 'production') {
        if (candlesRef.current.length === 0) {
          setCandles([])
          setLivePrice(null)
          publishPriceTick(null, 0)
          setLevels([])
        }
        setDataMode('live')
        setCandleFeed('empty')
        return
      }
      // Demo-only fallback during morning session if feeds fail (local/dev)
      const generated = generateCandles(meta.basePrice, tfSec)
      setCandles(generated)
      setDataMode('synthetic')
      setCandleFeed('empty')
      const generatedPrice = generated[generated.length - 1]?.close ?? null
      setLivePrice(generatedPrice)
      publishPriceTick(generatedPrice, 0)
      loadLevelsRef.current(instrument, generated)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [instrument, chartReady, publishPriceTick, timeframe])

  // Mid-morning: re-grade levels against candles every 2 minutes (rule engine only)
  useEffect(() => {
    if (!chartReady) return
    void gradeLevels(instrument)
    const id = setInterval(() => void gradeLevels(instrument), 120_000)
    return () => clearInterval(id)
  }, [chartReady, instrument, gradeLevels])

  // Initial / instrument load — do not wipe levels when working or in a trade
  useEffect(() => {
    if (!chartReady) return
    void loadLevels(instrument, candlesRef.current)
  }, [chartReady, instrument, levelsRefreshKey, loadLevels])

  // Reset chart series + levels when switching instrument (wrong-scale leftovers squash the pane)
  const prevInstrumentRef = useRef<Instrument | null>(null)
  useEffect(() => {
    const prev = prevInstrumentRef.current
    prevInstrumentRef.current = instrument
    // Skip first mount — initial load effect owns the first candle fetch
    if (prev === null || prev === instrument) return

    didFitRef.current = false
    priceLineHostSeededRef.current = false
    lastCandleRef.current = null
    sessionSpansRef.current = null
    setStreamArmed(false)

    // Paint cached bars to avoid a blank flash, but only while they are recent enough to
    // still be the same tape. The price is held to a much tighter window than the bars:
    // it marks open positions, so a stale mark is worse than showing none.
    const cacheKey = `${instrument}:${timeframe}`
    const cached = candleCacheRef.current.get(cacheKey)
    const cacheAge = cached ? Date.now() - cached.timestamp : Infinity
    if (cached && cached.candles.length > 0 && cacheAge < CANDLE_CACHE_FRESH_MS) {
      setCandles(cached.candles)
      candlesRef.current = cached.candles
    } else {
      setCandles([])
      candlesRef.current = []
    }
    if (cached?.livePrice != null && cacheAge < CACHED_PRICE_FRESH_MS) {
      setLivePrice(cached.livePrice)
      publishPriceTick(cached.livePrice, cached.changePct)
    } else {
      setLivePrice(null)
      publishPriceTick(null, 0)
    }

    setLevels([])
    clearHoverPreview()

    const host = priceLineHostRef.current
    const removeAll = (lines: any[]) => {
      lines.forEach((line) => {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      })
    }
    removeAll(levelLinesRef.current)
    removeAll(positionLinesRef.current)
    levelLinesRef.current = []
    positionLinesRef.current = []
    if (jumpMarkerRef.current && candleRef.current) {
      try {
        candleRef.current.removePriceLine(jumpMarkerRef.current)
      } catch {
        /* ignore */
      }
      jumpMarkerRef.current = null
    }

    try {
      candleRef.current?.setData([])
    } catch {
      /* ignore */
    }
    const vs = vwapSeriesRef.current
    if (vs) {
      try {
        vs.vwap.setData([])
        vs.upper1.setData([])
        vs.lower1.setData([])
        vs.upper2.setData([])
        vs.lower2.setData([])
        vs.upper3.setData([])
        vs.lower3.setData([])
      } catch {
        /* ignore */
      }
    }
    const nvs = newsVwapSeriesRef.current
    if (nvs) {
      try {
        nvs.vwap.setData([])
        nvs.upper1.setData([])
        nvs.lower1.setData([])
        nvs.upper2.setData([])
        nvs.lower2.setData([])
        nvs.upper3.setData([])
        nvs.lower3.setData([])
      } catch {
        /* ignore */
      }
    }
    const ibs = ibSeriesRef.current
    if (ibs) {
      try {
        ibs.high.setData([])
        ibs.low.setData([])
      } catch {
        /* ignore */
      }
    }
    setIbShaped(false)
    setIbLevels(null)
    ibRangeRef.current = null
    const lunchS = or15SeriesRef.current
    if (lunchS) {
      try {
        lunchS.high.setData([])
        lunchS.low.setData([])
      } catch {
        /* ignore */
      }
    }
    or15RangeRef.current = null
    setOr15Shaped(false)
    setOr15Locked(false)
    const usR = usRangeSeriesRef.current
    if (usR) {
      try {
        usR.high.setData([])
        usR.low.setData([])
      } catch {
        /* ignore */
      }
    }
    usRangeRef.current = null
    setUsRangeShaped(false)
    {
      const host = priceLineHostRef.current
      for (const line of ydayLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      ydayLinesRef.current = []
      ydayPaintKeyRef.current = ''
    }
    {
      const host = priceLineHostRef.current
      for (const line of openingLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      openingLinesRef.current = []
      openingPaintKeyRef.current = ''
    }
    {
      const host = priceLineHostRef.current
      for (const line of frvpLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      frvpLinesRef.current = []
    }
    {
      const host = priceLineHostRef.current
      for (const line of yesterdayNycLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      yesterdayNycLinesRef.current = []
    }
    {
      const host = priceLineHostRef.current
      for (const line of inventoryLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      inventoryLinesRef.current = []
    }
    {
      const host = priceLineHostRef.current
      for (const line of avwap5mLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      avwap5mLinesRef.current = []
    }
    {
      const host = priceLineHostRef.current
      for (const line of controlLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      controlLinesRef.current = []
      controlPaintKeyRef.current = ''
    }
    {
      const host = priceLineHostRef.current
      for (const line of auctionLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      auctionLinesRef.current = []
      auctionPaintKeyRef.current = ''
      auctionSignalsRef.current = []
    }
    {
      const host = priceLineHostRef.current
      for (const line of dow15mFailLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      dow15mFailLinesRef.current = []
      dow15mFailPaintKeyRef.current = ''
      dow15mFailSignalsRef.current = []
    }
    setCallBadge('WAIT')
    setCallHover(
      'CALL WAIT — no ticket\n\nTicket stays 1.5R. No Leo. No Level Finder fills.'
    )
    setPerfBadge('WAIT')
    setPerfHover(
      'PERF WAIT — not enough letters for a developing value area. Drive may still CALL. Ticket stays 1.5R.'
    )
    setSitBadge('NONE')
    setSitHover(
      'SIT NONE — no special situation. CALL side unchanged. Ticket stays 1.5R.'
    )
    {
      const host = priceLineHostRef.current
      for (const line of spikeLinesRef.current) {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      spikeLinesRef.current = []
      spikePaintKeyRef.current = ''
    }
    deskCallRef.current = null
    const or30S = or30SeriesRef.current
    if (or30S) {
      try {
        or30S.high.setData([])
        or30S.low.setData([])
      } catch {
        /* ignore */
      }
    }
    or30RangeRef.current = null
    setOr30Shaped(false)
    setOr30Locked(false)
    try {
      host?.setData([])
    } catch {
      /* ignore */
    }
    paintSessionHighlightOverlay(sessionOverlayRef.current, [])
    paintPositionBandOverlay(positionBandOverlayRef.current, [])
    paintFrvpHistogramRef.current()
    paintExcessesAndRoundedRef.current()
    paintNewsMarkersRef.current()
    paintUserDrawingsRef.current()

    // Fresh autoscaling for the next instrument's price universe
    try {
      chartRef.current?.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: DESK_CHART_THEME.rightPriceScale.scaleMargins,
      })
    } catch {
      /* ignore */
    }
  }, [instrument, clearHoverPreview, publishPriceTick])

  // Reset chart series, old timestamps, and markers when switching timeframe
  const prevTimeframeRef = useRef<DeskTimeframe | null>(null)
  useEffect(() => {
    const prev = prevTimeframeRef.current
    prevTimeframeRef.current = timeframe
    if (prev === null || prev === timeframe) return

    didFitRef.current = false
    priceLineHostSeededRef.current = false
    lastCandleRef.current = null
    sessionSpansRef.current = null
    if (newsMarkersOverlayRef.current) {
      newsMarkersOverlayRef.current.innerHTML = ''
    }
    // Check if target timeframe already has fresh cached candles
    const cached = candleCacheRef.current.get(`${instrument}:${timeframe}`)
    // Same window the loader uses, otherwise bars are wiped here and immediately
    // repainted from the very same cache entry, which reads as a flash.
    if (!cached || Date.now() - cached.timestamp >= CANDLE_CACHE_FRESH_MS || cached.candles.length === 0) {
      setCandles([])
      candlesRef.current = []
      try { candleRef.current?.setData([]) } catch {}
      try { priceLineHostRef.current?.setData([]) } catch {}
      try { volumeSeriesRef.current?.setData([]) } catch {}

      const vs = vwapSeriesRef.current
      if (vs) {
        try {
          vs.vwap.setData([])
          vs.upper1.setData([])
          vs.lower1.setData([])
          vs.upper2.setData([])
          vs.lower2.setData([])
          vs.upper3.setData([])
          vs.lower3.setData([])
        } catch {}
      }

      const nvs = newsVwapSeriesRef.current
      if (nvs) {
        try {
          nvs.vwap.setData([])
          nvs.upper1.setData([])
          nvs.lower1.setData([])
          nvs.upper2.setData([])
          nvs.lower2.setData([])
          nvs.upper3.setData([])
          nvs.lower3.setData([])
        } catch {}
      }
    }

    if (timeframe === '1D') {
      const ibs = ibSeriesRef.current
      if (ibs) {
        try { ibs.high.setData([]); ibs.low.setData([]) } catch {}
      }
      const or15s = or15SeriesRef.current
      if (or15s) {
        try { or15s.high.setData([]); or15s.low.setData([]) } catch {}
      }
      const uss = usRangeSeriesRef.current
      if (uss) {
        try { uss.high.setData([]); uss.low.setData([]) } catch {}
      }
      const or30s = or30SeriesRef.current
      if (or30s) {
        try { or30s.high.setData([]); or30s.low.setData([]) } catch {}
      }
      try { candleRef.current?.setMarkers([]) } catch {}
      setFrvp5d(null)
      setYesterdayNyc(null)
      setOvernightInventory(null)
      setYdayProfile(null)
    }
  }, [timeframe])

  useEffect(() => {
    instrumentRef.current = instrument
  }, [instrument])

  useEffect(() => {
    // Keep the imperative tick buffer separate from React state. The hot path
    // updates only its final element in place; cloning here prevents mutating
    // the state array while avoiding an O(history) copy on every exchange tick.
    candlesRef.current = candles.slice()
    requestAnimationFrame(() => {
      refreshSessionHighlightsRef.current?.()
    })
  }, [candles])

  useEffect(() => {
    levelsRef.current = levels
  }, [levels])

  useEffect(() => {
    showLevelsRef.current = showLevels
  }, [showLevels])

  /** Paint levels on host series — survives candle/VWAP setData. */
  const paintLevelLines = useCallback(() => {
    const host = priceLineHostRef.current
    if (!host) return

    levelLinesRef.current.forEach((line) => {
      try {
        host.removePriceLine(line)
      } catch {
        /* ignore */
      }
    })
    levelLinesRef.current = []
  }, [])

  // ── Push candle data to chart ─────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !chartRef.current || candles.length === 0) return

    const ordered = normalizeCandleTimes(candles, timeframe)
    const tz = chartTzRef.current
    const seenTimes = new Set<string>()
    const candleData: CandlestickData[] = []
    const volumeData: { time: Time; value: number; color: string }[] = []
    const cvdRaw = computeCvdCandleBars(
      ordered.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }))
    )
    const cvdByUnix = new Map<number, (typeof cvdRaw)[number]>()
    for (const b of cvdRaw) cvdByUnix.set(b.time, b)
    const shiftedCvd: CandlestickData[] = []
    for (const c of ordered) {
      const t = toSeriesTime(c.time as number, timeframe, tz)
      const key = isBusinessDay(t) ? `${t.year}-${t.month}-${t.day}` : String(t)
      if (!seenTimes.has(key)) {
        seenTimes.add(key)
        candleData.push({
          time: t,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })
        const isUp = c.close >= c.open
        volumeData.push({
          time: t,
          value: Number.isFinite(c.volume) ? (c.volume ?? 0) : 0,
          color: isUp ? 'rgba(8, 153, 129, 0.7)' : 'rgba(242, 54, 69, 0.7)',
        })
        const d = cvdByUnix.get(c.time as number)
        shiftedCvd.push({
          time: t,
          open: d?.open ?? 0,
          high: d?.high ?? 0,
          low: d?.low ?? 0,
          close: d?.close ?? 0,
        })
      }
    }
    candleData.sort((a, b) => chartTimeToUnix(a.time) - chartTimeToUnix(b.time))
    volumeData.sort((a, b) => chartTimeToUnix(a.time) - chartTimeToUnix(b.time))
    shiftedCvd.sort((a, b) => chartTimeToUnix(a.time) - chartTimeToUnix(b.time))

    const ts = chartRef.current.timeScale()
    let savedRange: { from: number; to: number } | null = null
    if (didFitRef.current) {
      try {
        savedRange = ts.getVisibleLogicalRange()
      } catch {
        savedRange = null
      }
    }

    const liveBefore = lastCandleRef.current

    try {
      candleRef.current.setData(candleData)
    } catch {
      /* ignore candle data error */
    }

    if (volumeSeriesRef.current) {
      try {
        volumeSeriesRef.current.setData(volumeData as any)
      } catch {
        /* ignore */
      }
    }

    // 5-Month Anchored VWAP on 1D; Dynamic Session/5D Anchored VWAP with bands on intraday
    const clock = deskClockFor(instrument)
    const mappedBars = ordered.map((c) => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))
    const bands =
      timeframe === '1D'
        ? compute5MonthAnchoredVwap({
            bars: mappedBars,
            instrument,
            baseline: null,
          })
        : computeAnchoredVwap(mappedBars, clock)
    latestVwapBandsRef.current = bands
    if (bands?.vwap?.length) {
      const last = bands.vwap[bands.vwap.length - 1]
      avwapLastRef.current =
        last && last.value > 0 ? last.value : null
      const lastU = bands.upper1?.[bands.upper1.length - 1]
      const lastL = bands.lower1?.[bands.lower1.length - 1]
      if (last && last.value > 0) {
        setCurrentVwap({
          vwap: Number(last.value.toFixed(2)),
          upper1: lastU ? Number(lastU.value.toFixed(2)) : 0,
          lower1: lastL ? Number(lastL.value.toFixed(2)) : 0,
        })
      }
    } else {
      avwapLastRef.current = null
      setCurrentVwap(null)
    }

    const vs = vwapSeriesRef.current
    if (vs) {
      const shouldRenderBands = show5mAvwapOnChart
      if (shouldRenderBands && bands) {
        const shift = (rows: Array<{ time: number; value: number }>) =>
          timeframe === '1D'
            ? toDailyLinePoints(rows)
            : sanitizeChartPoints(
                mapTimesToChart(
                  rows.map((r) => ({ time: r.time as number, value: r.value })),
                  tz
                ).map((r) => ({ time: r.time as UTCTimestamp, value: r.value }))
              )
        try { vs.vwap.setData(shift(bands.vwap) as any) } catch {}
        if (showSdBands) {
          try { vs.upper1.setData(shift(bands.upper1) as any) } catch {}
          try { vs.lower1.setData(shift(bands.lower1) as any) } catch {}
          try { vs.upper2.setData(shift(bands.upper2) as any) } catch {}
          try { vs.lower2.setData(shift(bands.lower2) as any) } catch {}
          try { vs.upper3.setData(bands.upper3 ? (shift(bands.upper3) as any) : []) } catch {}
          try { vs.lower3.setData(bands.lower3 ? (shift(bands.lower3) as any) : []) } catch {}
        } else {
          try { vs.upper1.setData([]) } catch {}
          try { vs.lower1.setData([]) } catch {}
          try { vs.upper2.setData([]) } catch {}
          try { vs.lower2.setData([]) } catch {}
          try { vs.upper3.setData([]) } catch {}
          try { vs.lower3.setData([]) } catch {}
        }
      } else {
        try { vs.vwap.setData([]) } catch {}
        try { vs.upper1.setData([]) } catch {}
        try { vs.lower1.setData([]) } catch {}
        try { vs.upper2.setData([]) } catch {}
        try { vs.lower2.setData([]) } catch {}
        try { vs.upper3.setData([]) } catch {}
        try { vs.lower3.setData([]) } catch {}
      }
    }

    // Update & Cache CVD Candlesticks for Sub-Chart Pane — same timestamps as price.
    try {
      cachedCvdBarsRef.current = shiftedCvd

      if (cvdCandleSeriesRef.current) {
        cvdCandleSeriesRef.current.setData(shiftedCvd)
        if (shiftedCvd.length > 0) {
          const lastCvd = shiftedCvd[shiftedCvd.length - 1]
          if (lastCvd) {
            setCurrentCvdLegend({
              open: Math.round(lastCvd.open),
              high: Math.round(lastCvd.high),
              low: Math.round(lastCvd.low),
              close: Math.round(lastCvd.close),
            })
          }
        }
        requestAnimationFrame(() => syncCvdFromMainRef.current())
      }
    } catch {}

    if (timeframe !== '1D') {
      try { syncDeskPlaybookRangesRef.current(ordered) } catch {}
      try { paintYesterdayProfileRef.current() } catch {}
      try { paintOpeningActivityRef.current() } catch {}
      try { paintFrvp5dRef.current(ordered) } catch {}
      try { paintYesterdayNycRef.current(ordered) } catch {}
      try { paintInventorySessionsRef.current() } catch {}
      try { paintAuctionOverlayRef.current() } catch {}
      try { paintDow15mFailOverlayRef.current() } catch {}
      try { paintMarketControlRef.current() } catch {}
    } else {
      try { paintYesterdayProfileRef.current() } catch {}
      try { paintOpeningActivityRef.current() } catch {}
      try { paintFrvp5dRef.current(ordered) } catch {}
      try { paintYesterdayNycRef.current(ordered) } catch {}
      try { paintInventorySessionsRef.current() } catch {}
      try { paintAuctionOverlayRef.current() } catch {}
      try { paintDow15mFailOverlayRef.current() } catch {}
      try { paintMarketControlRef.current() } catch {}
    }
    try { paint5mAvwapBenchmarkRef.current() } catch {}
    try { paintFrvpHistogramRef.current?.() } catch {}
    try { paintExcessesAndRoundedRef.current?.() } catch {}
    try { paintNewsMarkersRef.current?.() } catch {}
    try { paintUserDrawingsRef.current?.() } catch {}

    const host = priceLineHostRef.current
    if (host && !priceLineHostSeededRef.current && ordered.length > 0) {
      const a = ordered[0]!
      const b = ordered[ordered.length - 1]!
      try {
        if (ordered.length === 1 || a.time === b.time) {
          host.setData([
            {
              time: toSeriesTime(a.time as number, timeframe, tz),
              value: a.close,
            },
          ])
        } else {
          host.setData([
            {
              time: toSeriesTime(a.time as number, timeframe, tz),
              value: a.close,
            },
            {
              time: toSeriesTime(b.time as number, timeframe, tz),
              value: b.close,
            },
          ])
        }
        priceLineHostSeededRef.current = true
      } catch {}
    }

    // Keep a fresher live tip than the server snapshot when quotes advanced it
    // (only same instrument — never merge a leftover tip from the previous tab)
    const serverTip = ordered[ordered.length - 1] ?? null
    if (
      liveBefore &&
      serverTip &&
      Math.abs(liveBefore.close - serverTip.close) / serverTip.close <= 0.015
    ) {
      const liveT = liveBefore.time as number
      const serverT = serverTip.time as number
      if (liveT === serverT) {
        const tipDiv =
          serverTip.close > 0
            ? Math.abs(liveBefore.close - serverTip.close) / serverTip.close
            : 0
        const close = tipDiv <= 0.012 ? liveBefore.close : serverTip.close
        const merged: OHLCV = {
          ...serverTip,
          high: Math.max(serverTip.high, liveBefore.high, liveBefore.close, close),
          low: Math.min(serverTip.low, liveBefore.low, liveBefore.close, close),
          close,
        }
        lastCandleRef.current = merged
        try {
          candleRef.current.update({
            time: toSeriesTime(merged.time as number, timeframe, chartTzRef.current),
            open: merged.open,
            high: merged.high,
            low: merged.low,
            close: merged.close,
          })
        } catch {
          /* ignore */
        }
      } else if (liveT > serverT) {
        lastCandleRef.current = liveBefore
        try {
          candleRef.current.update({
            time: toSeriesTime(liveBefore.time as number, timeframe, chartTzRef.current),
            open: liveBefore.open,
            high: liveBefore.high,
            low: liveBefore.low,
            close: liveBefore.close,
          })
        } catch {
          /* ignore */
        }
      } else {
        lastCandleRef.current = serverTip
      }
    } else {
      lastCandleRef.current = serverTip
    }

    // Only paint levels after refs synced — empty after instrument switch until loadLevels
    levelsRef.current = levels
    paintLevelLines()

    if (!didFitRef.current) {
      // Tip-anchored window — never fit all ~3k history bars (looks randomly zoomed out)
      const width = containerRef.current?.clientWidth ?? 900
      const isDaily = timeframe === '1D'
      const spacing = deskBarSpacing(width, ordered.length, timeframe)
      ts.applyOptions({
        barSpacing: spacing,
        rightOffset: isDaily ? 6 : DESK_CHART_THEME.timeScale.rightOffset,
        timeVisible: !isDaily,
        secondsVisible: false,
      })
      requestAnimationFrame(() => {
        try {
          chartRef.current?.priceScale('right').applyOptions({
            autoScale: true,
            scaleMargins: DESK_CHART_THEME.rightPriceScale.scaleMargins,
          })
          const restored = loadDeskViewport(instrument, ordered.length, width, timeframe)
          ts.setVisibleLogicalRange(
            restored ?? deskVisibleLogicalRange(ordered.length, width, timeframe)
          )
          didFitRef.current = true
          refreshSessionHighlightsRef.current?.()
          syncCvdFromMainRef.current()
        } catch {
          /* ignore */
        }
      })
    } else if (savedRange) {
      // New prints / range unlock must not shrink candles (last-value tags widen the axis)
      requestAnimationFrame(() => {
        try {
          const cur = ts.getVisibleLogicalRange()
          if (!cur || Math.abs(cur.from - savedRange.from) >= 0.05 || Math.abs(cur.to - savedRange.to) >= 0.05) {
            ts.setVisibleLogicalRange(savedRange)
          }
          refreshSessionHighlightsRef.current?.()
          syncCvdFromMainRef.current()
        } catch {
          /* ignore */
        }
      })
    }
    requestAnimationFrame(() => {
      refreshSessionHighlightsRef.current?.()
    })
  }, [candles, instrument, paintLevelLines, avwap5mBenchmark, timeframe, show5mAvwapOnChart]) // eslint-disable-line react-hooks/exhaustive-deps

  // Repaint VWAP series data when avwap5mBenchmark changes or on instrument switch
  useEffect(() => {
    const vs = vwapSeriesRef.current
    if (!vs) return
    const list = candlesRef.current
    if (!list || list.length === 0) return

    const clock = deskClockFor(instrument)
    const mappedBars = list.map((c) => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))
    const bands =
      timeframe === '1D'
        ? compute5MonthAnchoredVwap({
            bars: mappedBars,
            instrument,
            baseline: null,
          })
        : computeAnchoredVwap(mappedBars, clock)
    latestVwapBandsRef.current = bands
    if (bands?.vwap?.length) {
      const last = bands.vwap[bands.vwap.length - 1]
      avwapLastRef.current = last && last.value > 0 ? last.value : null
      const lastU = bands.upper1?.[bands.upper1.length - 1]
      const lastL = bands.lower1?.[bands.lower1.length - 1]
      if (last && last.value > 0) {
        setCurrentVwap({
          vwap: Number(last.value.toFixed(2)),
          upper1: lastU ? Number(lastU.value.toFixed(2)) : 0,
          lower1: lastL ? Number(lastL.value.toFixed(2)) : 0,
        })
      }
    }

    const shouldRenderBands = show5mAvwapOnChart
    if (bands && bands.vwap && shouldRenderBands) {
      const tz = chartTzRef.current
      const shift = <T extends { time: number | UTCTimestamp; value: number }>(rows: T[]) =>
        timeframe === '1D'
          ? (toDailyLinePoints(rows as Array<{ time: number; value: number }>) as any)
          : sanitizeChartPoints(
              mapTimesToChart(
                rows.map((r) => ({ time: r.time as number, value: r.value })),
                tz
              ).map((r) => ({ time: r.time as UTCTimestamp, value: r.value }))
            )
      try { if (bands.vwap) vs.vwap.setData(shift(bands.vwap)) } catch {}
      if (showSdBands) {
        try { if (bands.upper1) vs.upper1.setData(shift(bands.upper1)) } catch {}
        try { if (bands.lower1) vs.lower1.setData(shift(bands.lower1)) } catch {}
        try { if (bands.upper2) vs.upper2.setData(shift(bands.upper2)) } catch {}
        try { if (bands.lower2) vs.lower2.setData(shift(bands.lower2)) } catch {}
        try { if (bands.upper3) vs.upper3.setData(shift(bands.upper3)) } catch {}
        try { if (bands.lower3) vs.lower3.setData(shift(bands.lower3)) } catch {}
      } else {
        try { vs.upper1.setData([]) } catch {}
        try { vs.lower1.setData([]) } catch {}
        try { vs.upper2.setData([]) } catch {}
        try { vs.lower2.setData([]) } catch {}
        try { vs.upper3.setData([]) } catch {}
        try { vs.lower3.setData([]) } catch {}
      }
    } else {
      try { vs.vwap.setData([]) } catch {}
      try { vs.upper1.setData([]) } catch {}
      try { vs.lower1.setData([]) } catch {}
      try { vs.upper2.setData([]) } catch {}
      try { vs.lower2.setData([]) } catch {}
      try { vs.upper3.setData([]) } catch {}
      try { vs.lower3.setData([]) } catch {}
    }
  }, [avwap5mBenchmark, instrument, timeframe, show5mAvwapOnChart, showSdBands])

  // Repaint News Catalyst Anchored VWAP series and standard deviation bands
  useEffect(() => {
    const nvs = newsVwapSeriesRef.current
    const list = candlesRef.current
    if (!list || list.length === 0) {
      if (nvs) {
        try { nvs.vwap.setData([]) } catch {}
        try { nvs.upper1.setData([]) } catch {}
        try { nvs.lower1.setData([]) } catch {}
        try { nvs.upper2.setData([]) } catch {}
        try { nvs.lower2.setData([]) } catch {}
        try { nvs.upper3.setData([]) } catch {}
        try { nvs.lower3.setData([]) } catch {}
      }
      return
    }

    const mappedBars: SessionBar[] = list.map((c) => ({
      time: c.time as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))

    const result = computeNewsCatalystVwap(mappedBars, newsEvents)

    if (!nvs) return

    if (!showNewsAvwap || !result) {
      try { nvs.vwap.setData([]) } catch {}
      try { nvs.upper1.setData([]) } catch {}
      try { nvs.lower1.setData([]) } catch {}
      try { nvs.upper2.setData([]) } catch {}
      try { nvs.lower2.setData([]) } catch {}
      try { nvs.upper3.setData([]) } catch {}
      try { nvs.lower3.setData([]) } catch {}
      return
    }

    const tz = chartTzRef.current
    const shift = <T extends { time: number | UTCTimestamp; value: number }>(rows: T[]) =>
      timeframe === '1D'
        ? (toDailyLinePoints(rows as Array<{ time: number; value: number }>) as any)
        : sanitizeChartPoints(
            mapTimesToChart(
              rows.map((r) => ({ time: r.time as number, value: r.value })),
              tz
            ).map((r) => ({ time: r.time as UTCTimestamp, value: r.value }))
          )

    try { if (result.bands.vwap) nvs.vwap.setData(shift(result.bands.vwap)) } catch {}
    try { if (result.bands.upper1) nvs.upper1.setData(shift(result.bands.upper1)) } catch {}
    try { if (result.bands.lower1) nvs.lower1.setData(shift(result.bands.lower1)) } catch {}
    try { if (result.bands.upper2) nvs.upper2.setData(shift(result.bands.upper2)) } catch {}
    try { if (result.bands.lower2) nvs.lower2.setData(shift(result.bands.lower2)) } catch {}

    if (newsAvwapBandCount === 3) {
      try { if (result.bands.upper3) nvs.upper3.setData(shift(result.bands.upper3)) } catch {}
      try { if (result.bands.lower3) nvs.lower3.setData(shift(result.bands.lower3)) } catch {}
    } else {
      try { nvs.upper3.setData([]) } catch {}
      try { nvs.lower3.setData([]) } catch {}
    }
  }, [candles, newsEvents, instrument, timeframe, showNewsAvwap, newsAvwapBandCount])


  // ── Session color boxes (cached spans + imperative paint = smooth pan)
  const refreshSessionHighlights = useCallback(() => {
    const chart = chartRef.current
    const series = candleRef.current
    const list = candlesRef.current
    const host = sessionOverlayRef.current
    if (!chart || !series || !containerRef.current || list.length === 0 || timeframe === '1D') {
      paintSessionHighlightOverlay(host, [])
      paintPositionBandOverlay(positionBandOverlayRef.current, [])
      paintFrvpHistogramRef.current()
      paintExcessesAndRoundedRef.current()
      paintNewsMarkersRef.current()
      paintUserDrawingsRef.current()
      return
    }

    const tz = chartTzRef.current
    const lastBar = list[list.length - 1]
    const tip = (lastBar?.time as number) || 0
    const tipH = lastBar?.high != null ? Number(lastBar.high.toFixed(2)) : 0
    const tipL = lastBar?.low != null ? Number(lastBar.low.toFixed(2)) : 0
    const cacheKey = `${instrument}:${timeframe}:${tip}:${tipH}:${tipL}:${list.length}:${tz}`
    let cached = sessionSpansRef.current
    if (!cached || cached.key !== cacheKey) {
      const built = computeSessionHighlightSpans({
        candles: list.map((c) => ({
          time: c.time as number,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
        instrument,
        barSeconds,
      })
      cached = { key: cacheKey, spans: built.spans, candleTimes: built.candleTimes }
      sessionSpansRef.current = cached
    }

    let priceAxisW = 70
    try {
      priceAxisW = chart.priceScale('right').width() || priceAxisW
    } catch {
      /* defaults */
    }

    const { rects } = projectSessionHighlightRects({
      spans: cached.spans.map((s: any) => ({
        ...s,
        startT: toChartTime(s.startT, tz),
        endT: toChartTime(s.endT, tz),
      })),
      candleTimes: cached.candleTimes.map((t: number) => toChartTime(t, tz)),
      timeScale: chart.timeScale(),
      priceToY: (price) => series.priceToCoordinate(price),
      priceScaleWidth: priceAxisW,
      containerWidth: containerRef.current.clientWidth,
      containerHeight: containerRef.current.clientHeight,
      sessionPaint: 'range',
    })
    paintSessionHighlightOverlay(host, rects)

    if (cvdSessionOverlayRef.current && cvdChartRef.current && cvdCandleSeriesRef.current && cvdContainerRef.current) {
      let cvdPriceAxisW = 70
      try {
        cvdPriceAxisW = cvdChartRef.current.priceScale('right').width() || cvdPriceAxisW
      } catch {}
      const cvdSeries = cvdCandleSeriesRef.current
      const { rects: cvdRects } = projectSessionHighlightRects({
        spans: cached.spans.map((s: any) => ({
          ...s,
          startT: toChartTime(s.startT, tz),
          endT: toChartTime(s.endT, tz),
        })),
        candleTimes: cached.candleTimes.map((t: number) => toChartTime(t, tz)),
        timeScale: cvdChartRef.current.timeScale(),
        priceToY: (price) => cvdSeries.priceToCoordinate(price),
        priceScaleWidth: cvdPriceAxisW,
        containerWidth: cvdContainerRef.current.clientWidth,
        containerHeight: cvdContainerRef.current.clientHeight,
        sessionPaint: 'range',
      })
      paintSessionHighlightOverlay(cvdSessionOverlayRef.current, cvdRects, { hideLabels: true })
    }

    // Position TP / SL band overlay
    const bandHost = positionBandOverlayRef.current
    if (bandHost) {
      const bands: Array<{ top: number; height: number; color: string; border: string; title: string }> = []
      const pushBand = (p1: number | null, p2: number | null, color: string, border: string, title: string) => {
        if (p1 == null || p2 == null) return
        const top = Math.min(p1, p2)
        const bottom = Math.max(p1, p2)
        const height = bottom - top
        if (height < 2) return
        bands.push({ top, height, color, border, title })
      }
      if (positionOverlay) {
        const yEntry = series.priceToCoordinate(positionOverlay.entryPrice)
        const yTp = positionOverlay.profitTarget ? series.priceToCoordinate(positionOverlay.profitTarget) : null
        const yStop = positionOverlay.stopLoss ? series.priceToCoordinate(positionOverlay.stopLoss) : null
        pushBand(yEntry, yTp, 'rgba(22, 163, 74, 0.28)', '#15803d', 'Position TP zone')
        pushBand(yEntry, yStop, 'rgba(220, 38, 38, 0.28)', '#b91c1c', 'Position SL zone')
      }
      paintPositionBandOverlay(bandHost, bands, { keepPreviousIfEmpty: true })
    }
    paintFrvpHistogramRef.current()
    paintExcessesAndRoundedRef.current()
    paintNewsMarkersRef.current()
    paintUserDrawingsRef.current()
  }, [instrument])

  useEffect(() => {
    paintFrvpHistogramRef.current = paintFrvpHistogram
    paintExcessesAndRoundedRef.current = paintExcessesAndRounded
    paintNewsMarkersRef.current = paintNewsMarkers
    paintUserDrawingsRef.current = paintUserDrawings
    requestAnimationFrame(() => {
      paintFrvpHistogram()
      paintExcessesAndRounded()
      paintNewsMarkers()
      paintUserDrawings()
    })
  }, [paintFrvpHistogram, paintExcessesAndRounded, paintNewsMarkers, paintUserDrawings])

  /** TradingView-style: re-enable auto price scale after manual zoom on the axis */
  const resetPriceScale = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: DESK_CHART_THEME.rightPriceScale.scaleMargins,
    })
    const list = candlesRef.current
    const width = containerRef.current?.clientWidth ?? 900
    const isDaily = timeframe === '1D'
    try {
      const ts = chart.timeScale()
      ts.applyOptions({
        barSpacing: deskBarSpacing(width, list.length, timeframe),
        rightOffset: isDaily ? 6 : DESK_CHART_THEME.timeScale.rightOffset,
        timeVisible: !isDaily,
        secondsVisible: false,
      })
      const defaultRange = deskVisibleLogicalRange(list.length, width, timeframe)
      ts.setVisibleLogicalRange(defaultRange)
      saveDeskViewport(instrumentRef.current, defaultRange, list.length, timeframe)
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => refreshSessionHighlights())
  }, [refreshSessionHighlights, timeframe])

  useEffect(() => {
    refreshSessionHighlightsRef.current = refreshSessionHighlights
    requestAnimationFrame(() => refreshSessionHighlights())
  }, [positionOverlay, editableOverlay, filledBook, refreshSessionHighlights])

  useEffect(() => {
    if (!chartReady || !chartRef.current) return
    const host = sessionOverlayRef.current
    const el = containerRef.current
    let settleTimer = 0
    let rafPending = 0
    let pointerDown = false

    const paintNow = () => {
      if (rafPending) cancelAnimationFrame(rafPending)
      rafPending = requestAnimationFrame(() => {
        rafPending = 0
        refreshSessionHighlights()
        if (host) host.style.opacity = '1'
      })
    }

    const scheduleSettle = () => {
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        if (pointerDown) return
        interactingRef.current = false
        paintNow()
        if (didFitRef.current && chartRef.current) {
          try {
            const range = chartRef.current.timeScale().getVisibleLogicalRange()
            const list = candlesRef.current
            if (range && list.length > 1) {
              saveDeskViewport(instrumentRef.current, range, list.length, timeframe)
            }
          } catch {
            /* ignore */
          }
        }
      }, 16)
    }

    const beginInteract = () => {
      pointerDown = true
      interactingRef.current = true
      window.clearTimeout(settleTimer)
    }

    const endInteract = () => {
      if (!pointerDown) return
      pointerDown = false
      scheduleSettle()
    }

    el?.addEventListener('pointerdown', beginInteract, { passive: true })
    window.addEventListener('pointerup', endInteract, { passive: true })
    window.addEventListener('pointercancel', endInteract, { passive: true })

    const ts = chartRef.current.timeScale()
    const onRangeChange = () => {
      if (!didFitRef.current) return
      if (host) host.style.opacity = '1'
      paintNow()
      scheduleSettle()
    }
    ts.subscribeVisibleLogicalRangeChange(onRangeChange)

    const t1 = window.setTimeout(() => refreshSessionHighlights(), 200)

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(settleTimer)
      if (rafPending) cancelAnimationFrame(rafPending)
      interactingRef.current = false
      try {
        ts.unsubscribeVisibleLogicalRangeChange(onRangeChange)
      } catch {
        /* ignore */
      }
      el?.removeEventListener('pointerdown', beginInteract)
      window.removeEventListener('pointerup', endInteract)
      window.removeEventListener('pointercancel', endInteract)
    }
  }, [chartReady, refreshSessionHighlights, timeframe])

  // ── Draw level lines ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartReady) return
    paintLevelLines()
  }, [levels, showLevels, callBadge, chartReady, paintLevelLines])

  // Arm live quote/candle stream once bars exist (do not restart on every new print)
  useEffect(() => {
    if (candles.length > 0) setStreamArmed(true)
  }, [candles.length])

  // ── Chart tip stream & candle refresh (active market stream + post-market updates) ──
  useEffect(() => {
    if (!chartReady || !streamArmed || dataMode === 'synthetic') return

    const CANDLE_REFRESH_MS = 15_000
    const candleIntervalMs = tipStreamActive ? CANDLE_REFRESH_MS : 30_000
    let lastTickPublishAt = 0
    let lastPriceStateAt = 0
    let lastMarkerPaintAt = 0
    let tipPaintRaf = 0
    const fetchGen = ++candleFetchGenRef.current
    let sseHealthy = false
    let lastSseMessageAt = 0
    const SSE_STALE_MS = 3_000

    /** Live quote stream: NY from the commodity open, Nikkei for the Tokyo session. */
    const tipOpen = () => tipStreamActive && isChartStreamAllowed(instrument).open

    const toChartCandle = (bar: OHLCV) => ({
      time: toSeriesTime(bar.time as number, timeframe, chartTzRef.current),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    })

    let lastOverlayTickPaint = 0
    const paintTipBar = (bar: OHLCV) => {
      lastCandleRef.current = bar
      if (tipPaintRaf) return
      tipPaintRaf = requestAnimationFrame(() => {
        tipPaintRaf = 0
        const b = lastCandleRef.current
        if (!b || !candleRef.current) return
        try {
          candleRef.current.update(toChartCandle(b))
          // Keep the live volume bar in sync with the forming candle
          if (volumeSeriesRef.current && (b.volume ?? 0) > 0) {
            const volTime = toSeriesTime(b.time as number, timeframe, chartTzRef.current)
            const volColor =
              b.close >= b.open
                ? 'rgba(8, 153, 129, 0.7)'
                : 'rgba(242, 54, 69, 0.7)'
            try {
              volumeSeriesRef.current.update({
                time: volTime,
                value: b.volume ?? 0,
                color: volColor,
              } as any)
            } catch {
              /* ignore */
            }
          }
          if (!interactingRef.current) {
            const now = Date.now()
            if (now - lastOverlayTickPaint >= 150) {
              lastOverlayTickPaint = now
              paintOverlaysSinglePassRef.current()
            }
          }
        } catch {
          /* ignore */
        }
      })
    }

    const commitTipBar = (bar: OHLCV, fills: OHLCV[] = []) => {
      const bars = candlesRef.current
      if (bars.length === 0) {
        lastCandleRef.current = bar
        return
      }
      const next = bars
      for (const g of fills) {
        const prev = next[next.length - 1]
        // Ensure gap fills strictly advance time
        if (prev && (g.time as number) <= (prev.time as number)) continue
        try {
          candleRef.current?.update(toChartCandle(g))
        } catch {
          /* ignore */
        }
        next.push(g)
      }
      const last = next[next.length - 1]!
      // Strictly prevent non-monotonic timestamps which cause Lightweight Charts to throw or drop subsequent bars
      if ((bar.time as number) < (last.time as number)) {
        return
      }
      const isNewBar = (last.time as number) !== (bar.time as number)
      if (isNewBar) {
        next.push(bar)
      } else {
        next[next.length - 1] = {
          ...last,
          ...bar,
          volume: Math.max(last.volume ?? 0, bar.volume ?? 0),
        }
      }
      candlesRef.current = next
      paintTipBar(bar)
      if (fills.length > 0) {
        const now = Date.now()
        if (now - lastMarkerPaintAt >= 1000) {
          lastMarkerPaintAt = now
          paintDeskMarkersRef.current(next)
        }
      }
      if (isNewBar || fills.length > 0) {
        refreshSessionHighlightsRef.current?.()
        paintUserDrawingsRef.current?.()
      }
    }

    const applyQuote = (
      price: number,
      changePct: number,
      quoteTs: number,
      streamLive: boolean,
      trustedExchange: boolean,
      exchangeBar?: {
        time: number
        open: number
        high: number
        low: number
        close: number
        volume: number
      }
    ) => {
      // Guard rogue ticks, cross-feed scale bleeds, and delayed outliers.
      // Calibrated per instrument to eliminate false massive tails without blocking real volatility
      const tip = lastCandleRef.current
      if (
        trustedExchange &&
        timeframe !== '1D' &&
        tip &&
        Math.floor(quoteTs / barSeconds) * barSeconds <
          (tip.time as number)
      ) {
        // Reconnect replay for an already-closed bucket. The bar refresh owns
        // it; publishing it as the current quote would make the ticker jump back.
        return
      }
      if (
        tip &&
        !isPlausibleRealtimeTick(
          tip.close,
          price,
          instrument,
          trustedExchange
        )
      ) {
        return
      }

      onPriceUpdate?.(price)
      if (!interactingRef.current) {
        const now = Date.now()
        // Header readout repaints on its own subscription — candle tip updates every tick below
        if (now - lastTickPublishAt >= PRICE_TICKER_MS) {
          lastTickPublishAt = now
          publishPriceTick(price, changePct)
          onQuoteTick?.(Math.floor(now / 1000))
        }
        // Badges / proximity / alert effects read state — they do not need 20 Hz
        if (now - lastPriceStateAt >= PRICE_STATE_MS) {
          lastPriceStateAt = now
          setLivePrice(price)
        }
      }

      // Advance candle tip whenever the chart stream is open (incl. afternoon)
      if (!streamLive) return
      const last = lastCandleRef.current
      if (!last || !candleRef.current) return

      if (timeframe === '1D') {
        const quoteDay = snapDailyUnix(quoteTs)
        const lastDay = snapDailyUnix(last.time as number)
        const updatedVol =
          exchangeBar && exchangeBar.volume > 0
            ? Math.max(last.volume ?? 0, exchangeBar.volume)
            : last.volume

        if (quoteDay > lastDay) {
          // Calendar rollover to a new day: append new daily bar instead of mutating yesterday
          const newBar: OHLCV = {
            time: quoteDay as UTCTimestamp,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: exchangeBar?.volume ?? 0,
          }
          lastCandleRef.current = newBar
          candlesRef.current.push(newBar)
          try {
            candleRef.current.update(toChartCandle(newBar))
          } catch {
            /* ignore */
          }
          if (volumeSeriesRef.current) {
            const volTime = toSeriesTime(newBar.time as number, '1D', chartTzRef.current)
            try {
              volumeSeriesRef.current.update({
                time: volTime,
                value: newBar.volume ?? 0,
                color: 'rgba(8, 153, 129, 0.7)',
              } as any)
            } catch {
              /* ignore */
            }
          }
          return
        }

        // Daily chart: directly update today's candle high, low, close with live tick
        // Volume: take the cumulative volume from the exchange's 1m bar if provided
        const updated: OHLCV = {
          ...last,
          high: Math.max(last.high, price),
          low: Math.min(last.low, price),
          close: price,
          volume: updatedVol,
        }
        lastCandleRef.current = updated
        try {
          candleRef.current.update(toChartCandle(updated))
        } catch {
          /* ignore */
        }
        // Keep daily volume bar in sync
        if (volumeSeriesRef.current && (updatedVol ?? 0) > 0) {
          const volTime = toSeriesTime(updated.time as number, '1D', chartTzRef.current)
          const volColor =
            updated.close >= updated.open
              ? 'rgba(8, 153, 129, 0.7)'
              : 'rgba(242, 54, 69, 0.7)'
          try {
            volumeSeriesRef.current.update({
              time: volTime,
              value: updatedVol ?? 0,
              color: volColor,
            } as any)
          } catch {
            /* ignore */
          }
        }
        return
      }

      const tfSec = barSeconds
      // Databento event time is authoritative, including reconnect replay.
      // Wall-clock bucketing stale exchange events would stuff old prints into
      // the current bar and create false volatility.
      const bucketTs = trustedExchange
        ? quoteTs
        : quoteUnixForBucket(quoteTs)
      const stepped = applyTickToFormingBar(
        {
          time: last.time as number,
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
          volume: last.volume,
        },
        price,
        bucketTs,
        tfSec,
        instrument,
        trustedExchange
      )
      const fills: OHLCV[] = stepped.gapFills.map((g) => ({
        time: g.time as UTCTimestamp,
        open: g.open,
        high: g.high,
        low: g.low,
        close: g.close,
        volume: g.volume ?? 0,
      }))
      const exchangeBucket =
        exchangeBar && exchangeBar.time > 0
          ? Math.floor(exchangeBar.time / tfSec) * tfSec
          : -1
      const exactExchangeMinute =
        trustedExchange &&
        exchangeBar &&
        exchangeBucket === stepped.last.time
          ? exchangeBar
          : null
      const bar: OHLCV = {
        time: stepped.last.time as UTCTimestamp,
        open: stepped.last.open,
        high: exactExchangeMinute
          ? Math.max(stepped.last.high, exactExchangeMinute.high)
          : stepped.last.high,
        low: exactExchangeMinute
          ? Math.min(stepped.last.low, exactExchangeMinute.low)
          : stepped.last.low,
        close: stepped.last.close,
        volume:
          tfSec === 60 && exactExchangeMinute
            ? exactExchangeMinute.volume
            : stepped.last.volume ?? last.volume ?? 0,
      }
      commitTipBar(bar, fills)
    }

    const pollQuote = async () => {
      if (!tipOpen()) return
      if (quoteInFlightRef.current) return
      quoteInFlightRef.current = true
      const streamLive = tipOpen()
      try {
        const res = await fetch(
          `/api/trading/quote?instrument=${instrument}&_=${Date.now()}`,
          { cache: 'no-store' }
        )
        if (!res.ok) return
        const json = await res.json()
        if (typeof json.price === 'number' && json.price > 0) {
          const ts =
            typeof json.timestamp === 'number' && json.timestamp > 0
              ? json.timestamp
              : Math.floor(Date.now() / 1000)
          applyQuote(
            json.price,
            json.change_pct ?? 0,
            ts,
            streamLive,
            json.feed === 'databento',
            json.bar
          )
        }
      } catch {
        /* keep */
      } finally {
        quoteInFlightRef.current = false
      }
    }

    const refreshCandles = async () => {
      try {
        const days = timeframe === '1D' ? 730 : timeframe === '1m' ? 3 : AVWAP_CANDLE_FETCH_CALENDAR_DAYS
        const res = await fetch(
          `/api/trading/candles?instrument=${instrument}&timeframe=${timeframe}&days=${days}&quote=0&_=${Date.now()}`,
          { cache: 'no-store' }
        )
        if (!res.ok) return
        if (fetchGen !== candleFetchGenRef.current) return
        const json = await res.json()
        if (fetchGen !== candleFetchGenRef.current) return
        if (!Array.isArray(json.candles) || json.candles.length === 0) return

        const mapped: OHLCV[] = json.candles.map((c: any) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? 0,
        }))
        const trimmed = normalizeCandleTimes(toDeskCandles(mapped, instrument, timeframe), timeframe)
        if (trimmed.length === 0) return

        const live = lastCandleRef.current
        const streamLive = tipOpen()
        const merged = mergeHistoryWithLiveTip(
          trimmed.map((c) => ({
            time: c.time as number,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
          live && streamLive
            ? {
              time: live.time as number,
              open: live.open,
              high: live.high,
              low: live.low,
              close: live.close,
              volume: live.volume,
            }
            : null,
          timeframe,
          instrument
        )
        const nextBars: OHLCV[] = merged.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? 0,
        }))
        if (nextBars.length === 0) return

        if (fetchGen !== candleFetchGenRef.current) return

        const prev = candlesRef.current
        const tipOwned = !!(live && streamLive)
        const structureChanged =
          prev.length !== nextBars.length ||
          (prev.length > 0 &&
            nextBars.length > 0 &&
            (prev[0]!.time as number) !== (nextBars[0]!.time as number)) ||
          (prev.length >= 2 &&
            nextBars.length >= 2 &&
            (prev[prev.length - 2]!.time as number) !==
            (nextBars[nextBars.length - 2]!.time as number))
        const closedChanged = closedHistoryOhlcChanged(
          prev.map((c) => ({
            time: c.time as number,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
          nextBars.map((c) => ({
            time: c.time as number,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
          tipOwned
        )

        lastCandleRef.current = nextBars[nextBars.length - 1]!
        // REST owns closed bars: replace gap-fill flats when Yahoo catches up.
        if (structureChanged || closedChanged) {
          setCandles(nextBars)
        } else {
          const tip = nextBars[nextBars.length - 1]!
          try {
            candleRef.current?.update({
              time: toChartTime(tip.time as number, chartTzRef.current) as UTCTimestamp,
              open: tip.open,
              high: tip.high,
              low: tip.low,
              close: tip.close,
            })
          } catch {
            setCandles(nextBars)
          }
          candlesRef.current = nextBars
          syncDeskPlaybookRangesRef.current(nextBars)
          refreshSessionHighlightsRef.current?.()
          paintUserDrawingsRef.current?.()
        }
        setDataMode('live')
        if (json.source === 'yahoo' || json.source === 'oanda' || json.source === 'databento') {
          setCandleFeed(json.source)
        }
      } catch {
        /* ignore */
      }
    }

    void pollQuote()
    void refreshCandles()
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
    candleRefreshRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void refreshCandles()
    }, candleIntervalMs)

    // Primary tip: OANDA pricing stream via SSE (push on every tick)
    let es: EventSource | null = null
    const openPriceStream = () => {
      if (typeof EventSource === 'undefined') return
      if (!tipOpen()) return
      try {
        es?.close()
      } catch {
        /* ignore */
      }
      es = new EventSource(
        `/api/trading/quote/stream?instrument=${encodeURIComponent(instrument)}`
      )
      es.onmessage = (ev) => {
        try {
          const json = JSON.parse(ev.data) as {
            price?: number
            change_pct?: number
            timestamp?: number
            instrument?: string
            source?: string
            feed?: string
            bar?: {
              time: number
              open: number
              high: number
              low: number
              close: number
              volume: number
            }
          }
          // Hard reject ticks from another book (stale EventSource during tab switch)
          if (
            json.instrument &&
            String(json.instrument).toUpperCase() !== instrument
          ) {
            return
          }
          if (typeof json.price !== 'number' || !(json.price > 0)) return
          sseHealthy = true
          lastSseMessageAt = Date.now()
          const streamLive = tipOpen()
          const ts =
            typeof json.timestamp === 'number' && json.timestamp > 0
              ? json.timestamp
              : Math.floor(Date.now() / 1000)
          applyQuote(
            json.price,
            json.change_pct ?? 0,
            ts,
            streamLive,
            json.feed === 'databento',
            json.bar
          )
        } catch {
          /* ignore bad frames */
        }
      }
      es.onerror = () => {
        sseHealthy = false
        // Browser auto-reconnects EventSource; REST backup covers the gap
      }
    }
    openPriceStream()

    const handleReconnect = () => {
      openPriceStream()
      void refreshCandles()
      void pollQuote()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        openPriceStream()
        void refreshCandles()
        void pollQuote()
      }
    }
    window.addEventListener('online', handleReconnect)
    document.addEventListener('visibilitychange', handleVisibility)

    // Backup REST poll — frequent only when SSE is unhealthy
    tickIntervalRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (!tipOpen()) return
      if (sseHealthy && Date.now() - lastSseMessageAt < SSE_STALE_MS) return
      void pollQuote()
    }, 500)
    // Safety reconcile even when SSE is healthy (drift / missed reconnect) —
    // stretched to 20s while push ticks arrive, still 4s once SSE goes quiet.
    let lastReconcileAt = Date.now()
    const reconcile = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      if (!tipOpen()) return
      const now = Date.now()
      if (
        sseHealthy &&
        now - lastSseMessageAt < SSE_STALE_MS &&
        now - lastReconcileAt < RECONCILE_HEALTHY_MS
      ) {
        return
      }
      lastReconcileAt = now
      void pollQuote()
    }, 4_000)

    return () => {
      candleFetchGenRef.current += 1
      if (tipPaintRaf) cancelAnimationFrame(tipPaintRaf)
      tipPaintRaf = 0
      clearInterval(reconcile)
      window.removeEventListener('online', handleReconnect)
      document.removeEventListener('visibilitychange', handleVisibility)
      try {
        es?.close()
      } catch {
        /* ignore */
      }
      es = null
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
      if (candleRefreshRef.current) clearInterval(candleRefreshRef.current)
      tickIntervalRef.current = null
      candleRefreshRef.current = null
    }
  }, [
    chartReady,
    instrument,
    timeframe,
    barSeconds,
    streamArmed,
    dataMode,
    tipStreamActive,
    onQuoteTick,
    onPriceUpdate,
    publishPriceTick,
  ])

  // Context 5-5: Interactive limit order tool and entry band highlights removed.

  // ── Draw Zone tool — drag to draw a rectangle price zone ────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container || !candleRef.current || !chartReady || !drawZoneActive) return
    container.style.cursor = 'crosshair'

    // Create or reuse overlay div for the rectangle
    let overlay = drawZoneOverlayRef.current
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.style.position = 'absolute'
      overlay.style.pointerEvents = 'none'
      overlay.style.zIndex = '25'
      overlay.style.display = 'none'
      overlay.style.borderRadius = '4px'
      container.style.position = 'relative'
      container.appendChild(overlay)
      drawZoneOverlayRef.current = overlay
    }

    let startX: number | null = null
    let startY: number | null = null
    let anchorPrice: number | null = null
    let dragging = false

    const priceAtY = (clientY: number): number | null => {
      if (!candleRef.current) return null
      const price = priceFromClientY(container, candleRef.current, clientY)
      if (price == null) return null
      return Math.round(price * 100) / 100
    }

    const renderHandles = (highPrice: number | null, lowPrice: number | null) => {
      if (!overlay) return
      const handlesHtml = `
        <div style="position:absolute;top:-5px;left:-5px;width:10px;height:10px;background:#3b82f6;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);width:10px;height:10px;background:#3b82f6;border:1.5px solid #fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;top:-5px;right:-5px;width:10px;height:10px;background:#3b82f6;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;top:50%;left:-5px;transform:translateY(-50%);width:10px;height:10px;background:#3b82f6;border:1.5px solid #fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;top:50%;right:-5px;transform:translateY(-50%);width:10px;height:10px;background:#3b82f6;border:1.5px solid #fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;bottom:-5px;left:-5px;width:10px;height:10px;background:#3b82f6;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;bottom:-5px;left:50%;transform:translateX(-50%);width:10px;height:10px;background:#3b82f6;border:1.5px solid #fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;bottom:-5px;right:-5px;width:10px;height:10px;background:#3b82f6;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        ${highPrice != null && lowPrice != null
          ? `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:4px 8px;height:100%;flex-direction:column;pointer-events:none">
                <span style="font-family:monospace;font-size:10px;font-weight:700;color:#93c5fd;background:rgba(15,23,42,0.75);padding:1px 5px;border-radius:3px;border:1px solid rgba(59,130,246,0.3)">${highPrice.toLocaleString()}</span>
                <span style="font-family:monospace;font-size:10px;font-weight:700;color:#93c5fd;background:rgba(15,23,42,0.75);padding:1px 5px;border-radius:3px;border:1px solid rgba(59,130,246,0.3)">${lowPrice.toLocaleString()}</span>
              </div>`
          : ''
        }
      `
      overlay.innerHTML = handlesHtml
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return // left click only
      const p = priceAtY(e.clientY)
      if (p == null) return
      e.preventDefault()
      e.stopPropagation()
      const rect = container.getBoundingClientRect()
      startX = e.clientX - rect.left
      startY = e.clientY - rect.top
      anchorPrice = p
      dragging = true
      if (overlay) {
        overlay.style.display = 'block'
        overlay.style.left = `${startX}px`
        overlay.style.top = `${startY}px`
        overlay.style.width = '0px'
        overlay.style.height = '0px'
        overlay.style.right = 'auto'
        overlay.style.background = 'rgba(59, 130, 246, 0.16)'
        overlay.style.border = '2px solid #3b82f6'
        overlay.style.borderRadius = '4px'
        overlay.style.boxSizing = 'border-box'
        renderHandles(p, p)
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging || startX == null || startY == null || !overlay) return
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const currentX = e.clientX - rect.left
      const currentY = e.clientY - rect.top

      const left = Math.min(startX, currentX)
      const top = Math.min(startY, currentY)
      const width = Math.abs(currentX - startX)
      const height = Math.abs(currentY - startY)

      overlay.style.left = `${left}px`
      overlay.style.top = `${top}px`
      overlay.style.width = `${width}px`
      overlay.style.height = `${height}px`

      const topPrice = priceAtY(rect.top + top)
      const botPrice = priceAtY(rect.top + top + height)
      if (topPrice != null && botPrice != null) {
        const high = Math.max(topPrice, botPrice)
        const low = Math.min(topPrice, botPrice)
        renderHandles(high, low)
      }
    }

    const onMouseUp = (e: MouseEvent) => {
      if (!dragging || startX == null || startY == null || anchorPrice == null) return
      e.preventDefault()
      e.stopPropagation()
      dragging = false
      const endPrice = priceAtY(e.clientY)
      if (endPrice == null || Math.abs(endPrice - anchorPrice) < 1) {
        if (overlay) overlay.style.display = 'none'
        return
      }
      const high = Math.max(anchorPrice, endPrice)
      const low = Math.min(anchorPrice, endPrice)

      const host = priceLineHostRef.current
      if (host) {
        const lineHigh = host.createPriceLine({
          price: high,
          color: '#a78bfa',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '▔ Zone High',
        })
        const lineLow = host.createPriceLine({
          price: low,
          color: '#a78bfa',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '▁ Zone Low',
        })
        drawZoneLinesRef.current.push(lineHigh, lineLow)
      }
      setDrawnZone({ priceHigh: high, priceLow: low })
      setDrawZoneActive(false)
      container.style.cursor = ''
    }

    // Attach to container + inner canvases
    container.addEventListener('mousedown', onMouseDown, true)
    container.addEventListener('mousemove', onMouseMove, true)
    container.addEventListener('mouseup', onMouseUp, true)
    return () => {
      container.removeEventListener('mousedown', onMouseDown, true)
      container.removeEventListener('mousemove', onMouseMove, true)
      container.removeEventListener('mouseup', onMouseUp, true)
      container.style.cursor = ''
      if (overlay) overlay.style.display = 'none'
    }
  }, [drawZoneActive, chartReady])

  // Clear drawn zone lines helper
  const clearDrawnZoneLines = useCallback(() => {
    const host = priceLineHostRef.current
    drawZoneLinesRef.current.forEach((line) => {
      try { host?.removePriceLine(line) } catch { /* ignore */ }
    })
    drawZoneLinesRef.current = []
    // Also hide the rectangle overlay
    if (drawZoneOverlayRef.current) {
      drawZoneOverlayRef.current.style.display = 'none'
    }
  }, [])

  // Send drawn zone to Leo
  const sendDrawnZoneToLeo = useCallback(async () => {
    if (!drawnZone) return
    setDrawnZoneSending(true)
    const inst = (lockedInstrument ?? instrument) as Instrument

    // Auto-open voice panel first so context loads
    if (!voiceOpen) setVoiceOpen(true)

    const zoneName = `Zone ${drawnZoneCounter}`
    const mid = Math.round(((drawnZone.priceHigh + drawnZone.priceLow) / 2) * 100) / 100

    try {
      const res = await fetch('/api/trading/live-voice/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instrument: inst,
          transcript: `I drew a custom ${drawnZoneSide} zone named ${zoneName} on ${inst} between ${drawnZone.priceLow.toLocaleString()} and ${drawnZone.priceHigh.toLocaleString()}. What do you think of this level?`,
          customPin: {
            price: mid,
            side: drawnZoneSide,
            reason: zoneName,
          }
        }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success && json?.audioBase64) {
        // Play Leo's verbal response immediately
        const bytes = Uint8Array.from(atob(json.audioBase64), (c) => c.charCodeAt(0))
        const blob = new Blob([bytes], { type: json.mime || 'audio/mp3' })
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.play().catch(() => { })
      }
      setDrawnZoneCounter((prev) => prev + 1)
    } catch { /* silent */ }

    setDrawnZoneSending(false)
    setDrawnZone(null)
    clearDrawnZoneLines()
  }, [drawnZone, drawnZoneSide, instrument, lockedInstrument, voiceOpen, clearDrawnZoneLines, drawnZoneCounter])

  const cancelDrawnZone = useCallback(() => {
    setDrawnZone(null)
    setDrawZoneActive(false)
    clearDrawnZoneLines()
  }, [clearDrawnZoneLines])

  // Send drawn time range to Leo
  const sendDrawnTimeToLeo = useCallback(async () => {
    if (!drawnTime) return
    setDrawnTimeSending(true)
    const inst = (lockedInstrument ?? instrument) as Instrument

    // Auto-open voice panel first so context loads
    if (!voiceOpen) setVoiceOpen(true)

    const label = drawnTime.label || 'Highlight 1'
    const sessionSpanStr = describeTimeHighlightSpan(
      label,
      drawnTime.startUnix,
      drawnTime.endUnix,
      drawnTime.priceStart,
      drawnTime.priceEnd,
      inst
    )

    const fmtFull = new Intl.DateTimeFormat('en-US', {
      timeZone: TRADER_DISPLAY_TZ,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    const fullStartStr = fmtFull.format(new Date(drawnTime.startUnix * 1000))
    const fullEndStr = fmtFull.format(new Date(drawnTime.endUnix * 1000))
    const tzLabel = TRADER_DISPLAY_LABEL

    const clickStartP = drawnTime.priceStart
    const clickEndP = drawnTime.priceEnd
    const openP = drawnTime.candleStartOpen ?? clickStartP
    const closeP = drawnTime.candleEndClose ?? clickEndP
    const rHigh = drawnTime.rangeHigh ?? drawnTime.priceHigh
    const rLow = drawnTime.rangeLow ?? drawnTime.priceLow
    const pts = clickEndP - clickStartP
    const pct = clickStartP > 0 ? (pts / clickStartP) * 100 : 0

    const detailedTranscript = `USER HIGHLIGHTED PRICE MOVE (${label}): "${sessionSpanStr}".
Time Window: ${fullStartStr} (${tzLabel}) to ${fullEndStr} (${tzLabel}).
Highlighted Click Move Details:
- 1st Click (Start Price): ${clickStartP.toLocaleString()}
- 2nd Click (Finish Price): ${clickEndP.toLocaleString()}
- Clicked Move: ${pts >= 0 ? '+' : ''}${pts.toFixed(2)} pts (${pts >= 0 ? '+' : ''}${pct.toFixed(2)}%)
- Period High (Resistance): ${rHigh.toLocaleString()}
- Period Low (Support): ${rLow.toLocaleString()}
- Underlying Bar Open: ${openP.toLocaleString()} | Bar Close: ${closeP.toLocaleString()}
- 5m Bar Count: ${drawnTime.candleCount ?? 'N/A'}

Please evaluate this highlighted move from ${clickStartP.toLocaleString()} to ${clickEndP.toLocaleString()}, market structure, price action, volume, and session context during this period.`

    try {
      const res = await fetch('/api/trading/live-voice/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instrument: inst,
          transcript: detailedTranscript,
        }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success && json?.audioBase64) {
        // Play Leo's verbal response immediately
        const bytes = Uint8Array.from(atob(json.audioBase64), (c) => c.charCodeAt(0))
        const blob = new Blob([bytes], { type: json.mime || 'audio/mp3' })
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.play().catch(() => { })
      }
    } catch { /* silent */ }

    // Save to list
    const newHl = {
      id: `${Date.now()}`,
      label,
      startUnix: drawnTime.startUnix,
      endUnix: drawnTime.endUnix,
      priceHigh: drawnTime.priceHigh,
      priceLow: drawnTime.priceLow,
      priceStart: drawnTime.priceStart,
      priceEnd: drawnTime.priceEnd,
      rangeHigh: rHigh,
      rangeLow: rLow,
      candleStartOpen: openP,
      candleEndClose: closeP,
      candleCount: drawnTime.candleCount ?? 0,
      netMovePts: pts,
      netMovePct: pct,
      sessionSpanStr,
      visible: true,
    }
    setSavedHighlights((prev) => [...prev, newHl])

    setDrawnTimeSending(false)
    setDrawnTime(null)
  }, [drawnTime, instrument, lockedInstrument, voiceOpen, setSavedHighlights])

  const cancelDrawnTime = useCallback(() => {
    setDrawnTime(null)
    setDrawTimeActive(false)
  }, [])

  const centerChartOnHighlight = useCallback((hl: typeof savedHighlights[0]) => {
    const chart = chartRef.current
    if (!chart) return
    const timeScale = chart.timeScale()

    // Add extra padding bars to the left and right so it visualizes comfortably
    const span = hl.endUnix - hl.startUnix
    const padding = Math.max(span * 0.2, 3600) // minimum 1 hour padding

    timeScale.setVisibleRange({
      from: toChartTime(hl.startUnix - padding, chartTzRef.current) as UTCTimestamp,
      to: toChartTime(hl.endUnix + padding, chartTzRef.current) as UTCTimestamp,
    })
  }, [])

  // Lock pan/zoom while a 2-click draw is in progress so a drag does not pan.
  // Never change rightOffset here — that snaps the camera to last-bar + pad
  // (the chart jumps to the far right the moment a drawing tool is selected).
  // Future clicks past the last print use logicalFromPixel, not extra whitespace.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const drawing = drawTimeActive || drawZoneActive || activeDrawingTool !== 'NONE'
    const ts = chart.timeScale()
    const savedRange = ts.getVisibleLogicalRange()

    chart.applyOptions({
      handleScroll: {
        mouseWheel: !drawing,
        pressedMouseMove: !drawing,
        horzTouchDrag: !drawing,
        vertTouchDrag: !drawing,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: !drawing,
          price: !drawing,
        },
        axisDoubleClickReset: {
          time: !drawing,
          price: !drawing,
        },
        mouseWheel: !drawing,
        pinch: !drawing,
      },
    })
    if (savedRange) {
      try {
        ts.setVisibleLogicalRange(savedRange)
      } catch {
        /* ignore */
      }
    }
  }, [drawTimeActive, drawZoneActive, activeDrawingTool])

  // ── Highlight Time Range tool — 2-Click (Click Start → Move → Click End) ────
  useEffect(() => {
    const container = containerRef.current
    if (!container || !candleRef.current || !chartReady || !drawTimeActive) return
    container.style.cursor = 'crosshair'

    let overlay = drawTimeOverlayRef.current
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.style.position = 'absolute'
      overlay.style.pointerEvents = 'none'
      overlay.style.zIndex = '25'
      overlay.style.display = 'none'
      overlay.style.borderRadius = '4px'
      container.style.position = 'relative'
      container.appendChild(overlay)
      drawTimeOverlayRef.current = overlay
    }

    let startX: number | null = null
    let startY: number | null = null
    let step = 0 // 0 = awaiting 1st click, 1 = awaiting 2nd click

    const priceAtY = (clientY: number): number | null => {
      if (!candleRef.current) return null
      const price = priceFromClientY(container, candleRef.current, clientY)
      if (price == null) return null
      return Math.round(price * 100) / 100
    }

    const renderHandles = (highPrice: number | null, lowPrice: number | null, hintText?: string) => {
      if (!overlay) return
      const handlesHtml = `
        <div style="position:absolute;top:-5px;left:-5px;width:10px;height:10px;background:#8b5cf6;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);width:10px;height:10px;background:#8b5cf6;border:1.5px solid #fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;top:-5px;right:-5px;width:10px;height:10px;background:#8b5cf6;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;top:50%;left:-5px;transform:translateY(-50%);width:10px;height:10px;background:#8b5cf6;border:1.5px solid #fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;top:50%;right:-5px;transform:translateY(-50%);width:10px;height:10px;background:#8b5cf6;border:1.5px solid #fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;bottom:-5px;left:-5px;width:10px;height:10px;background:#8b5cf6;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;bottom:-5px;left:50%;transform:translateX(-50%);width:10px;height:10px;background:#8b5cf6;border:1.5px solid #fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;bottom:-5px;right:-5px;width:10px;height:10px;background:#8b5cf6;border:1.5px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>
        ${highPrice != null && lowPrice != null
          ? `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:4px 8px;height:100%;flex-direction:column;pointer-events:none">
                <span style="font-family:monospace;font-size:10px;font-weight:700;color:#c4b5fd;background:rgba(15,23,42,0.85);padding:2px 6px;border-radius:3px;border:1px solid rgba(139,92,246,0.5)">${highPrice.toLocaleString()}</span>
                ${hintText ? `<span style="font-size:9px;font-weight:600;color:#e9d5ff;background:rgba(126,34,206,0.8);padding:2px 6px;border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,0.3)">${hintText}</span>` : ''}
                <span style="font-family:monospace;font-size:10px;font-weight:700;color:#c4b5fd;background:rgba(15,23,42,0.85);padding:2px 6px;border-radius:3px;border:1px solid rgba(139,92,246,0.5)">${lowPrice.toLocaleString()}</span>
              </div>`
          : ''
        }
      `
      overlay.innerHTML = handlesHtml
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        // Right click cancels highlight creation immediately
        e.preventDefault()
        e.stopPropagation()
        if (overlay) overlay.style.display = 'none'
        step = 0
        setDrawTimeActive(false)
        container.style.cursor = ''
        return
      }
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      if (step === 0) {
        // 1st Click: Lock start position
        startX = x
        startY = y
        step = 1
        if (overlay) {
          overlay.style.display = 'block'
          overlay.style.left = `${startX}px`
          overlay.style.top = `${startY}px`
          overlay.style.width = '0px'
          overlay.style.height = '0px'
          overlay.style.background = 'rgba(139, 92, 246, 0.16)'
          overlay.style.border = '2px dashed #8b5cf6'
          overlay.style.borderRadius = '4px'
          overlay.style.boxSizing = 'border-box'
          const p = priceAtY(e.clientY)
          renderHandles(p, p, 'Click 2nd point (or Right-Click to cancel)')
        }
      } else if (step === 1 && startX != null && startY != null) {
        // 2nd Click: Lock end position & complete
        const endX = x
        const endY = y

        const minY = Math.min(startY, endY)
        const maxY = Math.max(startY, endY)

        const topP = priceAtY(minY)
        const botP = priceAtY(maxY)
        const highPrice = topP != null && botP != null ? Math.max(topP, botP) : 0
        const lowPrice = topP != null && botP != null ? Math.min(topP, botP) : 0

        const pStart = priceAtY(startY)
        const pEnd = priceAtY(endY)

        const timeScale = chartRef.current?.timeScale()
        if (timeScale) {
          const startLogical = timeScale.coordinateToLogical(startX)
          const endLogical = timeScale.coordinateToLogical(endX)

          if (startLogical != null && endLogical != null && candles.length > 0) {
            const startIdx = Math.max(0, Math.min(candles.length - 1, Math.round(startLogical)))
            const endIdx = Math.max(0, Math.min(candles.length - 1, Math.round(endLogical)))

            const startCandle = candles[startIdx]
            const endCandle = candles[endIdx]
            if (startCandle && endCandle) {
              const sTime = Number(startCandle.time)
              const eTime = Number(endCandle.time)
              const minTime = Math.min(sTime, eTime)
              const maxTime = Math.max(sTime, eTime)
              const rangeBars = candles.filter((c) => Number(c.time) >= minTime && Number(c.time) <= maxTime)

              const cOpen = rangeBars[0]?.open ?? pStart ?? highPrice
              const cClose = rangeBars[rangeBars.length - 1]?.close ?? pEnd ?? lowPrice
              const rHigh = rangeBars.length > 0 ? Math.max(...rangeBars.map((c) => c.high)) : highPrice
              const rLow = rangeBars.length > 0 ? Math.min(...rangeBars.map((c) => c.low)) : lowPrice
              const cCount = rangeBars.length
              const movePts = (pStart != null && pEnd != null) ? (pEnd - pStart) : (cClose - cOpen)
              const movePct = (pStart != null && pStart > 0) ? (movePts / pStart) * 100 : 0

              const currentLabel = `Highlight ${drawnTimeCounter}`
              setDrawnTimeCounter((prev) => prev + 1)
              setDrawnTime({
                startUnix: sTime,
                endUnix: eTime,
                priceHigh: highPrice,
                priceLow: lowPrice,
                priceStart: pStart ?? cOpen,
                priceEnd: pEnd ?? cClose,
                rangeHigh: rHigh,
                rangeLow: rLow,
                candleStartOpen: cOpen,
                candleEndClose: cClose,
                candleCount: cCount,
                netMovePts: movePts,
                netMovePct: movePct,
                label: currentLabel,
              })
            }
          }
        }
        if (overlay) overlay.style.display = 'none'
        step = 0
        setDrawTimeActive(false)
        container.style.cursor = ''
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (step !== 1 || startX == null || startY == null || !overlay) return
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const currentX = e.clientX - rect.left
      const currentY = e.clientY - rect.top

      const left = Math.min(startX, currentX)
      const top = Math.min(startY, currentY)
      const width = Math.abs(currentX - startX)
      const height = Math.abs(currentY - startY)

      overlay.style.left = `${left}px`
      overlay.style.top = `${top}px`
      overlay.style.width = `${width}px`
      overlay.style.height = `${height}px`

      const topPrice = priceAtY(rect.top + top)
      const botPrice = priceAtY(rect.top + top + height)
      if (topPrice != null && botPrice != null) {
        const high = Math.max(topPrice, botPrice)
        const low = Math.min(topPrice, botPrice)
        renderHandles(high, low, 'Click 2nd point (or Right-Click to cancel)')
      }
    }

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (overlay) overlay.style.display = 'none'
      step = 0
      setDrawTimeActive(false)
      container.style.cursor = ''
    }

    container.addEventListener('mousedown', onMouseDown, true)
    container.addEventListener('mousemove', onMouseMove, true)
    container.addEventListener('contextmenu', onContextMenu, true)
    const canvases = Array.from(container.querySelectorAll('canvas'))
    for (const c of canvases) {
      c.addEventListener('mousedown', onMouseDown, true)
      c.addEventListener('mousemove', onMouseMove, true)
      c.addEventListener('contextmenu', onContextMenu, true)
    }
    return () => {
      container.removeEventListener('mousedown', onMouseDown, true)
      container.removeEventListener('mousemove', onMouseMove, true)
      container.removeEventListener('contextmenu', onContextMenu, true)
      for (const c of canvases) {
        c.removeEventListener('mousedown', onMouseDown, true)
        c.removeEventListener('mousemove', onMouseMove, true)
        c.removeEventListener('contextmenu', onContextMenu, true)
      }
      container.style.cursor = ''
      if (overlay) overlay.style.display = 'none'
    }
  }, [drawTimeActive, chartReady, candles, drawnTimeCounter])

  // ── User Drawing Tools Interaction Effect (Trendline, Range, Manual FRVP) ──
  useEffect(() => {
    const container = containerRef.current
    if (!container || !candleRef.current || !chartReady || activeDrawingTool === 'NONE') return
    container.style.cursor = 'crosshair'

    const priceAtY = (clientY: number): number | null => {
      if (!candleRef.current) return null
      const price = priceFromClientY(container, candleRef.current, clientY)
      if (price == null) return null
      return Math.round(price * 100) / 100
    }

    const timeAtX = (clientX: number): number | null => {
      const chart = chartRef.current
      if (!chart || !container) return null
      const rect = container.getBoundingClientRect()
      const x = clientX - rect.left
      const list = candlesRef.current
      if (!(list.length > 0)) return null
      const logical = logicalFromPixel(chart.timeScale(), x, list.length)
      if (logical == null) return null
      const times = list.map((c) => Number(c.time))
      return unixFromLogical(logical, times, barSeconds)
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return // left click only
      const price = priceAtY(e.clientY)
      const time = timeAtX(e.clientX)
      if (price == null || time == null) return
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      e.preventDefault()
      e.stopPropagation()

      if (!drawingDraft) {
        // First click: save anchor draft
        setDrawingDraft({ time, price, x, y })
      } else {
        // Second click: finish drawing
        const p1Raw = drawingDraft
        const p2Raw = { time, price, x, y }
        // Chronological normalization: ensure p1 is earlier in time than p2
        const p1 = p1Raw.time <= p2Raw.time ? p1Raw : p2Raw
        const p2 = p1Raw.time <= p2Raw.time ? p2Raw : p1Raw

        if (activeDrawingTool === 'TRENDLINE') {
          const pDiff = p2.price - p1.price
          const inferredDir: 'BEARISH' | 'BULLISH' = pDiff < 0 ? 'BEARISH' : 'BULLISH'

          // Dynamically detect session origin based on anchor time p1 (Asia, London, or NYC)
          const anchorTime = Math.min(p1.time, p2.time)
          const rawDeskSess = nyDeskSessionAt(anchorTime) ?? nyDeskSessionAt(Math.floor(Date.now() / 1000))
          const sessionOrigin: 'Asia' | 'London' | 'NYC' =
            rawDeskSess === 'Asia' ? 'Asia' : rawDeskSess === 'London' ? 'London' : rawDeskSess === 'New York' ? 'NYC' : 'Asia'
          const isCarriedFromOvernight = sessionOrigin !== 'NYC'

          const rawBars: WyckoffBar[] = (candlesRef.current || []).map((c: any) => ({
            time: typeof c.time === 'number' ? c.time : 0,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume || 1),
            cvd: typeof c.cvd === 'number' ? c.cvd : undefined,
          }))

          const tempTl: UserTrendline = {
            id: `tl-${Date.now()}`,
            type: 'TRENDLINE',
            p1: { time: p1.time, price: p1.price },
            p2: { time: p2.time, price: p2.price },
            instrument,
            direction: inferredDir,
            sessionOrigin,
            isCarriedFromOvernight,
          }

          const wyckoffCtx: WyckoffChartContext = {
            yesterday: yesterdayNyc,
            overnight: overnightInventory,
            frvp5d,
            avwap5m: avwap5mBenchmark,
          }

          const evaluation = evaluateSpringOrUpthrustTrendline(tempTl, rawBars, wyckoffCtx)

          const newTl: UserTrendline = {
            ...tempTl,
            color: evaluation.color,
            label: `Trendline · ${evaluation.originType} (${evaluation.totalScore} pts)`,
          }
          setTrendlines((prev) => [...prev, newTl])

          playTradingViewChime()
          setDrawingToast({
            type: 'TRENDLINE',
            id: newTl.id,
            label: `Trendline · ${evaluation.originType} (${evaluation.totalScore}/100 pts · Grade ${evaluation.grade})`,
            summary: `${evaluation.summary} | Stop: ${evaluation.stopLoss.toFixed(1)} | Target: ${evaluation.targetZoneLabel} (${evaluation.targetPrice.toFixed(1)}, ${evaluation.rrRatio}R) · ${evaluation.is2RValid ? '✅ Valid >= 2R' : '⚠️ Filtered (< 2R)'}`,
          })
        } else if (activeDrawingTool === 'RANGE') {
          const newRange: UserRangeBox = {
            id: `range-${Date.now()}`,
            type: 'RANGE',
            p1: { time: p1.time, price: p1.price },
            p2: { time: p2.time, price: p2.price },
            color: '#a855f7',
            label: `Range ${activeRangeBoxes.length + 1}`,
            instrument,
          }
          setRangeBoxes((prev) => [...prev, newRange])
          const highP = Math.max(p1.price, p2.price)
          const lowP = Math.min(p1.price, p2.price)
          setDrawingToast({
            type: 'RANGE',
            id: newRange.id,
            label: newRange.label || 'Range Box',
            summary: `High ${highP.toLocaleString()} – Low ${lowP.toLocaleString()} (${Math.round(highP - lowP)} pts)`,
          })
        } else if (activeDrawingTool === 'FRVP') {
          const computed = computeCustomFixedRangeVolumeProfile(
            candlesRef.current.map((c) => ({
              time: Number(c.time),
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            })),
            p1.time,
            p2.time
          )
          if (computed) {
            computed.instrument = instrument
            setManualFrvps((prev) => [...prev, computed])
            setDrawingToast({
              type: 'FRVP',
              id: computed.id,
              label: computed.label || 'Manual FRVP',
              summary: `POC: ${computed.poc.toLocaleString()} | VAH: ${computed.vah.toLocaleString()} | VAL: ${computed.val.toLocaleString()}`,
            })
          }
        } else if (activeDrawingTool === 'MEASURE') {
          const newMeasure: UserMeasure = {
            id: `measure-${Date.now()}`,
            type: 'MEASURE',
            p1: { time: p1.time, price: p1.price },
            p2: { time: p2.time, price: p2.price },
            instrument,
          }
          setMeasures((prev) => [...prev, newMeasure])
          playTradingViewChime()
          const dP = p2.price - p1.price
          const pct = p1.price !== 0 ? (dP / p1.price) * 100 : 0
          setDrawingToast({
            type: 'RANGE',
            id: newMeasure.id,
            label: 'Measure Locked',
            summary: `${dP >= 0 ? '+' : ''}${Math.abs(dP).toFixed(2)} pts (${dP >= 0 ? '+' : ''}${pct.toFixed(2)}%) · Click ✕ to remove`,
          })
        }

        setDrawingDraft(null)
        draftMousePosRef.current = null
        setActiveDrawingTool('NONE')
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      const price = priceAtY(e.clientY)
      const time = timeAtX(e.clientX)
      if (price == null || time == null) return
      const rect = container.getBoundingClientRect()
      draftMousePosRef.current = {
        time,
        price,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
      if (drawingDraft) {
        paintUserDrawings()
      }
    }

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDrawingDraft(null)
      draftMousePosRef.current = null
      setActiveDrawingTool('NONE')
      container.style.cursor = ''
    }

    container.addEventListener('mousedown', onMouseDown, true)
    container.addEventListener('mousemove', onMouseMove, true)
    container.addEventListener('contextmenu', onContextMenu, true)
    const canvases = Array.from(container.querySelectorAll('canvas'))
    for (const c of canvases) {
      c.addEventListener('mousedown', onMouseDown, true)
      c.addEventListener('mousemove', onMouseMove, true)
      c.addEventListener('contextmenu', onContextMenu, true)
    }
    return () => {
      container.removeEventListener('mousedown', onMouseDown, true)
      container.removeEventListener('mousemove', onMouseMove, true)
      container.removeEventListener('contextmenu', onContextMenu, true)
      for (const c of canvases) {
        c.removeEventListener('mousedown', onMouseDown, true)
        c.removeEventListener('mousemove', onMouseMove, true)
        c.removeEventListener('contextmenu', onContextMenu, true)
      }
      container.style.cursor = ''
    }
  }, [activeDrawingTool, drawingDraft, trendlines.length, rangeBoxes.length, manualFrvps.length, measures.length, paintUserDrawings, barSeconds, chartReady])

  // ── TradingView-Style Interactive Trendline Drag & Edit Hook ─────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container || !chartReady || activeDrawingTool !== 'NONE') return

    const priceAtY = (clientY: number): number | null => {
      if (!candleRef.current) return null
      const price = priceFromClientY(container, candleRef.current, clientY)
      if (price == null) return null
      return Math.round(price * 100) / 100
    }

    const timeAtX = (clientX: number): number | null => {
      const chart = chartRef.current
      if (!chart || !container) return null
      const rect = container.getBoundingClientRect()
      const x = clientX - rect.left
      const list = candlesRef.current
      if (!(list.length > 0)) return null
      const logical = logicalFromPixel(chart.timeScale(), x, list.length)
      if (logical == null) return null
      const times = list.map((c) => Number(c.time))
      return unixFromLogical(logical, times, barSeconds)
    }

    const getHandleAt = (clientX: number, clientY: number): {
      tl: UserTrendline
      handle: 'p1' | 'p2' | 'body' | 'mid'
      dist: number
    } | null => {
      const chart = chartRef.current
      const series = candleRef.current
      const list = candlesRef.current
      if (!chart || !series || !container || list.length === 0) return null

      const rect = container.getBoundingClientRect()
      const mouseX = clientX - rect.left
      const mouseY = clientY - rect.top
      const tz = chartTzRef.current
      const candleTimes =
        candleTimesRef.current.length === list.length
          ? candleTimesRef.current
          : list.map((c) => toChartTime(c.time as number, tz))

      let bestHit: { tl: UserTrendline; handle: 'p1' | 'p2' | 'body' | 'mid'; dist: number } | null = null

      for (const tl of activeTrendlines) {
        const x1 = timeToX(chart.timeScale(), toChartTime(tl.p1.time, tz), candleTimes)
        const x2 = timeToX(chart.timeScale(), toChartTime(tl.p2.time, tz), candleTimes)
        const y1 = series.priceToCoordinate(tl.p1.price)
        const y2 = series.priceToCoordinate(tl.p2.price)
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue

        // Check P1 (hit tolerance 14px)
        const d1 = Math.hypot(mouseX - x1, mouseY - y1)
        if (d1 <= 14) {
          if (!bestHit || d1 < bestHit.dist) {
            bestHit = { tl, handle: 'p1', dist: d1 }
            continue
          }
        }

        // Check P2 (hit tolerance 14px)
        const d2 = Math.hypot(mouseX - x2, mouseY - y2)
        if (d2 <= 14) {
          if (!bestHit || d2 < bestHit.dist) {
            bestHit = { tl, handle: 'p2', dist: d2 }
            continue
          }
        }

        // Check midpoint (hit tolerance 12px)
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const dMid = Math.hypot(mouseX - mx, mouseY - my)
        if (dMid <= 12) {
          if (!bestHit || dMid < bestHit.dist) {
            bestHit = { tl, handle: 'mid', dist: dMid }
            continue
          }
        }

        // Check line segment body (hit tolerance 9px)
        const dSegSq = distToSegmentSquared(mouseX, mouseY, x1, y1, x2, y2)
        const dSeg = Math.sqrt(dSegSq)
        if (dSeg <= 9) {
          if (!bestHit || dSeg < bestHit.dist) {
            bestHit = { tl, handle: 'body', dist: dSeg }
          }
        }
      }
      return bestHit
    }

    let isDragging = false
    let dragData: {
      tlId: string
      handle: 'p1' | 'p2' | 'body' | 'mid'
      startPrice: number
      startTime: number
      startP1: { time: number; price: number }
      startP2: { time: number; price: number }
      originalTl: UserTrendline
    } | null = null

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) return
      const hit = getHandleAt(e.clientX, e.clientY)
      if (hit) {
        if (hit.handle === 'p1' || hit.handle === 'p2') {
          container.style.cursor = 'crosshair'
        } else {
          container.style.cursor = 'move'
        }
        if (
          hoveredHandleRef.current?.id !== hit.tl.id ||
          hoveredHandleRef.current?.type !== hit.handle
        ) {
          hoveredHandleRef.current = { id: hit.tl.id, type: hit.handle }
          paintUserDrawingsRef.current()
        }
      } else {
        if (hoveredHandleRef.current !== null) {
          hoveredHandleRef.current = null
          container.style.cursor = ''
          paintUserDrawingsRef.current()
        }
      }
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return // Left click only

      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // 1. Check if user clicked on any pinned measurement badge (e.g. [✕] delete button)
      for (const [id, hit] of measureBadgeHitsRef.current.entries()) {
        if (mouseX >= hit.x && mouseX <= hit.x + hit.w && mouseY >= hit.y && mouseY <= hit.y + hit.h) {
          e.preventDefault()
          e.stopPropagation()
          handleDeleteMeasure(id)
          return
        }
      }

      // 2. TradingView-style Shift + Click to instantly start Measure Tool
      if (e.shiftKey) {
        const curPrice = priceAtY(e.clientY)
        const curTime = timeAtX(e.clientX)
        if (curPrice != null && curTime != null) {
          e.preventDefault()
          e.stopPropagation()
          setActiveDrawingTool('MEASURE')
          setDrawingDraft({ time: curTime, price: curPrice, x: mouseX, y: mouseY })
          draftMousePosRef.current = { time: curTime, price: curPrice, x: mouseX, y: mouseY }
          return
        }
      }

      const hit = getHandleAt(e.clientX, e.clientY)
      if (!hit) {
        if (selectedTrendlineIdRef.current) {
          setSelectedTrendlineId(null)
          paintUserDrawingsRef.current()
        }
        return
      }

      // Stop propagation to prevent Lightweight Charts pan/drag
      e.preventDefault()
      e.stopPropagation()

      setSelectedTrendlineId(hit.tl.id)
      const curPrice = priceAtY(e.clientY) ?? hit.tl.p1.price
      const curTime = timeAtX(e.clientX) ?? hit.tl.p1.time

      isDragging = true
      dragData = {
        tlId: hit.tl.id,
        handle: hit.handle,
        startPrice: curPrice,
        startTime: curTime,
        startP1: { ...hit.tl.p1 },
        startP2: { ...hit.tl.p2 },
        originalTl: { ...hit.tl },
      }

      container.style.cursor = hit.handle === 'body' || hit.handle === 'mid' ? 'grabbing' : 'crosshair'

      const onWindowMouseMove = (ev: MouseEvent) => {
        if (!isDragging || !dragData) return
        ev.preventDefault()
        ev.stopPropagation()

        const p = priceAtY(ev.clientY)
        const t = timeAtX(ev.clientX)
        if (p == null || t == null) return

        let nextP1 = { ...dragData.startP1 }
        let nextP2 = { ...dragData.startP2 }

        if (dragData.handle === 'p1') {
          nextP1 = { time: t, price: p }
        } else if (dragData.handle === 'p2') {
          nextP2 = { time: t, price: p }
        } else {
          // 'body' or 'mid' - translate entire trendline
          const dPrice = p - dragData.startPrice
          const dTime = t - dragData.startTime
          nextP1 = {
            time: dragData.startP1.time + dTime,
            price: Math.round((dragData.startP1.price + dPrice) * 100) / 100,
          }
          nextP2 = {
            time: dragData.startP2.time + dTime,
            price: Math.round((dragData.startP2.price + dPrice) * 100) / 100,
          }
        }

        const pDiff = nextP2.price - nextP1.price
        const inferredDir: 'BEARISH' | 'BULLISH' = pDiff < 0 ? 'BEARISH' : 'BULLISH'

        activeDraggingTlRef.current = {
          id: dragData.tlId,
          p1: nextP1,
          p2: nextP2,
          direction: inferredDir,
        }

        paintUserDrawingsRef.current()
      }

      const onWindowMouseUp = () => {
        window.removeEventListener('mousemove', onWindowMouseMove, true)
        window.removeEventListener('mouseup', onWindowMouseUp, true)

        if (!isDragging || !dragData) return
        isDragging = false

        const finalDragged = activeDraggingTlRef.current
        const tlId = dragData.tlId
        dragData = null
        activeDraggingTlRef.current = null

        container.style.cursor = ''

        if (finalDragged) {
          // Invalidate breakout cache so engine recalculates against the new adjusted line
          confirmedBreakoutsRef.current.delete(tlId)

          const rawBars: WyckoffBar[] = (candlesRef.current || []).map((c: any) => ({
            time: typeof c.time === 'number' ? c.time : 0,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume || 1),
            cvd: typeof c.cvd === 'number' ? c.cvd : undefined,
          }))

          const wyckoffCtx: WyckoffChartContext = {
            yesterday: yesterdayNyc,
            overnight: overnightInventory,
            frvp5d,
            avwap5m: avwap5mBenchmark,
          }

          let evalSummary = ''
          let evalLabel = 'Trendline'

          setTrendlines((prev) =>
            prev.map((t) => {
              if (t.id !== tlId) return t
              const pDiff = finalDragged.p2.price - finalDragged.p1.price
              const inferredDir: 'BEARISH' | 'BULLISH' = pDiff < 0 ? 'BEARISH' : 'BULLISH'

              const evaluation = evaluateSpringOrUpthrustTrendline(
                {
                  ...t,
                  p1: finalDragged.p1,
                  p2: finalDragged.p2,
                  direction: inferredDir,
                },
                rawBars,
                wyckoffCtx
              )

              evalLabel = `Trendline · ${evaluation.originType} (${evaluation.totalScore} pts)`
              evalSummary = `Updated: ${finalDragged.p1.price.toFixed(1)} → ${finalDragged.p2.price.toFixed(1)} | Target: ${evaluation.targetZoneLabel} (${evaluation.targetPrice.toFixed(1)}, ${evaluation.rrRatio}R)`

              return {
                ...t,
                p1: finalDragged.p1,
                p2: finalDragged.p2,
                direction: inferredDir,
                label: evalLabel,
                color: evaluation.color,
              }
            })
          )

          playTradingViewChime()
          setDrawingToast({
            type: 'TRENDLINE',
            id: tlId,
            label: evalLabel,
            summary: evalSummary,
          })
        }
      }

      window.addEventListener('mousemove', onWindowMouseMove, true)
      window.addEventListener('mouseup', onWindowMouseUp, true)
    }

    // Keyboard delete / backspace support (TradingView standard)
    const onKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isInputActive =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      if (isInputActive) return

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTrendlineIdRef.current) {
        e.preventDefault()
        const targetId = selectedTrendlineIdRef.current
        handleDeleteTrendline(targetId)
        setSelectedTrendlineId(null)
        setDrawingToast({
          type: 'TRENDLINE',
          id: targetId,
          label: 'Trendline Deleted',
          summary: 'Drawing removed from chart',
        })
      }
    }

    container.addEventListener('mousemove', onMouseMove, true)
    container.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('keydown', onKeyDown)

    const canvases = Array.from(container.querySelectorAll('canvas'))
    for (const c of canvases) {
      c.addEventListener('mousemove', onMouseMove, true)
      c.addEventListener('mousedown', onMouseDown, true)
    }

    return () => {
      container.removeEventListener('mousemove', onMouseMove, true)
      container.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('keydown', onKeyDown)
      for (const c of canvases) {
        c.removeEventListener('mousemove', onMouseMove, true)
        c.removeEventListener('mousedown', onMouseDown, true)
      }
      container.style.cursor = ''
      hoveredHandleRef.current = null
      activeDraggingTlRef.current = null
    }
  }, [activeDrawingTool, activeTrendlines, chartReady, barSeconds, handleDeleteTrendline, handleDeleteMeasure])

  // Clear risk box chart lines
  const clearRiskBoxLines = useCallback(() => {
    const host = priceLineHostRef.current
    if (host) {
      riskBoxLinesRef.current.forEach((line) => {
        try { host.removePriceLine(line) } catch { /* silent */ }
      })
    }
    riskBoxLinesRef.current = []
  }, [])

  const cancelRiskBox = useCallback(() => {
    setRiskBox(null)
    setRiskBoxActive(false)
    clearRiskBoxLines()
  }, [clearRiskBoxLines])

  // Mouse dragging for Risk Box lines (Entry between open-band centers; TP / SL free)
  const draggingRiskLineRef = useRef<'ENTRY' | 'TP' | 'SL' | null>(null)

  const onRiskLineMouseDown = useCallback((type: 'ENTRY' | 'TP' | 'SL') => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement | null)?.closest('button')) return
    e.preventDefault()
    e.stopPropagation()
    draggingRiskLineRef.current = type
  }, [])

  useEffect(() => {
    if (!riskBox) return

    const liveOkForSnap = (
      range: { label: string; high: number; low: number },
      strategyRange: StrategyRangeEdges | null,
      ladder: ReturnType<typeof attemptLadderFromCounts>
    ) => {
      if (range.label === 'OR30') {
        return (
          !!strategyRange &&
          strategyRange.label === range.label &&
          strategyRange.high === range.high &&
          strategyRange.low === range.low
        )
      }
      return assertBucketEntryEligible({
        instrument,
        market: deskMarketFor(instrument),
        timeSec: deskClockSeconds(instrument),
        ladder,
        rangeLabel: range.label,
      }).ok
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRiskLineRef.current || !containerRef.current || !candleRef.current) return
      if (
        Date.now() < ignorePriceFromPointerUntilRef.current &&
        !draggingRiskLineRef.current
      ) {
        return
      }
      const rawPrice = priceFromClientY(containerRef.current, candleRef.current, e.clientY)
      if (rawPrice == null) return

      const snappedRaw = snapDeskPrice(instrument, rawPrice)
      const { snapRanges } = getStrategyRiskBundleRef.current()

      if (draggingRiskLineRef.current === 'ENTRY') {
        // Free vertical follow within the outer ±10 envelope (H ↔ Mid ↔ L reachable).
        // Snap to a band center on mouseup — continuous center clamp traps mid.
        const enveloped = clampPriceToRangeEdgeEnvelope(
          snappedRaw,
          snapRanges,
          undefined,
          ticketAllowedEdges({
            useCall: useCallRef.current,
            call: deskCallRef.current ?? getStrategyRiskBundleRef.current().call,
          })
        )
        const snapped = snapDeskPrice(instrument, enveloped ?? snappedRaw)
        setRiskBox((prev) => {
          if (!prev) return null
          const diff = snapped - prev.entryPrice
          return {
            ...prev,
            entryPrice: snapped,
            stopLoss: snapStopToTick(instrument, snapped, prev.stopLoss + diff, prev.direction),
            profitTarget: snapTargetToTick(
              instrument,
              snapped,
              prev.profitTarget + diff,
              prev.direction
            ),
          }
        })
      } else if (draggingRiskLineRef.current === 'TP') {
        setRiskBox((prev) =>
          prev
            ? {
              ...prev,
              profitTarget: snapTargetToTick(
                instrument,
                prev.entryPrice,
                snappedRaw,
                prev.direction
              ),
            }
            : null
        )
      } else if (draggingRiskLineRef.current === 'SL') {
        // Manual SL drag: TP follows 1.5R of new |entry−SL|
        setRiskBox((prev) => {
          if (!prev) return null
          const sl = snapStopToTick(instrument, prev.entryPrice, snappedRaw, prev.direction)
          const isLong = prev.direction === 'LONG'
          if (isLong ? !(sl < prev.entryPrice) : !(sl > prev.entryPrice)) {
            return prev
          }
          const rawTp = takeProfitFromStopR({
            entry: prev.entryPrice,
            stop: sl,
            direction: prev.direction,
          })
          const tp = snapTargetToTick(
            instrument,
            prev.entryPrice,
            snapProfitToRound(prev.entryPrice, sl, rawTp, prev.direction),
            prev.direction
          )
          return { ...prev, stopLoss: sl, profitTarget: tp }
        })
      }
    }

    const onMouseUp = () => {
      const was = draggingRiskLineRef.current
      draggingRiskLineRef.current = null
      if (was !== 'ENTRY') return
      const { snapRanges, strategyRange, ladder, call } = getStrategyRiskBundleRef.current()
      setRiskBox((prev) => {
        if (!prev) return null
        const snapped = snapEntryToNearestOpenBandCenter({
          entry: prev.entryPrice,
          candidates: snapRanges,
          preferLabel: prev.preferRangeLabel ?? strategyRange?.label ?? null,
          liveOk: (range: any) => liveOkForSnap(range, strategyRange, ladder),
          allowedEdges: ticketAllowedEdges({
            useCall: useCallRef.current,
            call,
          }),
        })
        if (!snapped) return prev
        const next = snapDeskPrice(instrument, snapped.price)
        const preferRangeLabel =
          snapped.hit.range.label ?? prev.preferRangeLabel ?? strategyRange?.label ?? null
        if (next === prev.entryPrice && preferRangeLabel === prev.preferRangeLabel) {
          return prev
        }
        const diff = next - prev.entryPrice
        return {
          ...prev,
          entryPrice: next,
          stopLoss: snapDeskPrice(instrument, prev.stopLoss + diff),
          profitTarget: snapDeskPrice(instrument, prev.profitTarget + diff),
          preferRangeLabel,
        }
      })
    }

    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [riskBox != null, instrument])

  // Drag filled-position SL/TP (Entry fixed). Commit on mouseup via onAdjustBrackets.
  const onBracketLineMouseDown = useCallback(
    (type: 'SL' | 'TP') => (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (bracketAdjustStatus === 'saving') return
      const ov = editableOverlayRef.current
      if (!ov || !onAdjustBracketsRef.current) return
      draggingBracketRef.current = type
      bracketDragStartRef.current = {
        stopLoss: ov.stopLoss,
        profitTarget: ov.profitTarget,
      }
    },
    [bracketAdjustStatus]
  )

  useEffect(() => {
    if (!editableOverlay || riskBox) return

    const onMouseMove = (e: MouseEvent) => {
      if (!draggingBracketRef.current || !containerRef.current || !candleRef.current) return
      const rawPrice = priceFromClientY(containerRef.current, candleRef.current, e.clientY)
      if (rawPrice == null) return
      const ov = editableOverlayRef.current
      if (!ov) return
      const dir = ov.direction === 'long' ? 'LONG' : 'SHORT'
      const isLong = ov.direction === 'long'

      if (draggingBracketRef.current === 'SL') {
        const sl = snapStopToTick(instrument, ov.entryPrice, rawPrice, dir)
        if (isLong ? !(sl < ov.entryPrice) : !(sl > ov.entryPrice)) return
        // Filled position: SL drag re-locks TP to 1.5R of new stop distance
        setEditableOverlay((prev) => {
          if (!prev) return null
          const rawTp = takeProfitFromStopR({
            entry: prev.entryPrice,
            stop: sl,
            direction: dir,
          })
          const tp = snapTargetToTick(
            instrument,
            prev.entryPrice,
            snapProfitToRound(prev.entryPrice, sl, rawTp, dir),
            dir
          )
          return { ...prev, stopLoss: sl, profitTarget: tp }
        })
      } else if (draggingBracketRef.current === 'TP') {
        const tp = snapTargetToTick(instrument, ov.entryPrice, rawPrice, dir)
        if (isLong ? !(tp > ov.entryPrice) : !(tp < ov.entryPrice)) return
        setEditableOverlay((prev) => (prev ? { ...prev, profitTarget: tp } : null))
      }
    }

    const onMouseUp = () => {
      const type = draggingBracketRef.current
      draggingBracketRef.current = null
      if (!type) return
      const ov = editableOverlayRef.current
      const start = bracketDragStartRef.current
      bracketDragStartRef.current = null
      const cb = onAdjustBracketsRef.current
      if (!ov || !start || !cb) return
      const payload: { stopLoss?: number; profitTarget?: number } = {}
      if (Math.abs(ov.stopLoss - start.stopLoss) > 1e-9) payload.stopLoss = ov.stopLoss
      if (Math.abs(ov.profitTarget - start.profitTarget) > 1e-9) {
        payload.profitTarget = ov.profitTarget
      }
      if (payload.stopLoss == null && payload.profitTarget == null) return
      void cb(payload)
    }

    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [editableOverlay != null, riskBox != null, instrument])

  const onWorkingTpMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (workingBracketAdjustStatus === 'saving') return
      const pend = editablePendingRef.current
      if (!pend || !onAdjustWorkingBracketsRef.current) return
      draggingWorkingBracketRef.current = 'TP'
      workingBracketDragStartRef.current = pend.profitTarget
    },
    [workingBracketAdjustStatus]
  )

  // Drag working-limit TP only (SL locked at place).
  useEffect(() => {
    if (!editablePending || riskBox || positionOverlay) return

    const onMouseMove = (e: MouseEvent) => {
      if (!draggingWorkingBracketRef.current || !containerRef.current || !candleRef.current) return
      const rawPrice = priceFromClientY(containerRef.current, candleRef.current, e.clientY)
      if (rawPrice == null) return
      const pend = editablePendingRef.current
      if (!pend) return
      const dir = pend.direction === 'long' ? 'LONG' : 'SHORT'
      const snapped = snapTargetToTick(instrument, pend.price, rawPrice, dir)
      const isLong = pend.direction === 'long'
      if (isLong ? !(snapped > pend.price) : !(snapped < pend.price)) return
      setEditablePending((prev) => (prev ? { ...prev, profitTarget: snapped } : null))
    }

    const onMouseUp = () => {
      if (!draggingWorkingBracketRef.current) return
      draggingWorkingBracketRef.current = null
      const pend = editablePendingRef.current
      const startTp = workingBracketDragStartRef.current
      workingBracketDragStartRef.current = null
      const cb = onAdjustWorkingBracketsRef.current
      if (!pend || startTp == null || !cb) return
      if (Math.abs(pend.profitTarget - startTp) <= 1e-9) return
      void cb({ profitTarget: pend.profitTarget })
    }

    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [editablePending != null, riskBox != null, positionOverlay != null, instrument])

  // Paint interactive limit risk-box lines on chart
  useEffect(() => {
    clearRiskBoxLines()
    if (!riskBox || !chartReady) return
    const host = priceLineHostRef.current
    if (!host) return

    const isLong = riskBox.direction === 'LONG'
    const entryColor = isLong
      ? 'rgba(56, 189, 248, 0.95)'
      : 'rgba(251, 113, 133, 0.95)'
    const slColor = '#f43f5e'
    const tpColor = '#10b981'

    const lineEntry = host.createPriceLine({
      price: riskBox.entryPrice,
      color: entryColor,
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: `◆ ENTRY ${riskBox.direction} @ ${riskBox.entryPrice.toLocaleString()}`,
    })

    const lineSl = host.createPriceLine({
      price: riskBox.stopLoss,
      color: slColor,
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: `▁ SL @ ${riskBox.stopLoss.toLocaleString()}`,
    })

    const lineTp = host.createPriceLine({
      price: riskBox.profitTarget,
      color: tpColor,
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: `▔ TP @ ${riskBox.profitTarget.toLocaleString()}`,
    })

    riskBoxLinesRef.current = [lineEntry, lineSl, lineTp]
  }, [riskBox, chartReady, instrument, clearRiskBoxLines])

  const onPriceAlertLineMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    draggingPriceAlertRef.current = true
  }, [])

  useEffect(() => {
    if (!priceAlert?.armed) return

    const onMouseMove = (e: MouseEvent) => {
      if (!draggingPriceAlertRef.current || !containerRef.current || !candleRef.current) return
      const rawPrice = priceFromClientY(containerRef.current, candleRef.current, e.clientY)
      if (rawPrice == null) return
      const snapped = snapDeskPrice(instrument, rawPrice)
      priceAlertPrimedRef.current = false
      prevLivePriceForAlertRef.current = null
      // Dragging near live restarts arm-after-away so we don't fire on release.
      const nearSpot =
        livePrice != null &&
        Number.isFinite(livePrice) &&
        !hasPriceLeftAlert({ livePrice, alertPrice: snapped })
      setPriceAlert((prev) =>
        prev
          ? {
            ...prev,
            price: snapped,
            armed: true,
            pendingAway: nearSpot || prev.pendingAway === true,
          }
          : null
      )
    }

    const onMouseUp = () => {
      draggingPriceAlertRef.current = false
    }

    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [priceAlert?.armed, instrument, livePrice])

  useEffect(() => {
    clearPriceAlertLine()
    if (!priceAlert || !chartReady) return
    const host = priceLineHostRef.current
    if (!host) return

    const armed = priceAlert.armed !== false
    const pending = armed && priceAlert.pendingAway === true
    const line = host.createPriceLine({
      price: priceAlert.price,
      color: armed
        ? pending
          ? 'rgba(168, 85, 247, 0.55)'
          : 'rgba(168, 85, 247, 0.95)'
        : 'rgba(168, 85, 247, 0.35)',
      lineWidth: armed && !pending ? 2 : 1,
      lineStyle: armed ? 2 : 1,
      axisLabelVisible: true,
      title: !armed
        ? `🔔 FIRED @ ${priceAlert.price.toLocaleString()}`
        : pending
          ? `🔔 ARMING @ ${priceAlert.price.toLocaleString()}`
          : `🔔 ALERT @ ${priceAlert.price.toLocaleString()}`,
    })
    priceAlertLineRef.current = line
  }, [priceAlert, chartReady, instrument, clearPriceAlertLine])

  useEffect(() => {
    priceAlertPrimedRef.current = false
    prevLivePriceForAlertRef.current = null
  }, [priceAlert?.price, priceAlert?.armed, priceAlert?.pendingAway])

  useEffect(() => {
    if (!priceAlert?.armed || !onDeskAlert) return
    if (livePrice == null) return

    // Arm-after-away: stay pending until live clears the level, then arm for later touch.
    if (priceAlert.pendingAway === true) {
      if (hasPriceLeftAlert({ livePrice, alertPrice: priceAlert.price })) {
        priceAlertPrimedRef.current = false
        prevLivePriceForAlertRef.current = livePrice
        setPriceAlert((prev) =>
          prev && prev.armed !== false
            ? { ...prev, pendingAway: false, armed: true }
            : prev
        )
      }
      return
    }

    if (!priceAlertPrimedRef.current) {
      priceAlertPrimedRef.current = true
      prevLivePriceForAlertRef.current = livePrice
      return
    }

    const prev = prevLivePriceForAlertRef.current
    prevLivePriceForAlertRef.current = livePrice

    if (
      !didPriceTouchAlert({
        prevPrice: prev,
        livePrice,
        alertPrice: priceAlert.price,
      })
    ) {
      return
    }

    const claimKind = `price_touch_${Math.round(priceAlert.price)}`
    if (!claimDeskNoteOnce(claimKind, instrument)) return

    const msg = formatPriceTouchAlert({
      instrument,
      alertPrice: priceAlert.price,
      livePrice,
    })
    playTradingViewChime()
    onDeskAlert({
      ...msg,
      instrument,
      dedupeKey: deskNoteClaimKey(claimKind, instrument),
    })
    setPriceAlert({ price: priceAlert.price, armed: false, pendingAway: false })
  }, [livePrice, priceAlert, instrument, onDeskAlert])

  const confirmRiskBoxOrder = useCallback(() => {
    if (!riskBox) return
    const { entryPrice: boxEntry, stopLoss, profitTarget, direction } = riskBox

    const { strategyMagnets, snapRanges, strategyRange, ladder } = getStrategyRiskBundle()
    const preferLabel =
      riskBox.preferRangeLabel ?? strategyRange?.label ?? null
    const liveOk = (range: { label: string; high: number; low: number }) => {
      if (range.label === 'OR30') {
        return (
          !!strategyRange &&
          strategyRange.label === range.label &&
          strategyRange.high === range.high &&
          strategyRange.low === range.low
        )
      }
      return assertBucketEntryEligible({
        instrument,
        market: deskMarketFor(instrument),
        timeSec: deskClockSeconds(instrument),
        ladder,
        rangeLabel: range.label,
      }).ok
    }
    const snapped = snapEntryToNearestOpenBandCenter({
      entry: boxEntry,
      candidates: snapRanges,
      preferLabel,
      liveOk,
    })
    if (!snapped) {
      onDeskAlert?.({
        kind: 'entry_band_deny',
        title: 'Off-band entry',
        body: RANGE_EDGE_OFF_BAND_MESSAGE,
        telegram: '',
        instrument,
      })
      return
    }
    const hit = snapped.hit
    // Lock to band center — never place mid-band interior from a drifted risk box.
    const entryPrice = snapDeskPrice(instrument, hit.center)
    const attributedRange = hit.range

    // Check if Leo was consulted for this session / price
    const discussedWithLeo = (levelsRef.current || []).some(
      (l) => Math.abs(l.price - entryPrice) / entryPrice < 0.005
    )

    const autoReason = discussedWithLeo
      ? `Manual ${direction} Limit Zone (Discussed with Leo): Level @ ${entryPrice.toLocaleString()}, SL @ ${stopLoss.toLocaleString()}, TP @ ${profitTarget.toLocaleString()}`
      : `Manual ${direction} entry: Technical structure limit @ ${entryPrice.toLocaleString()} | SL/TP rationale: Protective SL @ ${stopLoss.toLocaleString()}, Target TP @ ${profitTarget.toLocaleString()}`

    onLevelSelect?.(entryPrice, {
      source: 'manual',
      type: 'manual',
      orderType: 'LIMIT',
      side: direction === 'LONG' ? 'BUY' : 'SHORT',
      preferredDirection: direction,
      reasoning: autoReason,
      stopLoss,
      profitTarget,
      strategyRange: attributedRange,
      strategyMagnets,
    })
    cancelRiskBox()
  }, [riskBox, onLevelSelect, cancelRiskBox, getStrategyRiskBundle, onDeskAlert, instrument])

  const toggleRiskBoxDirection = useCallback(() => {
    if (!riskBox) return
    const newDir: 'LONG' | 'SHORT' = riskBox.direction === 'LONG' ? 'SHORT' : 'LONG'
    setRiskBox((prev) => {
      if (!prev) return null
      const entryPx = prev.entryPrice
      const slDist = Math.abs(prev.entryPrice - prev.stopLoss)
      const tpDist = Math.abs(prev.profitTarget - prev.entryPrice)
      const newSL = newDir === 'LONG' ? entryPx - slDist : entryPx + slDist
      const newTP = newDir === 'LONG' ? entryPx + tpDist : entryPx - tpDist

      return {
        ...prev,
        direction: newDir,
        stopLoss: snapDeskPrice(instrument, newSL),
        profitTarget: snapDeskPrice(instrument, newTP),
      }
    })
  }, [instrument, riskBox, getStrategyRiskBundle, onDeskAlert])

  // ── Keyboard shortcuts: V (Voice), L (Levels), P (Playbook), D (Draw Zone), T (Highlight Time), H (Sessions), O (Risk Box), F (Fullscreen), Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const key = e.key.toLowerCase()

      if (key === 'f') {
        e.preventDefault()
        toggleFullscreen()
      } else if (key === 'l') {
        e.preventDefault()
        setShowLevels((prev) => !prev)
      } else if (key === 'y') {
        e.preventDefault()
        setShowYesterdayProfile((prev) => !prev)
      } else if (key === 'h') {
        e.preventDefault()
        setShowSessionBands((prev) => !prev)
      } else if (key === 'n') {
        e.preventDefault()
        if (isOr15Instrument(instrument)) {
          setShowOr15((prev) => !prev)
        }
      } else if (key === 'u') {
        e.preventDefault()
      } else if (key === 'r') {
        e.preventDefault()
        if (isOr30Instrument(instrument)) {
          setShowOr30((prev) => !prev)
        }
      } else if (key === 'p') {
        e.preventDefault()
        togglePlaybook()
      } else if (key === 'w' || key === 'x') {
        e.preventDefault()
        setActiveDrawingTool((prev) => (prev === 'TRENDLINE' ? 'NONE' : 'TRENDLINE'))
        setDrawingDraft(null)
      } else if (key === 'd') {
        e.preventDefault()
        setActiveDrawingTool((prev) => (prev === 'RANGE' ? 'NONE' : 'RANGE'))
        setDrawingDraft(null)
      } else if (key === 'v') {
        e.preventDefault()
        setActiveDrawingTool((prev) => (prev === 'FRVP' ? 'NONE' : 'FRVP'))
        setDrawingDraft(null)
      } else if (key === 'm') {
        e.preventDefault()
        setActiveDrawingTool((prev) => (prev === 'MEASURE' ? 'NONE' : 'MEASURE'))
        setDrawingDraft(null)
      } else if (key === 't') {
        e.preventDefault()
        setDrawTimeActive((prev) => {
          if (prev) {
            cancelDrawnTime()
            return false
          } else {
            setDrawnTime(null)
            return true
          }
        })
      } else if (key === 'a') {
        e.preventDefault()
        togglePriceAlert()
      } else if (key === 'escape') {
        if (selectedTrendlineId) {
          e.preventDefault()
          setSelectedTrendlineId(null)
          requestAnimationFrame(() => paintUserDrawingsRef.current())
        } else if (activeDrawingTool !== 'NONE' || drawingDraft) {
          e.preventDefault()
          setActiveDrawingTool('NONE')
          setDrawingDraft(null)
          draftMousePosRef.current = null
        } else if (activeMeasures.length > 0) {
          e.preventDefault()
          setMeasures((prev) => prev.slice(0, -1))
          requestAnimationFrame(() => paintUserDrawingsRef.current())
        } else if (riskBoxActive || riskBox) {
          e.preventDefault()
          cancelRiskBox()
        } else if (priceAlert) {
          e.preventDefault()
          dismissPriceAlert()
        } else if (drawZoneActive || drawnZone) {
          e.preventDefault()
          cancelDrawnZone()
        } else if (drawTimeActive || drawnTime) {
          e.preventDefault()
          cancelDrawnTime()
        } else if (isFullscreen) {
          e.preventDefault()
          if (document.exitFullscreen && document.fullscreenElement) {
            document.exitFullscreen().catch(() => null)
          }
          setIsFullscreen(false)
        }
      }
    }

    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
      requestAnimationFrame(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.resize(
            containerRef.current.clientWidth,
            containerRef.current.clientHeight
          )
        }
        if (cvdContainerRef.current && cvdChartRef.current) {
          cvdChartRef.current.resize(
            cvdContainerRef.current.clientWidth,
            cvdContainerRef.current.clientHeight
          )
        }
        pokeOverlayLayoutRef.current()
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('fullscreenchange', onFsChange)
    }
  }, [
    isFullscreen,
    activeDrawingTool,
    drawingDraft,
    drawZoneActive,
    drawnZone,
    drawTimeActive,
    drawnTime,
    toggleFullscreen,
    cancelDrawnZone,
    clearDrawnZoneLines,
    cancelDrawnTime,
    instrument,
    riskBoxActive,
    riskBox,
    cancelRiskBox,
    openRiskBox,
    priceAlert,
    dismissPriceAlert,
    togglePriceAlert,
  ])

  // ── Hover visible AI/structure level → preview entry / SL / TP ─
  // Morning: place preview. Afternoon: same geometry, watch-only (canPlaceOrder false).
  useEffect(() => {
    clearHoverPreview()
  }, [clearHoverPreview])

  // ── Position / working-limit overlay lines (host series — survives candle setData)
  // Independent of Hide levels — AI/structure lines toggle separately.
  useEffect(() => {
    const host = priceLineHostRef.current
    clearHoverPreview()
    positionLinesRef.current.forEach(line => {
      try { host?.removePriceLine(line) } catch { }
    })
    positionLinesRef.current = []

    const savedSpacing = readDeskBarSpacing(chartRef.current)

    if (!host || !chartReady) {
      return
    }

    const fmt = (n: number) =>
      n.toLocaleString('en-US', { maximumFractionDigits: 0 })

    const paint = (
      entries: Array<{ price: number; color: string; label: string; style: LineStyle; width: 1 | 2 | 3 | 4 }>
    ) => {
      for (const { price, color, label, style, width } of entries) {
        if (!Number.isFinite(price) || price <= 0) continue
        try {
          positionLinesRef.current.push(
            host.createPriceLine({
              price,
              color,
              lineStyle: style,
              lineWidth: width,
              axisLabelVisible: true,
              title: label,
            })
          )
        } catch { /* ignore */ }
      }
      keepDeskBarSpacing(chartRef.current, savedSpacing)
    }

    if (positionOverlay || editableOverlay) {
      const ov = editableOverlay ?? positionOverlay
      if (!ov) return
      const tpLabel = 'Target'
      const tpColor = '#22c55e'
      const size = filledBook?.sizeNote ? ` · ${filledBook.sizeNote}` : ''
      paint([
        {
          price: filledBook?.entry ?? ov.entryPrice,
          color: '#1d4ed8',
          label: `Entry ${ov.direction.toUpperCase()} ${fmt(filledBook?.entry ?? ov.entryPrice)}${size}`,
          style: LineStyle.Solid,
          width: 3,
        },
        {
          price: filledBook?.stop ?? ov.stopLoss,
          color: '#dc2626',
          label: `SL ${fmt(filledBook?.stop ?? ov.stopLoss)}${onAdjustBrackets ? ' · drag' : ''}`,
          style: LineStyle.Solid,
          width: 3,
        },
        {
          price: filledBook?.target ?? ov.profitTarget,
          color: tpColor,
          label: `${tpLabel} ${fmt(filledBook?.target ?? ov.profitTarget)}${onAdjustBrackets ? ' · drag' : ''}`,
          style: LineStyle.Solid,
          width: 3,
        },
      ])
      return
    }

    const asiaLive =
      asiaOco && asiaOco.qualified && asiaOco.event === 'place_both'
    if (asiaLive && asiaOco) {
      const frac = asiaOco.instrument === 'GOLD' ? 1 : 0
      const fmtA = (n: number) =>
        n.toLocaleString('en-US', { maximumFractionDigits: frac })
      paint([
        {
          price: asiaOco.asiaHigh,
          color: '#26a69a',
          label: `ASIA H ${fmtA(asiaOco.asiaHigh)}`,
          style: LineStyle.Dotted,
          width: 1,
        },
        {
          price: asiaOco.asiaLow,
          color: '#ef5350',
          label: `ASIA L ${fmtA(asiaOco.asiaLow)}`,
          style: LineStyle.Dotted,
          width: 1,
        },
        {
          price: asiaOco.buyStop,
          color: '#00e676',
          label: `BUY STOP ${fmtA(asiaOco.buyStop)} · ${asiaOco.contract} x ${asiaOco.contracts}`,
          style: LineStyle.Solid,
          width: 3,
        },
        {
          price: asiaOco.sellStop,
          color: '#ff1744',
          label: `SELL STOP ${fmtA(asiaOco.sellStop)} · ${asiaOco.contract} x ${asiaOco.contracts}`,
          style: LineStyle.Solid,
          width: 3,
        },
        {
          price: asiaOco.asiaMid,
          color: '#ffeb3b',
          label: `SL MID ${fmtA(asiaOco.asiaMid)}`,
          style: LineStyle.Solid,
          width: 2,
        },
        {
          price: asiaOco.longTp,
          color: '#69f0ae',
          label: `LONG TP ${fmtA(asiaOco.longTp)}`,
          style: LineStyle.Dotted,
          width: 2,
        },
        {
          price: asiaOco.shortTp,
          color: '#ff8a80',
          label: `SHORT TP ${fmtA(asiaOco.shortTp)}`,
          style: LineStyle.Dotted,
          width: 2,
        },
      ])
    }

    if (pendingLimit) {
      const pend = editablePending ?? pendingLimit
      const dir = pend.direction.toUpperCase()
      const tpDrag = onAdjustWorkingBrackets ? ' · drag' : ''
      const size = workingBook?.sizeNote ? ` · ${workingBook.sizeNote}` : ''
      paint([
        {
          price: workingBook?.entry ?? pend.price,
          color: '#38bdf8',
          label: `WORKING ${dir} ${fmt(workingBook?.entry ?? pend.price)}${size}`,
          style: LineStyle.Solid,
          width: 3,
        },
        {
          price: workingBook?.stop ?? pend.stopLoss,
          color: '#ef4444',
          label: `SL ${fmt(workingBook?.stop ?? pend.stopLoss)} · locked`,
          style: LineStyle.Dotted,
          width: 2,
        },
        {
          price: workingBook?.target ?? pend.profitTarget,
          color: '#22c55e',
          label: `TP ${fmt(workingBook?.target ?? pend.profitTarget)}${tpDrag}`,
          style: LineStyle.Dotted,
          width: 2,
        },
      ])
      return
    }

    // ── Armed Situations Overlay Lines (Target Level, Planned SL & TP) ──
    if (armedSituations.length > 0 && !positionOverlay && !editableOverlay && !pendingLimit) {
      const allSitEntries: Array<{ price: number; color: string; label: string; style: LineStyle; width: 1 | 2 | 3 | 4 }> = []
      for (const sit of armedSituations) {
        const targetPx = sit.targetPrice ?? sit.conditions?.targetPrice
        if (!targetPx || targetPx <= 0) continue
        const dir = (sit.direction || 'LONG').toUpperCase()
        const pat = sit.pattern || sit.conditions?.pattern || sit.targetReference || 'Level Touch'
        allSitEntries.push({
          price: targetPx,
          color: dir === 'LONG' ? '#06b6d4' : '#f59e0b',
          label: `🎯 SITUATION ${dir} @ ${fmt(targetPx)} (${pat})`,
          style: LineStyle.Dashed,
          width: 2,
        })
        const sl = sit.stopLoss ?? sit.conditions?.stopLoss
        if (sl && sl > 0) {
          allSitEntries.push({
            price: sl,
            color: '#ef4444',
            label: `▁ SIT SL ${fmt(sl)}`,
            style: LineStyle.Dotted,
            width: 2,
          })
        }
        const tp = sit.takeProfit ?? sit.conditions?.takeProfit
        if (tp && tp > 0) {
          allSitEntries.push({
            price: tp,
            color: '#10b981',
            label: `▔ SIT TP ${fmt(tp)}`,
            style: LineStyle.Dotted,
            width: 2,
          })
        }
      }
      if (allSitEntries.length > 0) {
        paint(allSitEntries)
        return
      }
    }
  }, [positionOverlay, editableOverlay, pendingLimit, editablePending, filledBook, workingBook, aiVerdict, chartReady, clearHoverPreview, onAdjustBrackets, onAdjustWorkingBrackets, asiaOco, armedSituations])

  /** Levels / playbook — strategy-aware titles (morning → IB → lunch break → lunch-range) */
  void focusTick
  const playbookMode = resolveDeskPlaybookMode({
    instrument,
    rangeStrategy,
    ladder: attemptLadderFromCounts({
      morningAttempts,
      ibAttempts,
      lunchAttempts,
      morningStopHits: stopHits,
    }),
  })

  /** ±10 of active playbook range while entries unlocked (limit or market). */
  const edgeProximity = useMemo(() => {
    if (!canPlaceOrder || !livePrice) return null
    const strategyRangeRaw = activeRangeForPlaybook({
      playbookMode,
      instrument,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      or15: or15RangeRef.current,
      morningAttempts,
    })
    const strategyRange = strategyRangeRaw
      ? applyIbLiquiditySwingToRange(strategyRangeRaw, ibExtendRef.current?.swing)
      : null
    return rangeEdgeProximity(livePrice, strategyRange)
  }, [canPlaceOrder, livePrice, playbookMode, instrument, rangeStrategy, morningAttempts, ibExtendBadge])

  /** Drop the ±10 tags only when the chart itself goes away. */
  useEffect(() => {
    return () => {
      const h = priceLineHostRef.current
      for (const line of entryBandLinesRef.current) {
        try {
          h?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      }
      entryBandLinesRef.current = []
      entryBandPaintKeyRef.current = null
      entryBandPaintHostRef.current = null
    }
  }, [])

  /** Paint ±10 zones for toggled shaped overlays (OR30 only while morning window open). */
  useEffect(() => {
    // Context 5-5: Order entry band highlights removed
  }, [])

  // Active playbook range ATR chip (advise-only; refresh with focusTick / range shape)
  const onRangeAtrRef = useRef(onRangeAtr)
  useEffect(() => {
    onRangeAtrRef.current = onRangeAtr
  }, [onRangeAtr])
  useEffect(() => {
    void focusTick
    const strategyRange = activeRangeForPlaybook({
      playbookMode,
      instrument,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      or15: or15RangeRef.current,
      morningAttempts,
    })
    if (!strategyRange || !(strategyRange.high > strategyRange.low)) {
      setRangeAtrSnap((prev) => (prev == null ? prev : null))
      onRangeAtrRef.current?.(null)
      return
    }
    const snap = buildRangeAtrSnapshot({
      rangeLabel: strategyRange.label,
      high: strategyRange.high,
      low: strategyRange.low,
      bars: candlesRef.current,
    })
    setRangeAtrSnap((prev) => {
      if (
        prev &&
        snap &&
        prev.rangeLabel === snap.rangeLabel &&
        prev.height === snap.height &&
        prev.atr === snap.atr &&
        prev.stopPad === snap.stopPad &&
        prev.trailStep === snap.trailStep
      ) {
        return prev
      }
      return snap
    })
    onRangeAtrRef.current?.(snap)
  }, [
    playbookMode,
    instrument,
    rangeStrategy,
    morningAttempts,
    or30Locked,
    ibShaped,
    or15Locked,
    usRangeShaped,
    focusTick,
  ])

  const wasCallSetupRef = useRef(false)
  const setupAlertPrimedRef = useRef(false)
  const setupAlertInstrumentRef = useRef(instrument)
  useEffect(() => {
    const call = deskCallRef.current
    const nowSetup = isNyCallSetup({
      side: call?.side,
      edge: edgeProximity?.edge,
      bookLocked: call?.bookLocked,
    })
    if (setupAlertInstrumentRef.current !== instrument) {
      setupAlertInstrumentRef.current = instrument
      setupAlertPrimedRef.current = false
      wasCallSetupRef.current = false
    }
    if (!setupAlertPrimedRef.current) {
      if (livePrice == null) return
      setupAlertPrimedRef.current = true
      wasCallSetupRef.current = nowSetup
    }

    if (
      nowSetup &&
      call &&
      call.side !== 'WAIT' &&
      call.rangeKey &&
      call.entryPrice != null &&
      call.entryEdge &&
      livePrice != null &&
      onDeskAlert &&
      isDeskInstrument(instrument) &&
      claimDeskNoteOnce(`call_setup_${call.side}_${call.rangeKey}`, instrument)
    ) {
      const telegram = formatCallSetupTelegram({
        instrument,
        side: call.side,
        rangeKey: call.rangeKey,
        entryPrice: call.entryPrice,
        edge: call.entryEdge,
        livePrice,
      })
      onDeskAlert({
        kind: 'call_setup',
        title: `SETUP ${instrument} · CALL ${call.side}`,
        body: `${call.rangeKey} legal ±10 ${call.entryEdge.toUpperCase()} @ ${call.entryPrice.toLocaleString()}`,
        telegram,
        instrument,
        dedupeKey: deskNoteClaimKey(
          `call_setup_${call.side}_${call.rangeKey}`,
          instrument
        ),
      })
    }

    wasCallSetupRef.current = nowSetup
  }, [
    edgeProximity,
    livePrice,
    instrument,
    onDeskAlert,
  ])

  /** Rising edge: OR30 / IB / lunch / US Range fully shaped → structured Telegram note. */
  const prevRangeLocksRef = useRef({
    or30: false,
    ib: false,
    lunch: false,
    us: false,
  })
  const rangeNotesPrimedRef = useRef(false)
  const rangeNotesInstrumentRef = useRef(instrument)
  useEffect(() => {
    if (!onDeskAlert || !isDeskInstrument(instrument)) return
    const next = {
      or30: or30Locked,
      ib: ibShaped,
      lunch: or15Locked,
      us: false,
    }

    // Instrument tab change or first mount: seed from durable claims + current locks.
    // Refresh must not re-send shaped notes (bare-chart still computes ranges under the hood).
    if (
      !rangeNotesPrimedRef.current ||
      rangeNotesInstrumentRef.current !== instrument
    ) {
      rangeNotesPrimedRef.current = true
      rangeNotesInstrumentRef.current = instrument
      prevRangeLocksRef.current = {
        or30: next.or30 || hasDeskNoteClaim('range_or30', instrument),
        ib: next.ib || hasDeskNoteClaim('range_ib', instrument),
        lunch: next.lunch || hasDeskNoteClaim('range_lunch', instrument),
        us: next.us || hasDeskNoteClaim('range_us', instrument),
      }
      return
    }

    const prev = prevRangeLocksRef.current

    if (next.or30 && !prev.or30) {
      const r = or30RangeRef.current
      if (r && claimDeskNoteOnce('range_or30', instrument)) {
        const atrSnap = buildRangeAtrSnapshot({
          rangeLabel: 'OR30',
          high: r.high,
          low: r.low,
          bars: candlesRef.current,
        })
        const note = formatRangeShapedNote({
          instrument,
          rangeLabel: 'OR30',
          high: r.high,
          low: r.low,
          atrLine: atrSnap ? formatRangeAtrAdviceLine(atrSnap) : null,
          nextHint:
            'Optional morning probe (±10 H / L). If unused when IB locks → hand off to IB.',
        })
        onDeskAlert({
          ...note,
          instrument,
          dedupeKey: deskNoteClaimKey('range_or30', instrument),
        })
      }
    }
    if (next.ib && !prev.ib) {
      const r = ibRangeRef.current
      if (r && claimDeskNoteOnce('range_ib', instrument)) {
        const label = 'IB'
        const atrSnap = buildRangeAtrSnapshot({
          rangeLabel: label,
          high: r.high,
          low: r.low,
          bars: candlesRef.current,
        })
        const note = formatRangeShapedNote({
          instrument,
          rangeLabel: label,
          high: r.high,
          low: r.low,
          atrLine: atrSnap ? formatRangeAtrAdviceLine(atrSnap) : null,
          nextHint: 'IB entry window is open (±10 of locked H / L).',
        })
        onDeskAlert({
          ...note,
          instrument,
          dedupeKey: deskNoteClaimKey('range_ib', instrument),
        })
      }
    }
    if (next.lunch && !prev.lunch) {
      const r = or15RangeRef.current
      if (r && claimDeskNoteOnce('range_lunch', instrument)) {
        const atrSnap = buildRangeAtrSnapshot({
          rangeLabel: 'Open range',
          high: r.high,
          low: r.low,
          bars: candlesRef.current,
        })
        const note = formatRangeShapedNote({
          instrument,
          rangeLabel: 'Open range',
          high: r.high,
          low: r.low,
          atrLine: atrSnap ? formatRangeAtrAdviceLine(atrSnap) : null,
          nextHint: 'Open-range entry window is open (±10 of locked H / L).',
        })
        onDeskAlert({
          ...note,
          instrument,
          dedupeKey: deskNoteClaimKey('range_lunch', instrument),
        })
      }
    }
    if (next.us && !prev.us) {
      const r = usRangeRef.current
      if (r && claimDeskNoteOnce('range_us', instrument)) {
        const atrSnap = buildRangeAtrSnapshot({
          rangeLabel: 'US Range',
          high: r.high,
          low: r.low,
          bars: candlesRef.current,
        })
        const note = formatRangeShapedNote({
          instrument,
          rangeLabel: 'US Range (prior NYC)',
          high: r.high,
          low: r.low,
          atrLine: atrSnap ? formatRangeAtrAdviceLine(atrSnap) : null,
          nextHint:
            'Already shaped from prior NYC session. Entry when US Range window unlocks (±10 H / L only).',
        })
        onDeskAlert({
          ...note,
          instrument,
          dedupeKey: deskNoteClaimKey('range_us', instrument),
        })
      }
    }

    prevRangeLocksRef.current = next
  }, [
    or30Locked,
    ibShaped,
    or15Locked,
    usRangeShaped,
    instrument,
    onDeskAlert,
  ])

  /** Active entry unlock — same rule for DOW/NASDAQ (ET) and NIKKEI (JST). */
  const inEntryWindow = isDeskEntryWindowActive({
    playbookMode,
    rangeStrategy,
    canPlaceEntry: canPlaceOrder,
  })
  /** Observe-only outside entry windows (lunch break / done). */
  const afternoonWatch =
    clockReady &&
    isAfternoonWatchWindow(new Date(), instrument) &&
    !canPlaceOrder &&
    !inEntryWindow &&
    isDeskWatchOnlyPlaybook(playbookMode)

  const playbookPanelTitle = deskPlaybookPanelTitle(playbookMode, instrument, {
    watchOnly: afternoonWatch,
  })
  const watchPlaybookHint = deskPlaybookHint(playbookMode, instrument)
  const callAdviseSide: 'BUY' | 'SHORT' | null = callBadge.includes('SHORT')
    ? 'SHORT'
    : callBadge.includes('LONG')
      ? 'BUY'
      : null
  const playbookAdviseLevels = (() => {
    const cards = levels.filter((l) => l.source === 'ai' || l.source === 'structure')
    if (!callAdviseSide) return cards.slice(0, 4)
    const aligned = cards.filter((l) => {
      const side: 'BUY' | 'SHORT' =
        l.side === 'BUY' || l.side === 'SHORT'
          ? l.side
          : l.type === 'resistance'
            ? 'SHORT'
            : 'BUY'
      return side === callAdviseSide
    })
    return (aligned.length > 0 ? aligned : cards).slice(0, 4)
  })()

  const renderSavedHighlightBoxes = () => {
    // Combine saved highlights and the currently active unsent drawnTime highlight
    const listToRender = [...savedHighlights]
    if (drawnTime) {
      listToRender.push({
        id: 'unsent-drawn-time',
        label: drawnTime.label,
        startUnix: drawnTime.startUnix,
        endUnix: drawnTime.endUnix,
        priceHigh: drawnTime.priceHigh,
        priceLow: drawnTime.priceLow,
        priceStart: drawnTime.priceStart,
        priceEnd: drawnTime.priceEnd,
        rangeHigh: drawnTime.rangeHigh,
        rangeLow: drawnTime.rangeLow,
        candleStartOpen: drawnTime.candleStartOpen,
        candleEndClose: drawnTime.candleEndClose,
        candleCount: drawnTime.candleCount,
        netMovePts: drawnTime.netMovePts,
        netMovePct: drawnTime.netMovePct,
        sessionSpanStr: 'Unsent highlight',
        visible: true,
      })
    }

    return listToRender.map((hl, idx) => {
      if (!hl.visible) return null

      const boxTime = `${toChartTime(hl.startUnix, chartTzRef.current)},${toChartTime(
        hl.endUnix,
        chartTzRef.current
      )}`

      // Handle price boundaries: use exact priceHigh and priceLow drawn by user (do NOT extend vertically)
      const pHigh = hl.priceHigh || hl.rangeHigh || (candles.length > 0 ? Math.max(...candles.map(c => c.high)) : 100000)
      const pLow = hl.priceLow || hl.rangeLow || (candles.length > 0 ? Math.min(...candles.map(c => c.low)) : 0)

      const isUnsent = hl.id === 'unsent-drawn-time'
      const theme = getHighlightTheme(idx, isUnsent)

      return (
        <div
          key={hl.id}
          data-ov-box-price={`${pHigh},${pLow}`}
          data-ov-box-time={boxTime}
          className={`absolute border border-dashed rounded pointer-events-none z-20 flex flex-col justify-between p-1.5 ${theme.border} ${theme.bg}`}
          style={{
            left: 0,
            top: 0,
            transform: OVERLAY_HIDDEN_TRANSFORM,
            transition: 'none',
          }}
        >
          <span className={`text-[9px] font-mono font-extrabold border px-1.5 py-0.5 rounded w-max select-none leading-none shadow-md ${theme.text} ${theme.pillBg} ${theme.pillBorder}`}>
            {hl.label}
          </span>
          {!isUnsent && (
            <span className={`text-[7px] font-bold self-end select-none opacity-80 ${theme.badgeText}`}>
              SAVED
            </span>
          )}
        </div>
      )
    })
  }

  return (
    <div
      ref={outerWrapperRef}
      className={`flex flex-col gap-1 overflow-hidden ${isFullscreen
        ? 'fixed inset-0 z-[100] bg-[#0d1117] p-2 h-screen w-full max-w-full'
        : 'h-full w-full max-w-full min-h-0'
        }`}
    >
      {/* ── Toolbar & Sub-header HUD (Hidden in Fullscreen Mode) ────────────────── */}
      {!isFullscreen && (
        <div ref={chartHeaderRef} className="flex flex-col gap-1 shrink-0 select-none overscroll-none">
          {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-1.5 pb-0.5 shrink-0">
            {/* Instrument tabs — LIVE focus hides off-session desks */}
            <div className="tab-bar">
              {visibleInstruments.map((inst) => (
                <button
                  key={inst}
                  onClick={() => setInstrument(inst)}
                  className={`tab ${instrument === inst ? 'tab-active' : ''}`}
                  style={instrument === inst ? { backgroundColor: INSTRUMENT_META[inst].color + '33', color: INSTRUMENT_META[inst].color } : {}}
                >
                  {liveDeskContractLabel(inst)}
                </button>
              ))}
            </div>

            {/* Timeframe selector */}
            <div className="flex items-center rounded-lg border border-surface-700 bg-surface-900/80 p-0.5">
              {(['1m', '5m', '30m', '1D'] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => {
                    if (timeframe === tf) return
                    didFitRef.current = false
                    priceLineHostSeededRef.current = false
                    lastCandleRef.current = null
                    sessionSpansRef.current = null
                    setCandles([])
                    candlesRef.current = []
                    try { candleRef.current?.setData([]) } catch {}
                    try { volumeSeriesRef.current?.setData([]) } catch {}
                    try { priceLineHostRef.current?.setData([]) } catch {}
                    setTimeframe(tf)
                  }}
                  className={`rounded px-2.5 py-1 text-xs font-semibold transition-all ${
                    timeframe === tf
                      ? 'bg-blue-600 text-white shadow-sm font-bold'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-surface-800'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>



            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-surface-900/90 border border-neutral-700/60 shadow-sm text-xs font-mono">
              <button
                type="button"
                onClick={() => {
                  setHideTrendlineBadges((prev) => {
                    const next = !prev
                    try {
                      localStorage.setItem('hide_trendline_badges', String(next))
                    } catch {}
                    return next
                  })
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded font-bold transition shadow-sm active:scale-95 cursor-pointer ${
                  hideTrendlineBadges
                    ? 'bg-amber-500/25 hover:bg-amber-500/40 border border-amber-500/70 text-amber-300'
                    : 'bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 text-neutral-300 hover:text-white'
                }`}
                title={
                  hideTrendlineBadges
                    ? 'Systematic text labels on trendlines are hidden (Click to show labels)'
                    : 'Hide systematic text labels on trendlines (Keeps initiate & responsive lines visible on chart)'
                }
              >
                <span>{hideTrendlineBadges ? '🙈 Labels: OFF' : '🏷️ Labels: ON'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setChartThemeMode((prev) => {
                    const next = prev === 'dark' ? 'light' : 'dark'
                    try {
                      localStorage.setItem('desk_chart_theme_mode', next)
                    } catch {}
                    return next
                  })
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded font-bold transition shadow-sm active:scale-95 cursor-pointer ${
                  chartThemeMode === 'light'
                    ? 'bg-sky-500/25 hover:bg-sky-500/40 border border-sky-400 text-sky-200'
                    : 'bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 text-neutral-300 hover:text-white'
                }`}
                title="Switch between Light theme (white background) and Dark theme (black background)"
              >
                <span>{chartThemeMode === 'light' ? '☀️ Light Mode' : '🌙 Dark Mode'}</span>
              </button>
            </div>

            {/* Live price ticker */}
            <div className="ml-auto flex items-center gap-3">
              <LivePriceTicker
                subscribe={subscribePriceTick}
                getTick={getPriceTick}
                instrument={instrument}
                barCountdown={barCountdown}
                timeframe={timeframe}
              />
              {dataMode === 'live' ? (
                candleFeed === 'databento' || candleFeed === 'yahoo' ? (
                  <span
                    className="flex items-center gap-1 text-xs font-semibold text-emerald-400"
                    title={
                      candleFeed === 'databento'
                        ? 'Official CME Globex MDP 3.0 Real-Time Exchange Feed (Databento API Active)'
                        : 'Live CME futures real-time feed active'
                    }
                  >
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    {candleFeed === 'databento'
                      ? 'LIVE · DATABENTO'
                      : 'LIVE · CME'}
                  </span>
                ) : null
              ) : (
                <span
                  className="flex items-center gap-1 text-xs text-amber-400"
                  title="Candle API failed — showing demo prices. Do not trade off this chart."
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  SYNTHETIC
                </span>
              )}
            </div>
          </div>

          {/* ── Compact Evaluators & OHLCV Tooltip Row ─────────────────────────── */}
          <div className="flex flex-nowrap items-center justify-between gap-x-2 px-1 py-0.5 text-[10.5px] text-gray-400 h-[24px] min-h-[24px] max-h-[24px] shrink-0 overflow-hidden select-none">
            <div className="flex flex-nowrap items-center gap-x-2 overflow-x-auto scrollbar-none min-w-0 flex-1">
              {/* Structural Evaluators: Day Type, Opening, and Overnight Inventory (Active Session Only) */}
              {(() => {
                const nycActive = isNycSessionActive()
                if (!nycActive) return null

                const invText = overnightInventory
                  ? `${overnightInventory.biasLabel} · ${overnightInventory.rangeLabel}`
                  : 'WAIT'
                const invColor = !overnightInventory
                  ? 'text-gray-400'
                  : overnightInventory.bias.includes('LONG')
                  ? 'text-emerald-400'
                  : overnightInventory.bias.includes('SHORT')
                  ? 'text-rose-400'
                  : 'text-amber-300'
                const invTitle = overnightInventory
                  ? `${overnightInventory.description} (Long: ${overnightInventory.pctLong}%, Short: ${overnightInventory.pctShort}%)`
                  : 'Overnight Inventory vs Prior NYC Close (Calculated across Globex: Asia, London, Pre-Market)'

                return (
                  <>
                    <div className="flex items-center gap-1 select-none">
                      <span className="text-gray-500">Day: </span>
                      <span className="text-purple-300 font-semibold">
                        {dayTypeOverride ? '🤖 ' : ''}{dayTypeEval.badgeText}{dayTypeOverride ? ' (AI Overwrite)' : ''}
                      </span>
                    </div>
                    {dayTypeOverride && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDayTypeOverride(null)
                        }}
                        className="text-[9px] text-amber-400/80 hover:text-amber-300 hover:underline px-1 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 font-mono transition cursor-pointer"
                        title="Revert AI Overwrite back to mathematical Day Type"
                      >
                        Reset Math
                      </button>
                    )}
                    <span className="text-gray-600 text-[10px]">|</span>
                    <div className="flex items-center gap-1 select-none">
                      <span className="text-gray-500">Open: </span>
                      <span className="text-cyan-300 font-semibold">
                        {openingBadge}
                      </span>
                    </div>
                    <span className="text-gray-600 text-[10px]">|</span>
                    <div
                      className="flex items-center gap-1 select-none cursor-default"
                      title={invTitle}
                    >
                      <span className="text-gray-500">Inventory: </span>
                      <span className={`${invColor} font-semibold`}>
                        {invText}
                      </span>
                    </div>
                    <span className="text-gray-600 text-[10px]">|</span>
                  </>
                )
              })()}
              {/* 5-Month Anchored VWAP (5M AVWAP) Button with SD Bands */}
              <button
                type="button"
                onClick={() => {
                  setShow5mAvwapOnChart((prev) => {
                    const next = !prev
                    try {
                      window.localStorage.setItem('desk.avwap5m.open.v1', next ? '1' : '0')
                    } catch {}
                    return next
                  })
                }}
                className={`transition flex items-center gap-1.5 select-none px-1.5 py-0.5 rounded cursor-pointer ${
                  show5mAvwapOnChart
                    ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/60 shadow-sm font-semibold'
                    : 'bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800 border border-zinc-700/40'
                }`}
                title="Toggle 5-Month Anchored VWAP benchmark & ±1σ/±2σ/±3σ bands on chart"
              >
                <span className="text-[11px]">🌐</span>
                <span className="text-gray-400 font-semibold">5M AVWAP:</span>
                <span className={`font-mono font-bold ${show5mAvwapOnChart ? 'text-emerald-300' : 'text-zinc-400'}`}>
                  {show5mAvwapOnChart ? 'ON' : 'OFF'}
                </span>
              </button>
              {/* Interactive CVD Sub-Chart Pane Button */}
              <button
                type="button"
                onClick={() => setShowCvdSubPane((prev) => !prev)}
                className={`transition flex items-center gap-1.5 select-none px-1.5 py-0.5 rounded cursor-pointer ${
                  showCvdSubPane
                    ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/60 shadow-sm font-semibold'
                    : 'bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800 border border-zinc-700/40'
                }`}
                title="Click to toggle CVD Sub-Chart Pane"
              >
                <span className="text-[11px]">📊</span>
                <span className="text-gray-400 font-semibold">CVD:</span>
                <span className={`font-mono font-bold ${showCvdSubPane ? 'text-cyan-300' : 'text-zinc-400'}`}>
                  {showCvdSubPane ? 'ON' : 'OFF'}
                </span>
                {sessionOrderFlow?.divergence !== 'NONE' && (
                  <span className="relative flex h-2 w-2">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      sessionOrderFlow?.divergence === 'BULLISH_ABSORPTION' ? 'bg-emerald-400' : 'bg-rose-400'
                    }`} />
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${
                      sessionOrderFlow?.divergence === 'BULLISH_ABSORPTION' ? 'bg-emerald-500' : 'bg-rose-500'
                    }`} />
                  </span>
                )}
              </button>
              {/* News Events Markers Toggle Button */}
              <button
                type="button"
                onClick={() => setShowNewsOnChart((prev) => !prev)}
                className={`transition flex items-center gap-1.5 select-none px-1.5 py-0.5 rounded cursor-pointer ${
                  showNewsOnChart
                    ? 'bg-purple-500/25 text-purple-200 border border-purple-400/60 shadow-sm font-semibold'
                    : 'bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800 border border-zinc-700/40'
                }`}
                title="Toggle upcoming economic news event markers on chart time-axis"
              >
                <span className="text-[11px]">⚡</span>
                <span className="text-gray-400 font-semibold">News:</span>
                <span className={`font-mono font-bold ${showNewsOnChart ? 'text-purple-300' : 'text-zinc-400'}`}>
                  {showNewsOnChart ? 'ON' : 'OFF'}
                </span>
              </button>
              {/* News Catalyst Anchored VWAP (News AVWAP) Button */}
              <button
                type="button"
                onClick={() => setShowNewsAvwap((prev) => !prev)}
                className={`transition flex items-center gap-1.5 select-none px-1.5 py-0.5 rounded cursor-pointer ${
                  showNewsAvwap
                    ? 'bg-amber-500/25 text-amber-200 border border-amber-400/60 shadow-sm font-semibold'
                    : 'bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800 border border-zinc-700/40'
                }`}
                title="Toggle News Catalyst Anchored VWAP & standard deviation bands on chart"
              >
                <span className="text-[11px]">⚡</span>
                <span className="text-gray-400 font-semibold">News AVWAP:</span>
                <span className={`font-mono font-bold ${showNewsAvwap ? 'text-amber-300' : 'text-zinc-400'}`}>
                  {showNewsAvwap ? 'ON' : 'OFF'}
                </span>
              </button>
              {/* ATR (Average True Range) Sub-Pane Button */}
              <button
                type="button"
                onClick={() => setShowAtrSubPane((prev) => !prev)}
                className={`transition flex items-center gap-1.5 select-none px-1.5 py-0.5 rounded cursor-pointer ${
                  showAtrSubPane
                    ? 'bg-red-500/20 text-red-200 border border-red-400/60 shadow-sm font-semibold'
                    : 'bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800 border border-zinc-700/40'
                }`}
                title="Toggle ATR (Average True Range) pane — TradingView built-in, 14 RMA"
              >
                <span className="text-[11px]">〽️</span>
                <span className="text-gray-400 font-semibold">ATR:</span>
                <span className={`font-mono font-bold ${showAtrSubPane ? 'text-red-300' : 'text-zinc-400'}`}>
                  {showAtrSubPane ? 'ON' : 'OFF'}
                </span>
              </button>
              {isCritiqueSessionActiveState && (
                <>
                  <span className="text-gray-600 text-[10px]">|</span>
                  {/* Questioning / Price Critique Desk Button */}
                  <button
                    type="button"
                    onClick={() => setShowQuestioningModal((prev) => !prev)}
                    className={`transition flex items-center gap-1.5 select-none px-2 py-0.5 rounded cursor-pointer ${
                      showQuestioningModal
                        ? 'bg-amber-500/25 text-amber-200 border border-amber-400/60 shadow-sm font-semibold'
                        : 'bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800 border border-zinc-700/40'
                    }`}
                    title="Auction Price Critique & Questioning Desk (Hotkey: Q) — Question the price before doing business!"
                  >
                    <span className="text-[11px]">⚖️</span>
                    <span className="text-gray-400 font-semibold">Critique:</span>
                    <span
                      className={`font-mono font-bold ${
                        !livePriceCritique
                          ? 'text-gray-400'
                          : livePriceCritique.valuationState.includes('DISCOUNT')
                          ? 'text-emerald-400'
                          : livePriceCritique.valuationState.includes('PREMIUM')
                          ? 'text-rose-400'
                          : 'text-cyan-300'
                      }`}
                    >
                      {livePriceCritique ? livePriceCritique.valuationState.replace('_', ' ') : 'STANDBY'}
                    </span>
                    {livePriceCritique?.weakHandTrap.isTrapRisk && (
                      <span className="px-1 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[9px] font-bold border border-rose-500/40 animate-pulse">
                        TRAP RISK
                      </span>
                    )}
                  </button>
                </>
              )}
            </div>

            {/* OHLCV Hover Tooltip inline on the right */}
            <div className="ml-auto flex-shrink-0">
              <OHLCVTooltip data={tooltip} color={meta.color} />
            </div>
          </div>
        </div>
      )}

      <div
        ref={chartFrameRef}
        onClick={handleChartFrameClick}
        onMouseMove={handleChartFrameMouseMove}
        className="flex-1 min-h-0 relative rounded-xl border border-zinc-800 overflow-hidden bg-[#0e1117] flex flex-col"
      >
        {/* Floating Exit Fullscreen Button */}
        {isFullscreen && (
          <button
            type="button"
            onClick={toggleFullscreen}
            className="absolute top-3 right-3 z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/90 text-zinc-300 hover:text-white hover:bg-zinc-800 border border-zinc-700/80 shadow-xl backdrop-blur-md text-xs font-semibold transition-all select-none"
            title="Exit Fullscreen Mode (Hotkey: F or Esc)"
          >
            <span>⤢</span>
            <span>Exit Fullscreen</span>
            <span className="text-[10px] text-zinc-400 font-mono bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">Esc</span>
          </button>
        )}


        {/* Main Price Chart Section */}
        <div className="relative flex-1 w-full min-h-[300px]">
          <div ref={containerRef} className="absolute inset-0 z-0" />
          <div
            ref={sessionOverlayRef}
            className="pointer-events-none absolute inset-0 z-[1]"
            style={{ opacity: 1, transition: 'none', willChange: 'opacity' }}
          />
          <canvas
            ref={frvpHistogramCanvasRef}
            className="pointer-events-none absolute inset-0 z-[2]"
          />
          <canvas
            ref={excessesCanvasRef}
            className="pointer-events-none absolute inset-0 z-[3]"
          />
          <div
            ref={positionBandOverlayRef}
            className="pointer-events-none absolute inset-0 z-[4]"
          />
          <div
            ref={newsMarkersOverlayRef}
            className="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
          />
          <canvas
            ref={userDrawingsCanvasRef}
            className="pointer-events-none absolute inset-0 z-[6]"
          />

          {/* Selected Trendline Floating Action Banner */}
          {selectedTrendlineId && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 rounded-full bg-slate-950/95 border border-sky-500/70 px-4 py-1.5 text-xs shadow-2xl backdrop-blur-md animate-in fade-in select-none">
              <span className="inline-block h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
              <span className="font-semibold text-slate-200">
                {(() => {
                  const tl = trendlines.find((t) => t.id === selectedTrendlineId)
                  if (!tl) return 'Trendline Selected'
                  return `📐 Trendline Selected (${tl.p1.price.toFixed(1)} → ${tl.p2.price.toFixed(1)})`
                })()}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (selectedTrendlineId) {
                    const targetId = selectedTrendlineId
                    handleDeleteTrendline(targetId)
                    setSelectedTrendlineId(null)
                    setDrawingToast({
                      type: 'TRENDLINE',
                      id: targetId,
                      label: 'Trendline Removed',
                      summary: 'Drawing deleted from chart',
                    })
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-600/90 hover:bg-rose-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                title="Remove this Trendline (or press Delete/Backspace)"
              >
                <span>🗑️</span>
                <span>Remove Trendline</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedTrendlineId(null)}
                className="text-slate-400 hover:text-white text-xs font-bold px-1.5 py-0.5 rounded hover:bg-slate-800 transition cursor-pointer"
                title="Deselect (or press Esc)"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Synchronized CVD Sub-Chart Pane with TradingView Draggable Resizer */}
        <div
          className={`relative w-full border-t border-zinc-800 bg-[#0b0e14] flex flex-col flex-shrink-0 ${
            showCvdSubPane ? '' : 'hidden'
          }`}
          style={{ height: showCvdSubPane ? cvdSubPaneHeight : 0 }}
        >
          {/* Draggable Resizer Splitter Bar (TradingView Style) */}
          <div
            onMouseDown={handleCvdResizerMouseDown}
            className="absolute -top-1.5 left-0 right-0 h-3 z-30 cursor-ns-resize flex items-center justify-center group hover:bg-cyan-500/20 transition-colors select-none"
            title="Drag up or down to resize CVD sub-pane"
          >
            <div className="w-16 h-1 rounded-full bg-zinc-700/80 group-hover:bg-cyan-400 group-active:bg-cyan-300 shadow-sm transition-colors" />
          </div>

          {/* CVD Sub-Pane Header Legend */}
          <div className="absolute top-2 left-3 z-10 flex items-center gap-2.5 text-xs font-mono font-semibold bg-zinc-950/90 px-2.5 py-1 rounded border border-zinc-800/80 select-none shadow-md pointer-events-none">
            <span className="font-bold text-zinc-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              CVD
            </span>
            {currentCvdLegend ? (
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className={currentCvdLegend.close >= 0 ? 'text-cyan-400 font-bold' : 'text-rose-400 font-bold'}>
                  {(() => {
                    const val = currentCvdLegend.close
                    const sign = val >= 0 ? '+' : ''
                    const abs = Math.abs(val)
                    if (abs >= 1_000_000) return `${sign}${(val / 1_000_000).toFixed(2)}M`
                    if (abs >= 1_000) return `${sign}${(val / 1_000).toFixed(1)}K`
                    return `${sign}${val.toLocaleString()}`
                  })()}
                </span>
                <span className="text-zinc-600">|</span>
                <span className="text-zinc-400 text-[10.5px]">
                  Bar Δ: <strong className={currentCvdLegend.close >= currentCvdLegend.open ? 'text-cyan-400' : 'text-rose-400'}>
                    {(() => {
                      const delta = currentCvdLegend.close - currentCvdLegend.open
                      const sign = delta >= 0 ? '+' : ''
                      const abs = Math.abs(delta)
                      if (abs >= 1_000_000) return `${sign}${(delta / 1_000_000).toFixed(2)}M`
                      if (abs >= 1_000) return `${sign}${(delta / 1_000).toFixed(1)}K`
                      return `${sign}${delta.toLocaleString()}`
                    })()}
                  </strong>
                </span>
                <span className="text-zinc-600 hidden sm:inline">|</span>
                <span className="text-zinc-400 text-[10px] hidden md:inline">
                  O: <span className="text-zinc-200">{currentCvdLegend.open.toLocaleString()}</span> H: <span className="text-zinc-200">{currentCvdLegend.high.toLocaleString()}</span> L: <span className="text-zinc-200">{currentCvdLegend.low.toLocaleString()}</span> C: <span className="text-zinc-200">{currentCvdLegend.close.toLocaleString()}</span>
                </span>
              </div>
            ) : (
              <span className="text-zinc-500">—</span>
            )}
            <span className="ml-1 inline-flex items-center gap-1 text-[9.5px] font-mono text-cyan-400/90 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/40">
              🔒 1:1 Linked
            </span>
          </div>

          {/* CVD Lightweight Chart Container */}
          <div
            ref={cvdContainerRef}
            className="absolute inset-0 z-0"
            title="Scroll or drag anywhere to zoom and pan. Price and CVD stay 100% 1:1 synchronized."
          />
          <div
            ref={cvdSessionOverlayRef}
            className="pointer-events-none absolute inset-0 z-[1]"
            style={{ opacity: 1, transition: 'none', willChange: 'opacity' }}
          />
        </div>

        {/* ATR (Average True Range) Sub-Pane — TradingView built-in, 1:1 linked with price */}
        {showAtrSubPane && (
          <AtrSubPane
            mainChart={chartReady ? chartRef.current : null}
            mainSeries={chartReady ? candleRef.current : null}
            onClose={closeAtrSubPane}
          />
        )}

        {/* Synchronized TradingView Crosshair Guide & Column Beam across Main & CVD Panes */}
        {showCvdSubPane && syncCrosshair && (
          <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
            {/* Full-height Vertical Beam Highlight connecting price candle to CVD candle */}
            <div
              style={{
                left: `${syncCrosshair.x - Math.round(((chartRef.current?.timeScale() as any)?.options?.()?.barSpacing ?? 10) * 0.42)}px`,
                width: `${Math.max(4, Math.round(((chartRef.current?.timeScale() as any)?.options?.()?.barSpacing ?? 10) * 0.84))}px`,
              }}
              className="absolute top-0 bottom-0 bg-cyan-400/[0.12] transition-none pointer-events-none"
            />
            {/* Full-height Vertical Crosshair Hairline */}
            <div
              style={{ left: `${syncCrosshair.x}px` }}
              className="absolute top-0 bottom-0 w-[1px] border-l border-dashed border-cyan-400/80 transition-none pointer-events-none shadow-[0_0_8px_rgba(34,211,238,0.5)]"
            />
          </div>
        )}

        {/* ── Draggable Floating Drawing Tool Rail (horizontal) ── */}
        <div
          ref={railContainerRef}
          style={{ left: railPos.x, top: railPos.y }}
          className="absolute z-30 flex flex-row items-center rounded-xl border border-slate-700/80 bg-slate-900/90 shadow-2xl backdrop-blur-md select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag Handle — left side, hold to move */}
          <div
            className="flex h-full cursor-grab items-center justify-center rounded-l-xl px-1.5 active:cursor-grabbing hover:bg-slate-800/60 transition-colors"
            title="Hold to move toolbar"
            onMouseDown={(e) => {
              e.preventDefault()
              railDragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                origX: railPos.x,
                origY: railPos.y,
              }
              const onMove = (ev: MouseEvent) => {
                if (!railDragRef.current || !railContainerRef.current) return
                const frame = chartFrameRef.current
                const rail = railContainerRef.current
                const dx = ev.clientX - railDragRef.current.startX
                const dy = ev.clientY - railDragRef.current.startY
                const maxX = frame ? Math.max(0, frame.clientWidth - rail.offsetWidth - 4) : 9999
                const maxY = frame ? Math.max(0, frame.clientHeight - rail.offsetHeight - 4) : 9999
                setRailPos({
                  x: Math.min(maxX, Math.max(0, railDragRef.current.origX + dx)),
                  y: Math.min(maxY, Math.max(0, railDragRef.current.origY + dy)),
                })
              }
              const onUp = () => {
                railDragRef.current = null
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
              }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
          >
            {/* Dotted grip — 2 rows × 3 cols for horizontal bar */}
            <svg width="6" height="14" viewBox="0 0 6 14" fill="none" className="opacity-40">
              <circle cx="3" cy="2"  r="1.5" fill="currentColor" className="text-slate-300"/>
              <circle cx="3" cy="7"  r="1.5" fill="currentColor" className="text-slate-300"/>
              <circle cx="3" cy="12" r="1.5" fill="currentColor" className="text-slate-300"/>
            </svg>
          </div>

          {/* Tool buttons — horizontal row */}
          <div className="flex flex-row items-center gap-1 py-1 pr-1.5">
            {/* Trendline (W or X) */}
            <button
              type="button"
              onClick={() => {
                setActiveDrawingTool((prev) => (prev === 'TRENDLINE' ? 'NONE' : 'TRENDLINE'))
                setDrawingDraft(null)
              }}
              className={`flex h-9 px-2.5 items-center gap-1.5 rounded-lg text-xs font-bold transition-all ${
                activeDrawingTool === 'TRENDLINE'
                  ? 'bg-sky-500 text-slate-950 shadow-lg shadow-sky-500/40 ring-2 ring-sky-300'
                  : 'text-sky-300 hover:bg-slate-800 hover:text-sky-100 bg-slate-900/60 border border-sky-500/30'
              }`}
              title="Trendline (Hotkey: W or X)"
            >
              <span className="text-sm">📐</span>
              <span className="hidden md:inline font-mono">Trendline</span>
            </button>

            {/* Range Box (D) */}
            <button
              type="button"
              onClick={() => {
                setActiveDrawingTool((prev) => (prev === 'RANGE' ? 'NONE' : 'RANGE'))
                setDrawingDraft(null)
              }}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-base transition-all ${
                activeDrawingTool === 'RANGE'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-purple-300'
              }`}
              title="Draw Range / Box (Hotkey: D)"
            >
              <span>⬛</span>
            </button>

            {/* Manual FRVP (V) */}
            <button
              type="button"
              onClick={() => {
                setActiveDrawingTool((prev) => (prev === 'FRVP' ? 'NONE' : 'FRVP'))
                setDrawingDraft(null)
              }}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-base transition-all ${
                activeDrawingTool === 'FRVP'
                  ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-amber-300'
              }`}
              title="Draw Fixed Range Volume Profile (Hotkey: V)"
            >
              <span>📈</span>
            </button>

            {/* Measure Tool (M / Shift+Click) */}
            <button
              type="button"
              onClick={() => {
                setActiveDrawingTool((prev) => (prev === 'MEASURE' ? 'NONE' : 'MEASURE'))
                setDrawingDraft(null)
              }}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-base transition-all ${
                activeDrawingTool === 'MEASURE'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 ring-2 ring-emerald-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-emerald-300'
              }`}
              title="Measure Price / Range (Hotkey: M / Shift+Click)"
            >
              <span>📏</span>
            </button>

            {/* Candlestick Patterns Toggle */}
            <button
              type="button"
              onClick={() => setShowCandlestickPatterns((prev) => !prev)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-base transition-all ${
                showCandlestickPatterns
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-emerald-300'
              }`}
              title="Toggle Candlestick Pattern Markers"
            >
              <span>🕯️</span>
            </button>

            {/* CVD Sub-Chart Toggle */}
            <button
              type="button"
              onClick={() => setShowCvdSubPane((prev) => !prev)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-base transition-all ${
                showCvdSubPane
                  ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/30 font-bold'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-cyan-300'
              }`}
              title="Toggle CVD Sub-Chart Pane"
            >
              <span>📊</span>
            </button>

            {/* ATR Sub-Chart Toggle */}
            <button
              type="button"
              onClick={() => setShowAtrSubPane((prev) => !prev)}
              className={`flex h-9 px-2 items-center justify-center rounded-lg text-[11px] font-mono font-bold transition-all ${
                showAtrSubPane
                  ? 'bg-[#B71C1C] text-white shadow-lg shadow-red-700/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-red-300'
              }`}
              title="Toggle ATR (Average True Range) Pane"
            >
              ATR
            </button>


            {/* ── Vertical Separator ── */}
            <div className="w-px h-6 bg-slate-700/80 mx-0.5" />

            {/* Manage Drawings */}
            <button
              type="button"
              onClick={() => setDrawingsPanelOpen((prev) => !prev)}
              className={`group relative flex h-9 w-9 items-center justify-center rounded-lg text-base transition-all ${
                drawingsPanelOpen || activeTrendlines.length + activeRangeBoxes.length + activeManualFrvps.length + activeMeasures.length > 0
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-cyan-300'
              }`}
              title="Manage Drawings"
            >
              <span>🎨</span>
              {activeTrendlines.length + activeRangeBoxes.length + activeManualFrvps.length + activeMeasures.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-cyan-500 px-0.5 text-[9px] font-bold text-slate-950 shadow">
                  {activeTrendlines.length + activeRangeBoxes.length + activeManualFrvps.length + activeMeasures.length}
                </span>
              )}
              <span className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 hidden whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-xs font-semibold text-cyan-200 shadow-xl border border-slate-800 group-hover:block z-50">
                Manage Tools ({activeTrendlines.length + activeRangeBoxes.length + activeManualFrvps.length + activeMeasures.length})
              </span>
            </button>

            {/* Quick Clear — only when drawings exist */}
            {activeTrendlines.length + activeRangeBoxes.length + activeManualFrvps.length + activeMeasures.length > 0 && (
              <button
                type="button"
                onClick={handleClearAllDrawings}
                className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-base text-slate-400 hover:bg-rose-950/40 hover:text-rose-400 transition-all"
                title="Clear All Drawings"
              >
                <span>🗑️</span>
                <span className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 hidden whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-xs font-semibold text-rose-300 shadow-xl border border-rose-900/60 group-hover:block z-50">
                  Clear All
                </span>
              </button>
            )}

            {/* ── Future-tools expansion zone ── */}
            <div className="w-2 h-full" aria-hidden="true" />
          </div>
        </div>

        {/* In-progress drawing guide banner */}
        {activeDrawingTool !== 'NONE' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full bg-slate-950/90 border border-cyan-500/60 px-4 py-1.5 text-xs font-medium text-cyan-200 shadow-2xl backdrop-blur-sm animate-pulse">
            <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
            <span>
              {activeDrawingTool === 'TRENDLINE' && '📐 Drawing Trendline (Click 1: Spring/Upthrust anchor · Click 2: Projection)'}
              {activeDrawingTool === 'RANGE' && '⬛ Drawing Range Box (Click 2 corners)'}
              {activeDrawingTool === 'FRVP' && '📊 Drawing Custom FRVP (Click start & end bars)'}
              {activeDrawingTool === 'MEASURE' && '📏 Drawing Measure (Click 1st point, then 2nd point to pin · Hold Shift anytime)'}
            </span>
            <button
              type="button"
              onClick={() => {
                setActiveDrawingTool('NONE')
                setDrawingDraft(null)
              }}
              className="ml-2 text-slate-400 hover:text-white font-bold"
              title="Cancel drawing"
            >
              ✕
            </button>
          </div>
        )}

        {/* Drawings Manager Panel */}
        {drawingsPanelOpen && (
          <div className="absolute top-12 left-14 z-40 w-80 max-h-[420px] flex flex-col rounded-xl border border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-md text-slate-100 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-3 py-2 bg-slate-800/60">
              <div className="flex items-center gap-1.5 font-bold text-xs text-cyan-300">
                <span>🎨</span>
                <span>User Tools & Drawings ({instrument})</span>
                <span className="text-[11px] text-slate-400 font-normal">
                  ({activeTrendlines.length + activeRangeBoxes.length + activeManualFrvps.length + activeMeasures.length})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setHideTrendlineBadges((prev) => {
                      const next = !prev
                      try {
                        localStorage.setItem('hide_trendline_badges', String(next))
                      } catch {}
                      return next
                    })
                  }}
                  className={`text-[11px] font-semibold px-1.5 py-0.5 rounded transition ${
                    hideTrendlineBadges
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                      : 'bg-slate-700/60 text-slate-300 hover:text-white'
                  }`}
                  title={hideTrendlineBadges ? 'Show trendline text labels' : 'Hide trendline text labels'}
                >
                  {hideTrendlineBadges ? '🙈 Text Off' : '🏷️ Text On'}
                </button>
                {activeTrendlines.length + activeRangeBoxes.length + activeManualFrvps.length + activeMeasures.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllDrawings}
                    className="text-[11px] text-rose-400 hover:text-rose-300 font-semibold px-1 py-0.5 rounded hover:bg-rose-500/10 transition"
                    title="Delete all drawn tools for this instrument"
                  >
                    Clear All
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDrawingsPanelOpen(false)}
                  className="text-slate-400 hover:text-white text-xs font-bold px-1"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs divide-y divide-slate-800/60">
              {activeTrendlines.length === 0 && activeRangeBoxes.length === 0 && activeManualFrvps.length === 0 && activeMeasures.length === 0 && (
                <div className="py-6 text-center text-slate-500 space-y-1">
                  <div className="text-2xl">📐 🎯 ⬛ 📊 📏</div>
                  <div className="font-semibold text-slate-400">No active drawings on {instrument}</div>
                  <div className="text-[11px] text-slate-500">
                    Press <span className="text-sky-300 font-mono">W</span> or <span className="text-sky-300 font-mono">X</span> for Trendline,{' '}
                    <span className="text-purple-300 font-mono">D</span> for Range,{' '}
                    <span className="text-amber-300 font-mono">V</span> for FRVP, or{' '}
                    <span className="text-emerald-300 font-mono">M</span> (Shift+Click) for Measure.
                  </div>
                </div>
              )}

              {/* Trendlines */}
              {activeTrendlines.length > 0 && (
                <div className="pt-1.5 first:pt-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400 mb-1 px-1">
                    Trendlines ({activeTrendlines.length})
                  </div>
                  <div className="space-y-1">
                    {activeTrendlines.map((tl) => {
                      const isSpring = tl.label?.includes('Spring') || tl.p2.price >= tl.p1.price
                      return (
                        <div
                          key={tl.id}
                          className="group flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/40 transition"
                        >
                          <div className="min-w-0 flex-1">
                            <div
                              className={`flex items-center gap-1 font-semibold truncate ${
                                isSpring ? 'text-emerald-300' : 'text-rose-300'
                              }`}
                            >
                              <span>📐</span>
                              <span className="truncate">
                                {tl.label || (isSpring ? 'Trendline · Spring' : 'Trendline · Upthrust')}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {tl.p1.price.toLocaleString()} → {tl.p2.price.toLocaleString()} ({isSpring ? 'Spring Origin' : 'Upthrust Origin'})
                            </div>
                          </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleAskLeoAboutDrawing('TRENDLINE', tl.id)}
                            className="px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 font-medium text-[11px] border border-sky-500/30 transition"
                            title="Send to Leo AI"
                          >
                            Ask Leo
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTrendline(tl.id)}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                            title="Delete trendline"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  </div>
                </div>
              )}

              {/* Range Boxes */}
              {activeRangeBoxes.length > 0 && (
                <div className="pt-1.5 first:pt-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-1 px-1">
                    Range Boxes ({activeRangeBoxes.length})
                  </div>
                  <div className="space-y-1">
                    {activeRangeBoxes.map((rb) => {
                      const hi = Math.max(rb.p1.price, rb.p2.price)
                      const lo = Math.min(rb.p1.price, rb.p2.price)
                      const pts = Math.round(hi - lo)
                      return (
                        <div
                          key={rb.id}
                          className="group flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/40 transition"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1 font-semibold text-purple-300 truncate">
                              <span>⬛</span>
                              <span className="truncate">{rb.label || 'Range Box'}</span>
                              <span className="text-[10px] text-purple-400 font-mono">({pts} pts)</span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              High {hi.toLocaleString()} · Low {lo.toLocaleString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setTargetMemoryRange({
                                  id: rb.id,
                                  priceLow: lo,
                                  priceHigh: hi,
                                  purpose: rb.memoryPurpose || 'Keep eyes on this level when price visits to see if support or resistance',
                                })
                                setMemoryModalOpen(true)
                              }}
                              className={`px-2 py-0.5 rounded font-medium text-[11px] border transition ${
                                rb.isMemory
                                  ? 'bg-amber-500/30 text-amber-200 border-amber-500/50'
                                  : 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border-purple-500/30'
                              }`}
                              title={rb.isMemory ? 'Edit Leo Long-Term Memory' : 'Activate Leo Long-Term Memory'}
                            >
                              {rb.isMemory ? '🧠 Memory Active' : '🧠 Memory'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAskLeoAboutDrawing('RANGE', rb.id)}
                              className="px-2 py-0.5 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 font-medium text-[11px] border border-purple-500/30 transition"
                              title="Send to Leo AI"
                            >
                              Ask Leo
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRangeBox(rb.id)}
                              className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                              title="Delete range"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Manual FRVP */}
              {activeManualFrvps.length > 0 && (
                <div className="pt-1.5 first:pt-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-1 px-1">
                    Manual FRVPs ({activeManualFrvps.length})
                  </div>
                  <div className="space-y-1">
                    {activeManualFrvps.map((fp) => (
                      <div
                        key={fp.id}
                        className="group flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/40 transition"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 font-semibold text-amber-300 truncate">
                            <span>📊</span>
                            <span className="truncate">{fp.label || 'Manual FRVP'}</span>
                          </div>
                          <div className="text-[10px] text-amber-400/90 truncate font-mono">
                            POC {fp.poc.toLocaleString()} · VAH {fp.vah.toLocaleString()} · VAL {fp.val.toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleAskLeoAboutDrawing('FRVP', fp.id)}
                            className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-medium text-[11px] border border-amber-500/30 transition"
                            title="Send to Leo AI"
                          >
                            Ask Leo
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteManualFrvp(fp.id)}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                            title="Delete FRVP"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Measurements */}
              {activeMeasures.length > 0 && (
                <div className="pt-1.5 first:pt-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1 px-1">
                    Measurements ({activeMeasures.length})
                  </div>
                  <div className="space-y-1">
                    {activeMeasures.map((m) => {
                      const dP = m.p2.price - m.p1.price
                      const pct = m.p1.price !== 0 ? (dP / m.p1.price) * 100 : 0
                      const isUp = dP >= 0
                      return (
                        <div
                          key={m.id}
                          className="group flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/40 transition"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1 font-semibold text-emerald-300 truncate">
                              <span>📏</span>
                              <span className="truncate">
                                {isUp ? '+' : ''}{dP.toFixed(2)} pts ({isUp ? '+' : ''}{pct.toFixed(2)}%)
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {m.p1.price.toLocaleString()} → {m.p2.price.toLocaleString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleDeleteMeasure(m.id)}
                              className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                              title="Delete measurement"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-800/80 px-3 py-1.5 bg-slate-900/60 text-[10px] text-slate-400 flex items-center justify-between">
              <span>Hotkeys: W (Trend) · D (Range) · V (FRVP) · M (Measure)</span>
              <span>Esc cancels / clears</span>
            </div>
          </div>
        )}

        {/* Drawing Completed Notification Toast */}
        {drawingToast && (
          <div className="absolute bottom-10 left-4 z-40 max-w-sm rounded-xl border border-cyan-500/40 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md text-slate-100 flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="text-xl shrink-0 mt-0.5">
              {drawingToast.type === 'TRENDLINE' && '📐'}
              {drawingToast.type === 'RANGE' && '⬛'}
              {drawingToast.type === 'FRVP' && '📊'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-xs text-cyan-300 truncate">
                  {drawingToast.label} Placed
                </span>
                <button
                  type="button"
                  onClick={() => setDrawingToast(null)}
                  className="text-slate-400 hover:text-white text-xs font-bold px-1"
                >
                  ✕
                </button>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 line-clamp-2">
                {drawingToast.summary}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {drawingToast.type === 'RANGE' && (
                  <button
                    type="button"
                    onClick={() => {
                      const r = rangeBoxes.find((b) => b.id === drawingToast.id)
                      if (r) {
                        const highP = Math.max(r.p1.price, r.p2.price)
                        const lowP = Math.min(r.p1.price, r.p2.price)
                        setTargetMemoryRange({
                          id: r.id,
                          priceLow: lowP,
                          priceHigh: highP,
                          purpose: r.memoryPurpose || 'Keep eyes on this level when price visits to see if support or resistance',
                        })
                        setMemoryModalOpen(true)
                      }
                      setDrawingToast(null)
                    }}
                    className="px-2.5 py-1 rounded bg-purple-600/40 hover:bg-purple-600/60 text-purple-200 font-bold text-xs border border-purple-500/50 transition flex items-center gap-1.5 shadow-sm"
                  >
                    <span>🧠</span>
                    <span>Activate Long-Term Memory</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    handleAskLeoAboutDrawing(drawingToast.type, drawingToast.id)
                    setDrawingToast(null)
                  }}
                  className="px-2.5 py-1 rounded bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 font-semibold text-xs border border-cyan-500/40 transition flex items-center gap-1.5 shadow-sm"
                >
                  <span>🤖</span>
                  <span>Ask Leo</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDrawingsPanelOpen(true)}
                  className="px-2 py-1 rounded text-slate-400 hover:text-slate-200 text-xs transition"
                >
                  View Tools
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Leo Long-Term Memory Activation Modal */}
        {memoryModalOpen && targetMemoryRange && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="w-full max-w-md rounded-xl border border-purple-500/60 bg-[#161b22] p-5 shadow-2xl space-y-4 text-gray-200">
              <div className="flex items-center justify-between border-b border-[#30363d] pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🧠</span>
                  <div>
                    <h3 className="text-sm font-bold text-white">Activate Leo Long-Term Memory</h3>
                    <p className="text-[11px] text-gray-400">Save Higher Timeframe level to Leo's memory with TradingView alarms</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMemoryModalOpen(false)
                    setTargetMemoryRange(null)
                  }}
                  className="text-gray-400 hover:text-white text-xs font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-gray-400 text-[11px] font-semibold mb-1">
                    Level / Range Boundaries ({instrument})
                  </label>
                  <div className="flex items-center gap-2 font-mono">
                    <input
                      type="number"
                      value={targetMemoryRange.priceLow}
                      onChange={(e) =>
                        setTargetMemoryRange((prev) => prev ? { ...prev, priceLow: Number(e.target.value) } : null)
                      }
                      className="w-full rounded bg-[#0d1117] border border-[#30363d] px-2.5 py-1.5 text-white"
                      placeholder="Low"
                    />
                    <span className="text-gray-500">to</span>
                    <input
                      type="number"
                      value={targetMemoryRange.priceHigh}
                      onChange={(e) =>
                        setTargetMemoryRange((prev) => prev ? { ...prev, priceHigh: Number(e.target.value) } : null)
                      }
                      className="w-full rounded bg-[#0d1117] border border-[#30363d] px-2.5 py-1.5 text-white"
                      placeholder="High"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-gray-400 text-[11px] font-semibold mb-1">
                    Observation Purpose &amp; Note for Leo
                  </label>
                  <textarea
                    rows={3}
                    value={targetMemoryRange.purpose}
                    onChange={(e) =>
                      setTargetMemoryRange((prev) => prev ? { ...prev, purpose: e.target.value } : null)
                    }
                    className="w-full rounded bg-[#0d1117] border border-[#30363d] p-2 text-white placeholder-gray-500 text-xs resize-none"
                    placeholder="e.g. Keep eyes on this level when price visits to see if support or resistance"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">
                    Leo will memorize this macro level, monitor order flow &amp; volume on approach, and provide HTF commentary.
                  </p>
                </div>

                <div className="rounded-lg bg-[#0d1117] p-3 border border-[#30363d] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-300 font-semibold flex items-center gap-1.5">
                      <span>🔔</span>
                      <span>TradingView-Style Chime Alarm</span>
                    </span>
                    <span className="text-[10px] text-emerald-400 font-bold uppercase">Armed</span>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    Dual-tone audio chime will sound the instant price touches or enters this range.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#30363d]">
                <button
                  type="button"
                  onClick={() => {
                    setMemoryModalOpen(false)
                    setTargetMemoryRange(null)
                  }}
                  className="px-3 py-1.5 rounded border border-[#30363d] text-xs font-semibold text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!targetMemoryRange) return
                    const low = Math.min(targetMemoryRange.priceLow, targetMemoryRange.priceHigh)
                    const high = Math.max(targetMemoryRange.priceLow, targetMemoryRange.priceHigh)
                    const memory: LeoLongTermMemory = {
                      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      instrument,
                      timeframe,
                      priceLow: low,
                      priceHigh: high,
                      purpose: targetMemoryRange.purpose || 'Keep eyes on this level when price visits to see if support or resistance',
                      status: 'ACTIVE',
                      createdAt: new Date().toISOString(),
                      triggerCount: 0,
                      sourceDrawingId: targetMemoryRange.id,
                      alarmSoundEnabled: true,
                      isLongTerm: true,
                    }
                    saveLongTermMemory(memory)
                    // Tag range box
                    setRangeBoxes((prev) =>
                      prev.map((b) =>
                        b.id === targetMemoryRange.id
                          ? {
                              ...b,
                              isMemory: true,
                              memoryPurpose: memory.purpose,
                              color: '#f59e0b',
                            }
                          : b
                      )
                    )
                    playTradingViewChime()
                    setMemoryModalOpen(false)
                    setTargetMemoryRange(null)
                  }}
                  className="px-3.5 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white shadow-md flex items-center gap-1.5"
                >
                  <span>🧠</span>
                  <span>Save to Long-Term Memory</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TradingView-Style Live Alarm Toast */}
        {activeTradingViewAlarm && (
          <div className="absolute top-16 right-6 z-50 max-w-sm rounded-xl border border-amber-500/70 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-md text-slate-100 flex items-start gap-3 animate-in slide-in-from-top-4 duration-200">
            <span className="text-2xl animate-bounce">🔔</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  TradingView Alarm Triggered
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTradingViewAlarm(null)}
                  className="text-slate-400 hover:text-white text-xs font-bold px-1"
                >
                  ✕
                </button>
              </div>
              <div className="mt-1 font-mono text-sm font-bold text-white">
                {activeTradingViewAlarm.memory.instrument} visited @ ${activeTradingViewAlarm.price.toFixed(2)}
              </div>
              <p className="mt-1 text-xs text-gray-300 italic line-clamp-2">
                &ldquo;{activeTradingViewAlarm.memory.purpose}&rdquo;
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleAskLeoAboutMemory(activeTradingViewAlarm.memory, activeTradingViewAlarm.price)
                    setActiveTradingViewAlarm(null)
                  }}
                  className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold text-xs border border-amber-500/40 transition flex items-center gap-1.5"
                >
                  <span>🤖</span>
                  <span>Consult Leo on Level Visit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTradingViewAlarm(null)}
                  className="px-2 py-1 rounded text-slate-400 hover:text-slate-200 text-xs transition"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {activeNewsTooltip && (
          <div
            className="absolute z-40 w-72 rounded-xl border border-violet-500/40 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-md text-slate-100"
            style={{
              left: Math.max(12, Math.min((chartFrameRef.current?.clientWidth ?? 600) - 296, activeNewsTooltip.x - 140)),
              bottom: 34,
            }}
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-700/60 pb-2">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-violet-300">
                <span>⚡</span>
                <span className="truncate">{activeNewsTooltip.event.country} Release</span>
              </div>
              <button
                type="button"
                onClick={() => setActiveNewsTooltip(null)}
                className="text-slate-400 hover:text-white text-xs font-bold px-1"
              >
                ✕
              </button>
            </div>
            <div className="mt-2 space-y-1 text-xs">
              <div className="font-bold text-sm text-white">{activeNewsTooltip.event.event}</div>
              <div className="flex items-center gap-2 pt-1">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  activeNewsTooltip.event.impact?.toLowerCase().includes('high')
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                  {activeNewsTooltip.event.impact || 'MEDIUM'} IMPACT
                </span>
                <span className="text-[11px] text-slate-400">{activeNewsTooltip.event.time}</span>
              </div>
              {activeNewsTooltip.event.deskNote && (
                <p className="mt-1.5 text-[11px] text-slate-300 leading-relaxed border-t border-slate-800 pt-1.5">
                  {activeNewsTooltip.event.deskNote}
                </p>
              )}
              {(() => {
                const matchedMove = emotionalNewsMoves.find(
                  (m) =>
                    Math.abs(m.newsTime - (parseCalendarEventMs(activeNewsTooltip.event.time) ?? 0) / 1000) <= 600 ||
                    m.eventName.toLowerCase().includes(activeNewsTooltip.event.event.toLowerCase().slice(0, 8))
                )
                if (!matchedMove) return null
                return (
                  <div className="mt-2.5 rounded-lg border border-purple-500/30 bg-purple-950/40 p-2 text-[11px] space-y-1">
                    <div className="flex items-center justify-between font-bold text-purple-200">
                      <span>⚡ EMOTIONAL MOVE</span>
                      <span className="text-amber-300 font-mono">
                        {matchedMove.direction === 'WHIPSAW'
                          ? '± Whipsaw'
                          : matchedMove.direction === 'BULLISH_DRIVE'
                          ? '▲ Bullish Drive'
                          : '▼ Bearish Flush'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] font-mono pt-0.5">
                      <div><span className="text-rose-400 font-semibold">News H:</span> {matchedMove.newsHigh.toLocaleString()}</div>
                      <div><span className="text-emerald-400 font-semibold">News L:</span> {matchedMove.newsLow.toLocaleString()}</div>
                      <div><span className="text-violet-300">Base:</span> {matchedMove.basePrice.toLocaleString()}</div>
                      <div><span className="text-amber-300">Range:</span> {matchedMove.moveRange.toFixed(1)} pts</div>
                    </div>
                    <div className="text-[10px] text-purple-200/90 pt-0.5 border-t border-purple-800/40">
                      {matchedMove.description}
                    </div>
                    <div className="text-[9px] text-gray-400">
                      Reaction: <span className="font-semibold text-slate-200">{matchedMove.status.replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {showAuction && auctionHud && isAuctionInstrument(instrument) && (
          <AuctionHudPanel hud={auctionHud} />
        )}
        {showDow15mFail && dow15mFailHud && isDowVolumeBarInstrument(instrument) && (
          <Dow15mFailHudPanel hud={dow15mFailHud} />
        )}

        {/* Render Saved 2D Time Highlights */}
        {!SYSTEMATIC_LIVE_DESK && renderSavedHighlightBoxes()}

        {/* Saved Highlights List glassmorphism popup panel */}
        {!SYSTEMATIC_LIVE_DESK && highlightsListOpen && (
          <div className="absolute top-3 right-3 z-30 w-80 rounded-xl border border-violet-500/50 bg-[#161b22]/95 shadow-2xl backdrop-blur-md p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-violet-500/20 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
                <svg viewBox="0 0 16 16" className="h-4 w-4 text-violet-400" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <line x1="4" y1="4" x2="12" y2="4" strokeLinecap="round" />
                  <line x1="4" y1="8" x2="12" y2="8" strokeLinecap="round" />
                  <line x1="4" y1="12" x2="12" y2="12" strokeLinecap="round" />
                </svg>
                Saved Highlights ({savedHighlights.length})
              </span>
              <button
                onClick={() => setHighlightsListOpen(false)}
                className="text-gray-400 hover:text-white transition text-xs font-bold"
              >✕</button>
            </div>

            {savedHighlights.length === 0 ? (
              <p className="text-xs text-gray-550 text-center py-6">
                No highlights saved yet. Drag on chart using "Highlight Time" to create.
              </p>
            ) : (
              <div className="max-h-60 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                {savedHighlights.map((hl, idx) => {
                  const theme = getHighlightTheme(idx, false)
                  return (
                    <div
                      key={hl.id}
                      className={`flex flex-col gap-1.5 rounded-lg border bg-black/30 p-2.5 transition ${theme.pillBorder}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold ${theme.text}`}>{hl.label}</span>
                        <div className="flex items-center gap-1.5">
                          {/* Toggle Visibility */}
                          <button
                            onClick={() => {
                              setSavedHighlights((prev) =>
                                prev.map((item) =>
                                  item.id === hl.id ? { ...item, visible: !item.visible } : item
                                )
                              )
                            }}
                            className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition border ${hl.visible
                              ? `${theme.pillBg} ${theme.pillBorder} ${theme.text}`
                              : 'bg-transparent border-gray-605 text-gray-505 hover:border-gray-500'
                              }`}
                            title="Toggle visibility on chart"
                          >
                            {hl.visible ? 'Hide' : 'Show'}
                          </button>
                          {/* Center chart on range */}
                          <button
                            onClick={() => centerChartOnHighlight(hl)}
                            className="px-1.5 py-0.5 text-[10px] font-bold rounded border border-[#30363d] bg-black/40 text-gray-300 hover:bg-black/60 hover:text-white transition"
                            title="Center chart on highlight range"
                          >
                            Center
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => {
                              setSavedHighlights((prev) => prev.filter((item) => item.id !== hl.id))
                            }}
                            className="text-gray-505 hover:text-red-400 transition font-bold text-[10px] px-1"
                            title="Delete highlight"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 leading-normal">{hl.sessionSpanStr}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {positionOverlay && !SYSTEMATIC_LIVE_DESK && (() => {
          const dir = (positionOverlay.direction || 'long').toUpperCase()
          const isLong = dir === 'LONG'
          const curPx = livePrice ?? positionOverlay.entryPrice
          const entryPx = positionOverlay.entryPrice
          const stopPx = positionOverlay.stopLoss
          const tpPx = positionOverlay.profitTarget
          const pnlPts = isLong ? curPx - entryPx : entryPx - curPx
          const isProfit = pnlPts > 0
          const isFlat = Math.abs(pnlPts) < 0.25

          const pointVal =
            instrument === 'NASDAQ' ? 2 : instrument === 'DOW' ? 0.5 : instrument === 'GOLD' ? 10 : instrument === 'CRUDE' ? 100 : instrument === 'NIKKEI' ? 5 : 5
          const sz = positionOverlay.positionSize ?? 1
          const pnlUsd = pnlPts * sz * pointVal

          const distTp = isLong ? tpPx - curPx : curPx - tpPx
          const distSl = isLong ? curPx - stopPx : stopPx - curPx
          const totalTpSpan = Math.abs(tpPx - entryPx)
          const tpProgress = totalTpSpan > 0 ? Math.max(0, Math.min(100, Math.round((pnlPts / totalTpSpan) * 100))) : 0

          const riskSpan = Math.abs(entryPx - stopPx)
          const currentR = riskSpan > 0 ? (pnlPts / riskSpan).toFixed(2) : '0.00'

          if (positionHudMinimized) {
            return (
              <div className="absolute left-3 top-3 z-30 flex items-center gap-2 pointer-events-auto">
                <button
                  type="button"
                  onClick={() => setPositionHudMinimized(false)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border shadow-2xl backdrop-blur-md transition-all hover:scale-105 active:scale-95 ${
                    isProfit
                      ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-200'
                      : isFlat
                      ? 'bg-neutral-900/90 border-neutral-700/60 text-neutral-200'
                      : 'bg-rose-950/90 border-rose-500/60 text-rose-200'
                  }`}
                  title="Click to expand position details"
                >
                  <span className="w-2 h-2 rounded-full animate-ping bg-emerald-400" />
                  <span className="font-mono text-xs font-bold">{dir} {instrument}</span>
                  <span className="font-mono text-xs font-extrabold">
                    {pnlPts >= 0 ? `+${pnlPts.toFixed(1)}` : pnlPts.toFixed(1)} pts
                  </span>
                  <span className="text-[10px] font-mono opacity-80">
                    ({pnlUsd >= 0 ? `+$${pnlUsd.toFixed(2)}` : `-$${Math.abs(pnlUsd).toFixed(2)}`})
                  </span>
                  <span className="text-neutral-400 hover:text-white text-[10px] ml-1">↗</span>
                </button>
              </div>
            )
          }

          return (
            <div className="absolute left-3 top-3 z-30 pointer-events-auto w-80 max-w-[calc(100%-1.5rem)] rounded-2xl border border-neutral-800/90 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur-md space-y-2.5 transition-all">
              {/* Card Header */}
              <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-extrabold font-mono tracking-wider ${
                      isLong ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                    }`}
                  >
                    {dir} {sz} {instrument}
                  </span>
                  <span className="flex items-center gap-1 text-[9px] font-mono text-neutral-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    LIVE
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {aiVerdict && (
                    <span
                      className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                        aiVerdict.verdict.toLowerCase() === 'reversal'
                          ? 'bg-violet-950 text-violet-300 border-violet-700'
                          : aiVerdict.verdict.toLowerCase() === 'pullback'
                          ? 'bg-amber-950 text-amber-300 border-amber-700'
                          : 'bg-emerald-950 text-emerald-300 border-emerald-700'
                      }`}
                    >
                      AI: {aiVerdict.verdict.toUpperCase()} ({aiVerdict.confidence}%)
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPositionHudMinimized(true)}
                    className="p-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 text-xs transition"
                    title="Minimize HUD"
                  >
                    _
                  </button>
                </div>
              </div>

              {/* Live P&L Hero Section */}
              <div className="flex items-baseline justify-between bg-neutral-900/80 rounded-xl p-2.5 border border-neutral-800/80">
                <div>
                  <div className="text-[9px] font-mono text-neutral-400 uppercase tracking-wider">Unrealized P&L</div>
                  <div
                    className={`text-2xl font-black font-mono tracking-tight ${
                      isProfit ? 'text-emerald-400' : isFlat ? 'text-neutral-300' : 'text-rose-400'
                    }`}
                  >
                    {pnlPts >= 0 ? `+${pnlPts.toFixed(1)}` : pnlPts.toFixed(1)} <span className="text-xs font-normal">pts</span>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div
                    className={`text-base font-bold ${
                      isProfit ? 'text-emerald-400' : isFlat ? 'text-neutral-300' : 'text-rose-400'
                    }`}
                  >
                    {pnlUsd >= 0 ? `+$${pnlUsd.toFixed(2)}` : `-$${Math.abs(pnlUsd).toFixed(2)}`}
                  </div>
                  <div className="text-[9px] text-neutral-400">
                    {currentR}R multiple
                  </div>
                </div>
              </div>

              {/* Price Ladder (Entry, Live, Target, Stop) */}
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                <div className="p-1.5 rounded-lg bg-neutral-900/60 border border-neutral-800/60">
                  <span className="text-neutral-500 text-[8.5px] block">ENTRY</span>
                  <span className="text-blue-400 font-bold">{entryPx.toLocaleString()}</span>
                </div>
                <div className="p-1.5 rounded-lg bg-neutral-900/60 border border-neutral-800/60">
                  <span className="text-neutral-500 text-[8.5px] block">LIVE PRICE</span>
                  <span className="text-white font-bold">{curPx.toLocaleString()}</span>
                </div>
                <div className="p-1.5 rounded-lg bg-neutral-900/60 border border-emerald-950/60">
                  <span className="text-emerald-500 text-[8.5px] block">TARGET (TP)</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-emerald-400 font-bold">{tpPx.toLocaleString()}</span>
                    <span className="text-[8.5px] text-neutral-400">{distTp >= 0 ? `+${distTp.toFixed(1)}` : `${distTp.toFixed(1)}`}</span>
                  </div>
                </div>
                <div className="p-1.5 rounded-lg bg-neutral-900/60 border border-rose-950/60">
                  <span className="text-rose-500 text-[8.5px] block">PROTECTIVE STOP</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-rose-400 font-bold">{stopPx.toLocaleString()}</span>
                    <span className="text-[8.5px] text-neutral-400">{distSl >= 0 ? `-${distSl.toFixed(1)}` : `+${Math.abs(distSl).toFixed(1)}`}</span>
                  </div>
                </div>
              </div>

              {/* Progress to TP Bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[8.5px] font-mono text-neutral-400">
                  <span>Target Progress</span>
                  <span className="text-emerald-400 font-bold">{tpProgress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-300"
                    style={{ width: `${tpProgress}%` }}
                  />
                </div>
              </div>

              {/* Action Buttons (1-Click Flatten & Breakeven) */}
              <div className="flex items-center gap-1.5 pt-1 border-t border-neutral-800/70 font-mono text-[9.5px]">
                <button
                  type="button"
                  onClick={() => {
                    if (onClosePosition) {
                      void onClosePosition('Trader closed position via chart HUD')
                    }
                  }}
                  className="flex-1 py-1.5 px-2 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-700/70 hover:border-rose-500 text-rose-200 font-bold transition active:scale-95 text-center flex items-center justify-center gap-1"
                  title="Manual position exit (AI never auto-exits; you control execution)"
                >
                  <span>✕</span>
                  <span>Flatten Trade</span>
                </button>
                {onAdjustBrackets && (
                  <button
                    type="button"
                    onClick={() => {
                      void onAdjustBrackets({ stopLoss: entryPx })
                    }}
                    disabled={stopPx === entryPx}
                    className="py-1.5 px-2.5 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 hover:text-white transition active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                    title="Move stop loss to entry price (Risk-free trade)"
                  >
                    🛡️ Breakeven
                  </button>
                )}
              </div>
            </div>
          )
        })()}

        <button
          type="button"
          onClick={resetPriceScale}
          className="absolute bottom-2.5 right-14 z-20 rounded-md border border-surface-500/80 bg-surface-800/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300 shadow-lg backdrop-blur transition hover:border-brand-500/50 hover:text-white select-none"
          title="Reset price scale (and fit time) — same as TradingView double-click on price axis"
        >
          Reset scale
        </button>

        {/* Live Voice coach — floating panel (self-contained card; toggle via Voice button) */}
        {!SYSTEMATIC_LIVE_DESK && voiceOpen && (
          <div className="absolute bottom-20 left-3 z-30 max-w-[min(340px,calc(100vw-1.5rem))]">
            <LiveVoicePanel
              instrument={(lockedInstrument ?? instrument) as Instrument}
              clockedIn={clockedIn}
              livePrice={livePrice}
              refreshKey={levelsRefreshKey}
              onClose={() => setVoiceOpen(false)}
            />
          </div>
        )}

        {/* Drawn Zone confirmation popup — appears after drawing two points */}
        {!SYSTEMATIC_LIVE_DESK && drawnZone && (
          <div className="absolute bottom-20 right-3 z-40 w-64 rounded-xl border border-violet-500/40 bg-[#161b22]/95 shadow-2xl backdrop-blur-md p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="4" width="12" height="8" rx="1" strokeLinecap="round" />
                  <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2 2" />
                </svg>
                Drawn Zone
              </span>
              <button
                onClick={cancelDrawnZone}
                className="text-gray-500 hover:text-white transition text-xs"
                title="Discard zone"
              >✕</button>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-[#30363d] bg-black/40 px-3 py-2">
              <div className="space-y-0.5">
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Range</span>
                <p className="font-mono text-sm font-bold text-white">
                  {drawnZone.priceLow.toLocaleString()} – {drawnZone.priceHigh.toLocaleString()}
                </p>
              </div>
              <span className="text-[10px] font-mono text-gray-500">
                {Math.round(drawnZone.priceHigh - drawnZone.priceLow)} pts
              </span>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setDrawnZoneSide('BUY')}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold uppercase tracking-wide transition border ${drawnZoneSide === 'BUY'
                  ? 'bg-emerald-600/40 border-emerald-500/60 text-emerald-200 shadow-sm'
                  : 'bg-transparent border-[#30363d] text-gray-500 hover:text-emerald-300 hover:border-emerald-500/40'
                  }`}
              >
                BUY Zone
              </button>
              <button
                onClick={() => setDrawnZoneSide('SHORT')}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold uppercase tracking-wide transition border ${drawnZoneSide === 'SHORT'
                  ? 'bg-red-600/40 border-red-500/60 text-red-200 shadow-sm'
                  : 'bg-transparent border-[#30363d] text-gray-500 hover:text-red-300 hover:border-red-500/40'
                  }`}
              >
                SHORT Zone
              </button>
            </div>
            <button
              onClick={sendDrawnZoneToLeo}
              disabled={drawnZoneSending}
              className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 text-white py-2 text-xs font-bold uppercase tracking-wider transition shadow-md disabled:opacity-50"
            >
              {drawnZoneSending ? 'Sending…' : 'Send to Leo'}
            </button>
          </div>
        )}

        {/* Drawn Time confirmation popup */}
        {!SYSTEMATIC_LIVE_DESK && drawnTime && (
          <div className="absolute bottom-20 right-72 z-40 w-72 rounded-xl border border-violet-500/50 bg-[#161b22]/95 shadow-2xl backdrop-blur-md p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="2" width="12" height="12" rx="1" strokeLinecap="round" />
                  <line x1="8" y1="2" x2="8" y2="14" strokeDasharray="2 2" />
                </svg>
                {drawnTime.label || 'Highlight 1'}
              </span>
              <button
                onClick={cancelDrawnTime}
                className="text-gray-400 hover:text-white transition text-xs font-bold"
                title="Discard time highlight"
              >✕</button>
            </div>
            <div className="rounded-lg border border-[#30363d] bg-black/40 p-2.5 space-y-1">
              <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide block">
                Session Breakdown
              </span>
              <p className="text-xs font-semibold text-violet-200 leading-snug">
                {describeTimeHighlightSpan(
                  drawnTime.label || 'Highlight 1',
                  drawnTime.startUnix,
                  drawnTime.endUnix,
                  drawnTime.priceStart,
                  drawnTime.priceEnd,
                  (lockedInstrument ?? instrument) as Instrument
                )}
              </p>
            </div>
            <button
              onClick={sendDrawnTimeToLeo}
              disabled={drawnTimeSending}
              className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 text-white py-2 text-xs font-bold uppercase tracking-wider transition shadow-md disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {drawnTimeSending ? 'Sending to Leo…' : 'Send to Leo'}
            </button>
          </div>
        )}

        {/* TradingView Order Line Overlay Badges (Attached Directly to Price Lines on Chart) */}
        {riskBox && (() => {
          const place = resolveTradeifyPlace({
            fillsUsed: attemptsUsed,
            stopOutsToday: stopHits,
          })
          const dollars = riskBoxDollarPreview({
            entry: riskBox.entryPrice,
            stop: riskBox.stopLoss,
            target: riskBox.profitTarget,
            riskDollars: place.riskDollars,
          })
          const lossVal = dollars.size > 0 ? dollars.lossDollars.toFixed(0) : '—'
          const profitVal = dollars.size > 0 ? dollars.profitDollars.toFixed(0) : '—'
          const fillN = Math.min(attemptsUsed + 1, 3)

          return (
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              {/* Dashed Vertical Blue Connecting Line */}
              <div
                data-ov-span={`${riskBox.entryPrice},${riskBox.profitTarget},${riskBox.stopLoss}`}
                className="absolute border-r-2 border-dashed border-blue-500/80 pointer-events-none"
                style={{
                  left: 'calc(50% + 140px)',
                  top: 0,
                  transform: OVERLAY_HIDDEN_TRANSFORM,
                }}
              />

              {/* Take Profit (TP) Line Pill Badge — Drag to adjust TP */}
              <div
                data-ov-price={riskBox.profitTarget}
                data-ov-dy={-13}
                onMouseDown={onRiskLineMouseDown('TP')}
                className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group"
                style={{
                  left: '42%',
                  top: 0,
                  transform: OVERLAY_HIDDEN_TRANSFORM,
                }}
                title="Drag Take Profit line up or down"
              >
                <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md group-hover:border-emerald-300 transition">
                  <span className="text-emerald-400">
                    +{profitVal} · {riskBox.profitTarget.toLocaleString()}
                  </span>
                  <span className="text-emerald-600 mx-1.5">|</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); cancelRiskBox() }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="text-gray-400 hover:text-emerald-200 transition font-bold"
                    title="Remove TP"
                  >✕</button>
                </div>
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
              </div>

              {/* Entry Line Pill Badge — drag between open ±10 band centers; TP/SL free */}
              <div
                data-ov-price={riskBox.entryPrice}
                data-ov-dy={-14}
                onMouseDown={onRiskLineMouseDown('ENTRY')}
                className="absolute flex items-center gap-2 pointer-events-auto cursor-ns-resize group"
                style={{
                  left: '32%',
                  top: 0,
                  transform: OVERLAY_HIDDEN_TRANSFORM,
                }}
                title="Drag Entry between painted ±10 band centers (H / L)"
              >
                {/* Explicit Buy / Sell Placement Button — ONLY BUTTON THAT PLACES ORDER */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    confirmRiskBoxOrder()
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`px-3 py-1 text-xs font-extrabold uppercase rounded-md shadow-md transition border ${riskBox.direction === 'LONG'
                    ? 'bg-blue-600 border-blue-400 text-white hover:bg-blue-500 hover:scale-105'
                    : 'bg-red-600 border-red-400 text-white hover:bg-red-500 hover:scale-105'
                    }`}
                  title={`Click to place ${riskBox.direction} Limit Order`}
                >
                  {riskBox.direction === 'LONG' ? 'BUY LIMIT' : 'SELL LIMIT'}
                </button>

                {/* Direction Switch Icon Toggle Button — Switch between LONG and SHORT */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleRiskBoxDirection()
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-7 h-7 flex items-center justify-center text-xs font-mono font-extrabold rounded-md shadow-md bg-[#161b22]/95 border border-gray-600 text-gray-200 hover:text-white hover:border-amber-400 hover:bg-surface-700 transition"
                  title={`Click to switch to ${riskBox.direction === 'LONG' ? 'SHORT / SELL' : 'LONG / BUY'} mode`}
                >
                  ⇄
                </button>

                {/* Pill Badge with Non-Clickable Order Type Label */}
                <div className="flex items-center rounded-md border border-blue-400 bg-white/95 px-3 py-1 text-xs font-mono font-bold text-gray-900 shadow-xl transition">
                  <span className="font-sans uppercase font-extrabold tracking-wider text-[11px] select-none">
                    Limit
                  </span>
                  <span className="text-gray-400 mx-1.5">|</span>
                  <span className="text-[9px] font-sans uppercase tracking-wide text-sky-700">
                    locked
                  </span>
                  <span className="text-gray-400 mx-1.5">|</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); cancelRiskBox() }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="text-gray-400 hover:text-red-500 transition font-bold"
                    title="Close (Esc)"
                  >
                    ✕
                  </button>
                </div>

                <div className="w-3 h-3 rounded-full border-2 border-white shadow-md bg-blue-500" />
              </div>

              {/* Stop Loss (SL) Line Pill Badge — Drag to adjust SL (progressive session risk) */}
              <div
                data-ov-price={riskBox.stopLoss}
                data-ov-dy={-13}
                onMouseDown={onRiskLineMouseDown('SL')}
                className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group"
                style={{
                  left: '42%',
                  top: 0,
                  transform: OVERLAY_HIDDEN_TRANSFORM,
                }}
                title={`Drag Stop Loss @ ${riskBox.stopLoss.toLocaleString()} — $${lossVal} risk (fill ${fillN}/3)`}
              >
                <div className="flex items-center rounded border border-dashed border-amber-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-amber-300 shadow-md group-hover:border-amber-300 transition">
                  <span className="text-amber-400">
                    −{lossVal} · {riskBox.stopLoss.toLocaleString()} · {fillN}/3
                  </span>
                  <span className="text-amber-600 mx-1.5">|</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); cancelRiskBox() }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="text-gray-400 hover:text-amber-200 transition font-bold"
                    title="Remove SL"
                  >✕</button>
                </div>
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
              </div>
            </div>
          )
        })()}

        {/* Draggable price alert line + pill badge */}
        {priceAlert && !riskBox && (() => {
          const armed = priceAlert.armed !== false
          const pending = armed && priceAlert.pendingAway === true

          return (
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              <div
                data-ov-price={priceAlert.price}
                data-ov-dy={-14}
                onMouseDown={armed ? onPriceAlertLineMouseDown : undefined}
                className={`absolute flex items-center gap-2 pointer-events-auto group ${armed ? 'cursor-ns-resize' : 'cursor-default'
                  }`}
                style={{
                  left: '38%',
                  top: 0,
                  transform: OVERLAY_HIDDEN_TRANSFORM,
                }}
                title={
                  !armed
                    ? 'Alert fired — dismiss with ✕ or press A / Esc'
                    : pending
                      ? 'Waiting for price to leave, then re-touch fires Desk Alert'
                      : 'Drag alert line — Desk Alert when price touches (soft signal, not an order)'
                }
              >
                <div
                  className={`flex items-center rounded-md border px-3 py-1 text-xs font-mono font-bold shadow-xl transition ${!armed
                    ? 'border-violet-500/40 bg-violet-950/50 text-violet-300/70'
                    : pending
                      ? 'border-violet-400/70 bg-violet-950/80 text-violet-200/90'
                      : 'border-violet-400 bg-violet-950/95 text-violet-100 group-hover:border-violet-300'
                    }`}
                >
                  <span className="font-sans uppercase font-extrabold tracking-wider text-[11px] select-none">
                    {!armed ? 'Fired' : pending ? 'Arming' : 'Alert'}
                  </span>
                  <span className="text-violet-400 mx-1.5">@</span>
                  <span>{priceAlert.price.toLocaleString()}</span>
                  <span className="text-violet-500/60 mx-1.5">|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      dismissPriceAlert()
                    }}
                    className="text-violet-400/80 hover:text-violet-200 transition font-bold"
                    title="Dismiss alert"
                  >
                    ✕
                  </button>
                </div>
                <div
                  className={`w-3 h-3 rounded-full border-2 border-white shadow-md transition-transform ${!armed
                    ? 'bg-violet-500/40'
                    : pending
                      ? 'bg-violet-400/70'
                      : 'bg-violet-500 group-hover:scale-125'
                    }`}
                />
              </div>
            </div>
          )
        })()}

        {/* ── TradingView On-Chart Order & Bracket Badges (Position / Armed / Pending) ── */}
        {(editableOverlay || positionOverlay) && !riskBox && (() => {
          const ov = editableOverlay ?? positionOverlay!
          const isLong = (ov.direction || 'long').toLowerCase() === 'long'
          const curPx = livePrice ?? ov.entryPrice
          const entryPx = ov.entryPrice
          const stopPx = ov.stopLoss
          const tpPx = ov.profitTarget
          const pnlPts = isLong ? curPx - entryPx : entryPx - curPx
          const pointVal =
            instrument === 'NASDAQ' ? 2 : instrument === 'DOW' ? 0.5 : instrument === 'GOLD' ? 10 : instrument === 'CRUDE' ? 100 : instrument === 'NIKKEI' ? 5 : 5
          const sz = ov.positionSize ?? 1
          const pnlUsd = pnlPts * sz * pointVal

          const distTpPts = isLong ? tpPx - curPx : curPx - tpPx
          const distTpUsd = distTpPts * sz * pointVal
          const distSlPts = isLong ? curPx - stopPx : stopPx - curPx
          const distSlUsd = distSlPts * sz * pointVal
          const saving = bracketAdjustStatus === 'saving'

          return (
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              {/* Take Profit Line Pill */}
              <div
                data-ov-price={tpPx}
                data-ov-dy={-14}
                onMouseDown={onAdjustBrackets && !saving ? onBracketLineMouseDown('TP') : undefined}
                className={`absolute flex items-center pointer-events-auto select-none z-30 group ${
                  onAdjustBrackets && !saving ? 'cursor-ns-resize' : 'cursor-default'
                }`}
                style={{ left: '38%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                title={onAdjustBrackets ? `Drag Take Profit @ ${tpPx.toLocaleString()} — saves on release` : `Take Profit @ ${tpPx.toLocaleString()}`}
              >
                <div className="flex items-center rounded-md border border-[#363a45] bg-[#1e222d]/95 shadow-xl text-[11px] font-mono overflow-hidden backdrop-blur-sm transition-all group-hover:border-emerald-500/70">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 text-neutral-200">
                    <span className="font-semibold text-neutral-300">
                      {isLong ? 'Limit Sell' : 'Limit Buy'}
                    </span>
                    <span className="text-emerald-400 font-bold">
                      {distTpPts >= 0 ? `+${distTpPts.toFixed(1)} pts` : `${distTpPts.toFixed(1)} pts`} ({distTpUsd >= 0 ? `+$${distTpUsd.toFixed(2)}` : `-$${Math.abs(distTpUsd).toFixed(2)}`})
                    </span>
                  </div>
                  <div className={`px-2 py-1 font-bold text-xs text-white ${isLong ? 'bg-[#f23645]' : 'bg-[#089981]'}`}>
                    {isLong ? `-${sz}` : `+${sz}`}
                  </div>
                  {onClosePosition && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onClosePosition('Trader closed position via TP badge')
                      }}
                      className="px-2 py-1 text-neutral-400 hover:text-white hover:bg-[#2a2e39] transition border-l border-[#363a45] cursor-pointer"
                      title="Close Position"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {onAdjustBrackets && (
                  <div className="w-2.5 h-2.5 ml-1.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
                )}
              </div>

              {/* Position Entry Line Pill */}
              <div
                data-ov-price={entryPx}
                data-ov-dy={-14}
                className="absolute flex items-center pointer-events-auto select-none z-30 group cursor-default"
                style={{ left: '38%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                title={`Position Entry @ ${entryPx.toLocaleString()}`}
              >
                <div className="flex items-center rounded-md border border-[#363a45] bg-[#1e222d]/95 shadow-xl text-[11px] font-mono overflow-hidden backdrop-blur-sm transition-all group-hover:border-blue-500/70">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 text-neutral-200">
                    <span className="font-semibold text-neutral-300">
                      {isLong ? 'Market Buy' : 'Market Sell'}
                    </span>
                    <span className={`font-bold ${pnlPts >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {pnlUsd >= 0 ? `+$${pnlUsd.toFixed(2)}` : `-$${Math.abs(pnlUsd).toFixed(2)}`} ({pnlPts >= 0 ? `+${pnlPts.toFixed(1)}` : pnlPts.toFixed(1)} pts)
                    </span>
                  </div>
                  <div className={`px-2 py-1 font-bold text-xs text-white ${isLong ? 'bg-[#089981]' : 'bg-[#f23645]'}`}>
                    {isLong ? `+${sz}` : `-${sz}`}
                  </div>
                  {onClosePosition && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onClosePosition('Trader flattened position via on-chart badge')
                      }}
                      className="px-2 py-1 bg-rose-950/70 hover:bg-rose-600 text-rose-300 hover:text-white font-bold transition border-l border-[#363a45] cursor-pointer"
                      title="Flatten / Close Position at Market"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Stop Loss Line Pill */}
              <div
                data-ov-price={stopPx}
                data-ov-dy={-14}
                onMouseDown={onAdjustBrackets && !saving ? onBracketLineMouseDown('SL') : undefined}
                className={`absolute flex items-center pointer-events-auto select-none z-30 group ${
                  onAdjustBrackets && !saving ? 'cursor-ns-resize' : 'cursor-default'
                }`}
                style={{ left: '38%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                title={onAdjustBrackets ? `Drag Stop Loss @ ${stopPx.toLocaleString()} — saves on release` : `Stop Loss @ ${stopPx.toLocaleString()}`}
              >
                <div className="flex items-center rounded-md border border-[#363a45] bg-[#1e222d]/95 shadow-xl text-[11px] font-mono overflow-hidden backdrop-blur-sm transition-all group-hover:border-red-500/70">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 text-neutral-200">
                    <span className="font-semibold text-neutral-300">
                      {isLong ? 'Stop Market Sell' : 'Stop Market Buy'}
                    </span>
                    <span className="text-rose-400 font-bold">
                      -{distSlPts.toFixed(1)} pts (-${distSlUsd.toFixed(2)})
                    </span>
                  </div>
                  <div className={`px-2 py-1 font-bold text-xs text-white ${isLong ? 'bg-[#f23645]' : 'bg-[#089981]'}`}>
                    {isLong ? `-${sz}` : `+${sz}`}
                  </div>
                  {onClosePosition && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onClosePosition('Trader closed position via SL badge')
                      }}
                      className="px-2 py-1 text-neutral-400 hover:text-white hover:bg-[#2a2e39] transition border-l border-[#363a45] cursor-pointer"
                      title="Close Position"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {onAdjustBrackets && (
                  <div className="w-2.5 h-2.5 ml-1.5 rounded-full bg-red-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
                )}
              </div>

              {(bracketAdjustStatus === 'saving' ||
                bracketAdjustStatus === 'error' ||
                bracketAdjustError) && (
                <div className="absolute left-3 bottom-3 pointer-events-none rounded-md border border-white/15 bg-black/80 px-2.5 py-1.5 text-[10px] font-semibold">
                  {bracketAdjustStatus === 'saving' && (
                    <span className="text-amber-200">Saving SL/TP…</span>
                  )}
                  {(bracketAdjustStatus === 'error' || bracketAdjustError) &&
                    bracketAdjustStatus !== 'saving' && (
                      <span className="text-red-300">
                        {bracketAdjustError || 'Could not update brackets'}
                      </span>
                    )}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Armed Situations On-Chart Badges (Waiting for Level Touch / Conditions) ── */}
        {!positionOverlay && !editableOverlay && !pendingLimit && armedSituations.length > 0 && (() => {
          const sit = armedSituations[0]!
          const sitTarget = sit.targetPrice ?? sit.conditions?.targetPrice
          if (!sitTarget || sitTarget <= 0) return null
          const sitSl = sit.stopLoss ?? sit.conditions?.stopLoss
          const sitTp = sit.takeProfit ?? sit.conditions?.takeProfit
          const isLong = (sit.direction || 'LONG').toUpperCase() === 'LONG'
          const curPx = livePrice ?? sitTarget
          const distToTarget = Math.abs(curPx - sitTarget)
          const distTpPts = sitTp ? Math.abs(sitTp - sitTarget) : 0
          const distSlPts = sitSl ? Math.abs(sitTarget - sitSl) : 0

          return (
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              {/* Planned Take Profit Line Pill */}
              {sitTp && sitTp > 0 && (
                <div
                  data-ov-price={sitTp}
                  data-ov-dy={-14}
                  className="absolute flex items-center pointer-events-auto select-none z-30 group cursor-default"
                  style={{ left: '38%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                  title={`Planned Take Profit @ ${sitTp.toLocaleString()}`}
                >
                  <div className="flex items-center rounded-md border border-[#363a45] bg-[#1e222d]/95 shadow-xl text-[11px] font-mono overflow-hidden backdrop-blur-sm">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 text-neutral-200">
                      <span className="font-semibold text-neutral-400">Planned TP:</span>
                      <span className="font-semibold text-neutral-300">
                        {isLong ? 'Limit Sell' : 'Limit Buy'}
                      </span>
                      <span className="text-emerald-400 font-bold">+{distTpPts.toFixed(1)} pts</span>
                    </div>
                    <div className={`px-2 py-1 font-bold text-xs text-white ${isLong ? 'bg-[#f23645]' : 'bg-[#089981]'}`}>
                      {isLong ? '-1' : '+1'}
                    </div>
                  </div>
                </div>
              )}

              {/* Situation Entry Trigger Level (Target Price) */}
              <div
                data-ov-price={sitTarget}
                data-ov-dy={-14}
                className="absolute flex items-center pointer-events-auto select-none z-30 group cursor-default"
                style={{ left: '38%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                title={`Armed Situation Trigger Level @ ${sitTarget.toLocaleString()}`}
              >
                <div className="flex items-center rounded-md border border-cyan-500/60 bg-[#1e222d]/95 shadow-xl text-[11px] font-mono overflow-hidden backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 text-neutral-200">
                    <span className="font-semibold text-cyan-300">
                      {isLong ? 'Market Buy (Touch)' : 'Market Sell (Touch)'}
                    </span>
                    <span className="text-amber-300 font-bold">
                      {distToTarget.toFixed(1)} pts away
                    </span>
                  </div>
                  <div className={`px-2 py-1 font-bold text-xs text-white ${isLong ? 'bg-[#089981]' : 'bg-[#f23645]'}`}>
                    {isLong ? '+1' : '-1'}
                  </div>
                  {/* Instant 1-Click Market Enter Button */}
                  {onPlaceOrder && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const cur = livePrice ?? sitTarget
                        const meta = MARKET_DEFAULT_PARAMS[instrument as MarketInstrument] || { defaultPrice: cur, defaultPoints: 20 }
                        const sl = sitSl ?? (isLong ? cur - meta.defaultPoints : cur + meta.defaultPoints)
                        const tp = sitTp ?? (isLong ? cur + meta.defaultPoints : cur - meta.defaultPoints)
                        void onPlaceOrder({
                          instrument,
                          direction: isLong ? 'LONG' : 'SHORT',
                          price: cur,
                          stopLoss: sl,
                          profitTarget: tp,
                          size: 1,
                          reason: `Manual 1-Click Trigger of Armed Situation: ${sit.description}`,
                        })
                      }}
                      className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition border-l border-[#363a45] flex items-center gap-0.5 cursor-pointer"
                      title="Jump in immediately at market price"
                    >
                      <span>⚡ In</span>
                    </button>
                  )}
                  {/* Disarm / Cancel button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      const updated = armedSituations.filter((r) => r.id !== sit.id)
                      setArmedSituations(updated)
                      saveRulesForMarket(instrument as MarketInstrument, updated as any)
                    }}
                    className="px-2 py-1 text-neutral-400 hover:text-white hover:bg-[#2a2e39] transition border-l border-[#363a45] cursor-pointer"
                    title="Disarm situation"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Planned Stop Loss Line Pill */}
              {sitSl && sitSl > 0 && (
                <div
                  data-ov-price={sitSl}
                  data-ov-dy={-14}
                  className="absolute flex items-center pointer-events-auto select-none z-30 group cursor-default"
                  style={{ left: '38%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                  title={`Planned Stop Loss @ ${sitSl.toLocaleString()}`}
                >
                  <div className="flex items-center rounded-md border border-[#363a45] bg-[#1e222d]/95 shadow-xl text-[11px] font-mono overflow-hidden backdrop-blur-sm">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 text-neutral-200">
                      <span className="font-semibold text-neutral-400">Planned SL:</span>
                      <span className="font-semibold text-neutral-300">
                        {isLong ? 'Stop Market Sell' : 'Stop Market Buy'}
                      </span>
                      <span className="text-rose-400 font-bold">-{distSlPts.toFixed(1)} pts</span>
                    </div>
                    <div className={`px-2 py-1 font-bold text-xs text-white ${isLong ? 'bg-[#f23645]' : 'bg-[#089981]'}`}>
                      {isLong ? '-1' : '+1'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Working Limit Order On-Chart Badges ── */}
        {(editablePending || pendingLimit) && !positionOverlay && !riskBox && (() => {
          const pend = editablePending ?? pendingLimit!
          const isLong = (pend.direction || 'long').toLowerCase() === 'long'
          const curPx = livePrice ?? pend.price
          const distToLimit = Math.abs(curPx - pend.price)
          const distTpPts = Math.abs(pend.profitTarget - pend.price)
          const distSlPts = Math.abs(pend.price - pend.stopLoss)
          const saving = workingBracketAdjustStatus === 'saving'

          return (
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              {/* Working TP */}
              <div
                data-ov-price={pend.profitTarget}
                data-ov-dy={-14}
                onMouseDown={onAdjustWorkingBrackets && !saving ? onWorkingTpMouseDown : undefined}
                className={`absolute flex items-center pointer-events-auto select-none z-30 group ${
                  onAdjustWorkingBrackets && !saving ? 'cursor-ns-resize' : 'cursor-default'
                }`}
                style={{ left: '38%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                title={`Drag Take Profit @ ${pend.profitTarget.toLocaleString()}`}
              >
                <div className="flex items-center rounded border border-[#363a45] bg-[#1e222d]/95 shadow-xl text-[11px] font-mono overflow-hidden backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 text-neutral-200">
                    <span className="font-semibold text-neutral-300">
                      {isLong ? 'Limit Sell' : 'Limit Buy'}
                    </span>
                    <span className="text-emerald-400 font-bold">+{distTpPts.toFixed(1)} pts</span>
                  </div>
                  <div className={`px-2 py-1 font-bold text-xs text-white ${isLong ? 'bg-[#f23645]' : 'bg-[#089981]'}`}>
                    {isLong ? '-1' : '+1'}
                  </div>
                  {onCancelPending && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCancelPending()
                      }}
                      className="px-2 py-1 text-neutral-400 hover:text-white hover:bg-[#2a2e39] transition border-l border-[#363a45] cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {onAdjustWorkingBrackets && (
                  <div className="w-2.5 h-2.5 ml-1.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
                )}
              </div>

              {/* Working Limit Entry */}
              <div
                data-ov-price={pend.price}
                data-ov-dy={-14}
                className="absolute flex items-center pointer-events-auto select-none z-30 group cursor-default"
                style={{ left: '38%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
              >
                <div className="flex items-center rounded border border-sky-500/60 bg-[#1e222d]/95 shadow-xl text-[11px] font-mono overflow-hidden backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 text-neutral-200">
                    <span className="font-semibold text-sky-300">
                      {isLong ? 'Limit Buy' : 'Limit Sell'}
                    </span>
                    <span className="text-sky-400 font-bold">{distToLimit.toFixed(1)} pts away</span>
                  </div>
                  <div className={`px-2 py-1 font-bold text-xs text-white ${isLong ? 'bg-[#089981]' : 'bg-[#f23645]'}`}>
                    {isLong ? '+1' : '-1'}
                  </div>
                  {onCancelPending && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCancelPending()
                      }}
                      className="px-2 py-1 bg-rose-950/70 hover:bg-rose-600 text-rose-300 hover:text-white font-bold transition border-l border-[#363a45] cursor-pointer"
                      title="Cancel Limit Order"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Working SL */}
              <div
                data-ov-price={pend.stopLoss}
                data-ov-dy={-14}
                className="absolute flex items-center pointer-events-none select-none z-30 opacity-90"
                style={{ left: '38%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
              >
                <div className="flex items-center rounded border border-dotted border-red-500/60 bg-[#1e222d]/95 shadow-xl text-[11px] font-mono overflow-hidden backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 text-neutral-200">
                    <span className="font-semibold text-neutral-300">
                      {isLong ? 'Stop Market Sell' : 'Stop Market Buy'}
                    </span>
                    <span className="text-rose-400 font-bold">-{distSlPts.toFixed(1)} pts</span>
                    <span className="text-[9px] uppercase text-amber-300">locked</span>
                  </div>
                  <div className={`px-2 py-1 font-bold text-xs text-white ${isLong ? 'bg-[#f23645]' : 'bg-[#089981]'}`}>
                    {isLong ? '-1' : '+1'}
                  </div>
                </div>
              </div>

              {(workingBracketAdjustStatus === 'saving' ||
                workingBracketAdjustStatus === 'error' ||
                workingBracketAdjustError) && (
                <div className="absolute left-3 bottom-3 pointer-events-none rounded-md border border-white/15 bg-black/80 px-2.5 py-1.5 text-[10px] font-semibold">
                  {workingBracketAdjustStatus === 'saving' && (
                    <span className="text-amber-200">Saving TP…</span>
                  )}
                  {(workingBracketAdjustStatus === 'error' || workingBracketAdjustError) &&
                    workingBracketAdjustStatus !== 'saving' && (
                      <span className="text-red-300">
                        {workingBracketAdjustError || 'Could not update take profit'}
                      </span>
                    )}
                </div>
              )}
            </div>
          )
        })()}



        {/* Playbook — hidden until Playbook (P); cards still refresh in the background */}
        {!SYSTEMATIC_LIVE_DESK && deskLevelsActive && playbookOpen && (
          <DraggableDeskWidget
            storageKey="desk-playbook-live"
            defaultPos={{ x: 24, y: 88 }}
            title={playbookPanelTitle}
            onClose={() => {
              playbookUserClosedRef.current = true
              setPlaybookOpen(false)
            }}
          >
            <div className="space-y-1.5 p-2">
              <p className="px-1 pb-1 text-[10px] leading-snug text-gray-500">
                Level Finder advises only. Place on CALL ±10 (double-click or a painted band).
              </p>
              <p className="px-1 pb-1 text-[10px] leading-snug text-gray-500">
                {watchPlaybookHint}
              </p>
              {noInBandLevelsMessage && (
                <p className="rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-2 text-[11px] leading-snug text-amber-100">
                  {noInBandLevelsMessage}
                </p>
              )}
              {playbookAdviseLevels.length === 0 && (
                <p className="rounded-md border border-white/10 bg-black/30 px-2 py-2 text-[11px] leading-snug text-gray-400">
                  No in-band advise levels yet — the book still updates with CALL and the
                  locked playbook. Place on CALL ±10.
                </p>
              )}
              {playbookAdviseLevels
                .map((l, i) => {
                  const side: 'BUY' | 'SHORT' =
                    l.side === 'BUY' || l.side === 'SHORT'
                      ? l.side
                      : l.type === 'resistance'
                        ? 'SHORT'
                        : 'BUY'
                  const isRes = side === 'SHORT'
                  const stars = Math.max(1, Math.min(5, Math.round((l.conviction || 5) / 2)))
                  const isPrimary = (l.label || '').includes('PRIMARY')
                  const reaction = reactionLabel(l)
                  const why =
                    (l.reasoning && l.reasoning.trim()) ||
                    `${isPrimary ? 'Primary' : 'Watch'} ${isRes ? 'short' : 'buy'} from ${l.source === 'structure' ? 'structure' : 'AI'} · conviction ${l.conviction ?? '—'}`
                  return (
                    <button
                      key={`${l.price}-${i}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        jumpToPriceRef?.current?.(l.price)
                      }}
                      className={`w-full rounded-xl border px-2.5 py-2.5 text-left text-[11px] transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${isRes
                        ? 'border-red-800/80 bg-[#2a1518] text-red-200'
                        : 'border-emerald-800/80 bg-[#12241c] text-emerald-200'
                        } ${isPrimary ? 'ring-1 ring-white/25' : 'opacity-90'}`}
                      title={`${why} · advise only (click to focus) — place on CALL ±10`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-wide">
                          {isPrimary ? 'PRIMARY' : 'WATCH'} {isRes ? 'SHORT' : 'BUY'}
                        </span>
                        <span className="text-[10px] text-amber-300" title={`Conviction ${l.conviction}`}>
                          {'★'.repeat(stars)}
                          <span className="text-gray-500">{'☆'.repeat(5 - stars)}</span>
                        </span>
                      </div>
                      <div className="price-mono mt-1 text-base font-bold tracking-tight text-white">
                        {l.price.toLocaleString()}
                      </div>
                      <p className="mt-1.5 line-clamp-3 text-[10px] leading-snug text-gray-400 normal-case">
                        {why}
                      </p>
                      {reaction && (
                        <div
                          className={`mt-1.5 text-[9px] font-semibold uppercase tracking-wide ${reaction.startsWith('held')
                            ? 'text-emerald-400'
                            : reaction.startsWith('broke')
                              ? 'text-red-400'
                              : 'text-amber-300'
                            }`}
                        >
                          Market · {reaction}
                        </div>
                      )}
                    </button>
                  )
                })}
            </div>
          </DraggableDeskWidget>
        )}



        {/* ── Confluence Strategy Signals — rendered directly on chart candles ── */}

        {/* User Drawing Toast Notification */}
        {drawingToast && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-xl bg-neutral-900/95 border border-purple-500/50 shadow-2xl backdrop-blur text-xs font-mono text-white animate-in fade-in zoom-in duration-150">
            <span className="text-purple-400 font-bold">
              {drawingToast.type === 'TRENDLINE' ? '📐 TRENDLINE' : drawingToast.type === 'RANGE' ? '⬛ RANGE BOX' : '📊 MANUAL FRVP'}:
            </span>
            <span className="text-neutral-200">{drawingToast.summary}</span>
            <button
              onClick={() => setDrawingToast(null)}
              className="ml-2 text-neutral-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Auction Price Critique & "Questioning" Desk Modal ── */}
        {showQuestioningModal && livePriceCritique && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-[#0f141c] border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden font-sans text-slate-200">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">⚖️</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-sm tracking-wide text-amber-300 uppercase">
                        Auction Price Critique & "Questioning" Desk
                      </h3>
                      <span className="text-[10px] text-zinc-400 font-mono bg-zinc-800/80 px-1.5 py-0.5 rounded border border-zinc-700">
                        Hotkey: Q
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      {instrument} @ <span className="font-mono font-bold text-white">{livePriceCritique.currentPrice.toFixed(2)}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center bg-zinc-800/90 rounded-lg p-0.5 border border-zinc-700/70 text-[10px]">
                    <span className="text-zinc-400 px-1.5 font-medium">NY Session Unlock:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setCritiqueStartOption('09:00')
                        critiqueStartOptionRef.current = '09:00'
                        if (typeof window !== 'undefined') localStorage.setItem('trading_critique_start_time', '09:00')
                      }}
                      className={`px-2 py-0.5 rounded font-mono font-bold transition cursor-pointer ${
                        critiqueStartOption === '09:00'
                          ? 'bg-amber-500 text-slate-950 shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                      title="Activate starting at 09:00 AM ET (30 mins before NY cash open)"
                    >
                      09:00 AM
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCritiqueStartOption('09:15')
                        critiqueStartOptionRef.current = '09:15'
                        if (typeof window !== 'undefined') localStorage.setItem('trading_critique_start_time', '09:15')
                      }}
                      className={`px-2 py-0.5 rounded font-mono font-bold transition cursor-pointer ${
                        critiqueStartOption === '09:15'
                          ? 'bg-amber-500 text-slate-950 shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                      title="Activate starting at 09:15 AM ET (15 mins before NY cash open)"
                    >
                      09:15 AM
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowQuestioningModal(false)}
                    className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition text-sm cursor-pointer"
                    title="Close (Esc or Q)"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                {/* Core Philosophy Banner */}
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200/90 leading-relaxed italic">
                  "The market is a place to do business. If price is not suitable for us, we never force a trade. Price advertises opportunity: when discounted we buy, when premium we short."
                </div>

                {/* Valuation State & Meter */}
                <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-400 uppercase tracking-wider text-[11px]">Valuation Meter</span>
                    <span className={`px-2 py-0.5 rounded font-extrabold text-xs font-mono uppercase tracking-wider ${
                      livePriceCritique.valuationState.includes('DISCOUNT')
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : livePriceCritique.valuationState.includes('PREMIUM')
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    }`}>
                      {livePriceCritique.valuationState.replace('_', ' ')} ({livePriceCritique.valuationScore > 0 ? '+' : ''}{livePriceCritique.valuationScore} / 100)
                    </span>
                  </div>

                  {/* Meter Bar */}
                  <div className="relative w-full h-3 bg-zinc-800 rounded-full overflow-hidden flex">
                    <div className="w-1/2 h-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-zinc-700 opacity-60" />
                    <div className="w-1/2 h-full bg-gradient-to-r from-zinc-700 via-rose-400 to-rose-500 opacity-60" />
                    {/* Position Marker */}
                    <div
                      className="absolute top-0 bottom-0 w-2.5 bg-white rounded-full shadow-[0_0_8px_white] -translate-x-1/2"
                      style={{ left: `${Math.max(5, Math.min(95, ((livePriceCritique.valuationScore + 100) / 200) * 100))}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                    <span>-100 Deep Discount</span>
                    <span>0 Fair Value</span>
                    <span>+100 Extreme Premium</span>
                  </div>
                </div>

                {/* Overnight & Session Inventory Reality */}
                <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-2">
                  <div className="flex items-center gap-2 text-sky-400 font-bold uppercase tracking-wider text-[11px]">
                    <span>🌐</span>
                    <span>Overnight & Global Inventory Reality</span>
                  </div>
                  <p className="text-zinc-300 text-[11.5px] leading-relaxed">
                    {livePriceCritique.inventoryCritique.critiqueSummary}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                    <div className="p-2 rounded bg-zinc-800/60 border border-zinc-700/50">
                      <span className="text-zinc-500 block text-[9.5px]">ON-POC</span>
                      <span className="text-white font-bold">{livePriceCritique.inventoryCritique.overnightPoc ?? 'N/A'}</span>
                    </div>
                    <div className="p-2 rounded bg-zinc-800/60 border border-zinc-700/50">
                      <span className="text-zinc-500 block text-[9.5px]">Y-POC</span>
                      <span className="text-white font-bold">{livePriceCritique.multiHorizonLevels.yesterdayPoc ?? 'N/A'}</span>
                    </div>
                    <div className="p-2 rounded bg-zinc-800/60 border border-zinc-700/50">
                      <span className="text-zinc-500 block text-[9.5px]">5D-POC</span>
                      <span className="text-white font-bold">{livePriceCritique.multiHorizonLevels.fiveDayPoc ?? 'N/A'}</span>
                    </div>
                    <div className="p-2 rounded bg-zinc-800/60 border border-zinc-700/50">
                      <span className="text-zinc-500 block text-[9.5px]">5M AVWAP</span>
                      <span className="text-emerald-400 font-bold">{livePriceCritique.multiHorizonLevels.fiveMonthAvwap ?? 'N/A'}</span>
                    </div>
                  </div>
                </div>

                {/* Weak-Hand Trap & Emotional Risk Radar */}
                <div className={`p-4 rounded-xl border ${
                  livePriceCritique.weakHandTrap.isTrapRisk
                    ? 'bg-rose-500/10 border-rose-500/40 text-rose-200'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                }`}>
                  <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[11px] mb-1">
                    <span>{livePriceCritique.weakHandTrap.isTrapRisk ? '⚠️' : '🛡️'}</span>
                    <span>Weak-Hand Trap & Emotional Risk Radar</span>
                  </div>
                  <p className="text-[11.5px] leading-relaxed">
                    {livePriceCritique.weakHandTrap.isTrapRisk
                      ? livePriceCritique.weakHandTrap.warning
                      : 'No acute weak-hand trap detected. Order flow and volume indicate structural participation.'}
                  </p>
                </div>

                {/* 6-Point Questioning Self-Audit Checklist */}
                <div className="space-y-2">
                  <span className="font-bold text-zinc-400 uppercase tracking-wider text-[11px] block">
                    Pre-Trade 6-Question Self-Audit
                  </span>
                  <div className="space-y-2">
                    {livePriceCritique.sixQuestionAudit.map((q) => (
                      <div
                        key={q.id}
                        className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-zinc-300 text-[11px]">{q.question}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold font-mono ${
                              q.status === 'DANGER'
                                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                                : q.status === 'WARNING'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            }`}
                          >
                            {q.status}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-zinc-400 leading-snug">
                          <span className="text-zinc-200 font-medium">{q.headline}: </span>
                          {q.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Desk Guidance */}
                <div className="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/60 text-amber-200 font-mono text-[11px] flex items-start gap-2">
                  <span className="text-base">📋</span>
                  <div>
                    <span className="font-bold uppercase text-zinc-400 block text-[10px]">Desk Directive</span>
                    {livePriceCritique.deskGuidance}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800 bg-zinc-950">
                <button
                  type="button"
                  onClick={() => setShowQuestioningModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition cursor-pointer"
                >
                  Close (Esc)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLeoExternalPoints([
                      {
                        id: 'price-critique-dossier',
                        label: `Price Critique: ${livePriceCritique.valuationState}`,
                        value: `${livePriceCritique.valuationScore > 0 ? '+' : ''}${livePriceCritique.valuationScore} / 100`,
                        tier: 'CONTEXT',
                        category: 'INVENTORY',
                        description: `${livePriceCritique.deskGuidance} | ${livePriceCritique.inventoryCritique.critiqueSummary}`,
                      },
                    ])
                    setLeoAutoPrompt(
                      'Leo, critique the current market price and auction structure based on overnight inventory, yesterday and 5-day POCs, and 5-month AVWAP.'
                    )
                    setLeoPanelOpen(true)
                    setShowQuestioningModal(false)
                  }}
                  className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                >
                  <span>🤖</span>
                  <span>Ask Leo to Critique Price</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Leo AI Desk Assistant (Voice & Interactive Clickable Telemetry) ── */}
        <LeoAssistantPanel
          key={leoContext.instrument}
          context={leoContext}
          candles={candlesRef.current.length > 0 ? candlesRef.current : candles}
          isOpen={leoPanelOpen}
          onToggleOpen={() => setLeoPanelOpen((prev) => !prev)}
          onClose={() => setLeoPanelOpen(false)}
          externalAttachedPoints={leoExternalPoints}
          onClearExternalAttachedPoints={() => setLeoExternalPoints([])}
          externalPrompt={leoAutoPrompt}
          onClearExternalPrompt={() => setLeoAutoPrompt(null)}
          onClosePosition={onClosePosition}
          onPlaceOrder={onPlaceOrder}
          onOverrideDayType={setDayTypeOverride}
        />
      </div>
    </div>
  )
}
