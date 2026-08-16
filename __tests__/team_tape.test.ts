/**
 * NYC team tape — leftover-fill advice. Team stock fills never burn a 3/3.
 * Run: npx tsx __tests__/team_tape.test.ts
 */

import assert from 'node:assert/strict'
import {
  buildTeamCopyAdvice,
  formatTeamTelegram,
  isTeamTapeSymbol,
  parseTeamTapeIngest,
  parseTeamTapeSide,
  teamCopyAdviceFromInput,
  teamTapeTarget1_5R,
} from '../lib/trading/teamTape'
import { resolveTradeifyPlace } from '../lib/trading/tradeifyGrowth50k'

const midday = new Date('2026-08-18T11:30:00-04:00')
const afterFlatten = new Date('2026-08-18T17:05:00-04:00')

assert.equal(isTeamTapeSymbol('AAPL'), true)
assert.equal(isTeamTapeSymbol('BRK.B'), true)
assert.equal(isTeamTapeSymbol('AAPL  21Aug26C150.00'), false)
assert.equal(isTeamTapeSymbol('MNQ'), true)
assert.equal(parseTeamTapeSide('Buy'), 'BUY')
assert.equal(parseTeamTapeSide('SHORT'), 'SELL')
assert.equal(parseTeamTapeSide('hold'), null)

assert.equal(teamTapeTarget1_5R({ side: 'BUY', entry: 100, stop: 90 }), 115)
assert.equal(teamTapeTarget1_5R({ side: 'SELL', entry: 100, stop: 110 }), 85)
assert.equal(teamTapeTarget1_5R({ side: 'BUY', entry: 100, stop: null }), null)

const parsed = parseTeamTapeIngest({
  sourceId: 'qt-1',
  symbol: 'aapl',
  side: 'Buy',
  quantity: 200,
  entry: 189.5,
  stop: 187,
})
assert.equal(parsed.ok, true)
if (parsed.ok) {
  assert.equal(parsed.signal.symbol, 'AAPL')
  assert.equal(parsed.signal.side, 'BUY')
  assert.equal(parsed.signal.target, 193.25)
}

const optionReject = parseTeamTapeIngest({
  sourceId: 'qt-opt',
  symbol: 'AAPL  21Aug26C150.00',
  side: 'Buy',
  quantity: 1,
  entry: 2.5,
})
assert.equal(optionReject.ok, false)

const first = teamCopyAdviceFromInput({
  now: midday,
  fillsUsed: 0,
  dailyPnl: 0,
  clockedIn: true,
})
assert.equal(first.canCopy, true)
assert.equal(first.fillsUsed, 0)
assert.equal(first.fillsLeft, 3)
assert.equal(first.nextFillNumber, 1)
assert.equal(first.riskDollars, 400)
assert.match(first.headline, /fill 1\/3/)

const afterNikkei = teamCopyAdviceFromInput({
  now: midday,
  fillsUsed: 2,
  dailyPnl: -80,
  clockedIn: true,
})
assert.equal(afterNikkei.canCopy, true)
assert.equal(afterNikkei.fillsLeft, 1)
assert.equal(afterNikkei.nextFillNumber, 3)
assert.equal(afterNikkei.riskDollars, 150)

const full = teamCopyAdviceFromInput({
  now: midday,
  fillsUsed: 3,
  clockedIn: true,
})
assert.equal(full.canCopy, false)
assert.equal(full.fillsLeft, 0)
assert.match(full.headline, /Do not copy/)

const lockedStops = teamCopyAdviceFromInput({
  now: midday,
  fillsUsed: 1,
  stopOutsToday: 2,
  clockedIn: true,
})
assert.equal(lockedStops.canCopy, false)
assert.match(lockedStops.headline, /Do not copy/)

const notClocked = teamCopyAdviceFromInput({
  now: midday,
  fillsUsed: 0,
  clockedIn: false,
})
assert.equal(notClocked.canCopy, false)
assert.match(notClocked.headline, /Clock in/)
assert.equal(notClocked.fillsLeft, 3)

const flatten = teamCopyAdviceFromInput({
  now: afterFlatten,
  fillsUsed: 0,
  clockedIn: true,
})
assert.equal(flatten.canCopy, false)
assert.equal(flatten.mustFlatten, true)
assert.match(flatten.headline, /Flatten/)

const signal = {
  sourceId: 'qt-1',
  symbol: 'AAPL',
  side: 'BUY' as const,
  quantity: 200,
  entry: 189.5,
  stop: 187,
  target: 193.25,
  status: 'filled' as const,
}
const tg = formatTeamTelegram({ signal, advice: first })
assert.match(tg, /^\[TEAM\] BUY AAPL/)
assert.match(tg, /1\.5R 193\.25/)
assert.doesNotMatch(tg, /200 MNQ/)

const place = resolveTradeifyPlace({ now: midday, fillsUsed: 1 })
const viaBuild = buildTeamCopyAdvice({ place, clockedIn: true, now: midday })
assert.equal(viaBuild.nextFillNumber, 2)
assert.equal(viaBuild.riskDollars, 250)

console.log('team_tape.test.ts: ok')
