/**
 * Unit tests for Team Tape orders, SL/TP updates (trailing/break-even stops), and symbol real names.
 * Run: npx tsx __tests__/team_tape_updates.test.ts
 */

import assert from 'node:assert/strict'
import {
  pairQuestradeBook,
  parseQuestradeSymbol,
} from '../lib/trading/questradeOrders'
import {
  formatTeamTelegram,
  parseTeamTapeIngest,
  teamTapeTarget1_5R,
} from '../lib/trading/teamTape'
import {
  formatOptionRealName,
  getRealName,
  getSymbolRealName,
} from '../lib/trading/symbolNames'
import { buildQuestradeTradeifyTransfer } from '../lib/trading/questradeTransfer'
import { buildTeamCopyAdvice } from '../lib/trading/teamTape'
import { resolveTradeifyPlace } from '../lib/trading/tradeifyGrowth50k'

// ==========================================
// 1. Symbol Real Names & Option Formatting
// ==========================================

console.log('Testing Symbol Real Names...')

assert.equal(getRealName('AAPL'), 'Apple Inc.')
assert.equal(getRealName('NVDA'), 'NVIDIA Corporation')
assert.equal(getRealName('MSFT'), 'Microsoft Corporation')
assert.equal(getRealName('PLTR'), 'Palantir Technologies Inc.')
assert.equal(getRealName('MSTR'), 'MicroStrategy Inc.')
assert.equal(getRealName('COIN'), 'Coinbase Global Inc.')
assert.equal(getRealName('SPY'), 'SPDR S&P 500 ETF Trust')
assert.equal(getRealName('QQQ'), 'Invesco QQQ Trust (Nasdaq 100)')
assert.equal(getRealName('DIA'), 'SPDR Dow Jones Industrial Average ETF')
assert.equal(getRealName('IWM'), 'iShares Russell 2000 ETF')
assert.equal(getRealName('SOXL'), 'Direxion Daily Semiconductor Bull 3X')
assert.equal(getRealName('SOXS'), 'Direxion Daily Semiconductor Bear 3X')
assert.equal(getRealName('IBIT'), 'iShares Bitcoin Trust ETF')
assert.equal(getRealName('BRK.B'), 'Berkshire Hathaway Inc. (Class B)')

const metaAapl = getSymbolRealName('AAPL')
assert.equal(metaAapl.name, 'Apple Inc.')
assert.equal(metaAapl.shortName, 'Apple')
assert.equal(metaAapl.assetType, 'stock')
assert.equal(metaAapl.sector, 'Technology')

const metaQqq = getSymbolRealName('QQQ')
assert.equal(metaQqq.name, 'Invesco QQQ Trust (Nasdaq 100)')
assert.equal(metaQqq.assetType, 'etf')

// Options real names
const optNvda = formatOptionRealName('NVDA  22Aug26C180.00')
assert.ok(optNvda)
assert.equal(optNvda?.isOption, true)
assert.equal(optNvda?.underlying, 'NVDA')
assert.equal(optNvda?.companyName, 'NVIDIA Corporation')
assert.equal(optNvda?.fullName, 'NVIDIA Corporation · 22Aug26 $180 Call')

const optPltr = formatOptionRealName('PLTR  18Sep26P35.50')
assert.ok(optPltr)
assert.equal(optPltr?.underlying, 'PLTR')
assert.equal(optPltr?.companyName, 'Palantir Technologies Inc.')
assert.equal(optPltr?.fullName, 'Palantir Technologies Inc. · 18Sep26 $35.50 Put')

const optOcc = formatOptionRealName('AAPL  260918C00150000')
assert.ok(optOcc)
assert.equal(optOcc?.underlying, 'AAPL')
assert.equal(optOcc?.companyName, 'Apple Inc.')
assert.equal(optOcc?.fullName, 'Apple Inc. · 26-09-18 $150 Call')

console.log('Symbol Real Names tests passed.')

// ==========================================
// 2. Trailing & Break-Even Stop Loss Updates
// ==========================================

console.log('Testing Trailing & Break-Even Stop Loss Updates...')

// Test case: Trader entered LONG NVDA at $100.
// Trader later moved Stop Loss to $108 (above entry into profit!) and updated TP to $130.
const trailingStopBook = pairQuestradeBook({
  orders: [
    {
      id: 201,
      symbol: 'NVDA',
      side: 'Buy',
      orderType: 'Limit',
      state: 'Executed',
      totalQuantity: 50,
      avgExecPrice: 100,
      updateTime: '2026-09-10T10:00:00Z',
    },
    // Initial stop loss at 92 (cancelled when replaced)
    {
      id: 202,
      symbol: 'NVDA',
      side: 'Sell',
      orderType: 'Stop',
      state: 'Canceled',
      totalQuantity: 50,
      stopPrice: 92,
      parentId: 201,
      updateTime: '2026-09-10T10:01:00Z',
    },
    // Updated Trailing Stop Loss at 108 (above entry!) - currently WORKING
    {
      id: 203,
      symbol: 'NVDA',
      side: 'Sell',
      orderType: 'Stop',
      state: 'Working',
      totalQuantity: 50,
      stopPrice: 108,
      parentId: 201,
      updateTime: '2026-09-10T14:30:00Z',
    },
    // Working Take Profit at 130
    {
      id: 204,
      symbol: 'NVDA',
      side: 'Sell',
      orderType: 'Limit',
      state: 'Working',
      totalQuantity: 50,
      limitPrice: 130,
      parentId: 201,
      updateTime: '2026-09-10T14:30:00Z',
    },
  ],
  positions: [
    {
      symbol: 'NVDA',
      openQuantity: 50,
      averageEntryPrice: 100,
      currentPrice: 115,
      openPnl: 750,
    },
  ],
})

assert.equal(trailingStopBook.openPositions.length, 1)
const nvdaPos = trailingStopBook.openPositions[0]
assert.ok(nvdaPos)
assert.equal(nvdaPos.symbol, 'NVDA')
assert.equal(nvdaPos.companyName, 'NVIDIA Corporation')
assert.equal(nvdaPos.entry, 100)
// The updated trailing stop at 108 MUST be picked (not discarded!)
assert.equal(nvdaPos.stop, 108, 'Trailing stop above entry must be paired correctly')
assert.equal(nvdaPos.stopStatus, 'working')
assert.equal(nvdaPos.target, 130)
assert.equal(nvdaPos.targetStatus, 'working')
assert.equal(nvdaPos.livePnl, 750)

// Test case: Trader entered SHORT PLTR at $30 with initial SL at $33.
// Later moved SL to break-even at $30 or trailed down to $28.
const shortTrailingBook = pairQuestradeBook({
  orders: [
    {
      id: 301,
      symbol: 'PLTR',
      side: 'Sell',
      orderType: 'Limit',
      state: 'Executed',
      totalQuantity: 100,
      avgExecPrice: 30,
      updateTime: '2026-09-12T10:00:00Z',
    },
    // Working stop moved below entry to $28 (locking in $2 profit)
    {
      id: 302,
      symbol: 'PLTR',
      side: 'Buy',
      orderType: 'Stop',
      state: 'Working',
      totalQuantity: 100,
      stopPrice: 28,
      parentId: 301,
      updateTime: '2026-09-12T15:00:00Z',
    },
  ],
  positions: [
    {
      symbol: 'PLTR',
      openQuantity: -100,
      averageEntryPrice: 30,
      currentPrice: 25,
      openPnl: 500,
    },
  ],
})

const pltrPos = shortTrailingBook.openPositions[0]
assert.ok(pltrPos)
assert.equal(pltrPos.symbol, 'PLTR')
assert.equal(pltrPos.companyName, 'Palantir Technologies Inc.')
assert.equal(pltrPos.side, 'SELL')
assert.equal(pltrPos.entry, 30)
assert.equal(pltrPos.stop, 28, 'Short trailing stop below entry must be paired correctly')
assert.equal(pltrPos.stopStatus, 'working')

console.log('Trailing & Break-Even Stop Loss tests passed.')

// ==========================================
// 3. Team Tape Ingest Alias Support & Updates
// ==========================================

console.log('Testing Team Tape Ingest Alias Support...')

const ingestAliases = parseTeamTapeIngest({
  orderId: 'team-ord-99',
  symbol: 'pltr',
  side: 'BUY',
  qty: 300,
  price: 32.5,
  stop_price: 30.0,
  take_profit: 36.25,
  status: 'working',
})

assert.equal(ingestAliases.ok, true)
if (ingestAliases.ok) {
  assert.equal(ingestAliases.signal.sourceId, 'team-ord-99')
  assert.equal(ingestAliases.signal.symbol, 'PLTR')
  assert.equal(ingestAliases.signal.companyName, 'Palantir Technologies Inc.')
  assert.equal(ingestAliases.signal.entry, 32.5)
  assert.equal(ingestAliases.signal.stop, 30.0)
  assert.equal(ingestAliases.signal.target, 36.25)
  assert.equal(ingestAliases.signal.status, 'working')
}

// Ingest with sl / tp aliases and automatic 1.5R target calculation
const ingestSlTp = parseTeamTapeIngest({
  sourceId: 'team-ord-100',
  symbol: 'meta',
  side: 'BUY',
  quantity: 50,
  entry: 500,
  sl: 480,
})

assert.equal(ingestSlTp.ok, true)
if (ingestSlTp.ok) {
  assert.equal(ingestSlTp.signal.symbol, 'META')
  assert.equal(ingestSlTp.signal.companyName, 'Meta Platforms Inc.')
  assert.equal(ingestSlTp.signal.entry, 500)
  assert.equal(ingestSlTp.signal.stop, 480)
  // 1.5R target = 500 + 1.5 * (500 - 480) = 530
  assert.equal(ingestSlTp.signal.target, 530)
}

// Telegram format with company name
const midday = new Date('2026-08-18T11:30:00-04:00')
const place = resolveTradeifyPlace({ now: midday, fillsUsed: 0 })
const advice = buildTeamCopyAdvice({ place, clockedIn: true, now: midday })

if (ingestSlTp.ok) {
  const tgMsg = formatTeamTelegram({ signal: ingestSlTp.signal, advice })
  assert.match(tgMsg, /\[TEAM\] BUY META \(Meta Platforms Inc\.\) × 50 @ 500/)
  assert.match(tgMsg, /SL 480 · 1\.5R 530/)
}

console.log('Team Tape Ingest Alias tests passed.')

// ==========================================
// 4. Tradeify Transfers with Real Names
// ==========================================

console.log('Testing Tradeify Transfers with Real Names...')

const xfer = buildQuestradeTradeifyTransfer({
  row: nvdaPos,
  advice,
  indexLast: { NASDAQ: 20000, DOW: 39000 },
})

assert.equal(xfer.symbol, 'NVDA')
assert.equal(xfer.companyName, 'NVIDIA Corporation')
assert.equal(xfer.realName, 'NVIDIA Corporation')
assert.ok(xfer.ticket)

console.log('Tradeify Transfers tests passed.')
console.log('All team tape update & symbol name tests passed successfully!')
