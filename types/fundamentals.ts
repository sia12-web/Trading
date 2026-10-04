/**
 * Oil Fundamental Analyst Domain Types
 * Market: NYMEX WTI Crude Oil
 *
 * Implements:
 * 1. Machine-readable structured JSON event evaluation (no 5-paragraph essays)
 * 2. Version 1 pragmatic 5-feed state engine
 * 3. "TODAY'S OIL FUNDAMENTAL STATE" with invalidation criteria
 */

export type FundamentalPillarId =
  | 'crude_supply'
  | 'petroleum_demand'
  | 'inventories'
  | 'refinery_activity'
  | 'imports_exports'
  | 'opec_policy'
  | 'geopolitical_risk'
  | 'curve_structure'
  | 'speculative_positioning'
  | 'macro_drivers'

export type DirectionalBias = 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL'

export type ImpactHorizon = 'INTRADAY' | 'DAYS_WEEKS' | 'MONTHS'

export type EventImportance = 'HIGH' | 'MEDIUM' | 'LOW'

export type ConfirmationStrength =
  | 'STRONG'
  | 'MODERATE'
  | 'WEAK'
  | 'CONTRADICTED'
  | 'DIVERGENT'
  | 'UNCONFIRMED'

export type AffectedCategory =
  | 'SUPPLY'
  | 'DEMAND'
  | 'INVENTORIES'
  | 'REFINING'
  | 'TRANSPORTATION'
  | 'POSITIONING'
  | 'MACRO_CONDITIONS'

export type MarketConfirmationVerdict =
  | 'CONFIRMED'
  | 'CONTRADICTED'
  | 'DIVERGENT'
  | 'UNCONFIRMED_PENDING_FLOW'

export type CurveRegime = 'BACKWARDATION' | 'CONTANGO' | 'FLAT'

// ==========================================
// 1. STRICT MACHINE-READABLE EVENT EVALUATION
// ==========================================

export interface EventDriver {
  factor: string
  actual: number | string
  consensus: number | string | null
  unit: string
  effect: DirectionalBias
}

export interface StructuredOilEventOutput {
  timestamp: string
  market: 'WTI'
  event: string
  importance: EventImportance

  fundamental_effect: {
    intraday: DirectionalBias
    short_term: DirectionalBias
    medium_term: DirectionalBias
  }

  drivers: EventDriver[]

  market_confirmation: {
    cl_5m_return: number // % return in 5m (e.g. 0.8)
    front_spread_change: number // $/bbl change (e.g. 0.06)
    confirmation: ConfirmationStrength
  }

  confidence: number // 0.0 to 1.0 (e.g. 0.84)
  summary: string // crisp 1-2 sentence institutional summary, no essays
}

// ==========================================
// 2. TODAY'S OIL FUNDAMENTAL STATE (V1 CORE)
// ==========================================

export interface TodaysOilFundamentalState {
  supply: string
  demand: string
  inventories: string
  opec: string
  geopolitical_risk: string
  positioning: string
  curve: string
  upcoming_catalysts: string

  bias: DirectionalBias
  confidence: number // e.g. 0.84 or 84%
  what_changed_since_yesterday: string
  what_would_invalidate_this_view: string

  updatedAt: string
}

// ==========================================
// 3. PRAGMATIC 5 FEEDS STATUS
// ==========================================

export type FeedId =
  | 'eia_api'
  | 'trading_economics'
  | 'cftc_api'
  | 'realtime_news'
  | 'cme_databento'

export interface FiveFeedStatus {
  id: FeedId
  name: string
  source: string
  status: 'ONLINE' | 'ACTIVE' | 'FALLBACK'
  lastSync: string
  details: string
}

// ==========================================
// 4. PILLARS & TELEMETRY
// ==========================================

export interface FundamentalPillarMetric {
  label: string
  value: string | number
  unit?: string
  trend?: 'UP' | 'DOWN' | 'FLAT'
  note?: string
}

export interface FundamentalPillarState {
  id: FundamentalPillarId
  name: string
  subtitle: string
  bias: DirectionalBias
  statusSummary: string
  metrics: FundamentalPillarMetric[]
  horizon: ImpactHorizon
  confidence: number // 1 to 10
  reliability: number // 1 to 10
  keyTakeaway: string
  lastUpdated: string
  primarySource: string
  isMateriallyShifted?: boolean
}

export interface ScheduledDataComparison {
  metric: string
  actual: string
  consensus?: string | null
  previous?: string | null
  revised?: string | null
  surpriseDelta?: string | null
  isSurprise?: boolean
}

export interface SourceAndTimestamp {
  source: string
  timestamp: string
  verified: boolean
  channelType?: 'OFFICIAL_GOV' | 'EXCHANGE' | 'WIRE_SERVICE' | 'SURVEY_ESTIMATE' | 'ANALYST_NOTE'
  notes?: string
}

export interface FactsVsEstimates {
  facts: string[]
  estimatesAndInterpretation: string[]
  conflicts: string[]
  hasConflict: boolean
}

export interface EvaluationRatings {
  reliability: number // 1 - 10
  magnitude: number // 1 - 10
  novelty: number // 1 - 10
  confidence: number // 1 - 10
  rationale: string
}

export interface MarketConfirmation {
  wtiPrice: number
  wtiChange: number
  wtiChangePct: number
  calendarSpread: number // M1 - M2 spread ($/bbl)
  spreadRegime: CurveRegime
  verdict: MarketConfirmationVerdict
  priceReactionDetail: string
  spreadReactionDetail: string
}

export interface MaterialityDecision {
  isMaterial: boolean
  stateUpdated: boolean
  rationale: string
  pillarsImpacted: FundamentalPillarId[]
}

export interface EvaluationSafeguards {
  missingData: string[]
  correlationCausationWarnings: string[]
  headlineTradeWarning: string
  sourceConflicts: string[]
}

export interface OilEventEvaluation {
  id: string
  rawInput: string
  title: string
  evaluatedAt: string

  // Machine-readable structured payload
  structured: StructuredOilEventOutput

  // 10-Step Evaluation Framework
  step1_factual_information: string[]
  step2_source_and_timestamp: SourceAndTimestamp
  step3_facts_vs_estimates: FactsVsEstimates
  step4_scheduled_data_comparison: ScheduledDataComparison | null
  step5_affected_categories: AffectedCategory[]
  step6_direction: DirectionalBias
  step7_relevant_horizon: ImpactHorizon
  step8_ratings: EvaluationRatings
  step9_market_confirmation: MarketConfirmation
  step10_materiality: MaterialityDecision

  // Safeguards
  safeguards: EvaluationSafeguards
}

export interface WtiTelemetry {
  promptPrice: number
  symbol: string
  change: number
  changePct: number
  high: number
  low: number
  previousClose: number
  promptSpread: number // e.g. +0.45 (backwardation) or -0.30 (contango)
  spreadRegime: CurveRegime
  brentPrice?: number
  brentWtiSpread?: number
  crackSpread321?: number
  gasolinePrice?: number
  heatingOilPrice?: number
  volume?: number
  timestamp: number
  source: string
  updatedAt: string
}

export interface LiveOilHeadline {
  id: string
  headline: string
  source: string
  datetime: number
  url: string | null
  summary: string | null
}

export interface OilCatalystEvent {
  id: string
  name: string
  agency: string
  frequency: string
  dayTimeEt: string
  impact: 'HIGH' | 'MEDIUM' | 'LOW'
  description: string
  focusPillars: FundamentalPillarId[]
  nextScheduled?: string
  lastActual?: string
  lastSurprise?: string
}

export interface OilFundamentalDashboardState {
  market: 'NYMEX_WTI'
  analystPersona: 'Oil Fundamental Analyst'
  updatedAt: string
  overallBias: DirectionalBias
  overallConfidence: number
  biasSummary: string
  physicalBalance: 'DEFICIT' | 'SURPLUS' | 'BALANCED'
  curveSummary: string
  wtiTelemetry: WtiTelemetry
  today: TodaysOilFundamentalState
  fiveFeeds: FiveFeedStatus[]
  pillars: Record<FundamentalPillarId, FundamentalPillarState>
  recentEvents: OilEventEvaluation[]
  scheduledCatalysts: OilCatalystEvent[]
  liveOilHeadlines: LiveOilHeadline[]
}

// ==========================================
// UNIFIED MULTI-AGENT PROTOCOL (Item 39)
// Uniform protocol across OIL, NQ, GOLD agents
// ==========================================

export interface UnifiedAgentDriver {
  factor: string
  impact: string
  effect: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED'
}

export interface UnifiedAgentProtocolOutput {
  market: 'CL' | 'GC' | 'NQ' | 'YM'
  regime: string
  catalyst: string
  expected_direction: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL' | 'UNCERTAIN'
  magnitude: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  horizon: 'INTRADAY' | 'SHORT_TERM' | 'MEDIUM_TERM'
  confidence: number // 0.0 to 1.0
  market_confirmation: 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'REJECTED' | 'INCONCLUSIVE'
  key_drivers: UnifiedAgentDriver[]
  invalidation: string
}

// ==========================================
// GOLD FUNDAMENTAL ANALYST DOMAIN TYPES (GC)
// Macro + Monetary + Physical Demand Analyst
// ==========================================

export type GoldEventCategory =
  | 'MONETARY_POLICY'
  | 'REAL_RATES'
  | 'NOMINAL_RATES'
  | 'USD'
  | 'INFLATION'
  | 'LABOR'
  | 'GROWTH'
  | 'LIQUIDITY'
  | 'GEOPOLITICAL_RISK'
  | 'FINANCIAL_STRESS'
  | 'CENTRAL_BANK_DEMAND'
  | 'ETF_FLOWS'
  | 'SPECULATIVE_POSITIONING'
  | 'PHYSICAL_DEMAND'
  | 'MINE_SUPPLY'
  | 'RECYCLING'
  | 'COMEX_INVENTORY'
  | 'OPTIONS_VOLATILITY'

export type GoldDirectionalStance = 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL' | 'UNCERTAIN'

export type GoldHorizon = 'INTRADAY' | 'SHORT_TERM' | 'MEDIUM_TERM'

export type GoldSurpriseType =
  | 'HOTTER_THAN_EXPECTED'
  | 'COOLER_THAN_EXPECTED'
  | 'HAWKISH_SURPRISE'
  | 'DOVISH_SURPRISE'
  | 'AS_EXPECTED'
  | 'INLINE'
  | 'UNEXPECTED_EVENT'

export interface GoldTransmission {
  real_rates: 'UP' | 'DOWN' | 'FLAT' | 'UNCERTAIN'
  nominal_rates: 'UP' | 'DOWN' | 'FLAT' | 'UNCERTAIN'
  usd: 'UP' | 'DOWN' | 'FLAT' | 'UNCERTAIN'
}

export interface GoldMarketResponse {
  gc_initial: 'UP' | 'DOWN' | 'FLAT'
  gc_5m: 'UP' | 'DOWN' | 'FLAT'
  gc_15m: 'CONTINUING' | 'REVERSING' | 'RECLAIMING' | 'ACCEPTING' | 'STALLED'
  real_yield_confirmation: 'BULLISH_GOLD' | 'BEARISH_GOLD' | 'NEUTRAL'
  usd_confirmation: 'BULLISH_GOLD' | 'BEARISH_GOLD' | 'NEUTRAL'
  gold_response_quality:
    | 'CONFIRMED'
    | 'PARTIAL_CONFIRMATION'
    | 'PARTIAL_REJECTION'
    | 'COMPLETE_REJECTION'
    | 'INCONCLUSIVE'
}

/**
 * Strict Machine-Readable Event Output for Gold Agent (Item 36)
 */
export interface StructuredGoldEventOutput {
  timestamp: string
  market: 'GC'
  event: string
  importance: 'HIGH' | 'MEDIUM' | 'LOW'

  event_analysis: {
    category: GoldEventCategory
    expected_gold_effect: GoldDirectionalStance
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW'
    surprise: GoldSurpriseType
    raw_surprise?: number
    standardized_surprise?: number // (actual - consensus) / historical volatility
  }

  transmission: GoldTransmission

  fundamental_state: {
    intraday: GoldDirectionalStance
    short_term: GoldDirectionalStance
    medium_term: GoldDirectionalStance
  }

  market_response: GoldMarketResponse

  confidence: number // 0.0 to 1.0 (e.g. 0.84)
  summary: string // crisp 1-2 sentence institutional summary, no essays
  unified_protocol?: UnifiedAgentProtocolOutput
}

/**
 * Daily Gold Fundamental State (Item 37)
 */
export interface TodaysGoldFundamentalState {
  monetary_policy: string
  real_rate_regime: string
  usd_regime: string
  inflation: string
  growth: string
  financial_stress: string
  geopolitical_risk: string
  etf_flows: string
  central_bank_demand: string
  cftc_positioning: string
  physical_demand: string
  supply: string
  comex_inventory_deliveries: string
  gold_volatility: string

  intraday_bias: GoldDirectionalStance
  short_term_bias: GoldDirectionalStance
  medium_term_bias: GoldDirectionalStance

  main_current_driver: string
  upcoming_catalysts: string
  what_changed_since_yesterday: string
  what_would_invalidate_this_view: string
}

export type GoldDriverId =
  | 'real_interest_rates'
  | 'fed_rate_expectations'
  | 'us_dollar'
  | 'inflation_macro'
  | 'geopolitical_financial_stress'
  | 'etf_speculative_flows'
  | 'central_bank_physical_demand'

export interface GoldDriverMetric {
  label: string
  value: string
  change?: string
  trend: 'UP' | 'DOWN' | 'FLAT'
  stance: GoldDirectionalStance
}

export interface GoldDriverState {
  id: GoldDriverId
  name: string
  intradayStars: number // 1 to 5
  longTermStars: number // 1 to 5
  stance: GoldDirectionalStance
  transmissionRole: string
  summary: string
  metrics: GoldDriverMetric[]
  lastUpdated: string
}

export interface GoldTelemetry {
  goldPrice: number // e.g. 4162.30
  goldChange: number
  goldChangePct: number
  silverPrice: number // e.g. 60.415
  silverChange: number
  goldSilverRatio: number // e.g. 68.89
  us10yNominalYield: number // e.g. 5.28% (^TNX)
  us5yNominalYield: number // e.g. 5.05% (^FVX)
  us2yNominalYield?: number
  us30yNominalYield?: number
  us10yRealYield: number // e.g. 2.88% (FRED DFII10)
  us5yRealYield: number // e.g. 2.65% (FRED DFII5)
  us10yBreakeven: number // e.g. 2.36% (FRED T10YIE)
  dxyIndex: number // e.g. 101.92 (DX-Y.NYB)
  dxyChangePct: number
  eurUsd: number // e.g. 1.1257
  usdJpy: number // e.g. 153.40
  goldCvol: number // e.g. 16.4% (CME Gold CVOL index)
  goldRealizedVol30d: number
  cvdAggressionStance?: 'AGGRESSIVE_BUYING' | 'AGGRESSIVE_SELLING' | 'ABSORPTION' | 'NEUTRAL'
  timestamp: number
  source: string
  updatedAt: string
}

export interface LiveGoldHeadline {
  id: string
  headline: string
  source: string
  datetime: number
  url: string | null
  summary: string | null
}

export interface GoldEtfFlowState {
  globalTonnes: number
  weeklyChangeTonnes: number
  monthlyChangeTonnes: number
  gldHoldingsTonnes: number
  iauHoldingsTonnes: number
  divergenceSignal: 'CONFIRMING' | 'DIVERGENT_OTC_CENTRAL_BANK' | 'OUTFLOWS_DESPITE_PRICE_RALLY' | 'NEUTRAL'
  notes: string
}

export interface CftcGoldPositioningState {
  reportDate: string
  managedMoneyLong: number
  managedMoneyShort: number
  netManagedMoney: number
  weeklyChangeContracts: number
  longShortRatio: number
  fourWeekTrend: number[]
  crowdingIndex: number // 0-100 (0=extreme short, 100=extreme crowded long)
  liquidationRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME'
  openInterest: number
}

export interface ComexDepositoryInventoryState {
  reportDate: string
  registeredOz: number
  eligibleOz: number
  totalOz: number
  dailyReceivedOz: number
  dailyWithdrawnOz: number
  deliveryNotices: number
  change1dOz: number
  change5dOz: number
  change20dOz: number
  warningDisclaimer: string // "COMEX_STOCK_CHANGE != TRADE_SIGNAL. Eligible metal can be warranted anytime. Do not infer physical shortages without cash delivery stress."
}

export interface CentralBankDemandState {
  annualNetPurchasesTonnes: number
  quarterlyRunRateTonnes: number
  pbocReportedOunces: number
  pbocPurchasesStatus: string
  reserveDiversificationPace: 'ACCELERATING' | 'STEADY' | 'DECELERATING'
  imfDataTimestamp: string
}

export interface GoldFeedStatus {
  id: string
  name: string
  subtitle: string
  category: 'MACRO_CALENDAR' | 'CENTRAL_BANK' | 'REAL_RATES' | 'CME_GLOBEX' | 'CFTC' | 'WORLD_GOLD_COUNCIL' | 'NEWS_WIRE' | 'COMEX_STOCKS'
  status: 'ONLINE' | 'ACTIVE' | 'POLLING' | 'DEGRADED' | 'CONFIG_REQUIRED'
  latency: string
  lastSync: string
  primarySource: string
}

export interface GoldEventEvaluation {
  id: string
  timestamp: string
  event: string
  rawText: string
  structuredOutput: StructuredGoldEventOutput
  safeguards: {
    noInventedData: boolean
    correlationNotCausation: boolean
    noHeadlineOnlyTrade: boolean
    sourcesConflictReported: boolean
    comexNotTradeSignal: boolean
  }
}

export interface GoldFundamentalDashboardState {
  market: 'COMEX_GC'
  analystPersona: 'Gold Macro, Monetary and Physical Demand Analyst'
  updatedAt: string
  overallBias: GoldDirectionalStance
  overallConfidence: number
  biasSummary: string
  goldTelemetry: GoldTelemetry
  today: TodaysGoldFundamentalState
  drivers: Record<GoldDriverId, GoldDriverState>
  etfFlows: GoldEtfFlowState
  cftcPositioning: CftcGoldPositioningState
  comexInventory: ComexDepositoryInventoryState
  centralBankDemand: CentralBankDemandState
  feeds: GoldFeedStatus[]
  recentEvents: GoldEventEvaluation[]
  liveGoldHeadlines: LiveGoldHeadline[]
}

// ==========================================
// NASDAQ-100 FUNDAMENTAL ANALYST DOMAIN TYPES (NQ)
// Macro + Earnings + Rates + Flow Analyst
// ==========================================

export type NasdaqEventCategory =
  | 'MONETARY_POLICY'
  | 'RATES'
  | 'INFLATION'
  | 'LABOR'
  | 'GROWTH'
  | 'LIQUIDITY'
  | 'EARNINGS'
  | 'GUIDANCE'
  | 'AI_CAPEX'
  | 'SEMICONDUCTORS'
  | 'REGULATION'
  | 'GEOPOLITICS'
  | 'VOLATILITY'
  | 'OPTIONS'
  | 'POSITIONING'
  | 'BREADTH'

export type NasdaqDirectionalStance = 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL' | 'UNCERTAIN'

export type NasdaqHorizon = 'INTRADAY' | 'SHORT_TERM' | 'MEDIUM_TERM'

export interface NasdaqAbnormalBehavior {
  detected: boolean
  type:
    | 'BULLISH_RELATIVE_STRENGTH'
    | 'BEARISH_RELATIVE_WEAKNESS'
    | 'RATES_DIVERGENCE'
    | 'BREADTH_DIVERGENCE'
    | 'VOLATILITY_EXPANSION_ON_RALLY'
    | 'NONE'
  description: string
}

export interface StructuredNasdaqEventOutput {
  timestamp: string
  market: 'NQ'
  event: string
  importance: 'HIGH' | 'MEDIUM' | 'LOW'

  // Prompt 34 schema:
  fundamental_effect: {
    intraday: NasdaqDirectionalStance
    short_term: NasdaqDirectionalStance
    medium_term: NasdaqDirectionalStance
  }

  drivers: Array<{
    factor: string
    actual: number | string
    consensus: number | string | null
    unit: string
    effect: NasdaqDirectionalStance
    standardized_surprise?: number
    capex_guidance_nuance?: string
  }>

  market_confirmation: {
    cl_5m_return: number // or nq_5m_return %
    us2y_bps_change?: number
    us10y_bps_change?: number
    vxn_point_change?: number
    advance_decline_ratio?: number
    confirmation: 'STRONG' | 'MODERATE' | 'WEAK' | 'CONTRADICTED'
    market_state?: string
  }

  // Prompt 35: Abnormal behavior detection
  abnormal_behavior: NasdaqAbnormalBehavior

  confidence: number // 0.0 to 1.0 (e.g. 0.86)
  summary: string // crisp 1-2 sentence institutional summary, no essays

  // Extended macro transmission & response
  event_analysis?: {
    category: NasdaqEventCategory
    expected_direction: NasdaqDirectionalStance
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW'
    surprise: string
    raw_surprise?: number
    standardized_surprise?: number
    index_relevance_pct?: number
  }

  transmission?: {
    fed_expectations: 'MORE_HAWKISH' | 'MORE_DOVISH' | 'UNCHANGED' | 'UNCERTAIN'
    us2y: 'UP' | 'DOWN' | 'FLAT'
    us10y: 'UP' | 'DOWN' | 'FLAT'
    usd: 'UP' | 'DOWN' | 'FLAT'
  }

  fundamental_state?: {
    intraday: NasdaqDirectionalStance
    short_term: NasdaqDirectionalStance
    medium_term: NasdaqDirectionalStance
  }

  market_response?: {
    nq_initial: 'UP' | 'DOWN' | 'FLAT'
    nq_5m: 'UP' | 'DOWN' | 'FLAT'
    nq_15m: 'CONTINUING' | 'REVERSING' | 'RECLAIMING' | 'ACCEPTING' | 'STALLED'
    rates_confirmation: 'YES' | 'NO' | 'MIXED'
    volatility_confirmation: 'YES' | 'NO' | 'DIVERGENT'
    nq_response_quality:
      | 'CONFIRMED'
      | 'PARTIAL_CONFIRMATION'
      | 'PARTIAL_REJECTION'
      | 'COMPLETE_REJECTION'
      | 'INCONCLUSIVE'
  }

  unified_protocol?: UnifiedAgentProtocolOutput
}

export interface TodaysNasdaqFundamentalState {
  fed_regime: string
  rate_regime: string
  us2y: string
  us10y: string
  inflation_trend: string
  labor_trend: string
  growth_trend: string
  financial_conditions: string
  ndx_earnings_trend: string
  forward_guidance_trend: string
  ai_capex_trend: string
  semiconductor_trend: string
  breadth: string
  leadership: string
  volatility: string
  positioning: string
  main_current_market_driver: string

  intraday_bias: NasdaqDirectionalStance
  short_term_bias: NasdaqDirectionalStance
  medium_term_bias: NasdaqDirectionalStance

  upcoming_catalysts: string
  what_changed_since_yesterday: string
  what_would_invalidate_the_current_interpretation: string
}

export type NasdaqDriverId =
  | 'fed_rate_expectations'
  | 'treasury_yields'
  | 'inflation'
  | 'labor_growth'
  | 'ndx_earnings_guidance'
  | 'ai_semi_cycle'
  | 'market_breadth'
  | 'volatility_options'
  | 'positioning'
  | 'usd_financial_conditions'
  | 'regulation_geopolitics'

export interface NasdaqDriverMetric {
  label: string
  value: string
  change?: string
  trend: 'UP' | 'DOWN' | 'FLAT'
  stance: NasdaqDirectionalStance
}

export interface NasdaqDriverState {
  id: NasdaqDriverId
  name: string
  intradayStars: number // 1 to 5
  longTermStars: number // 1 to 5
  stance: NasdaqDirectionalStance
  transmissionRole: string
  summary: string
  metrics: NasdaqDriverMetric[]
  lastUpdated: string
}

export interface NdxConstituentWeight {
  symbol: string
  name: string
  weight: number // % of index
  sector: string
  price: number
  changePct: number
  lastEpsSurprise?: string
  forwardGuidanceStance?: 'RAISED' | 'LOWERED' | 'MAINTAINED'
}

export interface NdxBreadthState {
  advancingCount: number
  decliningCount: number
  advanceDeclineRatio: number
  pctAbove20dMa: number
  pctAbove50dMa: number
  pctAbove200dMa: number
  pctAboveVwap: number
  qqqVsQqqeRatio: number // cap-weighted vs equal-weighted
  marketParticipationStance:
    | 'BROAD_EXPANSION'
    | 'CONCENTRATED_MEGA_CAP_RALLY'
    | 'BROAD_DETERIORATION'
    | 'NEUTRAL'
}

export interface AiSemiCycleState {
  acceleratorDemandTrend: 'ACCELERATING' | 'STEADY' | 'DECELERATING'
  hyperscalerCapexRunRateBillions: number
  semiconductorEquipmentCycle: string
  exportRestrictionsStatus: string
  aiLeadershipStance: 'TECH_LEADING_BROAD_EXPANSION' | 'NARROW_CHIP_CONCENTRATION' | 'DEFENSIVE_ROTATION'
}

export interface NdxEarningsCycleState {
  blendedEarningsGrowthPct: number
  guidanceRevisionRatio: number
  capexGrowthPct: number
  notableRecentReports: Array<{
    company: string
    symbol: string
    epsResult: 'BEAT' | 'MISS' | 'INLINE'
    revenueResult: 'BEAT' | 'MISS' | 'INLINE'
    guidanceResult: 'RAISED' | 'LOWERED' | 'REAFFIRMED'
    indexImpactPoints: number
  }>
}

export interface NasdaqTelemetry {
  nqPrice: number // e.g. 24850.50
  nqChange: number
  nqChangePct: number
  esPrice: number // e.g. 6420.25
  esChangePct: number
  ymPrice: number // e.g. 46500
  ymChangePct: number
  relativeStrengthStance:
    | 'GROWTH_TECH_LEADERSHIP'
    | 'VALUE_DEFENSIVE_LEADERSHIP'
    | 'BROAD_RISK_ON'
    | 'BROAD_LIQUIDATION'
    | 'NEUTRAL'
  us2yNominalYield: number // e.g. 4.88%
  us10yNominalYield: number // e.g. 5.28%
  yieldCurve2s10sSpreadBps: number // 10Y - 2Y in bps
  us10yRealYield: number // e.g. 2.88% (FRED DFII10)
  dxyIndex: number // e.g. 101.92
  dxyChangePct: number
  vixIndex: number // e.g. 15.20
  vxnIndex: number // e.g. 18.40 (Nasdaq-100 implied volatility)
  semiBasketChangePct: number // SOXX / NVDA basket
  topConstituents: NdxConstituentWeight[]
  advanceDeclineRatio: number
  cvdAggressionStance?: 'AGGRESSIVE_BUYING' | 'AGGRESSIVE_SELLING' | 'ABSORPTION' | 'NEUTRAL'
  timestamp: number
  source: string
  updatedAt: string
}

export interface LiveNasdaqHeadline {
  id: string
  eventId?: string // Deduplicated event cluster ID
  headline: string
  source: string
  datetime: number
  url: string | null
  summary: string | null
  isDuplicateCluster?: boolean
  duplicateCount?: number
  indexRelevance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface NasdaqFeedStatus {
  id: string
  name: string
  subtitle: string
  category:
    | 'MACRO_CALENDAR'
    | 'CENTRAL_BANK'
    | 'RATES_ENGINE'
    | 'CME_GLOBEX'
    | 'SEC_EDGAR_EARNINGS'
    | 'INDEX_CONSTITUENTS'
    | 'VOLATILITY_CBOE'
    | 'CFTC'
    | 'NEWS_WIRE'
  status: 'ONLINE' | 'ACTIVE' | 'POLLING' | 'DEGRADED' | 'CONFIG_REQUIRED'
  latency: string
  lastSync: string
  primarySource: string
}

export interface NasdaqEventEvaluation {
  id: string
  timestamp: string
  event: string
  rawText: string
  structuredOutput: StructuredNasdaqEventOutput
  safeguards: {
    noInventedData: boolean
    rateCutNotAutoBullish: boolean
    earningsBeatNotAutoBullish: boolean
    correlationNotCausation: boolean
    noHeadlineOnlyTrade: boolean
    cftcNotRealtimeFlow: boolean
    eventDeduplicated: boolean
  }
}

export interface NasdaqFundamentalDashboardState {
  market: 'CME_NQ'
  analystPersona: 'Nasdaq-100 Macro, Earnings and Market-Flow Analyst'
  updatedAt: string
  overallBias: NasdaqDirectionalStance
  overallConfidence: number
  biasSummary: string
  nasdaqTelemetry: NasdaqTelemetry
  today: TodaysNasdaqFundamentalState
  drivers: Record<NasdaqDriverId, NasdaqDriverState>
  breadth: NdxBreadthState
  semiCycle: AiSemiCycleState
  earningsCycle: NdxEarningsCycleState
  feeds: NasdaqFeedStatus[]
  recentEvents: NasdaqEventEvaluation[]
  liveHeadlines: LiveNasdaqHeadline[]
}

// ==========================================
// 8. DOW JONES INDUSTRIAL AVERAGE (DOW_AGENT - CME YM)
// ==========================================

export type DowEventCategory =
  | 'MONETARY_POLICY'
  | 'RATES'
  | 'INFLATION'
  | 'LABOR'
  | 'GROWTH'
  | 'MANUFACTURING'
  | 'INDUSTRIAL_ACTIVITY'
  | 'CONSUMER'
  | 'EARNINGS'
  | 'GUIDANCE'
  | 'FINANCIALS'
  | 'CREDIT'
  | 'ENERGY'
  | 'COMMODITY_COSTS'
  | 'USD'
  | 'TRADE_POLICY'
  | 'HEALTHCARE_POLICY'
  | 'REGULATION'
  | 'GEOPOLITICS'
  | 'VOLATILITY'
  | 'POSITIONING'
  | 'BREADTH'
  | 'SECTOR_ROTATION'

export type DowDirectionalStance =
  | 'BULLISH'
  | 'BEARISH'
  | 'MIXED'
  | 'NEUTRAL'
  | 'UNCERTAIN'

export type YieldMoveDriver =
  | 'GROWTH_DRIVEN'
  | 'INFLATION_DRIVEN'
  | 'FED_DRIVEN'
  | 'RISK_OFF'
  | 'UNKNOWN'

export type GrowthInflationQuadrant =
  | 'GROWTH_UP_INFLATION_DOWN' // Sweet spot, bullish YM
  | 'GROWTH_UP_INFLATION_UP' // Solid activity, mixed rates risk
  | 'GROWTH_DOWN_INFLATION_DOWN' // Easing hope vs recession worry
  | 'GROWTH_DOWN_INFLATION_UP' // Stagflation, bearish cyclicals

export interface DowAbnormalBehavior {
  detected: boolean
  type:
    | 'BULLISH_RELATIVE_STRENGTH'
    | 'BEARISH_RELATIVE_WEAKNESS'
    | 'RATES_DIVERGENCE'
    | 'BREADTH_DIVERGENCE'
    | 'CREDIT_DIVERGENCE'
    | 'ROTATION_DIVERGENCE'
    | 'PRICE_WEIGHT_DISTORTION'
    | 'NONE'
  description: string
}

export interface DjiaConstituent {
  symbol: string
  name: string
  sector: string
  price: number
  priceWeightPct: number // price / sum(prices) * 100
  dayChange: number
  dayChangePct: number
  pointContribution: number // dayChange / divisor
  lastEpsSurprise?: string
  forwardGuidance?: 'RAISED' | 'LOWERED' | 'MAINTAINED'
}

export interface DjiaContributionState {
  divisor: number // ~0.151727525
  sumSharePrices: number
  totalDayPointsMove: number
  top1ContributionPct: number
  top3ContributionPct: number
  top5ContributionPct: number
  contributionConcentration: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME'
  equalWeight30ReturnPct: number
  priceWeightedDjiaReturnPct: number
  weightingDivergenceSignal: 'HIGH_PRICED_DOMINATED' | 'BROAD_CONSTITUENT_RALLY' | 'BALANCED'
}

export interface DowRotationState {
  ymChangePct: number
  esChangePct: number
  nqChangePct: number
  rtyChangePct: number
  rotationRegime:
    | 'CYCLICAL_VALUE_OUTPERFORMANCE'
    | 'TECH_GROWTH_OUTPERFORMANCE'
    | 'BROAD_RISK_ON'
    | 'BROAD_RISK_OFF'
    | 'DEFENSIVE_HEALTHCARE_CONSUMER'
  leadershipSector: string
  laggingSector: string
  ymVsNqSpreadPct: number
}

export interface DowCreditState {
  hygPrice: number
  hygChangePct: number
  lqdPrice: number
  lqdChangePct: number
  highYieldSpreadBps: number
  investmentGradeSpreadBps: number
  bankSectorChangePct: number
  creditStressRegime: 'HEALTHY_EXPANSION' | 'MILD_COMPRESSION' | 'STRESS_WIDENING' | 'ACUTE_DISLOCATION'
  creditDivergenceAlert: boolean
}

export interface IndustrialCycleState {
  ismManufacturingHeadline: number
  ismNewOrders: number
  ismPricesPaid: number
  ismProduction: number
  durableGoodsMomPct: number
  coreCapitalGoodsOrdersMomPct: number
  cyclePhase: 'EXPANSION' | 'ACCELERATING_DEMAND' | 'CONTRACTION' | 'STAGFLATIONARY_PRESSURE'
}

export interface StructuredDowEventOutput {
  timestamp: string
  market: 'YM'
  event: string
  importance: 'HIGH' | 'MEDIUM' | 'LOW'

  event_analysis: {
    category: DowEventCategory
    expected_direction: DowDirectionalStance
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW'
    surprise: string
    raw_surprise?: number
    standardized_surprise?: number
    estimated_dow_point_impact?: number
    affected_constituents?: string[]
    affected_sectors?: string[]
  }

  transmission: {
    growth_expectations: 'UP' | 'DOWN' | 'FLAT'
    industrial_outlook: 'IMPROVING' | 'DETERIORATING' | 'STEADY'
    us10y: 'UP' | 'DOWN' | 'FLAT'
    yield_move_driver?: YieldMoveDriver
    sector_rotation: 'CYCLICAL' | 'DEFENSIVE' | 'TECH_GROWTH' | 'NEUTRAL'
    credit_conditions?: 'LOOSE' | 'TIGHTENING' | 'STRESSED' | 'STABLE'
  }

  fundamental_state: {
    intraday: DowDirectionalStance
    short_term: DowDirectionalStance
    medium_term: DowDirectionalStance
  }

  fundamental_effect?: {
    intraday: DowDirectionalStance
    short_term: DowDirectionalStance
    medium_term: DowDirectionalStance
  }

  drivers?: Array<{
    factor: string
    actual: number | string
    consensus: number | string | null
    unit: string
    effect: DowDirectionalStance
    standardized_surprise?: number
    point_impact?: number
  }>

  market_response: {
    ym_initial: 'UP' | 'DOWN' | 'FLAT'
    ym_5m: 'UP' | 'DOWN' | 'FLAT'
    ym_15m: 'CONTINUING' | 'REVERSING' | 'RECLAIMING' | 'ACCEPTING' | 'STALLED' | 'UP' | 'DOWN'
    industrials: 'UP' | 'DOWN' | 'FLAT'
    financials: 'UP' | 'DOWN' | 'FLAT'
    nq_relative: 'OUTPERFORMING' | 'UNDERPERFORMING' | 'INLINE'
    confirmation: 'STRONG' | 'MODERATE' | 'WEAK' | 'CONTRADICTED' | 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'REJECTED' | 'INCONCLUSIVE'
  }

  market_confirmation?: {
    cl_5m_return: number // or ym_5m_return %
    ym_points_change?: number
    us2y_bps_change?: number
    us10y_bps_change?: number
    confirmation: 'STRONG' | 'MODERATE' | 'WEAK' | 'CONTRADICTED'
  }

  breadth: {
    advancers: number
    decliners: number
    contribution_concentration: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME'
    top3_contribution_pct?: number
  }

  abnormal_behavior: DowAbnormalBehavior

  confidence: number // 0.0 to 1.0 (e.g. 0.88)
  summary: string // crisp 1-2 sentence institutional summary, no essays
  unified_protocol?: UnifiedAgentProtocolOutput
}

export interface TodaysDowFundamentalState {
  economic_growth: string
  manufacturing: string
  consumer: string
  labor: string
  inflation: string
  fed: string
  us2y: string
  us10y: string
  yield_curve: string
  financial_conditions: string
  credit: string
  industrial_sector: string
  financial_sector: string
  energy: string
  healthcare: string
  consumer_sectors: string
  djia_earnings: string
  forward_guidance: string
  usd: string
  trade_policy: string
  breadth: string
  contribution_concentration: string
  sector_rotation: string
  cftc_positioning: string

  intraday_bias: DowDirectionalStance
  short_term_bias: DowDirectionalStance
  medium_term_bias: DowDirectionalStance

  primary_current_driver: string
  upcoming_catalysts: string
  what_changed_since_yesterday: string
  what_would_invalidate_the_current_interpretation: string
}

export type DowDriverId =
  | 'us_growth_economic_cycle'
  | 'fed_rates'
  | 'industrial_manufacturing'
  | 'dow_earnings_guidance'
  | 'financial_conditions'
  | 'consumer_conditions'
  | 'usd'
  | 'oil_commodity_costs'
  | 'trade_tariff_policy'
  | 'sector_rotation'
  | 'credit_conditions'

export interface DowDriverMetric {
  label: string
  value: string
  change?: string
  trend: 'UP' | 'DOWN' | 'FLAT'
  stance: DowDirectionalStance
}

export interface DowDriverState {
  id: DowDriverId
  name: string
  intradayStars: number // 1 to 5
  longTermStars: number // 1 to 5
  stance: DowDirectionalStance
  transmissionRole: string
  summary: string
  metrics: DowDriverMetric[]
  lastUpdated: string
}

export interface DowTelemetry {
  ymPrice: number // e.g. 46500.00
  ymChange: number
  ymChangePct: number
  contractMultiplier: 5 // $5 per index point
  contractNotionalValue: number // ymPrice * 5
  esPrice: number
  esChangePct: number
  nqPrice: number
  nqChangePct: number
  rtyPrice: number
  rtyChangePct: number
  us2yNominalYield: number
  us10yNominalYield: number
  yieldCurve2s10sSpreadBps: number
  yieldMoveDriver: YieldMoveDriver
  growthInflationQuadrant: GrowthInflationQuadrant
  dxyIndex: number
  dxyChangePct: number
  oilWtiPrice: number
  oilWtiChangePct: number
  vixIndex: number
  advancersCount: number // out of 30
  declinersCount: number
  unchangedCount: number
  dowDivisor: number
  topConstituentsByWeight: DjiaConstituent[]
  cvdAggressionStance?: 'AGGRESSIVE_BUYING' | 'AGGRESSIVE_SELLING' | 'ABSORPTION' | 'NEUTRAL'
  timestamp: number
  source: string
  updatedAt: string
}

export interface LiveDowHeadline {
  id: string
  eventId?: string
  headline: string
  source: string
  datetime: number
  url: string | null
  summary: string | null
  isDuplicateCluster?: boolean
  duplicateCount?: number
  indexRelevance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  affectedSymbols?: string[]
}

export interface DowFeedStatus {
  id: string
  name: string
  subtitle: string
  category:
    | 'MACRO_CALENDAR'
    | 'CENTRAL_BANK'
    | 'RATES_ENGINE'
    | 'CME_GLOBEX'
    | 'SEC_EDGAR_EARNINGS'
    | 'PRICE_WEIGHTS_DIVISOR'
    | 'CREDIT_MARKETS'
    | 'SECTOR_ROTATION'
    | 'CFTC'
    | 'NEWS_WIRE'
  status: 'ONLINE' | 'ACTIVE' | 'POLLING' | 'DEGRADED' | 'CONFIG_REQUIRED'
  latency: string
  lastSync: string
  primarySource: string
}

export interface DowEventEvaluation {
  id: string
  timestamp: string
  event: string
  rawText: string
  structuredOutput: StructuredDowEventOutput
  safeguards: {
    noInventedData: boolean
    priceWeightingNotCapWeighting: boolean
    strongDataNotAutoBullish: boolean
    ratesUpNotAutoBearish: boolean
    dollarMoveEvaluatedNotOnlyPercent: boolean
    cftcNotRealtimeFlow: boolean
    eventDeduplicated: boolean
  }
}

export interface DowFundamentalDashboardState {
  market: 'CME_YM'
  analystPersona: 'Dow Jones Macro, Cyclical Economy, Earnings and Rotation Analyst'
  updatedAt: string
  overallBias: DowDirectionalStance
  overallConfidence: number
  biasSummary: string
  dowTelemetry: DowTelemetry
  today: TodaysDowFundamentalState
  contribution: DjiaContributionState
  rotation: DowRotationState
  credit: DowCreditState
  industrial: IndustrialCycleState
  drivers: Record<DowDriverId, DowDriverState>
  feeds: DowFeedStatus[]
  recentEvents: DowEventEvaluation[]
  liveHeadlines: LiveDowHeadline[]
}

// ============================================================================
// 9. NIKKEI 225 FUNDAMENTAL ANALYST DOMAIN TYPES (NIKKEI_AGENT - CME NKD)
// ============================================================================

export type NikkeiEventCategory =
  | 'BOJ_MONETARY_POLICY'
  | 'FX_USD_JPY'
  | 'TECH_SEMICONDUCTORS'
  | 'DOMESTIC_MACRO'
  | 'EARNINGS_EXPORTERS'
  | 'GEOPOLITICS_TRADE'
  | 'GLOBAL_EQUITY_SPILLOVER'
  | 'MARKET_STRUCTURE'

export type NikkeiDirectionalStance = 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL' | 'UNCERTAIN'

export type BojPolicyStance =
  | 'HAWKISH_HIKE'
  | 'DOVISH_HOLD'
  | 'YCC_EXPANSION'
  | 'INTERVENTION_RISK'
  | 'NORMALIZING'

export type FxRegimeStance =
  | 'YEN_WEAKNESS_EXPORTER_BOOST'
  | 'YEN_STRENGTH_HEADWIND'
  | 'INTERVENTION_ALERT'
  | 'FX_STABLE'

export interface NikkeiConstituent {
  symbol: string
  name: string
  priceJpy: number
  weightPct: number
  sector: string
  betaToUsdJpy: number
  pointContributionPer100Yen?: number
}

export interface NikkeiContributionState {
  sumSharePricesJpy: number
  top1ContributionPct: number
  top3ContributionPct: number
  top5ContributionPct: number
  semiconductorSharePct: number
  weightingConcentration: 'HIGH' | 'MODERATE' | 'BALANCED'
  fastRetailingWeightPct: number
  tokyoElectronWeightPct: number
  advantestWeightPct: number
  softbankWeightPct: number
}

export interface NikkeiBojState {
  uncollateralizedCallRatePct: number // policy rate e.g. 0.25%
  jgb10yYieldPct: number // 10Y JGB yield e.g. 0.95%
  yccStatus: 'FLEXIBLE_CEILING' | 'STRICT_PEG' | 'ABANDONED_NORMALIZED'
  etfPurchasePace: 'PHASING_OUT' | 'CEASED' | 'ACTIVE'
  policyStance: BojPolicyStance
  nextMeetingDate: string
  summary: string
}

export interface NikkeiFxState {
  usdjpyRate: number // e.g. 152.40
  usdjpyChangePct: number
  fxRegime: FxRegimeStance
  mofInterventionZone: boolean
  implicationForNikkei: string
}

export interface NikkeiAbnormalBehavior {
  detected: boolean
  type:
    | 'YEN_DIVERGENCE'
    | 'SEMICONDUCTOR_DECOUPLING'
    | 'BOJ_ABSORPTION'
    | 'OVERNIGHT_GAP_FADE'
    | 'PRICE_WEIGHT_DISTORTION'
    | 'NONE'
  explanation: string
}

export interface StructuredNikkeiEventOutput {
  event: string
  category: NikkeiEventCategory
  importance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  confidence: number // 0-100
  market_stance: {
    intraday: NikkeiDirectionalStance
    short_term: NikkeiDirectionalStance
    medium_term: NikkeiDirectionalStance
  }
  transmission_channels: {
    boj_policy_impact: 'HAWKISH_TIGHTENING' | 'DOVISH_EASING' | 'NEUTRAL'
    fx_pass_through: 'BULLISH_EXPORTERS' | 'BEARISH_EXPORTERS' | 'NEUTRAL'
    tech_semiconductor_effect: 'RALLY' | 'DRAG' | 'NEUTRAL'
    domestic_growth_effect: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
  }
  market_reaction: {
    nkd_initial_reaction: 'UP' | 'DOWN' | 'FLAT'
    nkd_5m_continuation: 'CONTINUING' | 'REVERSING' | 'STALLED'
    usdjpy_reaction: 'UP' | 'DOWN' | 'FLAT'
    jgb10y_reaction: 'UP' | 'DOWN' | 'FLAT'
  }
  abnormal_behavior: NikkeiAbnormalBehavior
  estimated_nkd_point_impact?: number
  summary: string
  actionable_takeaway: string
}

export interface TodaysNikkeiFundamentalState {
  market: 'CME_NKD'
  intraday_bias: NikkeiDirectionalStance
  short_term_bias: NikkeiDirectionalStance
  medium_term_bias: NikkeiDirectionalStance
  boj_policy_stance: BojPolicyStance
  fx_regime: FxRegimeStance
  semiconductor_tailwind: 'STRONG' | 'MODERATE' | 'NEUTRAL' | 'HEADWIND'
  domestic_macro_growth: string
  inflation_wages_shunto: string
  foreign_investor_flow: 'HEAVY_INFLOW' | 'MODERATE_BUYING' | 'NEUTRAL' | 'OUTFLOW'
  us_overnight_lead: 'STRONG_BULLISH' | 'MILD_BULLISH' | 'FLAT' | 'MILD_BEARISH' | 'STRONG_BEARISH'
  tokyo_cash_session_bias: string
  key_risks: string[]
  top_catalysts: string[]
  summary_narrative: string
  updated_at: string
}

export type NikkeiDriverId =
  | 'boj_monetary_policy'
  | 'usdjpy_fx_flow'
  | 'tokyo_electron_semis'
  | 'fast_retailing_retail'
  | 'global_risk_us_spillover'
  | 'japan_wage_inflation_shunto'
  | 'foreign_investor_inflows'

export interface NikkeiDriverMetric {
  name: string
  currentValue: string | number
  priorValue: string | number
  unit: string
  trend: 'UP' | 'DOWN' | 'FLAT'
  stance: NikkeiDirectionalStance
  description: string
}

export interface NikkeiDriverState {
  id: NikkeiDriverId
  name: string
  subtitle: string
  category: 'MONETARY' | 'CURRENCY' | 'TECH' | 'PRICE_WEIGHTED' | 'GLOBAL' | 'MACRO' | 'FLOWS'
  intradayStars: number // 1 to 5
  longTermStars: number // 1 to 5
  stance: NikkeiDirectionalStance
  transmissionRole: string
  summary: string
  metrics: NikkeiDriverMetric[]
  lastUpdated: string
}

export interface NikkeiTelemetry {
  nkdPrice: number // e.g. 38900.00
  nkdChange: number
  nkdChangePct: number
  contractMultiplier: 5 // $5 per index point for NKD
  contractNotionalValue: number // nkdPrice * 5
  usdjpyRate: number // e.g. 152.45
  usdjpyChangePct: number
  jgb10yNominalYield: number // e.g. 0.95%
  jgb10yChangeBps: number
  soxIndex: number // Philadelphia Semiconductor Index
  soxChangePct: number
  nqPrice: number
  nqChangePct: number
  topixPrice: number
  topixChangePct: number
  advancersCount: number // out of 225
  declinersCount: number
  unchangedCount: number
  nikkeiDivisor: number
  topConstituentsByWeight: NikkeiConstituent[]
  tokyoCashSessionActive: boolean
  tokyoSessionPhase: 'PREP' | 'MORNING_CASH' | 'LUNCH_BREAK' | 'AFTERNOON_CASH' | 'CLOSED'
  timestamp: number
  source: string
  updatedAt: string
}

export interface LiveNikkeiHeadline {
  id: string
  eventId?: string
  headline: string
  source: string
  datetime: number
  url: string | null
  summary: string | null
  isDuplicateCluster?: boolean
  duplicateCount?: number
  indexRelevance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  affectedSymbols?: string[]
}

export interface NikkeiFeedStatus {
  id: string
  name: string
  subtitle: string
  category:
    | 'BOJ_POLICY'
    | 'FX_MARKETS'
    | 'SEMICONDUCTOR_CHAIN'
    | 'CME_GLOBEX'
    | 'TSE_JPX_CASH'
    | 'PRICE_WEIGHTS_DIVISOR'
    | 'MACRO_JAPAN'
    | 'FOREIGN_FLOWS'
    | 'NEWS_WIRE'
  status: 'ONLINE' | 'ACTIVE' | 'POLLING' | 'DEGRADED' | 'CONFIG_REQUIRED'
  latency: string
  lastSync: string
  primarySource: string
}

export interface NikkeiEventEvaluation {
  id: string
  timestamp: string
  event: string
  rawText: string
  structuredOutput: StructuredNikkeiEventOutput
  safeguards: {
    noInventedData: boolean
    priceWeightingNotCapWeighting: boolean
    yenSensitivityEvaluated: boolean
    bojHikeNotAutoBearish: boolean
    semiconductorTransmissionChecked: boolean
    tokyoCashVsOvernightDistinguished: boolean
    eventDeduplicated: boolean
  }
}

export interface NikkeiFundamentalDashboardState {
  market: 'CME_NKD'
  analystPersona: 'Nikkei 225 Macro, BoJ Monetary Policy, FX Pass-Through & Global Tech Analyst'
  updatedAt: string
  overallBias: NikkeiDirectionalStance
  overallConfidence: number
  biasSummary: string
  nikkeiTelemetry: NikkeiTelemetry
  today: TodaysNikkeiFundamentalState
  contribution: NikkeiContributionState
  boj: NikkeiBojState
  fx: NikkeiFxState
  drivers: Record<NikkeiDriverId, NikkeiDriverState>
  feeds: NikkeiFeedStatus[]
  recentEvents: NikkeiEventEvaluation[]
  liveHeadlines: LiveNikkeiHeadline[]
}



