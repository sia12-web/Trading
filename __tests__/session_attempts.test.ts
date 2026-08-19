/**
 * Morning book (evaluateSessionAttempts) + full-day SIM gate (2/2/2).
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

assert(MAX_SESSION_ATTEMPTS === 2, 'max morning attempts must be 2')
assert(MAX_STOP_HITS === 2, 'max stops must be 2')

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
  // One fill closed via TP — morning still has probes left (Option B)
  const afterTp = evaluateSessionAttempts({
    attemptsUsed: 1,
    stopHits: 0,
    hasOpenPosition: false,
  })
  assert(!afterTp.entriesLocked, 'after 1 TP — morning still open')
  assert(!afterTp.sessionDone, 'morning probes remain')
}

{
  // Two fills / two stops — morning book full
  const afterSl = evaluateSessionAttempts({
    attemptsUsed: 2,
    stopHits: 2,
    hasOpenPosition: false,
  })
  assert(afterSl.entriesLocked, 'after two stops — morning locked')
  assert(afterSl.sessionDone, 'morning attempts used')
  assert(!!afterSl.lockReason?.includes('Morning'), 'lock reason mentions morning')
}

{
  // One morning probe during OR30 → ENTRY still open (Option B)
  const morning = new Date('2026-07-14T14:00:00.000Z') // 10:00 ET
  const gate = resolveSimMorningGate({
    now: morning,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 1,
    stopHits: 0,
  })
  assert(gate.phase === 'ENTRY', `expected ENTRY (window open), got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'can place after 1 morning probe')
  assert(gate.morningAttempts === 1, 'morningAttempts counted')
}

{
  // After morning entryClose — IB unlocks only once first-hour IB locks (10:30)
  const beforeIbLock = new Date('2026-07-14T14:20:00.000Z') // 10:20 ET
  const waiting = resolveSimMorningGate({
    now: beforeIbLock,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    morningAttempts: 1,
    stopHits: 0,
  })
  assert(waiting.canPlaceEntry === true, 'OR30 entry at 10:20 after morning probe')
  assert(waiting.rangeStrategy === 'or30', 'OR30 strategy at 10:20')

  const afterIbLock = new Date('2026-07-14T14:35:00.000Z') // 10:35 ET
  const unlocked = resolveSimMorningGate({
    now: afterIbLock,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    morningAttempts: 1,
    stopHits: 0,
  })
  assert(unlocked.phase === 'ENTRY', `expected IB ENTRY after IB lock, got ${unlocked.phase}`)
  assert(unlocked.canPlaceEntry === true, 'IB open after morning probe + IB lock')
  assert(unlocked.rangeStrategy === 'ib', 'IB strategy')
}

{
  // Open range forming — no morning entry yet
  const forming = new Date('2026-07-14T13:40:00.000Z') // 09:40 ET
  const gate = resolveSimMorningGate({
    now: forming,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(gate.canPlaceEntry === false, 'Open range forming blocks morning entry')
  assert(/Open range forming/i.test(gate.message), gate.message)
}

{
  const morning = new Date('2026-07-14T13:50:00.000Z') // 09:50 ET — Open range lock
  const gate = resolveSimMorningGate({
    now: morning,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(gate.phase === 'ENTRY', `expected ENTRY fresh, got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'fresh morning can place after Open range lock')
}

{
  // After morning entryClose — IB unlock when morning skipped (NY) at 10:30+
  const afterEntry = new Date('2026-07-14T14:35:00.000Z') // 10:35 ET
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
  // Nikkei morning entry after OR30 lock (09:30–09:45 JST)
  const nikkeiMorning = new Date('2026-07-14T00:35:00.000Z') // 09:35 JST
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
  // Nikkei US Range from cash open when morning skipped / OR30 still forming
  const nikkeiUs = new Date('2026-07-14T00:20:00.000Z') // 09:20 JST
  const gate = resolveSimMorningGate({
    now: nikkeiUs,
    instrument: 'NIKKEI',
    hasOpenPosition: false,
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(gate.phase === 'ENTRY', `Nikkei Open range ENTRY at 09:20, got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'Nikkei Open range unlock after 15m lock')
  assert(gate.rangeStrategy == null, 'Open range — no slot-2 strategy at 09:20')
}

{
  // Nikkei US Range still open 10:20 JST
  const nikkeiUsLate = new Date('2026-07-14T01:20:00.000Z') // 10:20 JST
  const gate = resolveSimMorningGate({
    now: nikkeiUsLate,
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
  assert(gate.rangeStrategy === 'ib', 'lunch_range strategy')
}

console.log('session_attempts: ok')
