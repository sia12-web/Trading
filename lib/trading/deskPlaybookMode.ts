/**
 * Live desk playbook mode — morning → IB → lunch-break → lunch-range.
 * No PM watch — when entry paths are done, UI stays on last playbook / manage-only.
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
import { attemptLadderFromTotals } from '@/lib/trading/attemptLadder'
import { parseTimeToSeconds } from '@/lib/utils/timeUtils'

export type DeskPlaybookMode =
  | 'morning'
  | 'ib'
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
  const ladder =
    args.ladder ??
    attemptLadderFromTotals({
      attemptsUsed: args.attemptsUsed ?? 0,
      stopHits: args.stopHits ?? 0,
    })
  const range =
    args.rangeStrategy !== undefined
      ? args.rangeStrategy
      : resolveRangeStrategy({
          market,
          timeSec: t,
          ladder,
        })

  if (range === 'ib') return 'ib'
  if (range === 'lunch_range') return 'lunch_range'

  const ibEnd = parseTimeToSeconds(ibStrategyEndHms(market))
  const lnStart = parseTimeToSeconds(lunchRangeEntryStartHms(market))
  const lnEnd = parseTimeToSeconds(lunchRangeEntryEndHms(market))
  const close = parseTimeToSeconds(sess.marketClose)

  // After IB → Lunch break playbook until lunch-range opens (if still eligible)
  if (ladder.lunchEligible && t >= ibEnd && t < lnStart) {
    return 'lunch_break'
  }

  // During lunch-range clock but not unlocked → still lunch break framing if eligible path was open
  if (ladder.lunchEligible && t >= lnStart && t < lnEnd) {
    return 'lunch_break'
  }

  // Entry paths exhausted or past lunch-range end
  if (t >= ibEnd && t < close) {
    if (
      ladder.revengeLocked ||
      ladder.dayLocked ||
      ladder.ibAttempts > 0 ||
      !ladder.lunchEligible ||
      t >= lnEnd
    ) {
      return 'done'
    }
    return 'lunch_break'
  }

  return 'morning'
}

export function deskPlaybookTitle(mode: DeskPlaybookMode, _instrument?: string): string {
  switch (mode) {
    case 'ib':
      return 'IB playbook'
    case 'lunch_break':
      return 'Lunch break playbook'
    case 'lunch_range':
      return 'Lunch-range playbook'
    case 'done':
      return 'Watch playbook'
    default:
      return 'Morning playbook'
  }
}

export function deskPlaybookButtonLabel(mode: DeskPlaybookMode): string {
  switch (mode) {
    case 'ib':
      return 'IB playbook'
    case 'lunch_break':
      return 'Lunch break'
    case 'lunch_range':
      return 'Lunch-range'
    case 'done':
      return 'Watch'
    default:
      return 'Playbook'
  }
}

/**
 * True while an entry unlock is live (morning entry / IB / lunch-range).
 * Same rule for NY (DOW/NASDAQ) and Tokyo (NIKKEI) — clocks come from playbookMode.
 * Morning mode alone is not enough (post–entryClose gap before IB is not an entry window).
 */
export function isDeskEntryWindowActive(args: {
  playbookMode: DeskPlaybookMode
  rangeStrategy?: RangeStrategy
  /** When known: morning ENTRY only counts if the gate still allows placing. */
  canPlaceEntry?: boolean
}): boolean {
  const { playbookMode, rangeStrategy, canPlaceEntry } = args
  if (rangeStrategy === 'ib' || rangeStrategy === 'lunch_range') return true
  if (playbookMode === 'ib' || playbookMode === 'lunch_range') return true
  if (playbookMode === 'morning') {
    // Unknown canPlaceEntry → treat morning playbook as entry (prep + open)
    if (canPlaceEntry === undefined) return true
    return canPlaceEntry
  }
  return false
}

/** Observe-only after entry paths: lunch break prep or done (same NY + Nikkei). */
export function isDeskWatchOnlyPlaybook(mode: DeskPlaybookMode): boolean {
  return mode === 'lunch_break' || mode === 'done'
}

/** Toolbar label — Watch when entry paths are finished; else strategy name. */
export function deskPlaybookToolbarLabel(
  mode: DeskPlaybookMode,
  opts?: { watchOnly?: boolean }
): string {
  if (opts?.watchOnly && mode === 'done') return 'Watch'
  return deskPlaybookButtonLabel(mode)
}

/** Panel title — Tokyo gets an explicit watch title when done. */
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

export function deskPlaybookHint(mode: DeskPlaybookMode, _instrument?: string): string {
  switch (mode) {
    case 'ib':
      return 'Initial Balance — 1 attempt (only if morning skipped). Any IB fill turns lunch-range off.'
    case 'lunch_break':
      return 'IB entry closed. Prep for lunch-range — levels update. Lunch opens only if morning + IB were skipped.'
    case 'lunch_range':
      return 'Lunch-range — 1 attempt while the PM entry window is open.'
    case 'done':
      return 'Entry windows done or earlier trade taken — manage if open (confirm lunch close or ride to cash close), no new entries.'
    default:
      return 'Morning AI + structure — 1 attempt. Any fill (SL, TP, or open book) locks IB and lunch-range. Lunch 11:30 is confirm-close; unconfirmed books ride to cash close.'
  }
}

/** Levels paint path: afternoon merge (IB + FLIP/RETEST) for IB / lunch-break / lunch-range. */
export function deskPlaybookUsesAfternoonLevels(mode: DeskPlaybookMode): boolean {
  return mode === 'ib' || mode === 'lunch_break' || mode === 'lunch_range' || mode === 'done'
}

export function deskPlaybookAnalysisMode(
  mode: DeskPlaybookMode
): 'morning' | 'ib' | 'lunch_range' | 'afternoon' {
  switch (mode) {
    case 'ib':
      return 'ib'
    case 'lunch_break':
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
