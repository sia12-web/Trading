/**
 * SENTINEL — Dalton opening activity: edge cases, sim no-peek, ticket freeze,
 * live/sim/Leo contract. No new API.
 * Run: npx tsx __tests__/sentinel_opening_activity.test.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import assert from 'node:assert/strict'
import {
  cashOpenUnixForYmd,
  NY_DESK_CLOCK,
  TOKYO_DESK_CLOCK,
  zonedCivilToUnix,
} from '../lib/chart/sessionVwap'
import { DEFAULT_TAKE_PROFIT_R } from '../lib/trading/positionSizing'
import {
  computeOpeningActivity,
  formatOpeningActivityForPrompt,
  openingActivityBadgeText,
  openingActivityLineSpecs,
  openingActivityPaintKey,
  openingRefBuffer,
  OPENING_BAR_SEC,
  resolveOpeningAsOfUnix,
  touchesRef,
  type OpeningBar,
  type OpeningRefs,
} from '../lib/trading/openingActivity'

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

function src(rel: string): string {
  return readFileSync(join(__dirname, '..', rel), 'utf8')
}

const mondayOpen = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
const emptyRefs: OpeningRefs = {
  yh: null,
  yl: null,
  vah: null,
  val: null,
  overnightHigh: null,
  overnightLow: null,
}

function mondayBars(
  rows: Array<{ open: number; high: number; low: number; close: number }>
): OpeningBar[] {
  return rows.map((ohlc, i) => ({
    time: mondayOpen + i * OPENING_BAR_SEC,
    ...ohlc,
    volume: 1,
  }))
}

function asOf(nClosed: number): number {
  return mondayOpen + nClosed * OPENING_BAR_SEC
}

function driveUpBars(): OpeningBar[] {
  return mondayBars([
    { open: 42100, high: 42140, low: 42095, close: 42130 },
    { open: 42130, high: 42160, low: 42120, close: 42150 },
    { open: 42150, high: 42180, low: 42140, close: 42170 },
    { open: 42170, high: 42200, low: 42160, close: 42190 },
  ])
}

// ─── Empty / garbage input ───────────────────────────────────────────────────

test('empty candles → WAITING, no throw', () => {
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: [],
    asOfUnix: asOf(2),
    refs: emptyRefs,
  })
  assert.equal(p.type, 'WAITING')
  assert.equal(p.openPrice, null)
  assert.equal(openingActivityLineSpecs(p).length, 0)
})

test('before cash open → WAITING even with later bars in the array', () => {
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: driveUpBars(),
    asOfUnix: mondayOpen - 1,
    refs: emptyRefs,
  })
  assert.equal(p.type, 'WAITING')
  assert.equal(p.sessionDate, '2026-08-17')
})

test('Sunday asOf → WAITING with no sessionDate', () => {
  const sun = cashOpenUnixForYmd('2026-08-16', NY_DESK_CLOCK)
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: driveUpBars(),
    asOfUnix: sun + 600,
    refs: emptyRefs,
  })
  assert.equal(p.type, 'WAITING')
  assert.equal(p.sessionDate, null)
})

test('doji first bar (zero range) is not a Drive', () => {
  const bars = mondayBars([
    { open: 42100, high: 42100, low: 42100, close: 42100 },
    { open: 42100, high: 42100, low: 42100, close: 42100 },
    { open: 42100, high: 42100, low: 42100, close: 42100 },
  ])
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOf(3),
    refs: emptyRefs,
  })
  assert.equal(p.type, 'OPEN_AUCTION')
  assert.equal(p.failedDrive, false)
})

test('unsorted bars still classify Drive', () => {
  const bars = driveUpBars().slice(0, 2).reverse()
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOf(2),
    refs: emptyRefs,
  })
  assert.equal(p.type, 'OPEN_DRIVE')
  assert.equal(p.direction, 'up')
})

test('NaN / inverted OHLC does not throw', () => {
  const bars: OpeningBar[] = [
    {
      time: mondayOpen,
      open: Number.NaN,
      high: 1,
      low: 2,
      close: Number.POSITIVE_INFINITY,
      volume: 1,
    },
    {
      time: mondayOpen + OPENING_BAR_SEC,
      open: 42100,
      high: 42110,
      low: 42090,
      close: 42100,
      volume: 1,
    },
  ]
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOf(2),
    refs: emptyRefs,
  })
  assert.ok(p.type === 'WAITING' || p.type === 'OPEN_AUCTION' || p.type === 'OPEN_DRIVE' || p.type === 'OPEN_REJECTION_REVERSE' || p.type === 'OPEN_TEST_DRIVE')
})

// ─── Sim no-peek / closed bars ───────────────────────────────────────────────

test('sim asOf after bar 1 ignores later Drive bars sitting in the array', () => {
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: driveUpBars(),
    asOfUnix: asOf(1),
    refs: emptyRefs,
  })
  assert.equal(p.type, 'WAITING', 'must not peek at bars 2–4')
})

test('sim resolveOpeningAsOfUnix(simT, simT) never jumps to wall clock', () => {
  const simT = mondayOpen + 120
  const wall = mondayOpen + 4 * 3600
  assert.equal(resolveOpeningAsOfUnix('DOW', simT, simT), simT)
  assert.notEqual(resolveOpeningAsOfUnix('DOW', simT, simT), wall)
})

test('live RTH asOf uses wall clock when last bar is stale', () => {
  const lastBar = mondayOpen
  const wall = mondayOpen + 90 * 60
  assert.equal(resolveOpeningAsOfUnix('DOW', lastBar, wall), wall)
})

test('weekend live asOf stays on last bar (no fake Saturday cash open)', () => {
  const lastFri = zonedCivilToUnix(
    '2026-08-14',
    NY_DESK_CLOCK.overnightStartHour,
    NY_DESK_CLOCK.timeZone
  ) - 300
  const sat = cashOpenUnixForYmd('2026-08-15', NY_DESK_CLOCK)
  assert.equal(resolveOpeningAsOfUnix('DOW', lastFri, sat + 3600), lastFri)
})

// ─── Classification edges ────────────────────────────────────────────────────

test('Open-Drive down holds the first-bar high', () => {
  const bars = mondayBars([
    { open: 42100, high: 42108, low: 42020, close: 42040 },
    { open: 42040, high: 42050, low: 42000, close: 42010 },
  ])
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOf(2),
    refs: emptyRefs,
  })
  assert.equal(p.type, 'OPEN_DRIVE')
  assert.equal(p.direction, 'down')
  assert.equal(openingActivityBadgeText(p), 'DRIVE ↓')
})

test('Drive wins when a buying tail also tags YL', () => {
  const bars = mondayBars([
    { open: 42020, high: 42140, low: 42000, close: 42120 },
    { open: 42120, high: 42160, low: 42100, close: 42150 },
  ])
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOf(2),
    refs: { ...emptyRefs, yl: 42000, yh: 42200 },
  })
  assert.equal(p.type, 'OPEN_DRIVE', 'initiative tail is Drive, not Test-Drive')
  assert.equal(p.testedRef, null)
})

test('refs: null is empty refs — YL tag becomes Rej-Rev not Test-Drive', () => {
  const bars = mondayBars([
    { open: 42100, high: 42110, low: 42000, close: 42080 },
    { open: 42080, high: 42140, low: 42070, close: 42130 },
  ])
  const none = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOf(2),
    refs: null,
  })
  const tagged = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOf(2),
    refs: { ...emptyRefs, yl: 42000 },
  })
  assert.equal(none.type, 'OPEN_REJECTION_REVERSE')
  assert.equal(tagged.type, 'OPEN_TEST_DRIVE')
  assert.equal(tagged.testedRef, 'YL')
})

test('overnight low can be the Test-Drive reference', () => {
  const bars = mondayBars([
    { open: 42100, high: 42110, low: 41980, close: 42080 },
    { open: 42080, high: 42140, low: 42070, close: 42130 },
  ])
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOf(2),
    refs: { ...emptyRefs, overnightLow: 41980 },
  })
  assert.equal(p.type, 'OPEN_TEST_DRIVE')
  assert.equal(p.testedRef, 'ON_LOW')
})

test('price just outside the buffer is not a known-reference test', () => {
  const yl = 42000
  const buf = openingRefBuffer(yl)
  assert.equal(touchesRef(yl + buf + 5, yl + buf + 20, yl), false)
  const bars = mondayBars([
    { open: 42100, high: 42115, low: yl + buf + 8, close: 42070 },
    { open: 42070, high: 42150, low: 42060, close: 42135 },
  ])
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOf(2),
    refs: { ...emptyRefs, yl },
  })
  assert.equal(p.type, 'OPEN_REJECTION_REVERSE')
  assert.equal(p.testedRef, null)
})

test('NASDAQ uses NY cash open (same Drive as DOW clock)', () => {
  const p = computeOpeningActivity({
    instrument: 'NASDAQ',
    candles: driveUpBars().slice(0, 2),
    asOfUnix: asOf(2),
    refs: emptyRefs,
  })
  assert.equal(p.sourceSession, 'NY_RTH')
  assert.equal(p.type, 'OPEN_DRIVE')
})

test('Nikkei after Tokyo cash close keeps the morning Drive (no NY-hour re-open)', () => {
  const tokyoOpen = cashOpenUnixForYmd('2026-08-17', TOKYO_DESK_CLOCK)
  const tokyoClose = zonedCivilToUnix(
    '2026-08-17',
    TOKYO_DESK_CLOCK.overnightStartHour,
    TOKYO_DESK_CLOCK.timeZone
  )
  const bars: OpeningBar[] = [
    {
      time: tokyoOpen,
      open: 38000,
      high: 38080,
      low: 37990,
      close: 38050,
      volume: 1,
    },
    {
      time: tokyoOpen + OPENING_BAR_SEC,
      open: 38050,
      high: 38120,
      low: 38040,
      close: 38100,
      volume: 1,
    },
  ]
  const p = computeOpeningActivity({
    instrument: 'NIKKEI',
    candles: bars,
    asOfUnix: tokyoClose + 3 * 3600,
    refs: emptyRefs,
  })
  assert.equal(p.sourceSession, 'TOKYO_CASH')
  assert.equal(p.type, 'OPEN_DRIVE')
  assert.ok(formatOpeningActivityForPrompt(p).includes('not US Range'))
})

test('Drive stays locked at the cash close (no afternoon flip without a takeout)', () => {
  const closeU = zonedCivilToUnix(
    '2026-08-17',
    NY_DESK_CLOCK.overnightStartHour,
    NY_DESK_CLOCK.timeZone
  )
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: driveUpBars(),
    asOfUnix: closeU + 60,
    refs: emptyRefs,
  })
  assert.equal(p.type, 'OPEN_DRIVE')
  assert.equal(p.failedDrive, false)
})

// ─── Overlay / prompt contracts ──────────────────────────────────────────────

test('paint key off is identical so hidden lines are not rebuilt', () => {
  const a = computeOpeningActivity({
    instrument: 'DOW',
    candles: driveUpBars().slice(0, 2),
    asOfUnix: asOf(2),
    refs: emptyRefs,
  })
  const b = computeOpeningActivity({
    instrument: 'NASDAQ',
    candles: driveUpBars().slice(0, 2),
    asOfUnix: asOf(2),
    refs: emptyRefs,
  })
  assert.equal(openingActivityPaintKey(false, a), 'off')
  assert.equal(openingActivityPaintKey(false, b), 'off')
  assert.notEqual(openingActivityPaintKey(true, a), openingActivityPaintKey(true, b))
})

test('playLine and prompt never auto-move the ticket', () => {
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: driveUpBars().slice(0, 2),
    asOfUnix: asOf(2),
    refs: emptyRefs,
  })
  const packed = formatOpeningActivityForPrompt(p)
  assert.ok(p.playLine.includes('$400'))
  assert.ok(p.playLine.includes('1.5R'))
  assert.ok(p.playLine.includes('does not unlock off-band'))
  assert.ok(!p.playLine.toLowerCase().includes('auto-move'))
  assert.ok(!packed.toLowerCase().includes('auto-move'))
  assert.equal(DEFAULT_TAKE_PROFIT_R, 1.5)
})

test('prompt does not echo raw HTML from a weird instrument id', () => {
  const p = computeOpeningActivity({
    instrument: 'DOW<script>alert(1)</script>',
    candles: driveUpBars().slice(0, 2),
    asOfUnix: asOf(2),
    refs: emptyRefs,
  })
  const packed = formatOpeningActivityForPrompt(p)
  assert.ok(!packed.includes('<script>'))
  assert.equal(p.sourceSession, 'NY_RTH')
})

test('5000 leftover globex bars do not hang', () => {
  const junk: OpeningBar[] = []
  for (let i = 0; i < 5000; i++) {
    junk.push({
      time: mondayOpen - (i + 1) * 60,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1,
      volume: 1,
    })
  }
  const t0 = Date.now()
  const p = computeOpeningActivity({
    instrument: 'DOW',
    candles: [...junk, ...driveUpBars().slice(0, 2)],
    asOfUnix: asOf(2),
    refs: emptyRefs,
  })
  assert.ok(Date.now() - t0 < 2000, 'classifier must stay bounded')
  assert.equal(p.type, 'OPEN_DRIVE')
})

// ─── Live / sim / Leo wiring (no new API) ────────────────────────────────────

test('live and sim both call the same opening helper', () => {
  const live = src('app/dashboard/chart/components/TradingChart.tsx')
  const sim = src('app/dashboard/simulation/replay/desk/page.tsx')
  assert.ok(live.includes('computeOpeningActivity'))
  assert.ok(live.includes('resolveOpeningAsOfUnix'))
  assert.ok(sim.includes('computeOpeningActivity'))
  assert.ok(sim.includes('resolveOpeningAsOfUnix'))
  assert.ok(sim.includes('simT, simT'), 'sim passes replay time twice')
})

test('Leo + Level Finder + range brief print OPENING TYPE and keep ±10', () => {
  const leo = src('lib/trading/liveVoicePrompt.ts')
  const lf = src('lib/services/levelFinderAgent/levelFinderAgent.ts')
  const brief = src('lib/trading/rangeLiquidityBrief.ts')
  assert.ok(leo.includes('OPENING TYPE'))
  assert.ok(leo.includes('Never unlocks off-band'))
  assert.ok(lf.includes('OPENING TYPE'))
  assert.ok(lf.includes('Never unlocks ±10'))
  assert.ok(brief.includes('computeOpeningActivity'))
  assert.ok(brief.includes('formatOpeningActivityForPrompt'))
  assert.ok(!src('lib/trading/openingActivity.ts').includes('from('))
  assert.ok(!src('lib/trading/openingActivity.ts').includes('supabase'))
})

test('no new API route for opening type', () => {
  const live = src('app/dashboard/chart/components/TradingChart.tsx')
  const sim = src('app/dashboard/simulation/replay/desk/page.tsx')
  assert.ok(!live.includes('/api/trading/opening'))
  assert.ok(!sim.includes('/api/trading/opening'))
})

// ─── Report ──────────────────────────────────────────────────────────────────

if (failed.length) {
  console.error(`sentinel_opening_activity: ${failed.length} failed / ${passed.length} passed`)
  for (const f of failed) console.error(`  FAIL ${f.name}: ${f.error}`)
  process.exit(1)
}

console.log(`sentinel_opening_activity: ${passed.length} passed`)
