'use client'

/**
 * Session banner for NY/Tokyo desk — polls /api/trading/session-gate
 * Clock-in (“Today I trade”) unlocks live chart + level reaction AI.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'

export interface SessionGateState {
  phase: string
  message: string
  lockedInstrument: 'DOW' | 'NASDAQ' | 'NIKKEI' | null
  canPlaceEntry: boolean
  canManagePosition: boolean
  canViewLiveChart: boolean
  canFetchLiveBars?: boolean
  clockedIn?: boolean
  attendedToday?: boolean
  canClockIn?: boolean
  market?: 'NY' | 'TOKYO'
  timeEst: string
  entryWindow: 1 | 2 | 3 | null
  open_position_id: string | null
  attemptsUsed?: number
  maxAttempts?: number
  stopHits?: number
  maxStopHits?: number
}

/** Live banner clock — ET for NY desk, JST when Tokyo/NIKKEI is active. */
function formatDeskClock(market?: 'NY' | 'TOKYO' | null): { time: string; label: string } {
  const tokyo = market === 'TOKYO'
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tokyo ? 'Asia/Tokyo' : 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
  return { time, label: tokyo ? 'JST' : 'ET' }
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'FLAT':
      return 'MORNING'
    case 'RECOMMENDED':
      return 'PRE-OPEN'
    default:
      return phase
  }
}

function phaseHint(phase: string, message: string): string {
  if (phase === 'ENTRY' || phase === 'FLAT') {
    return 'Morning trading open until lunch — click the chart or a level to place a limit.'
  }
  if (phase === 'DONE' || phase === 'CLOSED') {
    return message
  }
  return message
}

export function SessionBanner({
  onGate,
  refreshKey = 0,
  onRefreshReady,
  lastQuoteAt = null,
  dataMode = 'live',
}: {
  onGate?: (g: SessionGateState) => void
  refreshKey?: number
  onRefreshReady?: (refresh: () => void) => void
  lastQuoteAt?: number | null
  dataMode?: 'live' | 'synthetic'
}) {
  const [gate, setGate] = useState<SessionGateState | null>(null)
  const [gateError, setGateError] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState<string | null>(null)
  const [clockLabel, setClockLabel] = useState('ET')
  const [mounted, setMounted] = useState(false)
  const [clocking, setClocking] = useState(false)
  const prepFiredRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/trading/session-gate?_=${Date.now()}`, {
        cache: 'no-store',
      })
      if (res.status === 401) {
        setGateError(
          'Session unauthorized — set DESK_USER_ID on Railway (required with DESK_MODE=single) or sign in with Supabase.'
        )
        return
      }
      if (!res.ok) {
        setGateError(`Session gate failed (${res.status})`)
        return
      }
      const json = await res.json()
      setGateError(null)
      const next: SessionGateState = {
        phase: json.phase,
        message: json.message,
        lockedInstrument: json.lockedInstrument,
        canPlaceEntry: json.canPlaceEntry,
        canManagePosition: json.canManagePosition,
        canViewLiveChart: json.canViewLiveChart,
        canFetchLiveBars: json.canFetchLiveBars,
        clockedIn: !!json.clockedIn,
        attendedToday: !!json.attendedToday,
        canClockIn: !!json.canClockIn,
        market: json.market,
        timeEst: json.timeEst,
        entryWindow: json.entryWindow,
        open_position_id: json.open_position_id,
        attemptsUsed: Number(json.attemptsUsed ?? json.attempts_used ?? 0),
        maxAttempts: Number(json.maxAttempts ?? json.max_attempts ?? 2),
        stopHits: Number(json.stopHits ?? json.stop_hits ?? 0),
        maxStopHits: Number(json.maxStopHits ?? json.max_stop_hits ?? 2),
      }
      setGate(next)
      onGate?.(next)

      // Only prep levels after clock-in — otherwise system does not care
      if (next.clockedIn && (next.phase === 'RECOMMENDED' || next.phase === 'PREP' || next.phase === 'ENTRY')) {
        if (!next.lockedInstrument) {
          if (prepFiredRef.current !== 'market-open') {
            prepFiredRef.current = 'market-open'
            fetch('/api/trading/market-open', { method: 'POST' }).catch(() => {})
          }
        } else {
          const key = `levels:${next.lockedInstrument}`
          if (prepFiredRef.current !== key) {
            prepFiredRef.current = key
            fetch(
              `/api/trading/auto-levels?instrument=${encodeURIComponent(next.lockedInstrument)}`,
              { method: 'POST' }
            ).catch(() => {})
          }
        }
      }
    } catch {
      setGateError('Session gate unreachable — check deploy / network')
    }
  }, [onGate])

  const handleClockIn = useCallback(async () => {
    if (clocking) return
    setClocking(true)
    try {
      const market = gate?.market || (gate?.lockedInstrument === 'NIKKEI' ? 'TOKYO' : 'NY')
      const res = await fetch('/api/trading/clock-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market,
          instrument: gate?.lockedInstrument ?? undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.warn('clock-in failed', json.error)
      }
      await refresh()
    } finally {
      setClocking(false)
    }
  }, [clocking, gate?.market, gate?.lockedInstrument, refresh])

  useEffect(() => {
    setMounted(true)
    const tick = () => {
      const c = formatDeskClock(gate?.market)
      setClockNow(c.time)
      setClockLabel(c.label)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [gate?.market])

  useEffect(() => {
    onRefreshReady?.(refresh)
  }, [refresh, onRefreshReady])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 10_000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (refreshKey > 0) refresh()
  }, [refreshKey, refresh])

  if (!gate) {
    return (
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-xs text-gray-500 font-mono">
        <span suppressHydrationWarning>
          {mounted && clockNow ? `${clockNow} ${clockLabel} · ` : ''}
        </span>
        {gateError ? (
          <span className="text-amber-300">{gateError}</span>
        ) : (
          'loading session…'
        )}
      </div>
    )
  }

  const tone =
    gate.phase === 'ENTRY'
      ? 'border-emerald-600/50 bg-emerald-950/80 text-emerald-200'
      : gate.phase === 'MANAGE'
        ? 'border-amber-600/50 bg-amber-950/80 text-amber-100'
        : gate.phase === 'DONE'
          ? 'border-red-600/50 bg-red-950/80 text-red-200'
          : gate.phase === 'FLAT'
            ? 'border-sky-700/40 bg-sky-950/50 text-sky-100'
            : 'border-[#30363d] bg-[#161b22]/90 text-gray-300'

  const quoteAgeSec =
    lastQuoteAt != null && mounted
      ? Math.max(0, Math.floor(Date.now() / 1000) - lastQuoteAt)
      : null
  const feedOk = dataMode === 'live' && quoteAgeSec != null && quoteAgeSec < 10

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs flex flex-wrap items-center gap-3 ${tone}`}>
      <span className="font-semibold tracking-wide uppercase">{phaseLabel(gate.phase)}</span>
      <span
        className="text-gray-400 font-mono tabular-nums min-w-[5.5rem]"
        title={
          gate.market === 'TOKYO'
            ? 'Asia/Tokyo (NIKKEI desk)'
            : 'America/New_York (NY desk)'
        }
        suppressHydrationWarning
      >
        {mounted && clockNow ? `${clockNow} ${clockLabel}` : `—:—:— ${clockLabel}`}
      </span>
      {gate.lockedInstrument && (
        <span className="rounded bg-white/10 px-2 py-0.5 font-medium">{gate.lockedInstrument}</span>
      )}
      {gate.clockedIn ? (
        <span className="rounded bg-emerald-500/25 px-2 py-0.5 text-emerald-200 font-semibold">
          CLOCKED IN
        </span>
      ) : gate.canClockIn ? (
        <button
          type="button"
          onClick={handleClockIn}
          disabled={clocking}
          className="rounded bg-amber-500/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-black hover:bg-amber-400 disabled:opacity-60"
        >
          {clocking ? 'Clocking in…' : 'Today I trade'}
        </button>
      ) : gate.attendedToday ? (
        <span className="rounded bg-gray-500/30 px-2 py-0.5 text-gray-300 font-semibold">
          CLOCKED OUT
        </span>
      ) : null}
      {gate.phase === 'ENTRY' && gate.entryWindow && gate.clockedIn && (
        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300">
          Window {gate.entryWindow}/3
        </span>
      )}
      {gate.clockedIn && (
        <span
          className={`rounded px-2 py-0.5 font-semibold tabular-nums ${
            (gate.stopHits ?? 0) >= (gate.maxStopHits ?? 2) ||
            (gate.attemptsUsed ?? 0) >= (gate.maxAttempts ?? 2)
              ? 'bg-red-500/25 text-red-200'
              : 'bg-sky-500/20 text-sky-200'
          }`}
          title="Max 2 attempts per session. After 2 stop-outs, trading switches off."
        >
          Attempts {gate.attemptsUsed ?? 0}/{gate.maxAttempts ?? 2}
          {(gate.stopHits ?? 0) > 0
            ? ` · Stops ${gate.stopHits}/${gate.maxStopHits ?? 2}`
            : ''}
        </span>
      )}
      <span className="flex-1 min-w-[12rem]">{phaseHint(gate.phase, gate.message)}</span>

      <span
        className={`flex items-center gap-1.5 font-mono text-[10px] ${
          dataMode === 'synthetic'
            ? 'text-amber-400'
            : feedOk
              ? 'text-emerald-400'
              : 'text-gray-500'
        }`}
        title="Last Yahoo quote age"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            dataMode === 'synthetic'
              ? 'bg-amber-400'
              : feedOk
                ? 'bg-emerald-400 animate-pulse'
                : 'bg-gray-600'
          }`}
        />
        {dataMode === 'synthetic'
          ? 'SYNTHETIC'
          : quoteAgeSec == null
            ? 'FEED…'
            : quoteAgeSec < 3
              ? 'FEED LIVE'
              : `FEED ${quoteAgeSec}s`}
      </span>

      <Link
        href="/dashboard/simulation"
        className="text-[10px] uppercase tracking-wider text-violet-300 hover:text-violet-100"
      >
        Simulation
      </Link>

      <button
        type="button"
        onClick={refresh}
        className="text-[10px] uppercase tracking-wider text-gray-500 hover:text-white"
      >
        Refresh
      </button>
    </div>
  )
}
