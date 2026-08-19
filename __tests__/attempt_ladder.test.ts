/**
 * Attempt ladder + playbook modes (per-window 2/2/2, session cap ≤ 3).
 * Run: npx tsx __tests__/attempt_ladder.test.ts
 */

import {
  attemptLadderFromCounts,
  buildAttemptLadder,
  classifyAttemptBucket,
  MAX_DAY_ATTEMPTS,
  MAX_MORNING_ATTEMPTS,
  resolveRangeStrategyFromLadder,
  bucketForRangeLabel,
  assertBucketEntryEligible,
  deskClockSeconds,
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

assert(MAX_DAY_ATTEMPTS === 3, 'session cap 3')
assert(MAX_MORNING_ATTEMPTS === 2, 'morning cap 2')

{
  const b = classifyAttemptBucket(
    'DOW',
    new Date(Date.UTC(2026, 6, 15, 9 + 4, 45, 0))
  )
  assert(b === 'morning', `morning bucket got ${b}`)
  const ib = classifyAttemptBucket(
    'DOW',
    new Date(Date.UTC(2026, 6, 15, 10 + 4, 15, 0))
  )
  assert(ib === 'ib', `ib bucket (OR30) got ${ib}`)
  const ln = classifyAttemptBucket(
    'DOW',
    new Date(Date.UTC(2026, 6, 15, 10 + 4, 30, 0))
  )
  assert(ln === 'lunch_range', `ln bucket (IB) got ${ln}`)
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
  // Clock past IB end (lunch-range start) with 1 IB fill → lunch unlocked (Option B)
  const afterMid = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 1,
    now: etDate(13, 30),
    instrument: 'DOW',
  })
  assert(afterMid.lunchEligible, 'after IB clock → lunch ok with prior IB fill')
}

{
  // During extended IB window (11:30) with 1 IB fill — lunch must NOT steal yet
  const duringIb = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 1,
    now: etDate(11, 30),
    instrument: 'DOW',
  })
  assert(duringIb.lunchEligible, '11:30 IB (slot 3) eligible after OR30 clock')
  assert(duringIb.ibEligible, 'OR30 probes still unused on the ladder')
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
  assert(dayCap.dayLocked, '6 fills → day locked well past session cap')
  assert(!dayCap.morningEligible && !dayCap.ibEligible && !dayCap.lunchEligible, 'all off')
}

{
  // Session (day) cap = 3 overrides per-window caps even when a window still
  // has spare probes — e.g. 1 morning + 1 IB + 1 lunch = 3 fills total, but
  // IB and Lunch each only used 1/2. Every window must still lock.
  const sessionCap = attemptLadderFromCounts({
    morningAttempts: 1,
    ibAttempts: 1,
    lunchAttempts: 1,
  })
  assert(sessionCap.dayAttempts === 3, 'session total = 3')
  assert(sessionCap.dayLocked, 'session cap (3) hit → day locked even with spare window probes')
  assert(
    !sessionCap.morningEligible && !sessionCap.ibEligible && !sessionCap.lunchEligible,
    'session cap overrides per-window caps (IB 1/2, Lunch 1/2 both still show spare probes)'
  )
}

{
  // Just under the session cap: 1 fill total (IB), IB window has 1/2 used
  // → IB should remain eligible (session cap not yet hit at 1/3).
  const underCap = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 1,
  })
  assert(underCap.dayAttempts === 1, 'session total = 1, under cap')
  assert(!underCap.dayLocked, 'session cap not yet hit at 1/3')
  assert(underCap.ibEligible, 'IB still eligible with 1/2 used and session 1/3')
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

{
  // Nikkei US Range bills to the ib storage bucket (slot 2)
  assert(bucketForRangeLabel('NIKKEI', 'US Range') === 'ib', 'US Range → ib bucket on NIKKEI')
  assert(bucketForRangeLabel('DOW', 'US Range') === null, 'US Range not a NY bucket label')
  const ladder = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 0,
    now: new Date(Date.UTC(2026, 6, 30, 0, 35, 0)),
    instrument: 'NIKKEI',
  })
  const tokyoOpen = new Date(Date.UTC(2026, 6, 30, 0, 35, 0)) // 09:35 JST
  const check = assertBucketEntryEligible({
    instrument: 'NIKKEI',
    market: 'TOKYO',
    timeSec: deskClockSeconds('NIKKEI', tokyoOpen),
    ladder,
    rangeLabel: 'US Range',
  })
  assert(check.ok, `US Range mid-window eligible: ${!check.ok ? check.message : ''}`)
}

{
  // Tokyo IB used=0 before first-hour lock — unlock copy (Montreal), NOT "probes used (0/2)"
  const duringUs = new Date(Date.UTC(2026, 6, 30, 0, 30, 0)) // 09:30 JST / 20:30 Montreal
  const ladder = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 0,
    lunchAttempts: 0,
    now: duringUs,
    instrument: 'NIKKEI',
  })
  assert(!ladder.lunchEligible, 'Tokyo IB not unlocked before first-hour lock')
  const denied = assertBucketEntryEligible({
    instrument: 'NIKKEI',
    market: 'TOKYO',
    timeSec: deskClockSeconds('NIKKEI', duringUs),
    ladder,
    rangeLabel: 'Tokyo IB',
  })
  assert(!denied.ok, 'Tokyo IB blocked before first-hour lock')
  if (!denied.ok) {
    assert(
      !/probes used \(0\/2\)/i.test(denied.message),
      `must not say probes used 0/2, got: ${denied.message}`
    )
    assert(
      /21:00–02:00 Montreal/i.test(denied.message),
      `must name Tokyo IB unlock in Montreal, got: ${denied.message}`
    )
    assert(!/\bJST\b/.test(denied.message), `must not show JST to trader, got: ${denied.message}`)
  }
}

{
  // After first-hour lock (10:19 JST / 21:19 Montreal) Tokyo IB is eligible with probes left
  const afterIbLock = new Date(Date.UTC(2026, 6, 30, 1, 19, 0)) // 10:19 JST
  const ladder = attemptLadderFromCounts({
    morningAttempts: 1,
    ibAttempts: 1,
    lunchAttempts: 0,
    now: afterIbLock,
    instrument: 'NIKKEI',
  })
  assert(ladder.lunchEligible, 'Tokyo IB unlocked at first-hour lock')
  const check = assertBucketEntryEligible({
    instrument: 'NIKKEI',
    market: 'TOKYO',
    timeSec: deskClockSeconds('NIKKEI', afterIbLock),
    ladder,
    rangeLabel: 'Tokyo IB',
  })
  assert(check.ok, `Tokyo IB eligible after lock: ${!check.ok ? check.message : ''}`)
}

{
  // Real exhaustion still says probes used (2/2)
  const duringIb = new Date(Date.UTC(2026, 6, 30, 5, 0, 0)) // 14:00 JST
  const exhausted = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 0,
    lunchAttempts: 2,
    now: duringIb,
    instrument: 'NIKKEI',
  })
  assert(!exhausted.dayLocked, 'session under day cap so bucket exhaustion copy can fire')
  const denied = assertBucketEntryEligible({
    instrument: 'NIKKEI',
    market: 'TOKYO',
    timeSec: deskClockSeconds('NIKKEI', duringIb),
    ladder: exhausted,
    rangeLabel: 'Tokyo IB',
  })
  assert(!denied.ok, 'exhausted Tokyo IB blocked')
  if (!denied.ok) {
    assert(
      /probes used \(2\/2\)/i.test(denied.message),
      `exhaustion copy, got: ${denied.message}`
    )
  }
}

{
  // Prefer stored range_bucket over clock during Tokyo US/IB overlap (10:00–10:45 JST).
  // 01:30 UTC = 10:30 JST — clock alone would bill as US (`ib`); DB lunch_range = Tokyo IB.
  const overlapTs = '2026-08-03T01:30:36.182Z'
  assert(
    classifyAttemptBucket('NIKKEI', overlapTs) === 'ib',
    'clock fallback at 10:30 JST → US (ib) during overlap'
  )
  const preferred = buildAttemptLadder(
    [
      {
        instrument: 'NIKKEI',
        entryTimestamp: overlapTs,
        exitReason: 'stop_hit',
        rangeBucket: 'lunch_range',
      },
    ],
    'NIKKEI'
  )
  assert(preferred.lunchAttempts === 1, 'stored lunch_range → Tokyo IB slot')
  assert(preferred.ibAttempts === 0, 'stored lunch_range must not inflate US slot')
  assert(preferred.dayAttempts === 1, 'one fill still counts once toward session')
}

console.log('attempt_ladder: all passed')
