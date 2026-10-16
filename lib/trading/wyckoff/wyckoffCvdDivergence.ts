/**
 * Wyckoff Cumulative Volume Delta (CVD) & Divergence Analyzer
 *
 * Tracks:
 * - Exchange-traded aggressor CVD vs estimated OHLCV candle delta (explicitly labeled)
 * - Session-reset-aware CVD accumulation
 * - CVD highs and lows
 * - Swing-to-swing CVD changes and displacement per unit of delta effort
 * - Bullish absorption divergence (CVD lower low + price equal/higher low or diminishing downward progress)
 * - Bearish absorption divergence (CVD higher high + price equal/lower high or diminishing upward progress)
 * - Successful initiative selling/buying (CVD and price moving together with sustained displacement)
 */

import { estimateBarDelta } from '@/lib/trading/orderFlowDelta'
import type {
  SwingCvdChange,
  WyckoffCandle,
  WyckoffSwingStructure,
  WyckoffTimeframe,
} from './types'

export interface EnrichedCvdBar extends WyckoffCandle {
  computedBuyVolume: number
  computedSellVolume: number
  computedDelta: number
  computedCvd: number
  cvdSource: 'EXCHANGE_AGGRESSOR' | 'ESTIMATED_CANDLE' | 'UNAVAILABLE'
}

export function enrichCandlesWithCvd(
  candles: WyckoffCandle[],
  options?: { resetSessionEverySec?: number }
): {
  bars: EnrichedCvdBar[]
  cvdSource: 'EXCHANGE_AGGRESSOR' | 'ESTIMATED_CANDLE' | 'UNAVAILABLE'
  isEstimated: boolean
} {
  if (!candles || candles.length === 0) {
    return { bars: [], cvdSource: 'UNAVAILABLE', isEstimated: false }
  }

  const hasValidVolume = candles.some((b) => (b.volume ?? 0) > 0 || b.cvd != null || b.delta != null)
  if (!hasValidVolume) {
    return {
      bars: candles.map((b) => ({
        ...b,
        computedBuyVolume: 0,
        computedSellVolume: 0,
        computedDelta: 0,
        computedCvd: 0,
        cvdSource: 'UNAVAILABLE',
      })),
      cvdSource: 'UNAVAILABLE',
      isEstimated: false,
    }
  }

  let hasExplicitExchangeCvd = true
  for (const b of candles) {
    const hasExplicit =
      (b.cvd != null || b.delta != null || (b.buyVolume != null && b.sellVolume != null)) &&
      b.isEstimatedCvd !== true
    if (!hasExplicit) {
      hasExplicitExchangeCvd = false
      break
    }
  }

  const cvdSource: 'EXCHANGE_AGGRESSOR' | 'ESTIMATED_CANDLE' = hasExplicitExchangeCvd
    ? 'EXCHANGE_AGGRESSOR'
    : 'ESTIMATED_CANDLE'

  const resetSec = options?.resetSessionEverySec ?? 0
  let runningCvd = 0
  let currentSessionBucket: number | null = null
  const enriched: EnrichedCvdBar[] = []

  for (let i = 0; i < candles.length; i++) {
    const b = candles[i]!
    if (resetSec > 0 && b.cvd == null) {
      const bucket = Math.floor(b.time / resetSec)
      if (currentSessionBucket !== null && bucket !== currentSessionBucket) {
        runningCvd = 0
      }
      currentSessionBucket = bucket
    }

    let buyVolume = 0
    let sellVolume = 0
    let delta = 0

    if (b.buyVolume != null && b.sellVolume != null) {
      buyVolume = b.buyVolume
      sellVolume = b.sellVolume
      delta = b.delta ?? buyVolume - sellVolume
    } else if (b.delta != null) {
      delta = b.delta
      const vol = Math.max(Math.abs(delta), b.volume || 0)
      buyVolume = Math.round((vol + delta) / 2)
      sellVolume = Math.max(0, vol - buyVolume)
    } else if (b.cvd != null) {
      const prevCvd = i > 0 ? enriched[i - 1]!.computedCvd : 0
      delta = i === 0 ? b.cvd : b.cvd - prevCvd
      const vol = Math.max(Math.abs(delta), b.volume || 0)
      buyVolume = Math.round((vol + delta) / 2)
      sellVolume = Math.max(0, vol - buyVolume)
    } else {
      const est = estimateBarDelta(b)
      buyVolume = est.buyVolume
      sellVolume = est.sellVolume
      delta = est.delta
    }

    if (b.cvd != null) {
      runningCvd = b.cvd
    } else {
      runningCvd += delta
    }

    enriched.push({
      ...b,
      computedBuyVolume: buyVolume,
      computedSellVolume: sellVolume,
      computedDelta: delta,
      computedCvd: runningCvd,
      cvdSource,
    })
  }

  return {
    bars: enriched,
    cvdSource,
    isEstimated: cvdSource === 'ESTIMATED_CANDLE',
  }
}

export function computeSwingCvdChanges(
  bars: EnrichedCvdBar[],
  swingStructure: WyckoffSwingStructure
): SwingCvdChange[] {
  const swings = swingStructure.swings
  if (swings.length < 2 || bars.length === 0) return []

  const changes: SwingCvdChange[] = []
  for (let i = 1; i < swings.length; i++) {
    const prev = swings[i - 1]!
    const curr = swings[i]!
    if (curr.index <= prev.index) continue

    const startBar = bars[prev.index]
    const endBar = bars[curr.index]
    if (!startBar || !endBar) continue

    let totalVolume = 0
    for (let k = prev.index + 1; k <= curr.index; k++) {
      totalVolume += bars[k]?.volume ?? 0
    }

    const priceDelta = Number((curr.price - prev.price).toFixed(4))
    const cvdDelta = Number((endBar.computedCvd - startBar.computedCvd).toFixed(2))
    const direction = priceDelta >= 0 ? 'UP_SWING' : 'DOWN_SWING'
    const effort = Math.max(1, Math.abs(cvdDelta))
    const displacementPerUnitEffort = Number((Math.abs(priceDelta) / effort).toFixed(6))

    changes.push({
      fromTime: prev.pivotTime,
      toTime: curr.pivotTime,
      direction,
      priceDelta,
      cvdDelta,
      totalVolume,
      displacementPerUnitEffort,
    })
  }

  return changes
}

export interface CvdDivergenceEvaluation {
  divergence: 'BULLISH_ABSORPTION_DIVERGENCE' | 'BEARISH_ABSORPTION_DIVERGENCE' | 'NONE' | 'UNKNOWN'
  isBullishAbsorptionCandidate: boolean
  isBearishAbsorptionCandidate: boolean
  isSuccessfulBullishInitiative: boolean
  isSuccessfulBearishInitiative: boolean
  explanation: string
}

/**
 * Evaluates CVD vs Price relationship across recent bars and structural swings.
 *
 * Rules enforced:
 * - Simple positive/negative CVD is NEVER classified as absorption.
 * - Bullish absorption candidate requires aggressive selling (CVD lower low or heavy negative delta)
 *   while price makes an equal/higher low OR substantially diminishing downward progress.
 * - If CVD falls AND price keeps making sustained lower lows (Test B), it is classified as
 *   SUCCESSFUL_BEARISH_INITIATIVE, never accumulation/absorption!
 * - Bearish absorption candidate requires aggressive buying (CVD higher high or heavy positive delta)
 *   while price makes an equal/lower high OR fails to sustain upward progress.
 */
export function evaluateWyckoffCvdDivergence(
  bars: EnrichedCvdBar[],
  timeframe: WyckoffTimeframe,
  atr: number | null,
  rangeBounds?: { low: number; high: number } | null
): CvdDivergenceEvaluation {
  if (bars.length < 4 || bars[0]?.cvdSource === 'UNAVAILABLE') {
    return {
      divergence: 'UNKNOWN',
      isBullishAbsorptionCandidate: false,
      isBearishAbsorptionCandidate: false,
      isSuccessfulBullishInitiative: false,
      isSuccessfulBearishInitiative: false,
      explanation: 'UNKNOWN: Insufficient volume/CVD data to evaluate effort vs result.',
    }
  }

  const effectiveAtr =
    atr && atr > 0
      ? atr
      : bars.reduce((s, b) => s + Math.max(0.0001, b.high - b.low), 0) / bars.length

  const windowSize = Math.min(12, bars.length)
  const recent = bars.slice(-windowSize)
  const half = Math.max(2, Math.floor(recent.length / 2))
  const firstHalf = recent.slice(0, half)
  const secondHalf = recent.slice(half)

  const firstMinLow = Math.min(...firstHalf.map((b) => b.low))
  const secondMinLow = Math.min(...secondHalf.map((b) => b.low))
  const firstMaxHigh = Math.max(...firstHalf.map((b) => b.high))
  const secondMaxHigh = Math.max(...secondHalf.map((b) => b.high))

  const firstMinCvd = Math.min(...firstHalf.map((b) => b.computedCvd))
  const secondMinCvd = Math.min(...secondHalf.map((b) => b.computedCvd))
  const firstMaxCvd = Math.max(...firstHalf.map((b) => b.computedCvd))
  const secondMaxCvd = Math.max(...secondHalf.map((b) => b.computedCvd))

  const netCvdChange =
    recent[recent.length - 1]!.computedCvd - recent[0]!.computedCvd
  const netPriceChange =
    recent[recent.length - 1]!.close - recent[0]!.open

  // Also check last 4 bars specifically for diminishing progress vs sustained breakdown/breakout
  const tail = recent.slice(-Math.min(5, recent.length))
  let consecutiveLowerLows = 0
  let consecutiveHigherHighs = 0
  let tailSellDeltaSum = 0
  let tailBuyDeltaSum = 0

  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1]!
    const curr = tail[i]!
    if (curr.low < prev.low - effectiveAtr * 0.12 && curr.close < prev.close) {
      consecutiveLowerLows++
    }
    if (curr.high > prev.high + effectiveAtr * 0.12 && curr.close > prev.close) {
      consecutiveHigherHighs++
    }
  }
  for (const b of tail) {
    if (b.computedDelta < 0) tailSellDeltaSum += Math.abs(b.computedDelta)
    if (b.computedDelta > 0) tailBuyDeltaSum += b.computedDelta
  }

  const latestClose = recent[recent.length - 1]!.close
  const downStep1 = Math.max(0, firstHalf[0]!.open - firstMinLow)
  const downStep2 = Math.max(0, firstMinLow - secondMinLow)
  const upStep1 = Math.max(0, firstMaxHigh - firstHalf[0]!.open)
  const upStep2 = Math.max(0, secondMaxHigh - firstMaxHigh)

  // Check for sustained bearish initiative (Test B):
  // CVD falling AND price keeps making meaningful lower lows without reclaiming
  const isSustainedDownwardDisplacement =
    (consecutiveLowerLows >= 2 && latestClose <= secondMinLow + effectiveAtr * 0.25) ||
    (netPriceChange < -effectiveAtr * 1.4 &&
      secondMinLow < firstMinLow - effectiveAtr * 0.6 &&
      latestClose < firstMinLow)

  if (netCvdChange < 0 && isSustainedDownwardDisplacement) {
    return {
      divergence: 'NONE',
      isBullishAbsorptionCandidate: false,
      isBearishAbsorptionCandidate: false,
      isSuccessfulBullishInitiative: false,
      isSuccessfulBearishInitiative: true,
      explanation: `Successful bearish initiative (${timeframe}): Aggressive selling (CVD Δ ${netCvdChange.toFixed(
        0
      )}) is achieving sustained downward price displacement (${netPriceChange.toFixed(
        2
      )} pts). Sellers are in control — NOT accumulation.`,
    }
  }

  // Check for sustained bullish initiative (Test D):
  const isSustainedUpwardDisplacement =
    (consecutiveHigherHighs >= 2 && latestClose >= secondMaxHigh - effectiveAtr * 0.35) ||
    (netPriceChange > effectiveAtr * 1.4 &&
      secondMaxHigh > firstMaxHigh + effectiveAtr * 0.6 &&
      latestClose > firstMaxHigh)

  if (netCvdChange > 0 && isSustainedUpwardDisplacement) {
    return {
      divergence: 'NONE',
      isBullishAbsorptionCandidate: false,
      isBearishAbsorptionCandidate: false,
      isSuccessfulBullishInitiative: true,
      isSuccessfulBearishInitiative: false,
      explanation: `Successful bullish initiative (${timeframe}): Aggressive buying (CVD Δ +${netCvdChange.toFixed(
        0
      )}) is achieving sustained upward displacement (+${netPriceChange.toFixed(
        2
      )} pts). Buyers are in control — NOT distribution.`,
    }
  }

  // Check for Bullish Absorption Candidate (Test A):
  // CVD makes a lower low (or heavy negative selling delta), while price makes an equal/higher low
  // OR substantially diminishing downward progress followed by price holding/reclaiming.
  const cvdMadeLowerLow = secondMinCvd < firstMinCvd || tailSellDeltaSum > tailBuyDeltaSum * 1.15
  const priceHeldOrDiminishedDownside =
    secondMinLow >= firstMinLow - effectiveAtr * 0.35 ||
    (downStep1 > 0 && downStep2 < downStep1 * 0.45) ||
    (rangeBounds != null && latestClose >= rangeBounds.low)

  if (
    cvdMadeLowerLow &&
    priceHeldOrDiminishedDownside &&
    latestClose > secondMinLow + effectiveAtr * 0.15
  ) {
    return {
      divergence: 'BULLISH_ABSORPTION_DIVERGENCE',
      isBullishAbsorptionCandidate: true,
      isBearishAbsorptionCandidate: false,
      isSuccessfulBullishInitiative: false,
      isSuccessfulBearishInitiative: false,
      explanation: `Possible bullish absorption (${timeframe}): CVD pushed lower (${secondMinCvd.toFixed(
        0
      )} vs ${firstMinCvd.toFixed(
        0
      )}) under aggressive selling, but downside price progress diminished (${secondMinLow.toFixed(
        2
      )} vs ${firstMinLow.toFixed(
        2
      )}) and price held/reclaimed (${latestClose.toFixed(
        2
      )}). Passive bids appear to be absorbing sell pressure (hypothesis requires structural confirmation).`,
    }
  }

  // Check for Bearish Absorption Candidate (Test C):
  // CVD makes a higher high (or heavy positive buying delta), while price makes an equal/lower high
  // OR fails to maintain progress above resistance.
  const cvdMadeHigherHigh = secondMaxCvd > firstMaxCvd || tailBuyDeltaSum > tailSellDeltaSum * 1.15
  const priceFailedUpside =
    secondMaxHigh <= firstMaxHigh + effectiveAtr * 0.35 ||
    (upStep1 > 0 && upStep2 < upStep1 * 0.45) ||
    (rangeBounds != null && secondMaxHigh > rangeBounds.high && latestClose <= rangeBounds.high)

  if (
    cvdMadeHigherHigh &&
    priceFailedUpside &&
    latestClose < secondMaxHigh - effectiveAtr * 0.15
  ) {
    return {
      divergence: 'BEARISH_ABSORPTION_DIVERGENCE',
      isBullishAbsorptionCandidate: false,
      isBearishAbsorptionCandidate: true,
      isSuccessfulBullishInitiative: false,
      isSuccessfulBearishInitiative: false,
      explanation: `Possible bearish absorption (${timeframe}): CVD pushed higher (${secondMaxCvd.toFixed(
        0
      )} vs ${firstMaxCvd.toFixed(
        0
      )}) under aggressive buying, but price failed to sustain higher levels (high ${secondMaxHigh.toFixed(
        2
      )}, close ${latestClose.toFixed(
        2
      )}). Passive offers appear to be absorbing buy orders (hypothesis requires structural rejection confirmation).`,
    }
  }

  return {
    divergence: 'NONE',
    isBullishAbsorptionCandidate: false,
    isBearishAbsorptionCandidate: false,
    isSuccessfulBullishInitiative: false,
    isSuccessfulBearishInitiative: false,
    explanation: `Balanced / neutral order flow (${timeframe}): Neither decisive absorption divergence nor one-sided initiative displacement is confirmed.`,
  }
}
