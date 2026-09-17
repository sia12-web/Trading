import test from 'node:test'
import assert from 'node:assert/strict'
import { GET as getCandles } from '@/app/api/trading/candles/route'
import { mergeHistoryWithLiveTip } from '@/lib/chart/liveFormingBar'

test('30-minute timeframe candle continuum & live updates', async (t) => {
  await t.test('/api/trading/candles?instrument=NASDAQ&timeframe=30m returns 30m candles', async () => {
    const req = new Request('http://localhost:3000/api/trading/candles?instrument=NASDAQ&timeframe=30m&days=5')
    const res = await getCandles(req)
    assert.equal(res.status, 200, 'Candle endpoint should return 200')
    const data = await res.json()
    assert.ok(Array.isArray(data.candles), 'Should return candles array')
    assert.ok(data.candles.length > 50, `Expected > 50 30m candles, got ${data.candles.length}`)

    // Check that intraday bar steps are multiples of 1800 seconds (30m)
    for (let i = 1; i < data.candles.length; i++) {
      const dt = data.candles[i].time - data.candles[i - 1].time
      assert.ok(
        dt % 1800 === 0,
        `Candle step between index ${i-1} (${data.candles[i-1].time}) and ${i} (${data.candles[i].time}) must be multiple of 1800s, got ${dt}s`
      )
    }
  })

  await t.test('mergeHistoryWithLiveTip preserves 30m step and does not inject 5m flat bars', async () => {
    const baseTime = 1789542000 // 03:00
    const history = [
      { time: baseTime - 3600, open: 29300, high: 29350, low: 29290, close: 29340, volume: 1000 },
      { time: baseTime - 1800, open: 29340, high: 29380, low: 29330, close: 29365, volume: 1200 },
      { time: baseTime, open: 29365, high: 29395, low: 29355, close: 29387, volume: 1500 },
    ]

    // Live tick at 03:14 (within the 03:00 - 03:30 bar)
    const tickTime = baseTime + 14 * 60 // 03:14
    const liveTick = {
      time: tickTime,
      open: 29365,
      high: 29400,
      low: 29355,
      close: 29398,
      volume: 100,
    }

    const merged = mergeHistoryWithLiveTip(history, liveTick, '30m')
    assert.equal(merged.length, 3, 'Must not append new bar when tick falls inside active 30m bar')
    const tip = merged[merged.length - 1]!
    assert.equal(tip.time, baseTime, 'Tip bar must maintain 03:00 bucket time')
    assert.equal(tip.open, 29365, 'Tip bar must preserve 30m open')
    assert.equal(tip.close, 29398, 'Tip bar must update to latest live tick close')
    assert.equal(tip.high, 29400, 'Tip bar must update high')

    // Live tick at 03:32 (rolling into next 30m bar)
    const nextTickTime = baseTime + 32 * 60 // 03:32
    const nextLiveTick = {
      time: nextTickTime,
      open: 29405,
      high: 29420,
      low: 29402,
      close: 29415,
      volume: 50,
    }

    const rolled = mergeHistoryWithLiveTip(merged, nextLiveTick, '30m')
    assert.equal(rolled.length, 4, 'Must roll to 4th bar for next 30m period')
    const newBar = rolled[rolled.length - 1]!
    assert.equal(newBar.time, baseTime + 1800, 'New bar time must be aligned to 03:30 (baseTime + 1800)')
    assert.equal(newBar.close, 29415)
  })
})
