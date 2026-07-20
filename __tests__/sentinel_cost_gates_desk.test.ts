/**
 * SENTINEL — cost gates, late clock-in, tip stream, AI attendance, peer tape, nav focus.
 * Run: npx tsx __tests__/sentinel_cost_gates_desk.test.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  canClockInNow,
  activeClockMarkets,
} from '../lib/trading/deskAttendance'
import {
  peerInstrumentFor,
  classifyPeerLean,
  formatPeerTapeForPrompt,
} from '../lib/trading/peerTapeBrief'
import {
  DEFAULT_LEVEL_FINDER_MODEL,
  llmLevelFinderModel,
  llmModel,
  parseLlmTier,
} from '../lib/llm/config'
import {
  isAnyLiveFocusWindowActive,
  isChartStreamAllowed,
  isLiveTipStreamAllowed,
  isLiveFocusWindowActive,
  isLevelPaintAllowed,
  isAfternoonWatchWindow,
  liveVisibleInstruments,
  resolveSessionGate,
  shouldRunLiveAiForInstrument,
  LIVE_FOCUS_LEAD_MINUTES,
} from '../lib/trading/sessionGate'

const TESTS_PASSED: string[] = []
const TESTS_FAILED: { name: string; error: string }[] = []

function test(name: string, fn: () => void) {
  try {
    fn()
    TESTS_PASSED.push(name)
    console.log(`✅ PASS: ${name}`)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    TESTS_FAILED.push({ name, error })
    console.log(`❌ FAIL: ${name} — ${error}`)
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

/** Wed 2026-07-15 — EDT = UTC-4 */
function etDate(h: number, m: number, day = 15) {
  return new Date(Date.UTC(2026, 6, day, h + 4, m, 0))
}

/** Wed 2026-07-15 — JST = UTC+9 */
function jstDate(h: number, m: number, day = 15) {
  return new Date(Date.UTC(2026, 6, day, h - 9, m, 0))
}

// ── Focus lead / tip stream cost gates ───────────────────────────────────────

test('LIVE_FOCUS_LEAD_MINUTES is 30', () => {
  assert(LIVE_FOCUS_LEAD_MINUTES === 30, `got ${LIVE_FOCUS_LEAD_MINUTES}`)
})

test('Tip frozen before NY focus (08:59 ET)', () => {
  const now = etDate(8, 59)
  assert(isLiveFocusWindowActive('DOW', now) === false, 'focus off')
  assert(isChartStreamAllowed('DOW', now).open === false, 'stream off')
  assert(isAnyLiveFocusWindowActive(now) === false, 'nav locked')
})

test('Tip opens at NY focus start (09:00 ET)', () => {
  const now = etDate(9, 0)
  assert(isLiveFocusWindowActive('DOW', now) === true, 'focus on')
  assert(isChartStreamAllowed('DOW', now).open === true, 'stream on')
  assert(isAnyLiveFocusWindowActive(now) === true, 'nav unlocked')
  assert(
    isLiveTipStreamAllowed('DOW', now, { attendedToday: false }).open === true,
    'pre-open tip without clock-in'
  )
})

test('Tokyo tip opens 08:30 JST, frozen at 08:29', () => {
  assert(isChartStreamAllowed('NIKKEI', jstDate(8, 29)).open === false, '08:29 off')
  assert(isChartStreamAllowed('NIKKEI', jstDate(8, 30)).open === true, '08:30 on')
})

test('After cash close tip frozen; nav locked', () => {
  const now = etDate(16, 30)
  assert(isChartStreamAllowed('DOW', now).open === false, 'stream frozen')
  assert(isAnyLiveFocusWindowActive(now) === false, 'nav locked after close')
})

test('Weekend: tip + nav off', () => {
  const sat = etDate(10, 0, 18) // Sat Jul 18
  assert(isChartStreamAllowed('DOW', sat).open === false, 'weekend stream')
  assert(isAnyLiveFocusWindowActive(sat) === false, 'weekend nav')
})

// ── Late clock-in / missed session ───────────────────────────────────────────

test('Clock-in open only in NY prep 09:15–09:30', () => {
  assert(canClockInNow('NY', etDate(9, 14)).ok === false, 'before prep')
  assert(canClockInNow('NY', etDate(9, 15)).ok === true, 'prep start')
  assert(canClockInNow('NY', etDate(9, 29)).ok === true, 'prep end')
  assert(canClockInNow('NY', etDate(9, 30)).ok === false, 'at open closed')
  assert(canClockInNow('NY', etDate(10, 15)).ok === false, 'mid session closed')
  assert(!activeClockMarkets(etDate(10, 0)).includes('NY'), 'not active after open')
  assert(activeClockMarkets(etDate(9, 20)).includes('NY'), 'active in prep')
})

test('Tokyo clock-in only 08:45–09:00 JST', () => {
  assert(canClockInNow('TOKYO', jstDate(8, 44)).ok === false, 'before prep')
  assert(canClockInNow('TOKYO', jstDate(8, 50)).ok === true, 'prep')
  assert(canClockInNow('TOKYO', jstDate(9, 0)).ok === false, 'at open')
  assert(canClockInNow('TOKYO', jstDate(10, 0)).ok === false, 'late')
})

test('Gate: late without clock-in → missed message, no AI path', () => {
  const gate = resolveSessionGate({
    now: etDate(10, 0),
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: false,
    attendedToday: false,
  })
  assert(gate.canClockIn === false, 'no late clock-in')
  assert(gate.canPlaceEntry === false, 'no entries')
  assert(gate.canManagePosition === false, 'no manage')
  assert(/missed|skipped/i.test(gate.message), gate.message)
  assert(
    isLiveTipStreamAllowed('DOW', etDate(10, 0), { attendedToday: false }).open ===
      false,
    'tip off when missed'
  )
})

test('Gate: clocked in before open → tip + entries in window', () => {
  const gate = resolveSessionGate({
    now: etDate(9, 45),
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
  })
  assert(gate.canPlaceEntry === true, 'can place in entry window')
  assert(
    isLiveTipStreamAllowed('DOW', etDate(9, 45), {
      clockedIn: true,
      attendedToday: true,
    }).open === true,
    'tip on when attended'
  )
})

test('Afternoon tip requires attendance; lunch watch alone not enough without attend', () => {
  const pm = etDate(14, 0)
  assert(isAfternoonWatchWindow(pm, 'DOW') === true, 'PM watch window')
  assert(
    isLiveTipStreamAllowed('DOW', pm, { attendedToday: false }).open === false,
    'no attend → tip off'
  )
  assert(
    isLiveTipStreamAllowed('DOW', pm, { attendedToday: true }).open === true,
    'attend → tip on'
  )
})

// ── AI clock-in hard gate ────────────────────────────────────────────────────

test('AI: rejected without clock-in even in focus', () => {
  const r = shouldRunLiveAiForInstrument('DOW', etDate(10, 0))
  assert(!r.ok && /clock in/i.test(r.reason), r.reason)
})

test('AI: allowed when clocked into locked DOW', () => {
  const r = shouldRunLiveAiForInstrument('DOW', etDate(10, 0), {
    lockedInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
  })
  assert(r.ok, r.reason)
})

test('AI: skip twin when locked to DOW', () => {
  const r = shouldRunLiveAiForInstrument('NASDAQ', etDate(10, 0), {
    lockedInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
  })
  assert(!r.ok, r.reason)
})

test('AI: skip NIKKEI during NY focus even if somehow clocked', () => {
  const r = shouldRunLiveAiForInstrument('NIKKEI', etDate(10, 0), {
    clockedIn: true,
    attendedToday: true,
  })
  assert(!r.ok, r.reason)
})

test('AI: attendedToday alone allows afternoon force path', () => {
  const r = shouldRunLiveAiForInstrument('DOW', etDate(14, 0), {
    lockedInstrument: 'DOW',
    clockedIn: false,
    attendedToday: true,
  })
  assert(r.ok, r.reason)
})

// ── Level paint vs stream ────────────────────────────────────────────────────

test('Level paint: not in pre-open before analyzeStart', () => {
  assert(isLevelPaintAllowed(etDate(9, 0), 'DOW').open === false, '09:00 no paint')
  assert(isLevelPaintAllowed(etDate(9, 20), 'DOW').open === true, '09:20 paint')
})

test('Level paint: afternoon yes, after close no; NIKKEI after NY close no', () => {
  assert(isLevelPaintAllowed(etDate(14, 0), 'DOW').open === true, 'PM paint')
  assert(isLevelPaintAllowed(etDate(16, 30), 'DOW').open === false, 'after close')
  assert(isLevelPaintAllowed(etDate(16, 30), 'NIKKEI').open === false, 'no NIKKEI paint')
})

// ── Peer tape ────────────────────────────────────────────────────────────────

test('Peer tape twins + lean classification', () => {
  assert(peerInstrumentFor('DOW') === 'NASDAQ', 'DOW→NASDAQ')
  assert(peerInstrumentFor('NASDAQ') === 'DOW', 'NASDAQ→DOW')
  assert(peerInstrumentFor('NIKKEI') === null, 'NIKKEI none')
  assert(classifyPeerLean(0.5, 0.4) === 'confirm_bull', 'bull')
  assert(classifyPeerLean(-0.5, -0.4) === 'confirm_bear', 'bear')
  assert(classifyPeerLean(0.5, -0.4) === 'diverge', 'diverge')
  assert(classifyPeerLean(0.05, -0.05) === 'neutral', 'noise')
  assert(classifyPeerLean(null, 0.5) === 'neutral', 'null primary')
  assert(formatPeerTapeForPrompt(null) === '', 'null format')
})

test('Peer tape prompt rules forbid foreign prices / S&P', () => {
  const src = readFileSync(
    join(__dirname, '../lib/trading/peerTapeBrief.ts'),
    'utf8'
  )
  assert(/Never paste/.test(src) || /MUST be/.test(src), 'must-stay-primary rule')
  assert(/No S&P|one twin/i.test(src), 'no S&P distraction')
  assert(/CONFIRM|DIVERGE/i.test(src), 'confirm/diverge language')
})

// ── Focus tabs / browse ──────────────────────────────────────────────────────

test('NY focus hides NIKKEI; after close all three', () => {
  const am = liveVisibleInstruments(etDate(10, 0))
  assert(am.includes('DOW') && am.includes('NASDAQ'), 'NY names')
  assert(!am.includes('NIKKEI'), 'NIKKEI hidden')
  const eve = liveVisibleInstruments(etDate(17, 0))
  assert(eve.length === 3, 'browse all after close')
})

test('Tokyo focus: NIKKEI only', () => {
  const v = liveVisibleInstruments(jstDate(10, 0))
  assert(v.length === 1 && v[0] === 'NIKKEI', `got ${v.join(',')}`)
})

test('Gate browse NIKKEI after NY close → Tokyo message not NY next-desk', () => {
  const gate = resolveSessionGate({
    now: etDate(17, 0),
    lockedInstrument: 'DOW',
    viewingInstrument: 'NIKKEI',
    clockedIn: false,
    attendedToday: true,
  })
  assert(gate.market === 'TOKYO', 'market TOKYO')
  assert(!/Next NY desk|9:15 ET/i.test(gate.message), gate.message)
  assert(/Tokyo|JST|NIKKEI|Pre-session/i.test(gate.message), gate.message)
})

// ── Level Finder model quality (not cut for cost) ────────────────────────────

test('Live Level Finder defaults to Opus 4.8; sim stays Haiku', () => {
  assert(DEFAULT_LEVEL_FINDER_MODEL === 'claude-opus-4-8', DEFAULT_LEVEL_FINDER_MODEL)
  assert(llmLevelFinderModel() === 'claude-opus-4-8', llmLevelFinderModel())
  assert(llmModel('proposer', 'live').includes('opus'), llmModel('proposer', 'live'))
  assert(llmModel('proposer', 'sim').includes('haiku'), llmModel('proposer', 'sim'))
  assert(parseLlmTier('sim') === 'sim', 'sim tier')
  assert(parseLlmTier('live') === 'live', 'live tier')
})

// ── Security: source contracts ───────────────────────────────────────────────

test('Security: quote + stream refuse outside focus + require auth', () => {
  const quoteSrc = readFileSync(
    join(__dirname, '../app/api/trading/quote/route.ts'),
    'utf8'
  )
  const streamSrc = readFileSync(
    join(__dirname, '../app/api/trading/quote/stream/route.ts'),
    'utf8'
  )
  assert(/getOrCreateUser/.test(quoteSrc), 'quote auth')
  assert(/Unauthorized/.test(quoteSrc), 'quote 401')
  assert(/isChartStreamAllowed/.test(quoteSrc), 'quote gated')
  assert(/frozen:\s*true/.test(quoteSrc), 'quote frozen flag')
  assert(/getOrCreateUser/.test(streamSrc), 'stream auth')
  assert(/isChartStreamAllowed/.test(streamSrc), 'stream gated')
  assert(/status:\s*403/.test(streamSrc), 'stream 403 outside window')
})

test('Security: find-levels requires attendance before AI (clock-in gate in route)', () => {
  const src = readFileSync(
    join(__dirname, '../app/api/agents/find-levels/route.ts'),
    'utf8'
  )
  assert(/shouldRunLiveAiForInstrument/.test(src), 'AI gate called')
  assert(/getTodayAttendance/.test(src), 'loads attendance')
  assert(/clockedIn/.test(src), 'passes clockedIn')
})

test('Security: clock-in API rejects when no prep window', () => {
  const src = readFileSync(
    join(__dirname, '../app/api/trading/clock-in/route.ts'),
    'utf8'
  )
  assert(/activeClockMarkets/.test(src), 'uses activeClockMarkets')
  assert(/skipped|prep only|cash open/i.test(src), 'late message in API')
})

test('Security: desk instruments reject garbage injection strings', () => {
  const { isLiveDeskInstrument } = require('../lib/trading/sessionGate') as {
    isLiveDeskInstrument: (s: string) => boolean
  }
  assert(!isLiveDeskInstrument("DOW'; DROP TABLE--"), 'sql-ish rejected')
  assert(!isLiveDeskInstrument('<script>'), 'xss rejected')
  assert(!isLiveDeskInstrument(''), 'empty rejected')
  assert(isLiveDeskInstrument('DOW'), 'DOW ok')
})

test('UX: chart page redirects off-focus; Sidebar locks Live Trading', () => {
  const chart = readFileSync(
    join(__dirname, '../app/dashboard/chart/page.tsx'),
    'utf8'
  )
  const side = readFileSync(join(__dirname, '../app/dashboard/Sidebar.tsx'), 'utf8')
  const home = readFileSync(join(__dirname, '../app/page.tsx'), 'utf8')
  assert(/isAnyLiveFocusWindowActive/.test(chart), 'chart checks focus')
  assert(/router\.replace\(['"]\/dashboard['"]\)/.test(chart), 'redirect /dashboard')
  assert(/No session now|30 min/i.test(side), 'locked hint')
  assert(/isAnyLiveFocusWindowActive/.test(side), 'sidebar focus')
  assert(/redirect\(['"]\/dashboard['"]\)/.test(home), 'root → dashboard off focus')
})

test('autoLevelPrep wires peer tape + live tier', () => {
  const src = readFileSync(
    join(__dirname, '../lib/services/autoLevelPrep.ts'),
    'utf8'
  )
  assert(/buildPeerTapeBrief/.test(src), 'peer tape')
  assert(/llm_tier:\s*'live'/.test(src), 'live Opus tier')
  assert(/shouldRunLiveAiForInstrument/.test(src), 'AI attendance gate')
})

// ── Boundary: exact open / lunch / close ─────────────────────────────────────

test('Boundaries: open tip needs attend; lunch tip needs attend; close freezes', () => {
  const open = etDate(9, 30)
  assert(
    isLiveTipStreamAllowed('DOW', open, { attendedToday: false }).open === false,
    'at open miss → tip off'
  )
  const lunch = etDate(11, 30)
  assert(isAfternoonWatchWindow(lunch, 'DOW') === true, 'lunch starts afternoon')
  assert(
    isLiveTipStreamAllowed('DOW', lunch, { attendedToday: false }).open === false,
    'lunch miss tip off'
  )
  const close = etDate(16, 0)
  assert(isChartStreamAllowed('DOW', close).open === false, 'at close frozen')
})

console.log('')
console.log(
  `sentinel_cost_gates_desk: ${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`
)
if (TESTS_FAILED.length) {
  for (const f of TESTS_FAILED) console.error(`  · ${f.name}: ${f.error}`)
  process.exit(1)
}
console.log('sentinel_cost_gates_desk: all passed')
