/**
 * Questrade book pairing + Tradeify transfer (stock prices are not MNQ prices).
 * Run: npx tsx __tests__/questrade_book.test.ts
 */

import assert from 'node:assert/strict'
import {
  pairQuestradeBook,
  parseQuestradeSymbol,
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
assert.equal(suggestTradeifyIndex('AAPL  21Aug26C150.00'), 'NASDAQ')
const opt = parseQuestradeSymbol('AAPL  21Aug26C150.00')
assert.equal(opt?.asset, 'option')
assert.equal(opt?.label, 'AAPL 21AUG26 $150 Call')
assert.equal(opt?.multiplier, 100)

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
  positions: [
    {
      symbol: 'AAPL',
      openQuantity: 1,
      averageEntryPrice: 306.71,
      currentPrice: 305.93,
      openPnl: -0.78,
    },
  ],
})

assert.equal(book.workingLimits.length, 1)
const msft = book.workingLimits[0]
const aapl = book.openPositions[0]
const hist = book.history[0]
assert.ok(msft && aapl && hist)
assert.equal(msft.symbol, 'MSFT')
assert.equal(msft.kind, 'entry_limit')
assert.equal(aapl.symbol, 'AAPL')
assert.equal(aapl.stop, 300)
assert.equal(aapl.target, 320)
assert.equal(aapl.livePnl, -0.78)
assert.equal(aapl.mark, 305.93)
assert.equal(hist.symbol, 'AAPL')

const optionBook = pairQuestradeBook({
  orders: [
    {
      id: 30,
      symbol: 'QQQ  06Aug26C670.00',
      side: 'Buy',
      orderType: 'Limit',
      state: 'Executed',
      totalQuantity: 1,
      avgExecPrice: 23.73,
    },
    {
      id: 31,
      symbol: 'QQQ  06Aug26C670.00',
      side: 'Sell',
      orderType: 'Stop',
      state: 'Working',
      totalQuantity: 1,
      stopPrice: 18,
      parentId: 30,
    },
    {
      id: 32,
      symbol: 'QQQ  06Aug26C670.00',
      side: 'Sell',
      orderType: 'Limit',
      state: 'Working',
      totalQuantity: 1,
      limitPrice: 30,
      parentId: 30,
    },
  ],
  positions: [
    {
      symbol: 'QQQ  06Aug26C670.00',
      openQuantity: 1,
      averageEntryPrice: 23.73,
      currentPrice: 26.1,
      openPnl: 237,
    },
  ],
})
const qqq = optionBook.openPositions[0]
assert.ok(qqq)
assert.equal(qqq.asset, 'option')
assert.equal(qqq.stop, 18)
assert.equal(qqq.target, 30)
assert.equal(qqq.livePnl, 237)
assert.equal(qqq.stockRiskDollars, 573)

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
  row: aapl,
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
  row: msft,
  advice,
})
assert.equal(noIndex.ticket, null)
assert.match(noIndex.note, /No index last/)

assert.equal(book.levels.length, 2)
assert.ok(book.levels.some((l) => l.kind === 'sl' && l.price === 300 && l.status === 'working'))
assert.ok(book.levels.some((l) => l.kind === 'tp' && l.price === 320 && l.status === 'working'))

const now = new Date('2026-08-15T21:00:00-04:00')
const optionSides = pairQuestradeBook({
  now,
  orders: [
    {
      id: 40,
      symbol: 'NVDA  22Aug26C180.00',
      side: 'BTO',
      orderType: 'Limit',
      state: 'Executed',
      totalQuantity: 2,
      avgExecPrice: 6.4,
      orderGroupId: 900,
      orderClass: 'Primary',
      updateTime: '2026-08-15T14:00:00Z',
    },
    {
      id: 41,
      symbol: 'NVDA  22Aug26C180.00',
      side: 'STC',
      orderType: 'TrailStopInDollar',
      state: 'Accepted',
      totalQuantity: 2,
      stopPrice: 4.1,
      orderGroupId: 900,
      orderClass: 'StopLoss',
      updateTime: '2026-08-15T14:01:00Z',
    },
    {
      id: 42,
      symbol: 'NVDA  22Aug26C180.00',
      side: 'STC',
      orderType: 'Limit',
      state: 'ContingentOrder',
      totalQuantity: 2,
      limitPrice: 9.2,
      orderGroupId: 900,
      orderClass: 'Limit',
      updateTime: '2026-08-15T14:01:00Z',
    },
  ],
  positions: [
    {
      symbol: 'NVDA  22Aug26C180.00',
      openQuantity: 2,
      averageEntryPrice: 6.4,
      currentPrice: 7.1,
      openPnl: 140,
    },
  ],
})
const nvda = optionSides.openPositions[0]
assert.ok(nvda)
assert.equal(nvda.stop, 4.1)
assert.equal(nvda.target, 9.2)
assert.equal(nvda.stopStatus, 'working')
assert.equal(nvda.targetStatus, 'working')

const flattened = pairQuestradeBook({
  now,
  orders: [
    {
      id: 50,
      symbol: 'AMD',
      side: 'Buy',
      orderType: 'Limit',
      state: 'Executed',
      totalQuantity: 10,
      avgExecPrice: 160,
      updateTime: '2026-08-15T15:00:00Z',
    },
    {
      id: 51,
      symbol: 'AMD',
      side: 'Sell',
      orderType: 'Stop',
      state: 'Canceled',
      totalQuantity: 10,
      stopPrice: 154,
      parentId: 50,
      updateTime: '2026-08-15T15:40:00Z',
    },
    {
      id: 52,
      symbol: 'AMD',
      side: 'Sell',
      orderType: 'Limit',
      state: 'Canceled',
      totalQuantity: 10,
      limitPrice: 172,
      parentId: 50,
      updateTime: '2026-08-15T15:40:00Z',
    },
  ],
})
const amd = flattened.history[0]
assert.ok(amd)
assert.equal(amd.stop, 154)
assert.equal(amd.target, 172)
assert.equal(amd.stopStatus, 'cancelled')
assert.equal(amd.targetStatus, 'cancelled')
assert.ok(flattened.levels.some((l) => l.kind === 'sl' && l.price === 154 && l.status === 'cancelled'))
assert.ok(flattened.levels.some((l) => l.kind === 'tp' && l.price === 172 && l.status === 'cancelled'))

const orphanStop = pairQuestradeBook({
  now,
  orders: [
    {
      id: 61,
      symbol: 'META  22Aug26P500.00',
      side: 'STC',
      orderType: 'StopLimit',
      state: 'Working',
      totalQuantity: 1,
      stopPrice: 8.5,
      limitPrice: 8.4,
      parentId: 999,
      updateTime: '2026-08-15T16:00:00Z',
    },
  ],
  positions: [
    {
      symbol: 'META  22Aug26P500.00',
      openQuantity: 1,
      averageEntryPrice: 12,
      currentPrice: 11,
      openPnl: -100,
    },
  ],
})
const meta = orphanStop.openPositions[0]
assert.ok(meta)
assert.equal(meta.stop, 8.5)
assert.equal(orphanStop.levels.length, 1)
assert.equal(orphanStop.levels[0]?.kind, 'sl')

console.log('questrade_book.test.ts: ok')
