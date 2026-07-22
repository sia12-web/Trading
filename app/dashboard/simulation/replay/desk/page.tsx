'use client'

/**
 * Simulation replay desk (query-param driven).
 * Flow: pick day → cash open (ET/JST) → structure levels → pending → fill → manage → lunch done
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  createChart,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  nyDateTimeToUnix,
  tokyoDateTimeToUnix,
  formatDateDisplay,
  getLastNNycTradingDays,
  getLastNTokyoTradingDays,
} from '@/lib/utils/dateUtils'
import {
  DESK_RISK_PERCENT,
  MANUAL_RISK_PERCENT,
  normalizeEntrySource,
  previewPositionSizing,
  riskPercentForEntrySource,
  type DeskEntrySource,
} from '@/lib/trading/positionSizing'
import {
  previewLevelOrderPrices,
  resolveChartLimitPick,
} from '@/lib/trading/chartLevelPick'
import {
  snapDeskPrice,
  snapStopToTick,
  snapTargetToTick,
} from '@/lib/trading/instrumentTicks'
import {
  MAX_SESSION_ATTEMPTS,
  MAX_STOP_HITS,
  resolveSimMorningGate,
  sessionFor,
} from '@/lib/trading/sessionGate'
import { LevelOrderTicket } from '@/app/dashboard/chart/components/LevelOrderTicket'
import {
  SESSION_STYLES,
  VWAP_COLORS,
  computeAnchoredVwap,
  computeSessionHighlightSpans,
  projectSessionHighlightRects,
  paintSessionHighlightOverlay,
  deskClockFor,
  lastNTradingSessions,
  sessionLegendLabel,
  sessionLegendOrder,
  type SessionHighlightSpan,
} from '@/lib/chart/sessionVwap'
import { DESK_CHART_THEME } from '@/lib/chart/deskChartTheme'
import {
  computeSimOvernightBias,
  simSuggestedDirection,
} from '@/lib/trading/simOvernightBias'
import {
  convictionStars,
  resolveDeskLevels,
  computeInitialBalance,
  ibLineSeriesData,
  type DeskPlaybook,
  zoneStopPrice,
  formatZone,
} from '@/lib/trading/deskLevels'
import { DraggableDeskWidget } from '@/app/dashboard/components/DraggableDeskWidget'

type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI'
type Direction = 'LONG' | 'SHORT'

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface AiLevel {
  level: number
  type: string
  conviction: number
  reasoning?: string
  source?: 'ai' | 'structure'
  rank?: 'primary' | 'watch'
  side?: 'BUY' | 'SHORT'
}

/** After SL/TP, flip or reinforce the traded level so the next entry set is updated. */
function applySimTradeOutcome(
  levels: AiLevel[],
  entry: number,
  direction: Direction,
  outcome: 'stop' | 'target'
): AiLevel[] {
  if (levels.length === 0) return levels
  let nearest = levels[0]!
  let best = Math.abs(nearest.level - entry)
  for (const l of levels) {
    const d = Math.abs(l.level - entry)
    if (d < best) {
      best = d
      nearest = l
    }
  }
  if (best / entry > 0.005) return levels

  return levels.map((l) => {
    if (l.level !== nearest.level) return l
    if (outcome === 'stop') {
      const flipped = direction === 'LONG' ? 'resistance' : 'support'
      return {
        ...l,
        type: flipped,
        conviction: Math.max(5, Math.min(9, (l.conviction || 6) + 1)),
        reasoning: `Market broke this zone (${direction} stopped out) — flipped to ${flipped} for the retest.`,
      }
    }
    return {
      ...l,
      conviction: Math.min(10, (l.conviction || 6) + 1),
      reasoning: `Held through take-profit (${direction}) — zone still defended; sweep risk rises on next touch.`,
    }
  })
}

interface PendingOrder {
  level: number
  direction: Direction
  stopLoss: number
  target: number
  size: number
  risk: number
  accountSize: number
  entryReason?: string
  conviction?: number
  entrySource: DeskEntrySource
}

interface PaperPosition {
  entry: number
  direction: Direction
  stopLoss: number
  target: number
  size: number
  risk: number
  accountSize: number
  filledAt: number
  entryReason?: string
  conviction?: number
  entrySource: DeskEntrySource
}

/** Trailing window while following the sim tip — readable bars, tip pinned right */
const FOLLOW_RIGHT_PAD = 8
const FOLLOW_BAR_SPACING = 7

type ChartFmt = {
  formatTime: (unix: number, withSeconds?: boolean) => string
  formatDate: (unix: number, style?: 'day' | 'month' | 'year') => string
  tickMarkFormatter: (time: UTCTimestamp | string | number, tickMarkType: TickMarkType) => string
  formatClock: (unix: number) => string
  tzLabel: string
}

/** Market-local chart clocks — NY for DOW/NASDAQ, Tokyo for NIKKEI. */
function makeChartFormatters(timeZone: string, tzLabel: string): ChartFmt {
  const fmtTime = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const fmtTimeSec = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const fmtDay = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'short',
  })
  const fmtMonth = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    year: '2-digit',
  })
  const fmtYear = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
  })

  const formatTime = (unix: number, withSeconds = false) =>
    (withSeconds ? fmtTimeSec : fmtTime).format(new Date(unix * 1000))
  const formatDate = (unix: number, style: 'day' | 'month' | 'year' = 'day') => {
    if (style === 'year') return fmtYear.format(new Date(unix * 1000))
    if (style === 'month') return fmtMonth.format(new Date(unix * 1000))
    return fmtDay.format(new Date(unix * 1000))
  }

  return {
    formatTime,
    formatDate,
    formatClock: (unix) => formatTime(unix, true),
    tzLabel,
    tickMarkFormatter: (time, tickMarkType) => {
      const unix =
        typeof time === 'number' ? time : Math.floor(new Date(String(time)).getTime() / 1000)
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
  }
}

function barTouches(bar: Candle, level: number): boolean {
  return bar.low <= level && bar.high >= level
}

/** Last index with candle.time <= t (candles must be sorted ascending). */
function lastIndexAtOrBefore(candles: Candle[], t: number): number {
  let lo = 0
  let hi = candles.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (candles[mid]!.time <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

function SimulationDeskInner() {
  const router = useRouter()
  const search = useSearchParams()

  const instrumentParam = (search.get('instrument') || 'DOW').toUpperCase()
  const instrument: Instrument =
    instrumentParam === 'NASDAQ'
      ? 'NASDAQ'
      : instrumentParam === 'NIKKEI'
        ? 'NIKKEI'
        : 'DOW'
  const replayDate = search.get('date') || ''
  const parsedSpeed = parseFloat(search.get('speed') || '0.25')
  const initialSpeed = Number.isFinite(parsedSpeed)
    ? Math.min(16, Math.max(0.25, parsedSpeed))
    : 0.25
  const sess = sessionFor(instrument)
  const tzLabel = instrument === 'NIKKEI' ? 'JST' : 'ET'
  const chartFmt = useMemo(
    () => makeChartFormatters(sess.tz, tzLabel),
    [sess.tz, tzLabel]
  )
  const toUnix = instrument === 'NIKKEI' ? tokyoDateTimeToUnix : nyDateTimeToUnix
  const [openH, openM] = sess.marketOpen.split(':').map(Number)
  const [entryH, entryM] = sess.entryClose.split(':').map(Number)
  const [lunchH, lunchM] = sess.lunchClose.split(':').map(Number)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [speed, setSpeed] = useState(initialSpeed)
  const [allCandles, setAllCandles] = useState<Candle[]>([])
  const [levels, setLevels] = useState<AiLevel[]>([])
  const levelsRef = useRef<AiLevel[]>([])
  const [levelsSource, setLevelsSource] = useState<'ai' | 'structure'>('structure')
  const [levelsAiLoading, setLevelsAiLoading] = useState(false)
  const [playbook, setPlaybook] = useState<DeskPlaybook | null>(null)
  const [simNow, setSimNow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pending, setPending] = useState<PendingOrder | null>(null)
  const [position, setPosition] = useState<PaperPosition | null>(null)
  /** Filled trades this replay (same max-2 book as live) */
  const [attemptsUsed, setAttemptsUsed] = useState(0)
  /** Stop-outs this replay — 2 locks the session */
  const [stopHits, setStopHits] = useState(0)
  const attemptsUsedRef = useRef(0)
  const stopHitsRef = useRef(0)
  const [accountSize, setAccountSize] = useState(100000)
  const [ticketLevel, setTicketLevel] = useState<AiLevel | null>(null)
  const [manualTicketOpen, setManualTicketOpen] = useState(false)
  /** Chart-click price for manual ticket; null = use lastPrice (toolbar Place limit). */
  const [manualClickPrice, setManualClickPrice] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [levelsOpen, setLevelsOpen] = useState(true)
  /** Floating morning playbook — independent of chart level lines. */
  const [playbookOpen, setPlaybookOpen] = useState(true)
  const levelsOpenRef = useRef(true)
  const [reasoningOpen, setReasoningOpen] = useState<number | null>(null)
  const [chartReady, setChartReady] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const sessionOverlayRef = useRef<HTMLDivElement>(null)
  const sessionSpansRef = useRef<{
    key: string
    spans: SessionHighlightSpan[]
    candleTimes: number[]
  } | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const vwapSeriesRef = useRef<{
    vwap: ISeriesApi<'Line'>
    upper1: ISeriesApi<'Line'>
    lower1: ISeriesApi<'Line'>
    upper2: ISeriesApi<'Line'>
    lower2: ISeriesApi<'Line'>
    upper3: ISeriesApi<'Line'>
    lower3: ISeriesApi<'Line'>
  } | null>(null)
  const ibSeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const [ibShaped, setIbShaped] = useState(false)
  const levelLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([])
  const posLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([])
  const hoverPreviewLinesRef = useRef<
    ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]
  >([])
  const hoverPreviewKeyRef = useRef<string | null>(null)
  /** Invisible series that hosts level/SL/TP price lines — seeded once, never updated again */
  const priceLineHostRef = useRef<ISeriesApi<'Line'> | null>(null)
  const priceLineHostSeededRef = useRef(false)
  const allCandlesRef = useRef<Candle[]>([])
  const replaySessionIdRef = useRef<string | null>(null)
  const sessionCandlesRef = useRef<Candle[]>([])
  const pendingRef = useRef<PendingOrder | null>(null)
  const positionRef = useRef<PaperPosition | null>(null)
  const placingOrderRef = useRef(false)
  const didFitRef = useRef(false)
  /** Last barSpacing we set on first fit / reset. */
  const barSpacingRef = useRef(FOLLOW_BAR_SPACING)
  /** Logical span last used while following — so Play slides without re-zooming. */
  const pinnedSpanRef = useRef<number | null>(null)
  const visibleCandlesRef = useRef<Candle[]>([])
  const simNowRef = useRef(0)
  const speedRef = useRef(initialSpeed)
  const lunchUnixRef = useRef(0)
  const playingRef = useRef(false)
  const followLiveRef = useRef(true)
  const ignoreRangeChangeRef = useRef(false)
  const lastAppliedBarIdxRef = useRef(-1)
  const wasPlayingRef = useRef(false)
  const lastPriceRef = useRef<number | null>(null)
  const applyChartDataRef = useRef<(simT: number, opts?: { force?: boolean; fit?: boolean }) => void>(
    () => {}
  )
  const fillPendingRef = useRef<(pend: PendingOrder, at: number) => void>(() => {})
  const tradesCountRef = useRef(0)
  const realizedPnlRef = useRef(0)
  const sessionCompletedRef = useRef(false)
  const sessionEpochRef = useRef(0)
  const [lastPrice, setLastPrice] = useState<number | null>(null)
  const [followingLive, setFollowingLive] = useState(true)

  useEffect(() => {
    allCandlesRef.current = allCandles
  }, [allCandles])
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  useEffect(() => {
    positionRef.current = position
  }, [position])
  useEffect(() => {
    // Don't clobber the live playback clock from a stale React state flush
    if (!playingRef.current) simNowRef.current = simNow
  }, [simNow])
  useEffect(() => {
    speedRef.current = speed
  }, [speed])
  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  const openUnix = useMemo(
    () => (replayDate ? toUnix(replayDate, openH!, openM || 0) : 0),
    [replayDate, toUnix, openH, openM]
  )
  const entryCloseUnix = useMemo(
    () => (replayDate ? toUnix(replayDate, entryH!, entryM || 0) : 0),
    [replayDate, toUnix, entryH, entryM]
  )
  const lunchUnix = useMemo(
    () => (replayDate ? toUnix(replayDate, lunchH!, lunchM || 0) : 0),
    [replayDate, toUnix, lunchH, lunchM]
  )

  useEffect(() => {
    lunchUnixRef.current = lunchUnix
  }, [lunchUnix])

  // Last 5 trading days prior to this replay session → AVWAP from that cash open
  const sessionCandles = useMemo(
    () =>
      lastNTradingSessions(
        allCandles,
        5,
        deskClockFor(instrument),
        openUnix || undefined
      ),
    [allCandles, instrument, openUnix]
  )

  useEffect(() => {
    sessionCandlesRef.current = sessionCandles
    lastAppliedBarIdxRef.current = -1
  }, [sessionCandles])

  // Sim-only: overnight gap + prior session (no news). Live desk unchanged.
  const overnightBias = useMemo(
    () => (openUnix ? computeSimOvernightBias(allCandles, openUnix, sess.tz) : null),
    [allCandles, openUnix, sess.tz]
  )

  // Ensure a DB session row exists (picker POST is fire-and-forget; desk owns persistence)
  useEffect(() => {
    if (!replayDate) return
    void fetch('/api/trading/replays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instrument,
        replay_date: replayDate,
        playback_speed: speed,
      }),
    })
      .then(async (res) => {
        const j = await res.json().catch(() => null)
        const id = j?.id as string | undefined
        if (id && !String(id).startsWith('local-')) {
          replaySessionIdRef.current = id
        }
      })
      .catch(() => {})
  }, [replayDate, instrument, speed])

  // Morning-only sim gate — same attempt/stop limits as live
  const gate = useMemo(() => {
    if (!simNow) return null
    return resolveSimMorningGate({
      now: new Date(simNow * 1000),
      instrument,
      hasOpenPosition: !!position,
      dayDone: simNow >= lunchUnix,
      attemptsUsed,
      stopHits,
    })
  }, [simNow, instrument, position, lunchUnix, attemptsUsed, stopHits])

  // Validate date + load candles/levels
  useEffect(() => {
    if (!replayDate) {
      setError('Missing date — pick a day from Simulation')
      setLoading(false)
      return
    }

    const allowed = new Set(
      instrument === 'NIKKEI' ? getLastNTokyoTradingDays(5) : getLastNNycTradingDays(5)
    )
    if (!allowed.has(replayDate)) {
      setError(
        instrument === 'NIKKEI'
          ? 'Date must be one of the last 5 Tokyo trading days'
          : 'Date must be one of the last 5 NYC trading days'
      )
      setLoading(false)
      return
    }

    let cancelled = false
    const candleController = new AbortController()
    const aiController = new AbortController()
    const candleTimeoutId = window.setTimeout(() => candleController.abort(), 20_000)
    const aiTimeoutId = window.setTimeout(() => aiController.abort(), 55_000)

    ;(async () => {
      setLoading(true)
      setError(null)
      setLevelsAiLoading(false)
      try {
        const startOpen = toUnix(replayDate, openH!, openM || 0)
        setSimNow(startOpen)

        const candlesRes = await fetch(
          `/api/trading/candles?instrument=${instrument}&timeframe=5m&days=7&date=${replayDate}&_=${Date.now()}`,
          { cache: 'no-store', signal: candleController.signal }
        )

        const cJson = await candlesRes.json()
        if (cancelled) return

        const mapped: Candle[] = (cJson.candles || []).map((c: {
          time: number
          open: number
          high: number
          low: number
          close: number
          volume?: number
        }) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? 0,
        }))

        if (mapped.length === 0) {
          throw new Error(
            cJson.error ||
              `No candles for ${replayDate} (${cJson.source || 'empty'}). Try another day or check OANDA/Yahoo.`
          )
        }

        setAllCandles(mapped)

        if (cancelled) return

        // Fast path: structure playbook so the desk opens immediately
        const biasProbe = computeSimOvernightBias(mapped, startOpen, sess.tz)
        const bias =
          biasProbe?.bias === 'bullish'
            ? 'bullish'
            : biasProbe?.bias === 'bearish'
              ? 'bearish'
              : 'none'
        const structure = resolveDeskLevels([], mapped, startOpen, sess.tz, bias)
        setLevels(structure.levels as AiLevel[])
        setLevelsSource(structure.source)
        setPlaybook(structure.playbook)

        const openLabel =
          instrument === 'NIKKEI' ? '9:00 AM JST' : '9:30 AM ET'
        setMsg(
          `${instrument} · ${formatDateDisplay(replayDate)} · clock at ${openLabel} · loading AI levels (Haiku)…`
        )
        setLoading(false)

        // Cheap AI (llm_tier=sim / Haiku) — upgrades structure when ready
        setLevelsAiLoading(true)
        try {
          const aiRes = await fetch('/api/trading/sim-levels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: aiController.signal,
            body: JSON.stringify({
              instrument,
              date: replayDate,
              candles_5m: mapped.map((c) => ({
                time: c.time,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
              })),
            }),
          })
          const aiJson = await aiRes.json().catch(() => ({}))
          if (cancelled) return

          if (aiRes.ok && Array.isArray(aiJson.levels) && aiJson.levels.length > 0) {
            const withAi = resolveDeskLevels(
              aiJson.levels,
              mapped,
              startOpen,
              sess.tz,
              bias
            )
            setLevels(withAi.levels as AiLevel[])
            setLevelsSource(withAi.source)
            setPlaybook(withAi.playbook)
            setMsg(
              `${instrument} · ${formatDateDisplay(replayDate)} · clock at ${openLabel} · AI levels (Haiku) — double-click the chart or pick a level, then Play`
            )
          } else {
            setMsg(
              `${instrument} · ${formatDateDisplay(replayDate)} · clock at ${openLabel} · structure levels (AI unavailable) — double-click the chart or pick a level, then Play`
            )
          }
        } catch (aiErr) {
          if (cancelled) return
          const aborted =
            (aiErr instanceof Error && aiErr.name === 'AbortError') ||
            (typeof aiErr === 'object' &&
              aiErr !== null &&
              'name' in aiErr &&
              (aiErr as { name: string }).name === 'AbortError')
          setMsg(
            `${instrument} · ${formatDateDisplay(replayDate)} · clock at ${openLabel} · structure levels${
              aborted ? ' (AI timed out)' : ' (AI failed)'
            } — double-click the chart or pick a level, then Play`
          )
        } finally {
          if (!cancelled) setLevelsAiLoading(false)
        }
      } catch (e) {
        if (cancelled) return
        const aborted =
          (e instanceof Error && e.name === 'AbortError') ||
          (typeof e === 'object' && e !== null && 'name' in e && (e as { name: string }).name === 'AbortError')
        setError(
          aborted
            ? 'Timed out loading candles (20s). Refresh or pick another day.'
            : e instanceof Error
              ? e.message
              : 'Failed to load desk'
        )
        setLoading(false)
      } finally {
        window.clearTimeout(candleTimeoutId)
      }
    })()

    return () => {
      cancelled = true
      candleController.abort()
      aiController.abort()
      window.clearTimeout(candleTimeoutId)
      window.clearTimeout(aiTimeoutId)
    }
  }, [instrument, replayDate, openH, openM, toUnix, sess.tz])

  // Chart init
  useEffect(() => {
    if (!containerRef.current || loading) return
    didFitRef.current = false
    setChartReady(false)

    const chart = createChart(containerRef.current, {
      ...DESK_CHART_THEME,
      timeScale: {
        ...DESK_CHART_THEME.timeScale,
        // Default axis is UTC — format ticks in market TZ (ET / JST)
        tickMarkFormatter: chartFmt.tickMarkFormatter,
      },
      localization: {
        timeFormatter: (time: UTCTimestamp | string | number) => {
          const unix =
            typeof time === 'number'
              ? time
              : Math.floor(new Date(String(time)).getTime() / 1000)
          if (!Number.isFinite(unix)) return ''
          return `${chartFmt.formatDate(unix, 'day')} ${chartFmt.formatTime(unix)} ${chartFmt.tzLabel}`
        },
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    })

    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })

    // Dedicated host for BUY/SHORT + working/manage lines. Candle/VWAP setData
    // must never touch this series or the levels vanish after a few seconds.
    const priceLineHost = chart.addLineSeries({
      color: 'rgba(0,0,0,0)',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceScaleId: 'right',
    })

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
        lastValueVisible: false,
        title: 'AVWAP',
      }),
      lower1: chart.addLineSeries({ ...bandOpts, title: '-1σ' }),
      lower2: chart.addLineSeries({ ...bandOpts, title: '-2σ' }),
      lower3: chart.addLineSeries({ ...bandOpts, title: '-3σ' }),
    }

    // Initial Balance — same blue H/L as live (extended to sim lunch)
    const ibLineOpts = {
      color: '#3b82f6',
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    }
    const ibSeries = {
      high: chart.addLineSeries({ ...ibLineOpts, title: 'IB H' }),
      low: chart.addLineSeries({ ...ibLineOpts, title: 'IB L' }),
    }

    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.05, bottom: 0.05 },
      borderVisible: false,
    })

    chartRef.current = chart
    seriesRef.current = series
    priceLineHostRef.current = priceLineHost
    vwapSeriesRef.current = vwapSeries
    ibSeriesRef.current = ibSeries
    setChartReady(true)

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
      setChartReady(false)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      priceLineHostRef.current = null
      priceLineHostSeededRef.current = false
      vwapSeriesRef.current = null
      ibSeriesRef.current = null
      setIbShaped(false)
      levelLinesRef.current = []
      posLinesRef.current = []
    }
  }, [loading])

  useEffect(() => {
    levelsRef.current = levels
  }, [levels])

  useEffect(() => {
    levelsOpenRef.current = levelsOpen
  }, [levelsOpen])

  /** Paint BUY/SHORT on dedicated host series — survives candle/VWAP setData. */
  const paintTradeLevels = useCallback(() => {
    const host = priceLineHostRef.current
    if (!host) return

    levelLinesRef.current.forEach((l) => {
      try {
        host.removePriceLine(l)
      } catch {
        /* ignore */
      }
    })
    levelLinesRef.current = []

    if (!levelsOpenRef.current) return

    for (const lv of levelsRef.current.slice(0, 4)) {
      const isRes = String(lv.type).toLowerCase().includes('resist')
      const side = isRes ? 'SHORT' : 'BUY'
      const isPrimary = lv.rank !== 'watch'
      const { label: stars } = convictionStars(lv.conviction)
      try {
        levelLinesRef.current.push(
          host.createPriceLine({
            price: lv.level,
            color: isRes ? '#f87171' : '#34d399',
            lineWidth: isPrimary ? 3 : 2,
            lineStyle: isPrimary ? LineStyle.Solid : LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${isPrimary ? 'P' : 'W'} ${side} ${lv.level.toLocaleString()} ${stars}`,
          })
        )
      } catch {
        /* ignore */
      }
    }
  }, [])

  const paintTradeLevelsRef = useRef(paintTradeLevels)
  paintTradeLevelsRef.current = paintTradeLevels

  const refreshSessionHighlights = useCallback(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    const list = visibleCandlesRef.current
    const host = sessionOverlayRef.current
    if (!chart || !series || !containerRef.current || list.length === 0) {
      paintSessionHighlightOverlay(host, [])
      return
    }

    const asOf = simNowRef.current || 0
    const tip = list[list.length - 1]?.time ?? 0
    const cacheKey = `${instrument}:${tip}:${asOf}:${list.length}`
    let cached = sessionSpansRef.current
    if (!cached || cached.key !== cacheKey) {
      const built = computeSessionHighlightSpans({
        candles: list,
        asOfUnix: asOf || undefined,
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

  /**
   * Keep the sim tip on the right edge.
   * resetSpacing: first fit / Reset scale only.
   * During Play follow: slide the existing window (same span) — never re-zoom.
   */
  const pinToLatest = useCallback(
    (endIdx: number, opts?: { resetSpacing?: boolean }) => {
      const chart = chartRef.current
      if (!chart || endIdx < 0) return

      const ts = chart.timeScale()
      ignoreRangeChangeRef.current = true
      const resetSpacing = !!opts?.resetSpacing || !didFitRef.current
      const to = endIdx + FOLLOW_RIGHT_PAD

      if (resetSpacing) {
        barSpacingRef.current = FOLLOW_BAR_SPACING
        ts.applyOptions({
          rightOffset: FOLLOW_RIGHT_PAD,
          barSpacing: FOLLOW_BAR_SPACING,
        })
        const width = containerRef.current?.clientWidth ?? 900
        const barsVisible = Math.max(
          40,
          Math.floor((width - 80) / FOLLOW_BAR_SPACING) - FOLLOW_RIGHT_PAD
        )
        pinnedSpanRef.current = barsVisible + FOLLOW_RIGHT_PAD
        ts.setVisibleLogicalRange({
          from: Math.max(-2, endIdx - barsVisible),
          to,
        })
      } else {
        // Preserve user's zoom: keep the same logical span, only slide to tip
        const cur = ts.getVisibleLogicalRange()
        const span =
          cur && cur.to > cur.from
            ? cur.to - cur.from
            : pinnedSpanRef.current || 104
        pinnedSpanRef.current = span
        ts.applyOptions({ rightOffset: FOLLOW_RIGHT_PAD })
        ts.setVisibleLogicalRange({
          from: to - span,
          to,
        })
      }

      didFitRef.current = true
      requestAnimationFrame(() => {
        ignoreRangeChangeRef.current = false
        refreshSessionHighlights()
      })
    },
    [refreshSessionHighlights]
  )

  const enableFollowLive = useCallback(() => {
    followLiveRef.current = true
    setFollowingLive(true)
    const endIdx = lastAppliedBarIdxRef.current
    if (endIdx >= 0) pinToLatest(endIdx, { resetSpacing: false })
  }, [pinToLatest])

  const resetPriceScale = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.05, bottom: 0.05 },
    })
    // Sim: snap to tip with default spacing (fitContent zooms out across all history)
    const endIdx = lastAppliedBarIdxRef.current
    followLiveRef.current = true
    setFollowingLive(true)
    if (endIdx >= 0) {
      pinToLatest(endIdx, { resetSpacing: true })
    } else {
      try {
        chart.timeScale().fitContent()
      } catch {
        /* ignore */
      }
      requestAnimationFrame(() => refreshSessionHighlights())
    }
  }, [pinToLatest, refreshSessionHighlights])

  /** Push candles/VWAP to the chart. Skips work when no new bar (playback stays smooth). */
  const applyChartData = useCallback(
    (simT: number, opts?: { force?: boolean; fit?: boolean }) => {
      const series = seriesRef.current
      const chart = chartRef.current
      const candles = sessionCandlesRef.current
      if (!series || !chart || candles.length === 0) return

      const endIdx = lastIndexAtOrBefore(candles, simT)
      if (endIdx < 0) return

      const force = opts?.force || endIdx < lastAppliedBarIdxRef.current
      if (!force && endIdx === lastAppliedBarIdxRef.current) return

      const toBar = (c: Candle) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })

      if (force || lastAppliedBarIdxRef.current < 0) {
        const slice = candles.slice(0, endIdx + 1)
        series.setData(slice.map(toBar))
        visibleCandlesRef.current = slice

        const clock = deskClockFor(instrument)
        const bands = computeAnchoredVwap(slice, clock)
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

        // IB high/low — shaped against replay clock (simT), not wall clock
        const ibs = ibSeriesRef.current
        if (ibs && openUnix) {
          const ib = computeInitialBalance(
            slice.map((c) => ({
              time: c.time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            })),
            openUnix,
            simT
          )
          if (ib) {
            const tip = slice[slice.length - 1]?.time ?? simT
            const sessionEnd = lunchUnix || tip
            const pts = ibLineSeriesData(ib, Math.max(tip, sessionEnd, simT))
            try {
              ibs.high.setData(
                pts.high.map((p) => ({
                  time: p.time as UTCTimestamp,
                  value: p.value,
                }))
              )
              ibs.low.setData(
                pts.low.map((p) => ({
                  time: p.time as UTCTimestamp,
                  value: p.value,
                }))
              )
              setIbShaped(true)
            } catch {
              ibs.high.setData([])
              ibs.low.setData([])
              setIbShaped(false)
            }
          } else {
            ibs.high.setData([])
            ibs.low.setData([])
            setIbShaped(false)
          }
        }

        // Seed host once so price lines bind to the right scale — never setData again
        const host = priceLineHostRef.current
        if (host && !priceLineHostSeededRef.current && slice.length > 0) {
          const a = slice[0]!
          const b = slice[slice.length - 1]!
          host.setData([
            { time: a.time as UTCTimestamp, value: a.close },
            { time: b.time as UTCTimestamp, value: b.close },
          ])
          priceLineHostSeededRef.current = true
          paintTradeLevelsRef.current()
        }
      } else {
        // Incremental: only append new bars (cheap path during Play)
        for (let i = lastAppliedBarIdxRef.current + 1; i <= endIdx; i++) {
          series.update(toBar(candles[i]!))
        }
        const slice = candles.slice(0, endIdx + 1)
        visibleCandlesRef.current = slice

        // VWAP bands only refresh when a bar is added (not every clock tick)
        const bands = computeAnchoredVwap(slice, deskClockFor(instrument))
        const vs = vwapSeriesRef.current
        if (vs && bands) {
          vs.vwap.setData(bands.vwap)
          vs.upper1.setData(bands.upper1)
          vs.lower1.setData(bands.lower1)
          vs.upper2.setData(bands.upper2)
          vs.lower2.setData(bands.lower2)
          vs.upper3.setData(bands.upper3)
          vs.lower3.setData(bands.lower3)
        }

        const ibs = ibSeriesRef.current
        if (ibs && openUnix) {
          const ib = computeInitialBalance(
            slice.map((c) => ({
              time: c.time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            })),
            openUnix,
            simT
          )
          if (ib) {
            const tip = slice[slice.length - 1]?.time ?? simT
            const sessionEnd = lunchUnix || tip
            const pts = ibLineSeriesData(ib, Math.max(tip, sessionEnd, simT))
            try {
              ibs.high.setData(
                pts.high.map((p) => ({
                  time: p.time as UTCTimestamp,
                  value: p.value,
                }))
              )
              ibs.low.setData(
                pts.low.map((p) => ({
                  time: p.time as UTCTimestamp,
                  value: p.value,
                }))
              )
              setIbShaped(true)
            } catch {
              ibs.high.setData([])
              ibs.low.setData([])
              setIbShaped(false)
            }
          } else {
            ibs.high.setData([])
            ibs.low.setData([])
            setIbShaped(false)
          }
        }
      }

      lastAppliedBarIdxRef.current = endIdx
      const price = candles[endIdx]!.close
      lastPriceRef.current = price
      setLastPrice(price)

      // Tip follow: reset spacing only on first fit / explicit fit — preserve user zoom
      if (opts?.fit || !didFitRef.current) {
        pinToLatest(endIdx, { resetSpacing: true })
      } else if (followLiveRef.current) {
        pinToLatest(endIdx, { resetSpacing: false })
      } else {
        requestAnimationFrame(() => refreshSessionHighlights())
      }
    },
    [pinToLatest, refreshSessionHighlights, instrument, openUnix, lunchUnix]
  )

  // Initial / seek chart paint — use ref so callback identity churn does not force setData
  useEffect(() => {
    if (!chartReady || sessionCandles.length === 0 || !simNow) return
    applyChartDataRef.current(simNow, { force: true, fit: !didFitRef.current })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when chart/candles ready; play uses applyChartDataRef
  }, [chartReady, sessionCandles])

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
        paintNow()
      }, 180)
    }

    const stopFollow = () => {
      if (!followLiveRef.current) return
      followLiveRef.current = false
      setFollowingLive(false)
    }

    const beginInteract = () => {
      pointerDown = true
      window.clearTimeout(settleTimer)
      // Dragging the scale / chart releases tip-follow so we don't fight the user
      if (!ignoreRangeChangeRef.current) stopFollow()
    }

    const endInteract = () => {
      if (!pointerDown) return
      pointerDown = false
      scheduleSettle()
    }

    /** Capture phase: LWC handles wheel on canvas; bubble may never reach container. */
    const onWheel = () => {
      if (ignoreRangeChangeRef.current) return
      stopFollow()
    }

    const onRangeChange = () => {
      // Track pan/zoom: repaint bands every frame so colors stay locked to the candles.
      paintNow()
      if (!pointerDown) scheduleSettle()

      if (ignoreRangeChangeRef.current || !followLiveRef.current) return
      const range = chartRef.current?.timeScale().getVisibleLogicalRange()
      if (!range || !(range.to > range.from)) return
      const span = range.to - range.from
      const pinned = pinnedSpanRef.current
      // Zoom (span change) or pan away from tip → release follow
      if (pinned != null && Math.abs(span - pinned) > 1.5) {
        stopFollow()
        return
      }
      const endIdx = lastAppliedBarIdxRef.current
      if (endIdx >= 0 && range.to < endIdx - 3) {
        stopFollow()
      }
    }

    paintNow()
    const t1 = window.setTimeout(paintNow, 50)
    const t2 = window.setTimeout(paintNow, 200)
    const ts = chartRef.current.timeScale()
    ts.subscribeVisibleLogicalRangeChange(onRangeChange)
    const ro = el ? new ResizeObserver(() => scheduleSettle()) : null
    ro?.observe(el!)
    el?.addEventListener('pointerdown', beginInteract)
    el?.addEventListener('wheel', onWheel, { passive: true, capture: true })
    window.addEventListener('pointerup', endInteract)
    window.addEventListener('pointercancel', endInteract)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(settleTimer)
      if (rafPending) cancelAnimationFrame(rafPending)
      try {
        ts.unsubscribeVisibleLogicalRangeChange(onRangeChange)
      } catch {
        /* ignore */
      }
      ro?.disconnect()
      el?.removeEventListener('pointerdown', beginInteract)
      el?.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('pointerup', endInteract)
      window.removeEventListener('pointercancel', endInteract)
    }
  }, [chartReady, refreshSessionHighlights])

  // Only re-enable tip-follow when Play transitions off → on (not on every callback churn)
  useEffect(() => {
    if (playing && !wasPlayingRef.current) {
      enableFollowLive()
    }
    wasPlayingRef.current = playing
  }, [playing, enableFollowLive])

  // Trade levels — manual Levels / Hide levels only (stay through working + position)
  useEffect(() => {
    if (!chartReady) return
    paintTradeLevels()
  }, [levels, chartReady, levelsOpen, paintTradeLevels])

  // Pending working limit + open position — on host series (survives candle setData).
  // Independent of Hide levels — AI/structure lines toggle separately.
  useEffect(() => {
    const host = priceLineHostRef.current
    if (!host || !chartReady) return
    posLinesRef.current.forEach((l) => {
      try {
        host.removePriceLine(l)
      } catch {
        /* ignore */
      }
    })
    posLinesRef.current = []

    const fmt = (n: number) =>
      n.toLocaleString('en-US', { maximumFractionDigits: 0 })

    const specs: Array<{
      price: number
      color: string
      title: string
      style: LineStyle
      width: 1 | 2 | 3 | 4
    }> = []

    if (position) {
      specs.push(
        {
          price: position.entry,
          color: '#3b82f6',
          title: `Entry ${position.direction} ${fmt(position.entry)}`,
          style: LineStyle.Solid,
          width: 2,
        },
        {
          price: position.stopLoss,
          color: '#ef4444',
          title: `SL ${fmt(position.stopLoss)}`,
          style: LineStyle.Dashed,
          width: 2,
        },
        {
          price: position.target,
          color: '#22c55e',
          title: `TP ${fmt(position.target)}`,
          style: LineStyle.Dashed,
          width: 2,
        }
      )
    } else if (pending) {
      specs.push(
        {
          price: pending.level,
          color: '#38bdf8',
          title: `WORKING ${pending.direction} ${fmt(pending.level)}`,
          style: LineStyle.Solid,
          width: 3,
        },
        {
          price: pending.stopLoss,
          color: '#ef4444',
          title: `SL ${fmt(pending.stopLoss)}`,
          style: LineStyle.Dotted,
          width: 2,
        },
        {
          price: pending.target,
          color: '#22c55e',
          title: `TP ${fmt(pending.target)}`,
          style: LineStyle.Dotted,
          width: 2,
        }
      )
    }

    const prices: number[] = []
    for (const s of specs) {
      if (!Number.isFinite(s.price) || s.price <= 0) continue
      prices.push(s.price)
      try {
        posLinesRef.current.push(
          host.createPriceLine({
            price: s.price,
            color: s.color,
            lineWidth: s.width,
            lineStyle: s.style,
            axisLabelVisible: true,
            title: s.title,
          })
        )
      } catch {
        /* ignore */
      }
    }

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
      } catch {
        /* ignore */
      }
    } else {
      try {
        host.applyOptions({ autoscaleInfoProvider: undefined })
      } catch {
        /* ignore */
      }
    }
  }, [position, pending, chartReady])

  const fillPending = useCallback((pend: PendingOrder, at: number) => {
    const filled: PaperPosition = {
      entry: pend.level,
      direction: pend.direction,
      stopLoss: pend.stopLoss,
      target: pend.target,
      size: pend.size,
      risk: pend.risk,
      accountSize: pend.accountSize,
      filledAt: at,
      entryReason: pend.entryReason,
      conviction: pend.conviction,
      entrySource: pend.entrySource || 'ai',
    }
    // Sync refs before next playback tick (16x can fire before React effects)
    pendingRef.current = null
    positionRef.current = filled
    setPosition(filled)
    setPending(null)
    setMsg(
      `FILLED ${pend.direction} @ ${pend.level.toLocaleString()} — attempts ${attemptsUsedRef.current}/${MAX_SESSION_ATTEMPTS} (stop-outs)`
    )
  }, [])

  const recordPaperClose = useCallback(
    (
      pos: PaperPosition,
      exitPrice: number,
      exitReason: 'stop_hit' | 'take_profit' | 'manual'
    ) => {
      const isLong = pos.direction === 'LONG'
      const pnl = isLong
        ? (exitPrice - pos.entry) * pos.size
        : (pos.entry - exitPrice) * pos.size
      const profitLoss = Math.round(pnl * 100) / 100
      realizedPnlRef.current += profitLoss
      tradesCountRef.current += 1

      if (!replayDate) return
      const exitAt = simNowRef.current || pos.filledAt
      void fetch('/api/trading/sim-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument,
          replay_date: replayDate,
          replay_id: replaySessionIdRef.current,
          direction: pos.direction,
          entry_price: pos.entry,
          exit_price: exitPrice,
          stop_loss: pos.stopLoss,
          take_profit: pos.target,
          position_size: pos.size,
          risk_amount: pos.risk,
          account_size: pos.accountSize || accountSize,
          filled_at_unix: pos.filledAt,
          exit_at_unix: exitAt,
          exit_reason: exitReason,
          profit_loss: profitLoss,
          entry_level: pos.entry,
          entry_reason: pos.entryReason || null,
          level_conviction: pos.conviction ?? null,
          entry_source: pos.entrySource || 'ai',
        }),
      })
        .then(async (res) => {
          if (res.ok) return
          const j = await res.json().catch(() => ({}))
          console.error('[sim-journal] save failed', res.status, j)
          setMsg(
            `Closed @ ${exitPrice.toLocaleString()} — history save failed (${j.error || res.status}). Check Order History → Simulation.`
          )
        })
        .catch((err) => {
          console.error('[sim-journal] network', err)
          setMsg(`Closed @ ${exitPrice.toLocaleString()} — history save failed (network).`)
        })
    },
    [instrument, replayDate, accountSize]
  )

  /** Persist lunch finish so the picker shows "done" instead of forever "resume". */
  const markSessionCompleted = useCallback(async () => {
    if (!replayDate || sessionCompletedRef.current) return
    const epoch = sessionEpochRef.current
    sessionCompletedRef.current = true
    const duration = Math.max(0, (simNowRef.current || lunchUnixRef.current) - (openUnix || 0))
    try {
      const res = await fetch('/api/trading/replays', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument,
          replay_date: replayDate,
          status: 'completed',
          final_pnl: Math.round(realizedPnlRef.current * 100) / 100,
          trades_count: tradesCountRef.current,
          replay_duration_seconds: duration,
          notes: 'Morning session finished at lunch',
        }),
      })
      // Ignore stale completes after Reset/Replay; retry if request failed
      if (epoch !== sessionEpochRef.current) return
      if (!res.ok) {
        sessionCompletedRef.current = false
      }
    } catch {
      if (epoch === sessionEpochRef.current) sessionCompletedRef.current = false
    }
  }, [instrument, replayDate, openUnix])

  useEffect(() => {
    applyChartDataRef.current = applyChartData
  }, [applyChartData])
  useEffect(() => {
    fillPendingRef.current = fillPending
  }, [fillPending])

  // Playback — step one candle at a time so the chart visibly moves
  useEffect(() => {
    if (!playing || !openUnix) return

    const stepOnce = () => {
      const candles = allCandlesRef.current
      const prev = simNowRef.current
      const lunch = lunchUnixRef.current
      if (!lunch || candles.length === 0) {
        setPlaying(false)
        return
      }

      // Next bar after the current sim clock (binary search)
      const nextIdx = lastIndexAtOrBefore(candles, prev) + 1
      if (nextIdx >= candles.length || candles[nextIdx]!.time > lunch) {
        simNowRef.current = lunch
        setSimNow(lunch)
        applyChartDataRef.current(lunch)
        setPlaying(false)
        setMsg(
          instrument === 'NIKKEI'
            ? 'Sim clock reached lunch (11:30 JST) — morning finished'
            : 'Sim clock reached lunch (11:30 ET) — morning finished'
        )
        void markSessionCompleted()
        return
      }

      const bar = candles[nextIdx]!
      const next = bar.time

      const pend = pendingRef.current
      if (pend && !positionRef.current && barTouches(bar, pend.level)) {
        fillPendingRef.current(pend, bar.time)
      }

      const pos = positionRef.current
      if (pos) {
        const hitSl =
          pos.direction === 'LONG'
            ? bar.low <= pos.stopLoss
            : bar.high >= pos.stopLoss
        const hitTp =
          pos.direction === 'LONG'
            ? bar.high >= pos.target
            : bar.low <= pos.target
        if (hitSl) {
          const closed = pos
          recordPaperClose(closed, closed.stopLoss, 'stop_hit')
          positionRef.current = null
          stopHitsRef.current += 1
          attemptsUsedRef.current = stopHitsRef.current
          setStopHits(stopHitsRef.current)
          setAttemptsUsed(attemptsUsedRef.current)
          simNowRef.current = next
          setSimNow(next)
          applyChartDataRef.current(next)
          setPlaying(false)
          const locked = stopHitsRef.current >= MAX_STOP_HITS
          setMsg(
            locked
              ? `STOP HIT @ ${closed.stopLoss.toLocaleString()} — stopped out ${MAX_STOP_HITS}/${MAX_STOP_HITS}, trading locked`
              : `STOP HIT @ ${closed.stopLoss.toLocaleString()} — attempts ${attemptsUsedRef.current}/${MAX_SESSION_ATTEMPTS} (stop-outs)`
          )
          setLevels((prev) =>
            applySimTradeOutcome(prev, closed.entry, closed.direction, 'stop')
          )
          setPosition(null)
          return
        }
        if (hitTp) {
          const closed = pos
          recordPaperClose(closed, closed.target, 'take_profit')
          positionRef.current = null
          simNowRef.current = next
          setSimNow(next)
          applyChartDataRef.current(next)
          setPlaying(false)
          setMsg(`TARGET HIT @ ${closed.target.toLocaleString()} — levels updated`)
          setLevels((prev) =>
            applySimTradeOutcome(prev, closed.entry, closed.direction, 'target')
          )
          setPosition(null)
          return
        }
      }

      simNowRef.current = next
      setSimNow(next)
      applyChartDataRef.current(next)
    }

    // 0.25x ≈ 1800ms per 5m bar; 1x ≈ 450ms; 16x ≈ 28ms
    const intervalMs = Math.max(28, Math.round(450 / Math.max(0.25, speed)))
    // Step once immediately so Play feels responsive
    stepOnce()
    const timer = window.setInterval(stepOnce, intervalMs)

    return () => {
      window.clearInterval(timer)
    }
  }, [playing, openUnix, speed, instrument, markSessionCompleted, recordPaperClose])

  // If clock is already at/after lunch (paused at end), flip picker to "done"
  useEffect(() => {
    if (!lunchUnix || !simNow) return
    if (simNow >= lunchUnix) void markSessionCompleted()
  }, [simNow, lunchUnix, markSessionCompleted])

  // Unfilled sim limits expire when the entry window ends
  useEffect(() => {
    if (!pending) return
    if (simNow <= entryCloseUnix) return
    pendingRef.current = null
    setPending(null)
    setMsg('Working limit cancelled — entry window closed (never filled)')
  }, [simNow, entryCloseUnix, pending])

  const cancelPending = useCallback(() => {
    if (!pendingRef.current) return
    pendingRef.current = null
    placingOrderRef.current = false
    setPending(null)
    setPlaying(false)
    setMsg('Working limit cancelled')
  }, [])

  const placePending = useCallback(
    (level: AiLevel, direction: Direction) => {
      if (placingOrderRef.current || pendingRef.current) return
      if (position) {
        setMsg('Already in a position — manage or close first')
        return
      }
      if (stopHitsRef.current >= MAX_STOP_HITS) {
        setMsg(`Stopped out ${MAX_STOP_HITS}/${MAX_STOP_HITS} — trading locked for this session`)
        return
      }
      const now = simNowRef.current
      if (now > entryCloseUnix) {
        setMsg(
          `Entry window closed (after ${sess.entryClose.slice(0, 5)} ${tzLabel} sim time)`
        )
        return
      }

      placingOrderRef.current = true
      const entrySource = normalizeEntrySource(level.source, 'structure')
      const limit = snapDeskPrice(instrument, level.level)
      const rawStop = zoneStopPrice(limit, direction)
      const stop = snapStopToTick(instrument, limit, rawStop, direction)
      const preview = previewPositionSizing(
        limit,
        accountSize,
        direction,
        stop,
        riskPercentForEntrySource(entrySource)
      )
      if (!preview) {
        placingOrderRef.current = false
        setMsg('Invalid sizing')
        return
      }
      const target = snapTargetToTick(
        instrument,
        limit,
        preview.profit_target_price,
        direction
      )
      const order: PendingOrder = {
        level: limit,
        direction,
        stopLoss: stop,
        target,
        size: preview.position_size,
        risk: preview.risk_amount,
        accountSize,
        entryReason:
          level.reasoning ||
          `${level.rank === 'primary' ? 'PRIMARY' : 'WATCH'} ${
            level.side || (direction === 'LONG' ? 'BUY' : 'SHORT')
          } level`,
        conviction: level.conviction,
        entrySource,
      }

      // Immediate fill if any bar from open→now already touched
      const touched = allCandlesRef.current.find(
        (c) => c.time >= openUnix && c.time <= now && barTouches(c, order.level)
      )
      setTicketLevel(null)
      if (touched) {
        fillPending(order, touched.time)
        placingOrderRef.current = false
        return
      }

      pendingRef.current = order
      setPending(order)
      setMsg(
        `Working ${direction} @ ${limit.toLocaleString()} — press Play until fill`
      )
      placingOrderRef.current = false
    },
    [
      position,
      entryCloseUnix,
      accountSize,
      openUnix,
      fillPending,
      sess.entryClose,
      tzLabel,
      instrument,
    ]
  )

  const closeAtMarket = () => {
    const price = lastPriceRef.current ?? lastPrice
    if (!position || price == null) return
    const closed = position
    recordPaperClose(closed, price, 'manual')
    positionRef.current = null
    setMsg(`Closed @ ${price.toLocaleString()} — manage ended`)
    setLevels((prev) =>
      applySimTradeOutcome(prev, closed.entry, closed.direction, 'target')
    )
    setPosition(null)
    setPlaying(false)
  }

  const resetSessionProgress = () => {
    sessionEpochRef.current += 1
    sessionCompletedRef.current = false
    tradesCountRef.current = 0
    realizedPnlRef.current = 0
    attemptsUsedRef.current = 0
    stopHitsRef.current = 0
    setAttemptsUsed(0)
    setStopHits(0)
    pendingRef.current = null
    positionRef.current = null
    if (replayDate) {
      void fetch('/api/trading/replays', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument,
          replay_date: replayDate,
          status: 'in_progress',
          final_pnl: null,
          final_pnl_percent: null,
          replay_duration_seconds: null,
          trades_count: 0,
          notes: null,
          clear_trades: true,
        }),
      })
    }
  }

  const jumpToOpen = () => {
    followLiveRef.current = true
    setFollowingLive(true)
    simNowRef.current = openUnix
    setSimNow(openUnix)
    applyChartData(openUnix, { force: true, fit: true })
    setPlaying(false)
    setPending(null)
    setPosition(null)
    setTicketLevel(null)
    setManualTicketOpen(false)
    setManualClickPrice(null)
    setLevelsOpen(true)
    resetSessionProgress()
    setMsg(
      instrument === 'NIKKEI'
        ? 'Reset to 9:00 AM JST — double-click the chart or pick a level, then Play'
        : 'Reset to 9:30 AM ET — double-click the chart or pick a level, then Play'
    )
  }

  /** Restart morning from cash open and auto-play (keeps levels). */
  const replayFromOpen = () => {
    followLiveRef.current = true
    setFollowingLive(true)
    simNowRef.current = openUnix
    setSimNow(openUnix)
    applyChartData(openUnix, { force: true, fit: true })
    setPending(null)
    setPosition(null)
    setTicketLevel(null)
    setManualTicketOpen(false)
    setManualClickPrice(null)
    setLevelsOpen(true)
    resetSessionProgress()
    setMsg(
      instrument === 'NIKKEI'
        ? 'Replay from 9:00 AM JST — double-click the chart or pick a level, or watch'
        : 'Replay from 9:30 AM ET — double-click the chart or pick a level, or watch'
    )
    setPlaying(true)
  }

  // Double-click chart to place limit (snap to nearby level, else manual) — same as live
  useEffect(() => {
    const container = containerRef.current
    const canPlace =
      chartReady &&
      !position &&
      !pending &&
      simNow > 0 &&
      simNow <= entryCloseUnix &&
      simNow >= openUnix &&
      stopHits < MAX_STOP_HITS &&
      gate?.canPlaceEntry !== false

    if (!container || !seriesRef.current || !canPlace) return

    // Double-click places a limit — single click/drag stays free for pan/zoom
    const onDblClick = (e: MouseEvent) => {
      e.preventDefault()
      if (!seriesRef.current) return
      const rect = container.getBoundingClientRect()
      const y = e.clientY - rect.top
      const raw = seriesRef.current.coordinateToPrice(y)
      if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) <= 0) return

      // Snap to AI/structure only when levels are visible — hidden → always manual
      const pick = resolveChartLimitPick({
        rawPrice: Number(raw),
        levels: levelsRef.current.map((l) => ({
          price: l.level,
          type: l.type,
          source: l.source,
          reasoning: l.reasoning,
          side: l.side ?? null,
        })),
        levelsVisible: levelsOpenRef.current,
      })

      if (pick.matched && pick.source !== 'manual') {
        const matched = levelsRef.current.find(
          (l) => Math.abs(l.level - pick.price) < 1e-6
        )
        if (matched) {
          setManualTicketOpen(false)
          setManualClickPrice(null)
          setTicketLevel(matched)
          return
        }
      }

      setTicketLevel(null)
      setManualClickPrice(pick.price)
      setManualTicketOpen(true)
    }

    container.style.cursor = 'crosshair'
    container.addEventListener('dblclick', onDblClick)
    return () => {
      container.removeEventListener('dblclick', onDblClick)
      container.style.cursor = ''
    }
  }, [
    chartReady,
    position,
    pending,
    simNow,
    entryCloseUnix,
    openUnix,
    attemptsUsed,
    stopHits,
    gate?.canPlaceEntry,
  ])

  // Hover visible level → preview entry / SL / TP (same math as AI ticket)
  useEffect(() => {
    const container = containerRef.current
    const host = priceLineHostRef.current
    const clearHover = () => {
      hoverPreviewLinesRef.current.forEach((line) => {
        try {
          host?.removePriceLine(line)
        } catch {
          /* ignore */
        }
      })
      hoverPreviewLinesRef.current = []
      hoverPreviewKeyRef.current = null
    }

    const canHover =
      chartReady &&
      !position &&
      !pending &&
      levelsOpen &&
      simNow > 0 &&
      simNow <= entryCloseUnix &&
      gate?.canPlaceEntry !== false

    if (!container || !seriesRef.current || !host || !canHover) {
      clearHover()
      return
    }

    const fmt = (n: number) =>
      n.toLocaleString('en-US', { maximumFractionDigits: 0 })

    const onMove = (e: MouseEvent) => {
      if (!seriesRef.current || !priceLineHostRef.current) return
      const rect = container.getBoundingClientRect()
      const y = e.clientY - rect.top
      const raw = seriesRef.current.coordinateToPrice(y)
      if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) <= 0) {
        clearHover()
        return
      }

      const pick = resolveChartLimitPick({
        rawPrice: Number(raw),
        levels: levelsRef.current.map((l) => ({
          price: l.level,
          type: l.type,
          source: l.source,
          reasoning: l.reasoning,
          side: l.side ?? null,
        })),
        levelsVisible: true,
      })
      if (pick.source === 'manual' || !pick.matched) {
        clearHover()
        return
      }

      const preview = previewLevelOrderPrices({
        level: pick.matched,
        instrument,
        accountSize,
      })
      if (!preview) {
        clearHover()
        return
      }

      const key = `${preview.direction}:${preview.entry}:${preview.stop}:${preview.target}`
      if (hoverPreviewKeyRef.current === key) return
      clearHover()
      hoverPreviewKeyRef.current = key
      const h = priceLineHostRef.current
      if (!h) return

      for (const s of [
        {
          price: preview.entry,
          color: 'rgba(56, 189, 248, 0.85)',
          title: `HOVER ${preview.direction} ${fmt(preview.entry)}`,
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
      ] as const) {
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

    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', clearHover)
    return () => {
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', clearHover)
      clearHover()
    }
  }, [
    chartReady,
    position,
    pending,
    levelsOpen,
    simNow,
    entryCloseUnix,
    gate?.canPlaceEntry,
    instrument,
    accountSize,
  ])

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-gray-500 text-sm">
        <p className="animate-pulse">Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-400 text-sm">{error}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs text-brand-400 hover:text-brand-300"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/simulation')}
            className="text-xs text-gray-400 hover:text-white"
          >
            ← Back to simulation
          </button>
        </div>
      </div>
    )
  }

  const phase = position ? 'MANAGE' : gate?.phase ?? 'ENTRY'
  const canEnter =
    !position &&
    !pending &&
    simNow <= entryCloseUnix &&
    simNow >= openUnix &&
    stopHits < MAX_STOP_HITS &&
    gate?.canPlaceEntry !== false

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0d1117]">
      {/* Full-bleed chart + session color bands (bands painted imperatively for smooth pan) */}
      <div className="absolute inset-0 z-0">
        <div ref={containerRef} className="absolute inset-0 z-0" />
        <div
          ref={sessionOverlayRef}
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ opacity: 1, transition: 'none', willChange: 'opacity' }}
        />
        {(position || pending) && (
          <div className="pointer-events-none absolute left-3 top-14 z-20 max-w-[min(360px,75%)]">
            <div
              className={`rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm ${
                position
                  ? 'border-emerald-500/40 bg-emerald-950/85 text-emerald-100'
                  : 'border-sky-500/40 bg-sky-950/85 text-sky-100'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider">
                    {position
                      ? `OPEN ${position.direction} · Entry / SL / TP on chart`
                      : `WORKING ${pending!.direction} · limit + SL/TP on chart`}
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] opacity-90">
                    {position
                      ? `@ ${position.entry.toLocaleString()} · SL ${position.stopLoss.toLocaleString()} · TP ${position.target.toLocaleString()}`
                      : `@ ${pending!.level.toLocaleString()} · SL ${pending!.stopLoss.toLocaleString()} · TP ${pending!.target.toLocaleString()}`}
                  </p>
                </div>
                {pending && !position && (
                  <button
                    type="button"
                    onClick={cancelPending}
                    className="pointer-events-auto shrink-0 rounded border border-sky-400/50 bg-sky-600/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-sky-500"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={resetPriceScale}
          className="absolute bottom-8 right-16 z-20 rounded-md border border-white/20 bg-[#0d1117]/95 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300 shadow-lg backdrop-blur transition hover:border-violet-400/50 hover:text-white"
          title="Reset price scale and snap to latest sim bar"
        >
          Reset scale
        </button>
      </div>

      {/* Top toolbar overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-[#0d1117]/90 px-2.5 py-1.5 text-xs backdrop-blur-md">
          <span className="font-semibold uppercase tracking-wide text-violet-300">SIM</span>
          <span className="font-mono tabular-nums text-white">
            {chartFmt.formatClock(simNow)} {tzLabel}
          </span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-gray-200">{instrument}</span>
          <span className="hidden text-gray-500 sm:inline">
            {formatDateDisplay(replayDate)}
          </span>
          <span className="rounded bg-violet-500/20 px-1.5 py-0.5 font-semibold uppercase text-violet-200">
            {phase}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 font-semibold tabular-nums ${
              stopHits >= MAX_STOP_HITS
                ? 'bg-red-500/25 text-red-200'
                : 'bg-sky-500/20 text-sky-200'
            }`}
            title="Attempts = stop-loss hits only (max 2). Fills / TP do not burn an attempt."
          >
            Attempts {stopHits}/{MAX_STOP_HITS}
          </span>
          {overnightBias && (
            <span
              className={`rounded px-1.5 py-0.5 font-semibold uppercase ${
                overnightBias.bias === 'bullish'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : overnightBias.bias === 'bearish'
                    ? 'bg-red-500/20 text-red-300'
                    : 'bg-white/10 text-gray-300'
              }`}
              title={overnightBias.detail}
            >
              {overnightBias.label}
            </span>
          )}
          {pending && (
            <>
              <span className="text-amber-300">
                Pending {pending.direction} @ {pending.level.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={cancelPending}
                className="rounded border border-sky-500/50 bg-sky-600/80 px-2 py-1 text-[10px] font-bold uppercase text-white hover:bg-sky-500"
              >
                Cancel limit
              </button>
            </>
          )}
          {position && (
            <span className="text-emerald-300">
              OPEN {position.direction} @ {position.entry.toLocaleString()}
            </span>
          )}

          <div className="mx-1 h-4 w-px bg-white/10" />

          <button
            type="button"
            onClick={jumpToOpen}
            className="rounded px-2 py-1 text-gray-400 hover:bg-white/10 hover:text-white"
            title="Jump to cash open and pause"
          >
            {instrument === 'NIKKEI' ? '9:00' : '9:30'}
          </button>
          <button
            type="button"
            onClick={replayFromOpen}
            className="rounded px-2.5 py-1 font-semibold text-violet-200 hover:bg-violet-500/20"
            title="Restart morning from open and play"
          >
            Replay
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className={`shrink-0 rounded px-2.5 py-1 font-semibold ${
              playing ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'
            }`}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <a
            href="/dashboard/journal?tab=sim"
            className="shrink-0 rounded px-2 py-1 text-gray-400 hover:bg-white/10 hover:text-violet-200"
            title="Open simulation order history"
          >
            History
          </a>
          <div
            className="flex shrink-0 flex-wrap items-center gap-0.5 rounded-md border border-white/10 bg-black/30 p-0.5"
            role="group"
            aria-label="Playback speed"
          >
            {([0.25, 0.5, 1, 2, 4, 16] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                title={`${s}× playback`}
                className={`shrink-0 rounded px-1.5 py-1 font-mono tabular-nums ${
                  speed === s ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {!followingLive && (
            <button
              type="button"
              onClick={enableFollowLive}
              className="rounded bg-sky-600/90 px-2 py-1 font-semibold text-white hover:bg-sky-500"
              title="Snap chart back to the latest sim bar"
            >
              Jump to latest
            </button>
          )}

          <button
            type="button"
            onClick={resetPriceScale}
            className="rounded border border-white/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300 hover:bg-white/10 hover:text-white"
            title="Reset price scale (and fit time) — same as TradingView"
          >
            Reset scale
          </button>

          {lastPrice != null && (
            <span className="price-mono ml-auto font-bold text-sm text-white">
              {lastPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          )}

          {canEnter && (
            <button
              type="button"
              onClick={() => {
                setManualClickPrice(null)
                setTicketLevel(null)
                setManualTicketOpen(true)
              }}
              className="rounded border border-amber-500/50 bg-amber-600/80 px-2 py-1 text-[10px] font-bold uppercase text-white hover:bg-amber-500"
              title="Manual limit — 1% account risk, size adjusts to your stop"
            >
              Place limit
            </button>
          )}
          {canEnter && (
            <span
              className="hidden text-[10px] text-gray-500 sm:inline"
              title="Double-click chart · or use playbook / Place limit"
            >
              Double-click chart
            </span>
          )}
          <button
            type="button"
            title={
              levelsOpen
                ? 'Hide AI/structure levels (working limit + SL/TP stay on chart)'
                : 'Show AI/structure levels'
            }
            onClick={() => setLevelsOpen((o) => !o)}
            className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-gray-300 hover:bg-white/10"
          >
            {levelsOpen ? 'Hide levels' : 'Levels'}
          </button>
          {!playbookOpen && (
            <button
              type="button"
              title="Show morning playbook panel"
              onClick={() => setPlaybookOpen(true)}
              className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-gray-400 hover:bg-white/10 hover:text-gray-200"
            >
              Playbook
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push('/dashboard/simulation')}
            className="rounded px-2 py-1 text-[10px] uppercase text-gray-500 hover:text-white"
          >
            Exit
          </button>
        </div>

        {/* Session + AVWAP legend */}
        <div className="pointer-events-none mt-1.5 flex flex-wrap items-center gap-3 px-1 text-[10px] uppercase tracking-wider text-gray-500">
          <span>Sessions</span>
          {sessionLegendOrder(instrument).map((name) => {
            const s = SESSION_STYLES[name]
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
            <span
              className="inline-block w-4 border-t-2"
              style={{ borderColor: VWAP_COLORS.vwap }}
            />
            <span style={{ color: VWAP_COLORS.vwap }}>AVWAP</span>
            <span className="text-gray-600">
              {deskClockFor(instrument).openLabel} · 5 trading days prior · ±1/2/3σ
            </span>
          </span>
          {ibShaped && (
            <>
              <span className="text-gray-600">·</span>
              <span
                className="flex items-center gap-1.5 normal-case tracking-normal"
                title="Initial Balance — first-hour high/low, extended to lunch (sim session end)"
              >
                <span className="inline-block w-4 border-t-2 border-blue-500" />
                <span className="text-blue-500">IB H/L</span>
                <span className="text-gray-600">to session end</span>
              </span>
            </>
          )}
        </div>

        {msg && (
          <div className="pointer-events-auto mt-1.5 max-w-xl rounded-lg border border-amber-800/40 bg-amber-950/80 px-3 py-1.5 text-[11px] text-amber-100 backdrop-blur">
            {msg}
          </div>
        )}

        {position && lastPrice != null && (
          <div className="pointer-events-auto mt-1.5 flex max-w-3xl flex-wrap items-center gap-3 rounded-lg border border-amber-700/40 bg-[#161b22]/95 px-3 py-2 text-xs backdrop-blur">
            <span className="rounded border border-amber-700/60 bg-amber-950/40 px-2 py-0.5 font-bold text-amber-200">
              MANAGE · {position.direction}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-sky-400/90">
              Watching SL / TP
            </span>
            <span className="text-gray-500">
              Entry{' '}
              <span className="price-mono text-blue-400">
                {position.entry.toLocaleString()}
              </span>
            </span>
            <span className="text-gray-500">
              SL{' '}
              <span className="price-mono text-red-400">
                {position.stopLoss.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </span>
            <span className="text-gray-500">
              TP{' '}
              <span className="price-mono text-emerald-400/80">
                {position.target.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </span>
            {/* Process meters only — no live $ P&L */}
            <span className="ml-auto flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wide text-gray-500">
              {(() => {
                const isLong = position.direction === 'LONG'
                const tpSpan = isLong
                  ? position.target - position.entry
                  : position.entry - position.target
                const slSpan = isLong
                  ? position.entry - position.stopLoss
                  : position.stopLoss - position.entry
                const toTp =
                  Math.abs(tpSpan) > 1e-9
                    ? Math.max(
                        0,
                        Math.min(
                          1,
                          (isLong
                            ? lastPrice - position.entry
                            : position.entry - lastPrice) / tpSpan
                        )
                      )
                    : null
                const roomSl =
                  Math.abs(slSpan) > 1e-9
                    ? Math.max(
                        0,
                        Math.min(
                          1,
                          (isLong
                            ? lastPrice - position.stopLoss
                            : position.stopLoss - lastPrice) / slSpan
                        )
                      )
                    : null
                return (
                  <>
                    {toTp != null && (
                      <span>
                        Path to TP{' '}
                        <span className="price-mono text-sky-300 normal-case">
                          {Math.round(toTp * 100)}%
                        </span>
                      </span>
                    )}
                    {roomSl != null && (
                      <span>
                        Room to SL{' '}
                        <span className="price-mono text-gray-300 normal-case">
                          {Math.round(roomSl * 100)}%
                        </span>
                      </span>
                    )}
                  </>
                )
              })()}
            </span>
            <button
              type="button"
              onClick={closeAtMarket}
              className="rounded-lg border border-emerald-800 px-2.5 py-1 text-[11px] font-semibold text-emerald-400"
            >
              CLOSE
            </button>
          </div>
        )}
      </div>

      {/* Morning playbook — close only hides this panel, not chart levels */}
      {playbookOpen && (
        <DraggableDeskWidget
          storageKey="desk-playbook-sim"
          defaultPos={{ x: 24, y: 72 }}
          title={
            <>
              Morning playbook
              <span className="ml-1.5 font-normal normal-case tracking-normal text-violet-300/80">
                · {levelsAiLoading ? 'AI…' : levelsSource === 'ai' ? 'AI Haiku' : 'structure'}
              </span>
            </>
          }
          onClose={() => setPlaybookOpen(false)}
          footer={
            <label className="block text-[9px] font-semibold uppercase tracking-wider text-gray-500">
              Account $
              <input
                type="number"
                value={accountSize}
                onChange={(e) => setAccountSize(Number(e.target.value) || 0)}
                className="price-mono mt-1.5 w-full rounded-lg border border-white/10 bg-[#161b22] px-2.5 py-1.5 text-xs font-semibold text-white focus:border-violet-500/40 focus:outline-none"
              />
            </label>
          }
        >
          {playbook && (
            <div className="border-b border-[#30363d] bg-[#1a1430] px-3 py-2.5 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-violet-200">
                Focus:{' '}
                {playbook.focusSide === 'BOTH' ? 'Best ★ first' : playbook.focusSide}
              </p>
              <p className="text-[10px] leading-snug text-gray-300">{playbook.focusHint}</p>
            </div>
          )}
          <div className="space-y-1.5 p-2">
            {levels.length === 0 && (
              <p className="p-2 text-[11px] text-amber-400">No levels for this session.</p>
            )}
            {levels.map((l, i) => {
              const isRes = String(l.type).toLowerCase().includes('resist')
              const whyOpen = reasoningOpen === i
              const isPrimary = l.rank !== 'watch'
              const { label: stars } = convictionStars(l.conviction)
              const why =
                l.reasoning?.trim() ||
                (isRes
                  ? 'SHORT zone — sell liquidity above bait highs.'
                  : 'BUY zone — buy liquidity below bait lows.')
              return (
                <div
                  key={`${l.level}-${i}`}
                  className={`rounded-xl border text-[11px] ${
                    isRes
                      ? 'border-red-800/80 bg-[#2a1518] text-red-200'
                      : 'border-emerald-800/80 bg-[#12241c] text-emerald-200'
                  } ${isPrimary ? 'ring-1 ring-white/25' : 'opacity-90'}`}
                >
                  <button
                    type="button"
                    disabled={!canEnter}
                    onClick={() => setTicketLevel(l)}
                    className="w-full px-2.5 py-2.5 text-left transition-all disabled:opacity-40 hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] font-bold uppercase tracking-wide">
                        {isPrimary ? 'PRIMARY' : 'WATCH'} {isRes ? 'SHORT' : 'BUY'}
                      </span>
                      <span
                        className="text-amber-300 text-[10px]"
                        title={`Conviction ${l.conviction}/10`}
                      >
                        {stars}
                      </span>
                    </div>
                    <div className="price-mono mt-1 text-base font-bold tracking-tight text-white">
                      {l.level.toLocaleString()}
                    </div>
                    <div className="mt-0.5 text-[9px] text-gray-400">
                      zone {formatZone(l.level)} · {levelsSource}
                    </div>
                  </button>
                  <div className="border-t border-white/10 px-2.5 pb-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setReasoningOpen(whyOpen ? null : i)
                      }}
                      className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 hover:text-white"
                    >
                      {whyOpen ? 'Hide why ▾' : 'Why this level ▸'}
                    </button>
                    {whyOpen && (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-300">{why}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </DraggableDeskWidget>
      )}

      {manualTicketOpen &&
        (manualClickPrice != null || lastPrice != null || ticketLevel != null) && (
        <LevelOrderTicket
          key={manualClickPrice != null ? `click-${manualClickPrice}` : 'toolbar-manual'}
          instrument={instrument}
          levelPrice={manualClickPrice ?? lastPrice ?? ticketLevel?.level ?? 0}
          entrySource="manual"
          levelType="manual"
          regime={
            overnightBias?.bias === 'bearish'
              ? 'bearish'
              : overnightBias?.bias === 'bullish'
                ? 'bullish'
                : 'choppy'
          }
          regimeConfidence={70}
          canPlace={canEnter}
          entryWindow={1}
          onClose={() => {
            setManualTicketOpen(false)
            setManualClickPrice(null)
          }}
          onPlaced={(order) => {
            setManualTicketOpen(false)
            setManualClickPrice(null)
            const pend: PendingOrder = {
              level: order.level,
              direction: order.direction,
              stopLoss: order.stopLoss,
              target: order.profitTarget,
              size: order.positionSize,
              risk: order.riskAmount,
              accountSize: order.accountSize,
              entryReason: order.entryReason,
              entrySource: 'manual',
            }
            const now = simNowRef.current
            const touched = allCandlesRef.current.find(
              (c) => c.time >= openUnix && c.time <= now && barTouches(c, pend.level)
            )
            if (touched) {
              fillPending(pend, touched.time)
              return
            }
            pendingRef.current = pend
            setPending(pend)
            setMsg(
              `Manual ${order.direction} limit @ ${order.level.toLocaleString()} — ${MANUAL_RISK_PERCENT}% risk · press Play until fill`
            )
          }}
        />
      )}

      {ticketLevel && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#30363d] bg-[#161b22] p-4">
            <div className="flex justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Sim limit order</h3>
                <p className="mt-1 text-xs text-gray-400">
                  {instrument} ·{' '}
                  <span
                    className={
                      ticketLevel.source === 'ai' ? 'text-emerald-300' : 'text-violet-300'
                    }
                  >
                    {ticketLevel.source === 'ai' ? 'AI level' : 'Structure'} ·{' '}
                    {DESK_RISK_PERCENT}% risk
                  </span>
                  <br />
                  {ticketLevel.level.toLocaleString()}
                  <span className="ml-1.5 text-gray-500">
                    zone {formatZone(ticketLevel.level)}
                  </span>
                </p>
                {ticketLevel.reasoning && (
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-300">
                    <span className="font-semibold uppercase tracking-wide text-gray-500">
                      Why ·{' '}
                    </span>
                    {ticketLevel.reasoning}
                  </p>
                )}
                {overnightBias && (
                  <p className="mt-1 text-[11px] text-gray-500">{overnightBias.detail}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setTicketLevel(null)}
                className="text-gray-500"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 flex gap-2">
              {(['LONG', 'SHORT'] as Direction[]).map((d) => {
                const prev = previewPositionSizing(
                  ticketLevel.level,
                  accountSize,
                  d,
                  zoneStopPrice(ticketLevel.level, d),
                  DESK_RISK_PERCENT
                )
                const suggested = simSuggestedDirection(
                  overnightBias?.bias ?? 'none',
                  ticketLevel.type
                )
                const isSuggested = d === suggested
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => placePending(ticketLevel, d)}
                    className={`flex-1 rounded-lg py-3 text-xs font-semibold transition ${
                      d === 'LONG' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                    } ${isSuggested ? 'ring-2 ring-white/70 scale-[1.02]' : 'opacity-55'}`}
                  >
                    <div>
                      {d === 'LONG' ? 'Deep Buy' : 'Deep Short'}
                      {isSuggested ? ' · suggested' : ''}
                    </div>
                    {prev && (
                      <div className="mt-1 font-normal opacity-80">
                        SL {prev.stop_loss_price.toFixed(0)} · size{' '}
                        {prev.position_size.toFixed(1)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-[10px] text-gray-500">
              Sim only: overnight gap + prior session. No news. You can still override.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SimulationDeskPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-gray-500 text-sm">
          Opening simulation desk…
        </div>
      }
    >
      <SimulationDeskInner />
    </Suspense>
  )
}
