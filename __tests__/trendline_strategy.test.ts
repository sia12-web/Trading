import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkTrendlineBreakout,
  findInitiatingPoint,
  evaluateTrendBorningZone,
  detectHigherLowsWithTiming,
  detectSwingPivotsWithTiming,
  calculateDynamicTrendline,
  checkDynamicTrendlineExit,
  detectSwingVolumeProgression,
  detectSessionTrendlines,
  evaluateChopShield,
  resampleCandlesTo5M,
  detectFlagAndSecondaryBreakout,
  findBreakoutSwingAnchor,
  isReactionTrendlineEligible,
  evaluateHorizontalRunway,
  calculateEmpiricalSpeedlines,
} from '../lib/trading/trendlineStrategy.ts'
import type { UserTrendline } from '../lib/trading/userDrawings.ts'
import type { Candle } from '../lib/trading/candlestickPatterns.ts'
import type { TrendBorningChartContext } from '../lib/trading/trendlineStrategy.ts'

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

  test('8. should calculate structural Borning Zone (±5.0 on Gold) and perform historical support comparison', () => {
    // 6 bars before initiating index where price previously touched [2045, 2055] with volume 100
    // Initiating bar at index 4 with volume 350
    const bars: Candle[] = [
      { time: 0, open: 2052, high: 2054, low: 2048, close: 2050, volume: 100 }, // prior touch
      { time: 300, open: 2050, high: 2055, low: 2047, close: 2049, volume: 100 }, // prior touch
      { time: 600, open: 2060, high: 2065, low: 2059, close: 2064, volume: 100 },
      { time: 900, open: 2062, high: 2063, low: 2053, close: 2054, volume: 120 },
      { time: 1200, open: 2054, high: 2056, low: 2048, close: 2055, volume: 350 }, // initiating low: 2048
      { time: 1500, open: 2055, high: 2064, low: 2054, close: 2063, volume: 250 },
    ]

    const res = evaluateTrendBorningZone({
      initiatingPoint: { time: 1200, price: 2048, candleIndex: 4 },
      bars,
    })

    assert.ok(res.structuralZone)
    assert.equal(res.structuralZone.originPrice, 2048)
    assert.equal(res.structuralZone.zoneSpan, 5.0) // Gold span
    assert.equal(res.structuralZone.zoneLow, 2043)
    assert.equal(res.structuralZone.zoneHigh, 2053)
    assert.ok(res.structuralZone.totalZoneVolume > 0)
    // Initiating volume (350+250) vs prior touch (100+100) -> surge ratio > 1.25 -> Institutional Absorption bonus
    assert.ok(res.structuralZone.historicalVolumeRatio != null)
    assert.ok(res.structuralZone.historicalVolumeRatio >= 1.25)
    assert.ok(res.factors.volumeQuality.historicalComparisonDesc?.includes('Institutional Absorption'))
  })

  test('9. should detect swing volume progression (declining swing volume triggers buyer exhaustion penalty)', () => {
    // Breakout at index 1.
    // Swing High 1 at index 3 (High: 2070, Vol: 300)
    // Swing Low at index 5 (Low: 2062, Vol: 100)
    // Swing High 2 at index 7 (High: 2075, Vol: 120) -> 60% drop in volume on higher high!
    const bars: Candle[] = [
      { time: 0, open: 2050, high: 2052, low: 2049, close: 2051, volume: 100 },
      { time: 300, open: 2051, high: 2058, low: 2051, close: 2057, volume: 200 }, // Breakout (index 1)
      { time: 600, open: 2057, high: 2065, low: 2056, close: 2064, volume: 220 },
      { time: 900, open: 2064, high: 2070, low: 2063, close: 2068, volume: 300 }, // SH 1 (index 3, vol 300)
      { time: 1200, open: 2068, high: 2069, low: 2064, close: 2065, volume: 150 },
      { time: 1500, open: 2065, high: 2066, low: 2062, close: 2063, volume: 100 }, // SL (index 5)
      { time: 1800, open: 2063, high: 2071, low: 2063, close: 2070, volume: 110 },
      { time: 2100, open: 2070, high: 2075, low: 2069, close: 2074, volume: 120 }, // SH 2 (index 7, vol 120 vs 300)
      { time: 2400, open: 2074, high: 2074, low: 2068, close: 2069, volume: 90 },
    ]

    const prog = detectSwingVolumeProgression(bars, 1)
    assert.equal(prog.trend, 'DECLINING')
    assert.ok(prog.decayPercentage <= -15)
    assert.ok(prog.scoreDelta < 0) // Negative penalty
    assert.ok(prog.slopeAccelerationPenalty > 0) // Steepening slope penalty active
    assert.ok(prog.description.includes('Buyer Exhaustion'))
  })

  test('10. should steepen dynamic trendline and reduce score when swing volume dries up', () => {
    const origin = { time: 0, price: 2050, candleIndex: 0 }
    const higherLows = [{ time: 0, price: 2050, candleIndex: 0, elapsedSecFromOrigin: 0, elapsedMinutesFromOrigin: 0, timingLabel: 'T0' }]

    // Bars with declining swing volume
    const barsWithDecayingVolume: Candle[] = [
      { time: 0, open: 2050, high: 2052, low: 2049, close: 2051, volume: 100 },
      { time: 300, open: 2051, high: 2058, low: 2051, close: 2057, volume: 200 },
      { time: 600, open: 2057, high: 2065, low: 2056, close: 2064, volume: 220 },
      { time: 900, open: 2064, high: 2070, low: 2063, close: 2068, volume: 300 }, // Swing high 1 (vol 300)
      { time: 1200, open: 2068, high: 2069, low: 2064, close: 2065, volume: 150 },
      { time: 1500, open: 2065, high: 2066, low: 2062, close: 2063, volume: 100 },
      { time: 1800, open: 2063, high: 2071, low: 2063, close: 2070, volume: 110 },
      { time: 2100, open: 2070, high: 2075, low: 2069, close: 2074, volume: 120 }, // Swing high 2 (vol 120)
      { time: 2400, open: 2074, high: 2074, low: 2068, close: 2069, volume: 90 },
    ]

    const dynamicLine = calculateDynamicTrendline({
      origin,
      compositeScore: 85,
      higherLows,
      currentPrice: 2070,
      currentTime: 2400,
      bars: barsWithDecayingVolume,
    })

    assert.ok(dynamicLine.swingVolumeProgression)
    assert.equal(dynamicLine.swingVolumeProgression?.trend, 'DECLINING')
    // Score should be reduced from base 85
    assert.ok(dynamicLine.compositeScore < 85)
    // volumeDecayPenalty should be > 0 and added to effective slope
    assert.ok(dynamicLine.volumeDecayPenalty > 0)
    assert.ok(dynamicLine.effectiveSlopePtsPer5m > dynamicLine.baseSlopePtsPer5m)
  })

  // ── TWO-WAY EXECUTION & SESSION PIPELINE TESTS ──

  test('11. should trigger SHORT entry when 5m candle closes strictly below ascending bullish trendline', () => {
    // Ascending bullish trendline: p1(t=1000, p=2040) -> p2(t=1900, p=2060) -> slope = +20 pts / 900s
    const mockBullishTrendline: UserTrendline = {
      id: 'tl-bull-1',
      type: 'TRENDLINE',
      p1: { time: 1000, price: 2040 },
      p2: { time: 1900, price: 2060 },
      color: '#22c55e',
    }

    // At t=2100: projected line = 2040 + (20/900)*(1100) = 2064.44
    // Candle at t=2100 closes at 2061 (Low: 2060, High: 2067) -> closes below line!
    const bars: Candle[] = [
      { time: 1200, open: 2042, high: 2048, low: 2041, close: 2046, volume: 100 },
      { time: 1500, open: 2047, high: 2055, low: 2046, close: 2053, volume: 120 },
      { time: 1800, open: 2054, high: 2072, low: 2053, close: 2070, volume: 300 }, // initiating high: 2072
      { time: 2100, open: 2068, high: 2069, low: 2060, close: 2061, volume: 250 }, // confirmed 5m close below 2064.44
    ]

    const check = checkTrendlineBreakout(mockBullishTrendline, bars, { fixedTpPts: 50 })
    assert.equal(check.direction, 'SHORT')
    assert.equal(check.trendlineDirection, 'BULLISH')
    assert.equal(check.isConfirmed5mClose, true)
    assert.equal(check.entryPrice, 2061)
    // Default SL for Short: breakout candle high + 1.0 = 2069 + 1.0 = 2070
    assert.equal(check.defaultStopLoss, 2070)
    // Risk = 2070 - 2061 = 9 pts
    assert.equal(check.riskPts, 9)
    // Fixed TP 50 pts: 2061 - 50 = 2011
    assert.equal(check.defaultTakeProfitFixed50, 2011)
    // 1:2 R:R TP: 2061 - (9 * 2) = 2043
    assert.equal(check.defaultTakeProfit1to2, 2043)
  })

  test('12. should locate the Initiating Point for SHORT (Origin High of Bearish Borning Zone)', () => {
    const mockBullishTrendline: UserTrendline = {
      id: 'tl-bull-2',
      type: 'TRENDLINE',
      p1: { time: 1000, price: 2040 },
      p2: { time: 1900, price: 2060 },
    }

    const bars: Candle[] = [
      { time: 1000, open: 2040, high: 2045, low: 2038, close: 2043, volume: 100 },
      { time: 1300, open: 2044, high: 2058, low: 2042, close: 2056, volume: 120 },
      { time: 1600, open: 2057, high: 2078.5, low: 2055, close: 2074, volume: 350 }, // highest high: 2078.5
      { time: 1900, open: 2072, high: 2073, low: 2062, close: 2064, volume: 150 },
      { time: 2200, open: 2063, high: 2065, low: 2050, close: 2052, volume: 400 }, // breakout down
    ]

    const initiating = findInitiatingPoint(mockBullishTrendline, bars, 4, { direction: 'SHORT' })
    assert.notEqual(initiating, null)
    assert.equal(initiating?.type, 'HIGH')
    assert.equal(initiating?.price, 2078.5)
    assert.equal(initiating?.time, 1600)
    assert.equal(initiating?.candleIndex, 2)
  })

  test('13. should compute 7-factor institutional score for SHORT Bearish Trend-Borning Zone', () => {
    // 2078.5 high bar with Selling Excess Tail (upper wick >= 45%) and high RVOL
    const bars: Candle[] = [
      { time: 1000, open: 2045, high: 2050, low: 2044, close: 2048, volume: 100 },
      { time: 1300, open: 2049, high: 2060, low: 2048, close: 2058, volume: 100 },
      // Selling Excess Bar: Open 2065, High 2078.5, Close 2063, Low 2062 -> top wick is 2078.5 - 2065 = 13.5 out of 16.5 (81% top wick!)
      { time: 1600, open: 2065, high: 2078.5, low: 2062, close: 2063, volume: 380 },
      { time: 1900, open: 2062, high: 2064, low: 2055, close: 2057, volume: 200 },
    ]

    const mockChartContext: any = {
      yesterday: { poc: 2060 }, // Origin 2078.5 is ABOVE Y-POC (+10)
      overnight: {
        overnight: { poc: 2065 }, // Origin 2078.5 is ABOVE ON-POC (+8)
      },
      frvp5d: { poc: 2062 }, // Origin 2078.5 is ABOVE 5D-POC (+7)
      avwap5m: {
        vwap: 2075, // Origin 2078.5 is within 3.5 pts of 5M AVWAP resistance! (+15)
        sigma1Upper: 2085,
        sigma1Lower: 2065,
      },
    }

    const borningResult = evaluateTrendBorningZone({
      initiatingPoint: { time: 1600, price: 2078.5, candleIndex: 2, type: 'HIGH' },
      bars,
      chartContext: mockChartContext,
      orderFlowAbsorption: true,
      direction: 'SHORT',
    })

    assert.equal(borningResult.direction, 'SHORT')
    // POC Score: above Y-POC (10) + above ON-POC (8) + above 5D-POC (7) = 25/25
    assert.equal(borningResult.factors.pocLocation.score, 25)
    assert.equal(borningResult.factors.pocLocation.isAboveYpoc, true)
    assert.equal(borningResult.factors.pocLocation.isAboveOnPoc, true)
    assert.equal(borningResult.factors.pocLocation.isAbove5dPoc, true)

    // Volume score: High RVOL (380 vs 100) -> 20/20
    assert.equal(borningResult.factors.volumeQuality.score, 20)

    // Candlestick power: Selling Excess Tail -> 20/20
    assert.equal(borningResult.factors.candlestickPower.hasExcessTail, true)
    assert.equal(borningResult.factors.candlestickPower.score, 20)

    // 5M AVWAP resistance: within 15 pts -> 15/15
    assert.equal(borningResult.factors.avwapSupport.score, 15)

    // Delta Absorption / Trapped Buyers: 5/5
    assert.equal(borningResult.factors.liquidityConfluence.score, 5)

    // Grade A composite score >= 80
    assert.ok(borningResult.compositeScore >= 80)
    assert.equal(borningResult.grade, 'A')
  })

  test('14. should construct descending dynamic trendline for SHORT and trigger EXIT on 5m close ABOVE line', () => {
    const origin = { time: 0, price: 2080, candleIndex: 0, type: 'HIGH' as const }
    const lowerHighs = [
      { time: 0, price: 2080, candleIndex: 0, elapsedSecFromOrigin: 0, elapsedMinutesFromOrigin: 0, timingLabel: 'T0 (Origin High)' },
      { time: 900, price: 2074, candleIndex: 3, elapsedSecFromOrigin: 900, elapsedMinutesFromOrigin: 15, timingLabel: 'LH1 (T+15m)' },
    ]

    const dynamicShortLine = calculateDynamicTrendline({
      origin,
      compositeScore: 75,
      higherLows: lowerHighs,
      currentPrice: 2065,
      currentTime: 1200,
      bars: [],
      direction: 'SHORT',
    })

    assert.equal(dynamicShortLine.direction, 'SHORT')
    // For Short, effective slope must be negative (sloping downward above price)
    assert.ok(dynamicShortLine.effectiveSlopePtsPer5m < 0)
    assert.ok(dynamicShortLine.slopePtsPerSec < 0)

    // At t=1500 (300s after LH1 at 2074): projected line is below 2074 (e.g. ~2068)
    // A 5m candle that continues moving downward (close 2062 < projected): NO exit
    const safeBearBar: Candle = { time: 1500, open: 2065, high: 2066, low: 2060, close: 2062, volume: 100 }
    const check1 = checkDynamicTrendlineExit(dynamicShortLine, safeBearBar)
    assert.equal(check1.shouldExit, false)
    assert.equal(check1.isConfirmed5mCloseAbove, false)

    // A 5m candle that closes ABOVE the descending trendline (close 2076 > projected): SYSTEMATIC SHORT EXIT
    const reversalBullBar: Candle = { time: 1500, open: 2064, high: 2077, low: 2063, close: 2076, volume: 300 }
    const check2 = checkDynamicTrendlineExit(dynamicShortLine, reversalBullBar)
    assert.equal(check2.shouldExit, true)
    assert.equal(check2.isConfirmed5mCloseAbove, true)
    assert.equal(check2.exitPrice, 2076)
    assert.ok(check2.reason.includes('5-minute candle close confirmed above dynamic trendline'))
  })

  test('15. should auto-detect session trendline from Asia/London and carry forward to NYC', () => {
    // Generate bars representing Asia session (18:00 ET -> 03:00 ET)
    const baseAsiaStart = 1773784800
    const bars: Candle[] = [
      { time: baseAsiaStart, open: 2070, high: 2072, low: 2068, close: 2070, volume: 100 },
      // Swing High 1 at +300 (high: 2078 > 2072 and > 2071)
      { time: baseAsiaStart + 300, open: 2070, high: 2078, low: 2069, close: 2076, volume: 100 },
      { time: baseAsiaStart + 600, open: 2075, high: 2071, low: 2064, close: 2066, volume: 100 },
      { time: baseAsiaStart + 900, open: 2066, high: 2067, low: 2062, close: 2063, volume: 100 },
      // Swing High 2 at +1200 (high: 2072 > 2067 and > 2065) - Descending from 2078!
      { time: baseAsiaStart + 1200, open: 2063, high: 2072, low: 2060, close: 2068, volume: 100 },
      { time: baseAsiaStart + 1500, open: 2067, high: 2065, low: 2058, close: 2060, volume: 100 },
      { time: baseAsiaStart + 1800, open: 2060, high: 2061, low: 2055, close: 2058, volume: 100 },
    ]

    const sessRes = detectSessionTrendlines(bars, { currentUnix: baseAsiaStart + 1800 })
    assert.ok(sessRes.allPivots.length >= 2)
    assert.ok(sessRes.summary.length > 0)
    assert.ok(sessRes.activeUnbrokenTrendline != null)
    assert.equal(sessRes.activeUnbrokenTrendline?.direction, 'BEARISH')
    assert.equal(sessRes.activeUnbrokenTrendline?.sessionOrigin, 'Asia')
  })

  test('16. should activate Dalton Balance Day Chop Shield on rapid alternating breakouts', () => {
    const tNow = 10000
    const alternatingBreaks = [
      { time: tNow - 3000, direction: 'LONG' as const },
      { time: tNow - 1200, direction: 'SHORT' as const }, // Alternated within 1800s (< 5400s)
    ]

    const shield = evaluateChopShield({
      breakoutHistory: alternatingBreaks,
    })

    assert.equal(shield.isChopShieldActive, true)
    // Required score must be elevated to Grade A (>= 75)
    assert.equal(shield.minScoreRequired, 75)
    // Stall penalty must be doubled to 2.0 to exit fast on false moves
    assert.equal(shield.stallPenaltyMultiplier, 2.0)
    assert.ok(shield.reason.includes('Chop Shield Active'))
  })

  test('17. should distinguish user-drawn Action Trendline (Initial Overnight) and arm systematic breakout reaction', () => {
    // Manually drawn Action Trendline connecting lower highs from overnight
    const actionTrendline: UserTrendline = {
      id: 'action-tl-overnight-1',
      type: 'TRENDLINE',
      p1: { time: 1000, price: 2060 },
      p2: { time: 1900, price: 2040 },
      direction: 'BEARISH',
      isActionTrendline: true,
      isInitialOvernight: true,
      sessionOrigin: 'London',
      label: 'Action Trendline (Long on Break)',
    }

    assert.equal(actionTrendline.isActionTrendline, true)
    assert.equal(actionTrendline.isInitialOvernight, true)
    assert.equal(actionTrendline.sessionOrigin, 'London')

    // At t=2200: projected line = 2040 - (20/900)*(300) = 2033.33
    // Candle at t=2200 closes at 2038 (Low: 2031, High: 2039) -> closes strictly above line!
    const bars: Candle[] = [
      { time: 1000, open: 2060, high: 2062, low: 2056, close: 2058, volume: 100 },
      { time: 1300, open: 2058, high: 2059, low: 2045, close: 2047, volume: 120 },
      { time: 1600, open: 2028, high: 2030, low: 2025, close: 2029, volume: 450 }, // lowest low at 2025 with buying excess tail (60% lower wick)
      { time: 1900, open: 2028, high: 2035, low: 2026, close: 2033, volume: 200 },
      { time: 2200, open: 2033, high: 2039, low: 2031, close: 2038, volume: 500 }, // confirmed 5m close above 2033.33 in NYC
    ]

    const breakout = checkTrendlineBreakout(actionTrendline, bars, { fixedTpPts: 50 })
    assert.equal(breakout.direction, 'LONG')
    assert.equal(breakout.isConfirmed5mClose, true)
    assert.equal(breakout.entryPrice, 2038)
    assert.equal(breakout.defaultStopLoss, 2030) // candle low 2031 - 1.0 = 2030
    assert.equal(breakout.defaultTakeProfitFixed50, 2088) // 2038 + 50 = 2088

    const initiating = findInitiatingPoint(actionTrendline, bars, breakout.breakoutCandleIndex!)
    assert.notEqual(initiating, null)
    assert.equal(initiating?.price, 2025)
    assert.equal(initiating?.type, 'LOW')

    const borningZone = evaluateTrendBorningZone({
      initiatingPoint: initiating!,
      bars,
      chartContext: {
        yesterday: { poc: 2040 }, // Origin 2025 is below Y-POC (+10)
        overnight: { overnight: { poc: 2035 } }, // Origin 2025 is below ON-POC (+8)
        frvp5d: { poc: 2038 }, // Origin 2025 is below 5D-POC (+7)
      },
      direction: 'LONG',
    })
    assert.ok(borningZone.compositeScore >= 60)
  })

  test('18. should normalize inverted anchor points (P2 clicked before P1) and calculate correct slope', () => {
    // User clicks right point first (t=1900, p=2040) and left point second (t=1000, p=2060)
    const invertedTrendline: UserTrendline = {
      id: 'tl-inverted-1',
      type: 'TRENDLINE',
      p1: { time: 1900, price: 2040 },
      p2: { time: 1000, price: 2060 },
      direction: 'BEARISH',
    }

    const bars: Candle[] = [
      { time: 1000, open: 2060, high: 2062, low: 2056, close: 2058, volume: 100 },
      { time: 1300, open: 2058, high: 2059, low: 2045, close: 2047, volume: 120 },
      { time: 1900, open: 2041, high: 2042, low: 2038, close: 2039, volume: 150 },
      { time: 2200, open: 2033, high: 2040, low: 2032, close: 2039, volume: 300 }, // Breakout bar above line (~2033.33)
    ]

    const breakout = checkTrendlineBreakout(invertedTrendline, bars)
    assert.equal(breakout.direction, 'LONG')
    assert.equal(breakout.isConfirmed5mClose, true)
    assert.equal(breakout.entryPrice, 2039)
  })

  test('19. should NOT trigger breakout on bars occurring prior to minBreakoutTime', () => {
    // Trendline from t=1000 to t=1900
    const tl: UserTrendline = {
      id: 'tl-stale-1',
      type: 'TRENDLINE',
      p1: { time: 1000, price: 2060 },
      p2: { time: 1900, price: 2040 },
    }

    // Bar at t=1950 broke the line, but rule was armed later at minBreakoutTime = 2100
    const bars: Candle[] = [
      { time: 1950, open: 2040, high: 2045, low: 2038, close: 2044, volume: 200 }, // Old overnight break
      { time: 2200, open: 2032, high: 2042, low: 2030, close: 2041, volume: 300 }, // Fresh NYC break
    ]

    const checkWithMinTime = checkTrendlineBreakout(tl, bars, { minBreakoutTime: 2100 })
    assert.equal(checkWithMinTime.isConfirmed5mClose, true)
    // Must trigger on the fresh bar at 2200, NOT the old bar at 1950
    assert.equal(checkWithMinTime.breakoutCandle?.time, 2200)
    assert.equal(checkWithMinTime.entryPrice, 2041)
  })

  test('20. should NOT treat actively forming 5m candle as confirmed close until 300s elapsed', () => {
    const tl: UserTrendline = {
      id: 'tl-forming-1',
      type: 'TRENDLINE',
      p1: { time: 1000, price: 2060 },
      p2: { time: 1900, price: 2040 },
    }

    // Bar at t=2200 with 1s tick above line
    const bars: Candle[] = [
      { time: 1900, open: 2041, high: 2042, low: 2038, close: 2039, volume: 150 },
      { time: 2200, open: 2034, high: 2040, low: 2032, close: 2039, volume: 300 }, // line at 2200 is 2033.33
    ]

    // While only 120s elapsed (currentTime = 2320 < 2200 + 300)
    const checkForming = checkTrendlineBreakout(tl, bars, { currentTimeSec: 2320, barDurationSec: 300 })
    assert.equal(checkForming.isCrossed, true) // Tick crossed
    assert.equal(checkForming.isConfirmed5mClose, false) // Not confirmed close yet!

    // Once 300s elapsed (currentTime = 2500 >= 2200 + 300)
    const checkCompleted = checkTrendlineBreakout(tl, bars, { currentTimeSec: 2500, barDurationSec: 300 })
    assert.equal(checkCompleted.isConfirmed5mClose, true) // Confirmed close!
    assert.equal(checkCompleted.entryPrice, 2039)
  })

  test('21. should reject dynamic trendline exit on intra-bar tick dip if 5m bar is still forming', () => {
    const dynLine = calculateDynamicTrendline({
      origin: { time: 1600, price: 2025, type: 'LOW' },
      compositeScore: 80,
      higherLows: [{ time: 1600, price: 2025, candleIndex: 0, elapsedSecFromOrigin: 0, elapsedMinutesFromOrigin: 0, timingLabel: 'T0' }],
      currentPrice: 2040,
      currentTime: 2200,
      bars: [
        { time: 1600, open: 2025, high: 2030, low: 2025, close: 2028, volume: 100 },
        { time: 1900, open: 2028, high: 2035, low: 2027, close: 2034, volume: 100 },
      ],
      direction: 'LONG',
    })

    // Projected dynamic line at t=2200 is ~2035
    // Forming bar at t=2200 dips to close 2030
    const formingBar: Candle = { time: 2200, open: 2036, high: 2037, low: 2029, close: 2030, volume: 150 }

    // While still forming at t=2290 (only 90s into the 5m bar):
    const exitForming = checkDynamicTrendlineExit(dynLine, formingBar, { currentTimeSec: 2290, barDurationSec: 300 })
    assert.equal(exitForming.shouldExit, false) // Must NOT exit intra-bar

    // Once bar completes at t=2500:
    const exitCompleted = checkDynamicTrendlineExit(dynLine, formingBar, { currentTimeSec: 2500, barDurationSec: 300 })
    assert.equal(exitCompleted.shouldExit, true) // Confirmed close below -> Exit!
  })

  test('22. should resample 1m bars into strictly aligned 5m candles', () => {
    // 5 one-minute bars spanning 00:00 to 00:04 (t = 0, 60, 120, 180, 240)
    const bars1m: Candle[] = [
      { time: 0, open: 2050, high: 2052, low: 2049, close: 2051, volume: 20 },
      { time: 60, open: 2051, high: 2055, low: 2050, close: 2054, volume: 30 },
      { time: 120, open: 2054, high: 2056, low: 2053, close: 2055, volume: 25 },
      { time: 180, open: 2055, high: 2055, low: 2048, close: 2049, volume: 40 },
      { time: 240, open: 2049, high: 2053, low: 2049, close: 2052, volume: 35 },
    ]

    const resampled = resampleCandlesTo5M(bars1m)
    assert.equal(resampled.length, 1)
    const c5m = resampled[0]!
    assert.equal(c5m.time, 0)
    assert.equal(c5m.open, 2050) // Open of first 1m bar
    assert.equal(c5m.high, 2056) // Max high across all five bars
    assert.equal(c5m.low, 2048) // Min low across all five bars
    assert.equal(c5m.close, 2052) // Close of last 1m bar
    assert.equal(c5m.volume, 150) // Sum of volume: 20+30+25+40+35 = 150
  })

  test('23. should superimpose dynamic trendline onto real higher low pivots when available, falling back to institutional score when no pivots exist yet', () => {
    const origin = { time: 0, price: 2050, candleIndex: 0 }

    // Phase 1: Newborn breakout with only Origin (0 structural pivots yet)
    const lineScoreGuided = calculateDynamicTrendline({
      origin,
      compositeScore: 90,
      higherLows: [{ time: 0, price: 2050, candleIndex: 0, elapsedSecFromOrigin: 0, elapsedMinutesFromOrigin: 0, timingLabel: 'T0' }],
      currentPrice: 2055,
      currentTime: 300,
      bars: [],
      direction: 'LONG',
    })
    assert.equal(lineScoreGuided.isEmpiricalPivotSlope, false)
    assert.ok(lineScoreGuided.effectiveSlopePtsPer5m > 6.0) // Score-guided projection

    // Phase 2: Price action prints real Higher Low (HL1 at t=1800 with low=2062)
    const lineEmpirical = calculateDynamicTrendline({
      origin,
      compositeScore: 90,
      higherLows: [
        { time: 0, price: 2050, candleIndex: 0, elapsedSecFromOrigin: 0, elapsedMinutesFromOrigin: 0, timingLabel: 'T0' },
        { time: 1800, price: 2062, candleIndex: 6, elapsedSecFromOrigin: 1800, elapsedMinutesFromOrigin: 30, timingLabel: 'HL1 (T+30m)' },
      ],
      currentPrice: 2065,
      currentTime: 2100,
      bars: [],
      direction: 'LONG',
    })

    // Real empirical slope: (2062 - 2050) / 1800s * 300s = 12 / 6 = 2.0 pts / 5m!
    assert.equal(lineEmpirical.isEmpiricalPivotSlope, true)
    assert.equal(lineEmpirical.baseSlopePtsPer5m, 2.0)
    assert.equal(lineEmpirical.effectiveSlopePtsPer5m, 2.0)
    assert.equal(lineEmpirical.p1.price, 2050) // Starts at Origin
    // At t=1800, projected line passes exactly through HL1 (2062)
    const checkAtHl1 = checkDynamicTrendlineExit(lineEmpirical, {
      time: 1800,
      open: 2063,
      high: 2066,
      low: 2062,
      close: 2064,
      volume: 100,
    })
    assert.equal(checkAtHl1.projectedTrendlinePrice, 2062)
  })

  test('24. should NOT trigger false breakout on candle containing Anchor 2 (P2) or when subsequent candles stay on valid side', () => {
    // User scenario: Bullish Action Trendline drawn in Tokyo/Asia from P1 (1000, 52184) to P2 (1900, 52195)
    const tl: UserTrendline = {
      id: 'tl-tokyo-bull',
      type: 'TRENDLINE',
      p1: { time: 1000, price: 52184 },
      p2: { time: 1900, price: 52195 },
      color: '#f59e0b',
      isActionTrendline: true,
    }

    // Bar at 1900 is Anchor 2 itself (low 52195, close 52195)
    // Subsequent bars (2200, 2500, 2800, 3100) all trade comfortably ABOVE the trendline
    const bars: Candle[] = [
      { time: 1000, open: 52185, high: 52188, low: 52184, close: 52186, volume: 100 },
      { time: 1300, open: 52186, high: 52192, low: 52185, close: 52190, volume: 120 },
      { time: 1600, open: 52190, high: 52198, low: 52188, close: 52196, volume: 150 },
      { time: 1900, open: 52197, high: 52200, low: 52195, close: 52195, volume: 180 }, // Anchor 2 bar
      { time: 2200, open: 52201, high: 52206, low: 52200, close: 52204, volume: 200 }, // Post-anchor bar 1 (strictly above line 52198.67)
      { time: 2500, open: 52204, high: 52208, low: 52203, close: 52206, volume: 220 }, // Post-anchor bar 2 (strictly above line 52202.33)
      { time: 2800, open: 52207, high: 52212, low: 52207, close: 52210, volume: 190 }, // Post-anchor bar 3 (strictly above line 52206.00)
      { time: 3100, open: 52211, high: 52215, low: 52210, close: 52213, volume: 210 }, // Post-anchor bar 4 (strictly above line 52209.67)
    ]

    const check = checkTrendlineBreakout(tl, bars)
    // Must NOT trigger breakout! Zero bars closed below trendline after Anchor 2
    assert.equal(check.isConfirmed5mClose, false)
    assert.equal(check.isCrossed, false)
    assert.equal(check.breakoutCandle, null)
    assert.equal(check.entryPrice, null)
  })

  test('25. should trigger breakout ONLY when a post-P2 candle closes across the trendline', () => {
    const tl: UserTrendline = {
      id: 'tl-tokyo-bull-2',
      type: 'TRENDLINE',
      p1: { time: 1000, price: 52184 },
      p2: { time: 1900, price: 52195 },
      color: '#f59e0b',
      isActionTrendline: true,
    }

    // Line projected at t=3400: 52184 + ((52195 - 52184)/900) * 2400 = 52184 + (11/900)*2400 = 52184 + 29.33 = 52213.33
    // At t=3400, price breaks down and candle closes at 52190 (below 52213.33)
    const bars: Candle[] = [
      { time: 1000, open: 52185, high: 52188, low: 52184, close: 52186, volume: 100 },
      { time: 1900, open: 52197, high: 52200, low: 52195, close: 52195, volume: 180 }, // Anchor 2 bar
      { time: 2200, open: 52196, high: 52206, low: 52196, close: 52202, volume: 200 },
      { time: 2500, open: 52202, high: 52208, low: 52200, close: 52205, volume: 220 },
      { time: 2800, open: 52205, high: 52212, low: 52204, close: 52210, volume: 190 },
      { time: 3100, open: 52210, high: 52220, low: 52208, close: 52218, volume: 210 },
      { time: 3400, open: 52216, high: 52217, low: 52189, close: 52190, volume: 450 }, // Real breakout bar!
    ]

    const check = checkTrendlineBreakout(tl, bars)
    assert.equal(check.isConfirmed5mClose, true)
    assert.equal(check.breakoutCandle?.time, 3400)
    assert.equal(check.entryPrice, 52190)
    assert.equal(check.direction, 'SHORT')
  })

  test('26. should NOT trigger REACTION BROKEN when price flags or consolidates in Phase 1 after breakout', () => {
    // Breakout occurs at t=1000 with close 52200. Origin is at t=500 with low 52180.
    const origin = { time: 500, price: 52180, candleIndex: 0, type: 'LOW' as const }
    const breakoutCandle: Candle = { time: 1000, open: 52190, high: 52205, low: 52188, close: 52200, volume: 300 }
    const structuralZone = {
      originPrice: 52180,
      zoneSpan: 10,
      zoneLow: 52175,
      zoneHigh: 52185,
      totalZoneVolume: 500,
      barCount: 3,
      avgBarVolume: 166,
    }

    // Post-breakout flag consolidation: candles pull back slightly and move sideways above the Borning Zone
    const bars: Candle[] = [
      { time: 500, open: 52182, high: 52186, low: 52180, close: 52184, volume: 150 }, // Origin bar
      breakoutCandle, // t=1000
      { time: 1300, open: 52201, high: 52210, low: 52198, close: 52205, volume: 200 }, // Impulse continuation
      { time: 1600, open: 52205, high: 52208, low: 52194, close: 52196, volume: 120 }, // Flag bar 1 (pullback)
      { time: 1900, open: 52196, high: 52202, low: 52195, close: 52200, volume: 110 }, // Flag bar 2 (pause)
      { time: 2200, open: 52200, high: 52204, low: 52196, close: 52198, volume: 100 }, // Flag bar 3 (pause)
    ]

    const flagState = detectFlagAndSecondaryBreakout({
      origin,
      breakoutCandle,
      bars,
      direction: 'LONG',
      structuralZone,
    })

    assert.equal(flagState.phase, 'FLAG_FORMING')
    assert.equal(flagState.polePrice, 52210)
    assert.equal(flagState.flagExtremePrice, 52194)
    assert.equal(flagState.flagCandleCount, 3)
    assert.equal(flagState.isSecondaryBreakout, false)

    const dynamicLine = calculateDynamicTrendline({
      origin,
      compositeScore: 80,
      higherLows: flagState.confirmedPivots,
      currentPrice: 52198,
      currentTime: 2200,
      bars,
      direction: 'LONG',
      breakoutCandle,
      flagState,
      structuralZone,
    })

    assert.equal(dynamicLine.isPhase1, true)
    // Projected price must act as support floor strictly below flag lows (52194)
    assert.ok(dynamicLine.currentProjectedPrice <= 52194)

    // For every flag candle, verify checkDynamicTrendlineExit does NOT trigger exit!
    for (let i = 2; i < bars.length; i++) {
      const exitCheck = checkDynamicTrendlineExit(dynamicLine, bars[i]!, {
        currentTimeSec: 2500,
        barDurationSec: 300,
        structuralZone,
      })
      assert.equal(exitCheck.shouldExit, false, `Bar at ${bars[i]!.time} falsely triggered exit!`)
      assert.ok(exitCheck.reason.includes('Phase 1: Incubation / Flag consolidation holding above Borning Zone'))
    }
  })

  test('27. should detect Bull Flag consolidation and trigger Secondary Breakout on 5m close above impulse pole', () => {
    const origin = { time: 500, price: 52180, candleIndex: 0, type: 'LOW' as const }
    const breakoutCandle: Candle = { time: 1000, open: 52190, high: 52205, low: 52188, close: 52200, volume: 300 }
    const structuralZone = {
      originPrice: 52180,
      zoneSpan: 10,
      zoneLow: 52175,
      zoneHigh: 52185,
      totalZoneVolume: 500,
      barCount: 3,
      avgBarVolume: 166,
    }

    const bars: Candle[] = [
      { time: 500, open: 52182, high: 52186, low: 52180, close: 52184, volume: 150 },
      breakoutCandle,
      { time: 1300, open: 52201, high: 52215, low: 52198, close: 52212, volume: 250 }, // Pole High = 52215
      { time: 1600, open: 52212, high: 52214, low: 52202, close: 52205, volume: 120 }, // Flag Low = 52202
      { time: 1900, open: 52205, high: 52210, low: 52203, close: 52208, volume: 110 },
      { time: 2200, open: 52208, high: 52222, low: 52206, close: 52220, volume: 400 }, // Secondary Breakout: Close 52220 > Pole 52215!
    ]

    const flagState = detectFlagAndSecondaryBreakout({
      origin,
      breakoutCandle,
      bars,
      direction: 'LONG',
      structuralZone,
    })

    assert.equal(flagState.isSecondaryBreakout, true)
    assert.equal(flagState.polePrice, 52215)
    assert.equal(flagState.flagExtremePrice, 52202)
    assert.equal(flagState.secondaryBreakoutCandle?.time, 2200)
    assert.equal(flagState.secondaryBreakoutPrice, 52220)
    assert.equal(flagState.phase, 'SECONDARY_BREAKOUT')
  })

  test('28. should promote flag low to confirmed Higher Low 1 (HL1) upon secondary breakout, establishing genuine 2-point trendline', () => {
    const origin = { time: 500, price: 52180, candleIndex: 0, type: 'LOW' as const }
    const breakoutCandle: Candle = { time: 1000, open: 52190, high: 52205, low: 52188, close: 52200, volume: 300 }
    const bars: Candle[] = [
      { time: 500, open: 52182, high: 52186, low: 52180, close: 52184, volume: 150 },
      breakoutCandle,
      { time: 1300, open: 52201, high: 52215, low: 52198, close: 52212, volume: 250 }, // Pole High = 52215
      { time: 1600, open: 52212, high: 52214, low: 52202, close: 52205, volume: 120 }, // Flag Low = 52202 (HL1)
      { time: 1900, open: 52205, high: 52210, low: 52203, close: 52208, volume: 110 },
      { time: 2200, open: 52208, high: 52222, low: 52206, close: 52220, volume: 400 }, // Secondary Breakout
    ]

    const flagState = detectFlagAndSecondaryBreakout({
      origin,
      breakoutCandle,
      bars,
      direction: 'LONG',
    })

    // Confirmed pivots must now have Origin T0 and promoted Flag Low HL1!
    assert.equal(flagState.confirmedPivots.length, 2)
    assert.equal(flagState.confirmedPivots[0]!.price, 52180)
    assert.equal(flagState.confirmedPivots[1]!.price, 52202)
    assert.equal(flagState.confirmedPivots[1]!.time, 1600)
    assert.ok(flagState.confirmedPivots[1]!.timingLabel.includes('HL1'))

    const dynamicLine = calculateDynamicTrendline({
      origin,
      compositeScore: 85,
      higherLows: flagState.confirmedPivots,
      currentPrice: 52220,
      currentTime: 2200,
      bars,
      direction: 'LONG',
      breakoutCandle,
      flagState,
    })

    // Must be a verified 2-point empirical trendline connecting Origin (52180) to HL1 (52202)!
    assert.equal(dynamicLine.isEmpiricalPivotSlope, true)
    assert.equal(dynamicLine.activePivotCount, 2)
    assert.equal(dynamicLine.p1.price, 52180)
    // Empirical slope: (52202 - 52180) / (1600 - 500)s * 300s = 22 / 1100 * 300 = 6.0 pts / 5m!
    assert.equal(dynamicLine.baseSlopePtsPer5m, 6.0)
    assert.equal(dynamicLine.effectiveSlopePtsPer5m, 6.0)
  })

  test('29. should trigger REACTION BROKEN exit ONLY when price closes across confirmed 2-point line, or breaches Borning Zone in Phase 1', () => {
    const origin = { time: 500, price: 52180, candleIndex: 0, type: 'LOW' as const }
    const breakoutCandle: Candle = { time: 1000, open: 52190, high: 52205, low: 52188, close: 52200, volume: 300 }
    const structuralZone = {
      originPrice: 52180,
      zoneSpan: 10,
      zoneLow: 52175,
      zoneHigh: 52185,
      totalZoneVolume: 500,
      barCount: 3,
      avgBarVolume: 166,
    }

    // Part A: In Phase 1, a catastrophic collapse that closes below Borning Zone triggers immediate structural exit
    const phase1Line = calculateDynamicTrendline({
      origin,
      compositeScore: 80,
      higherLows: [{ time: 500, price: 52180, candleIndex: 0, elapsedSecFromOrigin: 0, elapsedMinutesFromOrigin: 0, timingLabel: 'T0' }],
      currentPrice: 52170,
      currentTime: 1300,
      bars: [breakoutCandle],
      direction: 'LONG',
      breakoutCandle,
      flagState: {
        phase: 'INCUBATION',
        direction: 'LONG',
        breakoutTime: 1000,
        breakoutPrice: 52200,
        polePrice: 52205,
        poleTime: 1000,
        flagExtremePrice: 52188,
        flagExtremeTime: 1000,
        flagCandleCount: 0,
        isSecondaryBreakout: false,
        secondaryBreakoutCandle: null,
        secondaryBreakoutPrice: null,
        confirmedPivots: [{ time: 500, price: 52180, candleIndex: 0, elapsedSecFromOrigin: 0, elapsedMinutesFromOrigin: 0, timingLabel: 'T0' }],
      },
      structuralZone,
    })

    const collapseBar: Candle = { time: 1300, open: 52185, high: 52186, low: 52168, close: 52170, volume: 500 }
    const exitCollapse = checkDynamicTrendlineExit(phase1Line, collapseBar, { currentTimeSec: 1600, barDurationSec: 300, structuralZone })
    assert.equal(exitCollapse.shouldExit, true)
    assert.ok(exitCollapse.reason.includes('structural Borning Zone'))

    // Part B: In Phase 2, verified 2-point trendline triggers exit when 5m candle closes below line
    const phase2Line = calculateDynamicTrendline({
      origin,
      compositeScore: 85,
      higherLows: [
        { time: 500, price: 52180, candleIndex: 0, elapsedSecFromOrigin: 0, elapsedMinutesFromOrigin: 0, timingLabel: 'T0' },
        { time: 1600, price: 52202, candleIndex: 3, elapsedSecFromOrigin: 1100, elapsedMinutesFromOrigin: 18, timingLabel: 'HL1' },
      ],
      currentPrice: 52220,
      currentTime: 2200,
      bars: [],
      direction: 'LONG',
    })

    // At t=2500 (2000s from origin at 6.0 pts/5m), projected line is 52180 + (2000/300)*6.0 = 52180 + 40 = 52220
    const safeBar: Candle = { time: 2500, open: 52225, high: 52230, low: 52222, close: 52226, volume: 100 }
    const checkSafe = checkDynamicTrendlineExit(phase2Line, safeBar, { currentTimeSec: 2800, barDurationSec: 300 })
    assert.equal(checkSafe.shouldExit, false)

    const breakBar: Candle = { time: 2500, open: 52225, high: 52225, low: 52210, close: 52212, volume: 400 }
    const checkBreak = checkDynamicTrendlineExit(phase2Line, breakBar, { currentTimeSec: 2800, barDurationSec: 300 })
    assert.equal(checkBreak.shouldExit, true)
    assert.equal(checkBreak.exitPrice, 52212)
    assert.ok(checkBreak.reason.includes('below dynamic trendline'))
  })

  // 30. Deep Dip & Retest Range Accommodation
  test('30. should accommodate deep dips and retest ranges in Phase 1 without triggering premature REACTION BROKEN', () => {
    const origin = { time: 500, price: 4378.0, candleIndex: 0, type: 'LOW' as const }
    const breakoutCandle: Candle = { time: 1000, open: 4383, high: 4387, low: 4382, close: 4386.3, volume: 150 }

    // After breakout at 4386.3, impulse moves to 4390.0, then price dips deeply to 4382.3 (retesting broken trendline/range)
    const bars: Candle[] = [
      { time: 500, open: 4380, high: 4381, low: 4378, close: 4380, volume: 100 },
      breakoutCandle,
      { time: 1300, open: 4386.3, high: 4390.0, low: 4385.0, close: 4389.0, volume: 200 }, // Impulse pole
      { time: 1600, open: 4389.0, high: 4389.5, low: 4382.3, close: 4385.1, volume: 120 }, // Deep Dip retest bar
    ]

    const flagState = detectFlagAndSecondaryBreakout({
      origin,
      breakoutCandle,
      bars,
      direction: 'LONG',
    })

    assert.equal(flagState.phase, 'FLAG_FORMING')
    assert.equal(flagState.polePrice, 4390.0)
    assert.equal(flagState.flagExtremePrice, 4382.3)
    assert.equal(flagState.isDeepDip, true)
    assert.ok(flagState.dipRatio >= 0.40)
    assert.equal(flagState.rangeLow, 4382.0)
    assert.equal(flagState.rangeHigh, 4390.0)

    // Calculate dynamic trendline during this deep dip in Phase 1
    const dynLine = calculateDynamicTrendline({
      origin,
      compositeScore: 75,
      higherLows: flagState.confirmedPivots,
      currentPrice: 4385.1,
      currentTime: 1600,
      bars,
      direction: 'LONG',
      breakoutCandle,
      flagState,
    })

    // In Phase 1 with deep dip, the line acts as a Range Support Floor safely below 4382.3 (e.g. 4380.80)
    assert.ok(dynLine.currentProjectedPrice <= 4381.0)
    assert.equal(dynLine.effectiveSlopePtsPer5m, 0) // Flat floor during range retest

    // Check exit on the deep dip bar that closed at 4385.10 (from user's screenshot)
    const deepDipBar = bars[3]!
    const exitCheck = checkDynamicTrendlineExit(dynLine, deepDipBar, {
      currentTimeSec: 1900,
      barDurationSec: 300,
      structuralZone: {
        zoneLow: 4376.0,
        zoneHigh: 4380.0,
        pocPrice: 4378.0,
        volumeProfilePocScore: 20,
        orderFlowAbsorptionScore: 15,
        multiTimeframeConfluenceScore: 15,
        totalZoneVolume: 10000,
        historicalVolumeRatio: 1.5,
        rejectionWickRatio: 0.6,
        isConfirmedHistoricalSupport: true,
      },
    })

    // Must NOT exit! The deep dip retest is healthy range oscillation above Borning Zone
    assert.equal(exitCheck.shouldExit, false)
    assert.equal(exitCheck.isConfirmed5mCloseBelow, false)
  })

  // 31. Local Pre-Breakout Swing Low Anchor Detection
  test('31. should locate the local pre-breakout swing anchor under breakout candle when accumulation range exists', () => {
    // Distant macro tail at t=1000 (price 4378)
    const macroOrigin = { time: 1000, price: 4378.0, candleIndex: 0 }

    // 20 bars of accumulation range [4381 - 4386]
    const bars: Candle[] = [
      { time: 1000, open: 4380, high: 4381, low: 4378, close: 4380, volume: 500 }, // distant tail
      { time: 1300, open: 4380, high: 4385, low: 4380, close: 4384, volume: 200 },
      { time: 1600, open: 4384, high: 4385, low: 4382, close: 4383, volume: 150 },
      { time: 1900, open: 4383, high: 4384, low: 4381.5, close: 4382, volume: 160 }, // local swing low launching breakout
      { time: 2200, open: 4382, high: 4385, low: 4382, close: 4384.5, volume: 180 },
      { time: 2500, open: 4384.5, high: 4388, low: 4384, close: 4387.0, volume: 300 }, // Breakout candle
    ]

    const breakoutIndex = 5 // bar at time 2500

    // findInitiatingPoint locates the distant macro tail
    const mockTl: UserTrendline = {
      id: 'tl-1',
      type: 'TRENDLINE',
      p1: { time: 1000, price: 4395 },
      p2: { time: 2500, price: 4385 },
      direction: 'BEARISH',
    }
    const macroInit = findInitiatingPoint(mockTl, bars, breakoutIndex, { direction: 'LONG' })
    assert.equal(macroInit?.price, 4378.0)
    assert.equal(macroInit?.time, 1000)

    // findBreakoutSwingAnchor locates the local swing low at t=1900, price=4381.50
    const localAnchor = findBreakoutSwingAnchor({
      bars,
      breakoutIndex,
      direction: 'LONG',
      maxLookbackBars: 10,
      macroOrigin,
    })

    assert.ok(localAnchor)
    assert.equal(localAnchor?.price, 4381.5)
    assert.equal(localAnchor?.time, 1900)
    assert.equal(localAnchor?.type, 'LOW')
  })

  // 32. User-Drawn Reaction Trendline Integration
  test('32. should bind user-drawn Reaction Trendline and evaluate exit criteria against its empirical geometry', () => {
    const origin = { time: 1000, price: 4378.0, candleIndex: 0, type: 'LOW' as const }

    // User draws reaction trendline from (t=1900, p=4382) to (t=2500, p=4391) -> slope = 9 pts / 600s = +4.5 pts / 300s
    const userReactionTl: UserTrendline = {
      id: 'tl-user-reaction-1',
      type: 'TRENDLINE',
      p1: { time: 1900, price: 4382.0 },
      p2: { time: 2500, price: 4391.0 },
      direction: 'BULLISH',
      isReactionTrendline: true,
      parentActionTrendlineId: 'tl-action-1',
    }

    const dynLine = calculateDynamicTrendline({
      origin,
      compositeScore: 80,
      higherLows: [],
      currentPrice: 4395.0,
      currentTime: 3100, // 1200s from p1
      bars: [],
      direction: 'LONG',
      userReactionTrendline: userReactionTl,
    })

    assert.equal(dynLine.isUserReactionTrendline, true)
    assert.equal(dynLine.isEmpiricalPivotSlope, true)
    assert.equal(dynLine.p1.time, 1900)
    assert.equal(dynLine.p1.price, 4382.0)
    assert.equal(dynLine.p2.time, 2500)
    assert.equal(dynLine.p2.price, 4391.0)
    assert.equal(dynLine.effectiveSlopePtsPer5m, 4.5)

    // At t=3100 (1200s from p1), line is 4382 + (1200/300)*4.5 = 4382 + 18 = 4400.0
    // Candle safely above projected price:
    const aboveBar: Candle = { time: 3100, open: 4402, high: 4405, low: 4401, close: 4403, volume: 200 }
    const checkAbove = checkDynamicTrendlineExit(dynLine, aboveBar, { currentTimeSec: 3400, barDurationSec: 300 })
    assert.equal(checkAbove.shouldExit, false)

    // Candle closing below user reaction line:
    const breakBar: Candle = { time: 3100, open: 4400, high: 4401, low: 4396, close: 4397.5, volume: 300 }
    const checkBreak = checkDynamicTrendlineExit(dynLine, breakBar, { currentTimeSec: 3400, barDurationSec: 300 })
    assert.equal(checkBreak.shouldExit, true)
    assert.equal(checkBreak.exitPrice, 4397.5)
    assert.ok(checkBreak.reason.includes('below dynamic trendline'))
  })

  // 33. Reaction Trendline Usability & System-Wide Broken Action Line Enforcement
  test('33. should enforce that a Reaction Trendline is NOT eligible or usable unless an Action Trendline is broken, and reject mismatched orientation', () => {
    const unbrokenActionTl: UserTrendline = {
      id: 'action-tl-unbroken',
      type: 'TRENDLINE',
      p1: { time: 1000, price: 2080 },
      p2: { time: 1900, price: 2060 },
      isActionTrendline: true,
      direction: 'BEARISH',
    }

    const brokenActionTl: UserTrendline = {
      id: 'action-tl-broken',
      type: 'TRENDLINE',
      p1: { time: 1000, price: 2080 },
      p2: { time: 1900, price: 2060 },
      isActionTrendline: true,
      direction: 'BEARISH',
    }

    const validReactionTl: UserTrendline = {
      id: 'reaction-tl-1',
      type: 'TRENDLINE',
      p1: { time: 2000, price: 2050 },
      p2: { time: 2300, price: 2058 }, // ascending for LONG
      isReactionTrendline: true,
      parentActionTrendlineId: 'action-tl-broken',
    }

    // 1. If action line is NOT broken, reaction line is NOT eligible
    assert.equal(
      isReactionTrendlineEligible({
        reactionTl: validReactionTl,
        parentActionTl: unbrokenActionTl,
        isActionBroken: false,
        direction: 'LONG',
      }),
      false
    )

    // 2. If parent action line is missing, reaction line is NOT eligible
    assert.equal(
      isReactionTrendlineEligible({
        reactionTl: validReactionTl,
        parentActionTl: null,
        isActionBroken: true,
        direction: 'LONG',
      }),
      false
    )

    // 3. If parentActionTrendlineId mismatches, reaction line is NOT eligible
    assert.equal(
      isReactionTrendlineEligible({
        reactionTl: { ...validReactionTl, parentActionTrendlineId: 'different-id' },
        parentActionTl: brokenActionTl,
        isActionBroken: true,
        direction: 'LONG',
      }),
      false
    )

    // 4. If direction is LONG but reaction line is descending, it is NOT eligible
    const descendingReactionTl: UserTrendline = {
      id: 'reaction-tl-descending',
      type: 'TRENDLINE',
      p1: { time: 2000, price: 2058 },
      p2: { time: 2300, price: 2050 }, // descending
      isReactionTrendline: true,
      parentActionTrendlineId: 'action-tl-broken',
    }
    assert.equal(
      isReactionTrendlineEligible({
        reactionTl: descendingReactionTl,
        parentActionTl: brokenActionTl,
        isActionBroken: true,
        direction: 'LONG',
      }),
      false
    )

    // 5. Eligible when action line is broken, parent matches, and orientation matches
    assert.equal(
      isReactionTrendlineEligible({
        reactionTl: validReactionTl,
        parentActionTl: brokenActionTl,
        isActionBroken: true,
        direction: 'LONG',
      }),
      true
    )

    // 6. calculateDynamicTrendline ignores descending reaction line for LONG and falls back to dynamic line
    const dynLineInvalid = calculateDynamicTrendline({
      origin: { time: 1000, price: 2045, type: 'LOW' },
      compositeScore: 80,
      higherLows: [],
      currentPrice: 2065,
      currentTime: 2400,
      bars: [],
      direction: 'LONG',
      userReactionTrendline: descendingReactionTl,
    })
    // Descending reaction line for LONG was rejected as invalid user reaction line:
    assert.notEqual(dynLineInvalid.isUserReactionTrendline, true)
  })

  test('34. should evaluate horizontal S/R runway ratio and detect tight runway trap risk', () => {
    const mockChartCtx: any = {
      yesterday: { poc: 2058, high: 2075, low: 2040, vah: 2070, val: 2045 },
      overnight: {
        overnight: { poc: 2055, high: 2085, low: 2038 },
      },
      frvp5d: { poc: 2030, vah: 2060, val: 2025, high: 2090, low: 2020 },
    }

    // Case 1: Long entry with distant overhead resistance (Overnight High 2085, distance 35 pts, SL risk 10 pts)
    const longRunwayClear = evaluateHorizontalRunway({
      entryPrice: 2050,
      stopLossPrice: 2040,
      direction: 'LONG',
      chartContext: {
        overnight: { overnight: { high: 2085 } },
      },
    })
    assert.equal(longRunwayClear.quality, 'EXCELLENT')
    assert.equal(longRunwayClear.runwayPts, 35)
    assert.equal(longRunwayClear.runwayRatio, 3.5)
    assert.equal(longRunwayClear.nearestResistance?.label, 'Overnight High')
    assert.match(longRunwayClear.summary, /Clear runway/)

    // Case 2: Long entry directly under tight Yesterday NYC POC (2058 vs Entry 2050 -> 8 pts runway, 10 pts risk = 0.8:1 R:R)
    const longRunwayTight = evaluateHorizontalRunway({
      entryPrice: 2050,
      stopLossPrice: 2040,
      direction: 'LONG',
      chartContext: mockChartCtx,
    })
    assert.equal(longRunwayTight.quality, 'TIGHT_RUNWAY')
    assert.equal(longRunwayTight.runwayPts, 5) // Overnight POC @ 2055 is 5 pts away
    assert.equal(longRunwayTight.runwayRatio, 0.5)
    assert.match(longRunwayTight.summary, /⚠️ Tight Runway Warning/)

    // Case 3: Short entry with 20 pts runway to 5D POC (2050 -> 2030, 10 pts risk = 2.0:1 R:R)
    const shortRunway = evaluateHorizontalRunway({
      entryPrice: 2050,
      stopLossPrice: 2060,
      direction: 'SHORT',
      chartContext: {
        frvp5d: { poc: 2030 },
      },
    })
    assert.equal(shortRunway.quality, 'ACCEPTABLE')
    assert.equal(shortRunway.runwayPts, 20)
    assert.equal(shortRunway.runwayRatio, 2.0)
    assert.equal(shortRunway.nearestResistance?.label, '5-Day POC')
  })

  test('35. should calculate empirical speedlines and classify velocity states (Equilibrium, Climax, Retest)', () => {
    const origin = { time: 1000, price: 2040 }
    const breakout = { time: 1600, price: 2060 } // elapsed = 600s, delta = +20 pts => 10 pts/5m

    // Current time at t=1900 (300s post breakout, 900s from origin)
    // Projected equilibrium = 2040 + (20/600)*900 = 2070
    // Projected climax (1.5x) = 2040 + (20/600)*1.5*900 = 2085
    // Projected retest floor (0.5x) = 2040 + (20/600)*0.5*900 = 2055

    // Case 1: Price tracking equilibrium slope (2072)
    const eqCorridor = calculateEmpiricalSpeedlines({
      origin,
      breakout,
      currentPrice: 2072,
      currentTime: 1900,
      direction: 'LONG',
    })
    assert.equal(eqCorridor.baseVelocityPtsPer5m, 10)
    assert.equal(eqCorridor.projectedEquilibriumPrice, 2070)
    assert.equal(eqCorridor.projectedClimaxPrice, 2085)
    assert.equal(eqCorridor.projectedRetestFloorPrice, 2055)
    assert.equal(eqCorridor.currentVelocityState, 'EQUILIBRIUM')

    // Case 2: Price goes parabolic climax (> 2085)
    const climaxCorridor = calculateEmpiricalSpeedlines({
      origin,
      breakout,
      currentPrice: 2090,
      currentTime: 1900,
      direction: 'LONG',
    })
    assert.equal(climaxCorridor.currentVelocityState, 'CLIMAX_PARABOLIC')
    assert.match(climaxCorridor.summary, /Parabolic Climax Surge/)

    // Case 3: Price tests between floor (2055) and equilibrium (2070)
    const retestCorridor = calculateEmpiricalSpeedlines({
      origin,
      breakout,
      currentPrice: 2062,
      currentTime: 1900,
      direction: 'LONG',
    })
    assert.equal(retestCorridor.currentVelocityState, 'HEALTHY_RETEST')

    // Case 4: Price stalls and breaches retest floor (< 2055)
    const stalledCorridor = calculateEmpiricalSpeedlines({
      origin,
      breakout,
      currentPrice: 2050,
      currentTime: 1900,
      direction: 'LONG',
    })
    assert.equal(stalledCorridor.currentVelocityState, 'MOMENTUM_STALLED')
    assert.match(stalledCorridor.summary, /Momentum Stalled/)
  })
})



