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
  isPlausibleRealtimeTick,
  liveQuoteDisagreesWithReference,
  mergeHistoryWithLiveTip,
  quoteUnixForBucket,
  timeframeToSeconds,
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
  const current = {
    time: t0 + 300,
    open: 101,
    high: 102,
    low: 100,
    close: 101.5,
  }
  const replayed = applyTickToFormingBar(current, 99, t0 + 10)
  assert.deepEqual(replayed.last, current, 'older replay tick must not corrupt current bar')
  assert.equal(replayed.rolled, false)
}

{
  // A fast but valid exchange move must keep printing; the tighter proxy guard
  // still blocks the same transition until its basis/book is verified.
  assert.equal(isPlausibleRealtimeTick(29_400, 29_500, 'NASDAQ', true), true)
  assert.equal(isPlausibleRealtimeTick(29_400, 29_500, 'NASDAQ', false), false)

  // Delayed Yahoo must never veto live Databento during a real volatility move.
  assert.equal(
    liveQuoteDisagreesWithReference(29_500, t0 + 600, 29_400, t0, 'NASDAQ'),
    false
  )
  assert.equal(
    liveQuoteDisagreesWithReference(97.4, t0 + 30, 93.5, t0, 'CRUDE'),
    true,
    'same-time wrong-month scale mismatch is still rejected'
  )
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
  const history = [
    { time: t0, open: 93.4, high: 93.6, low: 93.2, close: 93.51, volume: 1 },
  ]
  const calendarFront = {
    time: t0,
    open: 97.2,
    high: 97.8,
    low: 97.1,
    close: 97.44,
    volume: 0,
  }
  const merged = mergeHistoryWithLiveTip(history, calendarFront, '5m', 'CRUDE')
  assert.equal(merged[0]!.close, 93.51, 'calendar-front CL must not jump the CL=F book')
}

{
  const delayedRest = [
    {
      time: t0,
      open: 29_400,
      high: 29_450,
      low: 29_390,
      close: 29_420,
      volume: 1,
    },
  ]
  const fastLive = {
    time: t0,
    open: 29_400,
    high: 29_650,
    low: 29_390,
    close: 29_640,
    volume: 0,
  }
  const merged = mergeHistoryWithLiveTip(delayedRest, fastLive, '5m', 'NASDAQ')
  assert.equal(
    merged[0]!.close,
    29_640,
    '15s REST refresh must not repaint a legitimate fast forming close'
  )
  assert.equal(merged[0]!.high, 29_650)
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

{
  // Outlier tick spike rejection test (prevent phantom wicks/tails)
  const last = { time: t0, open: 29400, high: 29410, low: 29395, close: 29405 }
  // A rogue tick jumps 200 points up (e.g. unshifted CFD collision)
  const spiked = applyTickToFormingBar(last, 29605, t0 + 15, 300, 'NASDAQ')
  assert.equal(spiked.last.high, 29410, 'rogue +200 pt tick does NOT stretch NASDAQ high')
  assert.equal(spiked.last.close, 29405, 'rogue tick close is ignored')

  // A valid tick (+10 points) is accepted normally
  const valid = applyTickToFormingBar(last, 29415, t0 + 20, 300, 'NASDAQ')
  assert.equal(valid.last.high, 29415, 'valid tick normal expansion accepted')
  assert.equal(valid.last.close, 29415)
}

{
  // Fast market plunge on Crude Oil (e.g. EIA inventory drop $92.50 -> $90.60)
  const crudeBar = { time: t0, open: 92.5, high: 92.6, low: 92.4, close: 92.5 }
  
  // Real-time CME / Databento trusted feed applies the fast drop without stalling
  const droppedTrusted = applyTickToFormingBar(crudeBar, 90.6, t0 + 30, 300, 'CRUDE', true)
  assert.equal(droppedTrusted.last.low, 90.6, 'trusted CME feed records fast Crude plunge low')
  assert.equal(droppedTrusted.last.close, 90.6, 'trusted CME feed records fast Crude plunge close')

  // Consecutive-tick confirmation (forceAccept) allows untrusted proxy feeds to update
  const droppedConfirmed = applyTickToFormingBar(crudeBar, 90.6, t0 + 30, 300, 'CRUDE', false, true)
  assert.equal(droppedConfirmed.last.low, 90.6, 'confirmed proxy tick records fast Crude plunge low')
  assert.equal(droppedConfirmed.last.close, 90.6, 'confirmed proxy tick records fast Crude plunge close')

  // Next bucket rollover prints the subsequent bar seamlessly
  const rolledNext = applyTickToFormingBar(droppedTrusted.last, 90.4, t0 + 300, 300, 'CRUDE', true)
  assert.equal(rolledNext.rolled, true, 'subsequent bar rolls without obstruction')
  assert.equal(rolledNext.last.time, t0 + 300)
  assert.equal(rolledNext.last.open, 90.6, 'new bar opens at previous bar close')
  assert.equal(rolledNext.last.close, 90.4)
}

{
  // Multi-timeframe step resolution:
  assert.equal(timeframeToSeconds('1m'), 60)
  assert.equal(timeframeToSeconds('5m'), 300)
  assert.equal(timeframeToSeconds('15m'), 900)
  assert.equal(timeframeToSeconds('30m'), 1800)
  assert.equal(timeframeToSeconds('1H'), 3600)
  assert.equal(timeframeToSeconds('4H'), 14400)
  assert.equal(timeframeToSeconds('1D'), 86400)
}

{
  // 15m chart: mergeHistoryWithLiveTip must use 900s step and not inject 5m (300s) intermediate bars
  const t15 = 1_700_000_000 - (1_700_000_000 % 900)
  const hist15 = [
    { time: t15, open: 100, high: 102, low: 99, close: 101, volume: 50 },
  ]
  const live15 = {
    time: t15 + 900,
    open: 101,
    high: 103,
    low: 100.5,
    close: 102.5,
    volume: 30,
  }
  const merged15 = mergeHistoryWithLiveTip(hist15, live15, '15m')
  assert.equal(merged15.length, 2, '15m chart merges next bucket without intermediate 5m bars')
  assert.equal(merged15[0]!.time, t15)
  assert.equal(merged15[1]!.time, t15 + 900)

  // When live is 2 buckets ahead on 15m, intermediate bar must have exactly 900s step
  const live15TwoAhead = {
    time: t15 + 1800,
    open: 101,
    high: 103,
    low: 100.5,
    close: 102.5,
    volume: 30,
  }
  const merged15Gap = mergeHistoryWithLiveTip(hist15, live15TwoAhead, '15m')
  assert.equal(merged15Gap.length, 3)
  assert.equal(merged15Gap[1]!.time, t15 + 900, 'intermediate gap fill is 15m (900s), not 5m (300s)')
  assert.equal(merged15Gap[2]!.time, t15 + 1800)
}

{
  // 1H chart: mergeHistoryWithLiveTip must use 3600s step
  const t1h = 1_700_000_000 - (1_700_000_000 % 3600)
  const hist1h = [
    { time: t1h, open: 200, high: 205, low: 198, close: 202, volume: 100 },
  ]
  const live1h = {
    time: t1h + 3600,
    open: 202,
    high: 206,
    low: 201,
    close: 204,
    volume: 40,
  }
  const merged1h = mergeHistoryWithLiveTip(hist1h, live1h, '1H')
  assert.equal(merged1h.length, 2, '1H chart merges next bucket without intermediate 5m bars')
  assert.equal(merged1h[1]!.time, t1h + 3600)
}

{
  // closedHistoryOhlcChanged detects modified closed bar up to 50 bars ago
  const tip = { time: t0 + 30 * 300, open: 100, high: 101, low: 99, close: 100.5 }
  const barsA: Array<{ time: number; open: number; high: number; low: number; close: number }> = []
  for (let i = 0; i < 30; i++) {
    barsA.push({ time: t0 + i * 300, open: 100, high: 101, low: 99, close: 100 })
  }
  barsA.push(tip)
  const barsB = barsA.map((b) => ({ ...b }))
  // Modify bar 20 bars ago (which was outside the old 12-bar window)
  barsB[10]!.close = 101.5
  assert.equal(
    closedHistoryOhlcChanged(barsA, barsB, true),
    true,
    'modifications 20 bars back are cleanly detected'
  )
}

console.log('live_forming_bar: all passed')
