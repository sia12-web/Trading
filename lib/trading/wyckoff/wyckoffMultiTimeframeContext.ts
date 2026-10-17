/**
 * Wyckoff Multi-Timeframe Context, Mindset Audit & Adversarial Questioning Engine
 *
 * Implements:
 * - Single-timeframe synthesis (`analyzeWyckoffSingleTimeframe`) producing the full
 *   Section 11 contract for 1D, 30m, or 5m.
 * - The 10 Wyckoffian Mindset Questions (Section 1)
 * - Inventory-Seeking Participant Thought Experiment (Section 2)
 * - The 8 Adversarial Questions for Long/Short Hypotheses + Self-Challenge (Section 7)
 * - Multi-Timeframe Hierarchy Synthesis (`1D -> 30m -> 5m`, Section 8), including
 *   explicit countertrend detection (Test F).
 */

import {
  adjustCandlesForContractRollover,
  computeWyckoffSwingStructure,
  resampleWyckoffCandles,
  resolveWyckoffMarketSpec,
} from './wyckoffSwingStructure'
import { computeWyckoffAtrRegime } from './wyckoffAtrRegime'
import { computeWyckoffVolumeEffortResult } from './wyckoffVolumeEffortResult'
import { detectWyckoffTradingRange } from './wyckoffRangeDetector'
import { evaluateWyckoffEventStateMachine } from './wyckoffEventStateMachine'
import type { CrossMarketVolatilityState } from '../crossMarketVolatility'
import type { CrossMarketRadarReport, RadarMarket } from '../crossMarketRadar'
import type {
  AdversarialQuestionCheck,
  WyckoffAtrRegime,
  WyckoffCandle,
  WyckoffCrossMarketSignal,
  WyckoffCvdVolumeIntelligence,
  WyckoffDetectedRange,
  WyckoffEventState,
  WyckoffHypothesisEvaluation,
  WyckoffInstrument,
  WyckoffMindsetAudit,
  WyckoffMonitoringStatus,
  WyckoffMultiTimeframeReport,
  WyckoffRangeClassification,
  WyckoffSwingStructure,
  WyckoffTimeframe,
  WyckoffTimeframeAnalysis,
  WyckoffVolGaugeSignal,
  WyckoffVolatilityAndRadarSynthesis,
} from './types'

export interface ExternalReferenceObstacles {
  yesterdayHigh?: number | null
  yesterdayLow?: number | null
  overnightHigh?: number | null
  overnightLow?: number | null
  fiveDaySupportLow?: number | null
  fiveDaySupportHigh?: number | null
  fiveDayResistanceLow?: number | null
  fiveDayResistanceHigh?: number | null
}

function buildWyckoffMindsetAudit(args: {
  currentPrice: number | null
  range: WyckoffDetectedRange | null
  swingStructure: WyckoffSwingStructure
  atrRegime: WyckoffAtrRegime
  cvdVolume: WyckoffCvdVolumeIntelligence
  eventState: WyckoffEventState
}): WyckoffMindsetAudit {
  const { currentPrice, range, swingStructure, atrRegime, cvdVolume, eventState } = args

  if (currentPrice == null) {
    return {
      whereConductingBusiness: 'UNKNOWN: No live price bars available.',
      inRangeOrTransitioning: 'UNKNOWN: Insufficient price data.',
      aggressiveSide: 'UNKNOWN: No volume or delta data.',
      isAggressiveMovingPrice: 'UNKNOWN',
      supplyAbsorptionVsSellingProgress: 'UNKNOWN',
      demandAbsorptionVsBuyingProgress: 'UNKNOWN',
      freshOppositeOrderOrigin: 'UNKNOWN',
      areBreakoutParticipantsTrapped: 'UNKNOWN',
      outsideRangeAcceptanceOrRejection: 'UNKNOWN',
      invalidationEvidence: 'Requires valid OHLCV data feed.',
    }
  }

  const whereConductingBusiness = range
    ? `Price (${currentPrice.toFixed(2)}) is conducting business at ${range.pricePosition} relative to the [${range.rangeLow.toFixed(2)} – ${range.rangeHigh.toFixed(2)}] range (Midpoint ${range.rangeMidpoint.toFixed(2)}${range.poc != null ? `, POC ${range.poc.toFixed(2)}` : ''}).`
    : `No bounded horizontal range active; price (${currentPrice.toFixed(2)}) is auctioning in a ${swingStructure.structuralTrend} swing structure.`

  const inRangeOrTransitioning = range
    ? range.classification === 'BREAKOUT' || range.classification === 'BREAKDOWN'
      ? `Transitioning outside the [${range.rangeLow.toFixed(2)} – ${range.rangeHigh.toFixed(2)}] range (${range.classification}).`
      : `Inside a ${range.durationBars}-bar trading range (${range.classification}, overlap ${(range.overlapRatio * 100).toFixed(0)}%).`
    : `Transitioning in ${swingStructure.structuralTrend} mode.`

  const aggressiveSide =
    cvdVolume.cvdSource === 'UNAVAILABLE'
      ? 'UNKNOWN: Volume/CVD unavailable.'
      : cvdVolume.aggressiveBuyVolume != null &&
          cvdVolume.aggressiveSellVolume != null
        ? cvdVolume.aggressiveBuyVolume > cvdVolume.aggressiveSellVolume * 1.12
          ? `Buyers appear more aggressive over the recent window (Buy Vol ${cvdVolume.aggressiveBuyVolume} vs Sell Vol ${cvdVolume.aggressiveSellVolume}${cvdVolume.isEstimated ? ', estimated from OHLCV' : ''}).`
          : cvdVolume.aggressiveSellVolume > cvdVolume.aggressiveBuyVolume * 1.12
            ? `Sellers appear more aggressive over the recent window (Sell Vol ${cvdVolume.aggressiveSellVolume} vs Buy Vol ${cvdVolume.aggressiveBuyVolume}${cvdVolume.isEstimated ? ', estimated from OHLCV' : ''}).`
            : `Two-sided balanced aggression (Buy Vol ${cvdVolume.aggressiveBuyVolume} vs Sell Vol ${cvdVolume.aggressiveSellVolume}).`
        : 'Balanced participation.'

  const isAggressiveMovingPrice =
    cvdVolume.condition === 'SUCCESSFUL_BULLISH_INITIATIVE' ||
    cvdVolume.condition === 'SUCCESSFUL_BEARISH_INITIATIVE'
      ? `Yes — ${cvdVolume.effortVsResultSummary}`
      : cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE' ||
          cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE'
        ? `No — aggressive effort is meeting resistance/absorption with diminishing price progress (${cvdVolume.condition}).`
        : atrRegime.isFightingWithoutProgress
          ? 'No — ATR expanded while net displacement stayed compressed (two-sided absorption fight).'
          : 'Moderate rotational displacement within expected range boundaries.'

  const supplyAbsorptionVsSellingProgress =
    cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE'
      ? 'Supply appears to be getting absorbed: aggressive selling is failing to achieve proportional downward progress.'
      : cvdVolume.condition === 'SUCCESSFUL_BEARISH_INITIATIVE'
        ? 'Selling is successfully driving price lower with sustained downward progress (initiative supply, NOT absorption).'
        : 'Neither decisive supply absorption nor sustained bearish initiative is dominant at this bar.'

  const demandAbsorptionVsBuyingProgress =
    cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE'
      ? 'Demand appears to be getting absorbed: aggressive buying is failing to achieve proportional upward progress.'
      : cvdVolume.condition === 'SUCCESSFUL_BULLISH_INITIATIVE'
        ? 'Buying is successfully driving price higher with sustained upward progress (initiative demand, NOT distribution).'
        : 'Neither decisive demand absorption nor sustained bullish initiative is dominant at this bar.'

  const freshOppositeOrderOrigin = range
    ? `Fresh responsive buyers expected near Lower Boundary Zone [${range.lowerZone.low.toFixed(2)} – ${range.lowerZone.high.toFixed(2)}]; fresh responsive sellers expected near Upper Boundary Zone [${range.upperZone.low.toFixed(2)} – ${range.upperZone.high.toFixed(2)}].`
    : swingStructure.latestSwingLow && swingStructure.latestSwingHigh
      ? `Opposite-side liquidity rests near prior confirmed Swing Low (${swingStructure.latestSwingLow.price.toFixed(2)}) and Swing High (${swingStructure.latestSwingHigh.price.toFixed(2)}).`
      : 'Awaiting confirmed structural swing pivots.'

  const areBreakoutParticipantsTrapped =
    eventState.candidateEvent === 'SPRING' &&
    (eventState.lifecycleStage === 'RECLAIM' ||
      eventState.lifecycleStage === 'RETEST' ||
      eventState.lifecycleStage === 'CONFIRMED')
      ? `Downside breakdown sellers below ${range?.rangeLow.toFixed(2) ?? 'support'} are offside after price reclaimed the range.`
      : eventState.candidateEvent === 'UPTHRUST' &&
          (eventState.lifecycleStage === 'RETURN_INSIDE' ||
            eventState.lifecycleStage === 'RETEST' ||
            eventState.lifecycleStage === 'CONFIRMED')
        ? `Upside breakout buyers above ${range?.rangeHigh.toFixed(2) ?? 'resistance'} are offside after price rejected back inside the range.`
        : 'No confirmed trapped-participant signature at this stage.'

  const outsideRangeAcceptanceOrRejection = !range
    ? 'No active range to measure acceptance/rejection outside boundaries.'
    : range.classification === 'BREAKOUT'
      ? `Market is ACCEPTING prices above Range High (${range.rangeHigh.toFixed(2)}).`
      : range.classification === 'BREAKDOWN'
        ? `Market is ACCEPTING prices below Range Low (${range.rangeLow.toFixed(2)}).`
        : range.failedBreakouts.length > 0 || range.failedBreakdowns.length > 0
          ? `Market REJECTED recent excursion(s) outside range boundaries (${range.failedBreakdowns.length} failed breakdown(s), ${range.failedBreakouts.length} failed breakout(s)).`
          : 'Price remains inside the established range without a sustained outside excursion.'

  const invalidationEvidence =
    eventState.invalidationReason ??
    (range
      ? `Sustained closes and expanding ATR outside [${range.lowerZone.low.toFixed(2)} – ${range.upperZone.high.toFixed(2)}] in the opposite direction of the hypothesis.`
      : 'Break of the most recent confirmed structural swing pivot.')

  return {
    whereConductingBusiness,
    inRangeOrTransitioning,
    aggressiveSide,
    isAggressiveMovingPrice,
    supplyAbsorptionVsSellingProgress,
    demandAbsorptionVsBuyingProgress,
    freshOppositeOrderOrigin,
    areBreakoutParticipantsTrapped,
    outsideRangeAcceptanceOrRejection,
    invalidationEvidence,
  }
}

function buildHypothesisEvaluation(args: {
  range: WyckoffDetectedRange | null
  swingStructure: WyckoffSwingStructure
  atrRegime: WyckoffAtrRegime
  cvdVolume: WyckoffCvdVolumeIntelligence
  eventState: WyckoffEventState
}): WyckoffHypothesisEvaluation {
  const { range, swingStructure, atrRegime, cvdVolume, eventState } = args

  const primaryHypothesis: WyckoffRangeClassification = range
    ? range.classification
    : 'UNDETERMINED'

  const supporting: string[] = []
  const contradicting: string[] = []

  if (range) {
    supporting.push(
      `Range [${range.rangeLow.toFixed(2)} – ${range.rangeHigh.toFixed(2)}] active for ${range.durationBars} bars (overlap ${(range.overlapRatio * 100).toFixed(0)}%).`
    )
    if (range.lowerTests.length > 0) {
      supporting.push(
        `Lower boundary tested ${range.lowerTests.length} time(s); ${range.failedBreakdowns.length} sweep-and-reclaim test(s).`
      )
    }
    if (range.upperTests.length > 0) {
      supporting.push(
        `Upper boundary tested ${range.upperTests.length} time(s); ${range.failedBreakouts.length} sweep-and-return test(s).`
      )
    }
  }

  if (cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE') {
    supporting.push(
      `Effort vs Result shows Bullish Absorption Candidate: ${cvdVolume.effortVsResultSummary}`
    )
  } else if (cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE') {
    supporting.push(
      `Effort vs Result shows Bearish Absorption Candidate: ${cvdVolume.effortVsResultSummary}`
    )
  } else if (cvdVolume.condition === 'SUCCESSFUL_BEARISH_INITIATIVE') {
    if (
      primaryHypothesis === 'POSSIBLE_ACCUMULATION' ||
      primaryHypothesis === 'POSSIBLE_REACCUMULATION'
    ) {
      contradicting.push(
        'Aggressive selling is actively achieving lower lows (initiative supply contradicts accumulation).'
      )
    } else {
      supporting.push(
        'Aggressive selling is achieving proportional downward displacement (Successful Bearish Initiative).'
      )
    }
  } else if (cvdVolume.condition === 'SUCCESSFUL_BULLISH_INITIATIVE') {
    if (
      primaryHypothesis === 'POSSIBLE_DISTRIBUTION' ||
      primaryHypothesis === 'POSSIBLE_REDISTRIBUTION'
    ) {
      contradicting.push(
        'Aggressive buying is actively achieving higher highs (initiative demand contradicts distribution).'
      )
    } else {
      supporting.push(
        'Aggressive buying is achieving proportional upward displacement (Successful Bullish Initiative).'
      )
    }
  }

  if (atrRegime.atrTrend === 'CONTRACTING' && cvdVolume.condition === 'BALANCED_AUCTION') {
    contradicting.push(
      'ATR is contracting without a confirmed CVD absorption divergence or boundary reclaim — remains unconfirmed BALANCE rather than high-conviction accumulation/distribution.'
    )
  }

  if (eventState.confirmationStatus === 'UNCONFIRMED' || eventState.confirmationStatus === 'POTENTIAL') {
    contradicting.push(
      `Candidate event (${eventState.candidateEvent}) is currently ${eventState.confirmationStatus} at stage ${eventState.lifecycleStage}; structural retest/confirmation is not yet complete.`
    )
  }

  const alternativeHypothesis =
    primaryHypothesis === 'POSSIBLE_ACCUMULATION' ||
    primaryHypothesis === 'POSSIBLE_REACCUMULATION'
      ? 'Alternative Hypothesis: Temporary pause / redistribution before bearish breakdown if support fails to hold on a secondary test.'
      : primaryHypothesis === 'POSSIBLE_DISTRIBUTION' ||
          primaryHypothesis === 'POSSIBLE_REDISTRIBUTION'
        ? 'Alternative Hypothesis: Reaccumulation pause before bullish breakout acceptance if sellers fail to push price below the range midpoint.'
        : primaryHypothesis === 'BREAKOUT'
          ? 'Alternative Hypothesis: Late-stage Upthrust After Distribution (UTAD) if price loses the breakout boundary and closes back inside the range.'
          : primaryHypothesis === 'BREAKDOWN'
            ? 'Alternative Hypothesis: Terminal Shakeout / Spring if selling exhausts and price aggressively reclaims the lower boundary.'
            : `Alternative Hypothesis: Rotational balance continues around POC (${range?.poc?.toFixed(2) ?? 'midpoint'}) until an initiative expansion breaks value.`

  const accumulationWhereAreSellers = range
    ? `Diagnostic thought experiment (Accumulation): An inventory-seeking buyer needs sell liquidity below [${range.lowerZone.low.toFixed(2)} – ${range.lowerZone.high.toFixed(2)}]. ${
        range.failedBreakdowns.length > 0 || cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE'
          ? 'Observable evidence shows sell volume expanding near/below support with diminishing downward progress, consistent with passive bids absorbing breakdown sellers and long stops.'
          : cvdVolume.condition === 'SUCCESSFUL_BEARISH_INITIATIVE'
            ? 'However, sellers are currently achieving sustained downward displacement below support — indicating active supply dominance rather than passive absorption.'
            : 'No conclusive sweep-and-absorption signature has occurred at the lower boundary yet.'
      }`
    : `No active horizontal range to anchor a support-sweep thought experiment (current structure: ${swingStructure.structuralTrend}).`

  const distributionWhereAreBuyers = range
    ? `Diagnostic thought experiment (Distribution): An inventory-distributing seller needs buy liquidity above [${range.upperZone.low.toFixed(2)} – ${range.upperZone.high.toFixed(2)}]. ${
        range.failedBreakouts.length > 0 || cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE'
          ? 'Observable evidence shows buy volume expanding near/above resistance with diminishing upward progress, consistent with passive offers absorbing momentum buyers and short stops.'
          : cvdVolume.condition === 'SUCCESSFUL_BULLISH_INITIATIVE'
            ? 'However, buyers are currently achieving sustained upward acceptance above resistance — indicating genuine initiative demand rather than distribution.'
            : 'No conclusive sweep-and-rejection signature has occurred at the upper boundary yet.'
      }`
    : `No active horizontal range to anchor a resistance-sweep thought experiment (current structure: ${swingStructure.structuralTrend}).`

  return {
    primaryHypothesis,
    alternativeHypothesis,
    supportingEvidence: supporting,
    contradictingEvidence: contradicting,
    inventoryThoughtExperiment: {
      accumulationWhereAreSellers,
      distributionWhereAreBuyers,
    },
  }
}

function computeNextObstacleAndRunway(args: {
  currentPrice: number | null
  directionBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  range: WyckoffDetectedRange | null
  swingStructure: WyckoffSwingStructure
  eventState: WyckoffEventState
  atr: number | null
  externalObstacles?: ExternalReferenceObstacles
}): {
  structuralInvalidation: { price: number | null; description: string }
  nextImportantObstacle: { price: number | null; label: string; distancePts: number | null }
  rewardToRiskRunway: {
    riskPts: number | null
    rewardPts: number | null
    rrRatio: number | null
    isAtLeast2R: boolean
    verdict: string
  }
} {
  const {
    currentPrice,
    directionBias,
    range,
    swingStructure,
    eventState,
    atr,
    externalObstacles,
  } = args

  if (currentPrice == null) {
    return {
      structuralInvalidation: {
        price: null,
        description: 'UNKNOWN: No current price available.',
      },
      nextImportantObstacle: {
        price: null,
        label: 'UNKNOWN',
        distancePts: null,
      },
      rewardToRiskRunway: {
        riskPts: null,
        rewardPts: null,
        rrRatio: null,
        isAtLeast2R: false,
        verdict: 'UNKNOWN: Cannot compute R:R without price and structural boundaries.',
      },
    }
  }

  const buffer = atr && atr > 0 ? atr * 0.25 : currentPrice * 0.001

  // 1. Structural invalidation
  let invalidationPrice: number | null = eventState.structuralInvalidationPrice
  let invalidationDesc =
    eventState.invalidationReason ??
    'Structural invalidation requires a breach of the active boundary or swing extreme.'

  if (invalidationPrice == null) {
    if (directionBias === 'BULLISH') {
      invalidationPrice =
        range != null
          ? Number((range.lowerZone.low - buffer).toFixed(4))
          : swingStructure.latestSwingLow != null
            ? Number((swingStructure.latestSwingLow.price - buffer).toFixed(4))
            : null
      invalidationDesc =
        invalidationPrice != null
          ? `Close below structural support / lower boundary zone (${invalidationPrice.toFixed(2)}).`
          : 'No bullish structural invalidation anchor defined.'
    } else if (directionBias === 'BEARISH') {
      invalidationPrice =
        range != null
          ? Number((range.upperZone.high + buffer).toFixed(4))
          : swingStructure.latestSwingHigh != null
            ? Number((swingStructure.latestSwingHigh.price + buffer).toFixed(4))
            : null
      invalidationDesc =
        invalidationPrice != null
          ? `Close above structural resistance / upper boundary zone (${invalidationPrice.toFixed(2)}).`
          : 'No bearish structural invalidation anchor defined.'
    } else if (range != null) {
      invalidationPrice = Number(range.lowerZone.low.toFixed(4))
      invalidationDesc = `Range boundaries [${range.lowerZone.low.toFixed(2)} – ${range.upperZone.high.toFixed(2)}] define current balance invalidation.`
    }
  }

  // 2. Gather candidate obstacles in the direction of the hypothesis
  const candidates: Array<{ price: number; label: string }> = []
  const minObstacleDistance = atr && atr > 0 ? atr * 0.35 : 0

  if (directionBias === 'BULLISH' || directionBias === 'NEUTRAL') {
    if (range) {
      if (range.poc != null && range.poc > currentPrice + minObstacleDistance) {
        candidates.push({ price: range.poc, label: 'Range POC' })
      }
      if (range.rangeMidpoint > currentPrice + minObstacleDistance) {
        candidates.push({ price: range.rangeMidpoint, label: 'Range Midpoint' })
      }
      if (range.upperZone.low > currentPrice + minObstacleDistance * 0.5) {
        candidates.push({ price: range.upperZone.low, label: 'Range Upper Boundary Zone' })
      }
      if (range.rangeHigh > currentPrice) {
        candidates.push({ price: range.rangeHigh, label: 'Range High' })
      }
      if (range.classification === 'BREAKOUT' && range.widthPts > 0) {
        candidates.push({
          price: Number((range.rangeHigh + range.widthPts).toFixed(4)),
          label: 'Measured Range Breakout Objective',
        })
      }
    }
    if (
      swingStructure.latestSwingHigh &&
      swingStructure.latestSwingHigh.price > currentPrice + minObstacleDistance * 0.5
    ) {
      candidates.push({
        price: swingStructure.latestSwingHigh.price,
        label: 'Prior Confirmed Swing High',
      })
    }
    if (
      externalObstacles?.yesterdayHigh != null &&
      externalObstacles.yesterdayHigh > currentPrice
    ) {
      candidates.push({
        price: externalObstacles.yesterdayHigh,
        label: 'Yesterday High',
      })
    }
    if (
      externalObstacles?.overnightHigh != null &&
      externalObstacles.overnightHigh > currentPrice
    ) {
      candidates.push({
        price: externalObstacles.overnightHigh,
        label: 'Overnight High',
      })
    }
    if (
      externalObstacles?.fiveDayResistanceLow != null &&
      externalObstacles.fiveDayResistanceLow > currentPrice
    ) {
      candidates.push({
        price: externalObstacles.fiveDayResistanceLow,
        label: '5D Overhead Resistance Zone',
      })
    }
    candidates.sort((a, b) => a.price - b.price)
  } else if (directionBias === 'BEARISH') {
    if (range) {
      if (range.poc != null && range.poc < currentPrice - minObstacleDistance) {
        candidates.push({ price: range.poc, label: 'Range POC' })
      }
      if (range.rangeMidpoint < currentPrice - minObstacleDistance) {
        candidates.push({ price: range.rangeMidpoint, label: 'Range Midpoint' })
      }
      if (range.lowerZone.high < currentPrice - minObstacleDistance * 0.5) {
        candidates.push({ price: range.lowerZone.high, label: 'Range Lower Boundary Zone' })
      }
      if (range.rangeLow < currentPrice) {
        candidates.push({ price: range.rangeLow, label: 'Range Low' })
      }
      if (range.classification === 'BREAKDOWN' && range.widthPts > 0) {
        candidates.push({
          price: Number((range.rangeLow - range.widthPts).toFixed(4)),
          label: 'Measured Range Breakdown Objective',
        })
      }
    }
    if (
      swingStructure.latestSwingLow &&
      swingStructure.latestSwingLow.price < currentPrice - minObstacleDistance * 0.5
    ) {
      candidates.push({
        price: swingStructure.latestSwingLow.price,
        label: 'Prior Confirmed Swing Low',
      })
    }
    if (
      externalObstacles?.yesterdayLow != null &&
      externalObstacles.yesterdayLow < currentPrice
    ) {
      candidates.push({
        price: externalObstacles.yesterdayLow,
        label: 'Yesterday Low',
      })
    }
    if (
      externalObstacles?.overnightLow != null &&
      externalObstacles.overnightLow < currentPrice
    ) {
      candidates.push({
        price: externalObstacles.overnightLow,
        label: 'Overnight Low',
      })
    }
    if (
      externalObstacles?.fiveDaySupportHigh != null &&
      externalObstacles.fiveDaySupportHigh < currentPrice
    ) {
      candidates.push({
        price: externalObstacles.fiveDaySupportHigh,
        label: '5D Underlying Support Zone',
      })
    }
    candidates.sort((a, b) => b.price - a.price)
  }

  // Pick the primary structural obstacle (for a Spring/Upthrust at boundary, the primary structural target is at least Range Midpoint or opposite boundary)
  const chosenObstacle =
    candidates.find(
      (c) =>
        eventState.confirmationStatus === 'CONFIRMED'
          ? c.label.includes('Boundary') ||
            c.label.includes('High') ||
            c.label.includes('Low') ||
            c.label.includes('Objective')
          : true
    ) ??
    candidates[0] ??
    null

  const nextImportantObstacle = chosenObstacle
    ? {
        price: Number(chosenObstacle.price.toFixed(4)),
        label: chosenObstacle.label,
        distancePts: Number(Math.abs(chosenObstacle.price - currentPrice).toFixed(4)),
      }
    : {
        price: null,
        label: 'No immediate structural obstacle in range',
        distancePts: null,
      }

  const riskPts =
    invalidationPrice != null && directionBias !== 'NEUTRAL'
      ? Number(Math.max(0.0001, Math.abs(currentPrice - invalidationPrice)).toFixed(4))
      : null
  const rewardPts = nextImportantObstacle.distancePts

  const rrRatio =
    riskPts != null && rewardPts != null && riskPts > 0
      ? Number((rewardPts / riskPts).toFixed(2))
      : null
  const isAtLeast2R = rrRatio != null && rrRatio >= 2.0

  const verdict =
    rrRatio == null
      ? 'Neutral / Wait — no directional risk-to-obstacle runway active.'
      : isAtLeast2R
        ? `Favorable structural runway: ${rrRatio.toFixed(2)}R to ${nextImportantObstacle.label} (${rewardPts?.toFixed(2)} pts reward vs ${riskPts?.toFixed(2)} pts risk).`
        : `Compressed runway (${rrRatio.toFixed(2)}R < 2.0R) before ${nextImportantObstacle.label} at ${nextImportantObstacle.price?.toFixed(2)}; requires closer entry near ${invalidationPrice?.toFixed(2)} or acceptance through obstacle.`

  return {
    structuralInvalidation: {
      price: invalidationPrice,
      description: invalidationDesc,
    },
    nextImportantObstacle,
    rewardToRiskRunway: {
      riskPts,
      rewardPts,
      rrRatio,
      isAtLeast2R,
      verdict,
    },
  }
}

export function buildAdversarialQuestionCheck(args: {
  directionBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  range: WyckoffDetectedRange | null
  cvdVolume: WyckoffCvdVolumeIntelligence
  eventState: WyckoffEventState
  htfSummary: string
  htfAligned: boolean
  structuralInvalidation: { price: number | null; description: string }
  nextImportantObstacle: { price: number | null; label: string; distancePts: number | null }
  rewardToRiskRunway: {
    riskPts: number | null
    rewardPts: number | null
    rrRatio: number | null
    isAtLeast2R: boolean
    verdict: string
  }
}): AdversarialQuestionCheck {
  const {
    directionBias,
    range,
    cvdVolume,
    eventState,
    htfSummary,
    htfAligned,
    structuralInvalidation,
    nextImportantObstacle,
    rewardToRiskRunway,
  } = args

  if (directionBias === 'BEARISH') {
    const q1Pass =
      cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE' ||
      cvdVolume.condition === 'SUCCESSFUL_BEARISH_INITIATIVE' ||
      (range?.upperTests.some((t) => t.diminishingProgress) ?? false)
    const q2Pass =
      (range?.upperTests.length ?? 0) >= 1 ||
      eventState.candidateEvent === 'UPTHRUST' ||
      eventState.candidateEvent === 'SIGN_OF_WEAKNESS' ||
      eventState.candidateEvent === 'BREAKDOWN_FAILED_RECLAIM'
    const q3Pass =
      eventState.lifecycleStage === 'RETURN_INSIDE' ||
      eventState.lifecycleStage === 'RETEST' ||
      eventState.lifecycleStage === 'CONFIRMED'
    const q4Pass =
      cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE' ||
      cvdVolume.condition === 'SUCCESSFUL_BEARISH_INITIATIVE'
    const q5Pass = htfAligned
    const q6Pass = nextImportantObstacle.price != null
    const q7Pass = structuralInvalidation.price != null
    const q8Pass = rewardToRiskRunway.isAtLeast2R

    return {
      direction: 'SHORT',
      questions: [
        {
          questionNumber: 1,
          question:
            'Where are the buyers, and is there evidence their buying is becoming less effective?',
          answer: q1Pass
            ? `Buyers were active near ${range?.upperZone.mid.toFixed(2) ?? 'resistance'}, and upward progress diminished (${cvdVolume.condition}).`
            : 'Buyers have not yet shown clear exhaustion or diminishing upward progress.',
          passed: q1Pass,
        },
        {
          questionNumber: 2,
          question: 'Did price sweep above resistance or repeatedly fail at resistance?',
          answer: q2Pass
            ? `Yes — ${range?.upperTests.length ?? 0} upper boundary test(s) and ${range?.failedBreakouts.length ?? 0} sweep/rejection(s) recorded.`
            : 'No confirmed resistance sweep or repeated upper boundary failure yet.',
          passed: q2Pass,
        },
        {
          questionNumber: 3,
          question: 'Did price return inside the range or form a lower high after the test?',
          answer: q3Pass
            ? `Yes — lifecycle reached ${eventState.lifecycleStage} (${eventState.eventSummary}).`
            : `Not yet — current stage is ${eventState.lifecycleStage} (${eventState.confirmationStatus}).`,
          passed: q3Pass,
        },
        {
          questionNumber: 4,
          question:
            'Is CVD or volume behavior consistent with supply absorption or weakening demand?',
          answer: cvdVolume.effortVsResultSummary,
          passed: q4Pass,
        },
        {
          questionNumber: 5,
          question: 'What is the higher-timeframe context on 1D and 30m?',
          answer: htfSummary,
          passed: q5Pass,
        },
        {
          questionNumber: 6,
          question: 'Where is the next support or liquidity obstacle?',
          answer:
            nextImportantObstacle.price != null
              ? `${nextImportantObstacle.label} at ${nextImportantObstacle.price.toFixed(2)} (${nextImportantObstacle.distancePts?.toFixed(2)} pts away).`
              : 'No defined downside support obstacle in immediate range.',
          passed: q6Pass,
        },
        {
          questionNumber: 7,
          question: 'Where is structural invalidation?',
          answer: structuralInvalidation.description,
          passed: q7Pass,
        },
        {
          questionNumber: 8,
          question:
            'Is there enough room to the next major obstacle to justify the risk?',
          answer: rewardToRiskRunway.verdict,
          passed: q8Pass,
        },
      ],
      selfChallengeCritique: `Self-Challenge against Short Hypothesis: What if the resistance test is actually Phase D absorption before a Sign of Strength breakout? If buyers reclaim and hold above ${structuralInvalidation.price?.toFixed(2) ?? 'resistance'} with expanding ATR and rising CVD, the bearish upthrust/distribution read is wrong and must be abandoned immediately.`,
    }
  }

  // Default to LONG check (or NEUTRAL_WAIT evaluated against bullish criteria)
  const q1Pass =
    cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE' ||
    cvdVolume.condition === 'SUCCESSFUL_BULLISH_INITIATIVE' ||
    (range?.lowerTests.some((t) => t.diminishingProgress) ?? false)
  const q2Pass =
    (range?.lowerTests.length ?? 0) >= 1 ||
    eventState.candidateEvent === 'SPRING' ||
    eventState.candidateEvent === 'SIGN_OF_STRENGTH' ||
    eventState.candidateEvent === 'BREAKOUT_RETEST'
  const q3Pass =
    eventState.lifecycleStage === 'RECLAIM' ||
    eventState.lifecycleStage === 'RETEST' ||
    eventState.lifecycleStage === 'CONFIRMED'
  const q4Pass =
    cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE' ||
    cvdVolume.condition === 'SUCCESSFUL_BULLISH_INITIATIVE'
  const q5Pass = htfAligned
  const q6Pass = nextImportantObstacle.price != null
  const q7Pass = structuralInvalidation.price != null
  const q8Pass = rewardToRiskRunway.isAtLeast2R

  return {
    direction: directionBias === 'BULLISH' ? 'LONG' : 'NEUTRAL_WAIT',
    questions: [
      {
        questionNumber: 1,
        question:
          'Where are the sellers, and is there evidence their selling is becoming less effective?',
        answer: q1Pass
          ? `Sellers were active near ${range?.lowerZone.mid.toFixed(2) ?? 'support'}, and downward progress diminished (${cvdVolume.condition}).`
          : 'Sellers have not yet shown clear exhaustion; downward effort is either untested or still achieving progress.',
        passed: q1Pass,
      },
      {
        questionNumber: 2,
        question:
          'Did price sweep below support or repeatedly test support without breaking down?',
        answer: q2Pass
          ? `Yes — ${range?.lowerTests.length ?? 0} lower boundary test(s) and ${range?.failedBreakdowns.length ?? 0} sweep/reclaim(s) recorded.`
          : 'No confirmed support sweep or repeated lower boundary defense yet.',
        passed: q2Pass,
      },
      {
        questionNumber: 3,
        question: 'Did price reclaim the range or form a higher low after the test?',
        answer: q3Pass
          ? `Yes — lifecycle reached ${eventState.lifecycleStage} (${eventState.eventSummary}).`
          : `Not yet — current stage is ${eventState.lifecycleStage} (${eventState.confirmationStatus}).`,
        passed: q3Pass,
      },
      {
        questionNumber: 4,
        question:
          'Is CVD or volume behavior consistent with absorption or recovering demand?',
        answer: cvdVolume.effortVsResultSummary,
        passed: q4Pass,
      },
      {
        questionNumber: 5,
        question: 'What is the higher-timeframe context on 1D and 30m?',
        answer: htfSummary,
        passed: q5Pass,
      },
      {
        questionNumber: 6,
        question: 'Where is the next resistance or liquidity obstacle?',
        answer:
          nextImportantObstacle.price != null
            ? `${nextImportantObstacle.label} at ${nextImportantObstacle.price.toFixed(2)} (${nextImportantObstacle.distancePts?.toFixed(2)} pts away).`
            : 'No defined overhead resistance obstacle in immediate range.',
        passed: q6Pass,
      },
      {
        questionNumber: 7,
        question: 'Where is structural invalidation?',
        answer: structuralInvalidation.description,
        passed: q7Pass,
      },
      {
        questionNumber: 8,
        question:
          'Is there enough room to the next major obstacle to justify the risk?',
        answer: rewardToRiskRunway.verdict,
        passed: q8Pass,
      },
    ],
    selfChallengeCritique: `Self-Challenge against Long Hypothesis: What if apparent support defense is merely a brief pause in a larger markdown where passive bids get overwhelmed? If selling volume continues achieving lower lows below ${structuralInvalidation.price?.toFixed(2) ?? 'support'} without an immediate reclaim, the bullish absorption/spring hypothesis is invalidated.`,
  }
}

function resolveMonitoringStatus(
  range: WyckoffDetectedRange | null,
  eventState: WyckoffEventState,
  cvdVolume: WyckoffCvdVolumeIntelligence
): WyckoffMonitoringStatus {
  if (!range) return 'NO_TRADE'

  if (
    eventState.confirmationStatus === 'INVALIDATED' ||
    eventState.confirmationStatus === 'FAILED'
  ) {
    return 'INVALIDATED'
  }

  if (eventState.confirmationStatus === 'CONFIRMED') {
    return 'CONFIRMED'
  }

  if (eventState.candidateEvent === 'SPRING') {
    return 'POSSIBLE_SPRING'
  }

  if (
    eventState.candidateEvent === 'UPTHRUST' ||
    eventState.candidateEvent === 'UTAD'
  ) {
    return 'POSSIBLE_UPTHRUST'
  }

  if (
    eventState.lifecycleStage === 'BOUNDARY_APPROACH' ||
    eventState.lifecycleStage === 'BOUNDARY_TEST' ||
    eventState.lifecycleStage === 'RANGE_DETECTED' ||
    cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE' ||
    cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE'
  ) {
    return 'WATCH'
  }

  return 'NO_TRADE'
}

export function analyzeWyckoffSingleTimeframe(args: {
  candles: WyckoffCandle[]
  instrumentRaw: string
  timeframe: WyckoffTimeframe
  dataSource?: string
  nowUnixSec?: number
  htfSummary?: string
  htfAligned?: boolean
  externalObstacles?: ExternalReferenceObstacles
}): WyckoffTimeframeAnalysis {
  const spec = resolveWyckoffMarketSpec(args.instrumentRaw)
  const { candles } = adjustCandlesForContractRollover(args.candles)
  const latestBar = candles.length > 0 ? candles[candles.length - 1]! : null
  const nowSec = args.nowUnixSec ?? (latestBar ? latestBar.time : Math.floor(Date.now() / 1000))
  const dataFreshnessSec = latestBar ? Math.max(0, nowSec - latestBar.time) : null
  const currentPrice = latestBar ? latestBar.close : null

  // 1. Causal Swing Structure
  const swingStructure = computeWyckoffSwingStructure(
    candles,
    spec.instrument,
    args.timeframe
  )

  // 2. Preliminary ATR for range detection
  const prelimAtrRegime = computeWyckoffAtrRegime(candles, args.timeframe)

  // 3. Preliminary Volume / CVD Effort vs Result
  const prelimCvdVolume = computeWyckoffVolumeEffortResult(
    candles,
    args.timeframe,
    swingStructure,
    prelimAtrRegime.currentAtr
  )

  // 4. Automatic Trading-Range Detection
  const rangeDetection = detectWyckoffTradingRange(
    candles,
    spec.instrument,
    args.timeframe,
    swingStructure,
    prelimAtrRegime,
    prelimCvdVolume
  )

  // 5. Refine ATR Regime with range width and boundary test indices
  const atrRegime = computeWyckoffAtrRegime(candles, args.timeframe, {
    rangeWidthPts: rangeDetection.range?.widthPts ?? null,
    boundaryTestBarIndices: rangeDetection.boundaryTestBarIndices,
    sweepBarIndices: rangeDetection.sweepBarIndices,
  })

  // 6. Refine CVD/Volume Effort vs Result with range bounds & test/reclaim indices
  const cvdVolume = computeWyckoffVolumeEffortResult(
    candles,
    args.timeframe,
    swingStructure,
    atrRegime.currentAtr,
    {
      rangeBounds: rangeDetection.range
        ? {
            low: rangeDetection.range.rangeLow,
            high: rangeDetection.range.rangeHigh,
            tolerance: rangeDetection.range.lowerZone.toleranceAtr,
          }
        : null,
      boundaryTestBarIndices: rangeDetection.boundaryTestBarIndices,
      reclaimBarIndices: rangeDetection.reclaimBarIndices,
    }
  )

  // 7. Re-run range classification with refined cvdVolume & atrRegime
  const finalRangeDetection = detectWyckoffTradingRange(
    candles,
    spec.instrument,
    args.timeframe,
    swingStructure,
    atrRegime,
    cvdVolume
  )
  const detectedRange = finalRangeDetection.range

  // 8. Event Lifecycle State Machine
  const eventState = evaluateWyckoffEventStateMachine(
    candles,
    spec.instrument,
    args.timeframe,
    detectedRange,
    atrRegime,
    cvdVolume
  )

  // Synchronize detectedRange classification with confirmed state machine breakouts/springs when appropriate
  if (detectedRange) {
    if (
      eventState.candidateEvent === 'BREAKOUT_RETEST' &&
      eventState.confirmationStatus === 'CONFIRMED'
    ) {
      detectedRange.classification = 'BREAKOUT'
      detectedRange.provisionalPhase = 'PHASE_E'
      detectedRange.phaseExplanation =
        'Confirmed Sign of Strength (SOS) and Last Point of Support (LPS) retest holding above resistance (Phase E markup).'
    } else if (
      eventState.candidateEvent === 'BREAKDOWN_FAILED_RECLAIM' &&
      eventState.confirmationStatus === 'CONFIRMED'
    ) {
      detectedRange.classification = 'BREAKDOWN'
      detectedRange.provisionalPhase = 'PHASE_E'
      detectedRange.phaseExplanation =
        'Confirmed Sign of Weakness (SOW) and failed reclaim below support (Phase E markdown).'
    } else if (
      eventState.candidateEvent === 'SPRING' &&
      eventState.confirmationStatus === 'INVALIDATED'
    ) {
      detectedRange.classification = 'BREAKDOWN'
      detectedRange.provisionalPhase = 'PHASE_E'
      detectedRange.phaseExplanation =
        'Downside sweep failed to reclaim support; sustained selling pressure achieved lower lows (Spring invalidated -> Breakdown).'
    }
  }

  // 9. Hypothesis Evaluation & Inventory Thought Experiment
  const hypothesis = buildHypothesisEvaluation({
    range: detectedRange,
    swingStructure,
    atrRegime,
    cvdVolume,
    eventState,
  })

  // 10. Mindset Audit (10 Wyckoffian Questions)
  const mindsetAudit = buildWyckoffMindsetAudit({
    currentPrice,
    range: detectedRange,
    swingStructure,
    atrRegime,
    cvdVolume,
    eventState,
  })

  // 11. Next Obstacle, Invalidation, and Reward-to-Risk Runway
  const { structuralInvalidation, nextImportantObstacle, rewardToRiskRunway } =
    computeNextObstacleAndRunway({
      currentPrice,
      directionBias: eventState.directionBias,
      range: detectedRange,
      swingStructure,
      eventState,
      atr: atrRegime.currentAtr,
      externalObstacles: args.externalObstacles,
    })

  // 12. Adversarial Questioning & Self-Challenge
  const adversarialCheck = buildAdversarialQuestionCheck({
    directionBias: eventState.directionBias,
    range: detectedRange,
    cvdVolume,
    eventState,
    htfSummary:
      args.htfSummary ??
      `Evaluated standalone on ${args.timeframe} (${swingStructure.structuralTrend}).`,
    htfAligned: args.htfAligned ?? true,
    structuralInvalidation,
    nextImportantObstacle,
    rewardToRiskRunway,
  })

  const monitoringStatus = resolveMonitoringStatus(
    detectedRange,
    eventState,
    cvdVolume
  )

  return {
    market: spec.canonicalId,
    instrument: spec.instrument,
    timeframe: args.timeframe,
    dataSource: args.dataSource ?? `${spec.exchange}:${spec.primaryContract}`,
    dataFreshnessSec,
    latestBarTime: latestBar?.time ?? null,
    currentPrice,
    detectedRange,
    swingStructure,
    atrRegime,
    cvdVolume,
    eventState,
    hypothesis,
    mindsetAudit,
    adversarialCheck,
    structuralInvalidation,
    nextImportantObstacle,
    rewardToRiskRunway,
    monitoringStatus,
  }
}

export interface MultiTimeframeWyckoffInput {
  instrumentRaw: string
  dailyCandles?: WyckoffCandle[]
  m30Candles?: WyckoffCandle[]
  m5Candles?: WyckoffCandle[]
  /** Fallback candle series (e.g. from Chart Leo context) if explicit per-TF arrays are omitted */
  intradayCandles?: WyckoffCandle[]
  dataSource?: string
  nowUnixSec?: number
  externalObstacles?: ExternalReferenceObstacles
  crossMarketVolatility?: CrossMarketVolatilityState | null
  marketRadar?: CrossMarketRadarReport | null
}

export function computeWyckoffVolatilityAndRadarSynthesis(args: {
  instrument: WyckoffInstrument
  daily: WyckoffTimeframeAnalysis
  m30: WyckoffTimeframeAnalysis
  m5: WyckoffTimeframeAnalysis
  crossMarketVolatility?: CrossMarketVolatilityState | null
  marketRadar?: CrossMarketRadarReport | null
}): WyckoffVolatilityAndRadarSynthesis {
  const { instrument, daily, m30, m5, crossMarketVolatility, marketRadar } = args

  // 1. Resolve Dedicated Implied Volatility Gauge for Instrument
  let primaryGaugeSymbol: 'VIX1D' | 'VIX' | 'OVX' | 'GVZ' | 'JNIV' = 'VIX1D'
  let primaryGaugeValue: number | null = null
  let primaryGaugeChangePct: number | null = null
  let primaryGaugeRegime = 'UNKNOWN'
  let isGaugeExpanding = false

  if (instrument === 'GOLD') {
    primaryGaugeSymbol = 'GVZ'
    if (crossMarketVolatility?.gold?.gvz) {
      primaryGaugeValue = crossMarketVolatility.gold.gvz.value
      primaryGaugeChangePct = crossMarketVolatility.gold.gvz.changePct
      primaryGaugeRegime = crossMarketVolatility.gold.activeRegime
      isGaugeExpanding = crossMarketVolatility.gold.isExpanding
    }
  } else if (instrument === 'CRUDE') {
    primaryGaugeSymbol = 'OVX'
    if (crossMarketVolatility?.crude?.ovx) {
      primaryGaugeValue = crossMarketVolatility.crude.ovx.value
      primaryGaugeChangePct = crossMarketVolatility.crude.ovx.changePct
      primaryGaugeRegime = crossMarketVolatility.crude.activeRegime
      isGaugeExpanding = crossMarketVolatility.crude.isExpanding
    }
  } else if (instrument === 'NIKKEI') {
    primaryGaugeSymbol = 'JNIV'
    if (crossMarketVolatility?.nikkei?.jniv) {
      primaryGaugeValue = crossMarketVolatility.nikkei.jniv.value
      primaryGaugeChangePct = crossMarketVolatility.nikkei.jniv.changePct
      primaryGaugeRegime = crossMarketVolatility.nikkei.activeRegime
      isGaugeExpanding = crossMarketVolatility.nikkei.isExpanding
    }
  } else {
    primaryGaugeSymbol = 'VIX1D'
    if (crossMarketVolatility?.equities?.vix1d) {
      primaryGaugeValue = crossMarketVolatility.equities.vix1d.value
      primaryGaugeChangePct = crossMarketVolatility.equities.vix1d.changePct
      primaryGaugeRegime = crossMarketVolatility.equities.activeRegime
      isGaugeExpanding = crossMarketVolatility.equities.isExpanding
    }
  }

  // Fallback to realized ATR regime if live Cboe gauge was not passed
  if (primaryGaugeRegime === 'UNKNOWN') {
    if (m5.atrRegime.atrTrend === 'CONTRACTING') primaryGaugeRegime = 'COMPRESSED'
    else if (m5.atrRegime.atrTrend === 'EXPANDING') {
      primaryGaugeRegime = 'EXPANDING'
      isGaugeExpanding = true
    } else primaryGaugeRegime = 'NORMAL'
  }

  const gaugeValStr =
    primaryGaugeValue != null
      ? `${primaryGaugeSymbol} ${primaryGaugeValue.toFixed(1)} (${primaryGaugeChangePct != null && primaryGaugeChangePct >= 0 ? '+' : ''}${primaryGaugeChangePct?.toFixed(1) ?? '0.0'}%, ${primaryGaugeRegime})`
      : `${primaryGaugeSymbol} (ATR proxy: ${primaryGaugeRegime})`

  const activeRange = m5.detectedRange ?? m30.detectedRange ?? daily.detectedRange
  const ev = m5.eventState.candidateEvent !== 'NONE' ? m5.eventState : m30.eventState

  const nearLowerBoundary =
    activeRange?.pricePosition === 'LOWER_BOUNDARY_ZONE' ||
    activeRange?.pricePosition === 'BELOW_RANGE' ||
    ev.candidateEvent === 'SPRING' ||
    ev.candidateEvent === 'SECONDARY_TEST'

  const nearUpperBoundary =
    activeRange?.pricePosition === 'UPPER_BOUNDARY_ZONE' ||
    activeRange?.pricePosition === 'ABOVE_RANGE' ||
    ev.candidateEvent === 'UPTHRUST' ||
    ev.candidateEvent === 'UTAD'

  let volGaugeSignal: WyckoffVolGaugeSignal = 'NEUTRAL_VOL_CONTEXT'
  let volGaugeDiagnosis = `${gaugeValStr} — Volatility is in balanced equilibrium; monitor range boundary tests for expansion or compression.`

  if (
    (ev.candidateEvent === 'SPRING' ||
      ev.candidateEvent === 'SIGN_OF_STRENGTH' ||
      ev.candidateEvent === 'BREAKOUT_RETEST') &&
    (ev.lifecycleStage === 'RECLAIM' ||
      ev.lifecycleStage === 'RETEST' ||
      ev.lifecycleStage === 'CONFIRMED') &&
    ((primaryGaugeChangePct != null && primaryGaugeChangePct < 0) ||
      (!isGaugeExpanding && m5.atrRegime.atrTrend !== 'EXPANDING'))
  ) {
    volGaugeSignal = 'POST_SPRING_VOL_CRUSH_MARKUP'
    volGaugeDiagnosis = `Post-Spring Volatility Crush (${gaugeValStr}): Implied volatility is contracting after support reclaim, confirming trapped sellers and orderly Wyckoff Phase D/E mark-up.`
  } else if (nearLowerBoundary) {
    if (isGaugeExpanding && (primaryGaugeChangePct == null || primaryGaugeChangePct >= 3.5)) {
      volGaugeSignal = 'CLIMACTIC_STOPPING_VOLUME_PHASE_A'
      volGaugeDiagnosis = `Phase A Selling Climax Volatility Spike (${gaugeValStr}): Sharp volatility expansion at support marks initial stopping action (SC). Require a Secondary Test (ST) with contracting volatility before confirming accumulation.`
    } else if (!isGaugeExpanding && (primaryGaugeChangePct == null || primaryGaugeChangePct <= 1.8)) {
      volGaugeSignal = 'SILENT_SPRING_ABSORPTION'
      volGaugeDiagnosis = `Silent Spring Volatility Divergence (${gaugeValStr}): Price is probing/sweeping support while ${primaryGaugeSymbol} refuses to spike — institutions are NOT buying panic put protection, confirming passive limit-bid absorption (Accumulation Phase C).`
    }
  } else if (nearUpperBoundary) {
    if (
      isGaugeExpanding ||
      (primaryGaugeChangePct != null && primaryGaugeChangePct >= 1.0) ||
      primaryGaugeRegime === 'ELEVATED' ||
      primaryGaugeRegime === 'EXPANDING'
    ) {
      volGaugeSignal = 'DISTRIBUTION_VOL_FLOOR_DIVERGENCE'
      volGaugeDiagnosis = `Distribution Volatility Floor/Skew Divergence (${gaugeValStr}): Price is testing upper resistance while ${primaryGaugeSymbol} is elevated/rising — smart money is buying downside protection into retail strength (Upthrust / Distribution Phase B-C).`
    }
  } else if (
    activeRange &&
    (primaryGaugeRegime === 'COMPRESSED' ||
      primaryGaugeRegime === 'NORMAL' ||
      m5.atrRegime.atrTrend === 'CONTRACTING')
  ) {
    volGaugeSignal = 'PHASE_B_COMPRESSION_CAUSE_BUILDING'
    volGaugeDiagnosis = `Phase B Volatility Compression (${gaugeValStr}): Volatility has drained into compression inside [${activeRange.rangeLow.toFixed(2)} – ${activeRange.rangeHigh.toFixed(2)}], indicating circulating float is being absorbed and Wyckoff Cause is charging.`
  }

  // 2. Evaluate Cross-Market Radar (Wyckoff Principle of Selection & Intermarket Non-Confirmation)
  const radarCard = marketRadar?.markets?.[instrument as RadarMarket] ?? null
  const radarGrade = radarCard?.grade ?? null
  const radarTopPick = marketRadar?.topPick ?? null

  let crossMarketSignal: WyckoffCrossMarketSignal = 'PEER_ALIGNED_BALANCE'
  let crossMarketDiagnosis = `Cross-market peer comparison is balanced; await clear relative strength or weakness at a Tier 1 boundary.`

  if (marketRadar && radarCard) {
    const peerKeys: RadarMarket[] =
      instrument === 'NASDAQ' || instrument === 'DOW'
        ? (['NASDAQ', 'DOW', 'SP500'].filter((k) => k !== instrument) as RadarMarket[])
        : instrument === 'GOLD'
          ? ['SILVER', 'CRUDE']
          : instrument === 'CRUDE'
            ? ['GOLD', 'NASDAQ']
            : ['NASDAQ', 'DOW']

    const peerCards = peerKeys
      .map((k) => marketRadar.markets[k])
      .filter((c): c is NonNullable<typeof c> => c != null)

    const avgPeerChange =
      peerCards.length > 0
        ? peerCards.reduce((acc, c) => acc + c.dayChangePct, 0) / peerCards.length
        : radarCard.dayChangePct

    const relDiff = radarCard.dayChangePct - avgPeerChange
    const peerSummary = peerCards
      .map((c) => `${c.tickerRoot} ${c.dayChangePct >= 0 ? '+' : ''}${c.dayChangePct.toFixed(2)}% (Gr ${c.grade})`)
      .join(', ')

    // Check defensive rotation (Equities stalling while Gold/Crude vol & price expand)
    const goldCard = marketRadar.markets.GOLD
    const crudeCard = marketRadar.markets.CRUDE
    const defensiveExpanding =
      (instrument === 'NASDAQ' || instrument === 'DOW') &&
      ((goldCard && goldCard.dayChangePct > 0.4 && crossMarketVolatility?.gold?.isExpanding) ||
        (crudeCard && crudeCard.dayChangePct > 0.8 && crossMarketVolatility?.crude?.isExpanding))

    if (defensiveExpanding && nearUpperBoundary) {
      crossMarketSignal = 'DEFENSIVE_ROTATION_DISTRIBUTION_WARN'
      crossMarketDiagnosis = `Macro Defensive Rotation Warning: ${instrument} is stalling near resistance while hard assets (GC/CL) expand in price and volatility — capital rotation warns of Equity Distribution rather than Reaccumulation.`
    } else if (
      radarCard.grade === 'A' ||
      (relDiff >= 0.18 && (nearLowerBoundary || m5.cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE'))
    ) {
      crossMarketSignal = 'REL_STRENGTH_ACCUMULATION_LEADER'
      crossMarketDiagnosis = `Wyckoff Relative Strength Leader (Grade ${radarCard.grade}): ${instrument} (${radarCard.dayChangePct >= 0 ? '+' : ''}${radarCard.dayChangePct.toFixed(2)}%) is outperforming peer complex (${peerSummary}) with stronger structural absorption — confirms institutional accumulation leadership.`
    } else if (
      nearUpperBoundary &&
      (relDiff <= -0.18 || peerCards.some((p) => p.dayChangePct < 0))
    ) {
      crossMarketSignal = 'ISOLATED_UPTHRUST_DISTRIBUTION_WARN'
      crossMarketDiagnosis = `Intermarket Non-Confirmation Warning (Grade ${radarCard.grade}): ${instrument} is probing highs without peer breadth confirmation (${peerSummary}) — elevated risk of Upthrust After Distribution (UTAD).`
    } else if (
      radarCard.dayChangePct > 0 &&
      primaryGaugeChangePct != null &&
      primaryGaugeChangePct < 0
    ) {
      crossMarketSignal = 'RISK_ON_MARKUP_CONFIRMATION'
      crossMarketDiagnosis = `Broad Markup Confirmation (Grade ${radarCard.grade}): ${instrument} is advancing alongside contracting ${primaryGaugeSymbol} (${primaryGaugeChangePct.toFixed(1)}%) and supportive peer breadth (${peerSummary}).`
    } else {
      crossMarketSignal = 'PEER_ALIGNED_BALANCE'
      crossMarketDiagnosis = `Cross-Market Radar Grade ${radarCard.grade} (Top Pick: ${radarTopPick ?? 'NONE'}): ${instrument} (${radarCard.dayChangePct >= 0 ? '+' : ''}${radarCard.dayChangePct.toFixed(2)}%) is tracking in line with peers (${peerSummary}).`
    }
  }

  // 3. Combined Accumulation vs. Distribution Verdict
  let combinedAccDistVerdict: WyckoffVolatilityAndRadarSynthesis['combinedAccDistVerdict'] =
    'AWAITING_CONFIRMATION'

  if (
    volGaugeSignal === 'SILENT_SPRING_ABSORPTION' ||
    volGaugeSignal === 'POST_SPRING_VOL_CRUSH_MARKUP' ||
    crossMarketSignal === 'REL_STRENGTH_ACCUMULATION_LEADER' ||
    (volGaugeSignal === 'PHASE_B_COMPRESSION_CAUSE_BUILDING' &&
      (m5.cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE' ||
        m30.detectedRange?.classification === 'POSSIBLE_ACCUMULATION' ||
        m30.detectedRange?.classification === 'POSSIBLE_REACCUMULATION'))
  ) {
    combinedAccDistVerdict = 'ACCUMULATION_FAVORED'
  } else if (
    volGaugeSignal === 'DISTRIBUTION_VOL_FLOOR_DIVERGENCE' ||
    crossMarketSignal === 'ISOLATED_UPTHRUST_DISTRIBUTION_WARN' ||
    crossMarketSignal === 'DEFENSIVE_ROTATION_DISTRIBUTION_WARN' ||
    (m5.cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE' && nearUpperBoundary)
  ) {
    combinedAccDistVerdict = 'DISTRIBUTION_FAVORED'
  } else if (volGaugeSignal === 'PHASE_B_COMPRESSION_CAUSE_BUILDING') {
    combinedAccDistVerdict = 'CAUSE_BUILDING_NEUTRAL'
  }

  const actionableSynthesis = `[${combinedAccDistVerdict}] ${volGaugeDiagnosis} | ${crossMarketDiagnosis}`

  return {
    primaryGaugeSymbol,
    primaryGaugeValue,
    primaryGaugeChangePct,
    primaryGaugeRegime,
    isGaugeExpanding,
    volGaugeSignal,
    volGaugeDiagnosis,
    radarGrade,
    radarTopPick,
    crossMarketSignal,
    crossMarketDiagnosis,
    combinedAccDistVerdict,
    actionableSynthesis,
  }
}

function isBearishContext(tf: WyckoffTimeframeAnalysis): boolean {
  if (tf.eventState.directionBias === 'BEARISH') return true
  if (
    tf.detectedRange?.classification === 'BREAKDOWN' ||
    tf.detectedRange?.classification === 'POSSIBLE_DISTRIBUTION' ||
    tf.detectedRange?.classification === 'POSSIBLE_REDISTRIBUTION'
  ) {
    return true
  }
  if (
    tf.swingStructure.structuralTrend === 'DOWNTREND' &&
    tf.eventState.directionBias !== 'BULLISH'
  ) {
    return true
  }
  return false
}

function isBullishContext(tf: WyckoffTimeframeAnalysis): boolean {
  if (tf.eventState.directionBias === 'BULLISH') return true
  if (
    tf.detectedRange?.classification === 'BREAKOUT' ||
    tf.detectedRange?.classification === 'POSSIBLE_ACCUMULATION' ||
    tf.detectedRange?.classification === 'POSSIBLE_REACCUMULATION'
  ) {
    return true
  }
  if (
    tf.swingStructure.structuralTrend === 'UPTREND' &&
    tf.eventState.directionBias !== 'BEARISH'
  ) {
    return true
  }
  return false
}

export function evaluateWyckoffMultiTimeframe(
  input: MultiTimeframeWyckoffInput
): Omit<WyckoffMultiTimeframeReport, 'alerts'> {
  const spec = resolveWyckoffMarketSpec(input.instrumentRaw)
  const baseIntraday = input.intradayCandles ?? input.m5Candles ?? []

  const m5Candles =
    input.m5Candles && input.m5Candles.length > 0
      ? resampleWyckoffCandles(input.m5Candles, '5m')
      : resampleWyckoffCandles(baseIntraday, '5m')

  const m30Candles =
    input.m30Candles && input.m30Candles.length > 0
      ? resampleWyckoffCandles(input.m30Candles, '30m')
      : resampleWyckoffCandles(m5Candles, '30m')

  const dailyCandles =
    input.dailyCandles && input.dailyCandles.length > 0
      ? resampleWyckoffCandles(input.dailyCandles, '1D')
      : resampleWyckoffCandles(
          m30Candles.length >= 20 ? m30Candles : m5Candles,
          '1D'
        )

  // 1. Analyze Daily (1D)
  const daily = analyzeWyckoffSingleTimeframe({
    candles: dailyCandles,
    instrumentRaw: spec.instrument,
    timeframe: '1D',
    dataSource: input.dataSource,
    nowUnixSec: input.nowUnixSec,
    htfSummary: '1D is the highest structural anchor.',
    htfAligned: true,
    externalObstacles: input.externalObstacles,
  })

  const dailySummary = daily.detectedRange
    ? `1D ${daily.detectedRange.classification} (${daily.detectedRange.provisionalPhase}) [${daily.detectedRange.rangeLow.toFixed(2)} – ${daily.detectedRange.rangeHigh.toFixed(2)}], trend ${daily.swingStructure.structuralTrend}.`
    : `1D structure: ${daily.swingStructure.structuralTrend}.`

  // 1b. Analyze 4-Hour (4H - Session Scale: Asia / London / New York)
  const h4Candles = resampleWyckoffCandles(
    m30Candles.length >= 8 ? m30Candles : m5Candles,
    '4H'
  )
  const h4 = analyzeWyckoffSingleTimeframe({
    candles: h4Candles,
    instrumentRaw: spec.instrument,
    timeframe: '4H',
    dataSource: input.dataSource,
    nowUnixSec: input.nowUnixSec,
    htfSummary: dailySummary,
    htfAligned: true,
    externalObstacles: input.externalObstacles,
  })

  const h4Summary = h4.detectedRange
    ? `4H ${h4.detectedRange.classification} (${h4.detectedRange.provisionalPhase}) [${h4.detectedRange.rangeLow.toFixed(2)} – ${h4.detectedRange.rangeHigh.toFixed(2)}], event ${h4.eventState.candidateEvent} (${h4.eventState.lifecycleStage}).`
    : `4H structure: ${h4.swingStructure.structuralTrend}.`

  // 2. Analyze 30-Minute (30m)
  const m30 = analyzeWyckoffSingleTimeframe({
    candles: m30Candles,
    instrumentRaw: spec.instrument,
    timeframe: '30m',
    dataSource: input.dataSource,
    nowUnixSec: input.nowUnixSec,
    htfSummary: dailySummary,
    htfAligned: true,
    externalObstacles: input.externalObstacles,
  })

  const m30Summary = m30.detectedRange
    ? `30m ${m30.detectedRange.classification} (${m30.detectedRange.provisionalPhase}) [${m30.detectedRange.rangeLow.toFixed(2)} – ${m30.detectedRange.rangeHigh.toFixed(2)}], event ${m30.eventState.candidateEvent} (${m30.eventState.lifecycleStage}).`
    : `30m structure: ${m30.swingStructure.structuralTrend}.`

  // Preliminary 5m analysis to check direction vs 1D and 30m
  const prelimM5 = analyzeWyckoffSingleTimeframe({
    candles: m5Candles,
    instrumentRaw: spec.instrument,
    timeframe: '5m',
    dataSource: input.dataSource,
    nowUnixSec: input.nowUnixSec,
    htfSummary: `${dailySummary} | ${m30Summary}`,
    htfAligned: true,
    externalObstacles: input.externalObstacles,
  })

  const dailyBearish = isBearishContext(daily)
  const dailyBullish = isBullishContext(daily)
  const m30Bearish = isBearishContext(m30)
  const m30Bullish = isBullishContext(m30)
  const m5Bullish = isBullishContext(prelimM5)
  const m5Bearish = isBearishContext(prelimM5)

  const explicitConflicts: string[] = []
  let isCountertrend5m = false
  let alignmentStatus: WyckoffMultiTimeframeReport['hierarchySynthesis']['alignmentStatus'] =
    'BALANCED_NEUTRAL'

  if (m5Bullish && (m30Bearish || dailyBearish)) {
    isCountertrend5m = true
    alignmentStatus = 'COUNTERTREND_5M_BULLISH_VS_HTF_BEARISH'
    if (m30Bearish && dailyBearish) {
      explicitConflicts.push(
        `COUNTERTREND WARNING: 5m bullish ${prelimM5.eventState.candidateEvent} is fighting BOTH bearish 30m (${m30.detectedRange?.classification ?? m30.swingStructure.structuralTrend}) and bearish 1D (${daily.detectedRange?.classification ?? daily.swingStructure.structuralTrend}) context.`
      )
    } else if (m30Bearish) {
      explicitConflicts.push(
        `COUNTERTREND WARNING: 5m bullish ${prelimM5.eventState.candidateEvent} forms against a bearish 30m intermediate auction (${m30.detectedRange?.classification ?? m30.swingStructure.structuralTrend}).`
      )
    } else {
      explicitConflicts.push(
        `HTF CONFLICT: 5m bullish ${prelimM5.eventState.candidateEvent} faces a bearish 1D macro structure (${daily.detectedRange?.classification ?? daily.swingStructure.structuralTrend}).`
      )
    }
  } else if (m5Bearish && (m30Bullish || dailyBullish)) {
    isCountertrend5m = true
    alignmentStatus = 'COUNTERTREND_5M_BEARISH_VS_HTF_BULLISH'
    if (m30Bullish && dailyBullish) {
      explicitConflicts.push(
        `COUNTERTREND WARNING: 5m bearish ${prelimM5.eventState.candidateEvent} is fighting BOTH bullish 30m (${m30.detectedRange?.classification ?? m30.swingStructure.structuralTrend}) and bullish 1D (${daily.detectedRange?.classification ?? daily.swingStructure.structuralTrend}) context.`
      )
    } else if (m30Bullish) {
      explicitConflicts.push(
        `COUNTERTREND WARNING: 5m bearish ${prelimM5.eventState.candidateEvent} forms against a bullish 30m intermediate auction.`
      )
    } else {
      explicitConflicts.push(
        `HTF CONFLICT: 5m bearish ${prelimM5.eventState.candidateEvent} faces a bullish 1D macro structure.`
      )
    }
  } else if (m5Bullish && m30Bullish && dailyBullish) {
    alignmentStatus = 'ALIGNED_BULLISH'
  } else if (m5Bearish && m30Bearish && dailyBearish) {
    alignmentStatus = 'ALIGNED_BEARISH'
  } else if (
    m5Bullish &&
    (m30.detectedRange?.pricePosition === 'LOWER_BOUNDARY_ZONE' ||
      daily.detectedRange?.pricePosition === 'LOWER_BOUNDARY_ZONE' ||
      m30Bullish)
  ) {
    alignmentStatus = 'HTF_SUPPORT_CONFLUENCE'
  } else if (
    m5Bearish &&
    (m30.detectedRange?.pricePosition === 'UPPER_BOUNDARY_ZONE' ||
      daily.detectedRange?.pricePosition === 'UPPER_BOUNDARY_ZONE' ||
      m30Bearish)
  ) {
    alignmentStatus = 'HTF_RESISTANCE_CONFLUENCE'
  } else if (
    daily.currentPrice == null &&
    m30.currentPrice == null &&
    prelimM5.currentPrice == null
  ) {
    alignmentStatus = 'UNKNOWN'
  } else if (
    (dailyBullish && m30Bearish) ||
    (dailyBearish && m30Bullish)
  ) {
    alignmentStatus = 'CONFLICTED_MIXED'
    explicitConflicts.push(
      `1D (${daily.swingStructure.structuralTrend}) and 30m (${m30.swingStructure.structuralTrend}) are in structural disagreement.`
    )
  }

  // Re-run 5m adversarial check with exact HTF alignment flag
  const m5 = analyzeWyckoffSingleTimeframe({
    candles: m5Candles,
    instrumentRaw: spec.instrument,
    timeframe: '5m',
    dataSource: input.dataSource,
    nowUnixSec: input.nowUnixSec,
    htfSummary: `${dailySummary} | ${m30Summary}${explicitConflicts.length > 0 ? ` | ${explicitConflicts.join(' ')}` : ''}`,
    htfAligned: !isCountertrend5m,
    externalObstacles: {
      ...input.externalObstacles,
      // Inject 30m and 1D boundaries as external obstacles for 5m if not already closer
      fiveDayResistanceLow:
        input.externalObstacles?.fiveDayResistanceLow ??
        m30.detectedRange?.upperZone.low ??
        daily.detectedRange?.upperZone.low ??
        null,
      fiveDaySupportHigh:
        input.externalObstacles?.fiveDaySupportHigh ??
        m30.detectedRange?.lowerZone.high ??
        daily.detectedRange?.lowerZone.high ??
        null,
    },
  })

  // 3. Synthesize Implied Volatility Gauges (VIX1D / OVX / GVZ / JNIV) & 5-Market Radar for Accumulation vs Distribution
  const volatilityAndRadarSynthesis = computeWyckoffVolatilityAndRadarSynthesis({
    instrument: spec.instrument,
    daily,
    m30,
    m5,
    crossMarketVolatility: input.crossMarketVolatility,
    marketRadar: input.marketRadar,
  })

  if (volatilityAndRadarSynthesis.combinedAccDistVerdict === 'ACCUMULATION_FAVORED') {
    if (
      m5.hypothesis.primaryHypothesis === 'POSSIBLE_ACCUMULATION' ||
      m5.hypothesis.primaryHypothesis === 'POSSIBLE_REACCUMULATION' ||
      m5.hypothesis.primaryHypothesis === 'BALANCE'
    ) {
      m5.hypothesis.supportingEvidence.push(volatilityAndRadarSynthesis.volGaugeDiagnosis)
      if (volatilityAndRadarSynthesis.crossMarketSignal !== 'PEER_ALIGNED_BALANCE') {
        m5.hypothesis.supportingEvidence.push(volatilityAndRadarSynthesis.crossMarketDiagnosis)
      }
    } else if (
      m5.hypothesis.primaryHypothesis === 'POSSIBLE_DISTRIBUTION' ||
      m5.hypothesis.primaryHypothesis === 'POSSIBLE_REDISTRIBUTION'
    ) {
      m5.hypothesis.contradictingEvidence.push(volatilityAndRadarSynthesis.volGaugeDiagnosis)
    }
  } else if (volatilityAndRadarSynthesis.combinedAccDistVerdict === 'DISTRIBUTION_FAVORED') {
    if (
      m5.hypothesis.primaryHypothesis === 'POSSIBLE_DISTRIBUTION' ||
      m5.hypothesis.primaryHypothesis === 'POSSIBLE_REDISTRIBUTION' ||
      m5.hypothesis.primaryHypothesis === 'BALANCE'
    ) {
      m5.hypothesis.supportingEvidence.push(volatilityAndRadarSynthesis.volGaugeDiagnosis)
      if (volatilityAndRadarSynthesis.crossMarketSignal !== 'PEER_ALIGNED_BALANCE') {
        m5.hypothesis.supportingEvidence.push(volatilityAndRadarSynthesis.crossMarketDiagnosis)
      }
    } else if (
      m5.hypothesis.primaryHypothesis === 'POSSIBLE_ACCUMULATION' ||
      m5.hypothesis.primaryHypothesis === 'POSSIBLE_REACCUMULATION'
    ) {
      m5.hypothesis.contradictingEvidence.push(volatilityAndRadarSynthesis.volGaugeDiagnosis)
    }
  }

  const currentPrice =
    m5.currentPrice ?? m30.currentPrice ?? daily.currentPrice ?? null

  const combinedVerdict: WyckoffMonitoringStatus =
    m5.monitoringStatus !== 'NO_TRADE'
      ? m5.monitoringStatus
      : m30.monitoringStatus !== 'NO_TRADE'
        ? m30.monitoringStatus
        : daily.monitoringStatus

  const actionableSummary = isCountertrend5m
    ? `${spec.instrument}: Countertrend 5m ${m5.eventState.candidateEvent} (${m5.eventState.confirmationStatus}) vs higher-timeframe ${m30Bearish ? '30m bearish' : '30m bullish'} / ${dailyBearish ? '1D bearish' : '1D bullish'} structure. Lower conviction — treat as tactical scalp only or wait for 30m reclaim.`
    : `${spec.instrument} [${alignmentStatus}]: 1D ${daily.detectedRange?.classification ?? daily.swingStructure.structuralTrend} | 30m ${m30.detectedRange?.classification ?? m30.swingStructure.structuralTrend} (${m30.eventState.lifecycleStage}) | 5m ${m5.eventState.candidateEvent} (${m5.eventState.lifecycleStage}, ${m5.monitoringStatus}) | Vol/Radar: ${volatilityAndRadarSynthesis.combinedAccDistVerdict} (${volatilityAndRadarSynthesis.primaryGaugeSymbol} ${volatilityAndRadarSynthesis.volGaugeSignal}).`

  return {
    market: spec.canonicalId,
    instrument: spec.instrument,
    evaluatedAt: new Date(
      (input.nowUnixSec ?? Math.floor(Date.now() / 1000)) * 1000
    ).toISOString(),
    currentPrice,
    daily,
    h4,
    m30,
    m5,
    hierarchySynthesis: {
      dailyLandscape: dailySummary,
      intermediate4hAuction: h4Summary,
      intermediate30mAuction: m30Summary,
      tactical5mConfirmation: `${m5.eventState.eventSummary} (Status: ${m5.monitoringStatus})`,
      alignmentStatus,
      isCountertrend5m,
      explicitConflicts,
      combinedVerdict,
      actionableSummary,
    },
    volatilityAndRadarSynthesis,
  }
}
