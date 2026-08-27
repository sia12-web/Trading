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
} from 'lightweight-charts'
import {
  AVWAP_CANDLE_FETCH_CALENDAR_DAYS,
  computeAnchoredVwap,
  computeSessionHighlightSpans,
  projectSessionHighlightRects,
  paintSessionHighlightOverlay,
  deskClockFor,
  deskSessionAt,
  isWeekdayYmd,
  zonedCivilToUnix,
  lastNTradingSessions as trimDeskCandles,
  sessionLegendLabel,
  sessionLegendOrder,
  SESSION_STYLES as SESSION_RANGE_STYLES,
  VWAP_COLORS as SHARED_VWAP_COLORS,
  type SessionHighlightSpan,
} from '@/lib/chart/sessionVwap'
import {
  applyTickToFormingBar,
  mergeHistoryWithLiveTip,
  closedHistoryOhlcChanged,
  quoteUnixForBucket,
} from '@/lib/chart/liveFormingBar'
import {
  formatChartClock,
  formatChartDate,
  mapTimesToChart,
  toChartTime,
} from '@/lib/chart/chartTime'
import {
  TRADER_DISPLAY_LABEL,
  TRADER_DISPLAY_TZ,
  deskLocalHmsAsTraderDisplay,
} from '@/lib/chart/traderDisplayTz'
import {
  previewLevelOrderPrices,
  resolveChartLimitPick,
} from '@/lib/trading/chartLevelPick'
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
  yesterdayProfileLineSpecs,
  yesterdayProfilePaintKey,
} from '@/lib/trading/yesterdayProfile'
import {
  computeOpeningActivity,
  openingActivityBadgeText,
  openingActivityLineSpecs,
  openingActivityPaintKey,
  resolveOpeningAsOfUnix,
} from '@/lib/trading/openingActivity'
import {
  computeMarketControl,
  marketControlBadgeText,
  marketControlLineSpecs,
  marketControlPaintKey,
  resolveMarketControlAsOfUnix,
  type MarketControl,
} from '@/lib/trading/marketControl'
import {
  CALL_COLORS,
  computeDeskCall,
  deskCallBadgeText,
  deskCallHoverText,
  resolveDeskCallAsOfUnix,
  assertDeskTicketEntry,
  ticketAllowedEdges,
  deskCallSetupEdges,
  type DeskCall,
} from '@/lib/trading/deskCall'
import { deskCallModeHoverPrefix } from '@/lib/trading/deskCallMode'
import { SYSTEMATIC_LIVE_DESK } from '@/lib/trading/systematicDesk'
import { persistQuietDeskPerfLtar } from '@/lib/trading/ltarStore'
import { deskSitLineSpecs } from '@/lib/trading/deskSituation'
import { longTermRegionLineSpecs } from '@/lib/trading/longTermBracket'
import {
  formatCallSetupTelegram,
  isNyCallSetup,
} from '@/lib/trading/nyDeskStrategy'
import {
  AUCTION_TELEGRAM_KIND,
  evaluateAuctionLiveSignal,
} from '@/lib/trading/auctionLiveSignal'
import {
  applyIbLiquiditySwingToRange,
  applyIbLiquiditySwingToRanges,
  computeIbExtendAdvice,
  findIbLiquiditySwing,
  ibExtendAlertKind,
  type IbExtendAdvice,
} from '@/lib/trading/ibExtendAdvice'
import { quoteBelongsToBook } from '@/lib/trading/deskExitGuard'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import { DraggableDeskWidget } from '@/app/dashboard/components/DraggableDeskWidget'
import { LiveVoicePanel } from '@/app/dashboard/chart/components/LiveVoicePanel'
import {
  DESK_BAR_SPACING,
  DESK_CANDLE_DOWN,
  DESK_CANDLE_UP,
  DESK_CHART_THEME,
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
} from '@/lib/trading/sessionGate'
import type { AsiaDeskOverlay } from '@/lib/trading/asiaDesk'
import {
  resolveDeskPlaybookMode,
  deskPlaybookAnalysisMode,
  deskPlaybookHint,
  deskPlaybookUsesAfternoonLevels,
  deskPlaybookToolbarLabel,
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
import {
  snapEntryToNearestOpenBandCenter,
  clampPriceToRangeEdgeEnvelope,
  filterLevelsInRangeEdgeBand,
  attributePlaybookBandEntry,
  NO_IN_BAND_LEVELS_MESSAGE,
  RANGE_EDGE_BAND_POINTS,
  RANGE_EDGE_OFF_BAND_MESSAGE,
  rangeEdgeBandLegend,
  rangeEdgeBands,
  filterRangeEdgeBands,
} from '@/lib/trading/rangeEdgeEntryGate'
import {
  computeRangeEdgeTails,
  latestQualityTail,
  preferLevelsWithRangeEdgeTail,
  type RangeEdgeTail,
  type ShapedRangeForTails,
} from '@/lib/chart/rangeEdgeTails'
import {
  formatRangeShapedNote,
  claimDeskNoteOnce,
  deskNoteClaimKey,
  hasDeskNoteClaim,
  rangeEdgeProximity,
} from '@/lib/trading/rangeEdgeAlerts'
import {
  buildRangeAtrSnapshot,
  formatRangeAtrAdviceLine,
  formatRangeAtrChip,
  type RangeAtrSnapshot,
} from '@/lib/trading/rangeAtr'
import {
  OR15_COLORS,
  computeOr15Range,
  computeOr15Signals,
  isOr15Instrument,
  or15LineSeriesData,
  or15WindowLabel,
  type Or15Range,
} from '@/lib/chart/openingRange15'
import {
  NIKKEI_US_RANGE_COLORS,
  computeNikkeiUsRangeBreakout,
  currentNikkeiUsRangeForChart,
  isNikkeiUsRangeInstrument,
  nikkeiUsRangeLineSeriesData,
  type NikkeiUsSessionRange,
} from '@/lib/chart/nikkeiUsRangeBreakout'
import {
  OR30_COLORS,
  computeOr30Range,
  computeOr30Signals,
  isOr30Instrument,
  or30LineSeriesData,
  or30WindowLabel,
  type Or30Range,
} from '@/lib/chart/openingRange30'
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
  clickIsOnPriceScale,
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

/** Header ticker repaint cadence — the readout subtree only. */
const PRICE_TICKER_MS = 50
/** Cadence for the React state that feeds badges / proximity / alert effects. */
const PRICE_STATE_MS = 200
/** REST reconcile spacing while the SSE push stream is still delivering ticks. */
const RECONCILE_HEALTHY_MS = 20_000

/** Candle width before range overlays / last-value tags relayout the pane. */
function readDeskBarSpacing(chart: { timeScale: () => { options: () => { barSpacing: number } } } | null): number {
  try {
    const n = chart?.timeScale().options().barSpacing
    return typeof n === 'number' && n > 0 ? n : DESK_BAR_SPACING
  } catch {
    return DESK_BAR_SPACING
  }
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
  tickMarkFormatter: (time: UTCTimestamp | string | number, tickMarkType: TickMarkType) => string
  timeFormatter: (time: UTCTimestamp | string | number) => string
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
function makeDeskChartFormatters(_instrument: Instrument): DeskChartFmt {
  const tzLabel = TRADER_DISPLAY_LABEL
  const toUnix = (time: UTCTimestamp | string | number) =>
    typeof time === 'number' ? time : Math.floor(new Date(String(time)).getTime() / 1000)

  const formatTime = (chartUnix: number, withSeconds = false) =>
    formatChartClock(chartUnix, withSeconds)
  const formatDate = (chartUnix: number, style: 'day' | 'month' | 'year' = 'day') =>
    formatChartDate(chartUnix, style)

  return {
    formatTime,
    formatDate,
    tzLabel,
    tickMarkFormatter: (time, tickMarkType) => {
      const unix = toUnix(time)
      if (!Number.isFinite(unix)) return ''
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
      return `${formatDate(unix, 'day')} ${formatTime(unix)} ${tzLabel}`
    },
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI' | 'GOLD' | 'CRUDE'

/** Desk charts are 5m only — live and simulation share this. */
const DESK_TIMEFRAME = '5m' as const
const DESK_BAR_SECONDS = 300

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
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INSTRUMENT_META: Record<Instrument, { label: string; symbol: string; color: string; basePrice: number }> = {
  DOW: { label: 'Micro Dow · MYM', symbol: 'MYM', color: '#1d4ed8', basePrice: 39500 },
  NASDAQ: { label: 'Micro Nasdaq · MNQ', symbol: 'MNQ', color: '#0f766e', basePrice: 28500 },
  NIKKEI: { label: 'Nikkei USD', symbol: 'NKD', color: '#f472b6', basePrice: 38000 },
  GOLD: { label: 'Micro Gold · MGC', symbol: 'MGC', color: '#ca8a04', basePrice: 4500 },
  CRUDE: { label: 'Crude · CL', symbol: 'CL', color: '#78716c', basePrice: 85 },
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

const LEVEL_COLORS: Record<string, string> = {
  support: '#22c55e',
  resistance: '#ef4444',
  vwap: '#f59e0b',
}

const STATUS_COLORS: Record<string, string> = {
  approaching: '#facc15',
  touched: '#3b82f6',
  contested: '#facc15',
  broken: '#ef4444',
  bounced: '#a855f7',
  respected: '#22c55e',
  rejected: '#f97316',
  held: '#22c55e',
  untested: '#6b7280',
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
function toDeskCandles(candles: OHLCV[], instrument: Instrument = 'DOW'): OHLCV[] {
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
  return trimmed.map((c) => ({
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
function normalizeCandleTimes(candles: OHLCV[]): OHLCV[] {
  if (!Array.isArray(candles) || candles.length === 0) return []
  const sorted = [...candles].sort(
    (a, b) => (a.time as number) - (b.time as number)
  )
  const out: OHLCV[] = []
  for (const c of sorted) {
    if (!c) continue
    const t = Number(c.time)
    const o = Number(c.open)
    const h = Number(c.high)
    const l = Number(c.low)
    const cl = Number(c.close)
    if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(cl)) continue
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
      out[out.length - 1] = safeCandle // keep latest OHLC for duplicate timestamp
      continue
    }
    if (prev && t <= (prev.time as number)) continue
    out.push(safeCandle)
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
  if (!data) return null
  const isUp = data.change >= 0

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs price-mono select-none pointer-events-none">
      <span className="text-gray-600">{data.time}</span>
      <span className="text-gray-500">O <span className="text-gray-300">{data.open.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
      <span className="text-gray-500">H <span className="text-green-400">{data.high.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
      <span className="text-gray-500">L <span className="text-red-400">{data.low.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
      <span className="text-gray-500">C <span style={{ color }}>{data.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
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
}: {
  subscribe: (onChange: () => void) => () => void
  getTick: () => LivePriceTick | null
  instrument: Instrument
  barCountdown: string
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
          title="Time remaining in current 5-minute candle"
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
  entryPrice: number
  stopLoss: number
  profitTarget: number
  direction: 'long' | 'short'
  /** Contract/units size — used for $ P&L on SL/TP drag pills */
  positionSize?: number
  /** Session risk $ — sizes MYM/MNQ on the chart to match the TradingView ticket */
  riskDollars?: number
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
  onCancelPending,
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
}: TradingChartProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartFrameRef = useRef<HTMLDivElement>(null)
  const sessionOverlayRef = useRef<HTMLDivElement>(null)
  const positionBandOverlayRef = useRef<HTMLDivElement>(null)
  const sessionSpansRef = useRef<{
    key: string
    spans: SessionHighlightSpan[]
    candleTimes: number[]
  } | null>(null)
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
  const [showIbBreakouts, setShowIbBreakouts] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().ib
  )
  /** Open range (first 15m) H/L + volume BRK/REJ */
  const or15SeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const or15RangeRef = useRef<Or15Range | null>(null)
  const [or15Shaped, setOr15Shaped] = useState(false)
  const [or15Locked, setOr15Locked] = useState(false)
  const [showOr15, setShowOr15] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().or15
  )
  /** US session range H/L + Asia BRK/REJ — NIKKEI only */
  const usRangeSeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const usRangeRef = useRef<NikkeiUsSessionRange | null>(null)
  const [usRangeShaped, setUsRangeShaped] = useState(false)
  /** Gates current-session US H/L lines (IB-style, no markers) */
  const [showUsRange, setShowUsRange] = useState(() => loadDeskOverlayToggles().us)
  /** Stable paint hook for tip-stream refresh (avoids restarting SSE on marker deps). */
  const paintDeskMarkersRef = useRef<(bars?: OHLCV[]) => void>(() => { })
  const syncDeskPlaybookRangesRef = useRef<(bars: OHLCV[]) => void>(() => { })
  const paintYesterdayProfileRef = useRef<() => void>(() => { })
  const paintOpeningActivityRef = useRef<() => void>(() => { })
  const paintMarketControlRef = useRef<() => void>(() => { })
  const paintDeskCallRef = useRef<() => void>(() => { })
  const deskCallRef = useRef<DeskCall | null>(null)
  const marketControlRef = useRef<MarketControl | null>(null)
  const resolvedUseCall: boolean | null = useCallProp === undefined ? true : useCallProp
  const useCallRef = useRef<boolean | null>(resolvedUseCall)
  useCallRef.current = resolvedUseCall
  /** First 30m opening range — NY 09:30–10:00 ET / Tokyo 09:00–09:30 JST */
  const or30SeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const or30RangeRef = useRef<Or30Range | null>(null)
  const [or30Shaped, setOr30Shaped] = useState(false)
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
  const [yesterdayBadge, setYesterdayBadge] = useState('Yday off')
  const [showOpeningActivity, setShowOpeningActivity] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().opening
  )
  const openingLinesRef = useRef<IPriceLine[]>([])
  const openingPaintKeyRef = useRef('')
  const [openingBadge, setOpeningBadge] = useState('WAIT')
  const [showMarketControl, setShowMarketControl] = useState(() =>
    SYSTEMATIC_LIVE_DESK ? true : loadDeskOverlayToggles().control
  )
  const controlLinesRef = useRef<IPriceLine[]>([])
  const controlPaintKeyRef = useRef('')
  const [controlBadge, setControlBadge] = useState('RF WAIT')
  const [callBadge, setCallBadge] = useState('WAIT')
  const [callHover, setCallHover] = useState(
    'CALL WAIT — no ticket\n\nTicket stays 1.5R. No Leo. No Level Finder fills.'
  )
  const [perfBadge, setPerfBadge] = useState('WAIT')
  const [perfHover, setPerfHover] = useState(
    'PERF WAIT — not enough letters for a developing value area. Drive may still CALL. Ticket stays 1.5R.'
  )
  const [sitBadge, setSitBadge] = useState('NONE')
  const [sitHover, setSitHover] = useState(
    'SIT NONE — no special situation. CALL side unchanged. Ticket stays 1.5R.'
  )
  const [regionBadge, setRegionBadge] = useState('WAIT')
  const [regionHover, setRegionHover] = useState(
    'REGION WAIT — not enough completed cash days for a 5-day TPO body. CALL unchanged. Ticket stays 1.5R.'
  )
  const [stayOutBadge, setStayOutBadge] = useState('—')
  const [stayOutHover, setStayOutHover] = useState(
    'OUT — not a stay-out day. CALL hunts legal ±10. Ticket stays 1.5R.'
  )
  const spikeLinesRef = useRef<IPriceLine[]>([])
  const spikePaintKeyRef = useRef('')
  const regionLinesRef = useRef<IPriceLine[]>([])
  const regionPaintKeyRef = useRef('')
  const quietLtarKeyRef = useRef('')
  const onDeskPerfRef = useRef(onDeskPerf)
  onDeskPerfRef.current = onDeskPerf
  const [ibExtendBadge, setIbExtendBadge] = useState('—')
  const [ibExtendHover, setIbExtendHover] = useState(
    'IB extend vs revert — advice only after IB locks. First tag is not the entry.'
  )
  const ibExtendRef = useRef<IbExtendAdvice | null>(null)
  const ibLiqLinesRef = useRef<IPriceLine[]>([])
  const paintIbExtendRef = useRef<() => void>(() => { })
  /** Live count of BRK/REJ markers currently painted (for toolbar status). */
  const [rangeSignalSummary, setRangeSignalSummary] = useState<{
    ib: number
    or30: number
    lunch: number
    us: number
  }>({ ib: 0, or30: 0, lunch: 0, us: 0 })
  const [latestTailStatus, setLatestTailStatus] = useState<{
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
  /** ±10 allowed-entry band lines around active playbook H/L */
  const entryBandLinesRef = useRef<IPriceLine[]>([])
  /** Signature of the painted ±10 tags — repaint only when the tags would differ */
  const entryBandPaintKeyRef = useRef<string | null>(null)
  const entryBandPaintHostRef = useRef<ISeriesApi<'Line'> | null>(null)
  const [entryBandsVisible, setEntryBandsVisible] = useState(false)
  const [entryBandLabel, setEntryBandLabel] = useState<string | null>(null)
  const [rangeAtrSnap, setRangeAtrSnap] = useState<RangeAtrSnapshot | null>(null)
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
  const [candles, setCandles] = useState<OHLCV[]>([])
  const [levels, setLevels] = useState<LevelLine[]>([])
  const [noInBandLevelsMessage, setNoInBandLevelsMessage] = useState<string | null>(null)
  const levelsRef = useRef<LevelLine[]>([])
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const [livePrice, setLivePrice] = useState<number | null>(null)
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
      const nowSec = Math.floor(Date.now() / 1000)
      const barSec = DESK_BAR_SECONDS
      const rem = barSec - (nowSec % barSec)
      const mins = Math.floor(rem / 60)
      const secs = rem % 60
      setBarCountdown(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`)
    }
    updateCountdown()
    const timer = setInterval(updateCountdown, 1000)
    return () => clearInterval(timer)
  }, [])

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
  ])
  /** Floating morning playbook — closed by default on chart refresh; open via Playbook (P). */
  const [playbookOpen, setPlaybookOpen] = useState(false)

  /** Single marker channel — IB + OR30 + Lunch + Nikkei US-range + range-edge tails. */
  const paintDeskMarkers = useCallback((bars?: OHLCV[]) => {
    const candleSeries = candleRef.current
    if (!candleSeries) return
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
    instrument,
    rangeStrategy,
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    stopHits,
  ])

  useEffect(() => {
    paintDeskMarkersRef.current = paintDeskMarkers
  }, [paintDeskMarkers])

  useEffect(() => {
    paintDeskMarkers()
  }, [showIbBreakouts, showOr15, showOr30, showUsRange, paintDeskMarkers])

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
      const openUnix =
        inst === 'NIKKEI'
          ? tokyoDateTimeToUnix(tipDay, oh!, om || 0)
          : nyDateTimeToUnix(tipDay, oh!, om || 0)
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
        const openUnix =
          inst === 'NIKKEI'
            ? tokyoDateTimeToUnix(tipDay, oh!, om || 0)
            : nyDateTimeToUnix(tipDay, oh!, om || 0)
        or15RangeRef.current = computeOr15Range(ohlcv, openUnix, nowUnix)
      } else {
        or15RangeRef.current = null
      }
      paintOr15Lines()
    }

    if (usRangeSeriesRef.current) {
      usRangeRef.current = isNikkeiUsRangeInstrument(inst)
        ? currentNikkeiUsRangeForChart(ohlcv, nowUnix)
        : null
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
        const openUnix =
          inst === 'NIKKEI'
            ? tokyoDateTimeToUnix(tipDay, oh!, om || 0)
            : nyDateTimeToUnix(tipDay, oh!, om || 0)
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
      const list = candlesRef.current
      if (list.length) syncDeskPlaybookRangesRef.current(list)
    }, 4000)
    return () => window.clearInterval(id)
  }, [])

  const paintYesterdayProfile = useCallback(() => {
    const host = priceLineHostRef.current
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
    if (!showYesterdayProfile || !profile || !host) return
    for (const spec of yesterdayProfileLineSpecs(profile)) {
      try {
        ydayLinesRef.current.push(
          host.createPriceLine({
            price: spec.price,
            color: spec.color,
            title: spec.title,
            lineWidth: spec.title === 'POC' ? 2 : 1,
            lineStyle: spec.dotted
              ? LineStyle.Dotted
              : spec.dashed
                ? LineStyle.Dashed
                : LineStyle.Solid,
            axisLabelVisible: true,
          })
        )
      } catch {
        /* ignore */
      }
    }
  }, [showYesterdayProfile, instrument])

  const paintOpeningActivity = useCallback(() => {
    const host = priceLineHostRef.current
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
    if (!showOpeningActivity || !host) return
    for (const spec of openingActivityLineSpecs(activity)) {
      try {
        openingLinesRef.current.push(
          host.createPriceLine({
            price: spec.price,
            color: spec.color,
            title: spec.title,
            lineWidth: spec.title === 'Open' ? 2 : 1,
            lineStyle: spec.dashed ? LineStyle.Dashed : LineStyle.Solid,
            axisLabelVisible: true,
          })
        )
      } catch {
        /* ignore */
      }
    }
  }, [showOpeningActivity, instrument])

  const paintMarketControl = useCallback(() => {
    const host = priceLineHostRef.current
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
    if (!showMarketControl || !host) return
    for (const spec of marketControlLineSpecs(control)) {
      try {
        controlLinesRef.current.push(
          host.createPriceLine({
            price: spec.price,
            color: spec.color,
            title: spec.title,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
          })
        )
      } catch {
        /* ignore */
      }
    }
  }, [showMarketControl, instrument])

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
      if (host) {
        for (const spec of deskSitLineSpecs({
          kind: call.sitKind ?? 'NONE',
          badgeText: nextSit,
          playLine: nextSitHover,
          spikeHigh: call.spikeHigh ?? null,
          spikeLow: call.spikeLow ?? null,
          gapHold: call.sitHold === true,
          gapDead: false,
          spikeReject: false,
        })) {
          try {
            spikeLinesRef.current.push(
              host.createPriceLine({
                price: spec.price,
                color: spec.color,
                title: spec.title,
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
              })
            )
          } catch {
            /* ignore */
          }
        }
      }
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
      if (host) {
        for (const spec of longTermRegionLineSpecs({
          instrument,
          ready: call.regionHigh != null && call.regionLow != null,
          mode: 'BRACKET',
          location: 'mid',
          acceptance: 'INSIDE',
          high: call.regionHigh ?? null,
          low: call.regionLow ?? null,
          days: 5,
          firstLegalOnly: call.regionVeto === true,
          badgeText: nextRegion,
          playLine: nextRegionHover,
        })) {
          try {
            regionLinesRef.current.push(
              host.createPriceLine({
                price: spec.price,
                color: spec.color,
                title: spec.title,
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
              })
            )
          } catch {
            /* ignore */
          }
        }
      }
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
    const chip = advice.chip
    setIbExtendBadge((prev) => (prev === chip ? prev : chip))
    const hover = `${advice.message}${advice.entryAdvice != null && advice.stopAdvice != null
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
    if (host && advice.swing) {
      try {
        ibLiqLinesRef.current.push(
          host.createPriceLine({
            price: advice.swing.price,
            color: '#eab308',
            title: advice.swing.kind === 'high' ? 'Liq H' : 'Liq L',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
          })
        )
      } catch {
        /* ignore */
      }
    }

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
    paintIbExtendRef.current = paintIbExtend
  }, [paintIbExtend])

  useEffect(() => {
    paintIbExtend()
  }, [paintIbExtend])

  const ibProximity = useMemo(() => {
    if (!showIbBreakouts || !ibShaped || !ibRangeRef.current || !livePrice) return null
    const ib = ibRangeRef.current
    const range = ib.high - ib.low
    const buffer = Math.max(range * 0.05, ib.high * 0.0015)

    if (Math.abs(livePrice - ib.high) <= buffer) {
      return { level: 'HIGH', price: ib.high }
    }
    if (Math.abs(livePrice - ib.low) <= buffer) {
      return { level: 'LOW', price: ib.low }
    }
    return null
  }, [showIbBreakouts, ibShaped, livePrice])
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

  const [rationaleModal, setRationaleModal] = useState<{
    open: boolean
    entryPrice: number
    stopLoss: number
    profitTarget: number
    direction: 'LONG' | 'SHORT'
    orderType?: 'LIMIT'
    suggestedReason: string
  } | null>(null)
  const [userRationale, setUserRationale] = useState('')
  const [userSlTpRationale, setUserSlTpRationale] = useState('')

  // Fullscreen mode (F key / Esc / button)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = useCallback(() => {
    if (!isFullscreen) {
      const elem = containerRef.current?.parentElement || document.documentElement
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
  }, [isFullscreen])

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

  const overlayRafRef = useRef(0)
  const overlaySampleUntilRef = useRef(0)

  /** Place now, then keep sampling each frame for a beat so kinetic scroll and
   * autoscale animations stay glued to the candles without a perpetual loop. */
  const pokeOverlayLayout = useCallback(() => {
    applyOverlayLayout()
    overlaySampleUntilRef.current = Date.now() + OVERLAY_SETTLE_MS
    if (overlayRafRef.current) return
    const loop = () => {
      applyOverlayLayout()
      if (Date.now() < overlaySampleUntilRef.current) {
        overlayRafRef.current = requestAnimationFrame(loop)
      } else {
        overlayRafRef.current = 0
      }
    }
    overlayRafRef.current = requestAnimationFrame(loop)
  }, [applyOverlayLayout])

  const pokeOverlayLayoutRef = useRef(pokeOverlayLayout)
  pokeOverlayLayoutRef.current = pokeOverlayLayout

  useOverlayLayoutEffect(() => {
    applyOverlayLayout()
  })

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
  /** LIVE = real Yahoo data; SYNTHETIC = random fallback (never trade off this) */
  const [dataMode, setDataModeState] = useState<'live' | 'synthetic'>('live')
  /** Candle history feed — yahoo means PA may diverge from OANDA/TV mid */
  const [candleFeed, setCandleFeed] = useState<'oanda' | 'yahoo' | 'empty'>('oanda')
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
                ? instrument === 'NIKKEI'
                  ? 'Open-range ±10 window is closed — enter on the live US Range / Tokyo IB playbook when unlocked.'
                  : 'Open-range / OR30 ±10 window is closed — enter on the live next-range playbook when unlocked.'
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
          body =
            instrument === 'NIKKEI'
              ? 'No live ±10 entry bands — wait for US Range / Tokyo IB to unlock, or refresh after first-hour IB lock.'
              : 'No live ±10 entry bands — wait for OR30 / IB to unlock.'
        } else if (hit) {
          if (hit.range.label === 'OR15' || hit.range.label === 'OR30') {
            title = `${hit.range.label} entry closed`
            body =
              instrument === 'NIKKEI'
                ? 'Open-range ±10 window is closed — enter on the live US Range / Tokyo IB playbook when unlocked.'
                : 'Open-range / OR30 ±10 window is closed — enter on the live next-range playbook when unlocked.'
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
  const [deskSessionLive, setDeskSessionLive] = useState(false)
  const [visibleInstruments, setVisibleInstruments] = useState<Instrument[]>(() => {
    if (allowedInstruments && allowedInstruments.length > 0) {
      return allowedInstruments.filter((i) => i !== 'NIKKEI')
    }
    return ['DOW', 'NASDAQ', 'GOLD', 'CRUDE']
  })

  useEffect(() => {
    const id = window.setInterval(() => setFocusTick((n) => n + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const now = new Date()
    setClockReady(true)
    setDeskSessionLive(isLiveTradingPageOpen(now))
    const live = liveVisibleInstruments(now, {
      lockedInstrument,
      clockedIn: deskAttended,
      attendedToday: deskAttended,
    }).filter((i) => i !== 'NIKKEI') as Instrument[]
    if (allowedInstruments && allowedInstruments.length > 0) {
      const fromGate = allowedInstruments.filter((i) => live.includes(i) && i !== 'NIKKEI')
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
    if (!visibleInstruments.includes(inst) || inst === 'NIKKEI') return
    setInstrumentState(inst)
    // Free-switch: remember any NY board tab (indexes + gold/crude).
    if (
      inst === 'DOW' ||
      inst === 'NASDAQ' ||
      inst === 'GOLD' ||
      inst === 'CRUDE'
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
    try {
      const aiRes = await fetch(aiLevelsUrl(inst))
      if (aiRes.ok) {
        const aiJson = await aiRes.json()
        aiRows = aiJson.levels ?? []
      }
    } catch {
      /* AI history optional until Level Finder has run */
    }

    let afternoonCandidates: unknown[] = []
    if (useAfternoonLevels) {
      try {
        const ap = await fetch(
          `/api/trading/afternoon-playbook?instrument=${encodeURIComponent(inst)}`
        )
        if (ap.ok) {
          const aj = await ap.json()
          afternoonCandidates = Array.isArray(aj.candidates) ? aj.candidates : []
        }
      } catch {
        /* optional until morning-review / IB prep has run */
      }
    }

    // Structure / IB anchored at this market's cash open (yesterday range)
    const sess = sessionFor(inst)
    const todayLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: sess.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const [oh, om] = sess.marketOpen.split(':').map(Number)
    const openUnix =
      inst === 'NIKKEI'
        ? tokyoDateTimeToUnix(todayLocal, oh!, om || 0)
        : nyDateTimeToUnix(todayLocal, oh!, om || 0)
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

  // Chart axis / tooltips always Montreal — desk logic stays on instrument clock.
  // Candle setData shifts unix → chart time; tickMarkFormatter reads UTC comps.
  useEffect(() => {
    chartFmtRef.current = makeDeskChartFormatters(instrument)
    chartTzRef.current = TRADER_DISPLAY_TZ
    const chart = chartRef.current
    if (!chart) return
    chart.applyOptions({
      localization: {
        timeFormatter: (time: UTCTimestamp | string | number) =>
          chartFmtRef.current.timeFormatter(time),
      },
    })
  }, [instrument])

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

    const chart = createChart(containerRef.current, {
      ...CHART_THEME,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      localization: {
        timeFormatter: (time: UTCTimestamp | string | number) =>
          chartFmtRef.current.timeFormatter(time),
      },
      timeScale: {
        ...CHART_THEME.timeScale,
        tickMarkFormatter: (
          time: UTCTimestamp | string | number,
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

      const session = sessionFocusHighLow(visibleBars, instrumentRef.current)
      if (session) {
        min = session.min
        max = session.max
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
      borderVisible: true,
      wickVisible: true,
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

    // Anchored VWAP + ±1/±2/±3σ bands (from NY 9:30 of 5 trading days ago)
    const bandOpts = {
      color: VWAP_COLORS.band,
      lineWidth: 1 as const,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      ...ignoreScale,
    }
    const vwapSeries = {
      upper3: chart.addLineSeries({ ...bandOpts, title: '+3σ' }),
      upper2: chart.addLineSeries({ ...bandOpts, title: '+2σ' }),
      upper1: chart.addLineSeries({ ...bandOpts, title: '+1σ' }),
      vwap: chart.addLineSeries({
        color: VWAP_COLORS.vwap,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title: 'AVWAP',
        ...ignoreScale,
      }),
      lower1: chart.addLineSeries({ ...bandOpts, title: '-1σ' }),
      lower2: chart.addLineSeries({ ...bandOpts, title: '-2σ' }),
      lower3: chart.addLineSeries({ ...bandOpts, title: '-3σ' }),
    }

    // Initial Balance — right-scale H/L labels only (no spanning line)
    const ibLineOpts = {
      color: '#3b82f6',
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      lineVisible: false,
      pointMarkersVisible: false,
      crosshairMarkerVisible: false,
      ...ignoreScale,
    }
    const ibSeries = {
      high: chart.addLineSeries({ ...ibLineOpts, title: 'IB H' }),
      low: chart.addLineSeries({ ...ibLineOpts, title: 'IB L' }),
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
      borderVisible: false,
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
      } else {
        const candle = param.seriesData.get(candleSeries) as CandlestickData | undefined
        if (!candle) {
          tipPending = null
        } else {
          const open = (candle as any).open ?? 0
          const close = (candle as any).close ?? 0
          const change = close - open
          const fmt = chartFmtRef.current
          tipPending = {
            time: param.time
              ? `${fmt.formatTime(param.time as number)} ${fmt.tzLabel}`
              : '',
            open: (candle as any).open,
            high: (candle as any).high,
            low: (candle as any).low,
            close: (candle as any).close,
            volume: 0,
            change,
            changePct: open !== 0 ? (change / open) * 100 : 0,
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
    ibSeriesRef.current = ibSeries
    or15SeriesRef.current = lunchSeries
    usRangeSeriesRef.current = usRangeSeries
    or30SeriesRef.current = or30Series
    setChartReady(true)

    // Sync overlay coordinates on chart scroll/zoom — DOM writes only, no render
    const onScroll = () => {
      pokeOverlayLayoutRef.current()
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onScroll)

    // Responsive resize — re-stick SL/TP after zoom / fullscreen
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        const dragging =
          draggingRiskLineRef.current ||
          draggingBracketRef.current ||
          draggingWorkingBracketRef.current
        if (!dragging) {
          ignorePriceFromPointerUntilRef.current = Date.now() + 80
        }
        chartRef.current.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        )
        pokeOverlayLayoutRef.current()
      }
    })
    ro.observe(containerRef.current)
    const onWheelLayout = () => pokeOverlayLayoutRef.current()
    containerRef.current.addEventListener('wheel', onWheelLayout, { passive: true })

    return () => {
      ro.disconnect()
      containerRef.current?.removeEventListener('wheel', onWheelLayout)
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onScroll)
      } catch { }
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      priceLineHostRef.current = null
      priceLineHostSeededRef.current = false
      vwapSeriesRef.current = null
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

  // ── Load candle data when instrument changes (5m only) ───────────────────────
  useEffect(() => {
    if (!chartReady) return
    // Free-switch NY board: load CME bars for the viewed book even if clock preference differs.
    let cancelled = false

    const load = async () => {
      const meta = INSTRUMENT_META[instrument]
      const tfSec = DESK_BAR_SECONDS
      const tradeLive = isLiveBarsAllowed(instrument)

      // Full continuum including afternoon — clipAfternoonBars is a no-op while freeze is off
      try {
        // Must cover cash open of 5 trading days prior (weekends truncate a plain 5d fetch)
        const days = AVWAP_CANDLE_FETCH_CALENDAR_DAYS
        const res = await fetch(
          `/api/trading/candles?instrument=${instrument}&timeframe=${DESK_TIMEFRAME}&days=${days}`
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
          const trimmed = normalizeCandleTimes(toDeskCandles(mapped, instrument))
          setCandles(trimmed)
          setDataMode('live')
          setCandleFeed(
            json.source === 'yahoo' ? 'yahoo' : json.source === 'oanda' ? 'oanda' : 'empty'
          )
          const last = mapped[mapped.length - 1]
          const loadedPrice = json.quote?.price ?? last?.close ?? null
          setLivePrice(loadedPrice)
          publishPriceTick(loadedPrice, json.quote?.change_pct ?? 0)
          loadLevels(instrument, trimmed)
          return
        }
      } catch {
        // fall through
      }

      if (cancelled) return
      // Synthetic fallback only during morning trade window — never invent afternoon/overnight
      if (!tradeLive.open) {
        setCandles([])
        setDataMode('live')
        setCandleFeed('empty')
        setLivePrice(null)
        publishPriceTick(null, 0)
        setLevels([])
        return
      }
      // Never invent candles in production — fake OHLCV must not drive orders
      if (process.env.NODE_ENV === 'production') {
        setCandles([])
        setDataMode('live')
        setCandleFeed('empty')
        setLivePrice(null)
        publishPriceTick(null, 0)
        setLevels([])
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
      loadLevels(instrument, generated)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [instrument, chartReady, loadLevels, levelsRefreshKey, lockedInstrument, publishPriceTick])

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
    void loadLevels(instrument)
  }, [chartReady, instrument, loadLevels])

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
    setCandles([])
    setLevels([])
    setLivePrice(null)
    publishPriceTick(null, 0)
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

  useEffect(() => {
    instrumentRef.current = instrument
  }, [instrument])

  useEffect(() => {
    candlesRef.current = candles
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

    if (!showLevelsRef.current) return

    const tip = lastCandleRef.current?.close
    const call = deskCallRef.current
    const wantSide: 'BUY' | 'SHORT' | null =
      call?.side === 'SHORT' ? 'SHORT' : call?.side === 'LONG' ? 'BUY' : null
    const source = levelsRef.current
    const aligned = wantSide
      ? source.filter((level) => {
        const isRes =
          level.type === 'resistance' ||
          String(level.type).toLowerCase().includes('resist')
        const side: 'BUY' | 'SHORT' =
          level.side === 'BUY' || level.side === 'SHORT'
            ? level.side
            : isRes
              ? 'SHORT'
              : 'BUY'
        return side === wantSide
      })
      : source
    const paintList = aligned.length > 0 ? aligned : source
    for (const level of paintList) {
      // Skip wrong-scale leftovers (e.g. Nikkei ~65k while DOW prints ~52k)
      if (
        tip != null &&
        tip > 0 &&
        Math.abs(level.price - tip) / tip > 0.08
      ) {
        continue
      }
      const isAi = level.source === 'ai'
      const isRes =
        level.type === 'resistance' || String(level.type).toLowerCase().includes('resist')
      const isPrimary = (level.label || '').includes('PRIMARY')
      const baseColor =
        STATUS_COLORS[level.status] ??
        LEVEL_COLORS[level.type] ??
        (isAi ? (isRes ? '#f87171' : '#34d399') : isRes ? '#f87171' : '#34d399')
      try {
        levelLinesRef.current.push(
          host.createPriceLine({
            price: level.price,
            color: baseColor,
            lineWidth: isPrimary ? 3 : 2,
            lineStyle: isPrimary ? LineStyle.Solid : isAi ? LineStyle.Solid : LineStyle.Dashed,
            axisLabelVisible: true,
            title: level.label
              ? `${level.label} ${level.price.toLocaleString()}`
              : `${isRes ? 'SHORT' : 'BUY'} ${level.price.toLocaleString()}`,
          })
        )
      } catch {
        /* ignore */
      }
    }
  }, [])

  // ── Push candle data to chart ─────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !chartRef.current || candles.length === 0) return

    const ordered = normalizeCandleTimes(candles)
    const tz = chartTzRef.current
    const candleData: CandlestickData[] = ordered.map((c) => ({
      time: toChartTime(c.time as number, tz) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    const ts = chartRef.current.timeScale()
    let savedRange: { from: number; to: number } | null = null
    const savedSpacing = didFitRef.current ? readDeskBarSpacing(chartRef.current) : DESK_BAR_SPACING
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

      // Same AVWAP pipeline for every index — cash open from desk clock
      const bands = computeAnchoredVwap(
        ordered.map((c) => ({
          time: c.time as number,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
        deskClockFor(instrument)
      )
      if (bands?.vwap?.length) {
        const last = bands.vwap[bands.vwap.length - 1]
        avwapLastRef.current =
          last && last.value > 0 ? last.value : null
      } else {
        avwapLastRef.current = null
      }
      const vs = vwapSeriesRef.current
      if (vs && bands) {
        const shift = <T extends { time: number | UTCTimestamp; value: number }>(rows: T[]) =>
          mapTimesToChart(
            rows.map((r) => ({ time: r.time as number, value: r.value })),
            tz
          ).map((r) => ({ time: r.time as UTCTimestamp, value: r.value }))
        vs.vwap.setData(shift(bands.vwap))
        vs.upper1.setData(shift(bands.upper1))
        vs.lower1.setData(shift(bands.lower1))
        vs.upper2.setData(shift(bands.upper2))
        vs.lower2.setData(shift(bands.lower2))
        vs.upper3.setData(shift(bands.upper3))
        vs.lower3.setData(shift(bands.lower3))
      } else if (vs) {
        vs.vwap.setData([])
        vs.upper1.setData([])
        vs.lower1.setData([])
        vs.upper2.setData([])
        vs.lower2.setData([])
        vs.upper3.setData([])
        vs.lower3.setData([])
      }

      syncDeskPlaybookRangesRef.current(ordered)

      paintYesterdayProfileRef.current()
      paintOpeningActivityRef.current()
      paintMarketControlRef.current()
      paintDeskCallRef.current()
      paintIbExtendRef.current()

      // One marker list for IB + Lunch (US Range / OR30 are lines-only)
      paintDeskMarkers(ordered)
      const host = priceLineHostRef.current
      if (host && !priceLineHostSeededRef.current && ordered.length > 0) {
        const a = ordered[0]!
        const b = ordered[ordered.length - 1]!
        if (ordered.length === 1 || a.time === b.time) {
          host.setData([
            {
              time: toChartTime(a.time as number, tz) as UTCTimestamp,
              value: a.close,
            },
          ])
        } else {
          host.setData([
            {
              time: toChartTime(a.time as number, tz) as UTCTimestamp,
              value: a.close,
            },
            {
              time: toChartTime(b.time as number, tz) as UTCTimestamp,
              value: b.close,
            },
          ])
        }
        priceLineHostSeededRef.current = true
      }
    } catch {
      // Bad series data must not blank the whole effect mid-way
      return
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
            time: toChartTime(merged.time as number, chartTzRef.current) as UTCTimestamp,
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
            time: toChartTime(liveBefore.time as number, chartTzRef.current) as UTCTimestamp,
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
      const spacing = deskBarSpacing(width, ordered.length)
      ts.applyOptions({ barSpacing: spacing, rightOffset: DESK_CHART_THEME.timeScale.rightOffset })
      requestAnimationFrame(() => {
        try {
          chartRef.current?.priceScale('right').applyOptions({
            autoScale: true,
            scaleMargins: DESK_CHART_THEME.rightPriceScale.scaleMargins,
          })
          const restored = loadDeskViewport(instrument, ordered.length, width)
          ts.setVisibleLogicalRange(
            restored ?? deskVisibleLogicalRange(ordered.length, width)
          )
          didFitRef.current = true
        } catch {
          /* ignore */
        }
      })
    } else if (savedRange) {
      // New prints / range unlock must not shrink candles (last-value tags widen the axis)
      requestAnimationFrame(() => {
        try {
          ts.setVisibleLogicalRange(savedRange)
          keepDeskBarSpacing(chartRef.current, savedSpacing)
        } catch {
          /* ignore */
        }
      })
    }
  }, [candles, instrument, paintLevelLines]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session color boxes (cached spans + imperative paint = smooth pan)
  const refreshSessionHighlights = useCallback(() => {
    const chart = chartRef.current
    const series = candleRef.current
    const list = candlesRef.current
    const host = sessionOverlayRef.current
    if (!chart || !series || !containerRef.current || list.length === 0) {
      paintSessionHighlightOverlay(host, [])
      paintPositionBandOverlay(positionBandOverlayRef.current, [])
      return
    }

    const tip = (list[list.length - 1]?.time as number) || 0
    const cacheKey = `${instrument}:${tip}:${list.length}`
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

    const tz = chartTzRef.current
    const { rects } = projectSessionHighlightRects({
      spans: cached.spans.map((s) => ({
        ...s,
        startT: toChartTime(s.startT, tz),
        endT: toChartTime(s.endT, tz),
      })),
      candleTimes: cached.candleTimes.map((t) => toChartTime(t, tz)),
      timeScale: chart.timeScale(),
      priceToY: (price) => series.priceToCoordinate(price),
      priceScaleWidth: priceAxisW,
      containerWidth: containerRef.current.clientWidth,
      containerHeight: containerRef.current.clientHeight,
      sessionPaint: showSessionBands ? 'full' : 'range',
    })
    paintSessionHighlightOverlay(host, rects, {
      keepPreviousIfEmpty: true,
      paintKey: showSessionBands ? 'full' : 'range',
    })

    const book = bookBandRef.current
    const bandHost = positionBandOverlayRef.current
    if (!book) {
      paintPositionBandOverlay(bandHost, [])
    } else {
      const chartH = containerRef.current.clientHeight
      const yEntry = series.priceToCoordinate(book.entry)
      const yStop = series.priceToCoordinate(book.stop)
      const yTp = series.priceToCoordinate(book.target)
      const bands: Array<{
        top: number
        height: number
        color: string
        border: string
        title: string
      }> = []
      const pushBand = (
        a: number | null,
        b: number | null,
        color: string,
        border: string,
        title: string
      ) => {
        if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return
        const top = Math.max(Math.min(a, b), 0)
        const bottom = Math.min(Math.max(a, b), chartH)
        const height = bottom - top
        if (height < 2) return
        bands.push({ top, height, color, border, title })
      }
      pushBand(yEntry, yTp, 'rgba(22, 163, 74, 0.28)', '#15803d', 'Position TP zone')
      pushBand(yEntry, yStop, 'rgba(220, 38, 38, 0.28)', '#b91c1c', 'Position SL zone')
      paintPositionBandOverlay(bandHost, bands, { keepPreviousIfEmpty: true })
    }
  }, [instrument, showSessionBands])

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
    try {
      const ts = chart.timeScale()
      ts.applyOptions({
        barSpacing: deskBarSpacing(width, list.length),
        rightOffset: DESK_CHART_THEME.timeScale.rightOffset,
      })
      ts.setVisibleLogicalRange(deskVisibleLogicalRange(list.length, width))
      saveDeskViewport(instrumentRef.current, deskVisibleLogicalRange(list.length, width), list.length)
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => refreshSessionHighlights())
  }, [refreshSessionHighlights])

  useEffect(() => {
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
              saveDeskViewport(instrumentRef.current, range, list.length)
            }
          } catch {
            /* ignore */
          }
        }
      }, 180)
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

    // Track pan/zoom: repaint bands every frame so colors stay locked to the candles.
    const onRangeChange = () => {
      interactingRef.current = true
      paintNow()
      if (!pointerDown) scheduleSettle()
    }

    paintNow()
    const t1 = window.setTimeout(paintNow, 80)
    const ts = chartRef.current.timeScale()
    ts.subscribeVisibleLogicalRangeChange(onRangeChange)
    el?.addEventListener('pointerdown', beginInteract)
    // window: drag can end outside the chart (pointerleave used to false-settle mid-pan)
    window.addEventListener('pointerup', endInteract)
    window.addEventListener('pointercancel', endInteract)
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
  }, [chartReady, refreshSessionHighlights])

  // ── Draw level lines ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartReady) return
    paintLevelLines()
  }, [levels, showLevels, callBadge, chartReady, paintLevelLines])

  // Arm live quote/candle stream once bars exist (do not restart on every new print)
  useEffect(() => {
    if (candles.length > 0) setStreamArmed(true)
  }, [candles.length])

  // ── Chart tip stream: only in focus window (−30m→close); afternoon if attended ─
  useEffect(() => {
    if (!chartReady || !streamArmed || dataMode === 'synthetic') return
    if (!tipStreamActive) return

    const CANDLE_REFRESH_MS = 15_000
    let lastTickPublishAt = 0
    let lastPriceStateAt = 0
    let lastMarkerPaintAt = 0
    let tipPaintRaf = 0
    const fetchGen = ++candleFetchGenRef.current
    let sseHealthy = false

    /** Parent encodes focus + afternoon attendance; re-check chart stream for clock edge */
    const tipOpen = () =>
      tipStreamActive && isChartStreamAllowed(instrument).open

    const toChartCandle = (bar: OHLCV) => ({
      time: toChartTime(bar.time as number, chartTzRef.current) as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    })

    const paintTipBar = (bar: OHLCV) => {
      lastCandleRef.current = bar
      if (tipPaintRaf) return
      tipPaintRaf = requestAnimationFrame(() => {
        tipPaintRaf = 0
        const b = lastCandleRef.current
        if (!b || !candleRef.current) return
        try {
          candleRef.current.update(toChartCandle(b))
          if (!interactingRef.current) pokeOverlayLayoutRef.current()
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
      let next = bars
      for (const g of fills) {
        try {
          candleRef.current?.update(toChartCandle(g))
        } catch {
          /* ignore */
        }
        next = [...next, g]
      }
      const last = next[next.length - 1]!
      next =
        (last.time as number) === (bar.time as number)
          ? [...next.slice(0, -1), { ...last, ...bar, volume: last.volume || bar.volume }]
          : [...next, bar]
      candlesRef.current = next
      paintTipBar(bar)
      if (fills.length > 0) {
        const now = Date.now()
        if (now - lastMarkerPaintAt >= 1000) {
          lastMarkerPaintAt = now
          paintDeskMarkersRef.current(next)
        }
      }
    }

    const applyQuote = (
      price: number,
      changePct: number,
      quoteTs: number,
      streamLive: boolean
    ) => {
      // Guard only true bad ticks / wrong-scale bleed (e.g. leftover tip).
      // 0.35% was too tight for index opens/gaps and froze the tip vs TradingView.
      const tip = lastCandleRef.current
      if (
        tip &&
        tip.close > 0 &&
        Math.abs(price - tip.close) / tip.close > 0.015
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

      const tfSec = DESK_BAR_SECONDS
      const bucketTs = quoteUnixForBucket(quoteTs)
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
        tfSec
      )
      const fills: OHLCV[] = stepped.gapFills.map((g) => ({
        time: g.time as UTCTimestamp,
        open: g.open,
        high: g.high,
        low: g.low,
        close: g.close,
        volume: g.volume ?? 0,
      }))
      const bar: OHLCV = {
        time: stepped.last.time as UTCTimestamp,
        open: stepped.last.open,
        high: stepped.last.high,
        low: stepped.last.low,
        close: stepped.last.close,
        volume: stepped.last.volume ?? last.volume ?? 0,
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
          applyQuote(json.price, json.change_pct ?? 0, ts, streamLive)
        }
      } catch {
        /* keep */
      } finally {
        quoteInFlightRef.current = false
      }
    }

    const refreshCandles = async () => {
      if (!tipOpen()) return
      try {
        const days = AVWAP_CANDLE_FETCH_CALENDAR_DAYS
        const res = await fetch(
          `/api/trading/candles?instrument=${instrument}&timeframe=${DESK_TIMEFRAME}&days=${days}&quote=0&_=${Date.now()}`,
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
        const trimmed = normalizeCandleTimes(toDeskCandles(mapped, instrument))
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
            : null
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

        // Never reset didFitRef here — new prints must not yank a panned viewport
        lastCandleRef.current = nextBars[nextBars.length - 1]!
        // REST owns closed bars: replace gap-fill flats when Yahoo catches up
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
        }
        setDataMode('live')
        if (json.source === 'yahoo' || json.source === 'oanda') {
          setCandleFeed(json.source)
        }
      } catch {
        /* ignore */
      }
    }

    void pollQuote()
    void refreshCandles()
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
    if (candleRefreshRef.current) clearInterval(candleRefreshRef.current)
    candleRefreshRef.current = setInterval(refreshCandles, CANDLE_REFRESH_MS)

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
          const streamLive = tipOpen()
          const ts =
            typeof json.timestamp === 'number' && json.timestamp > 0
              ? json.timestamp
              : Math.floor(Date.now() / 1000)
          applyQuote(json.price, json.change_pct ?? 0, ts, streamLive)
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

    // Backup REST poll — frequent only when SSE is unhealthy
    tickIntervalRef.current = setInterval(() => {
      if (!tipOpen()) return
      if (sseHealthy) return
      void pollQuote()
    }, 500)
    // Safety reconcile even when SSE is healthy (drift / missed reconnect) —
    // stretched to 20s while push ticks arrive, still 4s once SSE goes quiet.
    let lastReconcileAt = Date.now()
    const reconcile = setInterval(() => {
      if (!tipOpen()) return
      const now = Date.now()
      if (sseHealthy && now - lastReconcileAt < RECONCILE_HEALTHY_MS) return
      lastReconcileAt = now
      void pollQuote()
    }, 4_000)

    return () => {
      candleFetchGenRef.current += 1
      if (tipPaintRaf) cancelAnimationFrame(tipPaintRaf)
      tipPaintRaf = 0
      clearInterval(reconcile)
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
    streamArmed,
    dataMode,
    tipStreamActive,
    onQuoteTick,
    onPriceUpdate,
    publishPriceTick,
  ])

  // ── Double-click chart to drop TradingView Risk Box at clicked price ───────
  useEffect(() => {
    const container = containerRef.current
    if (!container || !candleRef.current || !chartReady) return
    if (positionOverlay || pendingLimit) return

    const placeAtClientY = (clientY: number) => {
      if (!candleRef.current) return
      const price = priceFromClientY(container, candleRef.current, clientY)
      if (price == null) return
      openRiskBox(price)
    }

    const onDblClick = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      placeAtClientY(e.clientY)
    }

    container.addEventListener('dblclick', onDblClick, true)
    const canvases = Array.from(container.querySelectorAll('canvas'))
    for (const c of canvases) {
      c.addEventListener('dblclick', onDblClick, true)
    }
    return () => {
      container.removeEventListener('dblclick', onDblClick, true)
      for (const c of canvases) {
        c.removeEventListener('dblclick', onDblClick, true)
      }
    }
  }, [chartReady, positionOverlay, pendingLimit, openRiskBox])

  // ── Click painted ±10 entry band → open limit ticket at that edge ─────────
  useEffect(() => {
    const container = containerRef.current
    if (!container || !candleRef.current || !chartReady) return
    if (positionOverlay || pendingLimit) return
    if (drawZoneActive || drawTimeActive || riskBox) return

    let down: { x: number; y: number } | null = null

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      down = { x: e.clientX, y: e.clientY }
    }

    const onUp = (e: MouseEvent) => {
      if (!down || e.button !== 0 || !candleRef.current) {
        down = null
        return
      }
      const dx = Math.abs(e.clientX - down.x)
      const dy = Math.abs(e.clientY - down.y)
      down = null
      // Ignore pans / drags
      if (dx > 6 || dy > 6) return

      const price = priceFromClientY(container, candleRef.current, e.clientY)
      if (price == null) return

      const { strategyRange, snapRanges, ladder } = getStrategyRiskBundle()
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
      const snapArgs = {
        entry: price,
        candidates: snapRanges,
        preferLabel: strategyRange?.label ?? null,
        liveOk,
      }
      let hit = attributePlaybookBandEntry(snapArgs)
      if (!hit) {
        // Right-scale H/L tags sit on the price axis — Y can miss the ±10
        // band by a few points. Snap that click onto the nearest live H/L.
        if (clickIsOnPriceScale(container, e.clientX)) {
          const nearest = snapEntryToNearestOpenBandCenter(snapArgs)
          hit = nearest?.hit ?? null
        }
      }
      if (!hit) return

      const label = hit.range.label || 'range'
      // OR30 has no independent afternoon bucket — it only trades inside its
      // own locked morning window, gated upstream (chart hides it once that
      // window closes; treat any hit here as preview-only).
      let denyBody: string | null = null
      if (label === 'OR30') {
        const or30Live =
          !!strategyRange &&
          strategyRange.label === hit.range.label &&
          strategyRange.high === hit.range.high &&
          strategyRange.low === hit.range.low
        if (!or30Live) {
          denyBody =
            instrument === 'NIKKEI'
              ? 'Open-range ±10 window is closed — enter on the live US Range / Tokyo IB playbook when unlocked.'
              : 'Open-range / OR30 ±10 window is closed — enter on the live next-range playbook when unlocked.'
        }
      } else {
        const bucketCheck = assertBucketEntryEligible({
          instrument,
          market: deskMarketFor(instrument),
          timeSec: deskClockSeconds(instrument),
          ladder,
          rangeLabel: hit.range.label,
        })
        if (!bucketCheck.ok) denyBody = bucketCheck.message
      }

      if (denyBody) {
        onDeskAlert?.({
          kind: 'entry_band_deny',
          title: `${label} entry closed`,
          body: denyBody,
          telegram: '',
          instrument,
        })
        return
      }

      e.preventDefault()
      e.stopPropagation()
      openRiskBox(hit.center, {
        lockHit: {
          center: hit.center,
          edge: hit.edge,
          range: hit.range,
        },
      })
    }

    container.addEventListener('mousedown', onDown, true)
    container.addEventListener('mouseup', onUp, true)
    const canvases = Array.from(container.querySelectorAll('canvas'))
    for (const c of canvases) {
      c.addEventListener('mousedown', onDown, true)
      c.addEventListener('mouseup', onUp, true)
    }
    return () => {
      container.removeEventListener('mousedown', onDown, true)
      container.removeEventListener('mouseup', onUp, true)
      for (const c of canvases) {
        c.removeEventListener('mousedown', onDown, true)
        c.removeEventListener('mouseup', onUp, true)
      }
    }
  }, [
    chartReady,
    positionOverlay,
    pendingLimit,
    drawZoneActive,
    drawTimeActive,
    riskBox,
    getStrategyRiskBundle,
    openRiskBox,
    onDeskAlert,
    instrument,
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    stopHits,
  ])

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

  // Lock chart scrolling & scaling during active drawing to prevent chart jumping
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const drawing = drawTimeActive || drawZoneActive

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
      }
    })
  }, [drawTimeActive, drawZoneActive])

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
          liveOk: (range) => liveOkForSnap(range, strategyRange, ladder),
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

    const { strategyMagnets, snapRanges, strategyRange, ladder, call } = getStrategyRiskBundle()
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
    const gated = assertDeskTicketEntry({
      useCall: useCallRef.current,
      call,
      edge: hit.edge,
      direction,
    })
    if (!gated.ok) {
      onDeskAlert?.({
        kind: 'entry_band_deny',
        title: 'CALL blocks this ticket',
        body: gated.message,
        telegram: '',
        instrument,
      })
      return
    }
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
    const call = deskCallRef.current ?? getStrategyRiskBundle().call
    const gated = assertDeskTicketEntry({
      useCall: useCallRef.current,
      call,
      direction: newDir,
    })
    if (!gated.ok) {
      onDeskAlert?.({
        kind: 'entry_band_deny',
        title: 'CALL side is locked',
        body: gated.message,
        telegram: '',
        instrument,
      })
      return
    }
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
      } else if (key === 'v') {
        if (SYSTEMATIC_LIVE_DESK) return
        e.preventDefault()
        setVoiceOpen((prev) => !prev)
      } else if (key === 'l') {
        if (SYSTEMATIC_LIVE_DESK) return
        e.preventDefault()
        setShowLevels((prev) => !prev)
      } else if (key === 'b') {
        e.preventDefault()
        setShowIbBreakouts((prev) => !prev)
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
        if (!SYSTEMATIC_LIVE_DESK && instrument === 'NIKKEI') {
          setShowUsRange((prev) => !prev)
        }
      } else if (key === 'r') {
        e.preventDefault()
        if (isOr30Instrument(instrument)) {
          setShowOr30((prev) => !prev)
        }
      } else if (key === 'p') {
        if (SYSTEMATIC_LIVE_DESK) return
        e.preventDefault()
        togglePlaybook()
      } else if (key === 'd') {
        if (SYSTEMATIC_LIVE_DESK) return
        e.preventDefault()
        setDrawZoneActive((prev) => {
          if (prev) {
            cancelDrawnZone()
            return false
          } else {
            setDrawnZone(null)
            clearDrawnZoneLines()
            return true
          }
        })
      } else if (key === 't') {
        if (SYSTEMATIC_LIVE_DESK) return
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
      } else if (key === 'o') {
        e.preventDefault()
        if (riskBoxActive && riskBox) {
          cancelRiskBox()
        } else {
          openRiskBox()
        }
      } else if (key === 'a') {
        e.preventDefault()
        togglePriceAlert()
      } else if (key === 'escape') {
        if (riskBoxActive || riskBox) {
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
        pokeOverlayLayoutRef.current()
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('fullscreenchange', onFsChange)
    }
  }, [isFullscreen, drawZoneActive, drawnZone, drawTimeActive, drawnTime, toggleFullscreen, cancelDrawnZone, clearDrawnZoneLines, cancelDrawnTime, instrument, riskBoxActive, riskBox, cancelRiskBox, openRiskBox, priceAlert, dismissPriceAlert, togglePriceAlert])

  // ── Hover visible AI/structure level → preview entry / SL / TP ─
  // Morning: place preview. Afternoon: same geometry, watch-only (canPlaceOrder false).
  useEffect(() => {
    const container = containerRef.current
    const host = priceLineHostRef.current
    if (
      !container ||
      !candleRef.current ||
      !host ||
      !chartReady ||
      positionOverlay ||
      pendingLimit ||
      !showLevels
    ) {
      clearHoverPreview()
      return
    }

    const fmt = (n: number) =>
      n.toLocaleString('en-US', { maximumFractionDigits: 0 })

    const onMove = (e: MouseEvent) => {
      if (!candleRef.current || !priceLineHostRef.current) return
      const raw = priceFromClientY(container, candleRef.current, e.clientY)
      if (raw == null) {
        clearHoverPreview()
        return
      }

      const { strategyRange, strategyMagnets } = getStrategyRiskBundle()
      const pick = resolveChartLimitPick({
        rawPrice: Number(raw),
        levels: levelsRef.current.map((l) => ({
          price: l.price,
          type: l.type,
          side: l.side,
          label: l.label,
          source: l.source,
          reasoning: l.reasoning,
        })),
        levelsVisible: true,
        activeRange: strategyRange,
      })
      if (pick.source === 'manual' || !pick.matched) {
        clearHoverPreview()
        return
      }

      const preview = previewLevelOrderPrices({
        level: pick.matched,
        instrument,
        activeRange: strategyRange,
        magnets: strategyMagnets,
      })
      if (!preview) {
        clearHoverPreview()
        return
      }

      const key = `${preview.direction}:${preview.entry}:${preview.stop}:${preview.target}`
      if (hoverPreviewKeyRef.current === key) return
      clearHoverPreview()
      hoverPreviewKeyRef.current = key
      const h = priceLineHostRef.current
      if (!h) return

      // Color alone = side (blue buy / rose short) — no written HOVER LONG/SHORT
      const entryColor =
        preview.direction === 'SHORT'
          ? 'rgba(251, 113, 133, 0.9)'
          : 'rgba(56, 189, 248, 0.85)'

      const specs = [
        {
          price: preview.entry,
          color: entryColor,
          title: fmt(preview.entry),
          style: LineStyle.Dashed,
        },
        {
          price: preview.stop,
          color: 'rgba(239, 68, 68, 0.75)',
          title: `SL ${fmt(preview.stop)}`,
          style: LineStyle.Dotted,
        },
        {
          price: preview.target,
          color: 'rgba(34, 197, 94, 0.75)',
          title: `TP ${fmt(preview.target)}`,
          style: LineStyle.Dotted,
        },
      ] as const

      for (const s of specs) {
        try {
          hoverPreviewLinesRef.current.push(
            h.createPriceLine({
              price: s.price,
              color: s.color,
              lineStyle: s.style,
              lineWidth: 1,
              axisLabelVisible: true,
              title: s.title,
            })
          )
        } catch {
          /* ignore */
        }
      }
    }

    const onLeave = () => clearHoverPreview()

    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    return () => {
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
      clearHoverPreview()
    }
  }, [
    canPlaceOrder,
    chartReady,
    positionOverlay,
    pendingLimit,
    showLevels,
    instrument,
    clearHoverPreview,
    getStrategyRiskBundle,
  ])

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
      const v = (aiVerdict?.verdict || '').toLowerCase()
      const aiWantsTp = v === 'reversal' || v === 'take_profit' || v === 'pullback'
      const tpLabel =
        v === 'reversal'
          ? 'AI EXIT · Target'
          : v === 'pullback'
            ? 'AI PULLBACK · Target'
            : v === 'hold'
              ? 'AI HOLD · Target'
              : 'Target'
      const tpColor = aiWantsTp && v === 'reversal' ? '#a78bfa' : '#22c55e'
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
      asiaOco &&
      (asiaOco.event === 'place_both' ||
        asiaOco.event === 'cancel_unfilled' ||
        asiaOco.event === 'flatten')
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
  }, [positionOverlay, editableOverlay, pendingLimit, editablePending, filledBook, workingBook, aiVerdict, chartReady, clearHoverPreview, onAdjustBrackets, onAdjustWorkingBrackets, asiaOco])

  /** Levels / playbook — strategy-aware titles (morning → IB → lunch break → lunch-range) */
  const tokyoDesk = instrument === 'NIKKEI'
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
    const host = priceLineHostRef.current
    const clearBands = () => {
      if (host) {
        for (const line of entryBandLinesRef.current) {
          try {
            host.removePriceLine(line)
          } catch {
            /* ignore */
          }
        }
      }
      entryBandLinesRef.current = []
      setEntryBandsVisible(false)
      setEntryBandLabel(null)
    }
    const markPainted = (key: string) => {
      entryBandPaintKeyRef.current = key
      entryBandPaintHostRef.current = host
    }

    if (!chartReady || !host) {
      if (entryBandPaintKeyRef.current !== null) {
        entryBandPaintKeyRef.current = null
        entryBandPaintHostRef.current = null
        clearBands()
      }
      return
    }

    const swing = ibExtendRef.current?.swing ?? null
    const activeRaw = activeRangeForPlaybook({
      playbookMode,
      instrument,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      or15: or15RangeRef.current,
      morningAttempts,
    })
    const active = activeRaw ? applyIbLiquiditySwingToRange(activeRaw, swing) : null
    const overlays = applyIbLiquiditySwingToRanges(
      entryEligibleOverlayRanges({
        playbookMode,
        instrument,
        showOr30,
        // IB H/L + ±10 follow the IB BRK/REJ toolbar toggle (remembered across refresh).
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
    // Right-scale ±10 tags follow the study toggles (R / B / N / U) — not the
    // active playbook. Snap/place still uses studyEntrySnapRanges + active.
    const chart = chartRef.current
    const call = deskCallRef.current
    const mode = useCallRef.current
    const allowed = ticketAllowedEdges({ useCall: mode, call })
    const setupEdges = mode === false ? deskCallSetupEdges(call) : []

    // Every painted tag (price, title, color) and the legend are a pure function
    // of these — identical key means the existing lines are already correct.
    const paintKey = [
      canPlaceOrder ? 'p1' : 'p0',
      mode == null ? 'mn' : mode ? 'm1' : 'm0',
      allowed == null ? '*' : allowed.join('+'),
      setupEdges.join('+'),
      active ? `${active.label ?? ''}|${active.high}|${active.low}` : '-',
      overlays.map((o) => `${o.label ?? ''}|${o.high}|${o.low}`).join(';'),
    ].join('~')
    if (entryBandPaintHostRef.current === host && entryBandPaintKeyRef.current === paintKey) {
      return
    }

    const savedSpacing = readDeskBarSpacing(chart)
    if (overlays.length === 0 || mode == null) {
      clearBands()
      markPainted(paintKey)
      keepDeskBarSpacing(chart, savedSpacing)
      return
    }
    if (allowed != null && allowed.length === 0) {
      clearBands()
      markPainted(paintKey)
      keepDeskBarSpacing(chart, savedSpacing)
      return
    }

    clearBands()
    markPainted(paintKey)

    const palette: Record<
      string,
      { high: string; low: string; highDim: string; lowDim: string }
    > = {
      OR30: {
        high: 'rgba(45, 212, 191, 0.95)',
        low: 'rgba(52, 211, 153, 0.95)',
        highDim: 'rgba(45, 212, 191, 0.4)',
        lowDim: 'rgba(52, 211, 153, 0.4)',
      },
      IB: {
        high: 'rgba(56, 189, 248, 0.95)',
        low: 'rgba(96, 165, 250, 0.95)',
        highDim: 'rgba(56, 189, 248, 0.4)',
        lowDim: 'rgba(96, 165, 250, 0.4)',
      },
      'Tokyo IB': {
        high: 'rgba(56, 189, 248, 0.95)',
        low: 'rgba(96, 165, 250, 0.95)',
        highDim: 'rgba(56, 189, 248, 0.4)',
        lowDim: 'rgba(96, 165, 250, 0.4)',
      },
      'US Range': {
        high: 'rgba(248, 113, 113, 0.95)',
        low: 'rgba(251, 146, 60, 0.95)',
        highDim: 'rgba(248, 113, 113, 0.4)',
        lowDim: 'rgba(251, 146, 60, 0.4)',
      },
      OR15: {
        high: 'rgba(245, 158, 11, 0.95)',
        low: 'rgba(251, 191, 36, 0.95)',
        highDim: 'rgba(245, 158, 11, 0.4)',
        lowDim: 'rgba(251, 191, 36, 0.4)',
      },
    }
    const fallback = {
      high: 'rgba(56, 189, 248, 0.95)',
      low: 'rgba(52, 211, 153, 0.95)',
      highDim: 'rgba(56, 189, 248, 0.4)',
      lowDim: 'rgba(52, 211, 153, 0.4)',
    }

    let anyLive = false
    for (const strategyRange of overlays) {
      const bands = filterRangeEdgeBands(rangeEdgeBands(strategyRange), allowed)
      if (bands.length === 0) continue
      const label = strategyRange.label || 'range'
      const entryLive =
        !!canPlaceOrder &&
        !!active &&
        active.label === label &&
        active.high === strategyRange.high &&
        active.low === strategyRange.low
      if (entryLive) anyLive = true
      const colors = palette[label] ?? fallback
      const setupHigh = setupEdges.includes('high')
      const setupLow = setupEdges.includes('low')
      const setupMid = setupEdges.includes('mid')
      const highColor =
        mode === false
          ? setupEdges.length === 0
            ? entryLive
              ? colors.high
              : colors.highDim
            : setupHigh
              ? colors.high
              : colors.highDim
          : entryLive
            ? colors.high
            : colors.highDim
      const lowColor =
        mode === false
          ? setupEdges.length === 0
            ? entryLive
              ? colors.low
              : colors.lowDim
            : setupLow
              ? colors.low
              : colors.lowDim
          : entryLive
            ? colors.low
            : colors.lowDim
      const midColor =
        mode === false
          ? setupEdges.length === 0
            ? entryLive
              ? 'rgba(168, 85, 247, 0.95)'
              : 'rgba(168, 85, 247, 0.4)'
            : setupMid
              ? 'rgba(168, 85, 247, 0.95)'
              : 'rgba(168, 85, 247, 0.4)'
          : entryLive
            ? 'rgba(168, 85, 247, 0.95)'
            : 'rgba(168, 85, 247, 0.4)'
      const highBand = bands.find((b) => b.edge === 'high')
      const midBand = bands.find((b) => b.edge === 'mid')
      const lowBand = bands.find((b) => b.edge === 'low')
      const specs: Array<{ price: number; color: string; title: string }> = []
      if (highBand) {
        specs.push({
          price: strategyRange.high,
          color: highColor,
          title: `${label} H`,
        })
      }
      if (midBand) {
        specs.push({
          price: (strategyRange.high + strategyRange.low) / 2,
          color: midColor,
          title: `${label} 50%`,
        })
      }
      if (lowBand) {
        specs.push({
          price: strategyRange.low,
          color: lowColor,
          title: `${label} L`,
        })
      }
      for (const s of specs) {
        try {
          entryBandLinesRef.current.push(
            host.createPriceLine({
              price: s.price,
              // Transparent stroke — only the right-scale tag should show (IB included).
              color: 'rgba(0,0,0,0)',
              axisLabelColor: s.color,
              axisLabelTextColor: '#f8fafc',
              lineWidth: 1,
              lineStyle: LineStyle.SparseDotted,
              axisLabelVisible: true,
              lineVisible: false,
              title: s.title,
            })
          )
        } catch {
          /* ignore */
        }
      }
    }

    setEntryBandsVisible(entryBandLinesRef.current.length > 0)
    const legendParts = overlays.map((o) => {
      const name = o.label || 'range'
      return `${name} ${rangeEdgeBandLegend(o)}`
    })
    const legendList = legendParts.join(' · ')
    const callTag = mode === false ? 'setup' : 'CALL'
    setEntryBandLabel(
      anyLive
        ? `±${RANGE_EDGE_BAND_POINTS} ${callTag} ${legendList} entry zones`
        : `±${RANGE_EDGE_BAND_POINTS} ${callTag} ${legendList} (shaped — entry window closed or inactive)`
    )
    keepDeskBarSpacing(chart, savedSpacing)
  }, [
    chartReady,
    canPlaceOrder,
    playbookMode,
    instrument,
    rangeStrategy,
    morningAttempts,
    or30Locked,
    ibShaped,
    ibLevels,
    or15Locked,
    usRangeShaped,
    showOr30,
    showIbBreakouts,
    showUsRange,
    showOr15,
    candles,
    focusTick,
    callBadge,
    ibExtendBadge,
    resolvedUseCall,
  ])

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

    if (
      SYSTEMATIC_LIVE_DESK &&
      nowSetup &&
      canPlaceOrder &&
      !positionOverlay &&
      !pendingLimit &&
      !riskBox &&
      onLevelSelect &&
      call &&
      call.side !== 'WAIT' &&
      call.entryPrice != null &&
      call.entryEdge &&
      isDeskInstrument(instrument) &&
      claimDeskNoteOnce(
        `auto_place_${call.side}_${call.rangeKey}_${attemptsUsed}`,
        instrument
      )
    ) {
      const { strategyRange, strategyMagnets } = getStrategyRiskBundleRef.current()
      const entry = snapDeskPrice(instrument, call.entryPrice)
      const gated = assertDeskTicketEntry({
        useCall: true,
        call,
        edge: call.entryEdge,
        direction: call.side,
      })
      if (gated.ok) {
        const strat = strategyEntryRisk({
          entry,
          direction: gated.side,
          activeRange: strategyRange,
          magnets: strategyMagnets,
        })
        onLevelSelect(entry, {
          source: 'structure',
          type: 'structure',
          orderType: 'LIMIT',
          side: gated.side === 'LONG' ? 'BUY' : 'SHORT',
          preferredDirection: gated.side,
          reasoning: `SYSTEM CALL ${gated.side} ${call.rangeKey} legal ±10. Ticket: SL beyond range, TP 1.5R.`,
          stopLoss: snapDeskPrice(instrument, strat.stop),
          profitTarget: snapDeskPrice(instrument, strat.target),
          strategyRange,
          strategyMagnets,
        })
      }
    }

    wasCallSetupRef.current = nowSetup
  }, [
    edgeProximity,
    livePrice,
    instrument,
    onDeskAlert,
    onLevelSelect,
    canPlaceOrder,
    positionOverlay,
    pendingLimit,
    riskBox,
    attemptsUsed,
  ])

  const lastAuctionEvalRef = useRef('')
  const auctionSigRef = useRef<ReturnType<typeof evaluateAuctionLiveSignal>>(null)
  useEffect(() => {
    if (!SYSTEMATIC_LIVE_DESK) return
    if (!isDeskInstrument(instrument) || instrument === 'NASDAQ') return
    const nowUnix = Math.floor(Date.now() / 1000)
    const bars = candlesRef.current
    let lastClosed: (typeof bars)[number] | null = null
    for (const c of bars) {
      if (Number(c.time) + 300 <= nowUnix) lastClosed = c
    }
    if (!lastClosed) return
    const lastClosedTime = Number(lastClosed.time)
    const evalKey = `${instrument}:${lastClosedTime}:${lastClosed.close}:${lastClosed.volume}`
    if (lastAuctionEvalRef.current !== evalKey) {
      lastAuctionEvalRef.current = evalKey
      auctionSigRef.current = evaluateAuctionLiveSignal({
        instrument,
        candles: bars.map((c) => ({
          time: Number(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
        nowUnix,
      })
    }
    const sig = auctionSigRef.current
    if (!sig) return

    const setupClaim = `auction_setup_${sig.side}_${sig.fillUnix}`
    if (onDeskAlert && claimDeskNoteOnce(setupClaim, instrument)) {
      onDeskAlert({
        kind: AUCTION_TELEGRAM_KIND,
        title: `SETUP ${instrument} · AUCTION ${sig.side}`,
        body: sig.note,
        telegram: sig.telegram,
        instrument,
        dedupeKey: deskNoteClaimKey(setupClaim, instrument),
      })
    }

    if (
      canPlaceOrder &&
      !positionOverlay &&
      !pendingLimit &&
      !riskBox &&
      onLevelSelect &&
      claimDeskNoteOnce(`auto_place_auction_${sig.side}_${sig.fillUnix}`, instrument)
    ) {
      onLevelSelect(snapDeskPrice(instrument, sig.entry), {
        source: 'structure',
        type: 'auction',
        orderType: 'LIMIT',
        side: sig.side === 'LONG' ? 'BUY' : 'SHORT',
        preferredDirection: sig.side,
        reasoning: sig.note,
        stopLoss: snapDeskPrice(instrument, sig.stop),
        profitTarget: snapDeskPrice(instrument, sig.target),
        strategyRange: {
          label: sig.rangeLabel,
          high: sig.entry,
          low: sig.entry,
        },
      })
    }
  }, [
    candles,
    livePrice,
    instrument,
    onDeskAlert,
    onLevelSelect,
    canPlaceOrder,
    positionOverlay,
    pendingLimit,
    riskBox,
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
      us: usRangeShaped && instrument === 'NIKKEI',
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
        const label = instrument === 'NIKKEI' ? 'Tokyo IB' : 'IB'
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
          nextHint:
            instrument === 'NIKKEI'
              ? `Tokyo IB shaped — ±10 entries are open now (${deskLocalHmsAsTraderDisplay('10:00:00', 'Asia/Tokyo')}–${deskLocalHmsAsTraderDisplay('15:00:00', 'Asia/Tokyo')} ${TRADER_DISPLAY_LABEL}). US Range may still run until ${deskLocalHmsAsTraderDisplay('10:45:00', 'Asia/Tokyo')} ${TRADER_DISPLAY_LABEL}.`
              : 'IB entry window is open (±10 of locked H / L).',
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
  const playbookButtonLabel = deskPlaybookToolbarLabel(playbookMode, {
    watchOnly: afternoonWatch,
  })
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
      className={`flex flex-col gap-2 ${isFullscreen
        ? 'fixed inset-0 z-[100] bg-[#0d1117] p-3 h-screen w-screen'
        : 'h-full w-full'
        }`}
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
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

        <span className="rounded-lg border border-surface-600 px-2.5 py-1.5 text-xs font-semibold text-gray-400">
          5m
        </span>



        {/* IB H/L + BRK/REJ + ±10 (Press B) — remembered across refresh */}
        {deskSessionLive && (
          <button
            type="button"
            title={
              showIbBreakouts
                ? 'IB H/L + BRK/REJ markers + ±10 bands on. BRK needs close beyond H/L + RVOL when volume exists; REJ = wick reject (Press B).'
                : 'Show IB high/low, break/reject markers, and ±10 bands (Press B)'
            }
            onClick={() => setShowIbBreakouts((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${showIbBreakouts
              ? 'bg-blue-600/30 border-blue-500/50 text-blue-100'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-blue-200 hover:border-blue-500/40'
              }`}
          >
            <span className={`w-2 h-2 rounded-full inline-block ${showIbBreakouts ? 'bg-blue-400' : 'bg-gray-600'}`} />
            <span>IB BRK/REJ (B)</span>
            {ibShaped && (
              <span className="text-[10px] font-normal text-blue-300/80">
                {rangeSignalSummary.ib > 0 ? `${rangeSignalSummary.ib}` : '0'}
              </span>
            )}
          </button>
        )}

        {deskSessionLive && (
          <button
            type="button"
            title={
              showYesterdayProfile
                ? 'Yesterday YH/YL/VA/POC + day type + superimposed range on (Press Y)'
                : 'Show yesterday cash profile: YH/YL/VAH/VAL/POC and open type (Press Y)'
            }
            onClick={() => setShowYesterdayProfile((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${showYesterdayProfile
              ? 'bg-amber-600/30 border-amber-500/50 text-amber-100'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-amber-200 hover:border-amber-500/40'
              }`}
          >
            <span className={`w-2 h-2 rounded-full inline-block ${showYesterdayProfile ? 'bg-amber-400' : 'bg-gray-600'}`} />
            <span>Yday (Y)</span>
            {showYesterdayProfile && (
              <span className="text-[10px] font-normal text-amber-200/80">{yesterdayBadge}</span>
            )}
          </button>
        )}

        {deskSessionLive && (
          <button
            type="button"
            title={
              showSessionBands
                ? 'Full session columns + range boxes on (Press H). Click for the quieter high→low boxes.'
                : 'Show full Asia / London / NY columns and range boxes like the session map (Press H)'
            }
            onClick={() => setShowSessionBands((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${showSessionBands
              ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-100'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-emerald-200 hover:border-emerald-500/40'
              }`}
          >
            <span className={`w-2 h-2 rounded-full inline-block ${showSessionBands ? 'bg-emerald-400' : 'bg-gray-600'}`} />
            <span>Sessions (H)</span>
          </button>
        )}

        {deskSessionLive && (
          <button
            type="button"
            title={
              showOpeningActivity
                ? 'Dalton opening type lines on — open + first 5m H/L. Click to hide lines (type still updates).'
                : 'Show Dalton opening type: Drive / Test-Drive / Rejection-Reverse / Auction. Click for open + first-bar H/L.'
            }
            onClick={() => setShowOpeningActivity((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${showOpeningActivity
              ? 'bg-cyan-600/30 border-cyan-500/50 text-cyan-100'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-cyan-200 hover:border-cyan-500/40'
              }`}
          >
            <span className={`w-2 h-2 rounded-full inline-block ${showOpeningActivity ? 'bg-cyan-400' : 'bg-gray-600'}`} />
            <span>Open</span>
            <span className="text-[10px] font-normal text-cyan-200/80">{openingBadge}</span>
          </button>
        )}

        {deskSessionLive && (
          <button
            type="button"
            title={
              showMarketControl
                ? 'Dalton control dPOC line on. Click to hide the line (RF type still updates). ↑ / ↓ = ONE-TF. 2TF = RF without matching dPOC.'
                : 'Show Dalton control: Rotation Factor + developing POC. ↑ / ↓ = ONE-TF BUY/SELL. 2TF is not a CALL. Click for the dPOC line.'
            }
            onClick={() => setShowMarketControl((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${showMarketControl
              ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-100'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-indigo-200 hover:border-indigo-500/40'
              }`}
          >
            <span className={`w-2 h-2 rounded-full inline-block ${showMarketControl ? 'bg-indigo-400' : 'bg-gray-600'}`} />
            <span>Ctrl</span>
            <span className="text-[10px] font-normal text-indigo-200/80">{controlBadge}</span>
          </button>
        )}

        {deskSessionLive && (
          <span
            title={callHover}
            className="group relative flex cursor-help items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border rounded-lg bg-transparent border-zinc-500/40 text-zinc-400"
          >
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: CALL_COLORS.badge }}
            />
            <span>Call</span>
            <span className="text-[10px] font-normal text-zinc-400/80">{callBadge}</span>
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-[22rem] whitespace-pre-wrap rounded-lg border border-zinc-500/40 bg-[#0d1117] px-2.5 py-2 text-left text-[10px] font-normal normal-case leading-snug tracking-normal text-zinc-200 shadow-xl group-hover:visible"
            >
              {callHover}
            </span>
          </span>
        )}

        {deskSessionLive && (
          <span
            title={perfHover}
            className="group relative flex cursor-help items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border rounded-lg bg-transparent border-zinc-500/40 text-zinc-400"
          >
            <span className="w-2 h-2 rounded-full inline-block bg-zinc-500" />
            <span>Perf</span>
            <span className="text-[10px] font-normal text-zinc-400/80">{perfBadge}</span>
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-[22rem] whitespace-pre-wrap rounded-lg border border-zinc-500/40 bg-[#0d1117] px-2.5 py-2 text-left text-[10px] font-normal normal-case leading-snug tracking-normal text-zinc-200 shadow-xl group-hover:visible"
            >
              {perfHover}
            </span>
          </span>
        )}

        {deskSessionLive && (
          <span
            title={regionHover}
            className="group relative flex cursor-help items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border rounded-lg bg-transparent border-zinc-500/40 text-zinc-400"
          >
            <span className="w-2 h-2 rounded-full inline-block bg-zinc-500" />
            <span>Region</span>
            <span className="text-[10px] font-normal text-zinc-400/80">{regionBadge}</span>
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-[22rem] whitespace-pre-wrap rounded-lg border border-zinc-500/40 bg-[#0d1117] px-2.5 py-2 text-left text-[10px] font-normal normal-case leading-snug tracking-normal text-zinc-200 shadow-xl group-hover:visible"
            >
              {regionHover}
            </span>
          </span>
        )}

        {deskSessionLive && (
          <span
            title={stayOutHover}
            className="group relative flex cursor-help items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border rounded-lg bg-transparent border-zinc-500/40 text-zinc-400"
          >
            <span className="w-2 h-2 rounded-full inline-block bg-zinc-500" />
            <span>Out</span>
            <span className="text-[10px] font-normal text-zinc-400/80">{stayOutBadge}</span>
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-[22rem] whitespace-pre-wrap rounded-lg border border-zinc-500/40 bg-[#0d1117] px-2.5 py-2 text-left text-[10px] font-normal normal-case leading-snug tracking-normal text-zinc-200 shadow-xl group-hover:visible"
            >
              {stayOutHover}
            </span>
          </span>
        )}

        {deskSessionLive && (
          <span
            title={sitHover}
            className="group relative flex cursor-help items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border rounded-lg bg-transparent border-zinc-500/40 text-zinc-400"
          >
            <span className="w-2 h-2 rounded-full inline-block bg-zinc-500" />
            <span>Sit</span>
            <span className="text-[10px] font-normal text-zinc-400/80">{sitBadge}</span>
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-[22rem] whitespace-pre-wrap rounded-lg border border-zinc-500/40 bg-[#0d1117] px-2.5 py-2 text-left text-[10px] font-normal normal-case leading-snug tracking-normal text-zinc-200 shadow-xl group-hover:visible"
            >
              {sitHover}
            </span>
          </span>
        )}

        {/* Open range — all desk names (Press N) */}
        {deskSessionLive && isOr15Instrument(instrument) && (
          <button
            type="button"
            title={
              showOr15
                ? `Open range lines ${or15WindowLabel(instrument)} + O15 BRK/REJ after lock (Press N)`
                : 'Show Open range high / low (Press N). First 15 minutes of cash open.'
            }
            onClick={() => setShowOr15((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${showOr15
              ? 'bg-amber-600/30 border-amber-500/50 text-amber-100'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-amber-200 hover:border-amber-500/40'
              }`}
          >
            <span className={`w-2 h-2 rounded-full inline-block ${showOr15 ? 'bg-amber-400' : 'bg-gray-600'}`} />
            <span>Open range (N)</span>
            {or15Shaped && (
              <span className="text-[10px] font-normal text-amber-200/80">
                {rangeSignalSummary.lunch > 0 ? `${rangeSignalSummary.lunch}` : '0'}
              </span>
            )}
          </button>
        )}

        {/* Nikkei US Range H/L toggle (Press U) — IB-style lines only */}
        {deskSessionLive && !SYSTEMATIC_LIVE_DESK && instrument === 'NIKKEI' && (
          <button
            type="button"
            title={
              showUsRange
                ? 'US H/L lines visible (Press U)'
                : 'Show current US session H/L (Press U)'
            }
            onClick={() => setShowUsRange((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${showUsRange
              ? 'bg-red-600/30 border-red-500/50 text-red-100'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-red-200 hover:border-red-500/40'
              }`}
          >
            <span className={`w-2 h-2 rounded-full inline-block ${showUsRange ? 'bg-red-500' : 'bg-gray-600'}`} />
            <span>US Range (U)</span>
          </button>
        )}

        {/* Opening range 30m (Press R) — lines + OR BRK/REJ markers */}
        {deskSessionLive && isOr30Instrument(instrument) && (
          <button
            type="button"
            title={
              showOr30
                ? `OR30 H/L + OR BRK/REJ — ${or30WindowLabel(instrument)} (Press R). Range is calculated even if you missed the window. BRK = close beyond H/L (RVOL when volume exists). REJ = wick reject.`
                : `OR30 is calculated from cash open even if you arrive late. Press R to show H/L + BRK/REJ — ${or30WindowLabel(instrument)}`
            }
            onClick={() => setShowOr30((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${showOr30
              ? 'bg-teal-600/30 border-teal-500/50 text-teal-100'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-teal-200 hover:border-teal-500/40'
              }`}
          >
            <span className={`w-2 h-2 rounded-full inline-block ${showOr30 ? 'bg-teal-400' : 'bg-gray-600'}`} />
            <span>OR30 BRK/REJ (R)</span>
            {or30Locked && !showOr30 && (
              <span className="text-[10px] font-normal text-teal-200/80">locked</span>
            )}
            {or30Shaped && (
              <span className="text-[10px] font-normal text-teal-200/80">
                {rangeSignalSummary.or30 > 0 ? `${rangeSignalSummary.or30}` : '0'}
              </span>
            )}
          </button>
        )}

        {/* IB Proximity Badge when price approaches IB High / IB Low */}
        {ibProximity && (
          <span
            className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-wide animate-pulse shadow-sm ${ibProximity.level === 'HIGH'
              ? 'border-amber-500/80 bg-amber-950/80 text-amber-200'
              : 'border-purple-500/80 bg-purple-950/80 text-purple-200'
              }`}
            title={`Price is testing Initial Balance ${ibProximity.level} (${ibProximity.price.toLocaleString()})`}
          >
            ⚡ TESTING IB {ibProximity.level} ({ibProximity.price.toLocaleString()})
          </span>
        )}

        {/* Active playbook ±10 band — entries unlocked (limit or market) */}
        {edgeProximity && canPlaceOrder && (
          <span
            className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-wide animate-pulse shadow-sm ${edgeProximity.edge === 'high'
              ? 'border-sky-500/80 bg-sky-950/80 text-sky-100'
              : edgeProximity.edge === 'mid'
                ? 'border-violet-500/80 bg-violet-950/80 text-violet-100'
                : 'border-emerald-500/80 bg-emerald-950/80 text-emerald-100'
              }`}
            title={`Live price is within ±10 of ${edgeProximity.label} ${edgeProximity.edge === 'mid' ? '50% mid' : edgeProximity.edge} (${edgeProximity.center.toLocaleString()}). Limit allowed.`}
          >
            IN BAND · {edgeProximity.label}{' '}
            {edgeProximity.edge === 'mid' ? '50%' : edgeProximity.edge.toUpperCase()} (
            {edgeProximity.center.toLocaleString()})
          </span>
        )}

        {deskSessionLive && !SYSTEMATIC_LIVE_DESK && deskLevelsActive && (
          <button
            type="button"
            title={
              playbookOpen
                ? `Hide ${playbookButtonLabel} (Press P) — advise only`
                : afternoonWatch
                  ? tokyoDesk
                    ? 'Show Tokyo watch playbook (Press P) — advise only'
                    : 'Show afternoon watch playbook (Press P) — advise only'
                  : `Show ${playbookButtonLabel} (Press P) — advise only; place on CALL ±10`
            }
            onClick={togglePlaybook}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${playbookOpen
              ? 'bg-surface-600 border-surface-400 text-gray-200'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-gray-300'
              }`}
          >
            {playbookButtonLabel} (P)
          </button>
        )}


        {deskSessionLive &&
          !SYSTEMATIC_LIVE_DESK &&
          deskLevelsActive &&
          afternoonWatch &&
          !canPlaceOrder &&
          !positionOverlay &&
          !pendingLimit && (
            <span
              className="rounded-lg border border-surface-600 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500"
              title={
                tokyoDesk
                  ? 'Outside Tokyo entry windows — levels are watch-only until cash close'
                  : 'Outside entry windows (morning / OR30 / IB) — levels are watch-only'
              }
            >
              Watch only
            </span>
          )}



        {/* Interactive TradingView Risk/Reward Limit Order Tool */}
        <button
          type="button"
          title={
            riskBox
              ? 'Limit Order active — place order or Esc to close'
              : 'Interactive Limit Order Tool (Press O)'
          }
          onClick={() => {
            if (riskBoxActive && riskBox) {
              cancelRiskBox()
            } else {
              openRiskBox()
            }
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${riskBox
            ? 'bg-sky-600/30 border-sky-500/50 text-sky-100 animate-pulse'
            : 'bg-transparent border-surface-600 text-gray-500 hover:text-sky-200 hover:border-sky-500/40'
            }`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="12" height="6" rx="1" className="fill-emerald-500/30 stroke-emerald-400" />
            <rect x="2" y="8" width="12" height="6" rx="1" className="fill-red-500/30 stroke-red-400" />
            <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" />
          </svg>
          {riskBox ? 'Limit Order Active' : 'Limit Order (O)'}
        </button>

        {/* Draggable price alert — Telegram on touch (A key); arms after price leaves */}
        <button
          type="button"
          title={
            priceAlert
              ? priceAlert.armed === false
                ? 'Price alert fired — dismiss (A / Esc)'
                : priceAlert.pendingAway
                  ? 'Waiting for price to leave alert, then re-touch fires (drag / Esc)'
                  : 'Price alert armed — drag line or Esc to dismiss (A)'
              : 'Place draggable price alert (Press A)'
          }
          onClick={togglePriceAlert}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${priceAlert
            ? priceAlert.armed === false
              ? 'bg-violet-950/40 border-violet-500/30 text-violet-300/70'
              : priceAlert.pendingAway
                ? 'bg-violet-600/20 border-violet-500/40 text-violet-200/90'
                : 'bg-violet-600/30 border-violet-500/50 text-violet-100 animate-pulse'
            : 'bg-transparent border-surface-600 text-gray-500 hover:text-violet-200 hover:border-violet-500/40'
            }`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v2M8 12v2M3.5 8H2M14 8h-1.5M4.2 4.2l1 1M10.8 10.8l1 1M4.2 11.8l1-1M10.8 5.2l1-1" />
            <circle cx="8" cy="8" r="2.5" className="fill-violet-500/40 stroke-violet-400" />
          </svg>
          {priceAlert
            ? priceAlert.armed === false
              ? 'Alert Fired'
              : priceAlert.pendingAway
                ? 'Alert Arming…'
                : 'Price Alert Active'
            : 'Price Alert (A)'}
        </button>

        {/* Toolbar Direction Switcher — regular ±10 only; CALL locks side */}
        {riskBox && resolvedUseCall === false && (
          <button
            type="button"
            onClick={toggleRiskBoxDirection}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-extrabold uppercase rounded-lg border transition shadow-sm ${riskBox.direction === 'LONG'
              ? 'bg-red-950/80 border-red-500/70 text-red-300 hover:bg-red-900'
              : 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300 hover:bg-emerald-900'
              }`}
            title={`Switch mode from ${riskBox.direction} to ${riskBox.direction === 'LONG' ? 'SHORT' : 'LONG'}`}
          >
            <span>⇄</span>
            <span>{riskBox.direction === 'LONG' ? 'SWITCH TO SHORT' : 'SWITCH TO LONG'}</span>
          </button>
        )}

        {/* Fullscreen mode button (Press F / Esc) */}
        <button
          type="button"
          title={
            isFullscreen
              ? 'Exit Fullscreen mode (Esc / F)'
              : 'Enter Fullscreen mode (Press F)'
          }
          onClick={toggleFullscreen}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${isFullscreen
            ? 'bg-blue-600/30 border-blue-500/50 text-blue-100'
            : 'bg-transparent border-surface-600 text-gray-500 hover:text-blue-200 hover:border-blue-500/40'
            }`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            {isFullscreen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 2v3.5H2M10.5 2v3.5H14M5.5 14v-3.5H2M10.5 14v-3.5H14" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M2 5.5V2h3.5M14 5.5V2h-3.5M2 10.5V14h3.5M14 10.5V14h-3.5" />
            )}
          </svg>
          {isFullscreen ? 'Exit Full (Esc)' : 'Fullscreen (F)'}
        </button>

        {pendingLimit && !positionOverlay && (() => {
          const isBroken = levels.some(
            (l: LevelLine) =>
              Math.abs(l.price - pendingLimit.price) < l.price * 0.002 &&
              (l.marketVerdict === 'broken' || l.marketOutcome === 'broke')
          )
          return (
            <>
              <span
                className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${isBroken
                  ? 'border-amber-500/80 bg-amber-950/80 text-amber-200 animate-pulse font-bold'
                  : 'border-sky-700/50 bg-sky-950/40 text-sky-200'
                  }`}
              >
                {isBroken ? '⚠️ Level Invalidated (Structure Broke) · Working ' : 'Working '}
                {pendingLimit.direction} · E{' '}
                {(workingBook?.entry ?? pendingLimit.price).toLocaleString()} · SL{' '}
                {(workingBook?.stop ?? pendingLimit.stopLoss).toLocaleString()} · TP{' '}
                {(workingBook?.target ?? pendingLimit.profitTarget).toLocaleString()}
                {workingBook?.sizeNote ? ` · ${workingBook.sizeNote}` : ''}
              </span>
              {onCancelPending && (
                <button
                  type="button"
                  onClick={onCancelPending}
                  className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide shadow-sm transition ${isBroken
                    ? 'border-red-500 bg-red-600 text-white hover:bg-red-500 animate-pulse'
                    : 'border-sky-500/60 bg-sky-600/80 text-white hover:bg-sky-500'
                    }`}
                >
                  Cancel limit
                </button>
              )}
            </>
          )
        })()}

        {positionOverlay && (
          <span className="rounded-lg border border-blue-700/50 bg-blue-950/40 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-200">
            In trade · E {(filledBook?.entry ?? positionOverlay.entryPrice).toLocaleString()} · SL{' '}
            {(filledBook?.stop ?? positionOverlay.stopLoss).toLocaleString()} · TP{' '}
            {(filledBook?.target ?? positionOverlay.profitTarget).toLocaleString()}
            {filledBook?.sizeNote ? ` · ${filledBook.sizeNote}` : ''}
          </span>
        )}

        {/* Live price ticker */}
        <div className="ml-auto flex items-center gap-3">
          <LivePriceTicker
            subscribe={subscribePriceTick}
            getTick={getPriceTick}
            instrument={instrument}
            barCountdown={barCountdown}
          />
          {/* Position overlay indicator */}
          {positionOverlay && (
            <span className={`text-xs px-2 py-0.5 rounded font-semibold border ${positionOverlay.direction === 'long'
              ? 'text-green-400 border-green-800 bg-green-900/30'
              : 'text-red-400 border-red-800 bg-red-900/30'
              }`}>
              {positionOverlay.direction === 'long' ? '▲' : '▼'} POSITION
            </span>
          )}
          {pendingLimit && !positionOverlay && (
            <span className="text-xs px-2 py-0.5 rounded font-semibold border text-sky-300 border-sky-800 bg-sky-900/30">
              WORKING {pendingLimit.direction.toUpperCase()}
              {workingBook?.sizeNote ? ` · ${workingBook.sizeNote}` : ''}
            </span>
          )}
          {asiaOco &&
            asiaOco.event === 'place_both' &&
            !positionOverlay && (
              <span
                className="text-xs px-2 py-0.5 rounded font-semibold border text-lime-200 border-lime-700 bg-lime-950/50"
                title="Locked Asia recipe — place both stop orders on Tradovate. Lines are the live Trade Pulse working book."
              >
                ASIA OCO · BUY {asiaOco.buyStop.toLocaleString('en-US', { maximumFractionDigits: asiaOco.instrument === 'GOLD' ? 1 : 0 })} / SELL{' '}
                {asiaOco.sellStop.toLocaleString('en-US', { maximumFractionDigits: asiaOco.instrument === 'GOLD' ? 1 : 0 })} · {asiaOco.contract} x {asiaOco.contracts}
              </span>
            )}
          {dataMode === 'live' ? (
            <span
              className={`flex items-center gap-1 text-xs ${candleFeed === 'yahoo' ? 'text-emerald-400' : 'text-amber-400'
                }`}
              title={
                candleFeed === 'yahoo'
                  ? 'CME futures (MYM / MNQ / NKD) — IB matches Tradovate, not OANDA US30/NAS100 cash'
                  : 'OANDA CFD fallback — IB will not match Tradovate. Refresh if this stays on.'
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full animate-pulse ${candleFeed === 'yahoo' ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
              />
              {candleFeed === 'yahoo' ? 'LIVE · CME' : 'LIVE · OANDA'}
            </span>
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

      {/* ── OHLCV tooltip bar ─────────────────────────────────────────────────── */}
      <div className="h-5">
        <OHLCVTooltip data={tooltip} color={meta.color} />
      </div>

      {/* Range overlay status — lines vs BRK/REJ (no separate volume pane) */}
      {deskSessionLive && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-gray-500">
          <span className="uppercase tracking-wider text-gray-600">Ranges</span>
          {entryBandsVisible && entryBandLabel && (
            <span
              className={
                canPlaceOrder
                  ? 'text-sky-300 font-semibold'
                  : 'text-sky-300/50'
              }
              title="Cyan = high ±10 · Emerald = low ±10. Enter only inside these bands when the entry window is open."
            >
              {entryBandLabel}
            </span>
          )}
          {rangeAtrSnap && (
            <span
              className="text-violet-300/90 font-medium tabular-nums"
              title={formatRangeAtrAdviceLine(rangeAtrSnap)}
            >
              {formatRangeAtrChip(rangeAtrSnap)}
            </span>
          )}
          <span title="Gold yesterday YH/YL/VA/POC + Dalton open type — toggle with Press Y.">
            <span className={showYesterdayProfile ? 'text-amber-500' : 'text-gray-600'}>
              {yesterdayBadge}
            </span>
          </span>
          <span title="Cyan Dalton opening type — first cash 5m. Click Open chip for open + first-bar H/L.">
            <span className={showOpeningActivity ? 'text-cyan-400' : 'text-gray-600'}>
              Open {openingBadge}
            </span>
          </span>
          <span title="Indigo Dalton control — RF + developing POC. Click Ctrl chip for the dPOC line.">
            <span className={showMarketControl ? 'text-indigo-400' : 'text-gray-600'}>
              Ctrl {controlBadge}
            </span>
          </span>
          <span title={callHover}>
            <span className="text-zinc-400">
              Call {callBadge}
            </span>
          </span>
          <span title={perfHover}>
            <span
              className={
                perfBadge === 'WAIT'
                  ? 'text-gray-500'
                  : perfBadge.startsWith('VERY STRONG') || perfBadge.startsWith('STRONG')
                    ? 'text-emerald-400'
                    : perfBadge.startsWith('SLOWING')
                      ? 'text-amber-300'
                      : perfBadge.startsWith('BALANCING')
                        ? 'text-violet-300'
                        : 'text-rose-300'
              }
            >
              Perf {perfBadge}
            </span>
          </span>
          <span title={regionHover}>
            <span className="text-zinc-400">
              Region {regionBadge}
            </span>
          </span>
          <span title={stayOutHover}>
            <span
              className={
                stayOutBadge.startsWith('OUT')
                  ? 'text-zinc-300 font-semibold'
                  : 'text-zinc-500'
              }
            >
              Out {stayOutBadge}
            </span>
          </span>
          <span title={sitHover}>
            <span className="text-zinc-400">
              Sit {sitBadge}
            </span>
          </span>
          <span title={ibExtendHover}>
            <span
              className={
                ibExtendBadge === 'Extend high' || ibExtendBadge === 'Extend low'
                  ? 'text-amber-300 font-semibold'
                  : ibExtendBadge === 'Balance'
                    ? 'text-violet-300 font-semibold'
                    : ibExtendBadge === 'Stand down'
                      ? 'text-rose-300/80'
                      : ibExtendBadge.startsWith('Waiting')
                        ? 'text-yellow-600'
                        : 'text-gray-600'
              }
            >
              IB {ibExtendBadge}
            </span>
          </span>
          <span title="Blue IB high/low + BRK/REJ + ±10 — toggle with Press B.">
            <span className={ibShaped ? 'text-blue-500' : 'text-gray-600'}>
              IB H/L {ibShaped ? 'on' : showIbBreakouts ? 'waiting' : 'off'}
            </span>
            {ibShaped && (
              <span className="text-gray-600">
                {' '}
                · ±10 on · BRK/REJ {rangeSignalSummary.ib}
              </span>
            )}
          </span>
          <span title="First 30m range is always calculated (even if you skip/miss the window). Press R to show H/L. Morning ±10 stays closed after OR30 clock — late desk uses IB / US Range.">
            <span className={or30Locked || or30Shaped ? 'text-teal-500' : 'text-gray-600'}>
              OR30 {or30Locked ? 'locked' : or30Shaped ? 'forming' : showOr30 ? 'waiting' : 'off'}
            </span>
            {or30Shaped && (
              <span className="text-gray-600">
                {' '}
                · BRK/REJ {showOr30 ? rangeSignalSummary.or30 : 'off'}
              </span>
            )}
          </span>
          {isOr15Instrument(instrument) && (
            <span title={`Open range ${or15WindowLabel(instrument)} — ±10 after 15m lock`}>
              <span className={or15Shaped ? 'text-amber-400' : 'text-gray-600'}>
                OR15 {or15Shaped ? (or15Locked ? 'locked' : 'forming') : 'forming'}
              </span>
              {or15Shaped && (
                <span className="text-gray-600">
                  {' '}
                  · O15 {showOr15 ? rangeSignalSummary.lunch : 'off'}
                </span>
              )}
            </span>
          )}
          {instrument === 'NIKKEI' && !SYSTEMATIC_LIVE_DESK && (
            <span title="Prior NYC session H/L on Tokyo cash">
              <span className={usRangeShaped ? 'text-red-400' : 'text-gray-600'}>
                US H/L {usRangeShaped ? 'on' : 'Tokyo cash only'}
              </span>
            </span>
          )}
          {latestTailStatus && (
            <span
              className="text-amber-400 normal-case tracking-normal"
              title="Rejection wick at the ±10 band after the active range locked — other-timeframe footprint"
            >
              TAIL {latestTailStatus.edge === 'high' ? 'H' : 'L'} ·{' '}
              {latestTailStatus.tier} · {latestTailStatus.label}
            </span>
          )}
          <span className="text-gray-600 normal-case tracking-normal">
            ±10 entries only after the active range locks · tails prefer good/strong wicks (≥0.4× body) · BRK needs close beyond H/L
          </span>
        </div>
      )}

      {/* ── Chart container ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-1 text-[10px] uppercase tracking-wider text-gray-500">
        <span>Sessions</span>
        {sessionLegendOrder(instrument).map((name) => {
          const s = SESSION_RANGE_STYLES[name]
          return (
            <span key={name} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-3.5 rounded-[2px] ring-1 ring-black/10"
                style={{ backgroundColor: showSessionBands ? s.column : s.color }}
              />
              <span style={{ color: s.line }}>{sessionLegendLabel(name, instrument)}</span>
            </span>
          )
        })}
        <span className="text-gray-600">·</span>
        <span className="flex items-center gap-1.5 normal-case tracking-normal">
          <span className="inline-block w-4 border-t-2" style={{ borderColor: SHARED_VWAP_COLORS.vwap }} />
          <span style={{ color: SHARED_VWAP_COLORS.vwap }}>AVWAP</span>
          <span className="text-gray-600">
            {deskClockFor(instrument).openLabel} · 5 trading days prior · ±1/2/3σ
          </span>
        </span>
        {ibShaped && (
          <>
            <span className="text-gray-600">·</span>
            <span
              className="flex items-center gap-1.5 normal-case tracking-normal"
              title="Initial Balance — first-hour high/low, extended to cash close"
            >
              <span className="inline-block w-4 border-t-2 border-blue-500" />
              <span className="text-blue-500">IB H/L</span>
              <span className="text-gray-600">to session end</span>
            </span>
          </>
        )}
        {or15Shaped && (
          <>
            <span className="text-gray-600">·</span>
            <span
              className="flex items-center gap-1.5 normal-case tracking-normal"
              title={`Open range — first 15 minutes (${or15WindowLabel(instrument)})`}
            >
              <span
                className="inline-block w-4 border-t-2"
                style={{ borderColor: OR15_COLORS.high }}
              />
              <span style={{ color: OR15_COLORS.high }}>OR15 H</span>
              <span
                className="inline-block w-4 border-t-2"
                style={{ borderColor: OR15_COLORS.low }}
              />
              <span style={{ color: OR15_COLORS.low }}>L</span>
              <span className="text-gray-600">{or15WindowLabel(instrument)}</span>
            </span>
          </>
        )}
        {usRangeShaped && (
          <>
            <span className="text-gray-600">·</span>
            <span
              className="flex items-center gap-1.5 normal-case tracking-normal"
              title="Last NYC session high/low — drawn only on current Tokyo cash (09:00→tip)"
            >
              <span
                className="inline-block w-4 border-t-2"
                style={{ borderColor: NIKKEI_US_RANGE_COLORS.high }}
              />
              <span style={{ color: NIKKEI_US_RANGE_COLORS.high }}>US H/L</span>
            </span>
          </>
        )}
        {or30Shaped && (
          <>
            <span className="text-gray-600">·</span>
            <span
              className="flex items-center gap-1.5 normal-case tracking-normal"
              title={`Opening range — first 30 minutes (${or30WindowLabel(instrument)})`}
            >
              <span
                className="inline-block w-4 border-t-2"
                style={{ borderColor: OR30_COLORS.high }}
              />
              <span style={{ color: OR30_COLORS.high }}>OR30 H/L</span>
            </span>
          </>
        )}
      </div>
      <div
        ref={chartFrameRef}
        className="flex-1 relative rounded-xl border border-gray-300 overflow-hidden bg-[#fafafa]"
        style={{ minHeight: 400 }}
      >
        <div ref={containerRef} className="absolute inset-0 z-0" />
        <div
          ref={sessionOverlayRef}
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ opacity: 1, transition: 'none', willChange: 'opacity' }}
        />
        <div
          ref={positionBandOverlayRef}
          className="pointer-events-none absolute inset-0 z-[2]"
        />

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
        {positionOverlay && !SYSTEMATIC_LIVE_DESK && (
          <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[min(360px,70%)]">
            {aiVerdict ? (
              <div
                className={`rounded-md border px-2 py-1 shadow-lg backdrop-blur-sm ${aiVerdict.verdict.toLowerCase() === 'reversal'
                  ? 'border-violet-500/50 bg-violet-950/85 text-violet-100'
                  : aiVerdict.verdict.toLowerCase() === 'pullback'
                    ? 'border-amber-500/50 bg-amber-950/85 text-amber-100'
                    : 'border-emerald-500/40 bg-emerald-950/85 text-emerald-100'
                  }`}
              >
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                  <span>
                    {aiVerdict.verdict === 'reversal'
                      ? 'EXIT'
                      : aiVerdict.verdict === 'hold'
                        ? 'HOLD'
                        : aiVerdict.verdict === 'pullback'
                          ? 'PULLBACK'
                          : aiVerdict.verdict}
                  </span>
                  <span
                    className="font-mono normal-case tracking-normal opacity-80"
                    title="AI confidence — not Entry→TP %"
                  >
                    {aiVerdict.confidence}%
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-amber-700/40 bg-amber-950/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200 shadow-lg backdrop-blur-sm">
                AI…
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={resetPriceScale}
          className="absolute bottom-8 right-16 z-20 rounded-md border border-surface-500/80 bg-surface-800/95 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300 shadow-lg backdrop-blur transition hover:border-brand-500/50 hover:text-white"
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
                      ? 'Waiting for price to leave, then re-touch fires Telegram'
                      : 'Drag alert line — Telegram when price touches (soft signal, not an order)'
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

        {/* Filled position — drag SL / TP to adjust brackets on OANDA + journal */}
        {editableOverlay && !riskBox && onAdjustBrackets && (() => {
          const saving = bracketAdjustStatus === 'saving'
          const units =
            editableOverlay.positionSize != null &&
              Number.isFinite(editableOverlay.positionSize) &&
              editableOverlay.positionSize > 0
              ? editableOverlay.positionSize
              : 0
          const lossPts = Math.abs(editableOverlay.entryPrice - editableOverlay.stopLoss)
          const profitPts = Math.abs(editableOverlay.profitTarget - editableOverlay.entryPrice)
          const lossCad = units > 0 ? (units * lossPts).toFixed(2) : null
          const profitCad = units > 0 ? (units * profitPts).toFixed(2) : null
          return (
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              <div
                data-ov-price={editableOverlay.profitTarget}
                data-ov-dy={-13}
                onMouseDown={saving ? undefined : onBracketLineMouseDown('TP')}
                className={`absolute flex items-center gap-1.5 pointer-events-auto group ${saving ? 'cursor-wait opacity-70' : 'cursor-ns-resize'
                  }`}
                style={{ left: '48%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                title={`Drag Take Profit @ ${editableOverlay.profitTarget.toLocaleString()} — saves on release`}
              >
                <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md">
                  <span className="text-emerald-400">
                    {profitCad != null
                      ? `+${profitCad} CAD`
                      : `TP ${editableOverlay.profitTarget.toLocaleString()}`}
                  </span>
                </div>
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
              </div>
              <div
                data-ov-price={editableOverlay.stopLoss}
                data-ov-dy={-13}
                onMouseDown={saving ? undefined : onBracketLineMouseDown('SL')}
                className={`absolute flex items-center gap-1.5 pointer-events-auto group ${saving ? 'cursor-wait opacity-70' : 'cursor-ns-resize'
                  }`}
                style={{ left: '48%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                title={`Drag Stop Loss @ ${editableOverlay.stopLoss.toLocaleString()} — saves on release`}
              >
                <div className="flex items-center rounded border border-dashed border-red-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-red-300 shadow-md">
                  <span className="text-red-300">
                    {lossCad != null
                      ? `-${lossCad} CAD`
                      : `SL ${editableOverlay.stopLoss.toLocaleString()}`}
                  </span>
                </div>
                <div className="w-2.5 h-2.5 rounded-full bg-red-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
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

        {/* Working limit — TP draggable; SL locked at place (sets size) */}
        {editablePending && !positionOverlay && !riskBox && onAdjustWorkingBrackets && (() => {
          const saving = workingBracketAdjustStatus === 'saving'
          return (
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              <div
                data-ov-price={editablePending.profitTarget}
                data-ov-dy={-13}
                onMouseDown={saving ? undefined : onWorkingTpMouseDown}
                className={`absolute flex items-center gap-1.5 pointer-events-auto group ${saving ? 'cursor-wait opacity-70' : 'cursor-ns-resize'
                  }`}
                style={{ left: '48%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                title={`Drag Take Profit @ ${editablePending.profitTarget.toLocaleString()} — saves on release`}
              >
                <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md">
                  TP {editablePending.profitTarget.toLocaleString()}
                </div>
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
              </div>
              <div
                data-ov-price={editablePending.stopLoss}
                data-ov-dy={-13}
                className="absolute flex items-center gap-1.5 pointer-events-none opacity-90"
                style={{ left: '48%', top: 0, transform: OVERLAY_HIDDEN_TRANSFORM }}
                title="SL locked — sized at place"
              >
                <div className="flex items-center rounded border border-dotted border-red-500/60 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-red-300/90 shadow-md">
                  SL {editablePending.stopLoss.toLocaleString()}
                  <span className="ml-1.5 text-[9px] font-sans uppercase tracking-wide text-amber-300/90">
                    locked
                  </span>
                </div>
                <div className="w-2.5 h-2.5 rounded-full bg-red-400/50 border border-white/40 shadow-sm" />
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

        {/* Confirm / journal before placing working limit */}
        {rationaleModal?.open && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
            <div className="w-full max-w-md rounded-2xl border border-sky-500/40 bg-[#161b22] p-5 shadow-2xl space-y-4 animate-fade-in">
              <div className="flex items-center justify-between border-b border-[#30363d] pb-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="text-sky-400">📝</span> Manual Trade Journal Rationale
                </h4>
                <button
                  onClick={() => setRationaleModal(null)}
                  className="text-gray-400 hover:text-white transition text-sm"
                >✕</button>
              </div>

              <p className="text-xs text-gray-400 leading-relaxed">
                Because this manual limit was placed without a Live Voice discussion with Leo, please record your entry and SL/TP rationale for your daily performance journal:
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Why did you choose this entry level ({rationaleModal.entryPrice.toLocaleString()})?
                  </label>
                  <input
                    type="text"
                    value={userRationale}
                    onChange={(e) => setUserRationale(e.target.value)}
                    placeholder="e.g. Key support re-test, liquidity sweep rejection"
                    className="w-full rounded-lg border border-[#30363d] bg-black/60 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Why did you set this SL ({rationaleModal.stopLoss.toLocaleString()}) & TP ({rationaleModal.profitTarget.toLocaleString()})?
                  </label>
                  <input
                    type="text"
                    value={userSlTpRationale}
                    onChange={(e) => setUserSlTpRationale(e.target.value)}
                    placeholder="e.g. SL beyond market structure, TP at AVWAP band"
                    className="w-full rounded-lg border border-[#30363d] bg-black/60 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRationaleModal(null)}
                  className="flex-1 rounded-lg border border-[#30363d] bg-transparent py-2 text-xs font-semibold text-gray-400 hover:bg-[#21262d] hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const fullReason = `Manual ${rationaleModal.direction} entry: ${userRationale || 'Technical structure'} | SL/TP rationale: ${userSlTpRationale || 'Geometry bounds'}`
                    const { strategyMagnets, snapRanges, strategyRange, ladder, call } =
                      getStrategyRiskBundle()
                    const snapped = snapEntryToNearestOpenBandCenter({
                      entry: rationaleModal.entryPrice,
                      candidates: snapRanges,
                      preferLabel:
                        riskBox?.preferRangeLabel ?? strategyRange?.label ?? null,
                      liveOk: (range) => {
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
                      },
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
                    const gated = assertDeskTicketEntry({
                      useCall: useCallRef.current,
                      call,
                      edge: hit.edge,
                      direction: rationaleModal.direction,
                    })
                    if (!gated.ok) {
                      onDeskAlert?.({
                        kind: 'entry_band_deny',
                        title: 'CALL blocks this ticket',
                        body: gated.message,
                        telegram: '',
                        instrument,
                      })
                      return
                    }
                    onLevelSelect?.(snapDeskPrice(instrument, snapped.price), {
                      source: 'manual',
                      type: 'manual',
                      orderType: 'LIMIT',
                      side: rationaleModal.direction === 'LONG' ? 'BUY' : 'SHORT',
                      preferredDirection: rationaleModal.direction,
                      reasoning: fullReason,
                      stopLoss: rationaleModal.stopLoss,
                      profitTarget: rationaleModal.profitTarget,
                      strategyRange: hit.range,
                      strategyMagnets,
                    })
                    setRationaleModal(null)
                    cancelRiskBox()
                  }}
                  className="flex-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white py-2 text-xs font-bold uppercase tracking-wider transition shadow-md"
                >
                  Confirm & Place Limit
                </button>
              </div>
            </div>
          </div>
        )}

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
      </div>
    </div>
  )
}
