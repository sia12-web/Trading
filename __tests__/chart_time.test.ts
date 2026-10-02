/**
 * Desk chart timezone shift — lightweight-charts UTC ticks ↔ ET/JST wall clock.
 * Run: npx tsx __tests__/chart_time.test.ts
 */

import {
  toChartTime,
  fromChartTime,
  formatChartClock,
  formatChartDate,
} from '../lib/chart/chartTime'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '../lib/utils/dateUtils'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const ET = 'America/New_York'
const JST = 'Asia/Tokyo'

{
  // Mon Jul 27 2026 13:15 ET
  const real = nyDateTimeToUnix('2026-07-27', 13, 15)
  const chart = toChartTime(real, ET)
  assert(formatChartClock(chart) === '13:15', `ET clock got ${formatChartClock(chart)}`)
  assert(formatChartDate(chart) === 'Jul 27', `ET date got ${formatChartDate(chart)}`)
  const back = fromChartTime(chart, ET)
  assert(Math.abs(back - real) <= 1, `ET roundtrip drift ${back - real}`)
}

{
  // Tokyo cash open
  const real = tokyoDateTimeToUnix('2026-07-27', 9, 0)
  const chart = toChartTime(real, JST)
  assert(formatChartClock(chart) === '09:00', `JST clock got ${formatChartClock(chart)}`)
  const back = fromChartTime(chart, JST)
  assert(Math.abs(back - real) <= 1, `JST roundtrip drift ${back - real}`)
}

{
  // Day boundary: ET midnight → chart DayOfMonth aligns to civil midnight
  const midnight = nyDateTimeToUnix('2026-07-27', 0, 0)
  const chart = toChartTime(midnight, ET)
  const d = new Date(chart * 1000)
  assert(d.getUTCHours() === 0 && d.getUTCMinutes() === 0, 'ET midnight → UTC 00:00 chart')
  assert(d.getUTCDate() === 27, 'civil day 27 on chart time')
}

{
  // Month ticks: clean month abbreviation ('Jul', 'Oct'), never 'Jul 26' or 'Oct 26'
  const realJul = nyDateTimeToUnix('2026-07-01', 0, 0)
  const chartJul = toChartTime(realJul, ET)
  assert(formatChartDate(chartJul, 'month') === 'Jul', `Expected 'Jul', got ${formatChartDate(chartJul, 'month')}`)

  const realOct = nyDateTimeToUnix('2026-10-01', 0, 0)
  const chartOct = toChartTime(realOct, ET)
  assert(formatChartDate(chartOct, 'month') === 'Oct', `Expected 'Oct', got ${formatChartDate(chartOct, 'month')}`)

  const realJan = nyDateTimeToUnix('2026-01-01', 0, 0)
  const chartJan = toChartTime(realJan, ET)
  assert(formatChartDate(chartJan, 'month') === '2026', `Expected '2026', got ${formatChartDate(chartJan, 'month')}`)
  assert(formatChartDate(chartJan, 'year') === '2026', `Expected '2026', got ${formatChartDate(chartJan, 'year')}`)
}

console.log('chart_time: ok')
