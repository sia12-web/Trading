/**
 * NY and Tokyo attempt books must not share caps; risk is source-derived.
 * Run: npx tsx __tests__/desk_market_attempts.test.ts
 */

import {
  deskMarketFor,
  instrumentsForDeskMarket,
} from '../lib/trading/sessionGate'
import {
  riskPercentForEntrySource,
  DESK_RISK_PERCENT,
  MANUAL_RISK_PERCENT,
} from '../lib/trading/positionSizing'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(riskPercentForEntrySource('manual') === MANUAL_RISK_PERCENT, 'manual = 1%')
assert(riskPercentForEntrySource('ai') === DESK_RISK_PERCENT, 'ai = desk 5%')
assert(riskPercentForEntrySource('structure') === DESK_RISK_PERCENT, 'structure = desk 5%')
assert(riskPercentForEntrySource(undefined) === DESK_RISK_PERCENT, 'default = desk 5%')
// Client cannot force higher risk via a fake source string either
assert(riskPercentForEntrySource('manual') !== DESK_RISK_PERCENT, 'manual never desk risk')

assert(deskMarketFor('NIKKEI') === 'TOKYO', 'NIKKEI → TOKYO')
assert(deskMarketFor('DOW') === 'NY', 'DOW → NY')
assert(deskMarketFor('NASDAQ') === 'NY', 'NASDAQ → NY')

assert(
  JSON.stringify(instrumentsForDeskMarket('TOKYO')) === JSON.stringify(['NIKKEI']),
  'Tokyo book is NIKKEI only'
)
assert(
  JSON.stringify(instrumentsForDeskMarket('NY')) === JSON.stringify(['DOW', 'NASDAQ']),
  'NY book is DOW+NASDAQ'
)

const allFills = [
  { instrument: 'DOW', exit_reason: 'stop_hit' },
  { instrument: 'NASDAQ', exit_reason: 'manual' },
  { instrument: 'NIKKEI', exit_reason: null },
]

const nyInstruments = instrumentsForDeskMarket('NY')
const tokyoInstruments = instrumentsForDeskMarket('TOKYO')
const nyBook = allFills.filter((t) =>
  (nyInstruments as string[]).includes(t.instrument)
)
const tokyoBook = allFills.filter((t) =>
  (tokyoInstruments as string[]).includes(t.instrument)
)

assert(nyBook.length === 2, 'NY attempts = 2 from mixed day')
assert(tokyoBook.length === 1, 'Tokyo has its own attempt')
assert(nyBook.length + tokyoBook.length === allFills.length, 'no fill counted twice')

console.log('desk_market_attempts: all passed')
