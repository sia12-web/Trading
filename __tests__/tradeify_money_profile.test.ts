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
  'tradeify_growth_50k',
  'desk is Tradeify only — OANDA hints are ignored'
)
assert.equal(
  mergeMoneyRiskProfile(undefined, undefined),
  'tradeify_growth_50k',
  'empty defaults to Tradeify'
)

console.log('tradeify_money_profile.test.ts: all assertions passed')
