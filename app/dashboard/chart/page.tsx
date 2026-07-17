'use client'

/**
 * Chart Page — live morning desk only (afternoon is background memory).
 * NY:  DOW/NASDAQ  9:30–11:30 ET (entries 9:30–10:15)
 * Tokyo: NIKKEI    9:00–11:30 JST (entries 9:00–9:45)
 * After lunch: chart frozen — no new bars.
 */

import Link from 'next/link'
import { useState, useRef, useCallback, useEffect } from 'react'
import { TradingChart } from './components/TradingChart'
import { SessionBanner, type SessionGateState } from './components/SessionBanner'
import { LevelOrderTicket, type FilledOrder } from './components/LevelOrderTicket'
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
  const [gate, setGate] = useState<SessionGateState | null>(null)
  const [orderLevel, setOrderLevel] = useState<number | null>(null)
  const [orderLevelType, setOrderLevelType] = useState<string | undefined>()
  const [regime, setRegime] = useState<'bullish' | 'bearish' | 'choppy'>('bullish')
  const [regimeConfidence, setRegimeConfidence] = useState(70)
  const [gateTick, setGateTick] = useState(0)
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null)
  const [dataMode, setDataMode] = useState<'live' | 'synthetic'>('live')

  const [levelsRefreshKey, setLevelsRefreshKey] = useState(0)

  const jumpToPriceRef = useRef<((price: number) => void) | null>(null)
  const bannerRefreshRef = useRef<(() => void) | null>(null)

  const handleLevelSelect = useCallback((price: number, meta?: { type?: string }) => {
    if (managePos || positionOverlay) return // in a trade — no new level orders
    setOrderLevel(price)
    setOrderLevelType(meta?.type)
  }, [managePos, positionOverlay])

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
        /* non-fatal — still reload chart levels */
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
      .catch(() => {})
  }, [])

  // Load open position into manage desk + chart overlay when MANAGE
  useEffect(() => {
    if (gate?.phase !== 'MANAGE') {
      if (gate?.phase !== 'ENTRY') setManagePos(null)
      return
    }
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
  }, [gate?.phase, gate?.lockedInstrument, gate?.open_position_id, instrument, gateTick])

  const handleFilled = useCallback(
    (order: FilledOrder) => {
      setOrderLevel(null)
      setOrderLevelType(undefined)
      const dir = order.entry_direction === 'LONG' ? 'long' : 'short'
      setPositionOverlay({
        entryPrice: order.entry_price,
        stopLoss: order.stop_loss_price,
        profitTarget: order.profit_target_price,
        direction: dir,
      })
      setManagePos({
        id: order.position_id,
        instrument: (gate?.lockedInstrument || instrument) as string,
        entryPrice: order.entry_price,
        stopLoss: order.stop_loss_price,
        profitTarget: order.profit_target_price,
        direction: dir,
        positionSize: order.position_size,
        riskAmount: order.risk_amount,
      })
      refreshGate()
    },
    [gate?.lockedInstrument, instrument, refreshGate]
  )

  const locked = gate?.lockedInstrument ?? null
  const canTrade = !!gate?.canPlaceEntry
  const inManage = gate?.phase === 'MANAGE'

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
              {canTrade
                ? 'Trading open · click a level, the chart, or Place order'
                : inManage
                  ? 'MANAGE · HOLD or TAKE PROFIT'
                  : gate?.phase === 'RECOMMENDED'
                    ? 'Pre-open · levels prep — entries at cash open'
                    : 'Live morning desk · orders open→lunch when locked'}
            </span>
            <Link
              href="/dashboard/simulation"
              className="ml-auto rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/25 hover:text-white"
            >
              Simulation →
            </Link>
          </div>

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
            onPriceUpdate={setLivePrice}
            onQuoteTick={setLastQuoteAt}
            onDataModeChange={setDataMode}
            positionOverlay={positionOverlay ?? (managePos
              ? {
                  entryPrice: managePos.entryPrice,
                  stopLoss: managePos.stopLoss,
                  profitTarget: managePos.profitTarget,
                  direction: managePos.direction,
                }
              : null)}
            jumpToPriceRef={jumpToPriceRef}
            lockedInstrument={locked}
            onLevelSelect={handleLevelSelect}
            canPlaceOrder={!!gate?.canPlaceEntry && !positionOverlay && !managePos}
            levelsRefreshKey={levelsRefreshKey}
            hideTradeLevels={!!managePos || !!positionOverlay}
          />
        </div>

        {orderLevel != null && (
          <LevelOrderTicket
            instrument={(locked || instrument) as Instrument}
            levelPrice={orderLevel}
            levelType={orderLevelType}
            regime={regime}
            regimeConfidence={regimeConfidence}
            canPlace={!!gate?.canPlaceEntry}
            entryWindow={gate?.entryWindow ?? 1}
            onClose={() => {
              setOrderLevel(null)
              setOrderLevelType(undefined)
            }}
            onFilled={handleFilled}
          />
        )}
      </div>
    </div>
  )
}
