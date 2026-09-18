/**
 * Systematic Trendline Breakout & "Trend-Borning Zone" Strategy Engine
 *
 * Implements:
 * 1. Bearish trendline breakout detection with confirmed 5-minute candle close.
 * 2. Origin "Trend-Borning Zone" detection (initiating lowest pivot low under the broken line).
 * 3. 7-Factor Institutional Scoring Model (0–100 pts):
 *    - POC Location (Overnight, Yesterday, 5-Day Composite)
 *    - Initiation Volume Quality (RVOL + Cluster Volume)
 *    - Candlestick Power & Excess Rejection Tail
 *    - Psychological Round Numbers (.00, .50)
 *    - 5-Month Anchored VWAP & Volatility Bands
 *    - Resting Liquidity & Delta Absorption
 *    - Time-of-Day Context (Opening Drive, Power Hour, Lunch Chop)
 * 4. Dynamic Responsive Trendline with Higher Low timing intervals (T0, T+15m, T+20m).
 * 5. Stalling Time-Decay Engine: steepens/flattens trendline upward during sideways chop.
 * 6. Systematic 5-minute candle close exit execution.
 */

import { detectCandlestickPatterns, type Candle, type CandlestickPatternResult } from '@/lib/trading/candlestickPatterns'
import type {
  FixedRangeVolumeProfile5D,
  AnchoredVwapBenchmark5M,
  YesterdayNycSession,
  SessionVolumeProfile,
} from '@/lib/chart/context55'
import type { UserTrendline } from '@/lib/trading/userDrawings'
import { nyDeskSessionAt } from '@/lib/chart/sessionVwap'

export interface TrendBorningChartContext {
  yesterday?: YesterdayNycSession | null
  overnight?: {
    overnight?: SessionVolumeProfile | null
    asia?: SessionVolumeProfile | null
    london?: SessionVolumeProfile | null
  } | null
  frvp5d?: FixedRangeVolumeProfile5D | null
  avwap5m?: AnchoredVwapBenchmark5M | null
  [key: string]: any
}

export interface TrendBorningFactorBreakdown {
  pocLocation: {
    score: number
    max: 25
    details: string[]
    isBelowYpoc: boolean
    isBelowOnPoc: boolean
    isBelow5dPoc: boolean
    isAboveYpoc?: boolean
    isAboveOnPoc?: boolean
    isAbove5dPoc?: boolean
    direction?: 'LONG' | 'SHORT'
  }
  volumeQuality: {
    score: number
    max: 20
    rvol: number
    clusterVolume: number
    avgVolume: number
    rating: 'HIGH' | 'ABOVE_AVERAGE' | 'NORMAL' | 'LOW'
    zoneTotalVolume?: number
    historicalTestRatio?: number
    historicalComparisonScore?: number
    historicalComparisonDesc?: string
  }
  candlestickPower: {
    score: number
    max: 20
    patternsDetected: string[]
    hasExcessTail: boolean
    tailRatio: number
  }
  roundNumbers: {
    score: number
    max: 10
    nearestHandle: number
    distancePts: number
    handleType: 'CENTURY' | 'HALF_CENTURY' | 'NONE'
  }
  avwapSupport: {
    score: number
    max: 15
    avwap5m: number | null
    distancePts: number | null
    inBand: boolean
    description: string
  }
  liquidityConfluence: {
    score: number
    max: 5
    hasRestingLiquidity: boolean
    deltaAbsorption: boolean
    description: string
  }
  timeOfDay: {
    score: number
    max: 5
    windowName: string
    isOpeningDrive: boolean
    isPowerHour: boolean
    isLunchChop: boolean
  }
}

export type BorningGrade = 'A' | 'B' | 'C' | 'D'

export interface TrendBorningZoneRange {
  originPrice: number
  zoneSpan: number
  zoneLow: number
  zoneHigh: number
  totalZoneVolume: number
  barCount: number
  avgBarVolume: number
  historicalVolumeRatio?: number | null
  historicalComparisonDesc?: string
}

export interface SwingVolumePivot {
  type: 'SWING_HIGH' | 'SWING_LOW'
  price: number
  time: number
  candleIndex: number
  volume: number
  rvol: number
}

export interface SwingVolumeProgression {
  pivots: SwingVolumePivot[]
  trend: 'DECLINING' | 'EXPANDING' | 'NEUTRAL'
  decayPercentage: number
  scoreDelta: number
  slopeAccelerationPenalty: number
  description: string
}

export interface TrendBorningZoneResult {
  initiatingPoint: {
    time: number
    price: number
    candleIndex: number
    type?: 'LOW' | 'HIGH'
  }
  direction?: 'LONG' | 'SHORT'
  structuralZone: TrendBorningZoneRange
  compositeScore: number
  baseScore?: number
  swingProgression?: SwingVolumeProgression
  grade: BorningGrade
  gradeLabel: string
  factors: TrendBorningFactorBreakdown
  summary: string
}

export interface HigherLowPivot {
  time: number
  price: number
  candleIndex: number
  elapsedSecFromOrigin: number
  elapsedMinutesFromOrigin: number
  timingLabel: string // e.g. "T0", "HL1 (T+15m)", "LH1 (T+15m)"
}

export interface DynamicResponsiveTrendline {
  origin: { time: number; price: number; type?: 'LOW' | 'HIGH' }
  direction?: 'LONG' | 'SHORT'
  compositeScore: number
  baseSlopePtsPer5m: number
  effectiveSlopePtsPer5m: number
  slopePtsPerSec: number
  higherLows: HigherLowPivot[] // Contains Higher Lows for Long, or Lower Highs for Short
  consecutiveStallBars: number
  stallPenaltyScore: number
  volumeDecayPenalty: number
  isStalling: boolean
  currentProjectedPrice: number
  p1: { time: number; price: number }
  p2: { time: number; price: number }
  structuralZone?: TrendBorningZoneRange
  swingVolumeProgression?: SwingVolumeProgression
  isEmpiricalPivotSlope?: boolean
  activePivotCount?: number
}

export interface TrendlineBreakoutCheck {
  direction?: 'LONG' | 'SHORT'
  trendlineDirection?: 'BEARISH' | 'BULLISH'
  isCrossed: boolean
  isConfirmed5mClose: boolean
  breakoutCandle: Candle | null
  breakoutCandleIndex: number | null
  entryPrice: number | null
  defaultStopLoss: number | null
  defaultTakeProfitFixed50: number | null
  defaultTakeProfit1to2: number | null
  riskPts: number | null
  trendlineProjectedAtBreakout: number | null
}

export interface TrendlineExitCheck {
  shouldExit: boolean
  isConfirmed5mCloseBelow: boolean
  isConfirmed5mCloseAbove?: boolean
  direction?: 'LONG' | 'SHORT'
  lastCandle: Candle | null
  projectedTrendlinePrice: number
  exitPrice: number | null
  reason: string
}

export interface SessionTrendlineDetectionResult {
  activeUnbrokenTrendline: UserTrendline | null
  overnightBreakCount: number
  brokenTrendlines: UserTrendline[]
  sessionState: 'OVERNIGHT_MONITORING' | 'NYC_SESSION_ARMED' | 'HALT'
  currentSession: 'Asia' | 'London' | 'NYC' | 'DEAD_ZONE'
  allPivots: { time: number; price: number; type: 'HIGH' | 'LOW'; session: string }[]
  summary: string
}

export interface ChopShieldEvaluation {
  isChopShieldActive: boolean
  minScoreRequired: number
  alternatingBreakCount: number
  stallPenaltyMultiplier: number
  reason: string
}

/**
 * 1. Evaluates whether price has crossed a trendline (bearish or bullish) and confirmed with a 5m candle close.
 * - Bearish trendline (pDiff < 0): triggers LONG entry on confirmed close ABOVE the line.
 * - Bullish trendline (pDiff > 0): triggers SHORT entry on confirmed close BELOW the line.
 */
export function checkTrendlineBreakout(
  trendline: UserTrendline,
  bars: Candle[],
  options?: {
    fixedTpPts?: number
    direction?: 'LONG' | 'SHORT'
    minBreakoutTime?: number
    currentTimeSec?: number
    barDurationSec?: number
  }
): TrendlineBreakoutCheck {
  const result: TrendlineBreakoutCheck = {
    isCrossed: false,
    isConfirmed5mClose: false,
    breakoutCandle: null,
    breakoutCandleIndex: null,
    entryPrice: null,
    defaultStopLoss: null,
    defaultTakeProfitFixed50: null,
    defaultTakeProfit1to2: null,
    riskPts: null,
    trendlineProjectedAtBreakout: null,
  }

  if (!bars || bars.length === 0 || !trendline) return result

  // Chronologically normalize anchor points: P1 must be earlier in time than P2
  let p1 = trendline.p1
  let p2 = trendline.p2
  if (p1.time > p2.time) {
    p1 = trendline.p2
    p2 = trendline.p1
  }

  const tDiffSec = p2.time - p1.time
  const pDiff = p2.price - p1.price

  // Must have a non-zero time difference and price difference
  if (tDiffSec <= 0 || pDiff === 0) return result

  const isBearish = pDiff < 0
  const dir: 'LONG' | 'SHORT' = options?.direction ?? (isBearish ? 'LONG' : 'SHORT')
  result.direction = dir
  result.trendlineDirection = isBearish ? 'BEARISH' : 'BULLISH'

  const slopePtsPerSec = pDiff / tDiffSec
  // Breakouts occur strictly after the right anchor point P2, and on or after minBreakoutTime
  const evalStartSec = Math.max(p2.time, options?.minBreakoutTime ?? 0)
  const barDuration = options?.barDurationSec ?? 300

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    if (b.time < evalStartSec) continue

    const trendlinePriceAtBar = p1.price + slopePtsPerSec * (b.time - p1.time)

    // A candle is only confirmed closed if a subsequent candle exists or its 5m duration has elapsed
    const isCompletedBar =
      i < bars.length - 1 ||
      (options?.currentTimeSec != null
        ? options.currentTimeSec >= b.time + barDuration
        : true)

    if (dir === 'LONG') {
      // Bearish trendline being broken to upside by buyers
      if (b.high > trendlinePriceAtBar) {
        result.isCrossed = true
      }

      // Strict 5-minute bar close confirmation ABOVE the trendline
      if (b.close > trendlinePriceAtBar) {
        if (!isCompletedBar) {
          // Bar is still actively forming (tick crossed, but bar close is not yet confirmed)
          continue
        }

        result.isConfirmed5mClose = true
        result.breakoutCandle = b
        result.breakoutCandleIndex = i
        result.entryPrice = b.close
        result.trendlineProjectedAtBreakout = Number(trendlinePriceAtBar.toFixed(2))

        // Default Stop Loss: Placed below the low of the candle that broke the trendline (1.0 pt safety buffer)
        const sl = Number((b.low - 1.0).toFixed(2))
        result.defaultStopLoss = sl

        const riskPts = Math.max(1.0, b.close - sl)
        result.riskPts = Number(riskPts.toFixed(2))

        const fixedTp = options?.fixedTpPts ?? 50.0
        result.defaultTakeProfitFixed50 = Number((b.close + fixedTp).toFixed(2))
        result.defaultTakeProfit1to2 = Number((b.close + riskPts * 2).toFixed(2))
        break
      }
    } else {
      // Bullish trendline being broken to downside by sellers (SHORT)
      if (b.low < trendlinePriceAtBar) {
        result.isCrossed = true
      }

      // Strict 5-minute bar close confirmation BELOW the trendline
      if (b.close < trendlinePriceAtBar) {
        if (!isCompletedBar) {
          // Bar is still actively forming (tick crossed, but bar close is not yet confirmed)
          continue
        }

        result.isConfirmed5mClose = true
        result.breakoutCandle = b
        result.breakoutCandleIndex = i
        result.entryPrice = b.close
        result.trendlineProjectedAtBreakout = Number(trendlinePriceAtBar.toFixed(2))

        // Default Stop Loss for Short: Placed above the high of the candle that broke the trendline (+1.0 pt)
        const sl = Number((b.high + 1.0).toFixed(2))
        result.defaultStopLoss = sl

        const riskPts = Math.max(1.0, sl - b.close)
        result.riskPts = Number(riskPts.toFixed(2))

        const fixedTp = options?.fixedTpPts ?? 50.0
        result.defaultTakeProfitFixed50 = Number((b.close - fixedTp).toFixed(2))
        result.defaultTakeProfit1to2 = Number((b.close - riskPts * 2).toFixed(2))
        break
      }
    }
  }

  return result
}

/**
 * 2. Find the Initiating Point of the Trend-Borning Zone:
 * - For LONG: Absolute lowest pivot low under the broken bearish line.
 * - For SHORT: Absolute highest pivot high under/around the broken bullish line.
 */
export function findInitiatingPoint(
  trendline: UserTrendline,
  bars: Candle[],
  breakoutIndex: number,
  options?: { direction?: 'LONG' | 'SHORT' }
): { time: number; price: number; candleIndex: number; type: 'LOW' | 'HIGH' } | null {
  if (!bars || bars.length === 0 || breakoutIndex < 0) return null

  const pDiff = trendline.p2.price - trendline.p1.price
  const dir: 'LONG' | 'SHORT' = options?.direction ?? (pDiff < 0 ? 'LONG' : 'SHORT')
  const p1Time = Math.min(trendline.p1.time, trendline.p2.time)

  if (dir === 'LONG') {
    let lowestPrice = Infinity
    let lowestIndex = -1
    let lowestTime = 0

    for (let i = 0; i <= breakoutIndex; i++) {
      const b = bars[i]!
      if (b.time >= p1Time) {
        if (b.low < lowestPrice) {
          lowestPrice = b.low
          lowestIndex = i
          lowestTime = b.time
        }
      }
    }

    if (lowestIndex === -1) {
      // Fallback: examine last 20 bars prior to breakout
      const start = Math.max(0, breakoutIndex - 20)
      for (let i = start; i <= breakoutIndex; i++) {
        const b = bars[i]!
        if (b.low < lowestPrice) {
          lowestPrice = b.low
          lowestIndex = i
          lowestTime = b.time
        }
      }
    }

    if (lowestIndex === -1 || !Number.isFinite(lowestPrice)) return null

    return {
      time: lowestTime,
      price: Number(lowestPrice.toFixed(2)),
      candleIndex: lowestIndex,
      type: 'LOW',
    }
  } else {
    // SHORT: Find highest pivot high under/around the broken line
    let highestPrice = -Infinity
    let highestIndex = -1
    let highestTime = 0

    for (let i = 0; i <= breakoutIndex; i++) {
      const b = bars[i]!
      if (b.time >= p1Time) {
        if (b.high > highestPrice) {
          highestPrice = b.high
          highestIndex = i
          highestTime = b.time
        }
      }
    }

    if (highestIndex === -1) {
      // Fallback: examine last 20 bars prior to breakout
      const start = Math.max(0, breakoutIndex - 20)
      for (let i = start; i <= breakoutIndex; i++) {
        const b = bars[i]!
        if (b.high > highestPrice) {
          highestPrice = b.high
          highestIndex = i
          highestTime = b.time
        }
      }
    }

    if (highestIndex === -1 || !Number.isFinite(highestPrice)) return null

    return {
      time: highestTime,
      price: Number(highestPrice.toFixed(2)),
      candleIndex: highestIndex,
      type: 'HIGH',
    }
  }
}

/**
 * 3. 7-Factor Institutional Scoring Engine for Trend-Borning Zones (Bullish Long or Bearish Short).
 */
export function evaluateTrendBorningZone(params: {
  initiatingPoint: { time: number; price: number; candleIndex: number; type?: 'LOW' | 'HIGH' }
  bars: Candle[]
  chartContext?: TrendBorningChartContext | null
  orderFlowAbsorption?: boolean
  direction?: 'LONG' | 'SHORT'
}): TrendBorningZoneResult {
  const { initiatingPoint, bars, chartContext, orderFlowAbsorption } = params
  const dir: 'LONG' | 'SHORT' = params.direction ?? (initiatingPoint.type === 'HIGH' ? 'SHORT' : 'LONG')
  const idx = initiatingPoint.candleIndex
  const originPrice = initiatingPoint.price
  const originTime = initiatingPoint.time

  // ── FACTOR 1: Multi-Horizon POC Location (Max 25 pts) ──
  // For LONG: origin at or below Yesterday POC (+10), Overnight POC (+8), 5D POC (+7) (Discount Value)
  // For SHORT: origin at or above Yesterday POC (+10), Overnight POC (+8), 5D POC (+7) (Premium Value)
  const pocDetails: string[] = []
  let pocScore = 0
  let isBelowYpoc = false
  let isBelowOnPoc = false
  let isBelow5dPoc = false
  let isAboveYpoc = false
  let isAboveOnPoc = false
  let isAbove5dPoc = false

  const ypoc = chartContext?.yesterday?.poc
  const onPoc = chartContext?.overnight?.overnight?.poc ?? chartContext?.overnight?.asia?.poc
  const poc5d = chartContext?.frvp5d?.poc

  if (dir === 'LONG') {
    if (ypoc && Number.isFinite(ypoc)) {
      if (originPrice <= ypoc) {
        pocScore += 10
        isBelowYpoc = true
        pocDetails.push(`Below Yesterday POC (${ypoc.toFixed(2)}) [+10 pts]`)
      } else {
        pocDetails.push(`Above Yesterday POC (${ypoc.toFixed(2)})`)
      }
    }

    if (onPoc && Number.isFinite(onPoc)) {
      if (originPrice <= onPoc) {
        pocScore += 8
        isBelowOnPoc = true
        pocDetails.push(`Below Overnight POC (${onPoc.toFixed(2)}) [+8 pts]`)
      } else {
        pocDetails.push(`Above Overnight POC (${onPoc.toFixed(2)})`)
      }
    }

    if (poc5d && Number.isFinite(poc5d)) {
      if (originPrice <= poc5d) {
        pocScore += 7
        isBelow5dPoc = true
        pocDetails.push(`Below 5-Day Composite POC (${poc5d.toFixed(2)}) [+7 pts]`)
      } else {
        pocDetails.push(`Above 5-Day Composite POC (${poc5d.toFixed(2)})`)
      }
    }

    if (!ypoc && !onPoc && !poc5d) {
      pocScore = 15
      pocDetails.push('Baseline Discount Zone (+15 pts default)')
    }
  } else {
    // SHORT: Premium location above POCs
    if (ypoc && Number.isFinite(ypoc)) {
      if (originPrice >= ypoc) {
        pocScore += 10
        isAboveYpoc = true
        pocDetails.push(`Above Yesterday POC (${ypoc.toFixed(2)}) [+10 pts]`)
      } else {
        pocDetails.push(`Below Yesterday POC (${ypoc.toFixed(2)})`)
      }
    }

    if (onPoc && Number.isFinite(onPoc)) {
      if (originPrice >= onPoc) {
        pocScore += 8
        isAboveOnPoc = true
        pocDetails.push(`Above Overnight POC (${onPoc.toFixed(2)}) [+8 pts]`)
      } else {
        pocDetails.push(`Below Overnight POC (${onPoc.toFixed(2)})`)
      }
    }

    if (poc5d && Number.isFinite(poc5d)) {
      if (originPrice >= poc5d) {
        pocScore += 7
        isAbove5dPoc = true
        pocDetails.push(`Above 5-Day Composite POC (${poc5d.toFixed(2)}) [+7 pts]`)
      } else {
        pocDetails.push(`Below 5-Day Composite POC (${poc5d.toFixed(2)})`)
      }
    }

    if (!ypoc && !onPoc && !poc5d) {
      pocScore = 15
      pocDetails.push('Baseline Premium Zone (+15 pts default)')
    }
  }

  pocScore = Math.min(25, Math.max(0, pocScore))

  // ── FACTOR 2: Initiation Volume Quality (Max 20 pts) ──
  // Initiation bar + adjacent 2-3 bar cluster RVOL
  let avgVolume = 1
  let clusterVolume = 0
  let rvol = 1.0

  if (bars && bars.length > 0 && idx >= 0 && idx < bars.length) {
    const lookback = Math.min(20, idx)
    let sumVol = 0
    let count = 0
    for (let i = Math.max(0, idx - lookback); i < idx; i++) {
      sumVol += bars[i]!.volume || 1
      count++
    }
    avgVolume = count > 0 ? sumVol / count : 1

    // Cluster: initiating bar + 1 before + 1 after
    const startCluster = Math.max(0, idx - 1)
    const endCluster = Math.min(bars.length - 1, idx + 1)
    let clusterSum = 0
    let clusterCount = 0
    for (let i = startCluster; i <= endCluster; i++) {
      clusterSum += bars[i]!.volume || 1
      clusterCount++
    }
    clusterVolume = clusterCount > 0 ? clusterSum / clusterCount : bars[idx]!.volume || 1
    rvol = Number((clusterVolume / Math.max(1, avgVolume)).toFixed(2))
  }

  // ── Structural Trend-Borning Zone & Historical Level Comparison ──
  const zoneSpan = originPrice > 10000 ? 20.0 : originPrice > 1000 ? 5.0 : 0.5
  const zoneLow = Number((originPrice - zoneSpan).toFixed(2))
  const zoneHigh = Number((originPrice + zoneSpan).toFixed(2))

  let zoneTotalVolume = 0
  let zoneBarCount = 0
  if (bars && bars.length > 0 && idx >= 0) {
    for (let i = Math.max(0, idx - 2); i <= Math.min(bars.length - 1, idx + 2); i++) {
      const b = bars[i]!
      if (b.low <= zoneHigh && b.high >= zoneLow) {
        zoneTotalVolume += b.volume || 1
        zoneBarCount++
      }
    }
  }
  const zoneAvgVolume = zoneBarCount > 0 ? zoneTotalVolume / zoneBarCount : clusterVolume

  // Historical Support/Resistance Level Comparison:
  let priorTouchVolumeSum = 0
  let priorTouchBarCount = 0
  if (bars && idx > 2) {
    for (let i = 0; i < idx - 2; i++) {
      const b = bars[i]!
      if (b.low <= zoneHigh && b.high >= zoneLow) {
        priorTouchVolumeSum += b.volume || 1
        priorTouchBarCount++
      }
    }
  }
  const priorTouchAvg = priorTouchBarCount > 0 ? priorTouchVolumeSum / priorTouchBarCount : 0

  let historicalTestRatio: number | null = null
  let historicalComparisonScore = 0
  const levelType = dir === 'LONG' ? 'support' : 'resistance'
  let historicalComparisonDesc = `No prior touches of ${levelType} zone in lookback`

  if (priorTouchAvg > 0) {
    historicalTestRatio = Number((zoneAvgVolume / priorTouchAvg).toFixed(2))
    if (historicalTestRatio >= 1.25) {
      historicalComparisonScore = 4
      historicalComparisonDesc = `Higher volume than prior ${levelType} tests (+${Math.round((historicalTestRatio - 1) * 100)}% surge: Institutional Absorption)`
    } else if (historicalTestRatio <= 0.75) {
      historicalComparisonScore = -2
      historicalComparisonDesc = `Lower volume than prior ${levelType} tests (-${Math.round((1 - historicalTestRatio) * 100)}% drying: Weak Interest)`
    } else {
      historicalComparisonScore = 1
      historicalComparisonDesc = `Volume aligned with prior ${levelType} tests (${historicalTestRatio}x)`
    }
  }

  const structuralZone: TrendBorningZoneRange = {
    originPrice,
    zoneSpan,
    zoneLow,
    zoneHigh,
    totalZoneVolume: Math.round(zoneTotalVolume),
    barCount: zoneBarCount,
    avgBarVolume: Math.round(zoneAvgVolume),
    historicalVolumeRatio: historicalTestRatio,
    historicalComparisonDesc,
  }

  let volScore = 2
  let volRating: 'HIGH' | 'ABOVE_AVERAGE' | 'NORMAL' | 'LOW' = 'LOW'
  if (rvol >= 2.0) {
    volScore = 20
    volRating = 'HIGH'
  } else if (rvol >= 1.5) {
    volScore = 14
    volRating = 'ABOVE_AVERAGE'
  } else if (rvol >= 1.0) {
    volScore = 8
    volRating = 'NORMAL'
  } else {
    volScore = 4
    volRating = 'LOW'
  }

  volScore = Math.min(20, Math.max(2, volScore + historicalComparisonScore))

  // ── FACTOR 3: Candlestick Pattern Power & Excess Tail (Max 20 pts) ──
  let candleScore = 3
  const detectedPatternNames: string[] = []
  let hasExcess = false
  let tailRatio = 0

  if (bars && bars.length > 0 && idx >= 0 && idx < bars.length) {
    const patResult: CandlestickPatternResult = detectCandlestickPatterns(bars, idx)
    const initBar = bars[idx]!
    const range = Math.max(0.0001, initBar.high - initBar.low)

    if (dir === 'LONG') {
      const bottomWick = Math.min(initBar.open, initBar.close) - initBar.low
      tailRatio = Number((bottomWick / range).toFixed(2))

      if (patResult.buyingExcess || tailRatio >= 0.45) {
        hasExcess = true
        candleScore += 10
        detectedPatternNames.push(`Buying Excess Tail (${Math.round(tailRatio * 100)}% wick)`)
      }

      if (patResult.bullEng) {
        candleScore += 10
        detectedPatternNames.push('Bullish Engulfing')
      } else if (patResult.hammer) {
        candleScore += 10
        detectedPatternNames.push('Hammer')
      } else if (patResult.morningStar) {
        candleScore += 10
        detectedPatternNames.push('Morning Star')
      } else if (patResult.piercing) {
        candleScore += 8
        detectedPatternNames.push('Piercing Line')
      } else if (patResult.bullHarami) {
        candleScore += 6
        detectedPatternNames.push('Bullish Harami')
      } else if (patResult.bullBelt) {
        candleScore += 6
        detectedPatternNames.push('Bullish Belt')
      }
    } else {
      // SHORT: Rejection upper wick or bearish patterns
      const topWick = initBar.high - Math.max(initBar.open, initBar.close)
      tailRatio = Number((topWick / range).toFixed(2))

      if (patResult.sellingExcess || tailRatio >= 0.45) {
        hasExcess = true
        candleScore += 10
        detectedPatternNames.push(`Selling Excess Tail (${Math.round(tailRatio * 100)}% wick)`)
      }

      if (patResult.bearEng) {
        candleScore += 10
        detectedPatternNames.push('Bearish Engulfing')
      } else if (patResult.shootingStar) {
        candleScore += 10
        detectedPatternNames.push('Shooting Star')
      } else if (patResult.eveningStar) {
        candleScore += 10
        detectedPatternNames.push('Evening Star')
      } else if (patResult.bearKick) {
        candleScore += 8
        detectedPatternNames.push('Bearish Kicker')
      } else if (patResult.bearHarami) {
        candleScore += 6
        detectedPatternNames.push('Bearish Harami')
      } else if (patResult.hangingMan) {
        candleScore += 6
        detectedPatternNames.push('Hanging Man')
      }
    }
  }

  candleScore = Math.min(20, Math.max(3, candleScore))

  // ── FACTOR 4: Psychological Round Numbers (Max 10 pts) ──
  const roundCentury = Math.round(originPrice / 100) * 100
  const distToCentury = Math.abs(originPrice - roundCentury)

  const roundHalfCentury = Math.round(originPrice / 50) * 50
  const distToHalfCentury = Math.abs(originPrice - roundHalfCentury)

  let roundScore = 0
  let handleType: 'CENTURY' | 'HALF_CENTURY' | 'NONE' = 'NONE'
  let nearestHandle = originPrice
  let roundDist = 0

  if (distToCentury <= 5.0) {
    roundScore = 10
    handleType = 'CENTURY'
    nearestHandle = roundCentury
    roundDist = Number(distToCentury.toFixed(2))
  } else if (distToHalfCentury <= 5.0) {
    roundScore = 6
    handleType = 'HALF_CENTURY'
    nearestHandle = roundHalfCentury
    roundDist = Number(distToHalfCentury.toFixed(2))
  } else {
    roundScore = 2
    nearestHandle = roundHalfCentury
    roundDist = Number(distToHalfCentury.toFixed(2))
  }

  // ── FACTOR 5: Long-Term Money (5-Month Anchored VWAP Support/Resistance) (Max 15 pts) ──
  const avwapBenchmark = chartContext?.avwap5m
  let avwapScore = 0
  let avwapPrice: number | null = null
  let avwapDist: number | null = null
  let inBand = false
  let avwapDesc = 'No 5M AVWAP anchor available'

  if (avwapBenchmark?.vwap && Number.isFinite(avwapBenchmark.vwap)) {
    const vwapVal = avwapBenchmark.vwap
    avwapPrice = vwapVal
    const distToVwap = Math.abs(originPrice - vwapVal)
    const targetSigma = dir === 'LONG'
      ? (avwapBenchmark.sigma1Lower || vwapVal)
      : (avwapBenchmark.sigma1Upper || vwapVal)
    const targetSigma2 = dir === 'LONG'
      ? (avwapBenchmark.sigma2Lower || vwapVal)
      : (avwapBenchmark.sigma2Upper || vwapVal)
    const distToSigma1 = Math.abs(originPrice - targetSigma)
    const distToSigma2 = Math.abs(originPrice - targetSigma2)
    const minDist = Math.min(distToVwap, distToSigma1, distToSigma2)
    avwapDist = Number(minDist.toFixed(2))

    if (minDist <= 15.0) {
      avwapScore = 15
      inBand = true
      avwapDesc = `Aligned within ±15 pts of 5M AVWAP ${levelType} band (${minDist.toFixed(1)} pts)`
    } else if (minDist <= 30.0) {
      avwapScore = 8
      inBand = true
      avwapDesc = `Proximal within ±30 pts of 5M AVWAP band (${minDist.toFixed(1)} pts)`
    } else {
      avwapScore = 3
      avwapDesc = `Outside 5M AVWAP band (${minDist.toFixed(1)} pts away)`
    }
  } else {
    avwapScore = 8 // neutral baseline
    avwapDesc = 'Neutral baseline (5M AVWAP pending)'
  }

  // ── FACTOR 6: Resting Liquidity & Delta Absorption Confluence (Max 5 pts) ──
  let liqScore = 2
  let hasResting = false
  let deltaAbs = Boolean(orderFlowAbsorption)

  if (orderFlowAbsorption) {
    liqScore = 5
    hasResting = true
    deltaAbs = true
  } else if (hasExcess || volScore >= 14) {
    liqScore = 4
    hasResting = true
  }

  // ── FACTOR 7: Time-of-Day Context (Max 5 pts) ──
  let timeScore = 2
  let windowName = 'Standard Session'
  let isOpeningDrive = false
  let isPowerHour = false
  let isLunchChop = false

  try {
    const d = new Date(originTime * 1000)
    const etHour = Number(d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }))
    const etMin = Number(d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }))
    const totalMin = etHour * 60 + etMin

    // 09:30 - 10:00 ET (570 - 600 min)
    if (totalMin >= 570 && totalMin <= 600) {
      timeScore = 5
      windowName = 'Opening Drive (09:30 - 10:00 ET)'
      isOpeningDrive = true
    }
    // 15:00 - 16:00 ET (900 - 960 min)
    else if (totalMin >= 900 && totalMin <= 960) {
      timeScore = 4
      windowName = 'Power Hour (15:00 - 16:00 ET)'
      isPowerHour = true
    }
    // 10:00 - 11:30 ET (600 - 690 min)
    else if (totalMin > 600 && totalMin <= 690) {
      timeScore = 3
      windowName = 'Morning Trend (10:00 - 11:30 ET)'
    }
    // 11:30 - 13:30 ET (690 - 810 min) -> Lunch Chop Window
    else if (totalMin > 690 && totalMin < 810) {
      timeScore = 0
      windowName = 'Lunch Window (11:30 - 13:30 ET - Chop Risk)'
      isLunchChop = true
    } else {
      timeScore = 2
      windowName = 'Standard RTH / Globex Window'
    }
  } catch {
    timeScore = 3
    windowName = 'Active Session'
  }

  // ── COMPOSITE SCORE CALCULATION ──
  const compositeScore = Math.min(
    100,
    Math.max(0, pocScore + volScore + candleScore + roundScore + avwapScore + liqScore + timeScore)
  )

  let grade: BorningGrade = 'C'
  let gradeLabel = 'Marginal / Speculative Setup'

  if (compositeScore >= 80) {
    grade = 'A'
    gradeLabel = 'Grade A: Exceptional Institutional Thrust'
  } else if (compositeScore >= 60) {
    grade = 'B'
    gradeLabel = 'Grade B: Solid Responsive Move'
  } else if (compositeScore >= 40) {
    grade = 'C'
    gradeLabel = 'Grade C: Moderate Borning Zone'
  } else {
    grade = 'D'
    gradeLabel = 'Grade D: Low Quality / High Chop Risk'
  }

  const factors: TrendBorningFactorBreakdown = {
    pocLocation: {
      score: pocScore,
      max: 25,
      details: pocDetails,
      isBelowYpoc,
      isBelowOnPoc,
      isBelow5dPoc,
      isAboveYpoc,
      isAboveOnPoc,
      isAbove5dPoc,
      direction: dir,
    },
    volumeQuality: {
      score: volScore,
      max: 20,
      rvol,
      clusterVolume: Math.round(clusterVolume),
      avgVolume: Math.round(avgVolume),
      rating: volRating,
      zoneTotalVolume: structuralZone.totalZoneVolume,
      historicalTestRatio: structuralZone.historicalVolumeRatio ?? undefined,
      historicalComparisonScore,
      historicalComparisonDesc,
    },
    candlestickPower: {
      score: candleScore,
      max: 20,
      patternsDetected: detectedPatternNames,
      hasExcessTail: hasExcess,
      tailRatio,
    },
    roundNumbers: {
      score: roundScore,
      max: 10,
      nearestHandle,
      distancePts: roundDist,
      handleType,
    },
    avwapSupport: {
      score: avwapScore,
      max: 15,
      avwap5m: avwapPrice,
      distancePts: avwapDist,
      inBand,
      description: avwapDesc,
    },
    liquidityConfluence: {
      score: liqScore,
      max: 5,
      hasRestingLiquidity: hasResting,
      deltaAbsorption: deltaAbs,
      description: deltaAbs
        ? dir === 'LONG' ? 'Delta Absorption / Trapped Sellers' : 'Delta Absorption / Trapped Buyers'
        : dir === 'LONG' ? 'Resting Bid Confluence' : 'Resting Offer Confluence',
    },
    timeOfDay: {
      score: timeScore,
      max: 5,
      windowName,
      isOpeningDrive,
      isPowerHour,
      isLunchChop,
    },
  }

  const summary = `${dir} Borning Score ${compositeScore}/100 (${grade}) · POCs: ${pocScore}/25 · Vol: ${volScore}/20 · Candle: ${candleScore}/20 · Round: ${roundScore}/10 · 5M-AVWAP: ${avwapScore}/15 · Liq: ${liqScore}/5 · Time: ${timeScore}/5`

  return {
    initiatingPoint,
    direction: dir,
    structuralZone,
    compositeScore,
    grade,
    gradeLabel,
    factors,
    summary,
  }
}

/**
 * 4. Detect swing pivots (Higher Lows for Long, Lower Highs for Short) formed after the initiating point
 * and format their timing intervals (T0, T+15m, T+20m).
 */
export function detectSwingPivotsWithTiming(
  origin: { time: number; price: number; candleIndex: number; type?: 'LOW' | 'HIGH' },
  bars: Candle[],
  currentIndex = bars.length - 1,
  direction: 'LONG' | 'SHORT' = 'LONG'
): HigherLowPivot[] {
  const pivots: HigherLowPivot[] = []
  const isLong = direction === 'LONG'

  // Add origin as T0
  pivots.push({
    time: origin.time,
    price: origin.price,
    candleIndex: origin.candleIndex,
    elapsedSecFromOrigin: 0,
    elapsedMinutesFromOrigin: 0,
    timingLabel: isLong ? 'T0 (Origin)' : 'T0 (Origin High)',
  })

  if (!bars || bars.length === 0 || origin.candleIndex >= currentIndex) {
    return pivots
  }

  let lastPivotPrice = origin.price
  let pivotCounter = 1

  for (let i = origin.candleIndex + 2; i < currentIndex; i++) {
    const prev = bars[i - 1]!
    const curr = bars[i]!
    const next = bars[i + 1]!

    if (isLong) {
      const isSwingLow = curr.low < prev.low && curr.low < next.low
      // Must be a HIGHER low than previous pivot
      if (isSwingLow && curr.low > lastPivotPrice + 0.5) {
        const elapsedSec = curr.time - origin.time
        const elapsedMin = Math.round(elapsedSec / 60)
        pivots.push({
          time: curr.time,
          price: Number(curr.low.toFixed(2)),
          candleIndex: i,
          elapsedSecFromOrigin: elapsedSec,
          elapsedMinutesFromOrigin: elapsedMin,
          timingLabel: `HL${pivotCounter} (T+${elapsedMin}m)`,
        })
        lastPivotPrice = curr.low
        pivotCounter++
      }
    } else {
      const isSwingHigh = curr.high > prev.high && curr.high > next.high
      // Must be a LOWER high than previous pivot
      if (isSwingHigh && curr.high < lastPivotPrice - 0.5) {
        const elapsedSec = curr.time - origin.time
        const elapsedMin = Math.round(elapsedSec / 60)
        pivots.push({
          time: curr.time,
          price: Number(curr.high.toFixed(2)),
          candleIndex: i,
          elapsedSecFromOrigin: elapsedSec,
          elapsedMinutesFromOrigin: elapsedMin,
          timingLabel: `LH${pivotCounter} (T+${elapsedMin}m)`,
        })
        lastPivotPrice = curr.high
        pivotCounter++
      }
    }
  }

  return pivots
}

export function detectHigherLowsWithTiming(
  origin: { time: number; price: number; candleIndex: number; type?: 'LOW' | 'HIGH' },
  bars: Candle[],
  currentIndex = bars.length - 1
): HigherLowPivot[] {
  return detectSwingPivotsWithTiming(origin, bars, currentIndex, origin.type === 'HIGH' ? 'SHORT' : 'LONG')
}

/**
 * 5. Swing Volume Progression Engine:
 * Tracks consecutive swing highs and swing lows and their volume profile.
 * - If volume on swings is diminishing (drying up), participants are exhausted:
 *   a score penalty (-5 to -15 pts) is applied, and the dynamic trendline is steepened
 *   (+0.5 to +1.5 pts/5m) to push for a faster exit before a reversal catches the trader.
 * - If volume on swings is expanding, aggressive participation continues:
 *   a score bonus (+5 to +10 pts) is awarded and the trendline maintains a healthy slope.
 */
export function detectSwingVolumeProgression(
  bars: Candle[],
  startIndex: number = 0
): SwingVolumeProgression {
  const pivots: SwingVolumePivot[] = []
  const start = Math.max(0, startIndex)

  const avgVol = bars.length > 0
    ? bars.reduce((acc, b) => acc + (b.volume || 1), 0) / bars.length
    : 1

  // Detect 3-bar swing pivots
  for (let i = start + 1; i < bars.length - 1; i++) {
    const prev = bars[i - 1]!
    const curr = bars[i]!
    const next = bars[i + 1]!

    if (curr.high > prev.high && curr.high >= next.high) {
      pivots.push({
        type: 'SWING_HIGH',
        price: curr.high,
        time: curr.time,
        candleIndex: i,
        volume: curr.volume || 1,
        rvol: Number(((curr.volume || 1) / Math.max(1, avgVol)).toFixed(2)),
      })
    } else if (curr.low < prev.low && curr.low <= next.low) {
      pivots.push({
        type: 'SWING_LOW',
        price: curr.low,
        time: curr.time,
        candleIndex: i,
        volume: curr.volume || 1,
        rvol: Number(((curr.volume || 1) / Math.max(1, avgVol)).toFixed(2)),
      })
    }
  }

  const swingHighs = pivots.filter((p) => p.type === 'SWING_HIGH')

  if (swingHighs.length >= 2) {
    const lastHigh = swingHighs[swingHighs.length - 1]!
    const prevHigh = swingHighs[swingHighs.length - 2]!

    const diffRatio = (lastHigh.volume - prevHigh.volume) / Math.max(1, prevHigh.volume)

    if (diffRatio <= -0.15) {
      // Volume drying up on swing highs
      const decayPct = Math.round(diffRatio * 100)
      const scoreDelta = Math.max(-15, Math.min(-5, Math.round(diffRatio * 20)))
      const slopeAccelerationPenalty = Number((Math.abs(scoreDelta) * 0.1).toFixed(2))
      return {
        pivots,
        trend: 'DECLINING',
        decayPercentage: decayPct,
        scoreDelta,
        slopeAccelerationPenalty,
        description: `Drying volume on swing highs (${decayPct}% drop: Buyer Exhaustion). Steepening trailing line by +${slopeAccelerationPenalty} pts/5m for faster exit.`,
      }
    } else if (diffRatio >= 0.15) {
      // Volume expanding on swing highs
      const expandPct = Math.round(diffRatio * 100)
      const scoreDelta = Math.min(10, Math.max(5, Math.round(diffRatio * 15)))
      return {
        pivots,
        trend: 'EXPANDING',
        decayPercentage: expandPct,
        scoreDelta,
        slopeAccelerationPenalty: 0,
        description: `Expanding volume on swing highs (+${expandPct}% surge: Institutional Continuation). Maintaining healthy trend angle.`,
      }
    }
  }

  return {
    pivots,
    trend: 'NEUTRAL',
    decayPercentage: 0,
    scoreDelta: 0,
    slopeAccelerationPenalty: 0,
    description: 'Volume progression on swings is balanced/neutral.',
  }
}

/**
 * 6. Construct Dynamic Responsive Trendline with Stalling & Swing-Decay Engines (Long or Short).
 */
export function calculateDynamicTrendline(params: {
  origin: { time: number; price: number; candleIndex?: number; type?: 'LOW' | 'HIGH' }
  compositeScore: number
  higherLows: HigherLowPivot[]
  currentPrice: number
  currentTime: number
  bars: Candle[]
  structuralZone?: TrendBorningZoneRange
  swingVolumeProgression?: SwingVolumeProgression
  direction?: 'LONG' | 'SHORT'
}): DynamicResponsiveTrendline {
  const { origin, compositeScore, higherLows, currentPrice, currentTime, bars, structuralZone } = params
  const dir: 'LONG' | 'SHORT' = params.direction ?? (origin.type === 'HIGH' ? 'SHORT' : 'LONG')

  // 1. Swing volume progression penalty/bonus:
  const originIdx = origin.candleIndex ?? 0
  const swingProgression = params.swingVolumeProgression ?? detectSwingVolumeProgression(bars, originIdx)
  const volumeDecayPenalty = swingProgression.slopeAccelerationPenalty || 0
  const adjustedScore = Math.min(100, Math.max(0, compositeScore + swingProgression.scoreDelta))

  // 2. Determine base slope:
  // - PHASE 2 (Empirical Reality): If confirmed higher lows (for LONG) or lower highs (for SHORT)
  //   exist (higherLows.length >= 2), calculate the empirical slope connecting the real pivots.
  //   We connect the real price pivots together so the trendline hugs real market structure.
  // - PHASE 1 (Theoretical Prior): When no confirmed pivots exist yet (higherLows.length <= 1),
  //   the 7-factor institutional composite score provides the assumed starting trajectory.
  const hasStructuralPivots = higherLows.length >= 2
  let baseSlopePtsPer5m = 0
  let isEmpiricalPivotSlope = false
  const anchorP1 = { time: origin.time, price: origin.price }

  if (hasStructuralPivots) {
    const p0 = higherLows[0]!
    const pLatest = higherLows[higherLows.length - 1]!
    const dtSec = Math.max(300, pLatest.time - p0.time)
    const dpPts = pLatest.price - p0.price
    const rawEmpiricalSlopePer5m = (dpPts / dtSec) * 300

    if (dir === 'LONG' && rawEmpiricalSlopePer5m > 0.2) {
      baseSlopePtsPer5m = Number(rawEmpiricalSlopePer5m.toFixed(2))
      isEmpiricalPivotSlope = true
    } else if (dir === 'SHORT' && rawEmpiricalSlopePer5m < -0.2) {
      baseSlopePtsPer5m = Number(Math.abs(rawEmpiricalSlopePer5m).toFixed(2))
      isEmpiricalPivotSlope = true
    }
  }

  if (!isEmpiricalPivotSlope) {
    // Score 40 -> 2 pts per 5m bar; Score 100 -> 8 pts per 5m bar
    const minSlopePtsPer5m = 2.0
    const maxSlopePtsPer5m = 8.0
    const scoreNorm = Math.min(1.0, Math.max(0.0, (adjustedScore - 30) / 70))
    baseSlopePtsPer5m = Number((minSlopePtsPer5m + scoreNorm * (maxSlopePtsPer5m - minSlopePtsPer5m)).toFixed(2))
  }

  // 3. Stalling / Sideways Range Detection:
  let consecutiveStallBars = 0
  const maxCheck = Math.min(6, bars.length)

  if (maxCheck >= 3) {
    for (let count = maxCheck; count >= 3; count--) {
      const checkBars = bars.slice(bars.length - count)
      const highest = Math.max(...checkBars.map((b) => b.high))
      const lowest = Math.min(...checkBars.map((b) => b.low))
      const rangePts = highest - lowest

      const tightThreshold = currentPrice > 10000 ? 15.0 : currentPrice > 1000 ? 5.0 : 1.5
      if (rangePts <= tightThreshold) {
        consecutiveStallBars = count
        break
      }
    }
  }

  // 4. Calculate time-decay & volume-decay slope penalties:
  const stallPenaltyScore = consecutiveStallBars * 0.5
  let effectiveSlopePtsPer5m = Number((baseSlopePtsPer5m + stallPenaltyScore + volumeDecayPenalty).toFixed(2))
  let slopePtsPerSec = effectiveSlopePtsPer5m / 300

  if (dir === 'SHORT') {
    // For Short, dynamic trendline slopes downwards above price
    effectiveSlopePtsPer5m = -effectiveSlopePtsPer5m
    slopePtsPerSec = effectiveSlopePtsPer5m / 300
  }

  // 5. Projected price at current time anchored from origin
  const elapsedSec = Math.max(0, currentTime - anchorP1.time)
  const currentProjectedPrice = Number((anchorP1.price + slopePtsPerSec * elapsedSec).toFixed(2))

  // Construct visual segment endpoints (anchoring at origin and projecting through swings)
  const p1 = { time: anchorP1.time, price: anchorP1.price }
  const p2 = {
    time: currentTime + 900, // +15 mins ahead
    price: Number((anchorP1.price + slopePtsPerSec * (elapsedSec + 900)).toFixed(2)),
  }

  return {
    origin: { time: origin.time, price: origin.price, type: origin.type },
    direction: dir,
    compositeScore: adjustedScore,
    baseSlopePtsPer5m,
    effectiveSlopePtsPer5m,
    slopePtsPerSec,
    higherLows,
    consecutiveStallBars,
    stallPenaltyScore,
    volumeDecayPenalty,
    isStalling: consecutiveStallBars >= 3,
    currentProjectedPrice,
    p1,
    p2,
    structuralZone,
    swingVolumeProgression: swingProgression,
    isEmpiricalPivotSlope,
    activePivotCount: higherLows.length,
  }
}

/**
 * 7. Checks if the latest completed 5-minute candle closed on the other side of the dynamic trendline (Exit Trigger).
 * - For LONG: Exit when 5m candle closes strictly BELOW ascending line.
 * - For SHORT: Exit when 5m candle closes strictly ABOVE descending line.
 */
export function checkDynamicTrendlineExit(
  dynamicTrendline: DynamicResponsiveTrendline,
  completed5mBar: Candle,
  options?: { currentTimeSec?: number; barDurationSec?: number }
): TrendlineExitCheck {
  if (!dynamicTrendline || !completed5mBar) {
    return {
      shouldExit: false,
      isConfirmed5mCloseBelow: false,
      isConfirmed5mCloseAbove: false,
      lastCandle: null,
      projectedTrendlinePrice: 0,
      exitPrice: null,
      reason: 'No data',
    }
  }

  const dir: 'LONG' | 'SHORT' = dynamicTrendline.direction ?? (dynamicTrendline.slopePtsPerSec >= 0 ? 'LONG' : 'SHORT')
  const p1 = dynamicTrendline.p1
  const slopePtsPerSec = dynamicTrendline.slopePtsPerSec
  const elapsedSec = Math.max(0, completed5mBar.time - p1.time)
  const projectedPrice = Number((p1.price + slopePtsPerSec * elapsedSec).toFixed(2))

  // Guard: Actively forming bar must NOT trigger dynamic trendline exit until 5m bar completes
  const barDuration = options?.barDurationSec ?? 300
  if (options?.currentTimeSec != null && options.currentTimeSec < completed5mBar.time + barDuration) {
    return {
      shouldExit: false,
      isConfirmed5mCloseBelow: false,
      isConfirmed5mCloseAbove: false,
      direction: dir,
      lastCandle: completed5mBar,
      projectedTrendlinePrice: projectedPrice,
      exitPrice: null,
      reason: 'Active 5-minute candle still forming (awaiting confirmed close)',
    }
  }

  if (dir === 'LONG') {
    const isConfirmed5mCloseBelow = completed5mBar.close < projectedPrice
    return {
      shouldExit: isConfirmed5mCloseBelow,
      isConfirmed5mCloseBelow,
      isConfirmed5mCloseAbove: false,
      direction: 'LONG',
      lastCandle: completed5mBar,
      projectedTrendlinePrice: projectedPrice,
      exitPrice: isConfirmed5mCloseBelow ? completed5mBar.close : null,
      reason: isConfirmed5mCloseBelow
        ? `5-minute candle close confirmed below dynamic trendline (Close: ${completed5mBar.close.toFixed(2)} < Line: ${projectedPrice.toFixed(2)})`
        : 'Price maintaining above dynamic trendline',
    }
  } else {
    // SHORT: Exit when 5m candle closes strictly ABOVE the descending dynamic trendline
    const isConfirmed5mCloseAbove = completed5mBar.close > projectedPrice
    return {
      shouldExit: isConfirmed5mCloseAbove,
      isConfirmed5mCloseBelow: false,
      isConfirmed5mCloseAbove,
      direction: 'SHORT',
      lastCandle: completed5mBar,
      projectedTrendlinePrice: projectedPrice,
      exitPrice: isConfirmed5mCloseAbove ? completed5mBar.close : null,
      reason: isConfirmed5mCloseAbove
        ? `5-minute candle close confirmed above dynamic trendline (Close: ${completed5mBar.close.toFixed(2)} > Line: ${projectedPrice.toFixed(2)})`
        : 'Price maintaining below dynamic trendline',
    }
  }
}

/**
 * Resamples any sequence of candles (e.g. 1-minute bars) into strictly aligned 5-minute (300s) candles.
 * If bars are already 5-minute bars (delta >= 300s), returns deduplicated and sorted 5m candles.
 */
export function resampleCandlesTo5M(candles: Candle[]): Candle[] {
  if (!candles || candles.length === 0) return []

  const sorted = [...candles].sort((a, b) => a.time - b.time)
  // Check if candles are already 5m bars (or larger)
  if (sorted.length >= 2 && (sorted[1]!.time - sorted[0]!.time) >= 300) {
    return sorted
  }

  const BUCKET = 300 // 5 minutes in seconds
  const result: Candle[] = []
  let cur: Candle | null = null
  let bucketStart = -1

  for (const c of sorted) {
    const start = Math.floor(c.time / BUCKET) * BUCKET
    if (!cur || start !== bucketStart) {
      if (cur) result.push(cur)
      bucketStart = start
      cur = {
        time: start,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 1,
      }
    } else {
      cur.high = Math.max(cur.high, c.high)
      cur.low = Math.min(cur.low, c.low)
      cur.close = c.close
      cur.volume = (cur.volume || 0) + (c.volume || 1)
    }
  }

  if (cur) result.push(cur)
  return result
}

/**
 * 8. Multi-Session Trendline Pipeline (Asia 18:00 ET -> London 03:00 ET -> NYC 09:30 ET).
 * Reconstructs unbroken trendlines across overnight sessions and presents the active unbroken trend entering NYC open.
 */
export function detectSessionTrendlines(
  bars: Candle[],
  options?: { currentUnix?: number; timeZone?: string }
): SessionTrendlineDetectionResult {
  const result: SessionTrendlineDetectionResult = {
    activeUnbrokenTrendline: null,
    overnightBreakCount: 0,
    brokenTrendlines: [],
    sessionState: 'HALT',
    currentSession: 'DEAD_ZONE',
    allPivots: [],
    summary: 'No session bars available',
  }

  if (!bars || bars.length === 0) return result

  const latestBar = bars[bars.length - 1]!
  const curUnix = options?.currentUnix ?? latestBar.time

  // Classify current session
  const rawSess = nyDeskSessionAt(curUnix)
  const currentSession: 'Asia' | 'London' | 'NYC' | 'DEAD_ZONE' =
    rawSess === 'Asia' ? 'Asia' : rawSess === 'London' ? 'London' : rawSess === 'New York' ? 'NYC' : 'DEAD_ZONE'
  result.currentSession = currentSession

  if (currentSession === 'NYC') {
    result.sessionState = 'NYC_SESSION_ARMED'
  } else if (currentSession === 'Asia' || currentSession === 'London') {
    result.sessionState = 'OVERNIGHT_MONITORING'
  } else {
    result.sessionState = 'HALT'
  }

  // Filter bars within the last 24-30h
  const lookbackSec = 30 * 3600
  const cutoffTime = curUnix - lookbackSec
  const recentBars = bars.filter((b) => b.time >= cutoffTime)

  if (recentBars.length < 5) {
    result.summary = 'Insufficient bars in 24h lookback'
    return result
  }

  // Detect 3-bar swing pivots in recent bars and tag their session
  const pivots: { time: number; price: number; type: 'HIGH' | 'LOW'; session: string; barIndex: number }[] = []

  for (let i = 1; i < recentBars.length - 1; i++) {
    const prev = recentBars[i - 1]!
    const curr = recentBars[i]!
    const next = recentBars[i + 1]!
    const barSess = nyDeskSessionAt(curr.time) ?? 'Overnight'

    if (curr.high > prev.high && curr.high >= next.high) {
      pivots.push({
        time: curr.time,
        price: curr.high,
        type: 'HIGH',
        session: barSess,
        barIndex: i,
      })
    } else if (curr.low < prev.low && curr.low <= next.low) {
      pivots.push({
        time: curr.time,
        price: curr.low,
        type: 'LOW',
        session: barSess,
        barIndex: i,
      })
    }
  }

  result.allPivots = pivots.map((p) => ({ time: p.time, price: p.price, type: p.type, session: p.session }))

  const swingHighs = pivots.filter((p) => p.type === 'HIGH')
  const swingLows = pivots.filter((p) => p.type === 'LOW')

  let activeTl: UserTrendline | null = null
  let overnightBreaks = 0
  const brokenTls: UserTrendline[] = []

  // Helper to test if a candidate line gets broken by subsequent bars during overnight
  const testBreak = (tl: UserTrendline, startIndex: number): { isBroken: boolean; breakBarIndex: number } => {
    const pDiff = tl.p2.price - tl.p1.price
    const tDiff = tl.p2.time - tl.p1.time
    if (tDiff <= 0) return { isBroken: false, breakBarIndex: -1 }
    const slope = pDiff / tDiff

    for (let j = startIndex; j < recentBars.length; j++) {
      const b = recentBars[j]!
      if (b.time <= tl.p2.time) continue
      const proj = tl.p1.price + slope * (b.time - tl.p1.time)

      if (pDiff < 0 && b.close > proj) {
        return { isBroken: true, breakBarIndex: j }
      } else if (pDiff > 0 && b.close < proj) {
        return { isBroken: true, breakBarIndex: j }
      }
    }
    return { isBroken: false, breakBarIndex: -1 }
  }

  // 1. Evaluate descending swing high pairs (bearish trendlines)
  if (swingHighs.length >= 2) {
    for (let h = 0; h < swingHighs.length - 1; h++) {
      const p1 = swingHighs[h]!
      const p2 = swingHighs[h + 1]!
      if (p2.price < p1.price) {
        const sessOrigin = (p1.session === 'Asia' ? 'Asia' : p1.session === 'London' ? 'London' : 'NYC') as 'Asia' | 'London' | 'NYC'
        const candidate: UserTrendline = {
          id: `session-tl-${p1.time}`,
          type: 'TRENDLINE',
          p1: { time: p1.time, price: p1.price },
          p2: { time: p2.time, price: p2.price },
          sessionOrigin: sessOrigin,
          isCarriedFromOvernight: sessOrigin !== 'NYC',
          breakCountOvernight: overnightBreaks,
          direction: 'BEARISH',
          isAutoDetected: true,
          color: '#ef4444',
          label: `${sessOrigin} Bearish Line`,
        }

        const check = testBreak(candidate, p2.barIndex + 1)
        if (check.isBroken) {
          overnightBreaks++
          candidate.breakCountOvernight = overnightBreaks
          brokenTls.push(candidate)
          activeTl = null
        } else {
          activeTl = candidate
        }
      }
    }
  }

  // 2. If no unbroken bearish line, check ascending swing low pairs (bullish trendlines)
  if (!activeTl && swingLows.length >= 2) {
    for (let l = 0; l < swingLows.length - 1; l++) {
      const p1 = swingLows[l]!
      const p2 = swingLows[l + 1]!
      if (p2.price > p1.price) {
        const sessOrigin = (p1.session === 'Asia' ? 'Asia' : p1.session === 'London' ? 'London' : 'NYC') as 'Asia' | 'London' | 'NYC'
        const candidate: UserTrendline = {
          id: `session-tl-${p1.time}`,
          type: 'TRENDLINE',
          p1: { time: p1.time, price: p1.price },
          p2: { time: p2.time, price: p2.price },
          sessionOrigin: sessOrigin,
          isCarriedFromOvernight: sessOrigin !== 'NYC',
          breakCountOvernight: overnightBreaks,
          direction: 'BULLISH',
          isAutoDetected: true,
          color: '#22c55e',
          label: `${sessOrigin} Bullish Line`,
        }

        const check = testBreak(candidate, p2.barIndex + 1)
        if (check.isBroken) {
          overnightBreaks++
          candidate.breakCountOvernight = overnightBreaks
          brokenTls.push(candidate)
          activeTl = null
        } else {
          activeTl = candidate
        }
      }
    }
  }

  result.activeUnbrokenTrendline = activeTl
  result.overnightBreakCount = overnightBreaks
  result.brokenTrendlines = brokenTls

  const sessLabel = currentSession === 'NYC' ? 'NYC Cash Session' : `${currentSession} Session`
  const tlStatus = activeTl
    ? `Active ${activeTl.direction} Line from ${activeTl.sessionOrigin} (Overnight breaks: ${overnightBreaks})`
    : `No unbroken line (Overnight breaks: ${overnightBreaks})`

  result.summary = `[${sessLabel}]: ${tlStatus}`
  return result
}

/**
 * 9. Dalton Balance Day & Chop Protection Filter:
 * Detects rotational chop (alternating Long/Short breakouts within 90m, or compression inside Y-VA).
 * Elevates the score threshold to Grade A (>=75) and doubles stall penalty to protect capital.
 */
export function evaluateChopShield(params: {
  bars?: Candle[]
  breakoutHistory?: Array<{ time: number; direction: 'LONG' | 'SHORT' }>
  yVal?: number
  yVah?: number
  dayType?: string
}): ChopShieldEvaluation {
  const { bars = [], breakoutHistory = [], yVal, yVah, dayType } = params

  let isChopShieldActive = false
  let alternatingBreakCount = 0
  let reason = 'Standard Trend Regime (Normal Score Threshold >= 60)'
  let stallPenaltyMultiplier = 1.0

  // 1. Check for rapid alternating breaks within 90 minutes (5400s)
  if (breakoutHistory.length >= 2) {
    const recentBreaks = breakoutHistory.slice(-4)
    let alternations = 0
    for (let i = 1; i < recentBreaks.length; i++) {
      const prev = recentBreaks[i - 1]!
      const curr = recentBreaks[i]!
      if (curr.direction !== prev.direction && curr.time - prev.time <= 5400) {
        alternations++
      }
    }
    if (alternations >= 1) {
      alternatingBreakCount = alternations
      isChopShieldActive = true
      reason = `Chop Shield Active: ${alternations} alternating Long/Short breakout(s) within 90m (Rotational Balance)`
    }
  }

  // 2. Check if trading inside Yesterday Value Area with Neutral or Non-Trend Day
  if (!isChopShieldActive && bars.length >= 10 && yVal != null && yVah != null && yVal > 0 && yVah > yVal) {
    const recentBars = bars.slice(-12)
    const allInside = recentBars.every((b) => b.close >= yVal && b.close <= yVah)
    const isNeutral = dayType === 'NEUTRAL' || dayType === 'NON_TREND' || dayType === 'NON_CONVICTION'
    if (allInside && isNeutral) {
      isChopShieldActive = true
      reason = `Chop Shield Active: Price rotating inside Yesterday Value Area [${yVal.toFixed(1)}–${yVah.toFixed(1)}] in ${dayType || 'Neutral'} Day`
    }
  }

  if (isChopShieldActive) {
    stallPenaltyMultiplier = 2.0
  }

  return {
    isChopShieldActive,
    minScoreRequired: isChopShieldActive ? 75 : 60,
    alternatingBreakCount,
    stallPenaltyMultiplier,
    reason,
  }
}
