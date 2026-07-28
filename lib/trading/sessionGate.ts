/**
 * Trading desk session state — NY (DOW/NASDAQ) and Tokyo (NIKKEI).
 *
 * LIVE attempt ladder (Option B: 2 / 2 / 2 · day ≤ 6; local cash clock):
 *   DOW/NASDAQ: Morning (OR30) → IB → Lunch-range
 *   NIKKEI:     Morning (OR30) → US Range (prior NYC) → Tokyo IB
 *   Next window unlocks when prior clock ends OR attempts are exhausted.
 *   No PM watch — manage-only when locked.
 *
 *   NY:  open 09:30 · OR30→10:15 · IB 10:15–10:45 · lunch-range 13:30–15:15 ET
 *   Tokyo: open 09:00 · OR30→09:45 · US Range 10:15–10:45 · IB 13:30–15:00 JST
 *
 * Chart stream: cash open − 30m through marketClose. Morning/slot-2 books are not
 * auto-flattened at lunchClose — trader confirms. Cash close auto-liquidates
 * slot-3 fills and any leftover opens. SIMULATION: same 2/2/2 ladder (no clock-in).
 */

import { parseTimeToSeconds } from '@/lib/utils/timeUtils'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import {
  TRADER_DISPLAY_LABEL,
  deskLocalHmsAsTraderDisplay,
  deskLocalRangeAsTraderDisplay,
  timeInTraderDisplay,
} from '@/lib/chart/traderDisplayTz'
import { getWindowManager } from '@/lib/trading/windowManager'
import type { Instrument } from '@/types/trading'
import {
  MAX_DAY_ATTEMPTS,
  MAX_MORNING_ATTEMPTS,
  attemptLadderFromCounts,
  attemptLadderFromTotals,
  attemptLadderLockReason,
  buildAttemptLadder,
  formatAttemptLadderShort,
  resolveRangeStrategyFromLadder,
  type AttemptFill,
  type AttemptLadder,
} from '@/lib/trading/attemptLadder'

export {
  MAX_DAY_ATTEMPTS,
  MAX_MORNING_ATTEMPTS,
  MAX_IB_ATTEMPTS,
  MAX_LUNCH_RANGE_ATTEMPTS,
  buildAttemptLadder,
  attemptLadderFromCounts,
  formatAttemptLadderShort,
} from '@/lib/trading/attemptLadder'
export type { AttemptFill, AttemptLadder } from '@/lib/trading/attemptLadder'

export type SessionPhase =
  | 'PREP'
  | 'RECOMMENDED'
  | 'ENTRY'
  | 'MANAGE'
  | 'FLAT'
  | 'DONE'
  | 'CLOSED'

/** Unlocked slot-2 / slot-3 strategy (null = not in an unlock window). */
export type RangeStrategy = 'ib' | 'lunch_range' | 'us_range' | null
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

/** IB entry window (NY) — after morning entry close; then manage-only. */
export const NY_IB_STRATEGY_START = '10:15:00'
export const NY_IB_STRATEGY_END = '10:45:00'
/** NYC lunch range (12:00–13:30 ET) locked — PM lunch-range entries until 15:15. */
export const NY_LUNCH_RANGE_ENTRY_START = '13:30:00'
export const NY_LUNCH_RANGE_ENTRY_END = '15:15:00'

/** TSE morning cash session; afternoon chart continues to 15:00. */
export const TOKYO_SESSION: MarketSessionTimes = {
  tz: 'Asia/Tokyo',
  analyzeStart: '08:45:00',
  marketOpen: '09:00:00',
  entryClose: '09:45:00',
  lunchClose: '11:30:00',
  marketClose: '15:00:00',
}

/** IB entry window (Tokyo local) — same clock shape as NY; then manage-only. */
export const TOKYO_IB_STRATEGY_START = '10:15:00'
export const TOKYO_IB_STRATEGY_END = '10:45:00'
/** Local lunch range locks 13:30 JST — entries until cash close (15:00). */
export const TOKYO_LUNCH_RANGE_ENTRY_START = '13:30:00'
export const TOKYO_LUNCH_RANGE_ENTRY_END = '15:00:00'

/** Legacy alias — NY times only */
export const SESSION_TIMES = NY_SESSION

/** Morning / simulation attempt cap (IB + lunch are separate on live). */
export const MAX_SESSION_ATTEMPTS = MAX_MORNING_ATTEMPTS
/** Stop hits allowed in morning book before locking remaining morning probes (Option B = 2). */
export const MAX_STOP_HITS = 2

/** Desk-local IB strategy start. */
export function ibStrategyStartHms(market: DeskMarket): string {
  return market === 'TOKYO' ? TOKYO_IB_STRATEGY_START : NY_IB_STRATEGY_START
}

/** Desk-local IB strategy end (after this → manage-only until lunch-range). */
export function ibStrategyEndHms(market: DeskMarket): string {
  return market === 'TOKYO' ? TOKYO_IB_STRATEGY_END : NY_IB_STRATEGY_END
}

/** Desk-local lunch-range PM entry start (after 12:00–13:30 local lunch range). */
export function lunchRangeEntryStartHms(market: DeskMarket): string {
  return market === 'TOKYO' ? TOKYO_LUNCH_RANGE_ENTRY_START : NY_LUNCH_RANGE_ENTRY_START
}

/** Desk-local lunch-range PM entry end (after this → manage-only until cash close). */
export function lunchRangeEntryEndHms(market: DeskMarket): string {
  return market === 'TOKYO' ? TOKYO_LUNCH_RANGE_ENTRY_END : NY_LUNCH_RANGE_ENTRY_END
}

/**
 * Which range-strategy window is open for this desk (Option B).
 * NY: IB after morning clock/exhaust; lunch-range after IB clock/exhaust.
 * Tokyo: US Range after morning clock/exhaust; IB after US Range clock/exhaust.
 */
export function resolveRangeStrategy(args: {
  market: DeskMarket
  /** Seconds since midnight in desk TZ */
  timeSec: number
  attemptsUsed?: number
  stopHits?: number
  ladder?: AttemptLadder
}): RangeStrategy {
  const ladder =
    args.ladder ??
    attemptLadderFromTotals({
      attemptsUsed: args.attemptsUsed ?? 0,
      stopHits: args.stopHits ?? 0,
    })
  return resolveRangeStrategyFromLadder({
    market: args.market,
    timeSec: args.timeSec,
    ladder,
  })
}

/**
 * Morning / simulation attempt book.
 * Live day cap (9) + IB/lunch rules live in attemptLadder.ts.
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
  /** No more new morning entries (attempt cap, stop, or already in a position). */
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
  if (stoppedOut || (atAttemptCap && !hasOpen)) {
    lockReason = `Morning probes used (${MAX_SESSION_ATTEMPTS}/${MAX_SESSION_ATTEMPTS}). Wait for the next range window.`
  } else if (hasOpen) {
    lockReason = `In a trade — morning ${Math.min(attemptsUsed, MAX_SESSION_ATTEMPTS)}/${MAX_SESSION_ATTEMPTS}. Manage only until flat.`
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
  /** Day's committed lock (clock-in / open book) — not a soft AI suggestion */
  lockedInstrument?: DeskInstrument | null
  /** AI / regime pick for NY (DOW vs NASDAQ) — suggestion only until clock-in */
  suggestedInstrument?: DeskInstrument | null
  /** True if an open position exists for the locked instrument today */
  hasOpenPosition?: boolean
  /** Filled trades today (open + closed) — each fill is one attempt (SL or TP) */
  attemptsUsed?: number
  /** Closed trades today with exit_reason stop_hit */
  stopLossHitCount?: number
  /** Per-fill timestamps for morning/IB/lunch classification (preferred) */
  attemptFills?: AttemptFill[]
  /** Prebuilt ladder — skips rebuild when provided */
  attemptLadder?: AttemptLadder
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
  /**
   * Soft NY pick (DOW or NASDAQ) from market-open / regime.
   * Does not collapse tabs — clock-in commits the lock.
   */
  suggestedInstrument: DeskInstrument | null
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
  /** Filled trades used today (day total) — SL or TP */
  attemptsUsed: number
  /** Day hard cap (3) */
  maxAttempts: number
  /** Stop-outs this session */
  stopHits: number
  maxStopHits: number
  /** IB / lunch-range unlock when eligible; else null */
  rangeStrategy: RangeStrategy
  /** Morning / IB / lunch attempt breakdown */
  morningAttempts: number
  ibAttempts: number
  lunchAttempts: number
  maxMorningAttempts: number
  maxIbAttempts: number
  maxLunchAttempts: number
  revengeLocked: boolean
  dayLocked: boolean
  attemptLadderLabel: string
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
          ? `Pre-open — Tokyo live desk opens ${deskLocalHmsAsTraderDisplay(s.marketOpen, s.tz, now)} ${TRADER_DISPLAY_LABEL}`
          : `Pre-open — NY live desk opens ${deskLocalHmsAsTraderDisplay(s.marketOpen, s.tz, now)} ${TRADER_DISPLAY_LABEL}`,
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
            ? `Pre-focus — NIKKEI tip starts ${deskLocalHmsAsTraderDisplay('08:30:00', s.tz, now)} ${TRADER_DISPLAY_LABEL}`
            : `Pre-focus — NY tip starts ${deskLocalHmsAsTraderDisplay('09:00:00', s.tz, now)} ${TRADER_DISPLAY_LABEL}`,
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
          ? `Pre-session — Tokyo desk opens ${deskLocalHmsAsTraderDisplay(s.analyzeStart, s.tz, now)} ${TRADER_DISPLAY_LABEL}`
          : `Pre-session — desk opens ${deskLocalHmsAsTraderDisplay(s.analyzeStart, s.tz, now)} ${TRADER_DISPLAY_LABEL}`,
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
          : 'Lunch break / lunch-range levels',
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
  const suggestedRaw = isDeskInstrument(input.suggestedInstrument)
    ? input.suggestedInstrument
    : null
  const suggestedInstrument =
    focusLive &&
    suggestedRaw &&
    deskMarketFor(suggestedRaw) === focusMarket &&
    focusMarket === 'NY'
      ? suggestedRaw
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
  /** Banner clock — always Montreal (trader wall clock), even on Tokyo desk. */
  const timeEst = timeInTraderDisplay(now)
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
  /**
   * NY dual browse: cash open − 30m → cash open, both DOW+NASDAQ visible,
   * tip on, no hard lock until clock-in. AI suggest lands at analyzeStart (9:15).
   */
  const nyDualBrowse =
    market === 'NY' &&
    focusLive &&
    !locked &&
    weekday &&
    t >= open - LIVE_FOCUS_LEAD_MINUTES * 60 &&
    t < open

  const hasOpen = !!input.hasOpenPosition
  const ladderRaw: AttemptLadder =
    input.attemptLadder ??
    (input.attemptFills
      ? buildAttemptLadder(
          input.attemptFills,
          lockedRaw ?? viewingRaw ?? 'DOW',
          now
        )
      : attemptLadderFromTotals({
          attemptsUsed: input.attemptsUsed ?? 0,
          stopHits: input.stopLossHitCount ?? 0,
          now,
          instrument: lockedRaw ?? viewingRaw ?? 'DOW',
        }))
  // Re-apply Option B clock unlock against `now` (pre-built ladders may omit clock)
  const ladder: AttemptLadder = attemptLadderFromCounts({
    morningAttempts: ladderRaw.morningAttempts,
    ibAttempts: ladderRaw.ibAttempts,
    lunchAttempts: ladderRaw.lunchAttempts,
    morningStopHits: ladderRaw.morningStopHits,
    now,
    instrument: lockedRaw ?? viewingRaw ?? 'DOW',
  })
  const book = evaluateSessionAttempts({
    attemptsUsed: ladder.morningAttempts,
    stopHits: ladder.morningStopHits,
    hasOpenPosition: hasOpen,
  })
  const dayDone =
    !!input.dayDone || !!input.marketDisabled || ladder.dayLocked
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

  const ladderLock = attemptLadderLockReason(ladder, viewing ?? locked)
  const bookFields = {
    attemptsUsed: ladder.dayAttempts,
    maxAttempts: MAX_DAY_ATTEMPTS,
    stopHits: ladder.morningStopHits,
    maxStopHits: MAX_STOP_HITS,
    rangeStrategy: null as RangeStrategy,
    morningAttempts: ladder.morningAttempts,
    ibAttempts: ladder.ibAttempts,
    lunchAttempts: ladder.lunchAttempts,
    maxMorningAttempts: ladder.maxMorningAttempts,
    maxIbAttempts: ladder.maxIbAttempts,
    maxLunchAttempts: ladder.maxLunchAttempts,
    revengeLocked: ladder.revengeLocked,
    dayLocked: ladder.dayLocked,
    attemptLadderLabel: formatAttemptLadderShort(ladder, viewing ?? locked),
  }

  const rangeStrategy = resolveRangeStrategy({
    market,
    timeSec: t,
    ladder,
  })

  const base = {
    timeEst,
    lockedInstrument: locked,
    suggestedInstrument,
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
      const openBook = r.phase === 'MANAGE' || hasOpen
      const canReClock = inDeskWindow && !openBook
      return {
        ...r,
        clockedIn: false,
        attendedToday: true,
        canClockIn: canReClock,
        canPlaceEntry: false,
        // Open book must stay manageable even after lunch/manual clock-out
        canManagePosition: openBook ? true : false,
        rangeStrategy: openBook ? r.rangeStrategy : null,
        canFetchLiveBars: openBook
          ? !!(r.canFetchLiveBars || bars.open || afternoonWatch || afterCashClose)
          : false,
        canViewLiveChart: openBook
          ? !!locked && (viewing == null || viewing === locked)
          : !!locked && (afternoonWatch || r.canViewLiveChart),
        message: openBook
          ? r.message || 'Position open. Manage only — no new entries.'
          : canReClock
            ? 'Clocked out — re-clock in with “Today I trade” to resume the live desk.'
            : r.message,
      }
    }
    // Never attended: allow NY dual browse pre-open; otherwise lock until clock-in / next day
    const skippedAfternoon = afternoonWatch && !attendedToday
    if (nyDualBrowse) {
      return {
        ...r,
        clockedIn: false,
        attendedToday: false,
        canClockIn,
        canViewLiveChart: true,
        canFetchLiveBars: false,
        canPlaceEntry: false,
        canManagePosition: false,
        rangeStrategy: null,
        message: r.message,
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

  const ibStartHms = ibStrategyStartHms(market)
  const ibEndHms = ibStrategyEndHms(market)
  const lnStartHms = lunchRangeEntryStartHms(market)
  const lnEndHms = lunchRangeEntryEndHms(market)
  const analyzeEt = deskLocalHmsAsTraderDisplay(s.analyzeStart, s.tz, now)
  const nextDesk =
    market === 'TOKYO'
      ? `Next Tokyo desk: clock in from ${analyzeEt} ${TRADER_DISPLAY_LABEL}.`
      : `Next NY desk: clock in from ${analyzeEt} ${TRADER_DISPLAY_LABEL}.`

  // Pre-session / weekend / after cash close
  // NY dual browse opens at cash open − 30m (before analyzeStart / clock-in).
  if (!weekday || (t < analyze && !nyDualBrowse)) {
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
            ? `Pre-session. Tokyo desk opens ${analyzeEt} ${TRADER_DISPLAY_LABEL} — clock in then to trade NIKKEI.`
            : `Pre-session. NY tip + dual browse from ${deskLocalHmsAsTraderDisplay('09:00:00', s.tz, now)} ${TRADER_DISPLAY_LABEL}; AI pick + clock-in at ${analyzeEt} ${TRADER_DISPLAY_LABEL}.`
          : `Weekend — desk closed. ${nextDesk} Or use Simulation.`,
    })
  }

  // NY focus lead-in (09:00–09:15): both DOW + NASDAQ, tip on, wait for AI pick
  if (nyDualBrowse && t < analyze) {
    return finish({
      ...base,
      rangeStrategy: null,
      phase: 'PREP',
      canViewLiveChart: true,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message: `NY focus — browse DOW and NASDAQ. AI suggests which to trade at ${analyzeEt} ${TRADER_DISPLAY_LABEL}.`,
    })
  }

  // Open book wins over cash-close CLOSED so MANAGE stays until flatten completes
  if (hasOpen && locked) {
    const canSee =
      (clockedIn || attendedToday) && locked === (viewing ?? locked)
    const openBookHint =
      ladder.morningAttempts > 0
        ? market === 'TOKYO'
          ? 'Morning (OR30) book open — manage only (one book at a time). Confirm close at lunch (11:30) or ride until cash-close flatten. US Range / IB still unlock on the clock after you flatten (up to 2 probes each @ 0.25%).'
          : 'Morning (OR30) book open — manage only (one book at a time). Confirm close at lunch (11:30) or ride until cash-close flatten. IB / lunch-range still unlock on the clock after you flatten (up to 2 probes each @ 0.25%).'
        : ladder.ibAttempts > 0
          ? market === 'TOKYO'
            ? 'US Range book open — manage only. Tokyo IB still unlocks on the clock after you flatten (up to 2 probes @ 0.25%).'
            : 'IB book open — manage only. Lunch-range still unlocks on the clock after you flatten (up to 2 probes @ 0.25%).'
          : ladder.lunchAttempts > 0
            ? market === 'TOKYO'
              ? 'IB book open. Manage only — no new entries while this book is open.'
              : 'Lunch-range book open. Manage only — no new entries while this book is open.'
            : 'Position open. Manage only — no new entries.'
    return finish({
      ...base,
      rangeStrategy: null,
      phase: 'MANAGE',
      canViewLiveChart: canSee,
      canFetchLiveBars:
        (clockedIn || attendedToday) && (bars.open || afternoonWatch || afterCashClose),
      canPlaceEntry: false,
      canManagePosition: clockedIn || attendedToday,
      message: afterCashClose
        ? 'Cash closed — flattening open book. Manage only until flat.'
        : openBookHint,
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
          ? 'Session done for today. Manage if open until cash close — no new entries.'
          : 'Session done for today (day attempt cap). Trading locked.'),
    })
  }

  if (!locked) {
    const pickHint = suggestedInstrument
      ? `AI suggests ${suggestedInstrument}. Clock in on DOW or NASDAQ to commit today's desk.`
      : 'Awaiting DOW vs NASDAQ recommendation…'
    return finish({
      ...base,
      rangeStrategy: null,
      phase: t >= analyze && t < open ? 'RECOMMENDED' : 'PREP',
      canViewLiveChart: nyDualBrowse,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message:
        market === 'TOKYO'
          ? 'No locked instrument for Tokyo session yet.'
          : nyDualBrowse
            ? t >= analyze
              ? pickHint
              : `NY focus — browse DOW and NASDAQ. AI suggests which to trade at ${analyzeEt} ${TRADER_DISPLAY_LABEL}.`
            : pickHint,
    })
  }

  // (hasOpen already handled above — through cash close)

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
          ? `Clocked in on ${locked}. Pre-open prep — entries ${deskLocalRangeAsTraderDisplay(s.marketOpen, s.entryClose, s.tz, now)}.`
          : `Clocked in on ${locked}. Pre-open prep — entries ${deskLocalRangeAsTraderDisplay(s.marketOpen, s.entryClose, s.tz, now)}.`
        : market === 'TOKYO'
          ? `Trade ${locked} today. Clock in to unlock the live desk (${deskLocalRangeAsTraderDisplay(s.marketOpen, s.lunchClose, s.tz, now)}).`
          : `Trade ${locked} today. Clock in to unlock the live desk (${deskLocalRangeAsTraderDisplay(s.marketOpen, s.lunchClose, s.tz, now)}).`,
    })
  }

  // Morning cash open → lunch (11:30)
  if (t >= open && t < lunch) {
    // Morning levels end just before IB start when they share the same clock mark
    const inEntryWindow = t < parseTimeToSeconds(ibStartHms) && t <= entryClose
    const canMorningAttempt = ladder.morningEligible && !hasOpen
    const entryUntil = `${deskLocalHmsAsTraderDisplay(s.entryClose, s.tz, now)} ${TRADER_DISPLAY_LABEL}`
    const entryRange = deskLocalRangeAsTraderDisplay(
      s.marketOpen,
      s.entryClose,
      s.tz,
      now
    )
    const ibUntil = `${deskLocalHmsAsTraderDisplay(ibEndHms, s.tz, now)} ${TRADER_DISPLAY_LABEL}`
    const ibRange = deskLocalRangeAsTraderDisplay(ibStartHms, ibEndHms, s.tz, now)
    const lunchRangeLabel = deskLocalRangeAsTraderDisplay(
      lnStartHms,
      lnEndHms,
      s.tz,
      now
    )
    const ladderHint = formatAttemptLadderShort(ladder, locked)
    const midLabel = market === 'TOKYO' ? 'US Range' : 'IB'
    const lateLabel = market === 'TOKYO' ? 'IB' : 'Lunch-range'
    const prepAfterMid =
      market === 'TOKYO' ? 'IB prep playbook' : 'Lunch break playbook'

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
            ? `Morning (OR30) playbook ${entryRange} — ${ladderHint}. Click a ${locked} level (until ${entryUntil}). Working limits do not count until filled.`
            : `Morning (OR30) playbook ${entryRange} — ${ladderHint}. Click a ${locked} level (until ${entryUntil}). Working limits do not count until filled.`
          : ladderLock ||
            book.lockReason ||
            `Morning attempts full (${ladder.morningAttempts}/${ladder.maxMorningAttempts}). ${ladderHint}`,
      })
    }

    // Slot-2 unlock: NY = IB · TOKYO = US Range
    if (rangeStrategy === 'ib' || rangeStrategy === 'us_range') {
      const slot2Eligible = ladder.ibEligible
      return finish({
        ...base,
        rangeStrategy,
        phase: 'ENTRY',
        canViewLiveChart: canView || clockedIn,
        canFetchLiveBars: clockedIn,
        canPlaceEntry: clockedIn && slot2Eligible && !hasOpen,
        canManagePosition: false,
        message: `${midLabel} playbook unlocked — up to 2 probes @ 0.25% ${ibRange}. ${ladderHint}. After ${ibUntil} → ${prepAfterMid}. Working limits do not count until filled.`,
      })
    }

    // Waiting for slot 2, slot 2 ended (prep for slot 3), or path blocked
    const waitingMid =
      ladder.ibEligible && t < parseTimeToSeconds(ibStartHms)
    const midEnded =
      t >= parseTimeToSeconds(ibEndHms) && t < lunch
    return finish({
      ...base,
      rangeStrategy: null,
      phase: 'FLAT',
      canViewLiveChart: canView || clockedIn,
      canFetchLiveBars: clockedIn,
      canPlaceEntry: false,
      canManagePosition: false,
      message: ladderLock
        ? `${ladderLock} ${ladderHint}`
        : waitingMid
          ? `Morning entry closed (${entryUntil}). ${midLabel} playbook ${ibRange} (up to 2 probes). ${ladderHint}`
          : midEnded
            ? `${midLabel} entry closed (${ibUntil}). ${prepAfterMid} — ${lateLabel} unlocks ${lunchRangeLabel}. ${ladderHint}`
            : `Morning entry closed (${entryUntil}). Next is ${midLabel} ${ibRange}. ${ladderHint}`,
    })
  }

  // Lunch → cash close: slot-3 unlock (NY lunch-range · TOKYO IB) OR manage-only
  if (t >= lunch && t < close) {
    if (rangeStrategy === 'lunch_range' || (market === 'TOKYO' && rangeStrategy === 'ib')) {
      const lnUntil = `${deskLocalHmsAsTraderDisplay(lnEndHms, s.tz, now)} ${TRADER_DISPLAY_LABEL}`
      const ladderHint = formatAttemptLadderShort(ladder, locked)
      const lateLabel = market === 'TOKYO' ? 'IB' : 'Lunch-range'
      return finish({
        ...base,
        rangeStrategy,
        phase: 'ENTRY',
        canViewLiveChart: !!locked && (clockedIn || attendedToday),
        canFetchLiveBars: clockedIn || attendedToday,
        canPlaceEntry: clockedIn && ladder.lunchEligible && !hasOpen,
        canManagePosition: false,
        message: `${lateLabel} playbook unlocked — up to 2 probes @ 0.25% ${deskLocalHmsAsTraderDisplay(lnStartHms, s.tz, now)}–${lnUntil}. ${ladderHint}. After that manage-only until cash close.`,
      })
    }

    const waitingLunchRange =
      ladder.lunchEligible && t < parseTimeToSeconds(lnStartHms)
    const lunchRangeEnded =
      ladder.lunchEligible && t >= parseTimeToSeconds(lnEndHms)
    const ladderHint = formatAttemptLadderShort(ladder, locked)
    const lunchRangeLabel = deskLocalRangeAsTraderDisplay(
      lnStartHms,
      lnEndHms,
      s.tz,
      now
    )
    const lateLabel = market === 'TOKYO' ? 'IB' : 'Lunch-range'
    const prepLabel =
      market === 'TOKYO' ? 'IB prep playbook' : 'Lunch break playbook'

    return finish({
      ...base,
      rangeStrategy: null,
      phase: 'DONE',
      canViewLiveChart: afternoonWatch && !!locked && attendedToday,
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message: ladderLock
        ? `${ladderLock} ${ladderHint}`
        : waitingLunchRange
          ? `${prepLabel} — ${lateLabel} opens ${lunchRangeLabel}. ${ladderHint}`
          : lunchRangeEnded || !ladder.lunchEligible
            ? `Entry windows done for today. Manage if open until cash close — no new entries. ${ladderHint}`
            : `Manage if open until cash close — no new entries. ${ladderHint}`,
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
 * SIMULATION full-day desk gate — same 2/2/2 ladder as live (no clock-in).
 *
 *   DOW/NASDAQ: Morning (OR30) → IB → Lunch-range
 *   NIKKEI:     Morning (OR30) → US Range → Tokyo IB
 *
 * Next window unlocks when prior clock ends or attempts are exhausted.
 * Chart continues to cash close. Live-only still: clock-in / attendance / broker flatten.
 */
export function resolveSimMorningGate(input: {
  now: Date
  instrument: DeskInstrument
  hasOpenPosition?: boolean
  dayDone?: boolean
  /** @deprecated prefer morning/ib/lunch counts */
  attemptsUsed?: number
  stopHits?: number
  morningAttempts?: number
  ibAttempts?: number
  lunchAttempts?: number
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
  | 'revengeLocked'
  | 'morningAttempts'
  | 'ibAttempts'
  | 'lunchAttempts'
  | 'maxMorningAttempts'
  | 'maxIbAttempts'
  | 'maxLunchAttempts'
  | 'attemptLadderLabel'
> {
  const instrument = input.instrument
  const market = deskMarketFor(instrument)
  const s = sessionFor(instrument)
  const timeLocal = timeInTz(input.now, s.tz)
  const t = parseTimeToSeconds(timeLocal)
  const open = parseTimeToSeconds(s.marketOpen)
  const entryClose = parseTimeToSeconds(s.entryClose)
  const lunch = parseTimeToSeconds(s.lunchClose)
  const close = parseTimeToSeconds(s.marketClose)
  const hasOpen = !!input.hasOpenPosition

  const morningAttempts =
    input.morningAttempts != null
      ? Math.max(0, Math.floor(input.morningAttempts))
      : Math.max(0, Math.floor(input.attemptsUsed || 0))
  const ibAttempts = Math.max(0, Math.floor(input.ibAttempts || 0))
  const lunchAttempts = Math.max(0, Math.floor(input.lunchAttempts || 0))
  const stopHits = Math.max(0, Math.floor(input.stopHits || 0))

  const ladder = attemptLadderFromCounts({
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    morningStopHits: Math.min(stopHits, morningAttempts),
    now: input.now,
    instrument,
  })
  const rangeStrategy = resolveRangeStrategy({
    market,
    timeSec: t,
    ladder,
  })
  const dayAttempts = ladder.dayAttempts
  const ladderHint = formatAttemptLadderShort(ladder, instrument)
  const revengeLocked = ladder.revengeLocked
  const dayDone = !!input.dayDone || (ladder.dayLocked && !hasOpen)

  const ibStartHms = ibStrategyStartHms(market)
  const ibEndHms = ibStrategyEndHms(market)
  const lnStartHms = lunchRangeEntryStartHms(market)
  const lnEndHms = lunchRangeEntryEndHms(market)

  const midLabel = market === 'TOKYO' ? 'US Range' : 'IB'
  const lateLabel = market === 'TOKYO' ? 'IB' : 'Lunch-range'
  const prepAfterMid =
    market === 'TOKYO' ? 'IB prep playbook' : 'Lunch break playbook'

  const entryRange = deskLocalRangeAsTraderDisplay(
    s.marketOpen,
    s.entryClose,
    s.tz,
    input.now
  )
  const entryUntil =
    deskLocalHmsAsTraderDisplay(s.entryClose, s.tz, input.now) +
    ' ' +
    TRADER_DISPLAY_LABEL
  const ibRange = deskLocalRangeAsTraderDisplay(
    ibStartHms,
    ibEndHms,
    s.tz,
    input.now
  )
  const ibUntil =
    deskLocalHmsAsTraderDisplay(ibEndHms, s.tz, input.now) +
    ' ' +
    TRADER_DISPLAY_LABEL
  const lunchRangeLabel = deskLocalRangeAsTraderDisplay(
    lnStartHms,
    lnEndHms,
    s.tz,
    input.now
  )
  const cashCloseEt =
    deskLocalHmsAsTraderDisplay(s.marketClose, s.tz, input.now) +
    ' ' +
    TRADER_DISPLAY_LABEL

  const entryWindow: 1 | 2 | 3 | null =
    t >= open && t <= entryClose
      ? 1
      : rangeStrategy === 'us_range' ||
          (market === 'NY' && rangeStrategy === 'ib')
        ? 2
        : rangeStrategy === 'lunch_range' ||
            (market === 'TOKYO' && rangeStrategy === 'ib')
          ? 3
          : null

  const base = {
    timeEst: timeInTraderDisplay(input.now),
    lockedInstrument: instrument,
    entryWindow,
    market,
    attemptsUsed: dayAttempts,
    maxAttempts: MAX_DAY_ATTEMPTS,
    stopHits,
    maxStopHits: MAX_STOP_HITS,
    rangeStrategy,
    revengeLocked,
    morningAttempts: ladder.morningAttempts,
    ibAttempts: ladder.ibAttempts,
    lunchAttempts: ladder.lunchAttempts,
    maxMorningAttempts: ladder.maxMorningAttempts,
    maxIbAttempts: ladder.maxIbAttempts,
    maxLunchAttempts: ladder.maxLunchAttempts,
    attemptLadderLabel: ladderHint,
  }

  if (t >= close || (dayDone && t >= close)) {
    return {
      ...base,
      phase: 'DONE',
      canPlaceEntry: false,
      canManagePosition: false,
      message: 'Cash close (' + cashCloseEt + '). Sim day finished. ' + ladderHint,
    }
  }

  if (hasOpen) {
    return {
      ...base,
      phase: 'MANAGE',
      canPlaceEntry: false,
      canManagePosition: true,
      message:
        'Position open — manage only. ' +
        ladderHint +
        (ladder.dayLocked
          ? ' Day attempt cap reached.'
          : ''),
    }
  }

  if (t < open) {
    return {
      ...base,
      rangeStrategy: null,
      phase: 'RECOMMENDED',
      canPlaceEntry: false,
      canManagePosition: false,
      message:
        'Replay clock before cash open. Morning entries ' +
        entryRange +
        '. ' +
        ladderHint,
    }
  }

  // Morning OR30 entry
  if (t >= open && t < lunch) {
    const inEntryWindow = t <= entryClose
    if (inEntryWindow) {
      return {
        ...base,
        rangeStrategy: null,
        phase: 'ENTRY',
        canPlaceEntry: ladder.morningEligible,
        canManagePosition: false,
        message: ladder.morningEligible
          ? 'Morning (OR30) playbook ' +
            entryRange +
            ' — ' +
            ladderHint +
            '. Click a level (until ' +
            entryUntil +
            ').'
          : 'Morning attempts full. ' + ladderHint,
      }
    }

    if (rangeStrategy === 'ib' || rangeStrategy === 'us_range') {
      return {
        ...base,
        phase: 'ENTRY',
        canPlaceEntry: ladder.ibEligible,
        canManagePosition: false,
        message:
          midLabel +
          ' playbook unlocked — up to 2 probes @ 0.25% ' +
          ibRange +
          '. ' +
          ladderHint +
          '. After ' +
          ibUntil +
          ' → ' +
          prepAfterMid +
          '.',
      }
    }

    const waitingMid = ladder.ibEligible && t < parseTimeToSeconds(ibStartHms)
    const midEnded = t >= parseTimeToSeconds(ibEndHms) && t < lunch
    return {
      ...base,
      rangeStrategy: null,
      phase: 'FLAT',
      canPlaceEntry: false,
      canManagePosition: false,
      message: waitingMid
        ? 'Morning entry closed (' +
          entryUntil +
          '). ' +
          midLabel +
          ' playbook ' +
          ibRange +
          ' (up to 2 probes). ' +
          ladderHint
        : midEnded
          ? midLabel +
            ' entry closed (' +
            ibUntil +
            '). ' +
            prepAfterMid +
            ' — ' +
            lateLabel +
            ' unlocks ' +
            lunchRangeLabel +
            '. ' +
            ladderHint
          : 'Morning entry closed (' +
            entryUntil +
            '). Next is ' +
            midLabel +
            ' ' +
            ibRange +
            '. ' +
            ladderHint,
    }
  }

  // Afternoon: lunch → cash close
  if (
    rangeStrategy === 'lunch_range' ||
    (market === 'TOKYO' && rangeStrategy === 'ib')
  ) {
    const lnUntil =
      deskLocalHmsAsTraderDisplay(lnEndHms, s.tz, input.now) +
      ' ' +
      TRADER_DISPLAY_LABEL
    return {
      ...base,
      phase: 'ENTRY',
      canPlaceEntry: ladder.lunchEligible,
      canManagePosition: false,
      message:
        lateLabel +
        ' playbook unlocked — up to 2 probes @ 0.25% ' +
        deskLocalHmsAsTraderDisplay(lnStartHms, s.tz, input.now) +
        '–' +
        lnUntil +
        '. ' +
        ladderHint +
        '.',
    }
  }

  const waitingLunchRange =
    ladder.lunchEligible && t < parseTimeToSeconds(lnStartHms)
  const lunchRangeEnded =
    ladder.lunchEligible && t >= parseTimeToSeconds(lnEndHms)

  return {
    ...base,
    rangeStrategy: null,
    phase: t >= close ? 'DONE' : 'FLAT',
    canPlaceEntry: false,
    canManagePosition: false,
    message: ladder.dayLocked
      ? 'Day attempt cap reached. Chart continues until cash close. ' + ladderHint
      : waitingLunchRange
        ? prepAfterMid +
          ' — ' +
          lateLabel +
          ' unlocks ' +
          lunchRangeLabel +
          '. ' +
          ladderHint
        : lunchRangeEnded || !ladder.lunchEligible
          ? lateLabel +
            ' entry closed. Manage-only until cash close (' +
            cashCloseEt +
            '). ' +
            ladderHint
          : 'Afternoon watch — ' +
            lateLabel +
            ' ' +
            lunchRangeLabel +
            ' if still eligible. ' +
            ladderHint,
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
    let message: string
    if (!gate.clockedIn) {
      message = gate.canClockIn
        ? 'Clocked out — click “Today I trade” to resume entries.'
        : 'Clocked out — no new entries. Manage only if you have an open book.'
    } else if (gate.dayLocked) {
      message = 'Day attempt cap reached — trading switched off. No new entries.'
    } else if (gate.phase === 'MANAGE') {
      message = 'Position open — manage only, no new entries.'
    } else if (gate.phase === 'FLAT') {
      message =
        'Entry window closed — wait for IB or lunch-range unlock (if still eligible).'
    } else if (gate.phase === 'DONE') {
      message = 'Entry windows done for today — manage if open, no new entries.'
    } else if (gate.phase === 'CLOSED') {
      message = 'Cash closed — desk is offline until the next session.'
    } else {
      message = gate.message || `Cannot place entry in phase ${gate.phase}`
    }
    return { ok: false, status: 403, message }
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
