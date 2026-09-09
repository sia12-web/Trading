import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  compute5DayFixedRangeVolumeProfile,
  compute5MonthAnchoredVwap,
  compute5MonthAnchoredVwapFromDailyBars,
  compute5MonthAnchoredVwapPath,
  typicalPriceStdev,
  computeYesterdayNycSession,
  computeOvernightInventoryAndSessions,
  classifyMarketDayType,
  detectMultiTimeframeOpportunities,
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
    assert.ok((benchmark.sigma3Upper ?? 0) > benchmark.sigma2Upper)
    assert.ok((benchmark.sigma3Lower ?? 0) < benchmark.sigma2Lower)
    const sigma = benchmark.sigma1Upper - benchmark.vwap
    assert.ok(Math.abs((benchmark.sigma3Upper ?? 0) - (benchmark.vwap + 3 * sigma)) < 0.05)
    assert.ok(benchmark.barCount >= 50)
    assert.ok((benchmark.sumV ?? 0) > 0)
    assert.ok((benchmark.lastBarUnix ?? 0) > 0)
  })

  it('walks 5-month AVWAP as a moving path through 5m bars, not a flat line', () => {
    const now = Math.floor(new Date('2026-09-07T14:00:00Z').getTime() / 1000)
    const dailyBars: ContextBar[] = []
    for (let i = 160; i >= 8; i--) {
      const t = now - i * 86400
      dailyBars.push({
        time: t,
        open: 40000,
        high: 40100,
        low: 39900,
        close: 40050,
        volume: 80000,
      })
    }
    const bars: ContextBar[] = []
    const start = now - 6 * 86400
    for (let i = 0; i < 40; i++) {
      const px = 41000 + i * 40
      bars.push({
        time: start + i * 300,
        open: px,
        high: px + 20,
        low: px - 20,
        close: px + 10,
        volume: 5000,
      })
    }
    const path = compute5MonthAnchoredVwapPath({
      dailyBars,
      bars,
      instrument: 'DOW',
      asOfUnix: now,
    })
    assert.ok(path !== null)
    assert.equal(path.vwap.length, bars.length)
    assert.equal(path.upper1.length, bars.length)
    const first = path.vwap[0]!.value
    const last = path.vwap[path.vwap.length - 1]!.value
    assert.ok(last > first, 'running 5M VWAP rises with the 5m trend')
    const unique = new Set(path.vwap.map((p) => p.value))
    assert.ok(unique.size > 5, 'VWAP is not a single flat level')
    assert.ok(path.upper3.length === bars.length)
    assert.ok(path.lower3.length === bars.length)
    const u1 = path.upper1[path.upper1.length - 1]!.value
    const v = path.vwap[path.vwap.length - 1]!.value
    const u3 = path.upper3[path.upper3.length - 1]!.value
    const sigma = u1 - v
    assert.ok(Math.abs(u3 - (v + 3 * sigma)) < 0.05, '±3σ is three standard deviations (HLC/3)')
    const windowSigma = typicalPriceStdev(bars)
    // Synthetic path is only 40 bars / ~3h, so recentBarsForSigma === bars
    assert.ok(Math.abs(sigma - windowSigma) < 0.05, 'overlay σ is recent 5m volatility, not 5-month daily variance')
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

  it('skips US Exchange Holidays (e.g. Labor Day Sept 7) and anchors to the prior active trading day (Sept 4)', () => {
    // 2026-09-08 (Tuesday EDT). 2026-09-07 is Labor Day (US Holiday).
    // The prior active trading day must be Friday 2026-09-04.
    const friOpenUnix = Math.floor(new Date('2026-09-04T13:30:00Z').getTime() / 1000)
    const friCloseUnix = Math.floor(new Date('2026-09-04T20:00:00Z').getTime() / 1000)
    const tueNowUnix = Math.floor(new Date('2026-09-08T14:00:00Z').getTime() / 1000)

    const bars: ContextBar[] = []
    // Friday bars (Active trading day)
    for (let t = friOpenUnix; t <= friCloseUnix; t += 300) {
      bars.push({
        time: t,
        open: 44100,
        high: 44250,
        low: 43900,
        close: 44150,
        volume: 500,
      })
    }

    const yday = computeYesterdayNycSession(bars, tueNowUnix, NY_DESK_CLOCK)
    assert.ok(yday !== null)
    // Must anchor to Friday 2026-09-04, skipping Labor Day 2026-09-07
    assert.equal(yday.sessionDate, '2026-09-04')
  })

  it('computes Overnight Inventory and Asia & London FRVP', () => {
    // Tuesday 10:00 ET after Labor Day — inventory belongs to Tuesday 09:30,
    // starting Monday 18:00 (Sunday 18:00 was not a Monday cash open).
    const friOpenUnix = Math.floor(new Date('2026-09-04T13:30:00Z').getTime() / 1000)
    const friCloseUnix = Math.floor(new Date('2026-09-04T20:00:00Z').getTime() / 1000)
    const tueNowUnix = Math.floor(new Date('2026-09-08T14:00:00Z').getTime() / 1000)

    const bars: ContextBar[] = []
    // Friday bars (prior RTH — Labor Day skipped)
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

    const yday = computeYesterdayNycSession(bars, tueNowUnix, NY_DESK_CLOCK)!
    assert.ok(yday !== null)

    // Monday 18:00 ET → Tuesday cash open. All prints above Friday close → 100% Long
    const inventoryOpen = Math.floor(new Date('2026-09-07T22:00:00Z').getTime() / 1000)
    for (let t = inventoryOpen; t < tueNowUnix; t += 300) {
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
      asOfUnix: tueNowUnix,
      clock: NY_DESK_CLOCK,
    })

    assert.ok(inv !== null)
    assert.ok(inv.asia !== null)
    assert.ok(inv.london !== null)
    assert.ok(inv.overnight !== null)
    assert.ok(yday.bins && yday.bins.length > 0)
    assert.ok(inv.overnight.bins && inv.overnight.bins.length > 0)
    assert.equal(inv.pctLong, 100)
    assert.equal(inv.bias, '100%_NET_LONG')
    assert.ok(inv.summaryBadge.includes('100% Long'))
  })

  it('prints overnight inventory FRVP during Tokyo hours before London opens', () => {
    const friOpenUnix = Math.floor(new Date('2026-09-04T13:30:00Z').getTime() / 1000)
    const friCloseUnix = Math.floor(new Date('2026-09-04T20:00:00Z').getTime() / 1000)
    const inventoryOpen = Math.floor(new Date('2026-09-07T22:00:00Z').getTime() / 1000) // Mon 18:00 ET
    const tokyoTip = Math.floor(new Date('2026-09-08T05:00:00Z').getTime() / 1000) // 01:00 EDT Tuesday

    const bars: ContextBar[] = []
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
    for (let t = inventoryOpen; t <= tokyoTip; t += 300) {
      bars.push({
        time: t,
        open: 44050,
        high: 44150,
        low: 44020,
        close: 44080,
        volume: 500,
      })
    }

    const yday = computeYesterdayNycSession(bars, tokyoTip, NY_DESK_CLOCK)
    assert.ok(yday !== null)
    const inv = computeOvernightInventoryAndSessions({
      bars,
      yesterday: yday,
      asOfUnix: tokyoTip,
      clock: NY_DESK_CLOCK,
    })
    assert.ok(inv !== null, 'inventory FRVP must exist when waking up in Tokyo')
    assert.ok(inv.asia !== null)
    assert.equal(inv.london, null, 'London FRVP waits for 03:00 ET')
    assert.ok(inv.overnight !== null)
    assert.ok(inv.overnight.bins && inv.overnight.bins.length > 0)
  })

  it('starts a new overnight inventory FRVP after NYC 16:00 until next 09:30', () => {
    const monOpen = Math.floor(new Date('2026-09-09T13:30:00Z').getTime() / 1000)
    const monClose = Math.floor(new Date('2026-09-09T20:00:00Z').getTime() / 1000)
    const monAsia = Math.floor(new Date('2026-09-09T22:00:00Z').getTime() / 1000)
    const monEve = Math.floor(new Date('2026-09-10T02:00:00Z').getTime() / 1000) // 22:00 EDT Wednesday

    const bars: ContextBar[] = []
    for (let t = monOpen; t < monClose; t += 300) {
      bars.push({
        time: t,
        open: 44000,
        high: 44100,
        low: 43900,
        close: 44020,
        volume: 800,
      })
    }
    for (let t = monAsia; t <= monEve; t += 300) {
      bars.push({
        time: t,
        open: 44040,
        high: 44120,
        low: 44010,
        close: 44080,
        volume: 400,
      })
    }

    const yday = computeYesterdayNycSession(bars, monEve, NY_DESK_CLOCK)
    assert.ok(yday !== null, 'today RTH becomes yesterday after 16:00')
    assert.equal(yday.sessionDate, '2026-09-09')
    const inv = computeOvernightInventoryAndSessions({
      bars,
      yesterday: yday,
      asOfUnix: monEve,
      clock: NY_DESK_CLOCK,
    })
    assert.ok(inv !== null, 'new overnight FRVP after cash close')
    assert.ok(inv.overnight !== null)
    assert.ok(inv.overnight.startUnix >= monAsia - 60)
    assert.ok(inv.overnight.endUnix > monAsia)
    assert.ok(inv.overnight.endUnix <= monEve + 60)
  })

  it('promotes today’s RTH to yesterday at 16:00 even if the last 5m bar is 15:55', () => {
    const open = Math.floor(new Date('2026-09-09T13:30:00Z').getTime() / 1000)
    const lastBar = Math.floor(new Date('2026-09-09T19:55:00Z').getTime() / 1000)
    const asOf = Math.floor(new Date('2026-09-09T20:05:00Z').getTime() / 1000)
    const bars: ContextBar[] = []
    for (let t = open; t <= lastBar; t += 300) {
      bars.push({
        time: t,
        open: 44000,
        high: 44100,
        low: 43900,
        close: 44020,
        volume: 800,
      })
    }
    const yday = computeYesterdayNycSession(bars, asOf, NY_DESK_CLOCK)
    assert.ok(yday !== null)
    assert.equal(yday.sessionDate, '2026-09-09')
  })

  it('detects multi-timeframe money opportunities and confluences', () => {
    const opps = detectMultiTimeframeOpportunities({
      currentPrice: 44005,
      avwap5m: {
        anchorDate: '2026-04-01',
        anchorUnix: 1775000000,
        vwap: 43500,
        sigma1Upper: 44000,
        sigma1Lower: 43000,
        sigma2Upper: 44500,
        sigma2Lower: 42500,
      },
      frvp5d: {
        startUnix: 1788000000,
        endUnix: 1788876000,
        high: 44300,
        low: 43700,
        poc: 44000,
        vah: 44200,
        val: 43850,
        totalVolume: 50000,
        bins: [],
        bucketSize: 5,
        hvn: [],
        lvn: [],
      },
      yesterday: {
        sessionDate: '2026-09-04',
        yh: 44250,
        yl: 43900,
        close: 43950,
        poc: 44000,
        vah: 44150,
        val: 43920,
        volume: 20000,
        openUnix: 1788700000,
        closeUnix: 1788730000,
        bins: [],
      },
      overnight: {
        asia: null,
        london: null,
        overnight: {
          name: 'Overnight',
          startUnix: 1788740000,
          endUnix: 1788800000,
          high: 44100,
          low: 43980,
          poc: 44010,
          vah: 44060,
          val: 43990,
          totalVolume: 8000,
          bins: [],
        },
        totalVolume: 8000,
        volumeAboveClose: 8000,
        volumeBelowClose: 0,
        pctLong: 100,
        pctShort: 0,
        bias: '100%_NET_LONG',
        biasLabel: '100% Long',
        rangeRelation: 'IN_RANGE',
        rangeLabel: 'In-Range',
        summaryBadge: '100% Long',
        description: 'Overnight 100% long test',
      },
    })

    assert.ok(opps.length >= 3)
    // Should detect ON-POC test (44005 vs 44010)
    assert.ok(opps.some((o) => o.id === 'st-on-poc'))
    // Should detect Y-POC test (44005 vs 44000)
    assert.ok(opps.some((o) => o.id === 'st-y-poc'))
    // Should detect 5D-POC test (44005 vs 44000)
    assert.ok(opps.some((o) => o.id === 'it-5d-poc'))
    // Should detect Confluence between Y-POC and 5D-POC
    assert.ok(opps.some((o) => o.id === 'conf-ypoc-5dpoc'))
    // Should detect Overnight Inventory Rebalance opportunity
    assert.ok(opps.some((o) => o.id === 'inv-rebalance'))
  })
})
