/**
 * SENTINEL — LIVE desk focus (one market / one instrument).
 * Simulation must remain unchanged (all three instruments always available).
 * Run: npx tsx __tests__/sentinel_live_focus.test.ts
 */

import {
  LIVE_FOCUS_LEAD_MINUTES,
  liveFocusMarket,
  liveVisibleInstruments,
  nextLiveDeskMarket,
  shouldRunLiveAiForInstrument,
  resolveSessionGate,
  instrumentsForDeskMarket,
} from '../lib/trading/sessionGate'

const TESTS_PASSED: string[] = []
const TESTS_FAILED: Array<{ name: string; error: string }> = []

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function test(name: string, fn: () => void) {
  try {
    fn()
    TESTS_PASSED.push(name)
    console.log(`✅ PASS: ${name}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    TESTS_FAILED.push({ name, error: errorMsg })
    console.log(`❌ FAIL: ${name}`)
    console.log(`   ${errorMsg}`)
  }
}

function etDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h + 4, min, 0))
}

function jstDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 9, min, 0))
}

const Y = 2026
const M = 7
const D = 15 // Wednesday

assert(LIVE_FOCUS_LEAD_MINUTES === 30, 'lead is 30 minutes')

// ── Session market focus ─────────────────────────────────────────────────────

test('NY morning: focus NY — DOW+NASDAQ visible, NIKKEI hidden', () => {
  const now = etDate(Y, M, D, 9, 45)
  assert(liveFocusMarket(now) === 'NY', 'focus NY')
  const vis = liveVisibleInstruments(now)
  assert(vis.includes('DOW') && vis.includes('NASDAQ'), 'US names')
  assert(!vis.includes('NIKKEI'), 'no NIKKEI in NY session')
  assert(JSON.stringify(vis) === JSON.stringify(instrumentsForDeskMarket('NY')), 'market list')
})

test('NY afternoon stream: still NY focus — NIKKEI hidden', () => {
  const now = etDate(Y, M, D, 14, 0)
  assert(liveFocusMarket(now) === 'NY', 'afternoon NY')
  assert(!liveVisibleInstruments(now).includes('NIKKEI'), 'no NIKKEI PM')
})

test('After NY cash close: NY names only — never NIKKEI', () => {
  // 16:30 ET — past NY cash close 16:00; overnight is not a Tokyo live desk
  const now = etDate(Y, M, D, 16, 30)
  const vis = liveVisibleInstruments(now, {
    lockedInstrument: 'DOW',
    clockedIn: false,
    attendedToday: true,
  })
  assert(vis.includes('DOW'), `DOW lock held got ${vis}`)
  assert(!vis.includes('NIKKEI'), `no live NIKKEI got ${vis}`)
  const gate = resolveSessionGate({
    now,
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: false,
    attendedToday: true,
    attemptsUsed: 1,
    stopLossHitCount: 0,
  })
  assert(gate.lockedInstrument === null, 'lock cleared after cash close')
  assert(gate.market === 'NY', 'live overnight stays NY')
  assert(!gate.allowedInstruments.includes('NIKKEI'), 'gate never allows live NIKKEI')
  assert(gate.allowedInstruments.includes('DOW') && gate.allowedInstruments.includes('NASDAQ'), 'NY names')
})

test('After NY close: live desk stays NY — no Tokyo browse tabs', () => {
  const now = etDate(Y, M, D, 17, 0)
  assert(liveFocusMarket(now) === 'NY', 'stays NY after close')
  const vis = liveVisibleInstruments(now)
  assert(!vis.includes('NIKKEI'), 'no NIKKEI overnight')
  assert(vis.includes('DOW') && vis.includes('NASDAQ'), 'NY names')
})

test('Tokyo hours: live tabs stay NY — never NIKKEI', () => {
  const before = jstDate(Y, M, D, 8, 29)
  assert(liveFocusMarket(before) === 'NY', 'pre-Tokyo still NY live')
  assert(!liveVisibleInstruments(before).includes('NIKKEI'), 'no NIKKEI before Tokyo')

  const atLead = jstDate(Y, M, D, 8, 30)
  assert(liveFocusMarket(atLead) === 'NY', 'live focus stays NY at Tokyo −30m')
  assert(!liveVisibleInstruments(atLead).includes('NIKKEI'), 'no live NIKKEI at 8:30 JST')
  assert(liveVisibleInstruments(atLead).includes('DOW'), 'NY names at Tokyo −30m')
})

test('Tokyo morning: live still NY names, never NIKKEI', () => {
  const now = jstDate(Y, M, D, 9, 30)
  assert(liveFocusMarket(now) === 'NY', 'live focus NY during Tokyo hours')
  const vis = liveVisibleInstruments(now)
  assert(!vis.includes('NIKKEI'), `no NIKKEI got ${vis}`)
  assert(vis.includes('DOW') && vis.includes('NASDAQ'), 'NY names')
})

test('Tokyo afternoon: live still NY names, never NIKKEI', () => {
  const now = jstDate(Y, M, D, 13, 0)
  assert(liveFocusMarket(now) === 'NY', 'live stays NY')
  assert(!liveVisibleInstruments(now).includes('NIKKEI'), 'no NIKKEI')
})

test('DOW locked: only DOW tab (no twin glance)', () => {
  const now = etDate(Y, M, D, 10, 0)
  const vis = liveVisibleInstruments(now, {
    lockedInstrument: 'DOW',
    clockedIn: false,
    attendedToday: false,
  })
  assert(JSON.stringify(vis) === JSON.stringify(['DOW']), `got ${vis}`)
})

test('Clocked into DOW: only DOW tab', () => {
  const now = etDate(Y, M, D, 10, 0)
  const vis = liveVisibleInstruments(now, {
    lockedInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
  })
  assert(JSON.stringify(vis) === JSON.stringify(['DOW']), `got ${vis}`)
})

test('Attended NASDAQ after lunch: only NASDAQ tab', () => {
  const now = etDate(Y, M, D, 14, 0)
  const vis = liveVisibleInstruments(now, {
    lockedInstrument: 'NASDAQ',
    clockedIn: false,
    attendedToday: true,
  })
  assert(JSON.stringify(vis) === JSON.stringify(['NASDAQ']), `got ${vis}`)
})

test('Persisted NIKKEI lock ignored on live — NY names, not Tokyo', () => {
  const now = jstDate(Y, M, D, 10, 0)
  const vis = liveVisibleInstruments(now, {
    lockedInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
  })
  assert(!vis.includes('NIKKEI'), `ignored NIKKEI lock got ${vis}`)
  assert(vis.includes('DOW') && vis.includes('NASDAQ'), 'falls back to NY names')

  const gate = resolveSessionGate({
    now,
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
  })
  assert(gate.market === 'NY', 'live viewing NIKKEI snaps to NY')
  assert(gate.lockedInstrument !== 'NIKKEI', 'NIKKEI lock dropped')
  assert(!gate.allowedInstruments.includes('NIKKEI'), 'NIKKEI not allowed')
  assert(gate.allowedInstruments.includes('DOW'), 'DOW allowed')
  assert(!/Tokyo IB|wait for Tokyo/i.test(gate.message), gate.message)
})

// ── AI token gate ────────────────────────────────────────────────────────────

test('AI: skip NIKKEI during NY session', () => {
  const now = etDate(Y, M, D, 10, 0)
  const r = shouldRunLiveAiForInstrument('NIKKEI', now)
  assert(!r.ok, r.reason)
})

test('AI: skip NASDAQ when DOW locked', () => {
  const now = etDate(Y, M, D, 10, 0)
  const r = shouldRunLiveAiForInstrument('NASDAQ', now, {
    lockedInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
  })
  assert(!r.ok && /DOW/i.test(r.reason), r.reason)
})

test('AI: allow DOW when clocked into DOW', () => {
  const now = etDate(Y, M, D, 10, 0)
  const r = shouldRunLiveAiForInstrument('DOW', now, {
    lockedInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
  })
  assert(r.ok, r.reason)
})

test('NY 09:00 dual browse: both DOW+NASDAQ, no hard lock, chart viewable', () => {
  const now = etDate(Y, M, D, 9, 0)
  assert(liveFocusMarket(now) === 'NY', 'focus NY at 9:00')
  const vis = liveVisibleInstruments(now)
  assert(vis.includes('DOW') && vis.includes('NASDAQ'), 'both visible')
  const gate = resolveSessionGate({
    now,
    lockedInstrument: null,
    suggestedInstrument: null,
    clockedIn: false,
    attendedToday: false,
    attemptsUsed: 0,
    stopLossHitCount: 0,
  })
  assert(gate.lockedInstrument === null, 'no hard lock before clock-in')
  assert(gate.canViewLiveChart === true, 'pre-open dual browse chart')
  assert(gate.phase === 'PREP', `phase PREP got ${gate.phase}`)
  assert(gate.canClockIn === false, 'clock-in opens at 9:15')
  assert(/browse DOW and NASDAQ/i.test(gate.message), gate.message)
})

test('NY 09:15: AI suggest soft — both tabs stay, clock-in open', () => {
  const now = etDate(Y, M, D, 9, 15)
  const gate = resolveSessionGate({
    now,
    lockedInstrument: null,
    suggestedInstrument: 'NASDAQ',
    clockedIn: false,
    attendedToday: false,
    attemptsUsed: 0,
    stopLossHitCount: 0,
  })
  assert(gate.lockedInstrument === null, 'suggest is not a hard lock')
  assert(gate.suggestedInstrument === 'NASDAQ', 'suggested NASDAQ')
  assert(
    gate.allowedInstruments.includes('DOW') && gate.allowedInstruments.includes('NASDAQ'),
    'both still allowed'
  )
  assert(gate.canViewLiveChart === true, 'still browsing pre-open')
  assert(gate.canClockIn === true, 'clock-in window open')
  assert(gate.phase === 'RECOMMENDED', `phase RECOMMENDED got ${gate.phase}`)
  assert(/NASDAQ/i.test(gate.message), gate.message)
})

test('NY 09:20 clock-in is one name; tickets stay on committed name', () => {
  const now = etDate(Y, M, D, 9, 20)
  const gate = resolveSessionGate({
    now,
    lockedInstrument: 'DOW',
    suggestedInstrument: 'NASDAQ',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
    viewingInstrument: 'DOW',
  })
  assert(gate.lockedInstrument === 'DOW', 'hard lock DOW')
  assert(
    JSON.stringify(gate.allowedInstruments) === JSON.stringify(['DOW']),
    'one door'
  )
  assert(gate.canViewLiveChart === true, 'clocked chart on')
  assert(gate.glanceOnly === false, 'on clocked name')
})

test('AI: skip live NIKKEI even during Tokyo focus', () => {
  const now = jstDate(Y, M, D, 8, 50)
  const r = shouldRunLiveAiForInstrument('NIKKEI', now, {
    lockedInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
  })
  assert(!r.ok, r.reason)
})

test('AI: skip without clock-in even in focus', () => {
  const now = etDate(Y, M, D, 10, 0)
  const r = shouldRunLiveAiForInstrument('DOW', now)
  assert(!r.ok && /clock in/i.test(r.reason), r.reason)
})

test('AI: skip DOW/NASDAQ overnight (Tokyo hours are not a live session)', () => {
  const now = jstDate(Y, M, D, 9, 30)
  assert(
    !shouldRunLiveAiForInstrument('DOW', now, { clockedIn: true, attendedToday: true }).ok,
    'skip DOW between NY sessions'
  )
  assert(
    !shouldRunLiveAiForInstrument('NASDAQ', now, { clockedIn: true, attendedToday: true }).ok,
    'skip NASDAQ between NY sessions'
  )
  assert(
    !shouldRunLiveAiForInstrument('NIKKEI', now, { clockedIn: true, attendedToday: true }).ok,
    'never live NIKKEI AI'
  )
})

test('nextLiveDeskMarket is always NY', () => {
  const m = nextLiveDeskMarket(etDate(Y, M, D, 17, 0))
  assert(m === 'NY', `got ${m}`)
  assert(nextLiveDeskMarket(jstDate(Y, M, D, 9, 0)) === 'NY', 'Tokyo hours still next NY')
})

console.log('')
console.log(`sentinel_live_focus: ${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length) {
  for (const f of TESTS_FAILED) console.error(`  · ${f.name}: ${f.error}`)
  process.exit(1)
}
console.log('sentinel_live_focus: all passed')
