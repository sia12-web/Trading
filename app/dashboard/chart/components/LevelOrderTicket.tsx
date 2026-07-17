'use client'

/**
 * Limit order ticket — places a WORKING limit at the level.
 * Does NOT open a position / enter MANAGE until price fills the limit.
 */

import { useMemo, useState, useEffect } from 'react'
import { previewPositionSizing } from '@/lib/trading/positionSizing'
import { zoneStopPrice, formatZone } from '@/lib/trading/deskLevels'

type Direction = 'LONG' | 'SHORT'

/** Working limit — not yet filled. */
export interface PendingLimitOrder {
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  level: number
  levelType?: string
  entryReason?: string
  direction: Direction
  stopLoss: number
  profitTarget: number
  positionSize: number
  riskAmount: number
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
}

interface Props {
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  levelPrice: number
  levelType?: string
  entryReason?: string
  regime: 'bullish' | 'bearish' | 'choppy'
  regimeConfidence: number
  canPlace: boolean
  entryWindow: 1 | 2 | 3
  onClose: () => void
  /** Called when the working limit is accepted — NOT when filled. */
  onPlaced: (order: PendingLimitOrder) => void
}

export function LevelOrderTicket({
  instrument,
  levelPrice,
  levelType,
  entryReason,
  regime,
  regimeConfidence,
  canPlace,
  entryWindow,
  onClose,
  onPlaced,
}: Props) {
  const suggested: Direction = regime === 'bearish' ? 'SHORT' : 'LONG'
  const [direction, setDirection] = useState<Direction>(suggested)
  const [accountSize, setAccountSize] = useState(100000)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDirection(suggested)
  }, [suggested, levelPrice])

  const preview = useMemo(
    () =>
      previewPositionSizing(
        levelPrice,
        accountSize,
        direction,
        zoneStopPrice(levelPrice, direction)
      ),
    [levelPrice, accountSize, direction]
  )

  const submit = () => {
    if (!canPlace) {
      setError(
        'Entries locked — morning session only (cash open → lunch), with a locked instrument and no open position'
      )
      return
    }
    if (!preview) {
      setError('Invalid account size or level price')
      return
    }
    onPlaced({
      instrument,
      level: levelPrice,
      levelType,
      entryReason:
        entryReason ||
        `${direction} at ${levelType || 'desk'} level ${levelPrice.toLocaleString()} — liquidity / stop-pool thesis`,
      direction,
      stopLoss: preview.stop_loss_price,
      profitTarget: preview.profit_target_price,
      positionSize: preview.position_size,
      riskAmount: preview.risk_amount,
      accountSize,
      entryWindow,
      regime,
      regimeConfidence,
      placedAt: Date.now(),
    })
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">Place working limit</h3>
            <p className="mt-1 text-xs text-gray-400">
              {instrument} · {levelType || 'AI level'} ·{' '}
              <span className="price-mono text-white">{levelPrice.toLocaleString()}</span>
              <span className="ml-1.5 text-gray-500">zone {formatZone(levelPrice)}</span>
            </p>
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
              onClick={() => setDirection(d)}
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
          Account size ($)
          <input
            type="number"
            value={accountSize}
            onChange={(e) => setAccountSize(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white price-mono"
          />
        </label>

        {preview && (
          <div className="mt-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2.5 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Limit price</span>
              <span className="price-mono text-sky-300 font-semibold">
                {levelPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Stop (beyond zone)</span>
              <span className="price-mono text-red-400 font-semibold">
                {preview.stop_loss_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Target (2R)</span>
              <span className="price-mono text-green-400">
                {preview.profit_target_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Position size</span>
              <span className="price-mono text-white">
                {preview.position_size.toFixed(2)} units
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Risk (max 5%, 5x cap)</span>
              <span className="price-mono text-amber-400">
                ${preview.risk_amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <button
          type="button"
          disabled={!canPlace || !preview}
          onClick={submit}
          className="mt-4 w-full rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:bg-sky-500"
        >
          {canPlace ? 'Place working limit' : 'Trading locked'}
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
