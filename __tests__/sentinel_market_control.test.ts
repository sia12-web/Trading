/**
 * SENTINEL — Dalton control engine (Slice 1): clocks, lunch freeze,
 * input abuse, ticket freeze. No overlay/Leo/API in this slice.
 * Run: npx tsx __tests__/sentinel_market_control.test.ts
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
  closedControlPeriods,
  computeMarketControl,
  CONTROL_PERIOD_SEC,
  formatMarketControlForPrompt,
  marketControlBadgeText,
  marketControlLineSpecs,
  marketControlPaintKey,
  resolveMarketControlAsOfUnix,
  rotationStep,
  type ControlBar,
} from '../lib/trading/marketControl'

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
const tokyoOpen = cashOpenUnixForYmd('2026-08-17', TOKYO_DESK_CLOCK)

function asOfPeriods(nClosed: number, openU = mondayOpen): number {
  return openU + nClosed * CONTROL_PERIOD_SEC
}

function fillPeriod(
  openU: number,
  idx: number,
  ohlc: { open: number; high: number; low: number; close: number }
): ControlBar[] {
  const start = openU + idx * CONTROL_PERIOD_SEC
  const out: ControlBar[] = []
  for (let i = 0; i < 6; i++) {
    out.push({ time: start + i * 300, ...ohlc, volume: 1 })
  }
  return out
}

function buyStairs(openU = mondayOpen, n = 4): ControlBar[] {
  const out: ControlBar[] = []
  for (let i = 0; i < n; i++) {
    const base = 42100 + i * 40
    out.push(
      ...fillPeriod(openU, i, {
        open: base,
        high: base + 50,
        low: base - 10,
        close: base + 30,
      })
    )
  }
  return out
}

function rotateBars(openU = mondayOpen, n = 8): ControlBar[] {
  const out: ControlBar[] = []
  for (let i = 0; i < n; i++) {
    out.push(
      ...fillPeriod(openU, i, {
        open: 42100,
        high: 42120 + i * 15,
        low: 42080 - i * 15,
        close: 42100,
      })
    )
  }
  return out
}

// ─── Clock boundaries ────────────────────────────────────────────────────────

test('one second before B close is still WAIT', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2) - 1,
  })
  assert.equal(p.label, 'WAIT')
  assert.equal(p.rf, null)
  assert.equal(marketControlBadgeText(p), 'RF WAIT')
})

test('asOf exactly IB end (open + 60m) locks RF', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: mondayOpen + 60 * 60,
  })
  assert.equal(p.periodCount, 2)
  assert.ok(p.rf != null)
  assert.notEqual(p.label, 'WAIT')
})

test('WAIT prompt does not invent an RF number', () => {
  const packed = formatMarketControlForPrompt(
    computeMarketControl({
      instrument: 'DOW',
      candles: buyStairs(),
      asOfUnix: asOfPeriods(1),
    })
  )
  assert.ok(packed.includes('waiting'))
  assert.ok(!/RF [+-]?\d/.test(packed), 'waiting copy must not print a scored RF')
  assert.ok(!packed.includes('ONE-TF'))
})

test('single 5m print in A + full B still locks (thin OR30)', () => {
  const bars: ControlBar[] = [
    {
      time: mondayOpen,
      open: 42100,
      high: 42150,
      low: 42090,
      close: 42120,
      volume: 1,
    },
    ...fillPeriod(mondayOpen, 1, {
      open: 42140,
      high: 42190,
      low: 42130,
      close: 42170,
    }),
  ]
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.periodCount, 2)
  assert.ok(p.rf != null)
})

test('duplicate timestamps in A merge high/low', () => {
  const start = mondayOpen
  const bars: ControlBar[] = [
    { time: start, open: 42100, high: 42110, low: 42090, close: 42100, volume: 1 },
    { time: start, open: 42100, high: 42180, low: 42050, close: 42100, volume: 1 },
    ...fillPeriod(mondayOpen, 1, {
      open: 42120,
      high: 42200,
      low: 42100,
      close: 42150,
    }),
  ]
  const periods = closedControlPeriods(
    bars,
    mondayOpen,
    mondayOpen + 7 * 3600,
    asOfPeriods(2)
  )
  assert.equal(periods[0]!.high, 42180)
  assert.equal(periods[0]!.low, 42050)
})

test('equal highs within EPS score 0 not +1', () => {
  const s = rotationStep(
    { high: 100, low: 90 },
    { high: 100 + 1e-12, low: 90 }
  )
  assert.equal(s.top, 0)
})

// ─── asOf resolve (live vs sim) ──────────────────────────────────────────────

test('live RTH asOf uses wall clock when last bar is stale', () => {
  const lastBar = mondayOpen
  const wall = mondayOpen + 90 * 60
  assert.equal(resolveMarketControlAsOfUnix('DOW', lastBar, wall), wall)
})

test('weekend live asOf stays on last bar (no fake Saturday cash open)', () => {
  const lastFri = zonedCivilToUnix(
    '2026-08-14',
    NY_DESK_CLOCK.overnightStartHour,
    NY_DESK_CLOCK.timeZone
  ) - 300
  const sat = cashOpenUnixForYmd('2026-08-15', NY_DESK_CLOCK)
  assert.equal(resolveMarketControlAsOfUnix('DOW', lastFri, sat + 3600), lastFri)
})

test('NaN asOf does not throw', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: Number.NaN,
  })
  assert.equal(p.label, 'WAIT')
})

test('non-array candles does not throw', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: null as unknown as ControlBar[],
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.label, 'WAIT')
})

test('Infinity OHLC is skipped; remaining stairs still score', () => {
  const bars: ControlBar[] = [
    {
      time: mondayOpen,
      open: 42100,
      high: Number.POSITIVE_INFINITY,
      low: 42090,
      close: 42100,
      volume: 1,
    },
    ...buyStairs(mondayOpen, 2),
  ]
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfPeriods(2),
  })
  assert.ok(p.label === 'ONE-TF BUY' || p.label === 'TWO-TF' || p.label === 'WAIT')
})

// ─── Lunch / flatten / close ─────────────────────────────────────────────────

test('RF 0 at 12:00 still freezes amRf (0 is not "missing")', () => {
  const lunchU = zonedCivilToUnix('2026-08-17', 12, NY_DESK_CLOCK.timeZone)
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: rotateBars(mondayOpen, 8),
    asOfUnix: lunchU + 1800,
  })
  assert.equal(p.amRf, 0)
  assert.ok(formatMarketControlForPrompt(p).includes('CONTROL AM'))
})

test('11:30 ET flatten is not a TPO split — letters keep counting', () => {
  const flatten = zonedCivilToUnix('2026-08-17', 11.5, NY_DESK_CLOCK.timeZone)
  const lunch = zonedCivilToUnix('2026-08-17', 12, NY_DESK_CLOCK.timeZone)
  const before = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 8),
    asOfUnix: flatten - 1,
  })
  const after = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 8),
    asOfUnix: lunch,
  })
  assert.ok(after.periodCount >= before.periodCount)
  assert.ok(after.periodCount > before.periodCount || after.amRf != null)
})

test('Tokyo 12:00 JST does not freeze NYC lunch AM', () => {
  const tokyoNoon = zonedCivilToUnix('2026-08-17', 12, TOKYO_DESK_CLOCK.timeZone)
  const p = computeMarketControl({
    instrument: 'NIKKEI',
    candles: buyStairs(tokyoOpen, 8),
    asOfUnix: tokyoNoon + 60,
  })
  assert.equal(p.amRf, null)
  assert.equal(p.sourceSession, 'TOKYO_CASH')
})

test('last 30m ending at NY cash close is included; Globex after close is not', () => {
  const closeU = zonedCivilToUnix(
    '2026-08-17',
    NY_DESK_CLOCK.overnightStartHour,
    NY_DESK_CLOCK.timeZone
  )
  const lastIdx = Math.floor((closeU - mondayOpen) / CONTROL_PERIOD_SEC) - 1
  const globex: ControlBar = {
    time: closeU,
    open: 99999,
    high: 99999,
    low: 99990,
    close: 99999,
    volume: 1,
  }
  const periods = closedControlPeriods(
    [...buyStairs(mondayOpen, lastIdx + 1), globex],
    mondayOpen,
    closeU,
    closeU + 3600
  )
  assert.ok(periods.length >= 2)
  assert.ok(periods.every((p) => p.end <= closeU))
  assert.ok(periods.every((p) => p.high < 90000))
})

test('WAIT has no dPOC line', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(),
    asOfUnix: asOfPeriods(1),
  })
  assert.equal(marketControlLineSpecs(p).length, 0)
})

// ─── Input / security ────────────────────────────────────────────────────────

test('SQL-ish instrument id is not echoed in the prompt', () => {
  const p = computeMarketControl({
    instrument: "DOW' OR 1=1 --",
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  const packed = formatMarketControlForPrompt(p)
  assert.ok(!packed.includes('OR 1=1'))
  assert.ok(!packed.includes('--'))
  assert.equal(p.sourceSession, 'NY_RTH')
})

test('prompt never tells Leo to auto-move or unlock ±10', () => {
  const packed = formatMarketControlForPrompt(
    computeMarketControl({
      instrument: 'DOW',
      candles: buyStairs(mondayOpen, 2),
      asOfUnix: asOfPeriods(2),
    })
  )
  assert.ok(packed.toLowerCase().includes('advise-only'))
  assert.ok(packed.includes('1.5R'))
  assert.ok(!packed.toLowerCase().includes('unlock ±10'))
  assert.ok(!packed.toLowerCase().includes('auto-move'))
  assert.equal(DEFAULT_TAKE_PROFIT_R, 1.5)
})

test('paint key off is identical across instruments', () => {
  const a = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  const b = computeMarketControl({
    instrument: 'NASDAQ',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(marketControlPaintKey(false, a), 'off')
  assert.equal(marketControlPaintKey(false, b), 'off')
})

test('live and sim both call the same control helper', () => {
  const live = src('app/dashboard/chart/components/TradingChart.tsx')
  const sim = src('app/dashboard/simulation/replay/desk/page.tsx')
  assert.ok(live.includes('computeMarketControl'))
  assert.ok(live.includes('resolveMarketControlAsOfUnix'))
  assert.ok(sim.includes('computeMarketControl'))
  assert.ok(sim.includes('resolveMarketControlAsOfUnix'))
  assert.ok(sim.includes('simT, simT'), 'sim passes replay time twice')
  assert.ok(live.includes('<span>Ctrl</span>'))
  assert.ok(sim.includes('Ctrl'))
  assert.ok(live.includes('indigo-400'))
  assert.ok(sim.includes('indigo-400'))
  assert.ok(live.includes('marketControlLineSpecs'))
  assert.ok(sim.includes('marketControlLineSpecs'))
  assert.ok(!live.includes('Press C'))
  assert.ok(!sim.includes('Press C'))
  assert.ok(src('lib/trading/liveVoicePrompt.ts').includes('CONTROL (Dalton — RF + dPOC)'))
  assert.ok(src('lib/trading/rangeLiquidityBrief.ts').includes('computeMarketControl'))
  assert.ok(!src('lib/trading/marketControl.ts').includes('/api/trading/control'))
})

test('opening-activity engine is unchanged by this slice', () => {
  const open = src('lib/trading/openingActivity.ts')
  assert.ok(open.includes('computeOpeningActivity'))
  assert.ok(!open.includes('computeMarketControl'))
  assert.ok(!open.includes('ONE-TF BUY'))
})

if (failed.length) {
  console.error(`sentinel_market_control: ${failed.length} failed / ${passed.length} passed`)
  for (const f of failed) console.error(`  FAIL ${f.name}: ${f.error}`)
  process.exit(1)
}

console.log(`sentinel_market_control: ${passed.length} passed`)
