import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeFootprintBars,
  findNakedPocs,
  findActiveUnfinishedAuctions,
  summarizeFootprintForLeo,
  markDiagonalImbalances,
  type FootprintBar,
} from '../lib/trading/orderFlowDelta'
import {
  deskFootprintTickSize,
  recentFootprintSlice,
  FOOTPRINT_RECENT_BARS,
  paintSierraNumberBars,
} from '../lib/chart/footprintPaint'

test('findNakedPocs detects untested candle POCs and clears tested ones', () => {
  const bars: FootprintBar[] = [
    {
      time: 100,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      candlePocPrice: 95, // Will be tested by bar 2
      totalVolume: 5000,
      netDelta: 200,
      deltaPct: 4,
      trappedTraders: 'NONE',
      ticks: [],
      stackedBuyImbalances: [],
      stackedSellImbalances: [],
      unfinishedAuction: { highZeroBid: false, lowZeroAsk: false },
    },
    {
      time: 200,
      open: 105,
      high: 115,
      low: 94, // Trades through 95!
      close: 112,
      candlePocPrice: 114, // Remains naked
      totalVolume: 6000,
      netDelta: 400,
      deltaPct: 6.7,
      trappedTraders: 'NONE',
      ticks: [],
      stackedBuyImbalances: [],
      stackedSellImbalances: [],
      unfinishedAuction: { highZeroBid: false, lowZeroAsk: false },
    },
    {
      time: 300,
      open: 112,
      high: 113,
      low: 108, // Does NOT touch 114
      close: 110,
      candlePocPrice: 110,
      totalVolume: 4000,
      netDelta: -100,
      deltaPct: -2.5,
      trappedTraders: 'NONE',
      ticks: [],
      stackedBuyImbalances: [],
      stackedSellImbalances: [],
      unfinishedAuction: { highZeroBid: false, lowZeroAsk: false },
    },
  ]

  const naked = findNakedPocs(bars)
  assert.equal(naked.length, 1)
  assert.equal(naked[0]!.price, 114)
  assert.equal(naked[0]!.time, 200)
})

test('findActiveUnfinishedAuctions detects poor highs and poor lows', () => {
  const bars: FootprintBar[] = [
    {
      time: 100,
      open: 100,
      high: 120,
      low: 95,
      close: 118,
      candlePocPrice: 115,
      totalVolume: 3000,
      netDelta: 150,
      deltaPct: 5,
      trappedTraders: 'NONE',
      ticks: [],
      stackedBuyImbalances: [],
      stackedSellImbalances: [],
      unfinishedAuction: { highZeroBid: true, lowZeroAsk: false }, // High 120 unfinished
    },
    {
      time: 200,
      open: 118,
      high: 119, // Doesn't reach 120
      low: 88, // Low 88 unfinished
      close: 92,
      candlePocPrice: 90,
      totalVolume: 4500,
      netDelta: -300,
      deltaPct: -6.7,
      trappedTraders: 'NONE',
      ticks: [],
      stackedBuyImbalances: [],
      stackedSellImbalances: [],
      unfinishedAuction: { highZeroBid: false, lowZeroAsk: true },
    },
  ]

  const uas = findActiveUnfinishedAuctions(bars)
  assert.equal(uas.length, 2)
  assert.equal(uas[0]!.type, 'HIGH')
  assert.equal(uas[0]!.price, 120)
  assert.equal(uas[1]!.type, 'LOW')
  assert.equal(uas[1]!.price, 88)
})

test('computeFootprintBars identifies Trapped Buyers and Trapped Sellers', () => {
  const candles = [
    { time: 100, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
    // Bar 2: pushes to 108 (above prev high 105), but sellers absorb (close 98 < open 102), negative delta
    { time: 200, open: 102, high: 108, low: 96, close: 98, volume: 2000 },
    // Bar 3: pushes to 94 (below prev low 96), but buyers absorb (close 101 > open 98), positive delta
    { time: 300, open: 98, high: 103, low: 94, close: 101, volume: 2000 },
  ]

  const bars = computeFootprintBars(candles, 0.25)
  assert.equal(bars.length, 3)
  assert.equal(bars[1]!.trappedTraders, 'TRAPPED_BUYERS')
  assert.equal(bars[2]!.trappedTraders, 'TRAPPED_SELLERS')
  assert.ok(bars[1]!.deltaPct !== 0)
})

test('summarizeFootprintForLeo includes Trapped Traders, Naked POCs, and Unfinished Auctions', () => {
  const bars: FootprintBar[] = [
    {
      time: 100,
      open: 100,
      high: 110,
      low: 90,
      close: 95,
      candlePocPrice: 108,
      totalVolume: 5000,
      netDelta: -450,
      deltaPct: -9,
      trappedTraders: 'TRAPPED_BUYERS',
      ticks: [],
      stackedBuyImbalances: [],
      stackedSellImbalances: [],
      unfinishedAuction: { highZeroBid: true, lowZeroAsk: false },
    },
    {
      time: 200,
      open: 95,
      high: 99,
      low: 85,
      close: 92,
      candlePocPrice: 88,
      totalVolume: 4000,
      netDelta: -100,
      deltaPct: -2.5,
      trappedTraders: 'NONE',
      ticks: [],
      stackedBuyImbalances: [],
      stackedSellImbalances: [],
      unfinishedAuction: { highZeroBid: false, lowZeroAsk: false },
    },
  ]

  const summary = summarizeFootprintForLeo(bars, null)
  assert.ok(summary.includes('TRAPPED BUYERS'), 'Summary should mention trapped buyers')
  assert.ok(summary.includes('UNTESTED NAKED POCs'), 'Summary should list naked POCs')
  assert.ok(summary.includes('108.00'), 'Summary should include naked POC price')
  assert.ok(summary.includes('UNFINISHED AUCTION TARGETS'), 'Summary should list unfinished auction targets')
})

test('Sierra diagonal imbalance compares ask at P to bid at P-1 tick', () => {
  const ticks = [
    { price: 100, bidVol: 10, askVol: 10, totalVol: 20, delta: 0, isBuyImbalance: false, isSellImbalance: false },
    { price: 101, bidVol: 8, askVol: 40, totalVol: 48, delta: 32, isBuyImbalance: false, isSellImbalance: false },
    { price: 102, bidVol: 50, askVol: 5, totalVol: 55, delta: -45, isBuyImbalance: false, isSellImbalance: false },
  ]
  markDiagonalImbalances(ticks, 3)
  assert.equal(ticks[1]!.isBuyImbalance, true, 'ask 40 vs bid 10 below is 4x buy imbalance')
  assert.equal(ticks[2]!.isSellImbalance, false)
  assert.equal(ticks[1]!.isSellImbalance, false)
})

test('recent footprint is only the live tail', () => {
  assert.equal(FOOTPRINT_RECENT_BARS, 12)
  const bars = Array.from({ length: 40 }, (_, i) => i)
  assert.deepEqual(recentFootprintSlice(bars), bars.slice(-12))
  assert.equal(deskFootprintTickSize('NASDAQ'), 0.25)
  assert.equal(deskFootprintTickSize('DOW'), 1)
  assert.equal(deskFootprintTickSize('GOLD'), 0.1)
  assert.equal(deskFootprintTickSize('CRUDE'), 0.01)
})

test('Sierra number bars paint bid x ask cells', () => {
  let filled = 0
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    fillRect() {
      filled += 1
    },
    strokeRect() {},
    fillText() {},
    measureText: () => ({ width: 20 }),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
  } as unknown as CanvasRenderingContext2D
  const bars = computeFootprintBars(
    [{ time: 1, open: 100, high: 101, low: 99.5, close: 100.5, volume: 800 }],
    0.25
  )
  paintSierraNumberBars(ctx, {
    bars,
    paneW: 400,
    paneH: 300,
    timeToX: () => 200,
    priceToY: (p) => 200 - (p - 99) * 40,
    barSpacing: 32,
  })
  assert.ok(filled > 0, 'number bars draw cells')
})

