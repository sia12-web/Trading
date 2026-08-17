'use client'

/**
 * Session banner for NY/Tokyo desk — polls /api/trading/session-gate
 * Clock-in (“Today I trade”) unlocks live chart + level reaction AI.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  deskPlaybookAnalysisMode,
  resolveDeskPlaybookMode,
} from '@/lib/trading/deskPlaybookMode'
import { attemptLadderFromCounts, MAX_DAY_ATTEMPTS } from '@/lib/trading/attemptLadder'
import {
  buildDeskNewsHazards,
  pickBannerHazard,
  type DeskNewsHazard,
} from '@/lib/trading/deskNewsHazard'
import type { DeskCalendarEvent } from '@/lib/trading/deskNews'
import { nikkeiCashLunchMontrealLabel } from '@/lib/trading/sessionGate'
import { liveDeskContractLabel } from '@/lib/trading/liveDeskBook'
import {
  getDeskRiskProfile,
  hydrateDeskRiskProfileFromServer,
  isTradeifyGrowth50k,
  DESK_RISK_PROFILE_EVENT,
  type DeskRiskProfile,
} from '@/lib/trading/tradeifyProfile'
import { formatTradeifyBannerChip } from '@/lib/trading/tradeifyGrowth50k'
import { DeskCallModePrompt } from './DeskCallModePrompt'

export interface SessionGateState {
  phase: string
  message: string
  lockedInstrument: 'DOW' | 'NASDAQ' | 'NIKKEI' | null
  suggestedInstrument?: 'DOW' | 'NASDAQ' | 'NIKKEI' | null
  allowedInstruments?: Array<'DOW' | 'NASDAQ' | 'NIKKEI'>
  canPlaceEntry: boolean
  canManagePosition: boolean
  canViewLiveChart: boolean
  canFetchLiveBars?: boolean
  clockedIn?: boolean
  attendedToday?: boolean
  canClockIn?: boolean
  glanceOnly?: boolean
  /** Clock-in CALL choice: true = CALL gate, false = regular ±10, null = not answered */
  useCall?: boolean | null
  market?: 'NY' | 'TOKYO'
  timeEst: string
  entryWindow: 1 | 2 | 3 | null
  open_position_id: string | null
  attemptsUsed?: number
  maxAttempts?: number
  stopHits?: number
  maxStopHits?: number
  morningAttempts?: number
  ibAttempts?: number
  lunchAttempts?: number
  maxMorningAttempts?: number
  maxIbAttempts?: number
  maxLunchAttempts?: number
  revengeLocked?: boolean
  dayLocked?: boolean
  attemptLadderLabel?: string
  /** Slot-2 / slot-3 unlock (NY: ib|lunch_range · Tokyo: us_range|ib) */
  rangeStrategy?: 'ib' | 'lunch_range' | 'us_range' | null
  tradeifyDayLocked?: boolean
  tradeifyLockMessage?: string | null
  tradeifyRefuseReason?: string | null
  tradeifyMustFlatten?: boolean
  tradeifyLeftoverDll?: number | null
  tradeifyFloorRoom?: number | null
  tradeifyStatus?: 'can_trade' | 'day_locked' | 'must_flatten' | null
  tradeifyFlattenMontreal?: string | null
}

/** Live banner clock — always Montreal (Eastern). */
function formatDeskClock(_market?: 'NY' | 'TOKYO' | null): { time: string; label: string } {
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
  return { time, label: 'Montreal' }
}

function phaseLabel(
  phase: string,
  rangeStrategy?: 'ib' | 'lunch_range' | 'us_range' | null,
  instrument?: 'DOW' | 'NASDAQ' | 'NIKKEI' | null
): string {
  if (rangeStrategy === 'us_range') return 'US-RANGE'
  if (rangeStrategy === 'ib') return instrument === 'NIKKEI' ? 'IB' : 'IB'
  if (rangeStrategy === 'lunch_range') return 'LUNCH-RANGE'
  switch (phase) {
    case 'FLAT':
      return 'MORNING'
    case 'RECOMMENDED':
      return 'PRE-OPEN'
    default:
      return phase
  }
}

/** Banner copy comes from sessionGate — keep one source of truth (no phase overrides). */
function phaseHint(_phase: string, message: string): string {
  return message
}

export function SessionBanner({
  onGate,
  refreshKey = 0,
  onRefreshReady,
  lastQuoteAt = null,
  dataMode = 'live',
  viewingInstrument = null,
}: {
  onGate?: (g: SessionGateState) => void
  refreshKey?: number
  onRefreshReady?: (refresh: () => void) => void
  lastQuoteAt?: number | null
  dataMode?: 'live' | 'synthetic'
  /** Current chart tab — preferred clock-in commitment when in focus market */
  viewingInstrument?: 'DOW' | 'NASDAQ' | 'NIKKEI' | null
}) {
  const [gate, setGate] = useState<SessionGateState | null>(null)
  const [gateError, setGateError] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState<string | null>(null)
  const [clockLabel, setClockLabel] = useState('Montreal')
  const [mounted, setMounted] = useState(false)
  const [clocking, setClocking] = useState(false)
  const [clockInError, setClockInError] = useState<string | null>(null)
  const [callModeBusy, setCallModeBusy] = useState(false)
  const [callModeError, setCallModeError] = useState<string | null>(null)
  const prepFiredRef = useRef<string | null>(null)
  const [newsHazard, setNewsHazard] = useState<DeskNewsHazard | null>(null)
  const [newsUnavailable, setNewsUnavailable] = useState(false)
  const [riskProfile, setRiskProfile] = useState<DeskRiskProfile>('tradeify_growth_50k')

  useEffect(() => {
    let cancelled = false
    const sync = () => setRiskProfile(getDeskRiskProfile())
    void hydrateDeskRiskProfileFromServer().then((profile) => {
      if (!cancelled) setRiskProfile(profile)
    })
    window.addEventListener(DESK_RISK_PROFILE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      cancelled = true
      window.removeEventListener(DESK_RISK_PROFILE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (!gate) return
    if (
      !isTradeifyGrowth50k(riskProfile) ||
      !(gate.tradeifyDayLocked || gate.tradeifyMustFlatten)
    )
      return
    if (!gate.canPlaceEntry) return
    const next = { ...gate, canPlaceEntry: false }
    setGate(next)
    onGate?.(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskProfile, gate?.tradeifyDayLocked, gate?.tradeifyMustFlatten])

  const refresh = useCallback(async () => {
    try {
      const q = new URLSearchParams({ _: String(Date.now()) })
      if (viewingInstrument) q.set('instrument', viewingInstrument)
      const res = await fetch(`/api/trading/session-gate?${q}`, {
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
        suggestedInstrument:
          json.suggestedInstrument ?? json.suggested_instrument ?? null,
        allowedInstruments: Array.isArray(json.allowedInstruments)
          ? json.allowedInstruments
          : undefined,
        canPlaceEntry: json.canPlaceEntry,
        canManagePosition: json.canManagePosition,
        canViewLiveChart: json.canViewLiveChart,
        canFetchLiveBars: json.canFetchLiveBars,
        clockedIn: !!json.clockedIn,
        attendedToday: !!json.attendedToday,
        canClockIn: !!json.canClockIn,
        glanceOnly: !!json.glanceOnly,
        useCall:
          json.useCall === true ? true : json.useCall === false ? false : null,
        market: json.market,
        timeEst: json.timeEst,
        entryWindow: json.entryWindow,
        open_position_id: json.open_position_id,
        attemptsUsed: Number(json.attemptsUsed ?? json.attempts_used ?? 0),
        maxAttempts: Number(json.maxAttempts ?? json.max_attempts ?? MAX_DAY_ATTEMPTS),
        stopHits: Number(json.stopHits ?? json.stop_hits ?? 0),
        maxStopHits: Number(json.maxStopHits ?? json.max_stop_hits ?? 2),
        morningAttempts: Number(json.morningAttempts ?? json.morning_attempts ?? 0),
        ibAttempts: Number(json.ibAttempts ?? json.ib_attempts ?? 0),
        lunchAttempts: Number(json.lunchAttempts ?? json.lunch_attempts ?? 0),
        maxMorningAttempts: Number(json.maxMorningAttempts ?? 2),
        maxIbAttempts: Number(json.maxIbAttempts ?? 2),
        maxLunchAttempts: Number(json.maxLunchAttempts ?? 2),
        revengeLocked: !!(json.revengeLocked ?? json.revenge_locked),
        dayLocked: !!(json.dayLocked ?? json.day_locked),
        attemptLadderLabel:
          typeof json.attemptLadderLabel === 'string'
            ? json.attemptLadderLabel
            : typeof json.attempt_ladder === 'string'
              ? json.attempt_ladder
              : undefined,
        rangeStrategy:
          json.rangeStrategy === 'ib' ||
          json.rangeStrategy === 'lunch_range' ||
          json.rangeStrategy === 'us_range'
            ? json.rangeStrategy
            : null,
        tradeifyDayLocked: !!(json.tradeify?.dayLocked || json.tradeify?.allowed === false),
        tradeifyLockMessage:
          typeof json.tradeify?.refuseMessage === 'string'
            ? json.tradeify.refuseMessage
            : null,
        tradeifyRefuseReason:
          typeof json.tradeify?.refuseReason === 'string'
            ? json.tradeify.refuseReason
            : null,
        tradeifyMustFlatten: !!json.tradeify?.mustFlatten,
        tradeifyLeftoverDll:
          typeof json.tradeify?.leftoverDll === 'number' ? json.tradeify.leftoverDll : null,
        tradeifyFloorRoom:
          typeof json.tradeify?.floorRoom === 'number' ? json.tradeify.floorRoom : null,
        tradeifyStatus:
          json.tradeify?.status === 'must_flatten' ||
          json.tradeify?.status === 'day_locked' ||
          json.tradeify?.status === 'can_trade'
            ? json.tradeify.status
            : null,
        tradeifyFlattenMontreal:
          typeof json.tradeify?.flattenMontreal === 'string'
            ? json.tradeify.flattenMontreal
            : null,
      }
      if (
        isTradeifyGrowth50k(getDeskRiskProfile()) &&
        (next.tradeifyDayLocked || next.tradeifyMustFlatten)
      ) {
        next.canPlaceEntry = false
      }
      setGate(next)
      onGate?.(next)

      // Prep / refresh levels for morning, IB, lunch-break prep, and lunch-range
      if (
        next.clockedIn &&
        (next.phase === 'RECOMMENDED' ||
          next.phase === 'PREP' ||
          next.phase === 'ENTRY' ||
          next.phase === 'FLAT' ||
          next.phase === 'DONE')
      ) {
        if (!next.lockedInstrument) {
          if (prepFiredRef.current !== 'market-open') {
            prepFiredRef.current = 'market-open'
            fetch('/api/trading/market-open', { method: 'POST' }).catch(() => {})
          }
        } else {
          const playbookMode = resolveDeskPlaybookMode({
            instrument: next.lockedInstrument,
            rangeStrategy: next.rangeStrategy ?? null,
            ladder: attemptLadderFromCounts({
              morningAttempts: next.morningAttempts ?? 0,
              ibAttempts: next.ibAttempts ?? 0,
              lunchAttempts: next.lunchAttempts ?? 0,
              morningStopHits: next.stopHits ?? 0,
            }),
          })
          const mode = deskPlaybookAnalysisMode(playbookMode, next.lockedInstrument)
          const key = `levels:${next.lockedInstrument}:${playbookMode}`
          if (prepFiredRef.current !== key) {
            prepFiredRef.current = key
            // Morning prep only on ENTRY/PREP/RECOMMENDED; IB/lunch_range/afternoon always refresh
            if (
              mode === 'morning' &&
              next.phase !== 'ENTRY' &&
              next.phase !== 'PREP' &&
              next.phase !== 'RECOMMENDED'
            ) {
              /* skip */
            } else {
              fetch(
                `/api/trading/auto-levels?instrument=${encodeURIComponent(next.lockedInstrument)}&force=${
                  mode === 'morning' ? '0' : '1'
                }&mode=${encodeURIComponent(mode)}`,
                { method: 'POST' }
              ).catch(() => {})
            }
          }
        }
      }
    } catch {
      setGateError('Session gate unreachable — check deploy / network')
    }
  }, [onGate, viewingInstrument])

  // Finnhub economic calendar → soft news hazard chip (high-impact only)
  useEffect(() => {
    let cancelled = false
    const desk =
      gate?.lockedInstrument ||
      viewingInstrument ||
      null
    if (!desk) {
      setNewsHazard(null)
      return
    }

    const load = async () => {
      try {
        const res = await fetch(
          `/api/trading/desk-news?window=24&desk=${desk}&session=0&calendarOnly=1&_=${Date.now()}`,
          { cache: 'no-store' }
        )
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean
          calendar?: DeskCalendarEvent[]
          error?: string
        } | null
        if (cancelled) return
        if (!json?.ok || !Array.isArray(json.calendar)) {
          setNewsUnavailable(true)
          setNewsHazard(null)
          return
        }
        setNewsUnavailable(false)
        const hazards = buildDeskNewsHazards({
          calendar: json.calendar,
          instrument: desk,
          includeUpcomingDay: true,
        })
        setNewsHazard(pickBannerHazard(hazards))
      } catch {
        if (!cancelled) {
          setNewsUnavailable(true)
          setNewsHazard(null)
        }
      }
    }

    void load()
    const id = window.setInterval(load, 120_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [gate?.lockedInstrument, viewingInstrument, refreshKey])

  const handleClockInName = useCallback(
    async (inst: 'DOW' | 'NASDAQ') => {
      if (clocking) return
      setClocking(true)
      setClockInError(null)
      try {
        const res = await fetch('/api/trading/clock-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            market: 'NY',
            instrument: inst,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg =
            typeof json.error === 'string' && json.error
              ? json.error
              : `Clock-in failed (${res.status})`
          setClockInError(msg)
          return
        }
        setClockInError(null)
        await refresh()
      } catch {
        setClockInError('Clock-in unreachable — check network or deploy')
      } finally {
        setClocking(false)
      }
    },
    [clocking, refresh]
  )

  const handleCallMode = useCallback(
    async (useCall: boolean) => {
      if (callModeBusy) return
      setCallModeBusy(true)
      setCallModeError(null)
      try {
        const res = await fetch('/api/trading/call-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            useCall,
            market: gate?.market,
            instrument: viewingInstrument || gate?.lockedInstrument,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setCallModeError(
            typeof json.error === 'string' && json.error
              ? json.error
              : `CALL choice failed (${res.status})`
          )
          return
        }
        await refresh()
      } catch {
        setCallModeError('Could not save CALL choice — check network')
      } finally {
        setCallModeBusy(false)
      }
    },
    [
      callModeBusy,
      gate?.market,
      gate?.lockedInstrument,
      viewingInstrument,
      refresh,
    ]
  )

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
  const tradeifyChip = isTradeifyGrowth50k(riskProfile)
    ? formatTradeifyBannerChip({
        leftoverDll: gate.tradeifyLeftoverDll ?? 1250,
        floorRoom: gate.tradeifyFloorRoom ?? 2000,
        status:
          gate.tradeifyStatus ??
          (gate.tradeifyMustFlatten
            ? 'must_flatten'
            : gate.tradeifyDayLocked
              ? 'day_locked'
              : 'can_trade'),
        refuseReason: gate.tradeifyRefuseReason,
        flattenMontreal: gate.tradeifyFlattenMontreal,
      })
    : null

  return (
    <>
    <div className={`rounded-lg border px-3 py-2 text-xs flex flex-wrap items-center gap-3 ${tone}`}>
      <span className="font-semibold tracking-wide uppercase">
        {phaseLabel(gate.phase, gate.rangeStrategy, gate.lockedInstrument)}
      </span>
      <span
        className="text-gray-400 font-mono tabular-nums min-w-[5.5rem]"
        title="Montreal time (America/Toronto)"
        suppressHydrationWarning
      >
        {mounted && clockNow ? `${clockNow} ${clockLabel}` : `—:—:— ${clockLabel}`}
      </span>
      {gate.lockedInstrument && (
        <span className="rounded bg-white/10 px-2 py-0.5 font-medium">
          {liveDeskContractLabel(gate.lockedInstrument)}
        </span>
      )}
      {viewingInstrument === 'NIKKEI' && (
        <span
          className="text-[10px] text-gray-500 tabular-nums"
          title="Tokyo Stock Exchange cash lunch (11:30–12:30 JST) · Montreal wall clock"
        >
          {nikkeiCashLunchMontrealLabel()}
        </span>
      )}
      {gate.clockedIn ? (
        <span className="rounded bg-emerald-500/25 px-2 py-0.5 text-emerald-200 font-semibold">
          CLOCKED IN
        </span>
      ) : gate.phase === 'MANAGE' && gate.canManagePosition ? (
        <span className="rounded bg-amber-500/25 px-2 py-0.5 text-amber-200 font-semibold">
          MANAGE OPEN
        </span>
      ) : gate.canClockIn && gate.market !== 'TOKYO' ? (
        <span className="flex items-center gap-1.5">
          {(['DOW', 'NASDAQ'] as const).map((inst) => (
            <button
              key={inst}
              type="button"
              onClick={() => void handleClockInName(inst)}
              disabled={clocking}
              className="rounded bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-black hover:bg-amber-400 disabled:opacity-60"
            >
              {clocking ? '…' : inst === 'DOW' ? 'DOW · MYM' : 'NASDAQ · MNQ'}
            </button>
          ))}
        </span>
      ) : gate.attendedToday &&
        !gate.canClockIn &&
        // Afternoon watch only — hide once cash close clears the day lock / focus
        !!gate.lockedInstrument ? (
        <span className="rounded bg-gray-500/30 px-2 py-0.5 text-gray-300 font-semibold">
          CLOCKED OUT
        </span>
      ) : null}
      {gate.clockedIn && gate.useCall === true && (
        <button
          type="button"
          disabled={callModeBusy}
          onClick={() => void handleCallMode(false)}
          className="rounded bg-zinc-500/25 px-2 py-0.5 text-zinc-200 font-semibold hover:bg-zinc-500/40 disabled:opacity-60"
          title="CALL gate on. Click to use regular ±10 — CALL setup stays on the chip."
        >
          CALL ON
        </button>
      )}
      {gate.clockedIn && gate.useCall === false && (
        <button
          type="button"
          disabled={callModeBusy}
          onClick={() => void handleCallMode(true)}
          className="rounded bg-sky-500/20 px-2 py-0.5 text-sky-200 font-semibold hover:bg-sky-500/30 disabled:opacity-60"
          title="Regular ±10. CALL still shows the setup. Click to gate tickets on CALL."
        >
          Regular ±10
        </button>
      )}
      {clockInError && (
        <span
          className="rounded bg-red-500/25 px-2 py-0.5 text-red-200 font-semibold max-w-[20rem]"
          title={clockInError}
        >
          {clockInError}
        </span>
      )}
      {gate.phase === 'ENTRY' && gate.clockedIn && (
        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300">
          {gate.market === 'TOKYO'
            ? 'Tokyo morning entry'
            : gate.entryWindow
              ? `Window ${gate.entryWindow}/3`
              : 'Entry window'}
        </span>
      )}
      <span
        className="rounded bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black"
        title="Tradeify Growth $50k — $400 / $250 / $150 stops, shared daily budget."
      >
        Tradeify $50k
      </span>
      {tradeifyChip && (
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-semibold max-w-[22rem] truncate ${
            tradeifyChip.tone === 'flatten'
              ? 'bg-red-500/40 text-red-50'
              : tradeifyChip.tone === 'lock'
                ? 'bg-red-500/30 text-red-100'
                : 'bg-amber-500/20 text-amber-100'
          }`}
          title={gate.tradeifyLockMessage || tradeifyChip.title}
        >
          {tradeifyChip.label}
        </span>
      )}
      {gate.clockedIn && (
        <span
          className={`rounded px-2 py-0.5 font-semibold tabular-nums ${
            gate.dayLocked ||
            (gate.attemptsUsed ?? 0) >= (gate.maxAttempts ?? MAX_DAY_ATTEMPTS)
              ? 'bg-red-500/25 text-red-200'
              : 'bg-sky-500/20 text-sky-200'
          }`}
          title="Tradeify $50k · $400 → $250 → $150 · SL beyond range · TP 1.5R (1:1.5). Session max 3 fills. Up to 2 per window. Flatten 16:59 ET. Working limits do not count until filled."
        >
          {gate.attemptLadderLabel ||
            (gate.lockedInstrument === 'NIKKEI'
              ? `Session ${gate.attemptsUsed ?? 0}/${gate.maxAttempts ?? MAX_DAY_ATTEMPTS} · AM ${gate.morningAttempts ?? 0}/${gate.maxMorningAttempts ?? 2} · US ${gate.ibAttempts ?? 0}/${gate.maxIbAttempts ?? 2} · IB ${gate.lunchAttempts ?? 0}/${gate.maxLunchAttempts ?? 2}`
              : `Session ${gate.attemptsUsed ?? 0}/${gate.maxAttempts ?? MAX_DAY_ATTEMPTS} · AM ${gate.morningAttempts ?? 0}/${gate.maxMorningAttempts ?? 2} · IB ${gate.ibAttempts ?? 0}/${gate.maxIbAttempts ?? 2} · LN ${gate.lunchAttempts ?? 0}/${gate.maxLunchAttempts ?? 2}`)}
          {(gate.stopHits ?? 0) > 0
            ? ` · Stops ${gate.stopHits}/${gate.maxStopHits ?? 2}`
            : ''}
        </span>
      )}
      {newsUnavailable ? (
        <Link
          href="/dashboard/news"
          className="rounded bg-gray-500/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-200"
          title="Finnhub calendar unreachable"
        >
          News: unavailable
        </Link>
      ) : newsHazard ? (
        <Link
          href="/dashboard/news"
          className={`max-w-[18rem] truncate rounded px-2 py-0.5 text-[10px] font-semibold ${
            newsHazard.level === 'stand_aside'
              ? 'bg-red-500/30 text-red-100 hover:bg-red-500/40'
              : newsHazard.level === 'careful'
                ? 'bg-amber-500/30 text-amber-100 hover:bg-amber-500/40'
                : 'bg-violet-500/20 text-violet-100 hover:bg-violet-500/30'
          }`}
          title={`${newsHazard.body} Soft warn only — not a trade signal.`}
        >
          {newsHazard.level === 'stand_aside'
            ? '⛔ '
            : newsHazard.level === 'careful'
              ? '⚠ '
              : '📰 '}
          {newsHazard.chip}
        </Link>
      ) : null}
      <span className="flex-1 min-w-[12rem]">{phaseHint(gate.phase, gate.message)}</span>

      <span
        className={`flex items-center gap-1.5 font-mono text-[10px] ${
          dataMode === 'synthetic'
            ? 'text-amber-400'
            : feedOk
              ? 'text-emerald-400'
              : 'text-gray-500'
        }`}
        title="Desk tip = OANDA mid (same broker as orders). Not CMC Markets / Yahoo cash."
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
            ? 'OANDA…'
            : quoteAgeSec < 3
              ? 'OANDA LIVE'
              : `OANDA ${quoteAgeSec}s`}
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
    <DeskCallModePrompt
      open={!!gate.clockedIn && gate.useCall == null}
      busy={callModeBusy}
      error={callModeError}
      onChoose={handleCallMode}
    />
    </>
  )
}
