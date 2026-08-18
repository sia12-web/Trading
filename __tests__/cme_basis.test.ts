/**
 * CME vs OANDA basis — live ticks must sit on Tradovate scale.
 * Run: npx tsx __tests__/cme_basis.test.ts
 */

import assert from 'node:assert/strict'
import { applyCmeBasis, cmeBasisFromPair } from '../lib/trading/cmeBasis'
import { YAHOO_CME_SYMBOLS } from '../lib/yahoo/symbols'

assert.equal(YAHOO_CME_SYMBOLS.DOW, 'MYM=F')
assert.equal(YAHOO_CME_SYMBOLS.NASDAQ, 'MNQ=F')
assert.equal(YAHOO_CME_SYMBOLS.NIKKEI, 'NKD=F')

{
  const b = cmeBasisFromPair(53262.6, 53311)
  assert.ok(b != null, 'today Dow basis is valid')
  assert.equal(Math.round(b! * 10) / 10, 48.4)
  assert.equal(applyCmeBasis(53262.6, b), 53311)
}

{
  const b = cmeBasisFromPair(29495.2, 29568.25)
  assert.ok(b != null, 'today Nasdaq basis is valid')
  assert.equal(Math.round(applyCmeBasis(29495.2, b) * 100) / 100, 29568.25)
}

assert.equal(cmeBasisFromPair(53000, 53000 * 1.02), null, '2% gap is not a basis')
assert.equal(cmeBasisFromPair(0, 53311), null)
assert.equal(applyCmeBasis(53262.6, null), 53262.6, 'no basis → leave OANDA')

console.log('cme_basis: ok')
