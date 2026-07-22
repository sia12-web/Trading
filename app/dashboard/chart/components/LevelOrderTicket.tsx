'use client'

/**
 * Limit order ticket — places a WORKING limit.
 * AI/structure: zone stop + desk risk (5%).
 * Manual: editable limit/SL/TP + 1% account risk (size auto-adjusts).
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import {
  DESK_RISK_PERCENT,
  MANUAL_RISK_PERCENT,
  normalizeEntrySource,
  previewPositionSizing,
  riskPercentForEntrySource,
  type DeskEntrySource,
} from '@/lib/trading/positionSizing'
import { zoneStopPrice, formatZone } from '@/lib/trading/deskLevels'
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
  onClose: () => void
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
  onClose,
  onPlaced,
}: Props) {
  const entrySource = normalizeEntrySource(
    entrySourceProp ||
      (levelType === 'manual' || levelType === 'market' ? 'manual' : undefined),
    levelType === 'structure' ? 'structure' : 'ai'
  )
  const isManual = entrySource === 'manual'
  const riskPct = riskPercentForEntrySource(entrySource)

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
  const [accountSize, setAccountSize] = useState(100000)
  const [limitPrice, setLimitPrice] = useState(levelPrice)
  const [stopInput, setStopInput] = useState(() =>
    isManual
      ? defaultManualStop(levelPrice, suggested)
      : zoneStopPrice(levelPrice, suggested)
  )
  const [tpInput, setTpInput] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const placingRef = useRef(false)
  const tick = instrumentTick(instrument)

  useEffect(() => {
    setDirection(suggested)
  }, [suggested, levelPrice])

  useEffect(() => {
    const snappedLimit = snapDeskPrice(instrument, levelPrice)
    setLimitPrice(snappedLimit)
    const dir = suggested
    const rawStop = isManual
      ? defaultManualStop(snappedLimit, dir)
      : zoneStopPrice(snappedLimit, dir)
    setStopInput(snapStopToTick(instrument, snappedLimit, rawStop, dir))
    setTpInput(null)
    placingRef.current = false
    setPlacing(false)
  }, [levelPrice, isManual, suggested, instrument])

  const snappedLimit = useMemo(
    () => snapDeskPrice(instrument, limitPrice),
    [instrument, limitPrice]
  )

  const stopForSizing = useMemo(() => {
    if (!isManual) {
      return snapStopToTick(
        instrument,
        snappedLimit,
        zoneStopPrice(snappedLimit, direction),
        direction
      )
    }
    if (!Number.isFinite(stopInput) || stopInput <= 0) return undefined
    const snapped = snapStopToTick(instrument, snappedLimit, stopInput, direction)
    const ok =
      direction === 'LONG' ? snapped < snappedLimit : snapped > snappedLimit
    return ok ? snapped : undefined
  }, [isManual, stopInput, snappedLimit, direction, instrument])

  const preview = useMemo(
    () =>
      previewPositionSizing(
        snappedLimit,
        accountSize,
        direction,
        stopForSizing,
        riskPct
      ),
    [snappedLimit, accountSize, direction, stopForSizing, riskPct]
  )

  const displayTpRaw = tpInput ?? preview?.profit_target_price ?? 0
  const displayTp =
    displayTpRaw > 0
      ? snapTargetToTick(instrument, snappedLimit, displayTpRaw, direction)
      : 0

  const submit = () => {
    if (placingRef.current) return
    if (!canPlace) {
      setError(
        'Entries locked — morning session only, max 2 stop-out attempts, locked instrument'
      )
      return
    }
    if (!preview) {
      setError(
        isManual
          ? 'Set a valid limit and stop (stop must be beyond the limit)'
          : 'Invalid account size or level price'
      )
      return
    }

    placingRef.current = true
    setPlacing(true)

    const limit = snappedLimit
    const stop = snapStopToTick(instrument, limit, preview.stop_loss_price, direction)
    let tp = displayTp
    if (!Number.isFinite(tp) || tp <= 0) {
      tp = snapTargetToTick(instrument, limit, preview.profit_target_price, direction)
    }
    if (direction === 'LONG' && tp <= limit) {
      placingRef.current = false
      setPlacing(false)
      setError('Take profit must be above the limit for LONG')
      return
    }
    if (direction === 'SHORT' && tp >= limit) {
      placingRef.current = false
      setPlacing(false)
      setError('Take profit must be below the limit for SHORT')
      return
    }

    // Re-size off snapped prices so risk stays exact
    const sized =
      previewPositionSizing(limit, accountSize, direction, stop, riskPct) ?? preview

    onPlaced({
      instrument,
      level: limit,
      levelType: isManual ? 'manual' : levelType,
      entrySource,
      entryReason:
        entryReason ||
        (isManual
          ? `Manual ${direction} limit @ ${limit.toLocaleString()} — ${riskPct}% risk`
          : `${direction} at ${levelType || 'desk'} level ${limit.toLocaleString()} — liquidity / stop-pool thesis`),
      direction,
      stopLoss: stop,
      profitTarget: tp,
      positionSize: sized.position_size,
      riskAmount: sized.risk_amount,
      riskPercent: riskPct,
      accountSize,
      entryWindow,
      regime,
      regimeConfidence,
      placedAt: Date.now(),
    })
  }

  const sourceBadge =
    entrySource === 'manual'
      ? 'Manual · 1% risk'
      : entrySource === 'structure'
        ? 'Structure · desk risk'
        : 'AI level · desk risk'

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
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
                <span className="ml-1.5 text-gray-500">zone {formatZone(levelPrice)}</span>
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
            <p className="mt-1 text-[10px] text-amber-400/90">
              MANAGE starts only after this limit fills — not when you place it.
            </p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              Morning desk · regime {regime} ({regimeConfidence}%)
              {canPlace ? ' · ready to place' : ' · trading locked'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white">
            ✕
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
          Account size ({deskCurrencyLabel()})
          <input
            type="number"
            value={accountSize}
            onChange={(e) => setAccountSize(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white price-mono"
          />
        </label>

        {isManual && (
          <>
            <label className="mt-3 block text-[10px] uppercase tracking-wider text-gray-500">
              Limit price
              <input
                type="number"
                value={limitPrice}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setLimitPrice(v)
                  setTpInput(null)
                }}
                className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white price-mono"
              />
            </label>
            <label className="mt-3 block text-[10px] uppercase tracking-wider text-gray-500">
              Stop loss
              <input
                type="number"
                value={stopInput}
                onChange={(e) => setStopInput(Number(e.target.value))}
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
              Risk fixed at {MANUAL_RISK_PERCENT}% of account — size adjusts when you widen or
              tighten the stop.
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
                {isManual ? 'Stop' : 'Stop (beyond zone)'}
              </span>
              <span className="price-mono text-red-400 font-semibold">
                {preview.stop_loss_price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Target {isManual ? '' : '(2R)'}</span>
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
                Risk ({riskPct}%{isManual ? '' : ` desk / ${DESK_RISK_PERCENT}%`})
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

        <button
          type="button"
          disabled={!canPlace || !preview || placing}
          onClick={submit}
          className="mt-4 w-full rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:bg-sky-500"
        >
          {!canPlace
            ? 'Trading locked'
            : placing
              ? 'Placing…'
              : 'Place working limit'}
        </button>
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
