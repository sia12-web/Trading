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
  }
  volumeQuality: {
    score: number
    max: 20
    rvol: number
    clusterVolume: number
    avgVolume: number
    rating: 'HIGH' | 'ABOVE_AVERAGE' | 'NORMAL' | 'LOW'
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

export interface TrendBorningZoneResult {
  initiatingPoint: {
    time: number
    price: number
    candleIndex: number
  }
  compositeScore: number
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
  timingLabel: string // e.g. "T0", "T+15m", "T+20m"
}

export interface DynamicResponsiveTrendline {
  origin: { time: number; price: number }
  compositeScore: number
  baseSlopePtsPer5m: number
  effectiveSlopePtsPer5m: number
  slopePtsPerSec: number
  higherLows: HigherLowPivot[]
  consecutiveStallBars: number
  stallPenaltyScore: number
  isStalling: boolean
  currentProjectedPrice: number
  p1: { time: number; price: number }
  p2: { time: number; price: number }
}

export interface TrendlineBreakoutCheck {
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
  lastCandle: Candle | null
  projectedTrendlinePrice: number
  exitPrice: number | null
  reason: string
}

/**
 * 1. Evaluates whether price has crossed a bearish trendline and confirmed with a 5m candle close.
 */
export function checkTrendlineBreakout(
  trendline: UserTrendline,
  bars: Candle[],
  options?: { fixedTpPts?: number }
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

  const p1 = trendline.p1
  const p2 = trendline.p2
  const tDiffSec = p2.time - p1.time
  const pDiff = p2.price - p1.price

  // Must be descending bearish trendline
  if (tDiffSec <= 0 || pDiff >= 0) return result

  const slopePtsPerSec = pDiff / tDiffSec

  // Find the first 5-minute candle that closes strictly ABOVE the trendline after p2 or during the segment
  const evalStartSec = Math.min(p1.time, p2.time)

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    if (b.time < evalStartSec) continue

    const trendlinePriceAtBar = p1.price + slopePtsPerSec * (b.time - p1.time)

    // Intrabar high crossed the trendline
    if (b.high > trendlinePriceAtBar) {
      result.isCrossed = true
    }

    // Strict 5-minute bar close confirmation above the trendline
    if (b.close > trendlinePriceAtBar) {
      result.isConfirmed5mClose = true
      result.breakoutCandle = b
      result.breakoutCandleIndex = i
      result.entryPrice = b.close
      result.trendlineProjectedAtBreakout = Number(trendlinePriceAtBar.toFixed(2))

      // Default Stop Loss: Placed below the low of the candle that crossed/broke the trendline
      // With 1.0 pt safety buffer
      const sl = Number((b.low - 1.0).toFixed(2))
      result.defaultStopLoss = sl

      const riskPts = Math.max(1.0, b.close - sl)
      result.riskPts = Number(riskPts.toFixed(2))

      const fixedTp = options?.fixedTpPts ?? 50.0
      result.defaultTakeProfitFixed50 = Number((b.close + fixedTp).toFixed(2))
      result.defaultTakeProfit1to2 = Number((b.close + riskPts * 2).toFixed(2))

      // Stop searching at first confirmed breakout bar
      break
    }
  }

  return result
}

/**
 * 2. Find the absolute lowest pivot low under the broken bearish trendline ("Initiating Point").
 */
export function findInitiatingPoint(
  trendline: UserTrendline,
  bars: Candle[],
  breakoutIndex: number
): { time: number; price: number; candleIndex: number } | null {
  if (!bars || bars.length === 0 || breakoutIndex <= 0) return null

  const p1Time = Math.min(trendline.p1.time, trendline.p2.time)
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
  }
}

/**
 * 3. 7-Factor Institutional Scoring Engine for the "Bullish Trend-Borning Zone".
 */
export function evaluateTrendBorningZone(params: {
  initiatingPoint: { time: number; price: number; candleIndex: number }
  bars: Candle[]
  chartContext?: TrendBorningChartContext | null
  orderFlowAbsorption?: boolean
}): TrendBorningZoneResult {
  const { initiatingPoint, bars, chartContext, orderFlowAbsorption } = params
  const idx = initiatingPoint.candleIndex
  const originPrice = initiatingPoint.price
  const originTime = initiatingPoint.time

  // ── FACTOR 1: Multi-Horizon POC Location (Max 25 pts) ──
  // Checks if origin is below Yesterday POC (+10), Overnight POC (+8), and 5D POC (+7)
  const pocDetails: string[] = []
  let pocScore = 0
  let isBelowYpoc = false
  let isBelowOnPoc = false
  let isBelow5dPoc = false

  const ypoc = chartContext?.yesterday?.poc
  const onPoc = chartContext?.overnight?.overnight?.poc ?? chartContext?.overnight?.asia?.poc
  const poc5d = chartContext?.frvp5d?.poc

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

  // If no chartContext POC available, give baseline 15 pts if origin is at or below middle
  if (!ypoc && !onPoc && !poc5d) {
    pocScore = 15
    pocDetails.push('Baseline Discount Zone (+15 pts default)')
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

  // ── FACTOR 3: Candlestick Pattern Power & Excess Tail (Max 20 pts) ──
  let candleScore = 3
  const detectedPatternNames: string[] = []
  let hasExcess = false
  let tailRatio = 0

  if (bars && bars.length > 0 && idx >= 0 && idx < bars.length) {
    const patResult: CandlestickPatternResult = detectCandlestickPatterns(bars, idx)
    const initBar = bars[idx]!
    const range = Math.max(0.0001, initBar.high - initBar.low)
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
  }

  candleScore = Math.min(20, Math.max(3, candleScore))

  // ── FACTOR 4: Psychological Round Numbers (Max 10 pts) ──
  // Century (.00) or Half-Century (.50) within +/- 5.0 pts
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

  // ── FACTOR 5: Long-Term Money (5-Month Anchored VWAP Support) (Max 15 pts) ──
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
    const distToSigma1 = Math.abs(originPrice - (avwapBenchmark.sigma1Lower || vwapVal))
    const distToSigma2 = Math.abs(originPrice - (avwapBenchmark.sigma2Lower || vwapVal))
    const minDist = Math.min(distToVwap, distToSigma1, distToSigma2)
    avwapDist = Number(minDist.toFixed(2))

    if (minDist <= 15.0) {
      avwapScore = 15
      inBand = true
      avwapDesc = `Aligned within ±15 pts of 5M AVWAP defense band (${minDist.toFixed(1)} pts)`
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
    },
    volumeQuality: {
      score: volScore,
      max: 20,
      rvol,
      clusterVolume: Math.round(clusterVolume),
      avgVolume: Math.round(avgVolume),
      rating: volRating,
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
      description: deltaAbs ? 'Delta Absorption / Trapped Sellers' : 'Resting Bid Confluence',
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

  const summary = `Borning Score ${compositeScore}/100 (${grade}) · POCs: ${pocScore}/25 · Vol: ${volScore}/20 · Candle: ${candleScore}/20 · Round: ${roundScore}/10 · 5M-AVWAP: ${avwapScore}/15 · Liq: ${liqScore}/5 · Time: ${timeScore}/5`

  return {
    initiatingPoint,
    compositeScore,
    grade,
    gradeLabel,
    factors,
    summary,
  }
}

/**
 * 4. Detect Higher Lows formed after the initiating point and format their timing intervals (T0, T+15m, T+20m).
 */
export function detectHigherLowsWithTiming(
  origin: { time: number; price: number; candleIndex: number },
  bars: Candle[],
  currentIndex = bars.length - 1
): HigherLowPivot[] {
  const higherLows: HigherLowPivot[] = []

  // Add origin as T0
  higherLows.push({
    time: origin.time,
    price: origin.price,
    candleIndex: origin.candleIndex,
    elapsedSecFromOrigin: 0,
    elapsedMinutesFromOrigin: 0,
    timingLabel: 'T0 (Origin)',
  })

  if (!bars || bars.length === 0 || origin.candleIndex >= currentIndex) {
    return higherLows
  }

  // Scan bars between origin and current for swing pivot lows (3-bar fractal low: low < prev.low && low < next.low)
  let lastPivotPrice = origin.price
  let pivotCounter = 1

  for (let i = origin.candleIndex + 2; i < currentIndex; i++) {
    const prev = bars[i - 1]!
    const curr = bars[i]!
    const next = bars[i + 1]!

    const isSwingLow = curr.low < prev.low && curr.low < next.low
    // Must be a HIGHER low than previous pivot
    if (isSwingLow && curr.low > lastPivotPrice + 0.5) {
      const elapsedSec = curr.time - origin.time
      const elapsedMin = Math.round(elapsedSec / 60)
      higherLows.push({
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
  }

  return higherLows
}

/**
 * 5. Construct Dynamic Responsive Trendline with Stalling Time-Decay Engine.
 */
export function calculateDynamicTrendline(params: {
  origin: { time: number; price: number; candleIndex: number }
  compositeScore: number
  higherLows: HigherLowPivot[]
  currentPrice: number
  currentTime: number
  bars: Candle[]
}): DynamicResponsiveTrendline {
  const { origin, compositeScore, higherLows, currentPrice, currentTime, bars } = params

  // 1. Baseline slope based on composite score:
  // Score 40 -> 2 pts per 5m bar; Score 100 -> 8 pts per 5m bar
  const minSlopePtsPer5m = 2.0
  const maxSlopePtsPer5m = 8.0
  const scoreNorm = Math.min(1.0, Math.max(0.0, (compositeScore - 30) / 70))
  const baseSlopePtsPer5m = Number((minSlopePtsPer5m + scoreNorm * (maxSlopePtsPer5m - minSlopePtsPer5m)).toFixed(2))

  // 2. Identify the active anchor point:
  // Use the latest confirmed Higher Low if present; otherwise origin
  const activeAnchor = higherLows.length > 1 ? higherLows[higherLows.length - 1]! : higherLows[0]!

  // 3. Stalling / Sideways Range Detection:
  // Check if price has failed to make progress over the last 3-6 bars (15-30 minutes)
  let consecutiveStallBars = 0
  const maxCheck = Math.min(6, bars.length)

  if (maxCheck >= 3) {
    for (let count = maxCheck; count >= 3; count--) {
      const checkBars = bars.slice(bars.length - count)
      const highest = Math.max(...checkBars.map((b) => b.high))
      const lowest = Math.min(...checkBars.map((b) => b.low))
      const rangePts = highest - lowest

      // If range is compressed (< 15 pts on Dow/NQ or < 5 pts on Gold)
      const tightThreshold = currentPrice > 10000 ? 15.0 : currentPrice > 1000 ? 5.0 : 1.5
      if (rangePts <= tightThreshold) {
        consecutiveStallBars = count
        break
      }
    }
  }

  // 4. Calculate time-decay slope penalty:
  // When market stalls, steepen/tighten slope upward toward price by 0.5 pts per stall bar
  const stallPenaltyScore = consecutiveStallBars * 0.5
  const effectiveSlopePtsPer5m = Number((baseSlopePtsPer5m + stallPenaltyScore).toFixed(2))
  const slopePtsPerSec = effectiveSlopePtsPer5m / 300

  // 5. Projected price at current time
  const elapsedSec = Math.max(0, currentTime - activeAnchor.time)
  const currentProjectedPrice = Number((activeAnchor.price + slopePtsPerSec * elapsedSec).toFixed(2))

  // Construct visual segment endpoints (p1 at active anchor, p2 projected into future +15m)
  const p1 = { time: activeAnchor.time, price: activeAnchor.price }
  const p2 = {
    time: currentTime + 900, // +15 mins ahead
    price: Number((activeAnchor.price + slopePtsPerSec * (elapsedSec + 900)).toFixed(2)),
  }

  return {
    origin: { time: origin.time, price: origin.price },
    compositeScore,
    baseSlopePtsPer5m,
    effectiveSlopePtsPer5m,
    slopePtsPerSec,
    higherLows,
    consecutiveStallBars,
    stallPenaltyScore,
    isStalling: consecutiveStallBars >= 3,
    currentProjectedPrice,
    p1,
    p2,
  }
}

/**
 * 6. Checks if the latest completed 5-minute candle closed on the other side of the dynamic trendline (Exit Trigger).
 */
export function checkDynamicTrendlineExit(
  dynamicTrendline: DynamicResponsiveTrendline,
  completed5mBar: Candle
): TrendlineExitCheck {
  if (!dynamicTrendline || !completed5mBar) {
    return {
      shouldExit: false,
      isConfirmed5mCloseBelow: false,
      lastCandle: null,
      projectedTrendlinePrice: 0,
      exitPrice: null,
      reason: 'No data',
    }
  }

  const p1 = dynamicTrendline.p1
  const slopePtsPerSec = dynamicTrendline.slopePtsPerSec
  const elapsedSec = Math.max(0, completed5mBar.time - p1.time)
  const projectedPrice = Number((p1.price + slopePtsPerSec * elapsedSec).toFixed(2))

  // Must be a confirmed 5m bar close STRICTLY BELOW the dynamic responsive trendline
  const isConfirmed5mCloseBelow = completed5mBar.close < projectedPrice

  return {
    shouldExit: isConfirmed5mCloseBelow,
    isConfirmed5mCloseBelow,
    lastCandle: completed5mBar,
    projectedTrendlinePrice: projectedPrice,
    exitPrice: isConfirmed5mCloseBelow ? completed5mBar.close : null,
    reason: isConfirmed5mCloseBelow
      ? `5-minute candle close confirmed below dynamic trendline (Close: ${completed5mBar.close.toFixed(2)} < Line: ${projectedPrice.toFixed(2)})`
      : 'Price maintaining above dynamic trendline',
  }
}
