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
  DESK_RISK_PROFILE_EVENT,
  type DeskRiskProfile,
} from '@/lib/trading/deskRiskProfile'
import { SYSTEMATIC_LIVE_DESK } from '@/lib/trading/systematicDesk'
import { getFeedMetricsSnapshot } from '@/lib/databento/feedLatencySelector'
import { useInternetLatency } from '@/lib/trading/useInternetLatency'
import type { DeskInstrument } from '@/lib/trading/sessionGate'

export interface SessionGateState {
  phase: string
  message: string
  lockedInstrument: DeskInstrument | null
  suggestedInstrument?: DeskInstrument | null
  allowedInstruments?: Array<DeskInstrument>
  /** 9:15 ranked board — soft priority across NY books */
  rankedBoard?: Array<{
    instrument: DeskInstrument
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
  /** GOLD/DOW Asia overnight book — chart unlocked outside NY cash */
  asiaDeskActive?: boolean
  /** Live desk is always CALL ON when clocked in. */
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
  deskRiskLocked?: boolean
  deskRiskLockMessage?: string | null
  deskRiskRefuseReason?: string | null
  deskRiskMustFlatten?: boolean
  deskRiskLeftoverDll?: number | null
  deskRiskFloorRoom?: number | null
  deskRiskStatus?: 'can_trade' | 'day_locked' | 'must_flatten' | null
  deskRiskFlattenMontreal?: string | null
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
  instrument?: DeskInstrument | null
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


export function SessionBanner({
  onGate,
  refreshKey = 0,
  onRefreshReady,
  lastQuoteAt: _lastQuoteAt = null,
  dataMode: _dataMode = 'live',
  viewingInstrument = null,
  asiaOrderLive = false,
}: {
  onGate?: (g: SessionGateState) => void
  refreshKey?: number
  onRefreshReady?: (refresh: () => void) => void
  lastQuoteAt?: number | null
  dataMode?: 'live' | 'synthetic'
  /** Current chart tab — preferred clock-in commitment when in focus market */
  viewingInstrument?: DeskInstrument | null
  /** Qualified Asia OCO after 02:00 lock — hide the badge unless the recipe fires */
  asiaOrderLive?: boolean
}) {
  const [gate, setGate] = useState<SessionGateState | null>(null)
  const [gateError, setGateError] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState<string | null>(null)
  const [clockLabel, setClockLabel] = useState('Montreal')
  const [mounted, setMounted] = useState(false)

  const prepFiredRef = useRef<string | null>(null)
  const [newsHazard, setNewsHazard] = useState<DeskNewsHazard | null>(null)
  const [newsUnavailable, setNewsUnavailable] = useState(false)
  const [riskProfile, setRiskProfile] = useState<DeskRiskProfile>('personal_futures')
  const [feedSnap, setFeedSnap] = useState(() => getFeedMetricsSnapshot())
  const internetLatency = useInternetLatency()

  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      setFeedSnap(getFeedMetricsSnapshot())
    }, 5000)
    return () => clearInterval(timer)
  }, [])
  const [htfStatus, setHtfStatus] = useState<string | null>(null)
  const [htfSummary, setHtfSummary] = useState<string | null>(null)
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
    if (!gate.deskRiskLocked && !gate.deskRiskMustFlatten) return
    if (!gate.canPlaceEntry) return
    const next = { ...gate, canPlaceEntry: false }
    setGate(next)
    onGate?.(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskProfile, gate?.deskRiskLocked, gate?.deskRiskMustFlatten])

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
        asiaDeskActive: !!json.asiaDeskActive,
        useCall: false,
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
        deskRiskLocked: !!(json.deskRisk?.dayLocked || json.deskRisk?.allowed === false || json.tradeify?.dayLocked),
        deskRiskLockMessage:
          typeof json.deskRisk?.refuseMessage === 'string'
            ? json.deskRisk.refuseMessage
            : typeof json.tradeify?.refuseMessage === 'string'
              ? json.tradeify.refuseMessage
              : null,
        deskRiskRefuseReason:
          typeof json.deskRisk?.refuseReason === 'string'
            ? json.deskRisk.refuseReason
            : typeof json.tradeify?.refuseReason === 'string'
              ? json.tradeify.refuseReason
              : null,
        deskRiskMustFlatten: !!(json.deskRisk?.mustFlatten || json.tradeify?.mustFlatten),
        deskRiskLeftoverDll:
          typeof json.deskRisk?.leftoverDll === 'number' ? json.deskRisk.leftoverDll : null,
        deskRiskFloorRoom:
          typeof json.deskRisk?.floorRoom === 'number' ? json.deskRisk.floorRoom : null,
        deskRiskStatus:
          json.deskRisk?.status === 'must_flatten' ||
          json.deskRisk?.status === 'day_locked' ||
          json.deskRisk?.status === 'can_trade'
            ? json.deskRisk.status
            : null,
        deskRiskFlattenMontreal:
          typeof json.deskRisk?.flattenMontreal === 'string'
            ? json.deskRisk.flattenMontreal
            : null,
      }
      if (next.deskRiskLocked || next.deskRiskMustFlatten) {
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
      if (!SYSTEMATIC_LIVE_DESK) {
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

    let timerId: number | null = null

    const scheduleNext = (delayMs: number) => {
      if (cancelled) return
      if (timerId != null) window.clearTimeout(timerId)
      timerId = window.setTimeout(async () => {
        await load()
      }, delayMs)
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
          scheduleNext(30_000)
          return
        }
        setNewsUnavailable(false)
        const hazards = buildDeskNewsHazards({
          calendar: json.calendar,
          instrument: desk,
          includeUpcomingDay: true,
        })
        const picked = pickBannerHazard(hazards)
        setNewsHazard(picked)

        // Rapid 10s polling when a release print just dropped or event is near
        const isUrgent =
          picked?.level === 'released' ||
          picked?.level === 'stand_aside' ||
          picked?.level === 'careful' ||
          hazards.some((h) => h.atMs != null && Math.abs(h.atMs - Date.now()) <= 30 * 60 * 1000)

        scheduleNext(isUrgent ? 10_000 : 30_000)
      } catch {
        if (!cancelled) {
          setNewsUnavailable(true)
          setNewsHazard(null)
          scheduleNext(30_000)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timerId != null) window.clearTimeout(timerId)
    }
  }, [gate?.lockedInstrument, viewingInstrument, refreshKey])



  useEffect(() => {
    setMounted(true)
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      const c = formatDeskClock(gate?.market)
      setClockNow(c.time)
      setClockLabel(c.label)
    }
    tick()
    const id = setInterval(tick, 1000)
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [gate?.market])

  useEffect(() => {
    onRefreshReady?.(refresh)
  }, [refresh, onRefreshReady])

  useEffect(() => {
    refresh()
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      refresh()
    }, 10_000)
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
            : gate.phase === 'ASIA'
              ? 'border-purple-500/50 bg-purple-950/80 text-purple-200 shadow-sm shadow-purple-500/10'
              : 'border-[#30363d] bg-[#161b22]/90 text-gray-300'

  const currentPhaseLabel = phaseLabel(gate.phase, gate.rangeStrategy, gate.lockedInstrument)

  return (
    <>
      <div className={`rounded-lg border px-3 py-2 text-xs flex flex-wrap items-center gap-3 ${tone}`}>
        {currentPhaseLabel && currentPhaseLabel !== 'CLOSED' && (
          <span className="font-semibold tracking-wide uppercase flex items-center gap-1.5">
            {gate.phase === 'ASIA' && (
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            )}
            {currentPhaseLabel === 'ASIA' ? 'ASIA LIVE' : currentPhaseLabel}
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
        <span
          className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold border ${
            feedSnap.activeFeed.status === 'HEALTHY'
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          }`}
          title={`Active Databento CME feed: ${feedSnap.activeFeed.name} (${feedSnap.activeFeed.qualityScore}/100 quality)`}
        >
          ⚡ Databento CME · {feedSnap.activeFeed.latencyMs}ms {feedSnap.zeroGapActive ? '(Zero Gap)' : ''}
        </span>
        <span
          className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold border flex items-center gap-1.5 transition-colors ${
            !internetLatency.isOnline || internetLatency.status === 'DISCONNECTED'
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
              : internetLatency.latencyMs > 180
              ? 'bg-red-500/15 text-red-300 border-red-500/30'
              : internetLatency.latencyMs > 90
              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
          }`}
          title={`Your Local Internet Latency (Browser to Server RTT): ${internetLatency.latencyMs}ms · Jitter: ${internetLatency.jitterMs}ms · Quality: ${internetLatency.status}`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              !internetLatency.isOnline || internetLatency.status === 'DISCONNECTED'
                ? 'bg-rose-400'
                : internetLatency.latencyMs > 180
                ? 'bg-red-400'
                : internetLatency.latencyMs > 90
                ? 'bg-amber-400'
                : 'bg-emerald-400'
            }`}
          />
          <span>
            🌐 Internet · {!internetLatency.isOnline || internetLatency.status === 'DISCONNECTED'
              ? 'Offline'
              : internetLatency.latencyMs > 0
              ? `${internetLatency.latencyMs}ms`
              : 'Measuring...'}
          </span>
        </span>
        {asiaOrderLive && (
          <span
            className="rounded bg-lime-500/25 px-2 py-0.5 text-lime-200 font-semibold text-xs border border-lime-500/40"
            title="Overnight Asia range qualified — bracket setup after 02:00 Montreal. Session window through 10:25."
          >
            ASIA DESK · BOTH STOPS
          </span>
        )}
        {!SYSTEMATIC_LIVE_DESK && htfStatus && (
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
            Day TF: {String(htfStatus).replace(/_/g, ' ')}
          </span>
        )}
        {!SYSTEMATIC_LIVE_DESK && htfPerf && (
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
            Perf: {String(htfPerf.grade || '').replace(/_/g, ' ')} ({htfPerf.targetMultiplier}x Target)
          </span>
        )}
        {!SYSTEMATIC_LIVE_DESK && htfBracket && (
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
            Bracket: {String(htfBracket.tradeLocationGrade || '').replace(/_/g, ' ')}
          </span>
        )}
        {!SYSTEMATIC_LIVE_DESK && htfCorr && htfCorr.type !== 'NONE' && (
          <span
            className={`rounded px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide border ${htfCorr.type === 'DISGUISED_BULLISH_CORRECTION'
              ? 'bg-emerald-500/35 text-emerald-100 border-emerald-400/60 animate-pulse font-bold'
              : htfCorr.type === 'DISGUISED_BEARISH_CORRECTION'
                ? 'bg-rose-500/35 text-rose-100 border-rose-400/60 animate-pulse font-bold'
                : 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30'
              }`}
            title={`Corrective Action: ${htfCorr.type} | ${htfCorr.directiveSummary}`}
          >
            Corr: {String(htfCorr.type || '').replace(/_/g, ' ')}
          </span>
        )}
        {!SYSTEMATIC_LIVE_DESK && htfSituation && htfSituation.activeSituation !== 'NONE' && (
          <span
            className={`rounded px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide border ${String(htfSituation.activeSituation || '').includes('BULL') || String(htfSituation.activeSituation || '').includes('BUYING')
              ? 'bg-emerald-500/35 text-emerald-100 border-emerald-400/60 font-bold'
              : String(htfSituation.activeSituation || '').includes('BEAR') || String(htfSituation.activeSituation || '').includes('SELLING')
                ? 'bg-rose-500/35 text-rose-100 border-rose-400/60 font-bold'
                : 'bg-purple-500/25 text-purple-200 border-purple-500/40'
              }`}
            title={`Special Situation: ${htfSituation.activeSituation} (${htfSituation.continuationProbabilityPct}% Odds) | ${htfSituation.directiveSummary}`}
          >
            Situation: {String(htfSituation.activeSituation || '').replace(/_/g, ' ')} ({htfSituation.continuationProbabilityPct}%)
          </span>
        )}
        {!SYSTEMATIC_LIVE_DESK && htfStandAside && htfStandAside.isStandAside && (
          <span
            className="rounded px-2 py-0.5 font-bold text-[10px] uppercase tracking-wide border bg-rose-500/40 text-rose-100 border-rose-400 animate-pulse flex items-center gap-1"
            title={`Market Stand-Aside Warning: ${htfStandAside.reason} | ${htfStandAside.directiveSummary}`}
          >
            <span>🛑 Stand Aside:</span>
            <span>{String(htfStandAside.reason || '').replace(/_/g, ' ')}</span>
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
            className={`max-w-[24rem] truncate rounded px-2 py-0.5 text-[10px] font-semibold border transition-colors ${
              newsHazard.level === 'released'
                ? 'border-emerald-500/60 bg-emerald-950/90 text-emerald-100 hover:bg-emerald-900/80 animate-pulse font-bold'
                : newsHazard.level === 'stand_aside'
                  ? 'border-rose-500/30 bg-red-500/30 text-red-100 hover:bg-red-500/40'
                  : newsHazard.level === 'careful'
                    ? 'border-amber-500/30 bg-amber-500/30 text-amber-100 hover:bg-amber-500/40'
                    : 'border-violet-500/20 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30'
            }`}
            title={`${newsHazard.body} Soft warn only — not a trade signal.`}
          >
            {newsHazard.level === 'released'
              ? '🎯 '
              : newsHazard.level === 'stand_aside'
                ? '⛔ '
                : newsHazard.level === 'careful'
                  ? '⚠ '
                  : '📰 '}
            {newsHazard.chip || ''}
          </Link>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded bg-surface-800 border border-neutral-700/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors"
            title="Go to Dashboard Overview"
          >
            📊 Dashboard
          </Link>
          <Link
            href="/dashboard/fundamentals"
            className="rounded bg-surface-800 border border-neutral-700/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors"
            title="Go to Fundamentals Multi-Agent Analysis"
          >
            🏛️ Fundamentals
          </Link>
          <Link
            href="/dashboard/positions"
            className="rounded bg-surface-800 border border-neutral-700/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors"
            title="Go to Live Positions Monitor"
          >
            ⚡ Live Positions
          </Link>
          <button
            type="button"
            onClick={refresh}
            className="text-[10px] uppercase tracking-wider text-gray-500 hover:text-white ml-1"
          >
            Refresh
          </button>
        </div>
      </div>
    </>
  )
}
