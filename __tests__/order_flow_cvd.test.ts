import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeCvdCandleBars, computeOrderFlowCvd } from '../lib/trading/orderFlowDelta'
import { deskCvdSessionStartUnix } from '../lib/trading/deskClockPhase'

describe('session-scoped CVD', () => {
  it('does not treat missing session bars as full-history CVD', () => {
    const bars = [
      { time: 1000, open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { time: 1060, open: 10.5, high: 10.6, low: 10, close: 10.1, volume: 80 },
    ]
    const futureStart = 5000
    assert.equal(computeCvdCandleBars(bars, futureStart).length, 0)
    assert.equal(computeOrderFlowCvd(bars, futureStart), null)
  })

  it('resets cumulative at the session start', () => {
    const bars = []
    for (let i = 0; i < 20; i++) {
      bars.push({
        time: 1_000_000 + i * 300,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 50,
      })
    }
    const start = bars[10]!.time
    const all = computeCvdCandleBars(bars)
    const sess = computeCvdCandleBars(bars, start)
    assert.ok(sess.length < all.length)
    assert.equal(sess[0]!.open, 0)
    assert.ok(Math.abs(sess[sess.length - 1]!.close) < Math.abs(all[all.length - 1]!.close) + 1)
  })

  it('deskCvdSessionStartUnix is at/before now', () => {
    const now = new Date('2026-09-10T15:00:00-04:00')
    const start = deskCvdSessionStartUnix(now)
    assert.ok(start <= Math.floor(now.getTime() / 1000))
    assert.ok(Math.floor(now.getTime() / 1000) - start < 36 * 3600)
  })
})
