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
  ColorType,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  computeAnchoredVwap,
  computeSessionHighlightRects,
  deskClockFor,
  lastNTradingSessions as trimDeskCandles,
  SESSION_STYLES as SESSION_RANGE_STYLES,
  VWAP_COLORS as SHARED_VWAP_COLORS,
  type SessionHighlightRect,
} from '@/lib/chart/sessionVwap'
import { aiLevelsUrl, resolveDeskLevels } from '@/lib/trading/deskLevels'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import {
  isDeskHoursNow,
  isLiveBarsAllowed,
  sessionFor,
} from '@/lib/trading/sessionGate'

/** Desk timezone for axis / tooltip labels (data stays true UTC). */
const CHART_TZ = 'America/New_York'

function formatChartTime(unix: number, withSeconds = false): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CHART_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(new Date(unix * 1000))
}

function formatChartDate(unix: number, style: 'day' | 'month' | 'year' = 'day'): string {
  if (style === 'year') {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: CHART_TZ,
      year: 'numeric',
    }).format(new Date(unix * 1000))
  }
  if (style === 'month') {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: CHART_TZ,
      month: 'short',
      year: '2-digit',
    }).format(new Date(unix * 1000))
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CHART_TZ,
    day: 'numeric',
    month: 'short',
  }).format(new Date(unix * 1000))
}

/** Axis tick labels in America/New_York (lightweight-charts defaults to UTC). */
function nyTickMarkFormatter(time: UTCTimestamp | string | number, tickMarkType: TickMarkType): string {
  const unix = typeof time === 'number' ? time : Math.floor(new Date(String(time)).getTime() / 1000)
  if (!Number.isFinite(unix)) return ''
  switch (tickMarkType) {
    case TickMarkType.Year:
      return formatChartDate(unix, 'year')
    case TickMarkType.Month:
      return formatChartDate(unix, 'month')
    case TickMarkType.DayOfMonth:
      return formatChartDate(unix, 'day')
    case TickMarkType.TimeWithSeconds:
      return formatChartTime(unix, true)
    case TickMarkType.Time:
    default:
      return formatChartTime(unix)
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
  broken:      '#ef4444',
  bounced:     '#a855f7',
  rejected:    '#f97316',
}

// Chart dark theme
const CHART_THEME = {
  layout: {
    background: { type: ColorType.Solid, color: '#131622' },
    textColor:  '#6b7280',
    fontFamily: 'Inter, JetBrains Mono, system-ui',
    fontSize:   11,
  },
  grid: {
    vertLines: { color: '#1a1e2e', style: LineStyle.Solid },
    horzLines: { color: '#1a1e2e', style: LineStyle.Solid },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: '#3a4268', width: 1 as any, style: LineStyle.Dashed, labelBackgroundColor: '#222840' },
    horzLine: { color: '#3a4268', width: 1 as any, style: LineStyle.Dashed, labelBackgroundColor: '#222840' },
  },
  rightPriceScale: {
    borderColor: '#1a1e2e',
    textColor:   '#6b7280',
    // Margins are set dynamically in the chart init block (0.05 top / 0.20 bottom)
    // to reserve space for volume bars at the bottom
  },
  timeScale: {
    borderColor:   '#1a1e2e',
    timeVisible:   true,
    secondsVisible: false,
    rightOffset:   12,
    barSpacing:    8,
    fixLeftEdge:   false,
    fixRightEdge:  false,
    // Default axis is UTC — format ticks in NY so 10:55 ET is not shown as 14:55 / 2:55
    tickMarkFormatter: nyTickMarkFormatter,
  },
  localization: {
    // Crosshair time label (bottom axis hover)
    timeFormatter: (time: UTCTimestamp | string | number) => {
      const unix = typeof time === 'number' ? time : Math.floor(new Date(String(time)).getTime() / 1000)
      if (!Number.isFinite(unix)) return ''
      return `${formatChartDate(unix, 'day')} ${formatChartTime(unix)} ET`
    },
  },
}

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

interface TradingChartProps {
  onInstrumentChange?: (i: Instrument) => void
  onPriceUpdate?:      (price: number) => void   // called every tick
  /** Fired with unix seconds whenever a live quote lands */
  onQuoteTick?:        (unixSec: number) => void
  onDataModeChange?:   (mode: 'live' | 'synthetic') => void
  positionOverlay?:    PositionOverlay | null     // filled position Entry/SL/TP
  /** Working limit — not filled yet; does not enter MANAGE */
  pendingLimit?:       PendingLimitOverlay | null
  jumpToPriceRef?:     React.MutableRefObject<((price: number) => void) | null>
  /** Lock tabs to day's recommended desk instrument */
  lockedInstrument?:   Instrument | null
  /** When user clicks a level price (from panel or highlight) */
  onLevelSelect?:      (price: number, meta?: { type?: string; reasoning?: string }) => void
  /** Morning session: allow placing limits from the chart */
  canPlaceOrder?: boolean
  /** Bump to force a levels reload after SL/TP (system memory updated) */
  levelsRefreshKey?: number
  /** When true (in a trade), hide buy/short levels — only Entry/SL/TP show */
  hideTradeLevels?: boolean
}

// ─── Main TradingChart component ──────────────────────────────────────────────

export function TradingChart({
  onInstrumentChange,
  onPriceUpdate,
  onQuoteTick,
  onDataModeChange,
  positionOverlay,
  pendingLimit = null,
  jumpToPriceRef,
  lockedInstrument,
  onLevelSelect,
  canPlaceOrder = false,
  levelsRefreshKey = 0,
  hideTradeLevels = false,
}: TradingChartProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null)
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
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const candleRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastCandleRef = useRef<OHLCV | null>(null)
  const quoteInFlightRef = useRef(false)
  const didFitRef = useRef(false)

  const [instrument,  setInstrumentState] = useState<Instrument>(lockedInstrument || 'DOW')
  const [candles,     setCandles]    = useState<OHLCV[]>([])
  const [levels,      setLevels]     = useState<LevelLine[]>([])
  const levelsRef = useRef<LevelLine[]>([])
  const [tooltip,     setTooltip]    = useState<TooltipData | null>(null)
  const [livePrice,   setLivePrice]  = useState<number | null>(null)
  const [priceChange, setPriceChange] = useState<number>(0)
  const [showLevels,  setShowLevels] = useState(true)
  const [chartReady,  setChartReady] = useState(false)
  const [sessionRects, setSessionRects] = useState<SessionHighlightRect[]>([])
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
    // Levels only during that market's prep→lunch window
    if (!isDeskHoursNow(new Date(), inst).open) {
      setLevels([])
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
    const resolved = resolveDeskLevels(aiRows, barsForFallback, openUnix, sess.tz)

    for (const l of resolved.levels) {
      const isRes = String(l.type).toLowerCase().includes('resist')
      byPrice.set(l.level, {
        price: l.level,
        type: isRes ? 'resistance' : 'support',
        status: l.source,
        conviction: l.conviction,
        reasoning: l.reasoning,
        source: l.source,
        label: `${l.source === 'ai' ? 'AI' : 'STR'} ${isRes ? 'R' : 'S'} · c${l.conviction ?? '?'} · ${l.level.toLocaleString()}`,
      })
    }

    setLevels(Array.from(byPrice.values()).sort((a, b) => b.price - a.price))
  }, []) // levels only — setLevels is stable

  // ── Initialize chart ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      ...CHART_THEME,
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
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
        lastValueVisible: true,
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

    // ─── 2. Crosshair OHLCV tooltip subscription ─────────────────────────────
    chart.subscribeCrosshairMove((param) => {
      if (!param?.seriesData?.size || param.point === undefined) {
        setTooltip(null)
        return
      }
      const candle = param.seriesData.get(candleSeries) as CandlestickData | undefined
      if (!candle) return

      const open      = (candle as any).open  ?? 0
      const close     = (candle as any).close ?? 0
      const change    = close - open
      const changePct = open !== 0 ? (change / open) * 100 : 0

      const time = param.time
        ? `${formatChartTime(param.time as number)} ET`
        : ''

      setTooltip({
        time,
        open:   (candle as any).open,
        high:   (candle as any).high,
        low:    (candle as any).low,
        close:  (candle as any).close,
        volume: 0,
        change,
        changePct,
      })
    })

    chartRef.current  = chart
    candleRef.current = candleSeries
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
      vwapSeriesRef.current = null
    }
  }, []) // initialize once only

  // ── Load candle data when instrument changes (5m only) ───────────────────────
  useEffect(() => {
    if (!chartReady) return
    let cancelled = false

    const load = async () => {
      const meta = INSTRUMENT_META[instrument]
      const tfSec = DESK_BAR_SECONDS
      const barsOk = isLiveBarsAllowed(instrument)
      setBarsFrozen(!barsOk.open)
      setSessionMsg(barsOk.open ? null : barsOk.reason)

      // Outside morning session: still show frozen morning history (API clips at lunch),
      // but do not invent synthetic bars for trading.
      try {
        const res = await fetch(
          `/api/trading/candles?instrument=${instrument}&timeframe=${DESK_TIMEFRAME}&days=5`
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
      if (!barsOk.open) {
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
      // Demo-only fallback during an open session if feeds fail (local/dev)
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

  // Refresh AI levels periodically during the session (ENTRY window only)
  useEffect(() => {
    if (!chartReady) return
    if (positionOverlay || hideTradeLevels) return
    const id = setInterval(() => loadLevels(instrument), 60_000)
    return () => clearInterval(id)
  }, [chartReady, instrument, loadLevels, positionOverlay, hideTradeLevels])

  // Clear buy/short levels when entry window ends or in a trade
  useEffect(() => {
    if (hideTradeLevels) setLevels([])
  }, [hideTradeLevels])

  // Reset fit when switching instrument
  useEffect(() => {
    didFitRef.current = false
  }, [instrument])

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

    const ts = chartRef.current.timeScale()
    if (!didFitRef.current) {
      // First load only — fit all ~5 sessions; later soft-refreshes keep the user's zoom
      const width = containerRef.current?.clientWidth ?? 900
      const spacing = Math.min(7, Math.max(2.5, (width - 40) / Math.max(ordered.length, 1)))
      ts.applyOptions({ barSpacing: spacing, rightOffset: 8 })
      const asiaPad = Math.max(20, Math.ceil(ordered.length * 0.08))
      requestAnimationFrame(() => {
        ts.setVisibleLogicalRange({
          from: -asiaPad,
          to: Math.max(ordered.length - 1, 1),
        })
        didFitRef.current = true
      })
    }
  }, [candles, instrument]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    candlesRef.current = candles
  }, [candles])

  useEffect(() => {
    levelsRef.current = levels
  }, [levels])

  // ── Session color boxes (time × session high→low)
  const refreshSessionHighlights = useCallback(() => {
    const chart = chartRef.current
    const series = candleRef.current
    const list = candlesRef.current
    if (!chart || !series || !containerRef.current || list.length === 0) {
      setSessionRects([])
      return
    }

    let priceAxisW = 70
    try {
      priceAxisW = chart.priceScale('right').width() || priceAxisW
    } catch {
      /* defaults */
    }

    const { rects } = computeSessionHighlightRects({
      candles: list.map((c) => ({
        time: c.time as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      timeScale: chart.timeScale(),
      priceToY: (price) => series.priceToCoordinate(price),
      priceScaleWidth: priceAxisW,
      containerWidth: containerRef.current.clientWidth,
      containerHeight: containerRef.current.clientHeight,
      instrument,
      fullHeight: true,
    })
    setSessionRects(rects)
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
    const run = () => requestAnimationFrame(() => refreshSessionHighlights())
    run()
    const t1 = window.setTimeout(run, 50)
    const t2 = window.setTimeout(run, 200)
    const ts = chartRef.current.timeScale()
    ts.subscribeVisibleLogicalRangeChange(run)
    ts.subscribeVisibleTimeRangeChange(run)
    const el = containerRef.current
    const ro = el ? new ResizeObserver(run) : null
    ro?.observe(el!)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      try {
        ts.unsubscribeVisibleLogicalRangeChange(run)
        ts.unsubscribeVisibleTimeRangeChange(run)
      } catch {
        /* ignore */
      }
      ro?.disconnect()
    }
  }, [chartReady, candles, refreshSessionHighlights])

  // ── Draw level lines ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current) return

    // Remove old level lines
    levelLinesRef.current.forEach(line => {
      try { candleRef.current?.removePriceLine(line) } catch {}
    })
    levelLinesRef.current = []

    if (!showLevels || hideTradeLevels || !!positionOverlay) return

    levels.forEach(level => {
      const isAi = level.source === 'ai'
      const isRes = level.type === 'resistance' || String(level.type).toLowerCase().includes('resist')
      const baseColor =
        STATUS_COLORS[level.status] ??
        LEVEL_COLORS[level.type] ??
        (isAi
          ? isRes
            ? '#f87171'
            : '#34d399'
          : isRes
            ? '#f87171'
            : '#34d399')
      try {
        const line = candleRef.current!.createPriceLine({
          price:             level.price,
          color:             baseColor,
          lineWidth:         2,
          lineStyle:         isAi ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible:  true,
          title:             level.label ?? `${isRes ? 'R' : 'S'} ${level.price.toLocaleString()}`,
        })
        levelLinesRef.current.push(line)
      } catch {}
    })
  }, [levels, showLevels, chartReady, positionOverlay, hideTradeLevels])

  // ── Live quote poll — ONLY during morning session (stops at lunch) ───────────
  useEffect(() => {
    if (!chartReady || candles.length === 0 || dataMode === 'synthetic') return
    if (!isLiveBarsAllowed(instrument).open) {
      setBarsFrozen(true)
      setSessionMsg(isLiveBarsAllowed(instrument).reason)
      return
    }

    const QUOTE_MS = 1000 // Yahoo quote is our live path
    const CANDLE_REFRESH_MS = 45_000 // soft-merge completed bars; quotes keep the forming bar live
    let lastUiPriceAt = 0

    const applyQuote = (price: number, changePct: number, quoteTs: number) => {
      // Always push price to parent (fill detection); throttle chart header React state
      onPriceUpdate?.(price)
      const now = Date.now()
      if (now - lastUiPriceAt >= 250) {
        lastUiPriceAt = now
        setLivePrice(price)
        setPriceChange(changePct)
        onQuoteTick?.(Math.floor(now / 1000))
      }

      const last = lastCandleRef.current
      if (!last || !candleRef.current) return

      // Roll to a new bar when the quote has crossed the 5m boundary,
      // instead of stretching the old candle until the next full refresh
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
            // ignore mid-reload races
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
        // ignore mid-reload races
      }
    }

    const pollQuote = async () => {
      const gate = isLiveBarsAllowed(instrument)
      if (!gate.open) {
        setBarsFrozen(true)
        setSessionMsg(gate.reason)
        if (tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current)
          tickIntervalRef.current = null
        }
        if (candleRefreshRef.current) {
          clearInterval(candleRefreshRef.current)
          candleRefreshRef.current = null
        }
        return
      }
      if (quoteInFlightRef.current) return
      quoteInFlightRef.current = true
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
          applyQuote(json.price, json.change_pct ?? 0, ts)
        }
      } catch {
        // keep last known price
      } finally {
        quoteInFlightRef.current = false
      }
    }

    const refreshCandles = async () => {
      if (!isLiveBarsAllowed(instrument).open) return
      try {
        const res = await fetch(
          `/api/trading/candles?instrument=${instrument}&timeframe=${DESK_TIMEFRAME}&days=5&quote=0&_=${Date.now()}`,
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

        // Preserve client-rolled forming bar ahead of server, or merge live OHLC
        const live = lastCandleRef.current
        const last = trimmed[trimmed.length - 1]!
        if (live) {
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
          setCandles(trimmed)
        } else {
          // Forming bar only — update series without rebuilding AVWAP / full setData
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
        // ignore — quote poll still keeps price fresh
      }
    }

    pollQuote()
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
    if (candleRefreshRef.current) clearInterval(candleRefreshRef.current)
    tickIntervalRef.current = setInterval(pollQuote, QUOTE_MS)
    candleRefreshRef.current = setInterval(refreshCandles, CANDLE_REFRESH_MS)

    return () => {
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

  // ── Position / working-limit overlay lines ──────────────────────────────────
  useEffect(() => {
    positionLinesRef.current.forEach(line => {
      try { candleRef.current?.removePriceLine(line) } catch {}
    })
    positionLinesRef.current = []

    if (!candleRef.current) return

    if (positionOverlay) {
      const entries: Array<{ price: number; color: string; label: string; style: LineStyle }> = [
        { price: positionOverlay.entryPrice,   color: '#3b82f6', label: `Entry ${positionOverlay.direction.toUpperCase()}`, style: LineStyle.Solid },
        { price: positionOverlay.stopLoss,     color: '#ef4444', label: 'Stop Loss',    style: LineStyle.Dashed },
        { price: positionOverlay.profitTarget, color: '#22c55e', label: 'Target',       style: LineStyle.Dashed },
      ]
      for (const { price, color, label, style } of entries) {
        try {
          positionLinesRef.current.push(
            candleRef.current.createPriceLine({
              price, color, lineStyle: style, lineWidth: 1,
              axisLabelVisible: true,
              title: label,
            })
          )
        } catch { /* ignore */ }
      }
      return
    }

    if (pendingLimit) {
      const dir = pendingLimit.direction.toUpperCase()
      const entries: Array<{ price: number; color: string; label: string; style: LineStyle }> = [
        { price: pendingLimit.price, color: '#38bdf8', label: `WORKING ${dir}`, style: LineStyle.Solid },
        { price: pendingLimit.stopLoss, color: '#ef4444', label: 'SL (if filled)', style: LineStyle.Dotted },
        { price: pendingLimit.profitTarget, color: '#22c55e', label: 'TP (if filled)', style: LineStyle.Dotted },
      ]
      for (const { price, color, label, style } of entries) {
        try {
          positionLinesRef.current.push(
            candleRef.current.createPriceLine({
              price, color, lineStyle: style, lineWidth: 1,
              axisLabelVisible: true,
              title: label,
            })
          )
        } catch { /* ignore */ }
      }
    }
  }, [positionOverlay, pendingLimit])

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

        {/* Level toggle */}
        <button
          onClick={() => setShowLevels(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all border rounded-lg ${
            showLevels
              ? 'bg-surface-600 border-surface-400 text-gray-200'
              : 'bg-transparent border-surface-600 text-gray-600 hover:text-gray-400'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
          {levels.some(l => l.source === 'ai') ? 'AI Levels' : 'Levels'}
          {levels.length > 0 ? ` (${levels.filter(l => l.source === 'ai' || l.source === 'structure').length})` : ''}
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
          <span className="rounded-lg border border-sky-700/50 bg-sky-950/40 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
            Working limit · waiting for fill
          </span>
        )}

        {(hideTradeLevels || positionOverlay) && (
          <span className="rounded-lg border border-blue-700/50 bg-blue-950/40 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-200">
            In trade · levels hidden · SL / TP only
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
        {Object.entries(SESSION_RANGE_STYLES).map(([name, s]) => (
          <span key={name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-3.5 rounded-[2px]"
              style={{ backgroundColor: s.color.replace(/[\d.]+\)$/, '0.55)') }}
            />
            <span style={{ color: s.line }}>{name}</span>
          </span>
        ))}
        <span className="text-gray-600">·</span>
        <span className="flex items-center gap-1.5 normal-case tracking-normal">
          <span className="inline-block w-4 border-t-2" style={{ borderColor: SHARED_VWAP_COLORS.vwap }} />
          <span style={{ color: SHARED_VWAP_COLORS.vwap }}>AVWAP</span>
          <span className="text-gray-600">
            {deskClockFor(instrument).openLabel} · 5 sessions · ±1/2/3σ
          </span>
        </span>
      </div>
      <div className="flex-1 relative rounded-xl border border-surface-600 overflow-hidden" style={{ minHeight: 400 }}>
        <div ref={containerRef} className="absolute inset-0 z-0" />
        {sessionRects.map((s, i) => (
          <div
            key={`${s.name}-${i}`}
            className="pointer-events-none absolute"
            style={{
              left: s.left,
              width: s.width,
              top: s.top,
              height: s.height,
              backgroundColor: s.color,
              zIndex: s.zIndex,
            }}
            title={`${s.name} session`}
          />
        ))}
        <button
          type="button"
          onClick={resetPriceScale}
          className="absolute bottom-8 right-16 z-20 rounded-md border border-surface-500/80 bg-surface-800/95 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300 shadow-lg backdrop-blur transition hover:border-brand-500/50 hover:text-white"
          title="Reset price scale (and fit time) — same as TradingView double-click on price axis"
        >
          Reset scale
        </button>
      </div>

      {/* ── Clickable level chips — hidden while in a trade (only SL/TP visible) ─ */}
      {showLevels && !hideTradeLevels && !positionOverlay && levels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-600 self-center mr-1">
            Click to trade
          </span>
          {levels
            .filter((l) => l.source === 'ai' || l.source === 'structure')
            .slice(0, 10)
            .map((l, i) => {
              const isRes = l.type === 'resistance'
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
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border transition-all ${
                    isRes
                      ? 'border-red-900/60 bg-red-950/40 text-red-300 hover:border-red-600'
                      : 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300 hover:border-emerald-600'
                  }`}
                  title={l.reasoning ?? l.label}
                >
                  <span className="font-semibold uppercase text-[9px] opacity-70">
                    {isRes ? 'SHORT zone' : 'BUY zone'}
                  </span>
                  <span className="price-mono font-bold">{l.price.toLocaleString()}</span>
                  {l.conviction != null && (
                    <span className="text-gray-500">c{l.conviction}</span>
                  )}
                </button>
              )
            })}
          {levels.filter((l) => l.source === 'ai' || l.source === 'structure').length === 0 && (
            <span className="text-[11px] text-amber-500/90">
              No levels yet — run AI Level Finder or wait for 9:15 market-open prep
            </span>
          )}
        </div>
      )}
    </div>
  )
}
