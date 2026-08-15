/**
 * Money path: persisted Tradeify must win over a missing/stale OANDA hint.
 * Run: npx tsx __tests__/tradeify_money_profile.test.ts
 */

import assert from 'node:assert/strict'
import { mergeMoneyRiskProfile } from '../lib/trading/tradeifyProfile'

assert.equal(
  mergeMoneyRiskProfile('oanda_cash', 'tradeify_growth_50k'),
  'tradeify_growth_50k',
  'persisted Tradeify beats client OANDA'
)
assert.equal(
  mergeMoneyRiskProfile(null, 'tradeify_growth_50k'),
  'tradeify_growth_50k',
  'missing client hint still Tradeify when persisted'
)
assert.equal(
  mergeMoneyRiskProfile('tradeify_growth_50k', 'oanda_cash'),
  'tradeify_growth_50k',
  'client Tradeify beats persisted OANDA'
)
assert.equal(
  mergeMoneyRiskProfile('oanda_cash', 'oanda_cash'),
  'oanda_cash',
  'both OANDA stays cash'
)
assert.equal(
  mergeMoneyRiskProfile(undefined, undefined),
  'oanda_cash',
  'empty defaults to cash'
)

console.log('tradeify_money_profile.test.ts: all assertions passed')
