/**
 * Whether a fill was entered before local morning lunchClose (morning/IB book).
 * Lunch-range fills after lunch should not get the morning confirm prompt.
 */

import { sessionFor } from '@/lib/trading/sessionGate'
import { parseTimeToSeconds } from '@/lib/utils/timeUtils'

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

export function isMorningOrIbEntry(
  instrument: string,
  entryTimestamp: string | number | Date | null | undefined
): boolean {
  if (entryTimestamp == null) return true // unknown → treat as morning (safer to prompt)
  const entry =
    typeof entryTimestamp === 'number'
      ? new Date(entryTimestamp)
      : entryTimestamp instanceof Date
        ? entryTimestamp
        : new Date(entryTimestamp)
  if (Number.isNaN(entry.getTime())) return true
  const sess = sessionFor(instrument)
  const t = parseTimeToSeconds(timeInTz(entry, sess.tz))
  const lunch = parseTimeToSeconds(sess.lunchClose)
  return t < lunch
}

export function isPastCashCloseNow(instrument: string, now: Date = new Date()): boolean {
  const sess = sessionFor(instrument)
  const t = parseTimeToSeconds(timeInTz(now, sess.tz))
  return t >= parseTimeToSeconds(sess.marketClose)
}
