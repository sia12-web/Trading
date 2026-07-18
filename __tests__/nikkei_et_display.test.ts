/**
 * Nikkei UI clocks are Eastern; Tokyo deskClock math unchanged.
 * Run: npx tsx __tests__/nikkei_et_display.test.ts
 */

import { deskClockFor } from '../lib/chart/sessionVwap'
import {
  deskDisplayTimeZone,
  deskDisplayTzLabel,
  formatDeskOpenLabel,
  formatDeskOpenLabelForDate,
  deskMarketWallUnix,
} from '../lib/trading/deskDisplayTz'
import { tokyoDateTimeToUnix } from '../lib/utils/dateUtils'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

// Trading math stays Tokyo
assert(deskClockFor('NIKKEI').timeZone === 'Asia/Tokyo', 'NIKKEI deskClock stays Tokyo')
assert(deskClockFor('DOW').timeZone === 'America/New_York', 'DOW deskClock NY')

// UI display always ET
assert(deskDisplayTimeZone('NIKKEI') === 'America/New_York', 'NIKKEI display ET')
assert(deskDisplayTzLabel('NIKKEI') === 'ET', 'NIKKEI label ET')
assert(deskDisplayTimeZone('DOW') === 'America/New_York', 'DOW display ET')

// Jul 15, 2026 Tokyo 09:00 = Jul 14, 2026 20:00 EDT
const openUnix = tokyoDateTimeToUnix('2026-07-15', 9, 0)
const label = formatDeskOpenLabel('NIKKEI', openUnix)
assert(label.includes('ET'), `open label has ET: ${label}`)
assert(
  /8:00\s*PM/i.test(label) || label.includes('20:00'),
  `NIKKEI July open should be 8:00 PM ET, got ${label}`
)

const fromDate = formatDeskOpenLabelForDate('NIKKEI', '2026-07-15')
assert(fromDate === label, `date helper matches unix helper: ${fromDate} vs ${label}`)

const wall = deskMarketWallUnix('NIKKEI', '2026-07-15', 9, 0)
assert(wall === openUnix, 'deskMarketWallUnix matches tokyoDateTimeToUnix')

const dowOpen = formatDeskOpenLabelForDate('DOW', '2026-07-15')
assert(/9:30\s*AM/i.test(dowOpen), `DOW open 9:30 AM ET, got ${dowOpen}`)

// Winter: Jan 15 2026 — EST (UTC-5) → Tokyo 09:00 = 19:00 ET prior evening
const winterOpen = formatDeskOpenLabel('NIKKEI', tokyoDateTimeToUnix('2026-01-15', 9, 0))
assert(
  /7:00\s*PM/i.test(winterOpen),
  `NIKKEI January open should be 7:00 PM ET, got ${winterOpen}`
)

console.log('✅ nikkei_et_display: UI ET / Tokyo math OK')
console.log('   summer open:', label)
console.log('   winter open:', winterOpen)
