/**
 * Volume-bar range break — synthetic 5m RTH.
 * Run: npx tsx __tests__/auction_volume_break.test.ts
 */

import assert from 'node:assert/strict'
import { cashOpenUnixForYmd, NY_DESK_CLOCK } from '../lib/chart/sessionVwap'
import {
  runVolumeBreakBacktest,
  computeDow15mFailOverlay,
  isDowVolumeBarInstrument,
  DOW_15M_FAIL_PARAMS,
  type AuctionBar,
} from '../lib/trading/auctionVolumeBreak'

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

const empty = runVolumeBreakBacktest({ instrument: 'DOW', candles: [] })
assert.equal(empty.trades.length, 0)

// 15M range 42000–42100. Green high-vol bar at 09:45 tags the high.
// Two bars later close through that bar's high → CONTINUE long.
const monday = rthBars('2026-08-17', (i) => {
  if (i < 3) {
    return { open: 42040, high: 42100, low: 42000, close: 42050, volume: 100 }
  }
  if (i === 3) {
    return { open: 42070, high: 42140, low: 42050, close: 42120, volume: 800 }
  }
  if (i === 5) {
    return { open: 42130, high: 42180, low: 42120, close: 42160, volume: 120 }
  }
  if (i > 5) {
    return { open: 42160, high: 42350, low: 42150, close: 42300, volume: 100 }
  }
  return { open: 42110, high: 42130, low: 42090, close: 42115, volume: 90 }
})

const ran = runVolumeBreakBacktest({
  instrument: 'DOW',
  candles: [...friday, ...monday],
  params: { waitBars: 5, rr: 1.25, slBufferTicks: 2 },
})
const fills = ran.trades.filter((t) => t.date === '2026-08-17')
assert.ok(fills.length >= 1, 'expected a volume-bar long')
assert.equal(fills[0]!.side, 'LONG')
assert.equal(fills[0]!.kind, 'CONTINUE')
assert.equal(fills[0]!.rangeFocus, '15M')
assert.ok(fills[0]!.stop < fills[0]!.entry)

// Fail: same green volume bar, then close breaks its low → SHORT.
const failMonday = rthBars('2026-08-17', (i) => {
  if (i < 3) {
    return { open: 42040, high: 42100, low: 42000, close: 42050, volume: 100 }
  }
  if (i === 3) {
    return { open: 42070, high: 42140, low: 42050, close: 42120, volume: 800 }
  }
  if (i === 6) {
    return { open: 42080, high: 42090, low: 42000, close: 42020, volume: 120 }
  }
  return { open: 42100, high: 42120, low: 42080, close: 42100, volume: 90 }
})
const failRun = runVolumeBreakBacktest({
  instrument: 'DOW',
  candles: [...friday, ...failMonday],
  params: { waitBars: 5, rr: 1.25, slBufferTicks: 2 },
})
const failFills = failRun.trades.filter((t) => t.date === '2026-08-17')
assert.ok(failFills.length >= 1, 'expected a failed-break short')
assert.equal(failFills[0]!.side, 'SHORT')
assert.equal(failFills[0]!.kind, 'FAIL')

const onlyFailOnContinue = runVolumeBreakBacktest({
  instrument: 'DOW',
  candles: [...friday, ...monday],
  params: { waitBars: 5, rr: 1.25, slBufferTicks: 2, onlyKind: 'FAIL' },
})
assert.equal(
  onlyFailOnContinue.trades.filter((t) => t.date === '2026-08-17').length,
  0,
  'FAIL-only must skip CONTINUE longs'
)
const onlyFailOnFail = runVolumeBreakBacktest({
  instrument: 'DOW',
  candles: [...friday, ...failMonday],
  params: { waitBars: 5, rr: 1.5, slBufferTicks: 5, onlyKind: 'FAIL', onlyRange: '15M' },
})
assert.ok(
  onlyFailOnFail.trades.filter((t) => t.date === '2026-08-17').length >= 1,
  'FAIL-only 15M still takes the failed-break short'
)

assert.equal(isDowVolumeBarInstrument('DOW'), true)
assert.equal(isDowVolumeBarInstrument('NASDAQ'), false)
assert.equal(
  computeDow15mFailOverlay({ instrument: 'NASDAQ', candles: [...friday, ...failMonday] }),
  null
)
const failOv = computeDow15mFailOverlay({
  instrument: 'DOW',
  candles: [...friday, ...failMonday],
})
assert.ok(failOv)
assert.equal(failOv!.hud.mode, 'FAIL')
assert.equal(failOv!.hud.marketOk, true)
assert.ok(failOv!.signals.length >= 1, 'DOW 15M fail overlay shows the short')
assert.equal(failOv!.signals[0]!.side, 'SHORT')
assert.equal(failOv!.signals[0]!.kind, 'FAIL')
assert.equal(DOW_15M_FAIL_PARAMS.onlyKind, 'FAIL')
assert.equal(DOW_15M_FAIL_PARAMS.onlyRange, '15M')
assert.equal(DOW_15M_FAIL_PARAMS.rr, 1.5)

console.log('auction_volume_break.test.ts: ok', {
  cont: fills[0]!.kind,
  fail: failFills[0]!.kind,
})
