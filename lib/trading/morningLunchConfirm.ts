/**
 * Whether a fill was entered before local morning lunchClose (morning/IB book).
 * Lunch-range fills after lunch should not get the morning confirm prompt.
 *
 * Also persists “Keep open until cash close” so chart/positions refresh does not
 * re-nag for the same open position.
 */

import { sessionFor } from '@/lib/trading/sessionGate'
import { parseTimeToSeconds } from '@/lib/utils/timeUtils'

const KEEP_OPEN_STORAGE_KEY = 'trading:morning-lunch-flat-keep-open'
/** Drop keep-open marks older than this (covers overnight leftovers). */
const KEEP_OPEN_TTL_MS = 36 * 60 * 60 * 1000

type KeepOpenMap = Record<string, number>

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

/** Live journal/position id — stable across chart refresh / new tab. */
export function liveLunchFlatKeepOpenKey(positionId: string): string {
  return `live:${positionId}`
}

/** Sim paper fill — keyed by desk day + fill time (no journal id). */
export function simLunchFlatKeepOpenKey(args: {
  instrument: string
  replayDate: string
  filledAt: number
}): string {
  return `sim:${args.instrument}:${args.replayDate}:${args.filledAt}`
}

function readKeepOpenMap(): KeepOpenMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEEP_OPEN_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as KeepOpenMap
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

function writeKeepOpenMap(map: KeepOpenMap): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEEP_OPEN_STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode — ignore */
  }
}

function pruneKeepOpenMap(map: KeepOpenMap, now = Date.now()): KeepOpenMap {
  const next: KeepOpenMap = {}
  for (const [key, ts] of Object.entries(map)) {
    if (typeof ts === 'number' && now - ts < KEEP_OPEN_TTL_MS) next[key] = ts
  }
  return next
}

/** True if trader already chose Keep open for this position/fill. */
export function hasLunchFlatKeepOpen(key: string): boolean {
  if (!key) return false
  const map = pruneKeepOpenMap(readKeepOpenMap())
  return typeof map[key] === 'number'
}

/** Persist Keep open so refresh / new tab does not re-prompt. */
export function markLunchFlatKeepOpen(key: string): void {
  if (!key) return
  const map = pruneKeepOpenMap(readKeepOpenMap())
  map[key] = Date.now()
  writeKeepOpenMap(map)
}

/** Clear when position closes or session resets. */
export function clearLunchFlatKeepOpen(key: string): void {
  if (!key) return
  const map = pruneKeepOpenMap(readKeepOpenMap())
  if (!(key in map)) return
  delete map[key]
  writeKeepOpenMap(map)
}
