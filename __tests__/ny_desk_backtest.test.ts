/**
 * NY desk backtest engine — no invented fills.
 * Run: npx tsx __tests__/ny_desk_backtest.test.ts
 */

import assert from 'node:assert/strict'
import { cashOpenUnixForYmd, NY_DESK_CLOCK } from '../lib/chart/sessionVwap'
import {
  runNyDeskInstrumentBacktest,
  summarizeNyBacktestTrades,
  type NyBacktestBar,
} from '../lib/trading/nyDeskBacktest'

function rthBars(
  ymd: string,
  make: (i: number, t: number) => { open: number; high: number; low: number; close: number }
): NyBacktestBar[] {
  const openU = cashOpenUnixForYmd(ymd, NY_DESK_CLOCK)
  const closeU = openU + 6.5 * 3600
  const out: NyBacktestBar[] = []
  let i = 0
  for (let t = openU; t < closeU; t += 300) {
    out.push({ time: t, ...make(i, t) })
    i += 1
  }
  return out
}

function quietDay(ymd: string, mid: number): NyBacktestBar[] {
  return rthBars(ymd, () => ({
    open: mid,
    high: mid + 12,
    low: mid - 12,
    close: mid,
  }))
}

const warmup = [
  ...quietDay('2026-08-10', 42100),
  ...quietDay('2026-08-11', 42120),
  ...quietDay('2026-08-12', 42140),
  ...quietDay('2026-08-13', 42110),
  ...quietDay('2026-08-14', 42100),
]

const mondayOpen = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
const monday = rthBars('2026-08-17', (i) => {
  if (i < 3) {
    return { open: 42100, high: 42180, low: 42100, close: 42170 }
  }
  const px = 42170 + Math.min(i, 20)
  return { open: px, high: px + 8, low: px - 8, close: px + 2 }
})

const empty = runNyDeskInstrumentBacktest({
  instrument: 'DOW',
  candles: [],
})
assert.equal(empty.trades.length, 0)
assert.equal(empty.summary.netPnl, 0)

const ran = runNyDeskInstrumentBacktest({
  instrument: 'DOW',
  candles: [...warmup, ...monday],
  minWarmupDays: 5,
})
assert.ok(ran.days >= 1)
for (const t of ran.trades) {
  assert.ok(t.side === 'LONG' || t.side === 'SHORT')
  assert.ok(t.entry > 0 && t.stop > 0 && t.target > 0)
  if (t.side === 'LONG') assert.ok(t.stop < t.entry, 'long stop below entry')
  if (t.side === 'SHORT') assert.ok(t.stop > t.entry, 'short stop above entry')
  assert.ok(t.contracts >= 1)
  assert.ok(['morning', 'or30', 'ib'].includes(t.window))
}

const zero = summarizeNyBacktestTrades([])
assert.equal(zero.winRate, null)
assert.equal(zero.trades, 0)

console.log('ny_desk_backtest.test.ts: all assertions passed')
void mondayOpen
