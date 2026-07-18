'use client'

/**
 * Simulation replay desk (query-param driven).
 * Flow: pick day → cash open (ET/JST) → structure levels → pending → fill → manage → lunch done
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  createChart,
  ColorType,
  CrosshairMode,
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
import { sessionFor } from '@/lib/trading/sessionGate'
import { previewPositionSizing } from '@/lib/trading/positionSizing'
import { resolveSimMorningGate } from '@/lib/trading/sessionGate'
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
  type SessionHighlightSpan,
  type SessionName,
} from '@/lib/chart/sessionVwap'
import {
  computeSimOvernightBias,
  simSuggestedDirection,
} from '@/lib/trading/simOvernightBias'
import {
  convictionStars,
  resolveDeskLevels,
  type DeskPlaybook,
  zoneStopPrice,
  formatZone,
} from '@/lib/trading/deskLevels'

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
}

/** Trailing window while following the sim tip — readable bars, tip pinned right */
const FOLLOW_BARS = 96
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
  const [levelsSource, setLevelsSource] = useState<'ai' | 'structure'>('structure')
  const [levelsAiLoading, setLevelsAiLoading] = useState(false)
  const [playbook, setPlaybook] = useState<DeskPlaybook | null>(null)
  const [simNow, setSimNow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pending, setPending] = useState<PendingOrder | null>(null)
  const [position, setPosition] = useState<PaperPosition | null>(null)
  const [accountSize, setAccountSize] = useState(100000)
  const [ticketLevel, setTicketLevel] = useState<AiLevel | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [levelsOpen, setLevelsOpen] = useState(true)
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
  const levelLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([])
  const posLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([])
  const allCandlesRef = useRef<Candle[]>([])
  const sessionCandlesRef = useRef<Candle[]>([])
  const pendingRef = useRef<PendingOrder | null>(null)
  const positionRef = useRef<PaperPosition | null>(null)
  const didFitRef = useRef(false)
  const visibleCandlesRef = useRef<Candle[]>([])
  const simNowRef = useRef(0)
  const speedRef = useRef(initialSpeed)
  const lunchUnixRef = useRef(0)
  const playingRef = useRef(false)
  const followLiveRef = useRef(true)
  const ignoreRangeChangeRef = useRef(false)
  const lastAppliedBarIdxRef = useRef(-1)
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

  // Last 5 cash sessions for this index (same window as live AVWAP; clock by instrument)
  const sessionCandles = useMemo(
    () => lastNTradingSessions(allCandles, 5, deskClockFor(instrument)),
    [allCandles, instrument]
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
    }).catch(() => {})
  }, [replayDate, instrument, speed])

  // Morning-only sim gate — no live afternoon / background-memory feature
  const gate = useMemo(() => {
    if (!simNow) return null
    return resolveSimMorningGate({
      now: new Date(simNow * 1000),
      instrument,
      hasOpenPosition: !!position,
      dayDone: simNow >= lunchUnix,
    })
  }, [simNow, instrument, position, lunchUnix])

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
              `${instrument} · ${formatDateDisplay(replayDate)} · clock at ${openLabel} · AI levels (Haiku) — place a limit, then Play`
            )
          } else {
            setMsg(
              `${instrument} · ${formatDateDisplay(replayDate)} · clock at ${openLabel} · structure levels (AI unavailable) — place a limit, then Play`
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
            } — place a limit, then Play`
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
      layout: {
        background: { type: ColorType.Solid, color: '#131622' },
        textColor: '#6b7280',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1a1e2e' },
        horzLines: { color: '#1a1e2e' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#3a4268',
          width: 1 as const,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#222840',
        },
        horzLine: {
          color: '#3a4268',
          width: 1 as const,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#222840',
        },
      },
      rightPriceScale: { borderColor: '#1a1e2e' },
      timeScale: {
        borderColor: '#1a1e2e',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        // Default axis is UTC — format ticks in market TZ (ET / JST)
        tickMarkFormatter: chartFmt.tickMarkFormatter,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
      kineticScroll: {
        mouse: true,
        touch: true,
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

    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.05, bottom: 0.05 },
      borderVisible: false,
    })

    chartRef.current = chart
    seriesRef.current = series
    vwapSeriesRef.current = vwapSeries
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
      vwapSeriesRef.current = null
    }
  }, [loading])

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
    paintSessionHighlightOverlay(host, rects)
  }, [instrument])

  /** Keep the sim tip pinned to the right with a readable trailing window. */
  const pinToLatest = useCallback(
    (endIdx: number) => {
      const chart = chartRef.current
      if (!chart || endIdx < 0) return

      const ts = chart.timeScale()
      ignoreRangeChangeRef.current = true
      ts.applyOptions({
        rightOffset: FOLLOW_RIGHT_PAD,
        barSpacing: FOLLOW_BAR_SPACING,
      })
      // Logical range: trailing window ending just past the newest bar
      ts.setVisibleLogicalRange({
        from: Math.max(-2, endIdx - FOLLOW_BARS),
        to: endIdx + FOLLOW_RIGHT_PAD,
      })
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
    if (endIdx >= 0) pinToLatest(endIdx)
  }, [pinToLatest])

  const resetPriceScale = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.05, bottom: 0.05 },
    })
    // Sim: snap to tip (fitContent zooms out across all history and feels broken)
    const endIdx = lastAppliedBarIdxRef.current
    followLiveRef.current = true
    setFollowingLive(true)
    if (endIdx >= 0) {
      pinToLatest(endIdx)
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
      }

      lastAppliedBarIdxRef.current = endIdx
      const price = candles[endIdx]!.close
      lastPriceRef.current = price
      setLastPrice(price)

      // Always keep the tip in view while following (Play or after reset)
      if (opts?.fit || !didFitRef.current || followLiveRef.current) {
        pinToLatest(endIdx)
      } else {
        requestAnimationFrame(() => refreshSessionHighlights())
      }
    },
    [pinToLatest, refreshSessionHighlights]
  )

  // Initial / seek chart paint (not every clock tick)
  useEffect(() => {
    if (!chartReady || sessionCandles.length === 0 || !simNow) return
    applyChartData(simNow, { force: true, fit: !didFitRef.current })
  }, [chartReady, sessionCandles, applyChartData]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chartReady || !chartRef.current) return
    const host = sessionOverlayRef.current
    const el = containerRef.current
    let settleTimer = 0
    let rafPending = 0
    let pointerDown = false

    const paintNow = () => {
      if (pointerDown) return
      if (rafPending) cancelAnimationFrame(rafPending)
      rafPending = requestAnimationFrame(() => {
        rafPending = 0
        if (pointerDown) return
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

    const beginInteract = () => {
      pointerDown = true
      if (host) host.style.opacity = '0'
      window.clearTimeout(settleTimer)
    }

    const endInteract = () => {
      if (!pointerDown) return
      pointerDown = false
      scheduleSettle()
    }

    const onRangeChange = () => {
      // Hide bands while dragging — chart pan stays 60fps like TradingView
      if (host) host.style.opacity = '0'
      if (!pointerDown) scheduleSettle()

      // User panned/zoomed away from the tip → stop auto-follow so we don't fight them
      if (ignoreRangeChangeRef.current || !followLiveRef.current) return
      const range = chartRef.current?.timeScale().getVisibleLogicalRange()
      const endIdx = lastAppliedBarIdxRef.current
      if (!range || endIdx < 0) return
      if (range.to < endIdx - 3) {
        followLiveRef.current = false
        setFollowingLive(false)
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
      window.removeEventListener('pointerup', endInteract)
      window.removeEventListener('pointercancel', endInteract)
    }
  }, [chartReady, refreshSessionHighlights])

  // Starting Play always snaps back to the live tip
  useEffect(() => {
    if (!playing) return
    enableFollowLive()
  }, [playing, enableFollowLive])

  // Trade levels — hidden while working or in a position (only Entry / SL / TP show)
  useEffect(() => {
    if (!seriesRef.current || !chartReady) return
    levelLinesRef.current.forEach((l) => {
      try {
        seriesRef.current?.removePriceLine(l)
      } catch {
        /* ignore */
      }
    })
    levelLinesRef.current = []

    if (position || pending) return

    for (const lv of levels.slice(0, 4)) {
      const isRes = String(lv.type).toLowerCase().includes('resist')
      const side = isRes ? 'SHORT' : 'BUY'
      const isPrimary = lv.rank !== 'watch'
      const { label: stars } = convictionStars(lv.conviction)
      try {
        levelLinesRef.current.push(
          seriesRef.current.createPriceLine({
            price: lv.level,
            color: isRes ? '#f87171' : '#34d399',
            lineWidth: isPrimary ? 2 : 1,
            lineStyle: isPrimary ? LineStyle.Solid : LineStyle.Dashed,
            // Labels live in the top-right panel — keep price axis readable
            axisLabelVisible: false,
            title: `${isPrimary ? 'PRIMARY' : 'WATCH'} ${side} ${stars}`,
          })
        )
      } catch {
        /* ignore */
      }
    }
  }, [levels, chartReady, position, pending])

  // Pending working limit + open position — always visible on the sim chart
  useEffect(() => {
    if (!seriesRef.current || !chartReady) return
    posLinesRef.current.forEach((l) => {
      try {
        seriesRef.current?.removePriceLine(l)
      } catch {
        /* ignore */
      }
    })
    posLinesRef.current = []

    const specs: Array<{
      price: number
      color: string
      title: string
      style: LineStyle
    }> = []

    if (position) {
      specs.push(
        {
          price: position.entry,
          color: '#3b82f6',
          title: `Entry ${position.direction}`,
          style: LineStyle.Solid,
        },
        { price: position.stopLoss, color: '#ef4444', title: 'Stop Loss', style: LineStyle.Dashed },
        { price: position.target, color: '#22c55e', title: 'Target', style: LineStyle.Dashed }
      )
    } else if (pending) {
      specs.push(
        {
          price: pending.level,
          color: '#38bdf8',
          title: `WORKING ${pending.direction}`,
          style: LineStyle.Solid,
        },
        {
          price: pending.stopLoss,
          color: '#ef4444',
          title: 'SL (if filled)',
          style: LineStyle.Dotted,
        },
        {
          price: pending.target,
          color: '#22c55e',
          title: 'TP (if filled)',
          style: LineStyle.Dotted,
        }
      )
    }

    for (const s of specs) {
      try {
        posLinesRef.current.push(
          seriesRef.current.createPriceLine({
            price: s.price,
            color: s.color,
            lineWidth: 2,
            lineStyle: s.style,
            axisLabelVisible: true,
            title: s.title,
          })
        )
      } catch {
        /* ignore */
      }
    }
  // Do not depend on lastPrice — recreating axis labels every tick makes them "pop"
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
    }
    // Sync refs before next playback tick (16x can fire before React effects)
    pendingRef.current = null
    positionRef.current = filled
    setPosition(filled)
    setPending(null)
    setLevelsOpen(false)
    setMsg(`FILLED ${pend.direction} @ ${pend.level.toLocaleString()} — SL/TP only`)
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
        }),
      }).catch(() => {
        /* history write is best-effort — desk keeps running */
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
          simNowRef.current = next
          setSimNow(next)
          applyChartDataRef.current(next)
          setPlaying(false)
          setMsg(`STOP HIT @ ${closed.stopLoss.toLocaleString()} — levels updated`)
          setLevels((prev) =>
            applySimTradeOutcome(prev, closed.entry, closed.direction, 'stop')
          )
          setPosition(null)
          setLevelsOpen(true)
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
          setLevelsOpen(true)
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
    setLevelsOpen(true)
    setMsg('Working limit cancelled — entry window closed (never filled)')
  }, [simNow, entryCloseUnix, pending])

  const placePending = useCallback(
    (level: AiLevel, direction: Direction) => {
      if (position) {
        setMsg('Already in a position — manage or close first')
        return
      }
      const now = simNowRef.current
      if (now > entryCloseUnix) {
        setMsg(
          `Entry window closed (after ${sess.entryClose.slice(0, 5)} ${tzLabel} sim time)`
        )
        return
      }
      // Zone-based stop: beyond the far edge of the level's zone (sweep-proof)
      const preview = previewPositionSizing(
        level.level,
        accountSize,
        direction,
        zoneStopPrice(level.level, direction)
      )
      if (!preview) {
        setMsg('Invalid sizing')
        return
      }
      const order: PendingOrder = {
        level: level.level,
        direction,
        stopLoss: preview.stop_loss_price,
        target: preview.profit_target_price,
        size: preview.position_size,
        risk: preview.risk_amount,
        accountSize,
        entryReason:
          level.reasoning ||
          `${level.rank === 'primary' ? 'PRIMARY' : 'WATCH'} ${
            level.side || (direction === 'LONG' ? 'BUY' : 'SHORT')
          } level`,
        conviction: level.conviction,
      }

      // Immediate fill if any bar from open→now already touched
      const touched = allCandlesRef.current.find(
        (c) => c.time >= openUnix && c.time <= now && barTouches(c, order.level)
      )
      setTicketLevel(null)
      setLevelsOpen(false) // hide playbook until SL/TP (or cancel) — clear chart
      if (touched) {
        fillPending(order, touched.time)
        setPlaying(true)
        return
      }

      pendingRef.current = order
      setPending(order)
      setMsg(
        `Pending ${direction} limit @ ${level.level.toLocaleString()} — other levels hidden · Play until fill`
      )
      setPlaying(true)
    },
    [position, entryCloseUnix, accountSize, openUnix, fillPending, sess.entryClose, tzLabel]
  )

  const closeAtMarket = () => {
    const price = lastPriceRef.current ?? lastPrice
    if (!position || price == null) return
    const closed = position
    recordPaperClose(closed, price, 'manual')
    positionRef.current = null
    setMsg(`Closed @ ${price.toLocaleString()} — manage ended · levels back`)
    setLevels((prev) =>
      applySimTradeOutcome(prev, closed.entry, closed.direction, 'target')
    )
    setPosition(null)
    setLevelsOpen(true)
    setPlaying(false)
  }

  const resetSessionProgress = () => {
    sessionEpochRef.current += 1
    sessionCompletedRef.current = false
    tradesCountRef.current = 0
    realizedPnlRef.current = 0
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
    setLevelsOpen(true)
    resetSessionProgress()
    setMsg(
      instrument === 'NIKKEI'
        ? 'Reset to 9:00 AM JST — place a level order, then Play'
        : 'Reset to 9:30 AM ET — place a level order, then Play'
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
    setLevelsOpen(true)
    resetSessionProgress()
    setMsg(
      instrument === 'NIKKEI'
        ? 'Replay from 9:00 AM JST — place a level or watch the morning'
        : 'Replay from 9:30 AM ET — place a level or watch the morning'
    )
    setPlaying(true)
  }

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
  const canEnter = !position && !pending && simNow <= entryCloseUnix && simNow >= openUnix

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
          <div className="pointer-events-none absolute left-3 top-14 z-20 max-w-[min(340px,70%)]">
            <div
              className={`rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm ${
                position
                  ? 'border-emerald-500/40 bg-emerald-950/85 text-emerald-100'
                  : 'border-sky-500/40 bg-sky-950/85 text-sky-100'
              }`}
            >
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
            <span className="text-amber-300">
              Pending {pending.direction} @ {pending.level.toLocaleString()}
            </span>
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
            className={`rounded px-2.5 py-1 font-semibold ${
              playing ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'
            }`}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          {[0.25, 0.5, 1, 2, 4, 16].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`rounded px-1.5 py-1 ${
                speed === s ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-white'
              }`}
            >
              {s}x
            </button>
          ))}

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

          {!(position || pending) && (
            <button
              type="button"
              onClick={() => setLevelsOpen((o) => !o)}
              className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-gray-300 hover:bg-white/10"
            >
              {levelsOpen ? 'Hide levels' : 'Levels'}
            </button>
          )}
          {(position || pending) && (
            <span className="rounded border border-blue-700/50 bg-blue-950/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-200">
              Levels hidden · SL / TP only
            </span>
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
          {(Object.keys(SESSION_STYLES) as SessionName[]).map((name) => {
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
              {deskClockFor(instrument).openLabel} · 5 sessions · ±1/2/3σ
            </span>
          </span>
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

      {/* Levels panel — bottom-center so it doesn't cover chart action */}
      {levelsOpen && !position && !pending && (
        <div className="absolute bottom-10 left-1/2 z-30 flex w-72 max-h-[min(38vh,360px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0d1117]/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Morning playbook
              <span className="ml-1.5 normal-case tracking-normal text-gray-600">
                · {levelsAiLoading ? 'AI…' : levelsSource === 'ai' ? 'AI Haiku' : 'structure'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setLevelsOpen(false)}
              className="text-gray-600 hover:text-white"
            >
              ✕
            </button>
          </div>
          {playbook && (
            <div className="border-b border-white/10 px-3 py-2 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-violet-300">
                Focus:{' '}
                {playbook.focusSide === 'BOTH'
                  ? 'Best ★ first'
                  : playbook.focusSide}
              </p>
              <p className="text-[10px] leading-snug text-gray-400">{playbook.focusHint}</p>
            </div>
          )}
          <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
            {levels.length === 0 && (
              <p className="p-2 text-[11px] text-amber-500/90">No levels for this session.</p>
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
                  className={`rounded-lg border text-[11px] ${
                    isRes
                      ? 'border-red-900/50 bg-red-950/40 text-red-300'
                      : 'border-emerald-900/50 bg-emerald-950/40 text-emerald-300'
                  } ${isPrimary ? 'ring-1 ring-white/15' : 'opacity-75'}`}
                >
                  <button
                    type="button"
                    disabled={!canEnter}
                    onClick={() => setTicketLevel(l)}
                    className="w-full px-2.5 py-2 text-left transition-all disabled:opacity-40 hover:brightness-110"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] font-bold uppercase">
                        {isPrimary ? 'PRIMARY' : 'WATCH'} {isRes ? 'SHORT' : 'BUY'}
                      </span>
                      <span className="text-amber-300/90 text-[10px]" title={`Conviction ${l.conviction}/10`}>
                        {stars}
                      </span>
                    </div>
                    <div className="price-mono mt-0.5 text-sm font-bold text-white">
                      {l.level.toLocaleString()}
                    </div>
                    <div className="mt-0.5 text-[9px] text-gray-500">
                      zone {formatZone(l.level)} · {levelsSource}
                    </div>
                  </button>
                  <div className="border-t border-white/5 px-2 pb-2">
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
                      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-300">
                        {why}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="border-t border-white/10 p-2">
            <label className="text-[9px] uppercase text-gray-600">
              Account $
              <input
                type="number"
                value={accountSize}
                onChange={(e) => setAccountSize(Number(e.target.value) || 0)}
                className="price-mono mt-1 w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-white"
              />
            </label>
          </div>
        </div>
      )}

      {ticketLevel && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[#30363d] bg-[#161b22] p-4">
            <div className="flex justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Sim limit order</h3>
                <p className="mt-1 text-xs text-gray-400">
                  {instrument} · {ticketLevel.level.toLocaleString()}
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
                  zoneStopPrice(ticketLevel.level, d)
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
