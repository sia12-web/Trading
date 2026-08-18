'use client'

/**
 * Chart Page — live desk: morning trading; afternoon chart continues (read-only).
 * Flow: place WORKING limit → wait for fill → then MANAGE (morning only).
 * NY:  DOW/NASDAQ  9:30–11:30 ET trade / chart through 16:00
 * Nikkei stays on Simulation — not a live desk.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useRef, useCallback, useEffect } from 'react'
import { TradingChart } from './components/TradingChart'
import { SessionBanner, type SessionGateState } from './components/SessionBanner'
import {
  LevelOrderTicket,
  type FilledOrder,
  type PendingLimitOrder,
  limitWouldFill,
} from './components/LevelOrderTicket'
import type {
  StrategyRangeEdges,
  StrategyRiskMagnets,
} from '@/lib/trading/strategyRiskGeometry'
import {
  ManageDeskBar,
  type AiVerdict,
  type ManagePosition,
} from './components/ManageDeskBar'
import {
  initialDeskChartInstrument,
  saveDeskClockLock,
  setDeskInstrumentPreference,
  type DeskInstrumentPref,
} from '@/lib/trading/deskInstrumentPreference'
import { isAnyLiveFocusWindowActive, isAfternoonWatchWindow, sessionFor, deskMarketFor } from '@/lib/trading/sessionGate'
import { LIVE_CLOCK_REFUSE, clockedNameOnlyMessage } from '@/lib/trading/liveDeskBook'
import { quoteBelongsToBook } from '@/lib/trading/deskExitGuard'
import {
  TRADER_DISPLAY_LABEL,
  deskLocalHmsAsTraderDisplay,
} from '@/lib/chart/traderDisplayTz'
import {
  clearLunchFlatKeepOpen,
  hasLunchFlatKeepOpen,
  isMorningOrIbEntry,
  isPastCashCloseNow,
  liveLunchFlatKeepOpenKey,
  markLunchFlatKeepOpen,
} from '@/lib/trading/morningLunchConfirm'
import { assertRangeEdgeEntry } from '@/lib/trading/rangeEdgeEntryGate'
import {
  assertBucketEntryEligible,
  attemptLadderFromCounts,
  bucketForRangeLabel,
  deskClockSeconds,
  MAX_DAY_ATTEMPTS as SESSION_MAX_ATTEMPTS,
} from '@/lib/trading/attemptLadder'
import {
  WORKING_LIMIT_ALREADY_MESSAGE,
  formatWorkingLimitAlreadyMessage,
  shouldCancelWorkingForGate,
  workingRowToPending,
  type WorkingLimitRow,
} from '@/lib/trading/workingLimitGate'
import { shouldClearChartAsClosed } from '@/lib/trading/currentPositionQuery'
import {
  formatEntryPermissionNote,
  formatSessionStartNote,
  formatSessionEndNote,
  claimDeskNoteOnce,
  deskNoteClaimKey,
} from '@/lib/trading/rangeEdgeAlerts'
import {
  buildDeskNewsHazards,
  formatDayNewsDigest,
} from '@/lib/trading/deskNewsHazard'
import type { DeskCalendarEvent } from '@/lib/trading/deskNews'
import { infoToast, warningToast, successToast } from '@/lib/utils/toastUtils'
import {
  deskAlertTelegramText,
  formatDeskAlertToast,
} from '@/lib/notify/deskAlertTelegram'
import { LiveDeskBriefPanel } from './components/LiveDeskBriefPanel'
import type { LiveDeskBrief } from '@/lib/trading/liveDeskBrief'
import type { DeskInstrument } from '@/lib/trading/sessionGate'
import {
  DESK_RISK_PROFILE_EVENT,
  getDeskRiskProfile,
  hydrateDeskRiskProfileFromServer,
  isTradeifyGrowth50k,
} from '@/lib/trading/tradeifyProfile'
import { TradovateMirrorCard } from './components/TradovateMirrorCard'
import {
  tradeifyFlattenOverridesKeepOpen,
  tradeifyMustFlatten,
} from '@/lib/trading/tradeifyGrowth50k'

/** Why new entries are blocked — shown on market/limit place attempts. */
function entryDeniedMessage(gate: SessionGateState | null | undefined): string | null {
  if (!gate) return 'Session gate loading — try again in a moment.'
  if (gate.phase === 'MANAGE' || gate.open_position_id) {
    return 'Position open — manage only, no new entries.'
  }
  if (!gate.clockedIn) {
    if (gate.canClockIn) {
      return 'Clocked out — click “Today I trade” to resume entries.'
    }
    if (gate.dayLocked || (gate.attemptsUsed ?? 0) >= (gate.maxAttempts ?? SESSION_MAX_ATTEMPTS)) {
      return 'Session attempt cap reached — trading switched off. No new entries.'
    }
    if (gate.phase === 'CLOSED') {
      return 'Cash closed — desk is offline until the next session.'
    }
    return 'Clocked out — no new entries. Manage only if you have an open book.'
  }
  if (gate.glanceOnly) {
    return (
      gate.message?.trim() ||
      (gate.lockedInstrument
        ? clockedNameOnlyMessage(gate.lockedInstrument)
        : LIVE_CLOCK_REFUSE)
    )
  }
  if (!gate.canPlaceEntry) {
    if (gate.dayLocked || (gate.attemptsUsed ?? 0) >= (gate.maxAttempts ?? SESSION_MAX_ATTEMPTS)) {
      return 'Session attempt cap reached — trading switched off. No new entries.'
    }
    // Prefer the live gate copy (OR30 forming / wait for US Range clock / etc.)
    // over a blunt FLAT fallback — US Range H/L can be painted before its entry window.
    if (gate.message && gate.message.trim()) {
      return gate.message.trim()
    }
    if (gate.phase === 'FLAT') {
      return 'Entry window closed — wait for IB or lunch-range unlock (if still eligible).'
    }
    if (gate.phase === 'DONE') {
      return 'Entry windows done for today — manage if open, no new entries.'
    }
    if (gate.phase === 'CLOSED') {
      return 'Cash closed — desk is offline until the next session.'
    }
    if (gate.phase === 'PREP' || gate.phase === 'RECOMMENDED') {
      return 'Pre-open prep — ±10 entries after OR30 locks (open + 30m).'
    }
    return 'Entries not available right now.'
  }
  return null
}

/**
 * Range-aware override: the blanket gate above follows the single sequential
 * "active" range and can deny a click on a range with its own budget left
 * (e.g. IB still 1/2 while the clock highlight has moved to Lunch-range).
 * Session (day) total cap always wins — 3 trades/session regardless of which
 * window still shows spare probes.
 */
function rangeAwareEntryDeniedMessage(
  gate: SessionGateState | null | undefined,
  instrument: string,
  rangeLabel: string | null | undefined
): string | null {
  const denied = entryDeniedMessage(gate)
  if (!denied) return null
  if (!gate || !gate.clockedIn || gate.dayLocked || gate.phase === 'MANAGE' || gate.phase === 'CLOSED') {
    return denied
  }
  if ((gate.attemptsUsed ?? 0) >= (gate.maxAttempts ?? SESSION_MAX_ATTEMPTS)) {
    return denied
  }
  if (!rangeLabel) return denied
  const bucket = bucketForRangeLabel(instrument, rangeLabel)
  if (!bucket) return denied
  const ladder = attemptLadderFromCounts({
    morningAttempts: gate.morningAttempts,
    ibAttempts: gate.ibAttempts,
    lunchAttempts: gate.lunchAttempts,
    now: new Date(),
    instrument,
  })
  const check = assertBucketEntryEligible({
    instrument,
    market: deskMarketFor(instrument),
    timeSec: deskClockSeconds(instrument),
    ladder,
    rangeLabel,
  })
  return check.ok ? null : denied
}

/** Cancelled working-limit copy — matches why the gate stopped the book. */
function workingLimitCancelledMessage(gate: SessionGateState): string {
  if (!gate.clockedIn) {
    return gate.canClockIn
      ? 'Working limit cancelled — clocked out. Re-clock in to place entries.'
      : 'Working limit cancelled — clocked out. No new entries.'
  }
  if (gate.phase === 'FLAT') {
    return 'Working limit cancelled — entry window closed (levels cleared)'
  }
  if (gate.phase === 'DONE') {
    return 'Working limit cancelled — entry windows done for today.'
  }
  return 'Working limit cancelled — cash session closed.'
}
import { MorningLunchFlatConfirm } from './components/MorningLunchFlatConfirm'

type Instrument = DeskInstrumentPref

function asLiveNy(i: string | null | undefined): Instrument {
  return i === 'NASDAQ' ? 'NASDAQ' : 'DOW'
}

interface PositionOverlay {
  entryPrice: number
  stopLoss: number
  profitTarget: number
  direction: 'long' | 'short'
  positionSize?: number
  riskDollars?: number
}

export default function ChartPage() {
  const router = useRouter()
  // SSR/hydration always starts DOW — restore preference after mount (see effect below)
  const [instrument, setInstrumentState] = useState<Instrument>('DOW')
  const [chartBooted, setChartBooted] = useState(false)

  const gateRef = useRef<SessionGateState | null>(null)

  /** User tab click — persist unclocked browse or the clocked name */
  const setInstrument = useCallback((i: string) => {
    const next = asLiveNy(i)
    setInstrumentState(next)
    const g = gateRef.current
    const locked = g?.lockedInstrument
    if (!g?.clockedIn || !locked || next === locked) {
      setDeskInstrumentPreference(next)
    }
  }, [])

  /** Gate/lock sync — update view only, do not clobber saved preference */
  const syncInstrument = useCallback((i: string) => {
    setInstrumentState(asLiveNy(i))
  }, [])

  useEffect(() => {
    setInstrumentState(initialDeskChartInstrument())
    setChartBooted(true)
  }, [])

  // Outside focus (−30m→close): send home — Live Trading is locked
  useEffect(() => {
    const check = () => {
      if (!isAnyLiveFocusWindowActive()) {
        router.replace('/dashboard')
      }
    }
    check()
    const id = window.setInterval(check, 15_000)
    return () => window.clearInterval(id)
  }, [router])
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [positionOverlay, setPositionOverlay] = useState<PositionOverlay | null>(null)
  const [managePos, setManagePos] = useState<ManagePosition | null>(null)
  const [pending, setPending] = useState<PendingLimitOrder | null>(null)
  const [tradeifyAccountName, setTradeifyAccountName] = useState<string | null>(null)
  const [riskProfile, setRiskProfile] = useState(getDeskRiskProfile)
  const lastTradeifyRiskRef = useRef(0)
  const [gate, setGate] = useState<SessionGateState | null>(null)
  gateRef.current = gate

  // Clocked name owns the chart on refresh — preference DOW must not hide NASDAQ/MNQ.
  useEffect(() => {
    const locked = gate?.lockedInstrument
    if (!gate?.clockedIn || !locked) {
      if (gate && !gate.clockedIn) saveDeskClockLock(null)
      return
    }
    saveDeskClockLock(asLiveNy(locked))
    setInstrumentState(asLiveNy(locked))
  }, [gate?.clockedIn, gate?.lockedInstrument])
  const [orderLevel, setOrderLevel] = useState<number | null>(null)
  const [orderLevelType, setOrderLevelType] = useState<string | undefined>()
  const [orderLevelSide, setOrderLevelSide] = useState<'BUY' | 'SHORT' | undefined>()
  const [orderPreferredDirection, setOrderPreferredDirection] = useState<
    'LONG' | 'SHORT' | undefined
  >()
  const [orderLevelReason, setOrderLevelReason] = useState<string | undefined>()
  const [orderEntrySource, setOrderEntrySource] = useState<'ai' | 'structure' | 'manual'>('ai')
  const [orderStrategyRange, setOrderStrategyRange] =
    useState<StrategyRangeEdges | null>(null)
  const [orderStrategyMagnets, setOrderStrategyMagnets] =
    useState<StrategyRiskMagnets | null>(null)
  /** Manual/journal-rationale flows already collected SL/TP up front — skip the
   *  redundant second "Place manual limit" confirm and auto-submit instead. */
  const [orderPresetStopLoss, setOrderPresetStopLoss] = useState<number | null>(null)
  const [orderPresetProfitTarget, setOrderPresetProfitTarget] = useState<number | null>(null)
  const [orderAutoConfirm, setOrderAutoConfirm] = useState(false)
  const [regime, setRegime] = useState<'bullish' | 'bearish' | 'choppy'>('bullish')
  const [regimeConfidence, setRegimeConfidence] = useState(70)
  const [gateTick, setGateTick] = useState(0)
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null)
  const [dataMode, setDataMode] = useState<'live' | 'synthetic'>('live')
  const [fillError, setFillError] = useState<string | null>(null)
  const [bracketAdjustStatus, setBracketAdjustStatus] = useState<
    'idle' | 'saving' | 'error' | null
  >(null)
  const [bracketAdjustError, setBracketAdjustError] = useState<string | null>(null)
  const [workingBracketAdjustStatus, setWorkingBracketAdjustStatus] = useState<
    'idle' | 'saving' | 'error' | null
  >(null)
  const [workingBracketAdjustError, setWorkingBracketAdjustError] = useState<string | null>(null)
  /** Snapshot to revert chart overlay if bracket API fails */
  const confirmedOverlayRef = useRef<PositionOverlay | null>(null)
  const bracketSavingRef = useRef(false)
  const workingBracketSavingRef = useRef(false)
  /** After 11:30 with open morning/IB book — ask before closing */
  const [lunchFlatPrompt, setLunchFlatPrompt] = useState(false)
  const [lunchFlatBusy, setLunchFlatBusy] = useState(false)
  /** Placing → Working → Filled | Rejected */
  const [orderStatus, setOrderStatus] = useState<
    'idle' | 'placing' | 'working' | 'filled' | 'rejected'
  >('idle')
  const [levelsRefreshKey, setLevelsRefreshKey] = useState(0)
  const afternoonLevelsLoadedRef = useRef(false)
  const [aiVerdict, setAiVerdict] = useState<AiVerdict | null>(null)
  const [rangeAtrAdvice, setRangeAtrAdvice] = useState<string | null>(null)
  const [recommendation, setRecommendation] = useState<{
    instrument: Instrument
    regime: string
    regime_confidence: number
    recommendation_confidence: number
    message: string
  } | null>(null)
  const [liveBrief, setLiveBrief] = useState<LiveDeskBrief | null>(null)
  const [liveBriefLoading, setLiveBriefLoading] = useState(false)
  const [liveBriefError, setLiveBriefError] = useState<string | null>(null)

  const jumpToPriceRef = useRef<((price: number) => void) | null>(null)
  const bannerRefreshRef = useRef<(() => void) | null>(null)
  const pendingRef = useRef<PendingLimitOrder | null>(null)
  const fillingRef = useRef(false)
  const placingOrderRef = useRef(false)
  /** Bumped on cancel / session expire so in-flight fills do not re-arm a cancelled limit */
  const orderGenRef = useRef(0)
  /** Last observed clockedIn — null until first gate (so refresh does not cancel as "clocked out"). */
  const hadClockedInRef = useRef<boolean | null>(null)
  const positionExitHandledRef = useRef(false)
  const livePriceRef = useRef<number | null>(null)
  const regimeFetchedRef = useRef(false)
  const lastParentPriceAt = useRef(0)

  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  useEffect(() => {
    let cancelled = false
    const sync = () => setRiskProfile(getDeskRiskProfile())
    void hydrateDeskRiskProfileFromServer().then((profile) => {
      if (!cancelled) setRiskProfile(profile)
    })
    window.addEventListener(DESK_RISK_PROFILE_EVENT, sync)
    return () => {
      cancelled = true
      window.removeEventListener(DESK_RISK_PROFILE_EVENT, sync)
    }
  }, [])
  useEffect(() => {
    if (pending?.riskAmount && pending.riskAmount > 0) {
      lastTradeifyRiskRef.current = pending.riskAmount
    } else if (managePos?.riskAmount && managePos.riskAmount > 0) {
      lastTradeifyRiskRef.current = managePos.riskAmount
    }
  }, [pending?.riskAmount, managePos?.riskAmount])
  useEffect(() => {
    if (!isTradeifyGrowth50k(riskProfile)) {
      setTradeifyAccountName(null)
      return
    }
    let cancelled = false
    void fetch('/api/trading/tradeify-snapshot', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return
        const name = typeof json?.accountName === 'string' ? json.accountName.trim() : ''
        setTradeifyAccountName(name || null)
      })
      .catch(() => {
        if (!cancelled) setTradeifyAccountName(null)
      })
    return () => {
      cancelled = true
    }
  }, [riskProfile])
  useEffect(() => {
    livePriceRef.current = livePrice
  }, [livePrice])

  useEffect(() => {
    setLivePrice(null)
    livePriceRef.current = null
  }, [instrument, gate?.lockedInstrument, managePos?.instrument])

  // Fill detection needs every tick on the ref; UI state is throttled unless a limit is working
  const pendingActiveRef = useRef(false)
  useEffect(() => {
    pendingActiveRef.current = !!pending && !managePos
  }, [pending, managePos])

  const onPriceUpdate = useCallback((price: number) => {
    livePriceRef.current = price
    if (pendingActiveRef.current) {
      setLivePrice(price)
      return
    }
    const now = Date.now()
    if (now - lastParentPriceAt.current < 50) return
    lastParentPriceAt.current = now
    setLivePrice(price)
  }, [])

  const handlePlacedRef = useRef<(order: PendingLimitOrder) => void>(() => {})

  const handleLevelSelect = useCallback(
    (
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
        strategyRange?: StrategyRangeEdges | null
        strategyMagnets?: StrategyRiskMagnets | null
      }
    ) => {
      if (managePos || positionOverlay || pending) {
        if (pending) {
          setFillError(WORKING_LIMIT_ALREADY_MESSAGE)
          setOrderStatus('rejected')
        }
        return
      }

      const inst = (gate?.lockedInstrument || instrument) as Instrument
      const denied = rangeAwareEntryDeniedMessage(gate, inst, meta?.strategyRange?.label)
      if (denied) {
        setFillError(denied)
        setOrderStatus('rejected')
        return
      }

      const isManualFlow =
        meta?.source === 'manual' ||
        meta?.type === 'manual' ||
        meta?.type === 'market'
      if (isManualFlow) {
        const edge = assertRangeEdgeEntry({
          entry: price,
          range: meta?.strategyRange ?? null,
        })
        if (!edge.ok) {
          setFillError(edge.message)
          setOrderStatus('rejected')
          return
        }
      }

      const side =
        meta?.side === 'BUY' || meta?.side === 'SHORT' ? meta.side : undefined
      const preferred =
        meta?.preferredDirection === 'LONG' || meta?.preferredDirection === 'SHORT'
          ? meta.preferredDirection
          : side === 'SHORT'
            ? 'SHORT'
            : side === 'BUY'
              ? 'LONG'
              : undefined

      // Manual / journal-rationale flows (risk-box drag, rationale modal) already
      // collected SL + TP before calling onLevelSelect — auto-submit immediately
      // instead of opening a second "Place manual limit" ticket to click through.
      const hasPresetRisk =
        meta?.stopLoss != null &&
        Number.isFinite(meta.stopLoss) &&
        meta?.profitTarget != null &&
        Number.isFinite(meta.profitTarget)

      // Desk is limit-only — always open the working-limit ticket
      setOrderLevel(price)
      setOrderLevelType(meta?.type === 'market' ? 'manual' : meta?.type)
      setOrderLevelSide(side)
      setOrderPreferredDirection(preferred)
      setOrderLevelReason(meta?.reasoning)
      setOrderEntrySource(
        meta?.source === 'manual' ||
          meta?.type === 'manual' ||
          meta?.type === 'market'
          ? 'manual'
          : meta?.source === 'structure'
            ? 'structure'
            : 'ai'
      )
      setOrderStrategyRange(meta?.strategyRange ?? null)
      setOrderStrategyMagnets(meta?.strategyMagnets ?? null)
      setOrderPresetStopLoss(hasPresetRisk ? (meta!.stopLoss as number) : null)
      setOrderPresetProfitTarget(hasPresetRisk ? (meta!.profitTarget as number) : null)
      setOrderAutoConfirm(hasPresetRisk)
    },
    [managePos, positionOverlay, pending, gate, instrument]
  )

  const refreshLevelsAfterExit = useCallback(
    async (exitReason: string) => {
      const inst = (gate?.lockedInstrument || instrument) as Instrument
      try {
        await fetch('/api/levels/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instrument: inst,
            exit_reason: exitReason,
            trigger: 'exit',
          }),
        })
      } catch {
        /* non-fatal */
      }
      setLevelsRefreshKey((n) => n + 1)
    },
    [gate?.lockedInstrument, instrument]
  )

  const refreshGate = useCallback(() => {
    setGateTick((n) => n + 1)
    bannerRefreshRef.current?.()
  }, [])

  const clearPositionUi = useCallback(
    (exitReason: 'stop_hit' | 'take_profit' | 'manual' | 'ai_signal' = 'manual') => {
      if (managePos?.id) clearLunchFlatKeepOpen(liveLunchFlatKeepOpenKey(managePos.id))
      setManagePos(null)
      setPositionOverlay(null)
      confirmedOverlayRef.current = null
      setBracketAdjustStatus(null)
      setBracketAdjustError(null)
      setAiVerdict(null)
      setLunchFlatPrompt(false)
      setOrderStatus('idle')
      refreshGate()
      void refreshLevelsAfterExit(exitReason === 'ai_signal' ? 'manual' : exitReason)
    },
    [managePos?.id, refreshGate, refreshLevelsAfterExit]
  )

  const handleBrokerExit = useCallback(
    (payload: {
      exitReason: 'stop_hit' | 'take_profit' | 'manual'
      exitPrice: number
    }) => {
      if (positionExitHandledRef.current) return
      positionExitHandledRef.current = true
      const label =
        payload.exitReason === 'stop_hit'
          ? `Stop loss hit @ ${payload.exitPrice.toLocaleString()}`
          : payload.exitReason === 'take_profit'
            ? `Take profit hit @ ${payload.exitPrice.toLocaleString()}`
            : `Position closed @ ${payload.exitPrice.toLocaleString()}`
      if (payload.exitReason === 'stop_hit') {
        warningToast(label, 9000)
      } else {
        successToast(label, 9000)
      }
      clearPositionUi(
        payload.exitReason === 'stop_hit'
          ? 'stop_hit'
          : payload.exitReason === 'take_profit'
            ? 'take_profit'
            : 'manual'
      )
    },
    [clearPositionUi]
  )

  const handleBreakEvenAvailable = useCallback(
    (payload: {
      positionId: string
      instrument: string
      proposedPrice: number
      reason: string
    }) => {
      const inst = payload.instrument as DeskInstrument
      if (payload.reason === '__confirmed__') {
        const msg = `Break-even confirmed — SL locked @ ${payload.proposedPrice.toLocaleString()}`
        successToast(msg, 7000)
        // Optimistic SL update so ManageDeskBar / overlay do not keep the pre-BE stop
        setManagePos((m) =>
          m && m.id === payload.positionId
            ? { ...m, stopLoss: payload.proposedPrice }
            : m
        )
        setPositionOverlay((ov) =>
          ov ? { ...ov, stopLoss: payload.proposedPrice } : ov
        )
        confirmedOverlayRef.current = confirmedOverlayRef.current
          ? { ...confirmedOverlayRef.current, stopLoss: payload.proposedPrice }
          : confirmedOverlayRef.current
        const kind = `be_confirmed_${payload.positionId.slice(0, 8)}`
        if (claimDeskNoteOnce(kind, inst)) {
          void fetch('/api/notify/desk-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'break_even_confirmed',
              title: 'Break-even confirmed',
              body: msg,
              telegram: `Break-even confirmed — SL @ ${payload.proposedPrice.toLocaleString()} (${inst})`,
              instrument: inst,
              dedupeKey: deskNoteClaimKey(kind, inst),
            }),
          }).catch(() => {})
        }
        return
      }
      const title = 'Break-even available'
      const body = `Confirm to lock SL at entry (${payload.proposedPrice.toLocaleString()})`
      infoToast(`${title} — ${body}`, 8000)
      const kind = `be_available_${payload.positionId.slice(0, 8)}`
      if (claimDeskNoteOnce(kind, inst)) {
        void fetch('/api/notify/desk-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'break_even_available',
            title,
            body: `${body}. ${payload.reason}`,
            telegram: `Break-even available — confirm to lock SL at entry (${inst})`,
            instrument: inst,
            dedupeKey: deskNoteClaimKey(kind, inst),
          }),
        }).catch(() => {})
      }
    },
    []
  )

  const lastUnlockKeyRef = useRef<string | null>(null)
  const prevCanPlaceRef = useRef(false)
  const lastEdgeAlertAtRef = useRef(0)
  const prevGatePhaseRef = useRef<string | null>(null)
  const prevFetchLiveRef = useRef(false)
  const prevPastCloseRef = useRef(false)
  /** First gate snapshot seeds rising-edge refs — refresh must not look like a transition. */
  const gateNotesPrimedRef = useRef(false)

  const pushDeskAlert = useCallback(
    (alert: {
      kind: string
      title: string
      body: string
      telegram: string
      dedupeKey?: string
      instrument?: string
    }) => {
      warningToast(formatDeskAlertToast(alert.title, alert.body), 8000)
      const telegram = deskAlertTelegramText(alert)
      if (!telegram) return
      void fetch('/api/notify/desk-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...alert, telegram }),
      }).catch(() => {})
    },
    []
  )

  const handleDeskAlert = useCallback(
    (alert: {
      kind: string
      title: string
      body: string
      telegram: string
      dedupeKey?: string
      instrument?: string
    }) => {
      const now = Date.now()
      // In-memory cooldown only for ±10 band noise; durable claim lives in TradingChart
      if (alert.kind === 'range_edge') {
        if (now - lastEdgeAlertAtRef.current < 90_000) return
        lastEdgeAlertAtRef.current = now
      }
      pushDeskAlert(alert)
    },
    [pushDeskAlert]
  )

  const handleRangeAtr = useCallback(
    (snap: {
      height: number
      atr: number | null
      stopPad: number
      trailStep: number
      wide: boolean
    } | null) => {
      setRangeAtrAdvice(
        snap
          ? `Vol: Hgt ${snap.height} · ATR ${snap.atr ?? '—'} · pad ~${snap.stopPad} · trail ~${snap.trailStep}${snap.wide ? ' (wide)' : ''} (advise only)`
          : null
      )
    },
    []
  )

  const handleGate = useCallback((g: SessionGateState) => {
    setGate(g)

    // Entry permission on strategy / morning-ENTRY change (not only canPlaceEntry rising edge)
    const entryUnlocked =
      !!g.clockedIn &&
      !!g.canPlaceEntry &&
      (g.rangeStrategy === 'ib' ||
        g.rangeStrategy === 'us_range' ||
        g.rangeStrategy === 'lunch_range' ||
        (g.phase === 'ENTRY' && !g.rangeStrategy))
    prevCanPlaceRef.current = !!g.canPlaceEntry

    // Session START = cash open (live bars unlock). Session END = cash close wall-clock.
    const inst = (g.lockedInstrument && g.lockedInstrument !== 'NIKKEI'
      ? g.lockedInstrument
      : null) as DeskInstrument | null
    const fetchLive = !!g.clockedIn && !!g.canFetchLiveBars
    const pastClose =
      !!inst &&
      (g.phase === 'CLOSED' ||
        (g.phase === 'MANAGE' && isPastCashCloseNow(inst)))

    // Remount/refresh: seed prev* from current gate so we do not re-fire Telegram.
    if (!gateNotesPrimedRef.current) {
      gateNotesPrimedRef.current = true
      prevGatePhaseRef.current = g.phase
      prevFetchLiveRef.current = fetchLive
      prevPastCloseRef.current = pastClose
      if (entryUnlocked && g.lockedInstrument) {
        const windowLabel =
          g.rangeStrategy === 'us_range'
            ? 'US Range'
            : g.rangeStrategy === 'ib'
              ? 'IB'
              : g.rangeStrategy === 'lunch_range'
                ? 'Lunch-range'
                : 'Morning (OR30)'
        lastUnlockKeyRef.current = `${g.lockedInstrument}:${g.rangeStrategy ?? 'morning'}:${windowLabel}`
      }
      // Still allow regime fetch below — only Telegram rising-edges are suppressed.
    } else {
      if (entryUnlocked && g.lockedInstrument) {
        const windowLabel =
          g.rangeStrategy === 'us_range'
            ? 'US Range'
            : g.rangeStrategy === 'ib'
              ? 'IB'
              : g.rangeStrategy === 'lunch_range'
                ? 'Lunch-range'
                : 'Morning (OR30)'
        const key = `${g.lockedInstrument}:${g.rangeStrategy ?? 'morning'}:${windowLabel}`
        const claimKind = `entry_${g.rangeStrategy ?? 'morning'}`
        if (
          lastUnlockKeyRef.current !== key &&
          claimDeskNoteOnce(claimKind, g.lockedInstrument)
        ) {
          lastUnlockKeyRef.current = key
          const msg = formatEntryPermissionNote({
            instrument: g.lockedInstrument,
            windowLabel,
            ladderHint: g.attemptLadderLabel,
          })
          infoToast(`${msg.title} — ${msg.body}`, 7000)
          void fetch('/api/notify/desk-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...msg,
              instrument: g.lockedInstrument,
              dedupeKey: deskNoteClaimKey(claimKind, g.lockedInstrument),
            }),
          }).catch(() => {})
        } else if (lastUnlockKeyRef.current !== key) {
          lastUnlockKeyRef.current = key
        }
      }

      const wasFetchLive = prevFetchLiveRef.current
      prevGatePhaseRef.current = g.phase
      prevFetchLiveRef.current = fetchLive

      if (
        inst &&
        fetchLive &&
        !wasFetchLive &&
        claimDeskNoteOnce('session_start', inst)
      ) {
        const msg = formatSessionStartNote({
          instrument: inst,
          tradeify: isTradeifyGrowth50k(getDeskRiskProfile()),
        })
        infoToast(msg.title, 6000)
        void fetch('/api/notify/desk-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...msg,
            instrument: inst,
            dedupeKey: deskNoteClaimKey('session_start', inst),
          }),
        }).catch(() => {})
      }

      if (
        inst &&
        pastClose &&
        !prevPastCloseRef.current &&
        claimDeskNoteOnce('session_end', inst)
      ) {
        const msg = formatSessionEndNote({ instrument: inst })
        warningToast(msg.title, 8000)
        void fetch('/api/notify/desk-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...msg,
            instrument: inst,
            dedupeKey: deskNoteClaimKey('session_end', inst),
          }),
        }).catch(() => {})
      }
      prevPastCloseRef.current = pastClose
    }

    // Regime / recommendation is day-stable — fetch once, not every 5s gate poll
    if (regimeFetchedRef.current) return
    regimeFetchedRef.current = true
    fetch('/api/trading/today-recommendation')
      .then((r) => r.json())
      .then((j) => {
        const rec = j?.recommendation
        if (rec) setRecommendation(rec)
        const nextRegime = rec?.regime ?? j?.regime
        const nextConf = rec?.regime_confidence ?? j?.regime_confidence
        if (nextRegime === 'bullish' || nextRegime === 'bearish' || nextRegime === 'choppy') {
          setRegime(nextRegime)
        }
        if (typeof nextConf === 'number') setRegimeConfidence(nextConf)
      })
      .catch(() => {
        regimeFetchedRef.current = false
      })
  }, [])

  // Late / live desk brief — refresh while locked (stale mitigation via asOf + poll)
  useEffect(() => {
    const late =
      !!gate &&
      !gate.clockedIn &&
      !!gate.canClockIn &&
      !gate.attendedToday &&
      (gate.phase === 'ENTRY' ||
        gate.phase === 'FLAT' ||
        gate.phase === 'MANAGE' ||
        gate.phase === 'DONE')
    if (!late) {
      return
    }
    let cancelled = false
    const focus = 'NY'
    const load = (isRefresh: boolean) => {
      if (!isRefresh) setLiveBriefLoading(true)
      setLiveBriefError(null)
      fetch(`/api/trading/live-desk-brief?focus=${focus}`)
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return
          if (j?.brief) setLiveBrief(j.brief as LiveDeskBrief)
          else setLiveBriefError(j?.error || 'Brief unavailable')
        })
        .catch(() => {
          if (cancelled) return
          setLiveBriefError('Brief failed to load')
        })
        .finally(() => {
          if (!cancelled) setLiveBriefLoading(false)
        })
    }
    load(false)
    const id = window.setInterval(() => load(true), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [
    gate?.clockedIn,
    gate?.canClockIn,
    gate?.attendedToday,
    gate?.phase,
    gate?.market,
  ])

  // Finnhub high-impact calendar → soft Leo/Telegram warns (clock-in digest + T−60 / T−15)
  useEffect(() => {
    const inst = (gate?.lockedInstrument || instrument) as
      | 'DOW'
      | 'NASDAQ'
      | 'NIKKEI'
      | null
    if (!gate?.clockedIn || !inst) return

    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/trading/desk-news?window=24&desk=${inst}&session=0&calendarOnly=1&_=${Date.now()}`,
          { cache: 'no-store' }
        )
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean
          calendar?: DeskCalendarEvent[]
        } | null
        if (cancelled || !json?.ok || !Array.isArray(json.calendar)) return

        const hazards = buildDeskNewsHazards({
          calendar: json.calendar,
          instrument: inst,
          includeUpcomingDay: true,
        })

        if (claimDeskNoteOnce('news_day_digest', inst)) {
          const digest = formatDayNewsDigest(hazards, inst)
          if (digest) {
            infoToast(`${digest.title} — ${digest.body}`, 9000)
            void fetch('/api/notify/desk-alert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind: 'news_day_digest',
                title: digest.title,
                body: digest.body,
                telegram: digest.telegram,
                instrument: inst,
                dedupeKey: deskNoteClaimKey('news_day_digest', inst),
              }),
            }).catch(() => {})
          }
        }

        for (const h of hazards) {
          const safeId = h.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
          if (h.level === 'careful' && claimDeskNoteOnce(`news_t60_${safeId}`, inst)) {
            warningToast(`${h.title} — ${h.body}`, 8000)
            void fetch('/api/notify/desk-alert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind: 'news_careful',
                title: h.title,
                body: h.body,
                telegram: `${h.title}\n${h.body}`,
                instrument: inst,
                dedupeKey: deskNoteClaimKey(`news_t60_${safeId}`, inst),
              }),
            }).catch(() => {})
          }
          if (h.level === 'stand_aside' && claimDeskNoteOnce(`news_t15_${safeId}`, inst)) {
            warningToast(`${h.title} — ${h.body}`, 10000)
            void fetch('/api/notify/desk-alert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind: 'news_stand_aside',
                title: h.title,
                body: h.body,
                telegram: `${h.title}\n${h.body}`,
                instrument: inst,
                dedupeKey: deskNoteClaimKey(`news_t15_${safeId}`, inst),
              }),
            }).catch(() => {})
          }
        }
      } catch {
        /* soft-fail */
      }
    }

    void poll()
    const id = window.setInterval(poll, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [gate?.clockedIn, gate?.lockedInstrument, instrument])

  const enterManage = useCallback(
    (order: FilledOrder, inst: string) => {
      positionExitHandledRef.current = false
      const dir = order.entry_direction === 'LONG' ? 'long' : 'short'
      setPending(null)
      pendingRef.current = null
      setFillError(null)
      setBracketAdjustStatus(null)
      setBracketAdjustError(null)
      setOrderStatus('filled')
      const overlay: PositionOverlay = {
        entryPrice: order.entry_price,
        stopLoss: order.stop_loss_price,
        profitTarget: order.profit_target_price,
        direction: dir,
        positionSize: order.position_size,
      }
      confirmedOverlayRef.current = overlay
      setPositionOverlay(overlay)
      setManagePos({
        id: order.position_id,
        instrument: inst,
        entryPrice: order.entry_price,
        stopLoss: order.stop_loss_price,
        profitTarget: order.profit_target_price,
        direction: dir,
        positionSize: order.position_size,
        riskAmount: order.risk_amount,
        entryTimestamp: new Date().toISOString(),
      })
      refreshGate()
    },
    [refreshGate]
  )

  const adjustBrackets = useCallback(
    async (update: { stopLoss?: number; profitTarget?: number }) => {
      const pos = managePos
      if (!pos) return
      const prev = confirmedOverlayRef.current
      bracketSavingRef.current = true
      setBracketAdjustStatus('saving')
      setBracketAdjustError(null)

      setPositionOverlay((cur) => {
        if (!cur) return cur
        return {
          ...cur,
          stopLoss: update.stopLoss ?? cur.stopLoss,
          profitTarget: update.profitTarget ?? cur.profitTarget,
        }
      })

      const applyConfirmed = (nextSl: number, nextTp: number) => {
        const nextOverlay: PositionOverlay = {
          entryPrice: pos.entryPrice,
          stopLoss: nextSl,
          profitTarget: nextTp,
          direction: pos.direction,
          positionSize: pos.positionSize,
        }
        confirmedOverlayRef.current = nextOverlay
        setPositionOverlay(nextOverlay)
        setManagePos((m) =>
          m
            ? {
                ...m,
                stopLoss: nextSl,
                profitTarget: nextTp,
              }
            : m
        )
      }

      try {
        const res = await fetch('/api/trading/positions/update-brackets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_id: pos.id,
            ...(update.stopLoss != null ? { stop_loss_price: update.stopLoss } : {}),
            ...(update.profitTarget != null
              ? { profit_target_price: update.profitTarget }
              : {}),
          }),
        })
        const json = (await res.json()) as {
          ok?: boolean
          partial?: boolean
          error?: string
          stop_loss_price?: number
          profit_target_price?: number | null
        }

        const hasServerSl =
          json.stop_loss_price != null && Number.isFinite(Number(json.stop_loss_price))
        const hasServerTp =
          json.profit_target_price != null &&
          Number.isFinite(Number(json.profit_target_price))

        if (hasServerSl || hasServerTp) {
          applyConfirmed(
            hasServerSl ? Number(json.stop_loss_price) : (prev?.stopLoss ?? pos.stopLoss),
            hasServerTp
              ? Number(json.profit_target_price)
              : (prev?.profitTarget ?? pos.profitTarget)
          )
        }

        if (json.ok && res.ok) {
          if (!hasServerSl && !hasServerTp) {
            applyConfirmed(
              update.stopLoss ?? pos.stopLoss,
              update.profitTarget ?? pos.profitTarget
            )
          }
          setBracketAdjustStatus('idle')
          setBracketAdjustError(null)
          return
        }

        // Partial broker success: keep server prices, surface warning
        if (json.partial && (hasServerSl || hasServerTp)) {
          setBracketAdjustStatus('error')
          const msg = json.error || 'Partial bracket update'
          setBracketAdjustError(msg)
          setFillError(msg)
          return
        }

        // Full failure — revert to last confirmed
        if (prev) {
          confirmedOverlayRef.current = prev
          setPositionOverlay(prev)
        }
        const msg = json.error || 'Bracket update failed'
        setBracketAdjustStatus('error')
        setBracketAdjustError(msg)
        setFillError(msg)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Bracket update failed'
        if (prev) {
          confirmedOverlayRef.current = prev
          setPositionOverlay(prev)
        }
        setBracketAdjustStatus('error')
        setBracketAdjustError(msg)
        setFillError(msg)
      } finally {
        bracketSavingRef.current = false
      }
    },
    [managePos]
  )

  const adjustWorkingBrackets = useCallback(
    async (update: { profitTarget?: number }) => {
      const pend = pendingRef.current
      if (!pend?.workingId || update.profitTarget == null) return
      workingBracketSavingRef.current = true
      setWorkingBracketAdjustStatus('saving')
      setWorkingBracketAdjustError(null)

      const nextPending = { ...pend, profitTarget: update.profitTarget }
      pendingRef.current = nextPending
      setPending(nextPending)

      try {
        const res = await fetch('/api/trading/positions/update-working-brackets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            working_id: pend.workingId,
            profit_target_price: update.profitTarget,
          }),
        })
        const json = (await res.json()) as {
          ok?: boolean
          error?: string
          sl_locked?: boolean
          profit_target_price?: number
        }

        if (res.ok && json.ok) {
          const tp =
            json.profit_target_price != null && Number.isFinite(Number(json.profit_target_price))
              ? Number(json.profit_target_price)
              : update.profitTarget
          const confirmed = { ...nextPending, profitTarget: tp }
          pendingRef.current = confirmed
          setPending(confirmed)
          setWorkingBracketAdjustStatus('idle')
          setWorkingBracketAdjustError(null)
          return
        }

        pendingRef.current = pend
        setPending(pend)
        const msg = json.error || 'Take profit update failed'
        setWorkingBracketAdjustStatus('error')
        setWorkingBracketAdjustError(msg)
        setFillError(msg)
      } catch (err) {
        pendingRef.current = pend
        setPending(pend)
        const msg = err instanceof Error ? err.message : 'Take profit update failed'
        setWorkingBracketAdjustStatus('error')
        setWorkingBracketAdjustError(msg)
        setFillError(msg)
      } finally {
        workingBracketSavingRef.current = false
      }
    },
    []
  )

  const cancelWorkingLimit = useCallback(
    async (inst: Instrument) => {
      try {
        await fetch('/api/trading/positions/cancel-working', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instrument: inst }),
        })
      } catch {
        /* non-fatal — local state already cleared */
      }
    },
    []
  )

  /** Paint durable working limit from server (refresh, 409, or instrument switch). */
  const applyWorkingFromServer = useCallback(
    (row: WorkingLimitRow, opts?: { notifyBlocked?: boolean; force?: boolean }) => {
      if (!opts?.force && (managePos || placingOrderRef.current)) return
      const order = workingRowToPending(row) as PendingLimitOrder
      pendingRef.current = order
      setPending(order)
      setOrderStatus('working')
      if (opts?.notifyBlocked) {
        setFillError(
          formatWorkingLimitAlreadyMessage({
            instrument: order.instrument,
            direction: order.direction,
            level: order.level,
          })
        )
      } else {
        setFillError(null)
      }
      if (order.instrument !== instrument) {
        setInstrument(order.instrument)
      }
      window.setTimeout(() => jumpToPriceRef.current?.(order.level), 150)
    },
    [managePos, instrument, setInstrument]
  )

  // Hydrate working limit overlay from DB on load / gate refresh (survives tab reload)
  useEffect(() => {
    if (managePos || placingOrderRef.current) return
    if (pendingRef.current && orderStatus === 'working') return
    if (gate?.phase === 'MANAGE') return

    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(
          `/api/trading/positions/working?instrument=${encodeURIComponent(instrument)}`,
          { cache: 'no-store' }
        )
        if (!res.ok || cancelled) return
        const json = (await res.json()) as { working?: WorkingLimitRow | null }
        if (cancelled || !json.working) return
        if (managePos || placingOrderRef.current) return
        applyWorkingFromServer(json.working)
      } catch {
        /* soft-fail */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [gateTick, gate?.phase, managePos, instrument, orderStatus, applyWorkingFromServer])

  /** Open the journal position only after the working limit fills. */
  const fillPending = useCallback(
    async (pend: PendingLimitOrder, fillPrice: number) => {
      if (fillingRef.current) return
      fillingRef.current = true
      const gen = orderGenRef.current
      setFillError(null)
      setOrderStatus('placing')
      try {
        const res = await fetch('/api/trading/positions/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instrument: pend.instrument,
            entry_price: fillPrice,
            entry_direction: pend.direction,
            entry_window: pend.entryWindow,
            account_size: pend.accountSize,
            regime: pend.regime,
            regime_confidence: pend.regimeConfidence,
            best_break_level: pend.level,
            entry_source: pend.entrySource || 'ai',
            stop_loss_price: pend.stopLoss,
            profit_target_price: pend.profitTarget,
            entry_reason:
              pend.entryReason ||
              `${pend.direction} working limit filled at liquidity level ${pend.level.toLocaleString()} (${pend.levelType || 'desk level'})`,
            range_high: pend.strategyRange?.high,
            range_low: pend.strategyRange?.low,
            range_label: pend.strategyRange?.label,
            risk_profile: pend.riskProfile ?? 'oanda_cash',
          }),
        })
        const json = await res.json()
        if (gen !== orderGenRef.current) {
          // Cancelled while in flight — if broker+journal succeeded, still manage the open risk
          if (res.ok && json.success) {
            setOrderStatus('filled')
            setPending(null)
            pendingRef.current = null
            enterManage(
              {
                position_id: json.position_id,
                entry_price: json.entry_price ?? fillPrice,
                stop_loss_price: json.stop_loss_price ?? pend.stopLoss,
                position_size: json.position_size ?? pend.positionSize,
                risk_amount: json.risk_amount ?? pend.riskAmount,
                entry_direction: pend.direction,
                profit_target_price: pend.profitTarget,
                entry_source: pend.entrySource,
              },
              pend.instrument
            )
          }
          return
        }
        if (!res.ok || !json.success) {
          setOrderStatus('rejected')
          setFillError(json.message || 'Fill rejected')
          pendingRef.current = null
          setPending(null)
          void cancelWorkingLimit(pend.instrument as Instrument)
          return
        }
        setOrderStatus('filled')
        setPending(null)
        pendingRef.current = null
        enterManage(
          {
            position_id: json.position_id,
            entry_price: json.entry_price ?? fillPrice,
            stop_loss_price: json.stop_loss_price ?? pend.stopLoss,
            position_size: json.position_size ?? pend.positionSize,
            risk_amount: json.risk_amount ?? pend.riskAmount,
            entry_direction: pend.direction,
            profit_target_price: pend.profitTarget,
            entry_source: pend.entrySource,
          },
          pend.instrument
        )
      } catch (e) {
        if (gen === orderGenRef.current) {
          setOrderStatus('rejected')
          setFillError(e instanceof Error ? e.message : 'Fill failed')
          pendingRef.current = null
          setPending(null)
          void cancelWorkingLimit(pend.instrument as Instrument)
        }
      } finally {
        fillingRef.current = false
      }
    },
    [enterManage, cancelWorkingLimit]
  )

  const persistWorking = useCallback(async (order: PendingLimitOrder) => {
    const gen = orderGenRef.current
    try {
      const res = await fetch('/api/trading/positions/working', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument: order.instrument,
          level: order.level,
          direction: order.direction,
          entry_direction: order.direction,
          stop_loss_price: order.stopLoss,
          profit_target_price: order.profitTarget,
          position_size: order.positionSize,
          risk_amount: order.riskAmount,
          account_size: order.accountSize,
          entry_window: order.entryWindow,
          regime: order.regime,
          regime_confidence: order.regimeConfidence,
          entry_reason: order.entryReason,
          entry_source: order.entrySource,
          range_high: order.strategyRange?.high,
          range_low: order.strategyRange?.low,
          range_label: order.strategyRange?.label,
          risk_profile: order.riskProfile ?? 'oanda_cash',
        }),
      })
      if (gen !== orderGenRef.current) return
      if (res.ok) {
        const j = (await res.json().catch(() => ({}))) as { working_id?: string }
        if (j.working_id && pendingRef.current) {
          const withId = { ...pendingRef.current, workingId: j.working_id }
          pendingRef.current = withId
          setPending(withId)
        }
        return
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string
          working?: WorkingLimitRow
          existing_instrument?: string
          existing_level?: number
          existing_direction?: string
        }
        if (res.status === 409 && j.working) {
          applyWorkingFromServer(j.working, { notifyBlocked: true })
          return
        }
        if (res.status === 409 && j.existing_instrument && j.existing_level != null) {
          applyWorkingFromServer(
            {
              instrument: j.existing_instrument,
              entry_price: Number(j.existing_level),
              entry_direction: j.existing_direction || 'LONG',
            },
            { notifyBlocked: true }
          )
          return
        }
        setOrderStatus('rejected')
        setFillError(j.error || 'Working limit rejected by server')
        pendingRef.current = null
        setPending(null)
      }
    } catch {
      if (gen !== orderGenRef.current) return
      setOrderStatus('rejected')
      setFillError('Working limit failed to persist — cleared')
      pendingRef.current = null
      setPending(null)
    }
  }, [applyWorkingFromServer])

  const expireWorkingLimits = useCallback(
    async (opts?: { forceExpireWorking?: boolean; forceCashClose?: boolean }) => {
      try {
        await fetch('/api/trading/positions/cleanup-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            force_expire_working: !!opts?.forceExpireWorking,
            force_cash_close: !!opts?.forceCashClose,
          }),
        })
      } catch {
        /* non-fatal */
      }
    },
    []
  )

  const handlePlaced = useCallback(
    (order: PendingLimitOrder) => {
      if (placingOrderRef.current || pendingRef.current || managePos) {
        if (pendingRef.current) {
          setFillError(WORKING_LIMIT_ALREADY_MESSAGE)
          setOrderStatus('rejected')
        }
        return
      }
      const denied = rangeAwareEntryDeniedMessage(
        gate,
        order.instrument,
        (order.strategyRange ?? orderStrategyRange)?.label
      )
      if (denied) {
        setFillError(denied)
        setOrderStatus('rejected')
        setOrderLevel(null)
        setOrderLevelType(undefined)
        return
      }
      const edge = assertRangeEdgeEntry({
        entry: order.level,
        range: order.strategyRange ?? orderStrategyRange,
      })
      if (!edge.ok) {
        setFillError(edge.message)
        setOrderStatus('rejected')
        setOrderLevel(null)
        setOrderLevelType(undefined)
        return
      }
      // Attach range onto order for API if missing
      const orderWithRange: PendingLimitOrder = {
        ...order,
        strategyRange: order.strategyRange ?? orderStrategyRange ?? null,
      }
      placingOrderRef.current = true
      setOrderStatus('placing')
      setOrderLevel(null)
      setOrderLevelType(undefined)
      setOrderLevelSide(undefined)
      setOrderPreferredDirection(undefined)
      setOrderLevelReason(undefined)
      setOrderEntrySource('ai')
      setOrderStrategyRange(null)
      setOrderStrategyMagnets(null)
      setOrderPresetStopLoss(null)
      setOrderPresetProfitTarget(null)
      setOrderAutoConfirm(false)
      setFillError(null)

      const px = livePriceRef.current
      // Limit-only desk: if price already through the limit, fill immediately; else work it
      if (
        px != null &&
        limitWouldFill(orderWithRange.direction, orderWithRange.level, px)
      ) {
        pendingRef.current = orderWithRange
        setPending(orderWithRange)
        void fillPending(orderWithRange, orderWithRange.level).finally(() => {
          placingOrderRef.current = false
        })
        return
      }

      // Optimistic WORKING — paint lines before network
      pendingRef.current = orderWithRange
      setPending(orderWithRange)
      setOrderStatus('working')
      placingOrderRef.current = false
      void persistWorking(orderWithRange)
    },
    [fillPending, persistWorking, managePos, gate, orderStrategyRange]
  )
  handlePlacedRef.current = handlePlaced

  // Watch live quotes — fill only durable WORKING limits (not placing/rejected)
  useEffect(() => {
    if (!pending || managePos || livePrice == null) return
    if (orderStatus !== 'working') return
    if (
      !quoteBelongsToBook({
        instrument: pending.instrument,
        entry: pending.level,
        quote: livePrice,
      })
    ) {
      return
    }
    if (!limitWouldFill(pending.direction, pending.level, livePrice)) return
    void fillPending(pending, pending.level)
  }, [livePrice, pending, managePos, fillPending, orderStatus])

  // Cancel unfilled working limits only on intentional gate rules — NEVER on refresh/remount.
  // Refresh: hadClockedIn is null → clocked-out alone keeps the book so hydrate can re-paint.
  useEffect(() => {
    if (!gate) return
    const action = shouldCancelWorkingForGate({
      phase: gate.phase,
      clockedIn: !!gate.clockedIn,
      hadClockedIn: hadClockedInRef.current,
      hasPending: !!pending,
    })
    // Seed / update after the decision so first observation cannot look like a clock-out.
    hadClockedInRef.current = !!gate.clockedIn

    if (action !== 'keep' && pending) {
      const inst = (pending.instrument || gate.lockedInstrument || instrument) as Instrument
      orderGenRef.current += 1
      pendingRef.current = null
      setPending(null)
      setOrderStatus('idle')
      setFillError(workingLimitCancelledMessage(gate))
      if (action === 'cancel') {
        void cancelWorkingLimit(inst)
      }
    }

    const phaseBlocks =
      gate.phase === 'FLAT' || gate.phase === 'DONE' || gate.phase === 'CLOSED'
    if (!phaseBlocks) return

    // Reload levels when strategy window changes (morning → IB → lunch-break → lunch-range)
    if (gate.phase === 'DONE') {
      void expireWorkingLimits({ forceExpireWorking: true, forceCashClose: false })
    } else if (gate.phase === 'CLOSED') {
      void expireWorkingLimits({ forceExpireWorking: true, forceCashClose: true })
    }
    if (
      gate.phase === 'DONE' ||
      gate.phase === 'FLAT' ||
      gate.rangeStrategy === 'ib' ||
      gate.rangeStrategy === 'us_range' ||
      gate.rangeStrategy === 'lunch_range'
    ) {
      if (!afternoonLevelsLoadedRef.current || gate.rangeStrategy) {
        afternoonLevelsLoadedRef.current = true
        setLevelsRefreshKey((k) => k + 1)
      }
    }
  }, [
    gate?.phase,
    gate?.rangeStrategy,
    gate?.lockedInstrument,
    gate?.clockedIn,
    pending,
    expireWorkingLimits,
    cancelWorkingLimit,
    instrument,
  ])

  // Bump levels paint when IB / lunch-range strategy unlocks (ENTRY phase too)
  const lastPlaybookStratRef = useRef<string | null>(null)
  useEffect(() => {
    const key = `${gate?.rangeStrategy ?? 'none'}:${gate?.phase ?? ''}`
    if (!gate?.clockedIn) return
    if (lastPlaybookStratRef.current === key) return
    if (
      gate.rangeStrategy === 'ib' ||
      gate.rangeStrategy === 'us_range' ||
      gate.rangeStrategy === 'lunch_range' ||
      gate.phase === 'FLAT' ||
      gate.phase === 'DONE'
    ) {
      lastPlaybookStratRef.current = key
      setLevelsRefreshKey((k) => k + 1)
    }
  }, [gate?.rangeStrategy, gate?.phase, gate?.clockedIn])

  // Past morning lunch with a morning/IB open book → confirm close (not lunch-range fills)
  useEffect(() => {
    if (!managePos) {
      setLunchFlatPrompt(false)
      return
    }
    const inst = managePos.instrument as Instrument
    if (!isAfternoonWatchWindow(new Date(), inst)) {
      setLunchFlatPrompt(false)
      return
    }
    if (!isMorningOrIbEntry(inst, managePos.entryTimestamp)) {
      setLunchFlatPrompt(false)
      return
    }
    const tradeifyOn = isTradeifyGrowth50k(getDeskRiskProfile())
    if (tradeifyOn && tradeifyFlattenOverridesKeepOpen()) {
      setLunchFlatPrompt(false)
      void expireWorkingLimits({ forceExpireWorking: true, forceCashClose: true })
      return
    }
    if (hasLunchFlatKeepOpen(liveLunchFlatKeepOpenKey(managePos.id))) {
      setLunchFlatPrompt(false)
      return
    }
    setLunchFlatPrompt(true)
  }, [managePos, gateTick, expireWorkingLimits])

  // Cash close + Tradeify 16:59 flatten (beats keep-open / Nikkei 02:00 hold)
  useEffect(() => {
    if (!managePos) return
    const inst = managePos.instrument as Instrument
    const tick = () => {
      const tradeifyOn = isTradeifyGrowth50k(getDeskRiskProfile())
      if (tradeifyOn && tradeifyMustFlatten()) {
        void expireWorkingLimits({ forceExpireWorking: true, forceCashClose: true })
        return
      }
      if (isPastCashCloseNow(inst)) {
        void expireWorkingLimits({ forceExpireWorking: true, forceCashClose: true })
      }
    }
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [managePos, expireWorkingLimits])

  const confirmLunchFlatClose = useCallback(async () => {
    if (!managePos || lunchFlatBusy) return
    setLunchFlatBusy(true)
    try {
      const px = livePriceRef.current ?? managePos.entryPrice
      const res = await fetch('/api/trading/positions/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: managePos.id,
          instrument: managePos.instrument,
          exit_price: px,
          exit_reason: 'manual',
          exit_notes: 'Confirmed close after morning lunch (trader confirm — not auto flatten)',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setFillError(j.message || j.error || 'Close failed')
        return
      }
      clearLunchFlatKeepOpen(liveLunchFlatKeepOpenKey(managePos.id))
      setLunchFlatPrompt(false)
      setManagePos(null)
      setPositionOverlay(null)
      confirmedOverlayRef.current = null
      setAiVerdict(null)
      refreshGate()
      void refreshLevelsAfterExit('manual')
    } catch {
      setFillError('Close failed — try Manage desk')
    } finally {
      setLunchFlatBusy(false)
    }
  }, [managePos, lunchFlatBusy, refreshGate, refreshLevelsAfterExit])

  // Load / reconcile open position — refresh UI when broker or journal goes flat
  useEffect(() => {
    if (!managePos && gate?.phase !== 'MANAGE') {
      if (gate?.phase !== 'ENTRY' && gate?.phase !== 'FLAT' && !pending) {
        setManagePos(null)
        setPositionOverlay(null)
      }
      return
    }

    const inst = managePos?.instrument || gate?.lockedInstrument || instrument
    let cancelled = false

    const load = async () => {
      try {
        let res = await fetch(
          `/api/trading/current-position?instrument=${encodeURIComponent(inst)}&reconcile=1&_=${Date.now()}`,
          { cache: 'no-store' }
        )
        let json = res.ok ? await res.json() : null
        if (!json?.position && managePos) {
          res = await fetch(
            `/api/trading/current-position?any=1&reconcile=1&_=${Date.now()}`,
            { cache: 'no-store' }
          )
          json = res.ok ? await res.json() : null
        }
        if (cancelled || !json) return

        if (json.reconciled?.closed) {
          handleBrokerExit({
            exitReason: json.reconciled.exit_reason,
            exitPrice: json.reconciled.exit_price,
          })
          return
        }

        if (!json.position) {
          if (managePos && !positionExitHandledRef.current) {
            // Confirm against Live Positions SoT + working — never false-close on null alone
            let hasFilledOpen = false
            let hasWorkingLimit = false
            try {
              const [statusRes, workingRes] = await Promise.all([
                fetch(
                  `/api/trading/positions/management-status?instrument=${encodeURIComponent(managePos.instrument)}`,
                  { cache: 'no-store' }
                ),
                fetch(
                  `/api/trading/positions/working?instrument=${encodeURIComponent(managePos.instrument)}`,
                  { cache: 'no-store' }
                ),
              ])
              if (statusRes.ok) {
                const statusJson = (await statusRes.json()) as {
                  success?: boolean
                  position?: {
                    id: string
                    instrument: string
                    entry_price: number
                    stop_loss_price: number
                    profit_target_price?: number | null
                    entry_direction?: string
                    position_size: number
                    risk_amount: number
                    entry_timestamp?: string | null
                  } | null
                }
                if (statusJson.success && statusJson.position) {
                  hasFilledOpen = true
                  const p = statusJson.position
                  const dir =
                    String(p.entry_direction || '').toUpperCase() === 'LONG' ? 'long' : 'short'
                  const target =
                    p.profit_target_price ??
                    (dir === 'long' ? p.entry_price * 1.01 : p.entry_price * 0.99)
                  const manage: ManagePosition = {
                    id: p.id,
                    instrument: p.instrument,
                    entryPrice: p.entry_price,
                    stopLoss: p.stop_loss_price,
                    profitTarget: target,
                    direction: dir,
                    positionSize: p.position_size,
                    riskAmount: p.risk_amount,
                    entryTimestamp: p.entry_timestamp ?? null,
                  }
                  setManagePos(manage)
                  const overlay = {
                    entryPrice: manage.entryPrice,
                    stopLoss: manage.stopLoss,
                    profitTarget: manage.profitTarget,
                    direction: manage.direction,
                    positionSize: manage.positionSize,
                  }
                  confirmedOverlayRef.current = overlay
                  setPositionOverlay(overlay)
                }
              }
              if (workingRes.ok) {
                const workingJson = (await workingRes.json()) as {
                  working?: WorkingLimitRow | null
                }
                if (workingJson.working) {
                  hasWorkingLimit = true
                  setManagePos(null)
                  setPositionOverlay(null)
                  confirmedOverlayRef.current = null
                  applyWorkingFromServer(workingJson.working, { force: true })
                }
              }
            } catch {
              /* keep local UI on confirm failure */
            }
            if (
              shouldClearChartAsClosed({
                reconciledClosed: false,
                hasFilledOpen,
                hasWorkingLimit,
              })
            ) {
              handleBrokerExit({
                exitReason: 'manual',
                exitPrice: livePriceRef.current ?? managePos.entryPrice,
              })
            }
          }
          return
        }

        if (bracketSavingRef.current) return
        const p = json.position
        const dir =
          String(p.entry_direction || '').toUpperCase() === 'LONG' ? 'long' : 'short'
        const target =
          p.profit_target_price ??
          (dir === 'long' ? p.entry_price * 1.01 : p.entry_price * 0.99)
        const manage: ManagePosition = {
          id: p.id,
          instrument: p.instrument,
          entryPrice: p.entry_price,
          stopLoss: p.stop_loss_price,
          profitTarget: target,
          direction: dir,
          positionSize: p.position_size,
          riskAmount: p.risk_amount,
          entryTimestamp: p.entry_timestamp ?? null,
        }
        setManagePos(manage)
        const overlay = {
          entryPrice: manage.entryPrice,
          stopLoss: manage.stopLoss,
          profitTarget: manage.profitTarget,
          direction: manage.direction,
          positionSize: manage.positionSize,
        }
        confirmedOverlayRef.current = overlay
        setPositionOverlay(overlay)
        if (pending) {
          pendingRef.current = null
          setPending(null)
        }
      } catch {
        /* keep */
      }
    }

    void load()
    const pollMs = managePos || gate?.phase === 'MANAGE' ? 4000 : 15000
    const id = setInterval(load, pollMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [
    managePos,
    gate?.phase,
    gate?.lockedInstrument,
    gate?.open_position_id,
    instrument,
    gateTick,
    pending,
    clearPositionUi,
    handleBrokerExit,
    applyWorkingFromServer,
  ])

  // Quote-driven reconcile while in trade (catch broker SL/TP between polls)
  useEffect(() => {
    if (!managePos || livePrice == null) return
    let cancelled = false
    const t = window.setTimeout(async () => {
      if (cancelled) return
      try {
        const res = await fetch(
          `/api/trading/current-position?instrument=${encodeURIComponent(managePos.instrument)}&reconcile=1&_=${Date.now()}`,
          { cache: 'no-store' }
        )
        if (!res.ok || cancelled) return
        const json = await res.json()
        if (json.reconciled?.closed) {
          handleBrokerExit({
            exitReason: json.reconciled.exit_reason,
            exitPrice: json.reconciled.exit_price,
          })
          return
        }
        if (!json.position && managePos && !positionExitHandledRef.current) {
          let hasFilledOpen = false
          let hasWorkingLimit = false
          try {
            const [statusRes, workingRes] = await Promise.all([
              fetch(
                `/api/trading/positions/management-status?instrument=${encodeURIComponent(managePos.instrument)}`,
                { cache: 'no-store' }
              ),
              fetch(
                `/api/trading/positions/working?instrument=${encodeURIComponent(managePos.instrument)}`,
                { cache: 'no-store' }
              ),
            ])
            if (statusRes.ok) {
              const statusJson = (await statusRes.json()) as {
                success?: boolean
                position?: unknown
              }
              if (statusJson.success && statusJson.position) hasFilledOpen = true
            }
            if (workingRes.ok) {
              const workingJson = (await workingRes.json()) as { working?: unknown }
              if (workingJson.working) hasWorkingLimit = true
            }
          } catch {
            /* keep */
          }
          if (cancelled) return
          if (
            shouldClearChartAsClosed({
              reconciledClosed: false,
              hasFilledOpen,
              hasWorkingLimit,
            })
          ) {
            handleBrokerExit({
              exitReason: 'manual',
              exitPrice: livePriceRef.current ?? managePos.entryPrice,
            })
          }
        }
      } catch {
        /* soft-fail */
      }
    }, 800)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [livePrice, managePos, handleBrokerExit])

  const locked = gate?.lockedInstrument ?? null
  const suggested =
    gate?.suggestedInstrument ?? recommendation?.instrument ?? null
  const clockedIn = !!gate?.clockedIn
  const attendedToday = !!gate?.attendedToday
  // Never clocked in today → lock for the cash session AFTER open (or missed).
  // Pre-open NY dual browse (canViewLiveChart) keeps the chart visible with both tabs.
  const chartLocked =
    gate != null &&
    !clockedIn &&
    !gate.canViewLiveChart &&
    (!!gate.canClockIn ||
      (!attendedToday &&
        (gate.phase === 'PREP' ||
          gate.phase === 'RECOMMENDED' ||
          gate.phase === 'ENTRY' ||
          gate.phase === 'FLAT' ||
          gate.phase === 'MANAGE' ||
          gate.phase === 'DONE')))
  /** Late join after cash open — show ranked brief + clock-in (not “session skipped”). */
  const lateJoinLocked =
    chartLocked &&
    !!gate?.canClockIn &&
    !attendedToday &&
    (gate.phase === 'ENTRY' ||
      gate.phase === 'FLAT' ||
      gate.phase === 'MANAGE' ||
      gate.phase === 'DONE')
  const missedSessionLocked =
    chartLocked &&
    !attendedToday &&
    !gate?.canClockIn &&
    (gate?.phase === 'DONE' || gate?.phase === 'FLAT')
  const showPreOpenClockIn =
    !clockedIn &&
    !!gate?.canViewLiveChart &&
    !!gate?.canClockIn &&
    gate.market === 'NY'
  const inManage = gate?.phase === 'MANAGE' || !!managePos
  const inEntry = gate?.phase === 'ENTRY' && !!gate?.canPlaceEntry
  const callModeChosen = gate?.useCall === true || gate?.useCall === false
  const canTrade = inEntry && !pending && !managePos && clockedIn && callModeChosen
  const inWorking = !!pending && !managePos
  // Playbook/levels only for the desk you clocked into — not on browse tabs after close
  const deskLevelsActive =
    !!gate &&
    gate.phase !== 'CLOSED' &&
    (clockedIn || attendedToday) &&
    (!gate.allowedInstruments || gate.allowedInstruments.includes(instrument))
  const deskAttended = clockedIn || attendedToday

  return (
    <div className="flex h-screen w-screen overflow-hidden relative flex-col bg-[#0d1117]">
      <div className="px-2 pt-1 pb-0.5 shrink-0 z-20">
        <SessionBanner
          onGate={handleGate}
          refreshKey={gateTick}
          lastQuoteAt={lastQuoteAt}
          dataMode={dataMode}
          viewingInstrument={instrument}
          onRefreshReady={(fn) => {
            bannerRefreshRef.current = fn
          }}
        />
      </div>

      <div className="flex-1 w-full h-full min-h-0 min-w-0 relative p-1 flex flex-col gap-1">
        {(inWorking && pending) || orderStatus === 'rejected' || orderStatus === 'placing' ? (
          <div
            className={`absolute bottom-14 left-4 z-30 flex items-center gap-3 rounded-lg border px-3 py-1.5 text-xs shadow-xl backdrop-blur-md ${
              orderStatus === 'rejected'
                ? 'border-red-700/50 bg-red-950/90 text-red-100'
                : 'border-sky-700/50 bg-sky-950/90 text-sky-100'
            }`}
          >
            <span className="font-semibold uppercase tracking-wide">
              {orderStatus === 'placing'
                ? 'Placing'
                : orderStatus === 'rejected'
                  ? 'Rejected'
                  : orderStatus === 'filled'
                    ? 'Filled'
                    : 'Working'}
            </span>
            {pending && (
              <>
                <span className="price-mono">
                  {pending.direction} @ {pending.level.toLocaleString()}
                </span>
                <span className="opacity-80">
                  SL {pending.stopLoss.toLocaleString()}{' '}
                  <span className="text-amber-300/90">(locked — sized at place)</span>
                  · TP {pending.profitTarget.toLocaleString()}{' '}
                  <span className="text-emerald-300/80">(drag on chart)</span>
                </span>
              </>
            )}
            {pending && livePrice != null && orderStatus === 'working' && (
              <span className="text-gray-400">
                last {livePrice.toLocaleString()} ·{' '}
                {pending.direction === 'LONG'
                  ? livePrice > pending.level
                    ? 'waiting for price ≤ limit'
                    : 'at/through limit…'
                  : livePrice < pending.level
                    ? 'waiting for price ≥ limit'
                    : 'at/through limit…'}
              </span>
            )}
            {pending && (
              <button
                type="button"
                onClick={() => {
                  const inst = pending.instrument
                  orderGenRef.current += 1
                  pendingRef.current = null
                  setPending(null)
                  setFillError(null)
                  setOrderStatus('idle')
                  void cancelWorkingLimit(asLiveNy(inst))
                }}
                className="ml-auto rounded border border-sky-600/50 px-2 py-1 text-[10px] font-semibold uppercase text-sky-200 hover:bg-sky-900/50"
              >
                Cancel
              </button>
            )}
          </div>
        ) : null}

        {isTradeifyGrowth50k(riskProfile) &&
          pending &&
          !managePos &&
          pending.instrument !== 'NIKKEI' && (
          <TradovateMirrorCard
            instrument={pending.instrument}
            direction={pending.direction}
            entry={pending.level}
            stop={pending.stopLoss}
            target={pending.profitTarget}
            riskDollars={pending.riskAmount}
            bookId={pending.workingId}
            accountName={tradeifyAccountName}
            phase="working"
          />
        )}
        {isTradeifyGrowth50k(riskProfile) &&
          managePos &&
          (managePos.instrument || instrument) !== 'NIKKEI' && (
          <TradovateMirrorCard
            instrument={(managePos.instrument || instrument) as 'DOW' | 'NASDAQ' | 'NIKKEI'}
            direction={
              String(managePos.direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'
            }
            entry={managePos.entryPrice}
            stop={managePos.stopLoss}
            target={managePos.profitTarget}
            riskDollars={
              (managePos.riskAmount ?? 0) > 0
                ? managePos.riskAmount
                : lastTradeifyRiskRef.current
            }
            bookId={managePos.id}
            accountName={tradeifyAccountName}
            phase="filled"
          />
        )}

        {fillError && (
          <p className="absolute bottom-14 left-4 z-30 px-2.5 py-1 text-xs text-red-300 bg-red-950/90 rounded border border-red-700/60 shadow-lg backdrop-blur-md">
            {fillError}
          </p>
        )}

        {inManage && managePos && (
          <div className="absolute bottom-14 left-3 z-30 pointer-events-auto">
            <ManageDeskBar
              position={managePos}
              currentPrice={
                livePrice != null &&
                quoteBelongsToBook({
                  instrument: managePos.instrument,
                  entry: managePos.entryPrice,
                  quote: livePrice,
                })
                  ? livePrice
                  : null
              }
              atrAdviceLine={rangeAtrAdvice}
              onClosed={(exitReason = 'manual') => {
                positionExitHandledRef.current = true
                if (exitReason === 'stop_hit') {
                  warningToast(
                    `Stop loss hit @ ${managePos.stopLoss.toLocaleString()}`,
                    9000
                  )
                } else if (exitReason === 'take_profit') {
                  successToast(
                    `Take profit @ ${managePos.profitTarget.toLocaleString()}`,
                    9000
                  )
                }
                clearPositionUi(exitReason)
              }}
              onRefreshGate={refreshGate}
              onAiVerdict={setAiVerdict}
              onBreakEvenAvailable={handleBreakEvenAvailable}
              onBrokerExit={handleBrokerExit}
            />
          </div>
        )}

        {managePos && (
          <MorningLunchFlatConfirm
            open={lunchFlatPrompt}
            instrument={managePos.instrument}
            direction={managePos.direction}
            entryPrice={managePos.entryPrice}
            cashCloseLabel={(() => {
              const s = sessionFor(managePos.instrument)
              return `${deskLocalHmsAsTraderDisplay(s.marketClose, s.tz)} ${TRADER_DISPLAY_LABEL}`
            })()}
            busy={lunchFlatBusy}
            onConfirm={() => void confirmLunchFlatClose()}
            onKeepOpen={() => {
              markLunchFlatKeepOpen(liveLunchFlatKeepOpenKey(managePos.id))
              setLunchFlatPrompt(false)
            }}
          />
        )}

        <div className="relative flex-1 w-full h-full min-h-0">
          {!chartLocked && chartBooted && (
            <TradingChart
              initialInstrument={instrument}
              onInstrumentChange={setInstrument}
              onInstrumentSync={syncInstrument}
              onPriceUpdate={onPriceUpdate}
              onQuoteTick={setLastQuoteAt}
              onDataModeChange={setDataMode}
              positionOverlay={
                positionOverlay ??
                (managePos
                  ? {
                      entryPrice: managePos.entryPrice,
                      stopLoss: managePos.stopLoss,
                      profitTarget: managePos.profitTarget,
                      direction: managePos.direction,
                      positionSize: managePos.positionSize,
                      riskDollars:
                        (managePos.riskAmount ?? 0) > 0
                          ? managePos.riskAmount
                          : lastTradeifyRiskRef.current,
                    }
                  : null)
              }
              pendingLimit={
                pending && !managePos
                  ? {
                      price: pending.level,
                      direction: pending.direction === 'LONG' ? 'long' : 'short',
                      stopLoss: pending.stopLoss,
                      profitTarget: pending.profitTarget,
                      riskDollars: pending.riskAmount,
                    }
                  : null
              }
              onCancelPending={() => {
                const inst = (pending?.instrument || locked || instrument) as Instrument
                orderGenRef.current += 1
                pendingRef.current = null
                setPending(null)
                setFillError(null)
                setOrderStatus('idle')
                void cancelWorkingLimit(inst)
              }}
              onAdjustBrackets={managePos ? adjustBrackets : undefined}
              onAdjustWorkingBrackets={
                pending && orderStatus === 'working' && pending.workingId
                  ? adjustWorkingBrackets
                  : undefined
              }
              bracketAdjustStatus={managePos ? bracketAdjustStatus : null}
              bracketAdjustError={managePos ? bracketAdjustError : null}
              workingBracketAdjustStatus={
                pending && orderStatus === 'working' ? workingBracketAdjustStatus : null
              }
              workingBracketAdjustError={
                pending && orderStatus === 'working' ? workingBracketAdjustError : null
              }
              aiVerdict={managePos ? aiVerdict : null}
              jumpToPriceRef={jumpToPriceRef}
              // Hard-lock tabs only after clock-in / open book (AI suggest stays soft)
              lockedInstrument={locked}
              allowedInstruments={gate?.allowedInstruments ?? undefined}
              onLevelSelect={handleLevelSelect}
              canPlaceOrder={canTrade && dataMode === 'live'}
              onDeskAlert={handleDeskAlert}
              onRangeAtr={handleRangeAtr}
              rangeStrategy={gate?.rangeStrategy ?? null}
              attemptsUsed={gate?.attemptsUsed ?? 0}
              stopHits={gate?.stopHits ?? 0}
              morningAttempts={gate?.morningAttempts ?? 0}
              ibAttempts={gate?.ibAttempts ?? 0}
              lunchAttempts={gate?.lunchAttempts ?? 0}
              deskLevelsActive={deskLevelsActive}
              deskAttended={deskAttended}
              clockedIn={clockedIn}
              useCall={clockedIn ? (gate?.useCall ?? null) : true}
              levelsRefreshKey={levelsRefreshKey}
            />
          )}

          {showPreOpenClockIn && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
              <div className="pointer-events-auto max-w-lg w-full rounded-2xl border border-amber-500/40 bg-[#161b22]/95 px-4 py-3 shadow-2xl backdrop-blur-md space-y-2">
                <p className="text-center text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
                  {suggested
                    ? `AI suggests ${suggested} — clock in to commit`
                    : 'Browse DOW & NASDAQ — clock in when ready'}
                </p>
                <div className="flex items-center justify-center gap-2">
                  {(['DOW', 'NASDAQ'] as Instrument[]).map((inst) => {
                    const isRec = suggested === inst
                    return (
                      <button
                        key={inst}
                        type="button"
                        onClick={async () => {
                          saveDeskClockLock(inst)
                          await fetch('/api/trading/clock-in', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              market: 'NY',
                              instrument: inst,
                            }),
                          })
                          setInstrument(inst)
                          bannerRefreshRef.current?.()
                          setGateTick((t) => t + 1)
                        }}
                        className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 border ${
                          isRec
                            ? 'bg-amber-500 text-black border-amber-400 shadow-lg shadow-amber-500/20 hover:bg-amber-400'
                            : 'bg-surface-700 text-gray-200 border-surface-600 hover:bg-surface-600 hover:text-white'
                        }`}
                      >
                        {isRec && <span>★ AI TOP PICK:</span>}
                        <span>{inst === 'DOW' ? 'DOW · MYM' : 'NASDAQ · MNQ'}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {chartLocked && (
            <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl border border-surface-600 bg-[#0d1117]/95 backdrop-blur-md p-6">
              <div
                className={`w-full px-6 py-5 text-center bg-[#161b22]/95 border border-amber-500/30 rounded-2xl shadow-2xl space-y-4 ${
                  lateJoinLocked ? 'max-w-lg' : 'max-w-md'
                }`}
              >
                {lateJoinLocked ? (
                  <>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-extrabold uppercase tracking-wider">
                      Late clock-in open
                    </div>
                    <div>
                      <h3 className="text-lg font-extrabold text-white tracking-tight">
                        Live Desk Brief
                      </h3>
                      <p className="mt-1 text-xs text-gray-400 leading-relaxed">
                        Cash open passed — you can still join for remaining probes. Dead OR30/IB
                        books stay closed. Telegram does not clock you in.
                      </p>
                    </div>
                    <LiveDeskBriefPanel
                      brief={liveBrief}
                      loading={liveBriefLoading}
                      error={liveBriefError}
                    />
                    {gate?.canClockIn && (
                      <div className="pt-2 flex flex-col gap-2">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          Clock in late — select desk:
                        </span>
                        <div className="flex items-center justify-center gap-2">
                          {(['DOW', 'NASDAQ'] as Instrument[]).map((inst) => {
                            const top =
                              liveBrief?.suggestion.kind === 'trade' &&
                              liveBrief.suggestion.instrument === inst
                            return (
                              <button
                                key={inst}
                                type="button"
                                onClick={async () => {
                                  const market = 'NY'
                                  try {
                                    saveDeskClockLock(inst)
                                    const res = await fetch('/api/trading/clock-in', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        market,
                                        instrument: inst,
                                      }),
                                    })
                                    const j = await res.json().catch(() => ({}))
                                    if (!res.ok) {
                                      warningToast(
                                        (j as { error?: string }).error ||
                                          'Clock-in failed — try again'
                                      )
                                      return
                                    }
                                    setInstrument(inst)
                                    bannerRefreshRef.current?.()
                                    setGateTick((t) => t + 1)
                                  } catch {
                                    warningToast('Clock-in failed — network error')
                                  }
                                }}
                                className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 border ${
                                  top
                                    ? 'bg-amber-500 text-black border-amber-400 shadow-lg shadow-amber-500/20 hover:bg-amber-400'
                                    : 'bg-surface-700 text-gray-200 border-surface-600 hover:bg-surface-600 hover:text-white'
                                }`}
                              >
                                {top && <span>★ BRIEF:</span>}
                                <span>{inst === 'DOW' ? 'DOW · MYM' : 'NASDAQ · MNQ'}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : missedSessionLocked ? (
                  <>
                    <p className="text-lg font-bold text-white tracking-tight">Session closed</p>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Cash close passed with no clock-in — live desk stays locked. Use Simulation,
                      or wait for the next prep window.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-extrabold uppercase tracking-wider">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                      PRE-MARKET PREP PHASE
                    </div>

                    <div>
                      <h3 className="text-lg font-extrabold text-white tracking-tight">
                        {suggested || recommendation ? (
                          <>
                            AI Recommendation:{' '}
                            <span className="text-amber-400">
                              {suggested ?? recommendation?.instrument}
                            </span>
                          </>
                        ) : (
                          'Pre-Market Session Analysis'
                        )}
                      </h3>
                      <p className="mt-1 text-xs text-amber-200/90 font-medium leading-relaxed">
                        {recommendation?.message ??
                          (suggested
                            ? `System pick: ${suggested}. Clock in on DOW or NASDAQ to unlock the live desk.`
                            : 'Level Finder has analyzed overnight structure, AVWAP, and market regime.')}
                      </p>
                    </div>

                    {gate?.canClockIn && (
                      <div className="pt-2 flex flex-col gap-2">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          Select Desk & Clock In for Today:
                        </span>
                        <div className="flex items-center justify-center gap-2">
                          {(['DOW', 'NASDAQ'] as Instrument[]).map((inst) => {
                            const isRec = (suggested ?? recommendation?.instrument ?? 'DOW') === inst
                            return (
                              <button
                                key={inst}
                                type="button"
                                onClick={async () => {
                                  const market = 'NY'
                                  saveDeskClockLock(inst)
                                  await fetch('/api/trading/clock-in', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      market,
                                      instrument: inst,
                                    }),
                                  })
                                  setInstrument(inst)
                                  bannerRefreshRef.current?.()
                                  setGateTick((t) => t + 1)
                                }}
                                className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 border ${
                                  isRec
                                    ? 'bg-amber-500 text-black border-amber-400 shadow-lg shadow-amber-500/20 hover:bg-amber-400 scale-[1.02]'
                                    : 'bg-surface-700 text-gray-200 border-surface-600 hover:bg-surface-600 hover:text-white'
                                }`}
                              >
                                {isRec && <span>★ AI TOP PICK:</span>}
                                <span>{inst === 'DOW' ? 'DOW · MYM' : 'NASDAQ · MNQ'}</span>
                                {isRec && recommendation?.recommendation_confidence && (
                                  <span className="text-[10px] opacity-80">({recommendation.recommendation_confidence}%)</span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="pt-3 border-t border-surface-700 flex items-center justify-between text-xs">
                  <span className="text-gray-400 text-[11px]">Prefer paper trading?</span>
                  <Link
                    href="/dashboard/simulation"
                    className="rounded-lg border border-violet-500/50 bg-violet-500/20 px-3 py-1 text-[11px] font-semibold text-violet-100 hover:bg-violet-500/30"
                  >
                    Try simulation
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>

        {orderLevel != null &&
          orderLevelType !== 'market' &&
          !pending &&
          !managePos && (
          <LevelOrderTicket
            key={`live-${orderLevel}-${orderEntrySource}-${orderPreferredDirection ?? orderLevelSide ?? orderLevelType ?? 'x'}`}
            instrument={(clockedIn && locked ? locked : instrument) as Instrument}
            levelPrice={orderLevel}
            levelType={orderLevelType}
            levelSide={orderLevelSide}
            preferredDirection={orderPreferredDirection}
            entryReason={orderLevelReason}
            entrySource={orderEntrySource}
            strategyRange={orderStrategyRange}
            strategyMagnets={orderStrategyMagnets}
            atrAdviceLine={rangeAtrAdvice}
            regime={regime}
            regimeConfidence={regimeConfidence}
            canPlace={canTrade && dataMode === 'live'}
            entryWindow={gate?.entryWindow ?? 1}
            presetStopLoss={orderPresetStopLoss}
            presetProfitTarget={orderPresetProfitTarget}
            autoConfirm={orderAutoConfirm}
            sessionFillsUsed={gate?.attemptsUsed ?? 0}
            onClose={() => {
              setOrderLevel(null)
              setOrderLevelType(undefined)
              setOrderLevelSide(undefined)
              setOrderPreferredDirection(undefined)
              setOrderLevelReason(undefined)
              setOrderEntrySource('ai')
              setOrderStrategyRange(null)
              setOrderStrategyMagnets(null)
              setOrderPresetStopLoss(null)
              setOrderPresetProfitTarget(null)
              setOrderAutoConfirm(false)
            }}
            onAutoConfirmError={(msg) => {
              setFillError(msg)
              setOrderStatus('rejected')
              setOrderLevel(null)
              setOrderLevelType(undefined)
              setOrderLevelSide(undefined)
              setOrderPreferredDirection(undefined)
              setOrderLevelReason(undefined)
              setOrderEntrySource('ai')
              setOrderStrategyRange(null)
              setOrderStrategyMagnets(null)
              setOrderPresetStopLoss(null)
              setOrderPresetProfitTarget(null)
              setOrderAutoConfirm(false)
            }}
            onPlaced={handlePlaced}
          />
        )}
      </div>
    </div>
  )
}
