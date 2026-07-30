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
assert(
  !(ladderNoNow.ibEligible || ladderNoNow.lunchEligible),
  'old lunch check would wrongly auto clock-out at lunch'
)

const ladder = buildAttemptLadder(fills, 'NIKKEI', ibPrep)
assert(ladder.dayAttempts === 2, '2 session fills')
assert(ladder.ibEligible, 'US Range still eligible (1/2)')
assert(ladder.lunchEligible, 'Tokyo IB still eligible (0/2)')
assert(
  shouldRetainClockInAtLunch(ladder),
  'retain clock-in while IB window remains'
)

// Re-clock must stay open through IB prep (not cut at 11:30 lunch)
const reClock = canReClockInNow('TOKYO', ibPrep)
assert(reClock.ok, `re-clock during IB prep: ${reClock.reason}`)

// Clocked-in banner copy during IB prep — prep message, not clocked-out
const gate = resolveSessionGate({
  now: ibPrep,
  lockedInstrument: 'NIKKEI',
  viewingInstrument: 'NIKKEI',
  clockedIn: true,
  attendedToday: true,
  attemptFills: fills,
})
assert(gate.phase === 'DONE', 'IB prep phase DONE')
assert(gate.clockedIn === true, 'still clocked in')
assert(gate.canPlaceEntry === false, 'no entries until IB opens')
assert(
  gate.message?.includes('IB prep') || gate.message?.includes('IB opens'),
  `prep copy not clocked-out: ${gate.message}`
)
assert(
  !gate.message?.toLowerCase().includes('clocked out'),
  'message must not say clocked out while clocked in'
)

// Session cap 3/3 → auto clock-out allowed
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

console.log('auto_lunch_clock_out: all passed')
