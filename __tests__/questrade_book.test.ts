/**
 * Questrade book pairing + Tradeify transfer (stock prices are not MNQ prices).
 * Run: npx tsx __tests__/questrade_book.test.ts
 */

import assert from 'node:assert/strict'
import {
  pairQuestradeBook,
  suggestTradeifyIndex,
} from '../lib/trading/questradeOrders'
import {
  buildQuestradeTradeifyTransfer,
  indexLevelsFromStockR,
  stockRiskPct,
} from '../lib/trading/questradeTransfer'
import { teamCopyAdviceFromInput } from '../lib/trading/teamTape'

const midday = new Date('2026-08-18T11:30:00-04:00')

assert.equal(suggestTradeifyIndex('AAPL'), 'NASDAQ')
assert.equal(suggestTradeifyIndex('JPM'), 'DOW')

const book = pairQuestradeBook({
  orders: [
    {
      id: 10,
      symbol: 'AAPL',
      side: 'Buy',
      orderType: 'Limit',
      state: 'Executed',
      totalQuantity: 1,
      avgExecPrice: 306.71,
      updateTime: '2026-08-10T13:30:00Z',
    },
    {
      id: 11,
      symbol: 'AAPL',
      side: 'Sell',
      orderType: 'Stop',
      state: 'Working',
      totalQuantity: 1,
      stopPrice: 300,
      parentId: 10,
    },
    {
      id: 12,
      symbol: 'AAPL',
      side: 'Sell',
      orderType: 'Limit',
      state: 'Working',
      totalQuantity: 1,
      limitPrice: 320,
      parentId: 10,
    },
    {
      id: 20,
      symbol: 'MSFT',
      side: 'Buy',
      orderType: 'Limit',
      state: 'Working',
      totalQuantity: 5,
      limitPrice: 400,
    },
  ],
  positions: [{ symbol: 'AAPL', openQuantity: 1, averageEntryPrice: 306.71 }],
})

assert.equal(book.workingLimits.length, 1)
assert.equal(book.workingLimits[0].symbol, 'MSFT')
assert.equal(book.workingLimits[0].kind, 'entry_limit')
assert.equal(book.openPositions[0].symbol, 'AAPL')
assert.equal(book.openPositions[0].stop, 300)
assert.equal(book.openPositions[0].target, 320)
assert.equal(book.history[0].symbol, 'AAPL')

const pct = stockRiskPct(306.71, 300)
assert.ok(pct != null && pct > 0.02 && pct < 0.03)
const levels = indexLevelsFromStockR({
  side: 'BUY',
  indexEntry: 20000,
  riskPct: pct,
  stockStop: 300,
  stockEntry: 306.71,
})
assert.ok(levels.stop != null && levels.stop < 20000)
assert.ok(levels.target != null && levels.target > 20000)

const advice = teamCopyAdviceFromInput({
  now: midday,
  fillsUsed: 0,
  clockedIn: true,
})
const transfer = buildQuestradeTradeifyTransfer({
  row: book.openPositions[0],
  advice,
  indexLast: { NASDAQ: 20000, DOW: 39000 },
})
assert.equal(transfer.instrument, 'NASDAQ')
assert.ok(transfer.ticket)
assert.equal(transfer.ticket!.symbol, 'MNQ')
assert.notEqual(transfer.ticket!.entry, 306.71)
assert.ok(transfer.ticket!.entry > 1000)
assert.match(transfer.note, /not your Tradovate size/)

const noIndex = buildQuestradeTradeifyTransfer({
  row: book.workingLimits[0],
  advice,
})
assert.equal(noIndex.ticket, null)
assert.match(noIndex.note, /No index last/)

console.log('questrade_book.test.ts: ok')
