/**
 * Dalton special situations — advise only, never a CALL gate.
 * Run: npx tsx __tests__/desk_situation.test.ts
 */

import assert from 'node:assert/strict'
import { cashOpenUnixForYmd, NY_DESK_CLOCK, zonedCivilToUnix } from '../lib/chart/sessionVwap'
import { computeDeskSituation, deskSitLineSpecs } from '../lib/trading/deskSituation'
import { computeDeskCall } from '../lib/trading/deskCall'
import type { SitBar } from '../lib/trading/deskSituation'

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log('ok', name)
  } catch (err) {
    console.error('FAIL', name, err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}

function rthBars(
  ymd: string,
  make: (i: number) => { open: number; high: number; low: number; close: number }
): SitBar[] {
  const openU = cashOpenUnixForYmd(ymd, NY_DESK_CLOCK)
  const closeU = zonedCivilToUnix(ymd, NY_DESK_CLOCK.overnightStartHour, NY_DESK_CLOCK.timeZone)
  const out: SitBar[] = []
  let i = 0
  for (let t = openU; t < closeU; t += 300) {
    out.push({ time: t, ...make(i) })
    i += 1
  }
  return out
}

const mondayOpen = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)

/** Tight Friday ~42100, late-day spike up. */
function spikeFriday(): SitBar[] {
  return rthBars('2026-08-14', (i) => {
    if (i >= 66) {
      const px = 42240 + (i - 66) * 4
      return { open: px - 2, high: px + 8, low: px - 6, close: px }
    }
    return { open: 42100, high: 42112, low: 42088, close: 42102 }
  })
}

function threeToOneBuyFriday(): SitBar[] {
  return rthBars('2026-08-14', (i) => {
    if (i < 6) {
      return { open: 42020, high: 42040, low: 42000, close: 42030 }
    }
    if (i < 12) {
      return { open: 42030, high: 42080, low: 42020, close: 42070 }
    }
    const px = 42140 + (i % 5)
    return { open: px, high: px + 20, low: px - 8, close: px + 10 }
  })
}

test('gap up holds, then dies when price trades through YH', () => {
  const friday = rthBars('2026-08-14', () => ({
    open: 42100,
    high: 42120,
    low: 42080,
    close: 42100,
  }))
  const openOnly = rthBars('2026-08-17', () => ({
    open: 42200,
    high: 42210,
    low: 42190,
    close: 42205,
  })).filter((c) => c.time < mondayOpen + 15 * 60)
  const hold = computeDeskSituation({
    instrument: 'DOW',
    candles: [...friday, ...openOnly],
    asOfUnix: mondayOpen + 15 * 60,
  })
  assert.equal(hold.kind, 'GAP')
  assert.equal(hold.badgeText, 'GAP · hold')
  assert.equal(hold.gapHold, true)
  assert.equal(hold.gapDead, false)

  const through = openOnly.map((c, i) =>
    i === openOnly.length - 1
      ? { ...c, low: 42090, close: 42100 }
      : c
  )
  const dead = computeDeskSituation({
    instrument: 'DOW',
    candles: [...friday, ...through],
    asOfUnix: mondayOpen + 15 * 60,
  })
  assert.equal(dead.badgeText, 'GAP · dead')
  assert.equal(dead.gapDead, true)
  assert.equal(dead.gapHold, false)
})

test('spike: open inside late-day spike is SPIKE · in, not a CALL gate', () => {
  const friday = spikeFriday()
  const monday = rthBars('2026-08-17', () => ({
    open: 42250,
    high: 42260,
    low: 42240,
    close: 42252,
  })).filter((c) => c.time < mondayOpen + 20 * 60)
  const sit = computeDeskSituation({
    instrument: 'DOW',
    candles: [...friday, ...monday],
    asOfUnix: mondayOpen + 20 * 60,
  })
  assert.equal(sit.kind, 'SPIKE')
  assert.equal(sit.badgeText, 'SPIKE · in')
  assert.ok(sit.spikeHigh != null && sit.spikeLow != null)
  assert.ok(deskSitLineSpecs(sit).some((s) => s.title === 'Sp H'))
  assert.equal(sit.spikeReject, false)

  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...monday],
    asOfUnix: mondayOpen + 20 * 60,
    playbookMode: 'morning',
  })
  assert.notEqual(call.side, undefined)
  assert.equal(call.sitBadge, 'SPIKE · in')
})

test('3-to-1 next-open note in first 90m; gone after 90m if no gap', () => {
  const friday = threeToOneBuyFriday()
  const morning = rthBars('2026-08-17', () => ({
    open: 42150,
    high: 42160,
    low: 42140,
    close: 42152,
  })).filter((c) => c.time < mondayOpen + 30 * 60)
  const early = computeDeskSituation({
    instrument: 'DOW',
    candles: [...friday, ...morning],
    asOfUnix: mondayOpen + 30 * 60,
  })
  assert.equal(early.kind, 'THREE_TO_ONE')
  assert.equal(early.badgeText, '3:1 · buy')

  const lateBars = rthBars('2026-08-17', () => ({
    open: 42150,
    high: 42160,
    low: 42140,
    close: 42152,
  })).filter((c) => c.time < mondayOpen + 100 * 60)
  const late = computeDeskSituation({
    instrument: 'DOW',
    candles: [...friday, ...lateBars],
    asOfUnix: mondayOpen + 100 * 60,
  })
  assert.notEqual(late.kind, 'THREE_TO_ONE')
})

test('VA · thru does not flip CALL; gap beats 3-to-1', () => {
  const friday = threeToOneBuyFriday()
  const gapped = rthBars('2026-08-17', () => ({
    open: 42300,
    high: 42320,
    low: 42280,
    close: 42310,
  })).filter((c) => c.time < mondayOpen + 20 * 60)
  const sit = computeDeskSituation({
    instrument: 'DOW',
    candles: [...friday, ...gapped],
    asOfUnix: mondayOpen + 20 * 60,
  })
  assert.equal(sit.kind, 'GAP', 'gap wins over 3-to-1')
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...gapped],
    asOfUnix: mondayOpen + 20 * 60,
    playbookMode: 'morning',
  })
  assert.equal(call.sitKind, 'GAP')
})

test('Sit never vetoes CALL (no sit WAIT gate)', () => {
  const friday = spikeFriday()
  const monday = rthBars('2026-08-17', () => ({
    open: 42250,
    high: 42280,
    low: 42220,
    close: 42260,
  })).filter((c) => c.time < mondayOpen + 25 * 60)
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...monday],
    asOfUnix: mondayOpen + 25 * 60,
    playbookMode: 'morning',
  })
  assert.equal(call.perfVeto, false)
  assert.ok(call.sitBadge)
  assert.ok(!call.hoverText?.includes('BLOCK  Sit:'))
})

if (!process.exitCode) console.log('desk_situation: all passed')
