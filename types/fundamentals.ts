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
  volume?: number
  timestamp: number
  source: string
  updatedAt: string
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
}
