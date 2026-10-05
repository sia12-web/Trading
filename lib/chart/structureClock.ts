/**
 * When the fixed maps move, and when the live tape comes back.
 *
 * Oil, gold, Dow, and Nasdaq share the New York morning:
 *   08:20 ET  commodity day-session open — live tape returns (history already holds the maps)
 *   08:30–09:30 ET  yesterday, 5-day FRVP, and overnight inventory keep updating
 *   09:30 ET  those three are fixed. Anchored VWAP, 5-month VWAP, and news VWAP keep moving.
 *
 * Nikkei is the Asia exception. The trader may be in that session, so the tape
 * stays live from 08:30 JST through the Tokyo cash close. The fixed maps update
 * only until the Tokyo open (09:00 JST), which is when the preceding inventory
 * is finished. After that, only the three VWAPs move.
 */

import { deskClockFor, zonedCivilToUnix } from '@/lib/chart/sessionVwap'
import { parseTimeToSeconds } from '@/lib/utils/timeUtils'

/** COMEX / NYMEX day-session reference. Live tape for the NY book returns here. */
export const NY_COMMODITY_OPEN_HMS = '08:20:00'
/** Fixed maps (yesterday, 5-day, inventory) start following the tape. */
export const STRUCTURE_UPDATE_START_HMS = '08:30:00'
/** NY cash open — overnight inventory is complete and the fixed maps stop. */
export const NY_STRUCTURE_FREEZE_HMS = '09:30:00'
/** Tokyo cash open — Nikkei fixed maps stop. The session itself keeps printing. */
export const NIKKEI_STRUCTURE_FREEZE_HMS = '09:00:00'

export type FixedRangePhase = 'history' | 'holding' | 'updating' | 'frozen'

function hmsInTz(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  let hour = parts.find((p) => p.type === 'hour')?.value || '00'
  if (hour === '24') hour = '00'
  const minute = parts.find((p) => p.type === 'minute')?.value || '00'
  const second = parts.find((p) => p.type === 'second')?.value || '00'
  return `${hour}:${minute}:${second}`
}

function ymdInTz(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function isWeekday(now: Date, timeZone: string): boolean {
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now)
  return day !== 'Sat' && day !== 'Sun'
}

function isNikkei(instrument: string | null | undefined): boolean {
  return instrument === 'NIKKEI'
}

/**
 * history  — before the live tape. Maps paint from loaded bars.
 * holding  — tape is on, update window has not started (NY 08:20–08:30). Snapshot stays.
 * updating — fixed maps follow the tape.
 * frozen   — yesterday, 5-day, and inventory stay at the cash-open print.
 */
export function fixedRangePhase(
  instrument: string | null | undefined,
  now: Date = new Date()
): FixedRangePhase {
  const clock = deskClockFor(instrument)
  if (!isWeekday(now, clock.timeZone)) return 'history'
  const t = parseTimeToSeconds(hmsInTz(now, clock.timeZone))
  const tapeStart = parseTimeToSeconds(
    isNikkei(instrument) ? STRUCTURE_UPDATE_START_HMS : NY_COMMODITY_OPEN_HMS
  )
  const updateStart = parseTimeToSeconds(STRUCTURE_UPDATE_START_HMS)
  const freeze = parseTimeToSeconds(
    isNikkei(instrument) ? NIKKEI_STRUCTURE_FREEZE_HMS : NY_STRUCTURE_FREEZE_HMS
  )
  if (t < tapeStart) return 'history'
  if (t < updateStart) return 'holding'
  if (t < freeze) return 'updating'
  return 'frozen'
}

/**
 * Clip used once the fixed maps are done.
 * 5-day stays on the completed sessions (one second before the open, so today
 * does not roll into the profile). Inventory includes every bar before the open.
 */
export function fixedRangeFreezeAsOf(
  instrument: string | null | undefined,
  now: Date = new Date()
): { fiveDayUnix: number; inventoryUnix: number } {
  const clock = deskClockFor(instrument)
  const ymd = ymdInTz(now, clock.timeZone)
  const freezeHour = isNikkei(instrument) ? 9 : 9.5
  const inventoryUnix = zonedCivilToUnix(ymd, freezeHour, clock.timeZone)
  return { fiveDayUnix: inventoryUnix - 1, inventoryUnix }
}
