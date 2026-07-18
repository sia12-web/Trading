'use client'

/**
 * MANAGE phase desk — process-focused (no live $ P&L).
 * Shows SL/TP path + AI verdict so you know manage is working without scorekeeping.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type Direction = 'long' | 'short'

export interface ManagePosition {
  id: string
  instrument: string
  entryPrice: number
  stopLoss: number
  profitTarget: number
  direction: Direction
  positionSize: number
  riskAmount: number
}

export interface AiVerdict {
  verdict: 'pullback' | 'reversal' | 'hold' | string
  confidence: number
  reason: string
  news_score?: number
  headlines?: string[]
  move_pct?: number
  closed?: boolean
}

interface Props {
  position: ManagePosition
  currentPrice: number | null
  onClosed: (exitReason?: 'stop_hit' | 'take_profit' | 'manual' | 'ai_signal') => void
  onRefreshGate: () => void
  /** Mirror AI manage verdict onto the chart canvas */
  onAiVerdict?: (verdict: AiVerdict | null) => void
}

export function ManageDeskBar({
  position,
  currentPrice,
  onClosed,
  onRefreshGate,
  onAiVerdict,
}: Props) {
  const [ai, setAi] = useState<AiVerdict | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const exitingRef = useRef(false)
  const priceRef = useRef(currentPrice)

  useEffect(() => {
    priceRef.current = currentPrice
  }, [currentPrice])

  useEffect(() => {
    onAiVerdict?.(ai)
  }, [ai, onAiVerdict])

  useEffect(() => {
    return () => onAiVerdict?.(null)
  }, [onAiVerdict])

  const isLong = position.direction === 'long'
  /** Path progress 0→1 toward TP (neutral — not framed as win/loss $). */
  const pathToTp =
    currentPrice != null
      ? (() => {
          const span = isLong
            ? position.profitTarget - position.entryPrice
            : position.entryPrice - position.profitTarget
          if (!Number.isFinite(span) || Math.abs(span) < 1e-9) return null
          const moved = isLong
            ? currentPrice - position.entryPrice
            : position.entryPrice - currentPrice
          return Math.max(0, Math.min(1, moved / span))
        })()
      : null
  const riskToSl =
    currentPrice != null
      ? (() => {
          const span = isLong
            ? position.entryPrice - position.stopLoss
            : position.stopLoss - position.entryPrice
          if (!Number.isFinite(span) || Math.abs(span) < 1e-9) return null
          const left = isLong
            ? currentPrice - position.stopLoss
            : position.stopLoss - currentPrice
          return Math.max(0, Math.min(1, left / span))
        })()
      : null

  const pollAi = useCallback(async () => {
    try {
      const res = await fetch('/api/trading/positions/ai-exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          current_price: priceRef.current ?? undefined,
        }),
      })
      if (!res.ok) return
      const json = await res.json()
      setAi({
        verdict: json.verdict,
        confidence: json.confidence,
        reason: json.reason,
        news_score: json.news_score,
        headlines: json.headlines,
        move_pct: json.move_pct,
        closed: json.closed,
      })
      if (json.closed) {
        setMsg('AI closed on reversal')
        onClosed('ai_signal')
        onRefreshGate()
      }
    } catch {
      /* keep last */
    }
  }, [position.id, onClosed, onRefreshGate])

  useEffect(() => {
    pollAi()
    const id = setInterval(pollAi, 45000)
    return () => clearInterval(id)
  }, [pollAi])

  // Auto-exit when live price hits stop or take-profit
  useEffect(() => {
    if (exitingRef.current) return
    if (currentPrice == null || !Number.isFinite(currentPrice)) return
    const hitSl = isLong
      ? currentPrice <= position.stopLoss
      : currentPrice >= position.stopLoss
    const hitTp = isLong
      ? currentPrice >= position.profitTarget
      : currentPrice <= position.profitTarget
    if (!hitSl && !hitTp) return

    exitingRef.current = true
    let cancelled = false
    ;(async () => {
      const exitReason = hitSl ? 'stop_hit' : 'take_profit'
      const exitPrice = hitSl ? position.stopLoss : position.profitTarget
      try {
        const closeRes = await fetch('/api/trading/positions/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_id: position.id,
            instrument: position.instrument,
            exit_price: exitPrice,
            exit_reason: hitSl ? 'stop_hit' : 'take_profit',
            reason: hitSl
              ? `Stop loss hit — price reached ${exitPrice}`
              : `Take profit hit — price reached ${exitPrice}`,
          }),
        })
        if (cancelled) return
        const closeJson = await closeRes.json()
        if (!closeRes.ok || !closeJson.success) {
          exitingRef.current = false
          setMsg(closeJson.message || `${exitReason} close failed`)
          return
        }
        setMsg(
          hitSl
            ? `STOP HIT @ ${exitPrice.toLocaleString()}`
            : `TAKE PROFIT @ ${exitPrice.toLocaleString()}`
        )
        onClosed(exitReason)
        onRefreshGate()
      } catch {
        if (!cancelled) {
          exitingRef.current = false
          setMsg('Auto-exit failed')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    currentPrice,
    isLong,
    position.id,
    position.instrument,
    position.stopLoss,
    position.profitTarget,
    onClosed,
    onRefreshGate,
  ])

  const decide = async (decision_type: 'HOLD' | 'TAKE_PROFIT') => {
    setBusy(decision_type)
    setMsg(null)
    try {
      await fetch('/api/trading/positions/management-decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          decision_type,
          notes: ai?.reason ?? null,
        }),
      })

      if (decision_type === 'TAKE_PROFIT') {
        const exitPrice = currentPrice ?? position.entryPrice
        const closeRes = await fetch('/api/trading/positions/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_id: position.id,
            instrument: position.instrument,
            exit_price: exitPrice,
            exit_reason: 'take_profit',
            reason: ai?.reason
              ? `Manual take profit — ${ai.reason}`
              : `Manual take profit at ${exitPrice}`,
          }),
        })
        const closeJson = await closeRes.json()
        if (!closeRes.ok || !closeJson.success) {
          setMsg(closeJson.message || 'Close failed')
          return
        }
        setMsg(`Closed @ ${exitPrice.toLocaleString()} — session flat`)
        onClosed('take_profit')
        onRefreshGate()
        return
      }

      setMsg('HOLD recorded — manage still watching')
    } catch {
      setMsg('Decision failed')
    } finally {
      setBusy(null)
    }
  }

  const verdictColor =
    ai?.verdict === 'reversal'
      ? 'text-red-400'
      : ai?.verdict === 'pullback'
        ? 'text-amber-400'
        : 'text-emerald-400'

  return (
    <div className="rounded-xl border border-amber-800/40 bg-[#161b22] px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="font-bold px-2 py-0.5 rounded border border-amber-700/60 bg-amber-950/40 text-amber-200">
          MANAGE · {isLong ? 'LONG' : 'SHORT'} {position.instrument}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-sky-400/90">
          {ai ? 'AI watching' : 'Arming…'}
        </span>
        <span className="text-gray-500">
          Entry{' '}
          <span className="price-mono text-blue-400">
            {position.entryPrice.toLocaleString()}
          </span>
        </span>
        <span className="text-gray-500">
          SL{' '}
          <span className="price-mono text-red-400">
            {position.stopLoss.toLocaleString()}
          </span>
        </span>
        <span className="text-gray-500">
          TP{' '}
          <span className="price-mono text-emerald-400/80">
            {position.profitTarget.toLocaleString()}
          </span>
        </span>
        {/* Process meters — no live $ P&L (keeps manage calm) */}
        <span className="ml-auto flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wide text-gray-500">
          {pathToTp != null && (
            <span title="Progress from entry toward take-profit (not P&L)">
              Path to TP{' '}
              <span className="price-mono text-sky-300 normal-case">
                {Math.round(pathToTp * 100)}%
              </span>
            </span>
          )}
          {riskToSl != null && (
            <span title="Room left before stop (not P&L)">
              Room to SL{' '}
              <span className="price-mono text-gray-300 normal-case">
                {Math.round(riskToSl * 100)}%
              </span>
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-3 text-[11px]">
        <div className="flex-1 min-w-[200px]">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
            Manage check · process only
          </div>
          {ai ? (
            <>
              <span className={`font-semibold uppercase ${verdictColor}`}>
                {ai.verdict}
              </span>
              <span className="text-gray-600 ml-2">{ai.confidence}% conf</span>
              <p className="text-gray-400 mt-0.5 leading-snug">{ai.reason}</p>
              {ai.headlines && ai.headlines.length > 0 && (
                <ul className="mt-1 text-gray-600 list-disc list-inside">
                  {ai.headlines.slice(0, 2).map((h, i) => (
                    <li key={i} className="truncate">
                      {h}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <span className="text-gray-600 animate-pulse">
              Manage active — scoring news + price…
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => decide('HOLD')}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-[#30363d] text-gray-300 hover:border-blue-700 hover:text-blue-400 disabled:opacity-40"
          >
            {busy === 'HOLD' ? '…' : 'HOLD'}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => decide('TAKE_PROFIT')}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-emerald-800 text-emerald-400 hover:bg-emerald-900/30 disabled:opacity-40"
          >
            {busy === 'TAKE_PROFIT' ? '…' : 'TAKE PROFIT'}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => pollAi()}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-[#30363d] text-gray-500 hover:text-white"
            title="Re-run AI check now"
          >
            ↻ AI
          </button>
        </div>
      </div>
      {msg && <p className="text-[11px] text-gray-400">{msg}</p>}
    </div>
  )
}
