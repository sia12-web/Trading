/**
 * The only live NY strategy + Telegram allowlist.
 * Run: npx tsx __tests__/ny_desk_strategy.test.ts
 */

import assert from 'node:assert/strict'
import { deskAlertTelegramText } from '../lib/notify/deskAlertTelegram'
import { firstLegalHuntVeto } from '../lib/trading/directionalPerformance'
import {
  formatCallSetupTelegram,
  isNyCallSetup,
  isNyTelegramKind,
  NY_MAX_FILLS,
  NY_MAX_STOP_OUTS,
  NY_TELEGRAM_KIND,
  NY_TICKET_R,
} from '../lib/trading/nyDeskStrategy'

assert.equal(NY_TICKET_R, 1.5)
assert.equal(NY_MAX_FILLS, 3)
assert.equal(NY_MAX_STOP_OUTS, 2)
assert.equal(NY_TELEGRAM_KIND, 'call_setup')
assert.equal(isNyTelegramKind('call_setup'), true)
assert.equal(isNyTelegramKind('auction_setup'), true)
assert.equal(isNyTelegramKind('range_shaped'), false)

assert.equal(isNyCallSetup({ side: 'LONG', edge: 'low' }), true)
assert.equal(isNyCallSetup({ side: 'SHORT', edge: 'high' }), true)
assert.equal(isNyCallSetup({ side: 'LONG', edge: 'high' }), false)
assert.equal(isNyCallSetup({ side: 'SHORT', edge: 'low' }), false)
assert.equal(isNyCallSetup({ side: 'LONG', edge: 'mid' }), false)
assert.equal(isNyCallSetup({ side: 'WAIT', edge: 'low' }), false)
assert.equal(isNyCallSetup({ side: 'LONG', edge: 'low', bookLocked: true }), false)

assert.equal(
  deskAlertTelegramText({
    kind: 'call_setup',
    telegram: 'SETUP DOW · CALL LONG',
  }),
  'SETUP DOW · CALL LONG'
)
assert.equal(
  deskAlertTelegramText({
    kind: 'range_shaped',
    telegram: 'OR30 LOCKED',
  }),
  null
)
assert.equal(
  deskAlertTelegramText({
    title: 'CLOCK IN',
    body: 'DOW locked',
    telegram: 'CLOCK IN\nDOW locked',
  }),
  null
)
assert.equal(
  deskAlertTelegramText({
    kind: 'price_touch_alert',
    title: 'NQ price alert touched @ 18,500',
    body: 'Live 18,500 hit your chart alert',
  }),
  null
)
assert.equal(
  deskAlertTelegramText({
    kind: 'range_edge',
    title: 'IN BAND',
    telegram: 'IN BAND',
  }),
  null
)
assert.equal(
  deskAlertTelegramText({
    kind: 'session_start',
    telegram: 'SESSION START',
  }),
  null
)

const setupText = formatCallSetupTelegram({
  instrument: 'DOW',
  side: 'LONG',
  rangeKey: 'OR30',
  entryPrice: 42100,
  edge: 'low',
  livePrice: 42102,
})
assert.ok(setupText.includes('SETUP DOW · CALL LONG'))
assert.ok(setupText.includes('1.5R'))

assert.equal(
  firstLegalHuntVeto({
    grade: 'BALANCING',
    playbookMode: 'or30',
    attemptsUsed: 1,
  }),
  true
)
assert.equal(
  firstLegalHuntVeto({
    grade: 'BALANCING',
    playbookMode: 'morning',
    attemptsUsed: 1,
  }),
  false
)
assert.equal(
  firstLegalHuntVeto({
    grade: 'STRONG',
    playbookMode: 'ib',
    attemptsUsed: 1,
  }),
  false
)

console.log('ny_desk_strategy.test.ts: all assertions passed')
