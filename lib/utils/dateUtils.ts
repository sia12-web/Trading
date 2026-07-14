/**
 * Date utility functions for replay mode
 */

/**
 * Get last N days including today (or up to a specific date)
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
