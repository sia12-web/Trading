'use client'

/**
 * Simulation replay desk (query-param driven).
 * Flow: pick day → cash open → full 1/1/1 session (OR30 → IB/US → Lunch-range) → cash close
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
  MAX_DAY_ATTEMPTS,
  attemptLadderFromCounts,
  deskMarketFor,
  ibStrategyEndHms,
  lunchRangeEntryEndHms,
  resolveSimMorningGate,
  sessionFor,
} from '@/lib/trading/sessionGate'
import { classifyAttemptBucket } from '@/lib/trading/attemptLadder'
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
import { DESK_CHART_THEME } from '@/lib/chart/deskChartTheme'
import {
  computeSimOvernightBias,
  simSuggestedDirection,
} from '@/lib/trading/simOvernightBias'
import {
  convictionStars,
  resolveDeskLevels,
  computeInitialBalance,
  computeIbSignals,
  ibLineSeriesData,
  type DeskPlaybook,
  type InitialBalanceRange,
  formatZone,
} from '@/lib/trading/deskLevels'
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
} from '@/lib/chart/nikkeiUsRangeBreakout'
import {
  activeRangeForPlaybook,
  strategyEntryRisk,
  type StrategyRangeEdges,
  type StrategyRiskMagnets,
} from '@/lib/trading/strategyRiskGeometry'
import {
  resolveDeskPlaybookMode,
  deskPlaybookPanelTitle,
  deskPlaybookHint,
  deskPlaybookToolbarLabel,
  isDeskWatchOnlyPlaybook,
} from '@/lib/trading/deskPlaybookMode'
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
  /** Sim clock when this window's working limit expires */
  windowEndUnix: number
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

/** Trader wall-clock formatters — Montreal for every instrument. */
function makeChartFormatters(timeZone: string, tzLabel: string): ChartFmt {
  const fmtTime = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const fmtTimeSec = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
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
      // Chart series times are desk-shifted — read UTC comps as wall clock
      const unix =
        typeof time === 'number' ? time : Math.floor(new Date(String(time)).getTime() / 1000)
      if (!Number.isFinite(unix)) return ''
      switch (tickMarkType) {
        case TickMarkType.Year:
          return formatChartDate(unix, 'year')
        case TickMarkType.Month:
          return formatChartDate(unix, 'month')
        case TickMarkType.DayOfMonth:
          return formatChartDate(unix, 'day')
        case TickMarkType.TimeWithSeconds:
          return formatChartClock(unix, true)
        case TickMarkType.Time:
        default:
          return formatChartClock(unix)
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
  const tzLabel = TRADER_DISPLAY_LABEL
  const chartFmt = useMemo(
    () => makeChartFormatters(TRADER_DISPLAY_TZ, tzLabel),
    [tzLabel]
  )
  const toUnix = instrument === 'NIKKEI' ? tokyoDateTimeToUnix : nyDateTimeToUnix
  const [openH, openM] = sess.marketOpen.split(':').map(Number)
  const [entryH, entryM] = sess.entryClose.split(':').map(Number)
  const [lunchH, lunchM] = sess.lunchClose.split(':').map(Number)
  const [closeH, closeM] = sess.marketClose.split(':').map(Number)

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
  /** Day fill count (AM + IB/US + LN) — hard cap 3 */
  const [attemptsUsed, setAttemptsUsed] = useState(0)
  const [morningAttempts, setMorningAttempts] = useState(0)
  const [ibAttempts, setIbAttempts] = useState(0)
  const [lunchAttempts, setLunchAttempts] = useState(0)
  /** Stop-outs this replay (informational; fill itself locks the slot) */
  const [stopHits, setStopHits] = useState(0)
  const attemptsUsedRef = useRef(0)
  const morningAttemptsRef = useRef(0)
  const ibAttemptsRef = useRef(0)
  const lunchAttemptsRef = useRef(0)
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return

      const key = e.key.toLowerCase()

      if (key === 'f') {
        e.preventDefault()
        toggleFullscreen()
      } else if (key === 'l') {
        e.preventDefault()
        setLevelsOpen((prev) => !prev)
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
        setPlaybookOpen((prev) => !prev)
      } else if (key === 'escape') {
        if (manualTicketOpen) {
          e.preventDefault()
          setManualTicketOpen(false)
          setManualClickPrice(null)
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
  }, [isFullscreen, manualTicketOpen, toggleFullscreen, instrument])

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
  const [lunchShaped, setLunchShaped] = useState(false)
  const [usRangeShaped, setUsRangeShaped] = useState(false)
  /** Script overlays — same toggles as live (B / N / U / R) */
  const [showIbBreakouts, setShowIbBreakouts] = useState(true)
  const [showLunchRange, setShowLunchRange] = useState(true)
  const [showUsRange, setShowUsRange] = useState(true)
  const [showOr30, setShowOr30] = useState(true)
  const showIbBreakoutsRef = useRef(true)
  const showLunchRangeRef = useRef(true)
  const showUsRangeRef = useRef(true)
  const showOr30Ref = useRef(true)
  const or30SeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const or30RangeRef = useRef<Or30Range | null>(null)
  const ibRangeRef = useRef<InitialBalanceRange | null>(null)
  const lunchRangeRef = useRef<NycLunchRange | null>(null)
  const usRangeRef = useRef<{ high: number; low: number } | null>(null)
  const lunchSeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
    mid: ISeriesApi<'Line'>
  } | null>(null)
  const usRangeSeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const avwapLastRef = useRef<number | null>(null)
  const [or30Shaped, setOr30Shaped] = useState(false)

  useEffect(() => {
    showIbBreakoutsRef.current = showIbBreakouts
  }, [showIbBreakouts])
  useEffect(() => {
    showLunchRangeRef.current = showLunchRange
  }, [showLunchRange])
  useEffect(() => {
    showUsRangeRef.current = showUsRange
  }, [showUsRange])
  useEffect(() => {
    showOr30Ref.current = showOr30
  }, [showOr30])

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
  const cashCloseUnixRef = useRef(0)
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
  const cashCloseUnix = useMemo(
    () => (replayDate ? toUnix(replayDate, closeH!, closeM || 0) : 0),
    [replayDate, toUnix, closeH, closeM]
  )
  const market = deskMarketFor(instrument)
  const midEndUnix = useMemo(() => {
    if (!replayDate) return 0
    const [h, m] = ibStrategyEndHms(market).split(':').map(Number)
    return toUnix(replayDate, h!, m || 0)
  }, [replayDate, toUnix, market])
  const lateEndUnix = useMemo(() => {
    if (!replayDate) return 0
    const [h, m] = lunchRangeEntryEndHms(market).split(':').map(Number)
    return toUnix(replayDate, h!, m || 0)
  }, [replayDate, toUnix, market])

  useEffect(() => {
    lunchUnixRef.current = lunchUnix
  }, [lunchUnix])
  useEffect(() => {
    cashCloseUnixRef.current = cashCloseUnix
  }, [cashCloseUnix])

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

  // Full-day sim gate — same 1/1/1 ladder as live (no clock-in)
  const gate = useMemo(() => {
    if (!simNow) return null
    return resolveSimMorningGate({
      now: new Date(simNow * 1000),
      instrument,
      hasOpenPosition: !!position,
      dayDone: cashCloseUnix > 0 && simNow >= cashCloseUnix,
      morningAttempts,
      ibAttempts,
      lunchAttempts,
      stopHits,
    })
  }, [
    simNow,
    instrument,
    position,
    cashCloseUnix,
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    stopHits,
  ])

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
          `Cash open ${deskLocalHmsAsTraderDisplay(sess.marketOpen, sess.tz, new Date(`${replayDate}T12:00:00Z`))} ${TRADER_DISPLAY_LABEL}`
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
          // Series times are desk-shifted — format UTC comps as wall clock
          const unix =
            typeof time === 'number'
              ? time
              : Math.floor(new Date(String(time)).getTime() / 1000)
          if (!Number.isFinite(unix)) return ''
          return `${formatChartDate(unix, 'day')} ${formatChartClock(unix)} ${chartFmt.tzLabel}`
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
      autoscaleInfoProvider: () => {
        const list = allCandlesRef.current
        if (!list || list.length === 0) return null
        const range = chart.timeScale().getVisibleLogicalRange()
        let visible = list
        if (range && Number.isFinite(range.from) && Number.isFinite(range.to)) {
          const fromIdx = Math.max(0, Math.floor(range.from))
          const toIdx = Math.min(list.length - 1, Math.ceil(range.to))
          if (fromIdx <= toIdx) {
            visible = list.slice(fromIdx, toIdx + 1)
          }
        }
        if (visible.length === 0 || !visible[0]) return null
        let minValue = visible[0].low
        let maxValue = visible[0].high
        for (let i = 1; i < visible.length; i++) {
          const c = visible[i]
          if (c && c.low < minValue) minValue = c.low
          if (c && c.high > maxValue) maxValue = c.high
        }
        return {
          priceRange: {
            minValue,
            maxValue,
          },
        }
      },
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

    // OR30 — teal H/L (morning bait), same as live desk
    const or30LineOpts = {
      color: OR30_COLORS.high,
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    }
    const or30Series = {
      high: chart.addLineSeries({ ...or30LineOpts, title: 'OR30 H' }),
      low: chart.addLineSeries({ ...or30LineOpts, title: 'OR30 L' }),
    }

    const lunchLineOpts = {
      color: NYC_LUNCH_COLORS.high,
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    }
    const lunchSeries = {
      high: chart.addLineSeries({ ...lunchLineOpts, color: NYC_LUNCH_COLORS.high, title: 'LN H' }),
      low: chart.addLineSeries({ ...lunchLineOpts, color: NYC_LUNCH_COLORS.low, title: 'LN L' }),
      mid: chart.addLineSeries({
        ...lunchLineOpts,
        color: NYC_LUNCH_COLORS.mid,
        lineWidth: 1 as const,
        lineStyle: LineStyle.Dashed,
        title: 'LN 50%',
      }),
    }

    const usLineOpts = {
      color: NIKKEI_US_RANGE_COLORS.high,
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    }
    const usRangeSeries = {
      high: chart.addLineSeries({ ...usLineOpts, title: 'US H' }),
      low: chart.addLineSeries({ ...usLineOpts, title: 'US L' }),
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
    or30SeriesRef.current = or30Series
    lunchSeriesRef.current = lunchSeries
    usRangeSeriesRef.current = usRangeSeries
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
      or30SeriesRef.current = null
      lunchSeriesRef.current = null
      usRangeSeriesRef.current = null
      or30RangeRef.current = null
      ibRangeRef.current = null
      lunchRangeRef.current = null
      usRangeRef.current = null
      avwapLastRef.current = null
      setIbShaped(false)
      setOr30Shaped(false)
      setLunchShaped(false)
      setUsRangeShaped(false)
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

    const tz = TRADER_DISPLAY_TZ
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
  }, [instrument, sess.tz])

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
        time: toChartTime(c.time, TRADER_DISPLAY_TZ) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })

      const shiftBand = <T extends { time: number | UTCTimestamp; value: number }>(rows: T[]) =>
        mapTimesToChart(
          rows.map((r) => ({ time: r.time as number, value: r.value })),
          TRADER_DISPLAY_TZ
        ).map((r) => ({ time: r.time as UTCTimestamp, value: r.value }))

      const paintIbAndOr30 = (slice: Candle[]) => {
        const bars = slice.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
        const tip = slice[slice.length - 1]?.time ?? simT
        const sessionEnd = cashCloseUnix || lunchUnix || tip
        const extendTo = Math.max(tip, sessionEnd, simT)

        const ibs = ibSeriesRef.current
        if (ibs && openUnix) {
          const ib = computeInitialBalance(bars, openUnix, simT)
          ibRangeRef.current = ib
          // IB H/L lines always paint when shaped (live: B toggles markers only)
          if (ib) {
            const pts = ibLineSeriesData(ib, extendTo)
            try {
              ibs.high.setData(shiftBand(pts.high.map((p) => ({ time: p.time, value: p.value }))))
              ibs.low.setData(shiftBand(pts.low.map((p) => ({ time: p.time, value: p.value }))))
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

        const ors = or30SeriesRef.current
        if (ors && openUnix) {
          const or30 = computeOr30Range(bars, openUnix, simT)
          or30RangeRef.current = or30
          if (showOr30Ref.current && or30) {
            const pts = or30LineSeriesData(or30, extendTo)
            try {
              ors.high.setData(shiftBand(pts.high.map((p) => ({ time: p.time, value: p.value }))))
              ors.low.setData(shiftBand(pts.low.map((p) => ({ time: p.time, value: p.value }))))
              setOr30Shaped(true)
            } catch {
              ors.high.setData([])
              ors.low.setData([])
              setOr30Shaped(false)
            }
          } else {
            ors.high.setData([])
            ors.low.setData([])
            setOr30Shaped(!!or30 && showOr30Ref.current)
          }
        }

        const lns = lunchSeriesRef.current
        if (lns) {
          if (isNycLunchInstrument(instrument) && replayDate) {
            const lunch = computeNycLunchRange(
              bars.map((c) => ({ time: c.time, high: c.high, low: c.low })),
              replayDate,
              Math.max(tip, simT)
            )
            lunchRangeRef.current = lunch
            if (showLunchRangeRef.current && lunch) {
              const pts = nycLunchLineSeriesData(lunch, extendTo, { showMid: true })
              try {
                lns.high.setData(shiftBand(pts.high))
                lns.low.setData(shiftBand(pts.low))
                lns.mid.setData(shiftBand(pts.mid))
                setLunchShaped(true)
              } catch {
                lns.high.setData([])
                lns.low.setData([])
                lns.mid.setData([])
                setLunchShaped(false)
              }
            } else {
              lns.high.setData([])
              lns.low.setData([])
              lns.mid.setData([])
              setLunchShaped(false)
            }
          } else {
            lunchRangeRef.current = null
            lns.high.setData([])
            lns.low.setData([])
            lns.mid.setData([])
            setLunchShaped(false)
          }
        }

        const uss = usRangeSeriesRef.current
        if (uss) {
          if (isNikkeiUsRangeInstrument(instrument)) {
            const us = currentNikkeiUsRangeForChart(bars, Math.max(tip, simT))
            usRangeRef.current = us ? { high: us.high, low: us.low } : null
            if (showUsRangeRef.current && us) {
              const pts = nikkeiUsRangeLineSeriesData(us, extendTo)
              try {
                uss.high.setData(shiftBand(pts.high))
                uss.low.setData(shiftBand(pts.low))
                setUsRangeShaped(true)
              } catch {
                uss.high.setData([])
                uss.low.setData([])
                setUsRangeShaped(false)
              }
            } else {
              uss.high.setData([])
              uss.low.setData([])
              setUsRangeShaped(false)
            }
          } else {
            usRangeRef.current = null
            uss.high.setData([])
            uss.low.setData([])
            setUsRangeShaped(false)
          }
        }

        // Script markers — IB / OR30 / Lunch / US Range (same as live)
        const candleSeries = seriesRef.current
        if (candleSeries) {
          type Mk = {
            time: UTCTimestamp
            position: 'aboveBar' | 'belowBar'
            color: string
            shape: 'arrowUp' | 'arrowDown' | 'circle'
            text: string
          }
          const markers: Mk[] = []
          if (showIbBreakoutsRef.current && ibRangeRef.current) {
            for (const s of computeIbSignals(bars, ibRangeRef.current)) {
              markers.push({
                time: s.time as UTCTimestamp,
                position: s.position,
                color: s.color,
                shape: s.shape,
                text: s.text,
              })
            }
          }
          if (showOr30Ref.current && or30RangeRef.current) {
            for (const s of computeOr30Signals(bars, or30RangeRef.current)) {
              markers.push({
                time: s.time as UTCTimestamp,
                position: s.position,
                color: s.color,
                shape: s.shape,
                text: s.text,
              })
            }
          }
          if (showLunchRangeRef.current && lunchRangeRef.current) {
            for (const m of nycLunchEndMarkers(lunchRangeRef.current)) {
              markers.push({
                time: m.time as UTCTimestamp,
                position: m.position,
                color: m.color,
                shape: m.shape,
                text: m.text,
              })
            }
            for (const s of computeNycLunchSignals(bars, lunchRangeRef.current)) {
              markers.push({
                time: s.time as UTCTimestamp,
                position: s.position,
                color: s.color,
                shape: s.shape,
                text: s.text,
              })
            }
          }
          if (showUsRangeRef.current && isNikkeiUsRangeInstrument(instrument)) {
            const us = computeNikkeiUsRangeBreakout(bars)
            if (us) {
              for (const s of us.signals) {
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
          try {
            candleSeries.setMarkers(
              mapTimesToChart(
                markers.map((m) => ({ ...m, time: m.time as number })),
                TRADER_DISPLAY_TZ
              ).map((m) => ({ ...m, time: m.time as UTCTimestamp }))
            )
          } catch {
            try {
              candleSeries.setMarkers([])
            } catch {
              /* ignore */
            }
          }
        }
      }

      if (force || lastAppliedBarIdxRef.current < 0) {
        const slice = candles.slice(0, endIdx + 1)
        series.setData(slice.map(toBar))
        visibleCandlesRef.current = slice

        const clock = deskClockFor(instrument)
        const bands = computeAnchoredVwap(slice, clock)
        const vs = vwapSeriesRef.current
        if (vs && bands) {
          vs.vwap.setData(shiftBand(bands.vwap))
          vs.upper1.setData(shiftBand(bands.upper1))
          vs.lower1.setData(shiftBand(bands.lower1))
          vs.upper2.setData(shiftBand(bands.upper2))
          vs.lower2.setData(shiftBand(bands.lower2))
          vs.upper3.setData(shiftBand(bands.upper3))
          vs.lower3.setData(shiftBand(bands.lower3))
          const lastV = bands.vwap[bands.vwap.length - 1]
          avwapLastRef.current =
            lastV && lastV.value > 0 ? lastV.value : null
        } else if (vs) {
          vs.vwap.setData([])
          vs.upper1.setData([])
          vs.lower1.setData([])
          vs.upper2.setData([])
          vs.lower2.setData([])
          vs.upper3.setData([])
          vs.lower3.setData([])
          avwapLastRef.current = null
        }

        paintIbAndOr30(slice)

        // Seed host once so price lines bind to the right scale — never setData again
        const host = priceLineHostRef.current
        if (host && !priceLineHostSeededRef.current && slice.length > 0) {
          const a = slice[0]!
          const b = slice[slice.length - 1]!
          host.setData([
            { time: toChartTime(a.time, TRADER_DISPLAY_TZ) as UTCTimestamp, value: a.close },
            { time: toChartTime(b.time, TRADER_DISPLAY_TZ) as UTCTimestamp, value: b.close },
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
          vs.vwap.setData(shiftBand(bands.vwap))
          vs.upper1.setData(shiftBand(bands.upper1))
          vs.lower1.setData(shiftBand(bands.lower1))
          vs.upper2.setData(shiftBand(bands.upper2))
          vs.lower2.setData(shiftBand(bands.lower2))
          vs.upper3.setData(shiftBand(bands.upper3))
          vs.lower3.setData(shiftBand(bands.lower3))
          const lastV = bands.vwap[bands.vwap.length - 1]
          avwapLastRef.current =
            lastV && lastV.value > 0 ? lastV.value : null
        }

        paintIbAndOr30(slice)
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
    [pinToLatest, refreshSessionHighlights, instrument, openUnix, lunchUnix, cashCloseUnix, sess.tz, replayDate]
  )

  /** Active playbook range (+ other magnets) for strategy SL/TP — same geometry as live. */
  const getStrategyRiskBundle = useCallback((): {
    strategyRange: StrategyRangeEdges | null
    strategyMagnets: StrategyRiskMagnets
  } => {
    const ladder = attemptLadderFromCounts({
      morningAttempts: morningAttemptsRef.current,
      ibAttempts: ibAttemptsRef.current,
      lunchAttempts: lunchAttemptsRef.current,
      morningStopHits: Math.min(stopHitsRef.current, morningAttemptsRef.current),
    })
    const playbookMode = resolveDeskPlaybookMode({
      instrument,
      now: new Date(simNowRef.current * 1000),
      ladder,
    })
    const strategyRange = activeRangeForPlaybook({
      playbookMode,
      instrument,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      lunchRange: lunchRangeRef.current,
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
      strategyMagnets: {
        avwap: avwapLastRef.current,
        extras,
      },
    }
  }, [instrument])

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

  // Re-paint script overlays when toggles change
  useEffect(() => {
    if (!chartReady || !simNowRef.current) return
    applyChartDataRef.current(simNowRef.current, { force: true })
  }, [chartReady, showIbBreakouts, showLunchRange, showUsRange, showOr30])

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

  const fillPending = useCallback(
    (pend: PendingOrder, at: number) => {
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
      pendingRef.current = null
      positionRef.current = filled

      const bucket = classifyAttemptBucket(instrument, at * 1000)
      if (bucket === 'morning') {
        morningAttemptsRef.current += 1
        setMorningAttempts(morningAttemptsRef.current)
      } else if (bucket === 'ib') {
        ibAttemptsRef.current += 1
        setIbAttempts(ibAttemptsRef.current)
      } else if (bucket === 'lunch_range') {
        lunchAttemptsRef.current += 1
        setLunchAttempts(lunchAttemptsRef.current)
      }
      const day =
        morningAttemptsRef.current +
        ibAttemptsRef.current +
        lunchAttemptsRef.current
      attemptsUsedRef.current = day
      setAttemptsUsed(day)

      setPosition(filled)
      setPending(null)
      const slot =
        bucket === 'ib'
          ? instrument === 'NIKKEI'
            ? 'US'
            : 'IB'
          : bucket === 'lunch_range'
            ? instrument === 'NIKKEI'
              ? 'IB'
              : 'LN'
            : 'AM'
      setMsg(
        'FILLED ' +
          pend.direction +
          ' @ ' +
          pend.level.toLocaleString() +
          ' — ' +
          slot +
          ' · day ' +
          day +
          '/' +
          MAX_DAY_ATTEMPTS +
          ' (in a trade)'
      )
    },
    [instrument]
  )

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
    const duration = Math.max(
      0,
      (simNowRef.current || cashCloseUnixRef.current || lunchUnixRef.current) -
        (openUnix || 0)
    )
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
          notes: 'Sim day finished at cash close',
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
      const endAt = cashCloseUnixRef.current || lunchUnixRef.current
      if (!endAt || candles.length === 0) {
        setPlaying(false)
        return
      }

      // Next bar after the current sim clock (binary search)
      const nextIdx = lastIndexAtOrBefore(candles, prev) + 1
      if (nextIdx >= candles.length || candles[nextIdx]!.time > endAt) {
        simNowRef.current = endAt
        setSimNow(endAt)
        applyChartDataRef.current(endAt)
        setPlaying(false)
        setMsg(
          `Sim clock reached cash close (${deskLocalHmsAsTraderDisplay(sess.marketClose, sess.tz)} ${TRADER_DISPLAY_LABEL}) — day finished`
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
          setStopHits(stopHitsRef.current)
          simNowRef.current = next
          setSimNow(next)
          applyChartDataRef.current(next)
          setPlaying(false)
          setMsg(
            `STOP HIT @ ${closed.stopLoss.toLocaleString()} — day ${attemptsUsedRef.current}/${MAX_DAY_ATTEMPTS}`
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

  // If clock is already at/after cash close (paused at end), flip picker to "done"
  useEffect(() => {
    if (!cashCloseUnix || !simNow) return
    if (simNow >= cashCloseUnix) void markSessionCompleted()
  }, [simNow, cashCloseUnix, markSessionCompleted])

  // Unfilled sim limits expire when that slot's entry window ends
  useEffect(() => {
    if (!pending) return
    if (simNow <= pending.windowEndUnix) return
    pendingRef.current = null
    setPending(null)
    setMsg('Working limit cancelled — entry window closed (never filled)')
  }, [simNow, pending])

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
      const now = simNowRef.current
      const liveGate = resolveSimMorningGate({
        now: new Date(now * 1000),
        instrument,
        hasOpenPosition: !!positionRef.current,
        morningAttempts: morningAttemptsRef.current,
        ibAttempts: ibAttemptsRef.current,
        lunchAttempts: lunchAttemptsRef.current,
        stopHits: stopHitsRef.current,
      })
      if (!liveGate.canPlaceEntry) {
        setMsg(liveGate.message || 'Entries locked for this window')
        return
      }
      if (attemptsUsedRef.current >= MAX_DAY_ATTEMPTS) {
        setMsg(
          `Day attempt cap (${MAX_DAY_ATTEMPTS}/${MAX_DAY_ATTEMPTS}) — no more entries this replay.`
        )
        return
      }

      const windowEndUnix =
        liveGate.entryWindow === 3
          ? lateEndUnix
          : liveGate.entryWindow === 2
            ? midEndUnix
            : entryCloseUnix

      placingOrderRef.current = true
      const entrySource = normalizeEntrySource(level.source, 'structure')
      const limit = snapDeskPrice(instrument, level.level)
      const { strategyRange, strategyMagnets } = getStrategyRiskBundle()
      const strat = strategyEntryRisk({
        entry: limit,
        direction,
        activeRange: strategyRange,
        magnets: strategyMagnets,
      })
      const stop = snapStopToTick(instrument, limit, strat.stop, direction)
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
        strategyRange ? strat.target : preview.profit_target_price,
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
        windowEndUnix: windowEndUnix || cashCloseUnix,
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
      midEndUnix,
      lateEndUnix,
      cashCloseUnix,
      accountSize,
      openUnix,
      fillPending,
      instrument,
      getStrategyRiskBundle,
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
    morningAttemptsRef.current = 0
    ibAttemptsRef.current = 0
    lunchAttemptsRef.current = 0
    stopHitsRef.current = 0
    setAttemptsUsed(0)
    setMorningAttempts(0)
    setIbAttempts(0)
    setLunchAttempts(0)
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
        ? `Reset to ${deskLocalHmsAsTraderDisplay(sess.marketOpen, sess.tz)} ${TRADER_DISPLAY_LABEL} — double-click the chart or pick a level, then Play`
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
        ? `Replay from ${deskLocalHmsAsTraderDisplay(sess.marketOpen, sess.tz)} ${TRADER_DISPLAY_LABEL} — double-click the chart or pick a level, or watch`
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
      simNow >= openUnix &&
      attemptsUsed < MAX_DAY_ATTEMPTS &&
      gate?.canPlaceEntry === true

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
    openUnix,
    attemptsUsed,
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
      gate?.canPlaceEntry === true

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

      const { strategyRange, strategyMagnets } = getStrategyRiskBundle()
      const preview = previewLevelOrderPrices({
        level: pick.matched,
        instrument,
        accountSize,
        activeRange: strategyRange,
        magnets: strategyMagnets,
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
    gate?.canPlaceEntry,
    instrument,
    accountSize,
    getStrategyRiskBundle,
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
    simNow >= openUnix &&
    attemptsUsed < MAX_DAY_ATTEMPTS &&
    gate?.canPlaceEntry === true
  const midChip = instrument === 'NIKKEI' ? 'US' : 'IB'
  const lateChip = instrument === 'NIKKEI' ? 'IB' : 'LN'

  const playbookMode = useMemo(() => {
    if (!simNow) return 'morning' as const
    return resolveDeskPlaybookMode({
      instrument,
      now: new Date(simNow * 1000),
      rangeStrategy: gate?.rangeStrategy ?? undefined,
      ladder: attemptLadderFromCounts({
        morningAttempts,
        ibAttempts,
        lunchAttempts,
        morningStopHits: Math.min(stopHits, morningAttempts),
      }),
    })
  }, [
    simNow,
    instrument,
    gate?.rangeStrategy,
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    stopHits,
  ])
  const watchOnlyPlaybook =
    isDeskWatchOnlyPlaybook(playbookMode) && !canEnter && !position
  const playbookPanelTitle = deskPlaybookPanelTitle(playbookMode, instrument, {
    watchOnly: watchOnlyPlaybook,
  })
  const playbookRangeHint = deskPlaybookHint(playbookMode, instrument)
  const playbookButtonLabel = deskPlaybookToolbarLabel(playbookMode, {
    watchOnly: watchOnlyPlaybook,
    instrument,
  })

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
              attemptsUsed >= MAX_DAY_ATTEMPTS
                ? 'bg-red-500/25 text-red-200'
                : 'bg-sky-500/20 text-sky-200'
            }`}
            title={
              gate?.attemptLadderLabel ||
              `Full session 1/1/1 · Day ≤ ${MAX_DAY_ATTEMPTS}. Skip-forward unlocks later windows.`
            }
          >
            Day {attemptsUsed}/{MAX_DAY_ATTEMPTS} · AM {morningAttempts}/1 · {midChip}{' '}
            {ibAttempts}/1 · {lateChip} {lunchAttempts}/1
            {attemptsUsed >= MAX_DAY_ATTEMPTS ? ' · LOCKED' : ''}
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
              showIbBreakouts
                ? 'IB Breakout & Rejection signals visible (Press B)'
                : 'Show session Initial Balance Breakout & Rejection signals (Press B)'
            }
            onClick={() => setShowIbBreakouts((v) => !v)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold uppercase ${
              showIbBreakouts
                ? 'border-blue-500/50 bg-blue-600/30 text-blue-100'
                : 'border-white/15 text-gray-500 hover:border-blue-500/40 hover:text-blue-200'
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${showIbBreakouts ? 'bg-blue-400' : 'bg-gray-600'}`}
            />
            IB Breakout (B)
          </button>
          {(instrument === 'DOW' || instrument === 'NASDAQ') && (
            <button
              type="button"
              title={
                showLunchRange
                  ? 'NYC Lunch range 12:00–13:30 ET visible (Press N)'
                  : 'Show NYC Lunch high / low / 50% (Press N)'
              }
              onClick={() => setShowLunchRange((v) => !v)}
              className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold uppercase ${
                showLunchRange
                  ? 'border-orange-500/50 bg-orange-600/30 text-orange-100'
                  : 'border-white/15 text-gray-500 hover:border-orange-500/40 hover:text-orange-200'
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${showLunchRange ? 'bg-orange-400' : 'bg-gray-600'}`}
              />
              Lunch Range (N)
            </button>
          )}
          {instrument === 'NIKKEI' && (
            <button
              type="button"
              title={
                showUsRange
                  ? 'US H/L lines visible (Press U)'
                  : 'Show current US session H/L (Press U)'
              }
              onClick={() => setShowUsRange((v) => !v)}
              className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold uppercase ${
                showUsRange
                  ? 'border-red-500/50 bg-red-600/30 text-red-100'
                  : 'border-white/15 text-gray-500 hover:border-red-500/40 hover:text-red-200'
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${showUsRange ? 'bg-red-500' : 'bg-gray-600'}`}
              />
              US Range (U)
            </button>
          )}
          {isOr30Instrument(instrument) && (
            <button
              type="button"
              title={
                showOr30
                  ? `OR 30 H/L visible — ${or30WindowLabel(instrument)} (Press R)`
                  : `Show first 30m opening range — ${or30WindowLabel(instrument)} (Press R)`
              }
              onClick={() => setShowOr30((v) => !v)}
              className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold uppercase ${
                showOr30
                  ? 'border-teal-500/50 bg-teal-600/30 text-teal-100'
                  : 'border-white/15 text-gray-500 hover:border-teal-500/40 hover:text-teal-200'
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${showOr30 ? 'bg-teal-400' : 'bg-gray-600'}`}
              />
              OR 30 (R)
            </button>
          )}
          <button
            type="button"
            title={
              levelsOpen
                ? 'Hide AI/structure levels (Press L)'
                : 'Show AI/structure levels (Press L)'
            }
            onClick={() => setLevelsOpen((o) => !o)}
            className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-gray-300 hover:bg-white/10"
          >
            {levelsOpen ? 'Levels (L)' : 'Show levels (L)'}
          </button>
          {!playbookOpen && (
            <button
              type="button"
              title={`Show ${playbookPanelTitle} (Press P)`}
              onClick={() => setPlaybookOpen(true)}
              className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-gray-400 hover:bg-white/10 hover:text-gray-200"
            >
              {playbookButtonLabel} (P)
            </button>
          )}
          <button
            type="button"
            title={
              isFullscreen
                ? 'Exit Fullscreen mode (Esc / F)'
                : 'Enter Fullscreen mode (Press F)'
            }
            onClick={toggleFullscreen}
            className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-gray-400 hover:bg-white/10 hover:text-gray-200"
          >
            {isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
          </button>
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
          {or30Shaped && (
            <>
              <span className="text-gray-600">·</span>
              <span
                className="flex items-center gap-1.5 normal-case tracking-normal"
                title={`Opening Range 30 — ${or30WindowLabel(instrument)} (morning bait)`}
              >
                <span
                  className="inline-block w-4 border-t-2"
                  style={{ borderColor: OR30_COLORS.high }}
                />
                <span style={{ color: OR30_COLORS.high }}>OR30 H/L</span>
                <span className="text-gray-600">morning bait</span>
              </span>
            </>
          )}
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
                title="NYC Lunch Session Range 12:00–13:30 ET"
              >
                <span
                  className="inline-block w-4 border-t-2"
                  style={{ borderColor: NYC_LUNCH_COLORS.high }}
                />
                <span style={{ color: NYC_LUNCH_COLORS.high }}>Lunch H/L</span>
              </span>
            </>
          )}
          {usRangeShaped && (
            <>
              <span className="text-gray-600">·</span>
              <span
                className="flex items-center gap-1.5 normal-case tracking-normal"
                title="Prior US session high/low for Nikkei"
              >
                <span
                  className="inline-block w-4 border-t-2"
                  style={{ borderColor: NIKKEI_US_RANGE_COLORS.high }}
                />
                <span style={{ color: NIKKEI_US_RANGE_COLORS.high }}>US H/L</span>
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

      {/* Playbook — morning / IB|US / lunch-break / lunch-range|Tokyo IB */}
      {playbookOpen && (
        <DraggableDeskWidget
          storageKey="desk-playbook-sim"
          defaultPos={{ x: 24, y: 72 }}
          title={
            <>
              {playbookPanelTitle}
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
          <div className="border-b border-[#30363d] bg-[#1a1430] px-3 py-2.5 space-y-1">
            <p className="text-[10px] leading-snug text-violet-200/90">{playbookRangeHint}</p>
            {playbook && (
              <>
                <p className="text-[10px] font-bold uppercase tracking-wide text-violet-200">
                  Focus:{' '}
                  {playbook.focusSide === 'BOTH' ? 'Best ★ first' : playbook.focusSide}
                </p>
                <p className="text-[10px] leading-snug text-gray-300">{playbook.focusHint}</p>
              </>
            )}
          </div>
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
          useLiveAccount={false}
          initialAccountSize={accountSize}
          regime={
            overnightBias?.bias === 'bearish'
              ? 'bearish'
              : overnightBias?.bias === 'bullish'
                ? 'bullish'
                : 'choppy'
          }
          regimeConfidence={70}
          canPlace={canEnter}
          entryWindow={(gate?.entryWindow as 1 | 2 | 3 | null) ?? 1}
          strategyRange={getStrategyRiskBundle().strategyRange}
          strategyMagnets={getStrategyRiskBundle().strategyMagnets}
          onClose={() => {
            setManualTicketOpen(false)
            setManualClickPrice(null)
          }}
          onPlaced={(order) => {
            setManualTicketOpen(false)
            setManualClickPrice(null)
            const windowEndUnix =
              gate?.entryWindow === 3
                ? lateEndUnix
                : gate?.entryWindow === 2
                  ? midEndUnix
                  : entryCloseUnix
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
              windowEndUnix: windowEndUnix || cashCloseUnix,
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
                  <span className="ml-1.5 text-sky-400/90">
                    {(() => {
                      const { strategyRange } = getStrategyRiskBundle()
                      return strategyRange
                        ? `SL/TP from ${strategyRange.label}`
                        : `zone ${formatZone(ticketLevel.level)}`
                    })()}
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
                const { strategyRange, strategyMagnets } = getStrategyRiskBundle()
                const strat = strategyEntryRisk({
                  entry: ticketLevel.level,
                  direction: d,
                  activeRange: strategyRange,
                  magnets: strategyMagnets,
                })
                const prev = previewPositionSizing(
                  ticketLevel.level,
                  accountSize,
                  d,
                  strat.stop,
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
                        SL {prev.stop_loss_price.toFixed(0)} · TP{' '}
                        {(strategyRange
                          ? strat.target
                          : prev.profit_target_price
                        ).toFixed(0)}{' '}
                        · size {prev.position_size.toFixed(1)}
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
