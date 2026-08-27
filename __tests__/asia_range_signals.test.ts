/**
 * Asia Range Signals engine — synthetic M5, Montreal clock.
 * Run: npx tsx __tests__/asia_range_signals.test.ts
 */

import assert from 'node:assert/strict'
import { zonedCivilToUnix } from '../lib/chart/sessionVwap'
import {
  ASIA_TZ,
  asiaQty,
  asiaSignalLevels,
  lockLatestAsiaSession,
  runAsiaRangeBacktest,
  type AsiaBar,
} from '../lib/trading/asiaRangeSignals'

function barAt(ymd: string, hour: number, minute: number, px: { o: number; h: number; l: number; c: number }): AsiaBar {
  const time = zonedCivilToUnix(ymd, hour + minute / 60, ASIA_TZ)
  return { time, open: px.o, high: px.h, low: px.l, close: px.c, volume: 1 }
}

function sessionBars(px: (ymd: string, hour: number, minute: number) => { o: number; h: number; l: number; c: number }): AsiaBar[] {
  const out: AsiaBar[] = []
  // 2026-01-14 19:55 through 2026-01-15 12:00 Montreal (EST)
  out.push(barAt('2026-01-14', 19, 55, px('2026-01-14', 19, 55)))
  for (let mins = 20 * 60; mins < 24 * 60; mins += 5) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    out.push(barAt('2026-01-14', h, m, px('2026-01-14', h, m)))
  }
  for (let mins = 0; mins <= 12 * 60; mins += 5) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    out.push(barAt('2026-01-15', h, m, px('2026-01-15', h, m)))
  }
  return out
}

const goldLevels = asiaSignalLevels({ asiaHigh: 2650, asiaLow: 2635, buffer: 10 })
assert.equal(goldLevels.asiaRange, 15)
assert.equal(goldLevels.asiaMid, 2642.5)
assert.equal(goldLevels.buyStop, 2660)
assert.equal(goldLevels.sellStop, 2625)
assert.equal(goldLevels.riskPts, 17.5)
assert.equal(goldLevels.longTp, 2686.25)
assert.equal(goldLevels.shortTp, 2598.75)
assert.equal(goldLevels.longRiskPts, 17.5)
assert.equal(goldLevels.shortRiskPts, 17.5)
assert.equal(asiaQty(17.5, 10), 2)

const mixed = asiaSignalLevels({ asiaHigh: 2650, asiaLow: 2635, bufferHigh: 10, bufferLow: 20 })
assert.equal(mixed.buyStop, 2660)
assert.equal(mixed.sellStop, 2615)
assert.equal(mixed.longRiskPts, 17.5)
assert.equal(mixed.shortRiskPts, 27.5)
assert.equal(mixed.riskPts, 27.5)
assert.equal(mixed.longTp, 2686.25)
assert.equal(mixed.shortTp, 2573.75)

const quiet = sessionBars((_ymd, hour) => {
  if (hour >= 20 || hour < 2) {
    return { o: 2642, h: 2650, l: 2635, c: 2642 }
  }
  return { o: 2642, h: 2644, l: 2640, c: 2642 }
})

const skipWide = runAsiaRangeBacktest({
  instrument: 'GOLD',
  candles: quiet,
  maxRange: 10,
})
assert.equal(skipWide.trades.length, 0)
assert.equal(skipWide.sessions[0]?.skipReason, 'range_too_wide')

const noFill = runAsiaRangeBacktest({
  instrument: 'GOLD',
  candles: quiet,
  maxRange: 80,
})
assert.equal(noFill.trades.length, 0)
assert.equal(noFill.sessions[0]?.skipReason, 'no_fill')
assert.equal(noFill.sessions[0]?.qualified, true)
assert.ok(Math.abs((noFill.sessions[0]?.asiaRange || 0) - 15) < 1e-9)

const longTp = sessionBars((ymd, hour, minute) => {
  if (hour >= 20 || hour < 2) return { o: 2642, h: 2650, l: 2635, c: 2642 }
  if (ymd === '2026-01-15' && hour === 2 && minute === 10) {
    return { o: 2645, h: 2661, l: 2644, c: 2660 }
  }
  if (ymd === '2026-01-15' && hour === 2 && minute >= 15) {
    return { o: 2660, h: 2690, l: 2658, c: 2688 }
  }
  return { o: 2642, h: 2644, l: 2640, c: 2642 }
})

const longRun = runAsiaRangeBacktest({ instrument: 'GOLD', candles: longTp, maxRange: 80 })
assert.equal(longRun.trades.length, 1)
assert.equal(longRun.trades[0]!.side, 'LONG')
assert.equal(longRun.trades[0]!.exitReason, 'take_profit')
assert.equal(longRun.trades[0]!.entry, 2660)
assert.equal(longRun.trades[0]!.stop, 2642.5)
assert.equal(longRun.trades[0]!.contracts, 2)
assert.ok(Math.abs(longRun.trades[0]!.rMultiple - 1.5) < 1e-9)
assert.ok(Math.abs(longRun.trades[0]!.pnl - 525) < 1e-6)

const shortStop = sessionBars((ymd, hour, minute) => {
  if (hour >= 20 || hour < 2) return { o: 2642, h: 2650, l: 2635, c: 2642 }
  if (ymd === '2026-01-15' && hour === 2 && minute === 10) {
    return { o: 2640, h: 2641, l: 2624, c: 2626 }
  }
  if (ymd === '2026-01-15' && hour === 2 && minute >= 15) {
    return { o: 2626, h: 2643, l: 2625, c: 2642 }
  }
  return { o: 2642, h: 2644, l: 2640, c: 2642 }
})

const shortRun = runAsiaRangeBacktest({ instrument: 'GOLD', candles: shortStop, maxRange: 80 })
assert.equal(shortRun.trades.length, 1)
assert.equal(shortRun.trades[0]!.side, 'SHORT')
assert.equal(shortRun.trades[0]!.exitReason, 'stop_hit')
assert.equal(shortRun.trades[0]!.rMultiple, -1)

const flattenBars = sessionBars((ymd, hour, minute) => {
  if (hour >= 20 || hour < 2) return { o: 2642, h: 2650, l: 2635, c: 2642 }
  if (ymd === '2026-01-15' && hour === 2 && minute === 10) {
    return { o: 2645, h: 2661, l: 2644, c: 2660 }
  }
  if (ymd === '2026-01-15' && hour === 2 && minute < 10) {
    return { o: 2642, h: 2644, l: 2640, c: 2642 }
  }
  return { o: 2662, h: 2670, l: 2655, c: 2664 }
})

const flatRun = runAsiaRangeBacktest({ instrument: 'GOLD', candles: flattenBars, maxRange: 80 })
assert.equal(flatRun.trades.length, 1)
assert.equal(flatRun.trades[0]!.side, 'LONG')
assert.equal(flatRun.trades[0]!.exitReason, 'flatten_1130')
assert.ok(flatRun.trades[0]!.rMultiple > 0)

const lateFill = sessionBars((ymd, hour, minute) => {
  if (hour >= 20 || hour < 2) return { o: 2642, h: 2650, l: 2635, c: 2642 }
  if (ymd === '2026-01-15' && hour === 3 && minute === 30) {
    return { o: 2645, h: 2661, l: 2644, c: 2660 }
  }
  return { o: 2642, h: 2644, l: 2640, c: 2642 }
})
const lateRun = runAsiaRangeBacktest({ instrument: 'GOLD', candles: lateFill, maxRange: 80 })
assert.equal(lateRun.trades.length, 0, '03:30 bar must not fill — stops already cancelled')
assert.equal(lateRun.sessions[0]?.skipReason, 'no_fill')

const liveLock = lockLatestAsiaSession({
  instrument: 'GOLD',
  candles: quiet,
  maxRange: 80,
})
assert.equal(liveLock?.qualified, true)
assert.equal(liveLock?.buyStop, 2660)

console.log('asia_range_signals.test.ts passed')
