/**
 * Shared range BRK/REJ + RVOL (1.2× / 20). BRK needs volume; REJ price-only; once/side.
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
  const open = t0
  const candles = [
    ...warm.map((b, i) =>
      i < 2
        ? bar(open + i * 300, 100, 102, 99, 101, 1000)
        : b
    ),
    bar(open + 0, 100, 102, 99, 101, 1000),
    bar(open + 300, 101, 105, 100, 104, 1000),
    bar(open + 600, 104, 106, 103, 105, 1000),
    bar(open + 900, 105, 107, 104, 106, 1000),
    bar(open + 1200, 106, 108, 105, 107, 1000),
    bar(open + 1500, 107, 109, 106, 108, 1000),
    // after 30m break
    bar(open + 1800, 108, 112, 107, 111, 2500),
  ]
  // rebuild clean series for OR30
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
    bar(lunchStart + 1800, 110, 111, 109, 110, 1000), // inside lunch
    // after 13:30
    bar(lunchStart + 90 * 60, 110, 115, 109, 114, 2500),
  ]
  const lunch = computeNycLunchRange(
    candles,
    day,
    lunchStart + 100 * 60
  )
  assert.ok(lunch?.complete)
  const lnSigs = computeNycLunchSignals(candles, lunch)
  assert.ok(lnSigs.some((s) => s.type === 'BRK_LONG'), 'LN BRK')
}

{
  const open = t0
  const candles = [
    ...warm,
    bar(open + 0, 100, 102, 99, 101, 1000),
    bar(open + 300, 101, 105, 100, 104, 1000),
    // fill first hour
    ...Array.from({ length: 10 }, (_, i) =>
      bar(open + (600 + i * 300), 104, 106, 103, 105, 1000)
    ),
    bar(open + 60 * 60, 105, 110, 104, 109, 2500),
  ]
  const ib = computeInitialBalance(candles, open, open + 70 * 60, 60)
  assert.ok(ib)
  const ibSigs = computeIbSignals(candles, ib)
  assert.ok(ibSigs.some((s) => s.type === 'INITIATIVE_LONG'), 'IB BRK with RVOL')
}

console.log('✅ range_break_signals: RVOL BRK + price REJ + once/side OK')
