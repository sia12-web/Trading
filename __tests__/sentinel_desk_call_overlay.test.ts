/**
 * SENTINEL — Desk CALL overlay (Slice 2): zinc Call chip, no line,
 * sim scoreboard, no new keyboard. Leo still unwired.
 * Run: npx tsx __tests__/sentinel_desk_call_overlay.test.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import assert from 'node:assert/strict'
import { DEFAULT_TAKE_PROFIT_R } from '../lib/trading/positionSizing'
import {
  CALL_COLORS,
  deskCallLineSpecs,
  computeDeskCall,
} from '../lib/trading/deskCall'
import { cashOpenUnixForYmd, NY_DESK_CLOCK } from '../lib/chart/sessionVwap'

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

function sliceBetween(hay: string, start: string, end: string): string {
  const i = hay.indexOf(start)
  const j = hay.indexOf(end, i + start.length)
  assert.ok(i >= 0 && j > i, `missing markers ${start} → ${end}`)
  return hay.slice(i, j)
}

const live = src('app/dashboard/chart/components/TradingChart.tsx')
const sim = src('app/dashboard/simulation/replay/desk/page.tsx')
const mondayOpen = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)

test('live and sim compute CALL with the same helper', () => {
  assert.ok(live.includes('computeDeskCall'))
  assert.ok(sim.includes('computeDeskCall'))
  assert.ok(live.includes('deskCallBadgeText'))
  assert.ok(sim.includes('deskCallBadgeText'))
  assert.ok(live.includes('resolveDeskCallAsOfUnix'))
  assert.ok(sim.includes('resolveDeskCallAsOfUnix'))
})

test('Call chip sits after Ctrl; zinc; not a toggle', () => {
  assert.ok(
    live.indexOf('<span>Ctrl</span>') < live.indexOf('<span>Call</span>'),
    'Call after Ctrl on live'
  )
  assert.ok(
    sim.indexOf('Dalton control dPOC line on') <
      sim.indexOf('Advise only; not a ticket. No line.'),
    'Call after Ctrl on sim'
  )
  assert.ok(live.includes('text-zinc-400'))
  assert.ok(live.includes('border-zinc-500/40'))
  assert.ok(sim.includes('text-zinc-400'))
  assert.ok(sim.includes('border-zinc-500/40'))
  assert.equal(CALL_COLORS.badge, '#a1a1aa')
  const liveChip = sliceBetween(
    live,
    'Advise only; not a ticket. No line.',
    '{callBadge}'
  )
  assert.ok(!liveChip.includes('onClick'))
  assert.ok(!live.includes('setShowDeskCall'))
  assert.ok(!sim.includes('setShowDeskCall'))
})

test('Call is not Open cyan / Ctrl indigo / Y amber / lunch orange / go-button green-red', () => {
  const liveChip = sliceBetween(
    live,
    'Advise only; not a ticket. No line.',
    '{callBadge}'
  )
  assert.ok(liveChip.includes('zinc-400'))
  assert.ok(!liveChip.includes('bg-cyan-600/30'))
  assert.ok(!liveChip.includes('bg-indigo-600/30'))
  assert.ok(!liveChip.includes('bg-amber-600/30'))
  assert.ok(!liveChip.includes('bg-orange-600/30'))
  assert.ok(!liveChip.includes('bg-green-600'))
  assert.ok(!liveChip.includes('bg-red-600'))
})

test('no CALL price line and no new keyboard', () => {
  const p = computeDeskCall({
    instrument: 'DOW',
    candles: [],
    asOfUnix: mondayOpen + 1800,
    playbookMode: 'morning',
  })
  assert.equal(deskCallLineSpecs(p).length, 0)
  assert.ok(!live.includes('deskCallLineSpecs'))
  assert.ok(!sim.includes('deskCallLineSpecs'))
  assert.ok(!live.includes('Press Call'))
  assert.ok(!sim.includes('Press Call'))
  const liveKeys = sliceBetween(live, 'const handleKeyDown', "window.addEventListener('keydown'")
  const simKeys = sliceBetween(sim, 'const handleKeyDown', "window.addEventListener('keydown'")
  assert.ok(!liveKeys.toLowerCase().includes('callbadge'))
  assert.ok(!simKeys.toLowerCase().includes('setcallbadge'))
})

test('sim does not peek wall clock; scores at cash close', () => {
  const call = sliceBetween(
    sim,
    'resolveDeskCallAsOfUnix(',
    'deskCallBadgeText'
  )
  assert.ok(call.includes('simT, simT'))
  assert.ok(!call.includes('Date.now'))
  assert.ok(sim.includes('scoreDeskCallSession'))
  assert.ok(sim.includes('formatDeskCallScoreStrip'))
  assert.ok(sim.includes('finalizeCallScore'))
})

test('instrument switch resets the Call badge', () => {
  assert.ok(live.includes("setCallBadge('WAIT')"))
  assert.ok(sim.includes("setCallBadge('WAIT')"))
})

test('Leo + Level Finder consume CALL; sim still has no Leo mic', () => {
  assert.ok(!sim.includes('LiveVoicePanel'))
  assert.ok(src('lib/trading/liveVoicePrompt.ts').includes('CALL (desk — bias + legal ±10)'))
  assert.ok(src('lib/trading/rangeLiquidityBrief.ts').includes('computeDeskCall'))
  assert.ok(src('lib/services/levelFinderAgent/levelFinderAgent.ts').includes('CALL (desk — bias + legal ±10)'))
  assert.ok(!src('lib/services/levelFinderAgent/levelFinderAgent.ts').includes('computeDeskCall'))
})

test('bookLocked is 3/3, open book, or working limit — not a closed entry window', () => {
  assert.ok(!live.includes('bookLocked: !canPlaceOrder'))
  const leo = src('lib/trading/liveVoiceContext.ts')
  assert.ok(leo.includes('gate.dayLocked'))
  assert.ok(!leo.includes('!gate.canPlaceEntry || (gate.attemptsUsed'))
})

test('sim Reset cannot double-count a scored day', () => {
  assert.ok(sim.includes('callScoredDaysRef'))
  assert.ok(sim.includes('callScoredDaysRef.current.has(key)'))
  assert.ok(sim.includes('callScoredDaysRef.current.add(key)'))
})

test('Call chip is a span, not innerHTML', () => {
  const liveChip = sliceBetween(
    live,
    'Advise only; not a ticket. No line.',
    '{callBadge}'
  )
  assert.ok(liveChip.includes('<span'))
  assert.ok(!liveChip.includes('dangerouslySetInnerHTML'))
  assert.ok(!live.includes('dangerouslySetInnerHTML'))
  assert.ok(!sim.includes('dangerouslySetInnerHTML'))
})

test('ticket freeze still holds', () => {
  assert.equal(DEFAULT_TAKE_PROFIT_R, 1.5)
  assert.ok(!live.includes('unlock off-band'))
  assert.ok(src('lib/trading/deskCall.ts').includes('Does not unlock off-band'))
})

if (failed.length) {
  console.error(`sentinel_desk_call_overlay: ${failed.length} failed / ${passed.length} passed`)
  for (const f of failed) console.error(`  FAIL ${f.name}: ${f.error}`)
  process.exit(1)
}

console.log(`sentinel_desk_call_overlay: ${passed.length} passed`)
