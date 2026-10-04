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
  market: 'CL' | 'GC' | 'NQ'
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

