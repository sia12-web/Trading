/**
 * Working-limit bracket amend — SL locked, TP editable.
 * Run: npx tsx __tests__/working_bracket_update.test.ts
 */
import assert from 'node:assert/strict'
import {
  assertWorkingStopLocked,
  validateWorkingBracketUpdate,
  WORKING_SL_LOCKED_MESSAGE,
} from '../lib/trading/workingBracketUpdate'

{
  const ok = validateWorkingBracketUpdate({
    entryPrice: 40000,
    direction: 'LONG',
    profitTargetPrice: 40300,
    currentStopLoss: 39850,
    currentProfitTarget: 40200,
  })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.stopLossPrice, 39850)
    assert.equal(ok.profitTargetPrice, 40300)
    assert.equal(ok.changedSl, false)
    assert.equal(ok.changedTp, true)
  }
}

{
  const blocked = validateWorkingBracketUpdate({
    entryPrice: 40000,
    direction: 'LONG',
    stopLossPrice: 39700,
    profitTargetPrice: 40200,
    currentStopLoss: 39850,
    currentProfitTarget: 40200,
  })
  assert.equal(blocked.ok, false)
  if (!blocked.ok) {
    assert.equal(blocked.error, WORKING_SL_LOCKED_MESSAGE)
    assert.equal(blocked.slLocked, true)
  }
}

{
  const badTp = validateWorkingBracketUpdate({
    entryPrice: 40000,
    direction: 'LONG',
    profitTargetPrice: 39900,
    currentStopLoss: 39850,
    currentProfitTarget: 40200,
  })
  assert.equal(badTp.ok, false)
  if (!badTp.ok) assert.match(badTp.error, /above entry/i)
}

{
  const lock = assertWorkingStopLocked(39850, 39850, 40000)
  assert.equal(lock.ok, true)
  const drift = assertWorkingStopLocked(39700, 39850, 40000)
  assert.equal(drift.ok, false)
}

console.log('working_bracket_update: all passed')
