/**
 * Trading desk session state — NY (DOW/NASDAQ) and Tokyo (NIKKEI).
 *
 * LIVE attempt ladder (both desks; local cash clock):
 *   1) Morning levels: cash open → entryClose — up to 2 filled attempts.
 *   2) If 0 morning fills → IB strategy from IB-shaped (open+60m) → lunchClose — 1 attempt
 *      (BRK / mean-reversion on Initial Balance).
 *   3) If still 0 fills → after local lunch-range lock (13:30) → marketClose — 1 attempt
 *      (lunch-range BRK / mean-reversion).
 *   Otherwise after morning entry: watch-only until cash close.
 *
 *   NY:  open 09:30 · entry→10:15 · IB 10:30–11:30 · lunch-range 13:30–16:00 ET
 *   Tokyo: open 09:00 · entry→09:45 · IB 10:00–11:30 · lunch-range 13:30–15:00 JST
 *
 * Chart stream: cash open − 30m through marketClose. Lunch flatten closes open books
 * at lunchClose. SIMULATION: morning only (resolveSimMorningGate).
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

/** Unlocked IB / lunch-range strategy (null = not in an unlock window). */
export type RangeStrategy = 'ib' | 'lunch_range' | null
/** @deprecated use RangeStrategy */
export type NyRangeStrategy = RangeStrategy

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
  /** Level resolution triggers at 09:15 ET to capture full London session moves right up to 9:15 AM ET */
  analyzeStart: '09:15:00',
  marketOpen: '09:30:00',
  entryClose: '10:15:00',
  lunchClose: '11:30:00',
  marketClose: '16:00:00',
}

/** IB shaped (NY open+60m) — range strategy entry opens if morning attempts unused. */
export const NY_IB_STRATEGY_START = '10:30:00'
/** NYC lunch range (12:00–13:30 ET) locked — PM lunch-range strategy opens. */
export const NY_LUNCH_RANGE_ENTRY_START = '13:30:00'

/** TSE morning cash session; afternoon chart continues to 15:00. */
export const TOKYO_SESSION: MarketSessionTimes = {
  tz: 'Asia/Tokyo',
  analyzeStart: '08:45:00',
  marketOpen: '09:00:00',
  entryClose: '09:45:00',
  lunchClose: '11:30:00',
  marketClose: '15:00:00',
}

/** IB shaped (Tokyo open+60m) — same ladder as NY on JST clock. */
export const TOKYO_IB_STRATEGY_START = '10:00:00'
/** Local lunch range 12:00–13:30 JST locks — PM lunch-range strategy to cash close. */
export const TOKYO_LUNCH_RANGE_ENTRY_START = '13:30:00'

/** Legacy alias — NY times only */
export const SESSION_TIMES = NY_SESSION

/** Max filled trades (attempts) per morning session — live and sim share this. */
export const MAX_SESSION_ATTEMPTS = 2
/** After this many stop-outs, trading locks (usually same as attempt cap). */
export const MAX_STOP_HITS = 2

/** Desk-local IB strategy start (when Initial Balance is shaped). */
export function ibStrategyStartHms(market: DeskMarket): string {
  return market === 'TOKYO' ? TOKYO_IB_STRATEGY_START : NY_IB_STRATEGY_START
}

/** Desk-local lunch-range PM entry start (after 12:00–13:30 local lunch range). */
export function lunchRangeEntryStartHms(market: DeskMarket): string {
  return market === 'TOKYO' ? TOKYO_LUNCH_RANGE_ENTRY_START : NY_LUNCH_RANGE_ENTRY_START
}

/**
 * Which range-strategy window is open for this desk.
 * Requires morning filled attempts === 0 (unused morning book).
 */
export function resolveRangeStrategy(args: {
  market: DeskMarket
  /** Seconds since midnight in desk TZ */
  timeSec: number
  attemptsUsed: number
  stopHits?: number
}): RangeStrategy {
  const attemptsUsed = Math.max(0, Math.floor(args.attemptsUsed || 0))
  const stopHits = Math.max(0, Math.floor(args.stopHits || 0))
  if (attemptsUsed !== 0 || stopHits >= MAX_STOP_HITS) return null

  const s = args.market === 'TOKYO' ? TOKYO_SESSION : NY_SESSION
  const lunch = parseTimeToSeconds(s.lunchClose)
  const close = parseTimeToSeconds(s.marketClose)
  const ibStart = parseTimeToSeconds(ibStrategyStartHms(args.market))
  const lnStart = parseTimeToSeconds(lunchRangeEntryStartHms(args.market))
  const t = args.timeSec

  if (t >= ibStart && t < lunch) return 'ib'
  if (t >= lnStart && t < close) return 'lunch_range'
  return null
}

/**
 * Session attempt book.
 * - Working / cancelled limits do NOT count.
 * - A fill starts a trade (manage only while open).
 * - That fill burns one attempt whether you exit via stop OR take-profit (or lunch).
 * - Max 2 filled trades per session; 2 stop-outs also locks.
 */
export function evaluateSessionAttempts(input: {
  /** Filled trades today (open + closed) — each fill is one attempt */
  attemptsUsed: number
  stopHits: number
  hasOpenPosition?: boolean
}): {
  attemptsUsed: number
  stopHits: number
  maxAttempts: number
  maxStopHits: number
  /** No more new entries (attempt cap, 2 stops, or already in a position). */
  entriesLocked: boolean
  /** Morning book finished (capped and flat). */
  sessionDone: boolean
  lockReason: string | null
} {
  const attemptsUsed = Math.max(0, Math.floor(input.attemptsUsed || 0))
  const stopHits = Math.max(0, Math.floor(input.stopHits || 0))
  const hasOpen = !!input.hasOpenPosition
  const atAttemptCap = attemptsUsed >= MAX_SESSION_ATTEMPTS
  const stoppedOut = stopHits >= MAX_STOP_HITS
  const entriesLocked = atAttemptCap || stoppedOut || hasOpen
  const sessionDone = (atAttemptCap || stoppedOut) && !hasOpen
  let lockReason: string | null = null
  if (stoppedOut) {
    lockReason = `Stopped out ${MAX_STOP_HITS}/${MAX_STOP_HITS} times — trading locked for this session.`
  } else if (atAttemptCap && !hasOpen) {
    lockReason = `Both attempts used (${MAX_SESSION_ATTEMPTS}/${MAX_SESSION_ATTEMPTS}) — trading locked for this session.`
  } else if (hasOpen) {
    lockReason = `In a trade — attempt ${Math.min(attemptsUsed, MAX_SESSION_ATTEMPTS)}/${MAX_SESSION_ATTEMPTS}. Manage only until flat.`
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
  /** Filled trades today (open + closed) — each fill is one attempt (SL or TP) */
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
  /** Filled trades used this session (max MAX_SESSION_ATTEMPTS) — SL or TP */
  attemptsUsed: number
  maxAttempts: number
  /** Stop-outs this session (max MAX_STOP_HITS) */
  stopHits: number
  maxStopHits: number
  /** IB / lunch-range unlock when morning attempts unused; else null */
  rangeStrategy: RangeStrategy
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
 * Live tip / quote stream window = focus lead only (cash open − 30m → cash close).
 * No midnight→open or overnight printing — saves Railway/OANDA when desk is idle.
 * History candles still load on demand; trading permissions stay separate (isLiveBarsAllowed).
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
  if (!isLiveFocusWindowActive(instrument, now)) {
    const t = parseTimeToSeconds(timeInTz(now, s.tz))
    const open = parseTimeToSeconds(s.marketOpen)
    const close = parseTimeToSeconds(s.marketClose)
    const focusStart = open - LIVE_FOCUS_LEAD_MINUTES * 60
    if (t >= close) {
      return {
        open: false,
        reason:
          deskMarketFor(instrument) === 'TOKYO'
            ? 'Cash close — chart frozen until next Tokyo focus (open − 30m).'
            : 'Cash close — chart frozen until next NY focus (open − 30m).',
      }
    }
    if (t < focusStart) {
      return {
        open: false,
        reason:
          deskMarketFor(instrument) === 'TOKYO'
            ? 'Pre-focus — NIKKEI tip starts 08:30 JST'
            : 'Pre-focus — NY tip starts 09:00 ET',
      }
    }
    return { open: false, reason: 'Outside focus window — tip frozen' }
  }
  if (isAfternoonWatchWindow(now, instrument)) {
    return { open: true, reason: 'Chart streaming (afternoon — trading locked)' }
  }
  return { open: true, reason: 'Chart streaming (focus window)' }
}

/**
 * Tip updates:
 *   −30m → cash open: on (watch while deciding to clock in)
 *   after cash open: only if clocked in / attended (late miss = tip off, no AI)
 *   afternoon: same attendance rule
 */
export function isLiveTipStreamAllowed(
  instrument: string | null | undefined,
  now: Date = new Date(),
  opts?: { clockedIn?: boolean; attendedToday?: boolean }
): { open: boolean; reason: string } {
  const stream = isChartStreamAllowed(instrument, now)
  if (!stream.open) return stream
  const attended = !!(opts?.clockedIn || opts?.attendedToday)
  if (isAfternoonWatchWindow(now, instrument)) {
    if (attended) return { open: true, reason: 'Afternoon tip (attended desk)' }
    return {
      open: false,
      reason: 'Afternoon tip frozen — no morning attendance (save feed cost)',
    }
  }
  // Morning focus: before cash open tip is free; after open require attendance
  if (!isDeskInstrument(instrument)) return stream
  const s = sessionFor(instrument)
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const open = parseTimeToSeconds(s.marketOpen)
  if (t < open) return { open: true, reason: 'Pre-open focus tip' }
  if (attended) return { open: true, reason: 'Session tip (clocked in)' }
  return {
    open: false,
    reason: 'Missed clock-in — session skipped (no tip / no AI)',
  }
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
 * Paint AI/structure levels only in the instrument's desk windows:
 *   morning prep → lunch, or lunch → cash close (watch-only).
 * Pre-open / after close / other market's session → no paint (do not reuse chart-stream).
 */
export function isLevelPaintAllowed(
  now: Date = new Date(),
  instrument: string | null | undefined = 'DOW'
): { open: boolean; reason: string } {
  if (isDeskHoursNow(now, instrument).open) {
    return { open: true, reason: 'Morning desk levels' }
  }
  if (isAfternoonWatchWindow(now, instrument)) {
    return {
      open: true,
      reason:
        isDeskInstrument(instrument) && deskMarketFor(instrument) === 'TOKYO'
          ? 'Tokyo watch levels (read-only)'
          : 'Afternoon watch levels (read-only)',
    }
  }
  return { open: false, reason: 'Outside level window for this desk' }
}

/**
 * True after lunch while that instrument's cash day is still open (lunch → marketClose).
 * Uses the instrument clock (ET vs JST) — not “is the chart streaming history”.
 */
export function isAfternoonWatchWindow(
  now: Date = new Date(),
  instrument: string | null | undefined = 'DOW'
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
 * True while either NY or Tokyo cash-day focus window is open
 * (cash open − 30m → cash close). Outside this = between sessions.
 */
export function isAnyLiveFocusWindowActive(now: Date = new Date()): boolean {
  return (
    isLiveFocusWindowActive('DOW', now) || isLiveFocusWindowActive('NIKKEI', now)
  )
}

/**
 * Instruments shown on the LIVE chart for the current session.
 * Focus market only while a cash day is live (NY hides NIKKEI; Tokyo hides DOW/NASDAQ).
 * When a day lock exists, only that name.
 * After cash close / between sessions → all three (normal browse state).
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
  // Session over / weekend gap — back to normal (all desks visible)
  if (!isAnyLiveFocusWindowActive(now)) {
    return [...DESK_INSTRUMENTS]
  }

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
 * Requires clock-in (or same-day attendance for afternoon force refresh).
 * Simulation / sim-levels must not use this. NY DOW/NASDAQ scoring stays on market-open (no Opus).
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
  if (!opts?.clockedIn && !opts?.attendedToday) {
    return { ok: false, reason: 'Clock in before Level Finder runs' }
  }
  if (!isAnyLiveFocusWindowActive(now)) {
    return { ok: false, reason: 'Between sessions — no live AI' }
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
  const focusLive = isAnyLiveFocusWindowActive(now)
  const lockedRaw = isDeskInstrument(input.lockedInstrument) ? input.lockedInstrument : null
  // Lock + focus tabs only while a cash-day focus window is open; after close → browse all
  const locked =
    focusLive && lockedRaw && deskMarketFor(lockedRaw) === focusMarket
      ? lockedRaw
      : null
  const viewingRaw = isDeskInstrument(input.viewingInstrument)
    ? input.viewingInstrument
    : locked
  const viewing =
    focusLive && viewingRaw && deskMarketFor(viewingRaw) === focusMarket
      ? viewingRaw
      : locked ?? (focusLive ? instrumentsForDeskMarket(focusMarket)[0]! : viewingRaw ?? 'DOW')
  const market = focusLive ? focusMarket : deskMarketFor(viewing ?? 'DOW')
  const s = sessionFor(viewing ?? locked ?? (focusLive ? instrumentsForDeskMarket(focusMarket)[0]! : 'DOW'))

  const timeLocal = timeInTz(now, s.tz)
  const timeEst = getESTTimeString(now) // keep EST label for NY-centric UI banner
  const t = parseTimeToSeconds(timeLocal)
  const analyze = parseTimeToSeconds(s.analyzeStart)
  const open = parseTimeToSeconds(s.marketOpen)
  const entryClose = parseTimeToSeconds(s.entryClose)
  const lunch = parseTimeToSeconds(s.lunchClose)
  const close = parseTimeToSeconds(s.marketClose)
  const weekday = isWeekdayInTz(now, s.tz)
  /** Lunch → cash close: chart + watch levels only */
  const afternoonWatch = weekday && t >= lunch && t < close
  /** Past cash close (same weekday) or weekend — desk fully closed */
  const afterCashClose = weekday && t >= close

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
  /** First clock-in: prep only (analyze → cash open). Late first entry = missed. */
  const inFirstClockWindow = isWeekdayInTz(now, s.tz) && t >= analyze && t < open
  /** Re-clock after early out: until lunch if already attended today. */
  const inDeskWindow = isWeekdayInTz(now, s.tz) && t >= analyze && t < lunch
  // First commit: prep only. Already attended (early out): re-enter until lunch.
  const canClockIn =
    !clockedIn && (!!input.attendedToday ? inDeskWindow : inFirstClockWindow)

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
    rangeStrategy: null as RangeStrategy,
  }

  const rangeStrategy = resolveRangeStrategy({
    market,
    timeSec: t,
    attemptsUsed: book.attemptsUsed,
    stopHits: book.stopHits,
  })

  const base = {
    timeEst: market === 'NY' ? timeEst : timeLocal,
    lockedInstrument: locked,
    allowedInstruments: focusLive
      ? liveVisibleInstruments(now, {
          lockedInstrument: locked,
          clockedIn,
          attendedToday,
        })
      : [...DESK_INSTRUMENTS],
    entryWindow: entryWindow as 1 | 2 | 3 | null,
    market,
    canFetchLiveBars: bars.open && !!locked && (!viewing || viewing === locked),
    clockedIn,
    attendedToday,
    canClockIn,
    ...bookFields,
    rangeStrategy,
  }

  // Live streaming only while currently clocked in; attendedToday keeps afternoon chart until cash close
  const canView =
    (clockedIn || (attendedToday && afternoonWatch)) &&
    !!locked &&
    (bars.open || (attendedToday && afternoonWatch) || (attendedToday && rangeStrategy != null)) &&
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
    const missedLate =
      needClock && isWeekdayInTz(now, s.tz) && t >= open && t < lunch
    // Attended earlier today (lunch/manual clock-out)
    if (attendedToday) {
      const canReClock = inDeskWindow // until lunch — they already committed today
      return {
        ...r,
        clockedIn: false,
        attendedToday: true,
        canClockIn: canReClock,
        canPlaceEntry: false,
        canManagePosition: false,
        rangeStrategy: null,
        // Chart may continue after lunch; no live trading bars once clocked out
        canFetchLiveBars: false,
        canViewLiveChart: !!locked && (afternoonWatch || r.canViewLiveChart),
        message: canReClock
          ? 'Clocked out — re-clock in with “Today I trade” to resume the live desk.'
          : r.message,
      }
    }
    // Never attended: locked all day through afternoon watch until cash close
    const skippedAfternoon = afternoonWatch && !attendedToday
    return {
      ...r,
      clockedIn: false,
      attendedToday: false,
      canClockIn,
      canViewLiveChart: false,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      rangeStrategy: null,
      message: skippedAfternoon
        ? 'Missed clock-in — no morning attendance. Live chart stays locked until cash close. Use Simulation.'
        : missedLate
          ? 'Missed clock-in — cash open already passed. This session is skipped (no AI, no trades). Use Simulation or wait for the next desk.'
          : needClock
            ? 'Live chart is closed — clock in (“Today I trade”) before cash open to unlock, or try Simulation.'
            : r.message,
    }
  }

  const tzShort = market === 'TOKYO' ? 'JST' : 'ET'
  const ibStartHms = ibStrategyStartHms(market)
  const lnStartHms = lunchRangeEntryStartHms(market)
  const nextDesk =
    market === 'TOKYO'
      ? 'Next Tokyo desk: clock in from 8:45 JST.'
      : 'Next NY desk: clock in from 9:15 ET.'

  // Pre-session / weekend / after cash close
  if (!weekday || t < analyze) {
    return finish({
      ...base,
      rangeStrategy: null,
      phase: 'CLOSED',
      canViewLiveChart: false,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message:
        t < analyze && weekday
          ? market === 'TOKYO'
            ? 'Pre-session. Tokyo desk opens 8:45 JST — clock in then to trade NIKKEI.'
            : 'Pre-session. Clock-in opens 9:15 ET (15 min before cash open).'
          : `Weekend — desk closed. ${nextDesk} Or use Simulation.`,
    })
  }

  if (afterCashClose) {
    return finish({
      ...base,
      rangeStrategy: null,
      phase: 'CLOSED',
      canViewLiveChart: false,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message: `Cash closed. ${nextDesk}`,
    })
  }

  // From here: weekday analyze ≤ t < marketClose

  if (dayDone && rangeStrategy == null) {
    return finish({
      ...base,
      rangeStrategy: null,
      phase: afternoonWatch ? 'DONE' : 'DONE',
      canViewLiveChart: canView || (afternoonWatch && !!locked && attendedToday),
      canFetchLiveBars: clockedIn && bars.open && !!locked,
      canPlaceEntry: false,
      canManagePosition: false,
      message:
        book.lockReason ||
        (afternoonWatch
          ? 'Session done for today. Afternoon watch — read-only until cash close.'
          : 'Session done for today (2 attempts). Trading locked.'),
    })
  }

  if (!locked) {
    return finish({
      ...base,
      rangeStrategy: null,
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

  // Open book — manage through cash close (incl. IB / lunch-range fills)
  if (hasOpen) {
    return finish({
      ...base,
      rangeStrategy: null,
      phase: 'MANAGE',
      canViewLiveChart: clockedIn && locked === (viewing ?? locked),
      canFetchLiveBars: clockedIn && (bars.open || afternoonWatch),
      canPlaceEntry: false,
      canManagePosition: clockedIn,
      message: 'Position open. Manage only — no new entries.',
    })
  }

  if (t >= analyze && t < open) {
    return finish({
      ...base,
      rangeStrategy: null,
      phase: 'RECOMMENDED',
      canViewLiveChart: clockedIn,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message: clockedIn
        ? market === 'TOKYO'
          ? `Clocked in on ${locked}. Pre-open prep — entries ${s.marketOpen.slice(0, 5)}–${s.entryClose.slice(0, 5)} JST.`
          : `Clocked in on ${locked}. Pre-open prep — entries ${s.marketOpen.slice(0, 5)}–${s.entryClose.slice(0, 5)} ET.`
        : market === 'TOKYO'
          ? `Trade ${locked} today. Clock in to unlock the live desk (${s.marketOpen.slice(0, 5)}–${s.lunchClose.slice(0, 5)} JST).`
          : `Trade ${locked} today. Clock in to unlock the live desk (${s.marketOpen.slice(0, 5)}–${s.lunchClose.slice(0, 5)} ET).`,
    })
  }

  // Morning cash open → lunch flatten
  if (t >= open && t < lunch) {
    const inEntryWindow = t <= entryClose
    const canMorningAttempt =
      book.attemptsUsed < MAX_SESSION_ATTEMPTS && book.stopHits < MAX_STOP_HITS
    const entryUntil = `${s.entryClose.slice(0, 5)} ${tzShort}`
    const entryRange = `${s.marketOpen.slice(0, 5)}–${s.entryClose.slice(0, 5)} ${tzShort}`
    const ibUntil = `${s.lunchClose.slice(0, 5)} ${tzShort}`

    if (inEntryWindow) {
      return finish({
        ...base,
        rangeStrategy: null,
        phase: 'ENTRY',
        canViewLiveChart: canView,
        canFetchLiveBars: clockedIn,
        canPlaceEntry: clockedIn && canMorningAttempt,
        canManagePosition: false,
        message: canMorningAttempt
          ? market === 'TOKYO'
            ? `Tokyo entry ${entryRange} — Attempts ${book.attemptsUsed}/${MAX_SESSION_ATTEMPTS} used. Click a ${locked} level (until ${entryUntil}). Working limits do not count until filled.`
            : `Entry window ${entryWindow ?? '—'}/3 — Attempts ${book.attemptsUsed}/${MAX_SESSION_ATTEMPTS} used. Click a ${locked} level (until ${entryUntil}). Working limits do not count until filled.`
          : book.lockReason ||
            `No attempts left (${book.attemptsUsed}/${MAX_SESSION_ATTEMPTS}). Trading locked.`,
      })
    }

    // After morning entry window — IB strategy if 0 fills
    if (rangeStrategy === 'ib') {
      return finish({
        ...base,
        rangeStrategy: 'ib',
        phase: 'ENTRY',
        canViewLiveChart: canView || clockedIn,
        canFetchLiveBars: clockedIn,
        canPlaceEntry: clockedIn,
        canManagePosition: false,
        message: `IB strategy unlocked (morning unused) — 1 attempt ${ibStartHms.slice(0, 5)}–${ibUntil}. Trade IB breakout or mean-reversion. Working limits do not count until filled.`,
      })
    }

    // Waiting for IB shape, or morning attempts already used
    const waitingIb =
      book.attemptsUsed === 0 &&
      book.stopHits < MAX_STOP_HITS &&
      t < parseTimeToSeconds(ibStartHms)
    return finish({
      ...base,
      rangeStrategy: null,
      phase: 'FLAT',
      canViewLiveChart: canView || clockedIn,
      canFetchLiveBars: clockedIn,
      canPlaceEntry: false,
      canManagePosition: false,
      message: waitingIb
        ? `Morning entry closed (${entryUntil}). IB shapes at ${ibStartHms.slice(0, 5)} ${tzShort} — 1 IB attempt unlocks if still 0/2 used.`
        : book.attemptsUsed > 0
          ? `Morning attempts used (${book.attemptsUsed}/${MAX_SESSION_ATTEMPTS}). Watch-only until cash close — no IB / lunch-range unlock.`
          : book.stopHits >= MAX_STOP_HITS
            ? book.lockReason ||
              `Stopped out ${MAX_STOP_HITS}/${MAX_STOP_HITS} — trading locked. Manage if open; otherwise wait for next session.`
            : `Morning entry closed (${entryUntil}). Next is IB strategy ${ibStartHms.slice(0, 5)}–${ibUntil} if still 0 fills — not lunch yet.`,
    })
  }

  // Lunch → cash close: lunch-range unlock OR watch-only
  if (t >= lunch && t < close) {
    if (rangeStrategy === 'lunch_range') {
      const closeLabel = `${s.marketClose.slice(0, 5)} ${tzShort}`
      return finish({
        ...base,
        rangeStrategy: 'lunch_range',
        phase: 'ENTRY',
        canViewLiveChart: !!locked && (clockedIn || attendedToday),
        canFetchLiveBars: false,
        canPlaceEntry: clockedIn,
        canManagePosition: false,
        message: `Lunch-range strategy unlocked (still 0 fills) — 1 attempt ${lnStartHms.slice(0, 5)}–${closeLabel}. Trade lunch-range breakout or mean-reversion. Working limits do not count until filled.`,
      })
    }

    const waitingLunchRange =
      book.attemptsUsed === 0 &&
      book.stopHits < MAX_STOP_HITS &&
      t < parseTimeToSeconds(lnStartHms)

    return finish({
      ...base,
      rangeStrategy: null,
      phase: 'DONE',
      canViewLiveChart: afternoonWatch && !!locked && attendedToday,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message: waitingLunchRange
        ? `Watch-only until ${lnStartHms.slice(0, 5)} ${tzShort} — lunch range locks then 1 attempt opens (morning + IB unused).`
        : book.attemptsUsed > 0
          ? 'Afternoon watch — read-only until cash close. Morning/IB attempt already used — no lunch-range unlock.'
          : 'Afternoon watch — read-only until cash close. Levels (AI + IB) are watch-only.',
    })
  }

  return finish({
    ...base,
    rangeStrategy: null,
    phase: 'CLOSED',
    canViewLiveChart: false,
    canFetchLiveBars: false,
    canPlaceEntry: false,
    canManagePosition: false,
    message: `Cash closed. ${nextDesk}`,
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
  | 'rangeStrategy'
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
    rangeStrategy: null as const,
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
        'Session done — 2 attempts reached. Trading locked.',
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
          ? `Entry window — Attempts ${book.attemptsUsed}/${MAX_SESSION_ATTEMPTS} used. Click a ${instrument} level. Working limits do not count until filled.`
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
