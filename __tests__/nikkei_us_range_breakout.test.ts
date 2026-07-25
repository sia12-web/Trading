/**
 * Nikkei US Range Breakout & Rejection (Asia session).
 * Run: npx tsx __tests__/nikkei_us_range_breakout.test.ts
 */

import {
  computeNikkeiUsRangeBreakout,
  inAsiaSessionUtc,
  inUsSessionUtc,
  isNikkeiUsRangeInstrument,
  nikkeiUsRangeLineSeriesData,
  type NikkeiUsRangeBar,
} from '../lib/chart/nikkeiUsRangeBreakout'

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

/** UTC wall-clock → unix */
function utcUnix(y: number, m: number, d: number, h: number, min: number): number {
  return Math.floor(Date.UTC(y, m - 1, d, h, min, 0) / 1000)
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

test('session windows: US 13:30–20:00 UTC, Asia 00:00–09:00 UTC', () => {
  assert(inUsSessionUtc(utcUnix(2026, 7, 15, 13, 30)) === true, 'US start')
  assert(inUsSessionUtc(utcUnix(2026, 7, 15, 19, 55)) === true, 'US late')
  assert(inUsSessionUtc(utcUnix(2026, 7, 15, 20, 0)) === false, 'US end exclusive')
  assert(inAsiaSessionUtc(utcUnix(2026, 7, 16, 0, 0)) === true, 'Asia start')
  assert(inAsiaSessionUtc(utcUnix(2026, 7, 16, 8, 55)) === true, 'Asia late')
  assert(inAsiaSessionUtc(utcUnix(2026, 7, 16, 9, 0)) === false, 'Asia end exclusive')
})

test('tracks US high/low then Asia breakout with RVOL', () => {
  const candles: NikkeiUsRangeBar[] = []
  // Warm volume SMA (20 bars pre-US)
  for (let i = 0; i < 20; i++) {
    candles.push(bar(utcUnix(2026, 7, 15, 10, i), 100, 101, 99, 100, 1000))
  }
  // US session — range 100–110
  candles.push(bar(utcUnix(2026, 7, 15, 13, 30), 105, 108, 104, 106, 1000))
  candles.push(bar(utcUnix(2026, 7, 15, 14, 0), 106, 110, 105, 109, 1000))
  candles.push(bar(utcUnix(2026, 7, 15, 19, 30), 109, 109.5, 100, 101, 1000))
  // Asia — approach then breakout above 110 with volume spike
  candles.push(bar(utcUnix(2026, 7, 16, 1, 0), 109, 109.8, 108.5, 109.5, 1000)) // still inside
  candles.push(bar(utcUnix(2026, 7, 16, 1, 5), 109.5, 112, 109, 111.5, 2500)) // cross up + RVOL

  const r = computeNikkeiUsRangeBreakout(candles)
  assert(r != null, 'result')
  assert(r!.high === 110, `high ${r!.high}`)
  assert(r!.low === 100, `low ${r!.low}`)
  assert(r!.visible === true, 'visible in Asia')
  const brk = r!.signals.filter((s) => s.type === 'US_BRK_LONG')
  assert(brk.length === 1, `one long brk got ${brk.length}`)
  assert(brk[0]!.text === 'US BRK', 'label')
})

test('Asia rejection at US high (no breakout close)', () => {
  const candles: NikkeiUsRangeBar[] = []
  for (let i = 0; i < 20; i++) {
    candles.push(bar(utcUnix(2026, 7, 15, 10, i), 100, 101, 99, 100, 1000))
  }
  candles.push(bar(utcUnix(2026, 7, 15, 14, 0), 105, 110, 100, 105, 1000))
  // Reject: high > 110, close < 110
  candles.push(bar(utcUnix(2026, 7, 16, 2, 0), 109, 111.5, 108, 109.2, 1000))

  const r = computeNikkeiUsRangeBreakout(candles, { useVol: false })
  assert(r != null, 'result')
  const rej = r!.signals.filter((s) => s.type === 'US_REJ_HIGH')
  assert(rej.length === 1, `one rej got ${rej.length}`)
  assert(rej[0]!.text === 'REJ', 'label')
})

test('lines hidden outside US/Asia windows', () => {
  const candles: NikkeiUsRangeBar[] = [
    bar(utcUnix(2026, 7, 15, 14, 0), 105, 110, 100, 105, 1000),
    // Tip in UTC dead zone 10:00 (between Asia end and US start)
    bar(utcUnix(2026, 7, 16, 10, 0), 105, 106, 104, 105, 1000),
  ]
  const r = computeNikkeiUsRangeBreakout(candles, { useVol: false })
  assert(r != null, 'result')
  assert(r!.visible === false, 'not visible in gap')
  const pts = nikkeiUsRangeLineSeriesData(r!)
  assert(pts.high.length === 0 && pts.low.length === 0, 'no lines in gap')
})

console.log(`\n${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length > 0) process.exit(1)
