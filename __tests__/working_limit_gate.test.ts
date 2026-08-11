/**
 * One working limit at a time + refresh must not cancel.
 * Run: npx tsx __tests__/working_limit_gate.test.ts
 */
import assert from 'node:assert/strict'
import {
  WORKING_LIMIT_ALREADY_MESSAGE,
  formatWorkingLimitAlreadyMessage,
  shouldCancelWorkingForGate,
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

{
  // Refresh/remount: first gate observation while clocked out must KEEP (hydrate ghost)
  assert.equal(
    shouldCancelWorkingForGate({
      phase: 'ENTRY',
      clockedIn: false,
      hadClockedIn: null,
      hasPending: true,
    }),
    'keep',
    'refresh while clocked-out must not cancel'
  )
  assert.equal(
    shouldCancelWorkingForGate({
      phase: 'ENTRY',
      clockedIn: true,
      hadClockedIn: null,
      hasPending: true,
    }),
    'keep',
    'refresh while clocked-in must not cancel'
  )
  // True clock-out transition cancels
  assert.equal(
    shouldCancelWorkingForGate({
      phase: 'ENTRY',
      clockedIn: false,
      hadClockedIn: true,
      hasPending: true,
    }),
    'cancel',
    'clock-out transition cancels'
  )
  // Window gap / day end
  assert.equal(
    shouldCancelWorkingForGate({
      phase: 'FLAT',
      clockedIn: true,
      hadClockedIn: true,
      hasPending: true,
    }),
    'cancel',
    'FLAT window gap cancels'
  )
  assert.equal(
    shouldCancelWorkingForGate({
      phase: 'DONE',
      clockedIn: true,
      hadClockedIn: true,
      hasPending: true,
    }),
    'expire-via-cleanup',
    'DONE clears via cleanup'
  )
  assert.equal(
    shouldCancelWorkingForGate({
      phase: 'ENTRY',
      clockedIn: true,
      hadClockedIn: true,
      hasPending: false,
    }),
    'keep',
    'no pending → keep'
  )
}

console.log('working_limit_gate: all passed')
