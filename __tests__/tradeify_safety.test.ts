/**
 * Tradeify eval safety: open reserve, EOD peak, hedge, news, holiday flatten.
 * Run: npx tsx __tests__/tradeify_safety.test.ts
 */

import assert from 'node:assert/strict'
import {
  resolveTradeifyPlace,
  tradeifyMustFlatten,
  tradeifyIsEarlyCloseDay,
  tradeifyPlaceHaircut,
} from '../lib/trading/tradeifyGrowth50k'
import {
  equityIndexHedgeConflict,
  isTradeifyRedNewsEvent,
  openRiskReserved,
  peakEodFromFills,
  realizedSessionPnl,
  tradeifyRedNewsBlocks,
} from '../lib/trading/tradeifySafety'

const midday = new Date('2026-08-18T11:30:00-04:00')

assert.equal(tradeifyPlaceHaircut(0), 75)
assert.equal(tradeifyPlaceHaircut(1), 95)

const openLong = {
  instrument: 'DOW',
  fill_status: 'filled',
  entry_direction: 'LONG',
  risk_amount: 400,
  profit_loss: -120,
}
assert.equal(openRiskReserved([openLong]), 400, 'open reserves the stop, not just mark')
assert.equal(realizedSessionPnl([openLong]), 0)

const closed = {
  ...openLong,
  exit_reason: 'stop_hit',
  exit_timestamp: midday.toISOString(),
  profit_loss: -400,
}
assert.equal(openRiskReserved([closed]), 0)
assert.equal(realizedSessionPnl([closed]), -400)

const priorSessionClose = {
  instrument: 'NASDAQ',
  fill_status: 'filled',
  entry_timestamp: '2026-08-16T20:00:00.000Z',
  exit_timestamp: '2026-08-17T15:00:00.000Z',
  exit_reason: 'take_profit',
  profit_loss: 1500,
}
assert.equal(peakEodFromFills([priorSessionClose], midday), 51_500)

const afterGreenPeak = resolveTradeifyPlace({
  now: midday,
  fillsUsed: 0,
  dailyPnl: 0,
  peakEodBalance: 51_500,
  equity: 51_500,
})
assert.equal(afterGreenPeak.floorLevel, 49_500)
assert.ok(afterGreenPeak.floorRoom <= 2000)

const stackedOpen = resolveTradeifyPlace({
  now: midday,
  fillsUsed: 1,
  dailyPnl: 0,
  openReserved: 400,
})
assert.equal(stackedOpen.leftoverDll, 850)
assert.ok(stackedOpen.riskDollars <= 250)

assert.equal(
  equityIndexHedgeConflict(
    [{ instrument: 'DOW', fill_status: 'filled', entry_direction: 'LONG' }],
    'NASDAQ',
    'SHORT'
  ),
  true
)
assert.equal(
  equityIndexHedgeConflict(
    [{ instrument: 'DOW', fill_status: 'filled', entry_direction: 'LONG' }],
    'NASDAQ',
    'LONG'
  ),
  false
)

const hedgePlace = resolveTradeifyPlace({
  now: midday,
  fillsUsed: 0,
  dailyPnl: 0,
  hedgeBlocked: true,
})
assert.equal(hedgePlace.allowed, false)
assert.equal(hedgePlace.refuseReason, 'hedge_conflict')

assert.ok(isTradeifyRedNewsEvent('United States CPI'))
assert.ok(isTradeifyRedNewsEvent('FOMC Rate Decision'))
assert.ok(isTradeifyRedNewsEvent('Non-Farm Payrolls'))
assert.ok(!isTradeifyRedNewsEvent('Existing Home Sales'))

const newsMs = midday.getTime()
const newsLock = tradeifyRedNewsBlocks(
  [{ time: String(Math.floor(newsMs / 1000)), event: 'CPI', impact: 'high' }],
  midday
)
assert.equal(newsLock, true)
const newsPlace = resolveTradeifyPlace({ now: midday, fillsUsed: 0, dailyPnl: 0, newsBlocked: true })
assert.equal(newsPlace.allowed, false)
assert.equal(newsPlace.refuseReason, 'news_lock')

const holiday = new Date('2026-11-27T13:05:00-05:00')
assert.equal(tradeifyIsEarlyCloseDay(holiday), true)
assert.equal(tradeifyMustFlatten(holiday), true)
assert.equal(tradeifyMustFlatten(new Date('2026-11-27T12:00:00-05:00')), false)
assert.equal(tradeifyMustFlatten(midday), false)

const tightPlaceable = resolveTradeifyPlace({ now: midday, fillsUsed: 0, dailyPnl: -1200 })
assert.equal(tightPlaceable.allowed, false, 'leftover $50 minus $75 haircut is under min')

console.log('tradeify_safety.test.ts: all assertions passed')
