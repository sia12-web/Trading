'use client'

/**
 * MANAGE phase desk — process-focused (no live $ P&L).
 * Price path toward TP is separate from AI confidence.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { quoteBelongsToBook } from '@/lib/trading/deskExitGuard'
import { scoreValueAcceptance, toEpochMs } from '@/lib/trading/valueAcceptance'
import { ValueAcceptanceRead } from './ValueAcceptanceRead'

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
  range_state?: string | null
  range_label?: string | null
  range_high?: number | null
  range_low?: number | null
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
  /** Soft desk alert when break-even becomes available (once per trade) */
  onBreakEvenAvailable?: (payload: {
    positionId: string
    instrument: string
    proposedPrice: number
    reason: string
  }) => void
  /** Broker/journal sync detected position already closed */
  onBrokerExit?: (payload: {
    exitReason: 'stop_hit' | 'take_profit' | 'manual'
    exitPrice: number
  }) => void
  /** Toast-only: first time this book looks accepted at entry */
  onValueAccepted?: (payload: {
    positionId: string
    instrument: string
    message: string
    confidence: number
  }) => void
}

export function ManageDeskBar({
  position,
  currentPrice,
  onClosed,
  onRefreshGate,
  onAiVerdict,
  atrAdviceLine = null,
  onBreakEvenAvailable,
  onBrokerExit,
  onValueAccepted,
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
  const [newsExpanded, setNewsExpanded] = useState(false)
  const [beDismissed, setBeDismissed] = useState(false)
  const beNotifiedRef = useRef(false)
  const beDismissedRef = useRef(false)
  const onBreakEvenAvailableRef = useRef(onBreakEvenAvailable)
  const onBrokerExitRef = useRef(onBrokerExit)
  const onValueAcceptedRef = useRef(onValueAccepted)
  const valueAcceptedNotifiedRef = useRef(false)
  const [clockMs, setClockMs] = useState(() => Date.now())
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
    setNewsExpanded(false)
    setRecommendation(null)
    setBeDismissed(false)
    beNotifiedRef.current = false
    beDismissedRef.current = false
    valueAcceptedNotifiedRef.current = false
    exitDismissedRef.current = false
    exitingRef.current = false
  }, [position.id])

  useEffect(() => {
    beDismissedRef.current = beDismissed
  }, [beDismissed])

  useEffect(() => {
    onBreakEvenAvailableRef.current = onBreakEvenAvailable
    onBrokerExitRef.current = onBrokerExit
    onValueAcceptedRef.current = onValueAccepted
  }, [onBreakEvenAvailable, onBrokerExit, onValueAccepted])

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
  useEffect(() => {
    setClockMs(Date.now())
    const id = window.setInterval(() => setClockMs(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [position.id])

  const quoteOk =
    currentPrice != null &&
    Number.isFinite(currentPrice) &&
    currentPrice > 0 &&
    quoteBelongsToBook({
      instrument: position.instrument,
      entry: position.entryPrice,
      quote: currentPrice,
    })

  const valueAcceptance = useMemo(() => {
    if (!quoteOk || currentPrice == null) return null
    const filledAtMs = toEpochMs(position.entryTimestamp)
    if (filledAtMs == null) return null
    return scoreValueAcceptance({
      side: isLong ? 'LONG' : 'SHORT',
      entry: position.entryPrice,
      stopLoss: position.stopLoss,
      takeProfit: position.profitTarget,
      nowMs: clockMs,
      filledAtMs,
      lastPrice: currentPrice,
    })
  }, [
    quoteOk,
    currentPrice,
    position.entryTimestamp,
    position.entryPrice,
    position.stopLoss,
    position.profitTarget,
    clockMs,
    isLong,
  ])

  useEffect(() => {
    if (!valueAcceptance || valueAcceptance.state !== 'looking_accepted') return
    if (valueAcceptedNotifiedRef.current) return
    valueAcceptedNotifiedRef.current = true
    onValueAcceptedRef.current?.({
      positionId: position.id,
      instrument: position.instrument,
      message: valueAcceptance.message,
      confidence: valueAcceptance.confidence,
    })
  }, [valueAcceptance, position.id, position.instrument])

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
      // 1. Auto-manage (BE / trail / scale) — trader must CONFIRM
      const manageRes = await fetch('/api/trading/positions/auto-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          current_price: priceRef.current ?? undefined,
        }),
      })
      if (manageRes.ok && !beDismissedRef.current) {
        const manageJson = (await manageRes.json()) as {
          recommendation?: {
            action_type: 'BREAKEVEN' | 'TRAIL_STOP' | 'SCALE_OUT'
            proposed_price?: number
            proposed_units?: number
            reason: string
            confidence: number
          } | null
          action_taken?: string
          updated_stop_loss?: number | null
        }
        if (
          manageJson.action_taken === 'MOVED_TO_BREAKEVEN' ||
          manageJson.action_taken === 'BREAKEVEN_AND_TRAILED'
        ) {
          setRecommendation(null)
        } else if (manageJson.recommendation && !beDismissedRef.current) {
          setRecommendation(manageJson.recommendation)
          if (
            manageJson.recommendation.action_type === 'BREAKEVEN' &&
            !beNotifiedRef.current
          ) {
            beNotifiedRef.current = true
            onBreakEvenAvailableRef.current?.({
              positionId: position.id,
              instrument: position.instrument,
              proposedPrice:
                manageJson.recommendation.proposed_price ?? position.entryPrice,
              reason: manageJson.recommendation.reason,
            })
          }
        } else if (!manageJson.recommendation) {
          setRecommendation(null)
        }
      }

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
    const id = setInterval(() => void pollAi(), 12000)
    return () => clearInterval(id)
  }, [pollAi])

  /** Broker/journal reconcile — detect OANDA SL/TP while chart still shows open */
  const pollReconcile = useCallback(async () => {
    if (exitingRef.current) return
    try {
      const res = await fetch(
        `/api/trading/current-position?instrument=${encodeURIComponent(position.instrument)}&reconcile=1&_=${Date.now()}`,
        { cache: 'no-store' }
      )
      if (!res.ok) return
      const json = (await res.json()) as {
        position?: unknown | null
        reconciled?: {
          closed: true
          exit_reason: 'stop_hit' | 'take_profit' | 'manual'
          exit_price: number
        }
      }
      if (json.reconciled?.closed) {
        exitingRef.current = true
        const reason = json.reconciled.exit_reason
        setMsg(
          reason === 'stop_hit'
            ? `STOP HIT @ ${json.reconciled.exit_price.toLocaleString()}`
            : reason === 'take_profit'
              ? `TAKE PROFIT @ ${json.reconciled.exit_price.toLocaleString()}`
              : `CLOSED @ ${json.reconciled.exit_price.toLocaleString()}`
        )
        onBrokerExitRef.current?.({
          exitReason: reason,
          exitPrice: json.reconciled.exit_price,
        })
        return
      }
      if (json.position) return

      // Never toast "closed" on a lone null — confirm Live Positions SoT + working limit.
      // (Wrong trade_date / race used to false-close Nikkei US Range books.)
      const [statusRes, workingRes] = await Promise.all([
        fetch(
          `/api/trading/positions/management-status?instrument=${encodeURIComponent(position.instrument)}`,
          { cache: 'no-store' }
        ),
        fetch(
          `/api/trading/positions/working?instrument=${encodeURIComponent(position.instrument)}`,
          { cache: 'no-store' }
        ),
      ])
      if (statusRes.ok) {
        const statusJson = (await statusRes.json()) as { success?: boolean; position?: unknown }
        if (statusJson.success && statusJson.position) return
      }
      if (workingRes.ok) {
        const workingJson = (await workingRes.json()) as { working?: unknown }
        if (workingJson.working) return
      }

      exitingRef.current = true
      onBrokerExitRef.current?.({
        exitReason: 'manual',
        exitPrice: priceRef.current ?? position.entryPrice,
      })
    } catch {
      /* soft-fail */
    }
  }, [position.id, position.instrument, position.entryPrice])

  useEffect(() => {
    void pollReconcile()
    const id = setInterval(() => void pollReconcile(), 4000)
    return () => clearInterval(id)
  }, [pollReconcile])

  useEffect(() => {
    if (currentPrice == null) return
    void pollReconcile()
  }, [currentPrice, pollReconcile])

  // Auto-exit when live price hits stop or take-profit
  useEffect(() => {
    if (exitingRef.current) return
    // Require a real live quote — never treat a missing/stale seed as a stop touch
    if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) return
    const hitSl = isLong
      ? currentPrice <= position.stopLoss
      : currentPrice >= position.stopLoss
    const hitTp = isLong
      ? currentPrice >= position.profitTarget
      : currentPrice <= position.profitTarget
    if (!hitSl && !hitTp) return
    if (
      !quoteBelongsToBook({
        instrument: position.instrument,
        entry: position.entryPrice,
        quote: currentPrice,
      })
    ) {
      return
    }

    // BE stop sits 1 tick off entry. If the quote is still exactly at entry (seed /
    // uncleared), do not market-flatten — wait for a real adverse print through SL.
    if (
      hitSl &&
      Math.abs(currentPrice - position.entryPrice) < 0.51 &&
      Math.abs(position.stopLoss - position.entryPrice) <= 2
    ) {
      return
    }

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
            exit_price: currentPrice,
            exit_reason: hitSl ? 'stop_hit' : 'take_profit',
            reason: hitSl
              ? `Stop loss hit — price reached ${currentPrice}`
              : `Take profit hit — price reached ${exitPrice}`,
          }),
        })
        if (cancelled) return
        const closeJson = await closeRes.json()
        if (!closeRes.ok || !closeJson.success) {
          // Journal may already be closed (broker SL/TP) — reconcile and clear UI
          if (closeRes.status === 404 || /already closed/i.test(String(closeJson.message || ''))) {
            await pollReconcile()
            return
          }
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
    position.entryPrice,
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
      const res = await fetch('/api/trading/positions/auto-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          current_price: priceRef.current ?? undefined,
          confirm_action: 'CONFIRM',
          action_type: recommendation.action_type,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        action_taken?: string
        updated_stop_loss?: number | null
        error?: string
      }
      if (!res.ok) {
        setMsg(json.error || 'Confirmation failed')
        return
      }
      if (recommendation.action_type === 'BREAKEVEN') {
        setMsg(`Break-even confirmed — SL @ ${(json.updated_stop_loss ?? position.entryPrice).toLocaleString()}`)
        onBreakEvenAvailableRef.current?.({
          positionId: position.id,
          instrument: position.instrument,
          proposedPrice: json.updated_stop_loss ?? position.entryPrice,
          reason: '__confirmed__',
        })
      } else {
        setMsg(`Confirmed: ${recommendation.action_type}`)
      }
      setRecommendation(null)
      setBeDismissed(true)
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
      setMsg(
        recommendation.action_type === 'BREAKEVEN'
          ? 'Break-even dismissed — SL unchanged'
          : 'Rejected — position held untouched'
      )
      setRecommendation(null)
      setBeDismissed(true)
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

  const headlinePreview =
    ai?.headlines && ai.headlines.length > 0
      ? ai.headlines.slice(0, 2).join(' · ')
      : null

  return (
    <div className="w-[min(300px,calc(100vw-1.5rem))] rounded-lg border border-amber-800/40 bg-[#161b22]/95 px-2 py-1.5 shadow-xl backdrop-blur-md space-y-1">
      {atrAdviceLine && (
        <p
          className="text-[9px] leading-tight text-violet-200/85 truncate"
          title={`${atrAdviceLine} — advise only, does not auto-move SL/TP`}
        >
          {atrAdviceLine}
        </p>
      )}
      {/* ── AI exit requires explicit trader CONFIRM (never auto-closes) ────── */}
      {exitPrompt && (
        <div className="rounded border border-red-500/70 bg-red-950/40 p-1.5 space-y-1">
          <p className="text-[9px] font-bold uppercase tracking-wide text-red-300">
            AI exit · {exitPrompt.confidence}%
          </p>
          <p className="text-[10px] text-gray-200 leading-snug line-clamp-2">
            {exitPrompt.reason}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void handleConfirmAiExit()}
              className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[9px] font-bold uppercase tracking-wide transition"
            >
              {busy === 'AI_EXIT' ? '…' : 'Exit'}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void handleRejectAiExit()}
              className="px-2 py-0.5 rounded bg-surface-700 hover:bg-surface-600 text-gray-300 hover:text-white text-[9px] font-semibold uppercase tracking-wide transition"
            >
              {busy === 'AI_HOLD' ? '…' : 'Hold'}
            </button>
          </div>
        </div>
      )}

      {/* ── Bracket recommendation (breakeven / trail / scale) — CONFIRM / REJECT ────── */}
      {recommendation && (
        <div className="rounded border border-amber-500/70 bg-amber-950/40 p-1.5 space-y-1">
          <p className="text-[9px] font-bold uppercase tracking-wide text-amber-300">
            {recommendation.action_type === 'BREAKEVEN'
              ? 'Break-even available'
              : `AI bracket · ${recommendation.action_type}`}
          </p>
          <p className="text-[10px] text-gray-200 leading-snug line-clamp-2">
            {recommendation.action_type === 'BREAKEVEN'
              ? `Confirm to lock SL at entry (${recommendation.proposed_price?.toLocaleString() ?? position.entryPrice.toLocaleString()}) — ${recommendation.reason}`
              : recommendation.reason}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void handleConfirmRecommendation()}
              className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[9px] font-bold uppercase tracking-wide transition"
            >
              {busy === 'CONFIRM' ? '…' : recommendation.action_type === 'BREAKEVEN' ? 'Move to BE' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void handleRejectRecommendation()}
              className="px-2 py-0.5 rounded bg-surface-700 hover:bg-surface-600 text-gray-300 hover:text-white text-[9px] font-semibold uppercase tracking-wide transition"
            >
              {busy === 'REJECT' ? '…' : 'Not now'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
        <span
          className={`font-bold px-1.5 py-px rounded border text-[9px] ${
            isLong
              ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200'
              : 'border-red-700/60 bg-red-950/40 text-red-200'
          }`}
        >
          {isLong ? 'LONG' : 'SHORT'}
        </span>
        <span className="text-gray-500">
          E{' '}
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
      </div>

      {(pathToTp != null || riskToSl != null) && (
        <div className="flex flex-wrap items-center gap-x-2 text-[9px] text-gray-500">
          {pathToTp != null && (
            <span title="How far price has moved from entry toward take-profit">
              →TP{' '}
              <span className="price-mono text-sky-300">
                {Math.round(pathToTp * 100)}%
              </span>
            </span>
          )}
          {riskToSl != null && (
            <span title="Room left before stop">
              SL room{' '}
              <span className="price-mono text-gray-300">
                {Math.round(riskToSl * 100)}%
              </span>
            </span>
          )}
        </div>
      )}

      {valueAcceptance && <ValueAcceptanceRead read={valueAcceptance} />}

      {ai ? (
        <div className="space-y-0.5 text-[10px]">
          <div className="flex items-baseline gap-x-1.5 min-w-0">
            <span className={`font-semibold uppercase shrink-0 ${verdictColor}`}>
              {ai.verdict}
            </span>
            <span
              className="text-gray-500 shrink-0"
              title="AI confidence — not Entry→TP progress"
            >
              {ai.confidence}%
            </span>
            <span className="text-gray-400 truncate min-w-0" title={ai.reason}>
              {ai.reason}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-2 text-[9px] uppercase tracking-wide text-gray-500">
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
              </span>
            )}
            {ai.range_state && ai.range_state !== 'unknown' && (
              <span title={
                ai.range_high != null && ai.range_low != null
                  ? `${ai.range_label || 'range'} H ${ai.range_high} / L ${ai.range_low}`
                  : undefined
              }>
                {ai.range_label || 'Range'}{' '}
                <span className="price-mono text-gray-300 normal-case">
                  {ai.range_state.replace(/_/g, ' ')}
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
          {headlinePreview && (
            <div className="text-[9px] text-gray-600">
              {newsExpanded ? (
                <ul className="list-disc list-inside space-y-0.5">
                  {ai.headlines!.slice(0, 2).map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              ) : (
                <p className="truncate" title={headlinePreview}>
                  {headlinePreview}
                </p>
              )}
              <button
                type="button"
                onClick={() => setNewsExpanded((v) => !v)}
                className="mt-0.5 text-gray-500 hover:text-gray-300 normal-case tracking-normal"
              >
                {newsExpanded ? 'Less' : 'More'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <span className="text-[10px] text-gray-600 animate-pulse">
          Scoring…
        </span>
      )}

      <div className="flex items-center gap-1 pt-0.5">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => decide('HOLD')}
          className="px-2 py-1 rounded text-[10px] font-semibold border border-[#30363d] text-gray-300 hover:border-blue-700 hover:text-blue-400 disabled:opacity-40"
        >
          {busy === 'HOLD' ? '…' : 'HOLD'}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => decide('TAKE_PROFIT')}
          className="px-2 py-1 rounded text-[10px] font-semibold border border-emerald-800 text-emerald-400 hover:bg-emerald-900/30 disabled:opacity-40"
        >
          {busy === 'TAKE_PROFIT' ? '…' : 'TAKE PROFIT'}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => pollAi()}
          className="px-2 py-1 rounded text-[10px] font-semibold border border-[#30363d] text-gray-500 hover:text-white"
          title="Re-run AI check now"
        >
          ↻ AI
        </button>
      </div>
      {msg && <p className="text-[9px] text-gray-400 truncate">{msg}</p>}
    </div>
  )
}
