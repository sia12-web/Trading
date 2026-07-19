/**
 * Max 2 attempts / 2 stop-outs — live and sim share evaluateSessionAttempts.
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
  const afterOneStop = evaluateSessionAttempts({ attemptsUsed: 1, stopHits: 1 })
  assert(!afterOneStop.sessionDone, 'one stop still allows a second attempt')
  assert(!afterOneStop.entriesLocked, 'one stop — can place again when flat')
}

{
  const twoStops = evaluateSessionAttempts({ attemptsUsed: 2, stopHits: 2 })
  assert(twoStops.sessionDone, 'two stops locks the session')
  assert(twoStops.entriesLocked, 'two stops blocks entries')
  assert(!!twoStops.lockReason?.includes('Stopped out'), 'lock reason mentions stops')
}

{
  const twoAttemptsFlat = evaluateSessionAttempts({
    attemptsUsed: 2,
    stopHits: 0,
    hasOpenPosition: false,
  })
  assert(twoAttemptsFlat.sessionDone, 'two attempts used → session done when flat')
}

{
  const secondOpen = evaluateSessionAttempts({
    attemptsUsed: 2,
    stopHits: 1,
    hasOpenPosition: true,
  })
  assert(!secondOpen.sessionDone, 'second attempt still open — manage, not done yet')
  assert(secondOpen.entriesLocked, 'cannot place while open')
}

{
  // Cash-open Monday-ish NY: use a fixed morning stamp
  const morning = new Date('2026-07-14T14:00:00.000Z') // 10:00 ET
  const gate = resolveSimMorningGate({
    now: morning,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 2,
    stopHits: 2,
  })
  assert(gate.phase === 'DONE', `expected DONE after 2 stops, got ${gate.phase}`)
  assert(gate.canPlaceEntry === false, 'cannot place after 2 stops')
  assert(gate.attemptsUsed === 2 && gate.stopHits === 2, 'book echoed on gate')
}

{
  const morning = new Date('2026-07-14T14:00:00.000Z')
  const gate = resolveSimMorningGate({
    now: morning,
    instrument: 'NASDAQ',
    hasOpenPosition: false,
    attemptsUsed: 1,
    stopHits: 1,
  })
  assert(gate.phase === 'ENTRY', `expected ENTRY for second attempt, got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'second attempt allowed after one stop')
}

console.log('session_attempts: ok')
