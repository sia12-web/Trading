/**
 * Desk UI clocks — always Eastern (NYC / Montreal) for DOW, NASDAQ, and NIKKEI.
 * Session math / AVWAP for NIKKEI stay on Asia/Tokyo via deskClockFor().
 */

import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'

export const DESK_DISPLAY_TZ = 'America/New_York'
export const DESK_DISPLAY_TZ_LABEL = 'ET'

export function deskDisplayTimeZone(
  _instrument?: string | null
): typeof DESK_DISPLAY_TZ {
  return DESK_DISPLAY_TZ
}

export function deskDisplayTzLabel(_instrument?: string | null): string {
  return DESK_DISPLAY_TZ_LABEL
}

function marketTzFor(instrument?: string | null): string {
  return instrument === 'NIKKEI' ? 'Asia/Tokyo' : 'America/New_York'
}

function dateKeyInTz(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Unix for market-local wall clock on a YYYY-MM-DD calendar date in that market. */
export function deskMarketWallUnix(
  instrument: string | null | undefined,
  dateKey: string,
  hour: number,
  minute = 0
): number {
  return instrument === 'NIKKEI'
    ? tokyoDateTimeToUnix(dateKey, hour, minute)
    : nyDateTimeToUnix(dateKey, hour, minute)
}

/** Format a unix instant in desk display TZ, e.g. "8:00 PM ET" / "9:30 AM ET". */
export function formatDeskClockLabel(
  unix: number,
  opts?: { withSeconds?: boolean; instrument?: string | null }
): string {
  if (!Number.isFinite(unix) || unix <= 0) return `— ${DESK_DISPLAY_TZ_LABEL}`
  const timeZone = deskDisplayTimeZone(opts?.instrument)
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    ...(opts?.withSeconds ? { second: '2-digit' } : {}),
    hour12: true,
  }).format(new Date(unix * 1000))
  return `${formatted} ${DESK_DISPLAY_TZ_LABEL}`
}

/** Compact 24h clock for status bars, e.g. "20:00:00 ET". */
export function formatDeskClockHms(
  unix: number,
  opts?: { instrument?: string | null }
): string {
  if (!Number.isFinite(unix) || unix <= 0) return `— ${DESK_DISPLAY_TZ_LABEL}`
  const timeZone = deskDisplayTimeZone(opts?.instrument)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(unix * 1000))
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const s = parts.find((p) => p.type === 'second')?.value ?? '00'
  const hour = h === '24' ? '00' : h
  return `${hour}:${m}:${s} ${DESK_DISPLAY_TZ_LABEL}`
}

/** HH:MM in display TZ (no label), for composing messages. */
export function formatDeskHm(
  unix: number,
  opts?: { instrument?: string | null; hour12?: boolean }
): string {
  if (!Number.isFinite(unix) || unix <= 0) return '—'
  const timeZone = deskDisplayTimeZone(opts?.instrument)
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: opts?.hour12 === false ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: opts?.hour12 !== false,
  }).format(new Date(unix * 1000))
}

/**
 * User-facing open label from the real open unix (DST-safe).
 * DOW/NASDAQ → "9:30 AM ET"; NIKKEI → "8:00 PM ET" (EDT) / "7:00 PM ET" (EST).
 */
export function formatDeskOpenLabel(
  instrument: string | null | undefined,
  openUnix: number
): string {
  return formatDeskClockLabel(openUnix, { instrument })
}

/** Open label for a replay/session calendar date (market-local date key). */
export function formatDeskOpenLabelForDate(
  instrument: string | null | undefined,
  dateKey: string
): string {
  const hour = 9
  const minute = instrument === 'NIKKEI' ? 0 : 30
  return formatDeskOpenLabel(
    instrument,
    deskMarketWallUnix(instrument, dateKey, hour, minute)
  )
}

/**
 * Format a market-local HH:MM[:SS] on today's market calendar as ET display.
 * Used for gate / attendance copy (DST-safe).
 */
export function formatMarketHmsTodayInDisplayTz(
  instrument: string | null | undefined,
  hms: string,
  now: Date = new Date()
): string {
  const marketTz = marketTzFor(instrument)
  const dateKey = dateKeyInTz(now, marketTz)
  const [h, m] = hms.split(':').map(Number)
  const unix = deskMarketWallUnix(instrument, dateKey, h || 0, m || 0)
  return formatDeskClockLabel(unix, { instrument })
}
