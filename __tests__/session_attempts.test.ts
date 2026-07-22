/**
 * Attempts = stop-outs only (max 2). Fills / TP do not burn an attempt.
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
  const fresh = evaluateSessionAttempts({ stopHits: 0 })
  assert(!fresh.entriesLocked, 'fresh session should allow entries')
  assert(!fresh.sessionDone, 'fresh session not done')
  assert(fresh.attemptsUsed === 0, 'attempts start at 0')
}

{
  // Two fills with zero stops must NOT lock the book
  const twoFillsNoStops = evaluateSessionAttempts({
    attemptsUsed: 2,
    stopHits: 0,
    hasOpenPosition: false,
  })
  assert(!twoFillsNoStops.sessionDone, 'fills alone do not finish the session')
  assert(!twoFillsNoStops.entriesLocked, 'fills alone do not lock entries')
  assert(twoFillsNoStops.attemptsUsed === 0, 'attempts = stopHits, not fill count')
}

{
  const afterOneStop = evaluateSessionAttempts({ stopHits: 1 })
  assert(!afterOneStop.sessionDone, 'one stop still allows a second attempt')
  assert(!afterOneStop.entriesLocked, 'one stop — can place again when flat')
  assert(afterOneStop.attemptsUsed === 1, 'one stop = one attempt')
}

{
  const twoStops = evaluateSessionAttempts({ stopHits: 2 })
  assert(twoStops.sessionDone, 'two stops locks the session')
  assert(twoStops.entriesLocked, 'two stops blocks entries')
  assert(twoStops.attemptsUsed === 2, 'two stops = two attempts')
  assert(!!twoStops.lockReason?.includes('Stopped out'), 'lock reason mentions stops')
}

{
  const openPos = evaluateSessionAttempts({
    stopHits: 0,
    hasOpenPosition: true,
  })
  assert(!openPos.sessionDone, 'open position is manage, not done')
  assert(openPos.entriesLocked, 'cannot place while open')
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
    attemptsUsed: 5,
    stopHits: 1,
  })
  assert(gate.phase === 'ENTRY', `expected ENTRY after one stop, got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'second attempt allowed after one stop')
  assert(gate.attemptsUsed === 1, 'attempts follow stopHits, ignore fill count')
}

console.log('session_attempts: ok')
