/**
 * Auto lunch clock-out must respect session ladder with clock-aware eligibility.
 * Run: npx tsx __tests__/auto_lunch_clock_out.test.ts
 */

import { buildAttemptLadder } from '../lib/trading/attemptLadder'
import {
  canReClockInNow,
  shouldRetainClockInAtLunch,
} from '../lib/trading/deskAttendance'
import { resolveSessionGate } from '../lib/trading/sessionGate'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function jstDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 9, min, 0))
}

function etDate(y: number, m: number, d: number, h: number, min: number): Date {
  // EDT = UTC-4 (Jul)
  return new Date(Date.UTC(y, m - 1, d, h + 4, min, 0))
}

const Y = 2026
const M = 7
const D = 29

// User report: Session 2/3 · AM 1/2 · US 1/2 · IB 0/2 at IB prep (after 11:30 JST lunch)
const fills = [
  {
    instrument: 'NIKKEI',
    entryTimestamp: jstDate(Y, M, D, 9, 35).toISOString(),
    exitReason: 'target_hit',
  },
  {
    instrument: 'NIKKEI',
    entryTimestamp: jstDate(Y, M, D, 10, 15).toISOString(),
    exitReason: 'target_hit',
  },
]

const ibPrep = jstDate(Y, M, D, 12, 30)

// Bug: without `now`, morning fill blocks later-window eligibility → false auto clock-out
const ladderNoNow = buildAttemptLadder(fills, 'NIKKEI')
assert(!ladderNoNow.ibEligible, 'without now: ibEligible false after morning fill')
assert(!ladderNoNow.lunchEligible, 'without now: lunchEligible false after morning fill')

const ladder = buildAttemptLadder(fills, 'NIKKEI', ibPrep)
assert(ladder.dayAttempts === 2, '2 session fills')
assert(ladder.ibEligible, 'US Range still eligible (1/2)')
assert(ladder.lunchEligible, 'Tokyo IB still eligible (0/2)')
assert(
  shouldRetainClockInAtLunch(ladder),
  'retain clock-in while session slots remain (2/3)'
)

// Live Tokyo clock-in is off — Nikkei re-clock belongs to Simulation
const reClock = canReClockInNow('TOKYO', ibPrep)
assert(!reClock.ok, `live Tokyo re-clock off: ${reClock.reason}`)
assert(/NYC only|Simulation/i.test(reClock.reason), reClock.reason)

// Clocked-in banner copy during IB prep — prep message, not clocked-out
const gate = resolveSessionGate({
  now: ibPrep,
  lockedInstrument: 'NIKKEI',
  viewingInstrument: 'NIKKEI',
  clockedIn: true,
  attendedToday: true,
  attemptFills: fills,
})
assert(gate.phase === 'ENTRY', `IB still open at 12:30 JST got ${gate.phase}`)
assert(gate.clockedIn === true, 'still clocked in')
assert(gate.canPlaceEntry === true, 'Tokyo IB entries still open')
assert(
  !gate.message?.toLowerCase().includes('clocked out'),
  'message must not say clocked out while clocked in'
)

// Session cap 3/3 on same desk day → auto clock-out allowed
const capped = buildAttemptLadder(
  [
    ...fills,
    {
      instrument: 'NIKKEI',
      entryTimestamp: jstDate(Y, M, D, 13, 45).toISOString(),
      exitReason: 'target_hit',
    },
  ],
  'NIKKEI',
  jstDate(Y, M, D, 14, 0)
)
assert(capped.dayLocked, '3/3 session locked')
assert(!shouldRetainClockInAtLunch(capped), 'no retain at session cap')

// Retain at 2/3 even if window eligibility looks closed (policy: until 3 fills)
const sessionOnly = buildAttemptLadder(fills, 'NIKKEI', ibPrep)
assert(sessionOnly.dayAttempts === 2, '2 session fills')
assert(shouldRetainClockInAtLunch(sessionOnly), 'retain at 2/3')

// If auto lunch wrongly merged prior EST-calendar fill, cap would hit 3/3
const priorEstDayFill = {
  instrument: 'NIKKEI',
  entryTimestamp: jstDate(Y, M, D, 8, 45).toISOString(),
  exitReason: 'target_hit',
}
const wronglyMerged = buildAttemptLadder(
  [priorEstDayFill, ...fills],
  'NIKKEI',
  ibPrep
)
assert(wronglyMerged.dayAttempts === 3, 'merged cross-day would be 3 fills')
assert(
  !shouldRetainClockInAtLunch(wronglyMerged),
  'wrong merge would wrongly auto clock-out at lunch'
)

// NY ~15:20 after Session 3/3 — must NOT offer “Today I trade”
const nyFills = [
  {
    instrument: 'DOW',
    entryTimestamp: etDate(2026, 7, 31, 10, 1).toISOString(),
    exitReason: 'stop_hit',
  },
  {
    instrument: 'DOW',
    entryTimestamp: etDate(2026, 7, 31, 10, 39).toISOString(),
    exitReason: 'stop_hit',
  },
  {
    instrument: 'DOW',
    entryTimestamp: etDate(2026, 7, 31, 15, 3).toISOString(),
    exitReason: 'stop_hit',
  },
]
const nyAfterFlat = etDate(2026, 7, 31, 15, 20)
const nyGate = resolveSessionGate({
  now: nyAfterFlat,
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: false,
  attendedToday: true,
  hasOpenPosition: false,
  attemptFills: nyFills,
})
assert(nyGate.dayLocked, 'NY day locked at 3/3')
assert(!nyGate.canClockIn, 'no Today I trade after Session 3/3')
assert(
  nyGate.message?.toLowerCase().includes('day locked') ||
    nyGate.message?.includes('3/3'),
  `day-locked copy, got: ${nyGate.message}`
)

console.log('auto_lunch_clock_out: all passed')
