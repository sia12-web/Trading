/**
 * Entry window management
 * Tracks the three 15-minute entry windows: 9:30-9:45, 9:45-10:00, 10:00-10:15
 * All times are in EST (America/New_York timezone)
 */

import { getESTTimeString, parseTimeToSeconds } from '@/lib/utils/timeUtils'
import type { EntryWindow, WindowDefinition } from '@/types/trading'

// Fixed window definitions (EST)
const WINDOWS: Record<EntryWindow, WindowDefinition> = {
  1: {
    window_number: 1,
    start_time: '09:30:00',
    end_time: '09:44:59',
    duration_minutes: 15,
  },
  2: {
    window_number: 2,
    start_time: '09:45:00',
    end_time: '09:59:59',
    duration_minutes: 15,
  },
  3: {
    window_number: 3,
    start_time: '10:00:00',
    end_time: '10:14:59',
    duration_minutes: 15,
  },
}

const MARKET_OPEN_TIME = '09:30:00'
const ENTRY_WINDOW_CLOSE_TIME = '10:15:00'

export class WindowManager {
  /**
   * Get current active window based on current time
   * Returns null if outside all windows
   */
  getCurrentWindow(date: Date = new Date()): EntryWindow | null {
    for (const windowNum of [1, 2, 3] as const) {
      if (this.isWithinWindow(date, windowNum)) {
        return windowNum
      }
    }

    return null
  }

  /**
   * Check if a given time is within a specific window
   */
  isWithinWindow(date: Date, window: EntryWindow): boolean {
    const timeStr = getESTTimeString(date)
    const windowDef = WINDOWS[window]

    return timeStr >= windowDef.start_time && timeStr <= windowDef.end_time
  }

  /**
   * Get window definition
   */
  getWindow(window: EntryWindow): WindowDefinition {
    return WINDOWS[window]
  }

  /**
   * Get next entry window after current time
   * Returns null if past window 3
   */
  getNextWindow(date: Date = new Date()): EntryWindow | null {
    const current = this.getCurrentWindow(date)

    if (current === 1) return 2
    if (current === 2) return 3
    if (current === 3) return null

    const timeStr = getESTTimeString(date)

    // Before any window
    if (timeStr < WINDOWS[1].start_time) return 1
    // Between windows
    if (timeStr > WINDOWS[1].end_time && timeStr < WINDOWS[2].start_time) return 2
    if (timeStr > WINDOWS[2].end_time && timeStr < WINDOWS[3].start_time) return 3
    // After all windows
    return null
  }

  /**
   * Get time remaining in current window (in seconds)
   * Returns null if not in a window
   */
  getTimeRemainingInWindow(date: Date = new Date()): number | null {
    const current = this.getCurrentWindow(date)
    if (!current) return null

    const windowDef = WINDOWS[current]
    const endTime = parseTimeToSeconds(windowDef.end_time)
    const now = parseTimeToSeconds(getESTTimeString(date))

    const remaining = endTime - now

    return remaining > 0 ? remaining : 0
  }

  /**
   * Check if entry windows are closed for the day
   * (after 10:15 AM when window 3 ends)
   */
  areEntryWindowsClosed(date: Date = new Date()): boolean {
    const timeStr = getESTTimeString(date)
    return timeStr > ENTRY_WINDOW_CLOSE_TIME
  }

  /**
   * Check if market is in trading hours
   * (9:30 AM to 4:00 PM EST)
   */
  isMarketOpen(date: Date = new Date()): boolean {
    const timeStr = getESTTimeString(date)
    return timeStr >= MARKET_OPEN_TIME && timeStr < '16:00:00'
  }

  /**
   * Get status of all entry windows
   */
  getAllWindowStatus(date: Date = new Date()): Array<{
    window: EntryWindow
    active: boolean
    start_time: string
    end_time: string
    time_remaining_seconds: number | null
  }> {
    const current = this.getCurrentWindow(date)
    const remaining = this.getTimeRemainingInWindow(date)

    return [1, 2, 3].map((window) => ({
      window: window as EntryWindow,
      active: window === current,
      start_time: WINDOWS[window as EntryWindow].start_time,
      end_time: WINDOWS[window as EntryWindow].end_time,
      time_remaining_seconds: window === current ? remaining : null,
    }))
  }

  /**
   * Validate entry time is within window boundaries (with tolerance)
   * Tolerance: ±1 second to account for clock skew
   */
  validateEntryTiming(entryTime: Date, window: EntryWindow): boolean {
    const TOLERANCE_SECONDS = 1 // 1 second tolerance

    const windowDef = WINDOWS[window]
    const windowStart = parseTimeToSeconds(windowDef.start_time)
    const windowEnd = parseTimeToSeconds(windowDef.end_time)

    const entrySeconds = parseTimeToSeconds(getESTTimeString(entryTime))

    return (
      entrySeconds >= windowStart - TOLERANCE_SECONDS && entrySeconds <= windowEnd + TOLERANCE_SECONDS
    )
  }

}

// Singleton instance
let windowManagerInstance: WindowManager | null = null

export function getWindowManager(): WindowManager {
  if (!windowManagerInstance) {
    windowManagerInstance = new WindowManager()
  }
  return windowManagerInstance
}
