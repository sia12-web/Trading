/**
 * Range strategy attempt ladder — NY + Tokyo.
 * Run: npx tsx __tests__/range_strategy_ladder.test.ts
 */

import {
  resolveSessionGate,
  resolveSimMorningGate,
  resolveRangeStrategy,
  NY_OR30_STRATEGY_START,
  NY_OR30_STRATEGY_END,
  NY_IB_STRATEGY_START,
  NY_IB_STRATEGY_END,
  TOKYO_IB_STRATEGY_START,
  TOKYO_US_RANGE_STRATEGY_END,
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

test('resolveRangeStrategy clocks: NY OR30 10:00–10:30, IB 10:30–15:15', () => {
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts('09:50:00'),
      attemptsUsed: 0,
    }) === null,
    'NY before OR30 lock (09:50) — Open range, no slot-2 yet'
  )
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts(NY_OR30_STRATEGY_START),
      attemptsUsed: 0,
    }) === 'or30',
    'NY OR30 start at 10:00'
  )
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts('10:15:00'),
      attemptsUsed: 0,
    }) === 'or30',
    'NY OR30 still open at 10:15'
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
      timeSec: pts('13:29:00'),
      attemptsUsed: 0,
    }) === 'ib',
    'NY IB still open at 13:29'
  )
  assert(NY_OR30_STRATEGY_END === NY_IB_STRATEGY_START, 'OR30 end === IB start')
  assert(
    resolveRangeStrategy({
      market: 'NY',
      timeSec: pts(NY_IB_STRATEGY_END),
      attemptsUsed: 0,
    }) === null,
    'NY IB ended 15:15'
  )
})

test('resolveRangeStrategy clocks: Tokyo US Range 09:30–10:45, IB from 10:00 lock', () => {
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts('09:00:00'),
      attemptsUsed: 0,
    }) === null,
    'Tokyo Open range forming at cash open'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts('09:20:00'),
      attemptsUsed: 0,
    }) === null,
    'Tokyo Open-range entry prefers morning (null strategy)'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts('09:35:00'),
      attemptsUsed: 0,
    }) === 'us_range',
    'Tokyo US Range after Open range'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts(TOKYO_IB_STRATEGY_START),
      attemptsUsed: 0,
    }) === 'us_range',
    'Tokyo US Range start constant'
  )
  // Sequential picker still prefers US while mid window open; IB bucket is also live.
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts(TOKYO_LUNCH_RANGE_ENTRY_START),
      attemptsUsed: 0,
    }) === 'us_range',
    'Tokyo at IB lock still shows US Range as sequential playbook (overlap)'
  )
  assert(
    resolveRangeStrategy({
      market: 'TOKYO',
      timeSec: pts(TOKYO_US_RANGE_STRATEGY_END),
      attemptsUsed: 0,
    }) === 'ib',
    'Tokyo IB sequential after US Range end'
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
  assert(beforeLock.canPlaceEntry === true, '10:20 — OR30 slot is open')
  assert(beforeLock.rangeStrategy === 'or30', 'OR30 strategy at 10:20')

  const afterIb = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 11, 30),
    viewingInstrument: 'DOW',
  })
  assert(afterIb.canPlaceEntry === true, '11:30 — IB still open')
  assert(afterIb.rangeStrategy === 'ib', 'IB strategy at 11:30')
  assert(/IB playbook unlocked/i.test(afterIb.message), afterIb.message)

  const justBeforeLn = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 13, 29),
    viewingInstrument: 'DOW',
  })
  assert(justBeforeLn.canPlaceEntry === true, '13:29 — IB still open')
  assert(justBeforeLn.rangeStrategy === 'ib', 'IB at 13:29')

  const atLn = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 13, 30),
    viewingInstrument: 'DOW',
  })
  assert(atLn.canPlaceEntry === true, '13:30 — IB still open')
  assert(atLn.rangeStrategy === 'ib', 'IB at 13:30')
})

test('NY: IB when morning + OR30 skipped; manage-only after 15:15; no PM watch copy', () => {
  const wait = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 12, 0),
    viewingInstrument: 'DOW',
  })
  assert(wait.canPlaceEntry === true, '12:00 IB still placeable')
  assert(wait.rangeStrategy === 'ib', '12:00 still IB')
  assert(/IB playbook unlocked/i.test(wait.message), wait.message)
  assert(!/watch-only|Afternoon watch|PM watch/i.test(wait.message), wait.message)

  const ln = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 14, 0),
    viewingInstrument: 'DOW',
  })
  assert(ln.canPlaceEntry === true, '14:00 IB place')
  assert(ln.rangeStrategy === 'ib', 'IB at 14:00')

  const afterMorning = resolveSessionGate({
    ...gateBase,
    attemptLadder: attemptLadderFromCounts({ morningAttempts: 1 }),
    now: etDate(2026, 7, 15, 14, 0),
    viewingInstrument: 'DOW',
  })
  assert(afterMorning.canPlaceEntry === true, 'morning probe → IB still open')
  assert(afterMorning.rangeStrategy === 'ib', 'IB after morning probe')

  const afterIbFill = resolveSessionGate({
    ...gateBase,
    attemptLadder: attemptLadderFromCounts({ ibAttempts: 1 }),
    now: etDate(2026, 7, 15, 14, 0),
    viewingInstrument: 'DOW',
  })
  assert(afterIbFill.canPlaceEntry === true, 'OR30 probe → IB still open after mid clock')
  assert(afterIbFill.rangeStrategy === 'ib', 'IB after OR30 probe')

  const afterLn = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 15, 30),
    viewingInstrument: 'DOW',
  })
  assert(afterLn.canPlaceEntry === false, '15:30 manage-only')
  assert(afterLn.rangeStrategy === null, 'no IB after 15:15')
})

test('Nikkei (simulation): US Range from cash open; IB to 15:00 JST', () => {
  const early = resolveSimMorningGate({
    instrument: 'NIKKEI',
    now: jstDate(2026, 7, 15, 9, 20),
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(early.canPlaceEntry === true, `Nikkei Open range at 09:20: ${early.message}`)
  assert(early.rangeStrategy == null, `got ${early.rangeStrategy}`)
  assert(/Open range/i.test(early.message), early.message)

  const us = resolveSimMorningGate({
    instrument: 'NIKKEI',
    now: jstDate(2026, 7, 15, 10, 30),
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(us.canPlaceEntry === true, `Nikkei US Range place: ${us.message}`)
  assert(us.rangeStrategy === 'us_range', `got ${us.rangeStrategy}`)
  assert(/US Range/i.test(us.message), us.message)

  const ib = resolveSimMorningGate({
    instrument: 'NIKKEI',
    now: jstDate(2026, 7, 15, 14, 0),
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(ib.canPlaceEntry === true, `Nikkei IB: ${ib.message}`)
  assert(ib.rangeStrategy === 'ib', `got ${ib.rangeStrategy}`)

  const liveSnap = resolveSessionGate({
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    now: jstDate(2026, 7, 15, 9, 20),
  })
  assert(liveSnap.market === 'NY', 'live gate never becomes Tokyo')
  assert(!liveSnap.allowedInstruments.includes('NIKKEI'), 'no live NIKKEI')
})

test('Nikkei (simulation): morning probe still allows US Range + IB after clocks (Option B)', () => {
  const us = resolveSimMorningGate({
    instrument: 'NIKKEI',
    now: jstDate(2026, 7, 15, 10, 30),
    morningAttempts: 1,
    stopHits: 1,
  })
  assert(us.revengeLocked === false, 'revenge always false')
  assert(us.canPlaceEntry === true, 'Nikkei US Range open after morning probe')
  assert(us.rangeStrategy === 'us_range', 'US Range after morning probe')

  const ib = resolveSimMorningGate({
    instrument: 'NIKKEI',
    now: jstDate(2026, 7, 15, 14, 0),
    morningAttempts: 1,
    stopHits: 1,
  })
  assert(ib.canPlaceEntry === true, 'Nikkei IB open after morning probe + clocks')
  assert(ib.rangeStrategy === 'ib', 'IB after morning probe')
})

test('Nikkei (simulation): US Range probe still allows IB after mid clock (Option B)', () => {
  const us = resolveSimMorningGate({
    instrument: 'NIKKEI',
    now: jstDate(2026, 7, 15, 10, 30),
    morningAttempts: 1,
    stopHits: 0,
  })
  assert(us.canPlaceEntry === true, `Nikkei US Range after morning: ${us.message}`)
  assert(us.rangeStrategy === 'us_range', 'US Range still open')

  const ib = resolveSimMorningGate({
    instrument: 'NIKKEI',
    now: jstDate(2026, 7, 15, 14, 0),
    ibAttempts: 1,
    stopHits: 0,
  })
  assert(ib.canPlaceEntry === true, 'US Range probe → IB still open after mid clock')
  assert(ib.rangeStrategy === 'ib', 'IB after US Range probe')
})

test('Morning entry window allows 2 attempts (NY Option B)', () => {
  const forming = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 9, 40),
    viewingInstrument: 'DOW',
  })
  assert(forming.canPlaceEntry === false, 'Open range forming — no entry yet')

  const locked = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 9, 50),
    viewingInstrument: 'DOW',
  })
  assert(locked.canPlaceEntry === true, 'morning entry after Open range lock')
  assert(locked.rangeStrategy === null, 'not range strategy yet')
  assert(locked.maxAttempts === 3, 'session max shown as 3')
  assert(locked.maxMorningAttempts === 2, 'morning max 2')

  const g = resolveSessionGate({
    ...gateBase,
    now: etDate(2026, 7, 15, 10, 5),
    viewingInstrument: 'DOW',
  })
  assert(g.canPlaceEntry === true, 'OR30 entry after 10:00')
  assert(g.rangeStrategy === 'or30', 'OR30 strategy at 10:05')
})

console.log(`\n${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length > 0) process.exit(1)
