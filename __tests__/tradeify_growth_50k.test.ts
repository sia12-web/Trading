/**
 * Tradeify Growth $50k risk engine (Slice 1).
 * Run: npx tsx __tests__/tradeify_growth_50k.test.ts
 */

import {
  buildTradeifyDashboardPayload,
  summarizeTradeifyFills,
} from '../lib/trading/tradeifySessionState'
import { tradeifyMustFlatten, tradeifyDeskStatus } from '../lib/trading/tradeifyGrowth50k'
import { parseDeskRiskProfile, isTradeifyGrowth50k } from '../lib/trading/tradeifyProfile'
import { getPositionSizer } from '../lib/trading/positionSizing'
import {
  isTradeifySessionDayLock,
  tradeifyBlocksNewEntries,
  TRADEIFY_DLL_DOLLARS,
  TRADEIFY_GREEN_DAY_LOCK_DOLLARS,
  TRADEIFY_RISK_FIRST_DOLLARS,
  TRADEIFY_RISK_SECOND_DOLLARS,
  TRADEIFY_RISK_THIRD_DOLLARS,
  TRADEIFY_STARTING_BALANCE,
  TRADEIFY_TRAILING_DD_DOLLARS,
  formatTradeifyRiskChip,
  oandaCashRiskDollars,
  oandaLadderWouldBreachTradeify,
  resolveTradeifyPlace,
  sameTradeifySession,
  tradeifyFloorLevel,
  tradeifyFloorRoom,
  tradeifyLeftoverDll,
  tradeifyRiskStepDollars,
  tradeifySessionKey,
} from '../lib/trading/tradeifyGrowth50k'
import {
  SESSION_RISK_FIRST_PERCENT,
  SESSION_RISK_SECOND_PERCENT,
  SESSION_RISK_THIRD_PERCENT,
  riskPercentForSessionAttempt,
} from '../lib/trading/positionSizing'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function approxEqual(a: number, b: number, tol: number, msg: string) {
  if (Math.abs(a - b) > tol) {
    throw new Error(`${msg}: expected ${b}, got ${a} (tol ${tol})`)
  }
}

// ─── OANDA cash ladder must stay 2 / 1 / 0.5 ─────────────────────────────────

assert(SESSION_RISK_FIRST_PERCENT === 2, 'OANDA first still 2%')
assert(SESSION_RISK_SECOND_PERCENT === 1, 'OANDA second still 1%')
assert(SESSION_RISK_THIRD_PERCENT === 0.5, 'OANDA third still 0.5%')
assert(riskPercentForSessionAttempt(0) === 2, 'OANDA helper unchanged')

// ─── Dollar steps ────────────────────────────────────────────────────────────

assert(tradeifyRiskStepDollars(0) === 400, 'fill0 = $400')
assert(tradeifyRiskStepDollars(1) === 250, 'fill1 = $250')
assert(tradeifyRiskStepDollars(2) === 150, 'fill2 = $150')
assert(tradeifyRiskStepDollars(3) === 150, 'fill3 still $150 (session already full)')
assert(tradeifyRiskStepDollars(null) === 400, 'null → first')
assert(formatTradeifyRiskChip(0).includes('$400'), 'chip $400')
assert(formatTradeifyRiskChip(0).includes('1/3'), 'chip 1/3')

const fullLadder = TRADEIFY_RISK_FIRST_DOLLARS + TRADEIFY_RISK_SECOND_DOLLARS + TRADEIFY_RISK_THIRD_DOLLARS
assert(fullLadder === 800, '3-stop planned sum = $800')
assert(fullLadder < TRADEIFY_DLL_DOLLARS, 'full Tradeify ladder fits inside $1,250 DLL')

// ─── Why 2% fails on $50k ────────────────────────────────────────────────────

assert(oandaCashRiskDollars(0) === 1000, 'OANDA first = $1,000')
assert(oandaCashRiskDollars(1) === 500, 'OANDA second = $500')
assert(oandaCashRiskDollars(0) + oandaCashRiskDollars(1) === 1500, 'two OANDA stops = $1,500 > DLL')
assert(oandaCashRiskDollars(0) * 2 === 2000, 'two first-size OANDA stops = $2,000 floor')
assert(oandaCashRiskDollars(0) * 2 === TRADEIFY_TRAILING_DD_DOLLARS, '2× $1,000 = trailing DD')

assert(
  oandaLadderWouldBreachTradeify({ fillsUsed: 0, dailyPnl: -400 }),
  'after $400 Nikkei stop, OANDA $1,000 first fill exceeds leftover DLL $850'
)
assert(
  !oandaLadderWouldBreachTradeify({ fillsUsed: 0, dailyPnl: 0 }),
  'fresh day: OANDA $1,000 still fits $1,250 DLL (but 80% of the day — we still do not use it)'
)

const midday = new Date('2026-08-18T11:30:00-04:00')
const fresh = resolveTradeifyPlace({ now: midday, fillsUsed: 0, dailyPnl: 0 })
assert(fresh.allowed, 'fresh day can place')
assert(fresh.riskDollars === 400, 'fresh first fill $400')
assert(fresh.leftoverDll === 1250, 'full DLL')

// ─── Shared session: Nikkei night + NY morning ───────────────────────────────

// Monday 21:00 ET (Nikkei US/IB) and Tuesday 11:30 ET (NASDAQ IB)
const nikkeiMon = new Date('2026-08-17T21:00:00-04:00')
const nasdaqTue = new Date('2026-08-18T11:30:00-04:00')
const afterRollTue = new Date('2026-08-18T18:05:00-04:00')

assert(tradeifySessionKey(nikkeiMon) === '2026-08-17', 'Mon 21:00 ET → session 17')
assert(tradeifySessionKey(nasdaqTue) === '2026-08-17', 'Tue 11:30 ET → same session 17')
assert(sameTradeifySession(nikkeiMon, nasdaqTue), 'Nikkei night + NY morning share key')
assert(tradeifySessionKey(afterRollTue) === '2026-08-18', 'Tue 18:05 ET rolls new session')
assert(!sameTradeifySession(nasdaqTue, afterRollTue), '18:00 ET starts a new day')

// ─── Shared budget: Nikkei stop then NY first fill ───────────────────────────

const afterNikkeiStop = resolveTradeifyPlace({
  now: nasdaqTue,
  fillsUsed: 1,
  dailyPnl: -400,
})
assert(afterNikkeiStop.allowed, 'NY still placeable after $400 Nikkei stop')
assert(afterNikkeiStop.sessionKey === tradeifySessionKey(nikkeiMon), 'same session key')
assert(afterNikkeiStop.stepDollars === 250, 'second fill step $250')
assert(afterNikkeiStop.riskDollars === 250, 'uses $250 not another $400')
approxEqual(afterNikkeiStop.leftoverDll, 850, 0.01, 'DLL leftover 1250-400')

// ─── Auto-shrink to leftover DLL ─────────────────────────────────────────────

const tightDll = resolveTradeifyPlace({ now: midday, fillsUsed: 0, dailyPnl: -1100 })
assert(tightDll.allowed, 'shrink when leftover $150 >= min $50')
assert(tightDll.riskDollars === 75, 'haircut $75 so placeable is $75 not full leftover $150')
assert(tightDll.leftoverDll === 150, 'leftover DLL 150')

const dllGone = resolveTradeifyPlace({ now: midday, fillsUsed: 0, dailyPnl: -1250 })
assert(!dllGone.allowed, 'DLL exhausted')
assert(dllGone.refuseReason === 'dll_exhausted', 'reason dll_exhausted')

approxEqual(tradeifyLeftoverDll(200), 1250, 0.01, 'green day does not refill above $1,250 — unused stays full')
approxEqual(tradeifyLeftoverDll(-200), 1050, 0.01, 'loss eats DLL')

// ─── Session 3 cap ──────────────────────────────────────────────────────────

const full = resolveTradeifyPlace({ now: midday, fillsUsed: 3, dailyPnl: 0 })
assert(!full.allowed && full.refuseReason === 'session_full', '3 fills lock')

// ─── Never grow above the step ───────────────────────────────────────────────

const fatRoom = resolveTradeifyPlace({
  now: midday,
  fillsUsed: 2,
  dailyPnl: 0,
  equity: 52_000,
  peakEodBalance: 50_000,
})
assert(fatRoom.riskDollars === 150, 'third fill stays $150')
assert(fatRoom.riskDollars <= fatRoom.stepDollars, 'never above step')

assert(TRADEIFY_STARTING_BALANCE === 50_000, '50k account')

assert(parseDeskRiskProfile('tradeify_growth_50k') === 'personal_futures', 'parse tradeify')
assert(parseDeskRiskProfile('Tradeify') === 'personal_futures', 'parse alias')
assert(parseDeskRiskProfile('personal_futures') === 'personal_futures', 'parse personal_futures')
assert(isTradeifyGrowth50k('personal_futures'), 'personal_futures is growth active')

const nikkeiFill = {
  instrument: 'NIKKEI',
  fill_status: 'filled',
  entry_timestamp: nikkeiMon.toISOString(),
  exit_reason: 'stop_hit',
  profit_loss: -400,
  risk_amount: 400,
}
const nyFill = {
  instrument: 'NASDAQ',
  fill_status: 'filled',
  entry_timestamp: nasdaqTue.toISOString(),
  exit_reason: 'take_profit',
  profit_loss: 250,
  risk_amount: 250,
}
const sum = summarizeTradeifyFills([nikkeiFill, nyFill], nasdaqTue)
assert(sum.fillsUsed === 2, 'both desks count in one session')
assert(sum.stopOutsToday === 1, 'one stop_hit')
approxEqual(sum.dailyPnl ?? 0, -150, 0.01, 'combined pnl')

const dash = buildTradeifyDashboardPayload(
  { ...sum, fills: [nikkeiFill, nyFill] },
  nasdaqTue
)
assert(dash.dllUsed === 150, 'DLL used from −150 pnl')
assert(dash.byInstrument.NIKKEI.fills === 1, 'Nikkei break')
assert(dash.byInstrument.NASDAQ.fills === 1, 'Nasdaq break')
assert(dash.byInstrument.GOLD.fills === 0, 'gold empty')
assert(dash.byInstrument.CRUDE.fills === 0, 'crude empty')
assert(dash.status === 'can_trade', 'status set')

const emptyBook = summarizeTradeifyFills([], nasdaqTue)
assert(emptyBook.fillsUsed === 0, 'reset journal → 0 fills')
assert(emptyBook.dailyPnl === 0, 'reset journal → $0 pnl')
assert(emptyBook.stopOutsToday === 0, 'reset journal → 0 stops')
const emptyDash = buildTradeifyDashboardPayload(emptyBook, nasdaqTue)
assert(emptyDash.allowed, 'empty Tradeify book can place')
assert(emptyDash.stepDollars === 400, 'empty book first step $400')
assert(emptyDash.riskDollars === 400, 'empty book risk $400 not 2%')
assert(emptyDash.dllUsed === 0, 'empty book unused DLL')

const goldFill = {
  instrument: 'GOLD',
  fill_status: 'filled',
  entry_timestamp: nasdaqTue.toISOString(),
  exit_reason: 'manual',
  profit_loss: 36.68,
  risk_amount: 39,
}
const crudeFill = {
  instrument: 'CRUDE',
  fill_status: 'filled',
  entry_timestamp: nasdaqTue.toISOString(),
  exit_reason: 'manual',
  profit_loss: 7.68,
  risk_amount: 10,
}
const offDesk = summarizeTradeifyFills([goldFill, crudeFill], nasdaqTue)
assert(offDesk.fillsUsed === 2, 'CME gold/crude count as fills')
approxEqual(offDesk.dailyPnl ?? 0, 44.36, 0.01, 'gold+crude pnl')
const offDash = buildTradeifyDashboardPayload({ ...offDesk, fills: [goldFill, crudeFill] }, nasdaqTue)
assert(offDash.byInstrument.GOLD.fills === 1, 'gold break')
assert(offDash.byInstrument.CRUDE.fills === 1, 'crude break')
approxEqual(offDash.byInstrument.GOLD.pnl, 36.68, 0.01, 'gold pnl')
approxEqual(offDash.dailyPnl, 44.36, 0.01, 'dashboard includes off-desk pnl')
assert(emptyDash.status === 'can_trade', 'empty book can_trade')

console.log('tradeify_growth_50k.test.ts: all passed')
