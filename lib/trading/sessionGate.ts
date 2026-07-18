/**
 * Trading desk session state — NY (DOW/NASDAQ) and Tokyo (NIKKEI).
 *
 * LIVE only:
 *   Morning bars: NY 09:30–11:30 ET / Tokyo cash 09:00–11:30 JST (shown as evening ET in UI)
 *   Lunch → cash close: psychology freeze (tip held; today's afternoon hidden).
 *   After cash close: afternoon + overnight continuum until next morning desk.
 *   Trading stays morning-only; freeze never carries into the next day.
 *
 * SIMULATION: morning session only (open → lunch). No afternoon feature,
 * no background memory pass — use resolveSimMorningGate(), not the live gate.
 *
 * Prep (AI levels): analyzeStart → lunchClose.
 * Entries: marketOpen → entryClose (first ~45 min).
 */

import { getESTTimeString, parseTimeToSeconds } from '@/lib/utils/timeUtils'
import { getWindowManager } from '@/lib/trading/windowManager'
import { formatMarketHmsTodayInDisplayTz } from '@/lib/trading/deskDisplayTz'
import type { Instrument } from '@/types/trading'

export type SessionPhase =
  | 'PREP'
  | 'RECOMMENDED'
  | 'ENTRY'
  | 'MANAGE'
  | 'FLAT'
  | 'DONE'
  | 'CLOSED'

export type DeskInstrument = 'DOW' | 'NASDAQ' | 'NIKKEI'
export type DeskMarket = 'NY' | 'TOKYO'

/** @deprecated use DeskInstrument — kept for older imports */
export type NyInstrument = 'DOW' | 'NASDAQ'

export const NY_INSTRUMENTS: DeskInstrument[] = ['DOW', 'NASDAQ']
export const DESK_INSTRUMENTS: DeskInstrument[] = ['DOW', 'NASDAQ', 'NIKKEI']

export interface MarketSessionTimes {
  tz: string
  analyzeStart: string
  marketOpen: string
  entryClose: string
  /** Live bars stop here — lunch / morning session end */
  lunchClose: string
  /** Full cash close (background only after lunch) */
  marketClose: string
}

export const NY_SESSION: MarketSessionTimes = {
  tz: 'America/New_York',
  analyzeStart: '09:15:00',
  marketOpen: '09:30:00',
  entryClose: '10:15:00',
  lunchClose: '11:30:00',
  marketClose: '16:00:00',
}

/** TSE morning cash session (afternoon 12:30–15:00 is background-only). */
export const TOKYO_SESSION: MarketSessionTimes = {
  tz: 'Asia/Tokyo',
  analyzeStart: '08:45:00',
  marketOpen: '09:00:00',
  entryClose: '09:45:00',
  lunchClose: '11:30:00',
  marketClose: '15:00:00',
}

/** Legacy alias — NY times only */
export const SESSION_TIMES = NY_SESSION

export const MAX_STOP_HITS = 3

export function deskMarketFor(instrument: string | null | undefined): DeskMarket {
  return instrument === 'NIKKEI' ? 'TOKYO' : 'NY'
}

export function sessionFor(instrument: string | null | undefined): MarketSessionTimes {
  return deskMarketFor(instrument) === 'TOKYO' ? TOKYO_SESSION : NY_SESSION
}

export function isDeskInstrument(i: string | null | undefined): i is DeskInstrument {
  return i === 'DOW' || i === 'NASDAQ' || i === 'NIKKEI'
}

function isNyInstrument(i: string | null | undefined): i is NyInstrument {
  return i === 'DOW' || i === 'NASDAQ'
}

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

function weekdayInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date)
}

function isWeekdayInTz(date: Date, timeZone: string): boolean {
  const d = weekdayInTz(date, timeZone)
  return d !== 'Sat' && d !== 'Sun'
}

export interface SessionGateInput {
  now?: Date
  /** Day's recommended / locked instrument */
  lockedInstrument?: DeskInstrument | null
  /** True if an open position exists for the locked instrument today */
  hasOpenPosition?: boolean
  stopLossHitCount?: number
  dayDone?: boolean
  marketDisabled?: boolean
  /** Instrument the user is viewing on the live chart */
  viewingInstrument?: DeskInstrument | null
  /**
   * Trader must clock in ("Today I trade") to unlock live chart + level AI.
   * When false/undefined during desk hours, chart stays locked.
   */
  clockedIn?: boolean
  /** Had a desk_attendance row today (clocked in earlier, even if lunch clock-out) */
  attendedToday?: boolean
}

export interface SessionGateResult {
  phase: SessionPhase
  timeEst: string
  lockedInstrument: DeskInstrument | null
  canViewLiveChart: boolean
  /** True only while morning session bars may stream */
  canFetchLiveBars: boolean
  canPlaceEntry: boolean
  canManagePosition: boolean
  allowedInstruments: DeskInstrument[]
  message: string
  entryWindow: 1 | 2 | 3 | null
  market: DeskMarket
  /** True when trader is currently clocked in for this market */
  clockedIn: boolean
  /** True if they clocked in at any point today (still true after lunch clock-out) */
  attendedToday: boolean
  /** Clock-in window open (prep → lunch) and not yet clocked in */
  canClockIn: boolean
}

function dateKeyInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * Psychology freeze: lunch → cash close on a weekday.
 * Tip stays at lunch; afternoon bars for *today* are hidden until cash close.
 * Past days always keep their full afternoon — and after close the chart continues.
 */
export function isLunchFreezeActive(
  instrument: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!isDeskInstrument(instrument)) return false
  const s = sessionFor(instrument)
  if (!isWeekdayInTz(now, s.tz)) return false
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const lunch = parseTimeToSeconds(s.lunchClose)
  const close = parseTimeToSeconds(s.marketClose)
  return t >= lunch && t < close
}

/**
 * Trading live bars: cash open → lunch only.
 * Next trading day this opens again automatically (not stuck from yesterday's freeze).
 */
export function isLiveBarsAllowed(
  instrument: string | null | undefined,
  now: Date = new Date()
): { open: boolean; reason: string } {
  if (!isDeskInstrument(instrument)) {
    return { open: false, reason: 'Unknown instrument' }
  }
  const s = sessionFor(instrument)
  if (!isWeekdayInTz(now, s.tz)) {
    return { open: false, reason: `Weekend — ${deskMarketFor(instrument)} session closed` }
  }
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const open = parseTimeToSeconds(s.marketOpen)
  const lunch = parseTimeToSeconds(s.lunchClose)
  if (t < open) {
    return {
      open: false,
      reason:
        deskMarketFor(instrument) === 'TOKYO'
          ? `Pre-open — Tokyo live desk opens ${formatMarketHmsTodayInDisplayTz(instrument, s.marketOpen, now)}`
          : 'Pre-open — NY live desk opens 9:30 AM ET',
    }
  }
  if (t >= lunch) {
    return {
      open: false,
      reason: isLunchFreezeActive(instrument, now)
        ? 'Lunch freeze — chart tip held until cash close, then afternoon + overnight resume.'
        : 'Morning entry session over — chart continues after cash close (read-only).',
    }
  }
  return { open: true, reason: 'Morning session live' }
}

/**
 * Chart may refresh candles/quotes for display.
 * Frozen only during lunch→close; after cash close + overnight + pre-open history continue
 * until the next morning desk. Trading permissions stay separate (isLiveBarsAllowed).
 */
export function isChartStreamAllowed(
  instrument: string | null | undefined,
  now: Date = new Date()
): { open: boolean; reason: string } {
  if (!isDeskInstrument(instrument)) {
    return { open: false, reason: 'Unknown instrument' }
  }
  const s = sessionFor(instrument)
  if (!isWeekdayInTz(now, s.tz)) {
    return { open: false, reason: `Weekend — ${deskMarketFor(instrument)} session closed` }
  }
  if (isLunchFreezeActive(instrument, now)) {
    return {
      open: false,
      reason:
        deskMarketFor(instrument) === 'TOKYO'
          ? `Lunch freeze (${formatMarketHmsTodayInDisplayTz(instrument, s.lunchClose, now)}–${formatMarketHmsTodayInDisplayTz(instrument, s.marketClose, now)}) — afternoon bars unlock at Tokyo cash close.`
          : 'Lunch freeze (11:30–16:00 ET) — afternoon bars unlock at NY cash close.',
    }
  }
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const lunch = parseTimeToSeconds(s.lunchClose)
  if (t < lunch) {
    return { open: true, reason: 'Chart streaming (morning / pre-open history)' }
  }
  return { open: true, reason: 'Chart streaming (post-close continuum)' }
}

/**
 * Prep / AI levels window: analyzeStart → lunchClose (same market clock).
 * Outside this, live AI levels sleep. Simulation is exempt.
 */
export function isDeskHoursNow(
  now: Date = new Date(),
  instrument: string | null | undefined = 'DOW'
): { open: boolean; reason: string } {
  const s = sessionFor(instrument)
  if (!isWeekdayInTz(now, s.tz)) {
    return { open: false, reason: 'Weekend — desk closed' }
  }
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const start = parseTimeToSeconds(s.analyzeStart)
  const lunch = parseTimeToSeconds(s.lunchClose)
  if (t < start) {
    return {
      open: false,
      reason:
        deskMarketFor(instrument) === 'TOKYO'
          ? `Pre-session — Tokyo desk opens ${formatMarketHmsTodayInDisplayTz(instrument, s.analyzeStart, now)}`
          : 'Pre-session — desk opens 9:15 ET',
    }
  }
  if (t >= lunch) {
    return {
      open: false,
      reason: 'Morning desk closed — afternoon updates are background-only',
    }
  }
  return { open: true, reason: 'Desk hours' }
}

/**
 * LIVE desk phase from clock + position state.
 * Afternoon freeze / background memory messaging belongs here only — not sim.
 */
export function resolveSessionGate(input: SessionGateInput = {}): SessionGateResult {
  const now = input.now ?? new Date()
  const locked = isDeskInstrument(input.lockedInstrument) ? input.lockedInstrument : null
  const viewing = isDeskInstrument(input.viewingInstrument)
    ? input.viewingInstrument
    : locked
  const market = deskMarketFor(viewing ?? locked ?? 'DOW')
  const s = sessionFor(viewing ?? locked ?? 'DOW')

  const timeLocal = timeInTz(now, s.tz)
  const timeEst = getESTTimeString(now) // keep EST label for NY-centric UI banner
  const t = parseTimeToSeconds(timeLocal)
  const analyze = parseTimeToSeconds(s.analyzeStart)
  const open = parseTimeToSeconds(s.marketOpen)
  const entryClose = parseTimeToSeconds(s.entryClose)
  const lunch = parseTimeToSeconds(s.lunchClose)

  const hasOpen = !!input.hasOpenPosition
  const hits = input.stopLossHitCount ?? 0
  const dayDone = !!input.dayDone || !!input.marketDisabled || hits >= MAX_STOP_HITS
  const clockedIn = !!input.clockedIn
  const attendedToday = !!input.attendedToday || clockedIn
  const inDeskWindow = isWeekdayInTz(now, s.tz) && t >= analyze && t < lunch
  // Can clock in only during morning window if not already attended (incl. re-open if early manual out)
  const canClockIn = inDeskWindow && !clockedIn

  const bars = isLiveBarsAllowed(viewing ?? locked, now)
  const wm = getWindowManager()
  // Entry windows are NY-based today; for Tokyo treat as single morning window
  const entryWindow =
    market === 'NY' ? wm.getCurrentWindow(now) : t >= open && t <= entryClose ? 1 : null

  const base = {
    timeEst: market === 'NY' ? timeEst : timeLocal,
    lockedInstrument: locked,
    allowedInstruments: DESK_INSTRUMENTS,
    entryWindow: entryWindow as 1 | 2 | 3 | null,
    market,
    canFetchLiveBars: bars.open && !!locked && (!viewing || viewing === locked),
    clockedIn,
    attendedToday,
    canClockIn,
  }

  // Live streaming only while currently clocked in; attendedToday still allows viewing frozen chart after lunch
  const canView =
    (clockedIn || (attendedToday && t >= lunch)) &&
    !!locked &&
    (bars.open || (attendedToday && t >= lunch)) &&
    (viewing == null || viewing === locked)

  const finish = (
    r: Omit<SessionGateResult, 'clockedIn' | 'canClockIn' | 'attendedToday'>
  ): SessionGateResult => {
    if (clockedIn) {
      return { ...r, clockedIn, attendedToday, canClockIn }
    }
    // Never clocked in during morning desk → lock trading + chart
    const needClock =
      inDeskWindow &&
      !attendedToday &&
      (r.phase === 'PREP' ||
        r.phase === 'RECOMMENDED' ||
        r.phase === 'ENTRY' ||
        r.phase === 'FLAT' ||
        r.phase === 'MANAGE')
    // Attended earlier today (lunch/manual clock-out)
    if (attendedToday) {
      const canReClock = inDeskWindow // before lunch only
      return {
        ...r,
        clockedIn: false,
        attendedToday: true,
        canClockIn: canReClock,
        canPlaceEntry: false,
        canManagePosition: false,
        // Frozen morning chart after lunch is OK; no live bars once clocked out
        canFetchLiveBars: false,
        canViewLiveChart: !!locked && (t >= lunch || r.canViewLiveChart),
        message: canReClock
          ? 'Clocked out — re-clock in with “Today I trade” to resume the live desk.'
          : r.message,
      }
    }
    return {
      ...r,
      clockedIn: false,
      attendedToday: false,
      canClockIn,
      canViewLiveChart: false,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message: needClock
        ? 'Live chart is closed — clock in (“Today I trade”) to unlock, or try Simulation.'
        : r.message,
    }
  }

  if (!isWeekdayInTz(now, s.tz) || t < analyze || t >= lunch) {
    const afterLunch = isWeekdayInTz(now, s.tz) && t >= lunch
    return finish({
      ...base,
      phase: dayDone || afterLunch ? 'DONE' : 'CLOSED',
      canViewLiveChart: false,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message: afterLunch
        ? 'Morning session closed at lunch. Live chart frozen — afternoon review runs in the background for memory only.'
        : t < analyze
          ? market === 'TOKYO'
            ? `Pre-session. Tokyo desk opens ${formatMarketHmsTodayInDisplayTz('NIKKEI', s.analyzeStart, now)} — clock in then to trade NIKKEI.`
            : 'Pre-session. Clock-in opens 9:15 ET (15 min before cash open).'
          : 'Session closed. Use Simulation for replay.',
    })
  }

  if (dayDone) {
    return finish({
      ...base,
      phase: 'DONE',
      canViewLiveChart: canView,
      canFetchLiveBars: clockedIn && bars.open && !!locked,
      canPlaceEntry: false,
      canManagePosition: false,
      message: 'Session done for today (stop limit or AI exit). Trading locked.',
    })
  }

  if (!locked) {
    return finish({
      ...base,
      phase: t >= analyze && t < open ? 'RECOMMENDED' : 'PREP',
      canViewLiveChart: false,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message:
        market === 'TOKYO'
          ? 'No locked instrument for Tokyo session yet.'
          : 'Awaiting DOW vs NASDAQ recommendation…',
    })
  }

  if (hasOpen) {
    const pastLunch = t >= lunch
    return finish({
      ...base,
      phase: pastLunch ? 'DONE' : 'MANAGE',
      canViewLiveChart: !pastLunch && clockedIn && locked === (viewing ?? locked),
      canFetchLiveBars: !pastLunch && clockedIn,
      canPlaceEntry: false,
      canManagePosition: !pastLunch && clockedIn,
      message: pastLunch
        ? 'Lunch flatten — morning session over. Live chart frozen.'
        : 'Position open. Manage only — no new entries.',
    })
  }

  if (t >= analyze && t < open) {
    return finish({
      ...base,
      phase: 'RECOMMENDED',
      canViewLiveChart: false, // bars start at open
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message:
        market === 'TOKYO'
          ? `Trade ${locked} today. Clock in to unlock the live desk (${formatMarketHmsTodayInDisplayTz('NIKKEI', s.marketOpen, now)}–${formatMarketHmsTodayInDisplayTz('NIKKEI', s.lunchClose, now)}).`
          : `Trade ${locked} today. Clock in to unlock the live desk (${s.marketOpen.slice(0, 5)}–${s.lunchClose.slice(0, 5)} ET).`,
    })
  }

  if (t >= open && t < lunch) {
    const inEntryWindow = t <= entryClose
    return finish({
      ...base,
      phase: inEntryWindow ? 'ENTRY' : 'FLAT',
      canViewLiveChart: canView,
      canFetchLiveBars: clockedIn,
      // Entries ONLY until entryClose (10:15 ET / 09:45 JST). After that: no new levels/orders.
      canPlaceEntry: inEntryWindow && clockedIn,
      canManagePosition: false,
      message: inEntryWindow
        ? `Entry window — click a ${locked} level to place a working limit (until ${s.entryClose.slice(0, 5)}).`
        : `Entry window closed (${s.entryClose.slice(0, 5)}). Levels cleared — manage an open position if you have one; otherwise wait for lunch.`,
    })
  }

  // After lunch — closed (afternoon is background memory only)
  return finish({
    ...base,
    phase: 'DONE',
    canViewLiveChart: false,
    canFetchLiveBars: false,
    canPlaceEntry: false,
    canManagePosition: false,
    message:
      'Morning session closed at lunch. Live chart frozen — afternoon review runs in the background for memory only.',
  })
}

/**
 * SIMULATION morning gate only — open → lunch.
 * No afternoon session, no live freeze / background-memory messaging.
 */
export function resolveSimMorningGate(input: {
  now: Date
  instrument: DeskInstrument
  hasOpenPosition?: boolean
  dayDone?: boolean
}): Pick<
  SessionGateResult,
  | 'phase'
  | 'message'
  | 'canPlaceEntry'
  | 'canManagePosition'
  | 'lockedInstrument'
  | 'entryWindow'
  | 'market'
  | 'timeEst'
> {
  const instrument = input.instrument
  const market = deskMarketFor(instrument)
  const s = sessionFor(instrument)
  const timeLocal = timeInTz(input.now, s.tz)
  const t = parseTimeToSeconds(timeLocal)
  const open = parseTimeToSeconds(s.marketOpen)
  const entryClose = parseTimeToSeconds(s.entryClose)
  const lunch = parseTimeToSeconds(s.lunchClose)
  const hasOpen = !!input.hasOpenPosition
  const dayDone = !!input.dayDone

  const base = {
    timeEst: market === 'NY' ? getESTTimeString(input.now) : timeLocal,
    lockedInstrument: instrument,
    entryWindow: (t >= open && t <= entryClose ? 1 : null) as 1 | 2 | 3 | null,
    market,
  }

  if (t >= lunch || dayDone) {
    return {
      ...base,
      phase: 'DONE',
      canPlaceEntry: false,
      canManagePosition: false,
      message: 'Morning replay ended at lunch. Simulation has no afternoon session.',
    }
  }

  if (hasOpen) {
    return {
      ...base,
      phase: 'MANAGE',
      canPlaceEntry: false,
      canManagePosition: true,
      message: 'Position open. Manage only — morning session until lunch.',
    }
  }

  if (t < open) {
    return {
      ...base,
      phase: 'RECOMMENDED',
      canPlaceEntry: false,
      canManagePosition: false,
      message: `Replay clock before cash open. Entries ${s.marketOpen.slice(0, 5)}–${s.lunchClose.slice(0, 5)}.`,
    }
  }

  if (t < lunch) {
    const inEntry = t <= entryClose
    return {
      ...base,
      phase: inEntry ? 'ENTRY' : 'FLAT',
      canPlaceEntry: inEntry,
      canManagePosition: false,
      message: inEntry
        ? `Entry window — click a ${instrument} level to place a working limit.`
        : `Entry window closed. Levels off — manage if in a trade; otherwise wait for lunch.`,
    }
  }

  return {
    ...base,
    phase: 'DONE',
    canPlaceEntry: false,
    canManagePosition: false,
    message: 'Morning replay ended at lunch. Simulation has no afternoon session.',
  }
}

export function assertCanOpenPosition(
  instrument: Instrument,
  gate: SessionGateResult
): { ok: true } | { ok: false; status: number; message: string } {
  if (!isDeskInstrument(instrument)) {
    return { ok: false, status: 400, message: 'Desk only allows DOW, NASDAQ, or NIKKEI' }
  }
  if (!gate.canPlaceEntry) {
    return {
      ok: false,
      status: 403,
      message: `Cannot place entry in phase ${gate.phase}: ${gate.message}`,
    }
  }
  if (gate.lockedInstrument && instrument !== gate.lockedInstrument) {
    return {
      ok: false,
      status: 403,
      message: `Instrument locked to ${gate.lockedInstrument} for today`,
    }
  }
  return { ok: true }
}

export function isNyDeskInstrument(instrument: string): instrument is NyInstrument {
  return isNyInstrument(instrument)
}

export function isLiveDeskInstrument(instrument: string): instrument is DeskInstrument {
  return isDeskInstrument(instrument)
}

function filterAfternoonBars<T extends { time: number }>(
  candles: T[],
  instrument: string | null | undefined,
  mode: 'today-freeze' | 'all-days',
  now: Date = new Date()
): T[] {
  if (candles.length === 0) return candles
  if (!isDeskInstrument(instrument)) return candles
  if (mode === 'today-freeze' && !isLunchFreezeActive(instrument, now)) return candles

  const s = sessionFor(instrument)
  const lunch = parseTimeToSeconds(s.lunchClose)
  const close = parseTimeToSeconds(s.marketClose)
  const todayKey = dateKeyInTz(now, s.tz)
  const secCache = new Map<number, number>()
  const dayCache = new Map<number, string>()

  return candles.filter((c) => {
    const minuteKey = Math.floor(c.time / 60)
    let day = dayCache.get(minuteKey)
    if (day == null) {
      day = dateKeyInTz(new Date(c.time * 1000), s.tz)
      dayCache.set(minuteKey, day)
    }
    if (mode === 'today-freeze' && day !== todayKey) return true

    let sec = secCache.get(minuteKey)
    if (sec == null) {
      sec = parseTimeToSeconds(timeInTz(new Date(c.time * 1000), s.tz))
      secCache.set(minuteKey, sec)
    }
    if (sec >= lunch && sec < close) return false
    return true
  })
}

/**
 * Live psychology clip: while lunch freeze is active, hide *today's* afternoon
 * only. Past days keep full afternoon. After cash close / weekend / next morning:
 * no clip — continuum through overnight into the next session.
 */
export function clipAfternoonBars<T extends { time: number }>(
  candles: T[],
  instrument: string | null | undefined,
  now: Date = new Date()
): T[] {
  return filterAfternoonBars(candles, instrument, 'today-freeze', now)
}

/** Simulation / dated morning window — strip lunch→close on every day in the series. */
export function clipAllAfternoonBars<T extends { time: number }>(
  candles: T[],
  instrument: string | null | undefined
): T[] {
  return filterAfternoonBars(candles, instrument, 'all-days')
}
