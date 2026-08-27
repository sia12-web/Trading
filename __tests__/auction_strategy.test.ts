/**
 * Sequential absorb-breakout auction engine — synthetic 5m RTH bars.
 * Run: npx tsx __tests__/auction_strategy.test.ts
 */

import assert from 'node:assert/strict'
import { cashOpenUnixForYmd, NY_DESK_CLOCK } from '../lib/chart/sessionVwap'
import {
  runAuctionBacktest,
  summarizeAuctionTrades,
  type AuctionBar,
} from '../lib/trading/auctionStrategy'

function rthBars(
  ymd: string,
  make: (i: number) => { open: number; high: number; low: number; close: number; volume?: number }
): AuctionBar[] {
  const openU = cashOpenUnixForYmd(ymd, NY_DESK_CLOCK)
  const closeU = openU + 6.5 * 3600
  const out: AuctionBar[] = []
  let i = 0
  for (let t = openU; t < closeU; t += 300) {
    const b = make(i)
    out.push({
      time: t,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume ?? 100,
    })
    i += 1
  }
  return out
}

function quietDay(ymd: string, mid: number): AuctionBar[] {
  return rthBars(ymd, () => ({
    open: mid,
    high: mid + 40,
    low: mid - 40,
    close: mid,
    volume: 100,
  }))
}

const friday = quietDay('2026-08-14', 42000)

const empty = runAuctionBacktest({ instrument: 'DOW', candles: [] })
assert.equal(empty.trades.length, 0)
assert.equal(empty.summary.netPnl, 0)

// IB window is 10:30–11:30 (bar 12+). Fake upper tail then close crosses it.
const mondayIb = rthBars('2026-08-17', (i) => {
  if (i < 12) {
    return { open: 42020, high: 42100, low: 42000, close: 42085, volume: 100 }
  }
  if (i === 12) {
    return { open: 42090, high: 42140, low: 42080, close: 42095, volume: 100 }
  }
  if (i === 13) {
    return { open: 42100, high: 42160, low: 42095, close: 42150, volume: 100 }
  }
  return { open: 42150, high: 42300, low: 42140, close: 42250, volume: 100 }
})

const ibRun = runAuctionBacktest({
  instrument: 'DOW',
  candles: [...friday, ...mondayIb],
})
const ibFills = ibRun.trades.filter((t) => t.date === '2026-08-17')
assert.ok(ibFills.length >= 1, 'expected IB absorb-breakout long')
assert.equal(ibFills[0]!.pattern, 'ABSORB_BREAKOUT')
assert.equal(ibFills[0]!.side, 'LONG')
assert.equal(ibFills[0]!.rangeFocus, 'IB')
assert.equal(ibFills[0]!.exitReason, 'take_profit')
assert.ok(ibFills[0]!.stop < ibFills[0]!.entry)

// 15M window is 09:45–10:00 (bars 3–5). Setup at 09:45, cross at 09:50.
const monday15 = rthBars('2026-08-17', (i) => {
  if (i < 3) {
    return { open: 42020, high: 42100, low: 42000, close: 42085, volume: 100 }
  }
  if (i === 3) {
    return { open: 42090, high: 42140, low: 42080, close: 42095, volume: 100 }
  }
  if (i === 4) {
    return { open: 42100, high: 42160, low: 42095, close: 42150, volume: 100 }
  }
  return { open: 42150, high: 42300, low: 42140, close: 42250, volume: 100 }
})
const m15 = runAuctionBacktest({
  instrument: 'DOW',
  candles: [...friday, ...monday15],
})
const fills15 = m15.trades.filter((t) => t.date === '2026-08-17')
assert.ok(fills15.length >= 1, 'expected 15M absorb-breakout')
assert.equal(fills15[0]!.rangeFocus, '15M')

// After 11:30 the sequential gates expire — lunch / afternoon must not fill.
const afterExpiry = rthBars('2026-08-17', (i) => {
  if (i === 30) {
    return { open: 42090, high: 42140, low: 42080, close: 42095, volume: 100 }
  }
  if (i === 31) {
    return { open: 42100, high: 42160, low: 42095, close: 42150, volume: 100 }
  }
  if (i < 12) {
    return { open: 42020, high: 42100, low: 42000, close: 42085, volume: 100 }
  }
  return { open: 42080, high: 42100, low: 42060, close: 42085, volume: 100 }
})
const expiredRun = runAuctionBacktest({
  instrument: 'DOW',
  candles: [...friday, ...afterExpiry],
})
assert.equal(
  expiredRun.trades.filter((t) => t.date === '2026-08-17').length,
  0,
  'fills after 11:30 must be zero'
)

const ibOnlyOn15 = runAuctionBacktest({
  instrument: 'GOLD',
  candles: [...friday, ...monday15],
  params: { rangeMode: 'ib' },
})
assert.equal(
  ibOnlyOn15.trades.filter((t) => t.date === '2026-08-17').length,
  0,
  'IB-only mode must not take 15M fills'
)
const ibOnlyOnIb = runAuctionBacktest({
  instrument: 'GOLD',
  candles: [...friday, ...mondayIb],
  params: { rangeMode: 'ib', allowShort: true },
})
assert.ok(
  ibOnlyOnIb.trades.filter((t) => t.date === '2026-08-17').length >= 1,
  'IB-only mode still takes IB absorb-breakout'
)

const zero = summarizeAuctionTrades([])
assert.equal(zero.winRate, null)
assert.equal(zero.trades, 0)

console.log('auction_strategy.test.ts: ok', {
  ib: ibFills[0]!.rangeFocus,
  m15: fills15[0]!.rangeFocus,
})
