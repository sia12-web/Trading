/**
 * Nikkei US Range Breakout & Rejection (Tokyo cash signals).
 * Run: npx tsx __tests__/nikkei_us_range_breakout.test.ts
 */

import {
  computeNikkeiUsRangeBreakout,
  currentNikkeiUsRangeForChart,
  inAsiaSessionUtc,
  inNikkeiUsBuildSession,
  inNikkeiUsSignalSession,
  inUsSessionUtc,
  isNikkeiUsRangeInstrument,
  lastNikkeiUsSessionRange,
  listNikkeiUsSessionRanges,
  nikkeiUsRangeLineSeriesData,
  type NikkeiUsRangeBar,
} from '../lib/chart/nikkeiUsRangeBreakout'
import { tokyoDeskSessionAt } from '../lib/chart/sessionVwap'

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

/** Asia/Tokyo wall-clock → unix (JST = UTC+9) */
function jstUnix(y: number, m: number, d: number, h: number, min: number): number {
  return Math.floor(Date.UTC(y, m - 1, d, h - 9, min, 0) / 1000)
}

function bar(
  time: number,
  o: number,
  h: number,
  l: number,
  c: number,
  volume = 1000
): NikkeiUsRangeBar {
  return { time, open: o, high: h, low: l, close: c, volume }
}

test('isNikkeiUsRangeInstrument: Nikkei only', () => {
  assert(isNikkeiUsRangeInstrument('NIKKEI') === true, 'NIKKEI')
  assert(isNikkeiUsRangeInstrument('DOW') === false, 'DOW off')
  assert(isNikkeiUsRangeInstrument('NASDAQ') === false, 'NASDAQ off')
})

test('sessions: US RTH builds, Tokyo signals, not London/dead', () => {
  const nyRth = jstUnix(2026, 7, 15, 23, 0) // 10:00 ET — US RTH
  const tokyo = jstUnix(2026, 7, 16, 10, 0) // Tokyo cash
  const dead = jstUnix(2026, 7, 16, 16, 0) // 15:00–17:00 uncolored
  const london = jstUnix(2026, 7, 16, 18, 0) // London / 05:00 ET
  const afterCash = jstUnix(2026, 7, 16, 5, 30) // 16:30 ET prior — after US cash

  assert(tokyoDeskSessionAt(nyRth) === 'New York', '23:00 JST band = New York')
  assert(tokyoDeskSessionAt(tokyo) === 'Asia', '10:00 JST = Tokyo/Asia')
  assert(tokyoDeskSessionAt(dead) === null, '16:00 JST = dead')
  assert(tokyoDeskSessionAt(london) === 'London', '18:00 JST = London')

  assert(inNikkeiUsBuildSession(nyRth) === true, 'build in US RTH')
  assert(inNikkeiUsBuildSession(afterCash) === false, 'no build after 16:00 ET')
  assert(inNikkeiUsBuildSession(london) === false, 'no build in London')
  assert(inNikkeiUsBuildSession(dead) === false, 'no build in dead')
  assert(inNikkeiUsSignalSession(tokyo) === true, 'signal in Tokyo')
  assert(inNikkeiUsSignalSession(london) === false, 'no signal in London')
  assert(inNikkeiUsSignalSession(dead) === false, 'no signal in dead')
  assert(inUsSessionUtc(nyRth) === true, 'alias build')
  assert(inAsiaSessionUtc(tokyo) === true, 'alias signal')
  assert(inAsiaSessionUtc(london) === false, 'alias not London')
})

test('tracks NY high/low then Tokyo cash breakout with RVOL', () => {
  const candles: NikkeiUsRangeBar[] = []
  // Warm volume during London (should not build range)
  for (let i = 0; i < 20; i++) {
    candles.push(bar(jstUnix(2026, 7, 15, 18, i), 100, 101, 99, 100, 1000))
  }
  // New York — range 100–110
  candles.push(bar(jstUnix(2026, 7, 15, 22, 30), 105, 108, 104, 106, 1000))
  candles.push(bar(jstUnix(2026, 7, 15, 23, 0), 106, 110, 105, 109, 1000))
  candles.push(bar(jstUnix(2026, 7, 16, 4, 0), 109, 109.5, 100, 101, 1000))
  // Tokyo cash — breakout above 110
  candles.push(bar(jstUnix(2026, 7, 16, 10, 0), 109, 109.8, 108.5, 109.5, 1000))
  candles.push(bar(jstUnix(2026, 7, 16, 10, 5), 109.5, 112, 109, 111.5, 2500))

  const r = computeNikkeiUsRangeBreakout(candles)
  assert(r != null, 'result')
  assert(r!.high === 110, `high ${r!.high}`)
  assert(r!.low === 100, `low ${r!.low}`)
  assert(r!.visible === true, 'visible in Tokyo cash')
  const brk = r!.signals.filter((s) => s.type === 'US_BRK_LONG')
  assert(brk.length === 1, `one long brk got ${brk.length}`)
  assert(brk[0]!.text === 'US BRK', 'label')
})

test('Tokyo cash rejection at US high (no breakout close)', () => {
  const candles: NikkeiUsRangeBar[] = []
  for (let i = 0; i < 20; i++) {
    candles.push(bar(jstUnix(2026, 7, 15, 18, i), 100, 101, 99, 100, 1000))
  }
  candles.push(bar(jstUnix(2026, 7, 15, 23, 0), 105, 110, 100, 105, 1000))
  candles.push(bar(jstUnix(2026, 7, 16, 10, 0), 109, 111.5, 108, 109.2, 1000))

  const r = computeNikkeiUsRangeBreakout(candles, { useVol: false })
  assert(r != null, 'result')
  const rej = r!.signals.filter((s) => s.type === 'US_REJ_HIGH')
  assert(rej.length === 1, `one rej got ${rej.length}`)
  assert(rej[0]!.text === 'US REJ', 'label')
})

test('Tokyo cash downside US BRK short (symmetric with high)', () => {
  const candles: NikkeiUsRangeBar[] = []
  for (let i = 0; i < 20; i++) {
    candles.push(bar(jstUnix(2026, 7, 15, 18, i), 100, 101, 99, 100, 1000))
  }
  candles.push(bar(jstUnix(2026, 7, 15, 22, 30), 105, 108, 104, 106, 1000))
  candles.push(bar(jstUnix(2026, 7, 15, 23, 0), 106, 110, 105, 109, 1000))
  candles.push(bar(jstUnix(2026, 7, 16, 4, 0), 109, 109.5, 100, 101, 1000))
  candles.push(bar(jstUnix(2026, 7, 16, 10, 0), 105, 106, 104, 105, 1000))
  candles.push(bar(jstUnix(2026, 7, 16, 10, 5), 105, 105.5, 97, 98, 2500))

  const r = computeNikkeiUsRangeBreakout(candles)
  assert(r != null, 'result')
  assert(r!.high === 110, `high ${r!.high}`)
  assert(r!.low === 100, `low ${r!.low}`)
  const brk = r!.signals.filter((s) => s.type === 'US_BRK_SHORT')
  assert(brk.length === 1, `one short brk got ${brk.length}`)
  assert(brk[0]!.text === 'US BRK', 'label')
  assert(brk[0]!.shape === 'arrowDown', 'arrow down')
})

test('US BRK short still fires after quiet first beyond bar (sticky RVOL)', () => {
  const candles: NikkeiUsRangeBar[] = []
  for (let i = 0; i < 20; i++) {
    candles.push(bar(jstUnix(2026, 7, 15, 18, i), 100, 101, 99, 100, 1000))
  }
  candles.push(bar(jstUnix(2026, 7, 15, 23, 0), 105, 110, 100, 105, 1000))
  candles.push(bar(jstUnix(2026, 7, 16, 10, 0), 105, 106, 104, 105, 1000))
  // First close beyond L — below RVOL threshold (must not permanently suppress)
  candles.push(bar(jstUnix(2026, 7, 16, 10, 5), 105, 105.5, 98, 99, 800))
  // Still beyond L with RVOL — must paint US BRK short
  candles.push(bar(jstUnix(2026, 7, 16, 10, 10), 99, 99.5, 95, 96, 2500))

  const r = computeNikkeiUsRangeBreakout(candles)
  assert(r != null, 'result')
  const brk = r!.signals.filter((s) => s.type === 'US_BRK_SHORT')
  assert(brk.length === 1, `sticky short brk got ${brk.length}`)
  assert(brk[0]!.time === jstUnix(2026, 7, 16, 10, 10), 'fires on RVOL bar')
})

test('no US BRK/REJ during London or dead zone', () => {
  const candles: NikkeiUsRangeBar[] = []
  candles.push(bar(jstUnix(2026, 7, 15, 23, 0), 105, 110, 100, 105, 1000))
  // Dead zone wick beyond US H — must NOT signal
  candles.push(bar(jstUnix(2026, 7, 16, 16, 0), 109, 112, 108, 109, 2500))
  // London close above US H — must NOT signal
  candles.push(bar(jstUnix(2026, 7, 16, 18, 0), 109, 113, 108, 111.5, 2500))

  const r = computeNikkeiUsRangeBreakout(candles, { useVol: false })
  assert(r != null, 'result')
  assert(r!.signals.length === 0, `no leak signals got ${r!.signals.length}`)
  assert(r!.visible === false, 'not visible in London tip')
})

test('lines hidden outside NY / Tokyo cash', () => {
  const candles: NikkeiUsRangeBar[] = [
    bar(jstUnix(2026, 7, 15, 23, 0), 105, 110, 100, 105, 1000),
    bar(jstUnix(2026, 7, 16, 16, 0), 105, 106, 104, 105, 1000), // dead
  ]
  const r = computeNikkeiUsRangeBreakout(candles, { useVol: false })
  assert(r != null, 'result')
  assert(r!.visible === false, 'not visible in dead zone')
})

test('IB-style line series draws US H/L only on Tokyo cash session', () => {
  const candles: NikkeiUsRangeBar[] = []
  candles.push(bar(jstUnix(2026, 7, 15, 23, 0), 105, 110, 100, 105, 1000))
  candles.push(bar(jstUnix(2026, 7, 16, 4, 0), 105, 108, 102, 106, 1000))
  const tip = jstUnix(2026, 7, 16, 10, 0)
  const cur = currentNikkeiUsRangeForChart(candles, tip)
  assert(cur != null, 'current range in Tokyo cash')
  const pts = nikkeiUsRangeLineSeriesData(cur!, tip)
  assert(pts.high.length === 2 && pts.low.length === 2, 'two points each')
  assert(pts.high[0]!.value === cur!.high, 'high level')
  assert(pts.low[0]!.value === cur!.low, 'low level')
  assert(pts.high[0]!.time === jstUnix(2026, 7, 16, 9, 0), 'starts at Tokyo cash open')
  assert(pts.high[1]!.time === tip, 'extends to tip')
  assert(pts.high[0]!.time > cur!.fromTime, 'does not start in NY band')
  assert(cur!.complete === true, 'Tokyo cash tip promotes sparse NY walk to complete')

  // Overnight / London tip → no chart lines
  const overnight = currentNikkeiUsRangeForChart(candles, jstUnix(2026, 7, 16, 4, 0))
  assert(overnight == null, 'hidden during NY overnight')
  const deadTip = jstUnix(2026, 7, 16, 16, 0)
  const last = lastNikkeiUsSessionRange(candles)
  assert(last != null, 'last range exists')
  const deadPts = nikkeiUsRangeLineSeriesData(last!, deadTip)
  assert(deadPts.high.length === 0, 'no lines in dead zone')
})
test('lastNikkeiUsSessionRange: last completed NYC H/L only', () => {
  const candles: NikkeiUsRangeBar[] = []
  // Day 1 NY (JST evening)
  for (let m = 30; m < 60; m += 5) {
    candles.push(bar(jstUnix(2026, 7, 14, 22, m), 105, 110, 100, 105))
  }
  for (let m = 0; m < 60; m += 5) {
    candles.push(bar(jstUnix(2026, 7, 14, 23, m), 105, 108, 102, 106))
  }
  // Gap then Day 2 NY
  for (let m = 30; m < 60; m += 5) {
    candles.push(bar(jstUnix(2026, 7, 15, 22, m), 210, 220, 200, 215))
  }
  candles.push(bar(jstUnix(2026, 7, 16, 10, 0), 215, 216, 214, 215)) // Tokyo

  const sessions = listNikkeiUsSessionRanges(candles)
  assert(sessions.length === 2, `two sessions got ${sessions.length}`)
  const last = lastNikkeiUsSessionRange(candles)
  assert(last != null, 'last exists')
  assert(last!.complete === true, 'complete')
  assert(last!.high === 220, `high ${last!.high}`)
  assert(last!.low === 200, `low ${last!.low}`)
  assert(last!.rangePts === 20, `range ${last!.rangePts}`)
})

console.log(`\n${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length > 0) process.exit(1)
