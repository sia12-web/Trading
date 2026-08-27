/**
 * Stay-out (NTREND / NCONV) — CALL WAIT after OR30. No flatten.
 * Run: npx tsx __tests__/desk_stay_out.test.ts
 */

import assert from 'node:assert/strict'
import { cashOpenUnixForYmd, NY_DESK_CLOCK } from '../lib/chart/sessionVwap'
import { computeDeskCall, type DeskCallBar } from '../lib/trading/deskCall'
import { computeDeskStayOut } from '../lib/trading/deskStayOut'

function rthBars(
  ymd: string,
  make: (i: number, t: number) => {
    open: number
    high: number
    low: number
    close: number
    volume?: number
  }
): DeskCallBar[] {
  const openU = cashOpenUnixForYmd(ymd, NY_DESK_CLOCK)
  const closeU = openU + 6.5 * 3600
  const out: DeskCallBar[] = []
  let i = 0
  for (let t = openU; t < closeU; t += 300) {
    out.push({ time: t, ...make(i, t) })
    i += 1
  }
  return out
}

function wideDay(ymd: string, vol = 5000): DeskCallBar[] {
  return rthBars(ymd, () => ({
    open: 42100,
    high: 42300,
    low: 41900,
    close: 42120,
    volume: vol,
  }))
}

function squatDay(ymd: string, vol = 40): DeskCallBar[] {
  return rthBars(ymd, () => ({
    open: 42100,
    high: 42112,
    low: 42088,
    close: 42101,
    volume: vol,
  }))
}

const priors = [
  '2026-08-03',
  '2026-08-04',
  '2026-08-05',
  '2026-08-06',
  '2026-08-07',
  '2026-08-10',
  '2026-08-11',
  '2026-08-12',
  '2026-08-13',
  '2026-08-14',
].flatMap((ymd) => wideDay(ymd))

const monday = '2026-08-17'
const openU = cashOpenUnixForYmd(monday, NY_DESK_CLOCK)
const or30Unix = openU + 35 * 60
const morningUnix = openU + 18 * 60

const squatHist = [...priors, ...squatDay(monday)]

const morning = computeDeskStayOut({
  instrument: 'DOW',
  candles: squatHist,
  asOfUnix: morningUnix,
  playbookMode: 'morning',
  openingType: 'OPEN_AUCTION',
  controlLabel: 'WAIT',
  ydayOpenType: 'IN_VALUE',
  ydayVah: 42200,
  ydayVal: 42000,
})
assert.equal(morning.kind, 'NONE', 'morning never stay-out')
assert.equal(morning.vetoCall, false)

const ntrend = computeDeskStayOut({
  instrument: 'DOW',
  candles: squatHist,
  asOfUnix: or30Unix,
  playbookMode: 'or30',
  openingType: 'OPEN_DRIVE',
  controlLabel: 'ONE-TF BUY',
  ydayOpenType: 'IN_VALUE',
  ydayVah: 42200,
  ydayVal: 42000,
})
assert.equal(ntrend.kind, 'NTREND', 'squat + low volume at OR30')
assert.equal(ntrend.vetoCall, true)
assert.equal(ntrend.badgeText, 'OUT · NTREND')

const wideHist = [...priors, ...wideDay(monday, 5000)]
const notTrend = computeDeskStayOut({
  instrument: 'DOW',
  candles: wideHist,
  asOfUnix: or30Unix,
  playbookMode: 'or30',
  openingType: 'OPEN_DRIVE',
  controlLabel: 'ONE-TF BUY',
  ydayOpenType: 'IN_RANGE',
  ydayVah: 42300,
  ydayVal: 41900,
})
assert.equal(notTrend.kind, 'NONE', 'normal range + matching volume is not NTREND')

const nconv = computeDeskStayOut({
  instrument: 'DOW',
  candles: squatHist,
  asOfUnix: or30Unix,
  playbookMode: 'or30',
  openingType: 'OPEN_AUCTION',
  controlLabel: 'TWO-TF',
  ydayOpenType: 'IN_VALUE',
  ydayVah: 42200,
  ydayVal: 42000,
})
assert.equal(nconv.kind, 'NTREND', 'NTREND wins when both could apply')
assert.equal(nconv.vetoCall, true)

const nconvOnly = computeDeskStayOut({
  instrument: 'DOW',
  candles: wideHist,
  asOfUnix: or30Unix,
  playbookMode: 'or30',
  openingType: 'OPEN_AUCTION',
  controlLabel: 'WAIT',
  ydayOpenType: 'IN_VALUE',
  ydayVah: 42350,
  ydayVal: 41850,
})
assert.equal(nconvOnly.kind, 'NCONV', 'auction in value, not ONE-TF, still inside yVA')
assert.equal(nconvOnly.badgeText, 'OUT · NCONV')

const oneTf = computeDeskStayOut({
  instrument: 'DOW',
  candles: wideHist,
  asOfUnix: or30Unix,
  playbookMode: 'or30',
  openingType: 'OPEN_AUCTION',
  controlLabel: 'ONE-TF SELL',
  ydayOpenType: 'IN_VALUE',
  ydayVah: 42350,
  ydayVal: 41850,
})
assert.equal(oneTf.kind, 'NONE', 'ONE-TF is not nonconviction')

const gated = computeDeskCall({
  instrument: 'DOW',
  candles: squatHist,
  asOfUnix: or30Unix,
  playbookMode: 'or30',
  stayOutEnabled: true,
})
assert.equal(gated.side, 'WAIT')
assert.equal(gated.stayOutVeto, true)
assert.ok((gated.stayOutBadge || '').startsWith('OUT'))

const baseline = computeDeskCall({
  instrument: 'DOW',
  candles: squatHist,
  asOfUnix: or30Unix,
  playbookMode: 'or30',
  stayOutEnabled: false,
})
assert.equal(baseline.stayOutVeto, false)
assert.equal(baseline.stayOutKind, 'NONE')

const morningCall = computeDeskCall({
  instrument: 'DOW',
  candles: squatHist,
  asOfUnix: morningUnix,
  playbookMode: 'morning',
  stayOutEnabled: true,
})
assert.notEqual(morningCall.stayOutKind, 'NTREND')
assert.notEqual(morningCall.stayOutKind, 'NCONV')
assert.equal(morningCall.stayOutVeto, false)

console.log('desk_stay_out.test.ts: all assertions passed')
