/**
 * Order history must hide cancelled / OANDA-ghost fills so they cannot eat the tape.
 * Run: npx tsx __tests__/journal_history.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isVisibleLiveJournalRow, journalTicketEquity, isLiveJournalInstrument } from '../lib/trading/journalHistory'
import { TRADEIFY_STARTING_BALANCE } from '../lib/trading/tradeifyGrowth50k'

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

const emptyEquity = journalTicketEquity([])
assert.equal(emptyEquity.equitySource, 'journal_ticket')
assert.equal(emptyEquity.startingAccount, TRADEIFY_STARTING_BALANCE)
assert.equal(emptyEquity.endingEquity, TRADEIFY_STARTING_BALANCE)
assert.equal(emptyEquity.equityChange, 0)
assert.equal(isLiveJournalInstrument('GOLD'), true, 'GOLD is a live journal book')
assert.equal(isLiveJournalInstrument('CRUDE'), true, 'CRUDE is a live journal book')
assert.equal(isLiveJournalInstrument('EURUSD'), false, 'spot FX stays off the live tape')

const dow = journalTicketEquity([
  {
    id: 'dow-1',
    account_size: 50_000,
    entry_timestamp: '2026-08-17T14:06:19Z',
    exit_timestamp: '2026-08-17T14:07:54Z',
    profit_loss: 90,
  },
])
assert.equal(dow.startingAccount, 50_000)
assert.equal(dow.endingEquity, 50_090)
assert.equal(dow.equityChange, 90)
assert.equal(dow.equityBefore.get('dow-1'), 50_000)
assert.equal(dow.equityAfter.get('dow-1'), 50_090)

const skipped = journalTicketEquity([
  { account_size: 50_000, profit_loss: 10, exit_timestamp: '2026-08-17T14:00:00Z' },
])
assert.equal(skipped.endingEquity, TRADEIFY_STARTING_BALANCE, 'rows without id do not move equity')

const offDesk = journalTicketEquity([
  {
    id: 'gold-1',
    account_size: 50_000,
    entry_timestamp: '2026-08-18T14:34:42Z',
    exit_timestamp: '2026-08-18T14:35:11Z',
    profit_loss: 36.68,
  },
  {
    id: 'crude-1',
    account_size: 50_000,
    entry_timestamp: '2026-08-18T14:36:29Z',
    exit_timestamp: '2026-08-18T14:36:47Z',
    profit_loss: 7.68,
  },
])
assert.equal(offDesk.endingEquity, 50_044.36)
assert.equal(offDesk.equityChange, 44.36)

const journalPage = readFileSync('app/dashboard/journal/page.tsx', 'utf8')
assert.ok(!/OANDA LIVE/.test(journalPage), 'order history must not paint OANDA LIVE')
assert.ok(!/oanda_account/.test(journalPage), 'order history must not bind OANDA account summary')
assert.ok(
  !/getOandaAccountSummary/.test(readFileSync('app/api/trading/journal/route.ts', 'utf8')),
  'journal API must not fetch OANDA equity'
)
assert.ok(/GOLD/.test(journalPage) && /CRUDE/.test(journalPage), 'live order history can filter GOLD and CRUDE')

console.log('journal_history.test.ts: all assertions passed')
