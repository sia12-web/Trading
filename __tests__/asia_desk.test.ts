/**
 * Asia live desk — locked recipes, telegram copy, webhook parse, chart window.
 * Run: npx tsx __tests__/asia_desk.test.ts
 */

import assert from 'node:assert/strict'
import { zonedCivilToUnix } from '../lib/chart/sessionVwap'
import {
  ASIA_TZ,
  lockLatestAsiaSession,
  type AsiaBar,
} from '../lib/trading/asiaRangeSignals'
import {
  ASIA_DESK_RECIPES,
  evaluateAsiaDeskOverlay,
  formatAsiaDeskTelegram,
  isAsiaDeskChartWindow,
  isAsiaLiveOrderOverlay,
  parseAsiaWebhookBody,
  overlayFromWebhook,
} from '../lib/trading/asiaDesk'

function barAt(ymd: string, hour: number, minute: number, px: { o: number; h: number; l: number; c: number }): AsiaBar {
  const time = zonedCivilToUnix(ymd, hour + minute / 60, ASIA_TZ)
  return { time, open: px.o, high: px.h, low: px.l, close: px.c, volume: 1 }
}

const bars: AsiaBar[] = []
bars.push(barAt('2026-08-26', 19, 55, { o: 4670, h: 4672, l: 4668, c: 4670 }))
for (let mins = 20 * 60; mins < 24 * 60; mins += 5) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  bars.push(barAt('2026-08-26', h, m, { o: 4670, h: 4697.7, l: 4654.6, c: 4672 }))
}
for (let mins = 0; mins <= 12 * 60; mins += 5) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  bars.push(barAt('2026-08-27', h, m, { o: 4672, h: 4674, l: 4670, c: 4672 }))
}

assert.equal(ASIA_DESK_RECIPES.GOLD.maxRange, 60)
assert.equal(ASIA_DESK_RECIPES.GOLD.buffer, 10)
assert.equal(ASIA_DESK_RECIPES.DOW.maxRange, 80)
assert.equal(ASIA_DESK_RECIPES.DOW.buffer, 20)

const lock = lockLatestAsiaSession({
  instrument: 'GOLD',
  candles: bars,
  maxRange: 60,
  buffer: 10,
  nowUnix: zonedCivilToUnix('2026-08-27', 2 + 10 / 60, ASIA_TZ),
})
assert.ok(lock)
assert.equal(lock.qualified, true)
assert.equal(lock.asiaHigh, 4697.7)
assert.equal(lock.asiaLow, 4654.6)
assert.equal(lock.buyStop, 4707.7)
assert.equal(lock.sellStop, 4644.6)

const atLock = new Date(zonedCivilToUnix('2026-08-27', 2 + 10 / 60, ASIA_TZ) * 1000)
assert.equal(isAsiaDeskChartWindow(atLock), true)
const beforeLock = new Date(zonedCivilToUnix('2026-08-27', 1 + 50 / 60, ASIA_TZ) * 1000)
assert.equal(isAsiaDeskChartWindow(beforeLock), false, 'no chart before 02:00 lock')
const atFlat = new Date(zonedCivilToUnix('2026-08-27', 10 + 25 / 60, ASIA_TZ) * 1000)
assert.equal(isAsiaDeskChartWindow(atFlat), false, 'chart closes at 10:25 flatten')

const overlay = evaluateAsiaDeskOverlay({
  instrument: 'GOLD',
  candles: bars,
  now: atLock,
})
assert.ok(overlay)
assert.equal(overlay.event, 'place_both')
assert.equal(overlay.contract, 'MGC')
assert.equal(isAsiaLiveOrderOverlay(overlay, atLock), true)
assert.equal(isAsiaLiveOrderOverlay(overlay, beforeLock), false)
assert.equal(isAsiaLiveOrderOverlay({ ...overlay, qualified: false }, atLock), false)
const text = formatAsiaDeskTelegram(overlay)
assert.ok(text && text.includes('PLACE OCO STOPS'))
assert.ok(text.includes('4707.7'))
assert.ok(text.includes('4644.6'))

const parsed = parseAsiaWebhookBody(text)
assert.ok(parsed)
assert.equal(parsed.instrument, 'GOLD')
assert.equal(parsed.event, 'place_both')

const skipParsed = parseAsiaWebhookBody('GOLD ASIA SKIP range 72.4 (need < 60)')
assert.equal(skipParsed?.event, 'skip')

const jsonHook = parseAsiaWebhookBody(
  JSON.stringify({
    v: 1,
    kind: 'asia',
    instrument: 'DOW',
    event: 'place_both',
    asiaHigh: 45500,
    asiaLow: 45440,
  })
)
const fromJson = overlayFromWebhook(jsonHook!)
assert.ok(fromJson)
assert.equal(fromJson.instrument, 'DOW')
assert.equal(fromJson.buyStop, 45520)
assert.equal(fromJson.sellStop, 45420)

const night = new Date(zonedCivilToUnix('2026-08-26', 20, ASIA_TZ) * 1000)
assert.equal(isAsiaDeskChartWindow(night), false)

console.log('asia_desk.test.ts: all assertions passed')
