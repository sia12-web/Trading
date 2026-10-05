/**
 * Fixed maps follow the tape only until the cash open.
 * NY: live tape 08:20 ET, maps update 08:30–09:30, then freeze.
 * Nikkei: tape through the Tokyo session, maps freeze at 09:00 JST.
 * Run: npx tsx __tests__/structure_clock.test.ts
 */

import assert from 'node:assert/strict'
import { fixedRangeFreezeAsOf, fixedRangePhase } from '../lib/chart/structureClock'
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

console.log('structure_clock: all passed')
