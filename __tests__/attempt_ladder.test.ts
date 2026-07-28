/**
 * Attempt ladder + playbook modes (1/1/1 skip-forward).
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
  // Gap fill ("other") must lock later windows — any fill locks later
  const gap = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 0,
    otherAttempts: 1,
  })
  assert(!gap.ibEligible, 'other fill → IB locked')
  assert(!gap.lunchEligible, 'other fill → lunch locked')
}

assert(MAX_DAY_ATTEMPTS === 3, 'day cap 3')
assert(MAX_MORNING_ATTEMPTS === 1, 'morning cap 1')


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
  // Skip morning → IB + lunch eligible
  const skip = attemptLadderFromCounts({ morningAttempts: 0 })
  assert(!skip.revengeLocked, 'no revenge field')
  assert(skip.ibEligible, 'skip morning → IB ok')
  assert(skip.lunchEligible, 'skip morning → lunch ok')
  assert(skip.morningEligible, 'morning still open')
}

{
  // Any morning fill (SL or TP) → IB + lunch locked
  const oneSl = attemptLadderFromCounts({ morningAttempts: 1, morningStopHits: 1 })
  assert(!oneSl.ibEligible, '1 morning SL → IB locked')
  assert(!oneSl.lunchEligible, '1 morning SL → lunch locked')
  assert(!oneSl.morningEligible, 'morning used')

  const oneTp = attemptLadderFromCounts({ morningAttempts: 1, morningStopHits: 0 })
  assert(!oneTp.ibEligible, '1 morning TP → IB locked')
  assert(!oneTp.lunchEligible, '1 morning TP → lunch locked')
}

{
  // IB fill kills lunch
  const afterIb = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 1,
  })
  assert(!afterIb.lunchEligible, 'IB fill → lunch off')
  assert(!afterIb.ibEligible, 'IB already used')
}

{
  const dayCap = attemptLadderFromCounts({
    morningAttempts: 1,
    ibAttempts: 1,
    lunchAttempts: 1,
  })
  assert(dayCap.dayLocked, '3 fills day locked')
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
  assert(
    resolveRangeStrategyFromLadder({
      market: 'NY',
      timeSec: pts('10:30:00'),
      ladder: attemptLadderFromCounts({ morningAttempts: 1 }),
    }) === null,
    'no IB after morning fill'
  )
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(10, 30),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
    rangeStrategy: 'ib',
  })
  assert(mode === 'ib', 'IB mode')
  assert(deskPlaybookTitle(mode) === 'IB playbook', 'IB title')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(11, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
  })
  assert(mode === 'lunch_break', 'lunch break after IB')
  assert(deskPlaybookTitle(mode) === 'Lunch break playbook', 'lunch break title')
}

{
  const tokyoUs = resolveRangeStrategyFromLadder({
    market: 'TOKYO',
    timeSec: pts('10:30:00'),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
  })
  assert(tokyoUs === 'us_range', 'Tokyo mid = US Range')
  const tokyoIb = resolveRangeStrategyFromLadder({
    market: 'TOKYO',
    timeSec: pts('14:00:00'),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
  })
  assert(tokyoIb === 'ib', 'Tokyo late = IB')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 1, morningStopHits: 1 }),
  })
  assert(mode === 'done', 'morning fill → done not PM watch')
  assert(deskPlaybookTitle(mode) === 'Watch playbook', 'watch title when done')
}

{
  const ib = resolveSessionGate({
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
    attemptLadder: attemptLadderFromCounts({ morningAttempts: 0 }),
    now: etDate(10, 30),
  })
  assert(ib.canPlaceEntry === true, 'skip morning → IB place')
  assert(ib.rangeStrategy === 'ib', 'IB strategy')
  assert(ib.maxAttempts === 3, 'day max 3 on gate')
}

{
  const blocked = resolveSessionGate({
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
    attemptLadder: attemptLadderFromCounts({
      morningAttempts: 1,
      morningStopHits: 1,
    }),
    now: etDate(10, 30),
  })
  assert(blocked.canPlaceEntry === false, 'morning fill → no IB')
  assert(blocked.rangeStrategy === null, 'no strategy')
  assert(blocked.revengeLocked === false, 'revenge always false')
}

{
  const noLunch = resolveSessionGate({
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
    attemptLadder: attemptLadderFromCounts({ ibAttempts: 1 }),
    now: etDate(14, 0),
  })
  assert(noLunch.canPlaceEntry === false, 'IB used → no lunch')
  assert(noLunch.rangeStrategy === null, 'no lunch strategy')
}

{
  // Open morning book during IB clock — manage only; later windows locked
  const openMorning = resolveSessionGate({
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
    hasOpenPosition: true,
    attemptLadder: attemptLadderFromCounts({ morningAttempts: 1 }),
    now: etDate(10, 30),
  })
  assert(openMorning.phase === 'MANAGE', 'open book → MANAGE in IB clock')
  assert(openMorning.canPlaceEntry === false, 'open morning → no IB entry')
  assert(openMorning.rangeStrategy === null, 'no IB strategy while open')
  assert(
    /Morning.*(OR30 )?book open|IB and lunch-range locked|US Range and IB locked|confirm close/i.test(
      openMorning.message
    ),
    openMorning.message
  )
}

{
  // Open morning book past lunch without confirm — still manage-only through afternoon
  const rideOpen = resolveSessionGate({
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
    hasOpenPosition: true,
    attemptLadder: attemptLadderFromCounts({ morningAttempts: 1 }),
    now: etDate(14, 0),
  })
  assert(rideOpen.phase === 'MANAGE', 'unconfirmed morning book still MANAGE at lunch-range clock')
  assert(rideOpen.canPlaceEntry === false, 'no lunch-range while morning book open')
  assert(rideOpen.rangeStrategy === null, 'lunch-range stays locked')
}

console.log('attempt_ladder: all passed')
