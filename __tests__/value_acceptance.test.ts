/**
 * Time / value acceptance — R-based pocket, time ramp, never 15:00 cliff.
 * Run: npx tsx __tests__/value_acceptance.test.ts
 */

import assert from 'node:assert/strict'
import {
  VALUE_ACCEPTANCE_ACCEPTED_MESSAGE,
  VALUE_ACCEPTANCE_EXTENSION_R,
  VALUE_ACCEPTANCE_POCKET_R,
  VALUE_ACCEPTANCE_RAMP_FULL_MS,
  VALUE_ACCEPTANCE_RAMP_START_MS,
  entryPocketBounds,
  scoreValueAcceptance,
  timeRamp,
  toEpochMs,
} from '../lib/trading/valueAcceptance'

function assertNeverAccepted(label: string, state: string) {
  assert.notEqual(state, 'looking_accepted', label)
}

const FILL = Date.parse('2026-08-17T14:40:00Z')

function score(over: Partial<Parameters<typeof scoreValueAcceptance>[0]> & {
  lastPrice: number
  nowMs: number
  side?: 'LONG' | 'SHORT'
  entry?: number
  stopLoss?: number
  takeProfit?: number
  recentBars?: { high: number; low: number }[]
}) {
  const entry = over.entry ?? 52000
  const stopLoss = over.stopLoss ?? 51920
  return scoreValueAcceptance({
    side: over.side ?? 'LONG',
    entry,
    stopLoss,
    takeProfit: over.takeProfit ?? 52120,
    nowMs: over.nowMs,
    filledAtMs: over.filledAtMs ?? FILL,
    lastPrice: over.lastPrice,
    recentBars: over.recentBars,
  })
}

{
  assert.equal(toEpochMs(1_700_000_000), 1_700_000_000_000, 'unix seconds → ms')
  assert.equal(toEpochMs(1_700_000_000_000), 1_700_000_000_000, 'ms stays ms')
  assert.ok(toEpochMs('2026-08-17T14:40:00Z') === FILL)
  assert.equal(toEpochMs(null), null)
}

{
  const { r, pocketLow, pocketHigh } = entryPocketBounds(52000, 51920)
  assert.equal(r, 80)
  assert.equal(pocketLow, 52000 - 80 * VALUE_ACCEPTANCE_POCKET_R)
  assert.equal(pocketHigh, 52000 + 80 * VALUE_ACCEPTANCE_POCKET_R)
  assert.equal(timeRamp(VALUE_ACCEPTANCE_RAMP_START_MS - 1), 0)
  assert.equal(timeRamp(VALUE_ACCEPTANCE_RAMP_FULL_MS), 1)
  assert.ok(timeRamp(14 * 60 * 1000) > 0 && timeRamp(14 * 60 * 1000) < 1)
}

// before 8 min: never looking_accepted
{
  const t = FILL + 7 * 60 * 1000
  const long = score({ lastPrice: 52002, nowMs: t })
  assert.equal(long.state, 'still_auctioning', 'long <8m still auctioning')
  assertNeverAccepted('long <8m', long.state)
  assert.ok(long.elapsedMs === 7 * 60 * 1000)

  const sh = score({
    side: 'SHORT',
    entry: 21000,
    stopLoss: 21080,
    takeProfit: 20880,
    lastPrice: 20998,
    nowMs: t,
  })
  assertNeverAccepted('short <8m', sh.state)
  assert.equal(sh.state, 'still_auctioning')
}

// 15:00 is not a cliff — 10 min after a 14:50 fill is still not accepted
{
  const filledAtMs = Date.parse('2026-08-17T14:50:00Z')
  const fifteen = Date.parse('2026-08-17T15:00:00Z')
  const r = score({
    filledAtMs,
    lastPrice: 51996,
    nowMs: fifteen,
  })
  assertNeverAccepted('not accepted at 15:00 after 10m', r.state)
  assert.equal(r.state, 'looking_balanced', '10m in pocket = balanced, not accepted')
}

// stuck in pocket, 20+ min, no progress → looking_accepted
{
  const t = FILL + VALUE_ACCEPTANCE_RAMP_FULL_MS + 30 * 1000
  const long = score({ lastPrice: 51997, nowMs: t })
  assert.equal(long.state, 'looking_accepted', 'long 20m+ stuck in pocket')
  assert.equal(long.message, VALUE_ACCEPTANCE_ACCEPTED_MESSAGE)
  assert.ok(long.confidence >= 0.75)
  assert.ok(long.rProgress < VALUE_ACCEPTANCE_POCKET_R)

  const mym = score({
    entry: 45500,
    stopLoss: 45420,
    takeProfit: 45620,
    lastPrice: 45504,
    nowMs: t,
  })
  assert.equal(mym.state, 'looking_accepted', 'MYM prices still R-based')

  const mnq = score({
    side: 'SHORT',
    entry: 20100,
    stopLoss: 20180,
    takeProfit: 19980,
    lastPrice: 20106,
    nowMs: t,
  })
  assert.equal(mnq.state, 'looking_accepted', 'MNQ prices still R-based')
}

// overlapping 5m bars stuck at entry, 20+ min
{
  const t = FILL + 22 * 60 * 1000
  const bars = [
    { high: 52008, low: 51990 },
    { high: 52010, low: 51988 },
    { high: 52006, low: 51992 },
  ]
  const r = score({ lastPrice: 52000, nowMs: t, recentBars: bars })
  assert.equal(r.state, 'looking_accepted', 'overlapping bars at entry')
}

// left pocket / 0.5R+ then pause → NOT looking_accepted
{
  const t = FILL + 25 * 60 * 1000
  const r = 80
  const halfR = 52000 + r * VALUE_ACCEPTANCE_EXTENSION_R
  const bars = [
    { high: halfR + 4, low: 52010 },
    { high: 52020, low: 51995 },
    { high: 52008, low: 51990 },
  ]
  const paused = score({ lastPrice: 52001, nowMs: t, recentBars: bars })
  assertNeverAccepted('0.5R then pause', paused.state)
  assert.equal(paused.state, 'still_auctioning')
  assert.ok(paused.maxFavorableR >= VALUE_ACCEPTANCE_EXTENSION_R)

  const leftPocket = score({
    lastPrice: 52001,
    nowMs: t,
    recentBars: [
      { high: 52000 + r * 0.4, low: 51995 },
      { high: 52012, low: 51990 },
    ],
  })
  assertNeverAccepted('left pocket then pause', leftPocket.state)
  assert.equal(leftPocket.state, 'still_auctioning')
}

// progress toward TP → still_auctioning
{
  const t = FILL + 12 * 60 * 1000
  const long = score({ lastPrice: 52000 + 50, nowMs: t })
  assert.equal(long.state, 'still_auctioning', 'long progress toward TP')
  assert.ok(long.rProgress > VALUE_ACCEPTANCE_POCKET_R)

  const sh = score({
    side: 'SHORT',
    entry: 21000,
    stopLoss: 21080,
    takeProfit: 20880,
    lastPrice: 20920,
    nowMs: t,
  })
  assert.equal(sh.state, 'still_auctioning', 'short progress toward TP')
  assert.ok(sh.rProgress > 0.3)
}

// 8–20 min stuck in pocket → looking_balanced, not accepted
{
  const t = FILL + 12 * 60 * 1000
  const r = score({ lastPrice: 52000, nowMs: t })
  assert.equal(r.state, 'looking_balanced')
  assertNeverAccepted('12m balanced', r.state)
  assert.ok(r.confidence > 0 && r.confidence < 0.75)
}

// short vs long pocket math
{
  const t = FILL + 21 * 60 * 1000
  const sh = score({
    side: 'SHORT',
    entry: 21000,
    stopLoss: 21080,
    takeProfit: 20880,
    lastPrice: 21004,
    nowMs: t,
  })
  assert.equal(sh.state, 'looking_accepted', 'short stuck at entry')
  assert.ok(sh.pocketLow < 21000 && sh.pocketHigh > 21000)
  assert.ok(Math.abs(sh.rProgress) < VALUE_ACCEPTANCE_POCKET_R)

  const longAway = score({
    lastPrice: 51800,
    nowMs: t,
  })
  assertNeverAccepted('long well against is not accepted', longAway.state)
}

// BE-like stop (tiny R) — never looking_accepted
{
  const t = FILL + 25 * 60 * 1000
  const be = score({
    entry: 52000,
    stopLoss: 51999,
    lastPrice: 52000,
    nowMs: t,
  })
  assertNeverAccepted('BE-like stop', be.state)
}

// R=0 / missing SL / NaN — never accepted, never throws
{
  const t = FILL + 25 * 60 * 1000
  const zeroR = score({ lastPrice: 52000, nowMs: t, stopLoss: 52000 })
  assertNeverAccepted('R=0 same SL', zeroR.state)
  assert.equal(zeroR.state, 'still_auctioning')

  const slZero = score({ lastPrice: 52000, nowMs: t, stopLoss: 0 })
  assertNeverAccepted('SL=0 must not false-accept', slZero.state)

  const nanPx = score({ lastPrice: Number.NaN, nowMs: t })
  assertNeverAccepted('NaN lastPrice', nanPx.state)

  const nanEntry = scoreValueAcceptance({
    side: 'LONG',
    entry: Number.NaN,
    stopLoss: 51920,
    nowMs: t,
    filledAtMs: FILL,
    lastPrice: 52000,
  })
  assertNeverAccepted('NaN entry', nanEntry.state)
}

// live clock mix: unix-seconds fill vs epoch-ms now
{
  const filledSec = FILL / 1000
  const filledAtMs = toEpochMs(filledSec)
  assert.ok(filledAtMs != null && Math.abs(filledAtMs - FILL) < 1)
  const r = score({
    lastPrice: 51997,
    nowMs: FILL + VALUE_ACCEPTANCE_RAMP_FULL_MS + 30 * 1000,
    filledAtMs,
  })
  assert.equal(r.state, 'looking_accepted', 'unix-seconds fill converted to ms')
}

console.log('value_acceptance.test.ts: all assertions passed')
