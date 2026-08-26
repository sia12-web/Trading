/**
 * Desk toast vs Telegram — empty telegram is on-screen only.
 * Run: npx tsx __tests__/desk_alert_telegram.test.ts
 */

import {
  deskAlertTelegramText,
  formatDeskAlertToast,
} from '../lib/notify/deskAlertTelegram'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(
  formatDeskAlertToast(
    'CALL WAIT',
    'CALL WAIT — hunt nothing new. Open and Control don’t agree yet, or there is no legal ±10.'
  ) ===
  'CALL WAIT — hunt nothing new. Open and Control don’t agree yet, or there is no legal ±10.',
  'toast does not duplicate CALL WAIT'
)
assert(
  formatDeskAlertToast('Off-band entry', 'Stay inside ±10 of H / L') ===
  'Off-band entry — Stay inside ±10 of H / L',
  'toast joins distinct title and body'
)

assert(
  deskAlertTelegramText({
    title: 'CALL WAIT',
    body: 'CALL WAIT — hunt nothing new.',
    telegram: '',
  }) === null,
  'empty telegram is toast-only'
)
assert(
  deskAlertTelegramText({
    title: 'CLOCK IN',
    body: 'DOW locked',
    telegram: 'CLOCK IN\nDOW locked',
  }) === 'CLOCK IN\nDOW locked',
  'explicit telegram still sends'
)
assert(
  deskAlertTelegramText({
    kind: 'price_touch_alert',
    title: 'NQ price alert touched @ 18,500',
    body: 'Live 18,500 hit your chart alert',
  }) === null,
  'price touch alert is suppressed from telegram'
)
assert(
  deskAlertTelegramText({
    kind: 'range_edge_alert',
    title: 'Band touch',
    body: 'Price in band',
  }) === null,
  'band proximity alert is suppressed from telegram'
)

console.log('desk_alert_telegram.test.ts: all assertions passed')
