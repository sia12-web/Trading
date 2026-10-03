/**
 * Wyckoff Structure Line & Auction Market Theory Strategy Unit Tests
 * Run: npx tsx __tests__/wyckoff_strategy.test.ts
 */

import assert from 'node:assert/strict'
import {
  classifyWyckoffLine,
  buildPreMarkedZones,
  findNextStructuralTarget,
  evaluateWyckoffSetup,
  type WyckoffBar,
  type WyckoffChartContext,
} from '../lib/trading/wyckoffStrategy'
import type { UserTrendline } from '../lib/trading/userDrawings'

// 1. Classification: Supply Line (Creek) vs Demand Line (Ice)
{
  const supplyTl: UserTrendline = {
    id: 'tl-1',
    type: 'TRENDLINE',
    p1: { time: 1000, price: 4300 },
    p2: { time: 2000, price: 4280 },
  }
  const sRes = classifyWyckoffLine(supplyTl)
  assert.equal(sRes.role, 'SUPPLY_LINE')
  assert.ok(sRes.label.includes('Supply Line (Creek)'))
  assert.equal(sRes.color, '#f59e0b')

  const demandTl: UserTrendline = {
    id: 'tl-2',
    type: 'TRENDLINE',
    p1: { time: 1000, price: 4200 },
    p2: { time: 2000, price: 4220 },
  }
  const dRes = classifyWyckoffLine(demandTl)
  assert.equal(dRes.role, 'DEMAND_LINE')
  assert.ok(dRes.label.includes('Demand Line (Ice)'))
  assert.equal(dRes.color, '#38bdf8')
}

// 2. Pre-marked structural zones map (Tier 1 Mandatory Chart Hierarchy)
{
  const mockCtx: WyckoffChartContext = {
    frvp5d: {
      poc: 4255,
      vah: 4290,
      val: 4210,
      high: 4310,
      low: 4180,
      totalVolume: 500000,
      buyVolume: 250000,
      sellVolume: 250000,
      bins: [],
      timeStart: 0,
      timeEnd: 0,
    },
    yesterday: {
      date: '2026-10-01',
      openUnix: 0,
      closeUnix: 0,
      yh: 4295,
      yl: 4205,
      poc: 4250,
      vah: 4285,
      val: 4215,
      profile: null as any,
    },
    overnight: {
      overnight: {
        poc: 4240,
        high: 4275,
        low: 4185,
        vah: 4260,
        val: 4220,
        totalVolume: 50000,
        buyVolume: 25000,
        sellVolume: 25000,
        bins: [],
      },
    },
    avwap5m: {
      vwap: 4235,
      sigma1Upper: 4260,
      sigma1Lower: 4210,
      sigma2Upper: 4285,
      sigma2Lower: 4185,
      sigma3Upper: 4310,
      sigma3Lower: 4160,
      anchorTimestamp: 0,
    },
  }

  const zones = buildPreMarkedZones(mockCtx)
  assert.ok(zones.length >= 8, 'Must extract zones from 5D, Yesterday, and Overnight')
  assert.ok(zones.some((z) => z.name === '5D POC' && z.price === 4255))
  assert.ok(zones.some((z) => z.name === 'Y-VAH' && z.price === 4285))
  assert.ok(zones.some((z) => z.name === 'ON-Low' && z.price === 4185))

  // Find next target for long at 4212 with 10 pts risk
  const targetLong = findNextStructuralTarget(4212, 'LONG', zones, 10)
  assert.ok(targetLong.targetPrice > 4212, 'Target must be above entry')
  assert.equal(targetLong.targetZoneLabel, 'ON-POC') // Overnight POC (4240) is the first structural zone above 4212 + 8
}

// 3. Setup 1: Wyckoff Spring at Demand Line with CVD Absorption & >= 2R Room
{
  const demandTl: UserTrendline = {
    id: 'tl-demand',
    type: 'TRENDLINE',
    p1: { time: 1000, price: 4210 },
    p2: { time: 4000, price: 4210 }, // Flat/ascending support at 4210
  }

  const bars: WyckoffBar[] = [
    { time: 1000, open: 4215, high: 4218, low: 4211, close: 4214, volume: 1000, cvd: 100 },
    { time: 1300, open: 4214, high: 4216, low: 4210, close: 4212, volume: 1100, cvd: 90 },
    { time: 1600, open: 4212, high: 4213, low: 4208, close: 4210, volume: 1500, cvd: 70 },
    // Sweep below support: Low 4203, CVD plunges to -200 (heavy selling)
    { time: 1900, open: 4210, high: 4211, low: 4203, close: 4207, volume: 4500, cvd: -200 },
    // Reclaim bar: Closes at 4213 (back above 4210), CVD is -220 but price is higher (Absorption)
    { time: 2200, open: 4207, high: 4214, low: 4206, close: 4213, volume: 3200, cvd: -220 },
  ]

  const mockCtx: WyckoffChartContext = {
    frvp5d: {
      poc: 4255, // 5D POC provides ample room: 4255 - 4213 = 42 pts >> 2 * 10 pts
      vah: 4290,
      val: 4210,
      high: 4310,
      low: 4180,
      totalVolume: 500000,
      buyVolume: 250000,
      sellVolume: 250000,
      bins: [],
      timeStart: 0,
      timeEnd: 0,
    },
  }

  const setup = evaluateWyckoffSetup(demandTl, bars, mockCtx)
  assert.equal(setup.setupType, 'SPRING')
  assert.equal(setup.entryPrice, 4213)
  assert.ok(setup.stopLoss <= 4203, 'Stop must be strictly below spring low 4203')
  assert.ok(setup.riskPoints <= 12)
  assert.ok(setup.is2RValid, 'Must be valid >= 2R')
  assert.ok(setup.rrRatio >= 2.0, `RR ratio must be >= 2.0 (got ${setup.rrRatio})`)
  assert.equal(setup.cvdAbsorption, true, 'Must detect CVD seller absorption')
  assert.ok(setup.badgeText.includes('Spring'), 'Badge text must mention Spring')
}

// 4. Setup 1 Filter: Spring with Insufficient Room (< 2R Rule 17 & 20)
{
  const demandTl: UserTrendline = {
    id: 'tl-demand-tight',
    type: 'TRENDLINE',
    p1: { time: 1000, price: 4210 },
    p2: { time: 4000, price: 4210 },
  }

  const bars: WyckoffBar[] = [
    { time: 1000, open: 4215, high: 4218, low: 4211, close: 4214, volume: 1000 },
    { time: 1300, open: 4214, high: 4216, low: 4210, close: 4212, volume: 1100 },
    { time: 1600, open: 4212, high: 4213, low: 4208, close: 4210, volume: 1500 },
    // Sweep low = 4201 (risk = 4212 - 4200 = 12 pts)
    { time: 1900, open: 4210, high: 4211, low: 4201, close: 4206, volume: 4500 },
    // Reclaim at 4212
    { time: 2200, open: 4206, high: 4213, low: 4205, close: 4212, volume: 3000 },
  ]

  // Major resistance sitting right at 4220 (only 8 pts away, risk is 12 pts -> RR = 0.67 < 2R)
  const mockCtxTight: WyckoffChartContext = {
    yesterday: {
      date: '2026-10-01',
      openUnix: 0,
      closeUnix: 0,
      yh: 4220, // Ceiling directly overhead
      yl: 4180,
      poc: 4219,
      vah: 4220,
      val: 4190,
      profile: null as any,
    },
  }

  const setupTight = evaluateWyckoffSetup(demandTl, bars, mockCtxTight)
  assert.equal(setupTight.setupType, 'SPRING')
  assert.equal(setupTight.is2RValid, false, 'Must fail 2R filter (Rule 17)')
  assert.ok(setupTight.badgeText.includes('< 2R Filter'), 'Badge text must show < 2R Filter')
  assert.ok(setupTight.statusTag.includes('FILTERED'), 'Status tag must indicate Filtered')
}

// 5. Setup 2: Wyckoff Upthrust at Supply Line with Seller Absorption & >= 2R
{
  const supplyTl: UserTrendline = {
    id: 'tl-supply',
    type: 'TRENDLINE',
    p1: { time: 1000, price: 4290 },
    p2: { time: 4000, price: 4290 }, // Resistance at 4290
  }

  const bars: WyckoffBar[] = [
    { time: 1000, open: 4280, high: 4285, low: 4278, close: 4284, volume: 1000, cvd: 100 },
    { time: 1300, open: 4284, high: 4288, low: 4282, close: 4287, volume: 1200, cvd: 150 },
    // Upthrust sweep above 4290: High reaches 4297 (+7 pts above resistance), CVD shoots up to +500
    { time: 1600, open: 4287, high: 4297, low: 4286, close: 4292, volume: 5500, cvd: 500 },
    // Return below resistance: Closes at 4288, CVD still high at +520 (passive seller absorption)
    { time: 1900, open: 4292, high: 4293, low: 4286, close: 4288, volume: 3800, cvd: 520 },
  ]

  const mockCtx: WyckoffChartContext = {
    frvp5d: {
      poc: 4255, // Room to downside: 4288 - 4255 = 33 pts, Risk = 4298 - 4288 = 10 pts -> RR = 3.3R >= 2R
      vah: 4290,
      val: 4210,
      high: 4310,
      low: 4180,
      totalVolume: 500000,
      buyVolume: 250000,
      sellVolume: 250000,
      bins: [],
      timeStart: 0,
      timeEnd: 0,
    },
  }

  const setup = evaluateWyckoffSetup(supplyTl, bars, mockCtx)
  assert.equal(setup.setupType, 'UPTHRUST')
  assert.equal(setup.entryPrice, 4288)
  assert.ok(setup.stopLoss >= 4297, 'Stop must be strictly above upthrust high 4297')
  assert.ok(setup.is2RValid, 'Must be valid >= 2R')
  assert.ok(setup.rrRatio >= 2.0, `RR ratio must be >= 2.0 (got ${setup.rrRatio})`)
  assert.equal(setup.cvdAbsorption, true, 'Must detect CVD buyer absorption by passive sellers')
  assert.ok(setup.badgeText.includes('Upthrust'))
}

// 6. Trendline drawn from a Spring: All Factors & Points Scoring (0-100 pts)
{
  const springTl: UserTrendline = {
    id: 'tl-spring-scored',
    type: 'TRENDLINE',
    p1: { time: 1900, price: 4203 }, // P1 anchored directly at the Spring low
    p2: { time: 2500, price: 4220 }, // Projecting upward
  }

  const bars: WyckoffBar[] = [
    { time: 1000, open: 4215, high: 4218, low: 4211, close: 4214, volume: 1000, cvd: 100 },
    { time: 1300, open: 4214, high: 4216, low: 4210, close: 4212, volume: 1100, cvd: 90 },
    { time: 1600, open: 4212, high: 4213, low: 4208, close: 4210, volume: 1500, cvd: 70 },
    // Spring Sweep Candle: Low 4203, long 60% bottom wick, high volume 4800, CVD plunged -220
    { time: 1900, open: 4210, high: 4211, low: 4203, close: 4209, volume: 4800, cvd: -220 },
    { time: 2200, open: 4209, high: 4216, low: 4208, close: 4215, volume: 3500, cvd: -180 },
  ]

  const mockCtx: WyckoffChartContext = {
    frvp5d: {
      poc: 4255,
      vah: 4290,
      val: 4210, // Spring sweeps 4210 VAL
      high: 4310,
      low: 4180,
      totalVolume: 500000,
      buyVolume: 250000,
      sellVolume: 250000,
      bins: [],
      timeStart: 0,
      timeEnd: 0,
    },
    yesterday: {
      date: '2026-10-01',
      openUnix: 0,
      closeUnix: 0,
      yh: 4295,
      yl: 4205,
      poc: 4250,
      vah: 4285,
      val: 4210, // Yesterday VAL confluence
      profile: null as any,
    },
    avwap5m: {
      vwap: 4215, // Proximal to 5M AVWAP
      sigma1Upper: 4240,
      sigma1Lower: 4190,
      sigma2Upper: 4265,
      sigma2Lower: 4165,
      sigma3Upper: 4290,
      sigma3Lower: 4140,
      anchorTimestamp: 0,
    },
  }

  // Import directly or call
  const { evaluateSpringOrUpthrustTrendline } = require('../lib/trading/wyckoffStrategy')
  const evalResult = evaluateSpringOrUpthrustTrendline(springTl, bars, mockCtx)

  assert.equal(evalResult.originType, 'SPRING')
  assert.ok(evalResult.totalScore >= 75, `Spring total score should be high quality (got ${evalResult.totalScore})`)
  assert.ok(['A+', 'A'].includes(evalResult.grade), `Grade should be A or A+ (got ${evalResult.grade})`)
  assert.ok(evalResult.factors.location.score >= 10, 'Location should award points for zone sweep')
  assert.ok(evalResult.factors.volumeEffortVsResult.score >= 15, 'Volume should award high points for RVOL')
  assert.ok(evalResult.factors.candleExcess.score >= 14, 'Candle excess tail should award high points')
  assert.ok(evalResult.factors.cvdAbsorption.score >= 10, 'CVD absorption should award points')
  assert.ok(evalResult.factors.avwap5m.score >= 7, 'AVWAP proximity should award points')
  assert.ok(evalResult.factors.roundNumber.score >= 4, 'Century handle $4200 should award points')
  assert.ok(evalResult.is2RValid, 'Must have >= 2R room to 5D POC')
  assert.ok(evalResult.stopLoss <= 4203, 'Stop loss must be below spring low')
  assert.ok(evalResult.badgeLabel.includes('Spring'), 'Badge label must state Spring')
  assert.ok(evalResult.badgeLabel.includes('pts'), 'Badge label must state points score')
}

// 7. Trendline drawn from an Upthrust: All Factors & Points Scoring (0-100 pts)
{
  const upthrustTl: UserTrendline = {
    id: 'tl-upthrust-scored',
    type: 'TRENDLINE',
    p1: { time: 1600, price: 4297 }, // P1 anchored directly at the Upthrust high
    p2: { time: 2400, price: 4275 }, // Projecting downward
  }

  const bars: WyckoffBar[] = [
    { time: 1000, open: 4280, high: 4285, low: 4278, close: 4284, volume: 1000, cvd: 100 },
    { time: 1300, open: 4284, high: 4288, low: 4282, close: 4287, volume: 1200, cvd: 150 },
    // Upthrust Sweep Candle: High 4297, long 65% top wick, volume 5500, CVD 500
    { time: 1600, open: 4287, high: 4297, low: 4286, close: 4289, volume: 5500, cvd: 500 },
    { time: 1900, open: 4289, high: 4291, low: 4280, close: 4283, volume: 3800, cvd: 510 },
  ]

  const mockCtx: WyckoffChartContext = {
    frvp5d: {
      poc: 4255, // 4289 - 4255 = 34 pts reward, Risk = 4298 - 4289 = 9 pts -> 3.7R
      vah: 4295, // Swept 5D VAH at 4295
      val: 4210,
      high: 4310,
      low: 4180,
      totalVolume: 500000,
      buyVolume: 250000,
      sellVolume: 250000,
      bins: [],
      timeStart: 0,
      timeEnd: 0,
    },
    yesterday: {
      date: '2026-10-01',
      openUnix: 0,
      closeUnix: 0,
      yh: 4295,
      yl: 4205,
      poc: 4250,
      vah: 4295, // Yesterday VAH confluence
      val: 4210,
      profile: null as any,
    },
  }

  const { evaluateSpringOrUpthrustTrendline } = require('../lib/trading/wyckoffStrategy')
  const evalResult = evaluateSpringOrUpthrustTrendline(upthrustTl, bars, mockCtx)

  assert.equal(evalResult.originType, 'UPTHRUST')
  assert.ok(evalResult.totalScore >= 75, `Upthrust total score should be high quality (got ${evalResult.totalScore})`)
  assert.ok(['A+', 'A'].includes(evalResult.grade), `Grade should be A or A+ (got ${evalResult.grade})`)
  assert.ok(evalResult.factors.location.score >= 10, 'Location should award points for VAH sweep')
  assert.ok(evalResult.factors.volumeEffortVsResult.score >= 15, 'Volume should award high points for RVOL')
  assert.ok(evalResult.factors.candleExcess.score >= 14, 'Candle excess top wick should award high points')
  assert.ok(evalResult.is2RValid, 'Must be valid >= 2R')
  assert.ok(evalResult.stopLoss >= 4297, 'Stop loss must be above upthrust high')
  assert.ok(evalResult.badgeLabel.includes('Upthrust'), 'Badge label must state Upthrust')
}

console.log('wyckoff_strategy: all tests passed!')

