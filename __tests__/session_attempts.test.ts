/**
 * Attempts = filled trades (max 2). Working limits do not count.
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

assert(MAX_SESSION_ATTEMPTS === 2, 'max attempts must be 2')
assert(MAX_STOP_HITS === 2, 'max stops must be 2')

{
  const fresh = evaluateSessionAttempts({ attemptsUsed: 0, stopHits: 0 })
  assert(!fresh.entriesLocked, 'fresh session should allow entries')
  assert(!fresh.sessionDone, 'fresh session not done')
}

{
  // Working limit / no fills — still open
  const noFills = evaluateSessionAttempts({ attemptsUsed: 0, stopHits: 0 })
  assert(!noFills.entriesLocked, 'no fills → can place')
}

{
  // One fill open = in a trade (manage only)
  const inTrade = evaluateSessionAttempts({
    attemptsUsed: 1,
    stopHits: 0,
    hasOpenPosition: true,
  })
  assert(inTrade.entriesLocked, 'in a trade — no new entry')
  assert(!inTrade.sessionDone, 'still managing — not session done')
}

{
  // One fill closed via TP — attempt used, can take second
  const afterTp = evaluateSessionAttempts({
    attemptsUsed: 1,
    stopHits: 0,
    hasOpenPosition: false,
  })
  assert(!afterTp.entriesLocked, 'after TP — second attempt allowed')
  assert(!afterTp.sessionDone, 'one attempt left')
}

{
  // One fill closed via SL — attempt used, can take second
  const afterSl = evaluateSessionAttempts({
    attemptsUsed: 1,
    stopHits: 1,
    hasOpenPosition: false,
  })
  assert(!afterSl.entriesLocked, 'after one stop — second attempt allowed')
  assert(!afterSl.sessionDone, 'one attempt left')
}

{
  const twoAttemptsFlat = evaluateSessionAttempts({
    attemptsUsed: 2,
    stopHits: 0,
    hasOpenPosition: false,
  })
  assert(twoAttemptsFlat.sessionDone, 'two fills (e.g. two TPs) → session done')
  assert(twoAttemptsFlat.entriesLocked, 'two fills blocks entries')
}

{
  const twoStops = evaluateSessionAttempts({ attemptsUsed: 2, stopHits: 2 })
  assert(twoStops.sessionDone, 'two stops locks the session')
  assert(twoStops.entriesLocked, 'two stops blocks entries')
  assert(!!twoStops.lockReason?.includes('Stopped out'), 'lock reason mentions stops')
}

{
  const morning = new Date('2026-07-14T14:00:00.000Z') // 10:00 ET
  const gate = resolveSimMorningGate({
    now: morning,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 2,
    stopHits: 2,
  })
  assert(gate.phase === 'DONE', `expected DONE after 2 attempts, got ${gate.phase}`)
  assert(gate.canPlaceEntry === false, 'cannot place after 2 attempts')
}

{
  const morning = new Date('2026-07-14T14:00:00.000Z')
  const gate = resolveSimMorningGate({
    now: morning,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 1,
    stopHits: 0,
  })
  assert(gate.phase === 'ENTRY', `expected ENTRY for second attempt, got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'second attempt after one TP/fill')
}

console.log('session_attempts: ok')
