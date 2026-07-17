'use client'

/**
 * Limit order ticket — click a level / chart during morning trading (open→lunch).
 * System sizes position (5% account risk) with zone-based stop.
 */

import { useMemo, useState, useEffect } from 'react'
import { previewPositionSizing } from '@/lib/trading/positionSizing'
import { zoneStopPrice, formatZone } from '@/lib/trading/deskLevels'

type Direction = 'LONG' | 'SHORT'

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
  regime: 'bullish' | 'bearish' | 'choppy'
  regimeConfidence: number
  canPlace: boolean
  entryWindow: 1 | 2 | 3
  onClose: () => void
  onFilled: (order: FilledOrder) => void
}

export function LevelOrderTicket({
  instrument,
  levelPrice,
  levelType,
  regime,
  regimeConfidence,
  canPlace,
  entryWindow,
  onClose,
  onFilled,
}: Props) {
  const suggested: Direction =
    regime === 'bearish' ? 'SHORT' : 'LONG'
  const [direction, setDirection] = useState<Direction>(suggested)
  const [accountSize, setAccountSize] = useState(100000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDirection(suggested)
  }, [suggested, levelPrice])

  // Zone-based stop: beyond the far edge of the level's zone (sweep-proof) —
  // identical to the simulation desk
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

  const submit = async () => {
    if (!canPlace) {
      setError('Entries locked — morning session only (cash open → lunch), with a locked instrument and no open position')
      return
    }
    if (!preview) {
      setError('Invalid account size or level price')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/trading/positions/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument,
          entry_price: levelPrice,
          entry_direction: direction,
          entry_window: entryWindow,
          account_size: accountSize,
          regime,
          regime_confidence: regimeConfidence,
          best_break_level: levelPrice,
          entry_source: 'chart_level',
          stop_loss_price: preview.stop_loss_price,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message || 'Order failed')
        return
      }
      onFilled({
        position_id: json.position_id,
        entry_price: json.entry_price ?? levelPrice,
        stop_loss_price: json.stop_loss_price ?? preview.stop_loss_price,
        position_size: json.position_size ?? preview.position_size,
        risk_amount: json.risk_amount ?? preview.risk_amount,
        entry_direction: direction,
        profit_target_price: preview.profit_target_price,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">AI level order</h3>
            <p className="mt-1 text-xs text-gray-400">
              {instrument} · {levelType || 'AI level'} ·{' '}
              <span className="price-mono text-white">{levelPrice.toLocaleString()}</span>
              <span className="ml-1.5 text-gray-500">zone {formatZone(levelPrice)}</span>
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
              Deep {d === 'LONG' ? 'Buy' : 'Short'}
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
            <div className="flex justify-between border-t border-[#21262d] pt-1.5">
              <span className="text-gray-500">Notional exposure</span>
              <span className="price-mono text-gray-300">
                ${preview.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <button
          type="button"
          disabled={busy || !canPlace || !preview}
          onClick={submit}
          className="mt-4 w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Submitting…' : canPlace ? 'Place limit & manage' : 'Trading locked'}
        </button>
      </div>
    </div>
  )
}
