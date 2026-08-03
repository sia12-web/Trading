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

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
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
  lastNTradingSessions as trimDeskCandles,
  sessionLegendLabel,
  sessionLegendOrder,
  SESSION_STYLES as SESSION_RANGE_STYLES,
  VWAP_COLORS as SHARED_VWAP_COLORS,
  type SessionHighlightSpan,
} from '@/lib/chart/sessionVwap'
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
import { previewPositionSizing, riskPercentForSessionAttempt } from '@/lib/trading/positionSizing'
import {
  aiLevelsUrl,
  resolveDeskLevels,
  resolveAfternoonDeskLevels,
  computeInitialBalance,
  computeIbSignals,
  ibLineSeriesData,
  type InitialBalanceRange,
} from '@/lib/trading/deskLevels'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import { DraggableDeskWidget } from '@/app/dashboard/components/DraggableDeskWidget'
import { LiveVoicePanel } from '@/app/dashboard/chart/components/LiveVoicePanel'
import { DESK_CHART_THEME } from '@/lib/chart/deskChartTheme'
import {
  DESK_INSTRUMENTS,
  isDeskInstrument,
  isLiveBarsAllowed,
  isChartStreamAllowed,
  isLiveTipStreamAllowed,
  isLevelPaintAllowed,
  isAfternoonWatchWindow,
  isAnyLiveFocusWindowActive,
  liveVisibleInstruments,
  sessionFor,
  deskMarketFor,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
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
  type StrategyRangeEdges,
  type StrategyRiskMagnets,
} from '@/lib/trading/strategyRiskGeometry'
import {
  clampPriceToNearestRangeEdgeBands,
  clampPriceToRangeEdgeEnvelope,
  filterLevelsInRangeEdgeBand,
  findRangeEdgeBandHit,
  NO_IN_BAND_LEVELS_MESSAGE,
  RANGE_EDGE_BAND_POINTS,
  RANGE_EDGE_OFF_BAND_MESSAGE,
  rangeEdgeBands,
} from '@/lib/trading/rangeEdgeEntryGate'
import {
  computeRangeEdgeTails,
  latestQualityTail,
  preferLevelsWithRangeEdgeTail,
  type RangeEdgeTail,
  type ShapedRangeForTails,
} from '@/lib/chart/rangeEdgeTails'
import {
  formatRangeEdgeAlertMessage,
  formatRangeShapedNote,
  claimDeskNoteOnce,
  claimDeskNoteCooldown,
  deskNoteClaimKey,
  hasDeskNoteClaim,
  rangeEdgeProximity,
  shouldFireRangeEdgeAlert,
} from '@/lib/trading/rangeEdgeAlerts'
import {
  buildRangeAtrSnapshot,
  formatRangeAtrAdviceLine,
  formatRangeAtrChip,
  type RangeAtrSnapshot,
} from '@/lib/trading/rangeAtr'
import {
  NYC_LUNCH_COLORS,
  computeNycLunchRange,
  computeNycLunchSignals,
  isNycLunchInstrument,
  nycLunchEndMarkers,
  nycLunchLineSeriesData,
  type NycLunchRange,
} from '@/lib/chart/nycLunchSessionRange'
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
  getDeskInstrumentPreference,
  setDeskInstrumentPreference,
  deskVisibleLogicalRange,
  deskBarSpacing,
} from '@/lib/trading/deskInstrumentPreference'
import { snapDeskPrice } from '@/lib/trading/instrumentTicks'
import {
  didPriceTouchAlert,
  formatPriceTouchAlert,
  loadStoredPriceAlert,
  saveStoredPriceAlert,
  type StoredPriceAlert,
} from '@/lib/trading/priceTouchAlert'

function defaultManualStop(limit: number, direction: 'LONG' | 'SHORT'): number {
  const pct = 0.0035
  return direction === 'LONG' ? limit * (1 - pct) : limit * (1 + pct)
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

type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI'

/** Desk charts are 5m only — live and simulation share this. */
const DESK_TIMEFRAME = '5m' as const
const DESK_BAR_SECONDS = 300

interface OHLCV {
  time:   UTCTimestamp
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

interface LevelLine {
  price:  number
  type:   'support' | 'resistance' | 'vwap' | string
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
  time:   string
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
  change: number
  changePct: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INSTRUMENT_META: Record<Instrument, { label: string; symbol: string; color: string; basePrice: number }> = {
  DOW:    { label: 'Dow Jones', symbol: '^DJI',  color: '#3b7eff', basePrice: 39500 },
  NASDAQ: { label: 'NASDAQ 100', symbol: '^NDX', color: '#3b7eff', basePrice: 28500 },
  NIKKEI: { label: 'Nikkei 225', symbol: '^N225', color: '#f472b6', basePrice: 38000 },
}

const LEVEL_COLORS: Record<string, string> = {
  support:    '#22c55e',
  resistance: '#ef4444',
  vwap:       '#f59e0b',
}

const STATUS_COLORS: Record<string, string> = {
  approaching: '#facc15',
  touched:     '#3b82f6',
  contested:   '#facc15',
  broken:      '#ef4444',
  bounced:     '#a855f7',
  respected:   '#22c55e',
  rejected:    '#f97316',
  held:        '#22c55e',
  untested:    '#6b7280',
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
  if (candles.length === 0) return candles
  const sorted = [...candles].sort(
    (a, b) => (a.time as number) - (b.time as number)
  )
  const out: OHLCV[] = []
  for (const c of sorted) {
    const t = c.time as number
    if (!Number.isFinite(t)) continue
    const prev = out[out.length - 1]
    if (prev && (prev.time as number) === t) {
      out[out.length - 1] = c // keep latest OHLC for duplicate timestamp
      continue
    }
    if (prev && t <= (prev.time as number)) continue
    out.push(c)
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
  const now   = Math.floor(Date.now() / 1000)
  const start = now - tfSeconds * count

  let price = basePrice
  const volatility = basePrice * 0.0008  // 0.08% per candle

  for (let i = 0; i < count; i++) {
    const t = (start + i * tfSeconds) as UTCTimestamp

    const open  = price
    const move  = (Math.random() - 0.48) * volatility * 2
    const close = open + move
    const wick  = Math.random() * volatility
    const high  = Math.max(open, close) + wick
    const low   = Math.min(open, close) - wick * 0.7
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

// ─── TradingChart props ───────────────────────────────────────────────────────

interface PositionOverlay {
  entryPrice:  number
  stopLoss:    number
  profitTarget: number
  direction:   'long' | 'short'
  /** Contract/units size — used for $ P&L on SL/TP drag pills */
  positionSize?: number
}

interface PendingLimitOverlay {
  price: number
  direction: 'long' | 'short'
  stopLoss: number
  profitTarget: number
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
  onPriceUpdate?:      (price: number) => void   // called every tick
  /** Fired with unix seconds whenever a live quote lands */
  onQuoteTick?:        (unixSec: number) => void
  onDataModeChange?:   (mode: 'live' | 'synthetic') => void
  positionOverlay?:    PositionOverlay | null     // filled position Entry/SL/TP
  /** Working limit — not filled yet; does not enter MANAGE */
  pendingLimit?:       PendingLimitOverlay | null
  /** Cancel the working limit (chart toolbar + parent bar) */
  onCancelPending?:    () => void
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
  aiVerdict?:          ChartAiVerdict | null
  jumpToPriceRef?:     React.MutableRefObject<((price: number) => void) | null>
  /** Lock tabs to day's recommended desk instrument */
  lockedInstrument?:   Instrument | null
  /**
   * LIVE focus tabs only (session market ± clock-in lock).
   * Simulation must never pass this — leave undefined to show all three.
   */
  allowedInstruments?: Instrument[] | null
  /** When user clicks a level price (from panel or highlight) */
  onLevelSelect?:      (
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
  rangeStrategy?: 'ib' | 'lunch_range' | 'us_range' | null
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
  onCancelPending,
  onAdjustBrackets,
  onAdjustWorkingBrackets,
  bracketAdjustStatus = null,
  bracketAdjustError = null,
  workingBracketAdjustStatus = null,
  workingBracketAdjustError = null,
  aiVerdict = null,
  jumpToPriceRef,
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
  levelsRefreshKey = 0,
  onDeskAlert,
  onRangeAtr,
}: TradingChartProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sessionOverlayRef = useRef<HTMLDivElement>(null)
  const sessionSpansRef = useRef<{
    key: string
    spans: SessionHighlightSpan[]
    candleTimes: number[]
  } | null>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null)
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
  /** IB H/L + BRK/REJ markers + ±10 bands — off on refresh; user toggles on (Press B). */
  const [showIbBreakouts, setShowIbBreakouts] = useState(false)
  /** NYC lunch 12:00–13:30 ET — DOW / NASDAQ only (Mind Over Markets range) */
  const lunchSeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
    mid: ISeriesApi<'Line'>
  } | null>(null)
  const lunchRangeRef = useRef<NycLunchRange | null>(null)
  const [lunchShaped, setLunchShaped] = useState(false)
  const [lunchLocked, setLunchLocked] = useState(false)
  const [showLunchRange, setShowLunchRange] = useState(false)
  /** US session range H/L + Asia BRK/REJ — NIKKEI only */
  const usRangeSeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const usRangeRef = useRef<NikkeiUsSessionRange | null>(null)
  const [usRangeShaped, setUsRangeShaped] = useState(false)
  /** Gates current-session US H/L lines (IB-style, no markers) */
  const [showUsRange, setShowUsRange] = useState(false)
  /** Stable paint hook for tip-stream refresh (avoids restarting SSE on marker deps). */
  const paintDeskMarkersRef = useRef<(bars?: OHLCV[]) => void>(() => {})
  /** First 30m opening range — NY 09:30–10:00 ET / Tokyo 09:00–09:30 JST */
  const or30SeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const or30RangeRef = useRef<Or30Range | null>(null)
  const [or30Shaped, setOr30Shaped] = useState(false)
  const [or30Locked, setOr30Locked] = useState(false)
  const [showOr30, setShowOr30] = useState(false)
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

  const [instrument,  setInstrumentState] = useState<Instrument>('DOW')
  const [candles,     setCandles]    = useState<OHLCV[]>([])
  const [levels,      setLevels]     = useState<LevelLine[]>([])
  const [noInBandLevelsMessage, setNoInBandLevelsMessage] = useState<string | null>(null)
  const levelsRef = useRef<LevelLine[]>([])
  const [tooltip,     setTooltip]    = useState<TooltipData | null>(null)
  const [livePrice,   setLivePrice]  = useState<number | null>(null)
  const [priceChange, setPriceChange] = useState<number>(0)
  const [barCountdown, setBarCountdown] = useState<string>('')
  const [liveAccountSize, setLiveAccountSize] = useState<number>(100000)

  useEffect(() => {
    let isMounted = true
    fetch('/api/trading/oanda/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted || !data?.ok) return
        const nav = Number(data.NAV ?? data.balance)
        if (Number.isFinite(nav) && nav > 0) {
          setLiveAccountSize(nav)
        }
      })
      .catch(() => {})
    return () => {
      isMounted = false
    }
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

  const [showLevels,  setShowLevels] = useState(false)
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

    if (showLunchRange && lunchRangeRef.current) {
      for (const m of nycLunchEndMarkers(lunchRangeRef.current)) {
        lunchCount += 1
        markers.push({
          time: m.time as UTCTimestamp,
          position: m.position,
          color: m.color,
          shape: m.shape,
          text: m.text,
        })
      }
      if (deskBars.length > 0) {
        for (const s of computeNycLunchSignals(deskBars, lunchRangeRef.current)) {
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
      lunchRange: lunchRangeRef.current,
      morningAttempts,
    })
    let shapedForTails: ShapedRangeForTails | null = null
    if (strategyRangeForTails) {
      const or30 = or30RangeRef.current
      const ib = ibRangeRef.current
      const lunch = lunchRangeRef.current
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
        showLunchRange &&
        lunch?.complete &&
        lunch.high === strategyRangeForTails.high &&
        lunch.low === strategyRangeForTails.low
      ) {
        shapedForTails = {
          ...strategyRangeForTails,
          complete: true,
          lockedUnix: lunch.lunchEndUnix,
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
    setLatestTailStatus(
      qualityTail
        ? {
            edge: qualityTail.edge,
            tier: qualityTail.tier,
            label: qualityTail.label,
          }
        : null
    )

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
      candleSeries.setMarkers(mapped)
    } catch {
      /* ignore */
    }
  }, [
    showIbBreakouts,
    showLunchRange,
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
  }, [showIbBreakouts, showLunchRange, showOr30, showUsRange, paintDeskMarkers])

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
    const sess = sessionFor(instrument)
    const tipDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: sess.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(tipUnix * 1000))
    const [ch, cm] = sess.marketClose.split(':').map(Number)
    const closeUnix =
      instrument === 'NIKKEI'
        ? tokyoDateTimeToUnix(tipDay, ch!, cm || 0)
        : nyDateTimeToUnix(tipDay, ch!, cm || 0)
    const pts = ibLineSeriesData(ib, Math.max(tipUnix, closeUnix))
    const tz = chartTzRef.current
    try {
      series.high.setData(
        mapTimesToChart(
          pts.high.map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      )
      series.low.setData(
        mapTimesToChart(
          pts.low.map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      )
      setIbShaped(true)
      setIbLevels({ high: ib.high, low: ib.low })
    } catch {
      series.high.setData([])
      series.low.setData([])
      setIbShaped(false)
      setIbLevels(null)
    }
  }, [showIbBreakouts, instrument])

  /** Apply / clear lunch line series from cached range (toggle without recompute). */
  const paintLunchLines = useCallback(() => {
    const series = lunchSeriesRef.current
    if (!series) return
    const lunch = lunchRangeRef.current
    if (!showLunchRange || !lunch || !isNycLunchInstrument(instrument)) {
      try {
        series.high.setData([])
        series.low.setData([])
        series.mid.setData([])
      } catch {
        /* ignore */
      }
      setLunchShaped(false)
      setLunchLocked(false)
      return
    }
    const tip = candlesRef.current[candlesRef.current.length - 1]?.time as number | undefined
    const sess = sessionFor(instrument)
    const todayLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: sess.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const [ch, cm] = sess.marketClose.split(':').map(Number)
    const closeUnix = nyDateTimeToUnix(todayLocal, ch!, cm || 0)
    const pts = nycLunchLineSeriesData(lunch, Math.max(tip ?? closeUnix, closeUnix), {
      showMid: true,
    })
    const tz = chartTzRef.current
    try {
      series.high.setData(
        mapTimesToChart(
          pts.high.map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      series.low.setData(
        mapTimesToChart(
          pts.low.map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      series.mid.setData(
        mapTimesToChart(
          pts.mid.map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      setLunchShaped(true)
      setLunchLocked(!!lunch.complete)
    } catch {
      series.high.setData([])
      series.low.setData([])
      series.mid.setData([])
      setLunchShaped(false)
      setLunchLocked(false)
    }
  }, [showLunchRange, instrument])

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
    try {
      const tz = chartTzRef.current
      series.high.setData(
        mapTimesToChart(
          pts.high.map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      series.low.setData(
        mapTimesToChart(
          pts.low.map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      setUsRangeShaped(pts.high.length > 0)
    } catch {
      series.high.setData([])
      series.low.setData([])
      setUsRangeShaped(false)
    }
  }, [showUsRange, instrument])

  /** Apply / clear first-30m opening range H/L (teal, IB-style). */
  const paintOr30Lines = useCallback(() => {
    const series = or30SeriesRef.current
    if (!series) return
    const range = or30RangeRef.current
    if (!showOr30 || !range || !isOr30Instrument(instrument)) {
      try {
        series.high.setData([])
        series.low.setData([])
      } catch {
        /* ignore */
      }
      setOr30Shaped(false)
      setOr30Locked(false)
      return
    }
    const tipUnix = candlesRef.current.length
      ? (candlesRef.current[candlesRef.current.length - 1]!.time as number)
      : Math.floor(Date.now() / 1000)
    const pts = or30LineSeriesData(range, tipUnix)
    try {
      const tz = chartTzRef.current
      series.high.setData(
        mapTimesToChart(
          pts.high.map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      series.low.setData(
        mapTimesToChart(
          pts.low.map((p) => ({ time: p.time, value: p.value })),
          tz
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      )
      setOr30Shaped(pts.high.length > 0)
      setOr30Locked(!!range.complete)
    } catch {
      series.high.setData([])
      series.low.setData([])
      setOr30Shaped(false)
      setOr30Locked(false)
    }
  }, [showOr30, instrument])

  useEffect(() => {
    paintIbLines()
  }, [paintIbLines])

  useEffect(() => {
    paintLunchLines()
  }, [paintLunchLines])

  useEffect(() => {
    paintUsRangeLines()
  }, [paintUsRangeLines])

  useEffect(() => {
    paintOr30Lines()
  }, [paintOr30Lines])

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
  }, [instrument])
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
  const [chartScrollTrigger, setChartScrollTrigger] = useState(0)
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
  } | null>(null)
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
  const [chartReady,  setChartReady] = useState(false)
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
  /** Entry/SL/TP for working limit or open position — folded into candle autoscale only */
  const overlayFitPricesRef = useRef<number[]>([])
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
    /** Visible (toggled) ±10 zones — limit drag/open/click snap. */
    snapRanges: StrategyRangeEdges[]
    strategyMagnets: StrategyRiskMagnets
  } => {
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
    const strategyRange = activeRangeForPlaybook({
      playbookMode,
      instrument,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      lunchRange: lunchRangeRef.current,
      morningAttempts,
    })
    const eligible = entryEligibleOverlayRanges({
      playbookMode,
      instrument,
      showOr30,
      showIb: showIbBreakouts,
      showUsRange,
      showLunchRange,
      or30: or30RangeRef.current,
      ib: ibLevels ?? ibRangeRef.current,
      usRange: usRangeRef.current,
      lunchRange: lunchRangeRef.current,
      morningAttempts,
    })
    // Snap only to visible toggled bands (dead OR30 after entryClose excluded).
    const activeForSnap =
      strategyRange &&
      eligible.some(
        (r) =>
          r.label === strategyRange.label &&
          r.high === strategyRange.high &&
          r.low === strategyRange.low
      )
        ? strategyRange
        : null
    const snapRanges = studyEntrySnapRanges({
      active: activeForSnap,
      overlays: eligible,
    })
    const extras: number[] = []
    for (const r of [
      or30RangeRef.current,
      ibRangeRef.current,
      usRangeRef.current,
      lunchRangeRef.current,
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
    return {
      strategyRange,
      snapRanges,
      strategyMagnets: {
        avwap: avwapLastRef.current,
        extras,
      },
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
    showLunchRange,
    ibLevels,
  ])

  /** Open Limit risk box with entry snapped into painted ±10 bands (study overlays). */
  const openRiskBox = useCallback(
    (
      preferredPrice?: number,
      opts?: { direction?: 'LONG' | 'SHORT' }
    ) => {
      const rawPx =
        preferredPrice != null && Number.isFinite(preferredPrice) && preferredPrice > 0
          ? preferredPrice
          : livePrice || (candles.length > 0 ? candles[candles.length - 1]!.close : 67000)
      const { snapRanges } = getStrategyRiskBundle()
      const inBand = clampPriceToNearestRangeEdgeBands(Number(rawPx), snapRanges)
      const entry = snapDeskPrice(instrument, inBand ?? Number(rawPx))
      const dir: 'LONG' | 'SHORT' = opts?.direction ?? 'LONG'
      setRiskBox({
        direction: dir,
        orderType: 'LIMIT',
        entryPrice: entry,
        stopLoss: defaultManualStop(entry, dir),
        profitTarget: snapDeskPrice(
          instrument,
          dir === 'LONG' ? entry * 1.0105 : entry * (1 - 0.0105)
        ),
      })
      setRiskBoxActive(true)
    },
    [livePrice, candles, instrument, getStrategyRiskBundle]
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
    setPriceAlert({ price, armed: true })
  }, [livePrice, candles, instrument])

  const togglePriceAlert = useCallback(() => {
    if (priceAlert) {
      dismissPriceAlert()
    } else {
      openPriceAlert()
    }
  }, [priceAlert, dismissPriceAlert, openPriceAlert])

  // Recompute focus tabs on a short clock so NIKKEI appears at Tokyo−30m without refresh.
  // Clock-gated UI must NOT run during the hydrate render (Railway TZ ≠ browser → React #418).
  const [focusTick, setFocusTick] = useState(0)
  const [clockReady, setClockReady] = useState(false)
  const [deskSessionLive, setDeskSessionLive] = useState(false)
  const [visibleInstruments, setVisibleInstruments] = useState<Instrument[]>(() => {
    if (lockedInstrument) return [lockedInstrument]
    if (allowedInstruments && allowedInstruments.length > 0) return [...allowedInstruments]
    return [...DESK_INSTRUMENTS] as Instrument[]
  })

  useEffect(() => {
    const id = window.setInterval(() => setFocusTick((n) => n + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const now = new Date()
    setClockReady(true)
    setDeskSessionLive(isAnyLiveFocusWindowActive(now))
    if (lockedInstrument) {
      setVisibleInstruments([lockedInstrument])
      return
    }
    const live = liveVisibleInstruments(now) as Instrument[]
    if (allowedInstruments && allowedInstruments.length > 0) {
      setVisibleInstruments(allowedInstruments.filter((i) => live.includes(i)))
      return
    }
    setVisibleInstruments(live)
  }, [allowedInstruments, lockedInstrument, focusTick])

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
    if (lockedInstrument && inst !== lockedInstrument) return
    if (!visibleInstruments.includes(inst)) return
    setInstrumentState(inst)
    // Persist only intentional tab clicks — never gate/lock sync
    if (!lockedInstrument) setDeskInstrumentPreference(inst)
    onInstrumentChange?.(inst)
  }, [onInstrumentChange, lockedInstrument, visibleInstruments])

  // Hydrate remembered market once; then follow clock-in lock / session focus
  useEffect(() => {
    if (lockedInstrument && visibleInstruments.includes(lockedInstrument)) {
      setInstrumentState(lockedInstrument)
      onInstrumentSync?.(lockedInstrument)
      return
    }
    const preferred = getDeskInstrumentPreference()
    const next = visibleInstruments.includes(preferred)
      ? preferred
      : visibleInstruments[0] ?? 'DOW'
    setInstrumentState(next)
    onInstrumentSync?.(next)
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
          color:            '#ffffff40',
          lineWidth:        1,
          lineStyle:        LineStyle.Dashed,
          axisLabelVisible: true,
          title:            '→ ' + price.toLocaleString('en-US', { minimumFractionDigits: 0 }),
        })
        jumpMarkerRef.current = marker
        setTimeout(() => {
          try {
            if (jumpMarkerRef.current === marker) {
              candleRef.current?.removePriceLine(marker)
              jumpMarkerRef.current = null
            }
          } catch {}
        }, 3000)
      } catch {}
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
          : playbookMode === 'ib'
            ? 'IB · '
            : playbookMode === 'lunch_break' || playbookMode === 'lunch_range'
              ? instrument === 'NIKKEI'
                ? 'IB · '
                : 'LN · '
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

    const strategyRange = activeRangeForPlaybook({
      playbookMode,
      instrument: inst,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      lunchRange: lunchRangeRef.current,
      morningAttempts,
    })
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
    if (
      !playbookUserClosedRef.current &&
      (actionable.some((l) => l.source === 'ai' || l.source === 'structure') ||
        !!bandMsg)
    ) {
      setPlaybookOpen(true)
    }
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
      width:  containerRef.current.clientWidth,
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

      let min = Infinity
      let max = -Infinity
      for (let i = startIndex; i <= endIndex; i++) {
        const c = list[i]
        if (c) {
          if (Number.isFinite(c.low) && c.low > 0) min = Math.min(min, c.low)
          if (Number.isFinite(c.high) && c.high > 0) max = Math.max(max, c.high)
        }
      }

      const tip = lastCandleRef.current
      if (tip) {
        min = Math.min(min, tip.low, tip.close)
        max = Math.max(max, tip.high, tip.close)
      }
      for (const p of overlayFitPricesRef.current) {
        if (Number.isFinite(p) && p > 0) {
          min = Math.min(min, p)
          max = Math.max(max, p)
        }
      }

      if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return null
      const pad = Math.max((max - min) * 0.05, Math.abs(max) * 0.0005)
      return {
        priceRange: {
          minValue: min - pad,
          maxValue: max + pad,
        },
      }
    }

    const candleSeries = chart.addCandlestickSeries({
      upColor:         '#089981',
      downColor:       '#f23645',
      borderUpColor:   '#089981',
      borderDownColor: '#f23645',
      wickUpColor:     '#089981',
      wickDownColor:   '#f23645',
      borderVisible:   true,
      wickVisible:     true,
      autoscaleInfoProvider: candleAutoscale,
    })

    const ignoreScale = { autoscaleInfoProvider: (): null => null }

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

    // Initial Balance — blue H/L from first hour, extended to session end
    const ibLineOpts = {
      color: '#3b82f6',
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      ...ignoreScale,
    }
    const ibSeries = {
      high: chart.addLineSeries({ ...ibLineOpts, title: 'IB H' }),
      low: chart.addLineSeries({ ...ibLineOpts, title: 'IB L' }),
    }

    // NYC Lunch Session Range (12:00–13:30 ET) — Dow / Nasdaq only
    const lunchLineBase = {
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      ...ignoreScale,
    }
    const lunchSeries = {
      high: chart.addLineSeries({
        ...lunchLineBase,
        color: NYC_LUNCH_COLORS.high,
        title: 'Lunch H',
      }),
      low: chart.addLineSeries({
        ...lunchLineBase,
        color: NYC_LUNCH_COLORS.low,
        title: 'Lunch L',
      }),
      mid: chart.addLineSeries({
        ...lunchLineBase,
        color: NYC_LUNCH_COLORS.mid,
        title: 'Lunch 50%',
      }),
    }

    // Nikkei — US session range H/L (Asia breakout / rejection script)
    const usRangeLineOpts = {
      color: NIKKEI_US_RANGE_COLORS.high,
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
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
      scaleMargins: { top: 0.05, bottom: 0.05 },
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

    chartRef.current  = chart
    candleRef.current = candleSeries
    priceLineHostRef.current = priceLineHost
    vwapSeriesRef.current = vwapSeries
    ibSeriesRef.current = ibSeries
    lunchSeriesRef.current = lunchSeries
    usRangeSeriesRef.current = usRangeSeries
    or30SeriesRef.current = or30Series
    setChartReady(true)

    // Sync React overlay coordinates on chart scroll/zoom
    const onScroll = () => {
      setChartScrollTrigger((prev) => prev + 1)
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onScroll)

    // Responsive resize
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        )
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onScroll)
      } catch {}
      chart.remove()
      chartRef.current  = null
      candleRef.current = null
      priceLineHostRef.current = null
      priceLineHostSeededRef.current = false
      vwapSeriesRef.current = null
      ibSeriesRef.current = null
      lunchSeriesRef.current = null
      usRangeSeriesRef.current = null
      or30SeriesRef.current = null
      levelLinesRef.current = []
      positionLinesRef.current = []
      setIbShaped(false)
      setIbLevels(null)
      setLunchShaped(false)
      setLunchLocked(false)
      setUsRangeShaped(false)
      setOr30Shaped(false)
      setOr30Locked(false)
    }
  }, []) // initialize once only

  // ── Load candle data when instrument changes (5m only) ───────────────────────
  useEffect(() => {
    if (!chartReady) return
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
            time:   c.time as UTCTimestamp,
            open:   c.open,
            high:   c.high,
            low:    c.low,
            close:  c.close,
            volume: c.volume ?? 0,
          }))
          const trimmed = normalizeCandleTimes(toDeskCandles(mapped, instrument))
          setCandles(trimmed)
          setDataMode('live')
          setCandleFeed(
            json.source === 'yahoo' ? 'yahoo' : json.source === 'oanda' ? 'oanda' : 'empty'
          )
          const last = mapped[mapped.length - 1]
          setLivePrice(json.quote?.price ?? last?.close ?? null)
          setPriceChange(json.quote?.change_pct ?? 0)
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
        setLevels([])
        return
      }
      // Never invent candles in production — fake OHLCV must not drive orders
      if (process.env.NODE_ENV === 'production') {
        setCandles([])
        setDataMode('live')
        setCandleFeed('empty')
        setLivePrice(null)
        setLevels([])
        return
      }
      // Demo-only fallback during morning session if feeds fail (local/dev)
      const generated = generateCandles(meta.basePrice, tfSec)
      setCandles(generated)
      setDataMode('synthetic')
      setCandleFeed('empty')
      setLivePrice(generated[generated.length - 1]?.close ?? null)
      setPriceChange(0)
      loadLevels(instrument, generated)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [instrument, chartReady, loadLevels, levelsRefreshKey])

  // Mid-morning: re-grade levels against candles every 2 minutes (rule engine only)
  useEffect(() => {
    if (!chartReady) return
    void gradeLevels(instrument)
    const id = setInterval(() => void gradeLevels(instrument), 15_000)
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
    setPriceChange(0)
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
    const lunchS = lunchSeriesRef.current
    if (lunchS) {
      try {
        lunchS.high.setData([])
        lunchS.low.setData([])
        lunchS.mid.setData([])
      } catch {
        /* ignore */
      }
    }
    lunchRangeRef.current = null
    setLunchShaped(false)
    setLunchLocked(false)
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

    // Fresh autoscaling for the next instrument's price universe
    try {
      chartRef.current?.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      })
    } catch {
      /* ignore */
    }
  }, [instrument, clearHoverPreview])

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
    for (const level of levelsRef.current) {
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

      // Initial Balance — first-hour H/L (lines only when IB toggle is on)
      // Open day follows tip candle (same as OR30) so Nikkei overnight stays aligned.
      const ibSeries = ibSeriesRef.current
      if (ibSeries) {
        const sess = sessionFor(instrument)
        const tipUnix = ordered.length
          ? (ordered[ordered.length - 1]!.time as number)
          : Math.floor(Date.now() / 1000)
        const nowUnix = Math.max(tipUnix, Math.floor(Date.now() / 1000))
        const tipDay = new Intl.DateTimeFormat('en-CA', {
          timeZone: sess.tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(tipUnix * 1000))
        const [oh, om] = sess.marketOpen.split(':').map(Number)
        const openUnix =
          instrument === 'NIKKEI'
            ? tokyoDateTimeToUnix(tipDay, oh!, om || 0)
            : nyDateTimeToUnix(tipDay, oh!, om || 0)
        const ib = computeInitialBalance(
          ordered.map((c) => ({
            time: c.time as number,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
          openUnix,
          nowUnix
        )
        ibRangeRef.current = ib
        paintIbLines()
      }

      // NYC Lunch Session Range — 12:00–13:30 ET, Dow & Nasdaq only
      const lunchSeries = lunchSeriesRef.current
      if (lunchSeries) {
        if (isNycLunchInstrument(instrument)) {
          const sess = sessionFor(instrument as DeskInstrument)
          const todayLocal = new Intl.DateTimeFormat('en-CA', {
            timeZone: sess.tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date())
          const [ch, cm] = sess.marketClose.split(':').map(Number)
          const closeUnix = nyDateTimeToUnix(todayLocal, ch!, cm || 0)
          const tipUnix = ordered.length
            ? (ordered[ordered.length - 1]!.time as number)
            : closeUnix
          const nowUnix = Math.max(tipUnix, Math.floor(Date.now() / 1000))
          const lunch = computeNycLunchRange(
            ordered.map((c) => ({
              time: c.time as number,
              high: c.high,
              low: c.low,
            })),
            todayLocal,
            nowUnix
          )
          lunchRangeRef.current = lunch
          paintLunchLines()
        } else {
          lunchRangeRef.current = null
          paintLunchLines()
        }
      }

      // Nikkei — current US session H/L only (IB-style 2 red lines, no BRK/REJ markers)
      const usRangeSeries = usRangeSeriesRef.current
      if (usRangeSeries) {
        if (isNikkeiUsRangeInstrument(instrument)) {
          const tipUnix = ordered.length
            ? (ordered[ordered.length - 1]!.time as number)
            : Math.floor(Date.now() / 1000)
          // Wall clock wins when tip lags — matches OR30/lunch and keeps
          // inNikkeiUsSignalSession aligned with the live Tokyo cash window.
          const nowUnix = Math.max(tipUnix, Math.floor(Date.now() / 1000))
          const usRange = currentNikkeiUsRangeForChart(
            ordered.map((c) => ({
              time: c.time as number,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            })),
            nowUnix
          )
          usRangeRef.current = usRange
          paintUsRangeLines()
        } else {
          usRangeRef.current = null
          paintUsRangeLines()
        }
      }

      // First 30m opening range — desk cash open (NY 09:30 / Tokyo 09:00)
      const or30Series = or30SeriesRef.current
      if (or30Series) {
        if (isOr30Instrument(instrument)) {
          const tipUnix = ordered.length
            ? (ordered[ordered.length - 1]!.time as number)
            : Math.floor(Date.now() / 1000)
          const nowUnix = Math.max(tipUnix, Math.floor(Date.now() / 1000))
          const sess = sessionFor(instrument)
          const tipDay = new Intl.DateTimeFormat('en-CA', {
            timeZone: sess.tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(tipUnix * 1000))
          const [oh, om] = sess.marketOpen.split(':').map(Number)
          const openUnix =
            instrument === 'NIKKEI'
              ? tokyoDateTimeToUnix(tipDay, oh!, om || 0)
              : nyDateTimeToUnix(tipDay, oh!, om || 0)
          const or30 = computeOr30Range(
            ordered.map((c) => ({
              time: c.time as number,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            })),
            openUnix,
            nowUnix
          )
          or30RangeRef.current = or30
          paintOr30Lines()
        } else {
          or30RangeRef.current = null
          paintOr30Lines()
        }
      }

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
      ts.applyOptions({ barSpacing: spacing, rightOffset: 8 })
      requestAnimationFrame(() => {
        try {
          chartRef.current?.priceScale('right').applyOptions({
            autoScale: true,
            scaleMargins: { top: 0.05, bottom: 0.05 },
          })
          ts.setVisibleLogicalRange(deskVisibleLogicalRange(ordered.length))
          didFitRef.current = true
        } catch {
          /* ignore */
        }
      })
    } else if (savedRange) {
      // New prints / refresh must not yank the viewport while the user is panned
      requestAnimationFrame(() => {
        try {
          ts.setVisibleLogicalRange(savedRange)
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
      fullHeight: false, // high→low only — never wallpaper above/below price
    })
    paintSessionHighlightOverlay(host, rects, { keepPreviousIfEmpty: true })
  }, [instrument])

  /** TradingView-style: re-enable auto price scale after manual zoom on the axis */
  const resetPriceScale = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.05, bottom: 0.05 },
    })
    try {
      chart.timeScale().fitContent()
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => refreshSessionHighlights())
  }, [refreshSessionHighlights])

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
  }, [levels, showLevels, chartReady, paintLevelLines])

  // Arm live quote/candle stream once bars exist (do not restart on every new print)
  useEffect(() => {
    if (candles.length > 0) setStreamArmed(true)
  }, [candles.length])

  // ── Chart tip stream: only in focus window (−30m→close); afternoon if attended ─
  useEffect(() => {
    if (!chartReady || !streamArmed || dataMode === 'synthetic') return
    if (!tipStreamActive) return

    const CANDLE_REFRESH_MS = 3_000
    let lastUiPriceAt = 0
    let lastMarkerPaintAt = 0
    const fetchGen = ++candleFetchGenRef.current
    let sseHealthy = false

    /** Parent encodes focus + afternoon attendance; re-check chart stream for clock edge */
    const tipOpen = () =>
      tipStreamActive && isChartStreamAllowed(instrument).open

    const syncTipMarkers = (tipBar: OHLCV) => {
      const bars = candlesRef.current
      if (bars.length === 0) return
      const last = bars[bars.length - 1]!
      const next =
        (last.time as number) === (tipBar.time as number)
          ? [...bars.slice(0, -1), { ...last, ...tipBar, volume: last.volume || tipBar.volume }]
          : [...bars, tipBar]
      candlesRef.current = next
      const now = Date.now()
      if (now - lastMarkerPaintAt < 1000) return
      lastMarkerPaintAt = now
      paintDeskMarkersRef.current(next)
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
        // Header label throttle only — candle tip updates every tick below
        if (now - lastUiPriceAt >= 50) {
          lastUiPriceAt = now
          setLivePrice(price)
          setPriceChange(changePct)
          onQuoteTick?.(Math.floor(now / 1000))
        }
      }

      // Advance candle tip whenever the chart stream is open (incl. afternoon)
      if (!streamLive) return
      const last = lastCandleRef.current
      if (!last || !candleRef.current) return

      const tfSec = DESK_BAR_SECONDS
      const lastT = last.time as number
      if (quoteTs >= lastT + tfSec) {
        const barTime = (lastT + tfSec) as UTCTimestamp
        const bar: OHLCV = {
          time: barTime,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
        }
        try {
          candleRef.current.update({
            time: toChartTime(bar.time as number, chartTzRef.current) as UTCTimestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          })
          lastCandleRef.current = bar
          syncTipMarkers(bar)
        } catch {
          /* ignore — do not advance ref on failed update */
        }
        return
      }

      const updated: OHLCV = {
        ...last,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
      }
      try {
        candleRef.current.update({
          time: toChartTime(updated.time as number, chartTzRef.current) as UTCTimestamp,
          open: updated.open,
          high: updated.high,
          low: updated.low,
          close: updated.close,
        })
        lastCandleRef.current = updated
        syncTipMarkers(updated)
      } catch {
        /* ignore */
      }
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
        const last = trimmed[trimmed.length - 1]!
        const streamLive = tipOpen()
        if (live && streamLive) {
          const liveT = live.time as number
          const lastT = last.time as number
          if (liveT > lastT) {
            trimmed.push(live)
          } else if (liveT === lastT) {
            // Prefer broker forming-bar mid when tick tip diverged (stale/spike-stuck).
            // Otherwise keep the faster tick close for TradingView-like tip speed.
            const tipDiv =
              last.close > 0
                ? Math.abs(live.close - last.close) / last.close
                : 0
            const close = tipDiv <= 0.012 ? live.close : last.close
            trimmed[trimmed.length - 1] = {
              ...last,
              high: Math.max(last.high, live.high, live.close, close),
              low: Math.min(last.low, live.low, live.close, close),
              close,
            }
          }
        }

        if (fetchGen !== candleFetchGenRef.current) return

        const prev = candlesRef.current
        const structureChanged =
          prev.length !== trimmed.length ||
          (prev.length > 0 &&
            trimmed.length > 0 &&
            (prev[0]!.time as number) !== (trimmed[0]!.time as number)) ||
          (prev.length >= 2 &&
            trimmed.length >= 2 &&
            (prev[prev.length - 2]!.time as number) !==
              (trimmed[trimmed.length - 2]!.time as number))

        // Never reset didFitRef here — new prints must not yank a panned viewport
        lastCandleRef.current = trimmed[trimmed.length - 1]!
        if (structureChanged) {
          setCandles(trimmed)
        } else {
          const tip = trimmed[trimmed.length - 1]!
          try {
            candleRef.current?.update({
              time: toChartTime(tip.time as number, chartTzRef.current) as UTCTimestamp,
              open: tip.open,
              high: tip.high,
              low: tip.low,
              close: tip.close,
            })
          } catch {
            setCandles(trimmed)
          }
          // Tip OHLC can cross US/IB/OR H/L without a new bar — keep ref + BRK/REJ
          // markers in sync (setCandles is skipped to avoid yanking the viewport).
          candlesRef.current = trimmed
          paintDeskMarkersRef.current(trimmed)
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
    // Safety reconcile even when SSE is healthy (drift / missed reconnect)
    const reconcile = setInterval(() => {
      if (!tipOpen()) return
      void pollQuote()
    }, 4_000)

    return () => {
      candleFetchGenRef.current += 1
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
  ])

  // ── Double-click chart to drop TradingView Risk Box at clicked price ───────
  useEffect(() => {
    const container = containerRef.current
    if (!container || !candleRef.current || !chartReady) return
    if (positionOverlay || pendingLimit) return

    const placeAtClientY = (clientY: number) => {
      if (!candleRef.current) return
      const rect = container.getBoundingClientRect()
      const y = clientY - rect.top
      if (y < 0 || y > rect.height) return
      const price = candleRef.current.coordinateToPrice(y)
      if (price == null || !Number.isFinite(Number(price)) || Number(price) <= 0) return
      openRiskBox(Number(price))
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

      const rect = container.getBoundingClientRect()
      const y = e.clientY - rect.top
      if (y < 0 || y > rect.height) return
      const raw = candleRef.current.coordinateToPrice(y)
      if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) <= 0) return
      const price = Number(raw)

      const { strategyRange, snapRanges } = getStrategyRiskBundle()
      const hit = findRangeEdgeBandHit(price, snapRanges)
      if (!hit) return

      const label = hit.range.label || 'range'
      // OR30 has no independent afternoon bucket — it only trades inside its
      // own locked morning window, gated upstream (chart hides it once that
      // window closes; treat any hit here as preview-only).
      const liveOk =
        label === 'OR30'
          ? !!strategyRange &&
            strategyRange.label === hit.range.label &&
            strategyRange.high === hit.range.high &&
            strategyRange.low === hit.range.low
          : assertBucketEntryEligible({
              instrument,
              market: deskMarketFor(instrument),
              timeSec: deskClockSeconds(instrument),
              ladder: attemptLadderFromCounts({
                morningAttempts,
                ibAttempts,
                lunchAttempts,
                morningStopHits: stopHits,
                now: new Date(),
                instrument,
              }),
              rangeLabel: hit.range.label,
            }).ok

      if (!liveOk) {
        onDeskAlert?.({
          kind: 'entry_band_deny',
          title: `${label} entry closed`,
          body:
            label === 'OR30'
              ? 'OR30 morning ±10 window is closed — enter on the live US Range / IB / lunch playbook when unlocked.'
              : `${label} probes are exhausted or its entry window is not open right now.`,
          telegram: '',
          instrument,
        })
        return
      }

      e.preventDefault()
      e.stopPropagation()
      const dir: 'LONG' | 'SHORT' =
        hit.edge === 'high'
          ? 'SHORT'
          : hit.edge === 'low'
            ? 'LONG'
            : // 50% mid: fade from whichever side price is on (above mid → short bias)
              livePrice != null && Number.isFinite(livePrice) && livePrice > hit.center
              ? 'SHORT'
              : 'LONG'
      openRiskBox(hit.center, { direction: dir })
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
      const rect = container.getBoundingClientRect()
      const y = clientY - rect.top
      if (y < 0 || y > rect.height) return null
      const price = candleRef.current.coordinateToPrice(y)
      if (price == null || !Number.isFinite(Number(price)) || Number(price) <= 0) return null
      return Math.round(Number(price) * 100) / 100
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
        ${
          highPrice != null && lowPrice != null
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
        audio.play().catch(() => {})
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
        audio.play().catch(() => {})
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
      const rect = container.getBoundingClientRect()
      const y = clientY - rect.top
      if (y < 0 || y > rect.height) return null
      const price = candleRef.current.coordinateToPrice(y)
      if (price == null || !Number.isFinite(Number(price)) || Number(price) <= 0) return null
      return Math.round(Number(price) * 100) / 100
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
        ${
          highPrice != null && lowPrice != null
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

  // Mouse dragging for Risk Box lines (Entry, TP, SL)
  const draggingRiskLineRef = useRef<'ENTRY' | 'TP' | 'SL' | null>(null)

  const onRiskLineMouseDown = useCallback((type: 'ENTRY' | 'TP' | 'SL') => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    draggingRiskLineRef.current = type
  }, [])

  useEffect(() => {
    if (!riskBox) return

    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRiskLineRef.current || !containerRef.current || !candleRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const y = e.clientY - rect.top
      if (y < 0 || y > rect.height) return
      const rawPrice = candleRef.current.coordinateToPrice(y)
      if (rawPrice == null || !Number.isFinite(Number(rawPrice)) || Number(rawPrice) <= 0) return

      const snappedRaw = snapDeskPrice(instrument, Number(rawPrice))
      const { snapRanges } = getStrategyRiskBundle()

      if (draggingRiskLineRef.current === 'ENTRY') {
        // Free vertical follow within the outer ±10 envelope (high↔low reachable).
        // Nearest-band snap on mouseup — continuous nearest-band clamp traps on the
        // high edge and blocks dragging down to the low band.
        const enveloped = clampPriceToRangeEdgeEnvelope(snappedRaw, snapRanges)
        const snapped = snapDeskPrice(instrument, enveloped ?? snappedRaw)
        setRiskBox((prev) => {
          if (!prev) return null
          const diff = snapped - prev.entryPrice
          return {
            ...prev,
            entryPrice: snapped,
            stopLoss: snapDeskPrice(instrument, prev.stopLoss + diff),
            profitTarget: snapDeskPrice(instrument, prev.profitTarget + diff),
          }
        })
      } else if (draggingRiskLineRef.current === 'TP') {
        setRiskBox((prev) => (prev ? { ...prev, profitTarget: snappedRaw } : null))
      } else if (draggingRiskLineRef.current === 'SL') {
        setRiskBox((prev) => (prev ? { ...prev, stopLoss: snappedRaw } : null))
      }
    }

    const onMouseUp = () => {
      const was = draggingRiskLineRef.current
      draggingRiskLineRef.current = null
      if (was !== 'ENTRY') return
      const { snapRanges } = getStrategyRiskBundle()
      setRiskBox((prev) => {
        if (!prev) return null
        const inBand = clampPriceToNearestRangeEdgeBands(prev.entryPrice, snapRanges)
        if (inBand == null) return prev
        const snapped = snapDeskPrice(instrument, inBand)
        if (snapped === prev.entryPrice) return prev
        const diff = snapped - prev.entryPrice
        return {
          ...prev,
          entryPrice: snapped,
          stopLoss: snapDeskPrice(instrument, prev.stopLoss + diff),
          profitTarget: snapDeskPrice(instrument, prev.profitTarget + diff),
        }
      })
    }

    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [riskBox, instrument, getStrategyRiskBundle])

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
      const rect = containerRef.current.getBoundingClientRect()
      const y = e.clientY - rect.top
      if (y < 0 || y > rect.height) return
      const rawPrice = candleRef.current.coordinateToPrice(y)
      if (rawPrice == null || !Number.isFinite(Number(rawPrice)) || Number(rawPrice) <= 0) return
      const snapped = snapDeskPrice(instrument, Number(rawPrice))
      const ov = editableOverlayRef.current
      if (!ov) return
      const isLong = ov.direction === 'long'

      if (draggingBracketRef.current === 'SL') {
        if (isLong ? !(snapped < ov.entryPrice) : !(snapped > ov.entryPrice)) return
        setEditableOverlay((prev) => (prev ? { ...prev, stopLoss: snapped } : null))
      } else if (draggingBracketRef.current === 'TP') {
        if (isLong ? !(snapped > ov.entryPrice) : !(snapped < ov.entryPrice)) return
        setEditableOverlay((prev) => (prev ? { ...prev, profitTarget: snapped } : null))
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
  }, [editableOverlay, riskBox, instrument])

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
      const rect = containerRef.current.getBoundingClientRect()
      const y = e.clientY - rect.top
      if (y < 0 || y > rect.height) return
      const rawPrice = candleRef.current.coordinateToPrice(y)
      if (rawPrice == null || !Number.isFinite(Number(rawPrice)) || Number(rawPrice) <= 0) return
      const snapped = snapDeskPrice(instrument, Number(rawPrice))
      const pend = editablePendingRef.current
      if (!pend) return
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
  }, [editablePending, riskBox, positionOverlay, instrument])

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
      const rect = containerRef.current.getBoundingClientRect()
      const y = e.clientY - rect.top
      if (y < 0 || y > rect.height) return
      const rawPrice = candleRef.current.coordinateToPrice(y)
      if (rawPrice == null || !Number.isFinite(Number(rawPrice)) || Number(rawPrice) <= 0) return
      const snapped = snapDeskPrice(instrument, Number(rawPrice))
      priceAlertPrimedRef.current = false
      prevLivePriceForAlertRef.current = null
      setPriceAlert((prev) => (prev ? { ...prev, price: snapped } : null))
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
  }, [priceAlert?.armed, instrument])

  useEffect(() => {
    clearPriceAlertLine()
    if (!priceAlert || !chartReady) return
    const host = priceLineHostRef.current
    if (!host) return

    const armed = priceAlert.armed !== false
    const line = host.createPriceLine({
      price: priceAlert.price,
      color: armed ? 'rgba(168, 85, 247, 0.95)' : 'rgba(168, 85, 247, 0.35)',
      lineWidth: armed ? 2 : 1,
      lineStyle: armed ? 2 : 1,
      axisLabelVisible: true,
      title: armed
        ? `🔔 ALERT @ ${priceAlert.price.toLocaleString()}`
        : `🔔 FIRED @ ${priceAlert.price.toLocaleString()}`,
    })
    priceAlertLineRef.current = line
  }, [priceAlert, chartReady, instrument, clearPriceAlertLine])

  useEffect(() => {
    priceAlertPrimedRef.current = false
    prevLivePriceForAlertRef.current = null
  }, [priceAlert?.price, priceAlert?.armed])

  useEffect(() => {
    if (!priceAlert?.armed || !onDeskAlert) return
    if (livePrice == null) return

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
    setPriceAlert({ price: priceAlert.price, armed: false })
  }, [livePrice, priceAlert, instrument, onDeskAlert])

  const confirmRiskBoxOrder = useCallback(() => {
    if (!riskBox) return
    const { entryPrice, stopLoss, profitTarget, direction } = riskBox

    const { strategyMagnets, snapRanges } = getStrategyRiskBundle()
    const hit = findRangeEdgeBandHit(entryPrice, snapRanges)
    if (!hit) {
      onDeskAlert?.({
        kind: 'entry_band_deny',
        title: 'Off-band entry',
        body: RANGE_EDGE_OFF_BAND_MESSAGE,
        telegram: '',
        instrument,
      })
      return
    }
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
    setRiskBox((prev) => {
      if (!prev) return null
      const newDir: 'LONG' | 'SHORT' = prev.direction === 'LONG' ? 'SHORT' : 'LONG'
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
  }, [instrument])

  // ── Keyboard shortcuts: V (Voice), L (Levels), P (Playbook), D (Draw Zone), T (Highlight Time), O (Risk Box), F (Fullscreen), Esc
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
        e.preventDefault()
        setVoiceOpen((prev) => !prev)
      } else if (key === 'l') {
        e.preventDefault()
        setShowLevels((prev) => !prev)
      } else if (key === 'b') {
        e.preventDefault()
        setShowIbBreakouts((prev) => !prev)
      } else if (key === 'n') {
        e.preventDefault()
        if (instrument === 'DOW' || instrument === 'NASDAQ') {
          setShowLunchRange((prev) => !prev)
        }
      } else if (key === 'u') {
        e.preventDefault()
        if (instrument === 'NIKKEI') {
          setShowUsRange((prev) => !prev)
        }
      } else if (key === 'r') {
        e.preventDefault()
        if (isOr30Instrument(instrument)) {
          setShowOr30((prev) => !prev)
        }
      } else if (key === 'p') {
        e.preventDefault()
        togglePlaybook()
      } else if (key === 'd') {
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
      const rect = container.getBoundingClientRect()
      const y = e.clientY - rect.top
      const raw = candleRef.current.coordinateToPrice(y)
      if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) <= 0) {
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
      try { host?.removePriceLine(line) } catch {}
    })
    positionLinesRef.current = []

    const refreshOverlayAutoscale = () => {
      try {
        chartRef.current?.priceScale('right').applyOptions({
          autoScale: true,
          scaleMargins: { top: 0.05, bottom: 0.05 },
        })
      } catch {
        /* ignore */
      }
    }

    if (!host || !chartReady) {
      overlayFitPricesRef.current = []
      return
    }

    const fmt = (n: number) =>
      n.toLocaleString('en-US', { maximumFractionDigits: 0 })

    const paint = (
      entries: Array<{ price: number; color: string; label: string; style: LineStyle; width: 1 | 2 | 3 | 4 }>
    ) => {
      const prices: number[] = []
      for (const { price, color, label, style, width } of entries) {
        if (!Number.isFinite(price) || price <= 0) continue
        prices.push(price)
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
      // Fold entry/SL/TP into candle autoscale (visible bars only) — never full history or distant overlays
      overlayFitPricesRef.current = prices
      if (prices.length >= 1) refreshOverlayAutoscale()
    }

    if (positionOverlay || editableOverlay) {
      const ov = editableOverlay ?? positionOverlay
      if (!ov) {
        overlayFitPricesRef.current = []
        return
      }
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
      paint([
        {
          price: ov.entryPrice,
          color: '#3b82f6',
          label: `Entry ${ov.direction.toUpperCase()} ${fmt(ov.entryPrice)}`,
          style: LineStyle.Solid,
          width: 2,
        },
        {
          price: ov.stopLoss,
          color: '#ef4444',
          label: `SL ${fmt(ov.stopLoss)}${onAdjustBrackets ? ' · drag' : ''}`,
          style: LineStyle.Dashed,
          width: 2,
        },
        {
          price: ov.profitTarget,
          color: tpColor,
          label: `${tpLabel} ${fmt(ov.profitTarget)}${onAdjustBrackets ? ' · drag' : ''}`,
          style: LineStyle.Dashed,
          width: 2,
        },
      ])
      return
    }

    if (pendingLimit) {
      const pend = editablePending ?? pendingLimit
      const dir = pend.direction.toUpperCase()
      const tpDrag = onAdjustWorkingBrackets ? ' · drag' : ''
      paint([
        {
          price: pend.price,
          color: '#38bdf8',
          label: `WORKING ${dir} ${fmt(pend.price)}`,
          style: LineStyle.Solid,
          width: 3,
        },
        {
          price: pend.stopLoss,
          color: '#ef4444',
          label: `SL ${fmt(pend.stopLoss)} · locked — sized at place`,
          style: LineStyle.Dotted,
          width: 2,
        },
        {
          price: pend.profitTarget,
          color: '#22c55e',
          label: `TP ${fmt(pend.profitTarget)}${tpDrag}`,
          style: LineStyle.Dotted,
          width: 2,
        },
      ])
      return
    }

    overlayFitPricesRef.current = []
    refreshOverlayAutoscale()
  }, [positionOverlay, editableOverlay, pendingLimit, editablePending, aiVerdict, chartReady, clearHoverPreview, onAdjustBrackets, onAdjustWorkingBrackets])

  const isUp = priceChange >= 0
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
    const strategyRange = activeRangeForPlaybook({
      playbookMode,
      instrument,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      lunchRange: lunchRangeRef.current,
      morningAttempts,
    })
    return rangeEdgeProximity(livePrice, strategyRange)
  }, [canPlaceOrder, livePrice, playbookMode, instrument, rangeStrategy, morningAttempts])

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

    if (!chartReady || !host) {
      clearBands()
      return
    }

    const active = activeRangeForPlaybook({
      playbookMode,
      instrument,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      lunchRange: lunchRangeRef.current,
      morningAttempts,
    })
    const overlays = entryEligibleOverlayRanges({
      playbookMode,
      instrument,
      showOr30,
      // IB H/L + ±10 follow the IB BRK/REJ toolbar toggle (off on refresh).
      showIb: showIbBreakouts,
      showUsRange,
      showLunchRange,
      or30: or30RangeRef.current,
      ib: ibLevels ?? ibRangeRef.current,
      usRange: usRangeRef.current,
      lunchRange: lunchRangeRef.current,
      morningAttempts,
    })
    if (overlays.length === 0) {
      clearBands()
      return
    }

    clearBands()

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
      'Lunch-range': {
        high: 'rgba(251, 146, 60, 0.95)',
        low: 'rgba(252, 211, 77, 0.95)',
        highDim: 'rgba(251, 146, 60, 0.4)',
        lowDim: 'rgba(252, 211, 77, 0.4)',
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
      const bands = rangeEdgeBands(strategyRange)
      if (bands.length < 3) continue
      const label = strategyRange.label || 'range'
      const entryLive =
        !!canPlaceOrder &&
        !!active &&
        active.label === label &&
        active.high === strategyRange.high &&
        active.low === strategyRange.low
      if (entryLive) anyLive = true
      const colors = palette[label] ?? fallback
      const highColor = entryLive ? colors.high : colors.highDim
      const lowColor = entryLive ? colors.low : colors.lowDim
      const midColor = entryLive ? 'rgba(168, 85, 247, 0.95)' : 'rgba(168, 85, 247, 0.4)'
      const highBand = bands.find((b) => b.edge === 'high')!
      const midBand = bands.find((b) => b.edge === 'mid')!
      const lowBand = bands.find((b) => b.edge === 'low')!
      const specs: Array<{ price: number; color: string; title: string }> = [
        {
          price: highBand.max,
          color: highColor,
          title: `±${RANGE_EDGE_BAND_POINTS} ${label} H+`,
        },
        {
          price: highBand.min,
          color: highColor,
          title: `±${RANGE_EDGE_BAND_POINTS} ${label} H−`,
        },
        {
          price: midBand.max,
          color: midColor,
          title: `±${RANGE_EDGE_BAND_POINTS} ${label} 50%+`,
        },
        {
          price: midBand.min,
          color: midColor,
          title: `±${RANGE_EDGE_BAND_POINTS} ${label} 50%−`,
        },
        {
          price: lowBand.max,
          color: lowColor,
          title: `±${RANGE_EDGE_BAND_POINTS} ${label} L+`,
        },
        {
          price: lowBand.min,
          color: lowColor,
          title: `±${RANGE_EDGE_BAND_POINTS} ${label} L−`,
        },
      ]
      for (const s of specs) {
        try {
          entryBandLinesRef.current.push(
            host.createPriceLine({
              price: s.price,
              color: s.color,
              lineWidth: entryLive ? 2 : 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: s.title,
            })
          )
        } catch {
          /* ignore */
        }
      }
    }

    setEntryBandsVisible(entryBandLinesRef.current.length > 0)
    const names = overlays.map((o) => o.label).filter(Boolean)
    const nameList = names.join(' · ')
    setEntryBandLabel(
      anyLive
        ? `${nameList} ±${RANGE_EDGE_BAND_POINTS} H / 50% / L entry zones`
        : `${nameList} ±${RANGE_EDGE_BAND_POINTS} H / 50% / L (shaped — entry window closed or inactive)`
    )

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
    }
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
    lunchLocked,
    usRangeShaped,
    showOr30,
    showIbBreakouts,
    showUsRange,
    showLunchRange,
    livePrice,
    focusTick,
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
      lunchRange: lunchRangeRef.current,
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
    lunchLocked,
    usRangeShaped,
    focusTick,
  ])

  const wasInEdgeBandRef = useRef(false)
  const edgeAlertPrimedRef = useRef(false)
  const edgeAlertInstrumentRef = useRef(instrument)
  useEffect(() => {
    const nowIn = !!edgeProximity
    if (edgeAlertInstrumentRef.current !== instrument) {
      edgeAlertInstrumentRef.current = instrument
      edgeAlertPrimedRef.current = false
      wasInEdgeBandRef.current = false
    }
    // Remount/refresh: wait for a live price, then seed band membership so
    // already-in-band after load ≠ rising edge (bare chart still computes ranges).
    if (!edgeAlertPrimedRef.current) {
      if (livePrice == null) return
      edgeAlertPrimedRef.current = true
      wasInEdgeBandRef.current = nowIn
      return
    }
    if (
      shouldFireRangeEdgeAlert(wasInEdgeBandRef.current, nowIn) &&
      edgeProximity &&
      livePrice != null &&
      onDeskAlert &&
      isDeskInstrument(instrument) &&
      claimDeskNoteCooldown(
        `range_edge_${edgeProximity.label}_${edgeProximity.edge}`,
        instrument,
        90_000
      )
    ) {
      const msg = formatRangeEdgeAlertMessage({
        instrument,
        proximity: edgeProximity,
        livePrice,
        mode: 'either',
      })
      onDeskAlert({
        ...msg,
        instrument,
        dedupeKey: deskNoteClaimKey(
          `range_edge_${edgeProximity.label}_${edgeProximity.edge}`,
          instrument
        ),
      })
    }
    wasInEdgeBandRef.current = nowIn
  }, [edgeProximity, livePrice, instrument, onDeskAlert])

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
      lunch: lunchLocked,
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
            'Optional morning probe (±10 H / 50% / L). If unused when IB locks → hand off to IB.',
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
              ? `Tokyo IB shaped now — entry window opens ${deskLocalHmsAsTraderDisplay('13:30:00', 'Asia/Tokyo')} ${TRADER_DISPLAY_LABEL} (±10 of locked H / 50% / L). Until then US Range is slot 2.`
              : 'IB entry window is open (±10 of locked H / 50% / L).',
        })
        onDeskAlert({
          ...note,
          instrument,
          dedupeKey: deskNoteClaimKey('range_ib', instrument),
        })
      }
    }
    if (next.lunch && !prev.lunch) {
      const r = lunchRangeRef.current
      if (r && claimDeskNoteOnce('range_lunch', instrument)) {
        const atrSnap = buildRangeAtrSnapshot({
          rangeLabel: 'Lunch-range',
          high: r.high,
          low: r.low,
          bars: candlesRef.current,
        })
        const note = formatRangeShapedNote({
          instrument,
          rangeLabel: 'Lunch-range',
          high: r.high,
          low: r.low,
          atrLine: atrSnap ? formatRangeAtrAdviceLine(atrSnap) : null,
          nextHint: 'Lunch-range entry window is open (±10 of locked H / 50% / L).',
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
            'Already shaped from prior NYC session. Entry when US Range window unlocks (±10 H / 50% / L).',
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
    lunchLocked,
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

  const renderSavedHighlightBoxes = () => {
    const chart = chartRef.current
    const series = candleRef.current
    if (!chart || !series) return null
    const timeScale = chart.timeScale()

    // Reference chartScrollTrigger to register active scroll updates and solve compiler checks
    void chartScrollTrigger

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

      // Convert times directly to coordinates
      const leftCoord = timeScale.timeToCoordinate(
        toChartTime(hl.startUnix, chartTzRef.current) as UTCTimestamp
      )
      const rightCoord = timeScale.timeToCoordinate(
        toChartTime(hl.endUnix, chartTzRef.current) as UTCTimestamp
      )
      
      // Handle price boundaries: use exact priceHigh and priceLow drawn by user (do NOT extend vertically)
      const pHigh = hl.priceHigh || hl.rangeHigh || (candles.length > 0 ? Math.max(...candles.map(c => c.high)) : 100000)
      const pLow = hl.priceLow || hl.rangeLow || (candles.length > 0 ? Math.min(...candles.map(c => c.low)) : 0)

      const topCoord = series.priceToCoordinate(pHigh)
      const bottomCoord = series.priceToCoordinate(pLow)

      if (leftCoord == null || rightCoord == null || topCoord == null || bottomCoord == null) return null

      const left = Math.min(leftCoord, rightCoord)
      const top = Math.min(topCoord, bottomCoord)
      const width = Math.abs(rightCoord - leftCoord)
      const height = Math.abs(bottomCoord - topCoord)

      const isUnsent = hl.id === 'unsent-drawn-time'
      const theme = getHighlightTheme(idx, isUnsent)

      return (
        <div
          key={hl.id}
          className={`absolute border border-dashed rounded pointer-events-none z-20 flex flex-col justify-between p-1.5 ${theme.border} ${theme.bg}`}
          style={{
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
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
      className={`flex flex-col gap-2 ${
        isFullscreen
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
              {inst}
            </button>
          ))}
        </div>

        <span className="rounded-lg border border-surface-600 px-2.5 py-1.5 text-xs font-semibold text-gray-400">
          5m
        </span>

        {/* Level toggle — only while this desk session has an active playbook */}
        {deskSessionLive && deskLevelsActive && (
          <button
            type="button"
            title={
              showLevels
                ? 'Hide AI/structure levels (Press L)'
                : 'Show AI/structure levels (Press L)'
            }
            onClick={() => setShowLevels((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
              showLevels
                ? 'bg-surface-600 border-surface-400 text-gray-200'
                : 'bg-transparent border-surface-600 text-gray-600 hover:text-gray-400'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            {showLevels
              ? 'Levels (L)'
              : levels.some((l) => l.source === 'ai')
                ? 'AI Levels (L)'
                : 'Levels (L)'}
            {levels.length > 0
              ? ` (${levels.filter((l) => l.source === 'ai' || l.source === 'structure').length})`
              : ''}
          </button>
        )}

        {/* IB H/L + BRK/REJ + ±10 (Press B) — off on refresh */}
        {deskSessionLive && (
          <button
            type="button"
            title={
              showIbBreakouts
                ? 'IB H/L + BRK/REJ markers + ±10 bands on. BRK needs close beyond H/L + RVOL when volume exists; REJ = wick reject (Press B).'
                : 'Show IB high/low, break/reject markers, and ±10 bands (Press B)'
            }
            onClick={() => setShowIbBreakouts((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
              showIbBreakouts
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

        {/* NYC Lunch Range — Dow & Nasdaq only (Press N) — not the “Lunch break” playbook prep */}
        {deskSessionLive && (instrument === 'DOW' || instrument === 'NASDAQ') && (
          <button
            type="button"
            title={
              showLunchRange
                ? `NYC Lunch range lines 12:00–13:30 ${TRADER_DISPLAY_LABEL} + LN BRK/REJ after 13:30 (Press N)`
                : 'Show NYC Lunch high / low / 50% (Press N). This is the lunch RANGE, not playbook “Lunch break” prep.'
            }
            onClick={() => setShowLunchRange((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
              showLunchRange
                ? 'bg-orange-600/30 border-orange-500/50 text-orange-100'
                : 'bg-transparent border-surface-600 text-gray-500 hover:text-orange-200 hover:border-orange-500/40'
            }`}
          >
            <span className={`w-2 h-2 rounded-full inline-block ${showLunchRange ? 'bg-orange-400' : 'bg-gray-600'}`} />
            <span>Lunch Range (N)</span>
            {lunchShaped && (
              <span className="text-[10px] font-normal text-orange-200/80">
                {rangeSignalSummary.lunch > 0 ? `${rangeSignalSummary.lunch}` : '0'}
              </span>
            )}
          </button>
        )}

        {/* Nikkei US Range H/L toggle (Press U) — IB-style lines only */}
        {deskSessionLive && instrument === 'NIKKEI' && (
          <button
            type="button"
            title={
              showUsRange
                ? 'US H/L lines visible (Press U)'
                : 'Show current US session H/L (Press U)'
            }
            onClick={() => setShowUsRange((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
              showUsRange
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
                ? `OR30 H/L + OR BRK/REJ — ${or30WindowLabel(instrument)} (Press R). BRK = close beyond H/L (RVOL when volume exists). REJ = wick reject.`
                : `Show first 30m opening range H/L + break/reject markers — ${or30WindowLabel(instrument)} (Press R)`
            }
            onClick={() => setShowOr30((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
              showOr30
                ? 'bg-teal-600/30 border-teal-500/50 text-teal-100'
                : 'bg-transparent border-surface-600 text-gray-500 hover:text-teal-200 hover:border-teal-500/40'
            }`}
          >
            <span className={`w-2 h-2 rounded-full inline-block ${showOr30 ? 'bg-teal-400' : 'bg-gray-600'}`} />
            <span>OR30 BRK/REJ (R)</span>
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
            className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-wide animate-pulse shadow-sm ${
              ibProximity.level === 'HIGH'
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
            className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-wide animate-pulse shadow-sm ${
              edgeProximity.edge === 'high'
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

        {deskSessionLive &&
          deskLevelsActive &&
          !playbookOpen &&
          levels.some((l) => l.source === 'ai' || l.source === 'structure') && (
          <button
            type="button"
            title={
              afternoonWatch
                ? tokyoDesk
                  ? 'Show Tokyo watch playbook (Press P)'
                  : 'Show afternoon watch playbook (Press P)'
                : canPlaceOrder
                  ? `Show ${playbookButtonLabel} (Press P)`
                  : inEntryWindow
                    ? `Show ${playbookButtonLabel} — clock in to place (Press P)`
                    : `Show ${playbookButtonLabel} (Press P)`
            }
            onClick={() => {
              playbookUserClosedRef.current = false
              setPlaybookOpen(true)
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg bg-transparent border-surface-600 text-gray-500 hover:text-gray-300"
          >
            {playbookButtonLabel} (P)
          </button>
        )}


        {deskSessionLive &&
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
                : 'Outside entry windows (morning / IB / lunch-range) — levels are watch-only'
            }
          >
            Watch only
          </span>
        )}

        {/* Live Voice — toggle like playbook; panel when open */}
        <button
          type="button"
          title={
            voiceOpen
              ? 'Hide Live Voice coach (Press V)'
              : clockedIn
                ? 'Show Live Voice — hold Mic to talk during morning entry (Press V)'
                : 'Live Voice — clock in first, then talk during morning entry (Press V)'
          }
          onClick={() => setVoiceOpen((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
            voiceOpen
              ? 'bg-violet-600/30 border-violet-500/50 text-violet-100'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-violet-200 hover:border-violet-500/40'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full inline-block ${
              voiceOpen ? 'bg-violet-400 animate-pulse' : 'bg-gray-600'
            }`}
          />
          Voice (V)
        </button>

        {/* Draw Zone tool — next to voice */}
        <button
          type="button"
          title={
            drawZoneActive
              ? 'Drag on chart to draw zone — or press D / Esc to cancel'
              : drawnZone
                ? 'Zone drawn — send or discard'
                : 'Draw a BUY/SHORT zone on the chart for Leo (Press D)'
          }
          onClick={() => {
            if (drawZoneActive) {
              cancelDrawnZone()
            } else {
              setDrawZoneActive(true)
              setDrawnZone(null)
              clearDrawnZoneLines()
            }
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
            drawZoneActive
              ? 'bg-amber-600/30 border-amber-500/50 text-amber-100 animate-pulse'
              : drawnZone
                ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-100'
                : 'bg-transparent border-surface-600 text-gray-500 hover:text-amber-200 hover:border-amber-500/40'
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="4" width="12" height="8" rx="1" strokeLinecap="round" />
            <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2 2" />
          </svg>
          {drawZoneActive ? 'Drag to draw…' : 'Draw Zone (D)'}
        </button>

        {/* Highlight Time Range tool */}
        <button
          type="button"
          title={
            drawTimeActive
              ? 'Click 1st & 2nd points on chart to highlight — or press T / Esc to cancel'
              : drawnTime
                ? 'Time highlighted — send or discard'
                : 'Highlight a specific time range to discuss with Leo (Press T)'
          }
          onClick={() => {
            if (drawTimeActive) {
              cancelDrawnTime()
            } else {
              setDrawTimeActive(true)
              setDrawnTime(null)
            }
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
            drawTimeActive
              ? 'bg-violet-600/30 border-violet-500/50 text-violet-100 animate-pulse'
              : drawnTime
                ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-100'
                : 'bg-transparent border-surface-600 text-gray-500 hover:text-violet-200 hover:border-violet-500/40'
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="12" height="12" rx="1" strokeLinecap="round" />
            <line x1="8" y1="2" x2="8" y2="14" strokeDasharray="2 2" />
          </svg>
          {drawTimeActive ? 'Click 1st & 2nd points…' : 'Highlight Time (T)'}
        </button>

        {/* Highlights Recall List Button */}
        <button
          type="button"
          title="Open list of saved session highlights"
          onClick={() => setHighlightsListOpen((prev) => !prev)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
            highlightsListOpen
              ? 'bg-violet-600 border-violet-500 text-white shadow-lg'
              : 'bg-violet-950/40 border-violet-500/40 text-violet-300 hover:text-white hover:border-violet-500 shadow-sm'
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="4" y1="4" x2="12" y2="4" strokeLinecap="round" />
            <line x1="4" y1="8" x2="12" y2="8" strokeLinecap="round" />
            <line x1="4" y1="12" x2="12" y2="12" strokeLinecap="round" />
          </svg>
          {`Previous Highlights (${savedHighlights.length})`}
        </button>

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
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
            riskBox
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

        {/* Draggable price alert — Telegram on touch (A key) */}
        <button
          type="button"
          title={
            priceAlert
              ? priceAlert.armed !== false
                ? 'Price alert armed — drag line or Esc to dismiss (A)'
                : 'Price alert fired — dismiss (A / Esc)'
              : 'Place draggable price alert (Press A)'
          }
          onClick={togglePriceAlert}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
            priceAlert
              ? priceAlert.armed !== false
                ? 'bg-violet-600/30 border-violet-500/50 text-violet-100 animate-pulse'
                : 'bg-violet-950/40 border-violet-500/30 text-violet-300/70'
              : 'bg-transparent border-surface-600 text-gray-500 hover:text-violet-200 hover:border-violet-500/40'
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v2M8 12v2M3.5 8H2M14 8h-1.5M4.2 4.2l1 1M10.8 10.8l1 1M4.2 11.8l1-1M10.8 5.2l1-1" />
            <circle cx="8" cy="8" r="2.5" className="fill-violet-500/40 stroke-violet-400" />
          </svg>
          {priceAlert
            ? priceAlert.armed !== false
              ? 'Price Alert Active'
              : 'Alert Fired'
            : 'Price Alert (A)'}
        </button>

        {/* Toolbar Direction Switcher when Order tool is active */}
        {riskBox && (
          <button
            type="button"
            onClick={toggleRiskBoxDirection}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-extrabold uppercase rounded-lg border transition shadow-sm ${
              riskBox.direction === 'LONG'
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
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
            isFullscreen
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
                className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                  isBroken
                    ? 'border-amber-500/80 bg-amber-950/80 text-amber-200 animate-pulse font-bold'
                    : 'border-sky-700/50 bg-sky-950/40 text-sky-200'
                }`}
              >
                {isBroken ? '⚠️ Level Invalidated (Structure Broke) · Working ' : 'Working '}
                {pendingLimit.direction} @ {pendingLimit.price.toLocaleString()}
              </span>
              {onCancelPending && (
                <button
                  type="button"
                  onClick={onCancelPending}
                  className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide shadow-sm transition ${
                    isBroken
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
            In trade · Entry / SL / TP on chart
          </span>
        )}

        {/* Live price ticker */}
        <div className="ml-auto flex items-center gap-3">
          {livePrice && (
            <div className="flex flex-col items-end leading-tight">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{INSTRUMENT_META[instrument].label}</span>
                <span
                  className="price-mono text-xl font-extrabold transition-colors duration-300"
                  style={{ color: INSTRUMENT_META[instrument].color }}
                  title="OANDA mid (bid+ask)/2 — compare TradingView to OANDA:US30USD / NAS100USD / JP225USD"
                >
                  {livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                  isUp ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                }`}>
                  {isUp ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}
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
          )}
          {/* Position overlay indicator */}
          {positionOverlay && (
            <span className={`text-xs px-2 py-0.5 rounded font-semibold border ${
              positionOverlay.direction === 'long'
                ? 'text-green-400 border-green-800 bg-green-900/30'
                : 'text-red-400 border-red-800 bg-red-900/30'
            }`}>
              {positionOverlay.direction === 'long' ? '▲' : '▼'} POSITION
            </span>
          )}
          {pendingLimit && !positionOverlay && (
            <span className="text-xs px-2 py-0.5 rounded font-semibold border text-sky-300 border-sky-800 bg-sky-900/30">
              WORKING {pendingLimit.direction.toUpperCase()}
            </span>
          )}
          {dataMode === 'live' ? (
            <span
              className={`flex items-center gap-1 text-xs ${
                candleFeed === 'yahoo' ? 'text-amber-400' : 'text-green-500'
              }`}
              title={
                candleFeed === 'yahoo'
                  ? 'Candles from Yahoo (cash index) — may diverge from TradingView OANDA mid. Tip still prefers OANDA when streaming.'
                  : 'OANDA mid feed — match TradingView to US30_USD / NAS100_USD / JP225_USD Mid'
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                  candleFeed === 'yahoo' ? 'bg-amber-400' : 'bg-green-500'
                }`}
              />
              {candleFeed === 'yahoo' ? 'LIVE · YAHOO' : 'LIVE · OANDA'}
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
          <span title="Blue IB high/low + BRK/REJ + ±10 — toggle with Press B (off on refresh).">
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
          <span title="Teal opening-range high/low (first 30m). ±10 entries only after the 30m window locks.">
            <span className={or30Shaped ? 'text-teal-500' : 'text-gray-600'}>
              OR30 {or30Shaped ? (or30Locked ? 'locked' : 'forming') : 'waiting'}
            </span>
            {or30Shaped && (
              <span className="text-gray-600">
                {' '}
                · BRK/REJ {showOr30 ? rangeSignalSummary.or30 : 'off'}
              </span>
            )}
          </span>
          {(instrument === 'DOW' || instrument === 'NASDAQ') && (
            <span title={`NYC lunch 12:00–13:30 ${TRADER_DISPLAY_LABEL} — ±10 entries only after 13:30 lock`}>
              <span className={lunchShaped ? 'text-orange-400' : 'text-gray-600'}>
                Lunch {lunchShaped ? (lunchLocked ? 'locked' : 'forming') : `after 12:00 ${TRADER_DISPLAY_LABEL}`}
              </span>
              {lunchShaped && (
                <span className="text-gray-600">
                  {' '}
                  · LN {showLunchRange ? rangeSignalSummary.lunch : 'off'}
                </span>
              )}
            </span>
          )}
          {instrument === 'NIKKEI' && (
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
                className="inline-block h-2.5 w-3.5 rounded-[2px]"
                style={{ backgroundColor: s.color.replace(/[\d.]+\)$/, '0.55)') }}
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
        {lunchShaped && (
          <>
            <span className="text-gray-600">·</span>
            <span
              className="flex items-center gap-1.5 normal-case tracking-normal"
              title={`NYC Lunch Session Range — 12:00–13:30 ${TRADER_DISPLAY_LABEL} high / low / 50% half-back (Dow & Nasdaq)`}
            >
              <span
                className="inline-block w-4 border-t-2"
                style={{ borderColor: NYC_LUNCH_COLORS.high }}
              />
              <span style={{ color: NYC_LUNCH_COLORS.high }}>Lunch H</span>
              <span
                className="inline-block w-4 border-t-2"
                style={{ borderColor: NYC_LUNCH_COLORS.low }}
              />
              <span style={{ color: NYC_LUNCH_COLORS.low }}>L</span>
              <span
                className="inline-block w-4 border-t-2"
                style={{ borderColor: NYC_LUNCH_COLORS.mid }}
              />
              <span style={{ color: NYC_LUNCH_COLORS.mid }}>50%</span>
              <span className="text-gray-600">12:00–13:30 {TRADER_DISPLAY_LABEL} → PM</span>
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
      <div className="flex-1 relative rounded-xl border border-gray-300 overflow-hidden bg-[#fafafa]" style={{ minHeight: 400 }}>
        <div ref={containerRef} className="absolute inset-0 z-0" />
        <div
          ref={sessionOverlayRef}
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ opacity: 1, transition: 'none', willChange: 'opacity' }}
        />

        {/* Render Saved 2D Time Highlights */}
        {renderSavedHighlightBoxes()}

        {/* Saved Highlights List glassmorphism popup panel */}
        {highlightsListOpen && (
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
                            className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition border ${
                              hl.visible
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
        {positionOverlay && (
          <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[min(360px,70%)]">
            {aiVerdict ? (
              <div
                className={`rounded-md border px-2 py-1 shadow-lg backdrop-blur-sm ${
                  aiVerdict.verdict.toLowerCase() === 'reversal'
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
        {voiceOpen && (
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
        {drawnZone && (
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
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold uppercase tracking-wide transition border ${
                  drawnZoneSide === 'BUY'
                    ? 'bg-emerald-600/40 border-emerald-500/60 text-emerald-200 shadow-sm'
                    : 'bg-transparent border-[#30363d] text-gray-500 hover:text-emerald-300 hover:border-emerald-500/40'
                }`}
              >
                BUY Zone
              </button>
              <button
                onClick={() => setDrawnZoneSide('SHORT')}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold uppercase tracking-wide transition border ${
                  drawnZoneSide === 'SHORT'
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
        {drawnTime && (
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
          const candleSeries = candleRef.current
          const entryY = candleSeries ? candleSeries.priceToCoordinate(riskBox.entryPrice) : null
          const tpY = candleSeries ? candleSeries.priceToCoordinate(riskBox.profitTarget) : null
          const slY = candleSeries ? candleSeries.priceToCoordinate(riskBox.stopLoss) : null

          // Progressive session risk: fill #1 = 1%, #2 = 0.5%, #3 = 0.25%
          const sessionRiskPct = riskPercentForSessionAttempt(attemptsUsed)
          const sz = previewPositionSizing(
            riskBox.entryPrice,
            liveAccountSize,
            riskBox.direction,
            riskBox.stopLoss,
            sessionRiskPct
          )
          const rawUnits = sz?.position_size ?? 1
          const posSize = typeof rawUnits === 'number' && Number.isFinite(rawUnits)
            ? (rawUnits >= 1 ? Math.round(rawUnits * 100) / 100 : Math.round(rawUnits * 1000) / 1000)
            : 1
          const lossVal = (sz?.risk_amount ?? 0).toFixed(2)
          const targetPts = Math.abs(riskBox.profitTarget - riskBox.entryPrice)
          const profitVal = (posSize * targetPts).toFixed(2)

          const minLineY = entryY != null && tpY != null && slY != null ? Math.min(entryY, tpY, slY) : null
          const maxLineY = entryY != null && tpY != null && slY != null ? Math.max(entryY, tpY, slY) : null

          return (
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              {/* Dashed Vertical Blue Connecting Line */}
              {minLineY != null && maxLineY != null && (
                <div
                  className="absolute border-r-2 border-dashed border-blue-500/80 pointer-events-none"
                  style={{
                    left: 'calc(50% + 140px)',
                    top: `${minLineY}px`,
                    height: `${Math.abs(maxLineY - minLineY)}px`,
                  }}
                />
              )}

              {/* Take Profit (TP) Line Pill Badge — Drag to adjust TP */}
              {tpY != null && (
                <div
                  onMouseDown={onRiskLineMouseDown('TP')}
                  className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group"
                  style={{
                    left: '42%',
                    top: `${tpY - 13}px`,
                  }}
                  title="Drag Take Profit line up or down"
                >
                  <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md group-hover:border-emerald-300 transition">
                    <span className="text-emerald-400">+{profitVal} CAD</span>
                    <span className="text-emerald-600 mx-1.5">|</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); cancelRiskBox() }}
                      className="text-gray-400 hover:text-emerald-200 transition font-bold"
                      title="Remove TP"
                    >✕</button>
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
                </div>
              )}

              {/* Entry Line Pill Badge: [ Buy ] / [ Sell ] (Places Order) | [ Units | Limit | ✕ ] (Drag to adjust Entry) */}
              {entryY != null && (
                <div
                  onMouseDown={onRiskLineMouseDown('ENTRY')}
                  className="absolute flex items-center gap-2 pointer-events-auto cursor-ns-resize group"
                  style={{
                    left: '32%',
                    top: `${entryY - 14}px`,
                  }}
                  title="Drag Entry within ±10 of range high, 50% mid, or low"
                >
                  {/* Explicit Buy / Sell Placement Button — ONLY BUTTON THAT PLACES ORDER */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      confirmRiskBoxOrder()
                    }}
                    className={`px-3 py-1 text-xs font-extrabold uppercase rounded-md shadow-md transition border ${
                      riskBox.direction === 'LONG'
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
                    className="w-7 h-7 flex items-center justify-center text-xs font-mono font-extrabold rounded-md shadow-md bg-[#161b22]/95 border border-gray-600 text-gray-200 hover:text-white hover:border-amber-400 hover:bg-surface-700 transition"
                    title={`Click to switch to ${riskBox.direction === 'LONG' ? 'SHORT / SELL' : 'LONG / BUY'} mode`}
                  >
                    ⇄
                  </button>

                  {/* Pill Badge with Non-Clickable Order Type Label */}
                  <div className="flex items-center rounded-md border border-blue-400 bg-white/95 px-3 py-1 text-xs font-mono font-bold text-gray-900 shadow-xl transition hover:border-blue-500">
                    <span className="font-sans uppercase font-extrabold tracking-wider text-[11px] select-none">
                      Limit
                    </span>
                    <span className="text-gray-400 mx-1.5">|</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); cancelRiskBox() }}
                      className="text-gray-400 hover:text-red-500 transition font-bold"
                      title="Close (Esc)"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="w-3 h-3 rounded-full border-2 border-white shadow-md bg-blue-500 group-hover:scale-125 transition-transform" />
                </div>
              )}

              {/* Stop Loss (SL) Line Pill Badge — Drag to adjust SL (progressive session risk) */}
              {slY != null && (
                <div
                  onMouseDown={onRiskLineMouseDown('SL')}
                  className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group"
                  style={{
                    left: '42%',
                    top: `${slY - 13}px`,
                  }}
                  title={`Drag Stop Loss — size adjusts to keep ${sessionRiskPct}% account risk (fill ${Math.min(attemptsUsed + 1, 3)}/3)`}
                >
                  <div className="flex items-center rounded border border-dashed border-amber-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-amber-300 shadow-md group-hover:border-amber-300 transition">
                    <span className="text-amber-400">
                      -{lossVal} CAD · {sessionRiskPct}%
                    </span>
                    <span className="text-amber-600 mx-1.5">|</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); cancelRiskBox() }}
                      className="text-gray-400 hover:text-amber-200 transition font-bold"
                      title="Remove SL"
                    >✕</button>
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
                </div>
              )}
            </div>
          )
        })()}

        {/* Draggable price alert line + pill badge */}
        {priceAlert && !riskBox && (() => {
          const candleSeries = candleRef.current
          const alertY = candleSeries
            ? candleSeries.priceToCoordinate(priceAlert.price)
            : null
          const armed = priceAlert.armed !== false

          return (
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              {alertY != null && (
                <div
                  onMouseDown={armed ? onPriceAlertLineMouseDown : undefined}
                  className={`absolute flex items-center gap-2 pointer-events-auto group ${
                    armed ? 'cursor-ns-resize' : 'cursor-default'
                  }`}
                  style={{
                    left: '38%',
                    top: `${alertY - 14}px`,
                  }}
                  title={
                    armed
                      ? 'Drag alert line — Telegram when price touches (soft signal, not an order)'
                      : 'Alert fired — dismiss with ✕ or press A / Esc'
                  }
                >
                  <div
                    className={`flex items-center rounded-md border px-3 py-1 text-xs font-mono font-bold shadow-xl transition ${
                      armed
                        ? 'border-violet-400 bg-violet-950/95 text-violet-100 group-hover:border-violet-300'
                        : 'border-violet-500/40 bg-violet-950/50 text-violet-300/70'
                    }`}
                  >
                    <span className="font-sans uppercase font-extrabold tracking-wider text-[11px] select-none">
                      {armed ? 'Alert' : 'Fired'}
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
                    className={`w-3 h-3 rounded-full border-2 border-white shadow-md transition-transform ${
                      armed
                        ? 'bg-violet-500 group-hover:scale-125'
                        : 'bg-violet-500/40'
                    }`}
                  />
                </div>
              )}
            </div>
          )
        })()}

        {/* Filled position — drag SL / TP to adjust brackets on OANDA + journal */}
        {editableOverlay && !riskBox && onAdjustBrackets && (() => {
          const candleSeries = candleRef.current
          const tpY = candleSeries
            ? candleSeries.priceToCoordinate(editableOverlay.profitTarget)
            : null
          const slY = candleSeries
            ? candleSeries.priceToCoordinate(editableOverlay.stopLoss)
            : null
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
              {tpY != null && (
                <div
                  onMouseDown={saving ? undefined : onBracketLineMouseDown('TP')}
                  className={`absolute flex items-center gap-1.5 pointer-events-auto group ${
                    saving ? 'cursor-wait opacity-70' : 'cursor-ns-resize'
                  }`}
                  style={{ left: '48%', top: `${tpY - 13}px` }}
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
              )}
              {slY != null && (
                <div
                  onMouseDown={saving ? undefined : onBracketLineMouseDown('SL')}
                  className={`absolute flex items-center gap-1.5 pointer-events-auto group ${
                    saving ? 'cursor-wait opacity-70' : 'cursor-ns-resize'
                  }`}
                  style={{ left: '48%', top: `${slY - 13}px` }}
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
              )}
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
          const candleSeries = candleRef.current
          const tpY = candleSeries
            ? candleSeries.priceToCoordinate(editablePending.profitTarget)
            : null
          const slY = candleSeries
            ? candleSeries.priceToCoordinate(editablePending.stopLoss)
            : null
          const saving = workingBracketAdjustStatus === 'saving'
          return (
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              {tpY != null && (
                <div
                  onMouseDown={saving ? undefined : onWorkingTpMouseDown}
                  className={`absolute flex items-center gap-1.5 pointer-events-auto group ${
                    saving ? 'cursor-wait opacity-70' : 'cursor-ns-resize'
                  }`}
                  style={{ left: '48%', top: `${tpY - 13}px` }}
                  title={`Drag Take Profit @ ${editablePending.profitTarget.toLocaleString()} — saves on release`}
                >
                  <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md">
                    TP {editablePending.profitTarget.toLocaleString()}
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
                </div>
              )}
              {slY != null && (
                <div
                  className="absolute flex items-center gap-1.5 pointer-events-none opacity-90"
                  style={{ left: '48%', top: `${slY - 13}px` }}
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
              )}
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
                    const { strategyMagnets, snapRanges } = getStrategyRiskBundle()
                    const hit = findRangeEdgeBandHit(rationaleModal.entryPrice, snapRanges)
                    if (!hit) {
                      onDeskAlert?.({
                        kind: 'entry_band_deny',
                        title: 'Off-band entry',
                        body: RANGE_EDGE_OFF_BAND_MESSAGE,
                        telegram: '',
                        instrument,
                      })
                      return
                    }
                    onLevelSelect?.(rationaleModal.entryPrice, {
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

        {/* Playbook — morning / IB / lunch-break / lunch-range */}
        {deskLevelsActive &&
          playbookOpen &&
          (noInBandLevelsMessage ||
            levels.some((l) => l.source === 'ai' || l.source === 'structure')) && (
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
                {watchPlaybookHint}
              </p>
              {noInBandLevelsMessage && (
                <p className="rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-2 text-[11px] leading-snug text-amber-100">
                  {noInBandLevelsMessage}
                </p>
              )}
              {levels
                .filter((l) => l.source === 'ai' || l.source === 'structure')
                .slice(0, 4)
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
                        // Strategy SL/TP from active playbook range (not zone-only)
                        const { strategyRange, strategyMagnets } =
                          getStrategyRiskBundle()
                        onLevelSelect?.(l.price, {
                          type: side === 'SHORT' ? 'resistance' : 'support',
                          side,
                          preferredDirection: side === 'SHORT' ? 'SHORT' : 'LONG',
                          reasoning: l.reasoning || why,
                          source: l.source === 'structure' ? 'structure' : 'ai',
                          strategyRange,
                          strategyMagnets,
                        })
                      }}
                      className={`w-full rounded-xl border px-2.5 py-2.5 text-left text-[11px] transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                        isRes
                          ? 'border-red-800/80 bg-[#2a1518] text-red-200'
                          : 'border-emerald-800/80 bg-[#12241c] text-emerald-200'
                      } ${isPrimary ? 'ring-1 ring-white/25' : 'opacity-90'}`}
                      title={
                        canPlaceOrder
                          ? why
                          : afternoonWatch
                            ? `${why} · watch only (click to focus price)`
                            : inEntryWindow
                              ? `${why} · clock in to place (click to focus)`
                              : `${why} · prep (click to focus price)`
                      }
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
                          className={`mt-1.5 text-[9px] font-semibold uppercase tracking-wide ${
                            reaction.startsWith('held')
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
