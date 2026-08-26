/**
 * SENTINEL — real desk month replay (no daily-open hallucination).
 * Run: npx tsx __tests__/desk_month_backtest.test.ts
 */

import assert from 'node:assert/strict'
import {
  cashOpenUnixForYmd,
  NY_DESK_CLOCK,
  zonedCivilToUnix,
} from '../lib/chart/sessionVwap'
import { selectDowAsiaSessionBars } from '../lib/trading/dowAsiaRangeEdge'
import {
  replayDeskMonth,
  type BtBar,
} from '../lib/trading/deskMonthBacktest'

const passed: string[] = []
const failed: { name: string; error: string }[] = []

function test(name: string, fn: () => void) {
  try {
    fn()
    passed.push(name)
  } catch (err) {
    failed.push({ name, error: err instanceof Error ? err.message : String(err) })
  }
}

const ET = 'America/New_York'
const YMD = '2026-08-17'
const openU = cashOpenUnixForYmd(YMD, NY_DESK_CLOCK)

function bar(time: number, open: number, high: number, low: number, close: number): BtBar {
  return { time, open, high, low, close, volume: 1 }
}

function rthDriveDown(): BtBar[] {
  const out: BtBar[] = []
  for (let i = 0; i < 84; i++) {
    const t = openU + i * 300
    if (i === 0) out.push(bar(t, 25020, 25040, 24990, 24995))
    else if (i === 1) out.push(bar(t, 24995, 25000, 24970, 24972))
    else if (i === 2) out.push(bar(t, 24972, 24980, 24950, 24955))
    else if (i === 3) out.push(bar(t, 24955, 24960, 24920, 24930))
    else out.push(bar(t, 24930, 24940, 24910, 24920))
  }
  return out
}

test('does not invent a 28210 OR15 long on a drive-down open', () => {
  const nasdaq = rthDriveDown()
  const dow = nasdaq.map((b) => ({ ...b, open: b.open + 20000, high: b.high + 20000, low: b.low + 20000, close: b.close + 20000 }))
  const res = replayDeskMonth({
    dow,
    nasdaq,
    fromYmd: YMD,
    toYmd: YMD,
  })
  for (const t of res.trades) {
    assert.notEqual(t.entry, 28210)
    if (t.setup === 'OR15' && t.instrument === 'NASDAQ' && t.side === 'LONG') {
      throw new Error('drive-down session should not fill a CALL LONG at the range high story')
    }
  }
})

test('Asia window helper keeps 20:00–02:00 ET only', () => {
  const cash = '2026-08-19'
  const start = zonedCivilToUnix('2026-08-18', 20, ET)
  const bars: BtBar[] = [
    bar(start - 300, 1, 1, 1, 1),
    bar(start, 2, 2, 2, 2),
    bar(zonedCivilToUnix('2026-08-19', 1.5, ET), 3, 3, 3, 3),
    bar(zonedCivilToUnix('2026-08-19', 2, ET), 4, 4, 4, 4),
    bar(zonedCivilToUnix('2026-08-19', 9.5, ET), 5, 5, 5, 5),
  ]
  const asia = selectDowAsiaSessionBars(bars, cash)
  assert.equal(asia.length, 2)
  assert.equal(asia[0]!.open, 2)
  assert.equal(asia[1]!.open, 3)
})

test('replay returns structured result for empty history', () => {
  const res = replayDeskMonth({
    dow: [],
    nasdaq: [],
    fromYmd: YMD,
    toYmd: YMD,
  })
  assert.equal(res.startingEquity, 50000)
  assert.ok(Array.isArray(res.trades))
  assert.ok(res.skips.length >= 1)
})

test('CALL LONG fills the OR15 low, not a high breakout', () => {
  const fridayOpen = cashOpenUnixForYmd('2026-08-14', NY_DESK_CLOCK)
  const friday: BtBar[] = []
  for (let i = 0; i < 78; i++) {
    const t = fridayOpen + i * 300
    const wobble = (i % 7) - 3
    const px = 42100 + wobble * 8
    friday.push(bar(t, px, px + 12, px - 12, px + 2))
  }

  const ovStart = zonedCivilToUnix('2026-08-16', 18, ET)
  const overnightNq: BtBar[] = []
  const overnightDow: BtBar[] = []
  for (let i = 0; i < 40; i++) {
    const t = ovStart + i * 300
    overnightNq.push(bar(t, 42100, 42200, 42000, 42150))
    overnightDow.push(bar(t, 62100, 62110, 62090, 62100))
  }

  const nasdaqRth: BtBar[] = [
    bar(openU, 42100, 42140, 42095, 42130),
    bar(openU + 300, 42130, 42150, 42120, 42140),
    bar(openU + 600, 42140, 42150, 42120, 42135),
    bar(openU + 900, 42135, 42155, 42120, 42140),
    bar(openU + 1200, 42150, 42280, 42145, 42250),
    bar(openU + 1500, 42120, 42130, 42090, 42100),
  ]
  for (let i = 6; i < 78; i++) {
    nasdaqRth.push(bar(openU + i * 300, 42110, 42140, 42100, 42120))
  }

  const res = replayDeskMonth({
    dow: overnightDow,
    nasdaq: [...friday, ...overnightNq, ...nasdaqRth],
    fromYmd: YMD,
    toYmd: YMD,
  })
  const longs = res.trades.filter(
    (t) => t.instrument === 'NASDAQ' && t.setup === 'OR15' && t.side === 'LONG'
  )
  assert.equal(longs.length, 1, `expected one OR15 long, got ${res.trades.map((t) => `${t.setup} ${t.side} ${t.entry}`).join('; ') || 'none'}`)
  const fill = longs[0]!
  assert.equal(fill.entry, 42095)
  assert.equal(fill.orLow, 42095)
  assert.ok(fill.orHigh != null && fill.orHigh >= 42150)
  assert.equal(fill.entryUnix, openU + 1500)
})

console.log(`desk_month_backtest: ${passed.length} passed, ${failed.length} failed`)
for (const f of failed) console.error(`  FAIL ${f.name}: ${f.error}`)
if (failed.length) process.exit(1)
