'use client'

/**
 * Chart Page — live desk: morning trading; afternoon chart continues (read-only).
 * Flow: place WORKING limit → wait for fill → then MANAGE (morning only).
 * NY:  DOW/NASDAQ  9:30–11:30 ET trade / chart through 16:00
 * Tokyo: NIKKEI    9:00–11:30 JST trade / chart through 15:00
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
  getDeskInstrumentPreference,
  setDeskInstrumentPreference,
  type DeskInstrumentPref,
} from '@/lib/trading/deskInstrumentPreference'
import { isAnyLiveFocusWindowActive, isAfternoonWatchWindow, sessionFor } from '@/lib/trading/sessionGate'
import {
  TRADER_DISPLAY_LABEL,
  deskLocalHmsAsTraderDisplay,
} from '@/lib/chart/traderDisplayTz'
import {
  isMorningOrIbEntry,
  isPastCashCloseNow,
} from '@/lib/trading/morningLunchConfirm'
import {
  RANGE_EDGE_RISK_PERCENT,
  previewPositionSizing,
} from '@/lib/trading/positionSizing'
import { snapDeskPrice, snapStopToTick, snapTargetToTick } from '@/lib/trading/instrumentTicks'
import { assertRangeEdgeEntry } from '@/lib/trading/rangeEdgeEntryGate'

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
    if (gate.dayLocked || (gate.attemptsUsed ?? 0) >= (gate.maxAttempts ?? 6)) {
      return 'Day attempt cap reached — trading switched off. No new entries.'
    }
    if (gate.phase === 'CLOSED') {
      return 'Cash closed — desk is offline until the next session.'
    }
    return 'Clocked out — no new entries. Manage only if you have an open book.'
  }
  if (!gate.canPlaceEntry) {
    if (gate.dayLocked || (gate.attemptsUsed ?? 0) >= (gate.maxAttempts ?? 6)) {
      return 'Day attempt cap reached — trading switched off. No new entries.'
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
      return 'Pre-open prep — entries open at cash open.'
    }
    return gate.message || 'Entries not available right now.'
  }
  return null
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

interface PositionOverlay {
  entryPrice: number
  stopLoss: number
  profitTarget: number
  direction: 'long' | 'short'
  positionSize?: number
}

export default function ChartPage() {
  const router = useRouter()
  // SSR/hydration always starts DOW — restore preference after mount (see effect below)
  const [instrument, setInstrumentState] = useState<Instrument>('DOW')

  /** User tab click — persist across refresh */
  const setInstrument = useCallback((i: Instrument) => {
    setInstrumentState(i)
    setDeskInstrumentPreference(i)
  }, [])

  /** Gate/lock sync — update view only, do not clobber saved preference */
  const syncInstrument = useCallback((i: Instrument) => {
    setInstrumentState(i)
  }, [])

  useEffect(() => {
    setInstrumentState(getDeskInstrumentPreference())
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
  const [gate, setGate] = useState<SessionGateState | null>(null)
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
  /** Snapshot to revert chart overlay if bracket API fails */
  const confirmedOverlayRef = useRef<PositionOverlay | null>(null)
  const bracketSavingRef = useRef(false)
  /** After 11:30 with open morning/IB book — ask before closing */
  const [lunchFlatPrompt, setLunchFlatPrompt] = useState(false)
  const [lunchFlatBusy, setLunchFlatBusy] = useState(false)
  const lunchFlatDismissedRef = useRef(false)
  /** Placing → Working → Filled | Rejected */
  const [orderStatus, setOrderStatus] = useState<
    'idle' | 'placing' | 'working' | 'filled' | 'rejected'
  >('idle')
  const [levelsRefreshKey, setLevelsRefreshKey] = useState(0)
  const afternoonLevelsLoadedRef = useRef(false)
  const [aiVerdict, setAiVerdict] = useState<AiVerdict | null>(null)
  const [recommendation, setRecommendation] = useState<{
    instrument: Instrument
    regime: string
    regime_confidence: number
    recommendation_confidence: number
    message: string
  } | null>(null)

  const jumpToPriceRef = useRef<((price: number) => void) | null>(null)
  const bannerRefreshRef = useRef<(() => void) | null>(null)
  const pendingRef = useRef<PendingLimitOrder | null>(null)
  const fillingRef = useRef(false)
  const placingOrderRef = useRef(false)
  /** Bumped on cancel / session expire so in-flight fills do not re-arm a cancelled limit */
  const orderGenRef = useRef(0)
  const livePriceRef = useRef<number | null>(null)
  const regimeFetchedRef = useRef(false)
  const lastParentPriceAt = useRef(0)

  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  useEffect(() => {
    livePriceRef.current = livePrice
  }, [livePrice])

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

  const placeMarketOrder = useCallback(
    (order: {
      entryPrice: number
      stopLoss: number
      profitTarget: number
      direction: 'LONG' | 'SHORT'
      reasoning: string
      strategyRange?: StrategyRangeEdges | null
    }) => {
      if (managePos || positionOverlay || pending) return
      const denied = entryDeniedMessage(gate)
      if (denied) {
        setOrderLevel(null)
        setOrderLevelType(undefined)
        setFillError(denied)
        setOrderStatus('rejected')
        return
      }
      setOrderLevel(null)
      setOrderLevelType(undefined)

      const lockedInst = gate?.lockedInstrument
      const inst = (gate?.clockedIn && lockedInst
        ? lockedInst
        : instrument) as Instrument
      const entry = snapDeskPrice(inst, order.entryPrice)
      const direction = order.direction
      const range = order.strategyRange ?? orderStrategyRange
      const edge = assertRangeEdgeEntry({ entry, range })
      if (!edge.ok) {
        setFillError(edge.message)
        setOrderStatus('rejected')
        return
      }
      // Market: live print must also sit in the ±10 band (plan rule)
      const livePx = livePriceRef.current
      if (livePx != null && Number.isFinite(livePx) && livePx > 0) {
        const liveEdge = assertRangeEdgeEntry({ entry: livePx, range })
        if (!liveEdge.ok) {
          setFillError(liveEdge.message)
          setOrderStatus('rejected')
          return
        }
      }
      const stop = snapStopToTick(inst, entry, order.stopLoss, direction)
      if (
        (direction === 'LONG' && !(stop < entry)) ||
        (direction === 'SHORT' && !(stop > entry))
      ) {
        setFillError('Invalid market stop — adjust SL beyond entry')
        return
      }

      void (async () => {
        let accountSize = 100000
        try {
          const res = await fetch('/api/trading/oanda/status')
          const data = res.ok ? await res.json() : null
          const nav = Number(data?.NAV ?? data?.balance)
          if (Number.isFinite(nav) && nav >= 100) {
            accountSize = Math.round(nav * 100) / 100
          }
        } catch {
          /* open API still prefers live NAV */
        }

        const preview = previewPositionSizing(
          entry,
          accountSize,
          direction,
          stop,
          RANGE_EDGE_RISK_PERCENT
        )
        if (!preview) {
          setFillError('Could not size market order — check account / stop')
          return
        }

        const tp = snapTargetToTick(
          inst,
          entry,
          order.profitTarget > 0 ? order.profitTarget : preview.profit_target_price,
          direction
        )

        handlePlacedRef.current({
          instrument: inst,
          level: entry,
          levelType: 'market',
          entryReason:
            order.reasoning ||
            `Manual ${direction} market @ ${entry.toLocaleString()}`,
          entrySource: 'manual',
          direction,
          stopLoss: preview.stop_loss_price || stop,
          profitTarget: tp,
          positionSize: preview.position_size,
          riskAmount: preview.risk_amount,
          riskPercent: RANGE_EDGE_RISK_PERCENT,
          accountSize,
          entryWindow: (gate?.entryWindow ?? 1) as 1 | 2 | 3,
          regime,
          regimeConfidence,
          placedAt: Date.now(),
          strategyRange: range ?? null,
        })
      })()
    },
    [
      managePos,
      positionOverlay,
      pending,
      instrument,
      gate,
      regime,
      regimeConfidence,
      orderStrategyRange,
    ]
  )

  const handleLevelSelect = useCallback(
    (
      price: number,
      meta?: {
        type?: string
        reasoning?: string
        source?: 'ai' | 'structure' | 'manual'
        side?: 'BUY' | 'SHORT'
        preferredDirection?: 'LONG' | 'SHORT'
        orderType?: 'LIMIT' | 'MARKET'
        stopLoss?: number
        profitTarget?: number
        strategyRange?: StrategyRangeEdges | null
        strategyMagnets?: StrategyRiskMagnets | null
      }
    ) => {
      if (managePos || positionOverlay || pending) return

      const denied = entryDeniedMessage(gate)
      if (denied) {
        setFillError(denied)
        setOrderStatus('rejected')
        return
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

      // Safety net: market-tagged select must not open the limit ticket
      const isMarket =
        meta?.type === 'market' || meta?.orderType === 'MARKET'
      if (isMarket) {
        placeMarketOrder({
          entryPrice: price,
          stopLoss:
            typeof meta?.stopLoss === 'number' && meta.stopLoss > 0
              ? meta.stopLoss
              : preferred === 'SHORT'
                ? price * 1.0035
                : price * 0.9965,
          profitTarget:
            typeof meta?.profitTarget === 'number' && meta.profitTarget > 0
              ? meta.profitTarget
              : 0,
          direction: preferred ?? 'LONG',
          reasoning:
            meta?.reasoning ||
            `Manual ${preferred ?? 'LONG'} market @ ${price.toLocaleString()}`,
        })
        return
      }

      // Limit / playbook — open LevelOrderTicket
      setOrderLevel(price)
      setOrderLevelType(meta?.type)
      setOrderLevelSide(side)
      setOrderPreferredDirection(preferred)
      setOrderLevelReason(meta?.reasoning)
      setOrderEntrySource(
        meta?.source === 'manual' || meta?.type === 'manual'
          ? 'manual'
          : meta?.source === 'structure'
            ? 'structure'
            : 'ai'
      )
      setOrderStrategyRange(
        meta?.source === 'manual' || meta?.type === 'manual'
          ? null
          : meta?.strategyRange ?? null
      )
      setOrderStrategyMagnets(
        meta?.source === 'manual' || meta?.type === 'manual'
          ? null
          : meta?.strategyMagnets ?? null
      )
    },
    [managePos, positionOverlay, pending, placeMarketOrder, gate]
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

  const handleGate = useCallback((g: SessionGateState) => {
    setGate(g)
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

  const enterManage = useCallback(
    (order: FilledOrder, inst: string) => {
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
        }),
      })
      if (gen !== orderGenRef.current) return
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
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
  }, [])

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
      if (placingOrderRef.current || pendingRef.current || managePos) return
      const denied = entryDeniedMessage(gate)
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
      setFillError(null)

      const px = livePriceRef.current
      const isMarket = orderWithRange.levelType === 'market'
      if (isMarket && px != null && Number.isFinite(px) && px > 0) {
        const liveEdge = assertRangeEdgeEntry({
          entry: px,
          range: orderWithRange.strategyRange,
        })
        if (!liveEdge.ok) {
          placingOrderRef.current = false
          setFillError(liveEdge.message)
          setOrderStatus('rejected')
          return
        }
      }
      if (
        isMarket ||
        (px != null && limitWouldFill(orderWithRange.direction, orderWithRange.level, px))
      ) {
        pendingRef.current = orderWithRange
        setPending(orderWithRange)
        const execPx = isMarket ? (px ?? orderWithRange.level) : orderWithRange.level
        void fillPending(orderWithRange, execPx).finally(() => {
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
    if (!limitWouldFill(pending.direction, pending.level, livePrice)) return
    void fillPending(pending, pending.level)
  }, [livePrice, pending, managePos, fillPending, orderStatus])

  // Cancel unfilled working limits when entry closed, day done, cash closed, or clocked out
  useEffect(() => {
    if (!gate) return
    const phaseBlocks =
      gate.phase === 'FLAT' || gate.phase === 'DONE' || gate.phase === 'CLOSED'
    const clockedOutBlocks = !gate.clockedIn

    if (pending && (phaseBlocks || clockedOutBlocks)) {
      const inst = (pending.instrument || gate.lockedInstrument || instrument) as Instrument
      orderGenRef.current += 1
      pendingRef.current = null
      setPending(null)
      setOrderStatus('idle')
      setFillError(workingLimitCancelledMessage(gate))
      if (gate.phase === 'FLAT' || clockedOutBlocks) {
        void cancelWorkingLimit(inst)
      }
    }

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
      lunchFlatDismissedRef.current = false
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
    if (lunchFlatDismissedRef.current) {
      setLunchFlatPrompt(false)
      return
    }
    setLunchFlatPrompt(true)
  }, [managePos, gateTick])

  // Cash close: force-flatten while MANAGE may still be active (open book past marketClose)
  useEffect(() => {
    if (!managePos) return
    const inst = managePos.instrument as Instrument
    const tick = () => {
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
      setLunchFlatPrompt(false)
      lunchFlatDismissedRef.current = true
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

  // Load open position into manage desk when already filled (refresh / reopen)
  useEffect(() => {
    if (gate?.phase !== 'MANAGE') {
      if (gate?.phase !== 'ENTRY' && gate?.phase !== 'FLAT' && !pending) {
        setManagePos(null)
      }
      return
    }
    if (pending) setPending(null) // DB position wins over stale working limit
    const inst = gate.lockedInstrument || instrument
    let cancelled = false
    const load = async () => {
      try {
        let res = await fetch(
          `/api/trading/current-position?instrument=${encodeURIComponent(inst)}`
        )
        let json = res.ok ? await res.json() : null
        if (!json?.position) {
          res = await fetch('/api/trading/current-position?any=1')
          json = res.ok ? await res.json() : null
        }
        if (cancelled || !json?.position) return
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
        if (bracketSavingRef.current) return
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
      } catch {
        /* keep */
      }
    }
    load()
    const id = setInterval(load, 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [gate?.phase, gate?.lockedInstrument, gate?.open_position_id, instrument, gateTick, pending])

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
  const missedSessionLocked =
    chartLocked && !attendedToday && (gate?.phase === 'DONE' || gate?.phase === 'FLAT')
  const showPreOpenClockIn =
    !clockedIn &&
    !!gate?.canViewLiveChart &&
    !!gate?.canClockIn &&
    gate.market === 'NY'
  const inManage = gate?.phase === 'MANAGE' || !!managePos
  const inEntry = gate?.phase === 'ENTRY' && !!gate?.canPlaceEntry
  const canTrade = inEntry && !pending && !managePos && clockedIn
  const inWorking = !!pending && !managePos
  // Playbook/levels only for the desk you clocked into — not on browse tabs after close
  const deskLevelsActive =
    !!gate &&
    gate.phase !== 'CLOSED' &&
    (clockedIn || attendedToday) &&
    (!locked || locked === instrument) &&
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
                  SL {pending.stopLoss.toLocaleString()} · TP{' '}
                  {pending.profitTarget.toLocaleString()}
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
                  void cancelWorkingLimit(inst)
                }}
                className="ml-auto rounded border border-sky-600/50 px-2 py-1 text-[10px] font-semibold uppercase text-sky-200 hover:bg-sky-900/50"
              >
                Cancel
              </button>
            )}
          </div>
        ) : null}

        {fillError && (
          <p className="absolute bottom-14 left-4 z-30 px-2.5 py-1 text-xs text-red-300 bg-red-950/90 rounded border border-red-700/60 shadow-lg backdrop-blur-md">
            {fillError}
          </p>
        )}

        {inManage && managePos && (
          <div className="absolute bottom-14 left-4 z-30">
            <ManageDeskBar
              position={managePos}
              currentPrice={livePrice}
              onClosed={(exitReason = 'manual') => {
                setManagePos(null)
                setPositionOverlay(null)
                confirmedOverlayRef.current = null
                setBracketAdjustStatus(null)
                setBracketAdjustError(null)
                setAiVerdict(null)
                setLunchFlatPrompt(false)
                lunchFlatDismissedRef.current = true
                refreshGate()
                void refreshLevelsAfterExit(exitReason)
              }}
              onRefreshGate={refreshGate}
              onAiVerdict={setAiVerdict}
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
              lunchFlatDismissedRef.current = true
              setLunchFlatPrompt(false)
            }}
          />
        )}

        <div className="relative flex-1 w-full h-full min-h-0">
          {!chartLocked && (
            <TradingChart
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
              bracketAdjustStatus={managePos ? bracketAdjustStatus : null}
              bracketAdjustError={managePos ? bracketAdjustError : null}
              aiVerdict={managePos ? aiVerdict : null}
              jumpToPriceRef={jumpToPriceRef}
              // Hard-lock tabs only after clock-in / open book (AI suggest stays soft)
              lockedInstrument={locked}
              allowedInstruments={gate?.allowedInstruments ?? undefined}
              onLevelSelect={handleLevelSelect}
              onMarketOrder={placeMarketOrder}
              canPlaceOrder={canTrade && dataMode === 'live'}
              rangeStrategy={gate?.rangeStrategy ?? null}
              attemptsUsed={gate?.attemptsUsed ?? 0}
              stopHits={gate?.stopHits ?? 0}
              morningAttempts={gate?.morningAttempts ?? 0}
              ibAttempts={gate?.ibAttempts ?? 0}
              lunchAttempts={gate?.lunchAttempts ?? 0}
              deskLevelsActive={deskLevelsActive}
              deskAttended={deskAttended}
              clockedIn={clockedIn}
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
                        <span>{inst}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {chartLocked && (
            <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl border border-surface-600 bg-[#0d1117]/95 backdrop-blur-md p-6">
              <div className="max-w-md w-full px-6 py-5 text-center bg-[#161b22]/95 border border-amber-500/30 rounded-2xl shadow-2xl space-y-4">
                {missedSessionLocked ? (
                  <>
                    <p className="text-lg font-bold text-white tracking-tight">Session Skipped</p>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      You did not clock in this morning, so the live desk (DOW, NASDAQ, and NIKKEI) stays locked through afternoon watch until cash close. Use Simulation, or wait for the next session.
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
                          {(gate.market === 'TOKYO' ? ['NIKKEI'] as Instrument[] : ['DOW', 'NASDAQ'] as Instrument[]).map((inst) => {
                            const isRec = (suggested ?? recommendation?.instrument ?? 'DOW') === inst
                            return (
                              <button
                                key={inst}
                                type="button"
                                onClick={async () => {
                                  const market = gate.market || (inst === 'NIKKEI' ? 'TOKYO' : 'NY')
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
                                <span>{inst}</span>
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
            regime={regime}
            regimeConfidence={regimeConfidence}
            canPlace={canTrade && dataMode === 'live'}
            entryWindow={gate?.entryWindow ?? 1}
            onClose={() => {
              setOrderLevel(null)
              setOrderLevelType(undefined)
              setOrderLevelSide(undefined)
              setOrderPreferredDirection(undefined)
              setOrderLevelReason(undefined)
              setOrderEntrySource('ai')
              setOrderStrategyRange(null)
              setOrderStrategyMagnets(null)
            }}
            onPlaced={handlePlaced}
          />
        )}
      </div>
    </div>
  )
}
