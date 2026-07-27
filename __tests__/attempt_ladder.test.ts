/**
 * Attempt ladder + playbook modes.
 * Run: npx tsx __tests__/attempt_ladder.test.ts
 */

import {
  attemptLadderFromCounts,
  classifyAttemptBucket,
  MAX_DAY_ATTEMPTS,
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

assert(MAX_DAY_ATTEMPTS === 4, 'day cap 4')

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
  // Revenge: 2 morning stops
  const revenge = attemptLadderFromCounts({
    morningAttempts: 2,
    morningStopHits: 2,
  })
  assert(revenge.revengeLocked, 'revenge')
  assert(!revenge.ibEligible, 'no IB after revenge')
  assert(!revenge.lunchEligible, 'no lunch after revenge')
}

{
  // 1 morning (SL or TP) → IB ok
  const one = attemptLadderFromCounts({ morningAttempts: 1, morningStopHits: 1 })
  assert(one.ibEligible, '1 morning → IB ok')
  assert(one.lunchEligible, '1 morning no IB fill → lunch ok')
}

{
  // 2 morning mixed (not all stops) → no IB; lunch ok if IB skipped
  const mixed = attemptLadderFromCounts({
    morningAttempts: 2,
    morningStopHits: 1,
  })
  assert(!mixed.revengeLocked, 'not revenge')
  assert(!mixed.ibEligible, '2 morning → no IB')
  assert(mixed.lunchEligible, 'IB skipped → lunch ok')
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
    morningAttempts: 2,
    ibAttempts: 1,
    lunchAttempts: 1,
  })
  assert(dayCap.dayLocked, '4 fills day locked')
  assert(!dayCap.morningEligible && !dayCap.ibEligible && !dayCap.lunchEligible, 'all off')
}

{
  const ladder = attemptLadderFromCounts({ morningAttempts: 1 })
  assert(
    resolveRangeStrategyFromLadder({
      market: 'NY',
      timeSec: pts('10:30:00'),
      ladder,
    }) === 'ib',
    'IB with 1 morning'
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
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 2, morningStopHits: 2 }),
  })
  assert(mode === 'done', 'revenge → done not PM watch')
  assert(deskPlaybookTitle(mode) === 'Watch playbook', 'watch title when done')
}

{
  const ib = resolveSessionGate({
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 1,
    stopLossHitCount: 0,
    attemptLadder: attemptLadderFromCounts({ morningAttempts: 1 }),
    now: etDate(10, 30),
  })
  assert(ib.canPlaceEntry === true, '1 morning → IB place')
  assert(ib.rangeStrategy === 'ib', 'IB strategy')
  assert(ib.maxAttempts === 4, 'day max 4 on gate')
}

{
  const blocked = resolveSessionGate({
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
    attemptLadder: attemptLadderFromCounts({
      morningAttempts: 2,
      morningStopHits: 2,
    }),
    now: etDate(10, 30),
  })
  assert(blocked.canPlaceEntry === false, 'revenge → no IB')
  assert(blocked.rangeStrategy === null, 'no strategy')
  assert(blocked.revengeLocked === true, 'revenge flag')
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

console.log('attempt_ladder: all passed')
