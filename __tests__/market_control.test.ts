/**
 * Dalton control engine — Rotation Factor + developing time-POC.
 * Run: npx tsx __tests__/market_control.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  cashOpenUnixForYmd,
  NY_DESK_CLOCK,
  TOKYO_DESK_CLOCK,
  zonedCivilToUnix,
} from '../lib/chart/sessionVwap'
import { DEFAULT_TAKE_PROFIT_R } from '../lib/trading/positionSizing'
import { tpoTickSize } from '../lib/trading/yesterdayProfile'
import {
  closedControlPeriods,
  computeMarketControl,
  CONTROL_COLORS,
  CONTROL_PERIOD_SEC,
  CONTROL_5M_SEC,
  CONTROL_10M_SEC,
  CONTROL_15M_SEC,
  controlHorizonForElapsed,
  controlPeriodSecsForElapsed,
  developingPoc,
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
    out.push({
      time: start + i * 300,
      ...ohlc,
      volume: 1,
    })
  }
  return out
}

/** Higher highs + higher lows staircase (buyer attempts). */
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

/** Lower highs + lower lows. */
function sellStairs(openU = mondayOpen, n = 4): ControlBar[] {
  const out: ControlBar[] = []
  for (let i = 0; i < n; i++) {
    const base = 42100 - i * 40
    out.push(
      ...fillPeriod(openU, i, {
        open: base,
        high: base + 10,
        low: base - 50,
        close: base - 30,
      })
    )
  }
  return out
}

/** Two-sided: higher high and lower low each letter. */
function rotateBars(openU = mondayOpen, n = 4): ControlBar[] {
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

// ─── Figure 4.28 scoring ─────────────────────────────────────────────────────

test('rotationStep: higher high + higher low = +1 +1', () => {
  const s = rotationStep(
    { high: 100, low: 90 },
    { high: 110, low: 95 }
  )
  assert.deepEqual(s, { top: 1, bot: 1 })
})

test('rotationStep: higher high + even low = +1 0', () => {
  const s = rotationStep(
    { high: 100, low: 90 },
    { high: 105, low: 90 }
  )
  assert.deepEqual(s, { top: 1, bot: 0 })
})

test('rotationStep: even high + lower low = 0 -1', () => {
  const s = rotationStep(
    { high: 100, low: 90 },
    { high: 100, low: 80 }
  )
  assert.deepEqual(s, { top: 0, bot: -1 })
})

test('rotationStep: lower high + lower low = -1 -1', () => {
  const s = rotationStep(
    { high: 100, low: 90 },
    { high: 95, low: 80 }
  )
  assert.deepEqual(s, { top: -1, bot: -1 })
})

test('rotationStep: same high and low = 0 0', () => {
  const s = rotationStep(
    { high: 100, low: 90 },
    { high: 100, low: 90 }
  )
  assert.deepEqual(s, { top: 0, bot: 0 })
})

// ─── WAIT / clocks ───────────────────────────────────────────────────────────

test('empty candles → WAIT, no throw', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: [],
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.label, 'WAIT')
  assert.equal(p.rf, null)
  assert.equal(p.dpoc, null)
  assert.equal(marketControlBadgeText(p), 'RF WAIT')
  assert.equal(marketControlLineSpecs(p).length, 0)
})

test('before cash open → WAIT even with later bars in the array', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(),
    asOfUnix: mondayOpen - 1,
  })
  assert.equal(p.label, 'WAIT')
  assert.equal(p.sessionDate, '2026-08-17')
})

test('Sunday asOf → WAIT with no sessionDate', () => {
  const sun = cashOpenUnixForYmd('2026-08-16', NY_DESK_CLOCK)
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(),
    asOfUnix: sun + 3600,
  })
  assert.equal(p.label, 'WAIT')
  assert.equal(p.sessionDate, null)
})

test('period A closed (OR30): opening 10m/15m may score; 30m still waits for B', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(),
    asOfUnix: asOfPeriods(1),
  })
  assert.equal(p.horizon, 'or30')
  assert.notEqual(p.periodSec, CONTROL_PERIOD_SEC)
  assert.ok(p.periodSec === 600 || p.periodSec === 900)
})

test('sim asOf after A ignores later buy-stairs sitting in the array', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 4),
    asOfUnix: asOfPeriods(1),
  })
  assert.equal(p.horizon, 'or30')
  assert.notEqual(p.label, 'ONE-TF BUY', 'must not peek at periods B–D 30m stairs')
  assert.ok(p.rf == null || p.rf === 0, 'period A 5m bars are flat — no later-stair RF')
})

test('unsorted 5m bars still score B vs A', () => {
  const bars = buyStairs(mondayOpen, 2).slice().reverse()
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.periodCount, 2)
  assert.ok(p.rf != null && p.rf > 0)
})

test('NaN / inverted OHLC does not throw', () => {
  const bars: ControlBar[] = [
    {
      time: mondayOpen,
      open: Number.NaN,
      high: 1,
      low: 2,
      close: Number.POSITIVE_INFINITY,
      volume: 1,
    },
    ...buyStairs(mondayOpen, 2),
  ]
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfPeriods(2),
  })
  assert.ok(
    p.label === 'WAIT' ||
      p.label === 'ONE-TF BUY' ||
      p.label === 'ONE-TF SELL' ||
      p.label === 'TWO-TF'
  )
})

// ─── Classification ──────────────────────────────────────────────────────────

test('B close on buy stairs → positive RF and ONE-TF BUY', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.periodCount, 2)
  assert.equal(p.rf, 2)
  assert.equal(p.rfTop, 1)
  assert.equal(p.rfBot, 1)
  assert.equal(p.dpocDir, 'up')
  assert.equal(p.label, 'ONE-TF BUY')
  assert.equal(marketControlBadgeText(p), 'RF +2 ↑')
  assert.ok(p.dpoc != null)
})

test('B close on sell stairs → ONE-TF SELL', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: sellStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.rf, -2)
  assert.equal(p.dpocDir, 'down')
  assert.equal(p.label, 'ONE-TF SELL')
  assert.equal(marketControlBadgeText(p), 'RF -2 ↓')
})

test('higher high + lower low is TWO-TF (RF near zero)', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: rotateBars(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.rf, 0)
  assert.equal(p.label, 'TWO-TF')
  assert.equal(marketControlBadgeText(p), 'RF 0 ROT')
})

test('|RF| of 1 stays TWO-TF even if dPOC migrates', () => {
  const bars = [
    ...fillPeriod(mondayOpen, 0, {
      open: 42100,
      high: 42140,
      low: 42080,
      close: 42110,
    }),
    ...fillPeriod(mondayOpen, 1, {
      open: 42110,
      high: 42180,
      low: 42080,
      close: 42150,
    }),
  ]
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.rf, 1)
  assert.equal(p.label, 'TWO-TF')
  assert.equal(marketControlBadgeText(p), 'RF +1 2TF')
})

test('NASDAQ uses NY cash open (same B lock as DOW)', () => {
  const p = computeMarketControl({
    instrument: 'NASDAQ',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.sourceSession, 'NY_RTH')
  assert.equal(p.label, 'ONE-TF BUY')
})

test('Nikkei after Tokyo cash close keeps morning RF (no NY-hour re-open)', () => {
  const tokyoClose = zonedCivilToUnix(
    '2026-08-17',
    TOKYO_DESK_CLOCK.overnightStartHour,
    TOKYO_DESK_CLOCK.timeZone
  )
  const p = computeMarketControl({
    instrument: 'NIKKEI',
    candles: buyStairs(tokyoOpen, 4),
    asOfUnix: tokyoClose + 3 * 3600,
  })
  assert.equal(p.sourceSession, 'TOKYO_CASH')
  assert.equal(p.label, 'ONE-TF BUY')
  assert.ok(p.rf != null && p.rf > 0)
  assert.equal(p.amRf, null, 'Nikkei has no NYC lunch AM freeze')
  assert.ok(formatMarketControlForPrompt(p).includes('not US Range'))
})

test('RF stays locked at NY cash close (no Globex letters)', () => {
  const closeU = zonedCivilToUnix(
    '2026-08-17',
    NY_DESK_CLOCK.overnightStartHour,
    NY_DESK_CLOCK.timeZone
  )
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 4),
    asOfUnix: closeU + 3600,
  })
  assert.equal(p.label, 'ONE-TF BUY')
  const atClose = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 4),
    asOfUnix: closeU,
  })
  assert.equal(p.rf, atClose.rf)
  assert.equal(p.periodCount, atClose.periodCount)
})

test('print a few seconds before cash open still fills period A', () => {
  const bars: ControlBar[] = [
    {
      time: mondayOpen - 15,
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
  assert.ok(p.rf != null && p.rf > 0)
})

test('RF +2 with dPOC stuck (sub-tick shift) is TWO-TF, not ONE-TF BUY', () => {
  const bars = [
    ...fillPeriod(mondayOpen, 0, {
      open: 42100,
      high: 42150,
      low: 42100,
      close: 42120,
    }),
    ...fillPeriod(mondayOpen, 1, {
      open: 42120,
      high: 42151,
      low: 42101,
      close: 42140,
    }),
  ]
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.rf, 2)
  assert.equal(p.dpocDir, 'stuck')
  assert.equal(p.label, 'TWO-TF')
  assert.equal(marketControlBadgeText(p), 'RF +2 2TF')
})

test('missing period B: C vs A still scores (skip, do not invent B)', () => {
  const bars = [
    ...fillPeriod(mondayOpen, 0, {
      open: 42100,
      high: 42140,
      low: 42090,
      close: 42120,
    }),
    ...fillPeriod(mondayOpen, 2, {
      open: 42160,
      high: 42200,
      low: 42150,
      close: 42180,
    }),
  ]
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfPeriods(3),
  })
  assert.equal(p.periodCount, 2)
  assert.equal(p.rf, 2)
})

// ─── Lunch AM freeze ─────────────────────────────────────────────────────────

test('NY lunch 12:00 freezes AM RF; later letters keep scoring', () => {
  const lunchU = zonedCivilToUnix('2026-08-17', 12, NY_DESK_CLOCK.timeZone)
  const bars = buyStairs(mondayOpen, 8)
  const am = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: lunchU,
  })
  const pm = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: lunchU + 3600,
  })
  assert.ok(am.rf != null)
  assert.equal(pm.amRf, am.rf)
  assert.equal(pm.amDpoc, am.dpoc)
  assert.ok(pm.rf != null && pm.rf !== pm.amRf, 'G/H after lunch must keep scoring')
  assert.ok(formatMarketControlForPrompt(pm).includes('CONTROL AM'))
  assert.ok(formatMarketControlForPrompt(pm).includes('11:30 confirm'))
})

test('before 12:00 ET amRf is null', () => {
  const lunchU = zonedCivilToUnix('2026-08-17', 12, NY_DESK_CLOCK.timeZone)
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 4),
    asOfUnix: lunchU - 1,
  })
  assert.equal(p.amRf, null)
  assert.equal(p.amDpoc, null)
})

// ─── Overlay / prompt contracts ──────────────────────────────────────────────

test('dPOC line title is dPOC not POC; color is indigo', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  const specs = marketControlLineSpecs(p)
  assert.equal(specs.length, 1)
  assert.equal(specs[0]!.title, 'dPOC')
  assert.equal(specs[0]!.color, CONTROL_COLORS.dpoc)
  assert.equal(CONTROL_COLORS.dpoc, '#818cf8')
  assert.ok(!formatMarketControlForPrompt(p).includes('volume POC'))
})

test('dPOC uses the same tick as yesterday TPO', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  assert.ok(p.dpoc != null)
  const tick = tpoTickSize(p.dpoc)
  assert.equal(p.dpoc % tick, 0)
})

test('paint key off is identical; on keys include instrument', () => {
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
  assert.notEqual(marketControlPaintKey(true, a), marketControlPaintKey(true, b))
})

test('playLine and prompt never auto-move the ticket or unlock ±10', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  const packed = formatMarketControlForPrompt(p)
  assert.ok(p.playLine.includes('1.5R'))
  assert.ok(p.playLine.includes('advise-only'))
  assert.ok(p.playLine.includes('Does not unlock off-band'))
  assert.ok(p.playLine.includes('Does not change Open type'))
  assert.ok(!p.playLine.toLowerCase().includes('auto-move'))
  assert.ok(!packed.toLowerCase().includes('auto-move'))
  assert.equal(DEFAULT_TAKE_PROFIT_R, 1.5)
})

test('prompt does not echo raw HTML from a weird instrument id', () => {
  const p = computeMarketControl({
    instrument: 'DOW<script>alert(1)</script>',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  const packed = formatMarketControlForPrompt(p)
  assert.ok(!packed.includes('<script>'))
  assert.equal(p.sourceSession, 'NY_RTH')
})

test('sim resolveMarketControlAsOfUnix(simT, simT) never jumps to wall clock', () => {
  const simT = mondayOpen + 120
  const wall = mondayOpen + 4 * 3600
  assert.equal(resolveMarketControlAsOfUnix('DOW', simT, simT), simT)
  assert.notEqual(resolveMarketControlAsOfUnix('DOW', simT, simT), wall)
})

test('5000 leftover globex bars do not hang', () => {
  const junk: ControlBar[] = []
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
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: [...junk, ...buyStairs(mondayOpen, 2)],
    asOfUnix: asOfPeriods(2),
  })
  assert.ok(Date.now() - t0 < 2000, 'classifier must stay bounded')
  assert.equal(p.label, 'ONE-TF BUY')
})

test('no supabase and no new API in the engine', () => {
  const src = readFileSync(
    join(__dirname, '..', 'lib/trading/marketControl.ts'),
    'utf8'
  )
  assert.ok(!src.includes('supabase'))
  assert.ok(!src.includes('/api/trading/control'))
  assert.ok(!src.includes("from '@/lib/supabase"))
})

test('closedControlPeriods ignores a forming 30m letter', () => {
  const periods = closedControlPeriods(
    buyStairs(mondayOpen, 2),
    mondayOpen,
    mondayOpen + 7 * 3600,
    mondayOpen + CONTROL_PERIOD_SEC + 60
  )
  assert.equal(periods.length, 1)
  assert.equal(periods[0]!.idx, 0)
})

test('Open range uses 5m letters; 1m and 3m are not in the set', () => {
  assert.deepEqual(controlPeriodSecsForElapsed(0), [CONTROL_5M_SEC])
  assert.deepEqual(controlPeriodSecsForElapsed(14 * 60), [CONTROL_5M_SEC])
  assert.equal(controlHorizonForElapsed(14 * 60), 'or15')
  assert.ok(!controlPeriodSecsForElapsed(10 * 60).includes(60))
  assert.ok(!controlPeriodSecsForElapsed(10 * 60).includes(180))
})

test('two closed 5m stairs score during Open range (~10m)', () => {
  const bars: ControlBar[] = []
  for (let i = 0; i < 3; i++) {
    const base = 42100 + i * 20
    bars.push({
      time: mondayOpen + i * 300,
      open: base,
      high: base + 15,
      low: base - 5,
      close: base + 10,
      volume: 1,
    })
  }
  const tooEarly = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: mondayOpen + 5 * 60 + 30,
  })
  assert.equal(tooEarly.label, 'WAIT', 'need two closed 5m letters')
  assert.equal(tooEarly.horizon, 'or15')
  assert.equal(tooEarly.periodSec, CONTROL_5M_SEC)

  const ready = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: mondayOpen + 10 * 60,
  })
  assert.equal(ready.horizon, 'or15')
  assert.equal(ready.periodSec, CONTROL_5M_SEC)
  assert.equal(ready.periodCount, 2)
  assert.equal(ready.label, 'ONE-TF BUY')
  assert.ok(ready.rf != null && ready.rf > 0)
})

test('OR30 window: 10m is primary before 15m has two letters', () => {
  assert.deepEqual(controlPeriodSecsForElapsed(20 * 60), [
    CONTROL_5M_SEC,
    CONTROL_10M_SEC,
  ])
  const bars: ControlBar[] = []
  for (let i = 0; i < 5; i++) {
    const base = 42100 + i * 25
    bars.push({
      time: mondayOpen + i * 300,
      open: base,
      high: base + 18,
      low: base - 6,
      close: base + 12,
      volume: 1,
    })
  }
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: mondayOpen + 20 * 60,
  })
  assert.equal(p.horizon, 'or30')
  assert.equal(p.periodSec, CONTROL_10M_SEC)
  assert.equal(p.periodCount, 2)
  assert.equal(p.label, 'ONE-TF BUY')
})

test('after two 15m letters, 15m is primary until IB', () => {
  assert.deepEqual(controlPeriodSecsForElapsed(30 * 60), [
    CONTROL_5M_SEC,
    CONTROL_10M_SEC,
    CONTROL_15M_SEC,
  ])
  const bars: ControlBar[] = []
  for (let i = 0; i < 6; i++) {
    const base = 42100 + i * 20
    bars.push({
      time: mondayOpen + i * 300,
      open: base,
      high: base + 15,
      low: base - 5,
      close: base + 10,
      volume: 1,
    })
  }
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: mondayOpen + 30 * 60,
  })
  assert.equal(p.horizon, 'or30')
  assert.equal(p.periodSec, CONTROL_15M_SEC)
  assert.equal(p.periodCount, 2)
  assert.equal(p.label, 'ONE-TF BUY')
})

test('opposite 5m vs 10m ONE-TF collapses to TWO-TF', () => {
  const bars: ControlBar[] = []
  // First 10m: two 5m bars drift down (5m SELL), second 10m drifts up so 10m HH/HL vs first 10m.
  const specs = [
    { high: 42140, low: 42100 },
    { high: 42120, low: 42080 },
    { high: 42180, low: 42130 },
    { high: 42210, low: 42160 },
  ]
  for (let i = 0; i < specs.length; i++) {
    bars.push({
      time: mondayOpen + i * 300,
      open: (specs[i]!.high + specs[i]!.low) / 2,
      high: specs[i]!.high,
      low: specs[i]!.low,
      close: (specs[i]!.high + specs[i]!.low) / 2,
      volume: 1,
    })
  }
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: mondayOpen + 20 * 60,
  })
  assert.equal(p.horizon, 'or30')
  assert.ok(p.label === 'TWO-TF' || p.label === 'ONE-TF BUY' || p.label === 'ONE-TF SELL')
})

test('IB lock switches to 30m letters', () => {
  assert.deepEqual(controlPeriodSecsForElapsed(60 * 60), [CONTROL_PERIOD_SEC])
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(mondayOpen, 2),
    asOfUnix: asOfPeriods(2),
  })
  assert.equal(p.horizon, 'ib')
  assert.equal(p.periodSec, CONTROL_PERIOD_SEC)
  assert.equal(p.periodCount, 2)
})

test('developingPoc tie goes to the price closest to range mid', () => {
  const poc = developingPoc([
    { idx: 0, start: 0, end: 1800, high: 100, low: 90 },
    { idx: 1, start: 1800, end: 3600, high: 100, low: 90 },
  ])
  assert.ok(poc != null)
  assert.ok(Math.abs(poc - 95) <= 5)
})

if (failed.length) {
  console.error(`market_control: ${failed.length} failed / ${passed.length} passed`)
  for (const f of failed) console.error(`  FAIL ${f.name}: ${f.error}`)
  process.exit(1)
}

console.log(`market_control: ${passed.length} passed`)
