/**
 * Tick snap for desk instruments.
 * Run: npx tsx __tests__/instrument_ticks.test.ts
 */

import {
  instrumentTick,
  snapDeskPrice,
  snapStopToTick,
  snapTargetToTick,
} from '../lib/trading/instrumentTicks'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(instrumentTick('NASDAQ') === 1, 'NASDAQ tick')
assert(snapDeskPrice('NASDAQ', 29500.4) === 29500, 'round half down-ish to nearest')
assert(snapDeskPrice('NASDAQ', 29500.5) === 29501, '0.5 rounds away via Math.round')

{
  const stop = snapStopToTick('NASDAQ', 29500, 29499.6, 'LONG')
  assert(stop < 29500, `LONG stop must be below limit, got ${stop}`)
  assert(stop === Math.round(stop), 'stop on tick')
}

{
  const tp = snapTargetToTick('NASDAQ', 29500, 29600.4, 'LONG')
  assert(tp > 29500, 'LONG TP above')
  assert(tp === 29600, `expected 29600 got ${tp}`)
}

{
  const stop = snapStopToTick('DOW', 42000, 42000, 'LONG')
  assert(stop === 41999, `stop on limit must step below, got ${stop}`)
}

console.log('instrument_ticks: ok')
