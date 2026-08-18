'use client'

/**
 * Simulation replay desk (query-param driven).
 * Flow: pick day → cash open → full 2/2/2 session (OR30 → IB/US → Lunch-range) → cash close
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  createChart,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
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
  previewPositionSizingFromRiskAmount,
  type DeskEntrySource,
} from '@/lib/trading/positionSizing'
import {
  getDeskRiskProfile,
  isTradeifyGrowth50k,
  DESK_RISK_PROFILE_EVENT,
} from '@/lib/trading/tradeifyProfile'
import {
  TRADEIFY_DLL_DOLLARS,
  TRADEIFY_STARTING_BALANCE,
  formatTradeifyRiskChip,
  resolveTradeifyPlace,
  tradeifyDeskStatus,
  tradeifyFlattenOverridesKeepOpen,
  tradeifyMustFlatten,
} from '@/lib/trading/tradeifyGrowth50k'
import { tradeifyFlattenMontreal } from '@/lib/trading/tradeifyLeoBlock'
import {
  snapDeskPrice,
  snapStopToTick,
  snapTargetToTick,
} from '@/lib/trading/instrumentTicks'
import {
  MAX_DAY_ATTEMPTS,
  MAX_IB_ATTEMPTS,
  MAX_LUNCH_RANGE_ATTEMPTS,
  MAX_MORNING_ATTEMPTS,
  attemptLadderFromCounts,
  deskMarketFor,
  ibStrategyEndHms,
  lunchRangeEntryEndHms,
  nikkeiCashLunchMontrealLabel,
  resolveSimMorningGate,
  sessionFor,
} from '@/lib/trading/sessionGate'
import {
  assertBucketEntryEligible,
  bucketForRangeLabel,
  classifyAttemptBucket,
  deskClockSeconds,
} from '@/lib/trading/attemptLadder'
import {
  assertRangeEdgeEntry,
  attributePlaybookBandEntry,
  filterLevelsInRangeEdgeBand,
  rangeEdgeBands,
  filterRangeEdgeBands,
  snapEntryToNearestOpenBandCenter,
  RANGE_EDGE_BAND_POINTS,
  RANGE_EDGE_OFF_BAND_MESSAGE,
} from '@/lib/trading/rangeEdgeEntryGate'
import {
  DeskManageBracketOverlay,
  DeskRiskBoxOverlay,
  DeskWorkingBracketOverlay,
  openDeskRiskBox,
  type DeskRiskBoxState,
} from '@/app/dashboard/chart/components/DeskRiskBoxOverlay'
import { assertProtectiveStop } from '@/lib/trading/stopLossGuard'
import { MorningLunchFlatConfirm } from '@/app/dashboard/chart/components/MorningLunchFlatConfirm'
import {
  clearLunchFlatKeepOpen,
  hasLunchFlatKeepOpen,
  markLunchFlatKeepOpen,
  simLunchFlatKeepOpenKey,
} from '@/lib/trading/morningLunchConfirm'
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
import {
  DESK_BAR_SPACING,
  DESK_CANDLE_DOWN,
  DESK_CANDLE_UP,
  DESK_CHART_THEME,
} from '@/lib/chart/deskChartTheme'
import { lockToCandleAutoscale, paddedCandlePriceRange, sessionFocusHighLow } from '@/lib/chart/seriesAutoscale'
import { priceFromClientY } from '@/lib/chart/chartPointerPrice'
import { deskBarSpacing, deskVisibleLogicalRange } from '@/lib/trading/deskInstrumentPreference'
import { scoreValueAcceptance, toEpochMs } from '@/lib/trading/valueAcceptance'
import { ValueAcceptanceRead } from '@/app/dashboard/chart/components/ValueAcceptanceRead'
import {
  computeSimOvernightBias,
} from '@/lib/trading/simOvernightBias'
import {
  convictionStars,
  computeInitialBalance,
  computeIbSignals,
  ibLineSeriesData,
  resolveAfternoonDeskLevels,
  resolveDeskLevels,
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
  assertDeskTicketEntry,
  computeDeskCall,
  deskCallBadgeText,
  deskCallHoverText,
  ticketAllowedEdges,
  deskCallSetupEdges,
  formatDeskCallScoreStrip,
  resolveDeskCallAsOfUnix,
  scoreDeskCallSession,
  tallyDeskCallScores,
  type DeskCall,
  type DeskCallScoreRow,
  type DeskCallScoreTally,
} from '@/lib/trading/deskCall'
import {
  deskCallModeHoverPrefix,
  readSimCallMode,
  writeSimCallMode,
} from '@/lib/trading/deskCallMode'
import {
  applyIbLiquiditySwingToRange,
  applyIbLiquiditySwingToRanges,
  computeIbExtendAdvice,
  findIbLiquiditySwing,
  type IbExtendAdvice,
} from '@/lib/trading/ibExtendAdvice'
import { DeskCallModePrompt } from '@/app/dashboard/chart/components/DeskCallModePrompt'
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
  type NikkeiUsSessionRange,
} from '@/lib/chart/nikkeiUsRangeBreakout'
import {
  activeRangeForPlaybook,
  entryEligibleOverlayRanges,
  studyEntrySnapRanges,
  type StrategyRangeEdges,
  type StrategyRiskMagnets,
} from '@/lib/trading/strategyRiskGeometry'
import {
  deskPlaybookHint,
  deskPlaybookPanelTitle,
  deskPlaybookToolbarLabel,
  deskPlaybookUsesAfternoonLevels,
  resolveDeskPlaybookMode,
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

function callAdviseSide(call: DeskCall | null): 'BUY' | 'SHORT' | null {
  if (call?.side === 'SHORT') return 'SHORT'
  if (call?.side === 'LONG') return 'BUY'
  return null
}

function tradeSideOfLevel(lv: Pick<AiLevel, 'side' | 'type'>): 'BUY' | 'SHORT' {
  if (lv.side === 'BUY' || lv.side === 'SHORT') return lv.side
  return String(lv.type).toLowerCase().includes('resist') ? 'SHORT' : 'BUY'
}

function callAlignedAdviseLevels(
  levels: AiLevel[],
  call: DeskCall | null,
  cap = 4
): AiLevel[] {
  const want = callAdviseSide(call)
  if (!want) return levels.slice(0, cap)
  const aligned = levels.filter((l) => tradeSideOfLevel(l) === want)
  return (aligned.length > 0 ? aligned : levels).slice(0, cap)
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
  /** Playbook range label for bucket billing (±10 H/Mid/L) */
  strategyRangeLabel?: string | null
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
  strategyRangeLabel?: string | null
  /** SL moved to entry after trader confirms break-even */
  breakEvenSet?: boolean
}

/** Trailing window while following the sim tip — same bar width as live */
const FOLLOW_RIGHT_PAD = DESK_CHART_THEME.timeScale.rightOffset
const FOLLOW_BAR_SPACING = DESK_BAR_SPACING

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

/** Live-style: only the current sim bar can fill a new limit — not earlier bars. */
function currentBarIfTouches(
  candles: Candle[],
  openUnix: number,
  now: number,
  level: number
): Candle | undefined {
  let last: Candle | undefined
  for (const c of candles) {
    if (c.time < openUnix || c.time > now) continue
    last = c
  }
  return last && barTouches(last, level) ? last : undefined
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
  const [paperDayPnl, setPaperDayPnl] = useState(0)
  const attemptsUsedRef = useRef(0)
  const morningAttemptsRef = useRef(0)
  const ibAttemptsRef = useRef(0)
  const lunchAttemptsRef = useRef(0)
  const stopHitsRef = useRef(0)
  const [accountSize] = useState(TRADEIFY_STARTING_BALANCE)
  const [riskProfile, setRiskProfile] = useState<'oanda_cash' | 'tradeify_growth_50k'>(
    'tradeify_growth_50k'
  )
  const [riskBox, setRiskBox] = useState<DeskRiskBoxState | null>(null)
  const riskBoxRef = useRef<DeskRiskBoxState | null>(null)
  riskBoxRef.current = riskBox
  const [overlayTick, setOverlayTick] = useState(0)
  const openRiskBoxFromPriceRef = useRef<() => void>(() => {})
  const [msg, setMsg] = useState<string | null>(null)
  const [levelsOpen, setLevelsOpen] = useState(false)
  const levelsOpenRef = useRef(false)
  const [playbookOpen, setPlaybookOpen] = useState(false)
  const adviseBookKeyRef = useRef('')
  const jumpMarkerRef = useRef<IPriceLine | null>(null)
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
    const sync = () => setRiskProfile(getDeskRiskProfile())
    sync()
    window.addEventListener(DESK_RISK_PROFILE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(DESK_RISK_PROFILE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

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
      } else if (key === 'p') {
        e.preventDefault()
        setPlaybookOpen((prev) => !prev)
      } else if (key === 'b') {
        e.preventDefault()
        setShowIbBreakouts((prev) => !prev)
      } else if (key === 'y') {
        e.preventDefault()
        setShowYesterdayProfile((prev) => !prev)
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
      } else if (key === 'o') {
        e.preventDefault()
        openRiskBoxFromPriceRef.current()
      } else if (key === 'escape') {
        if (riskBox) {
          e.preventDefault()
          setRiskBox(null)
        } else if (pending) {
          e.preventDefault()
          setPending(null)
          setPlaying(false)
          setMsg('Working limit cancelled')
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
        requestAnimationFrame(() => setOverlayTick((n) => n + 1))
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('fullscreenchange', onFsChange)
    }
  }, [isFullscreen, riskBox, pending, toggleFullscreen, instrument])

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
  /** Script overlays — same toggles as live (B / N / U / R). IB + US Range default OFF. */
  const [showIbBreakouts, setShowIbBreakouts] = useState(false)
  const [showLunchRange, setShowLunchRange] = useState(false)
  const [showUsRange, setShowUsRange] = useState(false)
  const [showOr30, setShowOr30] = useState(false)
  const [showYesterdayProfile, setShowYesterdayProfile] = useState(false)
  const [yesterdayBadge, setYesterdayBadge] = useState('Yday off')
  const [showOpeningActivity, setShowOpeningActivity] = useState(false)
  const [openingBadge, setOpeningBadge] = useState('WAIT')
  const [showMarketControl, setShowMarketControl] = useState(false)
  const [controlBadge, setControlBadge] = useState('RF WAIT')
  const [callBadge, setCallBadge] = useState('WAIT')
  const [callHover, setCallHover] = useState(
    'CALL WAIT — no ticket\n\nLeo and Level Finder advise only. No line.'
  )
  const [ibExtendBadge, setIbExtendBadge] = useState('—')
  const [ibExtendHover, setIbExtendHover] = useState(
    'IB extend vs revert — advice only after IB locks. First tag is not the entry.'
  )
  const ibExtendRef = useRef<IbExtendAdvice | null>(null)
  const ibLiqLinesRef = useRef<IPriceLine[]>([])
  const [useCall, setUseCall] = useState<boolean | null>(() =>
    readSimCallMode(instrument, replayDate)
  )
  const useCallRef = useRef<boolean | null>(useCall)
  useCallRef.current = useCall

  useEffect(() => {
    setUseCall(readSimCallMode(instrument, replayDate))
  }, [instrument, replayDate])
  useEffect(() => {
    const call = deskCallRef.current
    if (!call) return
    const hover = `${deskCallModeHoverPrefix(useCall)}${deskCallHoverText(call)}`
    setCallHover(hover)
  }, [useCall])
  const [callScoreText, setCallScoreText] = useState('')
  const showIbBreakoutsRef = useRef(false)
  const showLunchRangeRef = useRef(false)
  const showUsRangeRef = useRef(false)
  const showOr30Ref = useRef(false)
  const showYesterdayProfileRef = useRef(false)
  const showOpeningActivityRef = useRef(false)
  const showMarketControlRef = useRef(false)
  const ydayLinesRef = useRef<IPriceLine[]>([])
  const ydayPaintKeyRef = useRef('')
  const openingLinesRef = useRef<IPriceLine[]>([])
  const openingPaintKeyRef = useRef('')
  const controlLinesRef = useRef<IPriceLine[]>([])
  const controlPaintKeyRef = useRef('')
  const callTallyRef = useRef<DeskCallScoreTally>({ windows: 0, broke: 0, tagged: 0 })
  const callScoreKeyRef = useRef('')
  /** Days already added to the running tally — survives Reset so replay cannot double-count. */
  const callScoredDaysRef = useRef<Set<string>>(new Set())
  const deskCallRef = useRef<DeskCall | null>(null)
  const marketControlRef = useRef<MarketControl | null>(null)
  const or30SeriesRef = useRef<{
    high: ISeriesApi<'Line'>
    low: ISeriesApi<'Line'>
  } | null>(null)
  const or30RangeRef = useRef<Or30Range | null>(null)
  const ibRangeRef = useRef<InitialBalanceRange | null>(null)
  const lunchRangeRef = useRef<NycLunchRange | null>(null)
  /** Full session range — must keep `complete` so shapedPlaybookRanges unlocks US ±10. */
  const usRangeRef = useRef<NikkeiUsSessionRange | null>(null)
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
  const instrumentRef = useRef(instrument)
  instrumentRef.current = instrument
  const [or30Shaped, setOr30Shaped] = useState(false)
  const [or30Locked, setOr30Locked] = useState(false)

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
  useEffect(() => {
    showYesterdayProfileRef.current = showYesterdayProfile
  }, [showYesterdayProfile])
  useEffect(() => {
    showOpeningActivityRef.current = showOpeningActivity
  }, [showOpeningActivity])
  useEffect(() => {
    showMarketControlRef.current = showMarketControl
  }, [showMarketControl])

  const levelLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([])
  const posLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([])
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
  const [breakEvenAvailable, setBreakEvenAvailable] = useState(false)
  const [breakEvenDismissed, setBreakEvenDismissed] = useState(false)
  const [lunchFlatPrompt, setLunchFlatPrompt] = useState(false)

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

  // Full-day sim gate — same 2/2/2 ladder as live (no clock-in)
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
    const candleTimeoutId = window.setTimeout(() => candleController.abort(), 20_000)

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const startOpen = toUnix(replayDate, openH!, openM || 0)
        setSimNow(startOpen)

        const candlesRes = await fetch(
          `/api/trading/candles?instrument=${instrument}&timeframe=5m&days=12&date=${replayDate}&_=${Date.now()}`,
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

        setLevels([])
        adviseBookKeyRef.current = ''
        setMsg(
          `${instrument} · ${formatDateDisplay(replayDate)} · Tradeify $50k · CALL + playbook ±10 govern entries`
        )
        setLoading(false)
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
      window.clearTimeout(candleTimeoutId)
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

    const candleAutoscale = () => {
      // Series logical indexes match the replay slice, not the multi-day fetch.
      // Using allCandles here flattened the current day against unrelated history.
      const list = visibleCandlesRef.current
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
      const session = sessionFocusHighLow(
        visible.map((c) => ({ time: c.time, high: c.high, low: c.low })),
        instrumentRef.current
      )
      let minValue = session?.min ?? visible[0].low
      let maxValue = session?.max ?? visible[0].high
      if (!session) {
        for (let i = 1; i < visible.length; i++) {
          const c = visible[i]
          if (c && c.low < minValue) minValue = c.low
          if (c && c.high > maxValue) maxValue = c.high
        }
      }

      const risk = riskBoxRef.current
      const pending = pendingRef.current
      const position = positionRef.current
      const fitPrices = risk
        ? [risk.entryPrice, risk.stopLoss, risk.profitTarget]
        : pending
          ? [pending.level, pending.stopLoss, pending.target]
          : position
            ? [position.entry, position.stopLoss, position.target]
            : []
      return paddedCandlePriceRange(minValue, maxValue, fitPrices)
    }

    const series = chart.addCandlestickSeries({
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

    // Studies stay on the pane at true prices but vote for the candle window.
    const ignoreScale = lockToCandleAutoscale(candleAutoscale)

    // Dedicated host for BUY/SHORT + working/manage lines. Candle/VWAP setData
    // must never touch this series or the levels vanish after a few seconds.
    const priceLineHost = chart.addLineSeries({
      color: 'rgba(0,0,0,0)',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceScaleId: 'right',
      ...ignoreScale,
    })

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

    // Initial Balance — same blue H/L as live (extended to sim lunch)
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

    // OR30 — teal H/L (morning bait), same as live desk
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

    const lunchLineOpts = {
      color: NYC_LUNCH_COLORS.high,
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      ...ignoreScale,
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
      ...ignoreScale,
    }
    const usRangeSeries = {
      high: chart.addLineSeries({ ...usLineOpts, title: 'US H' }),
      low: chart.addLineSeries({ ...usLineOpts, title: 'US L' }),
    }

    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: DESK_CHART_THEME.rightPriceScale.scaleMargins,
      borderVisible: false,
    })

    chartRef.current = chart
    seriesRef.current = series
    priceLineHostRef.current = priceLineHost
    const bumpOverlay = () => setOverlayTick((n) => n + 1)
    chart.timeScale().subscribeVisibleLogicalRangeChange(bumpOverlay)
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
        requestAnimationFrame(() => {
          requestAnimationFrame(bumpOverlay)
        })
      }
    })
    ro.observe(containerRef.current)
    const onWheelLayout = () => bumpOverlay()
    containerRef.current.addEventListener('wheel', onWheelLayout, { passive: true })

    return () => {
      ro.disconnect()
      containerRef.current?.removeEventListener('wheel', onWheelLayout)
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(bumpOverlay)
      } catch {
        /* chart already gone */
      }
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
      setOr30Locked(false)
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

    const paintList = callAlignedAdviseLevels(levelsRef.current, deskCallRef.current)
    for (const lv of paintList) {
      const isRes = tradeSideOfLevel(lv) === 'SHORT'
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

  const jumpToAdvisePrice = useCallback((price: number) => {
    const host = priceLineHostRef.current || seriesRef.current
    if (!host) return
    try {
      if (jumpMarkerRef.current) {
        try {
          host.removePriceLine(jumpMarkerRef.current)
        } catch {
          /* ignore */
        }
        jumpMarkerRef.current = null
      }
      const marker = host.createPriceLine({
        price,
        color: '#ffffff40',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '→ ' + price.toLocaleString('en-US', { minimumFractionDigits: 0 }),
      })
      jumpMarkerRef.current = marker
      window.setTimeout(() => {
        try {
          if (jumpMarkerRef.current === marker) {
            host.removePriceLine(marker)
            jumpMarkerRef.current = null
          }
        } catch {
          /* ignore */
        }
      }, 3000)
    } catch {
      /* ignore */
    }
  }, [])

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
      const to = deskVisibleLogicalRange(endIdx + 1).to

      if (resetSpacing) {
        const width = containerRef.current?.clientWidth ?? 900
        const spacing = deskBarSpacing(width, endIdx + 1)
        barSpacingRef.current = spacing
        ts.applyOptions({
          rightOffset: FOLLOW_RIGHT_PAD,
          barSpacing: spacing,
        })
        const fitted = deskVisibleLogicalRange(endIdx + 1, width)
        pinnedSpanRef.current = fitted.to - fitted.from
        ts.setVisibleLogicalRange(fitted)
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
      scaleMargins: DESK_CHART_THEME.rightPriceScale.scaleMargins,
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
          volume: Math.max(0, Number(c.volume) || 0),
        }))
        const tip = slice[slice.length - 1]?.time ?? simT
        // Never inject future 16:00 points: they create a large blank right side.
        // Extend ranges only as replay time advances, like TradingView.
        const extendTo = Math.max(tip, simT)

        const ibs = ibSeriesRef.current
        if (ibs && openUnix) {
          const ib = computeInitialBalance(bars, openUnix, simT)
          ibRangeRef.current = ib
          // IB H/L + ±10 follow B toggle (same as live) — keep range ref for playbook.
          if (showIbBreakoutsRef.current && ib) {
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
          setOr30Locked(!!or30?.complete)
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
            // Keep complete/fromTime/toTime — stripping complete made activeRangeForPlaybook
            // return null during us_range and reject mid/H/L with "not shaped yet".
            usRangeRef.current = us
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
            const swing = findIbLiquiditySwing(bars, ibRangeRef.current)
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

        const host = priceLineHostRef.current
        const yday = computeYesterdayProfile({
          instrument,
          candles: bars,
          asOfUnix: resolveYesterdayAsOfUnix(instrument, simT, simT),
        })
        const visible = showYesterdayProfileRef.current
        const badge = visible ? yesterdayProfileBadgeText(yday) : 'Yday off'
        setYesterdayBadge((prev) => (prev === badge ? prev : badge))
        const key = yesterdayProfilePaintKey(visible, yday)
        if (key !== ydayPaintKeyRef.current) {
          ydayPaintKeyRef.current = key
          for (const line of ydayLinesRef.current) {
            try {
              host?.removePriceLine(line)
            } catch {
              /* ignore */
            }
          }
          ydayLinesRef.current = []
          if (visible && yday && host) {
            for (const spec of yesterdayProfileLineSpecs(yday)) {
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
          }
        }

        const opening = computeOpeningActivity({
          instrument,
          candles: bars,
          asOfUnix: resolveOpeningAsOfUnix(instrument, simT, simT),
        })
        const openingVisible = showOpeningActivityRef.current
        const openingText = openingActivityBadgeText(opening)
        setOpeningBadge((prev) => (prev === openingText ? prev : openingText))
        const openingKey = openingActivityPaintKey(openingVisible, opening)
        if (openingKey !== openingPaintKeyRef.current) {
          openingPaintKeyRef.current = openingKey
          for (const line of openingLinesRef.current) {
            try {
              host?.removePriceLine(line)
            } catch {
              /* ignore */
            }
          }
          openingLinesRef.current = []
          if (openingVisible && host) {
            for (const spec of openingActivityLineSpecs(opening)) {
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
          }
        }

        const control = computeMarketControl({
          instrument,
          candles: bars,
          asOfUnix: resolveMarketControlAsOfUnix(instrument, simT, simT),
        })
        marketControlRef.current = control
        const controlVisible = showMarketControlRef.current
        const controlText = marketControlBadgeText(control)
        setControlBadge((prev) => (prev === controlText ? prev : controlText))
        const controlKey = marketControlPaintKey(controlVisible, control)
        if (controlKey !== controlPaintKeyRef.current) {
          controlPaintKeyRef.current = controlKey
          for (const line of controlLinesRef.current) {
            try {
              host?.removePriceLine(line)
            } catch {
              /* ignore */
            }
          }
          controlLinesRef.current = []
          if (controlVisible && host) {
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
          }
        }

        const playbookMode = resolveDeskPlaybookMode({
          instrument,
          now: new Date(simT * 1000),
          ladder: attemptLadderFromCounts({
            morningAttempts: morningAttemptsRef.current,
            ibAttempts: ibAttemptsRef.current,
            lunchAttempts: lunchAttemptsRef.current,
            morningStopHits: Math.min(
              stopHitsRef.current,
              morningAttemptsRef.current
            ),
            now: new Date(simT * 1000),
            instrument,
          }),
        })
        const deskCall = computeDeskCall({
          instrument,
          candles: bars,
          asOfUnix: resolveDeskCallAsOfUnix(instrument, simT, simT),
          playbookMode,
          bookLocked:
            tradesCountRef.current >= 3 ||
            !!positionRef.current ||
            !!pendingRef.current,
          control,
        })
        deskCallRef.current = deskCall
        const callText = deskCallBadgeText(deskCall)
        setCallBadge((prev) => (prev === callText ? prev : callText))
        const hover = `${deskCallModeHoverPrefix(useCallRef.current)}${deskCallHoverText(deskCall)}`
        setCallHover((prev) => (prev === hover ? prev : hover))

        const lastBar = bars.length ? bars[bars.length - 1] : null
        const ibAdvice = computeIbExtendAdvice({
          instrument,
          ib: ibRangeRef.current,
          candles: bars,
          nowUnix: simT,
          useCall: useCallRef.current,
          callSide: deskCall.side,
          lastPrice: lastBar?.close ?? null,
        })
        ibExtendRef.current = ibAdvice
        setIbExtendBadge((prev) => (prev === ibAdvice.chip ? prev : ibAdvice.chip))
        const ibHover = ibAdvice.message
        setIbExtendHover((prev) => (prev === ibHover ? prev : ibHover))
        for (const line of ibLiqLinesRef.current) {
          try {
            host?.removePriceLine(line)
          } catch {
            /* ignore */
          }
        }
        ibLiqLinesRef.current = []
        if (host && ibAdvice.swing) {
          try {
            ibLiqLinesRef.current.push(
              host.createPriceLine({
                price: ibAdvice.swing.price,
                color: '#eab308',
                title: ibAdvice.swing.kind === 'high' ? 'Liq H' : 'Liq L',
                lineWidth: 2,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
              })
            )
          } catch {
            /* ignore */
          }
        }

        // Refresh advise book when CALL playbook / locked ±10 changes.
        // Do not open P/L — trader opts in. Structure only (no Level Finder spend).
        const preferredRaw = activeRangeForPlaybook({
          playbookMode,
          instrument,
          or30: or30RangeRef.current,
          ib: ibRangeRef.current,
          usRange: usRangeRef.current,
          lunchRange: lunchRangeRef.current,
          morningAttempts: morningAttemptsRef.current,
        })
        const preferred = preferredRaw
          ? applyIbLiquiditySwingToRange(preferredRaw, ibAdvice.swing)
          : null
        const bookKey = `${playbookMode}:${preferred?.label ?? ''}:${preferred?.high ?? ''}:${preferred?.low ?? ''}`
        if (openUnix && bookKey !== adviseBookKeyRef.current) {
          adviseBookKeyRef.current = bookKey
          const useAfternoon = deskPlaybookUsesAfternoonLevels(playbookMode)
          const tip = bars.length ? bars[bars.length - 1]!.close : null
          const resolved = useAfternoon
            ? resolveAfternoonDeskLevels([], [], bars, openUnix, sess.tz, tip, simT)
            : resolveDeskLevels([], bars, openUnix, sess.tz, 'none')
          const built = resolved.levels.map((l) => ({
            level: l.level,
            type: l.type,
            conviction: l.conviction,
            reasoning: l.reasoning,
            source: l.source,
            rank: l.rank,
            side: l.side,
            price: l.level,
          }))
          let next = built
          if (preferred) {
            const inBand = filterLevelsInRangeEdgeBand(built, preferred)
            next = built.length > 0 && inBand.length === 0 ? [] : inBand
          }
          setLevels(
            next.map(({ price: _price, ...rest }) => rest)
          )
        }
      }

      if (force || lastAppliedBarIdxRef.current < 0) {
        const slice = candles.slice(0, endIdx + 1)
        visibleCandlesRef.current = slice
        series.setData(slice.map(toBar))

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
        const slice = candles.slice(0, endIdx + 1)
        visibleCandlesRef.current = slice
        for (let i = lastAppliedBarIdxRef.current + 1; i <= endIdx; i++) {
          series.update(toBar(candles[i]!))
        }

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
    /** Entry-eligible ±10 candidates (bucket open / active playbook) for price attribution. */
    shapedRanges: StrategyRangeEdges[]
    /** Visible + active-playbook ±10 (CALL governs which edge is legal). */
    snapRanges: StrategyRangeEdges[]
    ladder: ReturnType<typeof attemptLadderFromCounts>
    strategyMagnets: StrategyRiskMagnets
    call: DeskCall
  } => {
    const simNow = new Date(simNowRef.current * 1000)
    const ladder = attemptLadderFromCounts({
      morningAttempts: morningAttemptsRef.current,
      ibAttempts: ibAttemptsRef.current,
      lunchAttempts: lunchAttemptsRef.current,
      morningStopHits: Math.min(stopHitsRef.current, morningAttemptsRef.current),
      now: simNow,
      instrument,
    })
    const playbookMode = resolveDeskPlaybookMode({
      instrument,
      now: simNow,
      ladder,
    })
    const morningAttempts = morningAttemptsRef.current
    const swing = ibExtendRef.current?.swing ?? null
    const preferredRaw = activeRangeForPlaybook({
      playbookMode,
      instrument,
      or30: or30RangeRef.current,
      ib: ibRangeRef.current,
      usRange: usRangeRef.current,
      lunchRange: lunchRangeRef.current,
      morningAttempts,
    })
    const preferred = preferredRaw
      ? applyIbLiquiditySwingToRange(preferredRaw, swing)
      : null
    const overlays = applyIbLiquiditySwingToRanges(
      entryEligibleOverlayRanges({
        playbookMode,
        instrument,
        now: simNow,
        showOr30: showOr30Ref.current,
        showIb: showIbBreakoutsRef.current,
        showUsRange: showUsRangeRef.current,
        showLunchRange: showLunchRangeRef.current,
        or30: or30RangeRef.current,
        ib: ibRangeRef.current,
        usRange: usRangeRef.current,
        lunchRange: lunchRangeRef.current,
        morningAttempts,
      }),
      swing
    )
    // Sim has no Level Finder — always snap/paint the locked playbook range.
    const snapRanges = studyEntrySnapRanges({
      active: preferred,
      overlays,
    })
    const strategyRange = preferred ?? snapRanges[0] ?? null
    const extras: number[] = []
    for (const r of snapRanges) {
      if (
        strategyRange &&
        r.high === strategyRange.high &&
        r.low === strategyRange.low
      ) {
        continue
      }
      extras.push(r.high, r.low)
    }
    const call = computeDeskCall({
      instrument,
      candles: allCandlesRef.current,
      asOfUnix: resolveDeskCallAsOfUnix(
        instrument,
        simNowRef.current,
        simNowRef.current
      ),
      playbookMode,
      bookLocked:
        tradesCountRef.current >= 3 ||
        !!positionRef.current ||
        !!pendingRef.current,
      control: marketControlRef.current,
    })
    deskCallRef.current = call
    return {
      strategyRange,
      shapedRanges: snapRanges,
      snapRanges,
      ladder,
      strategyMagnets: {
        avwap: avwapLastRef.current,
        extras,
      },
      call,
    }
  }, [instrument])

  /** Snap Limit / place-near onto nearest live ±10 band center (or deny). */
  const snapSimEntryOrDeny = useCallback(
    (
      rawPrice: number
    ): { price: number; range: StrategyRangeEdges } | { deny: string } => {
      const { strategyRange, snapRanges, ladder, call } = getStrategyRiskBundle()
      const wait = assertDeskTicketEntry({
        useCall: useCallRef.current,
        call,
      })
      if (!wait.ok) return { deny: wait.message }
      const now = new Date(simNowRef.current * 1000)
      const liveOk = (range: StrategyRangeEdges) => {
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
          timeSec: deskClockSeconds(instrument, now),
          ladder,
          rangeLabel: range.label,
        }).ok
      }
      const snapped = snapEntryToNearestOpenBandCenter({
        entry: rawPrice,
        candidates: snapRanges,
        preferLabel: strategyRange?.label ?? null,
        liveOk,
      })
      if (!snapped) {
        // Prefer attribution deny copy (closed bucket / mid) over generic off-band.
        const hit = attributePlaybookBandEntry({
          entry: rawPrice,
          candidates: snapRanges,
          preferLabel: strategyRange?.label ?? null,
          liveOk,
        })
        if (snapRanges.length === 0) {
          return {
            deny:
              'No locked playbook ±10 yet — wait for OR30 / IB / lunch-range / US Range to lock.',
          }
        }
        if (hit) {
          const gated = assertDeskTicketEntry({
            useCall: useCallRef.current,
            call,
            edge: hit.edge,
          })
          if (!gated.ok) return { deny: gated.message }
          if (hit.range.label === 'OR30') {
            return {
              deny:
                instrument === 'NIKKEI'
                  ? 'OR30 morning ±10 window is closed — enter on the live US Range / Tokyo IB playbook when unlocked.'
                  : 'OR30 morning ±10 window is closed — enter on the live IB / lunch-range playbook when unlocked.',
            }
          }
          const bucketOk = assertBucketEntryEligible({
            instrument,
            market: deskMarketFor(instrument),
            timeSec: deskClockSeconds(instrument, now),
            ladder,
            rangeLabel: hit.range.label,
          })
          if (!bucketOk.ok) return { deny: bucketOk.message }
          const edge = assertRangeEdgeEntry({
            entry: rawPrice,
            range: hit.range,
          })
          if (!edge.ok) return { deny: edge.message }
        }
        return { deny: RANGE_EDGE_OFF_BAND_MESSAGE }
      }
      const gated = assertDeskTicketEntry({
        useCall: useCallRef.current,
        call,
        edge: snapped.hit.edge,
      })
      if (!gated.ok) return { deny: gated.message }
      return {
        price: snapDeskPrice(instrument, snapped.price),
        range: snapped.hit.range,
      }
    },
    [getStrategyRiskBundle, instrument]
  )

  const openRiskBoxFromPrice = useCallback(
    (rawPrice?: number | null) => {
      if (positionRef.current || pendingRef.current || riskBox) return
      const seed = rawPrice ?? lastPriceRef.current
      if (seed == null || !(seed > 0)) {
        setMsg('No price to place from — wait for the sim bar')
        return
      }
      const snapped = snapSimEntryOrDeny(seed)
      if ('deny' in snapped) {
        setMsg(snapped.deny)
        return
      }
      const { snapRanges, strategyRange, ladder, call } = getStrategyRiskBundle()
      const now = new Date(simNowRef.current * 1000)
      const hit = attributePlaybookBandEntry({
        entry: snapped.price,
        candidates: snapRanges,
        preferLabel: strategyRange?.label ?? null,
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
            timeSec: deskClockSeconds(instrument, now),
            ladder,
            rangeLabel: range.label,
          }).ok
        },
      })
      const gated = assertDeskTicketEntry({
        useCall: useCallRef.current,
        call,
        edge: hit?.edge ?? null,
      })
      if (!gated.ok) {
        setMsg(gated.message)
        return
      }
      const dir: Direction = gated.side
      setPlaying(false)
      setRiskBox(
        openDeskRiskBox({
          entry: snapped.price,
          direction: dir,
          instrument,
          preferRangeLabel: snapped.range.label ?? strategyRange?.label ?? null,
        })
      )
      setMsg(
        useCallRef.current === false
          ? `Regular ${dir} — drag SL / TP on the chart, then ${
              dir === 'LONG' ? 'BUY LIMIT' : 'SELL LIMIT'
            }`
          : `CALL ${dir} — drag SL / TP on the chart, then ${
              dir === 'LONG' ? 'BUY LIMIT' : 'SELL LIMIT'
            }`
      )
    },
    [getStrategyRiskBundle, instrument, riskBox, snapSimEntryOrDeny]
  )
  openRiskBoxFromPriceRef.current = () =>
    openRiskBoxFromPrice(lastPriceRef.current)

  const placeSimWorkingLimit = useCallback(
    (order: {
      level: number
      direction: Direction
      stopLoss: number
      profitTarget: number
      size: number
      risk: number
      accountSize: number
      entryReason: string
      strategyRangeLabel?: string | null
    }) => {
      const snapped = snapSimEntryOrDeny(order.level)
      if ('deny' in snapped) {
        setMsg(snapped.deny)
        return
      }
      const { call } = getStrategyRiskBundle()
      const gated = assertDeskTicketEntry({
        useCall: useCallRef.current,
        call,
        direction: order.direction,
      })
      if (!gated.ok) {
        setMsg(gated.message)
        return
      }
      const edge = assertRangeEdgeEntry({
        entry: snapped.price,
        range: snapped.range,
      })
      if (!edge.ok) {
        setMsg(edge.message)
        return
      }
      const windowEndUnix =
        gate?.entryWindow === 3
          ? lateEndUnix
          : gate?.entryWindow === 2
            ? midEndUnix
            : entryCloseUnix
      const pend: PendingOrder = {
        level: snapped.price,
        direction: order.direction,
        stopLoss: order.stopLoss,
        target: order.profitTarget,
        size: order.size,
        risk: order.risk,
        accountSize: order.accountSize,
        entryReason: order.entryReason,
        entrySource: 'manual',
        windowEndUnix: windowEndUnix || cashCloseUnix,
        strategyRangeLabel: snapped.range.label ?? order.strategyRangeLabel ?? null,
      }
      setRiskBox(null)
      const now = simNowRef.current
      const touched = currentBarIfTouches(
        allCandlesRef.current,
        openUnix,
        now,
        pend.level
      )
      if (touched) {
        fillPendingRef.current(pend, touched.time)
        return
      }
      pendingRef.current = pend
      setPending(pend)
      setMsg(
        `Manual ${order.direction} limit @ ${snapped.price.toLocaleString()} — drag TP on the chart · press Play until fill`
      )
    },
    [
      snapSimEntryOrDeny,
      getStrategyRiskBundle,
      gate?.entryWindow,
      lateEndUnix,
      midEndUnix,
      entryCloseUnix,
      cashCloseUnix,
      openUnix,
    ]
  )

  const confirmRiskBox = useCallback(() => {
    if (!riskBox) return
    const { snapRanges, strategyRange, ladder, call } = getStrategyRiskBundle()
    const now = new Date(simNowRef.current * 1000)
    const hit = attributePlaybookBandEntry({
      entry: riskBox.entryPrice,
      candidates: snapRanges,
      preferLabel: riskBox.preferRangeLabel ?? strategyRange?.label ?? null,
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
          timeSec: deskClockSeconds(instrument, now),
          ladder,
          rangeLabel: range.label,
        }).ok
      },
    })
    if (!hit) {
      setMsg(RANGE_EDGE_OFF_BAND_MESSAGE)
      return
    }
    const gated = assertDeskTicketEntry({
      useCall: useCallRef.current,
      call,
      edge: hit.edge,
      direction: riskBox.direction,
    })
    if (!gated.ok) {
      setMsg(gated.message)
      return
    }
    const entry = snapDeskPrice(instrument, hit.center)
    const stopGuard = assertProtectiveStop({
      instrument,
      entry,
      stop: riskBox.stopLoss,
      direction: riskBox.direction,
    })
    if (!stopGuard.ok) {
      setMsg(stopGuard.message)
      return
    }
    const stop = stopGuard.stop
    let tp = riskBox.profitTarget
    if (riskBox.direction === 'LONG' && !(tp > entry)) {
      setMsg('Take profit must be above the limit for LONG')
      return
    }
    if (riskBox.direction === 'SHORT' && !(tp < entry)) {
      setMsg('Take profit must be below the limit for SHORT')
      return
    }
    tp = snapTargetToTick(instrument, entry, tp, riskBox.direction)
    const decision = resolveTradeifyPlace({
      now,
      fillsUsed: attemptsUsedRef.current,
      stopOutsToday: stopHitsRef.current,
      dailyPnl: paperDayPnl,
    })
    if (!decision.allowed) {
      setMsg(decision.refuseMessage)
      return
    }
    const sized = previewPositionSizingFromRiskAmount(
      entry,
      TRADEIFY_STARTING_BALANCE,
      riskBox.direction,
      stop,
      decision.riskDollars
    )
    if (!sized) {
      setMsg('Could not size this stop — widen SL or pick another band')
      return
    }
    placeSimWorkingLimit({
      level: entry,
      direction: riskBox.direction,
      stopLoss: stop,
      profitTarget: tp,
      size: sized.position_size,
      risk: sized.risk_amount,
      accountSize: TRADEIFY_STARTING_BALANCE,
      entryReason: `Manual ${riskBox.direction} limit @ ${entry.toLocaleString()} | SL ${stop.toLocaleString()} TP ${tp.toLocaleString()}`,
      strategyRangeLabel: hit.range.label ?? null,
    })
  }, [
    riskBox,
    getStrategyRiskBundle,
    instrument,
    paperDayPnl,
    placeSimWorkingLimit,
  ])

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
  }, [levels, chartReady, levelsOpen, callBadge, paintTradeLevels])

  // Re-paint script overlays when toggles change
  useEffect(() => {
    if (!chartReady || !simNowRef.current) return
    applyChartDataRef.current(simNowRef.current, { force: true })
  }, [chartReady, showIbBreakouts, showLunchRange, showUsRange, showOr30, showYesterdayProfile, showOpeningActivity, showMarketControl])

  // Pending working limit + open position — on host series (survives candle setData).
  // Working limit / position lines stay on the host series.
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

    if (riskBox) {
      specs.push(
        {
          price: riskBox.entryPrice,
          color: '#3b82f6',
          title: `◆ ENTRY ${riskBox.direction} @ ${fmt(riskBox.entryPrice)}`,
          style: LineStyle.Solid,
          width: 2,
        },
        {
          price: riskBox.stopLoss,
          color: '#f59e0b',
          title: `▁ SL @ ${fmt(riskBox.stopLoss)}`,
          style: LineStyle.Dashed,
          width: 2,
        },
        {
          price: riskBox.profitTarget,
          color: '#22c55e',
          title: `▔ TP @ ${fmt(riskBox.profitTarget)}`,
          style: LineStyle.Dashed,
          width: 2,
        }
      )
    } else if (position) {
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
          title: `SL ${fmt(position.stopLoss)} · drag`,
          style: LineStyle.Dashed,
          width: 2,
        },
        {
          price: position.target,
          color: '#22c55e',
          title: `TP ${fmt(position.target)} · drag`,
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
          title: `SL · locked — sized at place ${fmt(pending.stopLoss)}`,
          style: LineStyle.Dotted,
          width: 2,
        },
        {
          price: pending.target,
          color: '#22c55e',
          title: `TP · drag ${fmt(pending.target)}`,
          style: LineStyle.Dotted,
          width: 2,
        }
      )
    }

    // Mirror live ±10 entry band edges for all entry-eligible overlays
    // (H / 50% / L, or H / L only for US Range) — not only the active playbook.
    const entryOpen =
      !position &&
      !pending &&
      simNowRef.current >= openUnix &&
      attemptsUsedRef.current < MAX_DAY_ATTEMPTS
    if (entryOpen || pending || riskBox) {
      const { snapRanges, call } = getStrategyRiskBundle()
      const allowed = ticketAllowedEdges({
        useCall: useCallRef.current,
        call,
      })
      if (allowed == null || allowed.length > 0) {
      for (const strategyRange of snapRanges) {
        if (!(strategyRange.high > strategyRange.low)) continue
        const bands = filterRangeEdgeBands(rangeEdgeBands(strategyRange), allowed)
        const label = strategyRange.label || 'range'
        const setupEdges =
          useCallRef.current === false ? deskCallSetupEdges(call) : []
        for (const band of bands) {
          const setup = setupEdges.includes(band.edge)
          const emphasize =
            useCallRef.current !== false || setupEdges.length === 0 || setup
          const color =
            band.edge === 'mid'
              ? emphasize
                ? 'rgba(168, 85, 247, 0.85)'
                : 'rgba(168, 85, 247, 0.4)'
              : band.edge === 'high'
                ? emphasize
                  ? 'rgba(56, 189, 248, 0.75)'
                  : 'rgba(56, 189, 248, 0.35)'
                : emphasize
                  ? 'rgba(52, 211, 153, 0.75)'
                  : 'rgba(52, 211, 153, 0.35)'
          const tag =
            band.edge === 'mid' ? '50%' : band.edge === 'high' ? 'H' : 'L'
          specs.push(
            {
              price: band.max,
              color,
              title: `±${RANGE_EDGE_BAND_POINTS} ${label} ${tag}+`,
              style: LineStyle.SparseDotted,
              width: 1,
            },
            {
              price: band.min,
              color,
              title: `±${RANGE_EDGE_BAND_POINTS} ${label} ${tag}−`,
              style: LineStyle.SparseDotted,
              width: 1,
            }
          )
        }
      }
      }
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
  }, [
    position,
    pending,
    riskBox,
    chartReady,
    simNow,
    getStrategyRiskBundle,
    openUnix,
    showOr30,
    showIbBreakouts,
    showLunchRange,
    showUsRange,
    useCall,
  ])

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
        strategyRangeLabel: pend.strategyRangeLabel ?? null,
        breakEvenSet: false,
      }
      pendingRef.current = null
      positionRef.current = filled
      setBreakEvenAvailable(false)
      setBreakEvenDismissed(false)

      const labeled = bucketForRangeLabel(instrument, pend.strategyRangeLabel)
      const bucket =
        labeled ?? classifyAttemptBucket(instrument, at * 1000)
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
      setPaperDayPnl(realizedPnlRef.current)
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

  const finalizeCallScore = useCallback(
    (asOfUnix: number) => {
      if (!replayDate || !Number.isFinite(asOfUnix)) return
      const key = `${instrument}|${replayDate}`
      if (callScoreKeyRef.current === key) return
      callScoreKeyRef.current = key
      const rows: DeskCallScoreRow[] = scoreDeskCallSession({
        instrument,
        candles: allCandlesRef.current,
        asOfUnix,
        bookLocked: tradesCountRef.current >= 3,
      })
      const day = tallyDeskCallScores(rows)
      if (!callScoredDaysRef.current.has(key)) {
        callScoredDaysRef.current.add(key)
        callTallyRef.current = {
          windows: callTallyRef.current.windows + day.windows,
          broke: callTallyRef.current.broke + day.broke,
          tagged: callTallyRef.current.tagged + day.tagged,
        }
      }
      setCallScoreText(formatDeskCallScoreStrip(rows, callTallyRef.current))
    },
    [instrument, replayDate]
  )

  useEffect(() => {
    applyChartDataRef.current = applyChartData
  }, [applyChartData])
  useEffect(() => {
    setCallBadge('WAIT')
    setCallHover(
      'CALL WAIT — no ticket\n\nLeo and Level Finder advise only. No line.'
    )
    setCallScoreText('')
    callScoreKeyRef.current = ''
    deskCallRef.current = null
  }, [instrument, replayDate])
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
        finalizeCallScore(endAt)
        void markSessionCompleted()
        return
      }

      const bar = candles[nextIdx]!
      const next = bar.time

      const pend = pendingRef.current
      if (pend && !positionRef.current && barTouches(bar, pend.level)) {
        fillPendingRef.current(pend, bar.time)
      }

      const flattenAt = tradeifyMustFlatten(new Date(next * 1000))
      if (flattenAt) {
        const pendFlat = pendingRef.current
        if (pendFlat) {
          pendingRef.current = null
          setPending(null)
        }
        const posFlat = positionRef.current
        if (posFlat) {
          clearLunchFlatKeepOpen(
            simLunchFlatKeepOpenKey({
              instrument,
              replayDate,
              filledAt: posFlat.filledAt,
            })
          )
          recordPaperClose(posFlat, bar.close, 'manual')
          positionRef.current = null
          setPosition(null)
          setLunchFlatPrompt(false)
        }
        simNowRef.current = next
        setSimNow(next)
        applyChartDataRef.current(next)
        setPlaying(false)
        setMsg(
          posFlat
            ? `Tradeify flatten @ ${bar.close.toLocaleString()} — 16:59 ET. No new holds.`
            : pendFlat
              ? 'Tradeify flatten — working limit cancelled. No new holds until 18:00 ET.'
              : 'Tradeify flatten window — no new entries until 18:00 ET.'
        )
        return
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
          clearLunchFlatKeepOpen(
            simLunchFlatKeepOpenKey({
              instrument,
              replayDate,
              filledAt: closed.filledAt,
            })
          )
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
          setLunchFlatPrompt(false)
          return
        }
        if (hitTp) {
          const closed = pos
          clearLunchFlatKeepOpen(
            simLunchFlatKeepOpenKey({
              instrument,
              replayDate,
              filledAt: closed.filledAt,
            })
          )
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
          setLunchFlatPrompt(false)
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
  }, [playing, openUnix, speed, instrument, markSessionCompleted, recordPaperClose, finalizeCallScore])

  // If clock is already at/after cash close (paused at end), flip picker to "done"
  useEffect(() => {
    if (!cashCloseUnix || !simNow) return
    if (simNow >= cashCloseUnix) {
      finalizeCallScore(cashCloseUnix)
      void markSessionCompleted()
    }
  }, [simNow, cashCloseUnix, markSessionCompleted, finalizeCallScore])

  // Unfilled sim limits expire when that slot's entry window ends
  useEffect(() => {
    if (!pending) return
    if (simNow <= pending.windowEndUnix) return
    pendingRef.current = null
    setPending(null)
    setMsg('Working limit cancelled — entry window closed (never filled)')
  }, [simNow, pending])

  // Tradeify 16:59 ET flatten — cancel working + close the book if the clock is already there
  useEffect(() => {
    if (playing || !simNow) return
    if (!tradeifyMustFlatten(new Date(simNow * 1000))) return
    if (pendingRef.current) {
      pendingRef.current = null
      setPending(null)
    }
    const pos = positionRef.current
    if (pos) {
      const px = lastPriceRef.current ?? pos.entry
      clearLunchFlatKeepOpen(
        simLunchFlatKeepOpenKey({
          instrument,
          replayDate,
          filledAt: pos.filledAt,
        })
      )
      recordPaperClose(pos, px, 'manual')
      positionRef.current = null
      setPosition(null)
      setLunchFlatPrompt(false)
      setMsg(`Tradeify flatten @ ${px.toLocaleString()} — 16:59 ET. No new holds.`)
      return
    }
    if (pending) {
      setMsg('Tradeify flatten — working limit cancelled. No new holds until 18:00 ET.')
    }
  }, [playing, simNow, pending, instrument, replayDate, recordPaperClose])

  const cancelPending = useCallback(() => {
    if (!pendingRef.current) return
    pendingRef.current = null
    placingOrderRef.current = false
    setPending(null)
    setPlaying(false)
    setMsg('Working limit cancelled')
  }, [])

  const closeAtMarket = () => {
    const price = lastPriceRef.current ?? lastPrice
    if (!position || price == null) return
    const closed = position
    clearLunchFlatKeepOpen(
      simLunchFlatKeepOpenKey({
        instrument,
        replayDate,
        filledAt: closed.filledAt,
      })
    )
    recordPaperClose(closed, price, 'manual')
    positionRef.current = null
    setMsg(`Closed @ ${price.toLocaleString()} — manage ended`)
    setLevels((prev) =>
      applySimTradeOutcome(prev, closed.entry, closed.direction, 'target')
    )
    setPosition(null)
    setPlaying(false)
    setBreakEvenAvailable(false)
    setLunchFlatPrompt(false)
  }

  const moveStopToBreakEven = useCallback(() => {
    const pos = positionRef.current
    if (!pos || pos.breakEvenSet) return
    // One tick past entry (same as live breakEvenStopPrice / snapStopToTick)
    const be = snapStopToTick(instrument, pos.entry, pos.entry, pos.direction)
    if (be === pos.entry) return
    const next: PaperPosition = { ...pos, stopLoss: be, breakEvenSet: true }
    positionRef.current = next
    setPosition(next)
    setBreakEvenAvailable(false)
    setBreakEvenDismissed(true)
    setMsg(`Break-even confirmed — SL @ ${be.toLocaleString()}`)
  }, [instrument])

  // Break-even available at +1R (same idea as live ManageDeskBar)
  useEffect(() => {
    if (!position || lastPrice == null || position.breakEvenSet || breakEvenDismissed) {
      if (!position) setBreakEvenAvailable(false)
      return
    }
    const r = Math.abs(position.entry - position.stopLoss)
    if (!(r > 0)) return
    const move =
      position.direction === 'LONG'
        ? lastPrice - position.entry
        : position.entry - lastPrice
    const stillNeedsBe =
      position.direction === 'LONG'
        ? position.stopLoss < position.entry
        : position.stopLoss > position.entry
    setBreakEvenAvailable(stillNeedsBe && move >= r)
  }, [position, lastPrice, breakEvenDismissed])

  const valueAcceptance = useMemo(() => {
    if (!position || lastPrice == null || !simNow) return null
    const filledAtMs = toEpochMs(position.filledAt)
    if (filledAtMs == null) return null
    const bars = sessionCandles
      .filter((c) => c.time >= position.filledAt && c.time <= simNow)
      .map((c) => ({ high: c.high, low: c.low }))
    return scoreValueAcceptance({
      side: position.direction,
      entry: position.entry,
      stopLoss: position.stopLoss,
      takeProfit: position.target,
      nowMs: simNow * 1000,
      filledAtMs,
      lastPrice,
      recentBars: bars,
    })
  }, [position, lastPrice, simNow, sessionCandles])

  // Morning lunch flat confirm — mirror live MorningLunchFlatConfirm
  useEffect(() => {
    if (!position || !lunchUnix || !simNow) return
    if (simNow < lunchUnix) return
    // Only for morning/IB books (not lunch-range fills)
    const bucket =
      bucketForRangeLabel(instrument, position.strategyRangeLabel) ??
      classifyAttemptBucket(instrument, position.filledAt * 1000)
    if (bucket === 'lunch_range') return
    const keepKey = simLunchFlatKeepOpenKey({
      instrument,
      replayDate,
      filledAt: position.filledAt,
    })
    if (
      isTradeifyGrowth50k(riskProfile) &&
      tradeifyFlattenOverridesKeepOpen(new Date(simNow * 1000))
    ) {
      setLunchFlatPrompt(false)
      return
    }
    if (hasLunchFlatKeepOpen(keepKey)) {
      setLunchFlatPrompt(false)
      return
    }
    setLunchFlatPrompt(true)
    setPlaying(false)
  }, [position, simNow, lunchUnix, instrument, replayDate, riskProfile])

  const resetSessionProgress = () => {
    sessionEpochRef.current += 1
    sessionCompletedRef.current = false
    tradesCountRef.current = 0
    realizedPnlRef.current = 0
    setPaperDayPnl(0)
    attemptsUsedRef.current = 0
    morningAttemptsRef.current = 0
    ibAttemptsRef.current = 0
    lunchAttemptsRef.current = 0
    stopHitsRef.current = 0
    setCallBadge('WAIT')
    setCallHover(
      'CALL WAIT — no ticket\n\nLeo and Level Finder advise only. No line.'
    )
    setCallScoreText('')
    callScoreKeyRef.current = ''
    deskCallRef.current = null
    setAttemptsUsed(0)
    setMorningAttempts(0)
    setIbAttempts(0)
    setLunchAttempts(0)
    setStopHits(0)
    setBreakEvenAvailable(false)
    setBreakEvenDismissed(false)
    setLunchFlatPrompt(false)
    if (position) {
      clearLunchFlatKeepOpen(
        simLunchFlatKeepOpenKey({
          instrument,
          replayDate,
          filledAt: position.filledAt,
        })
      )
    }
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
    setRiskBox(null)
    adviseBookKeyRef.current = ''
    resetSessionProgress()
    setMsg(
      instrument === 'NIKKEI'
        ? `Reset to ${deskLocalHmsAsTraderDisplay(sess.marketOpen, sess.tz)} ${TRADER_DISPLAY_LABEL} — CALL + playbook ±10 govern entries`
        : `Reset to 9:30 AM ${TRADER_DISPLAY_LABEL} — CALL + playbook ±10 govern entries`
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
    setRiskBox(null)
    adviseBookKeyRef.current = ''
    resetSessionProgress()
    setMsg(
      instrument === 'NIKKEI'
        ? `Replay from ${deskLocalHmsAsTraderDisplay(sess.marketOpen, sess.tz)} ${TRADER_DISPLAY_LABEL} — CALL + playbook ±10 govern entries`
        : `Replay from 9:30 AM ${TRADER_DISPLAY_LABEL} — CALL + playbook ±10 govern entries`
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
      !riskBox &&
      simNow > 0 &&
      simNow >= openUnix &&
      attemptsUsed < MAX_DAY_ATTEMPTS &&
      gate?.canPlaceEntry === true

    if (!container || !seriesRef.current || !canPlace) return

    // Double-click places a limit — single click/drag stays free for pan/zoom
    const onDblClick = (e: MouseEvent) => {
      e.preventDefault()
      if (!seriesRef.current) return
      const raw = priceFromClientY(container, seriesRef.current, e.clientY)
      if (raw == null) return

      const snapped = snapSimEntryOrDeny(Number(raw))
      if ('deny' in snapped) {
        setMsg(snapped.deny)
        return
      }
      openRiskBoxFromPrice(snapped.price)
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
    snapSimEntryOrDeny,
    openRiskBoxFromPrice,
    riskBox,
  ])

  // Hooks must run unconditionally — early returns below come AFTER all hooks.
  const phase = position ? 'MANAGE' : gate?.phase ?? 'ENTRY'
  const tradeifyNow = simNow > 0 ? new Date(simNow * 1000) : undefined
  const tradeifyDayLock = resolveTradeifyPlace({
    now: tradeifyNow,
    fillsUsed: attemptsUsed,
    stopOutsToday: stopHits,
    dailyPnl: paperDayPnl,
  })
  const tradeifyStatus = tradeifyDeskStatus(
    tradeifyDayLock,
    tradeifyNow ?? new Date()
  )
  const canEnter =
    !position &&
    !pending &&
    !riskBox &&
    simNow >= openUnix &&
    attemptsUsed < MAX_DAY_ATTEMPTS &&
    gate?.canPlaceEntry === true &&
    tradeifyDayLock.allowed
  const midChip = instrument === 'NIKKEI' ? 'US' : 'IB'
  const lateChip = instrument === 'NIKKEI' ? 'IB' : 'LN'
  const simPlaybookNow = simNow > 0 ? new Date(simNow * 1000) : new Date()
  const simPlaybookMode = resolveDeskPlaybookMode({
    instrument,
    now: simPlaybookNow,
    ladder: attemptLadderFromCounts({
      morningAttempts,
      ibAttempts,
      lunchAttempts,
      morningStopHits: Math.min(stopHits, morningAttempts),
      now: simPlaybookNow,
      instrument,
    }),
  })
  const playbookButtonLabel = deskPlaybookToolbarLabel(simPlaybookMode)
  const playbookPanelTitle = deskPlaybookPanelTitle(simPlaybookMode, instrument)
  const watchPlaybookHint = deskPlaybookHint(simPlaybookMode, instrument)
  const playbookAdviseLevels = callAlignedAdviseLevels(levels, deskCallRef.current)

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

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0d1117]">
      <DeskCallModePrompt
        open={useCall == null}
        onChoose={(next) => {
          writeSimCallMode(instrument, replayDate, next)
          setUseCall(next)
        }}
      />
      {/* Full-bleed chart + session color bands (bands painted imperatively for smooth pan) */}
      <div className="absolute inset-0 z-0">
        <div ref={containerRef} className="absolute inset-0 z-0" />
        <div
          ref={sessionOverlayRef}
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ opacity: 1, transition: 'none', willChange: 'opacity' }}
        />
        {riskBox && chartReady && (
          <DeskRiskBoxOverlay
            containerRef={containerRef}
            series={seriesRef.current}
            instrument={instrument}
            riskBox={riskBox}
            onChange={setRiskBox}
            onConfirm={confirmRiskBox}
            onCancel={() => setRiskBox(null)}
            snapRanges={getStrategyRiskBundle().snapRanges}
            strategyRange={getStrategyRiskBundle().strategyRange}
            allowedEdges={ticketAllowedEdges({
              useCall,
              call: getStrategyRiskBundle().call,
            })}
            lockDirection={useCall !== false}
            liveOk={(range) => {
              const { strategyRange, ladder } = getStrategyRiskBundle()
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
                timeSec: deskClockSeconds(instrument, new Date(simNowRef.current * 1000)),
                ladder,
                rangeLabel: range.label,
              }).ok
            }}
            riskDollars={
              resolveTradeifyPlace({
                now: simNow > 0 ? new Date(simNow * 1000) : undefined,
                fillsUsed: attemptsUsed,
                stopOutsToday: stopHits,
                dailyPnl: paperDayPnl,
              }).riskDollars
            }
            fillsUsed={attemptsUsed}
            layoutTick={overlayTick + simNow}
          />
        )}
        {pending && !position && !riskBox && chartReady && (
          <DeskWorkingBracketOverlay
            containerRef={containerRef}
            series={seriesRef.current}
            instrument={instrument}
            entry={pending.level}
            direction={pending.direction}
            stopLoss={pending.stopLoss}
            profitTarget={pending.target}
            onTargetChange={(target) => {
              const next = { ...pending, target }
              pendingRef.current = next
              setPending(next)
              setMsg(`Working TP → ${target.toLocaleString()}`)
            }}
            onCancel={cancelPending}
            layoutTick={overlayTick + simNow}
          />
        )}
        {position && !riskBox && chartReady && (
          <DeskManageBracketOverlay
            containerRef={containerRef}
            series={seriesRef.current}
            instrument={instrument}
            entry={position.entry}
            direction={position.direction}
            stopLoss={position.stopLoss}
            profitTarget={position.target}
            size={position.size}
            onCommit={(next) => {
              const updated = {
                ...position,
                stopLoss: next.stopLoss,
                target: next.profitTarget,
              }
              positionRef.current = updated
              setPosition(updated)
              setMsg(
                `Brackets updated — SL ${next.stopLoss.toLocaleString()} · TP ${next.profitTarget.toLocaleString()}`
              )
            }}
            layoutTick={overlayTick + simNow}
          />
        )}
        {(position || pending) && (
          <div className="pointer-events-none absolute left-3 top-14 z-40 max-w-[min(360px,75%)]">
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
          {instrument === 'NIKKEI' && (
            <span
              className="text-[10px] text-gray-500 tabular-nums normal-case tracking-normal"
              title="Tokyo Stock Exchange cash lunch (11:30–12:30 JST) · Montreal wall clock"
            >
              {nikkeiCashLunchMontrealLabel()}
            </span>
          )}
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
              `Up to 2/2/2 per window · Session ≤ ${MAX_DAY_ATTEMPTS} fills total. Next window unlocks when prior clock ends or probes are exhausted, but the session cap always wins.`
            }
          >
            Session {attemptsUsed}/{MAX_DAY_ATTEMPTS} · AM {morningAttempts}/{MAX_MORNING_ATTEMPTS} ·{' '}
            {midChip} {ibAttempts}/{MAX_IB_ATTEMPTS} · {lateChip}{' '}
            {lunchAttempts}/{MAX_LUNCH_RANGE_ATTEMPTS}
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
              onClick={() => openRiskBoxFromPrice(lastPriceRef.current ?? lastPrice)}
              className="rounded border border-amber-500/50 bg-amber-600/80 px-2 py-1 text-[10px] font-bold uppercase text-white hover:bg-amber-500"
              title="Place CALL limit on the active playbook ±10"
            >
              Place limit
            </button>
          )}
          <span
            className="shrink-0 rounded bg-amber-500 px-2 py-1 text-[10px] font-bold uppercase text-black"
            title="Tradeify $50k dollar risk — $400 / $250 / $150"
          >
            Tradeify $50k
          </span>
          {!tradeifyDayLock.allowed && (
            <span
              className="max-w-[16rem] truncate text-[10px] font-semibold text-red-300"
              title={tradeifyDayLock.refuseMessage}
            >
              {tradeifyDayLock.refuseReason === 'day_locked_stops'
                ? '2 stops — sit'
                : tradeifyDayLock.refuseReason === 'day_locked_green'
                  ? 'Green-day lock'
                  : tradeifyDayLock.refuseReason === 'must_flatten'
                    ? 'Flatten now'
                    : 'No new entries'}
            </span>
          )}
          {canEnter && (
            <span
              className="hidden text-[10px] text-gray-500 sm:inline"
              title="Double-click the CALL ±10 band (low for LONG, high for SHORT)"
            >
              Double-click chart
            </span>
          )}
          <button
            type="button"
            title={
              levelsOpen
                ? 'Hide AI/structure levels (Press L)'
                : 'Show AI/structure levels (Press L)'
            }
            onClick={() => setLevelsOpen((v) => !v)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold uppercase ${
              levelsOpen
                ? 'border-white/30 bg-white/10 text-gray-100'
                : 'border-white/15 text-gray-500 hover:border-white/30 hover:text-gray-200'
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${levelsOpen ? 'bg-emerald-400' : 'bg-gray-600'}`}
            />
            Levels (L)
            {levels.length > 0 ? ` (${levels.length})` : ''}
          </button>
          <button
            type="button"
            title={
              showIbBreakouts
                ? 'IB BRK (RVOL) + REJ markers visible (Press B)'
                : 'Show IB breakout (volume) & rejection markers (Press B)'
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
          <button
            type="button"
            title={
              showYesterdayProfile
                ? 'Yesterday YH/YL/VA/POC + day type + superimposed range on (Press Y)'
                : 'Show yesterday cash profile (Press Y)'
            }
            onClick={() => setShowYesterdayProfile((v) => !v)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold uppercase ${
              showYesterdayProfile
                ? 'border-amber-500/50 bg-amber-600/30 text-amber-100'
                : 'border-white/15 text-gray-500 hover:border-amber-500/40 hover:text-amber-200'
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${showYesterdayProfile ? 'bg-amber-400' : 'bg-gray-600'}`}
            />
            Yday (Y)
            {showYesterdayProfile && (
              <span className="normal-case tracking-normal text-[10px] font-normal text-amber-200/80">
                {yesterdayBadge}
              </span>
            )}
          </button>
          <button
            type="button"
            title={
              showOpeningActivity
                ? 'Dalton opening type lines on — open + first 5m H/L. Click to hide lines (type still updates).'
                : 'Show Dalton opening type: Drive / Test-Drive / Rejection-Reverse / Auction. Click for open + first-bar H/L.'
            }
            onClick={() => setShowOpeningActivity((v) => !v)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold uppercase ${
              showOpeningActivity
                ? 'border-cyan-500/50 bg-cyan-600/30 text-cyan-100'
                : 'border-white/15 text-gray-500 hover:border-cyan-500/40 hover:text-cyan-200'
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${showOpeningActivity ? 'bg-cyan-400' : 'bg-gray-600'}`}
            />
            Open
            <span className="normal-case tracking-normal text-[10px] font-normal text-cyan-200/80">
              {openingBadge}
            </span>
          </button>
          <button
            type="button"
            title={
              showMarketControl
                ? 'Dalton control dPOC line on. Click to hide the line (RF type still updates).'
                : 'Show Dalton control: Rotation Factor + developing POC. Click for the dPOC line.'
            }
            onClick={() => setShowMarketControl((v) => !v)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold uppercase ${
              showMarketControl
                ? 'border-indigo-500/50 bg-indigo-600/30 text-indigo-100'
                : 'border-white/15 text-gray-500 hover:border-indigo-500/40 hover:text-indigo-200'
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${showMarketControl ? 'bg-indigo-400' : 'bg-gray-600'}`}
            />
            Ctrl
            <span className="normal-case tracking-normal text-[10px] font-normal text-indigo-200/80">
              {controlBadge}
            </span>
          </button>
          <span
            title={callHover}
            className="group relative flex cursor-help items-center gap-1 rounded border border-zinc-500/40 px-2 py-1 text-[10px] font-semibold uppercase text-zinc-400"
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: CALL_COLORS.badge }}
            />
            Call
            <span className="normal-case tracking-normal text-[10px] font-normal text-zinc-400/80">
              {callBadge}
            </span>
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-[22rem] whitespace-pre-wrap rounded-lg border border-zinc-500/40 bg-[#0d1117] px-2.5 py-2 text-left text-[10px] font-normal normal-case leading-snug tracking-normal text-zinc-200 shadow-xl group-hover:visible"
            >
              {callHover}
            </span>
          </span>
          <span
            title={ibExtendHover}
            className="flex items-center gap-1 rounded border border-amber-700/40 px-2 py-1 text-[10px] font-semibold uppercase text-amber-200/90"
          >
            IB
            <span className="normal-case tracking-normal text-[10px] font-normal text-amber-100/80">
              {ibExtendBadge}
            </span>
          </span>
          {useCall === true && (
            <button
              type="button"
              title="CALL gate on. Click for regular ±10 — CALL setup stays on the chip."
              onClick={() => {
                setUseCall(false)
                writeSimCallMode(instrument, replayDate, false)
              }}
              className="rounded border border-zinc-500/40 px-2 py-1 text-[10px] font-semibold uppercase text-zinc-300 hover:bg-zinc-500/20"
            >
              CALL ON
            </button>
          )}
          {useCall === false && (
            <button
              type="button"
              title="Regular ±10. CALL still shows the setup. Click to gate tickets on CALL."
              onClick={() => {
                setUseCall(true)
                writeSimCallMode(instrument, replayDate, true)
              }}
              className="rounded border border-sky-500/40 px-2 py-1 text-[10px] font-semibold uppercase text-sky-200 hover:bg-sky-500/20"
            >
              Regular ±10
            </button>
          )}
          <button
            type="button"
            title={
              playbookOpen
                ? `Hide ${playbookButtonLabel} (Press P) — advise only`
                : `Show ${playbookButtonLabel} (Press P) — advise only; place on CALL ±10`
            }
            onClick={() => setPlaybookOpen((v) => !v)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold uppercase ${
              playbookOpen
                ? 'border-white/30 bg-white/10 text-gray-100'
                : 'border-white/15 text-gray-500 hover:border-white/30 hover:text-gray-200'
            }`}
          >
            {playbookButtonLabel} (P)
          </button>
          {(instrument === 'DOW' || instrument === 'NASDAQ') && (
            <button
              type="button"
              title={
                showLunchRange
                  ? `NYC Lunch range 12:00–13:30 ${TRADER_DISPLAY_LABEL} visible (Press N)`
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
                  ? 'US Range H/L visible — no 50% mid (Press U)'
                  : 'Show prior NYC US session H/L only — no mid (Press U)'
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
                  ? `OR 30 H/L visible — ${or30WindowLabel(instrument)} (Press R). Range is calculated even if you missed the window.`
                  : `OR30 is calculated from cash open even if you arrive late. Press R to show H/L — ${or30WindowLabel(instrument)}`
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
              {or30Locked && !showOr30 ? ' locked' : ''}
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

        <div
          className={`pointer-events-none mt-1.5 flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-2.5 py-1.5 text-[10px] backdrop-blur ${
            tradeifyStatus === 'must_flatten'
              ? 'border-red-500/40 bg-red-950/80 text-red-100'
              : tradeifyStatus === 'day_locked'
                ? 'border-amber-500/40 bg-amber-950/80 text-amber-100'
                : 'border-amber-500/25 bg-[#161b22]/90 text-amber-100'
          }`}
        >
          <span className="font-bold uppercase tracking-wide">Tradeify $50k</span>
          <span className="text-white">
            {formatTradeifyRiskChip(attemptsUsed)}
          </span>
          <span>
            Fills {attemptsUsed}/3 · stops {stopHits}/2
          </span>
          <span className={paperDayPnl >= 0 ? 'text-emerald-300' : 'text-red-300'}>
            Day {paperDayPnl >= 0 ? '+' : '−'}$
            {Math.abs(Math.round(paperDayPnl)).toLocaleString()}
          </span>
          <span>
            DLL ${Math.round(tradeifyDayLock.leftoverDll)} / ${TRADEIFY_DLL_DOLLARS}
          </span>
          <span>Floor ${Math.round(tradeifyDayLock.floorRoom)}</span>
          <span>Flatten {tradeifyFlattenMontreal(tradeifyNow ?? new Date())}</span>
          {tradeifyStatus !== 'can_trade' && (
            <span className="font-semibold uppercase">
              {tradeifyStatus === 'must_flatten' ? 'Flatten now' : 'Day locked'}
            </span>
          )}
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
          <span className="text-gray-600">·</span>
          <span
            className="flex items-center gap-1.5 normal-case tracking-normal"
            title="Dalton opening type — first cash 5m. Click Open chip for open + first-bar H/L."
          >
            <span className="inline-block w-4 border-t-2 border-cyan-400" />
            <span className={showOpeningActivity ? 'text-cyan-400' : 'text-gray-500'}>
              Open {openingBadge}
            </span>
          </span>
          <span className="text-gray-600">·</span>
          <span
            className="flex items-center gap-1.5 normal-case tracking-normal"
            title="Dalton control — RF + developing POC. Click Ctrl chip for the dPOC line."
          >
            <span className="inline-block w-4 border-t-2 border-indigo-400" />
            <span className={showMarketControl ? 'text-indigo-400' : 'text-gray-500'}>
              Ctrl {controlBadge}
            </span>
          </span>
          <span className="text-gray-600">·</span>
          <span
            className="flex items-center gap-1.5 normal-case tracking-normal"
            title={callHover}
          >
            <span
              className="inline-block w-4 border-t-2"
              style={{ borderColor: CALL_COLORS.badge }}
            />
            <span className="text-zinc-400">Call {callBadge}</span>
          </span>
          <span className="text-gray-600">·</span>
          <span
            className="flex items-center gap-1.5 normal-case tracking-normal"
            title={ibExtendHover}
          >
            <span className="inline-block w-4 border-t-2 border-amber-400" />
            <span className="text-amber-300/90">IB {ibExtendBadge}</span>
          </span>
          {callScoreText ? (
            <>
              <span className="text-gray-600">·</span>
              <span
                className="normal-case tracking-normal text-zinc-400"
                title="Per-window CALL score for this clip + running tally this browser session"
              >
                {callScoreText}
              </span>
            </>
          ) : null}
          {(or30Shaped || or30Locked) && (
            <>
              <span className="text-gray-600">·</span>
              <span
                className="flex items-center gap-1.5 normal-case tracking-normal"
                title={`Opening Range 30 — ${or30WindowLabel(instrument)}. Calculated even if you skip/miss the window. Press R to show lines.`}
              >
                <span
                  className="inline-block w-4 border-t-2"
                  style={{ borderColor: OR30_COLORS.high }}
                />
                <span style={{ color: OR30_COLORS.high }}>
                  OR30 {or30Locked ? 'locked' : 'H/L'}
                </span>
                <span className="text-gray-600">
                  {or30Shaped ? 'morning bait' : 'calculated · R off'}
                </span>
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
                title={`NYC Lunch Session Range 12:00–13:30 ${TRADER_DISPLAY_LABEL}`}
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
              Drag SL / TP on chart
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
            {valueAcceptance && <ValueAcceptanceRead read={valueAcceptance} />}
            <button
              type="button"
              onClick={closeAtMarket}
              className="rounded-lg border border-emerald-800 px-2.5 py-1 text-[11px] font-semibold text-emerald-400"
            >
              CLOSE
            </button>
            {breakEvenAvailable && (
              <>
                <button
                  type="button"
                  onClick={moveStopToBreakEven}
                  className="rounded-lg border border-amber-500/60 bg-amber-600/90 px-2.5 py-1 text-[11px] font-bold uppercase text-white hover:bg-amber-500"
                >
                  Move to BE
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBreakEvenAvailable(false)
                    setBreakEvenDismissed(true)
                  }}
                  className="rounded-lg border border-white/15 px-2 py-1 text-[10px] text-gray-400 hover:text-white"
                >
                  Not now
                </button>
              </>
            )}
            {position.breakEvenSet && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-300/90">
                BE locked
              </span>
            )}
          </div>
        )}
      </div>

      {playbookOpen && (
        <DraggableDeskWidget
          storageKey="desk-playbook-sim"
          defaultPos={{ x: 24, y: 88 }}
          title={playbookPanelTitle}
          onClose={() => setPlaybookOpen(false)}
        >
          <div className="space-y-1.5 p-2">
            <p className="px-1 pb-1 text-[10px] leading-snug text-gray-500">
              Level Finder advises only. Place on CALL ±10 (double-click or a painted band).
            </p>
            <p className="px-1 pb-1 text-[10px] leading-snug text-gray-500">
              {watchPlaybookHint}
            </p>
            {playbookAdviseLevels.length === 0 && (
              <p className="rounded-md border border-white/10 bg-black/30 px-2 py-2 text-[11px] leading-snug text-gray-400">
                No in-band advise levels yet — the book still updates with CALL and the
                locked playbook. Place on CALL ±10.
              </p>
            )}
            {playbookAdviseLevels.map((l, i) => {
              const side = tradeSideOfLevel(l)
              const isRes = side === 'SHORT'
              const { label: starLabel } = convictionStars(l.conviction)
              const isPrimary = l.rank !== 'watch'
              const why =
                (l.reasoning && l.reasoning.trim()) ||
                `${isPrimary ? 'Primary' : 'Watch'} ${isRes ? 'short' : 'buy'} from ${l.source === 'structure' ? 'structure' : 'AI'} · conviction ${l.conviction ?? '—'}`
              return (
                <button
                  key={`${l.level}-${i}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    jumpToAdvisePrice(l.level)
                  }}
                  className={`w-full rounded-xl border px-2.5 py-2.5 text-left text-[11px] transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                    isRes
                      ? 'border-red-800/80 bg-[#2a1518] text-red-200'
                      : 'border-emerald-800/80 bg-[#12241c] text-emerald-200'
                  } ${isPrimary ? 'ring-1 ring-white/25' : 'opacity-90'}`}
                  title={`${why} · advise only (click to focus) — place on CALL ±10`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wide">
                      {isPrimary ? 'PRIMARY' : 'WATCH'} {side}
                    </span>
                    <span className="text-[10px] text-amber-300" title={`Conviction ${l.conviction}`}>
                      {starLabel}
                    </span>
                  </div>
                  <div className="price-mono mt-1 text-base font-bold tracking-tight text-white">
                    {l.level.toLocaleString()}
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-[10px] leading-snug text-gray-400 normal-case">
                    {why}
                  </p>
                </button>
              )
            })}
          </div>
        </DraggableDeskWidget>
      )}

      <MorningLunchFlatConfirm
        open={lunchFlatPrompt && !!position}
        instrument={instrument}
        direction={position?.direction || 'LONG'}
        entryPrice={position?.entry || 0}
        cashCloseLabel={`${deskLocalHmsAsTraderDisplay(sess.marketClose, sess.tz)} ${TRADER_DISPLAY_LABEL}`}
        onConfirm={() => {
          setLunchFlatPrompt(false)
          closeAtMarket()
        }}
        onKeepOpen={() => {
          if (position) {
            markLunchFlatKeepOpen(
              simLunchFlatKeepOpenKey({
                instrument,
                replayDate,
                filledAt: position.filledAt,
              })
            )
          }
          setLunchFlatPrompt(false)
        }}
      />

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
