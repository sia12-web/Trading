import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  detect5DayExcesses,
  getRoundedNumbers,
  type ExcessBar,
} from '../lib/chart/excesses'

describe('Auction Market Theory - Excesses & Rounded Numbers', () => {
  it('calculates rounded numbers properly by instrument', () => {
    const dow = getRoundedNumbers(43820, 45210, 'DOW')
    assert.deepEqual(dow, [44000, 44500, 45000])

    const nikkei = getRoundedNumbers(29100, 30600, 'NIKKEI')
    assert.deepEqual(nikkei, [29500, 30000, 30500])

    const gold = getRoundedNumbers(2910, 3020, 'GOLD')
    assert.deepEqual(gold, [2950, 3000])
  })

  it('detects selling excess with upper rejection wick', () => {
    const bars: ExcessBar[] = [
      { time: 1000, open: 29500, high: 29520, low: 29490, close: 29510, volume: 100 },
      { time: 1300, open: 29510, high: 29530, low: 29500, close: 29520, volume: 150 },
      // Selling excess: spiked to 29650, closed down near 29510 (large upper wick = 140/160 = 87%)
      { time: 1600, open: 29520, high: 29650, low: 29490, close: 29510, volume: 850 },
      { time: 1900, open: 29510, high: 29525, low: 29480, close: 29490, volume: 120 },
      { time: 2200, open: 29490, high: 29505, low: 29470, close: 29480, volume: 110 },
      // Later bar retesting the high with lower volume
      { time: 2500, open: 29480, high: 29648, low: 29480, close: 29550, volume: 300 },
    ]

    const excesses = detect5DayExcesses(bars, 'NIKKEI')
    assert.equal(excesses.length, 1)
    const ex = excesses[0]!
    assert.equal(ex.type, 'SELLING_EXCESS')
    assert.equal(ex.price, 29650)
    assert.equal(ex.volume, 850)
    assert.equal(ex.isRetested, true)
    assert.equal(ex.retestVolume, 300)
    assert.equal(ex.retestVolumeRatio, 0.35)
  })

  it('detects buying excess with lower rejection wick', () => {
    const bars: ExcessBar[] = [
      { time: 1000, open: 29500, high: 29520, low: 29490, close: 29510, volume: 100 },
      { time: 1300, open: 29510, high: 29520, low: 29480, close: 29490, volume: 150 },
      // Buying excess: plunged to 29300, closed back up at 29480 (lower wick = 180/200 = 90%)
      { time: 1600, open: 29490, high: 29500, low: 29300, close: 29480, volume: 950 },
      { time: 1900, open: 29480, high: 29510, low: 29470, close: 29500, volume: 120 },
      { time: 2200, open: 29500, high: 29530, low: 29495, close: 29520, volume: 110 },
    ]

    const excesses = detect5DayExcesses(bars, 'NIKKEI')
    assert.equal(excesses.length, 1)
    const ex = excesses[0]!
    assert.equal(ex.type, 'BUYING_EXCESS')
    assert.equal(ex.price, 29300)
    assert.equal(ex.volume, 950)
    assert.equal(ex.isRetested, false)
  })
})
