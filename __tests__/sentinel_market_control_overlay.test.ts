/**
 * SENTINEL — Dalton control overlay (Slice 2): Ctrl chip, dPOC line,
 * sim no-peek, no new keyboard. Leo still unwired.
 * Run: npx tsx __tests__/sentinel_market_control_overlay.test.ts
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
  computeMarketControl,
  CONTROL_COLORS,
  CONTROL_PERIOD_SEC,
  marketControlBadgeText,
  marketControlLineSpecs,
  marketControlPaintKey,
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

function fillPeriod(
  idx: number,
  ohlc: { open: number; high: number; low: number; close: number }
): ControlBar[] {
  const start = mondayOpen + idx * CONTROL_PERIOD_SEC
  const out: ControlBar[] = []
  for (let i = 0; i < 6; i++) {
    out.push({ time: start + i * 300, ...ohlc, volume: 1 })
  }
  return out
}

function buyStairs(n = 2): ControlBar[] {
  const out: ControlBar[] = []
  for (let i = 0; i < n; i++) {
    const base = 42100 + i * 40
    out.push(
      ...fillPeriod(i, {
        open: base,
        high: base + 50,
        low: base - 10,
        close: base + 30,
      })
    )
  }
  return out
}

const live = src('app/dashboard/chart/components/TradingChart.tsx')
const simGone = src('app/dashboard/simulation/replay/desk/page.tsx')
assert.ok(simGone.includes("redirect('/dashboard/chart')"))

function sliceBetween(hay: string, start: string, end: string): string {
  const i = hay.indexOf(start)
  const j = hay.indexOf(end, i + start.length)
  assert.ok(i >= 0 && j > i, `missing markers ${start} → ${end}`)
  return hay.slice(i, j)
}

// ─── Live chart contract (simulation desk removed) ───────────────────────────

test('live computes Dalton control; simulation desk is removed', () => {
  assert.ok(live.includes('computeMarketControl'))
  assert.ok(live.includes('marketControlBadgeText'))
  assert.ok(live.includes('setControlBadge'))
})

test('dPOC line is off by default on live unless systematic desk', () => {
  assert.ok(live.includes('loadDeskOverlayToggles().control'))
})

test('live clears control lines + paint key on instrument change', () => {
  assert.ok(live.includes('controlLinesRef.current = []'))
  assert.ok(live.includes("controlPaintKeyRef.current = ''"))
})

test('badge updates before paint-key early return (lines off still refresh type)', () => {
  const livePaint = sliceBetween(live, 'const paintMarketControl = useCallback', '}, [showMarketControl, instrument])')
  const badgeAt = livePaint.indexOf('setControlBadge')
  const keyAt = livePaint.indexOf('if (key === controlPaintKeyRef.current) return')
  assert.ok(badgeAt >= 0 && keyAt > badgeAt)
})

test('no new keyboard for Ctrl (Press C / key c must not toggle control)', () => {
  assert.ok(!live.includes('Press C'))
  const liveKeys = sliceBetween(live, 'const handleKeyDown', "window.addEventListener('keydown'")
  assert.ok(!liveKeys.includes('setShowMarketControl'))
})

test('overlay uses helper line title dPOC and indigo #818cf8', () => {
  const p = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(2),
    asOfUnix: mondayOpen + 2 * CONTROL_PERIOD_SEC,
  })
  const specs = marketControlLineSpecs(p)
  assert.equal(specs.length, 1)
  assert.equal(specs[0]!.title, 'dPOC')
  assert.equal(specs[0]!.color, '#818cf8')
  assert.equal(CONTROL_COLORS.dpoc, '#818cf8')
})

test('WAIT has no dPOC line; paint key off is shared; on keys include instrument', () => {
  const wait = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(2),
    asOfUnix: mondayOpen + 5 * 60 + 30,
  })
  const a = computeMarketControl({
    instrument: 'DOW',
    candles: buyStairs(2),
    asOfUnix: mondayOpen + 2 * CONTROL_PERIOD_SEC,
  })
  const b = computeMarketControl({
    instrument: 'NASDAQ',
    candles: buyStairs(2),
    asOfUnix: mondayOpen + 2 * CONTROL_PERIOD_SEC,
  })
  assert.equal(wait.label, 'WAIT')
  assert.equal(marketControlLineSpecs(wait).length, 0)
  assert.equal(marketControlBadgeText(wait), 'RF WAIT')
  assert.equal(marketControlPaintKey(false, a), 'off')
  assert.equal(marketControlPaintKey(false, b), 'off')
  assert.ok(marketControlPaintKey(true, a).startsWith('DOW|'))
  assert.ok(marketControlPaintKey(true, b).startsWith('NASDAQ|'))
  assert.notEqual(marketControlPaintKey(true, a), marketControlPaintKey(true, b))
})

test('Leo prompt copy lives on the control engine; still no new API', () => {
  assert.ok(live.includes('computeMarketControl'))
  assert.ok(src('lib/trading/marketControl.ts').includes('CONTROL (Dalton — RF + dPOC)'))
  assert.ok(!live.includes('/api/trading/control'))
  assert.ok(!src('lib/trading/marketControl.ts').includes("from '@/lib/supabase"))
})

test('overlay does not auto-move the ticket or unlock ±10', () => {
  const packed = marketControlBadgeText(
    computeMarketControl({
      instrument: 'DOW',
      candles: buyStairs(2),
      asOfUnix: mondayOpen + 2 * CONTROL_PERIOD_SEC,
    })
  )
  assert.ok(!packed.toLowerCase().includes('auto-move'))
  assert.equal(DEFAULT_TAKE_PROFIT_R, 1.5)
  assert.ok(!live.includes('unlock off-band'))
  assert.ok(src('lib/trading/marketControl.ts').includes('Does not unlock off-band'))
})

test('Open overlay still present (regression)', () => {
  assert.ok(live.includes('computeOpeningActivity'))
  assert.ok(live.includes('paintOpeningActivity'))
})

if (failed.length) {
  console.error(
    `sentinel_market_control_overlay: ${failed.length} failed / ${passed.length} passed`
  )
  for (const f of failed) console.error(`  FAIL ${f.name}: ${f.error}`)
  process.exit(1)
}

console.log(`sentinel_market_control_overlay: ${passed.length} passed`)
