/**
 * Wyckoff ATR & Multi-Timeframe Volatility Regime Analyzer
 *
 * Monitors ATR independently on 1D, 30m, and 5m.
 * Answers the core Wyckoff volatility question:
 * "Is volatility increasing because price is successfully moving away from value,
 *  or because buyers and sellers are fighting without producing sustained progress?"
 */

import { adjustCandlesForContractRollover } from './wyckoffSwingStructure'
import type { WyckoffAtrRegime, WyckoffCandle, WyckoffTimeframe } from './types'

export function computeTrueRanges(candles: WyckoffCandle[]): number[] {
  if (candles.length === 0) return []
  const trs: number[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!
    const highLow = Math.max(0, c.high - c.low)
    if (i === 0) {
      trs.push(highLow)
    } else {
      const prevClose = candles[i - 1]!.close
      const tr = Math.max(
        highLow,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      )
      trs.push(tr)
    }
  }
  return trs
}

export function computeRollingAtrSeries(candles: WyckoffCandle[], period = 14): number[] {
  const trs = computeTrueRanges(candles)
  if (trs.length === 0) return []

  const atrs: number[] = []
  let running = trs[0]!
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i]!
    const w = Math.min(i + 1, period)
    if (i < period) {
      let sum = 0
      for (let j = 0; j <= i; j++) sum += trs[j]!
      running = sum / (i + 1)
    } else {
      running = (running * (w - 1) + tr) / w
    }
    atrs.push(running)
  }
  return atrs
}

export function computeWyckoffAtrRegime(
  rawCandles: WyckoffCandle[],
  timeframe: WyckoffTimeframe,
  options?: {
    period?: number
    rangeWidthPts?: number | null
    boundaryTestBarIndices?: number[]
    sweepBarIndices?: number[]
  }
): WyckoffAtrRegime {
  const period = options?.period ?? 14
  const { candles } = adjustCandlesForContractRollover(rawCandles)

  if (candles.length < 3) {
    return {
      timeframe,
      period,
      currentAtr: null,
      atrTrend: 'UNKNOWN',
      atrPercentile: null,
      atrRatioToMedian: null,
      rangeWidthInAtr: null,
      preTestAtr: null,
      postTestAtr: null,
      springOrUpthrustAtrRatio: null,
      isInitiativeDisplacement: false,
      isFightingWithoutProgress: false,
      volatilityQuestionAnswer:
        'UNKNOWN: Insufficient candle history to evaluate ATR trend or displacement efficiency.',
    }
  }

  const atrs = computeRollingAtrSeries(candles, period)
  const trs = computeTrueRanges(candles)
  const currentAtr = Number(atrs[atrs.length - 1]!.toFixed(4))

  // Compare recent ATR (last 3 bars) to prior ATR (bars -8 to -4)
  const recentWindow = atrs.slice(-Math.min(4, atrs.length))
  const priorEnd = Math.max(0, atrs.length - 4)
  const priorStart = Math.max(0, priorEnd - 6)
  const priorWindow = atrs.slice(priorStart, priorEnd)

  const recentAvgAtr =
    recentWindow.reduce((s, v) => s + v, 0) / Math.max(1, recentWindow.length)
  const priorAvgAtr =
    priorWindow.length > 0
      ? priorWindow.reduce((s, v) => s + v, 0) / priorWindow.length
      : recentAvgAtr

  let atrTrend: WyckoffAtrRegime['atrTrend'] = 'STABLE'
  if (priorAvgAtr > 0) {
    const ratio = recentAvgAtr / priorAvgAtr
    if (ratio >= 1.12) atrTrend = 'EXPANDING'
    else if (ratio <= 0.88) atrTrend = 'CONTRACTING'
  }

  // Historical distribution percentile & ratio to median
  const sortedAtrs = [...atrs].sort((a, b) => a - b)
  const medianAtr = sortedAtrs[Math.floor(sortedAtrs.length / 2)] ?? currentAtr
  const atrRatioToMedian =
    medianAtr > 0 ? Number((currentAtr / medianAtr).toFixed(2)) : 1.0

  let belowOrEqual = 0
  for (const v of sortedAtrs) {
    if (v <= currentAtr) belowOrEqual++
  }
  const atrPercentile = Math.round((belowOrEqual / sortedAtrs.length) * 100)

  const rangeWidthInAtr =
    options?.rangeWidthPts != null && currentAtr > 0
      ? Number((options.rangeWidthPts / currentAtr).toFixed(2))
      : null

  // Volatility before and after support/resistance tests
  let preTestAtr: number | null = null
  let postTestAtr: number | null = null
  const testIndices = options?.boundaryTestBarIndices ?? []
  if (testIndices.length > 0) {
    const lastTestIdx = testIndices[testIndices.length - 1]!
    const preSlice = trs.slice(Math.max(0, lastTestIdx - 4), lastTestIdx)
    const postSlice = trs.slice(lastTestIdx, Math.min(trs.length, lastTestIdx + 4))
    if (preSlice.length > 0) {
      preTestAtr = Number(
        (preSlice.reduce((s, v) => s + v, 0) / preSlice.length).toFixed(4)
      )
    }
    if (postSlice.length > 0) {
      postTestAtr = Number(
        (postSlice.reduce((s, v) => s + v, 0) / postSlice.length).toFixed(4)
      )
    }
  }

  // Volatility during springs and upthrusts
  let springOrUpthrustAtrRatio: number | null = null
  const sweepIndices = options?.sweepBarIndices ?? []
  if (sweepIndices.length > 0 && currentAtr > 0) {
    const sweepTrs = sweepIndices
      .filter((i) => i >= 0 && i < trs.length)
      .map((i) => trs[i]!)
    if (sweepTrs.length > 0) {
      const avgSweepTr = sweepTrs.reduce((s, v) => s + v, 0) / sweepTrs.length
      springOrUpthrustAtrRatio = Number((avgSweepTr / currentAtr).toFixed(2))
    }
  }

  // Evaluate displacement efficiency over the last N bars (default 5)
  const evalCount = Math.min(6, candles.length)
  const recentBars = candles.slice(-evalCount)
  const netPriceDisplacement = Math.abs(
    recentBars[recentBars.length - 1]!.close - recentBars[0]!.open
  )
  const sumBarRanges = recentBars.reduce(
    (s, b) => s + Math.max(0.0001, b.high - b.low),
    0
  )
  // Efficiency ratio: 1.0 = one-way directional drive, ~0.0 = pure two-sided overlapping fight
  const displacementEfficiency =
    sumBarRanges > 0 ? netPriceDisplacement / sumBarRanges : 0

  const isInitiativeDisplacement =
    atrTrend === 'EXPANDING' &&
    displacementEfficiency >= 0.48 &&
    netPriceDisplacement >= currentAtr * 1.15

  const isFightingWithoutProgress =
    (atrTrend === 'EXPANDING' || atrRatioToMedian >= 1.1) &&
    displacementEfficiency < 0.32

  let volatilityQuestionAnswer = ''
  if (isInitiativeDisplacement) {
    volatilityQuestionAnswer =
      `Volatility is EXPANDING (${currentAtr.toFixed(2)} pts, ${atrRatioToMedian}x median) with high directional efficiency (${Math.round(
        displacementEfficiency * 100
      )}%): price is successfully moving away from value via initiative activity.`
  } else if (isFightingWithoutProgress) {
    volatilityQuestionAnswer =
      `Volatility is elevated (${currentAtr.toFixed(2)} pts, ${atrRatioToMedian}x median) but directional efficiency is low (${Math.round(
        displacementEfficiency * 100
      )}%): buyers and sellers are fighting aggressively without producing sustained directional progress (supports an absorption/churn hypothesis, pending structural confirmation).`
  } else if (atrTrend === 'CONTRACTING') {
    volatilityQuestionAnswer =
      `ATR is CONTRACTING (${currentAtr.toFixed(2)} pts, ${atrRatioToMedian}x median): volatility compression indicates rotational consolidation/balance, which does NOT prove accumulation or distribution on its own.`
  } else {
    volatilityQuestionAnswer =
      `ATR is STABLE (${currentAtr.toFixed(2)} pts, ${atrPercentile}th percentile): normal two-way auction facilitation without abnormal volatility expansion.`
  }

  return {
    timeframe,
    period,
    currentAtr,
    atrTrend,
    atrPercentile,
    atrRatioToMedian,
    rangeWidthInAtr,
    preTestAtr,
    postTestAtr,
    springOrUpthrustAtrRatio,
    isInitiativeDisplacement,
    isFightingWithoutProgress,
    volatilityQuestionAnswer,
  }
}
