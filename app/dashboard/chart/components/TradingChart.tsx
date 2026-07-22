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
  lastNTradingSessions as trimDeskCandles,
  sessionLegendLabel,
  sessionLegendOrder,
  SESSION_STYLES as SESSION_RANGE_STYLES,
  VWAP_COLORS as SHARED_VWAP_COLORS,
  type SessionHighlightSpan,
} from '@/lib/chart/sessionVwap'
import {
  previewLevelOrderPrices,
  resolveChartLimitPick,
} from '@/lib/trading/chartLevelPick'
import { previewPositionSizing } from '@/lib/trading/positionSizing'
import {
  aiLevelsUrl,
  resolveDeskLevels,
  resolveAfternoonDeskLevels,
  computeInitialBalance,
  ibLineSeriesData,
} from '@/lib/trading/deskLevels'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import { DraggableDeskWidget } from '@/app/dashboard/components/DraggableDeskWidget'
import { LiveVoicePanel } from '@/app/dashboard/chart/components/LiveVoicePanel'
import { DESK_CHART_THEME } from '@/lib/chart/deskChartTheme'
import {
  DESK_INSTRUMENTS,
  isLiveBarsAllowed,
  isChartStreamAllowed,
  isLiveTipStreamAllowed,
  isLevelPaintAllowed,
  isAfternoonWatchWindow,
  isAnyLiveFocusWindowActive,
  liveVisibleInstruments,
  sessionFor,
} from '@/lib/trading/sessionGate'
import {
  getDeskInstrumentPreference,
  setDeskInstrumentPreference,
  deskVisibleLogicalRange,
  deskBarSpacing,
} from '@/lib/trading/deskInstrumentPreference'
import {
  instrumentTick,
  snapDeskPrice,
  snapStopToTick,
  snapTargetToTick,
} from '@/lib/trading/instrumentTicks'

function defaultManualStop(limit: number, direction: 'LONG' | 'SHORT'): number {
  const pct = 0.0035
  return direction === 'LONG' ? limit * (1 - pct) : limit * (1 + pct)
}

type DeskChartFmt = {
  formatTime: (unix: number, withSeconds?: boolean) => string
  formatDate: (unix: number, style?: 'day' | 'month' | 'year') => string
  tickMarkFormatter: (time: UTCTimestamp | string | number, tickMarkType: TickMarkType) => string
  timeFormatter: (time: UTCTimestamp | string | number) => string
  tzLabel: string
}

/** DOW/NASDAQ → ET · NIKKEI → JST — same clocks as session color bands. */
function makeDeskChartFormatters(instrument: Instrument): DeskChartFmt {
  const clock = deskClockFor(instrument)
  const tzLabel = instrument === 'NIKKEI' ? 'JST' : 'ET'
  const fmtTime = new Intl.DateTimeFormat('en-US', {
    timeZone: clock.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const fmtTimeSec = new Intl.DateTimeFormat('en-US', {
    timeZone: clock.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const fmtDay = new Intl.DateTimeFormat('en-US', {
    timeZone: clock.timeZone,
    day: 'numeric',
    month: 'short',
  })
  const fmtMonth = new Intl.DateTimeFormat('en-US', {
    timeZone: clock.timeZone,
    month: 'short',
    year: '2-digit',
  })
  const fmtYear = new Intl.DateTimeFormat('en-US', {
    timeZone: clock.timeZone,
    year: 'numeric',
  })

  const formatTime = (unix: number, withSeconds = false) =>
    (withSeconds ? fmtTimeSec : fmtTime).format(new Date(unix * 1000))
  const formatDate = (unix: number, style: 'day' | 'month' | 'year' = 'day') => {
    const d = new Date(unix * 1000)
    if (style === 'year') return fmtYear.format(d)
    if (style === 'month') return fmtMonth.format(d)
    return fmtDay.format(d)
  }
  const toUnix = (time: UTCTimestamp | string | number) =>
    typeof time === 'number' ? time : Math.floor(new Date(String(time)).getTime() / 1000)

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
    }
  ) => void
  /** Morning session: allow placing limits from the chart */
  canPlaceOrder?: boolean
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
  aiVerdict = null,
  jumpToPriceRef,
  lockedInstrument,
  allowedInstruments = null,
  onLevelSelect,
  canPlaceOrder = false,
  deskLevelsActive = false,
  deskAttended = false,
  clockedIn = false,
  levelsRefreshKey = 0,
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
  const [ibShaped, setIbShaped] = useState(false)
  const levelLinesRef = useRef<any[]>([])
  /** Host for level/SL/TP price lines — seeded once; candle setData must not touch it */
  const priceLineHostRef = useRef<ISeriesApi<'Line'> | null>(null)
  const priceLineHostSeededRef = useRef(false)
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
  const levelsRef = useRef<LevelLine[]>([])
  const [tooltip,     setTooltip]    = useState<TooltipData | null>(null)
  const [livePrice,   setLivePrice]  = useState<number | null>(null)
  const [priceChange, setPriceChange] = useState<number>(0)
  const [showLevels,  setShowLevels] = useState(true)
  /** Floating morning playbook — independent of chart level lines. */
  const [playbookOpen, setPlaybookOpen] = useState(true)
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

  // Highlight Time Range tool — drag horizontally to highlight duration for Leo
  const [drawTimeActive, setDrawTimeActive] = useState(false)
  const [drawnTime, setDrawnTime] = useState<{ startUnix: number; endUnix: number } | null>(null)
  const [drawnTimeSending, setDrawnTimeSending] = useState(false)
  const drawTimeOverlayRef = useRef<HTMLDivElement | null>(null)

  // TradingView-style Interactive Risk/Reward Limit Tool (O key / toolbar button)
  const [riskBoxActive, setRiskBoxActive] = useState(false)
  const [riskBox, setRiskBox] = useState<{
    direction: 'LONG' | 'SHORT'
    entryPrice: number
    stopLoss: number
    profitTarget: number
  } | null>(null)
  const riskBoxLinesRef = useRef<any[]>([])
  const [rationaleModal, setRationaleModal] = useState<{
    open: boolean
    entryPrice: number
    stopLoss: number
    profitTarget: number
    direction: 'LONG' | 'SHORT'
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

  // Open Live Voice once when you clock in (same discoverability as playbook)
  useEffect(() => {
    if (clockedIn) setVoiceOpen(true)
  }, [clockedIn])
  const showLevelsRef = useRef(true)
  const [chartReady,  setChartReady] = useState(false)
  const candlesRef = useRef<OHLCV[]>([])
  const instrumentRef = useRef<Instrument>(instrument)
  /** LIVE = real Yahoo data; SYNTHETIC = random fallback (never trade off this) */
  const [dataMode, setDataModeState] = useState<'live' | 'synthetic'>('live')
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
  /** Axis / tooltip clocks — ET for DOW/NASDAQ, JST for NIKKEI */
  const chartFmtRef = useRef<DeskChartFmt>(makeDeskChartFormatters('DOW'))

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

    const afternoonWatch = isAfternoonWatchWindow(new Date(), inst)
    const tokyoDesk = inst === 'NIKKEI'
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
    if (afternoonWatch) {
      try {
        const ap = await fetch(
          `/api/trading/afternoon-playbook?instrument=${encodeURIComponent(inst)}`
        )
        if (ap.ok) {
          const aj = await ap.json()
          afternoonCandidates = Array.isArray(aj.candidates) ? aj.candidates : []
        }
      } catch {
        /* optional until morning-review has run */
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

    // Live morning: conviction rank. Afternoon: reaction + IB watch playbook.
    const resolved = afternoonWatch
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
      // NY post-lunch = PM; Tokyo post-lunch is still the Asia cash day — no NY “PM” brand
      const watchTag = afternoonWatch ? (tokyoDesk ? '' : 'PM · ') : ''
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
    setLevels(
      resolved.levels.map((l) => byPrice.get(l.level)!).filter(Boolean)
    )
    if (!playbookUserClosedRef.current && resolved.levels.some((l) => l.source === 'ai' || l.source === 'structure')) {
      setPlaybookOpen(true)
    }
  }, [deskLevelsActive])

  // Keep axis / tooltips on the same desk clock as session colors (ET vs JST).
  // tickMarkFormatter is wired via chartFmtRef at create time (v4 applyOptions
  // does not accept tickMarkFormatter on timeScale).
  useEffect(() => {
    chartFmtRef.current = makeDeskChartFormatters(instrument)
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
  const gradeLevels = useCallback(async (inst: Instrument) => {
    if (!deskLevelsActive || !isLevelPaintAllowed(new Date(), inst).open) {
      if (instrumentRef.current === inst) {
        setLevels([])
        setPlaybookOpen(false)
      }
      return
    }
    try {
      await fetch('/api/levels/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument: inst,
          trigger: isAfternoonWatchWindow(new Date(), inst)
            ? 'afternoon'
            : 'cadence',
        }),
      })
    } catch {
      /* non-fatal — still try to paint last known verdicts */
    }
    await loadLevels(inst)
  }, [loadLevels, deskLevelsActive])

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
      upColor:         '#26a69a',
      downColor:       '#ef5350',
      borderUpColor:   '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor:     '#26a69a',
      wickDownColor:   '#ef5350',
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
    setChartReady(true)

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
      chart.remove()
      chartRef.current  = null
      candleRef.current = null
      priceLineHostRef.current = null
      priceLineHostSeededRef.current = false
      vwapSeriesRef.current = null
      ibSeriesRef.current = null
      levelLinesRef.current = []
      positionLinesRef.current = []
      setIbShaped(false)
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
        setLivePrice(null)
        setLevels([])
        return
      }
      // Never invent candles in production — fake OHLCV must not drive orders
      if (process.env.NODE_ENV === 'production') {
        setCandles([])
        setDataMode('live')
        setLivePrice(null)
        setLevels([])
        return
      }
      // Demo-only fallback during morning session if feeds fail (local/dev)
      const generated = generateCandles(meta.basePrice, tfSec)
      setCandles(generated)
      setDataMode('synthetic')
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
    const candleData: CandlestickData[] = ordered.map((c) => ({
      time: c.time,
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
      const vs = vwapSeriesRef.current
      if (vs && bands) {
        vs.vwap.setData(bands.vwap)
        vs.upper1.setData(bands.upper1)
        vs.lower1.setData(bands.lower1)
        vs.upper2.setData(bands.upper2)
        vs.lower2.setData(bands.lower2)
        vs.upper3.setData(bands.upper3)
        vs.lower3.setData(bands.lower3)
      } else if (vs) {
        vs.vwap.setData([])
        vs.upper1.setData([])
        vs.lower1.setData([])
        vs.upper2.setData([])
        vs.lower2.setData([])
        vs.upper3.setData([])
        vs.lower3.setData([])
      }

      // Initial Balance — first-hour H/L, line extended through cash close
      const ibSeries = ibSeriesRef.current
      if (ibSeries) {
        const sess = sessionFor(instrument)
        const todayLocal = new Intl.DateTimeFormat('en-CA', {
          timeZone: sess.tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date())
        const [oh, om] = sess.marketOpen.split(':').map(Number)
        const [ch, cm] = sess.marketClose.split(':').map(Number)
        const openUnix =
          instrument === 'NIKKEI'
            ? tokyoDateTimeToUnix(todayLocal, oh!, om || 0)
            : nyDateTimeToUnix(todayLocal, oh!, om || 0)
        const closeUnix =
          instrument === 'NIKKEI'
            ? tokyoDateTimeToUnix(todayLocal, ch!, cm || 0)
            : nyDateTimeToUnix(todayLocal, ch!, cm || 0)
        const tipUnix = ordered.length
          ? (ordered[ordered.length - 1]!.time as number)
          : closeUnix
        const ib = computeInitialBalance(
          ordered.map((c) => ({
            time: c.time as number,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
          openUnix
        )
        if (ib) {
          const pts = ibLineSeriesData(ib, Math.max(tipUnix, closeUnix))
          try {
            ibSeries.high.setData(
              pts.high.map((p) => ({
                time: p.time as UTCTimestamp,
                value: p.value,
              }))
            )
            ibSeries.low.setData(
              pts.low.map((p) => ({
                time: p.time as UTCTimestamp,
                value: p.value,
              }))
            )
            setIbShaped(true)
          } catch {
            ibSeries.high.setData([])
            ibSeries.low.setData([])
            setIbShaped(false)
          }
        } else {
          ibSeries.high.setData([])
          ibSeries.low.setData([])
          setIbShaped(false)
        }
      }

      // Seed host once (never again) so price lines bind to the right scale
      const host = priceLineHostRef.current
      if (host && !priceLineHostSeededRef.current && ordered.length > 0) {
        const a = ordered[0]!
        const b = ordered[ordered.length - 1]!
        if (ordered.length === 1 || a.time === b.time) {
          host.setData([{ time: a.time, value: a.close }])
        } else {
          host.setData([
            { time: a.time, value: a.close },
            { time: b.time, value: b.close },
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
        const merged: OHLCV = {
          ...serverTip,
          high: Math.max(serverTip.high, liveBefore.high, liveBefore.close),
          low: Math.min(serverTip.low, liveBefore.low, liveBefore.close),
          close: liveBefore.close,
        }
        lastCandleRef.current = merged
        try {
          candleRef.current.update({
            time: merged.time,
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
            time: liveBefore.time,
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

    const { rects } = projectSessionHighlightRects({
      spans: cached.spans,
      candleTimes: cached.candleTimes,
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

    const CANDLE_REFRESH_MS = 30_000
    let lastUiPriceAt = 0
    const fetchGen = ++candleFetchGenRef.current
    let sseHealthy = false

    /** Parent encodes focus + afternoon attendance; re-check chart stream for clock edge */
    const tipOpen = () =>
      tipStreamActive && isChartStreamAllowed(instrument).open

    const applyQuote = (
      price: number,
      changePct: number,
      quoteTs: number,
      streamLive: boolean
    ) => {
      // Guard: never paint / feed a quote from a different index scale
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
            time: bar.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          })
          lastCandleRef.current = bar
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
          time: updated.time,
          open: updated.open,
          high: updated.high,
          low: updated.low,
          close: updated.close,
        })
        lastCandleRef.current = updated
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
            trimmed[trimmed.length - 1] = {
              ...last,
              high: Math.max(last.high, live.high, live.close),
              low: Math.min(last.low, live.low, live.close),
              close: live.close,
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
              time: tip.time,
              open: tip.open,
              high: tip.high,
              low: tip.low,
              close: tip.close,
            })
          } catch {
            setCandles(trimmed)
          }
        }
        setDataMode('live')
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
    }, 1_000)
    // Safety reconcile even when SSE is healthy (drift / missed reconnect)
    const reconcile = setInterval(() => {
      if (!tipOpen()) return
      void pollQuote()
    }, 8_000)

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

  // ── Manual double-click removed in favor of TradingView Interactive Risk Box (T key) ───────

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
    
    const fmt = makeDeskChartFormatters(inst)
    const startStr = fmt.formatTime(drawnTime.startUnix)
    const endStr = fmt.formatTime(drawnTime.endUnix)
    const tzLabel = fmt.tzLabel

    try {
      const res = await fetch('/api/trading/live-voice/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instrument: inst,
          transcript: `I highlighted a time range on the chart from ${startStr} to ${endStr} ${tzLabel}. What do you think of the price action during this period?`
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

    setDrawnTimeSending(false)
    setDrawnTime(null)
  }, [drawnTime, instrument, lockedInstrument, voiceOpen])

  const cancelDrawnTime = useCallback(() => {
    setDrawnTime(null)
    setDrawTimeActive(false)
  }, [])

  // ── Draw Time Range Overlay Selection ──
  useEffect(() => {
    const container = containerRef.current
    if (!container || !chartReady || !drawTimeActive) return
    container.style.cursor = 'col-resize'

    let overlay = drawTimeOverlayRef.current
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.style.position = 'absolute'
      overlay.style.pointerEvents = 'none'
      overlay.style.zIndex = '25'
      overlay.style.display = 'none'
      overlay.style.backgroundColor = 'rgba(139, 92, 246, 0.15)' // semi-transparent purple
      overlay.style.borderLeft = '2px dashed #8b5cf6'
      overlay.style.borderRight = '2px dashed #8b5cf6'
      overlay.style.top = '0'
      overlay.style.bottom = '0'
      container.style.position = 'relative'
      container.appendChild(overlay)
      drawTimeOverlayRef.current = overlay
    }

    let startX: number | null = null
    let dragging = false

    const onMouseDown = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      startX = e.clientX - rect.left
      dragging = true
      overlay.style.left = `${startX}px`
      overlay.style.width = '0px'
      overlay.style.display = 'block'
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging || startX == null) return
      const rect = container.getBoundingClientRect()
      const currentX = e.clientX - rect.left
      const left = Math.min(startX, currentX)
      const width = Math.abs(startX - currentX)
      overlay.style.left = `${left}px`
      overlay.style.width = `${width}px`
    }

    const onMouseUp = (e: MouseEvent) => {
      if (!dragging || startX == null) return
      dragging = false
      const rect = container.getBoundingClientRect()
      const endX = e.clientX - rect.left
      
      const timeScale = chartRef.current?.timeScale()
      if (!timeScale) return

      const startLogical = timeScale.coordinateToLogical(startX)
      const endLogical = timeScale.coordinateToLogical(endX)

      if (startLogical != null && endLogical != null && candles.length > 0) {
        const startIdx = Math.max(0, Math.min(candles.length - 1, Math.round(startLogical)))
        const endIdx = Math.max(0, Math.min(candles.length - 1, Math.round(endLogical)))
        const minIdx = Math.min(startIdx, endIdx)
        const maxIdx = Math.max(startIdx, endIdx)

        const startCandle = candles[minIdx]
        const endCandle = candles[maxIdx]
        if (startCandle && endCandle) {
          setDrawnTime({ startUnix: Number(startCandle.time), endUnix: Number(endCandle.time) })
        }
      }
      setDrawTimeActive(false)
      container.style.cursor = ''
    }

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
  }, [drawTimeActive, chartReady, candles])

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

  // Paint interactive risk box lines on chart
  useEffect(() => {
    clearRiskBoxLines()
    if (!riskBox || !chartReady) return
    const host = priceLineHostRef.current
    if (!host) return

    const isLong = riskBox.direction === 'LONG'
    const entryColor = isLong ? 'rgba(56, 189, 248, 0.95)' : 'rgba(251, 113, 133, 0.95)'
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

  const confirmRiskBoxOrder = useCallback(() => {
    if (!riskBox) return
    const { entryPrice, stopLoss, profitTarget, direction } = riskBox

    // Check if Leo was consulted for this session / price
    const discussedWithLeo = (levelsRef.current || []).some(
      (l) => Math.abs(l.price - entryPrice) / entryPrice < 0.005
    )

    if (discussedWithLeo) {
      const autoReason = `Manual ${direction} Zone (Discussed with Leo): Level @ ${entryPrice.toLocaleString()}, SL @ ${stopLoss.toLocaleString()}, TP @ ${profitTarget.toLocaleString()}`
      onLevelSelect?.(entryPrice, {
        source: 'manual',
        side: direction === 'LONG' ? 'BUY' : 'SHORT',
        preferredDirection: direction,
        reasoning: autoReason,
      })
      cancelRiskBox()
    } else {
      // Require user rationale for pure manual orders
      setUserRationale(`Technical structure entry @ ${entryPrice.toLocaleString()}`)
      setUserSlTpRationale(`Protective SL @ ${stopLoss.toLocaleString()}, Target TP @ ${profitTarget.toLocaleString()}`)
      setRationaleModal({
        open: true,
        entryPrice,
        stopLoss,
        profitTarget,
        direction,
        suggestedReason: `Manual ${direction} limit @ ${entryPrice.toLocaleString()}`,
      })
    }
  }, [riskBox, onLevelSelect, cancelRiskBox])

  // ── Keyboard shortcuts: V (Voice), L (Levels), P (Playbook), D (Draw Zone), T (Highlight Time), O (Risk Box), F (Fullscreen), Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return

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
        setRiskBoxActive((prev) => {
          if (prev || riskBox) {
            cancelRiskBox()
            return false
          } else {
            const rawPx = livePrice || (candles.length > 0 ? candles[candles.length - 1]!.close : 67000)
            const dir = 'LONG'
            setRiskBox({
              direction: dir,
              entryPrice: rawPx,
              stopLoss: defaultManualStop(rawPx, dir),
              profitTarget: dir === 'LONG' ? snapDeskPrice(instrument, rawPx * 1.0105) : snapDeskPrice(instrument, rawPx * 0.9895),
            })
            return true
          }
        })
      } else if (key === 'escape') {
        if (riskBoxActive || riskBox) {
          e.preventDefault()
          cancelRiskBox()
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
  }, [isFullscreen, drawZoneActive, drawnZone, drawTimeActive, drawnTime, toggleFullscreen, cancelDrawnZone, clearDrawnZoneLines, cancelDrawnTime])

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
      })
      if (pick.source === 'manual' || !pick.matched) {
        clearHoverPreview()
        return
      }

      const preview = previewLevelOrderPrices({
        level: pick.matched,
        instrument,
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

    if (!host || !chartReady) {
      try {
        host?.applyOptions({ autoscaleInfoProvider: (): null => null })
      } catch { /* ignore */ }
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
      // Expand candle scale just enough to keep entry/SL/TP in view — never orphan lines alone
      if (prices.length >= 1) {
        let min = Math.min(...prices)
        let max = Math.max(...prices)
        for (const c of candlesRef.current) {
          min = Math.min(min, c.low)
          max = Math.max(max, c.high)
        }
        const pad = Math.max((max - min) * 0.08, max * 0.0008)
        try {
          host.applyOptions({
            autoscaleInfoProvider: () => ({
              priceRange: {
                minValue: min - pad,
                maxValue: max + pad,
              },
            }),
          })
        } catch { /* ignore */ }
      } else {
        try {
          host.applyOptions({ autoscaleInfoProvider: (): null => null })
        } catch { /* ignore */ }
      }
    }

    if (positionOverlay) {
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
          price: positionOverlay.entryPrice,
          color: '#3b82f6',
          label: `Entry ${positionOverlay.direction.toUpperCase()} ${fmt(positionOverlay.entryPrice)}`,
          style: LineStyle.Solid,
          width: 2,
        },
        {
          price: positionOverlay.stopLoss,
          color: '#ef4444',
          label: `SL ${fmt(positionOverlay.stopLoss)}`,
          style: LineStyle.Dashed,
          width: 2,
        },
        {
          price: positionOverlay.profitTarget,
          color: tpColor,
          label: `${tpLabel} ${fmt(positionOverlay.profitTarget)}`,
          style: LineStyle.Dashed,
          width: 2,
        },
      ])
      return
    }

    if (pendingLimit) {
      const dir = pendingLimit.direction.toUpperCase()
      paint([
        {
          price: pendingLimit.price,
          color: '#38bdf8',
          label: `WORKING ${dir} ${fmt(pendingLimit.price)}`,
          style: LineStyle.Solid,
          width: 3,
        },
        {
          price: pendingLimit.stopLoss,
          color: '#ef4444',
          label: `SL ${fmt(pendingLimit.stopLoss)}`,
          style: LineStyle.Dotted,
          width: 2,
        },
        {
          price: pendingLimit.profitTarget,
          color: '#22c55e',
          label: `TP ${fmt(pendingLimit.profitTarget)}`,
          style: LineStyle.Dotted,
          width: 2,
        },
      ])
      return
    }

    try {
      host.applyOptions({ autoscaleInfoProvider: (): null => null })
    } catch { /* ignore */ }
  }, [positionOverlay, pendingLimit, aiVerdict, chartReady, clearHoverPreview])

  const isUp = priceChange >= 0
  /** Levels / Watch only / playbook — only while NY or Tokyo cash day is live (post-mount) */
  const tokyoDesk = instrument === 'NIKKEI'
  // Watch-only is afternoon only — morning prep/entry must never look like PM watch
  void focusTick
  const afternoonWatch =
    clockReady && isAfternoonWatchWindow(new Date(), instrument)
  const watchPlaybookTitle = tokyoDesk ? 'Tokyo watch' : 'Afternoon watch'
  const watchPlaybookHint = tokyoDesk
    ? 'Tokyo morning reaction + Initial Balance — watch only, no new orders.'
    : 'Morning reaction + Initial Balance — watch only, no new orders.'
  const playbookButtonLabel = afternoonWatch
    ? tokyoDesk
      ? 'Tokyo watch'
      : 'PM watch'
    : 'Playbook'
  const playbookPanelTitle = afternoonWatch ? watchPlaybookTitle : 'Morning playbook'

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
                  ? 'Show morning playbook panel (Press P)'
                  : 'Show morning playbook — entries at cash open (Press P)'
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

        {canPlaceOrder && !positionOverlay && !pendingLimit && onLevelSelect && (
          <button
            type="button"
            title="Manual limit at last price — 1% account risk, size adjusts to your stop"
            onClick={() => {
              const px = livePrice ?? lastCandleRef.current?.close
              if (px == null || !Number.isFinite(px)) return
              onLevelSelect(px, {
                type: 'manual',
                source: 'manual',
                reasoning: 'Manual limit at last traded price',
              })
            }}
            className="rounded-lg border border-amber-500/50 bg-amber-600/90 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-500"
          >
            Place limit
          </button>
        )}
        {canPlaceOrder && !positionOverlay && !pendingLimit && onLevelSelect && (
          <span
            className="hidden text-[10px] text-gray-500 sm:inline"
            title="Double-click chart · or use playbook / Place limit"
          >
            Double-click chart
          </span>
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
                ? 'Tokyo morning trading closed — levels are watch-only until cash close'
                : 'Morning trading closed — afternoon levels are watch-only'
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
              ? 'Drag horizontally on chart to highlight time — or press T / Esc to cancel'
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
          {drawTimeActive ? 'Drag to highlight…' : 'Highlight Time (T)'}
        </button>

        {/* Interactive TradingView Risk/Reward Limit Order Tool */}
        <button
          type="button"
          title={
            riskBox
              ? 'TradingView Risk Box active — place order or Esc to close'
              : 'Interactive Risk/Reward Limit Order Tool (Press T)'
          }
          onClick={() => {
            if (riskBoxActive || riskBox) {
              cancelRiskBox()
            } else {
              const rawPx = livePrice || (candles.length > 0 ? candles[candles.length - 1]!.close : 67000)
              const dir = 'LONG'
              setRiskBox({
                direction: dir,
                entryPrice: rawPx,
                stopLoss: defaultManualStop(rawPx, dir),
                profitTarget: snapDeskPrice(instrument, rawPx * 1.0105),
              })
              setRiskBoxActive(true)
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
          {riskBox ? 'Risk Box Active' : 'Risk Box (T)'}
        </button>

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

        {pendingLimit && !positionOverlay && (
          <>
            <span className="rounded-lg border border-sky-700/50 bg-sky-950/40 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
              Working {pendingLimit.direction} @{' '}
              {pendingLimit.price.toLocaleString()} · SL/TP on chart
            </span>
            {onCancelPending && (
              <button
                type="button"
                onClick={onCancelPending}
                className="rounded-lg border border-sky-500/60 bg-sky-600/80 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-sky-500"
              >
                Cancel limit
              </button>
            )}
          </>
        )}

        {positionOverlay && (
          <span className="rounded-lg border border-blue-700/50 bg-blue-950/40 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-200">
            In trade · Entry / SL / TP on chart
          </span>
        )}

        {/* Live price ticker */}
        <div className="ml-auto flex items-center gap-3">
          {livePrice && (
            <>
              <span className="text-xs text-gray-500">{INSTRUMENT_META[instrument].label}</span>
              <span
                className="price-mono text-xl font-bold transition-colors duration-300"
                style={{ color: INSTRUMENT_META[instrument].color }}
                title="OANDA mid (bid+ask)/2 — compare TradingView to OANDA:US30USD / NAS100USD / JP225USD, not CMC Markets"
              >
                {livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {dataMode === 'live' && (
                <span className="text-[9px] uppercase tracking-wider text-gray-600" title="Broker feed for fills">
                  OANDA mid
                </span>
              )}
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                isUp ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
              }`}>
                {isUp ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}
              </span>
            </>
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
            <span className="flex items-center gap-1 text-xs text-green-500">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              LIVE
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
      </div>
      <div className="flex-1 relative rounded-xl border border-gray-300 overflow-hidden bg-[#fafafa]" style={{ minHeight: 400 }}>
        <div ref={containerRef} className="absolute inset-0 z-0" />
        <div
          ref={sessionOverlayRef}
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ opacity: 1, transition: 'none', willChange: 'opacity' }}
        />
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
          <div className="absolute bottom-20 right-72 z-40 w-64 rounded-xl border border-violet-500/40 bg-[#161b22]/95 shadow-2xl backdrop-blur-md p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="2" width="12" height="12" rx="1" strokeLinecap="round" />
                  <line x1="8" y1="2" x2="8" y2="14" strokeDasharray="2 2" />
                </svg>
                Highlighted Time
              </span>
              <button
                onClick={cancelDrawnTime}
                className="text-gray-500 hover:text-white transition text-xs"
                title="Discard time highlight"
              >✕</button>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-[#30363d] bg-black/40 px-3 py-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Duration</span>
              <p className="font-mono text-xs font-semibold text-white leading-tight">
                {(() => {
                  const fmt = makeDeskChartFormatters((lockedInstrument ?? instrument) as Instrument)
                  return `${fmt.formatTime(drawnTime.startUnix)} – ${fmt.formatTime(drawnTime.endUnix)} ${fmt.tzLabel}`
                })()}
              </p>
            </div>
            <button
              onClick={sendDrawnTimeToLeo}
              disabled={drawnTimeSending}
              className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 text-white py-2 text-xs font-bold uppercase tracking-wider transition shadow-md disabled:opacity-50"
            >
              {drawnTimeSending ? 'Sending…' : 'Send Time to Leo'}
            </button>
          </div>
        )}

        {/* TradingView Interactive Risk/Reward Box HUD overlay on chart */}
        {riskBox && (
          <div className="absolute top-16 right-4 z-40 w-80 rounded-2xl border border-sky-500/50 bg-[#161b22]/95 shadow-2xl backdrop-blur-md p-4 space-y-3">
            {/* Top Bar: Buy/Sell pill + 1% Units + Limit Submit + Close */}
            <div className="flex items-center justify-between gap-2 border-b border-[#30363d] pb-3">
              <button
                type="button"
                onClick={() => {
                  const newDir = riskBox.direction === 'LONG' ? 'SHORT' : 'LONG'
                  const rawStop = defaultManualStop(riskBox.entryPrice, newDir)
                  const rawTp = newDir === 'LONG'
                    ? snapDeskPrice(instrument, riskBox.entryPrice * 1.0105)
                    : snapDeskPrice(instrument, riskBox.entryPrice * 0.9895)
                  setRiskBox({
                    ...riskBox,
                    direction: newDir,
                    stopLoss: rawStop,
                    profitTarget: rawTp,
                  })
                }}
                className={`px-3 py-1.5 text-xs font-extrabold uppercase rounded-lg shadow-sm transition border ${
                  riskBox.direction === 'LONG'
                    ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500'
                    : 'bg-red-600 border-red-500 text-white hover:bg-red-500'
                }`}
                title="Click to toggle BUY / SELL direction"
              >
                {riskBox.direction === 'LONG' ? 'Buy' : 'Sell'}
              </button>

              {/* TradingView Pill: [ Units | Limit | ✕ ] */}
              <div className="flex items-center rounded-lg border border-blue-500/60 bg-blue-950/40 px-2.5 py-1 text-xs font-mono font-bold text-blue-200 gap-2 shadow-inner">
                {(() => {
                  const sz = previewPositionSizing(
                    riskBox.entryPrice,
                    100000,
                    riskBox.direction,
                    riskBox.stopLoss,
                    1.0
                  )
                  return <span>{sz?.position_size ?? 1}</span>
                })()}
                <span className="text-gray-500">|</span>
                <button
                  type="button"
                  onClick={confirmRiskBoxOrder}
                  className="text-blue-300 hover:text-white font-sans uppercase tracking-wider text-[11px] font-extrabold transition"
                  title="Place 1% Limit Order"
                >
                  Limit
                </button>
                <span className="text-gray-500">|</span>
                <button
                  type="button"
                  onClick={cancelRiskBox}
                  className="text-gray-400 hover:text-red-400 transition"
                  title="Close Risk Box (Esc)"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Calculations Row: Entry | Reward:Risk */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-[#30363d] bg-black/40 p-2 space-y-0.5">
                <span className="text-[9px] text-gray-500 uppercase tracking-wide">Entry Price</span>
                <p className="font-mono font-bold text-white text-sm">
                  {riskBox.entryPrice.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border border-[#30363d] bg-black/40 p-2 space-y-0.5">
                <span className="text-[9px] text-gray-500 uppercase tracking-wide">Risk / Reward</span>
                <p className="font-mono font-bold text-emerald-400 text-sm">
                  {(() => {
                    const riskDist = Math.abs(riskBox.entryPrice - riskBox.stopLoss)
                    const rewardDist = Math.abs(riskBox.profitTarget - riskBox.entryPrice)
                    const ratio = riskDist > 0 ? rewardDist / riskDist : 0
                    return `${ratio.toFixed(2)} R`
                  })()}
                </p>
              </div>
            </div>

            {/* SL & TP Line Badges (TradingView Style with 1% Auto Sizing) */}
            <div className="space-y-2 text-xs">
              {/* Take Profit Pill */}
              <div className="flex items-center justify-between rounded-lg border border-dashed border-emerald-500/60 bg-emerald-950/20 px-3 py-2">
                <div className="space-y-0.5">
                  <span className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider">Take Profit (TP)</span>
                  <p className="font-mono font-bold text-emerald-300 text-xs">
                    {riskBox.profitTarget.toLocaleString()} ({(() => {
                      const sz = previewPositionSizing(
                        riskBox.entryPrice,
                        100000,
                        riskBox.direction,
                        riskBox.stopLoss,
                        1.0
                      )
                      const targetPts = Math.abs(riskBox.profitTarget - riskBox.entryPrice)
                      const profitVal = (sz?.position_size ?? 1) * targetPts
                      return `+${profitVal.toFixed(2)} USD`
                    })()})
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const step = instrumentTick(instrument)
                      setRiskBox({ ...riskBox, profitTarget: snapTargetToTick(instrument, riskBox.entryPrice, riskBox.profitTarget - step, riskBox.direction) })
                    }}
                    className="px-2 py-0.5 text-[10px] font-bold bg-emerald-900/40 text-emerald-200 rounded border border-emerald-700/50 hover:bg-emerald-800/60 transition"
                  >-</button>
                  <button
                    onClick={() => {
                      const step = instrumentTick(instrument)
                      setRiskBox({ ...riskBox, profitTarget: snapTargetToTick(instrument, riskBox.entryPrice, riskBox.profitTarget + step, riskBox.direction) })
                    }}
                    className="px-2 py-0.5 text-[10px] font-bold bg-emerald-900/40 text-emerald-200 rounded border border-emerald-700/50 hover:bg-emerald-800/60 transition"
                  >+</button>
                </div>
              </div>

              {/* Stop Loss Pill — Auto Recalculates 1% Position Size */}
              <div className="flex items-center justify-between rounded-lg border border-dashed border-amber-500/60 bg-amber-950/20 px-3 py-2">
                <div className="space-y-0.5">
                  <span className="text-[9px] text-amber-400 font-bold uppercase tracking-wider">Stop Loss (SL — 1.0% Risk)</span>
                  <p className="font-mono font-bold text-amber-300 text-xs">
                    {riskBox.stopLoss.toLocaleString()} ({(() => {
                      const sz = previewPositionSizing(
                        riskBox.entryPrice,
                        100000,
                        riskBox.direction,
                        riskBox.stopLoss,
                        1.0
                      )
                      return `-${(sz?.risk_amount ?? 100).toFixed(2)} USD`
                    })()})
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const step = instrumentTick(instrument)
                      setRiskBox({ ...riskBox, stopLoss: snapStopToTick(instrument, riskBox.entryPrice, riskBox.stopLoss - step, riskBox.direction) })
                    }}
                    className="px-2 py-0.5 text-[10px] font-bold bg-amber-900/40 text-amber-200 rounded border border-amber-700/50 hover:bg-amber-800/60 transition"
                  >-</button>
                  <button
                    onClick={() => {
                      const step = instrumentTick(instrument)
                      setRiskBox({ ...riskBox, stopLoss: snapStopToTick(instrument, riskBox.entryPrice, riskBox.stopLoss + step, riskBox.direction) })
                    }}
                    className="px-2 py-0.5 text-[10px] font-bold bg-amber-900/40 text-amber-200 rounded border border-amber-700/50 hover:bg-amber-800/60 transition"
                  >+</button>
                </div>
              </div>
            </div>

            <button
              onClick={confirmRiskBoxOrder}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 text-white py-2.5 text-xs font-extrabold uppercase tracking-wider transition shadow-lg flex items-center justify-center gap-1.5"
            >
              Place 1% Limit Order
            </button>
          </div>
        )}

        {/* Required Rationale Modal for Pure Manual Orders (No Leo conversation) */}
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
                Because this manual order was placed directly without a Live Voice discussion with Leo, please record your entry and SL/TP trade rationale for your daily performance journal:
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
                  onClick={() => setRationaleModal(null)}
                  className="flex-1 rounded-lg border border-[#30363d] bg-transparent py-2 text-xs font-semibold text-gray-400 hover:bg-[#21262d] hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const fullReason = `Manual ${rationaleModal.direction} entry: ${userRationale || 'Technical structure'} | SL/TP rationale: ${userSlTpRationale || 'Geometry bounds'}`
                    onLevelSelect?.(rationaleModal.entryPrice, {
                      source: 'manual',
                      side: rationaleModal.direction === 'LONG' ? 'BUY' : 'SHORT',
                      preferredDirection: rationaleModal.direction,
                      reasoning: fullReason,
                    })
                    setRationaleModal(null)
                    cancelRiskBox()
                  }}
                  className="flex-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white py-2 text-xs font-bold uppercase tracking-wider transition shadow-md"
                >
                  Confirm & Place Order
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Playbook — morning trade or post-lunch watch (read-only); NY vs Tokyo labels */}
        {deskLevelsActive &&
          playbookOpen &&
          levels.some((l) => l.source === 'ai' || l.source === 'structure') && (
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
              {afternoonWatch && (
                <p className="px-1 pb-1 text-[10px] leading-snug text-gray-500">
                  {watchPlaybookHint}
                </p>
              )}
              {!afternoonWatch && !canPlaceOrder && (
                <p className="px-1 pb-1 text-[10px] leading-snug text-gray-500">
                  Morning prep — review levels now; place limits at cash open.
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
                        if (!canPlaceOrder) return
                        // Match ticket to the same SHORT/BUY label shown on this row
                        onLevelSelect?.(l.price, {
                          type: side === 'SHORT' ? 'resistance' : 'support',
                          side,
                          preferredDirection: side === 'SHORT' ? 'SHORT' : 'LONG',
                          reasoning: l.reasoning || why,
                          source: l.source === 'structure' ? 'structure' : 'ai',
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
                            : `${why} · prep (click to focus price; entries at cash open)`
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
