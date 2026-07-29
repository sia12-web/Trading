/**
 * Trader wall clock — Montreal (Eastern).
 *
 * Desk logic stays on the instrument clock (America/New_York for DOW/NASDAQ,
 * Asia/Tokyo for NIKKEI). Chart axis, banners, and user-facing copy use this
 * display zone so everything reads in Montreal time.
 */

import { zonedCivilToUnix } from '@/lib/chart/sessionVwap'

export const TRADER_DISPLAY_TZ = 'America/Toronto'
/** Short label on trader-facing clocks (status, banners, Leo, Telegram). */
export const TRADER_DISPLAY_LABEL = 'Montreal'

function dayKeyInTz(unix: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000))
}

function parseHmsToDecimal(hms: string): number {
  const [hh = 0, mm = 0, ss = 0] = hms.split(':').map(Number)
  return hh + mm / 60 + ss / 3600
}

/** Live banner / status clock (HH:MM:SS) in Montreal. */
export function timeInTraderDisplay(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TRADER_DISPLAY_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value || '00'
  return `${get('hour')}:${get('minute')}:${get('second')}`
}

/** Format a unix instant as HH:MM (or HH:MM:SS) in Montreal. */
export function formatUnixTraderDisplay(
  unixSec: number,
  withSeconds = false
): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: TRADER_DISPLAY_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }
  if (withSeconds) opts.second = '2-digit'
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(
    new Date(unixSec * 1000)
  )
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value || '00'
  return withSeconds
    ? `${get('hour')}:${get('minute')}:${get('second')}`
    : `${get('hour')}:${get('minute')}`
}

/**
 * Desk-local schedule clock (e.g. Tokyo 08:45) → Montreal HH:MM for the desk
 * calendar day of `now`.
 */
export function deskLocalHmsAsTraderDisplay(
  hms: string,
  deskTz: string,
  now: Date = new Date()
): string {
  const ymd = dayKeyInTz(Math.floor(now.getTime() / 1000), deskTz)
  const unix = zonedCivilToUnix(ymd, parseHmsToDecimal(hms), deskTz)
  return formatUnixTraderDisplay(unix, false)
}

/** e.g. "20:00–20:45 Montreal" from Tokyo 09:00–09:45. */
export function deskLocalRangeAsTraderDisplay(
  startHms: string,
  endHms: string,
  deskTz: string,
  now: Date = new Date()
): string {
  const a = deskLocalHmsAsTraderDisplay(startHms, deskTz, now)
  const b = deskLocalHmsAsTraderDisplay(endHms, deskTz, now)
  return `${a}–${b} ${TRADER_DISPLAY_LABEL}`
}
