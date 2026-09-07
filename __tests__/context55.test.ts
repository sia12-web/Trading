import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  compute5DayFixedRangeVolumeProfile,
  compute5MonthAnchoredVwap,
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
})
