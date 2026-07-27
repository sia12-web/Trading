/**
 * Cash-close flatten rules — not lunch (11:30).
 * Run: npx tsx __tests__/cash_close_flatten.test.ts
 */

import {
  shouldAutoFlattenAtCashClose,
  shouldExpireWorkingLimit,
} from '../lib/trading/sessionCleanup'
import { parseTimeToSeconds } from '../lib/utils/timeUtils'
import { NY_SESSION, TOKYO_SESSION } from '../lib/trading/sessionGate'

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

const nyLunch = parseTimeToSeconds(NY_SESSION.lunchClose)
const nyClose = parseTimeToSeconds(NY_SESSION.marketClose)
const tokyoLunch = parseTimeToSeconds(TOKYO_SESSION.lunchClose)
const tokyoClose = parseTimeToSeconds(TOKYO_SESSION.marketClose)

test('NY: filled opens do NOT auto-flatten at lunch 11:30', () => {
  assert(
    shouldAutoFlattenAtCashClose({
      timeSec: nyLunch,
      marketCloseSec: nyClose,
    }) === false,
    '11:30 should not flatten'
  )
  assert(
    shouldAutoFlattenAtCashClose({
      timeSec: parseTimeToSeconds('12:00:00'),
      marketCloseSec: nyClose,
    }) === false,
    'afternoon before cash close should not flatten'
  )
})

test('NY: filled opens DO auto-flatten at cash close 16:00', () => {
  assert(
    shouldAutoFlattenAtCashClose({
      timeSec: nyClose,
      marketCloseSec: nyClose,
    }) === true,
    '16:00 flattens'
  )
  assert(
    shouldAutoFlattenAtCashClose({
      timeSec: parseTimeToSeconds('16:01:00'),
      marketCloseSec: nyClose,
    }) === true,
    'after cash close flattens'
  )
})

test('Tokyo: cash close 15:00 JST flattens; lunch does not', () => {
  assert(
    shouldAutoFlattenAtCashClose({
      timeSec: tokyoLunch,
      marketCloseSec: tokyoClose,
    }) === false,
    'Tokyo lunch no flatten'
  )
  assert(
    shouldAutoFlattenAtCashClose({
      timeSec: tokyoClose,
      marketCloseSec: tokyoClose,
    }) === true,
    'Tokyo cash close flattens'
  )
})

test('forceCashClose overrides clock', () => {
  assert(
    shouldAutoFlattenAtCashClose({
      timeSec: parseTimeToSeconds('10:00:00'),
      marketCloseSec: nyClose,
      forceCashClose: true,
    }) === true,
    'force flattens early'
  )
})

test('working limits still expire at lunch', () => {
  assert(
    shouldExpireWorkingLimit({
      timeSec: nyLunch,
      entryCloseSec: parseTimeToSeconds(NY_SESSION.entryClose),
      lunchCloseSec: nyLunch,
      deskHoursOpen: false,
    }) === true,
    'expire at lunch'
  )
  assert(
    shouldExpireWorkingLimit({
      timeSec: parseTimeToSeconds('10:00:00'),
      entryCloseSec: parseTimeToSeconds(NY_SESSION.entryClose),
      lunchCloseSec: nyLunch,
      deskHoursOpen: true,
    }) === false,
    'still in morning window'
  )
})

console.log(`\n${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length > 0) process.exit(1)
