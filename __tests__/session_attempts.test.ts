/**
 * Attempts = filled trades (max 1 morning). Working limits do not count.
 * Exit via stop OR take-profit still used that attempt.
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

assert(MAX_SESSION_ATTEMPTS === 1, 'max attempts must be 1')
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
  const morning = new Date('2026-07-14T14:00:00.000Z') // 10:00 ET
  const gate = resolveSimMorningGate({
    now: morning,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 1,
    stopHits: 0,
  })
  assert(gate.phase === 'DONE', `expected DONE after 1 attempt, got ${gate.phase}`)
  assert(gate.canPlaceEntry === false, 'cannot place after 1 attempt')
  assert(gate.revengeLocked === false, 'revenge always false')
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
  // After morning entryClose — no IB in sim (NY)
  const afterEntry = new Date('2026-07-14T14:20:00.000Z') // 10:20 ET
  const gate = resolveSimMorningGate({
    now: afterEntry,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(gate.phase === 'FLAT', `expected FLAT after entryClose, got ${gate.phase}`)
  assert(gate.canPlaceEntry === false, 'no IB unlock on sim')
  assert(!!gate.message?.includes('no IB'), 'message explains no IB in sim')
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
  // Nikkei after 09:45 — no IB window in sim (live would unlock IB at 10:15)
  const nikkeiFlat = new Date('2026-07-14T01:00:00.000Z') // 10:00 JST
  const gate = resolveSimMorningGate({
    now: nikkeiFlat,
    instrument: 'NIKKEI',
    hasOpenPosition: false,
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(gate.phase === 'FLAT', `Nikkei FLAT after morning entry, got ${gate.phase}`)
  assert(gate.canPlaceEntry === false, 'Nikkei sim has no IB')
}

console.log('session_attempts: ok')
