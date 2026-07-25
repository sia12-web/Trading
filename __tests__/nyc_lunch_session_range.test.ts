/**
 * NYC Lunch Session Range (12:00–13:30 ET) — Dow / Nasdaq overlay math.
 * Run: npx tsx __tests__/nyc_lunch_session_range.test.ts
 */

import {
  computeNycLunchRange,
  isNycLunchInstrument,
  nycLunchEndMarkers,
  nycLunchLineSeriesData,
} from '../lib/chart/nycLunchSessionRange'

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

test('isNycLunchInstrument: Dow + Nasdaq only', () => {
  assert(isNycLunchInstrument('DOW') === true, 'DOW')
  assert(isNycLunchInstrument('NASDAQ') === true, 'NASDAQ')
  assert(isNycLunchInstrument('NIKKEI') === false, 'NIKKEI off')
  assert(isNycLunchInstrument(null) === false, 'null off')
})

test('computeNycLunchRange: null before 12:00 ET', () => {
  const day = '2026-07-15'
  const bars = [
    { time: etUnix(2026, 7, 15, 11, 30), high: 400, low: 390 },
    { time: etUnix(2026, 7, 15, 11, 55), high: 405, low: 395 },
  ]
  const r = computeNycLunchRange(bars, day, etUnix(2026, 7, 15, 11, 59))
  assert(r === null, 'no range before lunch')
})

test('computeNycLunchRange: tracks H/L during 12:00–13:30', () => {
  const day = '2026-07-15'
  const bars = [
    { time: etUnix(2026, 7, 15, 11, 55), high: 410, low: 400 }, // pre — ignore
    { time: etUnix(2026, 7, 15, 12, 0), high: 420, low: 415 },
    { time: etUnix(2026, 7, 15, 12, 30), high: 430, low: 410 },
    { time: etUnix(2026, 7, 15, 13, 25), high: 425, low: 412 },
    { time: etUnix(2026, 7, 15, 13, 30), high: 450, low: 400 }, // at end — exclude
  ]
  const r = computeNycLunchRange(bars, day, etUnix(2026, 7, 15, 13, 0))
  assert(r != null, 'range exists')
  assert(r!.high === 430, `high ${r!.high}`)
  assert(r!.low === 410, `low ${r!.low}`)
  assert(r!.mid === 420, `mid ${r!.mid}`)
  assert(r!.complete === false, 'still in lunch')
})

test('computeNycLunchRange: locks after 13:30 and extends', () => {
  const day = '2026-07-15'
  const bars = [
    { time: etUnix(2026, 7, 15, 12, 0), high: 420, low: 415 },
    { time: etUnix(2026, 7, 15, 12, 45), high: 440, low: 405 },
    { time: etUnix(2026, 7, 15, 13, 25), high: 435, low: 408 },
    { time: etUnix(2026, 7, 15, 14, 0), high: 460, low: 390 },
  ]
  const r = computeNycLunchRange(bars, day, etUnix(2026, 7, 15, 14, 30))
  assert(r != null, 'range exists')
  assert(r!.complete === true, 'complete')
  assert(r!.high === 440, `high ${r!.high}`)
  assert(r!.low === 405, `low ${r!.low}`)

  const pts = nycLunchLineSeriesData(r!, etUnix(2026, 7, 15, 16, 0))
  assert(pts.high.length === 2, 'high segment')
  assert(pts.mid[1]!.value === r!.mid, 'mid extends')
  assert(pts.high[1]!.time === etUnix(2026, 7, 15, 16, 0), 'extends to cash close')

  const mk = nycLunchEndMarkers(r!)
  assert(mk.length === 1, 'one end marker')
  assert(mk[0]!.text === '1:30 PM', 'label')
})

console.log(`\n${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length > 0) process.exit(1)
