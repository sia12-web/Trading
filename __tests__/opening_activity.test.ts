/**
 * Dalton opening activity — Drive / Test-Drive / Rejection-Reverse / Auction.
 * Run: npx tsx __tests__/opening_activity.test.ts
 */

import assert from 'node:assert/strict'
import {
  cashOpenUnixForYmd,
  NY_DESK_CLOCK,
  TOKYO_DESK_CLOCK,
  zonedCivilToUnix,
} from '../lib/chart/sessionVwap'
import {
  computeYesterdayProfile,
  type YesterdayBar,
} from '../lib/trading/yesterdayProfile'
import {
  computeOpeningActivity,
  formatOpeningActivityForPrompt,
  openingActivityBadgeText,
  openingActivityLineSpecs,
  openingActivityPaintKey,
  openingRefBuffer,
  OPENING_BAR_SEC,
  resolveOpeningAsOfUnix,
  touchesRef,
  type OpeningBar,
  type OpeningRefs,
} from '../lib/trading/openingActivity'

function rthBars(
  ymd: string,
  clock: typeof NY_DESK_CLOCK,
  make: (i: number, t: number) => {
    open: number
    high: number
    low: number
    close: number
  }
): YesterdayBar[] {
  const openU = cashOpenUnixForYmd(ymd, clock)
  const closeU = zonedCivilToUnix(ymd, clock.overnightStartHour, clock.timeZone)
  const out: YesterdayBar[] = []
  let i = 0
  for (let t = openU; t < closeU; t += 300) {
    const ohlc = make(i, t)
    out.push({ time: t, ...ohlc, volume: 1 })
    i += 1
  }
  return out
}

const friday = rthBars('2026-08-14', NY_DESK_CLOCK, (i) => {
  const mid = 42100
  if (i === 2) return { open: mid, high: 42200, low: 42090, close: 42110 }
  if (i === 40) return { open: mid, high: 42110, low: 42000, close: 42090 }
  const wobble = (i % 7) - 3
  const px = mid + wobble * 8
  return { open: px, high: px + 12, low: px - 12, close: px + 2 }
})

const mondayOpen = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
const fridayClose = zonedCivilToUnix(
  '2026-08-14',
  NY_DESK_CLOCK.overnightStartHour,
  NY_DESK_CLOCK.timeZone
)

const overnight: OpeningBar[] = []
for (let t = fridayClose; t < mondayOpen; t += 3600) {
  overnight.push({
    time: t,
    open: 42080,
    high: 42120,
    low: 41980,
    close: 42100,
    volume: 1,
  })
}

function mondayBars(
  rows: Array<{ open: number; high: number; low: number; close: number }>
): OpeningBar[] {
  return rows.map((ohlc, i) => ({
    time: mondayOpen + i * OPENING_BAR_SEC,
    ...ohlc,
    volume: 1,
  }))
}

function asOfAfterBars(nClosed: number): number {
  return mondayOpen + nClosed * OPENING_BAR_SEC
}

const emptyRefs: OpeningRefs = {
  yh: null,
  yl: null,
  vah: null,
  val: null,
  overnightHigh: null,
  overnightLow: null,
}

{
  const bars = mondayBars([
    { open: 42100, high: 42140, low: 42095, close: 42130 },
    { open: 42130, high: 42160, low: 42120, close: 42150 },
  ])
  const early = computeOpeningActivity({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: mondayOpen + 60,
    refs: emptyRefs,
  })
  assert.equal(early.type, 'WAITING', 'forming first bar cannot lock')
  assert.equal(openingActivityBadgeText(early), 'WAIT')
}

{
  const bars = mondayBars([
    { open: 42100, high: 42140, low: 42095, close: 42130 },
    { open: 42130, high: 42160, low: 42120, close: 42150 },
  ])
  const atBar1 = computeOpeningActivity({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: asOfAfterBars(1),
    refs: emptyRefs,
  })
  assert.equal(atBar1.type, 'WAITING', 'Drive waits for bar 2')
  assert.equal(atBar1.openPrice, 42100)
  assert.equal(atBar1.rangeLow, 42095)
  assert.equal(atBar1.rangeHigh, 42140)

  const drive = computeOpeningActivity({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: asOfAfterBars(2),
    refs: emptyRefs,
  })
  assert.equal(drive.type, 'OPEN_DRIVE')
  assert.equal(drive.direction, 'up')
  assert.equal(drive.failedDrive, false)
  assert.equal(openingActivityBadgeText(drive), 'DRIVE ↑')
  assert.ok(drive.playLine.includes('1.5R'))
  assert.ok(drive.playLine.includes('off-band'))
  assert.ok(formatOpeningActivityForPrompt(drive).includes('Open-Drive'))
}

{
  const bars = mondayBars([
    { open: 42100, high: 42130, low: 42070, close: 42100 },
    { open: 42100, high: 42120, low: 42080, close: 42105 },
  ])
  const mid = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfAfterBars(2),
    refs: emptyRefs,
  })
  assert.equal(mid.type, 'WAITING', 'centered first bar is not a Drive at 10 min')
}

{
  const bars = mondayBars([
    { open: 42100, high: 42130, low: 42070, close: 42100 },
    { open: 42105, high: 42125, low: 42085, close: 42110 },
    { open: 42110, high: 42135, low: 42090, close: 42100 },
  ])
  const auction = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfAfterBars(3),
    refs: emptyRefs,
  })
  assert.equal(auction.type, 'OPEN_AUCTION')
  assert.equal(openingActivityBadgeText(auction), 'AUCTION')
}

{
  const profile = computeYesterdayProfile({
    instrument: 'DOW',
    candles: friday,
    asOfUnix: fridayClose,
  })
  assert.ok(profile, 'Friday TPO after cash close')
  const refs: OpeningRefs = {
    yh: profile!.yh,
    yl: profile!.yl,
    vah: profile!.vah,
    val: profile!.val,
    overnightHigh: 42120,
    overnightLow: 41980,
  }
  const bars = mondayBars([
    { open: 42100, high: 42110, low: 42000, close: 42080 },
    { open: 42080, high: 42140, low: 42070, close: 42130 },
  ])
  const testDrive = computeOpeningActivity({
    instrument: 'DOW',
    candles: [...friday, ...overnight, ...bars],
    asOfUnix: asOfAfterBars(2),
    refs,
  })
  assert.equal(testDrive.type, 'OPEN_TEST_DRIVE')
  assert.equal(testDrive.direction, 'up')
  assert.equal(testDrive.testedRef, 'YL')
  assert.equal(openingActivityBadgeText(testDrive), 'TEST-DRIVE ↑')
}

{
  const bars = mondayBars([
    { open: 42100, high: 42115, low: 42040, close: 42070 },
    { open: 42070, high: 42150, low: 42060, close: 42135 },
  ])
  const rej = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfAfterBars(2),
    refs: emptyRefs,
  })
  assert.equal(rej.type, 'OPEN_REJECTION_REVERSE', 'probe missed known refs')
  assert.equal(rej.testedRef, null)
  assert.equal(openingActivityBadgeText(rej), 'REJ-REV')
}

{
  const bars = mondayBars([
    { open: 42100, high: 42140, low: 42095, close: 42130 },
    { open: 42130, high: 42160, low: 42120, close: 42150 },
    { open: 42150, high: 42155, low: 42080, close: 42090 },
  ])
  const locked = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfAfterBars(2),
    refs: emptyRefs,
  })
  assert.equal(locked.type, 'OPEN_DRIVE')
  const failed = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfAfterBars(3),
    refs: emptyRefs,
  })
  assert.equal(failed.failedDrive, true)
  assert.equal(failed.type, 'OPEN_REJECTION_REVERSE')
  assert.equal(openingActivityBadgeText(failed), 'DRIVE FAIL')
  assert.ok(failed.playLine.includes('DRIVE FAIL'))
}

{
  const tokyoOpen = cashOpenUnixForYmd('2026-08-17', TOKYO_DESK_CLOCK)
  const tokyoBars: OpeningBar[] = [
    {
      time: tokyoOpen,
      open: 38000,
      high: 38080,
      low: 37990,
      close: 38050,
      volume: 1,
    },
    {
      time: tokyoOpen + OPENING_BAR_SEC,
      open: 38050,
      high: 38120,
      low: 38040,
      close: 38100,
      volume: 1,
    },
  ]
  const drive = computeOpeningActivity({
    instrument: 'NIKKEI',
    candles: tokyoBars,
    asOfUnix: tokyoOpen + 2 * OPENING_BAR_SEC,
    refs: emptyRefs,
  })
  assert.equal(drive.sourceSession, 'TOKYO_CASH')
  assert.equal(drive.type, 'OPEN_DRIVE')
  assert.equal(drive.direction, 'up')
  const packed = formatOpeningActivityForPrompt(drive)
  assert.ok(packed.includes('not US Range'))
  assert.ok(packed.includes('Tokyo cash'))
}

{
  const sat = cashOpenUnixForYmd('2026-08-15', NY_DESK_CLOCK)
  const weekend = computeOpeningActivity({
    instrument: 'DOW',
    candles: friday,
    asOfUnix: sat + 600,
    refs: emptyRefs,
  })
  assert.equal(weekend.type, 'WAITING')
  assert.equal(weekend.sessionDate, null)
}

{
  const bars = mondayBars([
    { open: 42100, high: 42140, low: 42095, close: 42130 },
    { open: 42130, high: 42160, low: 42120, close: 42150 },
  ])
  const live = resolveOpeningAsOfUnix('DOW', mondayOpen, mondayOpen + 90 * 60)
  assert.equal(live, mondayOpen + 90 * 60)
  const simT = mondayOpen + 600
  const sim = resolveOpeningAsOfUnix('DOW', simT, simT)
  assert.equal(sim, simT)
  const classified = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: sim,
    refs: emptyRefs,
  })
  assert.equal(classified.type, 'OPEN_DRIVE')
}

{
  assert.ok(openingRefBuffer(42100) >= 8)
  assert.ok(touchesRef(42000, 42020, 42000))
  assert.equal(touchesRef(42100, 42120, 42000), false)
}

{
  const profile = computeYesterdayProfile({
    instrument: 'DOW',
    candles: friday,
    asOfUnix: fridayClose,
  })
  const refs: OpeningRefs = {
    yh: profile!.yh,
    yl: profile!.yl,
    vah: profile!.vah,
    val: profile!.val,
    overnightHigh: 42120,
    overnightLow: 41980,
  }
  const bars = mondayBars([
    { open: 42100, high: 42110, low: 42000, close: 42080 },
    { open: 42080, high: 42140, low: 42070, close: 42130 },
    { open: 42130, high: 42135, low: 42090, close: 42100 },
  ])
  const locked = computeOpeningActivity({
    instrument: 'DOW',
    candles: [...friday, ...overnight, ...bars],
    asOfUnix: asOfAfterBars(2),
    refs,
  })
  assert.equal(locked.type, 'OPEN_TEST_DRIVE')
  const failed = computeOpeningActivity({
    instrument: 'DOW',
    candles: [...friday, ...overnight, ...bars],
    asOfUnix: asOfAfterBars(3),
    refs,
  })
  assert.equal(failed.failedDrive, true, 'Test-Drive dies if price returns through the open')
  assert.equal(openingActivityBadgeText(failed), 'TD FAIL')
}

{
  const lateFirst: OpeningBar[] = [
    {
      time: mondayOpen + OPENING_BAR_SEC,
      open: 42100,
      high: 42140,
      low: 42095,
      close: 42130,
      volume: 1,
    },
    {
      time: mondayOpen + 2 * OPENING_BAR_SEC,
      open: 42130,
      high: 42160,
      low: 42120,
      close: 42150,
      volume: 1,
    },
  ]
  const drive = computeOpeningActivity({
    instrument: 'DOW',
    candles: lateFirst,
    asOfUnix: mondayOpen + 3 * OPENING_BAR_SEC,
    refs: emptyRefs,
  })
  assert.equal(drive.type, 'OPEN_DRIVE', 'missing 09:30 bar still classifies from first 10m print')
}

{
  const bars = mondayBars([
    { open: 42100, high: 42140, low: 42095, close: 42130 },
  ])
  const waiting = computeOpeningActivity({
    instrument: 'DOW',
    candles: bars,
    asOfUnix: asOfAfterBars(1),
    refs: emptyRefs,
  })
  const packed = formatOpeningActivityForPrompt(waiting)
  assert.ok(packed.includes('WAITING'), 'prompt keeps WAITING after first bar')
  assert.ok(packed.includes('42100'), 'prompt still prints the open while waiting')
  const specs = openingActivityLineSpecs(waiting)
  assert.equal(specs.some((s) => s.title === 'Open H'), true)
  assert.equal(specs.some((s) => s.title === 'OR H'), false)
  const dowKey = openingActivityPaintKey(true, waiting)
  const ndx = computeOpeningActivity({
    instrument: 'NASDAQ',
    candles: bars,
    asOfUnix: asOfAfterBars(1),
    refs: emptyRefs,
  })
  assert.notEqual(dowKey, openingActivityPaintKey(true, ndx), 'paint key includes instrument')
}

console.log('opening_activity: all passed')
