/**
 * Live desk playbook mode — three ranges per desk:
 *   DOW/NASDAQ: Morning (OR30) → IB → Lunch-break → Lunch-range
 *   NIKKEI:     Morning (OR30) → US Range → IB prep → IB
 */

import {
  deskMarketFor,
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
  | 'ib'
  | 'us_range'
  | 'lunch_break'
  | 'lunch_range'
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
  if (range === 'ib') return 'ib'
  if (range === 'lunch_range') return 'lunch_range'

  const midEnd = parseTimeToSeconds(ibStrategyEndHms(market))
  const lateStart = parseTimeToSeconds(lunchRangeEntryStartHms(market))
  const lateEnd = parseTimeToSeconds(lunchRangeEntryEndHms(market))
  const close = parseTimeToSeconds(sess.marketClose)

  // After slot-2 ends → prep until slot-3 opens (if still eligible)
  if (ladder.lunchEligible && t >= midEnd && t < lateStart) {
    return 'lunch_break'
  }

  // Slot-3 clock with no unlock (ineligible) → done. Never treat entry window as prep.
  // Option B: earlier-window fills do NOT lock lunch / Tokyo IB.
  if (t >= lateStart && t < close) {
    if (
      ladder.revengeLocked ||
      ladder.dayLocked ||
      !ladder.lunchEligible ||
      t >= lateEnd
    ) {
      return 'done'
    }
    // Eligible but resolveRangeStrategy returned null (should be rare) — prep framing
    return 'lunch_break'
  }

  return 'morning'
}

export function deskPlaybookTitle(mode: DeskPlaybookMode, instrument?: string): string {
  const tokyo = instrument === 'NIKKEI'
  switch (mode) {
    case 'us_range':
      return 'US Range playbook'
    case 'ib':
      return tokyo ? 'IB playbook' : 'IB playbook'
    case 'lunch_break':
      return tokyo ? 'IB prep playbook' : 'Lunch break playbook'
    case 'lunch_range':
      return tokyo ? 'Tokyo IB playbook' : 'Lunch-range playbook'
    case 'done':
      return 'Watch playbook'
    default:
      return 'Morning playbook (OR30)'
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
    case 'ib':
      return 'IB playbook'
    case 'lunch_break':
      return tokyo ? 'IB prep' : 'Lunch break'
    case 'lunch_range':
      return tokyo ? 'Tokyo IB' : 'Lunch-range'
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
    rangeStrategy === 'lunch_range' ||
    rangeStrategy === 'us_range'
  ) {
    return true
  }
  if (
    playbookMode === 'ib' ||
    playbookMode === 'lunch_range' ||
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
      return 'Prior NYC session range — up to 2 probes @ 0.25% (entries within ±10 pts of range high or low only — no 50% mid). Unlocks after morning clock ends or morning probes are exhausted.'
    case 'ib':
      return tokyo
        ? 'Tokyo IB range — up to 2 probes @ 0.25% (entries within ±10 pts of H / 50% / L). Unlocks when first-hour IB locks (21:00 Montreal), or sooner if US Range probes are exhausted.'
        : 'Initial Balance — up to 2 probes @ 0.25% (entries within ±10 pts of H / 50% / L). Auto-takes over when IB locks if OR30 was skipped (OR30 is optional and sits inside the first hour).'
    case 'lunch_break':
      return tokyo
        ? 'Waiting for first-hour Tokyo IB lock (21:00 Montreal) — levels update. IB ±10 opens when the hour locks (or earlier if US Range probes were exhausted).'
        : 'IB entry closed. Prep for lunch-range — levels update. Lunch opens on the clock (or earlier if IB probes were exhausted).'
    case 'lunch_range':
      return tokyo
        ? 'Tokyo IB — up to 2 probes @ 0.25% while the PM entry window is open (entries within ±10 pts of H / 50% / L).'
        : 'Lunch-range — up to 2 probes @ 0.25% while the PM entry window is open (entries within ±10 pts of range high, 50% mid, or low).'
    case 'done':
      return 'Entry windows done for today — manage if open (confirm lunch close or ride to cash close), no new entries.'
    default:
      return tokyo
        ? 'Morning OR30 — optional (up to 2 probes @ 0.25%, ±10 of H / 50% / L once locked). Skip freely → US Range then Tokyo IB (session cap 3 fills total).'
        : 'Morning OR30 — optional (up to 2 probes @ 0.25%, ±10 of H / 50% / L once locked). Skip freely; when IB locks with no morning fill, desk auto-moves to IB (OR30 finished).'
  }
}

export function deskPlaybookUsesAfternoonLevels(mode: DeskPlaybookMode): boolean {
  return (
    mode === 'ib' ||
    mode === 'us_range' ||
    mode === 'lunch_break' ||
    mode === 'lunch_range' ||
    mode === 'done'
  )
}

export function deskPlaybookAnalysisMode(
  mode: DeskPlaybookMode,
  instrument?: string
): 'morning' | 'ib' | 'us_range' | 'lunch_range' | 'afternoon' {
  switch (mode) {
    case 'us_range':
      return 'us_range'
    case 'ib':
      return 'ib'
    case 'lunch_break':
      // NY: prep for lunch-range · Tokyo: prep for IB
      return instrument === 'NIKKEI' ? 'ib' : 'lunch_range'
    case 'lunch_range':
      return 'lunch_range'
    case 'done':
      return 'afternoon'
    default:
      return 'morning'
  }
}

export function isDeskInstrumentPref(i: string | null | undefined): i is DeskInstrument {
  return i === 'DOW' || i === 'NASDAQ' || i === 'NIKKEI'
}
