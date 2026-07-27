/**
 * Range strategy attempt ladder — NY + Tokyo.
 * Run: npx tsx __tests__/range_strategy_ladder.test.ts
 */

import {
  resolveSessionGate,
  resolveRangeStrategy,
  NY_IB_STRATEGY_START,
  NY_IB_STRATEGY_END,
  NY_LUNCH_RANGE_ENTRY_START,
  NY_LUNCH_RANGE_ENTRY_END,
  TOKYO_IB_STRATEGY_START,
  TOKYO_LUNCH_RANGE_ENTRY_START,
  TOKYO_LUNCH_RANGE_ENTRY_END,
  attemptLadderFromCounts,
} from '../lib/trading/sessionGate'
import { parseTimeToSeconds as pts } from '../lib/utils/timeUtils'

const TESTS_PASSED: string[] = []
const TESTS_FAILED: Array<{ name: string; error: string }> = []

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function test(name: string, fn: () => void) {
  try {
    fn()
    TESTS_PASSED.push(name)
    console.log(`✅ PASS: ${name}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    TESTS_FAILED.push({ name, error: errorMsg })
    console.log(`❌ FAIL: ${name}`)
    console.log(`   ${errorMsg}`)
  }
}

/** America/New_York July = EDT (UTC-4) */
function etDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h + 4, min, 0))
}

/** Asia/Tokyo = UTC+9 */
function jstDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 9, min, 0))
}

const gateBase = {
  lockedInstrument: 'DOW' as const,
  clockedIn: true,
  attendedToday: true,
  attemptsUsed: 0,
  stopLossHitCount: 0,
}

test('resolveRangeStrategy clocks: NY IB 10:15–10:45, lunch-range 13:30–15:15', () => {
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts(NY_IB_STRATEGY_START),
      attemptsUsed: 0,
    }) === 'ib',
    'NY IB start'
  )
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts('10:44:00'),
      attemptsUsed: 0,
    }) === 'ib',
    'NY IB late'
  )
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts(NY_IB_STRATEGY_END),
      attemptsUsed: 0,
    }) === null,
    'NY IB ended at 10:45'
  )
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts(NY_LUNCH_RANGE_ENTRY_START),
      attemptsUsed: 0,
    }) === 'lunch_range',
    'NY lunch-range start'
  )
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts(NY_LUNCH_RANGE_ENTRY_END),
      attemptsUsed: 0,
    }) === null,
    'NY lunch-range ended 15:15'
  )
})

test('resolveRangeStrategy clocks: Tokyo IB 10:15–10:45, lunch-range 13:30–15:00', () => {
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts(TOKYO_IB_STRATEGY_START),
      attemptsUsed: 0,
    }) === 'ib',
    'Tokyo IB start'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts(TOKYO_LUNCH_RANGE_ENTRY_START),
      attemptsUsed: 0,
    }) === 'lunch_range',
    'Tokyo lunch-range'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts(TOKYO_LUNCH_RANGE_ENTRY_END),
      attemptsUsed: 0,
    }) === null,
    'Tokyo lunch-range end'
  )
})

test('NY: morning ≤1 → IB unlock; 2 morning blocks IB; IB fill blocks lunch', () => {
  const ib = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 10, 30),
    viewingInstrument: 'DOW',
  })
  assert(ib.canPlaceEntry === true, 'IB can place')
  assert(ib.rangeStrategy === 'ib', 'IB strategy')

  const withOne = resolveSessionGate({
    ...gateBase,
    attemptLadder: attemptLadderFromCounts({ morningAttempts: 1 }),
    now: etDate(2026, 7, 15, 10, 30),
    viewingInstrument: 'DOW',
  })
  assert(withOne.canPlaceEntry === true, '1 morning → IB still open')
  assert(withOne.rangeStrategy === 'ib', 'IB with 1 morning')

  const afterIb = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 11, 0),
    viewingInstrument: 'DOW',
  })
  assert(afterIb.canPlaceEntry === false, 'after 10:45 no IB entry')
  assert(/Lunch break|IB entry closed/i.test(afterIb.message), afterIb.message)

  const twoMorning = resolveSessionGate({
    ...gateBase,
    attemptLadder: attemptLadderFromCounts({ morningAttempts: 2, morningStopHits: 0 }),
    now: etDate(2026, 7, 15, 10, 30),
    viewingInstrument: 'DOW',
  })
  assert(twoMorning.canPlaceEntry === false, '2 morning → no IB')
  assert(twoMorning.rangeStrategy === null, 'no IB strategy')
})

test('NY: lunch-range when IB skipped; manage-only after 15:15; no PM watch copy', () => {
  const wait = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 12, 0),
    viewingInstrument: 'DOW',
  })
  assert(wait.canPlaceEntry === false, '12:00 no place')
  assert(/Lunch break playbook|lunch-range opens/i.test(wait.message), wait.message)
  assert(!/watch-only|Afternoon watch|PM watch/i.test(wait.message), wait.message)

  const ln = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 14, 0),
    viewingInstrument: 'DOW',
  })
  assert(ln.canPlaceEntry === true, '14:00 lunch-range place')
  assert(ln.rangeStrategy === 'lunch_range', 'lunch_range')

  const afterIbFill = resolveSessionGate({
    ...gateBase,
    attemptLadder: attemptLadderFromCounts({ ibAttempts: 1 }),
    now: etDate(2026, 7, 15, 14, 0),
    viewingInstrument: 'DOW',
  })
  assert(afterIbFill.canPlaceEntry === false, 'IB fill → lunch off')
  assert(afterIbFill.rangeStrategy === null, 'no lunch')

  const afterLn = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 15, 30),
    viewingInstrument: 'DOW',
  })
  assert(afterLn.canPlaceEntry === false, '15:30 manage-only')
  assert(afterLn.rangeStrategy === null, 'no lunch-range after 15:15')
})

test('Nikkei: IB 10:15–10:45 JST; lunch-range to 15:00 JST', () => {
  const ib = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
    now: jstDate(2026, 7, 15, 10, 30),
  })
  assert(ib.canPlaceEntry === true, `Nikkei IB place: ${ib.message}`)
  assert(ib.rangeStrategy === 'ib', `got ${ib.rangeStrategy}`)

  const ln = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
    now: jstDate(2026, 7, 15, 14, 0),
  })
  assert(ln.canPlaceEntry === true, `Nikkei lunch-range: ${ln.message}`)
  assert(ln.rangeStrategy === 'lunch_range', `got ${ln.rangeStrategy}`)
})

test('Nikkei: revenge lock blocks IB + lunch-range (parity with NY)', () => {
  const fills = [
    {
      instrument: 'NIKKEI',
      entryTimestamp: jstDate(2026, 7, 15, 9, 10),
      exitReason: 'stop_hit',
    },
    {
      instrument: 'NIKKEI',
      entryTimestamp: jstDate(2026, 7, 15, 9, 30),
      exitReason: 'stop_hit',
    },
  ]
  const ib = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 2,
    stopLossHitCount: 2,
    attemptFills: fills,
    now: jstDate(2026, 7, 15, 10, 30),
  })
  assert(ib.revengeLocked === true, 'Nikkei revenge')
  assert(ib.canPlaceEntry === false, 'Nikkei IB blocked by revenge')
  assert(ib.rangeStrategy === null, 'no IB strategy when revenge')

  const ln = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 2,
    stopLossHitCount: 2,
    attemptFills: fills,
    now: jstDate(2026, 7, 15, 14, 0),
  })
  assert(ln.canPlaceEntry === false, 'Nikkei lunch-range blocked by revenge')
})

test('Nikkei: morning ≤1 unlocks IB; any IB fill kills lunch', () => {
  const morningOnly = [
    {
      instrument: 'NIKKEI',
      entryTimestamp: jstDate(2026, 7, 15, 9, 20),
      exitReason: 'take_profit',
    },
  ]
  const ib = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 1,
    stopLossHitCount: 0,
    attemptFills: morningOnly,
    now: jstDate(2026, 7, 15, 10, 30),
  })
  assert(ib.canPlaceEntry === true, `Nikkei IB after 1 morning: ${ib.message}`)
  assert(ib.rangeStrategy === 'ib', 'IB unlocked')

  const afterIb = [
    ...morningOnly,
    {
      instrument: 'NIKKEI',
      entryTimestamp: jstDate(2026, 7, 15, 10, 25),
      exitReason: 'take_profit',
    },
  ]
  const ln = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 2,
    stopLossHitCount: 0,
    attemptFills: afterIb,
    now: jstDate(2026, 7, 15, 14, 0),
  })
  assert(ln.canPlaceEntry === false, 'IB fill kills lunch on Nikkei')
  assert(ln.rangeStrategy === null, 'no lunch-range after IB fill')
})

test('Morning entry window still allows 2 attempts (NY)', () => {
  const g = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 9, 45),
    viewingInstrument: 'DOW',
  })
  assert(g.canPlaceEntry === true, 'morning entry')
  assert(g.rangeStrategy === null, 'not range strategy yet')
  assert(g.maxAttempts === 4, 'day max shown as 4')
})

console.log(`\n${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length > 0) process.exit(1)
