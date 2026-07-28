/**
 * Trader display TZ — Montreal wall clock for Nikkei schedule copy.
 */
import assert from 'node:assert/strict'
import {
  TRADER_DISPLAY_TZ,
  deskLocalHmsAsTraderDisplay,
  deskLocalRangeAsTraderDisplay,
  timeInTraderDisplay,
} from '../lib/chart/traderDisplayTz'

assert.equal(TRADER_DISPLAY_TZ, 'America/Toronto')

// Jul 27 2026 23:51 UTC = 19:51 Montreal (EDT)
const evening = new Date('2026-07-27T23:51:00.000Z')
assert.equal(timeInTraderDisplay(evening), '19:51:00')
assert.equal(deskLocalHmsAsTraderDisplay('08:45:00', 'Asia/Tokyo', evening), '19:45')
assert.equal(deskLocalHmsAsTraderDisplay('09:00:00', 'Asia/Tokyo', evening), '20:00')
assert.equal(
  deskLocalRangeAsTraderDisplay('09:00:00', '09:45:00', 'Asia/Tokyo', evening),
  '20:00–20:45 ET'
)

// NY schedule stays Eastern
const nyMorning = new Date('2026-07-15T13:20:00.000Z') // 09:20 EDT
assert.equal(deskLocalHmsAsTraderDisplay('09:15:00', 'America/New_York', nyMorning), '09:15')

console.log('✅ trader_display_tz: Montreal conversions OK')
