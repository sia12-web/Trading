/**
 * Questrade from TradePulse is GET-only.
 * Run: npx tsx __tests__/questrade_readonly.test.ts
 */

import assert from 'node:assert/strict'
import {
  assertQuestradeReadOnly,
  parseQuestradeAccountSize,
} from '../lib/trading/questradeReadOnly'

assert.doesNotThrow(() => assertQuestradeReadOnly('GET', 'v1/accounts'))
assert.doesNotThrow(() =>
  assertQuestradeReadOnly('GET', 'v1/accounts/29804934/orders')
)
assert.throws(
  () => assertQuestradeReadOnly('POST', 'v1/accounts/29804934/orders'),
  /read-only/i
)
assert.throws(
  () => assertQuestradeReadOnly('DELETE', 'v1/accounts/29804934/orders/1'),
  /read-only/i
)
assert.throws(() => assertQuestradeReadOnly('PUT', 'v1/accounts/1/orders/1'), /read-only/i)

const size = parseQuestradeAccountSize({
  account: '29804934',
  balances: {
    combinedBalances: [
      { currency: 'CAD', cash: 1200.5, marketValue: 800, totalEquity: 2000.5, buyingPower: 4000 },
    ],
  },
  positions: [{}, {}],
})
assert.equal(size.ok, true)
assert.equal(size.equity, 2000.5)
assert.equal(size.cash, 1200.5)
assert.equal(size.positions, 2)
assert.equal(size.currency, 'CAD')

console.log('questrade_readonly.test.ts: ok')
