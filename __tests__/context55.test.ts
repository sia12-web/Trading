import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  compute5DayFixedRangeVolumeProfile,
  compute5MonthAnchoredVwap,
  compute5MonthAnchoredVwapFromDailyBars,
  computeYesterdayNycSession,
  computeOvernightInventoryAndSessions,
  classifyMarketDayType,
  get5DayAnchorUnix,
  get5MonthAnchorUnix,
  type ContextBar,
} from '../lib/chart/context55'
import { NY_DESK_CLOCK } from '../lib/chart/sessionVwap'

describe('Context 5-5 Module Tests', () => {
  it('identifies 5-day anchor accurately at cash open (09:30 America/New_York)', () => {
    // 2026-09-07 (Monday) -> 4 trading days prior is 2026-09-01 (Tuesday)
    const asOf = Math.floor(new Date('2026-09-07T14:00:00Z').getTime() / 1000)
    const anchor = get5DayAnchorUnix(asOf, NY_DESK_CLOCK)
    assert.ok(anchor > 0)
    const dt = new Date(anchor * 1000)
    // In America/New_York (UTC-4 in Sep), 09:30 EDT is 13:30 UTC
    assert.equal(dt.getUTCHours(), 13)
    assert.equal(dt.getUTCMinutes(), 30)
  })

  it('identifies 5-month anchor accurately at cash open', () => {
    const asOf = Math.floor(new Date('2026-09-07T14:00:00Z').getTime() / 1000)
    const anchor = get5MonthAnchorUnix(asOf, NY_DESK_CLOCK)
    assert.ok(anchor > 0)
    assert.ok(anchor < asOf - 120 * 24 * 3600)
  })

  it('computes 5-Day Fixed Range Volume Profile with POC and 70% Value Area', () => {
    const now = Math.floor(new Date('2026-09-07T14:00:00Z').getTime() / 1000)
    const anchor = get5DayAnchorUnix(now, NY_DESK_CLOCK)

    const bars: ContextBar[] = []
    // Generate synthetic bars from anchor forward
    for (let t = anchor; t <= now; t += 300) {
      bars.push({
        time: t,
        open: 44000,
        high: 44050,
        low: 43950,
        close: 44010,
        volume: t === anchor + 300 * 5 ? 5000 : 100,
      })
    }

    const frvp = compute5DayFixedRangeVolumeProfile(bars, 'DOW', now)
    assert.ok(frvp !== null)
    assert.ok(frvp.poc >= 43950 && frvp.poc <= 44050)
    assert.ok(frvp.vah >= frvp.poc)
    assert.ok(frvp.val <= frvp.poc)
    assert.ok(frvp.bins.length > 0)
    assert.ok(frvp.totalVolume > 0)
  })

  it('computes 5-Month Anchored VWAP with standard deviation bands', () => {
    const now = Math.floor(new Date('2026-09-07T14:00:00Z').getTime() / 1000)
    const anchor = get5MonthAnchorUnix(now, NY_DESK_CLOCK)

    const bars: ContextBar[] = [
      { time: anchor, open: 40000, high: 40100, low: 39900, close: 40050, volume: 1000 },
      { time: anchor + 3600, open: 40050, high: 40200, low: 40000, close: 40150, volume: 1500 },
      { time: now, open: 44000, high: 44100, low: 43900, close: 44050, volume: 2000 },
    ]

    const res = compute5MonthAnchoredVwap({ bars, instrument: 'DOW', asOfUnix: now })
    assert.ok(res !== null)
    assert.ok(res.vwap.length > 0)
    assert.ok(res.upper1.length === res.vwap.length)
    assert.ok(res.lower1.length === res.vwap.length)
    assert.ok(res.upper2.length === res.vwap.length)
    assert.ok(res.lower2.length === res.vwap.length)
    assert.ok(res.upper1[0]!.value >= res.vwap[0]!.value)
    assert.ok(res.lower1[0]!.value <= res.vwap[0]!.value)
  })

  it('classifies Dalton Day Type properly', () => {
    const now = Math.floor(new Date('2026-09-07T14:00:00Z').getTime() / 1000)
    const bars: ContextBar[] = []
    for (let i = 0; i < 15; i++) {
      bars.push({
        time: now - (15 - i) * 300,
        open: 44000 + i * 10,
        high: 44020 + i * 10,
        low: 43990 + i * 10,
        close: 44015 + i * 10,
        volume: 200,
      })
    }

    const res = classifyMarketDayType({
      todayBars: bars,
      controlLabel: 'ONE-TF BUY',
      instrument: 'DOW',
      asOfUnix: now,
    })
    assert.equal(res.type, 'TREND_BULL')
    assert.equal(res.badgeText, 'Trend Day (Bull)')
  })

  it('computes 5-Month Anchored VWAP benchmark from 6mo daily bars', () => {
    const now = Math.floor(new Date('2026-09-07T14:00:00Z').getTime() / 1000)
    const dailyBars: ContextBar[] = []
    // 180 calendar days (~6 months)
    for (let i = 180; i >= 0; i--) {
      const t = now - i * 86400
      dailyBars.push({
        time: t,
        open: 40000 + (180 - i) * 30,
        high: 40100 + (180 - i) * 30,
        low: 39950 + (180 - i) * 30,
        close: 40050 + (180 - i) * 30,
        volume: 50000,
      })
    }

    const benchmark = compute5MonthAnchoredVwapFromDailyBars(dailyBars, now, NY_DESK_CLOCK)
    assert.ok(benchmark !== null)
    assert.ok(benchmark.vwap > 40000)
    assert.ok(benchmark.sigma1Upper > benchmark.vwap)
    assert.ok(benchmark.sigma1Lower < benchmark.vwap)
    assert.ok(benchmark.sigma2Upper > benchmark.sigma1Upper)
    assert.ok(benchmark.sigma2Lower < benchmark.sigma1Lower)
    assert.ok(benchmark.barCount >= 50)
  })

  it('computes Yesterday NYC Session accurately', () => {
    // 2026-09-04 is Friday (EDT, UTC-4). Cash open 09:30 EDT = 13:30 UTC. Cash close 16:00 EDT = 20:00 UTC.
    // 2026-09-07 is Monday.
    const friOpenUnix = Math.floor(new Date('2026-09-04T13:30:00Z').getTime() / 1000)
    const friCloseUnix = Math.floor(new Date('2026-09-04T20:00:00Z').getTime() / 1000)
    const monNowUnix = Math.floor(new Date('2026-09-07T14:00:00Z').getTime() / 1000)

    const bars: ContextBar[] = []
    for (let t = friOpenUnix; t <= friCloseUnix; t += 300) {
      bars.push({
        time: t,
        open: 44100,
        high: 44250,
        low: 43900,
        close: 44150,
        volume: t === friOpenUnix + 300 * 10 ? 10000 : 500,
      })
    }

    const yday = computeYesterdayNycSession(bars, monNowUnix, NY_DESK_CLOCK)
    assert.ok(yday !== null)
    assert.equal(yday.sessionDate, '2026-09-04')
    assert.equal(yday.yh, 44250)
    assert.equal(yday.yl, 43900)
    assert.equal(yday.close, 44150)
    assert.ok(yday.poc >= 43800 && yday.poc <= 44300)
    assert.ok(yday.vah >= yday.poc)
    assert.ok(yday.val <= yday.poc)
  })

  it('computes Overnight Inventory and Asia & London FRVP', () => {
    const friOpenUnix = Math.floor(new Date('2026-09-04T13:30:00Z').getTime() / 1000)
    const friCloseUnix = Math.floor(new Date('2026-09-04T20:00:00Z').getTime() / 1000)
    const monNowUnix = Math.floor(new Date('2026-09-07T14:00:00Z').getTime() / 1000)

    const bars: ContextBar[] = []
    // Friday bars
    for (let t = friOpenUnix; t <= friCloseUnix; t += 300) {
      bars.push({
        time: t,
        open: 44000,
        high: 44100,
        low: 43900,
        close: 44000,
        volume: 1000,
      })
    }

    const yday = computeYesterdayNycSession(bars, monNowUnix, NY_DESK_CLOCK)!
    assert.ok(yday !== null)

    // Add overnight bars for Asia (18:00 - 03:00) and London (03:00 - 09:30)
    // All trades happen ABOVE Friday close (44000), making inventory 100% Long
    const sunGlobexOpen = Math.floor(new Date('2026-09-06T22:00:00Z').getTime() / 1000) // 18:00 EDT Sun
    for (let t = sunGlobexOpen; t < monNowUnix; t += 300) {
      bars.push({
        time: t,
        open: 44050,
        high: 44150,
        low: 44020,
        close: 44080,
        volume: 500,
      })
    }

    const inv = computeOvernightInventoryAndSessions({
      bars,
      yesterday: yday,
      asOfUnix: monNowUnix,
      clock: NY_DESK_CLOCK,
    })

    assert.ok(inv !== null)
    assert.ok(inv.asia !== null)
    assert.ok(inv.london !== null)
    assert.ok(inv.overnight !== null)
    assert.equal(inv.pctLong, 100)
    assert.equal(inv.bias, '100%_NET_LONG')
    assert.ok(inv.summaryBadge.includes('100% Long'))
  })
})
