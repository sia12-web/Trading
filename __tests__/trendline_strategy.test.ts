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
})

