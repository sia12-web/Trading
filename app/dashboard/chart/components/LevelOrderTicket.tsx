'use client'

/**
 * Limit order ticket — places a WORKING limit.
 * Strategy entries: ±10 range-edge gate + progressive session risk (2% → 1% → 0.5%).
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import {
  normalizeEntrySource,
  previewPositionSizing,
  previewPositionSizingFromRiskAmount,
  riskPercentForEntrySource,
  takeProfitFromStopR,
  type DeskEntrySource,
} from '@/lib/trading/positionSizing'
import {
  DESK_RISK_PROFILE_EVENT,
  getDeskRiskProfile,
  isTradeifyGrowth50k,
  type DeskRiskProfile,
} from '@/lib/trading/tradeifyProfile'
import {
  TRADEIFY_STARTING_BALANCE,
  formatTradeifyRiskChip,
  resolveTradeifyPlace,
  type TradeifyPlaceDecision,
} from '@/lib/trading/tradeifyGrowth50k'
import { formatZone } from '@/lib/trading/deskLevels'
import {
  strategyEntryRisk,
  strategyTakeProfitPrice,
  type StrategyRangeEdges,
  type StrategyRiskMagnets,
} from '@/lib/trading/strategyRiskGeometry'
import {
  assertRangeEdgeEntry,
  findRangeEdgeBandHit,
  RANGE_EDGE_BAND_POINTS,
  RANGE_EDGE_OFF_BAND_MESSAGE,
  rangeAllowsMidEdge,
  rangeEdgeBandLegend,
} from '@/lib/trading/rangeEdgeEntryGate'
import { assertProtectiveStop } from '@/lib/trading/stopLossGuard'
import {
  instrumentTick,
  snapDeskPrice,
  snapStopToTick,
  snapTargetToTick,
} from '@/lib/trading/instrumentTicks'
import { deskCurrencyLabel, formatDeskMoney } from '@/lib/trading/currency'

type Direction = 'LONG' | 'SHORT'

/** Working limit — not yet filled. */
export interface PendingLimitOrder {
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  level: number
  levelType?: string
  entryReason?: string
  /** How the limit was chosen */
  entrySource: DeskEntrySource
  direction: Direction
  stopLoss: number
  profitTarget: number
  positionSize: number
  riskAmount: number
  riskPercent: number
  accountSize: number
  entryWindow: 1 | 2 | 3
  regime: 'bullish' | 'bearish' | 'choppy'
  regimeConfidence: number
  placedAt: number
  riskProfile?: 'oanda_cash' | 'tradeify_growth_50k'
  /** Durable trades_journal row — required for TP amend while working */
  workingId?: string
  /** Active playbook range for ±10 entry gate (API + fill) */
  strategyRange?: StrategyRangeEdges | null
}

/** Filled position handed to MANAGE. */
export interface FilledOrder {
  position_id: string
  entry_price: number
  stop_loss_price: number
  position_size: number
  risk_amount: number
  entry_direction: Direction
  profit_target_price: number
  entry_source?: DeskEntrySource
}

interface Props {
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  levelPrice: number
  levelType?: string
  /** Explicit playbook side — preferred over levelType parsing */
  levelSide?: 'BUY' | 'SHORT'
  /** Hard direction from playbook UI (Limit Buy ↔ LONG, Limit Short ↔ SHORT) */
  preferredDirection?: Direction
  entryReason?: string
  /** ai | structure | manual — defaults from levelType */
  entrySource?: DeskEntrySource | string
  regime: 'bullish' | 'bearish' | 'choppy'
  regimeConfidence: number
  canPlace: boolean
  entryWindow: 1 | 2 | 3
  /**
   * Live desk: fetch OANDA NAV for sizing (default true).
   * Simulation: set false and pass initialAccountSize (paper equity).
   */
  useLiveAccount?: boolean
  /** Fallback / sim equity before live NAV loads */
  initialAccountSize?: number
  /** Active playbook range for strategy SL/TP (AI/structure only) */
  strategyRange?: StrategyRangeEdges | null
  strategyMagnets?: StrategyRiskMagnets | null
  /** Advise-only ATR pad/trail line from chart */
  atrAdviceLine?: string | null
  /** Already-decided manual SL/TP (from the risk-box / journal rationale flow) */
  presetStopLoss?: number | null
  presetProfitTarget?: number | null
  /**
   * Skip the confirmation UI and submit as soon as sizing is ready — used
   * when the trader already confirmed entry + SL/TP + rationale upstream
   * (risk-box drag + journal modal) so there is no second "place limit"
   * dialog to click through.
   */
  autoConfirm?: boolean
  /** Filled session attempts so far (working limits excluded) — drives 2→1→0.5% */
  sessionFillsUsed?: number
  onClose: () => void
  /** Auto-confirm submit failed — parent should surface this (ticket UI is hidden). */
  onAutoConfirmError?: (message: string) => void
  /** Called when the working limit is accepted — NOT when filled. */
  onPlaced: (order: PendingLimitOrder) => void
}

function defaultManualStop(limit: number, direction: Direction): number {
  // ~0.35% protective stop when user hasn't set one yet
  const pct = 0.0035
  return direction === 'LONG' ? limit * (1 - pct) : limit * (1 + pct)
}

export function LevelOrderTicket({
  instrument,
  levelPrice,
  levelType,
  levelSide,
  preferredDirection,
  entryReason,
  entrySource: entrySourceProp,
  regime,
  regimeConfidence,
  canPlace,
  entryWindow,
  useLiveAccount = true,
  initialAccountSize,
  strategyRange = null,
  strategyMagnets = null,
  atrAdviceLine = null,
  presetStopLoss = null,
  presetProfitTarget = null,
  autoConfirm = false,
  sessionFillsUsed = 0,
  onClose,
  onAutoConfirmError,
  onPlaced,
}: Props) {
  const entrySource = normalizeEntrySource(
    entrySourceProp ||
      (levelType === 'manual' || levelType === 'market' ? 'manual' : undefined),
    levelType === 'structure' ? 'structure' : 'ai'
  )
  const isManual = entrySource === 'manual'
  const [riskProfile, setRiskProfile] = useState<DeskRiskProfile>('tradeify_growth_50k')
  const [tradeifyDecision, setTradeifyDecision] = useState<TradeifyPlaceDecision | null>(
    null
  )
  const tradeifyOn = isTradeifyGrowth50k(riskProfile)
  const tradeifyFills = tradeifyDecision?.fillsUsed ?? sessionFillsUsed
  const oandaRiskPct = riskPercentForEntrySource(entrySource, sessionFillsUsed)
  const riskPct = tradeifyOn
    ? tradeifyDecision
      ? (tradeifyDecision.riskDollars / TRADEIFY_STARTING_BALANCE) * 100
      : 0.8
    : oandaRiskPct

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
    if (!tradeifyOn) {
      setTradeifyDecision(null)
      return
    }
    let cancelled = false
    fetch('/api/trading/tradeify-snapshot', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return
        if (json?.ok) {
          setTradeifyDecision(
            resolveTradeifyPlace({
              fillsUsed: json.fillsUsed,
              dailyPnl: json.dailyPnl,
              stopOutsToday: json.stopOutsToday,
            })
          )
          return
        }
        setTradeifyDecision(resolveTradeifyPlace({ fillsUsed: sessionFillsUsed }))
      })
      .catch(() => {
        if (!cancelled) {
          setTradeifyDecision(resolveTradeifyPlace({ fillsUsed: sessionFillsUsed }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [tradeifyOn, sessionFillsUsed])

  // preferredDirection / playbook side win; then type; regime last
  const typeLower = String(levelType || '').toLowerCase()
  const fromLevel: Direction | null =
    preferredDirection === 'SHORT' || preferredDirection === 'LONG'
      ? preferredDirection
      : levelSide === 'SHORT'
        ? 'SHORT'
        : levelSide === 'BUY'
          ? 'LONG'
          : typeLower.includes('resist') ||
              typeLower.includes('short') ||
              typeLower.includes('supply') ||
              typeLower === 'sell'
            ? 'SHORT'
            : typeLower.includes('support') ||
                typeLower.includes('long') ||
                typeLower.includes('buy') ||
                typeLower.includes('demand')
              ? 'LONG'
              : null
  const suggested: Direction =
    fromLevel ?? (regime === 'bearish' ? 'SHORT' : 'LONG')
  const [direction, setDirection] = useState<Direction>(suggested)
  const seedAccount =
    typeof initialAccountSize === 'number' &&
    Number.isFinite(initialAccountSize) &&
    initialAccountSize >= 100
      ? initialAccountSize
      : 100000
  const [accountSize, setAccountSize] = useState(seedAccount)
  const [accountSource, setAccountSource] = useState<'live' | 'paper' | 'fallback'>(
    useLiveAccount ? 'fallback' : 'paper'
  )
  const [accountLoading, setAccountLoading] = useState(useLiveAccount)
  const [marginAvailable, setMarginAvailable] = useState<number | null>(null)
  const [limitPrice, setLimitPrice] = useState(levelPrice)
  const [stopInput, setStopInput] = useState(() => {
    if (isManual) {
      return presetStopLoss != null && Number.isFinite(presetStopLoss)
        ? presetStopLoss
        : defaultManualStop(levelPrice, suggested)
    }
    const strat = strategyEntryRisk({
      entry: levelPrice,
      direction: suggested,
      activeRange: strategyRange,
      magnets: strategyMagnets,
    })
    return strat.stop
  })
  const [tpInput, setTpInput] = useState<number | null>(() => {
    if (isManual) {
      return presetProfitTarget != null && Number.isFinite(presetProfitTarget)
        ? presetProfitTarget
        : null
    }
    if (!strategyRange) return null
    const strat = strategyEntryRisk({
      entry: levelPrice,
      direction: suggested,
      activeRange: strategyRange,
      magnets: strategyMagnets,
    })
    return strat.target
  })
  const [error, setError] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const placingRef = useRef(false)
  const tick = instrumentTick(instrument)

  useEffect(() => {
    setDirection(suggested)
  }, [suggested, levelPrice])

  // Live desk: size from real OANDA NAV (same equity the open API uses)
  useEffect(() => {
    if (!useLiveAccount) {
      setAccountSource('paper')
      setAccountLoading(false)
      if (
        typeof initialAccountSize === 'number' &&
        Number.isFinite(initialAccountSize) &&
        initialAccountSize >= 100
      ) {
        setAccountSize(initialAccountSize)
      }
      return
    }

    let cancelled = false
    setAccountLoading(true)
    fetch('/api/trading/oanda/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.ok) {
          if (!cancelled) {
            setAccountSource('fallback')
            setAccountLoading(false)
          }
          return
        }
        const nav = Number(data.NAV ?? data.balance)
        const free = Number(data.marginAvailable)
        if (Number.isFinite(nav) && nav >= 100) {
          setAccountSize(Math.round(nav * 100) / 100)
          setAccountSource('live')
        } else {
          setAccountSource('fallback')
        }
        if (Number.isFinite(free) && free >= 0) {
          setMarginAvailable(Math.round(free * 100) / 100)
        }
        setAccountLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setAccountSource('fallback')
          setAccountLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [useLiveAccount, initialAccountSize])

  useEffect(() => {
    // Snap into a painted ±10 band when in-band; never soft-clamp off-band into a
    // placeable price (that silently moved structure picks and accepted outside).
    let seed = levelPrice
    if (strategyRange != null) {
      const hit = findRangeEdgeBandHit(levelPrice, [strategyRange])
      if (hit) {
        seed = hit.center
      }
      // Off-band seed stays as-is so submit's assertRangeEdgeEntry rejects.
    }
    const snappedLimit = snapDeskPrice(instrument, seed)
    setLimitPrice(snappedLimit)
    const dir = suggested
    if (isManual) {
      const baseStop =
        presetStopLoss != null && Number.isFinite(presetStopLoss)
          ? presetStopLoss
          : defaultManualStop(snappedLimit, dir)
      const guard = assertProtectiveStop({
        instrument,
        entry: snappedLimit,
        stop: baseStop,
        direction: dir,
        plannedStop: baseStop,
      })
      setStopInput(guard.ok ? guard.stop : baseStop)
      setTpInput(
        presetProfitTarget != null && Number.isFinite(presetProfitTarget)
          ? snapTargetToTick(instrument, snappedLimit, presetProfitTarget, dir)
          : null
      )
    } else {
      const strat = strategyEntryRisk({
        entry: snappedLimit,
        direction: dir,
        activeRange: strategyRange,
        magnets: strategyMagnets,
      })
      setStopInput(snapStopToTick(instrument, snappedLimit, strat.stop, dir))
      setTpInput(
        strategyRange
          ? snapTargetToTick(instrument, snappedLimit, strat.target, dir)
          : null
      )
    }
    placingRef.current = false
    setPlacing(false)
  }, [
    levelPrice,
    isManual,
    suggested,
    instrument,
    strategyRange,
    strategyMagnets,
    presetStopLoss,
    presetProfitTarget,
  ])

  const snappedLimit = useMemo(
    () => snapDeskPrice(instrument, limitPrice),
    [instrument, limitPrice]
  )

  const strategyRisk = useMemo(() => {
    if (isManual) return null
    return strategyEntryRisk({
      entry: snappedLimit,
      direction,
      activeRange: strategyRange,
      magnets: strategyMagnets,
    })
  }, [
    isManual,
    snappedLimit,
    direction,
    strategyRange,
    strategyMagnets,
  ])

  const stopForSizing = useMemo(() => {
    if (!isManual) {
      if (!strategyRisk) return undefined
      return snapStopToTick(
        instrument,
        snappedLimit,
        strategyRisk.stop,
        direction
      )
    }
    if (!Number.isFinite(stopInput) || stopInput <= 0) return undefined
    const snapped = snapStopToTick(instrument, snappedLimit, stopInput, direction)
    const ok =
      direction === 'LONG' ? snapped < snappedLimit : snapped > snappedLimit
    return ok ? snapped : undefined
  }, [
    isManual,
    stopInput,
    snappedLimit,
    direction,
    instrument,
    strategyRisk,
  ])

  const preview = useMemo(() => {
    if (tradeifyOn && tradeifyDecision && stopForSizing != null) {
      if (!tradeifyDecision.allowed) return null
      return previewPositionSizingFromRiskAmount(
        snappedLimit,
        TRADEIFY_STARTING_BALANCE,
        direction,
        stopForSizing,
        tradeifyDecision.riskDollars
      )
    }
    return previewPositionSizing(
      snappedLimit,
      accountSize,
      direction,
      stopForSizing,
      riskPct
    )
  }, [
    tradeifyOn,
    tradeifyDecision,
    snappedLimit,
    accountSize,
    direction,
    stopForSizing,
    riskPct,
  ])

  const strategyTp = useMemo(() => {
    if (!strategyRisk || !strategyRange || !stopForSizing) return null
    return strategyTakeProfitPrice({
      entry: snappedLimit,
      stop: stopForSizing,
      direction,
      activeRange: strategyRange,
      magnets: strategyMagnets,
    })
  }, [
    strategyRisk,
    strategyRange,
    strategyMagnets,
    snappedLimit,
    direction,
    stopForSizing,
  ])

  const displayTpRaw = tpInput ?? strategyTp ?? preview?.profit_target_price ?? 0
  const displayTp =
    displayTpRaw > 0
      ? snapTargetToTick(instrument, snappedLimit, displayTpRaw, direction)
      : 0

  const failSubmit = (message: string) => {
    setError(message)
    if (autoConfirm) {
      onAutoConfirmError?.(message)
      onClose?.()
    }
  }

  const submit = () => {
    if (placingRef.current) return false
    if (useLiveAccount && accountLoading) {
      failSubmit('Wait for live OANDA equity to load before placing')
      return false
    }
    if (!canPlace) {
      failSubmit(
        'Entries locked — check session gate / attempt ladder / locked instrument'
      )
      return false
    }
    if (tradeifyOn && tradeifyDecision && !tradeifyDecision.allowed) {
      failSubmit(tradeifyDecision.refuseMessage)
      return false
    }
    const edge = assertRangeEdgeEntry({ entry: snappedLimit, range: strategyRange })
    if (!edge.ok) {
      failSubmit(edge.message)
      return false
    }
    if (!preview) {
      failSubmit(
        isManual
          ? 'Set a valid limit and stop (stop must be beyond the limit)'
          : 'Invalid account size or level price'
      )
      return false
    }

    placingRef.current = true
    setPlacing(true)

    const limit = snappedLimit
    const stopGuard = assertProtectiveStop({
      instrument,
      entry: limit,
      stop: isManual && Number.isFinite(stopInput) ? stopInput : preview.stop_loss_price,
      direction,
      plannedStop: isManual && Number.isFinite(stopInput) ? stopInput : preview.stop_loss_price,
    })
    if (!stopGuard.ok) {
      placingRef.current = false
      setPlacing(false)
      failSubmit(stopGuard.message)
      return false
    }
    const stop = stopGuard.stop
    let tp = displayTp
    if (!Number.isFinite(tp) || tp <= 0) {
      tp = snapTargetToTick(instrument, limit, preview.profit_target_price, direction)
    }
    if (direction === 'LONG' && tp <= limit) {
      placingRef.current = false
      setPlacing(false)
      failSubmit('Take profit must be above the limit for LONG')
      return false
    }
    if (direction === 'SHORT' && tp >= limit) {
      placingRef.current = false
      setPlacing(false)
      failSubmit('Take profit must be below the limit for SHORT')
      return false
    }

    // Re-size off snapped prices so risk stays exact
    const sized =
      (tradeifyOn && tradeifyDecision
        ? previewPositionSizingFromRiskAmount(
            limit,
            TRADEIFY_STARTING_BALANCE,
            direction,
            stop,
            tradeifyDecision.riskDollars
          )
        : previewPositionSizing(limit, accountSize, direction, stop, riskPct)) ?? preview

    onPlaced({
      instrument,
      level: limit,
      levelType: isManual ? 'manual' : levelType,
      entrySource,
      entryReason:
        entryReason ||
        (isManual
          ? `Manual ${direction} limit @ ${limit.toLocaleString()} — ${
              tradeifyOn
                ? formatTradeifyRiskChip(tradeifyFills)
                : `${riskPct}% risk`
            }`
          : `${direction} at ${levelType || 'desk'} level ${limit.toLocaleString()} — liquidity / stop-pool thesis`),
      direction,
      stopLoss: stop,
      profitTarget: tp,
      positionSize: sized.position_size,
      riskAmount: sized.risk_amount,
      riskPercent: sized.risk_percent,
      accountSize: tradeifyOn ? TRADEIFY_STARTING_BALANCE : accountSize,
      riskProfile: tradeifyOn ? 'tradeify_growth_50k' : 'oanda_cash',
      entryWindow,
      regime,
      regimeConfidence,
      placedAt: Date.now(),
      strategyRange: strategyRange ?? null,
    })
    return true
  }

  // Auto-confirm (risk-box flow already collected entry + SL/TP) — submit as
  // soon as live sizing is ready, no second "place limit" dialog.
  useEffect(() => {
    if (!autoConfirm) return
    if (placingRef.current) return
    if (useLiveAccount && accountLoading) return
    submit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoConfirm,
    useLiveAccount,
    accountLoading,
    snappedLimit,
    stopForSizing,
    direction,
    canPlace,
    strategyRange,
    preview,
  ])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return
        e.preventDefault()
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // No second confirmation dialog for risk-box / journal-rationale entries —
  // the auto-confirm effect above submits as soon as sizing is ready.
  if (autoConfirm) return null

  const sourceBadge = tradeifyOn
    ? `${entrySource === 'manual' ? 'Manual' : entrySource === 'structure' ? 'Structure' : 'AI'} · ${formatTradeifyRiskChip(tradeifyFills)}`
    : entrySource === 'manual'
      ? `Manual · ${riskPct}% risk (fill ${Math.min(sessionFillsUsed + 1, 3)}/3)`
      : entrySource === 'structure'
        ? `Structure · ${riskPct}% risk (fill ${Math.min(sessionFillsUsed + 1, 3)}/3)`
        : `AI level · ${riskPct}% risk (fill ${Math.min(sessionFillsUsed + 1, 3)}/3)`

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-surface-600 bg-[#161b22] p-5 shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              {isManual ? 'Place manual limit' : 'Place working limit'}
            </h3>
            <p className="mt-1 text-xs text-gray-400">
              {instrument} ·{' '}
              <span
                className={
                  entrySource === 'manual'
                    ? 'text-amber-300'
                    : entrySource === 'structure'
                      ? 'text-violet-300'
                      : 'text-emerald-300'
                }
              >
                {sourceBadge}
              </span>
            </p>
            {!isManual && (
              <p className="mt-1 text-xs text-gray-400">
                <span className="price-mono text-white">{levelPrice.toLocaleString()}</span>
                {strategyRange ? (
                  <span className="ml-1.5 text-sky-400/90">
                    {strategyRisk?.stopSource === 'range'
                      ? `SL beyond ${strategyRange.label}`
                      : `SL zone floor · TP from ${strategyRange.label}`}
                  </span>
                ) : (
                  <span className="ml-1.5 text-gray-500">zone {formatZone(levelPrice)}</span>
                )}
              </p>
            )}
            {entryReason && entryReason.trim() && (
              <p className="mt-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-2.5 py-2 text-[11px] leading-snug text-gray-300">
                <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-violet-300/90">
                  Why this level
                </span>
                {entryReason.trim()}
              </p>
            )}
            {atrAdviceLine && (
              <p
                className="mt-1.5 rounded-lg border border-violet-500/25 bg-violet-500/5 px-2.5 py-1.5 text-[10px] leading-snug text-violet-200/90"
                title="Advise only — does not auto-move SL/TP"
              >
                {atrAdviceLine}
              </p>
            )}
            <p className="mt-1 text-[10px] text-amber-400/90">
              MANAGE starts only after this limit fills — not when you place it.
            </p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              Morning desk · regime {regime} ({regimeConfidence}%)
              {canPlace ? ' · ready to place' : ' · trading locked'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 rounded-lg border border-surface-500 bg-surface-700/80 px-2.5 py-1 text-xs font-bold text-gray-300 transition hover:bg-red-600 hover:border-red-500 hover:text-white shrink-0"
            title="Close order ticket (Esc)"
          >
            <span>✕</span>
            <span>Close</span>
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          {(['LONG', 'SHORT'] as Direction[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDirection(d)
                if (isManual) {
                  setStopInput(defaultManualStop(limitPrice, d))
                  setTpInput(null)
                } else {
                  const strat = strategyEntryRisk({
                    entry: snappedLimit,
                    direction: d,
                    activeRange: strategyRange,
                    magnets: strategyMagnets,
                  })
                  setStopInput(
                    snapStopToTick(instrument, snappedLimit, strat.stop, d)
                  )
                  setTpInput(
                    strategyRange
                      ? snapTargetToTick(instrument, snappedLimit, strat.target, d)
                      : null
                  )
                }
              }}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                direction === d
                  ? d === 'LONG'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-red-600 text-white'
                  : 'bg-[#21262d] text-gray-400'
              }`}
            >
              Limit {d === 'LONG' ? 'Buy' : 'Short'}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-[10px] uppercase tracking-wider text-gray-500">
          {tradeifyOn
            ? 'Tradeify Growth $50k (sizing account)'
            : accountSource === 'live'
            ? `Live OANDA NAV (${deskCurrencyLabel()})`
            : accountSource === 'paper'
              ? `Paper account (${deskCurrencyLabel()})`
              : `Account size (${deskCurrencyLabel()})`}
          <input
            type="number"
            value={tradeifyOn ? TRADEIFY_STARTING_BALANCE : accountSize}
            readOnly={tradeifyOn || accountSource === 'live'}
            onChange={(e) => {
              if (accountSource === 'live') return
              setAccountSize(Number(e.target.value) || 0)
            }}
            className={`mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white price-mono ${
              accountSource === 'live' ? 'opacity-90 cursor-default' : ''
            }`}
          />
        </label>
        {accountLoading && (
          <p className="mt-1 text-[10px] text-sky-400/90">Loading live OANDA equity…</p>
        )}
        {tradeifyOn && tradeifyDecision && (
          <p
            className={`mt-1 text-[10px] ${
              tradeifyDecision.allowed ? 'text-sky-300/90' : 'text-red-300'
            }`}
          >
            {tradeifyDecision.allowed
              ? `${formatTradeifyRiskChip(tradeifyFills)} · leftover DLL $${Math.round(tradeifyDecision.leftoverDll)} · floor room $${Math.round(tradeifyDecision.floorRoom)}`
              : tradeifyDecision.refuseMessage}
          </p>
        )}
        {!tradeifyOn && !accountLoading && accountSource === 'live' && (
          <p className="mt-1 text-[10px] text-emerald-400/90">
            Risk = {riskPct}% of live NAV
            {marginAvailable != null
              ? ` · free margin ${formatDeskMoney(marginAvailable)}`
              : ''}
            {' '}(server re-checks OANDA on place)
          </p>
        )}
        {!accountLoading && accountSource === 'fallback' && useLiveAccount && (
          <p className="mt-1 text-[10px] text-amber-300/90">
            OANDA NAV unavailable — edit size carefully; place still prefers live equity when
            connected.
          </p>
        )}

        {isManual && (
          <>
            <div className="mt-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  Limit price (locked to band)
                </span>
                <span className="price-mono text-sky-300 font-semibold">
                  {snappedLimit.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
            {strategyRange && (
              <p className="mt-1 text-[10px] text-sky-400/80">
                {rangeAllowsMidEdge(strategyRange)
                  ? RANGE_EDGE_OFF_BAND_MESSAGE
                  : `Entry only at highlighted ±${RANGE_EDGE_BAND_POINTS} ${rangeEdgeBandLegend(strategyRange)}.`}{' '}
                Entry stays on ±{RANGE_EDGE_BAND_POINTS} of {strategyRange.label || 'range'} H (
                {strategyRange.high.toLocaleString()})
                {rangeAllowsMidEdge(strategyRange) ? ' / 50% mid' : ''} / L (
                {strategyRange.low.toLocaleString()}) — on chart, drag entry between those band centers; adjust TP / SL here.
              </p>
            )}
            <label className="mt-3 block text-[10px] uppercase tracking-wider text-gray-500">
              Stop loss
              <input
                type="number"
                value={stopInput}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setStopInput(next)
                  // SL edit → TP tracks 1.5R (initial ticket is always 1:1.5)
                  if (
                    Number.isFinite(next) &&
                    next > 0 &&
                    (direction === 'LONG' ? next < snappedLimit : next > snappedLimit)
                  ) {
                    const rawTp = takeProfitFromStopR({
                      entry: snappedLimit,
                      stop: next,
                      direction,
                    })
                    setTpInput(
                      snapTargetToTick(instrument, snappedLimit, rawTp, direction)
                    )
                  }
                }}
                className="mt-1 w-full rounded-lg border border-red-900/40 bg-[#0d1117] px-3 py-2 text-sm text-red-300 price-mono"
              />
            </label>
            <label className="mt-3 block text-[10px] uppercase tracking-wider text-gray-500">
              Take profit
              <input
                type="number"
                value={displayTp || ''}
                onChange={(e) => setTpInput(Number(e.target.value) || null)}
                className="mt-1 w-full rounded-lg border border-emerald-900/40 bg-[#0d1117] px-3 py-2 text-sm text-emerald-300 price-mono"
              />
            </label>
            <p className="mt-2 text-[10px] text-amber-300/90">
              {tradeifyOn
                ? `${formatTradeifyRiskChip(tradeifyFills)} · SL beyond the range · TP 1.5R (1:1.5) — size holds the dollar stop when you drag SL.`
                : `Risk steps 2% → 1% → 0.5% by session fill (this probe ${riskPct}%) — size adjusts when you widen or tighten the stop.`}
            </p>
          </>
        )}

        {preview && (
          <div className="mt-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2.5 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Limit price</span>
              <span className="price-mono text-sky-300 font-semibold">
                {snappedLimit.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">
                {isManual
                  ? 'Stop'
                  : strategyRisk?.stopSource === 'range' && strategyRange
                    ? `Stop (beyond ${strategyRange.label})`
                    : 'Stop (zone floor)'}
              </span>
              <span className="price-mono text-red-400 font-semibold">
                {preview.stop_loss_price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">
                {isManual
                  ? 'Target'
                  : strategyRange
                    ? `Target (${strategyRange.label} / magnets)`
                    : 'Target (1.5R)'}
              </span>
              <span className="price-mono text-green-400">
                {displayTp.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Position size</span>
              <span className="price-mono text-white">
                {preview.position_size.toFixed(2)} units
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">
                Risk ({riskPct}%)
              </span>
              <span className="price-mono text-amber-400">
                {formatDeskMoney(preview.risk_amount, { compact: true })}
              </span>
            </div>
            <p className="pt-1 text-[10px] text-gray-600">
              Prices snap to {tick}-pt ticks — what you confirm is what prints.
            </p>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-surface-600 bg-surface-800 py-2.5 text-xs font-semibold text-gray-300 hover:bg-surface-700 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canPlace || !preview || placing || (useLiveAccount && accountLoading)}
            onClick={submit}
            className="flex-[2] rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:bg-sky-500"
          >
            {!canPlace
              ? 'Trading locked'
              : useLiveAccount && accountLoading
                ? 'Loading equity…'
                : placing
                  ? 'Placing…'
                  : 'Place working limit'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** True when live price / bar would fill a resting limit. */
export function limitWouldFill(
  direction: Direction,
  level: number,
  price: number
): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(level) || price <= 0) return false
  // Buy limit fills at or below; sell/short limit fills at or above
  return direction === 'LONG' ? price <= level : price >= level
}

/** True when a candle's range touches the limit (same rule as simulation desk). */
export function barTouchesLimit(
  bar: { high: number; low: number },
  level: number
): boolean {
  return bar.low <= level && bar.high >= level
}

export type { DeskEntrySource }
