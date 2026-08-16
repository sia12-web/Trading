'use client'

/**
 * Tradeify Growth $50k eval progress — target, DLL, floor, fills, pace.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  DESK_RISK_PROFILE_EVENT,
  getDeskRiskProfile,
  hydrateDeskRiskProfileFromServer,
  isTradeifyGrowth50k,
  setDeskRiskProfile,
  type DeskRiskProfile,
} from '@/lib/trading/tradeifyProfile'

type InstrumentBreak = {
  fills: number
  pnl: number
  risked: number
  stops: number
}

type Snapshot = {
  ok?: boolean
  sessionKey?: string
  fillsUsed?: number
  stepDollars?: number
  leftoverDll?: number
  dllUsed?: number
  dllCap?: number
  floorRoom?: number
  dailyPnl?: number
  stopOutsToday?: number
  greenLockAt?: number
  profitTarget?: number
  todayTowardTargetPct?: number
  suggestedPaceLow?: number
  suggestedPaceHigh?: number
  flattenMontreal?: string
  accountName?: string | null
  byInstrument?: Record<'DOW' | 'NASDAQ' | 'NIKKEI', InstrumentBreak>
  allowed?: boolean
  refuseMessage?: string
  status?: 'can_trade' | 'day_locked' | 'must_flatten'
  error?: string
}

function money(n: number): string {
  const sign = n < 0 ? '−' : ''
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`
}

function Bar({
  used,
  cap,
  warn,
}: {
  used: number
  cap: number
  warn?: boolean
}) {
  const pct = cap > 0 ? Math.min(100, Math.max(0, (used / cap) * 100)) : 0
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full ${warn ? 'bg-red-400' : 'bg-sky-400'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function TradeifyProgressPanel({ compact = false }: { compact?: boolean }) {
  const [profile, setProfile] = useState<DeskRiskProfile>('oanda_cash')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const sync = () => setProfile(getDeskRiskProfile())
    void hydrateDeskRiskProfileFromServer().then((next) => {
      if (!cancelled) setProfile(next)
    })
    window.addEventListener(DESK_RISK_PROFILE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      cancelled = true
      window.removeEventListener(DESK_RISK_PROFILE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/trading/tradeify-snapshot?_=${Date.now()}`, {
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => null)) as Snapshot | null
      if (!res.ok || !json?.ok) {
        setError(json?.error || `Snapshot failed (${res.status})`)
        setSnap(null)
        return
      }
      setError(null)
      setSnap(json)
    } catch {
      setError('Snapshot unreachable')
      setSnap(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isTradeifyGrowth50k(profile)) return
    void load()
    const id = window.setInterval(load, 30_000)
    return () => window.clearInterval(id)
  }, [profile, load])

  const on = isTradeifyGrowth50k(profile)

  if (!on) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#161b22] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Tradeify $50k</h2>
            <p className="mt-1 text-[11px] text-gray-500">
              Profile off — desk uses OANDA 2% → 1% → 0.5%. Turn on to track Growth eval
              DLL / floor / $3,000 target.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDeskRiskProfile('tradeify_growth_50k')}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold uppercase text-black"
          >
            Enable
          </button>
        </div>
      </div>
    )
  }

  const status = snap?.status ?? 'can_trade'
  const statusLabel =
    status === 'must_flatten'
      ? 'Flatten now'
      : status === 'day_locked'
        ? 'Day locked'
        : 'Can trade'
  const statusClass =
    status === 'must_flatten'
      ? 'bg-red-500/25 text-red-100'
      : status === 'day_locked'
        ? 'bg-amber-500/25 text-amber-100'
        : 'bg-emerald-500/20 text-emerald-200'

  const dllUsed = snap?.dllUsed ?? 0
  const dllCap = snap?.dllCap ?? 1250
  const dailyPnl = snap?.dailyPnl ?? 0
  const target = snap?.profitTarget ?? 3000
  const floorRoom = snap?.floorRoom ?? 2000
  const fills = snap?.fillsUsed ?? 0

  return (
    <div className="rounded-xl border border-amber-500/30 bg-[#161b22] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">Tradeify Growth $50k</h2>
          <p className="mt-0.5 text-[10px] text-gray-500">
            {snap?.accountName ? `${snap.accountName} · ` : ''}
            Session {snap?.sessionKey ?? '—'} · flatten {snap?.flattenMontreal ?? '16:59 Montreal'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass}`}>
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={() => setDeskRiskProfile('oanda_cash')}
            className="text-[10px] text-gray-500 hover:text-white"
          >
            Use OANDA %
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-[11px] text-red-300">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="underline">
            Retry
          </button>
        </p>
      )}
      {loading && !snap && <p className="mt-3 text-[11px] text-gray-500">Loading snapshot…</p>}

      {snap && (
        <>
          <div className={`mt-4 grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">Today vs $3k</p>
              <p className={`mt-0.5 text-sm font-semibold ${dailyPnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {money(dailyPnl)}
              </p>
              <Bar used={Math.max(0, dailyPnl)} cap={target} />
              <p className="mt-0.5 text-[10px] text-gray-500">
                {snap.todayTowardTargetPct ?? 0}% of target · pace ${snap.suggestedPaceLow}–$
                {snap.suggestedPaceHigh}/day
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">Daily loss</p>
              <p className="mt-0.5 text-sm font-semibold text-white">
                {money(dllUsed)} / {money(dllCap)}
              </p>
              <Bar used={dllUsed} cap={dllCap} warn={dllUsed / dllCap > 0.7} />
              <p className="mt-0.5 text-[10px] text-gray-500">
                Leftover {money(snap.leftoverDll ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">Floor room</p>
              <p className="mt-0.5 text-sm font-semibold text-white">{money(floorRoom)}</p>
              <Bar used={2000 - floorRoom} cap={2000} warn={floorRoom < 800} />
              <p className="mt-0.5 text-[10px] text-gray-500">Trailing $2,000 · breach $48k</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">Fills / stops</p>
              <p className="mt-0.5 text-sm font-semibold text-white">
                {fills}/3 · stops {snap.stopOutsToday ?? 0}/2
              </p>
              <p className="mt-1 text-[10px] text-gray-500">
                Next {money(snap.stepDollars ?? 400)} · green lock {money(snap.greenLockAt ?? 700)}
              </p>
            </div>
          </div>

          {!compact && snap.byInstrument && (
            <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
              {(['NIKKEI', 'NASDAQ', 'DOW'] as const).map((inst) => {
                const row = snap.byInstrument![inst]
                return (
                  <div key={inst} className="rounded-lg border border-white/10 px-2 py-1.5">
                    <p className="text-[10px] font-semibold text-gray-400">{inst}</p>
                    <p className="text-white">
                      {row.fills} fill{row.fills === 1 ? '' : 's'} · {money(row.pnl)}
                    </p>
                    <p className="text-[10px] text-gray-500">risked {money(row.risked)}</p>
                  </div>
                )
              })}
            </div>
          )}

          {snap.refuseMessage && !snap.allowed && (
            <p className="mt-3 text-[11px] text-amber-200">{snap.refuseMessage}</p>
          )}

          {!compact && (
            <p className="mt-3 text-[10px] text-gray-600">
              Journal proxy until Tradovate sync — today&apos;s closed fills only. Slow path to
              $3,000; do not pass in one day.
            </p>
          )}
        </>
      )}

      {compact && (
        <Link
          href="/dashboard/tradeify"
          className="mt-3 inline-block text-[10px] font-semibold uppercase tracking-wide text-amber-300 hover:text-amber-100"
        >
          Full dashboard →
        </Link>
      )}
    </div>
  )
}
