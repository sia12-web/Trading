/**
 * Date utility functions for replay mode
 */

/**
 * Get last N calendar days including today (or up to a specific date)
 */
export function getLastNDays(days: number = 30): string[] {
  const dates: string[] = []
  const today = new Date()

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    dates.push(formatDateISO(date))
  }

  return dates
}

function lastNTradingDaysInTz(n: number, timeZone: string): string[] {
  const out: string[] = []
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const [y, m, d] = todayStr.split('-').map(Number)
  const cursor = new Date(Date.UTC(y!, m! - 1, d!))
  cursor.setUTCDate(cursor.getUTCDate() - 1) // start yesterday in that calendar

  let guard = 0
  while (out.length < n && guard < 40) {
    guard++
    const dateStr = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`
    // Weekday of that civil date at noon UTC is a stable Mon–Fri check for calendar days
    const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(dateStr)
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return out.reverse()
}

/**
 * Last N completed NYC cash trading days (Mon–Fri), ending yesterday ET.
 * Used by simulation — never includes today (live desk owns today).
 */
export function getLastNNycTradingDays(n: number = 5): string[] {
  return lastNTradingDaysInTz(n, 'America/New_York')
}

/** Last N completed Tokyo cash trading days (Mon–Fri), ending yesterday JST. */
export function getLastNTokyoTradingDays(n: number = 5): string[] {
  return lastNTradingDaysInTz(n, 'Asia/Tokyo')
}

/**
 * Unix seconds for a wall-clock time on a calendar date in any IANA timezone.
 */
export function zonedDateTimeToUnix(
  dateStr: string,
  hour: number,
  minute: number = 0,
  timeZone: string = 'America/New_York'
): number {
  const target = hour + minute / 60
  const [y, m, d] = dateStr.split('-').map(Number)
  // Rough morning guess in UTC; correction loop handles TZ/DST
  let guess = Math.floor(Date.UTC(y!, m! - 1, d!, 12, 0, 0) / 1000)

  for (let pass = 0; pass < 3; pass++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(guess * 1000))

    let h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
    const min = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
    if (h === 24) h = 0
    const actual = h + min / 60
    let diff = target - actual
    if (diff > 12) diff -= 24
    if (diff < -12) diff += 24
    if (Math.abs(diff) < 1 / 120) break
    guess += Math.round(diff * 3600)
  }
  return guess
}

/** Unix seconds for a wall-clock time on an ET calendar date (handles DST). */
export function nyDateTimeToUnix(
  dateStr: string,
  hour: number,
  minute: number = 0
): number {
  return zonedDateTimeToUnix(dateStr, hour, minute, 'America/New_York')
}

/** Unix seconds for a wall-clock time on a Tokyo calendar date. */
export function tokyoDateTimeToUnix(
  dateStr: string,
  hour: number,
  minute: number = 0
): number {
  return zonedDateTimeToUnix(dateStr, hour, minute, 'Asia/Tokyo')
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Parse YYYY-MM-DD string to Date (local midnight, not UTC)
 * For display purposes, dates are interpreted as local timezone dates
 * This ensures consistency with getLastNDays and getDaysAgo
 */
export function parseDateISO(dateStr: string): Date {
  const parts = dateStr.split('-')
  const year = parseInt(parts[0] || '1970', 10)
  const month = parseInt(parts[1] || '1', 10)
  const day = parseInt(parts[2] || '1', 10)
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

/**
 * Check if date string is valid YYYY-MM-DD format
 */
export function isValidDateFormat(dateStr: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/
  if (!regex.test(dateStr)) return false

  const date = parseDateISO(dateStr)
  return !isNaN(date.getTime())
}

/**
 * Get day of week name (Mon, Tue, etc.) using local timezone
 */
export function getDayName(dateStr: string): string {
  const date = parseDateISO(dateStr)  // Local date
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days[date.getDay()] || 'Sun'  // Use getDay() for local timezone
}

/**
 * Format date for display (e.g., "Jul 10, 2025")
 */
export function formatDateDisplay(dateStr: string): string {
  const date = parseDateISO(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

/**
 * Check if date is today
 */
export function isToday(dateStr: string): boolean {
  const today = formatDateISO(new Date())
  return dateStr === today
}

/**
 * Check if date is in future (using local time for consistency)
 */
export function isFuture(dateStr: string): boolean {
  const date = parseDateISO(dateStr)  // Local midnight
  const today = new Date()
  today.setHours(0, 0, 0, 0)  // Local midnight

  return date > today
}

/**
 * Get number of days ago (using local time)
 * Consistent with getLastNDays which uses local dates
 * Returns 0 for today, 1 for yesterday, etc.
 */
export function getDaysAgo(dateStr: string): number {
  const date = parseDateISO(dateStr)  // Now returns local midnight
  const today = new Date()
  today.setHours(0, 0, 0, 0)  // Local midnight

  const diffTime = today.getTime() - date.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return diffDays
}
