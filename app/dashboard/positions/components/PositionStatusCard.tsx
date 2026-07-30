'use client'

/**
 * Live manage card — path meters, AI verdict, HOLD / take-profit close.
 * Matches dark desk chrome (chart + order history).
 */

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePositionPriceSubscription } from '@/lib/hooks/usePositionPriceSubscription'
import { successToast, errorToast } from '@/lib/utils/toastUtils'
import type { PositionStatus } from '@/types/positionManagement'
import { entrySourceLabel, entrySourceTone } from '@/lib/trading/entrySourceBadge'
import { formatDeskMoney } from '@/lib/trading/currency'

interface PositionStatusCardProps {
  position: PositionStatus | null
  onClosed?: () => void
  onRefresh?: () => void
  /** When a working limit card is shown above, skip the empty-state placeholder. */
  hideEmptyWhenWorking?: boolean
}

interface AiVerdict {
  verdict: string
  confidence: number
  reason: string
  closed?: boolean
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function fmtMoney(n: number, signed = false) {
  return formatDeskMoney(n, { signed })
}

export function PositionStatusCard({
  position,
  onClosed,
  onRefresh,
  hideEmptyWhenWorking = false,
}: PositionStatusCardProps) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [ai, setAi] = useState<AiVerdict | null>(null)
  const [closedMsg, setClosedMsg] = useState<string | null>(null)
  const [exitPrompt, setExitPrompt] = useState<{
    reason: string
    confidence: number
  } | null>(null)
  const [exitDismissed, setExitDismissed] = useState(false)
  const exitingRef = useRef(false)
  const aiPollInFlightRef = useRef(false)
  const exitDismissedRef = useRef(false)
  const priceRef = useRef<number | null>(null)
  const onClosedRef = useRef(onClosed)
  const onRefreshRef = useRef(onRefresh)
  const closedMsgRef = useRef(closedMsg)
  const positionIdRef = useRef(position?.id)

  useEffect(() => {
    onClosedRef.current = onClosed
    onRefreshRef.current = onRefresh
  }, [onClosed, onRefresh])

  useEffect(() => {
    closedMsgRef.current = closedMsg
  }, [closedMsg])

  useEffect(() => {
    positionIdRef.current = position?.id
  }, [position?.id])

  useEffect(() => {
    priceRef.current = currentPrice
  }, [currentPrice])

  useEffect(() => {
    exitDismissedRef.current = exitDismissed
  }, [exitDismissed])

  useEffect(() => {
    setClosedMsg(null)
    setAi(null)
    setExitPrompt(null)
    setExitDismissed(false)
    exitDismissedRef.current = false
    exitingRef.current = false
    if (position) {
      setCurrentPrice(position.entry_price)
      priceRef.current = position.entry_price
    } else {
      setCurrentPrice(null)
      priceRef.current = null
    }
  }, [position?.id])

  const applyPrice = useCallback((price: number) => {
    if (!Number.isFinite(price) || price <= 0) return
    setCurrentPrice(price)
    priceRef.current = price
  }, [])

  // Realtime broadcast (best-effort)
  const { isConnected } = usePositionPriceSubscription(
    position?.instrument ?? null,
    useCallback(
      (price: number) => {
        applyPrice(price)
      },
      [applyPrice]
    )
  )

  // Reliable quote poll (same path as live chart)
  useEffect(() => {
    if (!position || closedMsg) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/trading/quote?instrument=${position.instrument}&_=${Date.now()}`,
          { cache: 'no-store' }
        )
        if (!res.ok || cancelled) return
        const json = await res.json()
        if (typeof json.price === 'number' && json.price > 0) applyPrice(json.price)
      } catch {
        /* keep */
      }
    }
    void poll()
    const id = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [position, closedMsg, applyPrice])

  const pollAi = useCallback(async () => {
    const positionId = positionIdRef.current
    if (!positionId || closedMsgRef.current || exitingRef.current) return
    if (aiPollInFlightRef.current) return
    aiPollInFlightRef.current = true
    try {
      // 1. Run Auto-Management (2-Year Empirical Profiles: Breakeven, Trailing Stop, Scale-Out)
      fetch('/api/trading/positions/auto-manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: positionId,
          current_price: priceRef.current ?? undefined,
        }),
      }).catch(() => {})

      // 2. Run AI Exit Check
      const res = await fetch('/api/trading/positions/ai-exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: positionId,
          current_price: priceRef.current ?? undefined,
        }),
      })
      if (!res.ok) return
      const json = await res.json()
      setAi({
        verdict: json.verdict,
        confidence: json.confidence,
        reason: json.reason,
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
  }, [])

  useEffect(() => {
    if (!position?.id || closedMsg) return
    void pollAi()
    const id = setInterval(() => void pollAi(), 20000)
    return () => clearInterval(id)
  }, [pollAi, position?.id, closedMsg])

  // Auto SL / TP
  useEffect(() => {
    if (!position || closedMsg || exitingRef.current) return
    if (currentPrice == null) return
    const isLong = position.entry_direction === 'LONG'
    const hitSl = isLong
      ? currentPrice <= position.stop_loss_price
      : currentPrice >= position.stop_loss_price
    const hitTp = isLong
      ? currentPrice >= position.profit_target_price
      : currentPrice <= position.profit_target_price
    if (!hitSl && !hitTp) return

    exitingRef.current = true
    const exitReason = hitSl ? 'stop_hit' : 'take_profit'
    const exitPrice = currentPrice
    ;(async () => {
      try {
        const closeRes = await fetch('/api/trading/positions/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_id: position.id,
            instrument: position.instrument,
            exit_price: exitPrice,
            exit_reason: exitReason,
            reason: hitSl
              ? `Stop loss hit at ${exitPrice}`
              : `Take profit hit at ${exitPrice}`,
          }),
        })
        const json = await closeRes.json()
        if (!closeRes.ok || !json.success) {
          exitingRef.current = false
          errorToast(json.message || 'Auto-exit failed')
          return
        }
        setClosedMsg(
          hitSl
            ? `Stopped out @ ${fmt(exitPrice)}`
            : `Take profit @ ${fmt(exitPrice)}`
        )
        successToast(hitSl ? 'Stop loss hit' : 'Take profit hit')
        onClosed?.()
        onRefresh?.()
      } catch {
        exitingRef.current = false
        errorToast('Auto-exit failed')
      }
    })()
  }, [currentPrice, position, closedMsg, onClosed, onRefresh])

  const closePosition = async (
    exit_reason: 'take_profit' | 'manual',
    label: string
  ) => {
    if (!position || exitingRef.current) return
    exitingRef.current = true
    setBusy(label)
    const exitPrice = currentPrice ?? position.entry_price
    try {
      if (exit_reason === 'take_profit') {
        await fetch('/api/trading/positions/management-decisions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_id: position.id,
            decision_type: 'TAKE_PROFIT',
            notes: ai?.reason ?? null,
          }),
        })
      }
      const closeRes = await fetch('/api/trading/positions/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          instrument: position.instrument,
          exit_price: exitPrice,
          exit_reason,
          reason:
            exit_reason === 'take_profit'
              ? ai?.reason
                ? `Manual take profit — ${ai.reason}`
                : `Manual take profit at ${exitPrice}`
              : `Manual close at ${exitPrice}`,
        }),
      })
      const json = await closeRes.json()
      if (!closeRes.ok || !json.success) {
        exitingRef.current = false
        errorToast(json.message || 'Close failed')
        return
      }
      setClosedMsg(`Closed @ ${fmt(exitPrice)}`)
      successToast(label === 'TAKE_PROFIT' ? 'Take profit recorded' : 'Position closed')
      onClosed?.()
      onRefresh?.()
    } catch {
      exitingRef.current = false
      errorToast('Close failed')
    } finally {
      setBusy(null)
    }
  }

  const hold = async () => {
    if (!position) return
    setBusy('HOLD')
    try {
      const res = await fetch('/api/trading/positions/management-decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          decision_type: 'HOLD',
          notes: ai?.reason ?? null,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        errorToast(json.message || 'HOLD failed')
        return
      }
      successToast('HOLD recorded — still managing')
    } catch {
      errorToast('HOLD failed')
    } finally {
      setBusy(null)
    }
  }

  const confirmAiExit = async () => {
    if (!position || !exitPrompt || exitingRef.current) return
    exitingRef.current = true
    setBusy('AI_EXIT')
    const exitPrice = currentPrice ?? position.entry_price
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
      const json = await closeRes.json()
      if (!closeRes.ok || !json.success) {
        exitingRef.current = false
        errorToast(json.message || 'AI exit close failed')
        return
      }
      setExitPrompt(null)
      setClosedMsg(`Closed @ ${fmt(exitPrice)} — AI exit confirmed`)
      successToast('AI exit confirmed')
      onClosed?.()
      onRefresh?.()
    } catch {
      exitingRef.current = false
      errorToast('AI exit confirmation failed')
    } finally {
      setBusy(null)
    }
  }

  const rejectAiExit = async () => {
    if (!position) return
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
      successToast('AI exit rejected — position held')
    } catch {
      errorToast('Could not record HOLD')
    } finally {
      setBusy(null)
    }
  }

  if (!position) {
    if (hideEmptyWhenWorking) return null
    return (
      <div className="rounded-xl border border-dashed border-[#30363d] bg-[#161b22] px-6 py-14 text-center">
        <p className="text-lg font-semibold text-white">No open position</p>
        <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
          Clock in and place a level during the entry window — filled books and working limits both
          show on this page and on Live Trading.
        </p>
        <Link
          href="/dashboard/chart"
          className="mt-6 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500"
        >
          Open Live Trading
        </Link>
      </div>
    )
  }

  if (closedMsg) {
    return (
      <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 px-6 py-10 text-center">
        <p className="text-lg font-semibold text-emerald-200">{closedMsg}</p>
        <p className="mt-2 text-sm text-gray-500">Flat for this instrument. See Order History for the full trail.</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard/journal"
            className="rounded-lg border border-[#30363d] px-4 py-2 text-xs font-semibold text-gray-300 hover:bg-[#1c2128]"
          >
            Order History
          </Link>
          <button
            type="button"
            onClick={() => onRefresh?.()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-500"
          >
            Refresh
          </button>
        </div>
      </div>
    )
  }

  const isLong = position.entry_direction === 'LONG'
  const px = currentPrice ?? position.entry_price
  const pnl =
    (isLong ? px - position.entry_price : position.entry_price - px) * position.position_size
  const pnlRounded = Math.round(pnl * 100) / 100
  const vsRisk =
    position.risk_amount > 0
      ? Math.round((pnlRounded / position.risk_amount) * 10000) / 100
      : 0

  const tpSpan = isLong
    ? position.profit_target_price - position.entry_price
    : position.entry_price - position.profit_target_price
  const slSpan = isLong
    ? position.entry_price - position.stop_loss_price
    : position.stop_loss_price - position.entry_price
  const pathToTp =
    Math.abs(tpSpan) > 1e-9
      ? clamp01((isLong ? px - position.entry_price : position.entry_price - px) / tpSpan)
      : 0
  const roomToSl =
    Math.abs(slSpan) > 1e-9
      ? clamp01((isLong ? px - position.stop_loss_price : position.stop_loss_price - px) / slSpan)
      : 0

  const verdict = (ai?.verdict || '').toLowerCase()
  const verdictStyle =
    verdict === 'reversal'
      ? 'border-violet-500/40 bg-violet-950/40 text-violet-100'
      : verdict === 'pullback'
        ? 'border-amber-500/40 bg-amber-950/40 text-amber-100'
        : 'border-emerald-500/30 bg-emerald-950/30 text-emerald-100'

  return (
    <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#30363d] px-4 py-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-2 py-0.5 text-xs font-bold ${
                isLong
                  ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
                  : 'border-red-800 bg-red-950/40 text-red-300'
              }`}
            >
              {isLong ? '▲ LONG' : '▼ SHORT'} {position.instrument}
            </span>
            <span className="rounded border border-amber-800/50 bg-amber-950/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
              Manage
            </span>
            {position.entry_source && (
              <span
                className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${entrySourceTone(position.entry_source)}`}
                title={position.entry_reason || undefined}
              >
                {entrySourceLabel(position.entry_source)}
                {position.entry_source === 'manual' ? ' · 1%' : ''}
              </span>
            )}
            <span
              className={`flex items-center gap-1 text-[10px] ${
                isConnected ? 'text-emerald-500' : 'text-gray-500'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'
                }`}
              />
              {isConnected ? 'Live feed' : 'Quote poll'}
            </span>
          </div>
          <p className="text-xs text-gray-500">
            Window {position.entry_window} · {position.regime}{' '}
            {position.regime_confidence != null ? `(${position.regime_confidence}%)` : ''} · filled{' '}
            {new Date(position.entry_timestamp).toLocaleTimeString()}
          </p>
        </div>

        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Live price</div>
          <div className="price-mono text-2xl font-bold text-white">{fmt(px)}</div>
          <div
            className={`price-mono text-sm font-semibold ${
              pnlRounded >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
            title="Unrealized vs risk dollars (desk bookkeeping)"
          >
            {fmtMoney(pnlRounded, true)}{' '}
            <span className="text-gray-500 font-normal">
              ({vsRisk >= 0 ? '+' : ''}
              {vsRisk.toFixed(0)}% risk)
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {/* Path meters */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2.5">
            <div className="flex justify-between text-[10px] uppercase tracking-wider text-gray-500">
              <span>Entry→TP</span>
              <span className="price-mono text-sky-300 normal-case">
                {Math.round(pathToTp * 100)}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#21262d]">
              <div
                className="h-full rounded-full bg-sky-500 transition-[width] duration-300"
                style={{ width: `${pathToTp * 100}%` }}
              />
            </div>
          </div>
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2.5">
            <div className="flex justify-between text-[10px] uppercase tracking-wider text-gray-500">
              <span>Room to SL</span>
              <span className="price-mono text-gray-300 normal-case">
                {Math.round(roomToSl * 100)}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#21262d]">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  roomToSl < 0.25 ? 'bg-red-500' : 'bg-emerald-600/80'
                }`}
                style={{ width: `${roomToSl * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Levels */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2">
            <div className="text-gray-500">Entry</div>
            <div className="price-mono mt-0.5 text-sky-300">{fmt(position.entry_price)}</div>
          </div>
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2">
            <div className="text-gray-500">Stop loss</div>
            <div className="price-mono mt-0.5 text-red-400">{fmt(position.stop_loss_price)}</div>
          </div>
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2">
            <div className="text-gray-500">Take profit</div>
            <div className="price-mono mt-0.5 text-emerald-400">
              {fmt(position.profit_target_price)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-[11px] text-gray-500">
          <span>
            Size{' '}
            <span className="price-mono text-gray-300">{position.position_size.toFixed(2)}</span>
          </span>
          <span>
            Risk{' '}
            <span className="price-mono text-amber-300/90">{fmtMoney(position.risk_amount)}</span>
          </span>
          <span>
            Account{' '}
            <span className="price-mono text-gray-300">{fmtMoney(position.account_size)}</span>
          </span>
          {position.stop_loss_hit_count > 0 && (
            <span className="text-red-400">Stops today {position.stop_loss_hit_count}/2</span>
          )}
        </div>

        {/* AI exit — requires explicit trader CONFIRM (never auto-closes) */}
        {exitPrompt && (
          <div className="rounded-lg border border-red-500/70 bg-red-950/40 px-3 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-red-300">
                AI exit suggestion · {exitPrompt.confidence}% — confirm to close
              </span>
              <p className="mt-1 text-[12px] text-gray-200 leading-snug">{exitPrompt.reason}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void confirmAiExit()}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-extrabold uppercase tracking-wider disabled:opacity-40"
              >
                {busy === 'AI_EXIT' ? '…' : 'CONFIRM EXIT'}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void rejectAiExit()}
                className="px-2.5 py-1.5 rounded border border-[#30363d] text-gray-300 hover:text-white text-xs font-semibold uppercase tracking-wider disabled:opacity-40"
              >
                {busy === 'AI_HOLD' ? '…' : 'HOLD'}
              </button>
            </div>
          </div>
        )}

        {/* AI verdict */}
        <div className={`rounded-lg border px-3 py-3 ${verdictStyle}`}>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
            <span>AI manage</span>
            {ai ? (
              <>
                <span className="rounded bg-black/25 px-1.5 py-0.5">
                  {verdict === 'reversal'
                    ? 'Suggest exit — confirm required'
                    : verdict === 'hold'
                      ? 'Hold — no TP yet'
                      : verdict === 'pullback'
                        ? 'Pullback — watch'
                        : ai.verdict}
                </span>
                <span
                  className="font-mono normal-case tracking-normal opacity-80"
                  title="AI confidence — not Entry→TP %"
                >
                  AI {ai.confidence}%
                </span>
              </>
            ) : (
              <span className="animate-pulse opacity-70">Scoring news + price…</span>
            )}
            <button
              type="button"
              onClick={() => void pollAi()}
              className="ml-auto rounded border border-white/10 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-gray-300 hover:bg-black/20"
            >
              Refresh AI
            </button>
          </div>
          {ai?.reason && (
            <p className="mt-1.5 text-[12px] leading-snug opacity-90">{ai.reason}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void hold()}
            className="flex-1 min-w-[100px] rounded-lg border border-[#30363d] px-3 py-2.5 text-sm font-semibold text-gray-200 hover:border-sky-700 hover:text-sky-300 disabled:opacity-40"
          >
            {busy === 'HOLD' ? '…' : 'HOLD'}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void closePosition('take_profit', 'TAKE_PROFIT')}
            className="flex-1 min-w-[120px] rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
          >
            {busy === 'TAKE_PROFIT' ? 'Closing…' : 'TAKE PROFIT'}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void closePosition('manual', 'CLOSE')}
            className="flex-1 min-w-[100px] rounded-lg border border-[#30363d] px-3 py-2.5 text-sm font-semibold text-gray-400 hover:border-red-800 hover:text-red-300 disabled:opacity-40"
          >
            {busy === 'CLOSE' ? 'Closing…' : 'Close market'}
          </button>
          <Link
            href="/dashboard/chart"
            className="flex items-center justify-center rounded-lg border border-brand-700/40 bg-brand-600/20 px-3 py-2.5 text-sm font-semibold text-brand-200 hover:bg-brand-600/30"
          >
            Chart
          </Link>
        </div>
        <p className="text-[11px] text-gray-600 leading-relaxed">
          TAKE PROFIT / Close market flatten now. HOLD only journals the decision. AI may suggest an
          exit — it never closes without your CONFIRM. SL/TP still auto-exit when price tags the level.
        </p>
      </div>
    </div>
  )
}
