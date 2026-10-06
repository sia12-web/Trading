/**
 * Fixed maps follow the tape only until the cash open.
 * NY: live tape 08:20 ET, maps update 08:30–09:30, then freeze.
 * Nikkei: tape through the Tokyo session, maps freeze at 09:00 JST.
 * Run: npx tsx __tests__/structure_clock.test.ts
 */

import assert from 'node:assert/strict'
import { anchoredVwapFollowsTape, fixedRangeFreezeAsOf, fixedRangePhase } from '../lib/chart/structureClock'
import {
  advanceAnchoredVwap,
  cashOpenUnixForYmd,
  computeAnchoredVwap,
  NY_DESK_CLOCK,
  seedAnchoredVwapFold,
  type SessionBar,
} from '../lib/chart/sessionVwap'
import { isChartStreamAllowed } from '../lib/trading/sessionGate'

// Wednesday 15 Jul 2026, EDT (UTC-4). 08:20 ET = 12:20 UTC.
const at = (h: number, m: number) => new Date(Date.UTC(2026, 6, 15, h + 4, m, 0))

for (const name of ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const) {
  assert.equal(fixedRangePhase(name, at(8, 0)), 'history', `${name} 08:00 history`)
  assert.equal(isChartStreamAllowed(name, at(8, 0)).open, false, `${name} 08:00 tape off`)
  assert.equal(fixedRangePhase(name, at(8, 20)), 'holding', `${name} 08:20 holding`)
  assert.equal(isChartStreamAllowed(name, at(8, 20)).open, true, `${name} 08:20 tape on`)
  assert.equal(fixedRangePhase(name, at(8, 30)), 'updating', `${name} 08:30 updating`)
  assert.equal(fixedRangePhase(name, at(9, 29)), 'updating', `${name} 09:29 updating`)
  assert.equal(fixedRangePhase(name, at(9, 30)), 'frozen', `${name} 09:30 frozen`)
  assert.equal(fixedRangePhase(name, at(14, 0)), 'frozen', `${name} 14:00 still frozen`)
  assert.equal(isChartStreamAllowed(name, at(14, 0)).open, true, `${name} 14:00 tape on`)
  assert.equal(isChartStreamAllowed(name, at(20, 0)).open, false, `${name} 20:00 tape off`)
  const clip = fixedRangeFreezeAsOf(name, at(14, 0))
  assert.ok(clip.inventoryUnix > clip.fiveDayUnix, `${name} 5-day clip is before the open`)
  assert.equal(clip.inventoryUnix - clip.fiveDayUnix, 1, `${name} 5-day is one second before the open`)
}

// Wednesday 15 Jul 2026, 08:30 JST = 14 Jul 23:30 UTC. Tokyo open 09:00 JST = 15 Jul 00:00 UTC.
const jst = (h: number, m: number) => new Date(Date.UTC(2026, 6, 15, h - 9, m, 0))
assert.equal(fixedRangePhase('NIKKEI', jst(8, 0)), 'history', 'NIKKEI 08:00 JST history')
assert.equal(isChartStreamAllowed('NIKKEI', jst(8, 0)).open, false, 'NIKKEI 08:00 tape off')
assert.equal(fixedRangePhase('NIKKEI', jst(8, 30)), 'updating', 'NIKKEI 08:30 JST updating')
assert.equal(isChartStreamAllowed('NIKKEI', jst(8, 30)).open, true, 'NIKKEI 08:30 tape on')
assert.equal(fixedRangePhase('NIKKEI', jst(8, 59)), 'updating', 'NIKKEI 08:59 JST still updating')
assert.equal(fixedRangePhase('NIKKEI', new Date('2026-07-15T00:00:00.000Z')), 'frozen', 'NIKKEI 09:00 JST frozen')
assert.equal(isChartStreamAllowed('NIKKEI', new Date('2026-07-15T01:00:00.000Z')).open, true, 'NIKKEI 10:00 JST tape stays on')
assert.equal(fixedRangePhase('NIKKEI', new Date('2026-07-15T01:00:00.000Z')), 'frozen', 'NIKKEI 10:00 JST maps frozen')

for (const name of ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const) {
  assert.equal(anchoredVwapFollowsTape(name, at(8, 29)), false, `${name} AVWAP idle at 08:29`)
  assert.equal(anchoredVwapFollowsTape(name, at(8, 30)), true, `${name} AVWAP follows from 08:30`)
  assert.equal(anchoredVwapFollowsTape(name, at(9, 30)), true, `${name} AVWAP still follows after the freeze`)
  assert.equal(anchoredVwapFollowsTape(name, at(15, 59)), true, `${name} AVWAP follows into the close`)
  assert.equal(anchoredVwapFollowsTape(name, at(16, 0)), false, `${name} AVWAP stops at 16:00`)
}
assert.equal(anchoredVwapFollowsTape('NIKKEI', jst(8, 29)), false, 'NIKKEI AVWAP idle at 08:29 JST')
assert.equal(anchoredVwapFollowsTape('NIKKEI', jst(8, 30)), true, 'NIKKEI AVWAP follows from 08:30 JST')
assert.equal(
  anchoredVwapFollowsTape('NIKKEI', new Date('2026-07-15T01:00:00.000Z')),
  true,
  'NIKKEI AVWAP follows at 10:00 JST after the map freeze'
)
assert.equal(
  anchoredVwapFollowsTape('NIKKEI', new Date('2026-07-15T06:00:00.000Z')),
  false,
  'NIKKEI AVWAP stops at 15:00 JST'
)

{
  const open = cashOpenUnixForYmd('2026-07-15', NY_DESK_CLOCK)
  const bar = (offset: number, close: number, volume = 10): SessionBar => ({
    time: open + offset,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume,
  })
  const first = bar(0, 100)
  const second = bar(300, 110)
  const fold = seedAnchoredVwapFold([first, second], NY_DESK_CLOCK)
  assert.ok(fold, 'fold seeds')
  const stepped = advanceAnchoredVwap(fold!, [first, second])
  const full = computeAnchoredVwap([first, second], NY_DESK_CLOCK)
  assert.ok(stepped.tip && full, 'tip and full series exist')
  assert.equal(stepped.tip!.vwap, full!.vwap[full!.vwap.length - 1]!.value, 'tip matches full AVWAP')

  const moved = { ...second, close: 130, high: 131 }
  const retick = advanceAnchoredVwap(stepped.fold, [first, moved])
  const fullMoved = computeAnchoredVwap([first, moved], NY_DESK_CLOCK)
  assert.ok(retick.tip && fullMoved, 'retick exists')
  assert.notEqual(retick.tip!.vwap, stepped.tip!.vwap, 'a new print moves the tip')
  assert.equal(retick.tip!.vwap, fullMoved!.vwap[fullMoved!.vwap.length - 1]!.value, 'moved tip matches')
  assert.equal(retick.fold.sumV, stepped.fold.sumV, 'forming bar stays out of the fold')

  const third = bar(600, 120)
  const rolled = advanceAnchoredVwap(retick.fold, [first, moved, third])
  const fullRolled = computeAnchoredVwap([first, moved, third], NY_DESK_CLOCK)
  assert.ok(rolled.tip && fullRolled, 'new bar tip exists')
  assert.equal(rolled.tip!.vwap, fullRolled!.vwap[fullRolled!.vwap.length - 1]!.value, 'new bar tip matches')
  assert.ok(rolled.fold.sumV > retick.fold.sumV, 'closed bar is folded when the next bar opens')
}

console.log('structure_clock: all passed')
