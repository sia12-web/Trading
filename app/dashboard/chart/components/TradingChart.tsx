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

import { useEffect, useRef, useState, useCallback } from 'react'
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
import { aiLevelsUrl, resolveDeskLevels } from '@/lib/trading/deskLevels'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import { DraggableDeskWidget } from '@/app/dashboard/components/DraggableDeskWidget'
import { DESK_CHART_THEME } from '@/lib/chart/deskChartTheme'
import {
  isDeskHoursNow,
  isLiveBarsAllowed,
  isLunchFreezeActive,
  isChartStreamAllowed,
  sessionFor,
} from '@/lib/trading/sessionGate'

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
  NASDAQ: { label: 'NASDAQ',   symbol: '^IXIC', color: '#a78bfa', basePrice: 17800 },
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

/** Same desk window for every index: last 5 cash days + overnight lead-in (clock by instrument). */
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
  /** When user clicks a level price (from panel or highlight) */
  onLevelSelect?:      (price: number, meta?: { type?: string; reasoning?: string }) => void
  /** Morning session: allow placing limits from the chart */
  canPlaceOrder?: boolean
  /** Bump to force a levels reload after SL/TP (system memory updated) */
  levelsRefreshKey?: number
}

// ─── Main TradingChart component ──────────────────────────────────────────────

export function TradingChart({
  onInstrumentChange,
  onPriceUpdate,
  onQuoteTick,
  onDataModeChange,
  positionOverlay,
  pendingLimit = null,
  onCancelPending,
  aiVerdict = null,
  jumpToPriceRef,
  lockedInstrument,
  onLevelSelect,
  canPlaceOrder = false,
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
  const levelLinesRef = useRef<any[]>([])
  /** Host for level/SL/TP price lines — seeded once; candle setData must not touch it */
  const priceLineHostRef = useRef<ISeriesApi<'Line'> | null>(null)
  const priceLineHostSeededRef = useRef(false)
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const candleRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastCandleRef = useRef<OHLCV | null>(null)
  const quoteInFlightRef = useRef(false)
  const didFitRef = useRef(false)
  /** True while user is dragging/zooming — pause React work for TV-smooth pan */
  const interactingRef = useRef(false)

  const [instrument,  setInstrumentState] = useState<Instrument>(lockedInstrument || 'DOW')
  const [candles,     setCandles]    = useState<OHLCV[]>([])
  const [levels,      setLevels]     = useState<LevelLine[]>([])
  const levelsRef = useRef<LevelLine[]>([])
  const [tooltip,     setTooltip]    = useState<TooltipData | null>(null)
  const [livePrice,   setLivePrice]  = useState<number | null>(null)
  const [priceChange, setPriceChange] = useState<number>(0)
  const [showLevels,  setShowLevels] = useState(true)
  const showLevelsRef = useRef(true)
  const [chartReady,  setChartReady] = useState(false)
  const [barsFrozen, setBarsFrozen] = useState(false)
  const [sessionMsg, setSessionMsg] = useState<string | null>(null)
  const candlesRef = useRef<OHLCV[]>([])
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
  /** Axis / tooltip clocks — ET for DOW/NASDAQ, JST for NIKKEI */
  const chartFmtRef = useRef<DeskChartFmt>(makeDeskChartFormatters(lockedInstrument || 'DOW'))

  const setInstrument = useCallback((inst: Instrument) => {
    if (lockedInstrument && inst !== lockedInstrument) return
    setInstrumentState(inst)
    onInstrumentChange?.(inst)
  }, [onInstrumentChange, lockedInstrument])

  // Follow day's locked instrument
  useEffect(() => {
    if (lockedInstrument) {
      setInstrumentState(lockedInstrument)
      onInstrumentChange?.(lockedInstrument)
    }
  }, [lockedInstrument, onInstrumentChange])

  // Register jumpToPrice so level clicks can scroll/highlight on the chart
  useEffect(() => {
    if (!jumpToPriceRef) return
    jumpToPriceRef.current = (price: number) => {
      onLevelSelect?.(price)
      if (!candleRef.current) return
      try {
        const marker = candleRef.current.createPriceLine({
          price,
          color:            '#ffffff40',
          lineWidth:        1,
          lineStyle:        LineStyle.Dashed,
          axisLabelVisible: true,
          title:            '→ ' + price.toLocaleString('en-US', { minimumFractionDigits: 0 }),
        })
        // Auto-remove the highlight after 3 seconds
        setTimeout(() => {
          try { candleRef.current?.removePriceLine(marker) } catch {}
        }, 3000)
      } catch {}
    }
  }, [jumpToPriceRef, onLevelSelect])

  const meta = INSTRUMENT_META[instrument]

  // ── Load levels — SAME pipeline as the simulation desk (shared deskLevels) ───
  const loadLevels = useCallback(async (inst: Instrument, freshCandles?: OHLCV[]) => {
    // Outside desk hours: keep whatever is already on the chart (manual Hide only clears view)
    if (!isDeskHoursNow(new Date(), inst).open) {
      return
    }

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

    // Structure fallback anchored at this market's cash open (yesterday range)
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
    // Live morning: no overnight sim bias here — rank by conviction only (BOTH focus)
    const resolved = resolveDeskLevels(aiRows, barsForFallback, openUnix, sess.tz, 'none')

    for (const l of resolved.levels) {
      const isRes = String(l.type).toLowerCase().includes('resist')
      const side = isRes ? 'SHORT' : 'BUY'
      const stars = Math.max(1, Math.min(5, Math.round((l.conviction || 5) / 2)))
      const starLabel = `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`
      const rank = l.rank === 'watch' ? 'WATCH' : 'PRIMARY'
      const status = reactionStatus(l.marketVerdict, l.marketOutcome)
      byPrice.set(l.level, {
        price: l.level,
        type: isRes ? 'resistance' : 'support',
        status,
        conviction: l.conviction,
        reasoning: l.reasoning,
        source: l.source,
        marketVerdict: l.marketVerdict,
        marketOutcome: l.marketOutcome,
        testedCount: l.testedCount,
        successCount: l.successCount,
        label: `${rank} ${side} ${starLabel} · ${l.level.toLocaleString()}`,
      })
    }

    // Keep playbook order (primary focus first), not price sort
    setLevels(
      resolved.levels.map((l) => byPrice.get(l.level)!).filter(Boolean)
    )
  }, []) // levels only — setLevels is stable

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
    if (!isDeskHoursNow(new Date(), inst).open) return
    try {
      await fetch('/api/levels/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument: inst, trigger: 'cadence' }),
      })
    } catch {
      /* non-fatal — still try to paint last known verdicts */
    }
    await loadLevels(inst)
  }, [loadLevels])

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
    const candleSeries = chart.addCandlestickSeries({
      upColor:         '#26a69a',   // TradingView classic teal-green
      downColor:       '#ef5350',   // TradingView classic red
      borderUpColor:   '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor:     '#26a69a',
      wickDownColor:   '#ef5350',
    })

    const priceLineHost = chart.addLineSeries({
      color: 'rgba(0,0,0,0)',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceScaleId: 'right',
    })

    // Anchored VWAP + ±1/±2/±3σ bands (from NY 9:30 of 5 trading days ago)
    const bandOpts = {
      color: VWAP_COLORS.band,
      lineWidth: 1 as const,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    }
    const vwapSeries = {
      upper3: chart.addLineSeries({ ...bandOpts, title: '+3σ' }),
      upper2: chart.addLineSeries({ ...bandOpts, title: '+2σ' }),
      upper1: chart.addLineSeries({ ...bandOpts, title: '+1σ' }),
      vwap: chart.addLineSeries({
        color: VWAP_COLORS.vwap,
        lineWidth: 2,
        priceLineVisible: false,
        // lastValueVisible causes axis churn while panning — keep off for smooth scroll
        lastValueVisible: false,
        title: 'AVWAP',
      }),
      lower1: chart.addLineSeries({ ...bandOpts, title: '-1σ' }),
      lower2: chart.addLineSeries({ ...bandOpts, title: '-2σ' }),
      lower3: chart.addLineSeries({ ...bandOpts, title: '-3σ' }),
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
      levelLinesRef.current = []
      positionLinesRef.current = []
    }
  }, []) // initialize once only

  // ── Load candle data when instrument changes (5m only) ───────────────────────
  useEffect(() => {
    if (!chartReady) return
    let cancelled = false

    const load = async () => {
      const meta = INSTRUMENT_META[instrument]
      const tfSec = DESK_BAR_SECONDS
      const lunchFreeze = isLunchFreezeActive(instrument)
      const stream = isChartStreamAllowed(instrument)
      const tradeLive = isLiveBarsAllowed(instrument)
      setBarsFrozen(lunchFreeze)
      setSessionMsg(
        lunchFreeze
          ? stream.reason ||
              'Lunch freeze — afternoon + overnight unlock after cash close.'
          : null
      )

      // Always load history. Lunch freeze clips only *today's* afternoon; after cash
      // close / next day the full continuum returns (never stuck frozen overnight).
      try {
        // NIKKEI needs a longer window — Yahoo ^N225 5d is often truncated; OANDA JP225 fills gaps
        const days = instrument === 'NIKKEI' ? 7 : 5
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

  // Reset fit + price-line host when switching instrument
  useEffect(() => {
    didFitRef.current = false
    priceLineHostSeededRef.current = false
    try {
      priceLineHostRef.current?.setData([])
    } catch {
      /* ignore */
    }
    levelLinesRef.current = []
    positionLinesRef.current = []
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

    for (const level of levelsRef.current) {
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
    const candleData: CandlestickData[] = ordered.map(c => ({
      time:  c.time,
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
    }))

    candleRef.current.setData(candleData)
    lastCandleRef.current = ordered[ordered.length - 1] ?? null

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

    // Seed host once (never again) so price lines bind to the right scale
    const host = priceLineHostRef.current
    if (host && !priceLineHostSeededRef.current && ordered.length > 0) {
      const a = ordered[0]!
      const b = ordered[ordered.length - 1]!
      host.setData([
        { time: a.time, value: a.close },
        { time: b.time, value: b.close },
      ])
      priceLineHostSeededRef.current = true
    }
    paintLevelLines()

    const ts = chartRef.current.timeScale()
    if (!didFitRef.current) {
      // First load — show ~5 sessions with the tip pinned near the right edge
      const width = containerRef.current?.clientWidth ?? 900
      const spacing = Math.min(7, Math.max(2.5, (width - 40) / Math.max(ordered.length, 1)))
      ts.applyOptions({ barSpacing: spacing, rightOffset: 4 })
      const leftPad = Math.max(8, Math.ceil(ordered.length * 0.04))
      requestAnimationFrame(() => {
        const last = Math.max(ordered.length - 1, 1)
        ts.setVisibleLogicalRange({
          from: -leftPad,
          to: last + 2,
        })
        didFitRef.current = true
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

  // ── Chart stream: trade live open→lunch; lunch freeze tip; after cash close continuum ─
  useEffect(() => {
    if (!chartReady || candles.length === 0 || dataMode === 'synthetic') return

    const CANDLE_REFRESH_MS = 45_000
    let lastUiPriceAt = 0
    let wasFrozen = isLunchFreezeActive(instrument)

    const syncFreezeBanner = () => {
      const freeze = isLunchFreezeActive(instrument)
      setBarsFrozen(freeze)
      setSessionMsg(freeze ? isChartStreamAllowed(instrument).reason : null)
      // Cash close unlock — pull afternoon + overnight bars immediately
      if (wasFrozen && !freeze) {
        wasFrozen = false
        void refreshCandles()
      } else {
        wasFrozen = freeze
      }
      return freeze
    }

    const applyQuote = (
      price: number,
      changePct: number,
      quoteTs: number,
      tradeLive: boolean
    ) => {
      onPriceUpdate?.(price)
      if (!interactingRef.current) {
        const now = Date.now()
        if (now - lastUiPriceAt >= 250) {
          lastUiPriceAt = now
          setLivePrice(price)
          setPriceChange(changePct)
          onQuoteTick?.(Math.floor(now / 1000))
        }
      }

      if (!tradeLive) return
      const last = lastCandleRef.current
      if (!last || !candleRef.current) return

      const tfSec = DESK_BAR_SECONDS
      const lastT = last.time as number
      if (quoteTs >= lastT + tfSec) {
        const barTime = Math.floor(quoteTs / tfSec) * tfSec
        if (barTime > lastT) {
          const bar: OHLCV = {
            time: barTime as UTCTimestamp,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: 0,
          }
          lastCandleRef.current = bar
          try {
            candleRef.current.update({
              time: bar.time,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
            })
          } catch {
            /* ignore */
          }
          return
        }
      }

      const updated: OHLCV = {
        ...last,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
      }
      lastCandleRef.current = updated
      try {
        candleRef.current.update({
          time: updated.time,
          open: updated.open,
          high: updated.high,
          low: updated.low,
          close: updated.close,
        })
      } catch {
        /* ignore */
      }
    }

    const pollQuote = async () => {
      if (syncFreezeBanner()) return
      if (!isChartStreamAllowed(instrument).open) return
      if (quoteInFlightRef.current) return
      quoteInFlightRef.current = true
      const tradeLive = isLiveBarsAllowed(instrument).open
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
          applyQuote(json.price, json.change_pct ?? 0, ts, tradeLive)
        }
      } catch {
        /* keep */
      } finally {
        quoteInFlightRef.current = false
      }
    }

    const refreshCandles = async () => {
      if (isLunchFreezeActive(instrument)) return
      if (!isChartStreamAllowed(instrument).open) return
      try {
        const days = instrument === 'NIKKEI' ? 7 : 5
        const res = await fetch(
          `/api/trading/candles?instrument=${instrument}&timeframe=${DESK_TIMEFRAME}&days=${days}&quote=0&_=${Date.now()}`,
          { cache: 'no-store' }
        )
        if (!res.ok) return
        const json = await res.json()
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
        const tradeLive = isLiveBarsAllowed(instrument).open
        if (live && tradeLive) {
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

        lastCandleRef.current = trimmed[trimmed.length - 1]!
        if (structureChanged) {
          // Afternoon unlock / overnight tip — full setData + AVWAP rebuild
          didFitRef.current = false
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

    syncFreezeBanner()
    void pollQuote()
    void refreshCandles()
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
    if (candleRefreshRef.current) clearInterval(candleRefreshRef.current)
    // Keep a steady poll so lunch→close→overnight transitions wake without reload
    tickIntervalRef.current = setInterval(pollQuote, 5_000)
    candleRefreshRef.current = setInterval(refreshCandles, CANDLE_REFRESH_MS)
    // Faster quotes only while morning trade desk is live
    const tradeQuote = setInterval(() => {
      if (isLiveBarsAllowed(instrument).open && !isLunchFreezeActive(instrument)) {
        void pollQuote()
      }
    }, 1000)

    return () => {
      clearInterval(tradeQuote)
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
      if (candleRefreshRef.current) clearInterval(candleRefreshRef.current)
      tickIntervalRef.current = null
      candleRefreshRef.current = null
    }
  }, [chartReady, instrument, candles.length, dataMode, onQuoteTick, onPriceUpdate])

  // ── Click chart to place order at that price (morning trading) ─────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container || !candleRef.current || !canPlaceOrder || !onLevelSelect || positionOverlay) return

    const onClick = (e: MouseEvent) => {
      if (!candleRef.current) return
      const rect = container.getBoundingClientRect()
      const y = e.clientY - rect.top
      const price = candleRef.current.coordinateToPrice(y)
      if (price == null || !Number.isFinite(Number(price)) || Number(price) <= 0) return

      // Snap to nearest AI/structure level within 0.25% when close
      const tradeLevels = levelsRef.current.filter(
        (l) => l.source === 'ai' || l.source === 'structure'
      )
      let best = Number(price)
      let bestType: string | undefined
      let bestDist = Infinity
      for (const l of tradeLevels) {
        const d = Math.abs(l.price - best) / best
        if (d < bestDist && d <= 0.0025) {
          bestDist = d
          best = Number(l.price)
          bestType = String(l.type)
        }
      }
      onLevelSelect(best, bestType ? { type: bestType } : undefined)
    }

    container.style.cursor = 'crosshair'
    container.addEventListener('click', onClick)
    return () => {
      container.removeEventListener('click', onClick)
      container.style.cursor = ''
    }
  }, [canPlaceOrder, onLevelSelect, chartReady, positionOverlay])

  // ── Position / working-limit overlay lines (host series — survives candle setData)
  // Independent of Hide levels — AI/structure lines toggle separately.
  useEffect(() => {
    const host = priceLineHostRef.current
    positionLinesRef.current.forEach(line => {
      try { host?.removePriceLine(line) } catch {}
    })
    positionLinesRef.current = []

    if (!host || !chartReady) {
      try {
        host?.applyOptions({ autoscaleInfoProvider: undefined })
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
      // Keep limit/entry + SL + TP inside the visible price scale
      if (prices.length >= 2) {
        const min = Math.min(...prices)
        const max = Math.max(...prices)
        const pad = Math.max((max - min) * 0.1, max * 0.0008)
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
          host.applyOptions({ autoscaleInfoProvider: undefined })
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
      host.applyOptions({ autoscaleInfoProvider: undefined })
    } catch { /* ignore */ }
  }, [positionOverlay, pendingLimit, aiVerdict, chartReady])

  // ── Emit live price to parent ─────────────────────────────────────────────────
  useEffect(() => {
    if (livePrice !== null) onPriceUpdate?.(livePrice)
  }, [livePrice, onPriceUpdate])

  const isUp = priceChange >= 0

  return (
    <div className="flex flex-col h-full gap-2">
      {barsFrozen && sessionMsg && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-950/50 px-3 py-2 text-[11px] text-amber-100">
          Live frozen · {sessionMsg}
        </div>
      )}
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Instrument tabs */}
        <div className="tab-bar">
          {(Object.keys(INSTRUMENT_META) as Instrument[]).map(inst => (
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

        {/* Level toggle — AI/structure only; working limit + SL/TP always stay */}
        <button
          type="button"
          title={
            showLevels
              ? 'Hide AI/structure levels (working limit + SL/TP stay on chart)'
              : 'Show AI/structure levels'
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
            ? 'Hide levels'
            : levels.some((l) => l.source === 'ai')
              ? 'AI Levels'
              : 'Levels'}
          {levels.length > 0
            ? ` (${levels.filter((l) => l.source === 'ai' || l.source === 'structure').length})`
            : ''}
        </button>

        {canPlaceOrder && !positionOverlay && !pendingLimit && (
          <button
            type="button"
            title="Place a working limit at the live price (fills only when price reaches it)"
            onClick={() => {
              const px = livePrice ?? lastCandleRef.current?.close
              if (px == null || !Number.isFinite(px)) return
              onLevelSelect?.(px, { type: 'market' })
            }}
            className="rounded-lg border border-sky-500/50 bg-sky-600/90 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-sky-500"
          >
            Place limit
          </button>
        )}

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
              >
                {livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
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
            {deskClockFor(instrument).openLabel} · 5 sessions · ±1/2/3σ
          </span>
        </span>
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
                className={`rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm ${
                  aiVerdict.verdict.toLowerCase() === 'reversal'
                    ? 'border-violet-500/50 bg-violet-950/85 text-violet-100'
                    : aiVerdict.verdict.toLowerCase() === 'pullback'
                      ? 'border-amber-500/50 bg-amber-950/85 text-amber-100'
                      : 'border-emerald-500/40 bg-emerald-950/85 text-emerald-100'
                }`}
              >
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                  <span>AI manage</span>
                  <span className="rounded bg-black/30 px-1.5 py-0.5">
                    {aiVerdict.verdict === 'reversal'
                      ? 'TAKE PROFIT / EXIT'
                      : aiVerdict.verdict === 'hold'
                        ? 'HOLD — no TP yet'
                        : aiVerdict.verdict === 'pullback'
                          ? 'PULLBACK — watch TP'
                          : aiVerdict.verdict}
                  </span>
                  <span className="font-mono normal-case tracking-normal opacity-80">
                    {aiVerdict.confidence}%
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug opacity-90 line-clamp-3">
                  {aiVerdict.reason}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-700/40 bg-amber-950/80 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-amber-200 shadow-lg backdrop-blur-sm">
                AI manage · scoring…
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

        {/* Morning playbook — follows Levels / Hide levels toggle only */}
        {showLevels &&
          levels.some((l) => l.source === 'ai' || l.source === 'structure') && (
          <DraggableDeskWidget
            storageKey="desk-playbook-live"
            defaultPos={{ x: 24, y: 88 }}
            title="Morning playbook"
            onClose={() => setShowLevels(false)}
          >
            <div className="space-y-1.5 p-2">
              {levels
                .filter((l) => l.source === 'ai' || l.source === 'structure')
                .slice(0, 4)
                .map((l, i) => {
                  const isRes = l.type === 'resistance'
                  const stars = Math.max(1, Math.min(5, Math.round((l.conviction || 5) / 2)))
                  const isPrimary = (l.label || '').startsWith('PRIMARY')
                  const reaction = reactionLabel(l)
                  return (
                    <button
                      key={`${l.price}-${i}`}
                      type="button"
                      onClick={() =>
                        onLevelSelect?.(l.price, {
                          type: String(l.type),
                          reasoning: l.reasoning,
                        })
                      }
                      className={`w-full rounded-xl border px-2.5 py-2.5 text-left text-[11px] transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                        isRes
                          ? 'border-red-800/80 bg-[#2a1518] text-red-200'
                          : 'border-emerald-800/80 bg-[#12241c] text-emerald-200'
                      } ${isPrimary ? 'ring-1 ring-white/25' : 'opacity-90'}`}
                      title={l.reasoning ?? l.label}
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
