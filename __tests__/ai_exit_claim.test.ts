/**
 * AI exit claim / Order History idempotency.
 * Run: npx tsx __tests__/ai_exit_claim.test.ts
 */
import assert from 'node:assert/strict'
import {
  countAiExitHistoryWriters,
  formatAiExitDecisionNotes,
  interpretAiExitClaim,
} from '../lib/trading/aiExitClaim'

{
  const won = interpretAiExitClaim({ data: { id: 'pos-1' }, error: null })
  assert.equal(won.kind, 'won')
  if (won.kind === 'won') assert.equal(won.positionId, 'pos-1')
}

{
  const lost = interpretAiExitClaim({ data: null, error: null })
  assert.equal(lost.kind, 'already_closed')
}

{
  const err = interpretAiExitClaim({
    data: null,
    error: { message: 'db down' },
  })
  assert.equal(err.kind, 'error')
  if (err.kind === 'error') assert.match(err.message, /db down/)
}

{
  // Simulate ~20 concurrent polls that all saw the position open: only the first
  // update+select returns a row; the rest see exit_timestamp already set → null.
  const concurrent = [
    { id: 'pos-1' },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]
  assert.equal(countAiExitHistoryWriters(concurrent), 1)
}

{
  assert.equal(
    formatAiExitDecisionNotes('Adverse -0.35% + elevated RVOL — likely reversal'),
    'AI exit: Adverse -0.35% + elevated RVOL — likely reversal'
  )
}

console.log('ai_exit_claim.test.ts: ok')
