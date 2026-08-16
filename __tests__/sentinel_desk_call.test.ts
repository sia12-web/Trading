/**
 * SENTINEL — Desk CALL engine (Slice 1): WAIT honesty, ticket freeze,
 * no overlay/Leo/API. Run: npx tsx __tests__/sentinel_desk_call.test.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import assert from 'node:assert/strict'
import {
  cashOpenUnixForYmd,
  NY_DESK_CLOCK,
} from '../lib/chart/sessionVwap'
import { DEFAULT_TAKE_PROFIT_R } from '../lib/trading/positionSizing'
import {
  computeDeskCall,
  deskCallLineSpecs,
  formatDeskCallForPrompt,
  scoreDeskCallWindow,
  type DeskCallBar,
} from '../lib/trading/deskCall'

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

function driveOr30(): DeskCallBar[] {
  const out: DeskCallBar[] = []
  for (let i = 0; i < 6; i++) {
    const t = mondayOpen + i * 300
    out.push(
      i === 0
        ? { time: t, open: 42100, high: 42140, low: 42095, close: 42130, volume: 1 }
        : { time: t, open: 42120, high: 42150, low: 42120, close: 42140, volume: 1 }
    )
  }
  return out
}

test('empty / NaN / non-array never throw and stay WAIT', () => {
  assert.equal(
    computeDeskCall({
      instrument: 'DOW',
      candles: [],
      asOfUnix: mondayOpen,
      playbookMode: 'morning',
    }).side,
    'WAIT'
  )
  assert.equal(
    computeDeskCall({
      instrument: 'DOW',
      candles: driveOr30(),
      asOfUnix: Number.NaN,
      playbookMode: 'morning',
    }).side,
    'WAIT'
  )
  assert.equal(
    computeDeskCall({
      instrument: 'DOW',
      candles: undefined as unknown as DeskCallBar[],
      asOfUnix: mondayOpen + 1800,
      playbookMode: 'morning',
    }).side,
    'WAIT'
  )
})

test('CALL waits until the active range is locked', () => {
  const p = computeDeskCall({
    instrument: 'DOW',
    candles: driveOr30().slice(0, 2),
    asOfUnix: mondayOpen + 600,
    playbookMode: 'morning',
  })
  assert.equal(p.side, 'WAIT')
  assert.ok(p.playLine.includes('no locked playbook range'))
})

test('prompt always says CALL and never volume POC / auto-move', () => {
  const packed = formatDeskCallForPrompt(
    computeDeskCall({
      instrument: 'DOW',
      candles: driveOr30(),
      asOfUnix: mondayOpen + 1800,
      playbookMode: 'morning',
    })
  )
  assert.ok(packed.includes('CALL'))
  assert.ok(!packed.toLowerCase().includes('volume poc'))
  assert.ok(!packed.toLowerCase().includes('auto-move'))
  assert.ok(packed.includes('dPOC is not the fill') || packed.includes('waiting'))
})

test('no price line; ticket R stays 1.5', () => {
  const p = computeDeskCall({
    instrument: 'DOW',
    candles: driveOr30(),
    asOfUnix: mondayOpen + 1800,
    playbookMode: 'morning',
  })
  assert.equal(deskCallLineSpecs(p).length, 0)
  assert.equal(DEFAULT_TAKE_PROFIT_R, 1.5)
  assert.ok(p.playLine.includes('$400→$250→$150') || p.playLine.includes('1.5R'))
})

test('scoreboard WAIT windows exclude B/C', () => {
  const s = scoreDeskCallWindow({
    call: computeDeskCall({
      instrument: 'DOW',
      candles: [],
      asOfUnix: mondayOpen,
      playbookMode: 'morning',
    }),
    bars: [{ time: mondayOpen + 1, high: 9e9, low: 1 }],
  })
  assert.equal(s.leftWait, true)
  assert.equal(s.brokeWithCall, null)
  assert.equal(s.taggedBand, null)
})

test('XSS instrument id is not echoed as HTML', () => {
  const packed = formatDeskCallForPrompt(
    computeDeskCall({
      instrument: '<script>alert(1)</script>',
      candles: driveOr30(),
      asOfUnix: mondayOpen + 1800,
      playbookMode: 'morning',
    })
  )
  assert.ok(!packed.includes('<script>'))
})

test('engine does not add a route or Supabase', () => {
  const engine = src('lib/trading/deskCall.ts')
  assert.ok(!engine.includes('/api/trading/call'))
  assert.ok(!engine.includes("from '@/lib/supabase"))
  assert.ok(engine.includes('computeOpeningActivity'))
  assert.ok(engine.includes('computeMarketControl'))
  assert.ok(engine.includes('computeYesterdayProfile'))
})

test('Slice 3 wires Leo + range brief; Level Finder does not import computeDeskCall', () => {
  assert.ok(src('app/dashboard/chart/components/TradingChart.tsx').includes('computeDeskCall'))
  assert.ok(src('app/dashboard/simulation/replay/desk/page.tsx').includes('computeDeskCall'))
  assert.ok(src('lib/trading/liveVoicePrompt.ts').includes('CALL (desk — bias + legal ±10)'))
  assert.ok(src('lib/trading/rangeLiquidityBrief.ts').includes('computeDeskCall'))
  assert.ok(src('lib/services/levelFinderAgent/levelFinderAgent.ts').includes('CALL (desk — bias + legal ±10)'))
  assert.ok(!src('lib/services/levelFinderAgent/levelFinderAgent.ts').includes('computeDeskCall'))
})

test('scoreboard latches B — a later bar that spans both edges does not wipe', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: driveOr30(),
    asOfUnix: mondayOpen + 1800,
    playbookMode: 'morning',
  })
  assert.equal(call.side, 'LONG')
  assert.ok(call.rangeHigh != null && call.rangeLow != null)
  const s = scoreDeskCallWindow({
    call,
    bars: [
      { time: mondayOpen + 2000, high: call.rangeHigh + 12, low: call.rangeLow + 2 },
      { time: mondayOpen + 2300, high: call.rangeHigh + 4, low: call.rangeLow - 12 },
    ],
  })
  assert.equal(s.brokeWithCall, true)
})

test('opening and control engines are not rewritten', () => {
  const open = src('lib/trading/openingActivity.ts')
  const ctrl = src('lib/trading/marketControl.ts')
  assert.ok(open.includes('computeOpeningActivity'))
  assert.ok(!open.includes('computeDeskCall'))
  assert.ok(ctrl.includes('ONE-TF BUY'))
  assert.ok(!ctrl.includes('computeDeskCall'))
})

if (failed.length) {
  console.error(`sentinel_desk_call: ${failed.length} failed / ${passed.length} passed`)
  for (const f of failed) console.error(`  FAIL ${f.name}: ${f.error}`)
  process.exit(1)
}

console.log(`sentinel_desk_call: ${passed.length} passed`)
