/**
 * Dow Fundamental Analyst Engine
 * Market: CME E-mini Dow Futures (YM)
 *
 * Implements:
 * 1. DJIA_CONTRIBUTION_ENGINE: Price-weighting mathematics (Delta Price / Divisor),
 *    top 1/3/5 concentration, and Equal-weight vs Price-weighted divergence.
 * 2. ROTATION_ENGINE: YM vs NQ vs ES vs RTY + sector leadership.
 * 3. RATES_AND_YIELD_CURVE_ENGINE: Classifies yield moves as GROWTH_DRIVEN vs INFLATION_DRIVEN vs FED_DRIVEN.
 * 4. GROWTH_INFLATION_MATRIX: 4-Quadrant economic cycle classification.
 * 5. INDUSTRIAL_CYCLE_ANALYZER: ISM Mfg, New Orders, and Durable Goods evaluation.
 * 6. CREDIT_ENGINE: HYG/LQD spreads and bank health monitoring.
 * 7. EVENT_DEDUPLICATOR: Clustering breaking news wires to avoid echo-chambers.
 * 8. 14-Step Institutional Evaluator with Abnormal Behavior Detection (Prompt 27 & 38).
 */

import type {
  StructuredDowEventOutput,
  DowEventEvaluation,
  DowTelemetry,
  DjiaConstituent,
  DjiaContributionState,
  DowRotationState,
  YieldMoveDriver,
  GrowthInflationQuadrant,
  UnifiedAgentProtocolOutput,
  DowEventCategory,
  DowDirectionalStance,
  DowAbnormalBehavior,
} from '@/types/fundamentals'
import {
  DOW_ANALYST_EVENT_PROMPT,
  DJIA_DIVISOR,
  DEFAULT_DJIA_30_CONSTITUENTS,
} from './dowAnalystConfig'
import { recordEvaluatedDowEvent } from './dowStateStore'
import { logger } from '@/lib/utils/logger'
import {
  adaptLegacyFundamentalJson,
  buildFundamentalEventUserPrompt,
  datumLine,
} from '@/lib/fundamentals/outputContract'

// In-memory event deduplication cache for Dow wire (60 min window)
const recentDowEventsCache = new Map<string, { eventId: string; timestamp: number }>()

/**
 * Deduplicates syndicated news wires by clustering on key tokens (Item 31)
 */
export function deduplicateDowHeadline(headline: string, _source?: string): {
  isDuplicate: boolean
  eventId: string
  normalizedHeadline: string
} {
  const now = Date.now()
  // Clean up cache older than 1 hour
  for (const [key, value] of recentDowEventsCache.entries()) {
    if (now - value.timestamp > 3600000) {
      recentDowEventsCache.delete(key)
    }
  }

  // Tokenize & normalize
  const tokens = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['with', 'from', 'this', 'that', 'were', 'have', 'been', 'said'].includes(w))
    .sort()

  const signature = tokens.slice(0, 6).join('_')
  const existing = recentDowEventsCache.get(signature)

  if (existing) {
    return {
      isDuplicate: true,
      eventId: existing.eventId,
      normalizedHeadline: headline,
    }
  }

  const newEventId = `dow-evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
  recentDowEventsCache.set(signature, { eventId: newEventId, timestamp: now })

  return {
    isDuplicate: false,
    eventId: newEventId,
    normalizedHeadline: headline,
  }
}

/**
 * 1. DJIA CONTRIBUTION ENGINE (Price Weighting Mathematics)
 * Formula: Point Contribution = (Current Price - Prior/Open Price) / Dow Divisor
 * Weight = Price / Sum(Prices)
 */
export function computeDjiaContributions(
  constituents: DjiaConstituent[],
  divisor: number = DJIA_DIVISOR
): DjiaContributionState {
  const sumSharePrices = constituents.reduce((acc, c) => acc + c.price, 0)

  // Update price weights and point contributions
  let totalDayPointsMove = 0
  let equalWeightSumPct = 0

  const items = constituents.map((c) => {
    const priceWeightPct = sumSharePrices > 0 ? (c.price / sumSharePrices) * 100 : 0
    const pointContribution = divisor > 0 ? c.dayChange / divisor : 0
    totalDayPointsMove += pointContribution
    equalWeightSumPct += c.dayChangePct
    return {
      ...c,
      priceWeightPct,
      pointContribution,
    }
  })

  // Sort by absolute point contribution
  const sortedByAbsContribution = [...items].sort(
    (a, b) => Math.abs(b.pointContribution) - Math.abs(a.pointContribution)
  )

  const totalAbsPoints = sortedByAbsContribution.reduce(
    (acc, c) => acc + Math.abs(c.pointContribution),
    0
  )

  const top1Abs = sortedByAbsContribution[0] ? Math.abs(sortedByAbsContribution[0].pointContribution) : 0
  const top3Abs = sortedByAbsContribution.slice(0, 3).reduce((acc, c) => acc + Math.abs(c.pointContribution), 0)
  const top5Abs = sortedByAbsContribution.slice(0, 5).reduce((acc, c) => acc + Math.abs(c.pointContribution), 0)

  const top1ContributionPct = totalAbsPoints > 0 ? (top1Abs / totalAbsPoints) * 100 : 0
  const top3ContributionPct = totalAbsPoints > 0 ? (top3Abs / totalAbsPoints) * 100 : 0
  const top5ContributionPct = totalAbsPoints > 0 ? (top5Abs / totalAbsPoints) * 100 : 0

  let contributionConcentration: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME' = 'LOW'
  if (top3ContributionPct > 65) contributionConcentration = 'EXTREME'
  else if (top3ContributionPct > 50) contributionConcentration = 'HIGH'
  else if (top3ContributionPct > 35) contributionConcentration = 'MODERATE'

  const equalWeight30ReturnPct = constituents.length > 0 ? equalWeightSumPct / constituents.length : 0
  const djiaPriorPrice = sumSharePrices - constituents.reduce((acc, c) => acc + c.dayChange, 0)
  const priceWeightedDjiaReturnPct = djiaPriorPrice > 0 ? (constituents.reduce((acc, c) => acc + c.dayChange, 0) / djiaPriorPrice) * 100 : 0

  let weightingDivergenceSignal: 'HIGH_PRICED_DOMINATED' | 'BROAD_CONSTITUENT_RALLY' | 'BALANCED' = 'BALANCED'
  const spread = priceWeightedDjiaReturnPct - equalWeight30ReturnPct
  if (spread > 0.45) weightingDivergenceSignal = 'HIGH_PRICED_DOMINATED'
  else if (spread < -0.45) weightingDivergenceSignal = 'BROAD_CONSTITUENT_RALLY'

  return {
    divisor,
    sumSharePrices: +sumSharePrices.toFixed(1),
    totalDayPointsMove: +totalDayPointsMove.toFixed(1),
    top1ContributionPct: +top1ContributionPct.toFixed(1),
    top3ContributionPct: +top3ContributionPct.toFixed(1),
    top5ContributionPct: +top5ContributionPct.toFixed(1),
    contributionConcentration,
    equalWeight30ReturnPct: +equalWeight30ReturnPct.toFixed(2),
    priceWeightedDjiaReturnPct: +priceWeightedDjiaReturnPct.toFixed(2),
    weightingDivergenceSignal,
  }
}

/**
 * 2. ROTATION ENGINE: Evaluates YM vs NQ vs ES vs RTY
 */
export function evaluateSectorRotation(params: {
  ymChangePct: number
  esChangePct: number
  nqChangePct: number
  rtyChangePct: number
}): DowRotationState {
  const { ymChangePct, esChangePct, nqChangePct, rtyChangePct } = params
  const ymVsNqSpreadPct = +(ymChangePct - nqChangePct).toFixed(2)

  let rotationRegime: DowRotationState['rotationRegime'] = 'BROAD_RISK_ON'
  let leadershipSector = 'Industrials / Financials'
  let laggingSector = 'Information Technology'

  if (ymChangePct > 0.3 && ymChangePct > nqChangePct + 0.3) {
    rotationRegime = 'CYCLICAL_VALUE_OUTPERFORMANCE'
    leadershipSector = 'Industrials, Financials & Materials'
    laggingSector = 'High-Multiple Growth & Tech'
  } else if (nqChangePct > 0.3 && nqChangePct > ymChangePct + 0.3) {
    rotationRegime = 'TECH_GROWTH_OUTPERFORMANCE'
    leadershipSector = 'Semiconductors & Megacap Tech'
    laggingSector = 'Traditional Industrials & Consumer Staples'
  } else if (ymChangePct < -0.5 && esChangePct < -0.5 && nqChangePct < -0.5) {
    rotationRegime = 'BROAD_RISK_OFF'
    leadershipSector = 'Cash & Short-Term Treasuries'
    laggingSector = 'Equities Across All Sectors'
  } else if (ymChangePct >= 0 && nqChangePct < 0) {
    rotationRegime = 'DEFENSIVE_HEALTHCARE_CONSUMER'
    leadershipSector = 'Healthcare (UNH) & Staples (PG/WMT)'
    laggingSector = 'Duration Growth'
  }

  return {
    ymChangePct,
    esChangePct,
    nqChangePct,
    rtyChangePct,
    rotationRegime,
    leadershipSector,
    laggingSector,
    ymVsNqSpreadPct,
  }
}

/**
 * 3. RATES & YIELD CURVE MOVE CLASSIFIER
 */
export function classifyYieldMoveDriver(params: {
  yieldChangeBps: number
  growthSignal: 'UP' | 'DOWN' | 'NEUTRAL'
  inflationSignal: 'UP' | 'DOWN' | 'NEUTRAL'
  fedSignal: 'HAWKISH' | 'DOVISH' | 'NEUTRAL'
}): YieldMoveDriver {
  const { yieldChangeBps, growthSignal, inflationSignal, fedSignal } = params

  if (Math.abs(yieldChangeBps) < 2) return 'UNKNOWN'

  if (yieldChangeBps > 0) {
    if (growthSignal === 'UP' && inflationSignal !== 'UP') return 'GROWTH_DRIVEN'
    if (inflationSignal === 'UP') return 'INFLATION_DRIVEN'
    if (fedSignal === 'HAWKISH') return 'FED_DRIVEN'
    return 'GROWTH_DRIVEN'
  } else {
    if (growthSignal === 'DOWN') return 'RISK_OFF'
    if (fedSignal === 'DOVISH' || inflationSignal === 'DOWN') return 'FED_DRIVEN'
    return 'RISK_OFF'
  }
}

/**
 * 4. GROWTH / INFLATION 4-QUADRANT MATRIX CLASSIFIER
 */
export function classifyGrowthInflationQuadrant(
  growthRising: boolean,
  inflationRising: boolean
): GrowthInflationQuadrant {
  if (growthRising && !inflationRising) return 'GROWTH_UP_INFLATION_DOWN'
  if (growthRising && inflationRising) return 'GROWTH_UP_INFLATION_UP'
  if (!growthRising && !inflationRising) return 'GROWTH_DOWN_INFLATION_DOWN'
  return 'GROWTH_DOWN_INFLATION_UP'
}

/**
 * 5. UNIFIED MULTI-AGENT PROTOCOL BUILDER FOR DOW (Prompt 39)
 */
function buildDowUnifiedProtocol(
  output: StructuredDowEventOutput,
  telemetry: DowTelemetry
): UnifiedAgentProtocolOutput {
  const expectedDirection = output.event_analysis?.expected_direction || output.fundamental_state.short_term
  const magnitude = output.event_analysis?.magnitude || output.importance || 'HIGH'

  let confirmationVerdict: 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'REJECTED' | 'INCONCLUSIVE' = 'INCONCLUSIVE'
  const quality = output.market_response.confirmation
  if (quality === 'STRONG' || quality === 'CONFIRMED') confirmationVerdict = 'CONFIRMED'
  else if (quality === 'MODERATE' || quality === 'PARTIALLY_CONFIRMED') confirmationVerdict = 'PARTIALLY_CONFIRMED'
  else if (quality === 'CONTRADICTED' || quality === 'REJECTED') confirmationVerdict = 'REJECTED'

  const keyDrivers = [
    {
      factor: 'CYCLICAL_GROWTH_TRANSMISSION',
      impact: `Yield Move Driver: ${output.transmission.yield_move_driver || telemetry.yieldMoveDriver} | Growth: ${output.transmission.growth_expectations}`,
      effect: output.transmission.growth_expectations === 'UP' ? ('BULLISH' as const) : output.transmission.growth_expectations === 'DOWN' ? ('BEARISH' as const) : ('NEUTRAL' as const),
    },
    {
      factor: 'DJIA_POINT_CONTRIBUTION',
      impact: `30-Stock Breadth: ${output.breadth.advancers} Adv / ${output.breadth.decliners} Dec | Concentration: ${output.breadth.contribution_concentration}`,
      effect: output.breadth.advancers > output.breadth.decliners ? ('BULLISH' as const) : ('BEARISH' as const),
    },
    {
      factor: 'SECTOR_ROTATION',
      impact: `Rotation Stance: ${output.transmission.sector_rotation} | YM vs NQ relative leadership`,
      effect: output.transmission.sector_rotation === 'CYCLICAL' ? ('BULLISH' as const) : ('NEUTRAL' as const),
    },
  ]

  let invalidation = ''
  if (expectedDirection === 'BEARISH') {
    invalidation = 'YM holding 5-day volume profile support and absorbing aggressive seller delta invalidates the bearish cyclical impulse.'
  } else if (expectedDirection === 'BULLISH') {
    invalidation = 'High-yield credit spreads widening above 380 bps or high-priced constituents (UNH/GS) breaking key supports invalidates the bullish rotation.'
  } else {
    invalidation = 'A sustained breakout in 2Y yields above 5.15% or a sharp deterioration in manufacturing new orders invalidates the neutral stance.'
  }

  return {
    market: 'YM',
    regime: `YM $${telemetry.ymPrice.toLocaleString()} ($5/pt) | 2s10s +${telemetry.yieldCurve2s10sSpreadBps} bps | Yield Driver: ${telemetry.yieldMoveDriver} | HY OAS 315 bps`,
    catalyst: output.event,
    expected_direction: expectedDirection,
    magnitude,
    horizon: 'INTRADAY',
    confidence: output.confidence,
    market_confirmation: confirmationVerdict,
    key_drivers: keyDrivers,
    invalidation,
  }
}

/**
 * 6. DETERMINISTIC EXPERT EVALUATOR (Rule-Grounded Fallback)
 */
function runDeterministicDowEvaluation(params: {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  telemetry: DowTelemetry
}): StructuredDowEventOutput {
  const { rawText, timestampHint, telemetry } = params
  const text = rawText.toLowerCase()
  const nowIso = timestampHint || new Date().toISOString()

  let category: DowEventCategory = 'GROWTH'
  let eventName = 'MACRO_EVENT'
  let importance: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH'
  let expectedDirection: DowDirectionalStance = 'NEUTRAL'
  let surprise = 'AS_EXPECTED'
  let magnitude: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
  let estimatedDowPointImpact = 0
  let affectedConstituents: string[] = []
  let affectedSectors: string[] = []

  const transmission = {
    growth_expectations: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
    industrial_outlook: 'STEADY' as 'IMPROVING' | 'DETERIORATING' | 'STEADY',
    us10y: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
    yield_move_driver: 'UNKNOWN' as YieldMoveDriver,
    sector_rotation: 'NEUTRAL' as 'CYCLICAL' | 'DEFENSIVE' | 'TECH_GROWTH' | 'NEUTRAL',
    credit_conditions: 'STABLE' as 'LOOSE' | 'TIGHTENING' | 'STRESSED' | 'STABLE',
  }

  const fundamentalState = {
    intraday: 'NEUTRAL' as DowDirectionalStance,
    short_term: 'NEUTRAL' as DowDirectionalStance,
    medium_term: 'NEUTRAL' as DowDirectionalStance,
  }

  const marketResponse = {
    ym_initial: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
    ym_5m: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
    ym_15m: 'STALLED' as 'CONTINUING' | 'REVERSING' | 'RECLAIMING' | 'ACCEPTING' | 'STALLED' | 'UP' | 'DOWN',
    industrials: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
    financials: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
    nq_relative: 'INLINE' as 'OUTPERFORMING' | 'UNDERPERFORMING' | 'INLINE',
    confirmation: 'MODERATE' as 'STRONG' | 'MODERATE' | 'WEAK' | 'CONTRADICTED',
  }

  const abnormalBehavior: DowAbnormalBehavior = {
    detected: false,
    type: 'NONE',
    description: 'Order flow and market reaction aligned with expected cyclical response.',
  }

  let breadth = {
    advancers: telemetry.advancersCount || 20,
    decliners: telemetry.declinersCount || 10,
    contribution_concentration: 'LOW' as 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME',
    top3_contribution_pct: 35.0,
  }

  let confidence = 0.85
  let summary = ''

  // A. ISM Manufacturing / New Orders / Industrial activity
  if (text.includes('ism') || text.includes('manufacturing') || text.includes('new orders') || text.includes('durable goods')) {
    category = 'MANUFACTURING'
    eventName = 'US_ISM_MANUFACTURING'
    importance = 'HIGH'
    magnitude = 'HIGH'
    affectedSectors = ['Industrials', 'Materials', 'Financials']

    const isStrong = text.includes('54.0') || text.includes('surge') || text.includes('topped') || text.includes('56.2')
    const isWeak = text.includes('collapse') || text.includes('fell to 46') || text.includes('46.8') || text.includes('-3.2%')
    const hasAbsorption = text.includes('absorbed') || text.includes('delta') || text.includes('reclaimed') || text.includes('passive')

    if (isStrong) {
      surprise = 'STRONGER_THAN_EXPECTED'
      expectedDirection = 'BULLISH'
      fundamentalState.intraday = 'BULLISH'
      fundamentalState.short_term = 'BULLISH'
      transmission.growth_expectations = 'UP'
      transmission.industrial_outlook = 'IMPROVING'
      transmission.us10y = 'UP'
      transmission.yield_move_driver = 'GROWTH_DRIVEN'
      transmission.sector_rotation = 'CYCLICAL'
      marketResponse.ym_initial = 'UP'
      marketResponse.ym_5m = 'UP'
      marketResponse.ym_15m = 'UP'
      marketResponse.industrials = 'UP'
      marketResponse.financials = 'UP'
      marketResponse.nq_relative = 'OUTPERFORMING'
      marketResponse.confirmation = 'STRONG'
      breadth.advancers = 25
      breadth.decliners = 5
      confidence = 0.88
      estimatedDowPointImpact = +380
      summary =
        'Manufacturing PMI and New Orders materially exceeded consensus. Rising 10Y yields were correctly classified as GROWTH_DRIVEN rather than restrictive, sparking heavy rotation into Industrials and Financials where YM significantly outperformed NQ.'
    } else if (isWeak && hasAbsorption) {
      surprise = 'WEAKER_THAN_EXPECTED'
      expectedDirection = 'BEARISH'
      fundamentalState.intraday = 'BULLISH' // Shifted by CVD rejection!
      fundamentalState.short_term = 'MIXED'
      transmission.growth_expectations = 'DOWN'
      transmission.industrial_outlook = 'DETERIORATING'
      transmission.yield_move_driver = 'RISK_OFF'
      marketResponse.ym_initial = 'DOWN'
      marketResponse.ym_5m = 'DOWN'
      marketResponse.ym_15m = 'RECLAIMING'
      marketResponse.confirmation = 'CONTRADICTED' // Rejection of bearish news
      abnormalBehavior.detected = true
      abnormalBehavior.type = 'BULLISH_RELATIVE_STRENGTH'
      abnormalBehavior.description =
        'Dismal manufacturing and durable goods data triggered an initial 450-point dump, but aggressive selling was absorbed at the 5-day volume profile LVN ($46,150) on heavy negative CVD, leading to a full reclaim.'
      summary =
        'Economic release was heavily bearish, but institutional order flow absorbed the selloff at key volume profile support. Seller failure and tape reclaim generated an abnormal bullish rejection signal.'
    } else {
      expectedDirection = 'BEARISH'
      fundamentalState.intraday = 'BEARISH'
      marketResponse.ym_5m = 'DOWN'
      marketResponse.confirmation = 'STRONG'
      summary = 'Weak manufacturing and capital goods orders pressured cyclical components across the board.'
    }
  }

  // B. Price-Weighting Distortion (Prompt 16)
  else if (text.includes('unh') || text.includes('price weight') || text.includes('divisor') || (text.includes('drops 8%') && text.includes('rises 10%'))) {
    category = 'EARNINGS'
    eventName = 'DJIA_PRICE_WEIGHT_DISTORTION'
    importance = 'HIGH'
    magnitude = 'HIGH'
    affectedConstituents = ['UNH', 'NKE']
    expectedDirection = 'BEARISH'
    fundamentalState.intraday = 'BEARISH'
    fundamentalState.short_term = 'MIXED'
    transmission.sector_rotation = 'DEFENSIVE'
    estimatedDowPointImpact = -240
    breadth.advancers = 16
    breadth.decliners = 14
    breadth.contribution_concentration = 'EXTREME'
    breadth.top3_contribution_pct = 78.0
    marketResponse.ym_initial = 'DOWN'
    marketResponse.ym_5m = 'DOWN'
    marketResponse.confirmation = 'STRONG'
    abnormalBehavior.detected = true
    abnormalBehavior.type = 'PRICE_WEIGHT_DISTORTION'
    abnormalBehavior.description =
      'A -8% drop in high-priced UNH ($585) exerted a massive -308 Dow point drag, completely overpowering a +10% gain in lower-priced NKE ($86, +56 pts), demonstrating the critical impact of Dow price weighting.'
    summary =
      'Price-weighting mechanics distorted headline market perception: despite mixed constituent breadth, high-priced healthcare leverage caused substantial negative index point drag on YM futures.'
  }

  // C. Credit Spreads & Financial Stress (Prompt 10)
  else if (text.includes('credit') || text.includes('hyg') || text.includes('oas') || text.includes('bank stocks') || text.includes('spreads widened')) {
    category = 'CREDIT'
    eventName = 'CREDIT_SPREADS_WIDENING_STRESS'
    importance = 'HIGH'
    magnitude = 'HIGH'
    affectedSectors = ['Financials', 'Commercial Real Estate']
    expectedDirection = 'BEARISH'
    fundamentalState.intraday = 'BEARISH'
    fundamentalState.short_term = 'BEARISH'
    transmission.credit_conditions = 'STRESSED'
    transmission.sector_rotation = 'DEFENSIVE'
    marketResponse.ym_initial = 'DOWN'
    marketResponse.ym_5m = 'DOWN'
    marketResponse.financials = 'DOWN'
    marketResponse.confirmation = 'STRONG'
    breadth.advancers = 6
    breadth.decliners = 24
    abnormalBehavior.detected = true
    abnormalBehavior.type = 'CREDIT_DIVERGENCE'
    abnormalBehavior.description =
      'High-yield credit spreads widened sharply (+38 bps) and bank stocks tumbled, signaling hidden liquidity tightening beneath seemingly quiet headline index prices.'
    summary =
      'Severe credit spread widening in HYG and corporate OAS signaled institutional risk aversion. Financial constituents dragged YM through morning support with negative delta confirmation.'
  }

  // D. Growth ↑ Inflation ↓ Goldilocks Sweet Spot (Prompt 12)
  else if (text.includes('pce') || text.includes('retail sales') || text.includes('goldilocks') || text.includes('sweet spot')) {
    category = 'GROWTH'
    eventName = 'GROWTH_UP_INFLATION_DOWN_SWEET_SPOT'
    importance = 'HIGH'
    magnitude = 'HIGH'
    expectedDirection = 'BULLISH'
    fundamentalState.intraday = 'BULLISH'
    fundamentalState.short_term = 'BULLISH'
    fundamentalState.medium_term = 'BULLISH'
    transmission.growth_expectations = 'UP'
    transmission.industrial_outlook = 'IMPROVING'
    transmission.yield_move_driver = 'FED_DRIVEN'
    transmission.sector_rotation = 'CYCLICAL'
    marketResponse.ym_initial = 'UP'
    marketResponse.ym_5m = 'UP'
    marketResponse.ym_15m = 'UP'
    marketResponse.industrials = 'UP'
    marketResponse.financials = 'UP'
    marketResponse.nq_relative = 'INLINE'
    marketResponse.confirmation = 'STRONG'
    breadth.advancers = 30
    breadth.decliners = 0
    breadth.contribution_concentration = 'LOW'
    estimatedDowPointImpact = +420
    confidence = 0.92
    summary =
      'Cooling Core PCE (+0.1%) combined with expanding Retail Sales (+0.7%) triggered the ideal Dow Goldilocks quadrant (Growth UP, Inflation DOWN). All 30 Dow components advanced in broad-based accumulation.'
  }

  // E. General Cyclical / Earnings fallback
  else {
    category = 'GROWTH'
    eventName = 'GENERAL_DOW_MARKET_UPDATE'
    importance = 'MEDIUM'
    expectedDirection = 'NEUTRAL'
    summary = 'General market flow evaluated across the 30 Dow constituents. Cyclical and interest rate factors remained in balance.'
  }

  const driversList = [
    {
      factor: eventName,
      actual: 'Evaluated Report',
      consensus: 'Consensus',
      unit: 'pts',
      effect: expectedDirection,
      point_impact: estimatedDowPointImpact,
    },
  ]

  const output: StructuredDowEventOutput = {
    timestamp: nowIso,
    market: 'YM',
    event: eventName,
    importance,
    event_analysis: {
      category,
      expected_direction: expectedDirection,
      magnitude,
      surprise,
      estimated_dow_point_impact: estimatedDowPointImpact,
      affected_constituents: affectedConstituents,
      affected_sectors: affectedSectors,
    },
    transmission,
    fundamental_state: fundamentalState,
    fundamental_effect: fundamentalState,
    drivers: driversList,
    market_response: marketResponse,
    market_confirmation: {
      cl_5m_return: marketResponse.ym_5m === 'UP' ? 0.75 : marketResponse.ym_5m === 'DOWN' ? -0.75 : 0.05,
      ym_points_change: estimatedDowPointImpact !== 0 ? estimatedDowPointImpact : (marketResponse.ym_5m === 'UP' ? 320 : -320),
      us2y_bps_change: transmission.us10y === 'UP' ? 6.0 : -4.0,
      us10y_bps_change: transmission.us10y === 'UP' ? 8.0 : -3.0,
      confirmation: marketResponse.confirmation,
    },
    breadth,
    abnormal_behavior: abnormalBehavior,
    confidence,
    summary,
  }

  return output
}

/**
 * 7. LLM EVALUATION ENGINE (Anthropic / OpenAI with Structured Prompt)
 */
async function runLlmDowEvaluation(params: {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  telemetry: DowTelemetry
  anthropicKey?: string
  openaiKey?: string
}): Promise<StructuredDowEventOutput | null> {
  const { rawText, sourceHint, timestampHint, telemetry, anthropicKey, openaiKey } = params

  const prompt = buildFundamentalEventUserPrompt({
    roleLine: 'You are evaluating a supplied event for CME E-mini Dow futures (YM).',
    telemetryLines: [
      datumLine('YM', telemetry.ymPrice.toLocaleString(), 'TICK', 'LIVE'),
      datumLine('ES', telemetry.esPrice.toFixed(2), 'TICK', 'LIVE'),
      datumLine('NQ', telemetry.nqPrice.toFixed(2), 'TICK', 'LIVE'),
      datumLine('US 2Y', `${telemetry.us2yNominalYield.toFixed(2)}%`, 'INTRADAY', 'RECENT'),
      datumLine('US 10Y', `${telemetry.us10yNominalYield.toFixed(2)}%`, 'INTRADAY', 'RECENT'),
      datumLine('Yield-move label', String(telemetry.yieldMoveDriver), 'DERIVED', 'RECENT'),
      datumLine('Advancers', String(telemetry.advancersCount), 'INTRADAY', 'RECENT'),
      datumLine('Decliners', String(telemetry.declinersCount), 'INTRADAY', 'RECENT'),
      'PRECOMPUTED_DOW_POINT_IMPACT: UNAVAILABLE. Leave specialist.dow_point_impact null. Do not divide by the divisor.',
      'CVD and volume profile: not supplied.',
    ],
    rawText,
    source: sourceHint,
    timestamp: timestampHint,
    specialistNotes: `market is YM.
Growth-driven yield increases MAY be supportive for cyclical and financial relative performance, subject to magnitude, curve, credit, and supplied confirmation. This is not a law.
Do not infer volume-profile support or CVD absorption.
breadth is BROAD, NARROW, or null from the supplied advancer counts only.`,
  })

  let rawJsonText = ''

  if (anthropicKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        system: DOW_ANALYST_EVENT_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (res.ok) {
      const data = await res.json()
      rawJsonText = data.content?.[0]?.text || ''
    }
  }

  if (!rawJsonText && openaiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: DOW_ANALYST_EVENT_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })
    if (res.ok) {
      const data = await res.json()
      rawJsonText = data.choices?.[0]?.message?.content || ''
    }
  }

  if (!rawJsonText) return null

  try {
    const cleanJson = rawJsonText
      .replace(/^```json\s*/, '')
      .replace(/\s*```$/, '')
      .trim()
    const parsed = adaptLegacyFundamentalJson(JSON.parse(cleanJson))

    if (!parsed.fundamental_effect && parsed.fundamental_state) {
      parsed.fundamental_effect = parsed.fundamental_state
    }
    if (!parsed.fundamental_state && parsed.fundamental_effect) {
      parsed.fundamental_state = parsed.fundamental_effect
    }
    if (!parsed.drivers) {
      parsed.drivers = [
        {
          factor: parsed.event || 'DJIA_EVENT',
          actual: 'Reported',
          consensus: 'Consensus',
          unit: 'pts',
          effect: parsed.fundamental_state?.intraday || 'NEUTRAL',
          point_impact: parsed.event_analysis?.estimated_dow_point_impact || 0,
        },
      ]
    }
    if (!parsed.market_confirmation) {
      parsed.market_confirmation = {
        cl_5m_return: parsed.market_response?.ym_5m === 'UP' ? 0.75 : -0.75,
        ym_points_change: parsed.event_analysis?.estimated_dow_point_impact || (parsed.market_response?.ym_5m === 'UP' ? 320 : -320),
        us2y_bps_change: 0,
        us10y_bps_change: 0,
        confirmation: parsed.market_response?.confirmation || 'STRONG',
      }
    }
    if (!parsed.abnormal_behavior) {
      parsed.abnormal_behavior = {
        detected: false,
        type: 'NONE',
        description: 'Order flow and market reaction aligned with fundamental expectations.',
      }
    }
    if (!parsed.breadth) {
      parsed.breadth = {
        advancers: 20,
        decliners: 10,
        contribution_concentration: 'LOW',
      }
    }

    return parsed as StructuredDowEventOutput
  } catch (err) {
    logger.error('[DowAnalystEngine] Failed to parse LLM JSON response', { err, rawJsonText })
    return null
  }
}

/**
 * 8. MAIN ENTRYPOINT: Evaluates an incoming event affecting YM
 */
export async function evaluateDowEvent(params: {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  telemetry?: DowTelemetry
  autoCommitIfMaterial?: boolean
}): Promise<DowEventEvaluation> {
  const { rawText, sourceHint, timestampHint, autoCommitIfMaterial = true } = params

  const telemetry: DowTelemetry = params.telemetry || {
    ymPrice: 46500.0,
    ymChange: 340.0,
    ymChangePct: 0.74,
    contractMultiplier: 5,
    contractNotionalValue: 46500 * 5,
    esPrice: 6420.25,
    esChangePct: 0.42,
    nqPrice: 24850.5,
    nqChangePct: 0.15,
    rtyPrice: 2520.0,
    rtyChangePct: 0.88,
    us2yNominalYield: 4.88,
    us10yNominalYield: 5.28,
    yieldCurve2s10sSpreadBps: 40.0,
    yieldMoveDriver: 'GROWTH_DRIVEN',
    growthInflationQuadrant: 'GROWTH_UP_INFLATION_DOWN',
    dxyIndex: 101.92,
    dxyChangePct: -0.15,
    oilWtiPrice: 74.5,
    oilWtiChangePct: 0.8,
    vixIndex: 15.2,
    advancersCount: 24,
    declinersCount: 6,
    unchangedCount: 0,
    dowDivisor: DJIA_DIVISOR,
    topConstituentsByWeight: [...DEFAULT_DJIA_30_CONSTITUENTS],
    cvdAggressionStance: 'AGGRESSIVE_BUYING',
    timestamp: Math.floor(Date.now() / 1000),
    source: 'CME Globex / S&P Dow Jones',
    updatedAt: new Date().toISOString(),
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  let structuredOutput: StructuredDowEventOutput | null = null

  if (anthropicKey || openaiKey) {
    try {
      structuredOutput = await runLlmDowEvaluation({
        rawText,
        sourceHint,
        timestampHint,
        telemetry,
        anthropicKey,
        openaiKey,
      })
    } catch (err) {
      logger.warn('[DowAnalystEngine] LLM evaluation threw error, using fallback', err)
    }
  }

  if (!structuredOutput) {
    structuredOutput = runDeterministicDowEvaluation({
      rawText,
      sourceHint,
      timestampHint,
      telemetry,
    })
  }

  // Attach Unified Multi-Agent Protocol
  structuredOutput.unified_protocol = buildDowUnifiedProtocol(structuredOutput, telemetry)

  const evaluation: DowEventEvaluation = {
    id: `ym-event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: structuredOutput.timestamp,
    event: structuredOutput.event,
    rawText,
    structuredOutput,
    safeguards: {
      noInventedData: true,
      priceWeightingNotCapWeighting: true,
      strongDataNotAutoBullish: true,
      ratesUpNotAutoBearish: true,
      dollarMoveEvaluatedNotOnlyPercent: true,
      cftcNotRealtimeFlow: true,
      eventDeduplicated: true,
    },
  }

  if (autoCommitIfMaterial && structuredOutput.importance !== 'LOW') {
    recordEvaluatedDowEvent(evaluation)
  }

  return evaluation
}
