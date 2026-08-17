/**
 * Order history must hide cancelled / OANDA-ghost fills so they cannot eat the tape.
 * Run: npx tsx __tests__/journal_history.test.ts
 */

import assert from 'node:assert/strict'
import { isVisibleLiveJournalRow } from '../lib/trading/journalHistory'

assert.equal(
  isVisibleLiveJournalRow({
    fill_status: 'filled',
    exit_reason: 'manual',
    notes: 'TV flatten',
  }),
  true,
  'real filled trade stays on the tape'
)

assert.equal(
  isVisibleLiveJournalRow({
    fill_status: 'cancelled',
    exit_reason: 'stop_hit',
    notes: null,
  }),
  false,
  'cancelled row must not show even if leftover exit_reason is stop_hit'
)

assert.equal(
  isVisibleLiveJournalRow({
    fill_status: 'filled',
    exit_reason: 'broker_rejected',
    notes: null,
  }),
  false,
  'OANDA reject must not show as a stop'
)

assert.equal(
  isVisibleLiveJournalRow({
    fill_status: 'working',
    exit_reason: null,
    notes: null,
  }),
  false,
  'working limits are not order history'
)

assert.equal(
  isVisibleLiveJournalRow({
    fill_status: 'filled',
    exit_reason: 'stop_hit',
    notes: 'OANDA order failed: insufficient margin',
  }),
  false,
  'failed broker notes stay off the tape'
)

console.log('journal_history.test.ts: all assertions passed')
