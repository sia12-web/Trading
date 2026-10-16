/**
 * TradePulse Wyckoff Multi-Timeframe Auction Intelligence Engine — Core Types
 *
 * Covers Daily (1D), 30-minute (30m), and 5-minute (5m) deterministic range discovery,
 * causal swing structure, ATR volatility regime, CVD/volume effort-vs-result,
 * weak-hand behavioral modeling, event lifecycle state machine, adversarial questioning,
 * and deduplicated desk alerts across NASDAQ (NQ), DOW (YM), GOLD (GC), CRUDE (CL), and NIKKEI (NK225).
 */

import type { CanonicalMarketId } from '@/lib/ai/canonicalMarkets'

export type WyckoffTimeframe = '1D' | '4H' | '30m' | '5m'

export type WyckoffInstrument = 'NASDAQ' | 'DOW' | 'GOLD' | 'CRUDE' | 'NIKKEI'

export type WyckoffRangeClassification =
  | 'BALANCE'
  | 'POSSIBLE_ACCUMULATION'
  | 'POSSIBLE_DISTRIBUTION'
  | 'POSSIBLE_REACCUMULATION'
  | 'POSSIBLE_REDISTRIBUTION'
  | 'BREAKOUT'
  | 'BREAKDOWN'
  | 'UNDETERMINED'

export type WyckoffProvisionalPhase =
  | 'PHASE_A'
  | 'PHASE_B'
  | 'PHASE_C'
  | 'PHASE_D'
  | 'PHASE_E'
  | 'UNDETERMINED'

export type WyckoffLifecycleStage =
  | 'NONE'
  | 'RANGE_DETECTED'
  | 'BOUNDARY_APPROACH'
  | 'BOUNDARY_TEST'
  | 'SWEEP'
  | 'RECLAIM'
  | 'RETURN_INSIDE'
  | 'RETEST'
  | 'CONFIRMED'
  | 'FAILED'
  | 'EXPIRED'

export type WyckoffCandidateEventType =
  | 'NONE'
  | 'SELLING_CLIMAX'
  | 'BUYING_CLIMAX'
  | 'AUTOMATIC_RALLY'
  | 'AUTOMATIC_REACTION'
  | 'SECONDARY_TEST'
  | 'SPRING'
  | 'UPTHRUST'
  | 'UTAD'
  | 'SIGN_OF_STRENGTH'
  | 'SIGN_OF_WEAKNESS'
  | 'LAST_POINT_OF_SUPPORT'
  | 'LAST_POINT_OF_SUPPLY'
  | 'BREAKOUT_RETEST'
  | 'BREAKDOWN_FAILED_RECLAIM'

export type WyckoffMonitoringStatus =
  | 'WATCH'
  | 'POSSIBLE_SPRING'
  | 'POSSIBLE_UPTHRUST'
  | 'CONFIRMED'
  | 'INVALIDATED'
  | 'NO_TRADE'

export interface WyckoffMarketSpec {
  instrument: WyckoffInstrument
  canonicalId: CanonicalMarketId
  exchange: 'CME_GLOBEX' | 'CBOT' | 'COMEX' | 'NYMEX' | 'OSE_CME'
  primaryContract: string
  microContract: string | null
  tickSize: number
  pointValue: number
  sessionCalendar: {
    timezone: string
    cashOpenLocal: string
    cashCloseLocal: string
    globexResetHourEt: number
  }
  rolloverCycleMonths: number[]
}

export interface WyckoffCandle {
  /** Unix timestamp in seconds (or milliseconds, normalized to seconds by engine) */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  /** Optional exchange aggressor buy volume */
  buyVolume?: number
  /** Optional exchange aggressor sell volume */
  sellVolume?: number
  /** Optional bar aggressor delta (askVolume - bidVolume) */
  delta?: number
  /** Optional cumulative volume delta */
  cvd?: number
  /** True if CVD/delta was estimated from OHLCV rather than exchange bid/ask trades */
  isEstimatedCvd?: boolean
  /** Optional futures contract code (e.g. 'NQZ6') to detect contract rollover boundaries */
  contractSymbol?: string
}

export type SwingLabel = 'HH' | 'HL' | 'LH' | 'LL' | 'EQH' | 'EQL'

export interface WyckoffSwingPoint {
  index: number
  pivotTime: number
  /** Timestamp of the causal confirmation bar (pivotIndex + rightBars). Never uses future data beyond evaluation time. */
  confirmedAtTime: number
  price: number
  type: 'HIGH' | 'LOW'
  label: SwingLabel
  volumeAtPivot: number
  cvdAtPivot: number | null
}

export interface WyckoffSwingStructure {
  timeframe: WyckoffTimeframe
  swings: WyckoffSwingPoint[]
  latestSwingHigh: WyckoffSwingPoint | null
  latestSwingLow: WyckoffSwingPoint | null
  priorSwingHigh: WyckoffSwingPoint | null
  priorSwingLow: WyckoffSwingPoint | null
  higherHighCount: number
  higherLowCount: number
  lowerHighCount: number
  lowerLowCount: number
  equalHighCount: number
  equalLowCount: number
  structuralTrend: 'UPTREND' | 'DOWNTREND' | 'ROTATIONAL' | 'TRANSITIONING' | 'UNKNOWN'
  priorTrendBeforeRange: 'UPTREND' | 'DOWNTREND' | 'FLAT' | 'UNKNOWN'
  rolloverAdjusted: boolean
  summary: string
}

export interface WyckoffAtrRegime {
  timeframe: WyckoffTimeframe
  period: number
  currentAtr: number | null
  atrTrend: 'EXPANDING' | 'CONTRACTING' | 'STABLE' | 'UNKNOWN'
  atrPercentile: number | null
  atrRatioToMedian: number | null
  rangeWidthInAtr: number | null
  preTestAtr: number | null
  postTestAtr: number | null
  springOrUpthrustAtrRatio: number | null
  isInitiativeDisplacement: boolean
  isFightingWithoutProgress: boolean
  volatilityQuestionAnswer: string
}

export type WeakHandCategory =
  | 'CAPITULATING_LONGS'
  | 'BREAKOUT_SELLERS'
  | 'LATE_BREAKOUT_BUYERS'
  | 'FORCED_SHORT_COVERING'
  | 'FAILED_BREAKOUT_PARTICIPANTS'
  | 'RESPONSIVE_BUYERS_SELLERS'
  | 'MOMENTUM_PARTICIPANTS'
  | 'PASSIVE_LIQUIDITY_PROVIDERS'

export interface WeakHandBehaviorAssessment {
  category: WeakHandCategory
  consistency: 'CONSISTENT_WITH_OBSERVATIONS' | 'SPECULATIVE' | 'NOT_SUPPORTED'
  observableEvidence: string
  howToDistinguish: string
}

export type CvdVolumeConditionType =
  | 'BULLISH_ABSORPTION_CANDIDATE'
  | 'BEARISH_ABSORPTION_CANDIDATE'
  | 'SUCCESSFUL_BULLISH_INITIATIVE'
  | 'SUCCESSFUL_BEARISH_INITIATIVE'
  | 'BALANCED_AUCTION'
  | 'LOW_PARTICIPATION_DRIFT'
  | 'UNKNOWN'

export interface SwingCvdChange {
  fromTime: number
  toTime: number
  direction: 'UP_SWING' | 'DOWN_SWING'
  priceDelta: number
  cvdDelta: number
  totalVolume: number
  displacementPerUnitEffort: number
}

export interface WyckoffCvdVolumeIntelligence {
  timeframe: WyckoffTimeframe
  cvdSource: 'EXCHANGE_AGGRESSOR' | 'ESTIMATED_CANDLE' | 'UNAVAILABLE'
  isEstimated: boolean
  sessionCvd: number | null
  cvdHigh: number | null
  cvdLow: number | null
  latestBarVolume: number | null
  relativeVolume: number | null
  volumeRatePerBar: number | null
  aggressiveBuyVolume: number | null
  aggressiveSellVolume: number | null
  boundaryTestVolumeRatio: number | null
  reclaimVolumeRatio: number | null
  cvdDivergence: 'BULLISH_ABSORPTION_DIVERGENCE' | 'BEARISH_ABSORPTION_DIVERGENCE' | 'NONE' | 'UNKNOWN'
  condition: CvdVolumeConditionType
  effortVsResultSummary: string
  swingCvdChanges: SwingCvdChange[]
  weakHandBehaviors: WeakHandBehaviorAssessment[]
}

export interface WyckoffBoundaryZone {
  low: number
  mid: number
  high: number
  toleranceAtr: number
}

export interface WyckoffBoundaryTest {
  time: number
  side: 'UPPER' | 'LOWER'
  extremePrice: number
  closePrice: number
  volume: number
  relativeVolume: number
  cvdAtTest: number | null
  sweptBeyondZone: boolean
  reclaimedInside: boolean
  diminishingProgress: boolean
}

export interface WyckoffDetectedRange {
  rangeId: string
  instrument: WyckoffInstrument
  timeframe: WyckoffTimeframe
  rangeHigh: number
  rangeLow: number
  rangeMidpoint: number
  upperZone: WyckoffBoundaryZone
  lowerZone: WyckoffBoundaryZone
  poc: number | null
  vah: number | null
  val: number | null
  hvnPrices: number[]
  lvnPrices: number[]
  widthPts: number
  widthAtr: number | null
  durationBars: number
  durationMinutes: number
  startTime: number
  firstIdentifiedAt: number
  lastUpdatedAt: number
  overlapRatio: number
  upperTests: WyckoffBoundaryTest[]
  lowerTests: WyckoffBoundaryTest[]
  failedBreakouts: WyckoffBoundaryTest[]
  failedBreakdowns: WyckoffBoundaryTest[]
  pricePosition: 'ABOVE_RANGE' | 'UPPER_BOUNDARY_ZONE' | 'UPPER_HALF' | 'MIDPOINT' | 'LOWER_HALF' | 'LOWER_BOUNDARY_ZONE' | 'BELOW_RANGE'
  classification: WyckoffRangeClassification
  provisionalPhase: WyckoffProvisionalPhase
  phaseExplanation: string
}

export interface WyckoffLifecycleTransition {
  fromStage: WyckoffLifecycleStage
  toStage: WyckoffLifecycleStage
  event: WyckoffCandidateEventType
  timestamp: number
  price: number
  evidence: string
}

export interface WyckoffEventState {
  timeframe: WyckoffTimeframe
  lifecycleStage: WyckoffLifecycleStage
  candidateEvent: WyckoffCandidateEventType
  confirmationStatus: 'UNCONFIRMED' | 'POTENTIAL' | 'CONFIRMED' | 'FAILED' | 'INVALIDATED' | 'EXPIRED' | 'NONE'
  directionBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  sweepExtremePrice: number | null
  sweepTime: number | null
  reclaimPrice: number | null
  reclaimTime: number | null
  retestPrice: number | null
  retestTime: number | null
  structuralInvalidationPrice: number | null
  invalidationReason: string | null
  transitions: WyckoffLifecycleTransition[]
  eventSummary: string
}

export interface WyckoffMindsetAudit {
  whereConductingBusiness: string
  inRangeOrTransitioning: string
  aggressiveSide: string
  isAggressiveMovingPrice: string
  supplyAbsorptionVsSellingProgress: string
  demandAbsorptionVsBuyingProgress: string
  freshOppositeOrderOrigin: string
  areBreakoutParticipantsTrapped: string
  outsideRangeAcceptanceOrRejection: string
  invalidationEvidence: string
}

export interface AdversarialQuestionCheck {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL_WAIT'
  questions: Array<{
    questionNumber: number
    question: string
    answer: string
    passed: boolean
  }>
  selfChallengeCritique: string
}

export interface WyckoffHypothesisEvaluation {
  primaryHypothesis: WyckoffRangeClassification
  alternativeHypothesis: string
  supportingEvidence: string[]
  contradictingEvidence: string[]
  inventoryThoughtExperiment: {
    accumulationWhereAreSellers: string
    distributionWhereAreBuyers: string
  }
}

export interface WyckoffTimeframeAnalysis {
  market: CanonicalMarketId
  instrument: WyckoffInstrument
  timeframe: WyckoffTimeframe
  dataSource: string
  dataFreshnessSec: number | null
  latestBarTime: number | null
  currentPrice: number | null
  detectedRange: WyckoffDetectedRange | null
  swingStructure: WyckoffSwingStructure
  atrRegime: WyckoffAtrRegime
  cvdVolume: WyckoffCvdVolumeIntelligence
  eventState: WyckoffEventState
  hypothesis: WyckoffHypothesisEvaluation
  mindsetAudit: WyckoffMindsetAudit
  adversarialCheck: AdversarialQuestionCheck
  structuralInvalidation: {
    price: number | null
    description: string
  }
  nextImportantObstacle: {
    price: number | null
    label: string
    distancePts: number | null
  }
  rewardToRiskRunway: {
    riskPts: number | null
    rewardPts: number | null
    rrRatio: number | null
    isAtLeast2R: boolean
    verdict: string
  }
  monitoringStatus: WyckoffMonitoringStatus
}

export interface WyckoffAuctionAlert {
  id: string
  fingerprint: string
  market: CanonicalMarketId
  instrument: WyckoffInstrument
  timeframe: WyckoffTimeframe
  monitoringStatus: WyckoffMonitoringStatus
  lifecycleStage: WyckoffLifecycleStage
  candidateEvent: WyckoffCandidateEventType
  headline: string
  observedCondition: string
  evidence: string
  timestamp: number
  isoTime: string
}

export interface WyckoffMultiTimeframeReport {
  market: CanonicalMarketId
  instrument: WyckoffInstrument
  evaluatedAt: string
  currentPrice: number | null
  daily: WyckoffTimeframeAnalysis
  h4?: WyckoffTimeframeAnalysis
  m30: WyckoffTimeframeAnalysis
  m5: WyckoffTimeframeAnalysis
  hierarchySynthesis: {
    dailyLandscape: string
    intermediate4hAuction?: string
    intermediate30mAuction: string
    tactical5mConfirmation: string
    alignmentStatus:
      | 'ALIGNED_BULLISH'
      | 'ALIGNED_BEARISH'
      | 'COUNTERTREND_5M_BULLISH_VS_HTF_BEARISH'
      | 'COUNTERTREND_5M_BEARISH_VS_HTF_BULLISH'
      | 'HTF_SUPPORT_CONFLUENCE'
      | 'HTF_RESISTANCE_CONFLUENCE'
      | 'CONFLICTED_MIXED'
      | 'BALANCED_NEUTRAL'
      | 'UNKNOWN'
    isCountertrend5m: boolean
    explicitConflicts: string[]
    combinedVerdict: WyckoffMonitoringStatus
    actionableSummary: string
  }
  alerts: WyckoffAuctionAlert[]
}
