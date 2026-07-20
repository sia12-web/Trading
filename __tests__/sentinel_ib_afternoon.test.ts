/**
 * SENTINEL — Initial Balance + afternoon watch levels (live + sim parity).
 * Run: npx tsx __tests__/sentinel_ib_afternoon.test.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  computeInitialBalance,
  ibLineSeriesData,
  initialBalanceLevelsFromCandles,
  mapAfternoonCandidates,
  resolveAfternoonDeskLevels,
  type DeskBar,
} from '../lib/trading/deskLevels'
import {
  isAfternoonWatchWindow,
  isLevelPaintAllowed,
  isLiveDeskInstrument,
  resolveSessionGate,
  resolveSimMorningGate,
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

/** America/New_York July = EDT (UTC-4) */
function etUnix(y: number, m: number, d: number, h: number, min: number): number {
  return Math.floor(Date.UTC(y, m - 1, d, h + 4, min, 0) / 1000)
}

function etDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h + 4, min, 0))
}

function jstDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 9, min, 0))
}

/** Synthetic 1m bars — clear IB extremes at +20m high / +35m low. */
function makeIbBars(openUnix: number, minutes = 65): DeskBar[] {
  const out: DeskBar[] = []
  for (let i = 0; i < minutes; i++) {
    const t = openUnix + i * 60
    out.push({
      time: t,
      open: 52000,
      high: i === 20 ? 52150 : 52010,
      low: i === 35 ? 51900 : 51990,
      close: 52005,
      volume: 100,
    })
  }
  return out
}

const OPEN = etUnix(2026, 7, 15, 9, 30)
const IB_END = OPEN + 60 * 60

// ── computeInitialBalance (shared live + sim; clock = nowUnix / simT) ─────────

test('IB: null before first hour closes (sim clock mid-window)', () => {
  const bars = makeIbBars(OPEN, 45)
  const ib = computeInitialBalance(bars, OPEN, OPEN + 45 * 60)
  assert(ib === null, 'not shaped at +45m')
})

test('IB: null at exact open', () => {
  assert(computeInitialBalance(makeIbBars(OPEN, 5), OPEN, OPEN) === null, 'at open')
})

test('IB: shaped once clock ≥ open+60m with ≥2 bars', () => {
  const bars = makeIbBars(OPEN, 70)
  const ib = computeInitialBalance(bars, OPEN, IB_END)
  assert(ib != null, 'shaped')
  assert(ib!.high > ib!.low, 'high > low')
  assert(ib!.openUnix === OPEN, 'openUnix')
  assert(ib!.endUnix === IB_END, 'endUnix')
  assert(ib!.high === 52150, `high ${ib!.high}`)
  assert(ib!.low === 51900, `low ${ib!.low}`)
})

test('IB: uses only bars inside [open, open+60m)', () => {
  const bars = makeIbBars(OPEN, 90)
  // Inject a higher high after IB window — must not affect IB
  bars.push({
    time: IB_END + 120,
    open: 99999,
    high: 99999,
    low: 99990,
    close: 99995,
    volume: 1,
  })
  const ib = computeInitialBalance(bars, OPEN, IB_END + 300)
  assert(ib != null && ib.high < 90000, 'post-IB bar ignored')
})

test('IB: null with empty candles or missing open', () => {
  assert(computeInitialBalance([], OPEN, IB_END) === null, 'empty')
  assert(computeInitialBalance(makeIbBars(OPEN, 70), 0, IB_END) === null, 'no open')
})

test('IB: null with single bar in window', () => {
  const one: DeskBar[] = [
    {
      time: OPEN,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    },
  ]
  assert(computeInitialBalance(one, OPEN, IB_END) === null, 'need ≥2 bars')
})

test('IB: sim replay clock — shaped at lunch simT, not wall clock', () => {
  // Bars only through lunch; wall clock irrelevant — pass lunch as nowUnix
  const lunch = etUnix(2026, 7, 15, 11, 30)
  const bars = makeIbBars(OPEN, 120)
  const ib = computeInitialBalance(bars, OPEN, lunch)
  assert(ib != null, 'shaped by replay lunch clock')
  const early = computeInitialBalance(bars.slice(0, 30), OPEN, OPEN + 29 * 60)
  assert(early === null, 'same bars truncated + early simT → not shaped')
})

test('ibLineSeriesData: extends to session end when asked', () => {
  const bars = makeIbBars(OPEN, 70)
  const ib = computeInitialBalance(bars, OPEN, IB_END)!
  const sessionEnd = OPEN + 6.5 * 3600 // ~cash close
  const pts = ibLineSeriesData(ib, sessionEnd)
  assert(pts.high.length === 2 && pts.low.length === 2, '2 pts each')
  assert(pts.high[0]!.value === ib.high && pts.high[1]!.value === ib.high, 'flat high')
  assert(pts.low[0]!.value === ib.low && pts.low[1]!.value === ib.low, 'flat low')
  assert(pts.high[0]!.time === ib.fromTime, 'fromTime')
  assert(pts.high[1]!.time === sessionEnd, 'extends to session end')
  assert(pts.high[1]!.time > ib.toTime, 'past IB window')
})

test('ibLineSeriesData: without extend still spans IB window', () => {
  const bars = makeIbBars(OPEN, 70)
  const ib = computeInitialBalance(bars, OPEN, IB_END)!
  const pts = ibLineSeriesData(ib)
  assert(pts.high[1]!.time === ib.toTime, 'toTime default')
})

// ── Afternoon gate / paint windows ───────────────────────────────────────────

test('isLevelPaintAllowed: morning + afternoon stream, not after close', () => {
  const morning = etDate(2026, 7, 15, 9, 45)
  const afternoon = etDate(2026, 7, 15, 14, 0)
  const afterClose = etDate(2026, 7, 15, 16, 30)
  assert(isLevelPaintAllowed(morning, 'DOW').open === true, 'morning paint')
  assert(isLevelPaintAllowed(afternoon, 'DOW').open === true, 'afternoon paint')
  assert(isLevelPaintAllowed(afterClose, 'DOW').open === false, 'frozen after close')
})

test('isAfternoonWatchWindow: true only after lunch while chart streams', () => {
  assert(isAfternoonWatchWindow(etDate(2026, 7, 15, 10, 0), 'DOW') === false, 'morning')
  assert(isAfternoonWatchWindow(etDate(2026, 7, 15, 14, 0), 'DOW') === true, 'afternoon')
  assert(isAfternoonWatchWindow(etDate(2026, 7, 15, 16, 30), 'DOW') === false, 'after close')
})

test('NIKKEI afternoon watch uses JST cash close 15:00', () => {
  // 13:00 JST = after Tokyo lunch 11:30, before 15:00 close
  const pm = jstDate(2026, 7, 15, 13, 0)
  assert(isAfternoonWatchWindow(pm, 'NIKKEI') === true, 'Tokyo PM watch')
  assert(isLevelPaintAllowed(pm, 'NIKKEI').open === true, 'Tokyo PM paint')
  const after = jstDate(2026, 7, 15, 15, 30)
  assert(isAfternoonWatchWindow(after, 'NIKKEI') === false, 'Tokyo after close')
})

test('Live gate: afternoon watch-only (no new entries)', () => {
  const gate = resolveSessionGate({
    now: etDate(2026, 7, 15, 14, 0),
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
  })
  assert(gate.canPlaceEntry === false, 'no entries')
  assert(isAfternoonWatchWindow(etDate(2026, 7, 15, 14, 0), 'DOW'), 'watch window')
})

test('Sim gate: morning-only — afternoon sim clock still locked for entries after lunch', () => {
  const simPm = resolveSimMorningGate({
    now: etDate(2026, 7, 15, 14, 0),
    instrument: 'DOW',
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(simPm.canPlaceEntry === false, 'sim no afternoon entries')
})

// ── Afternoon playbook merge (reaction + IB + AI) ────────────────────────────

test('mapAfternoonCandidates: FLIP / RETEST → DeskLevel ranks', () => {
  const rows = mapAfternoonCandidates([
    { level: 52100, play: 'FLIP', candidate_type: 'resistance', note: 'broke AM' },
    { level: 51900, play: 'RETEST', candidate_type: 'support' },
    { level: 0, play: 'FLIP' },
    { level: 'bad' },
  ])
  assert(rows.length === 2, 'two valid')
  assert(rows[0]!.rank === 'primary' && rows[0]!.conviction === 9, 'FLIP primary')
  assert(rows[1]!.rank === 'watch' && rows[1]!.conviction === 8, 'RETEST watch')
})

test('mapAfternoonCandidates: non-array → []', () => {
  assert(mapAfternoonCandidates(null as unknown as unknown[]).length === 0, 'null')
  assert(mapAfternoonCandidates(undefined as unknown as unknown[]).length === 0, 'undef')
})

test('initialBalanceLevelsFromCandles: IB H resistance + IB L support', () => {
  const bars = makeIbBars(OPEN, 70)
  const levels = initialBalanceLevelsFromCandles(bars, OPEN, 60, IB_END)
  assert(levels.length === 2, 'H+L')
  const hi = levels.find((l) => l.type === 'resistance')
  const lo = levels.find((l) => l.type === 'support')
  assert(hi && lo, 'types')
  assert(hi!.rank === 'watch' && lo!.rank === 'watch', 'watch rank')
  assert(/Initial Balance/i.test(hi!.reasoning), 'IB reasoning')
})

test('resolveAfternoonDeskLevels: includes IB even when AI/review present', () => {
  const bars = makeIbBars(OPEN, 70)
  const ib = computeInitialBalance(bars, OPEN, IB_END)!
  const tip = bars[bars.length - 1]!.close
  const resolved = resolveAfternoonDeskLevels(
    [{ level: tip + 5, type: 'resistance', conviction: 8 }],
    [{ level: tip - 5, play: 'RETEST', candidate_type: 'support' }],
    bars,
    OPEN,
    'America/New_York',
    tip,
    IB_END + 3600
  )
  const prices = resolved.levels.map((l) => l.level)
  assert(prices.includes(ib.high), `IB high ${ib.high} in ${prices}`)
  assert(prices.includes(ib.low), `IB low ${ib.low} in ${prices}`)
  assert(resolved.source === 'ai', 'source ai when review/AI present')
})

test('resolveAfternoonDeskLevels: IB alone can seed playbook when no AI', () => {
  const bars = makeIbBars(OPEN, 70)
  const ib = computeInitialBalance(bars, OPEN, IB_END)!
  const resolved = resolveAfternoonDeskLevels(
    [],
    [],
    bars,
    OPEN,
    'America/New_York',
    (ib.high + ib.low) / 2,
    IB_END + 60
  )
  assert(resolved.levels.length >= 2, 'at least IB H/L')
  assert(
    resolved.levels.some((l) => l.level === ib.high) &&
      resolved.levels.some((l) => l.level === ib.low),
    'IB levels present'
  )
})

// ── Security: afternoon-playbook route (static + instrument guard) ───────────

test('Security: afternoon-playbook requires auth (401 path in source)', () => {
  const src = readFileSync(
    join(process.cwd(), 'app/api/trading/afternoon-playbook/route.ts'),
    'utf8'
  )
  assert(/getOrCreateUser/.test(src), 'uses getOrCreateUser')
  assert(/status:\s*401/.test(src) || /'Unauthorized'/.test(src), '401 Unauthorized')
  assert(/isLiveDeskInstrument/.test(src), 'validates instrument')
  assert(/status:\s*400/.test(src) || /Invalid instrument/.test(src), '400 invalid')
  assert(/isAfternoonWatchWindow/.test(src), 'exposes watch flag')
  assert(/watch-only/i.test(src), 'documents watch-only')
})

test('Security: isLiveDeskInstrument rejects garbage / injection strings', () => {
  assert(isLiveDeskInstrument('DOW'), 'DOW ok')
  assert(isLiveDeskInstrument('NASDAQ'), 'NASDAQ ok')
  assert(isLiveDeskInstrument('NIKKEI'), 'NIKKEI ok')
  assert(!isLiveDeskInstrument(''), 'empty')
  assert(!isLiveDeskInstrument("DOW'; DROP TABLE--"), 'injection')
  assert(!isLiveDeskInstrument('<script>'), 'xss')
  assert(!isLiveDeskInstrument('EURUSD'), 'fx not desk')
  assert(!isLiveDeskInstrument('dow'), 'case sensitive')
})

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('')
console.log(`sentinel_ib_afternoon: ${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length) {
  for (const f of TESTS_FAILED) console.error(`  · ${f.name}: ${f.error}`)
  process.exit(1)
}
console.log('sentinel_ib_afternoon: all passed')
