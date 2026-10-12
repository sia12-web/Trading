/**
 * Personal Futures Desk Risk & Position Limits.
 * Clean personal risk model — no prop firm eval rules, no trailing drawdown ratchets.
 *
 * Session: 18:00 ET roll.
 * Nikkei night and NY morning share one session_key.
 */

import { zonedDateTimeToUnix } from '@/lib/utils/dateUtils'

export const PERSONAL_PROFILE_ID = 'personal_futures' as const
export const TRADEIFY_PROFILE_ID = PERSONAL_PROFILE_ID

export const PERSONAL_STARTING_BALANCE = 50_000
export const TRADEIFY_STARTING_BALANCE = PERSONAL_STARTING_BALANCE
export const TRADEIFY_PROFIT_TARGET = 3_000
export const PERSONAL_DLL_DOLLARS = 1_250
export const TRADEIFY_DLL_DOLLARS = PERSONAL_DLL_DOLLARS
export const TRADEIFY_TRAILING_DD_DOLLARS = 2_000
export const TRADEIFY_BREACH_FLOOR = 48_000
export const TRADEIFY_FUNDED_LOCK_BALANCE = 52_100

/** Fill #1 / #2 / #3 planned stop $ ($400 -> $250 -> $150). */
export const PERSONAL_RISK_FIRST_DOLLARS = 400
export const TRADEIFY_RISK_FIRST_DOLLARS = PERSONAL_RISK_FIRST_DOLLARS
export const PERSONAL_RISK_SECOND_DOLLARS = 250
export const TRADEIFY_RISK_SECOND_DOLLARS = PERSONAL_RISK_SECOND_DOLLARS
export const PERSONAL_RISK_THIRD_DOLLARS = 150
export const TRADEIFY_RISK_THIRD_DOLLARS = PERSONAL_RISK_THIRD_DOLLARS
export const PERSONAL_MAX_DAILY_FILLS = 3
export const TRADEIFY_MAX_DAILY_FILLS = PERSONAL_MAX_DAILY_FILLS

/** Refuse rather than place a token-size stop. */
export const PERSONAL_MIN_RISK_DOLLARS = 50
export const TRADEIFY_MIN_RISK_DOLLARS = PERSONAL_MIN_RISK_DOLLARS

/** Session rolls at 18:00 America/New_York. */
export const PERSONAL_SESSION_ROLL_ET = '18:00:00'
export const TRADEIFY_SESSION_ROLL_ET = PERSONAL_SESSION_ROLL_ET
export const PERSONAL_FLATTEN_ET = '16:59:00'
export const TRADEIFY_FLATTEN_ET = PERSONAL_FLATTEN_ET

export const TRADEIFY_GREEN_DAY_LOCK_DOLLARS = 700
export const TRADEIFY_MAX_STOP_OUTS = 2
export const TRADEIFY_SLIPPAGE_BUFFER_DOLLARS = 75
export const TRADEIFY_COMMISSION_PER_FILL_EST = 20

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

export type PersonalPlaceDecision = {
  allowed: boolean
  profileId: typeof PERSONAL_PROFILE_ID
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

export type TradeifyPlaceDecision = PersonalPlaceDecision

export type TradeifyPlaceInput = {
  now?: Date
  fillsUsed?: number | null
  dailyPnl?: number | null
  equity?: number | null
  peakEodBalance?: number | null
  stopOutsToday?: number | null
  greenDayLocked?: boolean | null
  openReserved?: number | null
  hedgeBlocked?: boolean | null
  newsBlocked?: boolean | null
}

export type PersonalPlaceInput = TradeifyPlaceInput

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

export function personalSessionKey(now: Date = new Date()): string {
  const { ymd, hour } = etYmdAndHms(now)
  if (hour >= 18) return ymd
  return addCalendarDaysYmd(ymd, -1)
}
export const tradeifySessionKey = personalSessionKey

export function tradeifyEtMinutes(now: Date = new Date()): number {
  const { hour, hms } = etYmdAndHms(now)
  const minute = parseInt(hms.slice(3, 5), 10) || 0
  return hour * 60 + minute
}

export function tradeifyIsEarlyCloseDay(now: Date = new Date()): boolean {
  return TRADEIFY_EARLY_CLOSE_ET_YMD.has(etYmdAndHms(now).ymd)
}

/** Personal futures do not have forced overnight liquidations. */
export function personalMustFlatten(_now: Date = new Date()): boolean {
  return false
}
export const tradeifyMustFlatten = personalMustFlatten

export type TradeifyDeskStatus = 'can_trade' | 'day_locked' | 'must_flatten'

export function tradeifyDeskStatus(
  decision: TradeifyPlaceDecision,
  _now: Date = new Date()
): TradeifyDeskStatus {
  if (!decision.allowed) return 'day_locked'
  return 'can_trade'
}

export function sameTradeifySession(a: Date, b: Date): boolean {
  return personalSessionKey(a) === personalSessionKey(b)
}

export function personalSessionWindow(now: Date = new Date()): {
  sessionKey: string
  startIso: string
  endIso: string
} {
  const sessionKey = personalSessionKey(now)
  const next = addCalendarDaysYmd(sessionKey, 1)
  const startUnix = zonedDateTimeToUnix(sessionKey, 18, 0, ET)
  const endUnix = zonedDateTimeToUnix(next, 18, 0, ET)
  return {
    sessionKey,
    startIso: new Date(startUnix * 1000).toISOString(),
    endIso: new Date(endUnix * 1000).toISOString(),
  }
}
export const tradeifySessionWindow = personalSessionWindow

export function personalRiskStepDollars(sessionFillsUsed?: number | null): number {
  const used = Math.max(0, Math.floor(Number(sessionFillsUsed) || 0))
  if (used <= 0) return PERSONAL_RISK_FIRST_DOLLARS
  if (used === 1) return PERSONAL_RISK_SECOND_DOLLARS
  return PERSONAL_RISK_THIRD_DOLLARS
}
export const tradeifyRiskStepDollars = personalRiskStepDollars

export function formatTradeifyRiskChip(sessionFillsUsed?: number | null): string {
  const used = Math.max(0, Math.floor(Number(sessionFillsUsed) || 0))
  const step = personalRiskStepDollars(used)
  const fillNum = Math.min(used + 1, 3)
  return `Personal $${step} (fill ${fillNum}/3)`
}

export function personalDllUsed(dailyPnl?: number | null): number {
  const pnl = Number(dailyPnl)
  if (!Number.isFinite(pnl) || pnl >= 0) return 0
  return Math.min(PERSONAL_DLL_DOLLARS, Math.round(-pnl * 100) / 100)
}
export const tradeifyDllUsed = personalDllUsed

export function personalLeftoverDll(dailyPnl?: number | null): number {
  return Math.max(0, Math.round((PERSONAL_DLL_DOLLARS - personalDllUsed(dailyPnl)) * 100) / 100)
}
export const tradeifyLeftoverDll = personalLeftoverDll

export function personalFloorLevel(_peakEodBalance?: number | null): number {
  return 0
}
export const tradeifyFloorLevel = personalFloorLevel

export function personalFloorRoom(args: {
  equity?: number | null
  dailyPnl?: number | null
  peakEodBalance?: number | null
}): number {
  const pnl = Number(args.dailyPnl)
  const eqRaw = Number(args.equity)
  const equity =
    Number.isFinite(eqRaw) && eqRaw > 0
      ? eqRaw
      : PERSONAL_STARTING_BALANCE + (Number.isFinite(pnl) ? pnl : 0)
  return Math.max(0, Math.round(equity * 100) / 100)
}
export const tradeifyFloorRoom = personalFloorRoom

export function oandaCashRiskDollars(fillsUsed?: number | null, account = PERSONAL_STARTING_BALANCE): number {
  const used = Math.max(0, Math.floor(Number(fillsUsed) || 0))
  const pct = used <= 0 ? 0.02 : used === 1 ? 0.01 : 0.005
  return Math.round(account * pct * 100) / 100
}

function refuseMessage(reason: TradeifyRefuseReason, extra?: { leftover?: number; risk?: number }): string {
  switch (reason) {
    case 'ok':
      return ''
    case 'session_full':
      return 'Personal desk session 3/3 — no new entries.'
    case 'dll_exhausted':
      return `Desk daily loss limit reached ($${PERSONAL_DLL_DOLLARS}). No new entries today.`
    case 'stop_exceeds_dll':
      return `Stop $${extra?.risk} would exceed leftover daily loss budget ($${extra?.leftover}).`
    case 'risk_too_small':
      return `Remaining risk budget is under $${PERSONAL_MIN_RISK_DOLLARS} — sit out.`
    case 'hedge_conflict':
      return 'Hedge conflict — an open index is in the opposing direction.'
    case 'news_lock':
      return 'Desk news caution — high-impact catalyst window.'
    default:
      return 'Risk limits reached.'
  }
}

export function personalPlaceHaircut(fillsUsed?: number | null): number {
  const used = Math.max(0, Math.floor(Number(fillsUsed) || 0))
  return TRADEIFY_SLIPPAGE_BUFFER_DOLLARS + used * TRADEIFY_COMMISSION_PER_FILL_EST
}
export const tradeifyPlaceHaircut = personalPlaceHaircut

export function resolvePersonalPlace(input: PersonalPlaceInput = {}): PersonalPlaceDecision {
  const now = input.now ?? new Date()
  const fillsUsed = Math.max(0, Math.floor(Number(input.fillsUsed) || 0))
  const sessionKey = personalSessionKey(now)
  const reserved = Math.max(0, Number(input.openReserved) || 0)
  const leftoverDll = Math.max(0, Math.round((personalLeftoverDll(input.dailyPnl) - reserved) * 100) / 100)
  const floorRoom = personalFloorRoom({ equity: input.equity, dailyPnl: input.dailyPnl })
  const floorLevel = 0
  const stepDollars = personalRiskStepDollars(fillsUsed)
  const haircut = personalPlaceHaircut(fillsUsed)
  const placeableDll = Math.max(0, Math.round((leftoverDll - haircut) * 100) / 100)

  const base = {
    profileId: PERSONAL_PROFILE_ID,
    sessionKey,
    fillsUsed,
    stepDollars,
    leftoverDll,
    floorRoom,
    floorLevel,
  } as const

  const deny = (reason: TradeifyRefuseReason, riskDollars = 0): PersonalPlaceDecision => ({
    ...base,
    allowed: false,
    riskDollars,
    refuseReason: reason,
    refuseMessage: refuseMessage(reason, { leftover: leftoverDll, risk: riskDollars || stepDollars }),
  })

  if (input.newsBlocked) return deny('news_lock')
  if (input.hedgeBlocked) return deny('hedge_conflict')
  if (fillsUsed >= PERSONAL_MAX_DAILY_FILLS) return deny('session_full')
  if (leftoverDll < PERSONAL_MIN_RISK_DOLLARS) return deny('dll_exhausted')

  const riskDollars = Math.min(stepDollars, placeableDll)
  if (riskDollars < PERSONAL_MIN_RISK_DOLLARS) return deny('risk_too_small')
  if (riskDollars > leftoverDll) return deny('stop_exceeds_dll', riskDollars)

  return {
    ...base,
    allowed: true,
    riskDollars,
    refuseReason: 'ok',
    refuseMessage: '',
  }
}
export const resolveTradeifyPlace = resolvePersonalPlace

export const TRADEIFY_DAY_LOCK_REASONS: readonly TradeifyRefuseReason[] = [
  'session_full',
  'dll_exhausted',
]

export function tradeifyBlocksNewEntries(decision: TradeifyPlaceDecision): boolean {
  return !decision.allowed
}

export function isTradeifySessionDayLock(reason: TradeifyRefuseReason): boolean {
  return reason === 'session_full' || reason === 'dll_exhausted'
}

export function tradeifyFlattenOverridesKeepOpen(_now: Date = new Date()): boolean {
  return false
}

export function formatTradeifyBannerChip(args: {
  leftoverDll: number
  floorRoom: number
  status: TradeifyDeskStatus
  refuseReason?: string | null
  flattenMontreal?: string | null
}): { label: string; title: string; tone: 'ok' | 'lock' | 'flatten' } {
  const dll = `DLL $${Math.round(Number(args.leftoverDll) || 0)}`
  if (args.status === 'day_locked') {
    return {
      label: `LOCKED · ${dll}`,
      title: `Desk session locked. ${dll} leftover.`,
      tone: 'lock',
    }
  }
  return {
    label: `${dll}`,
    title: `Personal Futures · ${dll} leftover of $${PERSONAL_DLL_DOLLARS}.`,
    tone: 'ok',
  }
}

export function oandaLadderWouldBreachTradeify(args: {
  fillsUsed?: number | null
  dailyPnl?: number | null
}): boolean {
  const planned = oandaCashRiskDollars(args.fillsUsed)
  const leftoverDll = personalLeftoverDll(args.dailyPnl)
  return planned > leftoverDll
}
