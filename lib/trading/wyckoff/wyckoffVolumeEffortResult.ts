/**
 * Wyckoff Volume Effort-vs-Result & Weak-Hand Behavioral Modeling Engine
 *
 * Implements:
 * - Relative volume, volume rate, boundary-test volume ratio, and reclaim volume ratio
 * - Effort vs Result classification (Bullish/Bearish Absorption Candidate vs Bullish/Bearish Initiative)
 * - 8 Weak-Hand & Participant Behavioral Categories (distinguishing what is consistent with observations
 *   vs what remains speculative without claiming participant identity).
 */

import { adjustCandlesForContractRollover } from './wyckoffSwingStructure'
import {
  computeSwingCvdChanges,
  enrichCandlesWithCvd,
  evaluateWyckoffCvdDivergence,
  type EnrichedCvdBar,
} from './wyckoffCvdDivergence'
import type {
  CvdVolumeConditionType,
  WeakHandBehaviorAssessment,
  WyckoffCandle,
  WyckoffCvdVolumeIntelligence,
  WyckoffSwingStructure,
  WyckoffTimeframe,
} from './types'

export function modelWeakHandBehaviors(args: {
  bars: EnrichedCvdBar[]
  condition: CvdVolumeConditionType
  rangeBounds?: { low: number; high: number } | null
  sweptBelowSupport: boolean
  sweptAboveResistance: boolean
  reclaimedInside: boolean
}): WeakHandBehaviorAssessment[] {
  const {
    condition,
    sweptBelowSupport,
    sweptAboveResistance,
    reclaimedInside,
  } = args

  const isBullAbs = condition === 'BULLISH_ABSORPTION_CANDIDATE'
  const isBearAbs = condition === 'BEARISH_ABSORPTION_CANDIDATE'
  const isBullInit = condition === 'SUCCESSFUL_BULLISH_INITIATIVE'
  const isBearInit = condition === 'SUCCESSFUL_BEARISH_INITIATIVE'

  return [
    {
      category: 'CAPITULATING_LONGS',
      consistency:
        sweptBelowSupport && (isBullAbs || isBearInit)
          ? 'CONSISTENT_WITH_OBSERVATIONS'
          : sweptBelowSupport
            ? 'SPECULATIVE'
            : 'NOT_SUPPORTED',
      observableEvidence: sweptBelowSupport
        ? 'Sell volume expanded as price broke below prior support lows, consistent with stop-loss triggers or long liquidation.'
        : 'Price has not swept below a defined support shelf where long stops typically cluster.',
      howToDistinguish:
        'Capitulation exhausted into passive demand is followed by diminishing downside progress and a rapid reclaim; genuine initiative selling continues making lower lows.',
    },
    {
      category: 'BREAKOUT_SELLERS',
      consistency:
        sweptBelowSupport
          ? 'CONSISTENT_WITH_OBSERVATIONS'
          : isBearInit
            ? 'SPECULATIVE'
            : 'NOT_SUPPORTED',
      observableEvidence: sweptBelowSupport
        ? 'Aggressive market sell orders hit bids beneath the support boundary.'
        : 'No downside boundary breach observed.',
      howToDistinguish:
        'If price reclaims the support zone and holds a higher low, breakdown sellers are offside; if price accepts below support, breakdown sellers are being rewarded.',
    },
    {
      category: 'LATE_BREAKOUT_BUYERS',
      consistency:
        sweptAboveResistance
          ? 'CONSISTENT_WITH_OBSERVATIONS'
          : isBullInit
            ? 'SPECULATIVE'
            : 'NOT_SUPPORTED',
      observableEvidence: sweptAboveResistance
        ? 'Aggressive buy volume expanded above resistance highs.'
        : 'No upside resistance breach observed.',
      howToDistinguish:
        'If price fails to hold above resistance and closes back inside the range (Upthrust), late breakout buyers are vulnerable; if price holds above resistance on a retest, breakout buyers are in control.',
    },
    {
      category: 'FORCED_SHORT_COVERING',
      consistency:
        sweptAboveResistance && (isBearAbs || isBullInit)
          ? 'SPECULATIVE'
          : 'NOT_SUPPORTED',
      observableEvidence: sweptAboveResistance
        ? 'Buy orders above resistance could include protective buy-stops from shorts alongside momentum entries (exchange tape does not separate opening vs closing orders).'
        : 'Price has not cleared an upper resistance boundary where short stops typically rest.',
      howToDistinguish:
        'Pure short covering often stalls quickly once stops above the high are cleared (returning inside the range), whereas fresh institutional demand holds the breakout level on pullbacks.',
    },
    {
      category: 'FAILED_BREAKOUT_PARTICIPANTS',
      consistency:
        (sweptBelowSupport || sweptAboveResistance) && reclaimedInside
          ? 'CONSISTENT_WITH_OBSERVATIONS'
          : sweptBelowSupport || sweptAboveResistance
            ? 'SPECULATIVE'
            : 'NOT_SUPPORTED',
      observableEvidence:
        (sweptBelowSupport || sweptAboveResistance) && reclaimedInside
          ? 'Price probed outside the range boundary on elevated effort and subsequently returned back inside the range.'
          : 'No completed excursion-and-return outside range boundaries.',
      howToDistinguish:
        'Confirmed only after price closes back inside the range and fails to re-break the extreme on a secondary test.',
    },
    {
      category: 'RESPONSIVE_BUYERS_SELLERS',
      consistency:
        isBullAbs || isBearAbs || condition === 'BALANCED_AUCTION'
          ? 'CONSISTENT_WITH_OBSERVATIONS'
          : 'SPECULATIVE',
      observableEvidence:
        'Two-sided rotational activity near value extremes fading excursions away from the range midpoint.',
      howToDistinguish:
        'Responsive participants fade range extremes back toward the POC; initiative participants drive price through boundaries with expanding ATR and acceptance.',
    },
    {
      category: 'MOMENTUM_PARTICIPANTS',
      consistency:
        isBullInit || isBearInit
          ? 'CONSISTENT_WITH_OBSERVATIONS'
          : 'NOT_SUPPORTED',
      observableEvidence:
        isBullInit || isBearInit
          ? 'Sustained directional displacement accompanied by aligned CVD delta and expanding bar ranges.'
          : 'Price is not exhibiting sustained one-way displacement.',
      howToDistinguish:
        'Momentum participation produces consecutive directional closes and shallow pullbacks that hold outside prior value.',
    },
    {
      category: 'PASSIVE_LIQUIDITY_PROVIDERS',
      consistency:
        isBullAbs || isBearAbs
          ? 'CONSISTENT_WITH_OBSERVATIONS'
          : 'SPECULATIVE',
      observableEvidence:
        isBullAbs || isBearAbs
          ? 'High aggressor volume/delta produced compressed price progress at a structural boundary, consistent with resting limit orders absorbing market orders.'
          : 'No clear divergence between aggressor effort and price displacement.',
      howToDistinguish:
        'Passive absorption remains a hypothesis until confirmed by price reclaiming the boundary and holding on a subsequent test.',
    },
  ]
}

export function computeWyckoffVolumeEffortResult(
  rawCandles: WyckoffCandle[],
  timeframe: WyckoffTimeframe,
  swingStructure: WyckoffSwingStructure,
  atr: number | null,
  options?: {
    rangeBounds?: { low: number; high: number; tolerance: number } | null
    boundaryTestBarIndices?: number[]
    reclaimBarIndices?: number[]
  }
): WyckoffCvdVolumeIntelligence {
  const { candles } = adjustCandlesForContractRollover(rawCandles)
  const resetSessionEverySec = timeframe === '1D' ? 0 : 86400
  const { bars, cvdSource, isEstimated } = enrichCandlesWithCvd(candles, {
    resetSessionEverySec,
  })

  if (bars.length === 0 || cvdSource === 'UNAVAILABLE') {
    return {
      timeframe,
      cvdSource: 'UNAVAILABLE',
      isEstimated: false,
      sessionCvd: null,
      cvdHigh: null,
      cvdLow: null,
      latestBarVolume: null,
      relativeVolume: null,
      volumeRatePerBar: null,
      aggressiveBuyVolume: null,
      aggressiveSellVolume: null,
      boundaryTestVolumeRatio: null,
      reclaimVolumeRatio: null,
      cvdDivergence: 'UNKNOWN',
      condition: 'UNKNOWN',
      effortVsResultSummary: 'UNKNOWN: Volume and aggressor CVD data are unavailable.',
      swingCvdChanges: [],
      weakHandBehaviors: [],
    }
  }

  const latest = bars[bars.length - 1]!
  const lookback = bars.slice(-Math.min(20, bars.length))
  const totalVol = lookback.reduce((s, b) => s + (b.volume || 0), 0)
  const avgVol = lookback.length > 0 ? totalVol / lookback.length : 1

  const relativeVolume =
    avgVol > 0 ? Number((latest.volume / avgVol).toFixed(2)) : 1.0
  const volumeRatePerBar = Number(avgVol.toFixed(1))

  const cvdValues = lookback.map((b) => b.computedCvd)
  const cvdHigh = Number(Math.max(...cvdValues).toFixed(2))
  const cvdLow = Number(Math.min(...cvdValues).toFixed(2))
  const sessionCvd = Number(latest.computedCvd.toFixed(2))

  let boundaryTestVolumeRatio: number | null = null
  const testIndices = options?.boundaryTestBarIndices ?? []
  if (testIndices.length > 0 && avgVol > 0) {
    const vols = testIndices
      .filter((i) => i >= 0 && i < bars.length)
      .map((i) => bars[i]!.volume)
    if (vols.length > 0) {
      const avgTestVol = vols.reduce((s, v) => s + v, 0) / vols.length
      boundaryTestVolumeRatio = Number((avgTestVol / avgVol).toFixed(2))
    }
  }

  let reclaimVolumeRatio: number | null = null
  const reclaimIndices = options?.reclaimBarIndices ?? []
  if (reclaimIndices.length > 0 && avgVol > 0) {
    const vols = reclaimIndices
      .filter((i) => i >= 0 && i < bars.length)
      .map((i) => bars[i]!.volume)
    if (vols.length > 0) {
      const avgReclaimVol = vols.reduce((s, v) => s + v, 0) / vols.length
      reclaimVolumeRatio = Number((avgReclaimVol / avgVol).toFixed(2))
    }
  }

  const cvdEval = evaluateWyckoffCvdDivergence(
    bars,
    timeframe,
    atr,
    options?.rangeBounds
      ? { low: options.rangeBounds.low, high: options.rangeBounds.high }
      : null
  )

  let condition: CvdVolumeConditionType = 'BALANCED_AUCTION'
  if (cvdEval.isSuccessfulBearishInitiative) {
    condition = 'SUCCESSFUL_BEARISH_INITIATIVE'
  } else if (cvdEval.isSuccessfulBullishInitiative) {
    condition = 'SUCCESSFUL_BULLISH_INITIATIVE'
  } else if (cvdEval.isBullishAbsorptionCandidate) {
    condition = 'BULLISH_ABSORPTION_CANDIDATE'
  } else if (cvdEval.isBearishAbsorptionCandidate) {
    condition = 'BEARISH_ABSORPTION_CANDIDATE'
  } else if (relativeVolume < 0.7) {
    condition = 'LOW_PARTICIPATION_DRIFT'
  }

  // Check if recent bars swept below or above range bounds
  let sweptBelowSupport = false
  let sweptAboveResistance = false
  let reclaimedInside = false
  if (options?.rangeBounds) {
    const { low, high, tolerance } = options.rangeBounds
    const recentTail = bars.slice(-Math.min(8, bars.length))
    for (const b of recentTail) {
      if (b.low < low - tolerance * 0.25) sweptBelowSupport = true
      if (b.high > high + tolerance * 0.25) sweptAboveResistance = true
    }
    if (
      (sweptBelowSupport && latest.close >= low) ||
      (sweptAboveResistance && latest.close <= high)
    ) {
      reclaimedInside = true
    }
  }

  const swingCvdChanges = computeSwingCvdChanges(bars, swingStructure)
  const weakHandBehaviors = modelWeakHandBehaviors({
    bars,
    condition,
    rangeBounds: options?.rangeBounds ?? null,
    sweptBelowSupport,
    sweptAboveResistance,
    reclaimedInside,
  })

  const sourceTag = isEstimated ? '[CVD: Estimated from OHLCV]' : '[CVD: Exchange Aggressor]'

  return {
    timeframe,
    cvdSource,
    isEstimated,
    sessionCvd,
    cvdHigh,
    cvdLow,
    latestBarVolume: latest.volume,
    relativeVolume,
    volumeRatePerBar,
    aggressiveBuyVolume: latest.computedBuyVolume,
    aggressiveSellVolume: latest.computedSellVolume,
    boundaryTestVolumeRatio,
    reclaimVolumeRatio,
    cvdDivergence: cvdEval.divergence,
    condition,
    effortVsResultSummary: `${cvdEval.explanation} ${sourceTag}`,
    swingCvdChanges,
    weakHandBehaviors,
  }
}
