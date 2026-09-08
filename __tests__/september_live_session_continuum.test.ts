import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeSessionHighlightSpans,
  sessionInstanceKeyFor,
  activeDeskSessionsAt,
  zonedCivilToUnix,
  NY_DESK_CLOCK,
} from '../lib/chart/sessionVwap'
import {
  get5DayAnchorUnix,
  computeOvernightInventoryAndSessions,
  computeYesterdayNycSession,
  type ContextBar,
} from '../lib/chart/context55'

describe('September 6-7 Asia/London/NY Continuum & 5-Day Rolling Window', () => {
  it('correctly creates Sept 6 Asia, Sept 7 London, and Sept 7 NY spans without dropping candles when asOfUnix is omitted', () => {
    // Sunday Sept 6 18:00 ET (22:00 UTC) through Monday Sept 7 16:00 ET (20:00 UTC)
    const sunAsiaStart = zonedCivilToUnix('2026-09-06', 18, 'America/New_York')
    const monNyClose = zonedCivilToUnix('2026-09-07', 16, 'America/New_York')

    const candles = []
    for (let t = sunAsiaStart; t < monNyClose; t += 300) {
      candles.push({
        time: t,
        open: 44000,
        high: 44050,
        low: 43950,
        close: 44020,
        volume: 200,
      })
    }

    // Call computeSessionHighlightSpans without asOfUnix
    const { spans, candleTimes } = computeSessionHighlightSpans({
      candles,
      instrument: 'DOW',
    })

    assert.ok(candleTimes.length > 0)
    assert.equal(candleTimes[0], sunAsiaStart)

    // Should contain Tokyo (Asia), London, and New York
    const tokyoSpan = spans.find((s) => s.name === 'Asia')
    const londonSpan = spans.find((s) => s.name === 'London')
    const nySpan = spans.find((s) => s.name === 'New York')

    assert.ok(tokyoSpan, 'Tokyo/Asia span must exist')
    assert.ok(londonSpan, 'London span must exist')
    assert.ok(nySpan, 'New York span must exist')

    assert.equal(tokyoSpan.displayName, 'Tokyo')
    assert.equal(tokyoSpan.startT, sunAsiaStart)
    // Asia ends at 03:00 Monday
    const mon0300 = zonedCivilToUnix('2026-09-07', 3, 'America/New_York')
    assert.equal(tokyoSpan.endT, mon0300)

    // London starts at 03:00 Monday and ends at 11:30 Monday
    assert.equal(londonSpan.displayName, 'London')
    assert.equal(londonSpan.startT, mon0300)
    const mon1130 = zonedCivilToUnix('2026-09-07', 11.5, 'America/New_York')
    assert.equal(londonSpan.endT, mon1130)

    // New York starts at 09:30 Monday and ends at 16:00 Monday
    const mon0930 = zonedCivilToUnix('2026-09-07', 9.5, 'America/New_York')
    assert.equal(nySpan.displayName, 'New York')
    assert.equal(nySpan.startT, mon0930)
    assert.equal(nySpan.endT, monNyClose)
  })

  it('marks overlapping sessions (London + NY) as isCurrent during overlap window', () => {
    // Current candle at 10:00 AM ET Monday (during 09:30-11:30 London/NY overlap)
    const mon0300 = zonedCivilToUnix('2026-09-07', 3, 'America/New_York')
    const mon1000 = zonedCivilToUnix('2026-09-07', 10, 'America/New_York')

    const candles = []
    for (let t = mon0300; t <= mon1000; t += 300) {
      candles.push({
        time: t,
        open: 44000,
        high: 44100,
        low: 43900,
        close: 44050,
        volume: 300,
      })
    }

    const { spans } = computeSessionHighlightSpans({
      candles,
      instrument: 'DOW',
    })

    const londonSpan = spans.find((s) => s.name === 'London')
    const nySpan = spans.find((s) => s.name === 'New York')

    assert.ok(londonSpan)
    assert.ok(nySpan)
    assert.equal(londonSpan.isCurrent, true, 'London must be active at 10:00 AM')
    assert.equal(nySpan.isCurrent, true, 'New York must be active at 10:00 AM')
  })

  it('dynamically expands session high and low on live intra-bar price ticks', () => {
    const sunAsiaStart = zonedCivilToUnix('2026-09-06', 18, 'America/New_York')
    const bar1 = {
      time: sunAsiaStart,
      open: 44000,
      high: 44050,
      low: 43950,
      close: 44020,
      volume: 100,
    }

    const initial = computeSessionHighlightSpans({
      candles: [bar1],
      instrument: 'DOW',
    })
    const initAsia = initial.spans.find((s) => s.name === 'Asia')!
    assert.equal(initAsia.high, 44050)
    assert.equal(initAsia.low, 43950)

    // Now live tick pushes high to 44200 and low to 43900 on the same bar
    const updatedBar1 = {
      ...bar1,
      high: 44200,
      low: 43900,
      close: 44180,
    }

    const updated = computeSessionHighlightSpans({
      candles: [updatedBar1],
      instrument: 'DOW',
    })
    const updatedAsia = updated.spans.find((s) => s.name === 'Asia')!
    assert.equal(updatedAsia.high, 44200)
    assert.equal(updatedAsia.low, 43900)
  })

  it('rolls the 5-day anchor forward from Aug 31 to Sep 1 when Monday 09:30 AM arrives', () => {
    // 1. Sunday evening Sept 6 at 19:00 ET: 5 completed trading days = Aug 31, Sep 1, Sep 2, Sep 3, Sep 4
    const sun1900 = zonedCivilToUnix('2026-09-06', 19, 'America/New_York')
    const sunAnchor = get5DayAnchorUnix(sun1900, NY_DESK_CLOCK)
    const expectedAug31Open = zonedCivilToUnix('2026-08-31', 9.5, 'America/New_York')
    assert.equal(sunAnchor, expectedAug31Open, 'Sunday evening must anchor to Monday Aug 31 open')

    // 2. Monday Sept 7 at 02:00 ET (Asia): cash open hasn't happened yet -> still anchors to Aug 31
    const mon0200 = zonedCivilToUnix('2026-09-07', 2, 'America/New_York')
    const monPreOpenAnchor = get5DayAnchorUnix(mon0200, NY_DESK_CLOCK)
    assert.equal(monPreOpenAnchor, expectedAug31Open, 'Monday pre-open Asia must anchor to Monday Aug 31 open')

    // 3. Monday Sept 7 at 09:30 ET (Cash open): rolls forward, dropping Aug 31 and anchoring to Sep 1
    const mon0930 = zonedCivilToUnix('2026-09-07', 9.5, 'America/New_York')
    const monOpenAnchor = get5DayAnchorUnix(mon0930, NY_DESK_CLOCK)
    const expectedSep01Open = zonedCivilToUnix('2026-09-01', 9.5, 'America/New_York')
    assert.equal(monOpenAnchor, expectedSep01Open, 'Monday cash open must roll forward to Tuesday Sep 1 open (dropping Aug 31)')
  })

  it('computes overnight Asia FRVP starting on Sunday Sept 6 at 18:00 ET for Monday trade date', () => {
    const friOpenUnix = zonedCivilToUnix('2026-09-04', 9.5, 'America/New_York')
    const friCloseUnix = zonedCivilToUnix('2026-09-04', 16, 'America/New_York')
    const monNowUnix = zonedCivilToUnix('2026-09-07', 8, 'America/New_York')

    const bars: ContextBar[] = []
    // Friday cash session bars
    for (let t = friOpenUnix; t < friCloseUnix; t += 300) {
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
    assert.ok(yday)
    assert.equal(yday.sessionDate, '2026-09-04')

    // Sunday Sept 6 18:00 ET Asia bars
    const sunAsiaOpen = zonedCivilToUnix('2026-09-06', 18, 'America/New_York')
    for (let t = sunAsiaOpen; t < monNowUnix; t += 300) {
      bars.push({
        time: t,
        open: 44050,
        high: 44150,
        low: 44010,
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

    assert.ok(inv)
    assert.ok(inv.asia)
    assert.equal(inv.asia.name, 'Asia')
    assert.equal(inv.asia.startUnix, sunAsiaOpen, 'Overnight Asia start must be Sunday Sept 6 18:00 ET')
    const monAsiaEnd = zonedCivilToUnix('2026-09-07', 3, 'America/New_York')
    assert.equal(inv.asia.endUnix, monAsiaEnd, 'Overnight Asia end must be Monday Sept 7 03:00 ET')
  })
})
