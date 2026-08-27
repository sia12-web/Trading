/**
 * Session STAY/EXIT engine.
 * Run: npx tsx __tests__/session_exit.test.ts
 */

import assert from 'node:assert/strict'
import { cashOpenUnixForYmd, NY_DESK_CLOCK } from '../lib/chart/sessionVwap'
import {
  computeSessionExit,
  parseFillUnix,
  rAtPrice,
  sessionExitWalls,
  SESSION_EXIT_ARM_SEC,
  SESSION_EXIT_BAR_SEC,
  SESSION_EXIT_LAST_WINDOW_SEC,
} from '../lib/trading/sessionExit'

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

const open = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
const fill = open + 5 * 60
const entry = 52000
const stop = 51800 // 200 pts = 1R for LONG
const lunch = open + 2 * 3600 // 11:30
const flatten = open + 6.5 * 3600 // 16:00

function barsAt(
  prices: { min: number; close: number }[]
): { time: number; close: number }[] {
  return prices.map((p) => ({
    time: fill + p.min * 60,
    close: p.close,
  }))
}

function longPx(r: number): number {
  return entry + r * (entry - stop)
}

function evalAt(args: {
  min: number
  prices: { min: number; close: number }[]
  liveR?: number
  or30Locked?: boolean
  perfLeave?: boolean
  market?: 'NY' | 'ASIA'
  lunchUnix?: number | null
  flattenUnix?: number
}) {
  const nowUnix = fill + args.min * 60
  const livePrice =
    args.liveR != null ? longPx(args.liveR) : args.prices.at(-1)?.close ?? entry
  return computeSessionExit({
    direction: 'LONG',
    entry,
    stop,
    fillUnix: fill,
    nowUnix,
    bars: barsAt(args.prices),
    livePrice,
    or30Locked: args.or30Locked ?? true,
    market: args.market ?? 'NY',
    perfLeave: args.perfLeave,
    lunchUnix: args.lunchUnix === undefined ? lunch : args.lunchUnix,
    flattenUnix: args.flattenUnix ?? flatten,
  })
}

test('R is stop distance, same for a short', () => {
  assert.equal(rAtPrice({ direction: 'LONG', entry, stop, price: longPx(1) }), 1)
  assert.equal(
    Math.round(
      rAtPrice({ direction: 'SHORT', entry, stop: 52200, price: 51700 }) * 10
    ) / 10,
    1.5
  )
  assert.ok(parseFillUnix('2026-08-17T14:00:00.000Z')! > 0)
  assert.equal(parseFillUnix(null), null)
})

test('unarmed before 30m even if OR30 locked', () => {
  const read = evalAt({
    min: 20,
    prices: [
      { min: 5, close: longPx(0.1) },
      { min: 20, close: longPx(0.1) },
    ],
    liveR: 0.1,
  })
  assert.equal(read.word, 'STAY')
  assert.equal(read.reason, 'unarmed')
  assert.ok(read.line.includes('arms in'))
})

test('NY morning fill waits for OR30 lock', () => {
  const read = evalAt({
    min: 40,
    prices: [{ min: 40, close: longPx(0) }],
    liveR: 0,
    or30Locked: false,
  })
  assert.equal(read.word, 'STAY')
  assert.equal(read.armed, false)
})

test('stalled EXIT after arm when MFE dead and R ≤ +0.3', () => {
  const prices = []
  for (let m = 5; m <= 45; m += 5) prices.push({ min: m, close: longPx(0.1) })
  const read = evalAt({ min: 45, prices, liveR: 0.1 })
  assert.equal(read.word, 'EXIT')
  assert.equal(read.reason, 'stalled')
  assert.ok(read.line.startsWith('EXIT · stalled'))
})

test('expanding green never EXITs on stall/red', () => {
  const prices = []
  for (let m = 5; m <= 45; m += 5) {
    prices.push({ min: m, close: longPx(0.05 * (m / 5)) })
  }
  const read = evalAt({ min: 45, prices, liveR: 0.45 })
  assert.equal(read.word, 'STAY')
  assert.ok(read.reason === 'expanding' || read.reason === 'hold')
  assert.ok(read.mfe > 0.3)
})

test('red clock EXIT when armed, more red than green, red now', () => {
  const prices = [
    { min: 5, close: longPx(-0.2) },
    { min: 10, close: longPx(-0.2) },
    { min: 15, close: longPx(0.1) },
    { min: 20, close: longPx(-0.2) },
    { min: 25, close: longPx(-0.2) },
    { min: 30, close: longPx(-0.2) },
    { min: 35, close: longPx(-0.2) },
  ]
  const read = evalAt({ min: 35, prices, liveR: -0.2 })
  assert.equal(read.word, 'EXIT')
  assert.equal(read.reason, 'red_clock')
  assert.ok(read.line.includes('red'))
})

test('lunch EXIT when R < +0.5R', () => {
  const lunchMin = (lunch - fill) / 60
  const prices = [{ min: lunchMin, close: longPx(0.2) }]
  const read = evalAt({ min: lunchMin, prices, liveR: 0.2 })
  assert.equal(read.word, 'EXIT')
  assert.equal(read.reason, 'lunch')
  assert.ok(read.line.includes('lunch'))
})

test('lunch STAY when ≥ +0.5R and MFE expanding', () => {
  const lunchMin = (lunch - fill) / 60
  const prices = [
    { min: lunchMin - 5, close: longPx(0.4) },
    { min: lunchMin, close: longPx(0.7) },
  ]
  const read = evalAt({ min: lunchMin, prices, liveR: 0.7 })
  assert.equal(read.word, 'STAY')
  assert.equal(read.reason, 'expanding')
})

test('last 20m EXIT unless R ≥ +0.8R', () => {
  const t = flatten - SESSION_EXIT_LAST_WINDOW_SEC + 60
  const min = (t - fill) / 60
  const weak = evalAt({
    min,
    prices: [{ min, close: longPx(0.4) }],
    liveR: 0.4,
  })
  assert.equal(weak.word, 'EXIT')
  assert.equal(weak.reason, 'last_window')
  const strong = evalAt({
    min,
    prices: [{ min, close: longPx(0.9) }],
    liveR: 0.9,
  })
  assert.ok(strong.word === 'STAY' || strong.currentR >= 0.8)
  assert.notEqual(strong.reason, 'last_window')
})

test('stop owns suppresses clock EXIT at ≤ −0.7R', () => {
  const prices = []
  for (let m = 5; m <= 40; m += 5) prices.push({ min: m, close: longPx(-0.8) })
  const read = evalAt({ min: 40, prices, liveR: -0.8 })
  assert.equal(read.word, 'STAY')
  assert.equal(read.reason, 'stop_owns')
  assert.ok(read.line.includes('stop owns'))
})

test('Perf LEAVE still EXITs when stop owns', () => {
  const prices = [{ min: 40, close: longPx(-0.8) }]
  const read = evalAt({ min: 40, prices, liveR: -0.8, perfLeave: true })
  assert.equal(read.word, 'EXIT')
  assert.equal(read.reason, 'perf')
  assert.equal(read.line, 'EXIT · Perf')
})

test('sticky EXIT unsticks once on a new MFE', () => {
  const stallPrices = []
  for (let m = 5; m <= 45; m += 5) stallPrices.push({ min: m, close: longPx(0.05) })
  const dead = evalAt({ min: 45, prices: stallPrices, liveR: 0.05 })
  assert.equal(dead.word, 'EXIT')
  const run = evalAt({
    min: 50,
    prices: [...stallPrices, { min: 50, close: longPx(0.5) }],
    liveR: 0.5,
  })
  assert.equal(run.word, 'STAY')
  assert.equal(run.reason, 'expanding')
})

test('Asia book has no lunch wall and arms without OR30', () => {
  const walls = sessionExitWalls({ fillUnix: fill, market: 'ASIA' })
  assert.equal(walls.lunchUnix, null)
  assert.ok(walls.flattenUnix > fill)
  const read = computeSessionExit({
    direction: 'LONG',
    entry,
    stop,
    fillUnix: fill,
    nowUnix: fill + SESSION_EXIT_ARM_SEC + SESSION_EXIT_BAR_SEC,
    bars: [
      { time: fill + 5 * 60, close: longPx(0.05) },
      { time: fill + SESSION_EXIT_ARM_SEC + SESSION_EXIT_BAR_SEC, close: longPx(0.05) },
    ],
    livePrice: longPx(0.05),
    or30Locked: false,
    market: 'ASIA',
    lunchUnix: null,
    flattenUnix: fill + 8 * 3600,
  })
  assert.equal(read.armed, true)
  assert.equal(read.market, 'ASIA')
  assert.equal(read.word, 'EXIT')
  assert.equal(read.reason, 'stalled')
})

test('no fill time stays STAY', () => {
  const read = computeSessionExit({
    direction: 'LONG',
    entry,
    stop,
    fillUnix: null,
    nowUnix: fill + 3600,
    bars: [],
    livePrice: entry,
    or30Locked: true,
  })
  assert.equal(read.word, 'STAY')
  assert.equal(read.reason, 'no_fill')
})

test('NY walls are lunch 11:30 and flatten 16:00 on the fill day', () => {
  const walls = sessionExitWalls({ fillUnix: fill, market: 'NY' })
  assert.ok(walls.lunchUnix != null)
  assert.equal(walls.lunchUnix, lunch)
  assert.equal(walls.flattenUnix, flatten)
})

test('manage bar is advise-only STAY/EXIT; chart computes it', () => {
  const { readFileSync } = require('fs') as typeof import('fs')
  const { join } = require('path') as typeof import('path')
  const bar = readFileSync(
    join(__dirname, '../app/dashboard/chart/components/ManageDeskBar.tsx'),
    'utf8'
  )
  const chart = readFileSync(
    join(__dirname, '../app/dashboard/chart/components/TradingChart.tsx'),
    'utf8'
  )
  const page = readFileSync(
    join(__dirname, '../app/dashboard/chart/page.tsx'),
    'utf8'
  )
  assert.ok(bar.includes("sessionExit?.word === 'EXIT'"))
  assert.ok(bar.includes('banner only, not auto-flatten'))
  assert.ok(!bar.includes('onClosed(sessionExit'))
  assert.ok(chart.includes('computeSessionExit'))
  assert.ok(chart.includes('onSessionExit'))
  assert.ok(page.includes('sessionExit={sessionExit}'))
})

if (failed.length) {
  for (const f of failed) console.error(`FAIL ${f.name}: ${f.error}`)
  process.exit(1)
}
console.log(`session_exit: ${passed.length} passed`)
