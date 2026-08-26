/**
 * Tradeify Growth $50k risk overlay (Slice 1).
 * Pure rules — does not change OANDA 2% → 1% → 0.5%.
 *
 * Session: 18:00 ET → flatten ~16:59 ET next calendar day.
 * Nikkei night and NY morning share one session_key.
 */

import { zonedDateTimeToUnix } from '@/lib/utils/dateUtils'

export const TRADEIFY_PROFILE_ID = 'tradeify_growth_50k' as const

export const TRADEIFY_STARTING_BALANCE = 50_000
export const TRADEIFY_PROFIT_TARGET = 3_000
export const TRADEIFY_DLL_DOLLARS = 1_250
export const TRADEIFY_TRAILING_DD_DOLLARS = 2_000
export const TRADEIFY_BREACH_FLOOR = TRADEIFY_STARTING_BALANCE - TRADEIFY_TRAILING_DD_DOLLARS // 48_000
export const TRADEIFY_FUNDED_LOCK_BALANCE = 52_100

/** Fill #1 / #2 / #3 planned stop $ (before shrink). */
export const TRADEIFY_RISK_FIRST_DOLLARS = 400
export const TRADEIFY_RISK_SECOND_DOLLARS = 250
export const TRADEIFY_RISK_THIRD_DOLLARS = 150

/** Refuse rather than place a token-size stop. */
export const TRADEIFY_MIN_RISK_DOLLARS = 50

/** Tradeify session rolls at 18:00 America/New_York. */
export const TRADEIFY_SESSION_ROLL_ET = '18:00:00'
/** Mandatory flatten (Growth) — show as 16:59 Montreal when EDT. */
export const TRADEIFY_FLATTEN_ET = '16:59:00'

export const TRADEIFY_GREEN_DAY_LOCK_DOLLARS = 700
export const TRADEIFY_MAX_STOP_OUTS = 2
export const TRADEIFY_SLIPPAGE_BUFFER_DOLLARS = 75
export const TRADEIFY_COMMISSION_PER_FILL_EST = 20
/** CME equity early-close days — flatten from 12:59 ET (Tradeify holiday rule). */
export const TRADEIFY_EARLY_CLOSE_ET_YMD = new Set([
  '2025-07-03',
  '2025-11-28',
  '2025-12-24',
  '2026-07-02',
  '2026-11-27',
  '2026-12-24',
  '2027-07-02',
  '2027-11-26',
  '2027-12-24',
])

const ET = 'America/New_York'

export type TradeifyRefuseReason =
  | 'ok'
  | 'session_full'
  | 'day_locked_stops'
  | 'day_locked_green'
  | 'dll_exhausted'
  | 'floor_exhausted'
  | 'stop_exceeds_dll'
  | 'stop_exceeds_floor'
  | 'risk_too_small'
  | 'must_flatten'
  | 'hedge_conflict'
  | 'news_lock'

export type TradeifyPlaceDecision = {
  allowed: boolean
  profileId: typeof TRADEIFY_PROFILE_ID
  sessionKey: string
  fillsUsed: number
  stepDollars: number
  riskDollars: number
  leftoverDll: number
  floorRoom: number
  floorLevel: number
  refuseReason: TradeifyRefuseReason
  refuseMessage: string
}

export type TradeifyPlaceInput = {
  now?: Date
  /** Filled trades already counted on this Tradeify session (working does not count). */
  fillsUsed?: number | null
  /** Realized + unrealized day P&L for this Tradeify session (negative = loss). */
  dailyPnl?: number | null
  /** Current account equity (defaults to starting 50k + dailyPnl). */
  equity?: number | null
  /**
   * Highest *end-of-day* balance this eval has closed at.
   * Floor = max(48_000, peakEod − 2_000). Eval never locks.
   */
  peakEodBalance?: number | null
  stopOutsToday?: number | null
  greenDayLocked?: boolean | null
  /** Open stop $ (or worse unrealized) still hanging on this session. */
  openReserved?: number | null
  hedgeBlocked?: boolean | null
  newsBlocked?: boolean | null
}

function etYmdAndHms(now: Date): { ymd: string; hms: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const year = parts.find((p) => p.type === 'year')?.value || '2024'
  const month = parts.find((p) => p.type === 'month')?.value || '01'
  const day = parts.find((p) => p.type === 'day')?.value || '01'
  let hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10)
  if (hour === 24) hour = 0
  const minute = parts.find((p) => p.type === 'minute')?.value || '00'
  const second = parts.find((p) => p.type === 'second')?.value || '00'
  return {
    ymd: `${year}-${month}-${day}`,
    hms: `${String(hour).padStart(2, '0')}:${minute}:${second}`,
    hour,
  }
}

function addCalendarDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const cursor = new Date(Date.UTC(y!, m! - 1, d!))
  cursor.setUTCDate(cursor.getUTCDate() + delta)
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`
}

/**
 * Shared Tradeify session id: the ET calendar date on which the 18:00 roll occurred.
 * Mon 21:00 ET (Nikkei) and Tue 11:30 ET (NASDAQ) → same key (Monday).
 */
export function tradeifySessionKey(now: Date = new Date()): string {
  const { ymd, hour } = etYmdAndHms(now)
  if (hour >= 18) return ymd
  return addCalendarDaysYmd(ymd, -1)
}

/** ET hour+minute as minutes since midnight. */
export function tradeifyEtMinutes(now: Date = new Date()): number {
  const { hour, hms } = etYmdAndHms(now)
  const minute = parseInt(hms.slice(3, 5), 10) || 0
  return hour * 60 + minute
}

export function tradeifyIsEarlyCloseDay(now: Date = new Date()): boolean {
  return TRADEIFY_EARLY_CLOSE_ET_YMD.has(etYmdAndHms(now).ymd)
}

/** Regular 16:59 ET, or 12:59 ET on CME early-close days, until 18:00 roll. */
export function tradeifyMustFlatten(now: Date = new Date()): boolean {
  const m = tradeifyEtMinutes(now)
  if (m >= 18 * 60) return false
  const cut = tradeifyIsEarlyCloseDay(now) ? 12 * 60 + 59 : 16 * 60 + 59
  return m >= cut
}

export type TradeifyDeskStatus = 'can_trade' | 'day_locked' | 'must_flatten'

export function tradeifyDeskStatus(
  decision: TradeifyPlaceDecision,
  now: Date = new Date()
): TradeifyDeskStatus {
  if (tradeifyMustFlatten(now)) return 'must_flatten'
  if (!decision.allowed) return 'day_locked'
  return 'can_trade'
}

export function sameTradeifySession(a: Date, b: Date): boolean {
  return tradeifySessionKey(a) === tradeifySessionKey(b)
}

/** Inclusive start / exclusive end ISO for journal queries. */
export function tradeifySessionWindow(now: Date = new Date()): {
  sessionKey: string
  startIso: string
  endIso: string
} {
  const sessionKey = tradeifySessionKey(now)
  const next = addCalendarDaysYmd(sessionKey, 1)
  const startUnix = zonedDateTimeToUnix(sessionKey, 18, 0, ET)
  const endUnix = zonedDateTimeToUnix(next, 18, 0, ET)
  return {
    sessionKey,
    startIso: new Date(startUnix * 1000).toISOString(),
    endIso: new Date(endUnix * 1000).toISOString(),
  }
}

export function tradeifyRiskStepDollars(sessionFillsUsed?: number | null): number {
  const used = Math.max(0, Math.floor(Number(sessionFillsUsed) || 0))
  if (used <= 0) return TRADEIFY_RISK_FIRST_DOLLARS
  if (used === 1) return TRADEIFY_RISK_SECOND_DOLLARS
  return TRADEIFY_RISK_THIRD_DOLLARS
}

export function formatTradeifyRiskChip(sessionFillsUsed?: number | null): string {
  const used = Math.max(0, Math.floor(Number(sessionFillsUsed) || 0))
  const step = tradeifyRiskStepDollars(used)
  const fillNum = Math.min(used + 1, 3)
  return `Tradeify $${step} (fill ${fillNum}/3)`
}

/** Dollars already eaten from the $1,250 DLL (wins do not refill it). */
export function tradeifyDllUsed(dailyPnl?: number | null): number {
  const pnl = Number(dailyPnl)
  if (!Number.isFinite(pnl) || pnl >= 0) return 0
  return Math.min(TRADEIFY_DLL_DOLLARS, Math.round(-pnl * 100) / 100)
}

export function tradeifyLeftoverDll(dailyPnl?: number | null): number {
  return Math.max(0, Math.round((TRADEIFY_DLL_DOLLARS - tradeifyDllUsed(dailyPnl)) * 100) / 100)
}

export function tradeifyFloorLevel(peakEodBalance?: number | null): number {
  const peak = Number(peakEodBalance)
  const high = Number.isFinite(peak) && peak > 0 ? peak : TRADEIFY_STARTING_BALANCE
  return Math.max(TRADEIFY_BREACH_FLOOR, Math.round((high - TRADEIFY_TRAILING_DD_DOLLARS) * 100) / 100)
}

export function tradeifyFloorRoom(args: {
  equity?: number | null
  dailyPnl?: number | null
  peakEodBalance?: number | null
}): number {
  const pnl = Number(args.dailyPnl)
  const eqRaw = Number(args.equity)
  const equity =
    Number.isFinite(eqRaw) && eqRaw > 0
      ? eqRaw
      : TRADEIFY_STARTING_BALANCE + (Number.isFinite(pnl) ? pnl : 0)
  const floor = tradeifyFloorLevel(args.peakEodBalance)
  return Math.max(0, Math.round((equity - floor) * 100) / 100)
}

export function oandaCashRiskDollars(fillsUsed?: number | null, account = TRADEIFY_STARTING_BALANCE): number {
  const used = Math.max(0, Math.floor(Number(fillsUsed) || 0))
  const pct = used <= 0 ? 0.02 : used === 1 ? 0.01 : 0.005
  return Math.round(account * pct * 100) / 100
}

function refuseMessage(reason: TradeifyRefuseReason, extra?: { leftover?: number; floor?: number; risk?: number }): string {
  switch (reason) {
    case 'ok':
      return ''
    case 'session_full':
      return 'Tradeify session 3/3 — no new entries.'
    case 'day_locked_stops':
      return 'Tradeify day locked — 2 stop-outs. Manage only until the next 18:00 ET session.'
    case 'day_locked_green':
      return `Tradeify day locked — green-day cap ($${TRADEIFY_GREEN_DAY_LOCK_DOLLARS}). Manage only.`
    case 'dll_exhausted':
      return `Tradeify daily loss used ($${TRADEIFY_DLL_DOLLARS}). No new entries today.`
    case 'floor_exhausted':
      return 'Tradeify trailing floor has no room left — no new entries.'
    case 'stop_exceeds_dll':
      return `Stop $${extra?.risk} would breach leftover daily loss ($${extra?.leftover}).`
    case 'stop_exceeds_floor':
      return `Stop $${extra?.risk} would tag the trailing floor (room $${extra?.floor}).`
    case 'risk_too_small':
      return `Leftover room is under $${TRADEIFY_MIN_RISK_DOLLARS} — sit out.`
    case 'must_flatten':
      return 'Tradeify flatten — close Tradovate AND cancel working orders. Regular 16:59 ET / holiday 12:59 ET. No new holds until 18:00 ET.'
    case 'hedge_conflict':
      return 'Tradeify hedge — an open index is the other way. Flatten that book before the opposite ticket (YM/NQ/NKD group).'
    case 'news_lock':
      return 'Tradeify news lock — no new entries ±5 minutes around CPI / FOMC / NFP.'
    default:
      return 'Tradeify gate refused this entry.'
  }
}

/**
 * Decide planned stop $ and whether a new entry is legal.
 * Shrinks the step to leftover DLL / floor room; never grows above the step.
 */
export function tradeifyPlaceHaircut(fillsUsed?: number | null): number {
  const used = Math.max(0, Math.floor(Number(fillsUsed) || 0))
  return TRADEIFY_SLIPPAGE_BUFFER_DOLLARS + used * TRADEIFY_COMMISSION_PER_FILL_EST
}

export function resolveTradeifyPlace(input: TradeifyPlaceInput = {}): TradeifyPlaceDecision {
  const now = input.now ?? new Date()
  const fillsUsed = Math.max(0, Math.floor(Number(input.fillsUsed) || 0))
  const sessionKey = tradeifySessionKey(now)
  const reserved = Math.max(0, Number(input.openReserved) || 0)
  const leftoverDll = Math.max(0, Math.round((tradeifyLeftoverDll(input.dailyPnl) - reserved) * 100) / 100)
  const floorRoom = Math.max(
    0,
    Math.round(
      (tradeifyFloorRoom({
        equity: input.equity,
        dailyPnl: input.dailyPnl,
        peakEodBalance: input.peakEodBalance,
      }) -
        reserved) *
      100
    ) / 100
  )
  const floorLevel = tradeifyFloorLevel(input.peakEodBalance)
  const stepDollars = tradeifyRiskStepDollars(fillsUsed)
  const stopOuts = Math.max(0, Math.floor(Number(input.stopOutsToday) || 0))
  const dailyPnl = Number(input.dailyPnl)
  const greenLocked =
    input.greenDayLocked === true ||
    (Number.isFinite(dailyPnl) && dailyPnl >= TRADEIFY_GREEN_DAY_LOCK_DOLLARS)
  const haircut = tradeifyPlaceHaircut(fillsUsed)
  const placeableDll = Math.max(0, Math.round((leftoverDll - haircut) * 100) / 100)
  const placeableFloor = Math.max(0, Math.round((floorRoom - haircut) * 100) / 100)

  const base = {
    profileId: TRADEIFY_PROFILE_ID,
    sessionKey,
    fillsUsed,
    stepDollars,
    leftoverDll,
    floorRoom,
    floorLevel,
  } as const

  const deny = (reason: TradeifyRefuseReason, riskDollars = 0): TradeifyPlaceDecision => ({
    ...base,
    allowed: false,
    riskDollars,
    refuseReason: reason,
    refuseMessage: refuseMessage(reason, { leftover: leftoverDll, floor: floorRoom, risk: riskDollars || stepDollars }),
  })

  if (tradeifyMustFlatten(now)) return deny('must_flatten')
  if (input.newsBlocked) return deny('news_lock')
  if (input.hedgeBlocked) return deny('hedge_conflict')
  if (stopOuts >= TRADEIFY_MAX_STOP_OUTS) return deny('day_locked_stops')
  if (greenLocked) return deny('day_locked_green')
  if (leftoverDll < TRADEIFY_MIN_RISK_DOLLARS) return deny('dll_exhausted')
  if (floorRoom < TRADEIFY_MIN_RISK_DOLLARS) return deny('floor_exhausted')

  const riskDollars = Math.min(stepDollars, placeableDll, placeableFloor)
  if (riskDollars < TRADEIFY_MIN_RISK_DOLLARS) return deny('risk_too_small')
  if (riskDollars > leftoverDll) return deny('stop_exceeds_dll', riskDollars)
  if (riskDollars > floorRoom) return deny('stop_exceeds_floor', riskDollars)

  return {
    ...base,
    allowed: true,
    riskDollars,
    refuseReason: 'ok',
    refuseMessage: '',
  }
}

/** True if the OANDA cash % ladder would breach Growth $50k DLL or floor on this state. */
/** Reasons that block new entries for the rest of this Tradeify session. */
export const TRADEIFY_DAY_LOCK_REASONS: readonly TradeifyRefuseReason[] = [
  'day_locked_stops',
  'day_locked_green',
  'session_full',
  'dll_exhausted',
  'floor_exhausted',
]

export function tradeifyBlocksNewEntries(decision: TradeifyPlaceDecision): boolean {
  return !decision.allowed
}

export function isTradeifySessionDayLock(reason: TradeifyRefuseReason): boolean {
  return (
    reason === 'day_locked_stops' ||
    reason === 'day_locked_green' ||
    reason === 'session_full'
  )
}

/** Keep-open / Nikkei 02:00 ride must not survive the 16:59 ET flatten window. */
export function tradeifyFlattenOverridesKeepOpen(now: Date = new Date()): boolean {
  return tradeifyMustFlatten(now)
}

export function formatTradeifyBannerChip(args: {
  leftoverDll: number
  floorRoom: number
  status: TradeifyDeskStatus
  refuseReason?: string | null
  flattenMontreal?: string | null
}): { label: string; title: string; tone: 'ok' | 'lock' | 'flatten' } {
  const dll = `DLL $${Math.round(Number(args.leftoverDll) || 0)}`
  const floor = `floor $${Math.round(Number(args.floorRoom) || 0)}`
  const flatten = args.flattenMontreal || '16:59 Montreal'
  if (args.status === 'must_flatten') {
    return {
      label: `FLATTEN · ${dll} · ${floor}`,
      title: `Tradeify flatten now (${flatten}). No new holds. Keep-open / Nikkei 02:00 ride does not apply.`,
      tone: 'flatten',
    }
  }
  if (args.status === 'day_locked') {
    const why =
      args.refuseReason === 'day_locked_stops'
        ? '2 stop-outs'
        : args.refuseReason === 'day_locked_green'
          ? 'green-day cap'
          : args.refuseReason === 'session_full'
            ? '3/3 fills'
            : 'no new entries'
    return {
      label: `LOCKED · ${dll} · ${floor}`,
      title: `Tradeify day locked (${why}). ${dll} leftover · ${floor} room. Flatten ${flatten}.`,
      tone: 'lock',
    }
  }
  return {
    label: `${dll} · ${floor}`,
    title: `Tradeify Growth $50k · ${dll} leftover of $${TRADEIFY_DLL_DOLLARS} · ${floor} to trailing floor. Flatten ${flatten}.`,
    tone: 'ok',
  }
}

export function oandaLadderWouldBreachTradeify(args: {
  fillsUsed?: number | null
  dailyPnl?: number | null
  equity?: number | null
  peakEodBalance?: number | null
}): boolean {
  const planned = oandaCashRiskDollars(args.fillsUsed)
  const leftoverDll = tradeifyLeftoverDll(args.dailyPnl)
  const floorRoom = tradeifyFloorRoom(args)
  return planned > leftoverDll || planned > floorRoom
}
