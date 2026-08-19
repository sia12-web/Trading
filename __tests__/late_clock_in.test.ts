/**
 * Late clock-in during cash session + live desk brief ranking.
 * Run: npx tsx __tests__/late_clock_in.test.ts
 */

import {
  canClockInNow,
  activeClockMarkets,
  isLateJoinClockIn,
} from '../lib/trading/deskAttendance'
import {
  resolveSessionGate,
  isLiveTipStreamAllowed,
} from '../lib/trading/sessionGate'
import {
  buildInstrumentDeskCard,
  buildLiveDeskBrief,
} from '../lib/trading/liveDeskBrief'
import { attemptLadderFromCounts } from '../lib/trading/attemptLadder'

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
assert(isLateJoinClockIn('NY', etDate(9, 20)) === false, 'prep is not late join')

// At / after cash open — late join allowed through cash close
assert(canClockInNow('NY', etDate(9, 30)).ok === true, 'exact open late join ok')
assert(isLateJoinClockIn('NY', etDate(9, 30)) === true, 'exact open is late')
const late = canClockInNow('NY', etDate(10, 0))
assert(late.ok === true, 'late clock-in allowed')
assert(/late|remaining/i.test(late.reason), late.reason)
assert(activeClockMarkets(etDate(10, 0)).includes('NY'), 'active after open for late join')
assert(isLateJoinClockIn('NY', etDate(10, 0)) === true, '10:00 is late join')

assert(canClockInNow('NY', etDate(15, 59)).ok === true, 'until cash close')
assert(canClockInNow('NY', etDate(16, 0)).ok === false, 'at cash close closed')
assert(!activeClockMarkets(etDate(16, 0)).includes('NY'), 'not active after close')

const gate = resolveSessionGate({
  now: etDate(10, 0),
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: false,
  attendedToday: false,
})
assert(gate.canClockIn === true, 'gate canClockIn true after open (late join)')
assert(gate.canPlaceEntry === false, 'no entries until clock-in')
assert(gate.canViewLiveChart === false, 'chart locked until clock-in')
assert(/late/i.test(gate.message), gate.message)
assert(
  isLiveTipStreamAllowed('DOW', etDate(10, 0), { attendedToday: false }).open === false,
  'not clocked in → tip off'
)
assert(
  isLiveTipStreamAllowed('DOW', etDate(10, 0), { attendedToday: true }).open === true,
  'late join attended → tip on'
)

// Tokyo live clock-in is off — Nikkei is Simulation
assert(canClockInNow('TOKYO', jstDate(8, 50)).ok === false, 'Tokyo live clock-in off')
assert(canClockInNow('TOKYO', jstDate(9, 30)).ok === false, 'Tokyo late join off')
assert(isLateJoinClockIn('TOKYO', jstDate(9, 30)) === true, 'Tokyo late flag still time-true')
assert(canClockInNow('TOKYO', jstDate(15, 0)).ok === false, 'Tokyo after cash close')

// Re-clock after early out still allowed until cash close
const re = resolveSessionGate({
  now: etDate(10, 0),
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: false,
  attendedToday: true,
})
assert(re.canClockIn === true, 're-clock until cash close if already attended')

const afterLunch = resolveSessionGate({
  now: etDate(12, 0),
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: false,
  attendedToday: true,
})
assert(afterLunch.canClockIn === true, 're-clock after lunch until cash close')

// ── Brief ranking helpers ───────────────────────────────────────────────────

const or30Open = buildInstrumentDeskCard(
  {
    instrument: 'DOW',
    ladder: attemptLadderFromCounts({
      morningAttempts: 0,
      ibAttempts: 0,
      lunchAttempts: 0,
      now: etDate(10, 5),
      instrument: 'DOW',
    }),
    or30: { high: 40000, low: 39900, complete: true },
  },
  etDate(10, 5)
)
assert(or30Open.tradeableNow === true, 'DOW OR30 tradeable at 10:05')
assert(or30Open.openBook === 'OR30', 'open book OR30')
assert(or30Open.books.find((b) => b.label === 'OR30')?.state === 'open', 'OR30 open')

const or30Dead = buildInstrumentDeskCard(
  {
    instrument: 'DOW',
    ladder: attemptLadderFromCounts({
      morningAttempts: 0,
      ibAttempts: 0,
      lunchAttempts: 0,
      now: etDate(10, 20),
      instrument: 'DOW',
    }),
    or30: { high: 40000, low: 39900, complete: true },
  },
  etDate(10, 20)
)
assert(
  or30Dead.books.find((b) => b.label === 'OR30')?.state === 'open',
  'OR30 still open at 10:20'
)

// Morning probes exhausted before IB unlock → IB is upcoming, not dead
const ibUpcoming = buildInstrumentDeskCard(
  {
    instrument: 'DOW',
    ladder: attemptLadderFromCounts({
      morningAttempts: 2,
      ibAttempts: 0,
      lunchAttempts: 0,
      now: etDate(10, 5),
      instrument: 'DOW',
    }),
    or30: { high: 40000, low: 39900, complete: true },
  },
  etDate(10, 5)
)
assert(
  ibUpcoming.books.find((b) => b.label === 'IB')?.state === 'upcoming',
  `IB must be upcoming before 10:30, got ${ibUpcoming.books.find((b) => b.label === 'IB')?.state}`
)
assert(ibUpcoming.tradeableNow === true, 'OR30 still tradeable at 10:05 after morning probes used')
assert(/IB:/i.test(ibUpcoming.nextUnlock || ''), 'nextUnlock points at IB')

const ranked = buildLiveDeskBrief(
  [
    {
      instrument: 'DOW',
      ladder: attemptLadderFromCounts({
        morningAttempts: 0,
        now: etDate(10, 5),
        instrument: 'DOW',
      }),
      or30: { high: 40000, low: 39900, complete: true },
    },
    {
      instrument: 'NASDAQ',
      ladder: attemptLadderFromCounts({
        morningAttempts: 2,
        now: etDate(10, 5),
        instrument: 'NASDAQ',
      }),
      or30: { high: 18000, low: 17900, complete: true },
    },
    {
      instrument: 'NIKKEI',
      ladder: attemptLadderFromCounts({
        morningAttempts: 0,
        now: etDate(10, 5),
        instrument: 'NIKKEI',
      }),
    },
  ],
  etDate(10, 5)
)
assert(ranked.instruments[0]!.instrument === 'DOW', 'DOW ranks first when OR30 open')
assert(ranked.suggestion.kind === 'trade', 'suggest trade')
if (ranked.suggestion.kind === 'trade') {
  assert(ranked.suggestion.instrument === 'DOW', 'suggest DOW')
  assert(ranked.suggestion.book === 'OR30', 'suggest OR30 book')
}
assert(ranked.asOfDisplay.length > 0, 'as-of display present')
assert(ranked.bullets.length >= 2, 'bullets present')

const sitOut = buildLiveDeskBrief(
  [
    {
      instrument: 'DOW',
      ladder: attemptLadderFromCounts({
        morningAttempts: 3,
        ibAttempts: 0,
        lunchAttempts: 0,
        now: etDate(11, 0),
        instrument: 'DOW',
      }),
    },
    { instrument: 'NASDAQ' },
    { instrument: 'NIKKEI' },
  ],
  etDate(16, 30)
)
assert(sitOut.suggestion.kind === 'sit_out', 'sit out when nothing left')

// Focus-scoped suggestion: NY digest must not suggest NIKKEI even if Tokyo IB is live
const nyFocus = buildLiveDeskBrief(
  [
    { instrument: 'DOW' },
    { instrument: 'NASDAQ' },
    {
      instrument: 'NIKKEI',
      ladder: attemptLadderFromCounts({
        morningAttempts: 0,
        ibAttempts: 0,
        lunchAttempts: 0,
        now: jstDate(10, 15),
        instrument: 'NIKKEI',
      }),
      ib: { high: 40000, low: 39900, complete: true },
    },
  ],
  jstDate(10, 15),
  'NY'
)
assert(nyFocus.suggestion.kind === 'sit_out', 'NY focus sits out when NY books dead')
assert(/DOW|NASDAQ/i.test(nyFocus.suggestion.text), nyFocus.suggestion.text)
if (nyFocus.suggestion.kind === 'trade') {
  throw new Error('must not suggest trade off-focus')
}
assert(
  !nyFocus.instruments.some((c) => c.instrument === 'NIKKEI'),
  'live brief does not rank NIKKEI'
)

console.log('late_clock_in: all passed')
