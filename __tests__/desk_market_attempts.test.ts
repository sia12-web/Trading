/**
 * NY and Tokyo attempt books must not share caps; all desk sources share progressive risk.
 * Run: npx tsx __tests__/desk_market_attempts.test.ts
 */

import {
  deskMarketFor,
  instrumentsForDeskMarket,
} from '../lib/trading/sessionGate'
import {
  riskPercentForEntrySource,
  RANGE_EDGE_RISK_PERCENT,
  SESSION_RISK_FIRST_PERCENT,
  SESSION_RISK_THIRD_PERCENT,
} from '../lib/trading/positionSizing'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(RANGE_EDGE_RISK_PERCENT === 0.5, 'range-edge floor = third step 0.5%')
assert(RANGE_EDGE_RISK_PERCENT === SESSION_RISK_THIRD_PERCENT, 'floor aliases third')
assert(riskPercentForEntrySource('manual') === SESSION_RISK_FIRST_PERCENT, 'manual first = 2%')
assert(riskPercentForEntrySource('ai') === SESSION_RISK_FIRST_PERCENT, 'ai first = 2%')
assert(riskPercentForEntrySource('structure') === SESSION_RISK_FIRST_PERCENT, 'structure first = 2%')
assert(riskPercentForEntrySource(undefined) === SESSION_RISK_FIRST_PERCENT, 'default first = 2%')
assert(riskPercentForEntrySource('fake_source') === SESSION_RISK_FIRST_PERCENT, 'unknown source still first step')

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
