/**
 * 1-minute charts must load the same five RTH sessions the 5-minute chart shows.
 * Run: npx tsx __tests__/one_minute_five_day_window.test.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ONE_MINUTE_FETCH_CALENDAR_DAYS,
  lastNTradingSessions,
  NY_DESK_CLOCK,
} from '../lib/chart/sessionVwap'

const root = path.resolve(__dirname, '..')
const chart = fs.readFileSync(
  path.join(root, 'app/dashboard/chart/components/TradingChart.tsx'),
  'utf8'
)
const route = fs.readFileSync(
  path.join(root, 'app/api/trading/candles/route.ts'),
  'utf8'
)

assert.equal(ONE_MINUTE_FETCH_CALENDAR_DAYS, 8)
assert.ok(chart.includes('ONE_MINUTE_FETCH_CALENDAR_DAYS'))
assert.ok(!chart.includes("timeframe === '1m' ? 3"))
assert.ok(route.includes('ONE_MINUTE_FETCH_CALENDAR_DAYS'))
assert.ok(!route.includes('Math.max(days, 3)'))

// Monday 2026-10-05 16:00 ET, plus the five prior weekday cash opens.
const tip = Math.floor(Date.UTC(2026, 9, 5, 20, 0, 0) / 1000)
const sessionOpens = [
  Math.floor(Date.UTC(2026, 8, 28, 13, 30, 0) / 1000), // Mon
  Math.floor(Date.UTC(2026, 8, 29, 13, 30, 0) / 1000),
  Math.floor(Date.UTC(2026, 8, 30, 13, 30, 0) / 1000),
  Math.floor(Date.UTC(2026, 9, 1, 13, 30, 0) / 1000),
  Math.floor(Date.UTC(2026, 9, 2, 13, 30, 0) / 1000), // Fri
  tip,
]
const bars = sessionOpens.map((time) => ({
  time,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
}))
const scoped = lastNTradingSessions(bars, 5, NY_DESK_CLOCK, tip)
assert.equal(scoped[0]!.time, sessionOpens[1], 'five sessions start at Tuesday, not only Friday')
const spanDays = (scoped[scoped.length - 1]!.time - scoped[0]!.time) / 86400
assert.ok(spanDays >= 4, `five sessions span ${spanDays.toFixed(2)} days`)

console.log('one_minute_five_day_window: ok')
