/**
 * Live desk is Tradeify / TradingView paste — never send OANDA orders,
 * even if OANDA_EXECUTE_ORDERS is set true in the environment.
 * Run: npx tsx __tests__/oanda_tradeify_no_orders.test.ts
 */

process.env.OANDA_API_KEY = 'test-key'
process.env.OANDA_ACCOUNT_ID = 'test-account'
process.env.OANDA_ENVIRONMENT = 'practice'
process.env.OANDA_EXECUTE_ORDERS = 'true'

import assert from 'node:assert/strict'
import { shouldExecuteOandaOrders } from '../lib/oanda/config'

assert.equal(
  shouldExecuteOandaOrders(),
  false,
  'Tradeify desk must never execute OANDA orders'
)

console.log('oanda_tradeify_no_orders.test.ts: all assertions passed')
