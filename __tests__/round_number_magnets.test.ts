/**
 * Round-number magnets for grounding, stops, and take-profits.
 * Run: npx tsx __tests__/round_number_magnets.test.ts
 */

import { groundLevels } from '../lib/llm/antiHallucination'
import {
  extendStopPastRound,
  snapProfitToRound,
  zoneStopPrice,
} from '../lib/trading/deskLevels'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

{
  const candles = [
    {
      timestamp: '2026-07-14T13:00:00.000Z',
      open: 29480,
      high: 29520,
      low: 29440,
      close: 29500,
      volume: 1000,
    },
  ]
  const grounded = groundLevels(
    [
      {
        level: 29500,
        type: 'resistance',
        conviction: 8,
        reasoning: '29,500 handle + London wick',
        timeframe: 'H1',
      },
    ],
    { candles, currentPrice: 29490, snap: false }
  )
  assert(grounded[0]?.grounded === true, 'round handle should ground')
  assert(
    !!grounded[0]?.anchor_source &&
      /round_number|high|close|open/.test(grounded[0].anchor_source),
    `unexpected anchor ${grounded[0]?.anchor_source}`
  )
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
