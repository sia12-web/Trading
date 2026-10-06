/**
 * Questrade book pairing + Tradeify transfer (stock prices are not MNQ prices).
 * Run: npx tsx __tests__/questrade_book.test.ts
 */

import assert from 'node:assert/strict'
import {
  buildClosedTradeHistory,
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
assert.ok(msft && aapl)
assert.equal(msft.symbol, 'MSFT')
assert.equal(msft.kind, 'entry_limit')
assert.equal(aapl.symbol, 'AAPL')
assert.equal(aapl.stop, 300)
assert.equal(aapl.target, 320)
assert.equal(aapl.livePnl, -0.78)
assert.equal(aapl.mark, 305.93)
// Open entry fills must NOT appear as closed history / fake wins
assert.equal(book.history.length, 0)

// Closed round-trip: entry + stop fill → realized LOSS (not projected TP win)
const closedBook = pairQuestradeBook({
  orders: [
    {
      id: 40,
      symbol: 'NVDA',
      side: 'Buy',
      orderType: 'Limit',
      state: 'Executed',
      totalQuantity: 10,
      avgExecPrice: 100,
      updateTime: '2026-09-01T14:00:00Z',
    },
    {
      id: 41,
      symbol: 'NVDA',
      side: 'Sell',
      orderType: 'Stop',
      state: 'Executed',
      totalQuantity: 10,
      avgExecPrice: 95,
      stopPrice: 95,
      parentId: 40,
      updateTime: '2026-09-01T15:00:00Z',
    },
    {
      id: 42,
      symbol: 'NVDA',
      side: 'Sell',
      orderType: 'Limit',
      state: 'Cancelled',
      totalQuantity: 10,
      limitPrice: 110,
      parentId: 40,
      updateTime: '2026-09-01T15:00:00Z',
    },
  ],
  positions: [],
})
assert.equal(closedBook.openPositions.length, 0)
assert.equal(closedBook.history.length, 1)
const nvdaClose = closedBook.history[0]!
assert.equal(nvdaClose.symbol, 'NVDA')
assert.equal(nvdaClose.status, 'closed')
assert.equal(nvdaClose.entry, 100)
assert.equal(nvdaClose.exit, 95)
assert.equal(nvdaClose.pnl, -50)
assert.equal(nvdaClose.quantity, 10)
assert.equal(nvdaClose.side, 'BUY')

const fifoClosed = buildClosedTradeHistory([
  {
    id: 50,
    symbol: 'TSLA',
    side: 'Buy',
    orderType: 'Limit',
    state: 'Executed',
    totalQuantity: 2,
    avgExecPrice: 200,
    updateTime: '2026-09-02T14:00:00Z',
  },
  {
    id: 51,
    symbol: 'TSLA',
    side: 'Sell',
    orderType: 'Limit',
    state: 'Executed',
    totalQuantity: 2,
    avgExecPrice: 220,
    updateTime: '2026-09-02T16:00:00Z',
  },
])
assert.equal(fifoClosed.length, 1)
assert.equal(fifoClosed[0]!.pnl, 40)
assert.equal(fifoClosed[0]!.exit, 220)

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
assert.equal(transfer.fillNumber, 1)
assert.equal(transfer.tradeifyRiskDollars, 400)
assert.equal(transfer.canSize, true)
assert.match(transfer.riskLabel, /Risk · \$400/)

const secondAdvice = teamCopyAdviceFromInput({
  now: midday,
  fillsUsed: 1,
  clockedIn: true,
})
const secondXfer = buildQuestradeTradeifyTransfer({
  row: aapl,
  advice: secondAdvice,
  indexLast: { NASDAQ: 20000, DOW: 39000 },
})
assert.equal(secondXfer.fillNumber, 2)
assert.equal(secondXfer.tradeifyRiskDollars, 250)
assert.ok(secondXfer.ticket)
assert.ok(transfer.ticket && secondXfer.ticket.qty <= transfer.ticket.qty)

const thirdAdvice = teamCopyAdviceFromInput({
  now: midday,
  fillsUsed: 2,
  clockedIn: true,
})
const thirdXfer = buildQuestradeTradeifyTransfer({
  row: aapl,
  advice: thirdAdvice,
  indexLast: { NASDAQ: 20000, DOW: 39000 },
})
assert.equal(thirdXfer.fillNumber, 3)
assert.equal(thirdXfer.tradeifyRiskDollars, 150)

const flattenAdvice = teamCopyAdviceFromInput({
  now: new Date('2026-08-18T17:05:00-04:00'),
  fillsUsed: 2,
  clockedIn: true,
})
const flattenXfer = buildQuestradeTradeifyTransfer({
  row: aapl,
  advice: flattenAdvice,
  indexLast: { NASDAQ: 20000, DOW: 39000 },
})
assert.equal(flattenXfer.sessionReset, true)
assert.equal(flattenXfer.fillNumber, 1)
assert.equal(flattenXfer.tradeifyRiskDollars, 400)
assert.equal(flattenXfer.canSize, false)
assert.match(flattenXfer.riskLabel, /next risk/)

const fullAdvice = teamCopyAdviceFromInput({
  now: midday,
  fillsUsed: 3,
  clockedIn: true,
})
const fullXfer = buildQuestradeTradeifyTransfer({
  row: aapl,
  advice: fullAdvice,
  indexLast: { NASDAQ: 20000, DOW: 39000 },
})
assert.equal(fullXfer.canSize, false)
assert.equal(fullXfer.ticket, null)

const optionXfer = buildQuestradeTradeifyTransfer({
  row: qqq,
  advice,
  indexLast: { NASDAQ: 20000, DOW: 39000 },
})
assert.equal(optionXfer.ticket, null)
assert.equal(optionXfer.tradeifyRiskDollars, 400)
assert.equal(optionXfer.fillNumber, 1)
assert.match(optionXfer.note, /Option/)

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
    // Manual flatten exit — required for realized closed history
    {
      id: 53,
      symbol: 'AMD',
      side: 'Sell',
      orderType: 'Market',
      state: 'Executed',
      totalQuantity: 10,
      avgExecPrice: 158,
      updateTime: '2026-08-15T15:45:00Z',
    },
  ],
})
const amd = flattened.history[0]
assert.ok(amd)
assert.equal(amd.status, 'closed')
assert.equal(amd.entry, 160)
assert.equal(amd.exit, 158)
assert.equal(amd.pnl, -20)
assert.equal(amd.stop, 154)
assert.equal(amd.target, 172)
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
// Test TP and SL placed days later without parentId / orderGroupId
const delayedBook = pairQuestradeBook({
  now: new Date('2026-09-10T12:00:00Z'),
  orders: [
    // Entry placed on Aug 20
    {
      id: 1001,
      symbol: 'SPY',
      side: 'Buy',
      orderType: 'Limit',
      state: 'Executed',
      totalQuantity: 1,
      avgExecPrice: 765,
      creationTime: '2026-08-20T10:00:00Z',
      updateTime: '2026-08-20T10:05:00Z',
    },
    // Working entry limit placed later (unexecuted)
    {
      id: 1002,
      symbol: 'SPY',
      side: 'Buy',
      orderType: 'Limit',
      state: 'Accepted',
      totalQuantity: 1,
      limitPrice: 755,
      creationTime: '2026-09-05T10:00:00Z',
      updateTime: '2026-09-05T10:00:00Z',
    },
    // Take Profit placed on Sep 9 (20 days later!) without parentId
    {
      id: 1003,
      symbol: 'SPY',
      side: 'Sell',
      orderType: 'Limit',
      state: 'Accepted',
      totalQuantity: 1,
      limitPrice: 772,
      creationTime: '2026-09-09T09:00:00Z',
      updateTime: '2026-09-09T09:00:00Z',
    },
    // Stop loss placed on Sep 9 without parentId
    {
      id: 1004,
      symbol: 'SPY',
      side: 'Sell',
      orderType: 'Stop',
      state: 'Accepted',
      totalQuantity: 1,
      stopPrice: 740,
      creationTime: '2026-09-09T09:05:00Z',
      updateTime: '2026-09-09T09:05:00Z',
    },
  ],
  positions: [
    {
      symbol: 'SPY',
      openQuantity: 1,
      averageEntryPrice: 765,
      currentPrice: 761,
      openPnl: -4,
    },
  ],
})

const delayedSpy = delayedBook.openPositions[0]
assert.ok(delayedSpy, 'SPY open position must exist')
assert.equal(delayedSpy.entry, 765)
assert.equal(delayedSpy.target, 772, 'SPY TP placed 20 days later must be attached')
assert.equal(delayedSpy.targetStatus, 'working')
assert.equal(delayedSpy.stop, 740, 'SPY SL placed 20 days later must be attached')
assert.equal(delayedSpy.stopStatus, 'working')

const unexecutedSpyLimit = delayedBook.workingLimits.find((w) => w.sourceId === '1002')
assert.ok(unexecutedSpyLimit, 'Working buy limit 1002 must exist')
assert.equal(unexecutedSpyLimit.entry, 755)
assert.equal(unexecutedSpyLimit.target, null, 'Unexecuted working limit must NOT borrow position TP')
assert.equal(unexecutedSpyLimit.stop, null, 'Unexecuted working limit must NOT borrow position SL')

const meta = parseQuestradeSymbol('META23Oct26P680.00')
assert.equal(meta?.asset, 'option')
assert.equal(meta?.underlying, 'META')
assert.equal(meta?.multiplier, 100)
assert.equal(meta?.label, 'META 23OCT26 $680 Put')

const qqqSym = parseQuestradeSymbol('QQQ6Aug26C670.00')
assert.equal(qqqSym?.asset, 'option')
assert.equal(qqqSym?.label, 'QQQ 06AUG26 $670 Call')
assert.equal(qqqSym?.multiplier, 100)

const activityBook = pairQuestradeBook({
  orders: [
    {
      id: 1,
      symbol: 'META23Oct26P680.00',
      side: 'BTO',
      orderType: 'Market',
      state: 'Executed',
      totalQuantity: 1,
      filledQuantity: 1,
      avgExecPrice: 35.25,
      updateTime: '2026-09-16T15:14:35.301000-04:00',
    },
  ],
  positions: [
    {
      symbol: 'META23Oct26P680.00',
      openQuantity: 1,
      averageEntryPrice: 35.25,
      currentPrice: 6.27,
      openPnl: -2898,
    },
  ],
  activities: [
    {
      type: 'Trades',
      action: 'Buy',
      symbol: 'QQQ6Aug26C670.00',
      quantity: 1,
      price: 23.73,
      grossAmount: -2373,
      commission: -0.99,
      netAmount: -2373.99,
      tradeDate: '2026-07-27T00:00:00.000000-04:00',
    },
    {
      type: 'Trades',
      action: 'Sell',
      symbol: 'QQQ6Aug26C670.00',
      quantity: -1,
      price: 26.67,
      grossAmount: 2667,
      commission: -0.06,
      netAmount: 2666.94,
      tradeDate: '2026-07-31T00:00:00.000000-04:00',
    },
    {
      type: 'Trades',
      action: 'Buy',
      symbol: 'META23Oct26P680.00',
      quantity: 1,
      price: 35.25,
      netAmount: -3525,
      tradeDate: '2026-09-16T00:00:00.000000-04:00',
    },
    {
      type: 'Dividends',
      action: 'DIV',
      symbol: 'GOOG',
      netAmount: 1.2,
      tradeDate: '2026-09-01T00:00:00.000000-04:00',
    },
  ],
})
const metaPos = activityBook.openPositions[0]
assert.ok(metaPos)
assert.equal(metaPos.asset, 'option')
assert.equal(metaPos.livePnl, -2898)
assert.equal(metaPos.multiplier, 100)
assert.equal(activityBook.history.length, 1)
assert.equal(activityBook.history[0]!.symbol, 'QQQ6AUG26C670.00')
assert.equal(activityBook.history[0]!.pnl, 292.95)
assert.equal(activityBook.history[0]!.multiplier, 100)
assert.equal(activityBook.history[0]!.quantity, 1)

console.log('questrade_book.test.ts: ok')
