/**
 * Attempt ladder + playbook modes (Option B: 2/2/2 · day ≤ 6).
 * Run: npx tsx __tests__/attempt_ladder.test.ts
 */

import {
  attemptLadderFromCounts,
  classifyAttemptBucket,
  MAX_DAY_ATTEMPTS,
  MAX_MORNING_ATTEMPTS,
  resolveRangeStrategyFromLadder,
} from '../lib/trading/attemptLadder'
import { parseTimeToSeconds as pts } from '../lib/utils/timeUtils'
import {
  deskPlaybookTitle,
  resolveDeskPlaybookMode,
} from '../lib/trading/deskPlaybookMode'
import { resolveSessionGate } from '../lib/trading/sessionGate'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function etDate(h: number, m: number): Date {
  return new Date(Date.UTC(2026, 6, 15, h + 4, m, 0))
}

{
  // Gap fill ("other") no longer permanently kills later windows (Option B)
  const gap = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 0,
    otherAttempts: 1,
  })
  assert(gap.ibEligible, 'other fill → IB still eligible when morning skipped')
  assert(gap.lunchEligible, 'other fill → lunch still eligible when mid skipped')
}

assert(MAX_DAY_ATTEMPTS === 6, 'day cap 6')
assert(MAX_MORNING_ATTEMPTS === 2, 'morning cap 2')

{
  const b = classifyAttemptBucket(
    'DOW',
    new Date(Date.UTC(2026, 6, 15, 9 + 4, 45, 0))
  )
  assert(b === 'morning', `morning bucket got ${b}`)
  const ib = classifyAttemptBucket(
    'DOW',
    new Date(Date.UTC(2026, 6, 15, 10 + 4, 30, 0))
  )
  assert(ib === 'ib', `ib bucket got ${ib}`)
  const ln = classifyAttemptBucket(
    'DOW',
    new Date(Date.UTC(2026, 6, 15, 14 + 4, 0, 0))
  )
  assert(ln === 'lunch_range', `ln bucket got ${ln}`)
}

{
  // Skip morning → IB + lunch eligible (count-only)
  const skip = attemptLadderFromCounts({ morningAttempts: 0 })
  assert(!skip.revengeLocked, 'no revenge field')
  assert(skip.ibEligible, 'skip morning → IB ok')
  assert(skip.lunchEligible, 'skip morning → lunch ok')
  assert(skip.morningEligible, 'morning still open')
}

{
  // One morning fill without clock → mid still locked (morning not exhausted, clock unknown)
  const oneSl = attemptLadderFromCounts({ morningAttempts: 1, morningStopHits: 1 })
  assert(!oneSl.ibEligible, '1 morning without clock → IB locked')
  assert(oneSl.morningEligible, 'morning still has probes left')

  // Exhaust morning → mid unlocks
  const two = attemptLadderFromCounts({ morningAttempts: 2, morningStopHits: 2 })
  assert(two.ibEligible, '2 morning → IB unlocked')
  assert(!two.morningEligible, 'morning exhausted')
}

{
  // Clock past midStart (10:30) with 1 morning fill → IB unlocked (Option B)
  const afterAm = attemptLadderFromCounts({
    morningAttempts: 1,
    now: etDate(10, 30),
    instrument: 'DOW',
  })
  assert(afterAm.ibEligible, 'after morning clock → IB ok with prior fill')
}

{
  // Clock past midEnd with 1 IB fill → lunch unlocked (Option B)
  const afterMid = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 1,
    now: etDate(11, 0),
    instrument: 'DOW',
  })
  assert(afterMid.lunchEligible, 'after IB clock → lunch ok with prior IB fill')
}

{
  // IB fill without clock → lunch locked until mid exhausted or clock
  const afterIb = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 1,
  })
  assert(!afterIb.lunchEligible, 'IB fill without clock → lunch off')
  assert(afterIb.ibEligible, 'IB still has probes left')
}

{
  const dayCap = attemptLadderFromCounts({
    morningAttempts: 2,
    ibAttempts: 2,
    lunchAttempts: 2,
  })
  assert(dayCap.dayLocked, '6 fills day locked')
  assert(!dayCap.morningEligible && !dayCap.ibEligible && !dayCap.lunchEligible, 'all off')
}

{
  const ladder = attemptLadderFromCounts({ morningAttempts: 0 })
  assert(
    resolveRangeStrategyFromLadder({
      market: 'NY',
      timeSec: pts('10:30:00'),
      ladder,
    }) === 'ib',
    'IB when morning skipped'
  )
  // With count-only ladder after 1 morning fill, ibEligible false → no IB
  assert(
    resolveRangeStrategyFromLadder({
      market: 'NY',
      timeSec: pts('10:30:00'),
      ladder: attemptLadderFromCounts({ morningAttempts: 1 }),
    }) === null,
    'no IB when morning fill and no clock release on ladder'
  )
  assert(
    resolveRangeStrategyFromLadder({
      market: 'NY',
      timeSec: pts('10:30:00'),
      ladder: attemptLadderFromCounts({
        morningAttempts: 1,
        now: etDate(10, 30),
        instrument: 'DOW',
      }),
    }) === 'ib',
    'IB after morning clock with prior probe'
  )
}

{
  // Gate smoke — morning entry after OR30 lock (10:00)
  const g = resolveSessionGate({
    now: etDate(10, 5),
    lockedInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
  })
  assert(g.canPlaceEntry, 'morning can place')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    rangeStrategy: 'ib',
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
  })
  assert(deskPlaybookTitle(mode).length > 0, 'playbook title')
}

console.log('attempt_ladder: all passed')
