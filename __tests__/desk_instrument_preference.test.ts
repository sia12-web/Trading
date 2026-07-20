/**
 * Desk instrument preference persistence.
 * Run: npx tsx __tests__/desk_instrument_preference.test.ts
 */

import {
  parseDeskInstrument,
  deskVisibleLogicalRange,
  deskBarSpacing,
  DESK_VISIBLE_BARS,
} from '../lib/trading/deskInstrumentPreference'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(parseDeskInstrument('NASDAQ') === 'NASDAQ', 'NASDAQ')
assert(parseDeskInstrument('nasdaq') === 'NASDAQ', 'case')
assert(parseDeskInstrument('DOW') === 'DOW', 'DOW')
assert(parseDeskInstrument('NIKKEI') === 'NIKKEI', 'NIKKEI')
assert(parseDeskInstrument('SPX') === null, 'reject junk')
assert(parseDeskInstrument(null) === null, 'null')
assert(parseDeskInstrument('') === null, 'empty')

{
  const r = deskVisibleLogicalRange(3000)
  assert(r.to === 3002, `tip to ${r.to}`)
  assert(r.from === 3000 - DESK_VISIBLE_BARS, `from ${r.from}`)
  assert(r.to - r.from < 3000, 'not full history')
}

{
  const r = deskVisibleLogicalRange(50)
  assert(r.from === 0, 'small history starts at 0')
  assert(r.to === 52, 'small history tip')
}

{
  const spacing = deskBarSpacing(900, 3000)
  assert(spacing >= 3 && spacing <= 8, `spacing ${spacing}`)
}

console.log('desk_instrument_preference.test.ts: all passed')
