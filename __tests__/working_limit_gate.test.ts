/**
 * One working limit at a time.
 * Run: npx tsx __tests__/working_limit_gate.test.ts
 */
import assert from 'node:assert/strict'
import { WORKING_LIMIT_ALREADY_MESSAGE } from '../lib/trading/workingLimitGate'

{
  assert.match(WORKING_LIMIT_ALREADY_MESSAGE, /working limit is already open/i)
  assert.match(WORKING_LIMIT_ALREADY_MESSAGE, /cancel/i)
}

console.log('working_limit_gate: all passed')
