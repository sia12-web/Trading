/**
 * One working limit at a time.
 * Run: npx tsx __tests__/working_limit_gate.test.ts
 */
import assert from 'node:assert/strict'
import {
  WORKING_LIMIT_ALREADY_MESSAGE,
  formatWorkingLimitAlreadyMessage,
  workingRowToPending,
} from '../lib/trading/workingLimitGate'

{
  assert.match(WORKING_LIMIT_ALREADY_MESSAGE, /working limit is already open/i)
  assert.match(WORKING_LIMIT_ALREADY_MESSAGE, /cancel/i)

  const detailed = formatWorkingLimitAlreadyMessage({
    instrument: 'NIKKEI',
    direction: 'LONG',
    level: 61955,
  })
  assert.match(detailed, /NIKKEI/)
  assert.match(detailed, /61,955|61955/)
  assert.match(detailed, /LONG/i)

  const pending = workingRowToPending({
    instrument: 'DOW',
    entry_price: 42000,
    entry_direction: 'SHORT',
    stop_loss_price: 42100,
    profit_target_price: 41800,
    position_size: 2,
    risk_amount: 500,
    account_size: 100000,
  })
  assert.equal(pending.instrument, 'DOW')
  assert.equal(pending.direction, 'SHORT')
  assert.equal(pending.level, 42000)
}

console.log('working_limit_gate: all passed')
