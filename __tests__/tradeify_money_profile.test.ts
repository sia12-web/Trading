/**
 * Money path: persisted Tradeify must win over a missing/stale OANDA hint.
 * Run: npx tsx __tests__/tradeify_money_profile.test.ts
 */

import assert from 'node:assert/strict'
import { mergeMoneyRiskProfile } from '../lib/trading/tradeifyProfile'

assert.equal(
  mergeMoneyRiskProfile('oanda_cash', 'personal_futures'),
  'personal_futures',
  'persisted personal_futures beats client OANDA'
)
assert.equal(
  mergeMoneyRiskProfile(null, 'personal_futures'),
  'personal_futures',
  'missing client hint still personal_futures when persisted'
)
assert.equal(
  mergeMoneyRiskProfile('personal_futures', 'oanda_cash'),
  'personal_futures',
  'client personal_futures beats persisted OANDA'
)
assert.equal(
  mergeMoneyRiskProfile('oanda_cash', 'oanda_cash'),
  'personal_futures',
  'desk is personal_futures only — OANDA hints are ignored'
)
assert.equal(
  mergeMoneyRiskProfile(undefined, undefined),
  'personal_futures',
  'empty defaults to personal_futures'
)

console.log('tradeify_money_profile.test.ts: all assertions passed')
