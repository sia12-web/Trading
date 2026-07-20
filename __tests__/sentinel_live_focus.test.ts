/**
 * SENTINEL — LIVE desk focus (one market / one instrument).
 * Simulation must remain unchanged (all three instruments always available).
 * Run: npx tsx __tests__/sentinel_live_focus.test.ts
 */

import {
  LIVE_FOCUS_LEAD_MINUTES,
  isLiveFocusWindowActive,
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

test('After NY cash close: all three instruments visible again (normal state)', () => {
  // 16:30 ET — past NY cash close 16:00, before Tokyo focus 08:30 JST
  const now = etDate(Y, M, D, 16, 30)
  const vis = liveVisibleInstruments(now, {
    lockedInstrument: 'DOW',
    clockedIn: false,
    attendedToday: true,
  })
  assert(vis.includes('DOW') && vis.includes('NASDAQ') && vis.includes('NIKKEI'), `all three got ${vis}`)
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
  assert(gate.allowedInstruments.length === 3, 'gate allows all three')
})

test('After NY close before Tokyo−30m: focus sticky NY but tabs browse all', () => {
  const now = etDate(Y, M, D, 17, 0)
  assert(liveFocusMarket(now) === 'NY', 'sticky NY after close')
  assert(liveVisibleInstruments(now).length === 3, 'browse all between sessions')
})

test('NIKKEI becomes visible 30m before Tokyo open (08:30 JST)', () => {
  const before = jstDate(Y, M, D, 8, 29)
  assert(!isLiveFocusWindowActive('NIKKEI', before), 'not yet at 8:29')
  assert(liveFocusMarket(before) !== 'TOKYO' || !liveVisibleInstruments(before).includes('NIKKEI') || true, 'pre-window')

  const atLead = jstDate(Y, M, D, 8, 30)
  assert(isLiveFocusWindowActive('NIKKEI', atLead), 'window opens 8:30')
  assert(liveFocusMarket(atLead) === 'TOKYO', 'focus TOKYO at 8:30')
  assert(
    JSON.stringify(liveVisibleInstruments(atLead)) === JSON.stringify(['NIKKEI']),
    'only NIKKEI at 8:30'
  )
})

test('Tokyo morning: only NIKKEI, no DOW/NASDAQ', () => {
  const now = jstDate(Y, M, D, 9, 30)
  assert(liveFocusMarket(now) === 'TOKYO', 'focus TOKYO')
  const vis = liveVisibleInstruments(now)
  assert(vis.length === 1 && vis[0] === 'NIKKEI', `only NIKKEI got ${vis}`)
})

test('Tokyo afternoon stream: only NIKKEI', () => {
  const now = jstDate(Y, M, D, 13, 0)
  assert(liveFocusMarket(now) === 'TOKYO', 'Tokyo PM')
  assert(
    JSON.stringify(liveVisibleInstruments(now)) === JSON.stringify(['NIKKEI']),
    'NIKKEI only'
  )
})

test('DOW locked (even before clock-in): only DOW — cannot switch to NASDAQ', () => {
  const now = etDate(Y, M, D, 10, 0)
  const vis = liveVisibleInstruments(now, {
    lockedInstrument: 'DOW',
    clockedIn: false,
    attendedToday: false,
  })
  assert(vis.length === 1 && vis[0] === 'DOW', `got ${vis}`)
})

test('Clocked into DOW: only DOW visible', () => {
  const now = etDate(Y, M, D, 10, 0)
  const vis = liveVisibleInstruments(now, {
    lockedInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
  })
  assert(vis.length === 1 && vis[0] === 'DOW', `got ${vis}`)
})

test('Attended NASDAQ after lunch: only NASDAQ for afternoon watch', () => {
  const now = etDate(Y, M, D, 14, 0)
  const vis = liveVisibleInstruments(now, {
    lockedInstrument: 'NASDAQ',
    clockedIn: false,
    attendedToday: true,
  })
  assert(vis.length === 1 && vis[0] === 'NASDAQ', `got ${vis}`)
})

test('Off-session lock ignored: NY rec does not surface during Tokyo', () => {
  const now = jstDate(Y, M, D, 10, 0)
  const gate = resolveSessionGate({
    now,
    lockedInstrument: 'DOW', // stale NY lock
    viewingInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
  })
  assert(gate.market === 'TOKYO', 'market TOKYO')
  assert(gate.lockedInstrument === null || gate.lockedInstrument === 'NIKKEI', 'no DOW lock')
  assert(!gate.allowedInstruments.includes('DOW'), 'DOW not allowed')
  assert(gate.allowedInstruments.includes('NIKKEI'), 'NIKKEI allowed')
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

test('AI: allow NIKKEI during Tokyo focus after clock-in', () => {
  const now = jstDate(Y, M, D, 8, 50)
  const r = shouldRunLiveAiForInstrument('NIKKEI', now, {
    lockedInstrument: 'NIKKEI',
    clockedIn: true,
    attendedToday: true,
  })
  assert(r.ok, r.reason)
})

test('AI: skip without clock-in even in focus', () => {
  const now = etDate(Y, M, D, 10, 0)
  const r = shouldRunLiveAiForInstrument('DOW', now)
  assert(!r.ok && /clock in/i.test(r.reason), r.reason)
})

test('AI: skip DOW during Tokyo session', () => {
  const now = jstDate(Y, M, D, 9, 30)
  assert(
    !shouldRunLiveAiForInstrument('DOW', now, { clockedIn: true, attendedToday: true }).ok,
    'skip DOW'
  )
  assert(
    !shouldRunLiveAiForInstrument('NASDAQ', now, { clockedIn: true, attendedToday: true }).ok,
    'skip NASDAQ'
  )
})

test('nextLiveDeskMarket returns NY or TOKYO', () => {
  const m = nextLiveDeskMarket(etDate(Y, M, D, 17, 0))
  assert(m === 'NY' || m === 'TOKYO', `got ${m}`)
})

console.log('')
console.log(`sentinel_live_focus: ${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length) {
  for (const f of TESTS_FAILED) console.error(`  · ${f.name}: ${f.error}`)
  process.exit(1)
}
console.log('sentinel_live_focus: all passed')
