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

    const moves = detectEmotionalNewsMoves(bars, [], 'DOW')
    assert.equal(moves.length, 1)
    assert.equal(moves[0]!.eventName, 'Breaking News Volatility Spike')
    assert.equal(moves[0]!.newsHigh, 44120)
    assert.equal(moves[0]!.newsLow, 43940)
    assert.equal(moves[0]!.moveRange, 180)
    assert.equal(moves[0]!.direction, 'WHIPSAW')
  })
})
