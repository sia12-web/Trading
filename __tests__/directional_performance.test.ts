/**
 * Directional performance (Table 4.1 collapsed) + OR30 WAIT gate.
 * Run: npx tsx __tests__/directional_performance.test.ts
 */

import assert from 'node:assert/strict'
import {
  classifyVaPlacement,
  computeDeskPerf,
  gradeTable4,
} from '../lib/trading/directionalPerformance'
import { disguisedCorrectionHold } from '../lib/trading/longTermBracket'
import { cashOpenUnixForYmd, NY_DESK_CLOCK } from '../lib/chart/sessionVwap'
import type { MarketControl } from '../lib/trading/marketControl'

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log('ok', name)
  } catch (err) {
    console.error('FAIL', name, err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}

test('placement: fully above / below / inside / overlap', () => {
  assert.equal(
    classifyVaPlacement({ vah: 120, val: 110 }, { vah: 100, val: 90 }),
    'HIGHER'
  )
  assert.equal(
    classifyVaPlacement({ vah: 80, val: 70 }, { vah: 100, val: 90 }),
    'LOWER'
  )
  assert.equal(
    classifyVaPlacement({ vah: 98, val: 92 }, { vah: 100, val: 90 }),
    'INSIDE'
  )
  assert.equal(
    classifyVaPlacement({ vah: 110, val: 80 }, { vah: 100, val: 90 }),
    'OUTSIDE'
  )
})

test('Table 4.1 collapse: with-attempt + higher vol = very strong', () => {
  assert.equal(
    gradeTable4({
      attempt: 'UP',
      volumeRel: 'HIGHER',
      placement: 'HIGHER',
      width: 'AVERAGE',
    }),
    'VERY_STRONG'
  )
  assert.equal(
    gradeTable4({
      attempt: 'UP',
      volumeRel: 'LOWER',
      placement: 'HIGHER',
      width: 'AVERAGE',
    }),
    'SLOWING'
  )
  assert.equal(
    gradeTable4({
      attempt: 'UP',
      volumeRel: 'HIGHER',
      placement: 'LOWER',
      width: 'AVERAGE',
    }),
    'UNCLEAR'
  )
  assert.equal(
    gradeTable4({
      attempt: 'UP',
      volumeRel: null,
      placement: 'LOWER',
      width: 'NARROWER',
    }),
    'WEAK'
  )
  assert.equal(
    gradeTable4({
      attempt: 'DOWN',
      volumeRel: 'HIGHER',
      placement: 'LOWER',
      width: 'WIDER',
    }),
    'VERY_STRONG'
  )
})

test('UNCLEAR cannot print without higher volume', () => {
  const openU = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
  const control: MarketControl = {
    instrument: 'DOW',
    sourceSession: 'NY_RTH',
    sessionDate: '2026-08-17',
    label: 'ONE-TF BUY',
    rf: 3,
    rfTop: 2,
    rfBot: 1,
    dpoc: 42150,
    dpocDir: 'up',
    amRf: null,
    amDpoc: null,
    periodCount: 4,
    periodSec: 10 * 60,
    horizon: 'or30',
    playLine: '',
  }
  const candles = []
  for (let i = 0; i < 24; i++) {
    const t = openU + i * 300
    candles.push({
      time: t,
      open: 42100 - i * 2,
      high: 42120 - i,
      low: 42040 - i * 2,
      close: 42080 - i,
      volume: 10,
    })
  }
  const perf = computeDeskPerf({
    instrument: 'DOW',
    candles,
    asOfUnix: openU + 40 * 60,
    playbookMode: 'or30',
    control,
  })
  assert.notEqual(perf.grade, 'UNCLEAR')
})

test('Open range (morning) does not veto even if weak', () => {
  const openU = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
  const control: MarketControl = {
    instrument: 'DOW',
    sourceSession: 'NY_RTH',
    sessionDate: '2026-08-17',
    label: 'ONE-TF BUY',
    rf: 2,
    rfTop: 1,
    rfBot: 1,
    dpoc: 42100,
    dpocDir: 'up',
    amRf: null,
    amDpoc: null,
    periodCount: 2,
    periodSec: 5 * 60,
    horizon: 'or15',
    playLine: '',
  }
  const candles = []
  for (let i = 0; i < 6; i++) {
    const t = openU + i * 300
    candles.push({
      time: t,
      open: 42100,
      high: 42110,
      low: 42090,
      close: 42100,
      volume: 10,
    })
  }
  const perf = computeDeskPerf({
    instrument: 'DOW',
    candles,
    asOfUnix: openU + 12 * 60,
    playbookMode: 'morning',
    control,
  })
  assert.equal(perf.vetoCall, false)
  assert.equal(perf.leaveBook, false, 'LEAVE waits until OR30 VA exists')
})

test('TWO-TF Control is BALANCING; first legal hunt only after Open range', () => {
  const openU = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
  const control: MarketControl = {
    instrument: 'DOW',
    sourceSession: 'NY_RTH',
    sessionDate: '2026-08-17',
    label: 'TWO-TF',
    rf: 2,
    rfTop: 1,
    rfBot: 1,
    dpoc: 42100,
    dpocDir: 'stuck',
    amRf: null,
    amDpoc: null,
    periodCount: 4,
    periodSec: 10 * 60,
    horizon: 'or30',
    playLine: '',
  }
  const candles = []
  for (let i = 0; i < 24; i++) {
    const t = openU + i * 300
    candles.push({
      time: t,
      open: 42100,
      high: 42120,
      low: 42080,
      close: 42100,
      volume: 10,
    })
  }
  const first = computeDeskPerf({
    instrument: 'DOW',
    candles,
    asOfUnix: openU + 40 * 60,
    playbookMode: 'or30',
    attemptsUsed: 0,
    control,
  })
  assert.equal(first.grade, 'BALANCING')
  assert.equal(first.vetoCall, false)
  assert.equal(first.leaveBook, false)

  const used = computeDeskPerf({
    instrument: 'DOW',
    candles,
    asOfUnix: openU + 40 * 60,
    playbookMode: 'or30',
    attemptsUsed: 1,
    control,
  })
  assert.equal(used.vetoCall, true, 'BALANCING after first hunt waits')
})

test('disguised correction HOLD needs value-with; empty placement is not HOLD', () => {
  assert.equal(
    disguisedCorrectionHold({
      direction: 'LONG',
      controlLabel: 'ONE-TF BUY',
      placement: 'HIGHER',
    }),
    true
  )
  assert.equal(
    disguisedCorrectionHold({
      direction: 'LONG',
      controlLabel: 'ONE-TF BUY',
      placement: '',
    }),
    false
  )
  assert.equal(
    disguisedCorrectionHold({
      direction: 'LONG',
      controlLabel: 'ONE-TF BUY',
      placement: 'HIGHER',
      leaveBook: true,
    }),
    false
  )
  assert.equal(
    disguisedCorrectionHold({
      direction: 'LONG',
      controlLabel: 'ONE-TF SELL',
      placement: 'HIGHER',
    }),
    false
  )
})

if (!process.exitCode) console.log('directional_performance: all passed')
