'use client'

/**
 * MANAGE phase desk — process-focused (no live $ P&L).
 * Price path toward TP is separate from AI confidence.
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
  /** ISO entry time — used to skip morning-lunch confirm for lunch-range fills */
  entryTimestamp?: string | null
}

export interface AiVerdict {
  verdict: 'pullback' | 'reversal' | 'hold' | string
  confidence: number
  reason: string
  news_score?: number
  headlines?: string[]
  move_pct?: number
  rvol?: number | null
  rvol_source?: string | null
  factors?: string[]
  options?: {
    proxy: string
    put_call_volume: number | null
    put_call_oi: number | null
    call_volume: number
    put_volume: number
    bias: number
    source: string
  } | null
  closed?: boolean
}

interface Props {
  position: ManagePosition
  currentPrice: number | null
  onClosed: (exitReason?: 'stop_hit' | 'take_profit' | 'manual' | 'ai_signal') => void
  onRefreshGate: () => void
  /** Mirror AI manage verdict onto the chart canvas */
  onAiVerdict?: (verdict: AiVerdict | null) => void
  /** Advise-only ATR trail/pad suggestion from active range */
  atrAdviceLine?: string | null
}

export function ManageDeskBar({
  position,
  currentPrice,
  onClosed,
  onRefreshGate,
  onAiVerdict,
  atrAdviceLine = null,
}: Props) {
  const [ai, setAi] = useState<AiVerdict | null>(null)
  const [recommendation, setRecommendation] = useState<{
    action_type: 'BREAKEVEN' | 'TRAIL_STOP' | 'SCALE_OUT'
    proposed_price?: number
    proposed_units?: number
    reason: string
    confidence: number
  } | null>(null)
  /** AI wants out — never auto-closes; trader must CONFIRM */
  const [exitPrompt, setExitPrompt] = useState<{
    reason: string
    confidence: number
  } | null>(null)
  const [exitDismissed, setExitDismissed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const exitingRef = useRef(false)
  const aiPollInFlightRef = useRef(false)
  const exitDismissedRef = useRef(false)
  const priceRef = useRef(currentPrice)
  const onClosedRef = useRef(onClosed)
  const onRefreshGateRef = useRef(onRefreshGate)
  const onAiVerdictRef = useRef(onAiVerdict)

  useEffect(() => {
    setExitPrompt(null)
    setExitDismissed(false)
    exitDismissedRef.current = false
    exitingRef.current = false
  }, [position.id])

  useEffect(() => {
    priceRef.current = currentPrice
  }, [currentPrice])

  useEffect(() => {
    exitDismissedRef.current = exitDismissed
  }, [exitDismissed])

  useEffect(() => {
    onClosedRef.current = onClosed
    onRefreshGateRef.current = onRefreshGate
    onAiVerdictRef.current = onAiVerdict
  }, [onClosed, onRefreshGate, onAiVerdict])

  useEffect(() => {
    onAiVerdictRef.current?.(ai)
  }, [ai])

  useEffect(() => {
    return () => onAiVerdictRef.current?.(null)
  }, [])

  const isLong = position.direction === 'long'
  /** Geometric progress 0→1 from entry toward TP (not AI confidence). */
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
    if (aiPollInFlightRef.current || exitingRef.current) return
    aiPollInFlightRef.current = true
    try {
      // 1. Run Auto-Management Rules (Breakeven, Trailing Stop, Partial Scale-Out)
      fetch('/api/trading/positions/auto-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          current_price: priceRef.current ?? undefined,
        }),
      }).catch(() => {})

      // 2. Run AI Reversal & News / RVOL Exit Check
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
        rvol: json.rvol,
        rvol_source: json.rvol_source,
        factors: json.factors,
        options: json.options ?? null,
        closed: false,
      })
      if (json.requires_confirmation && !exitDismissedRef.current) {
        setExitPrompt({
          reason: json.reason || 'AI recommends exiting on reversal',
          confidence: json.confidence ?? 0,
        })
      } else if (!json.requires_confirmation) {
        setExitPrompt(null)
        setExitDismissed(false)
      }
    } catch {
      /* keep last */
    } finally {
      aiPollInFlightRef.current = false
    }
  }, [position.id])

  useEffect(() => {
    void pollAi()
    const id = setInterval(() => void pollAi(), 20000)
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

  const handleConfirmRecommendation = async () => {
    if (!recommendation) return
    setBusy('CONFIRM')
    try {
      await fetch('/api/trading/positions/auto-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          current_price: priceRef.current ?? undefined,
          confirm_action: 'CONFIRM',
          action_type: recommendation.action_type,
        }),
      })
      setMsg(`Confirmed: ${recommendation.action_type}`)
      setRecommendation(null)
      onRefreshGate()
    } catch {
      setMsg('Confirmation failed')
    } finally {
      setBusy(null)
    }
  }

  const handleRejectRecommendation = async () => {
    if (!recommendation) return
    setBusy('REJECT')
    try {
      await fetch('/api/trading/positions/auto-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          confirm_action: 'REJECT',
          action_type: recommendation.action_type,
        }),
      })
      setMsg(`Rejected: Position held untouched`)
      setRecommendation(null)
    } catch {
      setMsg('Rejection failed')
    } finally {
      setBusy(null)
    }
  }

  const handleConfirmAiExit = async () => {
    if (!exitPrompt || exitingRef.current) return
    exitingRef.current = true
    setBusy('AI_EXIT')
    setMsg(null)
    const exitPrice = priceRef.current ?? position.entryPrice
    try {
      // Single close attempt — close route writes one TAKE_PROFIT history row.
      const closeRes = await fetch('/api/trading/positions/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          instrument: position.instrument,
          exit_price: exitPrice,
          exit_reason: 'ai_signal',
          reason: `Trader confirmed AI exit: ${exitPrompt.reason}`,
        }),
      })
      const closeJson = await closeRes.json()
      if (!closeRes.ok || !closeJson.success) {
        exitingRef.current = false
        setMsg(closeJson.message || 'AI exit close failed')
        return
      }
      setExitPrompt(null)
      setMsg(`Closed @ ${exitPrice.toLocaleString()} — AI exit confirmed`)
      onClosedRef.current('ai_signal')
      onRefreshGateRef.current()
    } catch {
      exitingRef.current = false
      setMsg('AI exit confirmation failed')
    } finally {
      setBusy(null)
    }
  }

  const handleRejectAiExit = async () => {
    setBusy('AI_HOLD')
    try {
      await fetch('/api/trading/positions/management-decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          decision_type: 'HOLD',
          notes: exitPrompt
            ? `Trader rejected AI exit: ${exitPrompt.reason}`
            : 'Trader rejected AI exit',
        }),
      })
      setExitDismissed(true)
      setExitPrompt(null)
      setMsg('AI exit rejected — position held')
    } catch {
      setMsg('Could not record HOLD')
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

  const rvolOk =
    ai?.rvol != null && Number.isFinite(ai.rvol) && ai.rvol > 0

  return (
    <div className="rounded-xl border border-amber-800/40 bg-[#161b22] px-3 py-2.5 space-y-2">
      {atrAdviceLine && (
        <p
          className="text-[10px] leading-snug text-violet-200/85"
          title="Advise only — does not auto-move SL/TP"
        >
          {atrAdviceLine}
        </p>
      )}
      {/* ── AI exit requires explicit trader CONFIRM (never auto-closes) ────── */}
      {exitPrompt && (
        <div className="rounded-lg border border-red-500/70 bg-red-950/40 p-2.5 shadow-lg flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0">
              <span className="text-xs font-extrabold uppercase tracking-wider text-red-300">
                AI exit suggestion · {exitPrompt.confidence}% — confirm to close
              </span>
              <p className="text-xs text-gray-200 font-medium truncate">{exitPrompt.reason}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void handleConfirmAiExit()}
              className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-extrabold uppercase tracking-wider transition shadow"
            >
              {busy === 'AI_EXIT' ? '…' : 'CONFIRM EXIT'}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void handleRejectAiExit()}
              className="px-2.5 py-1 rounded bg-surface-700 hover:bg-surface-600 text-gray-300 hover:text-white text-xs font-semibold uppercase tracking-wider transition"
            >
              {busy === 'AI_HOLD' ? '…' : 'HOLD'}
            </button>
          </div>
        </div>
      )}

      {/* ── Bracket recommendation (breakeven / trail / scale) — CONFIRM / REJECT ────── */}
      {recommendation && (
        <div className="rounded-lg border border-amber-500/70 bg-amber-950/40 p-2.5 shadow-lg flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div>
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-300">
                AI Management Recommendation
              </span>
              <p className="text-xs text-gray-200 font-medium">{recommendation.reason}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={handleConfirmRecommendation}
              className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold uppercase tracking-wider transition shadow"
            >
              CONFIRM
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={handleRejectRecommendation}
              className="px-2.5 py-1 rounded bg-surface-700 hover:bg-surface-600 text-gray-300 hover:text-white text-xs font-semibold uppercase tracking-wider transition"
            >
              REJECT
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span
          className={`font-bold px-2 py-0.5 rounded border ${
            isLong
              ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200'
              : 'border-red-700/60 bg-red-950/40 text-red-200'
          }`}
        >
          {isLong ? 'LONG' : 'SHORT'}
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
        <span className="ml-auto flex flex-wrap items-center gap-3 text-[10px] tracking-wide text-gray-500">
          {pathToTp != null && (
            <span title="How far price has moved from entry toward take-profit">
              Entry→TP{' '}
              <span className="price-mono text-sky-300">
                {Math.round(pathToTp * 100)}%
              </span>
            </span>
          )}
          {riskToSl != null && (
            <span title="Room left before stop">
              Room to SL{' '}
              <span className="price-mono text-gray-300">
                {Math.round(riskToSl * 100)}%
              </span>
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-3 text-[11px]">
        <div className="flex-1 min-w-[200px]">
          {ai ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={`font-semibold uppercase ${verdictColor}`}>
                  {ai.verdict}
                </span>
                <span
                  className="text-gray-500"
                  title="AI confidence in this manage call — not Entry→TP progress"
                >
                  AI confidence{' '}
                  <span className="price-mono text-gray-300">
                    {ai.confidence}%
                  </span>
                </span>
              </div>
              <p className="text-gray-400 mt-0.5 leading-snug">{ai.reason}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] uppercase tracking-wide text-gray-500">
                {rvolOk ? (
                  <span title={ai.rvol_source ?? undefined}>
                    RVOL{' '}
                    <span className="price-mono text-gray-300 normal-case">
                      {ai.rvol!.toFixed(2)}×
                    </span>
                  </span>
                ) : (
                  <span className="text-gray-600 normal-case">RVOL —</span>
                )}
                {ai.options && (
                  <span title={`${ai.options.proxy} · ${ai.options.source}`}>
                    P/C{' '}
                    <span className="price-mono text-gray-300 normal-case">
                      {ai.options.put_call_volume != null
                        ? ai.options.put_call_volume.toFixed(2)
                        : '—'}
                    </span>
                    <span className="ml-1 normal-case text-gray-600">
                      {ai.options.bias > 0
                        ? 'calls'
                        : ai.options.bias < 0
                          ? 'puts'
                          : 'flat'}
                    </span>
                  </span>
                )}
                {typeof ai.news_score === 'number' && (
                  <span>
                    News{' '}
                    <span className="price-mono text-gray-300 normal-case">
                      {ai.news_score}
                    </span>
                  </span>
                )}
              </div>
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
              Scoring news + RVOL + options…
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
