/**
 * Desk instrument preference persistence.
 * Run: npx tsx __tests__/desk_instrument_preference.test.ts
 */

import { parseDeskInstrument } from '../lib/trading/deskInstrumentPreference'

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

console.log('desk_instrument_preference.test.ts: all passed')
