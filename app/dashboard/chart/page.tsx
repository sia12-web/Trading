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
import { isAnyLiveFocusWindowActive } from '@/lib/trading/sessionGate'

type Instrument = DeskInstrumentPref

interface PositionOverlay {
  entryPrice: number
  stopLoss: number
  profitTarget: number
  direction: 'long' | 'short'
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
  const [regime, setRegime] = useState<'bullish' | 'bearish' | 'choppy'>('bullish')
  const [regimeConfidence, setRegimeConfidence] = useState(70)
  const [gateTick, setGateTick] = useState(0)
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null)
  const [dataMode, setDataMode] = useState<'live' | 'synthetic'>('live')
  const [fillError, setFillError] = useState<string | null>(null)
  /** Placing → Working → Filled | Rejected */
  const [orderStatus, setOrderStatus] = useState<
    'idle' | 'placing' | 'working' | 'filled' | 'rejected'
  >('idle')
  const [levelsRefreshKey, setLevelsRefreshKey] = useState(0)
  const afternoonLevelsLoadedRef = useRef(false)
  const [aiVerdict, setAiVerdict] = useState<AiVerdict | null>(null)

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

  const handleLevelSelect = useCallback(
    (
      price: number,
      meta?: {
        type?: string
        reasoning?: string
        source?: 'ai' | 'structure' | 'manual'
        side?: 'BUY' | 'SHORT'
        preferredDirection?: 'LONG' | 'SHORT'
      }
    ) => {
      if (managePos || positionOverlay || pending) return
      // Always stash selection so the ticket can show "why this level"
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
      setOrderLevel(price)
      setOrderLevelType(meta?.type)
      setOrderLevelSide(side)
      setOrderPreferredDirection(preferred)
      setOrderLevelReason(meta?.reasoning)
      setOrderEntrySource(
        meta?.source === 'manual' || meta?.type === 'manual' || meta?.type === 'market'
          ? 'manual'
          : meta?.source === 'structure'
            ? 'structure'
            : 'ai'
      )

    },
    [managePos, positionOverlay, pending]
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
      setOrderStatus('filled')
      setPositionOverlay({
        entryPrice: order.entry_price,
        stopLoss: order.stop_loss_price,
        profitTarget: order.profit_target_price,
        direction: dir,
      })
      setManagePos({
        id: order.position_id,
        instrument: inst,
        entryPrice: order.entry_price,
        stopLoss: order.stop_loss_price,
        profitTarget: order.profit_target_price,
        direction: dir,
        positionSize: order.position_size,
        riskAmount: order.risk_amount,
      })
      refreshGate()
    },
    [refreshGate]
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

  const expireWorkingLimits = useCallback(async (force = false) => {
    try {
      await fetch('/api/trading/positions/cleanup-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force_expire_working: force,
          force_lunch_close: force,
        }),
      })
    } catch {
      /* non-fatal */
    }
  }, [])

  const handlePlaced = useCallback(
    (order: PendingLimitOrder) => {
      if (placingOrderRef.current || pendingRef.current || managePos) return
      placingOrderRef.current = true
      setOrderStatus('placing')
      setOrderLevel(null)
      setOrderLevelType(undefined)
      setOrderLevelSide(undefined)
      setOrderPreferredDirection(undefined)
      setOrderLevelReason(undefined)
      setOrderEntrySource('ai')
      setFillError(null)

      // Immediate fill if price is already through the limit
      const px = livePriceRef.current
      if (px != null && limitWouldFill(order.direction, order.level, px)) {
        pendingRef.current = order
        setPending(order)
        void fillPending(order, order.level).finally(() => {
          placingOrderRef.current = false
        })
        return
      }

      // Optimistic WORKING — paint lines before network
      pendingRef.current = order
      setPending(order)
      setOrderStatus('working')
      placingOrderRef.current = false
      void persistWorking(order)
    },
    [fillPending, persistWorking, managePos]
  )

  // Watch live quotes — fill only durable WORKING limits (not placing/rejected)
  useEffect(() => {
    if (!pending || managePos || livePrice == null) return
    if (orderStatus !== 'working') return
    if (!limitWouldFill(pending.direction, pending.level, livePrice)) return
    void fillPending(pending, pending.level)
  }, [livePrice, pending, managePos, fillPending, orderStatus])

  // After entryClose (FLAT) or session end: cancel unfilled working limits; levels gone
  useEffect(() => {
    if (gate?.phase !== 'FLAT' && gate?.phase !== 'DONE' && gate?.phase !== 'CLOSED') return
    if (pending) {
      const inst = (pending.instrument || gate.lockedInstrument || instrument) as Instrument
      orderGenRef.current += 1
      pendingRef.current = null
      setPending(null)
      setOrderStatus('idle')
      setFillError(
        gate.phase === 'FLAT'
          ? 'Working limit cancelled — entry window closed (levels cleared)'
          : 'Working limit cancelled — session closed'
      )
      if (gate.phase === 'FLAT') {
        void cancelWorkingLimit(inst)
      }
    }
    // Expire DB working rows + lunch-flatten any leftover filled opens
    if (gate.phase === 'DONE' || gate.phase === 'CLOSED') {
      void expireWorkingLimits(true)
    }
    // Reload levels once after lunch so afternoon watch playbook paints
    if (gate.phase === 'DONE') {
      if (!afternoonLevelsLoadedRef.current) {
        afternoonLevelsLoadedRef.current = true
        setLevelsRefreshKey((k) => k + 1)
      }
    } else {
      afternoonLevelsLoadedRef.current = false
    }
  }, [gate?.phase, gate?.lockedInstrument, pending, expireWorkingLimits, cancelWorkingLimit, instrument])

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
        }
        setManagePos(manage)
        setPositionOverlay({
          entryPrice: manage.entryPrice,
          stopLoss: manage.stopLoss,
          profitTarget: manage.profitTarget,
          direction: manage.direction,
        })
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
  const clockedIn = !!gate?.clockedIn
  const attendedToday = !!gate?.attendedToday
  // Never clocked in today → lock for the whole cash session (morning + afternoon).
  // Clocked in then out (attendedToday) → afternoon watch chart is allowed (read-only).
  const chartLocked =
    gate != null &&
    !clockedIn &&
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
                setAiVerdict(null)
                refreshGate()
                void refreshLevelsAfterExit(exitReason)
              }}
              onRefreshGate={refreshGate}
              onAiVerdict={setAiVerdict}
            />
          </div>
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
              aiVerdict={managePos ? aiVerdict : null}
              jumpToPriceRef={jumpToPriceRef}
              // Hard-lock tabs to day's recommended / clocked instrument (no NASDAQ switch when DOW locked)
              lockedInstrument={locked}
              allowedInstruments={gate?.allowedInstruments ?? undefined}
              onLevelSelect={handleLevelSelect}
              canPlaceOrder={canTrade && dataMode === 'live'}
              deskLevelsActive={deskLevelsActive}
              deskAttended={deskAttended}
              clockedIn={clockedIn}
              levelsRefreshKey={levelsRefreshKey}
            />
          )}

          {chartLocked && (
            <div className="absolute inset-0 z-30 flex items-center justify-center rounded-xl border border-surface-600 bg-[#0d1117]">
              <div className="max-w-md px-8 text-center">
                <p className="text-lg font-semibold text-white tracking-tight">
                  {missedSessionLocked ? 'Session skipped' : 'Live chart is closed'}
                </p>
                <p className="mt-2 text-sm text-gray-400 leading-relaxed">
                  {missedSessionLocked ? (
                    <>
                      You did not clock in this morning, so the live desk (DOW, NASDAQ, and
                      NIKKEI) stays locked through afternoon watch until cash close. Use
                      Simulation, or wait for the next session.
                    </>
                  ) : (
                    <>
                      Clock in with{' '}
                      <span className="text-amber-300 font-medium">Today I trade</span>{' '}
                      (15 min before cash open) to unlock the live desk and level journaling.
                      Or try Simulation.
                    </>
                  )}
                </p>
                <div className="mt-6 flex items-center justify-center gap-3">
                  {gate?.canClockIn && (
                    <button
                      type="button"
                      onClick={async () => {
                        const market =
                          gate.market ||
                          (gate.lockedInstrument === 'NIKKEI' ? 'TOKYO' : 'NY')
                        const allowed = gate.allowedInstruments
                        const focusInstrument =
                          (allowed?.includes(instrument) ? instrument : null) ||
                          gate.lockedInstrument ||
                          undefined
                        await fetch('/api/trading/clock-in', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            market,
                            instrument: focusInstrument,
                          }),
                        })
                        bannerRefreshRef.current?.()
                        setGateTick((t) => t + 1)
                      }}
                      className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-black hover:bg-amber-400"
                    >
                      Today I trade
                    </button>
                  )}
                  <Link
                    href="/dashboard/simulation"
                    className="rounded-lg border border-violet-500/50 bg-violet-500/20 px-4 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-500/30"
                  >
                    Try simulation
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>

        {orderLevel != null && !pending && !managePos && (
          <LevelOrderTicket
            key={`live-${orderLevel}-${orderEntrySource}-${orderPreferredDirection ?? orderLevelSide ?? orderLevelType ?? 'x'}`}
            instrument={(clockedIn && locked ? locked : instrument) as Instrument}
            levelPrice={orderLevel}
            levelType={orderLevelType}
            levelSide={orderLevelSide}
            preferredDirection={orderPreferredDirection}
            entryReason={orderLevelReason}
            entrySource={orderEntrySource}
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
            }}
            onPlaced={handlePlaced}
          />
        )}
      </div>
    </div>
  )
}
