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
assert(fresh.riskDollars === 400, 'fresh first fill $400 not $1,000')
assert(fresh.leftoverDll === 1250, 'full DLL')
assert(fresh.floorRoom === 2000, 'full $2,000 floor room at $50k')

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

const stackedOanda = resolveTradeifyPlace({
  now: nasdaqTue,
  fillsUsed: 0,
  dailyPnl: -400,
})
assert(stackedOanda.allowed, 'engine still allows a first-step shrink, not $1,000')
assert(stackedOanda.riskDollars === 400, 'step still $400 (fits in $850 leftover)')
assert(oandaLadderWouldBreachTradeify({ fillsUsed: 0, dailyPnl: -400 }), 'but OANDA $1,000 would not')

// ─── Auto-shrink to leftover DLL / floor ─────────────────────────────────────

const tightDll = resolveTradeifyPlace({ now: midday, fillsUsed: 0, dailyPnl: -1100 })
assert(tightDll.allowed, 'shrink when leftover $150 >= min $50')
assert(tightDll.riskDollars === 75, 'haircut $75 so placeable is $75 not full leftover $150')
assert(tightDll.leftoverDll === 150, 'leftover DLL 150')

const dllGone = resolveTradeifyPlace({ now: midday, fillsUsed: 0, dailyPnl: -1250 })
assert(!dllGone.allowed, 'DLL exhausted')
assert(dllGone.refuseReason === 'dll_exhausted', 'reason dll_exhausted')

const almostFloor = resolveTradeifyPlace({
  now: midday,
  fillsUsed: 0,
  dailyPnl: 0,
  equity: 50_040,
  peakEodBalance: 52_000,
})
assert(!almostFloor.allowed, 'EOD trail to $50k floor + $40 room → refuse')
assert(
  almostFloor.refuseReason === 'floor_exhausted' || almostFloor.refuseReason === 'risk_too_small',
  `near-floor refuse ${almostFloor.refuseReason}`
)
assert(almostFloor.floorLevel === 50_000, 'peak 52k → floor 50k')

assert(tradeifyFloorLevel(50_000) === 48_000, 'start floor 48k')
assert(tradeifyFloorLevel(51_000) === 49_000, 'EOD peak 51k → floor 49k')
approxEqual(tradeifyFloorRoom({ equity: 51_000, peakEodBalance: 51_000 }), 2000, 0.01, 'room stays $2k after trail')
approxEqual(tradeifyLeftoverDll(200), 1250, 0.01, 'green day does not refill above $1,250 — unused stays full')
approxEqual(tradeifyLeftoverDll(-200), 1050, 0.01, 'loss eats DLL')

// ─── Session 3 + day locks (engine helpers for later slices) ─────────────────

const full = resolveTradeifyPlace({ now: midday, fillsUsed: 3, dailyPnl: 0 })
assert(!full.allowed && full.refuseReason === 'session_full', '3 fills lock')

const twoStops = resolveTradeifyPlace({ now: midday, fillsUsed: 2, dailyPnl: -650, stopOutsToday: 2 })
assert(!twoStops.allowed && twoStops.refuseReason === 'day_locked_stops', '2 stop-outs lock')
assert(tradeifyBlocksNewEntries(twoStops), '2 stops block entries')
assert(isTradeifySessionDayLock('day_locked_stops'), 'stops are a session day lock')

const green = resolveTradeifyPlace({ now: midday, fillsUsed: 1, dailyPnl: TRADEIFY_GREEN_DAY_LOCK_DOLLARS })
assert(!green.allowed && green.refuseReason === 'day_locked_green', 'green-day lock at $700')
assert(isTradeifySessionDayLock('day_locked_green'), 'green is a session day lock')
assert(
  !isTradeifySessionDayLock('stop_exceeds_dll'),
  'DLL shrink refuse is not a day-lock label'
)

const justUnderGreen = resolveTradeifyPlace({ now: midday, fillsUsed: 1, dailyPnl: 699 })
assert(justUnderGreen.allowed, '$699 still placeable')
assert(justUnderGreen.riskDollars === 250, 'second fill $250 under green cap')

// ─── Never grow above the step ───────────────────────────────────────────────

const fatRoom = resolveTradeifyPlace({
  now: midday,
  fillsUsed: 2,
  dailyPnl: 0,
  equity: 52_000,
  peakEodBalance: 50_000,
})
assert(fatRoom.riskDollars === 150, 'third fill stays $150 even with fat floor room')
assert(fatRoom.riskDollars <= fatRoom.stepDollars, 'never above step')

assert(TRADEIFY_STARTING_BALANCE === 50_000, '50k account')

assert(parseDeskRiskProfile('tradeify_growth_50k') === 'tradeify_growth_50k', 'parse tradeify')
assert(parseDeskRiskProfile('Tradeify') === 'tradeify_growth_50k', 'parse alias')
assert(parseDeskRiskProfile('oanda_cash') === 'oanda_cash', 'parse oanda')
assert(!isTradeifyGrowth50k(null), 'null is oanda')

const sized = getPositionSizer().calculatePositionFromRiskAmount(
  20000,
  50_000,
  'LONG',
  19900,
  400
)
assert(sized != null && Math.abs(sized.position_size - 4) < 1e-9, 'size = $400 / 100pt')
assert(sized != null && sized.risk_amount === 400, 'risk stays $400')

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
assert(sum.fillsUsed === 2, 'both desks count in one Tradeify session')
assert(sum.stopOutsToday === 1, 'one stop_hit')
approxEqual(sum.dailyPnl ?? 0, -150, 0.01, 'combined pnl')

const nextSess = summarizeTradeifyFills([nikkeiFill, nyFill], afterRollTue)
assert(nextSess.fillsUsed === 0, 'after 18:00 ET roll those fills leave the window')

assert(!tradeifyMustFlatten(nasdaqTue), '11:30 ET is not flatten window')
assert(tradeifyMustFlatten(new Date('2026-08-18T17:05:00-04:00')), '17:05 ET must flatten')
assert(!tradeifyMustFlatten(afterRollTue), 'after 18:00 ET new session — not flatten')

const flattenPlace = resolveTradeifyPlace({
  now: new Date('2026-08-18T17:05:00-04:00'),
  fillsUsed: 0,
  dailyPnl: 0,
})
assert(!flattenPlace.allowed && flattenPlace.refuseReason === 'must_flatten', '16:59 window refuses new holds')

const dash = buildTradeifyDashboardPayload(
  { ...sum, fills: [nikkeiFill, nyFill] },
  nasdaqTue
)
assert(dash.dllUsed === 150, 'DLL used from −150 pnl')
assert(dash.byInstrument.NIKKEI.fills === 1, 'Nikkei break')
assert(dash.byInstrument.NASDAQ.fills === 1, 'Nasdaq break')
assert(dash.byInstrument.GOLD.fills === 0, 'gold empty')
assert(dash.byInstrument.CRUDE.fills === 0, 'crude empty')
assert(dash.status === 'can_trade' || dash.status === 'day_locked', 'status set')
assert(
  tradeifyDeskStatus(twoStops, nasdaqTue) === 'day_locked',
  '2-stop decision → day_locked status'
)

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
assert(offDesk.fillsUsed === 2, 'Tradovate gold/crude count as fills')
approxEqual(offDesk.dailyPnl ?? 0, 44.36, 0.01, 'gold+crude pnl')
const offDash = buildTradeifyDashboardPayload({ ...offDesk, fills: [goldFill, crudeFill] }, nasdaqTue)
assert(offDash.byInstrument.GOLD.fills === 1, 'gold break')
assert(offDash.byInstrument.CRUDE.fills === 1, 'crude break')
approxEqual(offDash.byInstrument.GOLD.pnl, 36.68, 0.01, 'gold pnl')
approxEqual(offDash.dailyPnl, 44.36, 0.01, 'dashboard includes off-desk pnl')
assert(emptyDash.status === 'can_trade', 'empty book can_trade')

console.log('tradeify_growth_50k.test.ts: all passed')
