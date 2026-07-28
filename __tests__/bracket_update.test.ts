/**
 * Bracket update validation unit tests.
 * Run: npx tsx __tests__/bracket_update.test.ts
 */
import assert from 'node:assert/strict'
import { validateBracketUpdate } from '../lib/trading/bracketUpdate'

{
  const ok = validateBracketUpdate({
    entryPrice: 40000,
    direction: 'LONG',
    stopLossPrice: 39900,
    profitTargetPrice: 40200,
    currentStopLoss: 39850,
    currentProfitTarget: 40150,
  })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.stopLossPrice, 39900)
    assert.equal(ok.profitTargetPrice, 40200)
    assert.equal(ok.changedSl, true)
    assert.equal(ok.changedTp, true)
  }
}

{
  const bad = validateBracketUpdate({
    entryPrice: 40000,
    direction: 'LONG',
    stopLossPrice: 40100,
    currentStopLoss: 39900,
    currentProfitTarget: 40200,
  })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.error, /below entry/i)
}

{
  const bad = validateBracketUpdate({
    entryPrice: 40000,
    direction: 'SHORT',
    profitTargetPrice: 40100,
    currentStopLoss: 40150,
    currentProfitTarget: 39800,
  })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.error, /below entry/i)
}

{
  const noop = validateBracketUpdate({
    entryPrice: 40000,
    direction: 'long',
    stopLossPrice: 39900,
    currentStopLoss: 39900,
    currentProfitTarget: 40200,
  })
  assert.equal(noop.ok, false)
  if (!noop.ok) assert.equal(noop.error, 'No change')
}

{
  const slOnly = validateBracketUpdate({
    entryPrice: 18000,
    direction: 'SHORT',
    stopLossPrice: 18100,
    currentStopLoss: 18200,
    currentProfitTarget: 17500,
  })
  assert.equal(slOnly.ok, true)
  if (slOnly.ok) {
    assert.equal(slOnly.changedSl, true)
    assert.equal(slOnly.changedTp, false)
    assert.equal(slOnly.profitTargetPrice, 17500)
  }
}

console.log('bracket_update: all passed')
