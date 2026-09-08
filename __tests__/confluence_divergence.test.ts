import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateStochastic,
  detectStochasticDivergence,
  evaluateConfluenceSignal,
  type Candle,
} from '../lib/trading/confluenceDivergenceStrategy'

test('calculateStochastic computes %K and %D within 0-100', () => {
  const bars: Candle[] = []
  for (let i = 0; i < 30; i++) {
    const p = 50000 + Math.sin(i / 3) * 100
    bars.push({
      time: 1700000000 + i * 60,
      open: p - 5,
      high: p + 15,
      low: p - 15,
      close: p + 5,
      volume: 100,
    })
  }

  const stoch = calculateStochastic(bars, 14, 3, 3)
  assert.ok(stoch.length > 0)
  for (const s of stoch) {
    assert.ok(s.k >= 0 && s.k <= 100, `K out of bounds: ${s.k}`)
    assert.ok(s.d >= 0 && s.d <= 100, `D out of bounds: ${s.d}`)
  }
})

test('detectStochasticDivergence identifies Bullish Divergence', () => {
  const bars: Candle[] = [
    { time: 100, open: 53100, high: 53120, low: 53080, close: 53090, volume: 100 },
    { time: 160, open: 53090, high: 53100, low: 53050, close: 53055, volume: 150 },
    { time: 220, open: 53055, high: 53080, low: 53050, close: 53075, volume: 120 },
    { time: 280, open: 53075, high: 53110, low: 53070, close: 53105, volume: 110 },
    { time: 340, open: 53105, high: 53110, low: 53060, close: 53070, volume: 130 },
    { time: 400, open: 53070, high: 53075, low: 53040, close: 53045, volume: 140 }, // Swing low: 53040
    { time: 460, open: 53045, high: 53065, low: 53042, close: 53060, volume: 160 }, // Current low: 53042
  ]

  const stoch = [
    { time: 100, k: 35, d: 40 },
    { time: 160, k: 12, d: 15 },
    { time: 220, k: 25, d: 20 },
    { time: 280, k: 55, d: 45 },
    { time: 340, k: 30, d: 35 },
    { time: 400, k: 18, d: 20 }, // Trough at 53040: %K = 18
    { time: 460, k: 24, d: 21 }, // Trough at 53042: %K = 24 (Higher low)
  ]

  const div = detectStochasticDivergence(bars, stoch)
  assert.equal(div.type, 'BULLISH')
  assert.equal(div.swingPrice1, 53040)
  assert.equal(div.swingPrice2, 53042)
})

test('evaluateConfluenceSignal generates BUY signal at Yesterday VAL', () => {
  const bars: Candle[] = [
    { time: 100, open: 53100, high: 53120, low: 53080, close: 53090, volume: 100 },
    { time: 160, open: 53090, high: 53100, low: 53050, close: 53055, volume: 150 },
    { time: 220, open: 53055, high: 53080, low: 53050, close: 53075, volume: 120 },
    { time: 280, open: 53075, high: 53110, low: 53070, close: 53105, volume: 110 },
    { time: 340, open: 53105, high: 53110, low: 53060, close: 53070, volume: 130 },
    { time: 400, open: 53070, high: 53075, low: 53040, close: 53045, volume: 140 },
    { time: 460, open: 53045, high: 53065, low: 53042, close: 53060, volume: 160 },
  ]

  const stoch = [
    { time: 100, k: 35, d: 40 },
    { time: 160, k: 12, d: 15 },
    { time: 220, k: 25, d: 20 },
    { time: 280, k: 55, d: 45 },
    { time: 340, k: 30, d: 35 },
    { time: 400, k: 18, d: 20 },
    { time: 460, k: 24, d: 21 },
  ]

  const valueArea = {
    vah: 53200,
    val: 53045,
    poc: 53125,
  }

  const signal = evaluateConfluenceSignal({
    instrument: 'DOW',
    bars,
    stochPoints: stoch,
    valueArea,
    vwap: { vwap: 53110, upper1: 53160, lower1: 53060 },
  })

  assert.ok(signal != null)
  assert.equal(signal.direction, 'BUY')
  assert.equal(signal.entryPrice, 53060)
  assert.equal(signal.stopLoss, 53028) // 53040 - 12 pt structural buffer
  assert.equal(signal.tp1, 53125)
  assert.ok(signal.rMultipleTp1 > 1.5)
})
