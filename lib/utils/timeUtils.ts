/**
 * Timezone utilities for trading operations
 * All market times are in EST (America/New_York timezone)
 */

/**
 * Convert any Date to EST timezone and return HH:MM:SS string
 * @param date Date to convert (defaults to now)
 * @returns Time string in HH:MM:SS format (EST)
 */
export function getESTTimeString(date: Date = new Date()): string {
  try {
    const estFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    const parts = estFormatter.formatToParts(date)
    const hour = parts.find((p) => p.type === 'hour')?.value || '00'
    const minute = parts.find((p) => p.type === 'minute')?.value || '00'
    const second = parts.find((p) => p.type === 'second')?.value || '00'

    return `${hour}:${minute}:${second}`
  } catch (error) {
    // Fallback: If Intl fails, throw error rather than return UTC time
    // Using UTC as fallback is DANGEROUS for trading - must fail loudly
    console.error('[CRITICAL] Failed to get EST time, Intl API error:', error)
    throw new Error('Failed to parse EST timezone - cannot proceed with trading')
  }
}

/**
 * Convert any Date to EST timezone and return YYYY-MM-DD string
 * @param date Date to convert (defaults to today)
 * @returns Date string in YYYY-MM-DD format (EST)
 */
export function getESTDateString(date: Date = new Date()): string {
  try {
    const estFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })

    const parts = estFormatter.formatToParts(date)
    const year = parts.find((p) => p.type === 'year')?.value || '2024'
    const month = parts.find((p) => p.type === 'month')?.value || '01'
    const day = parts.find((p) => p.type === 'day')?.value || '01'

    return `${year}-${month}-${day}`
  } catch (error) {
    // Fallback: throw error rather than return hardcoded date or UTC date
    // Using UTC date or wrong fallback date is DANGEROUS for trading - must fail loudly
    console.error('[CRITICAL] Failed to get EST date, Intl API error:', error)
    throw new Error('Failed to parse EST timezone - cannot proceed with trading')
  }
}

/**
 * Parse time string (HH:MM:SS) to seconds since midnight
 * @param timeStr Time string in HH:MM:SS format
 * @returns Seconds since midnight
 */
export function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map(Number)
  const hours = parts[0] || 0
  const minutes = parts[1] || 0
  const seconds = parts[2] || 0
  return hours * 3600 + minutes * 60 + seconds
}

/**
 * Check if a date is within trading hours (9:30 AM - 4:00 PM EST)
 * @param date Date to check
 * @returns true if within trading hours
 */
export function isWithinTradingHours(date: Date = new Date()): boolean {
  const timeStr = getESTTimeString(date)
  const timeSeconds = parseTimeToSeconds(timeStr)
  const marketOpenSeconds = parseTimeToSeconds('09:30:00')
  const marketCloseSeconds = parseTimeToSeconds('16:00:00')

  return timeSeconds >= marketOpenSeconds && timeSeconds < marketCloseSeconds
}

/**
 * Get minutes remaining until a specific EST time
 * @param targetTimeStr Target time in HH:MM:SS format (EST)
 * @param date Reference date (defaults to now)
 * @returns Minutes until target time, or null if past target
 */
export function getMinutesUntilTime(targetTimeStr: string, date: Date = new Date()): number | null {
  const currentTimeStr = getESTTimeString(date)
  const currentSeconds = parseTimeToSeconds(currentTimeStr)
  const targetSeconds = parseTimeToSeconds(targetTimeStr)

  if (currentSeconds >= targetSeconds) {
    return null // Already past target time
  }

  const secondsRemaining = targetSeconds - currentSeconds
  return Math.round(secondsRemaining / 60)
}
