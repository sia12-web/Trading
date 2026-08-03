/**
 * Regression: Nikkei US Range evening (ET) uses JST trade_date — chart current-position
 * must not query EST-only or it returns null and false-closes while Live Positions stays open.
 *
 * Run: npx tsx __tests__/current_position_trade_date.test.ts
 */

import assert from 'node:assert/strict'
import { getESTDateString } from '../lib/utils/timeUtils'
import { tradeDateForInstrument } from '../lib/trading/deskAttendance'
import {
  scopeForCurrentPositionQuery,
  shouldClearChartAsClosed,
} from '../lib/trading/currentPositionQuery'

// Sun 2026-08-02 20:29 ET = Mon 09:29 JST Aug 3 — Tokyo US Range window
const usRangeEvening = new Date('2026-08-03T00:29:00.000Z')

const est = getESTDateString(usRangeEvening)
const jst = tradeDateForInstrument('NIKKEI', usRangeEvening)

assert.equal(est, '2026-08-02', 'ET calendar date during Nikkei US Range evening')
assert.equal(jst, '2026-08-03', 'Nikkei journal trade_date is JST (next calendar day)')
assert.notEqual(est, jst, 'EST≠JST is the false-close precondition')

const nikkeiScope = scopeForCurrentPositionQuery({
  instrument: 'NIKKEI',
  anyNy: false,
  now: usRangeEvening,
})
assert.deepEqual(nikkeiScope.instruments, ['NIKKEI'])
assert.deepEqual(
  nikkeiScope.tradeDates,
  [jst],
  'current-position must query JST trade_date for NIKKEI (not EST)'
)
assert.ok(
  !nikkeiScope.tradeDates.includes(est),
  'must not use EST-only — that missed open Nikkei books'
)

const nyScope = scopeForCurrentPositionQuery({
  instrument: 'DOW',
  anyNy: false,
  now: usRangeEvening,
})
assert.deepEqual(nyScope.tradeDates, [est], 'DOW still uses ET trade_date')

const anyNy = scopeForCurrentPositionQuery({
  instrument: null,
  anyNy: true,
  now: usRangeEvening,
})
assert.deepEqual(anyNy.instruments, ['DOW', 'NASDAQ'])
assert.deepEqual(anyNy.tradeDates, [est])

// Chart clear guard — absence alone with working/open must not clear
assert.equal(
  shouldClearChartAsClosed({
    reconciledClosed: false,
    hasFilledOpen: true,
    hasWorkingLimit: false,
  }),
  false,
  'filled open → keep chart'
)
assert.equal(
  shouldClearChartAsClosed({
    reconciledClosed: false,
    hasFilledOpen: false,
    hasWorkingLimit: true,
  }),
  false,
  'working limit → never toast closed'
)
assert.equal(
  shouldClearChartAsClosed({
    reconciledClosed: true,
    hasFilledOpen: false,
    hasWorkingLimit: false,
  }),
  true,
  'reconcile closed → clear'
)
assert.equal(
  shouldClearChartAsClosed({
    reconciledClosed: false,
    hasFilledOpen: false,
    hasWorkingLimit: false,
  }),
  true,
  'both absent after confirm → clear'
)

console.log('current_position_trade_date: all passed')
