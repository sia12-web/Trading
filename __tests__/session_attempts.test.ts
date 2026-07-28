/**
 * Morning book (evaluateSessionAttempts) + full-day SIM gate (1/1/1).
 * Run: npx tsx __tests__/session_attempts.test.ts
 */

import {
  MAX_SESSION_ATTEMPTS,
  MAX_STOP_HITS,
  evaluateSessionAttempts,
  resolveSimMorningGate,
} from '../lib/trading/sessionGate'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(MAX_SESSION_ATTEMPTS === 1, 'max morning attempts must be 1')
assert(MAX_STOP_HITS === 1, 'max stops must be 1')

{
  const fresh = evaluateSessionAttempts({ attemptsUsed: 0, stopHits: 0 })
  assert(!fresh.entriesLocked, 'fresh session should allow entries')
  assert(!fresh.sessionDone, 'fresh session not done')
}

{
  const noFills = evaluateSessionAttempts({ attemptsUsed: 0, stopHits: 0 })
  assert(!noFills.entriesLocked, 'no fills → can place')
}

{
  const inTrade = evaluateSessionAttempts({
    attemptsUsed: 1,
    stopHits: 0,
    hasOpenPosition: true,
  })
  assert(inTrade.entriesLocked, 'in a trade — no new entry')
  assert(!inTrade.sessionDone, 'still managing — not session done')
}

{
  // One fill closed via TP — morning done
  const afterTp = evaluateSessionAttempts({
    attemptsUsed: 1,
    stopHits: 0,
    hasOpenPosition: false,
  })
  assert(afterTp.entriesLocked, 'after TP — morning locked')
  assert(afterTp.sessionDone, 'morning attempt used')
}

{
  // One fill closed via SL — morning done
  const afterSl = evaluateSessionAttempts({
    attemptsUsed: 1,
    stopHits: 1,
    hasOpenPosition: false,
  })
  assert(afterSl.entriesLocked, 'after one stop — morning locked')
  assert(afterSl.sessionDone, 'morning attempt used')
  assert(!!afterSl.lockReason?.includes('Morning'), 'lock reason mentions morning')
}

{
  // Morning fill used during OR30 window → ENTRY but locked
  const morning = new Date('2026-07-14T14:00:00.000Z') // 10:00 ET
  const gate = resolveSimMorningGate({
    now: morning,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 1,
    stopHits: 0,
  })
  assert(gate.phase === 'ENTRY', `expected ENTRY (window open), got ${gate.phase}`)
  assert(gate.canPlaceEntry === false, 'cannot place after morning fill')
  assert(gate.morningAttempts === 1, 'morningAttempts counted')
}

{
  // After morning entryClose with morning fill → later windows locked (FLAT)
  const afterEntry = new Date('2026-07-14T14:20:00.000Z') // 10:20 ET
  const locked = resolveSimMorningGate({
    now: afterEntry,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    morningAttempts: 1,
    stopHits: 0,
  })
  assert(locked.phase === 'FLAT', `expected FLAT after morning fill past entryClose, got ${locked.phase}`)
  assert(locked.canPlaceEntry === false, 'IB locked after morning fill')
}

{
  const morning = new Date('2026-07-14T14:00:00.000Z')
  const gate = resolveSimMorningGate({
    now: morning,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(gate.phase === 'ENTRY', `expected ENTRY fresh, got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'fresh morning can place')
}

{
  // After morning entryClose — IB unlock when morning skipped (NY)
  const afterEntry = new Date('2026-07-14T14:20:00.000Z') // 10:20 ET
  const gate = resolveSimMorningGate({
    now: afterEntry,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(gate.phase === 'ENTRY', `expected IB ENTRY, got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'IB unlock on sim when morning skipped')
  assert(gate.rangeStrategy === 'ib', 'IB range strategy')
}

{
  // Nikkei morning entry window (09:00–09:45 JST)
  const nikkeiMorning = new Date('2026-07-14T00:15:00.000Z') // 09:15 JST
  const gate = resolveSimMorningGate({
    now: nikkeiMorning,
    instrument: 'NIKKEI',
    hasOpenPosition: false,
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(gate.market === 'TOKYO', 'Nikkei uses Tokyo')
  assert(gate.phase === 'ENTRY', `Nikkei morning ENTRY, got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'Nikkei morning can place')
}

{
  // Nikkei US Range unlock 10:15–10:45 JST when morning skipped
  const nikkeiUs = new Date('2026-07-14T01:20:00.000Z') // 10:20 JST
  const gate = resolveSimMorningGate({
    now: nikkeiUs,
    instrument: 'NIKKEI',
    hasOpenPosition: false,
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(gate.phase === 'ENTRY', `Nikkei US Range ENTRY, got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'Nikkei US Range unlock')
  assert(gate.rangeStrategy === 'us_range', 'US range strategy')
}

{
  // NY lunch-range 13:30–15:15 ET when morning + IB skipped
  const lunch = new Date('2026-07-14T18:00:00.000Z') // 14:00 ET
  const gate = resolveSimMorningGate({
    now: lunch,
    instrument: 'DOW',
    hasOpenPosition: false,
    morningAttempts: 0,
    ibAttempts: 0,
    lunchAttempts: 0,
    stopHits: 0,
  })
  assert(gate.phase === 'ENTRY', `lunch-range ENTRY, got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'lunch-range unlock')
  assert(gate.rangeStrategy === 'lunch_range', 'lunch_range strategy')
}

console.log('session_attempts: ok')
