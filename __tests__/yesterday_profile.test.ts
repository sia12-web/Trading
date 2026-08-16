/**
 * Yesterday profile — TPO value, open type, superimpose ±10%.
 * Run: npx tsx __tests__/yesterday_profile.test.ts
 */

import assert from 'node:assert/strict'
import {
  cashOpenUnixForYmd,
  NY_DESK_CLOCK,
  TOKYO_DESK_CLOCK,
  zonedCivilToUnix,
} from '../lib/chart/sessionVwap'
import {
  buildTpoValueArea,
  classifyOpen,
  computeYesterdayProfile,
  formatYesterdayProfileForPrompt,
  resolveSuperimpose,
  resolveYesterdayAsOfUnix,
  type YesterdayBar,
} from '../lib/trading/yesterdayProfile'

function rthBars(
  ymd: string,
  clock: typeof NY_DESK_CLOCK,
  make: (i: number, t: number) => { open: number; high: number; low: number; close: number }
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

/** Friday 2026-08-14 clustered around 42100 with one spike each side. */
const friday = rthBars('2026-08-14', NY_DESK_CLOCK, (i) => {
  const mid = 42100
  if (i === 2) return { open: mid, high: 42200, low: 42090, close: 42110 }
  if (i === 40) return { open: mid, high: 42110, low: 42000, close: 42090 }
  const wobble = (i % 7) - 3
  const px = mid + wobble * 8
  return { open: px, high: px + 12, low: px - 12, close: px + 2 }
})

const va = buildTpoValueArea(
  friday,
  cashOpenUnixForYmd('2026-08-14', NY_DESK_CLOCK),
  zonedCivilToUnix('2026-08-14', NY_DESK_CLOCK.overnightStartHour, NY_DESK_CLOCK.timeZone)
)
assert.ok(va, 'Friday TPO value area')
assert.equal(va!.yh, 42200)
assert.equal(va!.yl, 42000)
assert.ok(va!.priorRangePoints === 200, `R=${va!.priorRangePoints}`)
assert.ok(va!.poc >= va!.val && va!.poc <= va!.vah, 'POC inside value')
assert.ok(va!.val > va!.yl, 'value tighter than full range (low spike)')
assert.ok(va!.vah < va!.yh, 'value tighter than full range (high spike)')

assert.equal(classifyOpen(va!.poc, 1, 0, va!), 'IN_VALUE')
assert.equal(classifyOpen(va!.yh - 1, 1, 0, va!), 'IN_RANGE')
assert.equal(classifyOpen(va!.yh + 10, 1, 0, va!), 'OUTSIDE_RANGE')
assert.equal(classifyOpen(42100, 10, 20, va!), 'WAITING')

/** Monday session: open inside value, IB holds the low, price auctions up. */
function mondayBars(openPx: number): YesterdayBar[] {
  const openU = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
  const closeU = zonedCivilToUnix('2026-08-17', NY_DESK_CLOCK.overnightStartHour, NY_DESK_CLOCK.timeZone)
  const out: YesterdayBar[] = []
  let i = 0
  for (let t = openU; t < closeU; t += 300) {
    if (i < 12) {
      // First hour: buying tail at the low, close back up
      const low = openPx - 40
      const high = openPx + 15
      const open = i === 0 ? openPx : openPx - 10
      const close = openPx + 5
      out.push({
        time: t,
        open,
        high,
        low: i === 1 ? low : openPx - 12,
        close,
        volume: 1,
      })
    } else {
      const px = openPx + Math.min(80, (i - 12) * 4)
      out.push({
        time: t,
        open: px,
        high: px + 8,
        low: px - 6,
        close: px + 3,
        volume: 1,
      })
    }
    i += 1
  }
  return out
}

{
  const monday = mondayBars(va!.poc)
  const asOf = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK) + 90 * 60
  const profile = computeYesterdayProfile({
    instrument: 'DOW',
    candles: [...friday, ...monday],
    asOfUnix: asOf,
  })
  assert.ok(profile, 'DOW profile')
  assert.equal(profile!.sourceSession, 'NY_RTH')
  assert.equal(profile!.sessionDate, '2026-08-14')
  assert.equal(profile!.openType, 'IN_VALUE')
  assert.equal(profile!.yh, 42200)
  assert.ok(profile!.slTpAdvice.includes('1.5R'))
  assert.ok(profile!.slTpAdvice.includes('$400'))
  assert.ok(formatYesterdayProfileForPrompt(profile).includes('YESTERDAY PROFILE'))
  assert.ok(profile!.superimpose === 'READY' || profile!.superimpose === 'WAITING')
  if (profile!.superimpose === 'READY') {
    assert.ok(profile!.holdingSide === 'low', 'holding the IB low')
    assert.ok(profile!.bandMin != null && profile!.bandMax != null)
    const width = profile!.bandMax! - profile!.bandMin!
    assert.ok(Math.abs(width - 40) < 0.2, `10% of R=200 is 40 pts, got ${width}`)
  }
}

{
  const monday = mondayBars(va!.yh + 25)
  const asOf = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK) + 10 * 60
  const profile = computeYesterdayProfile({
    instrument: 'DOW',
    candles: [...friday, ...monday],
    asOfUnix: asOf,
  })
  assert.equal(profile?.openType, 'OUTSIDE_RANGE')
  assert.equal(profile?.superimpose, 'WAITING', 'no superimpose before IB locks')
  assert.ok(profile?.playLine.includes('floor on potential'))
}

{
  const beforeOpen = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK) - 600
  const profile = computeYesterdayProfile({
    instrument: 'DOW',
    candles: friday,
    asOfUnix: beforeOpen,
  })
  assert.equal(profile?.openType, 'WAITING')
  assert.equal(profile?.sessionDate, '2026-08-14')
}

{
  const tokyoFri = rthBars('2026-08-14', TOKYO_DESK_CLOCK, (i) => {
    const mid = 38000
    if (i === 3) return { open: mid, high: 38150, low: 37980, close: 38020 }
    if (i === 20) return { open: mid, high: 38020, low: 37850, close: 37990 }
    const px = mid + ((i % 5) - 2) * 6
    return { open: px, high: px + 8, low: px - 8, close: px }
  })
  const tokyoMonOpen = cashOpenUnixForYmd('2026-08-17', TOKYO_DESK_CLOCK)
  const tokyoMon: YesterdayBar[] = []
  for (let t = tokyoMonOpen; t < tokyoMonOpen + 2 * 3600; t += 300) {
    tokyoMon.push({
      time: t,
      open: 38000,
      high: 38030,
      low: 37970,
      close: 38010,
      volume: 1,
    })
  }
  const profile = computeYesterdayProfile({
    instrument: 'NIKKEI',
    candles: [...tokyoFri, ...tokyoMon],
    asOfUnix: tokyoMonOpen + 900,
  })
  assert.ok(profile, 'Nikkei profile')
  assert.equal(profile!.sourceSession, 'TOKYO_CASH')
  assert.equal(profile!.sessionDate, '2026-08-14')
  assert.ok(profile!.yh !== 0)
  const packed = formatYesterdayProfileForPrompt(profile)
  assert.ok(packed.includes('not US Range'), 'Nikkei yesterday is Tokyo cash, not US Range')
}

{
  const ib = {
    high: 42120,
    low: 42060,
    openUnix: cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK),
    endUnix: cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK) + 3600,
    fromTime: cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK),
    toTime: cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK) + 3300,
  }
  const openU = ib.openUnix
  const bars: YesterdayBar[] = []
  for (let t = openU; t < openU + 90 * 60; t += 300) {
    const hour = t < ib.endUnix
    bars.push({
      time: t,
      open: hour ? 42080 : 42140,
      high: hour ? 42120 : 42180,
      low: hour ? 42060 : 42120,
      close: hour ? 42100 : 42150,
      volume: 1,
    })
  }
  const sup = resolveSuperimpose({
    va: va!,
    ib,
    candles: bars,
    asOfUnix: openU + 90 * 60,
    sessionOpenUnix: openU,
    tip: 42150,
  })
  assert.equal(sup.status, 'READY')
  assert.equal(sup.holdingSide, 'low')
  assert.equal(sup.holdingExtreme, 42060)
  assert.equal(sup.exact, 42260)
  assert.equal(sup.bandMin, 42240)
  assert.equal(sup.bandMax, 42280)
}

{
  const mondayOpen = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
  const fridayClose = zonedCivilToUnix(
    '2026-08-14',
    NY_DESK_CLOCK.overnightStartHour,
    NY_DESK_CLOCK.timeZone
  )
  const lastFri = fridayClose - 300
  const asOfLive = resolveYesterdayAsOfUnix(
    'DOW',
    lastFri,
    mondayOpen + 90 * 60
  )
  assert.equal(asOfLive, mondayOpen + 90 * 60, 'live RTH uses wall clock so IB can lock')
  const asOfSim = resolveYesterdayAsOfUnix('DOW', mondayOpen + 600, mondayOpen + 600)
  assert.equal(asOfSim, mondayOpen + 600, 'sim asOf stays on replay time')
  const weekend = resolveYesterdayAsOfUnix(
    'DOW',
    lastFri,
    cashOpenUnixForYmd('2026-08-15', NY_DESK_CLOCK)
  )
  assert.equal(weekend, lastFri, 'weekend does not jump asOf to Saturday RTH')
}

{
  const saturday = rthBars('2026-08-15', NY_DESK_CLOCK, () => ({
    open: 50000,
    high: 50100,
    low: 49900,
    close: 50050,
  }))
  const profile = computeYesterdayProfile({
    instrument: 'DOW',
    candles: [...friday, ...saturday],
    asOfUnix: cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK) + 600,
  })
  assert.equal(profile?.sessionDate, '2026-08-14', 'Saturday prints are not a cash session')
  assert.notEqual(profile?.yh, 50100)
}

console.log('yesterday_profile: all passed')
