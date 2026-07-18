/**
 * Smoke checks for market-reaction grading helper used by the live desk.
 * Run: npx tsx __tests__/level_reaction_status.test.ts
 */

import { evaluateLevel } from '../lib/services/levelValidation'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

// Support level at 100 — approach from above, wick through, reclaim → held
const holdBars = [
  { time: 1, open: 101, high: 102, low: 100.5, close: 101.2, volume: 1 },
  { time: 2, open: 101, high: 101.1, low: 99.7, close: 99.9, volume: 1 }, // touch
  { time: 3, open: 99.9, high: 100.2, low: 99.6, close: 100.05, volume: 1 },
  { time: 4, open: 100.1, high: 100.8, low: 100.0, close: 100.6, volume: 1 }, // clear above
]

const held = evaluateLevel(100, holdBars, 0.0012)
assert(held.tests >= 1, 'expect a test')
assert(held.lastOutcome === 'held', `expected held, got ${held.lastOutcome}`)
assert(held.verdict === 'respected' || held.verdict === 'contested', held.verdict)

// Break: approach from above, close through below clearance
const breakBars = [
  { time: 1, open: 101, high: 101.5, low: 100.8, close: 101, volume: 1 },
  { time: 2, open: 101, high: 101, low: 99.5, close: 99.6, volume: 1 },
  { time: 3, open: 99.6, high: 99.7, low: 99.2, close: 99.3, volume: 1 },
]
const broke = evaluateLevel(100, breakBars, 0.0012)
assert(broke.tests >= 1, 'break test')
assert(broke.lastOutcome === 'broke', `expected broke, got ${broke.lastOutcome}`)
assert(broke.verdict === 'broken', broke.verdict)

console.log('OK level reaction grading', { held, broke })
console.log('\nAll level reaction checks passed.')
