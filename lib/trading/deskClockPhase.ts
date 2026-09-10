/**
 * NYC cash clock for cooldown / overnight inventory.
 * 09:00–16:00 ET weekday: live desk. 16:00: cool down, reprint 5d + VWAP + Y-FRVP.
 * 18:00 ET → next 09:30: overnight inventory FRVP keeps updating (chart may be closed).
 * Charts resume 09:00 ET; inventory freezes at 09:30 cash open.
 */

import {
  addCalendarDaysYmd,
  cashOpenUnixForYmd,
  isUsMarketHoliday,
  isWeekdayYmd,
  nextTradingYmd,
  NY_DESK_CLOCK,
  zonedCivilToUnix,
} from '@/lib/chart/sessionVwap'

const TZ = NY_DESK_CLOCK.timeZone

export type DeskPhase = 'LIVE' | 'PREP' | 'COOLDOWN' | 'OVERNIGHT' | 'WEEKEND'

export function nyYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function nyUnixNow(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000)
}

function nySessionBounds(ymd: string) {
  return {
    prep: zonedCivilToUnix(ymd, 9, TZ),
    open: cashOpenUnixForYmd(ymd, NY_DESK_CLOCK),
    close: zonedCivilToUnix(ymd, 16, TZ),
    asia: zonedCivilToUnix(ymd, 18, TZ),
  }
}

export function isNyTradingDay(ymd: string): boolean {
  return isWeekdayYmd(ymd, TZ) && !isUsMarketHoliday(ymd)
}

/** 09:00–16:00 ET on a trading day — live chart hours (prep + RTH). */
export function isLiveChartHours(now: Date = new Date()): boolean {
  const ymd = nyYmd(now)
  if (!isNyTradingDay(ymd)) return false
  const unix = nyUnixNow(now)
  const b = nySessionBounds(ymd)
  return unix >= b.prep && unix < b.close
}

/**
 * After 16:00 ET until 09:00 ET the next session. Trader is away; desk is cooled.
 * Prep (09:00–09:30) is not cooled — charts come back, inventory still updates.
 */
export function isDeskCooled(now: Date = new Date()): boolean {
  return !isLiveChartHours(now)
}

/**
 * Overnight inventory FRVP window: Globex 18:00 ET before the next cash open,
 * updating until 09:30 ET. Dead zone 16:00–18:00 and Friday close → Sunday 18:00.
 */
export function isOvernightInventoryWindow(now: Date = new Date()): boolean {
  const unix = nyUnixNow(now)
  const ymd = nyYmd(now)
  const b = nySessionBounds(ymd)

  if (isNyTradingDay(ymd) && unix < b.open) {
    const eve = addCalendarDaysYmd(ymd, -1)
    return unix >= zonedCivilToUnix(eve, 18, TZ)
  }

  if (unix >= b.close || !isNyTradingDay(ymd)) {
    const next = nextTradingYmd(ymd, TZ)
    const nextOpen = cashOpenUnixForYmd(next, NY_DESK_CLOCK)
    const eve = addCalendarDaysYmd(next, -1)
    const start = zonedCivilToUnix(eve, 18, TZ)
    return unix >= start && unix < nextOpen
  }

  return false
}

/** 16:00–18:00 ET trading day: reprint 5d bars, 5M VWAP, yesterday FRVP. */
export function isCloseReprintWindow(now: Date = new Date()): boolean {
  const ymd = nyYmd(now)
  if (!isNyTradingDay(ymd)) return false
  const unix = nyUnixNow(now)
  const b = nySessionBounds(ymd)
  return unix >= b.close && unix < b.asia
}

export function deskPhaseAt(now: Date = new Date()): DeskPhase {
  const ymd = nyYmd(now)
  const unix = nyUnixNow(now)
  if (isNyTradingDay(ymd)) {
    const b = nySessionBounds(ymd)
    if (unix >= b.prep && unix < b.open) return 'PREP'
    if (unix >= b.open && unix < b.close) return 'LIVE'
    if (unix >= b.close && unix < b.asia) return 'COOLDOWN'
  }
  if (isOvernightInventoryWindow(now)) return 'OVERNIGHT'
  return 'WEEKEND'
}

/**
 * Globex day start (18:00 ET). CVD pane + Leo order-flow use this so the
 * cumulative resets with the futures session instead of spanning many days.
 */
export function deskCvdSessionStartUnix(now: Date = new Date()): number {
  const ymd = nyYmd(now)
  const unix = nyUnixNow(now)
  const todayGlobex = zonedCivilToUnix(ymd, 18, TZ)
  if (unix >= todayGlobex) return todayGlobex
  const prev = addCalendarDaysYmd(ymd, -1)
  return zonedCivilToUnix(prev, 18, TZ)
}
