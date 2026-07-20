/**
 * Trading desk session state — NY (DOW/NASDAQ) and Tokyo (NIKKEI).
 *
 * LIVE only:
 *   Morning trading: NY 09:30–11:30 ET / Tokyo 09:00–11:30 JST (entries until entryClose).
 *   Chart stream: cash day open continuum through afternoon until marketClose
 *     (no lunch freeze). After cash close the tip freezes — overnight is not traded.
 *   Next morning clock-in: full history (incl. prior afternoon) loads again.
 *   Lunch AI / morning-review still runs in the background for memory.
 *   AVWAP: always anchored at cash open of 5 trading days prior to the tip session.
 *
 * SIMULATION: morning session only (open → lunch). No afternoon feature,
 * no background memory pass — use resolveSimMorningGate(), not the live gate.
 *
 * Prep (AI levels): analyzeStart → lunchClose.
 * Entries: marketOpen → entryClose (first ~45 min).
 */

import { getESTTimeString, parseTimeToSeconds } from '@/lib/utils/timeUtils'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import { getWindowManager } from '@/lib/trading/windowManager'
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
  /** Morning trading desk ends here */
  lunchClose: string
  /** Full cash close (chart continues until here, then overnight) */
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

/** TSE morning cash session; afternoon chart continues to 15:00 (trading stays morning-only). */
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

/** Max filled trades (attempts) per morning session — live and sim share this. */
export const MAX_SESSION_ATTEMPTS = 2
/** After this many stop-outs in the session, trading switches off. */
export const MAX_STOP_HITS = 2

/** Session attempt / stop book — same rules for live desk and simulation. */
export function evaluateSessionAttempts(input: {
  attemptsUsed: number
  stopHits: number
  hasOpenPosition?: boolean
}): {
  attemptsUsed: number
  stopHits: number
  maxAttempts: number
  maxStopHits: number
  /** No more new entries (at attempt cap, or stopped out twice). */
  entriesLocked: boolean
  /** Morning book finished for trading (locked and flat). */
  sessionDone: boolean
  lockReason: string | null
} {
  const attemptsUsed = Math.max(0, Math.floor(input.attemptsUsed || 0))
  const stopHits = Math.max(0, Math.floor(input.stopHits || 0))
  const hasOpen = !!input.hasOpenPosition
  const stoppedOut = stopHits >= MAX_STOP_HITS
  const atAttemptCap = attemptsUsed >= MAX_SESSION_ATTEMPTS
  const entriesLocked = stoppedOut || atAttemptCap || hasOpen
  const sessionDone = stoppedOut || (atAttemptCap && !hasOpen)
  let lockReason: string | null = null
  if (stoppedOut) {
    lockReason = `Stopped out ${MAX_STOP_HITS}/${MAX_STOP_HITS} times — trading locked for this session.`
  } else if (atAttemptCap && !hasOpen) {
    lockReason = `Both attempts used (${MAX_SESSION_ATTEMPTS}/${MAX_SESSION_ATTEMPTS}) — trading locked for this session.`
  } else if (atAttemptCap && hasOpen) {
    lockReason = `Attempt ${attemptsUsed}/${MAX_SESSION_ATTEMPTS} open — manage only.`
  }
  return {
    attemptsUsed,
    stopHits,
    maxAttempts: MAX_SESSION_ATTEMPTS,
    maxStopHits: MAX_STOP_HITS,
    entriesLocked,
    sessionDone,
    lockReason,
  }
}

export function deskMarketFor(instrument: string | null | undefined): DeskMarket {
  return instrument === 'NIKKEI' ? 'TOKYO' : 'NY'
}

/** Attempt/stop book is per desk market so NY and Tokyo sessions do not share caps. */
export function instrumentsForDeskMarket(market: DeskMarket): DeskInstrument[] {
  return market === 'TOKYO' ? ['NIKKEI'] : NY_INSTRUMENTS
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
  /** Filled trades today (open + closed) — each fill is one attempt */
  attemptsUsed?: number
  /** Closed trades today with exit_reason stop_hit */
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
  /** Filled trades used this session (max MAX_SESSION_ATTEMPTS) */
  attemptsUsed: number
  maxAttempts: number
  /** Stop-outs this session (max MAX_STOP_HITS) */
  stopHits: number
  maxStopHits: number
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
 * Lunch→close psychology freeze — permanently off.
 * Afternoon prints live through cash close; AI morning-review still runs at lunch.
 * clipAfternoonBars stays a no-op so next-session loads keep prior afternoon history.
 */
export function isLunchFreezeActive(
  _instrument: string | null | undefined,
  _now: Date = new Date()
): boolean {
  return false
}

/**
 * Trading live bars: cash open → lunch only.
 * After lunch the chart still streams until cash close (isChartStreamAllowed).
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
          ? 'Pre-open — Tokyo live desk opens 9:00 JST'
          : 'Pre-open — NY live desk opens 9:30 ET',
    }
  }
  if (t >= lunch) {
    return {
      open: false,
      reason: 'Morning trading closed at lunch — chart continues until cash close (read-only).',
    }
  }
  return { open: true, reason: 'Morning session live' }
}

/**
 * Chart may refresh candles/quotes through the cash day (morning + afternoon).
 * Freezes after marketClose until the next weekday — overnight is not streamed.
 * Next session clock-in loads full history (prior afternoon included).
 * Trading permissions stay separate (isLiveBarsAllowed).
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
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const close = parseTimeToSeconds(s.marketClose)
  if (t >= close) {
    return {
      open: false,
      reason:
        deskMarketFor(instrument) === 'TOKYO'
          ? 'Cash close — chart frozen until next Tokyo session (clock in for full prints).'
          : 'Cash close — chart frozen until next NY session (clock in for full prints).',
    }
  }
  if (t >= parseTimeToSeconds(s.lunchClose)) {
    return { open: true, reason: 'Chart streaming (afternoon — trading locked)' }
  }
  return { open: true, reason: 'Chart streaming (morning / pre-open history)' }
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
          ? 'Pre-session — Tokyo desk opens 8:45 JST'
          : 'Pre-session — desk opens 9:15 ET',
    }
  }
  if (t >= lunch) {
    return {
      open: false,
      reason: 'Morning desk closed — trading locked; chart continues',
    }
  }
  return { open: true, reason: 'Desk hours' }
}

/**
 * Paint AI/structure levels while the cash day chart is live
 * (morning prep → cash close). Afternoon is watch-only; trading stays locked.
 */
export function isLevelPaintAllowed(
  now: Date = new Date(),
  instrument: string | null | undefined = 'DOW'
): { open: boolean; reason: string } {
  if (isDeskHoursNow(now, instrument).open) {
    return { open: true, reason: 'Morning desk levels' }
  }
  const stream = isChartStreamAllowed(instrument, now)
  if (stream.open) {
    return { open: true, reason: 'Afternoon watch levels (read-only)' }
  }
  return { open: false, reason: stream.reason || 'Outside cash session' }
}

/** True after lunch while the chart still streams (afternoon watch window). */
export function isAfternoonWatchWindow(
  now: Date = new Date(),
  instrument: string | null | undefined = 'DOW'
): boolean {
  return (
    !isDeskHoursNow(now, instrument).open &&
    isChartStreamAllowed(instrument, now).open
  )
}

/**
 * LIVE focus: tabs appear from cash open − 30m through cash close.
 * NIKKEI becomes visible at 08:30 JST (30m before 09:00); NY names at 09:00 ET.
 * Simulation must not use this.
 */
export const LIVE_FOCUS_LEAD_MINUTES = 30

export function isLiveFocusWindowActive(
  instrument: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!isDeskInstrument(instrument)) return false
  const s = sessionFor(instrument)
  if (!isWeekdayInTz(now, s.tz)) return false
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const open = parseTimeToSeconds(s.marketOpen)
  const close = parseTimeToSeconds(s.marketClose)
  const start = open - LIVE_FOCUS_LEAD_MINUTES * 60
  return t >= start && t < close
}

/** @deprecated alias — use isLiveFocusWindowActive */
export function isLiveCashDayActive(
  instrument: string | null | undefined,
  now: Date = new Date()
): boolean {
  return isLiveFocusWindowActive(instrument, now)
}

function isPastMarketClose(instrument: DeskInstrument, now: Date): boolean {
  const s = sessionFor(instrument)
  if (!isWeekdayInTz(now, s.tz)) return false
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  return t >= parseTimeToSeconds(s.marketClose)
}

function isBeforeFocusStart(instrument: DeskInstrument, now: Date): boolean {
  const s = sessionFor(instrument)
  if (!isWeekdayInTz(now, s.tz)) return true
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const open = parseTimeToSeconds(s.marketOpen)
  return t < open - LIVE_FOCUS_LEAD_MINUTES * 60
}

/**
 * Seconds until the next weekday focus start (cash open − lead) for this instrument.
 * Used only when neither cash desk is in its focus window (gap / weekend).
 */
function secondsUntilNextFocusStart(now: Date, instrument: DeskInstrument): number {
  const s = sessionFor(instrument)
  const nowSec = Math.floor(now.getTime() / 1000)
  const [oh, om] = s.marketOpen.split(':').map(Number)
  const leadSec = LIVE_FOCUS_LEAD_MINUTES * 60
  for (let i = 0; i < 10; i++) {
    const probe = new Date(now.getTime() + i * 86_400_000)
    if (!isWeekdayInTz(probe, s.tz)) continue
    const ymd = dateKeyInTz(probe, s.tz)
    const openUnix =
      deskMarketFor(instrument) === 'TOKYO'
        ? tokyoDateTimeToUnix(ymd, oh!, om || 0)
        : nyDateTimeToUnix(ymd, oh!, om || 0)
    const focusUnix = openUnix - leadSec
    if (focusUnix > nowSec) return focusUnix - nowSec
  }
  return Number.MAX_SAFE_INTEGER
}

/** Next LIVE desk market to open (gap / weekend). Simulation must not use this. */
export function nextLiveDeskMarket(now: Date = new Date()): DeskMarket {
  const ny = secondsUntilNextFocusStart(now, 'DOW')
  const tokyo = secondsUntilNextFocusStart(now, 'NIKKEI')
  return tokyo < ny ? 'TOKYO' : 'NY'
}

/**
 * Which LIVE desk market is in focus right now (never both).
 * - Tokyo focus window → NIKKEI only
 * - NY focus window → DOW/NASDAQ
 * - Between closes: sticky prior market so NIKKEI does not appear until 30m before Tokyo open
 * Simulation must not use this.
 */
export function liveFocusMarket(now: Date = new Date()): DeskMarket {
  const tokyoLive = isLiveFocusWindowActive('NIKKEI', now)
  const nyLive = isLiveFocusWindowActive('DOW', now)

  if (tokyoLive && !nyLive) return 'TOKYO'
  if (nyLive && !tokyoLive) return 'NY'
  if (tokyoLive && nyLive) {
    if (isDeskHoursNow(now, 'NIKKEI').open) return 'TOKYO'
    if (isDeskHoursNow(now, 'DOW').open) return 'NY'
    return 'TOKYO'
  }

  // Gap: stay on the desk that just closed until the other focus window opens
  if (isPastMarketClose('DOW', now) && isBeforeFocusStart('NIKKEI', now)) {
    return 'NY'
  }
  if (isPastMarketClose('NIKKEI', now) && isBeforeFocusStart('DOW', now)) {
    return 'TOKYO'
  }

  return nextLiveDeskMarket(now)
}

/**
 * Instruments shown on the LIVE chart for the current session.
 * Focus market only (NY hides NIKKEI; Tokyo hides DOW/NASDAQ).
 * When a day lock exists (recommendation / clock-in / open fill), only that name.
 * Simulation must not use this.
 */
export function liveVisibleInstruments(
  now: Date = new Date(),
  opts?: {
    lockedInstrument?: DeskInstrument | null
    clockedIn?: boolean
    attendedToday?: boolean
  }
): DeskInstrument[] {
  const market = liveFocusMarket(now)
  const sessionList = instrumentsForDeskMarket(market)
  const locked =
    opts?.lockedInstrument && isDeskInstrument(opts.lockedInstrument)
      ? opts.lockedInstrument
      : null

  // Day lock → cannot switch to the twin (e.g. DOW locked → no NASDAQ tab)
  if (locked && deskMarketFor(locked) === market) {
    return [locked]
  }
  return [...sessionList]
}

/**
 * Gate LIVE Level Finder / morning AI token spend to the focused desk.
 * Simulation / sim-levels must not use this.
 */
export function shouldRunLiveAiForInstrument(
  instrument: DeskInstrument,
  now: Date = new Date(),
  opts?: {
    lockedInstrument?: DeskInstrument | null
    clockedIn?: boolean
    attendedToday?: boolean
  }
): { ok: boolean; reason: string } {
  if (!isDeskInstrument(instrument)) {
    return { ok: false, reason: 'Unknown instrument' }
  }
  const focus = liveFocusMarket(now)
  if (deskMarketFor(instrument) !== focus) {
    return { ok: false, reason: `Live focus is ${focus} — skip ${instrument}` }
  }
  const visible = liveVisibleInstruments(now, opts)
  if (!visible.includes(instrument)) {
    return {
      ok: false,
      reason: opts?.lockedInstrument
        ? `Clocked into ${opts.lockedInstrument} — skip ${instrument}`
        : `Not in live focus list for ${focus}`,
    }
  }
  return { ok: true, reason: 'ok' }
}

/**
 * LIVE desk phase from clock + position state.
 * Trading is morning-only; chart stream continues after lunch (not sim).
 */
export function resolveSessionGate(input: SessionGateInput = {}): SessionGateResult {
  const now = input.now ?? new Date()
  const focusMarket = liveFocusMarket(now)
  const lockedRaw = isDeskInstrument(input.lockedInstrument) ? input.lockedInstrument : null
  // Never lock to an off-session name (e.g. NY rec while Tokyo cash day is live)
  const locked =
    lockedRaw && deskMarketFor(lockedRaw) === focusMarket ? lockedRaw : null
  const viewingRaw = isDeskInstrument(input.viewingInstrument)
    ? input.viewingInstrument
    : locked
  const viewing =
    viewingRaw && deskMarketFor(viewingRaw) === focusMarket
      ? viewingRaw
      : locked ?? instrumentsForDeskMarket(focusMarket)[0]!
  const market = focusMarket
  const s = sessionFor(viewing ?? locked ?? instrumentsForDeskMarket(focusMarket)[0]!)

  const timeLocal = timeInTz(now, s.tz)
  const timeEst = getESTTimeString(now) // keep EST label for NY-centric UI banner
  const t = parseTimeToSeconds(timeLocal)
  const analyze = parseTimeToSeconds(s.analyzeStart)
  const open = parseTimeToSeconds(s.marketOpen)
  const entryClose = parseTimeToSeconds(s.entryClose)
  const lunch = parseTimeToSeconds(s.lunchClose)

  const hasOpen = !!input.hasOpenPosition
  const book = evaluateSessionAttempts({
    attemptsUsed: input.attemptsUsed ?? 0,
    stopHits: input.stopLossHitCount ?? 0,
    hasOpenPosition: hasOpen,
  })
  const dayDone =
    !!input.dayDone || !!input.marketDisabled || book.sessionDone
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

  const bookFields = {
    attemptsUsed: book.attemptsUsed,
    maxAttempts: book.maxAttempts,
    stopHits: book.stopHits,
    maxStopHits: book.maxStopHits,
  }

  const base = {
    timeEst: market === 'NY' ? timeEst : timeLocal,
    lockedInstrument: locked,
    allowedInstruments: liveVisibleInstruments(now, {
      lockedInstrument: locked,
      clockedIn,
      attendedToday,
    }),
    entryWindow: entryWindow as 1 | 2 | 3 | null,
    market,
    canFetchLiveBars: bars.open && !!locked && (!viewing || viewing === locked),
    clockedIn,
    attendedToday,
    canClockIn,
    ...bookFields,
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
        // Chart may continue after lunch; no live trading bars once clocked out
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
      canViewLiveChart: afterLunch && !!locked,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message: afterLunch
        ? 'Morning trading closed at lunch. Chart continues until cash close (read-only); afternoon levels are watch-only (AI + IB).'
        : t < analyze
          ? market === 'TOKYO'
            ? 'Pre-session. Tokyo desk opens 8:45 JST — clock in then to trade NIKKEI.'
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
      message:
        book.lockReason ||
        'Session done for today (attempts or stop limit). Trading locked.',
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
      canViewLiveChart: clockedIn && locked === (viewing ?? locked),
      canFetchLiveBars: !pastLunch && clockedIn,
      canPlaceEntry: false,
      canManagePosition: !pastLunch && clockedIn,
      message: pastLunch
        ? 'Lunch flatten — morning trading over. Chart continues (read-only).'
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
          ? `Trade ${locked} today. Clock in to unlock the live desk (${s.marketOpen.slice(0, 5)}–${s.lunchClose.slice(0, 5)} JST).`
          : `Trade ${locked} today. Clock in to unlock the live desk (${s.marketOpen.slice(0, 5)}–${s.lunchClose.slice(0, 5)} ET).`,
    })
  }

  if (t >= open && t < lunch) {
    const inEntryWindow = t <= entryClose
    const canAttempt =
      book.attemptsUsed < MAX_SESSION_ATTEMPTS && book.stopHits < MAX_STOP_HITS
    return finish({
      ...base,
      phase: inEntryWindow ? 'ENTRY' : 'FLAT',
      canViewLiveChart: canView,
      canFetchLiveBars: clockedIn,
      // Entries ONLY until entryClose; max 2 attempts / 2 stop-outs per session.
      canPlaceEntry: inEntryWindow && clockedIn && canAttempt,
      canManagePosition: false,
      message: inEntryWindow
        ? canAttempt
          ? `Entry window — attempt ${book.attemptsUsed + 1}/${MAX_SESSION_ATTEMPTS} (stops ${book.stopHits}/${MAX_STOP_HITS}). Click a ${locked} level (until ${s.entryClose.slice(0, 5)}).`
          : book.lockReason ||
            `No attempts left (${book.attemptsUsed}/${MAX_SESSION_ATTEMPTS}). Trading locked.`
        : `Entry window closed (${s.entryClose.slice(0, 5)}). Levels cleared — manage an open position if you have one; otherwise wait for lunch.`,
    })
  }

  // After lunch — trading locked; chart stream continues separately
  return finish({
    ...base,
    phase: 'DONE',
    canViewLiveChart: !!locked,
    canFetchLiveBars: false,
    canPlaceEntry: false,
    canManagePosition: false,
    message:
      'Morning trading closed at lunch. Chart continues until cash close (read-only); afternoon levels are watch-only (AI + IB).',
  })
}

/**
 * SIMULATION morning gate only — open → lunch.
 * Same attempt/stop limits as live (MAX_SESSION_ATTEMPTS / MAX_STOP_HITS).
 * No afternoon session, no live freeze / background-memory messaging.
 */
export function resolveSimMorningGate(input: {
  now: Date
  instrument: DeskInstrument
  hasOpenPosition?: boolean
  dayDone?: boolean
  attemptsUsed?: number
  stopHits?: number
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
  | 'attemptsUsed'
  | 'maxAttempts'
  | 'stopHits'
  | 'maxStopHits'
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
  const book = evaluateSessionAttempts({
    attemptsUsed: input.attemptsUsed ?? 0,
    stopHits: input.stopHits ?? 0,
    hasOpenPosition: hasOpen,
  })
  const dayDone = !!input.dayDone || book.sessionDone

  const base = {
    timeEst: market === 'NY' ? getESTTimeString(input.now) : timeLocal,
    lockedInstrument: instrument,
    entryWindow: (t >= open && t <= entryClose ? 1 : null) as 1 | 2 | 3 | null,
    market,
    attemptsUsed: book.attemptsUsed,
    maxAttempts: book.maxAttempts,
    stopHits: book.stopHits,
    maxStopHits: book.maxStopHits,
  }

  if (t >= lunch) {
    return {
      ...base,
      phase: 'DONE',
      canPlaceEntry: false,
      canManagePosition: false,
      message: 'Morning replay ended at lunch. Simulation has no afternoon session.',
    }
  }

  if (dayDone) {
    return {
      ...base,
      phase: 'DONE',
      canPlaceEntry: false,
      canManagePosition: false,
      message:
        book.lockReason ||
        'Session done — attempts or stop limit reached. Trading locked.',
    }
  }

  if (hasOpen) {
    return {
      ...base,
      phase: 'MANAGE',
      canPlaceEntry: false,
      canManagePosition: true,
      message: `Position open — attempt ${book.attemptsUsed}/${MAX_SESSION_ATTEMPTS}. Manage only until lunch.`,
    }
  }

  if (t < open) {
    return {
      ...base,
      phase: 'RECOMMENDED',
      canPlaceEntry: false,
      canManagePosition: false,
      message: `Replay clock before cash open. Entries ${s.marketOpen.slice(0, 5)}–${s.lunchClose.slice(0, 5)}. Attempts ${book.attemptsUsed}/${MAX_SESSION_ATTEMPTS}.`,
    }
  }

  if (t < lunch) {
    const inEntry = t <= entryClose
    const canAttempt =
      book.attemptsUsed < MAX_SESSION_ATTEMPTS && book.stopHits < MAX_STOP_HITS
    return {
      ...base,
      phase: inEntry ? 'ENTRY' : 'FLAT',
      canPlaceEntry: inEntry && canAttempt,
      canManagePosition: false,
      message: inEntry
        ? canAttempt
          ? `Entry window — attempt ${book.attemptsUsed + 1}/${MAX_SESSION_ATTEMPTS} (stops ${book.stopHits}/${MAX_STOP_HITS}). Click a ${instrument} level.`
          : book.lockReason || 'No attempts left. Trading locked.'
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
 * Live afternoon clip — no-op while lunch freeze is off (chart prints afternoon).
 * Past days always keep full afternoon. Sim still uses clipAllAfternoonBars.
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
