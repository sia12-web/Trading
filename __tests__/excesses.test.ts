import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  detect5DaySessionExtremes,
  detectSpikes,
  detectDistributionReferences,
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
})
