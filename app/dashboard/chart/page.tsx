'use client'

/**
 * Chart Page — live morning desk only (afternoon is background memory).
 * Flow: place WORKING limit → wait for fill → then MANAGE.
 * NY:  DOW/NASDAQ  9:30–11:30 ET
 * Tokyo: NIKKEI    9:00–11:30 JST
 */

import Link from 'next/link'
import { useState, useRef, useCallback, useEffect } from 'react'
import { TradingChart } from './components/TradingChart'
import { SessionBanner, type SessionGateState } from './components/SessionBanner'
import {
  LevelOrderTicket,
  type FilledOrder,
  type PendingLimitOrder,
  limitWouldFill,
} from './components/LevelOrderTicket'
import { ManageDeskBar, type ManagePosition } from './components/ManageDeskBar'

type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI'

interface PositionOverlay {
  entryPrice: number
  stopLoss: number
  profitTarget: number
  direction: 'long' | 'short'
}

export default function ChartPage() {
  const [instrument, setInstrument] = useState<Instrument>('DOW')
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [positionOverlay, setPositionOverlay] = useState<PositionOverlay | null>(null)
  const [managePos, setManagePos] = useState<ManagePosition | null>(null)
  const [pending, setPending] = useState<PendingLimitOrder | null>(null)
  const [gate, setGate] = useState<SessionGateState | null>(null)
  const [orderLevel, setOrderLevel] = useState<number | null>(null)
  const [orderLevelType, setOrderLevelType] = useState<string | undefined>()
  const [orderLevelReason, setOrderLevelReason] = useState<string | undefined>()
  const [regime, setRegime] = useState<'bullish' | 'bearish' | 'choppy'>('bullish')
  const [regimeConfidence, setRegimeConfidence] = useState(70)
  const [gateTick, setGateTick] = useState(0)
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null)
  const [dataMode, setDataMode] = useState<'live' | 'synthetic'>('live')
  const [fillError, setFillError] = useState<string | null>(null)
  const [levelsRefreshKey, setLevelsRefreshKey] = useState(0)

  const jumpToPriceRef = useRef<((price: number) => void) | null>(null)
  const bannerRefreshRef = useRef<(() => void) | null>(null)
  const pendingRef = useRef<PendingLimitOrder | null>(null)
  const fillingRef = useRef(false)
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
    if (now - lastParentPriceAt.current < 200) return
    lastParentPriceAt.current = now
    setLivePrice(price)
  }, [])

  const handleLevelSelect = useCallback(
    (price: number, meta?: { type?: string; reasoning?: string }) => {
      if (managePos || positionOverlay || pending) return
      if (gate?.phase !== 'ENTRY' || !gate?.canPlaceEntry) return
      setOrderLevel(price)
      setOrderLevelType(meta?.type)
      setOrderLevelReason(meta?.reasoning)
    },
    [managePos, positionOverlay, pending, gate?.phase, gate?.canPlaceEntry]
  )

  const refreshLevelsAfterExit = useCallback(
    async (exitReason: string) => {
      const inst = (gate?.lockedInstrument || instrument) as Instrument
      try {
        await fetch('/api/levels/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instrument: inst, exit_reason: exitReason }),
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
      setFillError(null)
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

  /** Open the journal position only after the working limit fills. */
  const fillPending = useCallback(
    async (pend: PendingLimitOrder, fillPrice: number) => {
      if (fillingRef.current) return
      fillingRef.current = true
      setFillError(null)
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
            entry_source: 'chart_level',
            stop_loss_price: pend.stopLoss,
            profit_target_price: pend.profitTarget,
            entry_reason:
              pend.entryReason ||
              `${pend.direction} working limit filled at liquidity level ${pend.level.toLocaleString()} (${pend.levelType || 'desk level'})`,
          }),
        })
        const json = await res.json()
        if (!res.ok || !json.success) {
          setFillError(json.message || 'Fill failed — limit still working')
          return
        }
        enterManage(
          {
            position_id: json.position_id,
            entry_price: json.entry_price ?? fillPrice,
            stop_loss_price: json.stop_loss_price ?? pend.stopLoss,
            position_size: json.position_size ?? pend.positionSize,
            risk_amount: json.risk_amount ?? pend.riskAmount,
            entry_direction: pend.direction,
            profit_target_price: pend.profitTarget,
          },
          pend.instrument
        )
      } catch (e) {
        setFillError(e instanceof Error ? e.message : 'Fill failed')
      } finally {
        fillingRef.current = false
      }
    },
    [enterManage]
  )

  const handlePlaced = useCallback(
    (order: PendingLimitOrder) => {
      setOrderLevel(null)
      setOrderLevelType(undefined)
      setOrderLevelReason(undefined)
      setFillError(null)

      // Immediate fill if price is already through the limit
      const px = livePriceRef.current
      if (px != null && limitWouldFill(order.direction, order.level, px)) {
        void fillPending(order, order.level)
        return
      }

      setPending(order)
    },
    [fillPending]
  )

  // Watch live quotes — fill working limit when price reaches it
  useEffect(() => {
    if (!pending || managePos || livePrice == null) return
    if (!limitWouldFill(pending.direction, pending.level, livePrice)) return
    void fillPending(pending, pending.level)
  }, [livePrice, pending, managePos, fillPending])

  // After entryClose (FLAT) or session end: cancel unfilled working limits; levels gone
  useEffect(() => {
    if (!pending) return
    if (gate?.phase === 'FLAT' || gate?.phase === 'DONE' || gate?.phase === 'CLOSED') {
      setPending(null)
      setFillError(
        gate.phase === 'FLAT'
          ? 'Working limit cancelled — entry window closed (levels cleared)'
          : 'Working limit cancelled — session closed'
      )
    }
  }, [gate?.phase, pending])

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
  const inManage = gate?.phase === 'MANAGE' || !!managePos
  const inEntry = gate?.phase === 'ENTRY' && !!gate?.canPlaceEntry
  const canTrade = inEntry && !pending && !managePos
  const inWorking = !!pending && !managePos
  /** Buy/short levels only during ENTRY window while flat */
  const showDeskLevels = inEntry && !managePos && !positionOverlay

  return (
    <div className="flex h-screen overflow-hidden relative flex-col">
      <div className="px-3 pt-3">
        <SessionBanner
          onGate={handleGate}
          refreshKey={gateTick}
          lastQuoteAt={lastQuoteAt}
          dataMode={dataMode}
          onRefreshReady={(fn) => {
            bannerRefreshRef.current = fn
          }}
        />
      </div>

      <div className="flex flex-1 min-h-0 relative">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col p-2 gap-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] text-gray-600">
              {inWorking
                ? `WORKING ${pending!.direction} limit @ ${pending!.level.toLocaleString()} — waiting for fill`
                : canTrade
                  ? 'Entry window · click a level for a working limit (MANAGE only after fill)'
                  : inManage
                    ? 'MANAGE · HOLD or TAKE PROFIT — levels cleared'
                    : gate?.phase === 'FLAT'
                      ? 'Entry window closed · levels off · AI still updates memory for later'
                      : gate?.phase === 'RECOMMENDED'
                        ? 'Pre-open · levels prep — entries at cash open'
                        : 'Live morning desk'}
            </span>
            <Link
              href="/dashboard/simulation"
              className="ml-auto rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/25 hover:text-white"
            >
              Simulation →
            </Link>
          </div>

          {inWorking && pending && (
            <div className="flex items-center gap-3 rounded-lg border border-sky-700/50 bg-sky-950/40 px-3 py-2 text-xs text-sky-100">
              <span className="font-semibold uppercase tracking-wide text-sky-300">
                Working limit
              </span>
              <span className="price-mono">
                {pending.direction} @ {pending.level.toLocaleString()}
              </span>
              <span className="text-sky-400/80">
                SL {pending.stopLoss.toLocaleString()} · TP {pending.profitTarget.toLocaleString()}
              </span>
              {livePrice != null && (
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
              <button
                type="button"
                onClick={() => {
                  setPending(null)
                  setFillError(null)
                }}
                className="ml-auto rounded border border-sky-600/50 px-2 py-1 text-[10px] font-semibold uppercase text-sky-200 hover:bg-sky-900/50"
              >
                Cancel
              </button>
            </div>
          )}

          {fillError && (
            <p className="px-1 text-xs text-red-400">{fillError}</p>
          )}

          {inManage && managePos && (
            <ManageDeskBar
              position={managePos}
              currentPrice={livePrice}
              onClosed={(exitReason = 'manual') => {
                setManagePos(null)
                setPositionOverlay(null)
                void refreshLevelsAfterExit(exitReason)
              }}
              onRefreshGate={refreshGate}
            />
          )}

          <TradingChart
            onInstrumentChange={(i) => setInstrument(i as Instrument)}
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
            jumpToPriceRef={jumpToPriceRef}
            lockedInstrument={locked}
            onLevelSelect={handleLevelSelect}
            canPlaceOrder={canTrade && dataMode === 'live'}
            levelsRefreshKey={levelsRefreshKey}
            hideTradeLevels={!showDeskLevels}
          />
        </div>

        {orderLevel != null && !pending && !managePos && inEntry && (
          <LevelOrderTicket
            instrument={(locked || instrument) as Instrument}
            levelPrice={orderLevel}
            levelType={orderLevelType}
            entryReason={orderLevelReason}
            regime={regime}
            regimeConfidence={regimeConfidence}
            canPlace={canTrade && dataMode === 'live'}
            entryWindow={gate?.entryWindow ?? 1}
            onClose={() => {
              setOrderLevel(null)
              setOrderLevelType(undefined)
              setOrderLevelReason(undefined)
            }}
            onPlaced={handlePlaced}
          />
        )}
      </div>
    </div>
  )
}
