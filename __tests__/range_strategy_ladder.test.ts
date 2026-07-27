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
  TOKYO_IB_STRATEGY_END,
  TOKYO_LUNCH_RANGE_ENTRY_START,
  TOKYO_LUNCH_RANGE_ENTRY_END,
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
      timeSec: pts('11:00:00'),
      attemptsUsed: 0,
    }) === null,
    'NY after IB manage/watch'
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
      timeSec: pts('15:14:00'),
      attemptsUsed: 0,
    }) === 'lunch_range',
    'NY lunch-range late'
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
      timeSec: pts(TOKYO_IB_STRATEGY_END),
      attemptsUsed: 0,
    }) === null,
    'Tokyo IB end'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts('09:30:00'),
      attemptsUsed: 0,
    }) === null,
    'Tokyo before IB'
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
      timeSec: pts('14:59:00'),
      attemptsUsed: 0,
    }) === 'lunch_range',
    'Tokyo before cash close'
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

test('NY: morning unused → IB unlock 10:15–10:45; used morning blocks IB', () => {
  const ib = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 10, 30),
    viewingInstrument: 'DOW',
  })
  assert(ib.canPlaceEntry === true, 'IB can place')
  assert(ib.rangeStrategy === 'ib', 'IB strategy')
  assert(/IB strategy unlocked/i.test(ib.message), ib.message)

  const afterIb = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 11, 0),
    viewingInstrument: 'DOW',
  })
  assert(afterIb.canPlaceEntry === false, 'after 10:45 no IB entry')
  assert(afterIb.rangeStrategy === null, 'no strategy after IB')
  assert(/IB entry closed/i.test(afterIb.message), afterIb.message)

  const blocked = resolveSessionGate({
    ...gateBase,
    attemptsUsed: 1,
    now: etDate(2026, 7, 15, 10, 30),
    viewingInstrument: 'DOW',
  })
  assert(blocked.canPlaceEntry === false, 'morning used → no IB')
  assert(blocked.rangeStrategy === null, 'no strategy')
})

test('NY: lunch-range 13:30–15:15; manage-only after 15:15', () => {
  const wait = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 12, 0),
    viewingInstrument: 'DOW',
  })
  assert(wait.canPlaceEntry === false, '12:00 watch')
  assert(/Watch-only until 13:30/i.test(wait.message), wait.message)

  const ln = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 14, 0),
    viewingInstrument: 'DOW',
  })
  assert(ln.canPlaceEntry === true, '14:00 lunch-range place')
  assert(ln.rangeStrategy === 'lunch_range', 'lunch_range')

  const afterLn = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 15, 30),
    viewingInstrument: 'DOW',
  })
  assert(afterLn.canPlaceEntry === false, '15:30 manage-only')
  assert(afterLn.rangeStrategy === null, 'no lunch-range after 15:15')
  assert(/Lunch-range entry closed/i.test(afterLn.message), afterLn.message)
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

test('Morning entry window still allows 2 attempts (NY)', () => {
  const g = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 9, 45),
    viewingInstrument: 'DOW',
  })
  assert(g.canPlaceEntry === true, 'morning entry')
  assert(g.rangeStrategy === null, 'not range strategy yet')
})

console.log(`\n${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length > 0) process.exit(1)
