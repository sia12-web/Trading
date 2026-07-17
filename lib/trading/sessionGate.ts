/**
 * Trading desk session state — NY (DOW/NASDAQ) and Tokyo (NIKKEI).
 *
 * LIVE only:
 *   Morning bars: NY 09:30–11:30 ET / Tokyo 09:00–11:30 JST
 *   After lunch: live chart freezes. Afternoon review updates memory
 *   in the background — never shown as a tradable live session.
 *
 * SIMULATION: morning session only (open → lunch). No afternoon feature,
 * no background memory pass — use resolveSimMorningGate(), not the live gate.
 *
 * Prep (AI levels): analyzeStart → lunchClose.
 * Entries: marketOpen → entryClose (first ~45 min).
 */

import { getESTTimeString, parseTimeToSeconds } from '@/lib/utils/timeUtils'
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
}

/**
 * Live bars allowed only during that instrument's morning session
 * (open → lunch). After lunch: freeze — afternoon memory updates are background-only.
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
      reason:
        'Morning session closed — live bars frozen at lunch. Afternoon review runs in the background.',
    }
  }
  return { open: true, reason: 'Morning session live' }
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
  }

  // Live chart only when we have something to trade AND morning bars are live
  const canView =
    !!locked &&
    bars.open &&
    (viewing == null || viewing === locked)

  if (!isWeekdayInTz(now, s.tz) || t < analyze || t >= lunch) {
    const afterLunch = isWeekdayInTz(now, s.tz) && t >= lunch
    return {
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
            ? 'Pre-session. Tokyo desk opens 8:45 JST.'
            : 'Pre-session. Live desk opens at 9:15 ET for analysis.'
          : 'Session closed. Use Simulation for replay.',
    }
  }

  if (dayDone) {
    return {
      ...base,
      phase: 'DONE',
      canViewLiveChart: canView,
      canFetchLiveBars: bars.open && !!locked,
      canPlaceEntry: false,
      canManagePosition: false,
      message: 'Session done for today (stop limit or AI exit). Trading locked.',
    }
  }

  if (!locked) {
    return {
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
    }
  }

  if (hasOpen) {
    const pastLunch = t >= lunch
    return {
      ...base,
      phase: pastLunch ? 'DONE' : 'MANAGE',
      canViewLiveChart: !pastLunch && locked === (viewing ?? locked),
      canFetchLiveBars: !pastLunch,
      canPlaceEntry: false,
      canManagePosition: !pastLunch,
      message: pastLunch
        ? 'Lunch flatten — morning session over. Live chart frozen.'
        : 'Position open. Manage only — no new entries.',
    }
  }

  if (t >= analyze && t < open) {
    return {
      ...base,
      phase: 'RECOMMENDED',
      canViewLiveChart: false, // bars start at open
      canFetchLiveBars: false,
      canPlaceEntry: false,
      canManagePosition: false,
      message:
        market === 'TOKYO'
          ? `Trade ${locked} today. Tokyo morning entries ${s.marketOpen.slice(0, 5)}–${s.lunchClose.slice(0, 5)} JST.`
          : `Trade ${locked} today. Morning entries ${s.marketOpen.slice(0, 5)}–${s.lunchClose.slice(0, 5)} ET.`,
    }
  }

  if (t >= open && t < lunch) {
    const inEntryWindow = t <= entryClose
    return {
      ...base,
      phase: inEntryWindow ? 'ENTRY' : 'FLAT',
      canViewLiveChart: canView,
      canFetchLiveBars: true,
      // Entries ONLY until entryClose (10:15 ET / 09:45 JST). After that: no new levels/orders.
      canPlaceEntry: inEntryWindow,
      canManagePosition: false,
      message: inEntryWindow
        ? `Entry window — click a ${locked} level to place a working limit (until ${s.entryClose.slice(0, 5)}).`
        : `Entry window closed (${s.entryClose.slice(0, 5)}). Levels cleared — manage an open position if you have one; otherwise wait for lunch. AI still updates level memory in the background.`,
    }
  }

  // After lunch — closed (afternoon is background memory only)
  return {
    ...base,
    phase: 'DONE',
    canViewLiveChart: false,
    canFetchLiveBars: false,
    canPlaceEntry: false,
    canManagePosition: false,
    message:
      'Morning session closed at lunch. Live chart frozen — afternoon review runs in the background for memory only.',
  }
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

/**
 * Drop afternoon cash-session bars from a candle series.
 * Keeps overnight / pre-open + morning session; removes lunch→close for that market.
 * Used by the live candles API so the chart never shows post-lunch price action.
 */
export function clipAfternoonBars<T extends { time: number }>(
  candles: T[],
  instrument: string | null | undefined
): T[] {
  const s = sessionFor(instrument)
  const lunch = parseTimeToSeconds(s.lunchClose)
  const close = parseTimeToSeconds(s.marketClose)
  return candles.filter((c) => {
    const sec = parseTimeToSeconds(timeInTz(new Date(c.time * 1000), s.tz))
    // Afternoon RTH only — overnight and morning stay
    if (sec >= lunch && sec < close) return false
    return true
  })
}
