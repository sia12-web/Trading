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
import { LTARModal } from './LTARModal'

export interface SessionGateState {
  phase: string
  message: string
  lockedInstrument: 'DOW' | 'NASDAQ' | 'NIKKEI' | 'GOLD' | 'CRUDE' | null
  suggestedInstrument?: 'DOW' | 'NASDAQ' | 'NIKKEI' | 'GOLD' | 'CRUDE' | null
  allowedInstruments?: Array<'DOW' | 'NASDAQ' | 'NIKKEI' | 'GOLD' | 'CRUDE'>
  /** 9:15 ranked board — soft priority across NY books */
  rankedBoard?: Array<{
    instrument: 'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE'
    confidence: number
  }>
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
  rangeStrategy?: 'or30' | 'ib' | 'us_range' | null
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
  rangeStrategy?: 'or30' | 'ib' | 'us_range' | null,
  instrument?: 'DOW' | 'NASDAQ' | 'NIKKEI' | 'GOLD' | 'CRUDE' | null
): string {
  if (rangeStrategy === 'us_range') return 'US-RANGE'
  if (rangeStrategy === 'or30') return 'OR30'
  if (rangeStrategy === 'ib') return instrument === 'NIKKEI' ? 'TOKYO-IB' : 'IB'
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
  viewingInstrument?: 'DOW' | 'NASDAQ' | 'NIKKEI' | 'GOLD' | 'CRUDE' | null
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
  const [htfStatus, setHtfStatus] = useState<string | null>(null)
  const [htfSummary, setHtfSummary] = useState<string | null>(null)
  const [isLtarOpen, setIsLtarOpen] = useState(false)
  const [htfPerf, setHtfPerf] = useState<{
    grade: string
    targetMultiplier: number
    expectedRR: string
    holdingDirective: string
  } | null>(null)
  const [htfBracket, setHtfBracket] = useState<{
    bracketMode: string
    tradeLocationGrade: string
    directiveSummary: string
  } | null>(null)
  const [htfCorr, setHtfCorr] = useState<{
    type: string
    isDisguised: boolean
    underlyingStrength: string
    directiveSummary: string
  } | null>(null)
  const [htfSituation, setHtfSituation] = useState<{
    activeSituation: string
    continuationProbabilityPct: number
    primaryTargetPrice: number | null
    directiveSummary: string
  } | null>(null)
  const [htfStandAside, setHtfStandAside] = useState<{
    isStandAside: boolean
    reason: string
    severity: string
    directiveSummary: string
    newsSentimentRating?: string
  } | null>(null)
  const [isActivityRecordOpen, setIsActivityRecordOpen] = useState(false)

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
        rankedBoard: Array.isArray(json.rankedBoard) ? json.rankedBoard : undefined,
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
            json.rangeStrategy === 'or30' ||
            json.rangeStrategy === 'ib' ||
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
            fetch('/api/trading/market-open', { method: 'POST' }).catch(() => { })
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
                `/api/trading/auto-levels?instrument=${encodeURIComponent(next.lockedInstrument)}&force=${mode === 'morning' ? '0' : '1'
                }&mode=${encodeURIComponent(mode)}`,
                { method: 'POST' }
              ).catch(() => { })
            }
          }
        }
      }
      // Fetch Day Timeframe (Layer 1) Specialist state
      const targetInst = viewingInstrument || next.lockedInstrument || 'DOW'
      fetch(`/api/trading/htf-context?instrument=${encodeURIComponent(targetInst)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.state) {
            setHtfStatus(data.state.status)
            setHtfSummary(data.state.summaryText)
            if (data.state.directionalPerformance) {
              setHtfPerf({
                grade: data.state.directionalPerformance.grade,
                targetMultiplier: data.state.directionalPerformance.dynamicRR?.targetMultiplier ?? 1.0,
                expectedRR: data.state.directionalPerformance.dynamicRR?.expectedRR ?? '1:2.0',
                holdingDirective: data.state.directionalPerformance.dynamicRR?.holdingDirective ?? '',
              })
            }
            if (data.state.bracket) {
              setHtfBracket({
                bracketMode: data.state.bracket.bracketMode,
                tradeLocationGrade: data.state.bracket.tradeLocationGrade,
                directiveSummary: data.state.bracket.directiveSummary,
              })
            }
            if (data.state.correctiveAction) {
              setHtfCorr({
                type: data.state.correctiveAction.type,
                isDisguised: data.state.correctiveAction.isDisguised,
                underlyingStrength: data.state.correctiveAction.underlyingStrength,
                directiveSummary: data.state.correctiveAction.directiveSummary,
              })
            }
            if (data.state.specialSituation) {
              setHtfSituation({
                activeSituation: data.state.specialSituation.activeSituation,
                continuationProbabilityPct: data.state.specialSituation.continuationProbabilityPct,
                primaryTargetPrice: data.state.specialSituation.primaryTargetPrice,
                directiveSummary: data.state.specialSituation.directiveSummary,
              })
            }
            if (data.state.standAside) {
              setHtfStandAside({
                isStandAside: data.state.standAside.isStandAside,
                reason: data.state.standAside.reason,
                severity: data.state.standAside.severity,
                directiveSummary: data.state.standAside.directiveSummary,
                newsSentimentRating: data.state.standAside.newsSentimentRating,
              })
            }
          }
        })
        .catch(() => { })
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
    async (inst: 'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE') => {
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
        {gate.rankedBoard && gate.rankedBoard.length > 0 && (
          <span
            className="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-200 font-mono max-w-[28rem] truncate"
            title="9:15 ranked board — soft priority. Shared 3 fills across all four."
          >
            Board:{' '}
            {gate.rankedBoard
              .slice(0, 4)
              .map((r, i) => `${i + 1}.${r.instrument}${r.confidence ? `(${Math.round(r.confidence)})` : ''}`)
              .join(' · ')}
          </span>
        )}
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
        {gate.clockedIn ? (
          <span className="rounded bg-emerald-500/25 px-2 py-0.5 text-emerald-200 font-semibold">
            CLOCKED IN
          </span>
        ) : gate.phase === 'MANAGE' && gate.canManagePosition ? (
          <span className="rounded bg-amber-500/25 px-2 py-0.5 text-amber-200 font-semibold">
            MANAGE OPEN
          </span>
        ) : gate.canClockIn && gate.market !== 'TOKYO' ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {(
              (gate.rankedBoard?.length
                ? gate.rankedBoard.map((r) => r.instrument)
                : (['DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const)
              ).filter((inst, i, arr) => arr.indexOf(inst) === i) as Array<
                'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE'
              >
            ).map((inst) => (
              <button
                key={inst}
                type="button"
                onClick={() => void handleClockInName(inst)}
                disabled={clocking}
                className="rounded bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-black hover:bg-amber-400 disabled:opacity-60"
              >
                {clocking ? '…' : liveDeskContractLabel(inst)}
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
        {gate.clockedIn && (
          <span
            className="rounded bg-sky-500/25 px-2 py-0.5 text-sky-200 font-semibold text-xs border border-sky-500/40"
            title="SYSTEM CALL ACTIVE — Trades allowed ONLY when high-conviction system call triggers."
          >
            SYSTEM CALL ONLY
          </span>
        )}
        {htfStatus && (
          <span
            className={`rounded px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide border ${htfStatus === 'BUYING_EXCESS'
              ? 'bg-emerald-500/25 text-emerald-200 border-emerald-500/40'
              : htfStatus === 'SELLING_EXCESS'
                ? 'bg-rose-500/25 text-rose-200 border-rose-500/40'
                : htfStatus === 'P_PROFILE_SHORT_COVER'
                  ? 'bg-cyan-500/25 text-cyan-200 border-cyan-500/40'
                  : htfStatus === 'B_PROFILE_LONG_LIQ'
                    ? 'bg-orange-500/25 text-orange-200 border-orange-500/40'
                    : htfStatus === 'LEDGE_STALL'
                      ? 'bg-purple-500/25 text-purple-200 border-purple-500/40'
                      : htfStatus === 'DAY_MIRAGE'
                        ? 'bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-500/40 animate-pulse'
                        : htfStatus === 'UNFINISHED_AUCTION'
                          ? 'bg-amber-500/25 text-amber-200 border-amber-500/40'
                          : 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30'
              }`}
            title={htfSummary || 'Day Timeframe Specialist — Market Profile Context & Structure'}
          >
            Day TF: {htfStatus.replace(/_/g, ' ')}
          </span>
        )}
        {htfPerf && (
          <span
            className={`rounded px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide border ${htfPerf.grade === 'VERY_STRONG'
              ? 'bg-emerald-500/30 text-emerald-200 border-emerald-400/50'
              : htfPerf.grade === 'STRONG'
                ? 'bg-sky-500/25 text-sky-200 border-sky-500/40'
                : htfPerf.grade === 'SLOWING'
                  ? 'bg-amber-500/25 text-amber-200 border-amber-500/40'
                  : htfPerf.grade === 'FAILING_DIVERGENCE' || htfPerf.grade === 'WEAK'
                    ? 'bg-rose-500/25 text-rose-200 border-rose-500/40 animate-pulse'
                    : 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30'
              }`}
            title={`Directional Performance: ${htfPerf.grade} | Target ${htfPerf.targetMultiplier}x (${htfPerf.expectedRR}) | ${htfPerf.holdingDirective}`}
          >
            Perf: {htfPerf.grade.replace(/_/g, ' ')} ({htfPerf.targetMultiplier}x Target)
          </span>
        )}
        {htfBracket && (
          <span
            className={`rounded px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide border ${htfBracket.tradeLocationGrade === 'RESPONSIVE_LONG'
              ? 'bg-emerald-500/30 text-emerald-200 border-emerald-400/50'
              : htfBracket.tradeLocationGrade === 'RESPONSIVE_SHORT'
                ? 'bg-rose-500/30 text-rose-200 border-rose-400/50'
                : htfBracket.tradeLocationGrade === 'MID_BRACKET_CHOP'
                  ? 'bg-amber-500/30 text-amber-200 border-amber-400/50 animate-pulse'
                  : 'bg-indigo-500/25 text-indigo-200 border-indigo-500/40'
              }`}
            title={`Long-Term Bracket: ${htfBracket.bracketMode} | ${htfBracket.directiveSummary}`}
          >
            Bracket: {htfBracket.tradeLocationGrade.replace(/_/g, ' ')}
          </span>
        )}
        {htfCorr && htfCorr.type !== 'NONE' && (
          <span
            className={`rounded px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide border ${htfCorr.type === 'DISGUISED_BULLISH_CORRECTION'
              ? 'bg-emerald-500/35 text-emerald-100 border-emerald-400/60 animate-pulse font-bold'
              : htfCorr.type === 'DISGUISED_BEARISH_CORRECTION'
                ? 'bg-rose-500/35 text-rose-100 border-rose-400/60 animate-pulse font-bold'
                : 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30'
              }`}
            title={`Corrective Action: ${htfCorr.type} | ${htfCorr.directiveSummary}`}
          >
            Corr: {htfCorr.type.replace(/_/g, ' ')}
          </span>
        )}
        {htfSituation && htfSituation.activeSituation !== 'NONE' && (
          <span
            className={`rounded px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide border ${htfSituation.activeSituation.includes('BULL') || htfSituation.activeSituation.includes('BUYING')
              ? 'bg-emerald-500/35 text-emerald-100 border-emerald-400/60 font-bold'
              : htfSituation.activeSituation.includes('BEAR') || htfSituation.activeSituation.includes('SELLING')
                ? 'bg-rose-500/35 text-rose-100 border-rose-400/60 font-bold'
                : 'bg-purple-500/25 text-purple-200 border-purple-500/40'
              }`}
            title={`Special Situation: ${htfSituation.activeSituation} (${htfSituation.continuationProbabilityPct}% Odds) | ${htfSituation.directiveSummary}`}
          >
            Situation: {htfSituation.activeSituation.replace(/_/g, ' ')} ({htfSituation.continuationProbabilityPct}%)
          </span>
        )}
        {htfStandAside && htfStandAside.isStandAside && (
          <span
            className="rounded px-2 py-0.5 font-bold text-[10px] uppercase tracking-wide border bg-rose-500/40 text-rose-100 border-rose-400 animate-pulse flex items-center gap-1"
            title={`Market Stand-Aside Warning: ${htfStandAside.reason} | ${htfStandAside.directiveSummary}`}
          >
            <span>🛑 Stand Aside:</span>
            <span>{htfStandAside.reason.replace(/_/g, ' ')}</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => setIsLtarOpen(true)}
          className="rounded border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/30 transition flex items-center gap-1"
          title="Open Daily 9:30 AM Long-Term Activity Record (Figure 4.65)"
        >
          <span>LTAR</span>
          <span className="text-[9px]">📋</span>
        </button>
        <button
          type="button"
          onClick={() => setIsActivityRecordOpen(true)}
          className="rounded border border-cyan-500/40 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/30 transition flex items-center gap-1"
          title="Open Daily 9:30 AM RTH Opening Briefing & Activity Record"
        >
          <span>9:30 AM RTH</span>
          <span className="text-[9px]">⏱️</span>
        </button>
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
            {gate.entryWindow ? `Window ${gate.entryWindow}/3` : 'Entry window'}
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
            className={`rounded px-2 py-0.5 text-[10px] font-semibold max-w-[22rem] truncate ${tradeifyChip.tone === 'flatten'
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
            className={`rounded px-2 py-0.5 font-semibold tabular-nums ${gate.dayLocked ||
              (gate.attemptsUsed ?? 0) >= (gate.maxAttempts ?? MAX_DAY_ATTEMPTS)
              ? 'bg-red-500/25 text-red-200'
              : 'bg-sky-500/20 text-sky-200'
              }`}
            title="Tradeify $50k · $400 → $250 → $150 · SL beyond range · TP 1.5R (1:1.5). Session max 3 fills. Up to 2 per window. Flatten 16:59 ET. Working limits do not count until filled."
          >
            {gate.attemptLadderLabel ||
              `Session ${gate.attemptsUsed ?? 0}/${gate.maxAttempts ?? MAX_DAY_ATTEMPTS} · AM ${gate.morningAttempts ?? 0}/${gate.maxMorningAttempts ?? 2} · IB ${gate.ibAttempts ?? 0}/${gate.maxIbAttempts ?? 2} · LN ${gate.lunchAttempts ?? 0}/${gate.maxLunchAttempts ?? 2}`}
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
            className={`max-w-[18rem] truncate rounded px-2 py-0.5 text-[10px] font-semibold ${newsHazard.level === 'stand_aside'
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
          className={`flex items-center gap-1.5 font-mono text-[10px] ${dataMode === 'synthetic'
            ? 'text-amber-400'
            : feedOk
              ? 'text-emerald-400'
              : 'text-gray-500'
            }`}
          title="Desk tip = OANDA mid (same broker as orders). Not CMC Markets / Yahoo cash."
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${dataMode === 'synthetic'
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
      <LTARModal
        isOpen={isLtarOpen}
        onClose={() => setIsLtarOpen(false)}
        instrument={viewingInstrument || gate?.lockedInstrument || 'DOW'}
      />
      {isActivityRecordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-2xl rounded-xl border border-cyan-500/40 bg-zinc-950 p-6 text-zinc-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⏱️</span>
                <h3 className="font-bold text-lg text-cyan-400">9:30 AM RTH Session Briefing & Activity Record</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsActivityRecordOpen(false)}
                className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                ✕ Close
              </button>
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2 text-xs font-mono">
              <div className="p-3 rounded border border-cyan-500/30 bg-cyan-950/30 space-y-1">
                <div className="font-bold text-cyan-300">DAILY 9:30 AM EST AUTOMATED DIRECTIVE BRIEFING</div>
                <div className="text-zinc-400">Recorded for session open everyday at 9:30 AM EST</div>
              </div>

              <div className="space-y-2">
                {htfStandAside && htfStandAside.isStandAside && (
                  <div className="p-2.5 rounded bg-rose-950/50 border border-rose-500/60 text-rose-200 space-y-1">
                    <div className="font-bold text-rose-300 flex items-center gap-1.5 text-xs">
                      <span>🛑</span>
                      <span>MARKET STAND-ASIDE WARNING: {htfStandAside.reason}</span>
                    </div>
                    <p className="text-zinc-200">{htfStandAside.directiveSummary}</p>
                    {htfStandAside.newsSentimentRating && (
                      <p className="text-amber-300 font-semibold">
                        News Sentiment Rating: {htfStandAside.newsSentimentRating}
                      </p>
                    )}
                  </div>
                )}
                <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                  <span className="text-zinc-400">Special Situation: </span>
                  <span className="font-bold text-cyan-300">
                    {htfSituation ? `${htfSituation.activeSituation} (${htfSituation.continuationProbabilityPct}% Odds)` : 'None active'}
                  </span>
                  <p className="mt-1 text-zinc-300">{htfSituation?.directiveSummary || 'Standard Market Profile rotation.'}</p>
                </div>

                <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                  <span className="text-zinc-400">Long-Term Bracket: </span>
                  <span className="font-bold text-indigo-300">{htfBracket?.bracketMode || 'BALANCED'}</span>
                  <p className="mt-1 text-zinc-300">{htfBracket?.directiveSummary || 'No bracket expansion.'}</p>
                </div>

                <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                  <span className="text-zinc-400">Corrective Action: </span>
                  <span className="font-bold text-emerald-300">{htfCorr?.type || 'NONE'}</span>
                  <p className="mt-1 text-zinc-300">{htfCorr?.directiveSummary || 'No disguised correction.'}</p>
                </div>

                <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                  <span className="text-zinc-400">Directional Performance: </span>
                  <span className="font-bold text-amber-300">{htfPerf?.grade || 'BALANCING'}</span>
                  <p className="mt-1 text-zinc-300">Target Multiplier: {htfPerf?.targetMultiplier}x ({htfPerf?.expectedRR})</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsActivityRecordOpen(false)}
                className="rounded bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500"
              >
                Acknowledge 9:30 AM Record
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
