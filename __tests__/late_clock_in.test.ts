/**
 * Late clock-in after cash open = missed session.
 * Run: npx tsx __tests__/late_clock_in.test.ts
 */

import { canClockInNow, activeClockMarkets } from '../lib/trading/deskAttendance'
import {
  resolveSessionGate,
  isLiveTipStreamAllowed,
} from '../lib/trading/sessionGate'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

/** Wed 2026-07-15 */
function etDate(h: number, m: number) {
  return new Date(Date.UTC(2026, 6, 15, h + 4, m, 0)) // EDT = UTC-4
}

function jstDate(h: number, m: number) {
  return new Date(Date.UTC(2026, 6, 15, h - 9, m, 0))
}

// Prep window 09:15–09:30 ET
assert(canClockInNow('NY', etDate(9, 14)).ok === false, 'before prep closed')
assert(canClockInNow('NY', etDate(9, 20)).ok === true, 'prep clock-in open')
assert(activeClockMarkets(etDate(9, 20)).includes('NY'), 'prep active')
assert(canClockInNow('NY', etDate(9, 30)).ok === false, 'exact open closed')

// After cash open 09:30 — late
const late = canClockInNow('NY', etDate(10, 0))
assert(late.ok === false, 'late clock-in rejected')
assert(/skipped|passed|late/i.test(late.reason), late.reason)
assert(!activeClockMarkets(etDate(10, 0)).includes('NY'), 'not in active clock markets after open')

const gate = resolveSessionGate({
  now: etDate(10, 0),
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: false,
  attendedToday: false,
})
assert(gate.canClockIn === false, 'gate canClockIn false after open')
assert(gate.canPlaceEntry === false, 'no entries')
assert(/missed|skipped/i.test(gate.message), gate.message)
assert(
  isLiveTipStreamAllowed('DOW', etDate(10, 0), { attendedToday: false }).open === false,
  'missed → tip off'
)

// Tokyo late
assert(canClockInNow('TOKYO', jstDate(8, 50)).ok === true, 'Tokyo prep')
assert(canClockInNow('TOKYO', jstDate(9, 30)).ok === false, 'Tokyo late')

// First clock-in late = blocked; re-clock after early out still allowed until lunch
const re = resolveSessionGate({
  now: etDate(10, 0),
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: false,
  attendedToday: true,
})
assert(re.canClockIn === true, 're-clock until lunch if already attended')

const afterLunch = resolveSessionGate({
  now: etDate(12, 0),
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: false,
  attendedToday: true,
})
assert(afterLunch.canClockIn === false, 'no re-clock after lunch')

console.log('late_clock_in: all passed')
