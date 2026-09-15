/**
 * Round-number magnets for grounding, stops, and take-profits.
 * Run: npx tsx __tests__/round_number_magnets.test.ts
 */

import {
  extendStopPastRound,
  snapProfitToRound,
  zoneStopPrice,
} from '../lib/trading/deskLevels'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

{
  const extended = extendStopPastRound(29420, 'LONG', 29500)
  assert(extended < 29400, `expected stop under 29400, got ${extended}`)
  assert(extended > 29390, `expected soft extend, got ${extended}`)
}

{
  const snapped = snapProfitToRound(29500, 29400, 29698, 'LONG')
  assert(snapped === 29700, `expected TP snap to 29700, got ${snapped}`)
}

{
  const stop = zoneStopPrice(29450, 'LONG')
  assert(stop < 29450, `zone stop should be below level, got ${stop}`)
}

console.log('round_number_magnets: ok')
