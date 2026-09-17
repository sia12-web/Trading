import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkTrendlineBreakout,
  findInitiatingPoint,
  evaluateTrendBorningZone,
  detectHigherLowsWithTiming,
  calculateDynamicTrendline,
  checkDynamicTrendlineExit,
} from '../lib/trading/trendlineStrategy.ts'
import type { UserTrendline } from '../lib/trading/userDrawings.ts'
import type { Candle } from '../lib/trading/candlestickPatterns.ts'
import type { ChartContext55 } from '../lib/chart/context55.ts'

describe('Systematic Trendline Strategy & Trend-Borning Zone Engine', () => {
  // Mock bearish trendline from (t=1000, p=2080) to (t=1900, p=2060) -> slope = -20 pts / 900s
  const mockBearishTrendline: UserTrendline = {
    id: 'tl-bear-1',
    type: 'TRENDLINE',
    p1: { time: 1000, price: 2080 },
    p2: { time: 1900, price: 2060 },
    color: '#ef4444',
  }

  test('1. should NOT trigger breakout on wick-only piercing without confirmed 5m close', () => {
    // Trendline projected at t=2100: 2080 + (-20/900)*(1100) = 2080 - 24.44 = 2055.56
    // Bar with High piercing above line (2057), but Close remains below line (2053)
    const bars: Candle[] = [
      { time: 1200, open: 2075, high: 2076, low: 2070, close: 2072, volume: 100 },
      { time: 1500, open: 2070, high: 2071, low: 2062, close: 2064, volume: 120 },
      { time: 1800, open: 2063, high: 2064, low: 2058, close: 2060, volume: 90 },
      { time: 2100, open: 2054, high: 2057, low: 2051, close: 2053, volume: 110 },
    ]

    const check = checkTrendlineBreakout(mockBearishTrendline, bars)
    assert.equal(check.isCrossed, true) // Wick crossed
    assert.equal(check.isConfirmed5mClose, false) // Bar did NOT close above
    assert.equal(check.entryPrice, null)
  })

  test('2. should trigger ENTRY when 5m candle closes strictly above bearish trendline', () => {
    // Trendline projected at t=2100: ~2055.56
    // Breakout candle closes at 2059.00 (Low: 2051.50)
    const bars: Candle[] = [
      { time: 1200, open: 2075, high: 2076, low: 2070, close: 2072, volume: 100 },
      { time: 1500, open: 2070, high: 2071, low: 2062, close: 2064, volume: 120 },
      { time: 1800, open: 2063, high: 2064, low: 2050, close: 2051, volume: 90 }, // initiating low
      { time: 2100, open: 2052, high: 2060, low: 2051.5, close: 2059, volume: 280 }, // confirmed breakout bar
    ]

    const check = checkTrendlineBreakout(mockBearishTrendline, bars, { fixedTpPts: 50 })
    assert.equal(check.isConfirmed5mClose, true)
    assert.equal(check.entryPrice, 2059)
    // Default SL placed below breakout candle low (2051.5 - 1.0 = 2050.5)
    assert.equal(check.defaultStopLoss, 2050.5)
    // Risk = 2059 - 2050.5 = 8.5 pts
    assert.equal(check.riskPts, 8.5)
    // Default Fixed TP: entry + 50 = 2109
    assert.equal(check.defaultTakeProfitFixed50, 2109)
    // Dynamic 1:2 R:R TP: entry + (8.5 * 2) = 2076
    assert.equal(check.defaultTakeProfit1to2, 2076)
  })

  test('3. should locate the Initiating Point (Origin Low of Trend-Borning Zone)', () => {
    const bars: Candle[] = [
      { time: 1000, open: 2080, high: 2081, low: 2078, close: 2079, volume: 100 },
      { time: 1300, open: 2079, high: 2080, low: 2065, close: 2068, volume: 150 },
      { time: 1600, open: 2068, high: 2069, low: 2048.5, close: 2052, volume: 300 }, // lowest low: 2048.5
      { time: 1900, open: 2052, high: 2058, low: 2051, close: 2056, volume: 180 },
      { time: 2200, open: 2056, high: 2068, low: 2055, close: 2066, volume: 400 }, // breakout
    ]

    const initiating = findInitiatingPoint(mockBearishTrendline, bars, 4)
    assert.notEqual(initiating, null)
    assert.equal(initiating?.price, 2048.5)
    assert.equal(initiating?.time, 1600)
    assert.equal(initiating?.candleIndex, 2)
  })

  test('4. should compute 7-factor institutional score for the Trend-Borning Zone', () => {
    // 2048.5 low bar with Buying Excess Tail (lower wick >= 45%) and high RVOL (350 vs avg 100)
    const bars: Candle[] = [
      { time: 1000, open: 2080, high: 2080, low: 2075, close: 2076, volume: 100 },
      { time: 1300, open: 2076, high: 2077, low: 2068, close: 2070, volume: 100 },
      // Buying Excess Bar: Low 2048.5, Open 2058, Close 2060, High 2061 -> bottom wick is 2058 - 2048.5 = 9.5 out of 12.5 (76% wick!)
      { time: 1600, open: 2058, high: 2061, low: 2048.5, close: 2060, volume: 350 },
      { time: 1900, open: 2060, high: 2065, low: 2059, close: 2064, volume: 200 },
    ]

    const mockChartContext: Partial<ChartContext55> = {
      yesterday: {
        sessionDate: '2026-09-16',
        yh: 2090,
        yl: 2060,
        close: 2075,
        poc: 2072, // Origin 2048.5 is below Y-POC (+10)
        vah: 2080,
        val: 2065,
        volume: 50000,
        openUnix: 1000,
        closeUnix: 5000,
      },
      overnight: {
        overnight: {
          name: 'Overnight',
          startUnix: 1000,
          endUnix: 2000,
          high: 2085,
          low: 2055,
          poc: 2068, // Origin 2048.5 is below ON-POC (+8)
          vah: 2075,
          val: 2060,
          totalVolume: 20000,
        },
        asia: null,
        london: null,
        totalVolume: 20000,
        volumeAboveClose: 10000,
        volumeBelowClose: 10000,
        pctLong: 50,
        pctShort: 50,
        bias: 'BALANCED',
        biasLabel: 'Balanced',
        rangeRelation: 'IN_RANGE',
        rangeLabel: 'In Range',
        summaryBadge: 'Balanced',
        description: 'Balanced',
      },
      frvp5d: {
        startUnix: 1000,
        endUnix: 5000,
        high: 2100,
        low: 2040,
        poc: 2070, // Origin 2048.5 is below 5D POC (+7)
        vah: 2085,
        val: 2055,
        totalVolume: 100000,
        bins: [],
        bucketSize: 1,
        hvn: [],
        lvn: [],
      },
      avwap5m: {
        anchorDate: '2026-05-01',
        anchorUnix: 1000,
        vwap: 2050, // Origin 2048.5 is 1.5 pts from 5M AVWAP! (+15)
        sigma1Upper: 2070,
        sigma1Lower: 2030,
        sigma2Upper: 2090,
        sigma2Lower: 2010,
      },
    }

    const borningResult = evaluateTrendBorningZone({
      initiatingPoint: { time: 1600, price: 2048.5, candleIndex: 2 },
      bars,
      chartContext: mockChartContext as ChartContext55,
      orderFlowAbsorption: true,
    })

    // POC Score: below Y-POC (10) + below ON-POC (8) + below 5D-POC (7) = 25/25
    assert.equal(borningResult.factors.pocLocation.score, 25)
    assert.equal(borningResult.factors.pocLocation.isBelowYpoc, true)

    // Volume Score: High RVOL (350 vs ~100) -> 20/20
    assert.equal(borningResult.factors.volumeQuality.score, 20)

    // Candlestick Score: Buying Excess Tail + Reversal -> 20/20
    assert.equal(borningResult.factors.candlestickPower.hasExcessTail, true)
    assert.equal(borningResult.factors.candlestickPower.score, 20)

    // Round Number: 2048.5 is within 1.5 pts of Half Century 2050 -> +6
    assert.equal(borningResult.factors.roundNumbers.handleType, 'HALF_CENTURY')
    assert.equal(borningResult.factors.roundNumbers.score, 6)

    // 5M AVWAP: 1.5 pts from 2050 AVWAP -> 15/15
    assert.equal(borningResult.factors.avwapSupport.inBand, true)
    assert.equal(borningResult.factors.avwapSupport.score, 15)

    // Liquidity / Delta Absorption: +5
    assert.equal(borningResult.factors.liquidityConfluence.score, 5)

    // Composite score must be Grade A (>= 80)
    assert.ok(borningResult.compositeScore >= 80, `Expected score >= 80, got ${borningResult.compositeScore}`)
    assert.equal(borningResult.grade, 'A')
  })

  test('5. should detect Higher Lows with elapsed timing intervals (T0, T+15m, T+20m)', () => {
    // Origin at t=0 (0m), HL1 at t=900 (15m), HL2 at t=2100 (35m)
    const origin = { time: 0, price: 2050, candleIndex: 0 }
    const bars: Candle[] = [
      { time: 0, open: 2052, high: 2054, low: 2050, close: 2053, volume: 100 },
      { time: 300, open: 2053, high: 2060, low: 2052, close: 2058, volume: 100 },
      { time: 600, open: 2058, high: 2062, low: 2056, close: 2061, volume: 100 },
      // Swing low HL1 at t=900 (low 2055)
      { time: 900, open: 2058, high: 2060, low: 2055, close: 2057, volume: 100 },
      { time: 1200, open: 2057, high: 2065, low: 2056, close: 2064, volume: 100 },
      { time: 1500, open: 2064, high: 2070, low: 2063, close: 2069, volume: 100 },
      { time: 1800, open: 2069, high: 2072, low: 2065, close: 2068, volume: 100 },
      // Swing low HL2 at t=2100 (low 2063)
      { time: 2100, open: 2066, high: 2067, low: 2063, close: 2065, volume: 100 },
      { time: 2400, open: 2065, high: 2075, low: 2064, close: 2074, volume: 100 },
    ]

    const higherLows = detectHigherLowsWithTiming(origin, bars, 8)
    assert.ok(higherLows.length >= 2)
    assert.equal(higherLows[0]!.timingLabel, 'T0 (Origin)')
    assert.ok(higherLows[1]!.timingLabel.includes('T+15m'))
  })

  test('6. should steepen dynamic trendline during sideways stalling (Time-Decay Engine)', () => {
    const origin = { time: 0, price: 2050, candleIndex: 0 }
    const higherLows = [{ time: 0, price: 2050, candleIndex: 0, elapsedSecFromOrigin: 0, elapsedMinutesFromOrigin: 0, timingLabel: 'T0' }]

    // Ranging bars with no progress (compressed between 2060 and 2061 for 6 bars)
    const stallingBars: Candle[] = [
      { time: 0, open: 2050, high: 2052, low: 2049, close: 2051, volume: 100 },
      { time: 300, open: 2051, high: 2058, low: 2051, close: 2057, volume: 100 },
      { time: 600, open: 2060, high: 2061, low: 2060, close: 2060.5, volume: 50 },
      { time: 900, open: 2060.5, high: 2061.2, low: 2060.1, close: 2060.8, volume: 45 },
      { time: 1200, open: 2060.8, high: 2061.0, low: 2060.0, close: 2060.2, volume: 40 },
      { time: 1500, open: 2060.2, high: 2061.5, low: 2060.3, close: 2060.9, volume: 42 },
    ]

    const dynamicLine = calculateDynamicTrendline({
      origin,
      compositeScore: 85,
      higherLows,
      currentPrice: 2060.5,
      currentTime: 1500,
      bars: stallingBars,
    })

    assert.equal(dynamicLine.isStalling, true)
    assert.ok(dynamicLine.consecutiveStallBars >= 3)
    // Effective slope should exceed base slope due to stall penalty
    assert.ok(dynamicLine.effectiveSlopePtsPer5m > dynamicLine.baseSlopePtsPer5m)
  })

  test('7. should trigger systematic EXIT when 5-minute candle closes below dynamic trendline', () => {
    const origin = { time: 0, price: 2050, candleIndex: 0 }
    const dynamicLine = calculateDynamicTrendline({
      origin,
      compositeScore: 75,
      higherLows: [{ time: 0, price: 2050, candleIndex: 0, elapsedSecFromOrigin: 0, elapsedMinutesFromOrigin: 0, timingLabel: 'T0' }],
      currentPrice: 2065,
      currentTime: 300,
      bars: [],
    })

    // At t=300 (5m elapsed), projected price is 2050 + 5.86 = 2055.86
    // Completed 5m candle that closes comfortably above line (2060): NO exit
    const bullishBar: Candle = { time: 300, open: 2056, high: 2062, low: 2055, close: 2060, volume: 100 }
    const check1 = checkDynamicTrendlineExit(dynamicLine, bullishBar)
    assert.equal(check1.shouldExit, false)
    assert.equal(check1.isConfirmed5mCloseBelow, false)

    // Completed 5m candle that closes BELOW dynamic line (e.g. 2045): SYSTEMATIC EXIT
    const breakdownBar: Candle = { time: 300, open: 2056, high: 2057, low: 2044, close: 2045, volume: 300 }
    const check2 = checkDynamicTrendlineExit(dynamicLine, breakdownBar)
    assert.equal(check2.shouldExit, true)
    assert.equal(check2.isConfirmed5mCloseBelow, true)
    assert.equal(check2.exitPrice, 2045)
    assert.ok(check2.reason.includes('5-minute candle close confirmed below dynamic trendline'))
  })
})
