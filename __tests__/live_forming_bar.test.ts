/**
 * Live forming-bar: no fake open on delay, no intra-session holes.
 * Run: npx tsx __tests__/live_forming_bar.test.ts
 */

import assert from 'node:assert/strict'
import {
  applyTickToFormingBar,
  closedHistoryOhlcChanged,
  deskBarOpenUnix,
  dropImplausibleDeskBars,
  mergeHistoryWithLiveTip,
  quoteUnixForBucket,
  LIVE_MAX_GAP_FILLS,
} from '../lib/chart/liveFormingBar'

const t0 = 1_700_000_000 - (1_700_000_000 % 300)

{
  assert.equal(deskBarOpenUnix(t0 + 1), t0)
  assert.equal(deskBarOpenUnix(t0 + 299), t0)
  assert.equal(deskBarOpenUnix(t0 + 300), t0 + 300)
}

{
  const last = { time: t0, open: 100, high: 101, low: 99, close: 100.5 }
  const next = applyTickToFormingBar(last, 100.8, t0 + 12)
  assert.equal(next.rolled, false)
  assert.equal(next.last.open, 100)
  assert.equal(next.last.close, 100.8)
  assert.equal(next.last.high, 101)
}

{
  const last = { time: t0, open: 100, high: 101, low: 99, close: 100 }
  const next = applyTickToFormingBar(last, 98, t0 + 300 + 8)
  assert.equal(next.rolled, true)
  assert.equal(next.gapFills.length, 0)
  assert.equal(next.last.time, t0 + 300)
  assert.equal(next.last.open, 100, 'new 5m open = prior close, not the delayed tick')
  assert.equal(next.last.close, 98)
  assert.ok(next.last.close < next.last.open, 'down move stays a red bar')
}

{
  const last = { time: t0, open: 100, high: 101, low: 99, close: 100 }
  const next = applyTickToFormingBar(last, 102, t0 + 900 + 5)
  assert.equal(next.gapFills.length, 2)
  assert.equal(next.last.time, t0 + 900)
  assert.equal(next.last.open, 100)
  assert.equal(next.gapFills[0]!.close, 100)
}

{
  const last = { time: t0, open: 100, high: 101, low: 99, close: 100 }
  const far = applyTickToFormingBar(
    last,
    90,
    t0 + (LIVE_MAX_GAP_FILLS + 2) * 300
  )
  assert.equal(far.gapFills.length, 0, 'do not invent overnight flats')
  assert.equal(far.last.open, 90)
}

{
  const history = [
    { time: t0, open: 100, high: 101, low: 99, close: 100.2, volume: 1 },
  ]
  const live = {
    time: t0,
    open: 100.2,
    high: 100.9,
    low: 99.5,
    close: 99.8,
    volume: 0,
  }
  const merged = mergeHistoryWithLiveTip(history, live)
  assert.equal(merged[0]!.open, 100.2, 'tick open wins over delayed REST open')
  assert.equal(merged[0]!.close, 99.8)
  assert.ok(merged[0]!.close < merged[0]!.open)
}

{
  assert.equal(quoteUnixForBucket(t0, t0 + 3), t0)
  assert.equal(quoteUnixForBucket(t0, t0 + 200), t0 + 200)
}

{
  const closed = (o: number, c: number) => ({
    time: t0,
    open: o,
    high: Math.max(o, c),
    low: Math.min(o, c),
    close: c,
  })
  const tip = {
    time: t0 + 300,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
  }
  const prev = [closed(100, 100), tip]
  const flatGap = [closed(100, 100), tip]
  assert.equal(
    closedHistoryOhlcChanged(prev, flatGap, true),
    false,
    'identical closed OHLC is quiet'
  )
  const yahooFixed = [closed(100, 101.2), tip]
  assert.equal(
    closedHistoryOhlcChanged(prev, yahooFixed, true),
    true,
    'Yahoo replacing a flat gap-fill must refresh chart'
  )
  const tipOnlyDrift = [
    closed(100, 100),
    { ...tip, close: 99.1, high: 101, low: 99.1 },
  ]
  assert.equal(
    closedHistoryOhlcChanged(prev, tipOnlyDrift, true),
    false,
    'forming tip drift alone must not force setCandles'
  )
}

{
  const history = [
    { time: t0, open: 4650, high: 4652, low: 4648, close: 4650, volume: 1 },
  ]
  const fakeDump = {
    time: t0,
    open: 3400,
    high: 4650,
    low: 3400,
    close: 3400,
    volume: 0,
  }
  const merged = mergeHistoryWithLiveTip(history, fakeDump)
  assert.equal(merged[0]!.close, 4650, 'off-scale XAU tip must not paint a fake gold dump')
}

{
  const bars = [
    { time: t0, open: 4650, high: 4652, low: 4648, close: 4650 },
    { time: t0 + 300, open: 4650, high: 4650, low: 3400, close: 3400 },
    { time: t0 + 600, open: 3400, high: 3402, low: 3398, close: 3401 },
  ]
  const sane = dropImplausibleDeskBars(bars, 'GOLD')
  assert.equal(sane.length, 1, 'drop the glitch 5m gold dump')
  assert.equal(sane[0]!.close, 4650)
}

console.log('live_forming_bar: all passed')
