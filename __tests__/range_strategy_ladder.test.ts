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

test('resolveRangeStrategy clocks: NY IB 10:30–10:45, lunch-range 13:30–15:15', () => {
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts('10:15:00'),
      attemptsUsed: 0,
    }) === null,
    'NY before IB lock (10:15) — no IB yet'
  )
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts(NY_IB_STRATEGY_START),
      attemptsUsed: 0,
    }) === 'ib',
    'NY IB start at 10:30'
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

test('resolveRangeStrategy clocks: Tokyo US Range 09:00–10:45, IB 13:30–15:00', () => {
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts('09:00:00'),
      attemptsUsed: 0,
    }) === 'us_range',
    'Tokyo US Range at cash open'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts('09:20:00'),
      attemptsUsed: 0,
    }) === 'us_range',
    'Tokyo US Range while OR30 forming'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts('09:35:00'),
      attemptsUsed: 0,
    }) === null,
    'Tokyo OR30 morning slice prefers morning (null strategy)'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts(TOKYO_IB_STRATEGY_START),
      attemptsUsed: 0,
    }) === 'us_range',
    'Tokyo US Range start constant'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts(TOKYO_LUNCH_RANGE_ENTRY_START),
      attemptsUsed: 0,
    }) === 'ib',
    'Tokyo IB (slot 3)'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts(TOKYO_LUNCH_RANGE_ENTRY_END),
      attemptsUsed: 0,
    }) === null,
    'Tokyo IB end'
  )
})

test('NY: morning skipped → IB unlock; morning probe still allows IB after clock (Option B)', () => {
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
  assert(withOne.canPlaceEntry === true, '1 morning probe → IB still open after AM clock')
  assert(withOne.rangeStrategy === 'ib', 'IB after morning probe')

  const beforeLock = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 10, 20),
    viewingInstrument: 'DOW',
  })
  assert(beforeLock.canPlaceEntry === false, '10:20 — IB not shaped yet, no entry')
  assert(beforeLock.rangeStrategy == null, 'no IB strategy before 10:30')

  const afterIb = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 11, 0),
    viewingInstrument: 'DOW',
  })
  assert(afterIb.canPlaceEntry === false, 'after 10:45 no IB entry')
  assert(/Lunch break|IB entry closed/i.test(afterIb.message), afterIb.message)
})

test('NY: lunch-range when morning + IB skipped; manage-only after 15:15; no PM watch copy', () => {
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

  const afterMorning = resolveSessionGate({
    ...gateBase,
    attemptLadder: attemptLadderFromCounts({ morningAttempts: 1 }),
    now: etDate(2026, 7, 15, 14, 0),
    viewingInstrument: 'DOW',
  })
  assert(afterMorning.canPlaceEntry === true, 'morning probe → lunch still open after clocks')
  assert(afterMorning.rangeStrategy === 'lunch_range', 'lunch after morning probe')

  const afterIbFill = resolveSessionGate({
    ...gateBase,
    attemptLadder: attemptLadderFromCounts({ ibAttempts: 1 }),
    now: etDate(2026, 7, 15, 14, 0),
    viewingInstrument: 'DOW',
  })
  assert(afterIbFill.canPlaceEntry === true, 'IB probe → lunch still open after mid clock')
  assert(afterIbFill.rangeStrategy === 'lunch_range', 'lunch after IB probe')

  const afterLn = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 15, 30),
    viewingInstrument: 'DOW',
  })
  assert(afterLn.canPlaceEntry === false, '15:30 manage-only')
  assert(afterLn.rangeStrategy === null, 'no lunch-range after 15:15')
})

test('Nikkei: US Range from cash open; IB to 15:00 JST', () => {
  const early = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
    now: jstDate(2026, 7, 15, 9, 20),
  })
  assert(early.canPlaceEntry === true, `Nikkei US Range at 09:20: ${early.message}`)
  assert(early.rangeStrategy === 'us_range', `got ${early.rangeStrategy}`)
  assert(!/OR30 forming/i.test(early.message), early.message)

  const us = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
    now: jstDate(2026, 7, 15, 10, 30),
  })
  assert(us.canPlaceEntry === true, `Nikkei US Range place: ${us.message}`)
  assert(us.rangeStrategy === 'us_range', `got ${us.rangeStrategy}`)
  assert(/US Range/i.test(us.message), us.message)

  const ib = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
    now: jstDate(2026, 7, 15, 14, 0),
  })
  assert(ib.canPlaceEntry === true, `Nikkei IB: ${ib.message}`)
  assert(ib.rangeStrategy === 'ib', `got ${ib.rangeStrategy}`)
})

test('Nikkei: morning probe still allows US Range + IB after clocks (Option B)', () => {
  const fills = [
    {
      instrument: 'NIKKEI',
      entryTimestamp: jstDate(2026, 7, 15, 9, 10),
      exitReason: 'stop_hit',
    },
  ]
  const us = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 1,
    stopLossHitCount: 1,
    attemptFills: fills,
    now: jstDate(2026, 7, 15, 10, 30),
  })
  assert(us.revengeLocked === false, 'revenge always false')
  assert(us.canPlaceEntry === true, 'Nikkei US Range open after morning probe')
  assert(us.rangeStrategy === 'us_range', 'US Range after morning probe')

  const ib = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 1,
    stopLossHitCount: 1,
    attemptFills: fills,
    now: jstDate(2026, 7, 15, 14, 0),
  })
  assert(ib.canPlaceEntry === true, 'Nikkei IB open after morning probe + clocks')
  assert(ib.rangeStrategy === 'ib', 'IB after morning probe')
})

test('Nikkei: US Range probe still allows IB after mid clock (Option B)', () => {
  const morningOnly = [
    {
      instrument: 'NIKKEI',
      entryTimestamp: jstDate(2026, 7, 15, 9, 20),
      exitReason: 'take_profit',
    },
  ]
  const us = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 1,
    stopLossHitCount: 0,
    attemptFills: morningOnly,
    now: jstDate(2026, 7, 15, 10, 30),
  })
  assert(us.canPlaceEntry === true, `Nikkei US Range after morning: ${us.message}`)
  assert(us.rangeStrategy === 'us_range', 'US Range still open')

  const afterUsOnly = [
    {
      instrument: 'NIKKEI',
      entryTimestamp: jstDate(2026, 7, 15, 10, 25),
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
    attemptFills: afterUsOnly,
    now: jstDate(2026, 7, 15, 14, 0),
  })
  assert(ib.canPlaceEntry === true, 'US Range probe → IB still open after mid clock')
  assert(ib.rangeStrategy === 'ib', 'IB after US Range probe')
})

test('Morning entry window allows 2 attempts (NY Option B)', () => {
  const forming = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 9, 45),
    viewingInstrument: 'DOW',
  })
  assert(forming.canPlaceEntry === false, 'OR30 forming — no entry yet')

  const g = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 10, 5),
    viewingInstrument: 'DOW',
  })
  assert(g.canPlaceEntry === true, 'morning entry after OR30 lock')
  assert(g.rangeStrategy === null, 'not range strategy yet')
  assert(g.maxAttempts === 6, 'day max shown as 6')
  assert(g.maxMorningAttempts === 2, 'morning max 2')
})

console.log(`\n${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length > 0) process.exit(1)
