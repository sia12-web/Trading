/**
 * Live desk playbook mode — three ranges per desk:
 *   DOW/NASDAQ: Morning (Open range / OR15) → OR30 → IB
 *   NIKKEI:     Morning (Open range / OR15) → US Range → IB prep → Tokyo IB
 */

import {
  deskMarketFor,
  ibStrategyStartHms,
  ibStrategyEndHms,
  lunchRangeEntryStartHms,
  lunchRangeEntryEndHms,
  resolveRangeStrategy,
  sessionFor,
  type DeskInstrument,
  type DeskMarket,
  type RangeStrategy,
  type AttemptLadder,
} from '@/lib/trading/sessionGate'
import {
  attemptLadderFromCounts,
  attemptLadderFromTotals,
} from '@/lib/trading/attemptLadder'
import { parseTimeToSeconds } from '@/lib/utils/timeUtils'

export type DeskPlaybookMode =
  | 'morning'
  | 'or30'
  | 'ib'
  | 'us_range'
  | 'lunch_break'
  | 'done'

function timeInTz(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  let hour = parts.find((p) => p.type === 'hour')?.value || '00'
  if (hour === '24') hour = '00'
  const minute = parts.find((p) => p.type === 'minute')?.value || '00'
  const second = parts.find((p) => p.type === 'second')?.value || '00'
  return `${hour}:${minute}:${second}`
}

export function resolveDeskPlaybookMode(args: {
  instrument: string
  now?: Date
  attemptsUsed?: number
  stopHits?: number
  rangeStrategy?: RangeStrategy
  ladder?: AttemptLadder
}): DeskPlaybookMode {
  const now = args.now ?? new Date()
  const market: DeskMarket = deskMarketFor(args.instrument)
  const sess = sessionFor(args.instrument)
  const t = parseTimeToSeconds(timeInTz(now, sess.tz))
  const baseLadder =
    args.ladder ??
    attemptLadderFromTotals({
      attemptsUsed: args.attemptsUsed ?? 0,
      stopHits: args.stopHits ?? 0,
      now,
      instrument: args.instrument,
    })
  // Re-bind eligibility to the evaluation clock (counts may have been built without `now`).
  const ladder = attemptLadderFromCounts({
    morningAttempts: baseLadder.morningAttempts,
    ibAttempts: baseLadder.ibAttempts,
    lunchAttempts: baseLadder.lunchAttempts,
    morningStopHits: baseLadder.morningStopHits,
    otherAttempts: Math.max(
      0,
      baseLadder.dayAttempts -
        baseLadder.morningAttempts -
        baseLadder.ibAttempts -
        baseLadder.lunchAttempts
    ),
    now,
    instrument: args.instrument,
  })
  const range =
    args.rangeStrategy != null
      ? args.rangeStrategy
      : resolveRangeStrategy({
          market,
          timeSec: t,
          ladder,
        })

  if (range === 'us_range') return 'us_range'
  if (range === 'or30') return 'or30'
  if (range === 'ib') return 'ib'

  const midStart = parseTimeToSeconds(ibStrategyStartHms(market))
  const midEnd = parseTimeToSeconds(ibStrategyEndHms(market))
  const lateStart = parseTimeToSeconds(lunchRangeEntryStartHms(market))
  const lateEnd = parseTimeToSeconds(lunchRangeEntryEndHms(market))
  const close = parseTimeToSeconds(sess.marketClose)

  // Prep until slot-3 opens: after mid clock ends, or sooner if mid probes exhausted
  if (
    ladder.lunchEligible &&
    t < lateStart &&
    t >= midStart &&
    (t >= midEnd || !ladder.ibEligible)
  ) {
    return 'lunch_break'
  }

  if (t >= lateStart && t < close) {
    if (
      ladder.revengeLocked ||
      ladder.dayLocked ||
      !ladder.lunchEligible ||
      t >= lateEnd
    ) {
      return 'done'
    }
    return 'lunch_break'
  }

  return 'morning'
}

export function deskPlaybookTitle(mode: DeskPlaybookMode, instrument?: string): string {
  const tokyo = instrument === 'NIKKEI'
  switch (mode) {
    case 'us_range':
      return 'US Range playbook'
    case 'or30':
      return 'OR30 playbook'
    case 'ib':
      return tokyo ? 'Tokyo IB playbook' : 'IB playbook'
    case 'lunch_break':
      return tokyo ? 'IB prep playbook' : 'IB prep playbook'
    case 'done':
      return 'Watch playbook'
    default:
      return 'Morning playbook (Open range)'
  }
}

export function deskPlaybookButtonLabel(
  mode: DeskPlaybookMode,
  instrument?: string
): string {
  const tokyo = instrument === 'NIKKEI'
  switch (mode) {
    case 'us_range':
      return 'US Range'
    case 'or30':
      return 'OR30'
    case 'ib':
      return tokyo ? 'Tokyo IB' : 'IB playbook'
    case 'lunch_break':
      return tokyo ? 'IB prep' : 'IB prep'
    case 'done':
      return 'Watch'
    default:
      return 'Playbook'
  }
}

export function isDeskEntryWindowActive(args: {
  playbookMode: DeskPlaybookMode
  rangeStrategy?: RangeStrategy
  canPlaceEntry?: boolean
}): boolean {
  const { playbookMode, rangeStrategy, canPlaceEntry } = args
  if (
    rangeStrategy === 'ib' ||
    rangeStrategy === 'or30' ||
    rangeStrategy === 'us_range'
  ) {
    return true
  }
  if (
    playbookMode === 'ib' ||
    playbookMode === 'or30' ||
    playbookMode === 'us_range'
  ) {
    return true
  }
  if (playbookMode === 'morning') {
    if (canPlaceEntry === undefined) return true
    return canPlaceEntry
  }
  return false
}

export function isDeskWatchOnlyPlaybook(mode: DeskPlaybookMode): boolean {
  return mode === 'lunch_break' || mode === 'done'
}

export function deskPlaybookToolbarLabel(
  mode: DeskPlaybookMode,
  opts?: { watchOnly?: boolean; instrument?: string }
): string {
  if (opts?.watchOnly && mode === 'done') return 'Watch'
  return deskPlaybookButtonLabel(mode, opts?.instrument)
}

export function deskPlaybookPanelTitle(
  mode: DeskPlaybookMode,
  instrument?: string,
  opts?: { watchOnly?: boolean }
): string {
  if (opts?.watchOnly && mode === 'done') {
    return instrument === 'NIKKEI' ? 'Tokyo watch playbook' : 'Watch playbook'
  }
  return deskPlaybookTitle(mode, instrument)
}

export function deskPlaybookHint(mode: DeskPlaybookMode, instrument?: string): string {
  const tokyo = instrument === 'NIKKEI'
  switch (mode) {
    case 'us_range':
      return 'Prior NYC session range — up to 2 probes (progressive risk; entries within ±10 pts of range high or low only). Unlocks after morning clock ends or morning probes are exhausted.'
    case 'or30':
      return '30-minute range — up to 2 probes (progressive risk; entries within ±10 pts of H / L). Opens when OR30 locks (10:00 Montreal) and stays open until IB locks (10:30 Montreal).'
    case 'ib':
      return tokyo
        ? 'Tokyo IB range — up to 2 probes (progressive risk; entries within ±10 pts of H / L). Unlocks when first-hour IB locks (21:00 Montreal), or sooner if US Range probes are exhausted — open through cash close (02:00 Montreal).'
        : 'Initial Balance — up to 2 probes (progressive risk; entries within ±10 pts of H / L). Opens when IB locks (10:30 Montreal) and stays open until last-entry cutoff (15:15 Montreal). Auto-takes over when IB locks if OR30 was skipped.'
    case 'lunch_break':
      return tokyo
        ? 'Waiting for first-hour Tokyo IB lock (21:00 Montreal) — levels update. IB ±10 opens when the hour locks (or earlier if US Range probes were exhausted).'
        : 'OR30 entry closed. Prep for IB — levels update. IB opens on the clock (or earlier if OR30 probes were exhausted).'
    case 'done':
      return 'Entry windows done for today — manage if open (confirm lunch close or ride to cash close), no new entries.'
    default:
      return tokyo
        ? 'Morning Open range (first 15m) — optional (up to 2 probes, progressive risk, ±10 of H / L once locked). Skip freely → US Range then Tokyo IB (session cap 3 fills total).'
        : 'Morning Open range (first 15m) — optional (up to 2 probes, progressive risk, ±10 of H / L once locked). Skip freely; when OR30 locks with no morning fill, desk auto-moves to OR30.'
  }
}

export function deskPlaybookUsesAfternoonLevels(mode: DeskPlaybookMode): boolean {
  return (
    mode === 'ib' ||
    mode === 'or30' ||
    mode === 'us_range' ||
    mode === 'lunch_break' ||
    mode === 'done'
  )
}

export function deskPlaybookAnalysisMode(
  mode: DeskPlaybookMode,
  instrument?: string
): 'morning' | 'or30' | 'ib' | 'us_range' | 'afternoon' {
  switch (mode) {
    case 'us_range':
      return 'us_range'
    case 'or30':
      return 'or30'
    case 'ib':
      return 'ib'
    case 'lunch_break':
      return instrument === 'NIKKEI' ? 'ib' : 'or30'
    case 'done':
      return 'afternoon'
    default:
      return 'morning'
  }
}

export function isDeskInstrumentPref(i: string | null | undefined): i is DeskInstrument {
  return (
    i === 'DOW' ||
    i === 'NASDAQ' ||
    i === 'NIKKEI' ||
    i === 'GOLD' ||
    i === 'CRUDE'
  )
}
