/**
 * A Dow live quote must not take a Nasdaq book, and MNQ P&L is $2/pt.
 * Run: npx tsx __tests__/desk_exit_guard.test.ts
 */

import assert from 'node:assert/strict'
import {
  deskFuturesCashPnl,
  liveDeskPointValue,
  quoteBelongsToBook,
} from '../lib/trading/deskExitGuard'

assert.equal(liveDeskPointValue('NASDAQ'), 2)
assert.equal(liveDeskPointValue('DOW'), 0.5)

assert.equal(
  deskFuturesCashPnl({
    instrument: 'NASDAQ',
    direction: 'LONG',
    entry: 30112,
    exit: 30156,
    qty: 5,
  }),
  440,
  '5 MNQ × 44 pts × $2'
)

assert.equal(
  quoteBelongsToBook({ instrument: 'NASDAQ', entry: 30112, quote: 30090 }),
  true,
  'MNQ quote on MNQ book'
)

assert.equal(
  quoteBelongsToBook({ instrument: 'NASDAQ', entry: 30112, quote: 53490.65 }),
  false,
  'Dow quote must not belong on MNQ book'
)

assert.equal(
  quoteBelongsToBook({ instrument: 'DOW', entry: 53684, quote: 53702 }),
  true,
  'Dow quote on Dow book'
)

console.log('desk_exit_guard.test.ts: all assertions passed')
