import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  detect5DaySessionExtremes,
  detectSpikes,
  detectDistributionReferences,
  detectEmotionalNewsMoves,
  getRoundedNumbers,
  type ExcessBar,
} from '../lib/chart/excesses'

describe('Auction Market Theory - Session Extremes, Spikes & Distribution References', () => {
  it('calculates rounded numbers properly by instrument', () => {
    const dow = getRoundedNumbers(43820, 45210, 'DOW')
    assert.deepEqual(dow, [44000, 44500, 45000])

    const nasdaq = getRoundedNumbers(19800, 20350, 'NASDAQ')
    assert.deepEqual(nasdaq, [20000, 20250])

    const gold = getRoundedNumbers(2910, 3020, 'GOLD')
    assert.deepEqual(gold, [2950, 3000])

    const crude = getRoundedNumbers(68.2, 81.4, 'CRUDE')
    assert.deepEqual(crude, [70, 75, 80])
  })

  it('detects true session high and session low with retest tracking', () => {
    // Unix timestamps during NYC session
    const baseTime = 1788876000
    const bars: ExcessBar[] = [
      { time: baseTime + 0, open: 44000, high: 44050, low: 43980, close: 44020, volume: 1000 },
      { time: baseTime + 300, open: 44020, high: 44200, low: 44010, close: 44180, volume: 3500 }, // Session High
      { time: baseTime + 600, open: 44010, high: 44050, low: 43850, close: 43890, volume: 4200 }, // Session Low
      { time: baseTime + 900, open: 43890, high: 44020, low: 43900, close: 44010, volume: 1200 },
      // Retest bar approaching session high with lower volume
      { time: baseTime + 1200, open: 44050, high: 44198, low: 44040, close: 44120, volume: 1400 },
    ]

    const extremes = detect5DaySessionExtremes(bars, 'DOW')
    assert.equal(extremes.length, 2)

    const high = extremes.find((e) => e.type === 'HIGH')
    assert.ok(high)
    assert.equal(high.price, 44200)
    assert.equal(high.volume, 3500)
    assert.equal(high.isRetested, true)
    assert.equal(high.retestVolume, 1400)
    assert.equal(high.retestVolumeRatio, 0.4)

    const low = extremes.find((e) => e.type === 'LOW')
    assert.ok(low)
    assert.equal(low.price, 43850)
    assert.equal(low.volume, 4200)
    assert.equal(low.isRetested, false)
  })

  it('detects late-session spikes with spike high and base reference', () => {
    const baseTime = 1788876000
    const bars: ExcessBar[] = []
    for (let i = 0; i < 16; i++) {
      bars.push({
        time: baseTime + i * 300,
        open: 44050,
        high: 44100,
        low: 44000,
        close: 44060,
        volume: 500,
      })
    }
    bars.push({ time: baseTime + 16 * 300, open: 44090, high: 44150, low: 44080, close: 44140, volume: 1200 })
    bars.push({ time: baseTime + 17 * 300, open: 44140, high: 44200, low: 44130, close: 44190, volume: 1500 })
    bars.push({ time: baseTime + 18 * 300, open: 44190, high: 44250, low: 44180, close: 44240, volume: 1800 })

    const spikes = detectSpikes(bars, 'DOW')
    assert.equal(spikes.length, 1)
    const sp = spikes[0]!
    assert.equal(sp.direction, 'UP')
    assert.equal(sp.spikeHigh, 44250)
    assert.equal(sp.spikeBase, 44100)
  })

  it('detects Dalton Trend Day and Double Distribution references', () => {
    const baseTime = 1788876000
    const ddBars: ExcessBar[] = []
    for (let i = 0; i < 10; i++) {
      ddBars.push({
        time: baseTime + i * 300,
        open: 44020,
        high: 44100,
        low: 44000,
        close: 44060,
        volume: 500,
      })
    }
    for (let i = 10; i < 20; i++) {
      ddBars.push({
        time: baseTime + i * 300,
        open: 44270,
        high: 44350,
        low: 44250,
        close: 44320,
        volume: 600,
      })
    }

    const refs = detectDistributionReferences(ddBars, 'DOW')
    assert.equal(refs.length, 1)
    const ref = refs[0]!
    assert.equal(ref.dayType, 'DOUBLE_DISTRIBUTION')
    assert.ok(ref.separationLevel != null)
    assert.ok(ref.separationLevel > 44100 && ref.separationLevel < 44250)
  })

  it('detects two-way emotional whipsaw upon news announcement', () => {
    const baseTime = 1788876000 // e.g. 08:30 release
    const bars: ExcessBar[] = [
      { time: baseTime - 600, open: 44000, high: 44020, low: 43990, close: 44010, volume: 500 },
      { time: baseTime - 300, open: 44010, high: 44025, low: 44000, close: 44015, volume: 550 },
      // News release candle at baseTime: huge range sweeping high & low
      { time: baseTime, open: 44015, high: 44180, low: 43880, close: 44020, volume: 8500 },
      { time: baseTime + 300, open: 44020, high: 44060, low: 43980, close: 44030, volume: 3200 },
      { time: baseTime + 600, open: 44030, high: 44070, low: 44010, close: 44050, volume: 1800 },
      { time: baseTime + 900, open: 44050, high: 44080, low: 44040, close: 44070, volume: 1200 },
    ]

    const events = [
      { time: baseTime, event: 'Core CPI m/m', impact: 'High', country: 'US' }
    ]

    const moves = detectEmotionalNewsMoves(bars, events, 'DOW')
    assert.equal(moves.length, 1)
    const m = moves[0]!
    assert.equal(m.eventName, 'Core CPI m/m')
    assert.equal(m.newsHigh, 44180)
    assert.equal(m.newsLow, 43880)
    assert.equal(m.basePrice, 44015)
    assert.equal(m.moveRange, 300)
    assert.equal(m.direction, 'WHIPSAW')
    assert.ok(m.description.includes('Two-way whipsaw'))
  })

  it('detects bullish news drive and subsequent retest/rejection of news high', () => {
    const baseTime = 1788876000
    const bars: ExcessBar[] = [
      { time: baseTime - 300, open: 44000, high: 44020, low: 43990, close: 44010, volume: 500 },
      // News announcement: violent unidirectional drive up
      { time: baseTime, open: 44010, high: 44250, low: 44005, close: 44240, volume: 6500 },
      { time: baseTime + 300, open: 44240, high: 44260, low: 44210, close: 44250, volume: 4000 },
      { time: baseTime + 600, open: 44250, high: 44270, low: 44220, close: 44240, volume: 2200 },
      // Retest bar testing news high (44270) and rejecting back down
      { time: baseTime + 900, open: 44240, high: 44268, low: 44150, close: 44170, volume: 2500 },
    ]

    const events = [
      { time: baseTime, event: 'Non-Farm Payrolls', impact: 'High', country: 'US' }
    ]

    const moves = detectEmotionalNewsMoves(bars, events, 'DOW')
    assert.equal(moves.length, 1)
    const m = moves[0]!
    assert.equal(m.eventName, 'Non-Farm Payrolls')
    assert.equal(m.newsHigh, 44270)
    assert.equal(m.direction, 'BULLISH_DRIVE')
    assert.equal(m.isRetested, true)
    assert.equal(m.status, 'REJECTED_HIGH')
  })

  it('detects unscheduled breaking news volatility spikes without advance calendar event', () => {
    const baseTime = 1788876000
    const bars: ExcessBar[] = []
    // 10 quiet baseline bars (range ~30 pts)
    for (let i = 0; i < 10; i++) {
      bars.push({
        time: baseTime + i * 300,
        open: 44000,
        high: 44015,
        low: 43985,
        close: 44005,
        volume: 400,
      })
    }
    // Sudden headline spike bar (range 180 pts, 6x baseline, volume 4500)
    bars.push({
      time: baseTime + 10 * 300,
      open: 44005,
      high: 44120,
      low: 43940,
      close: 44010,
      volume: 4500,
    })
    bars.push({
      time: baseTime + 11 * 300,
      open: 44010,
      high: 44020,
      low: 43990,
      close: 44005,
      volume: 600,
    })

    // By default, generic spikes are NOT treated as news
    const defaultMoves = detectEmotionalNewsMoves(bars, [], 'DOW')
    assert.equal(defaultMoves.length, 0)

    // When explicitly enabled, unscheduled volatility spikes are captured
    const moves = detectEmotionalNewsMoves(bars, [], 'DOW', undefined, undefined, true)
    assert.equal(moves.length, 1)
    assert.equal(moves[0]!.eventName, 'Breaking News Volatility Spike')
    assert.equal(moves[0]!.newsHigh, 44120)
    assert.equal(moves[0]!.newsLow, 43940)
    assert.equal(moves[0]!.moveRange, 180)
    assert.equal(moves[0]!.direction, 'WHIPSAW')
  })

  it('rejects trivial or non-dramatic moves (e.g. 17 pts on DOW / 52k instrument) and does not label as flush', () => {
    const baseTime = 1788876000
    // User scenario: BOJ event during Tokyo session on high price instrument (52,195)
    // Range expands only 17 pts (52205 to 52188), which is normal candle fluctuation
    const bars: ExcessBar[] = [
      { time: baseTime - 600, open: 52190, high: 52200, low: 52185, close: 52195, volume: 150 },
      { time: baseTime - 300, open: 52195, high: 52202, low: 52190, close: 52198, volume: 180 },
      // Reaction bars: moveRange = 52205 - 52188 = 17.0 pts
      { time: baseTime, open: 52198, high: 52205, low: 52192, close: 52194, volume: 220 },
      { time: baseTime + 300, open: 52194, high: 52200, low: 52188, close: 52190, volume: 240 },
      { time: baseTime + 600, open: 52190, high: 52196, low: 52189, close: 52192, volume: 190 },
      { time: baseTime + 900, open: 52192, high: 52204, low: 52190, close: 52201, volume: 210 },
    ]

    const events = [
      { time: baseTime, event: 'BOJ Press Conference', impact: 'High', country: 'JP' }
    ]

    const moves = detectEmotionalNewsMoves(bars, events, 'DOW')
    // Must be completely rejected: 17 pts is not dramatic on DOW (requires >= 60 pts) and JP event is foreign
    assert.equal(moves.length, 0)
  })

  it('rejects foreign news event on DOW unless it creates a verified dramatic global shockwave', () => {
    const baseTime = 1788876000
    // Event is from Japan (BOJ), but move on DOW is only 35 pts (domestic noise)
    const quietBars: ExcessBar[] = [
      { time: baseTime - 300, open: 44000, high: 44015, low: 43990, close: 44005, volume: 400 },
      { time: baseTime, open: 44005, high: 44030, low: 43995, close: 44010, volume: 550 },
      { time: baseTime + 300, open: 44010, high: 44025, low: 44000, close: 44015, volume: 450 },
      { time: baseTime + 600, open: 44015, high: 44025, low: 44005, close: 44010, volume: 400 },
      { time: baseTime + 900, open: 44010, high: 44020, low: 44000, close: 44015, volume: 380 },
    ]

    const foreignEvents = [
      { time: baseTime, event: 'BOJ Rate Decision', impact: 'High', country: 'JP' }
    ]

    const movesQuiet = detectEmotionalNewsMoves(quietBars, foreignEvents, 'DOW')
    assert.equal(movesQuiet.length, 0) // Rejected

    // Now test when foreign event triggers a REAL global macro shockwave (250 pts on DOW with 6x volume)
    const shockwaveBars: ExcessBar[] = [
      { time: baseTime - 300, open: 44000, high: 44020, low: 43980, close: 44005, volume: 400 },
      { time: baseTime, open: 44005, high: 44015, low: 43765, close: 43770, volume: 5500 }, // -240 pt violent shock
      { time: baseTime + 300, open: 43770, high: 43790, low: 43750, close: 43760, volume: 3800 },
      { time: baseTime + 600, open: 43760, high: 43780, low: 43740, close: 43755, volume: 2900 },
      { time: baseTime + 900, open: 43755, high: 43810, low: 43750, close: 43800, volume: 2100 },
    ]

    const movesShock = detectEmotionalNewsMoves(shockwaveBars, foreignEvents, 'DOW')
    assert.equal(movesShock.length, 1)
    assert.equal(movesShock[0]!.direction, 'BEARISH_DRIVE')
    assert.ok(movesShock[0]!.description.includes('Bearish news flush'))
  })

  it('correctly classifies genuine Bearish Flush vs Whipsaw without false flushes', () => {
    const baseTime = 1788876000
    // Scenario A: Wick dips down 120 pts but completely rebounds to close near base price -> WHIPSAW, NOT A FLUSH!
    const whipBars: ExcessBar[] = [
      { time: baseTime - 300, open: 44000, high: 44020, low: 43980, close: 44005, volume: 500 },
      { time: baseTime, open: 44005, high: 44030, low: 43880, close: 43995, volume: 6000 }, // Low: 43880, close: 43995 (rebound!)
      { time: baseTime + 300, open: 43995, high: 44040, low: 43980, close: 44020, volume: 3000 },
      { time: baseTime + 600, open: 44020, high: 44035, low: 43990, close: 44010, volume: 2000 },
      { time: baseTime + 900, open: 44010, high: 44025, low: 44000, close: 44015, volume: 1500 },
    ]

    const events = [
      { time: baseTime, event: 'FOMC Rate Decision', impact: 'High', country: 'US' }
    ]

    const movesWhip = detectEmotionalNewsMoves(whipBars, events, 'DOW')
    assert.equal(movesWhip.length, 1)
    assert.equal(movesWhip[0]!.direction, 'WHIPSAW') // Rebound = Whipsaw, NOT a Flush!

    // Scenario B: True Bearish Flush where price closes at the lows (-180 pts)
    const flushBars: ExcessBar[] = [
      { time: baseTime - 300, open: 44000, high: 44020, low: 43980, close: 44005, volume: 500 },
      { time: baseTime, open: 44005, high: 44015, low: 43820, close: 43825, volume: 6500 }, // Closed near low (43825)
      { time: baseTime + 300, open: 43825, high: 43840, low: 43810, close: 43815, volume: 3500 },
      { time: baseTime + 600, open: 43815, high: 43830, low: 43800, close: 43805, volume: 2200 },
      { time: baseTime + 900, open: 43805, high: 43830, low: 43790, close: 43820, volume: 1800 },
    ]

    const movesFlush = detectEmotionalNewsMoves(flushBars, events, 'DOW')
    assert.equal(movesFlush.length, 1)
    assert.equal(movesFlush[0]!.direction, 'BEARISH_DRIVE')
    assert.ok(movesFlush[0]!.description.includes('Bearish news flush'))
  })
})

