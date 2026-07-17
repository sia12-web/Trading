'use client'

/**
 * Session banner for NY desk — polls /api/trading/session-gate
 * Clock ticks every second locally (ET). Phase comes from the server.
 */

import { useEffect, useState, useCallback, useRef } from 'react'

export interface SessionGateState {
  phase: string
  message: string
  lockedInstrument: 'DOW' | 'NASDAQ' | 'NIKKEI' | null
  canPlaceEntry: boolean
  canManagePosition: boolean
  canViewLiveChart: boolean
  canFetchLiveBars?: boolean
  timeEst: string
  entryWindow: 1 | 2 | 3 | null
  open_position_id: string | null
}

function formatEtNow(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
}

/** Human label — FLAT ≠ frozen feed */
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
  if (phase === 'FLAT') {
    return 'Morning trading open until lunch — click a level or the chart to place a limit.'
  }
  if (phase === 'FLAT') {
    return 'Entry window closed — levels off. Manage if in a trade; AI still updates memory.'
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
  /** Unix seconds of last live quote tick (from chart) */
  lastQuoteAt?: number | null
  dataMode?: 'live' | 'synthetic'
}) {
  const [gate, setGate] = useState<SessionGateState | null>(null)
  // Empty until mount — avoids SSR/client second mismatch hydration error
  const [clockEt, setClockEt] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  /** Fire market-open / auto-levels once per instrument per page load */
  const prepFiredRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/trading/session-gate?_=${Date.now()}`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const json = await res.json()
      const next: SessionGateState = {
        phase: json.phase,
        message: json.message,
        lockedInstrument: json.lockedInstrument,
        canPlaceEntry: json.canPlaceEntry,
        canManagePosition: json.canManagePosition,
        canViewLiveChart: json.canViewLiveChart,
        timeEst: json.timeEst,
        entryWindow: json.entryWindow,
        open_position_id: json.open_position_id,
      }
      setGate(next)
      onGate?.(next)

      // Auto prep once per load — same path for DOW / NASDAQ / NIKKEI
      if (next.phase === 'RECOMMENDED' || next.phase === 'PREP' || next.phase === 'ENTRY') {
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
      /* ignore */
    }
  }, [onGate])

  // Live ET clock — start only after mount (SSR HTML must match first client paint)
  useEffect(() => {
    setMounted(true)
    setClockEt(formatEtNow())
    const id = setInterval(() => setClockEt(formatEtNow()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    onRefreshReady?.(refresh)
  }, [refresh, onRefreshReady])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (refreshKey > 0) refresh()
  }, [refreshKey, refresh])

  if (!gate) {
    return (
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-xs text-gray-500 font-mono">
        <span suppressHydrationWarning>
          {mounted && clockEt ? `${clockEt} ET · ` : ''}
        </span>
        loading session…
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
        title="America/New_York (live)"
        suppressHydrationWarning
      >
        {mounted && clockEt ? `${clockEt} ET` : '—:—:— ET'}
      </span>
      {gate.lockedInstrument && (
        <span className="rounded bg-white/10 px-2 py-0.5 font-medium">{gate.lockedInstrument}</span>
      )}
      {gate.phase === 'ENTRY' && gate.entryWindow && (
        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300">
          Window {gate.entryWindow}/3
        </span>
      )}
      <span className="flex-1 min-w-[12rem]">{phaseHint(gate.phase, gate.message)}</span>

      {/* Feed health — proves ticks are moving even in POST-ENTRY */}
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
