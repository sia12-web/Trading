/**
 * Shared range BRK/REJ + RVOL (1.2× / 20). BRK needs volume; REJ price-only; once/side.
 * Run: npx tsx __tests__/range_break_signals.test.ts
 */
import assert from 'node:assert/strict'
import {
  computeRangeBreakRejectSignals,
  createRvolTracker,
} from '../lib/chart/rangeBreakSignals'
import { computeOr30Signals, computeOr30Range } from '../lib/chart/openingRange30'
import { computeNycLunchSignals, computeNycLunchRange } from '../lib/chart/nycLunchSessionRange'
import { computeIbSignals, computeInitialBalance } from '../lib/trading/deskLevels'
import { nyDateTimeToUnix } from '../lib/utils/dateUtils'

function bar(
  time: number,
  o: number,
  h: number,
  l: number,
  c: number,
  volume: number
) {
  return { time, open: o, high: h, low: l, close: c, volume }
}

const colors = {
  brkLong: '#22c55e',
  brkShort: '#ef4444',
  rejHigh: '#f97316',
  rejLow: '#a855f7',
}

// Warm volume average ~1000
const warm: ReturnType<typeof bar>[] = []
const t0 = nyDateTimeToUnix('2026-07-15', 9, 30)
for (let i = 0; i < 20; i++) {
  warm.push(bar(t0 - (20 - i) * 300, 100, 101, 99, 100, 1000))
}

{
  const rvol = createRvolTracker(20)
  for (const b of warm) rvol.push(b.volume)
  assert.equal(rvol.ok(1000, true, 1.2), false, 'at avg not ok')
  assert.equal(rvol.ok(1201, true, 1.2), true, 'above 1.2× ok')
  assert.equal(rvol.ok(500, false, 1.2), true, 'useVol off always ok')
}

{
  // Empty / zero volume history → allow BRK (CFD feed fallback)
  const empty = createRvolTracker(20)
  assert.equal(empty.ok(0, true, 1.2), true, 'no history → allow')
  for (let i = 0; i < 20; i++) empty.push(0)
  assert.equal(empty.ok(0, true, 1.2), true, 'all-zero avg → allow')
}

{
  const open = t0
  const candles = [
    ...warm,
    bar(open + 0, 100, 102, 99, 101, 1000),
    bar(open + 300, 101, 103, 100, 102, 1000),
    // after OR30 end (30m): break high with volume
    bar(open + 30 * 60, 102, 106, 101, 105, 2500),
    // second break — should be suppressed (once)
    bar(open + 35 * 60, 105, 108, 104, 107, 2500),
  ]
  const range = { high: 103, low: 99 }
  const sigs = computeRangeBreakRejectSignals(candles, range, {
    labelPrefix: 'OR',
    colors,
    signalAfterUnix: open + 30 * 60,
    oncePerSide: true,
  })
  const brks = sigs.filter((s) => s.type === 'BRK_LONG')
  assert.equal(brks.length, 1, 'one BRK long')
  assert.equal(brks[0]!.text, 'OR BRK')
}

{
  const open = t0
  const candles = [
    ...warm,
    bar(open + 0, 100, 102, 99, 101, 1000),
    bar(open + 300, 101, 103, 100, 102, 1000),
    // reject high — low volume still fires (REJ price-only)
    bar(open + 30 * 60, 102, 105, 100, 101, 200),
  ]
  const range = { high: 103, low: 99 }
  const sigs = computeRangeBreakRejectSignals(candles, range, {
    labelPrefix: 'IB',
    colors,
    signalAfterUnix: open + 30 * 60,
  })
  assert.equal(sigs.filter((s) => s.type === 'REJ_HIGH').length, 1, 'REJ without RVOL')
  assert.equal(sigs.filter((s) => s.type.startsWith('BRK')).length, 0, 'no BRK on low vol reject')
}

{
  // Zero-volume feed: BRK still paints (fallback), REJ still paints
  const open = t0
  const zeroWarm = warm.map((b) => ({ ...b, volume: 0 }))
  const candles = [
    ...zeroWarm,
    bar(open + 0, 100, 102, 99, 101, 0),
    bar(open + 300, 101, 103, 100, 102, 0),
    bar(open + 30 * 60, 102, 106, 101, 105, 0),
  ]
  const sigs = computeRangeBreakRejectSignals(candles, { high: 103, low: 99 }, {
    labelPrefix: 'OR',
    colors,
    signalAfterUnix: open + 30 * 60,
  })
  assert.equal(sigs.filter((s) => s.type === 'BRK_LONG').length, 1, 'zero-vol BRK fallback')
}

{
  const open = t0
  const orBars = [
    ...warm,
    bar(open + 0, 100, 102, 99, 101, 1000),
    bar(open + 300, 101, 105, 100, 104, 1000),
    bar(open + 600, 104, 106, 103, 105, 1000),
    bar(open + 900, 105, 107, 98, 106, 1000),
    bar(open + 1200, 106, 108, 105, 107, 1000),
    bar(open + 1500, 107, 109, 106, 108, 1000),
    bar(open + 1800, 108, 112, 107, 111, 2500),
  ]
  const or = computeOr30Range(orBars, open, open + 40 * 60)
  assert.ok(or)
  const orSigs = computeOr30Signals(orBars, or)
  assert.ok(orSigs.some((s) => s.type === 'BRK_LONG'), 'OR BRK')
}

{
  const day = '2026-07-15'
  const lunchStart = nyDateTimeToUnix(day, 12, 0)
  const candles = [
    ...warm,
    bar(lunchStart + 0, 100, 110, 100, 105, 1000),
    bar(lunchStart + 300, 105, 112, 104, 110, 1000),
    bar(lunchStart + 600, 110, 115, 109, 112, 1000),
    // after 13:30 — break lunch high with volume
    bar(lunchStart + 90 * 60, 112, 120, 111, 118, 2500),
  ]
  const lunch = computeNycLunchRange(
    candles.map((c) => ({ time: c.time, high: c.high, low: c.low })),
    day,
    lunchStart + 100 * 60
  )
  assert.ok(lunch?.complete, 'lunch complete')
  const lnSigs = computeNycLunchSignals(candles, lunch)
  assert.ok(lnSigs.some((s) => s.type === 'BRK_LONG'), 'LN BRK')
}

{
  const open = t0
  const bars = [
    ...warm,
    bar(open + 0, 100, 102, 99, 101, 1000),
    bar(open + 300, 101, 103, 100, 102, 1000),
    bar(open + 600, 102, 104, 101, 103, 1000),
    bar(open + 900, 103, 105, 102, 104, 1000),
    bar(open + 1200, 104, 106, 103, 105, 1000),
    bar(open + 1500, 105, 107, 104, 106, 1000),
    bar(open + 1800, 106, 108, 105, 107, 1000),
    bar(open + 2100, 107, 109, 106, 108, 1000),
    bar(open + 2400, 108, 110, 107, 109, 1000),
    bar(open + 2700, 109, 111, 108, 110, 1000),
    bar(open + 3000, 110, 112, 109, 111, 1000),
    bar(open + 3300, 111, 113, 110, 112, 1000),
    // after IB (60m): reject low
    bar(open + 3600, 112, 113, 95, 111, 200),
  ]
  const ib = computeInitialBalance(bars, open, open + 70 * 60)
  assert.ok(ib)
  const ibSigs = computeIbSignals(bars, ib)
  assert.ok(
    ibSigs.some((s) => s.type === 'REJECT_LOW' || s.text.includes('REJ')),
    'IB REJ'
  )
}

console.log('range_break_signals: all passed')
