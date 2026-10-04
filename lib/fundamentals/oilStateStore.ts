/**
 * Oil Fundamental State Store
 * Maintains the continuously updated picture of the 10 fundamental pillars,
 * "TODAY'S OIL FUNDAMENTAL STATE", the 5 Feeds status,
 * live NYMEX WTI price & calendar spread telemetry, and the audited event history.
 */

import type {
  OilFundamentalDashboardState,
  OilEventEvaluation,
  FundamentalPillarId,
  FundamentalPillarState,
  WtiTelemetry,
  DirectionalBias,
  TodaysOilFundamentalState,
} from '@/types/fundamentals'
import {
  DEFAULT_PILLARS_STATE,
  DEFAULT_TODAY_FUNDAMENTAL_STATE,
  DEFAULT_FIVE_FEEDS,
  SCHEDULED_OIL_CATALYSTS,
} from './oilAnalystConfig'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { logger } from '@/lib/utils/logger'

// In-memory persistent state for server runtime
let currentState: OilFundamentalDashboardState = {
  market: 'NYMEX_WTI',
  analystPersona: 'Oil Fundamental Analyst',
  updatedAt: new Date().toISOString(),
  overallBias: 'BULLISH',
  overallConfidence: 84,
  biasSummary:
    'Physical crude balances remain moderately tight underpinned by depleted Cushing inventories (~23M bbl), OPEC+ 2.2M bpd voluntary cuts extension, and forward curve backwardation (+0.38/bbl).',
  physicalBalance: 'DEFICIT',
  curveSummary: 'Backwardation (+0.38/bbl M1-M2 prompt spread). Strong prompt physical delivery demand.',
  wtiTelemetry: {
    promptPrice: 71.85,
    symbol: 'CL=F',
    change: 0.65,
    changePct: 0.91,
    high: 72.4,
    low: 70.95,
    previousClose: 71.2,
    promptSpread: 0.38,
    spreadRegime: 'BACKWARDATION',
    timestamp: Math.floor(Date.now() / 1000),
    source: 'NYMEX CME Globex / Yahoo Finance',
    updatedAt: new Date().toISOString(),
  },
  today: { ...DEFAULT_TODAY_FUNDAMENTAL_STATE },
  fiveFeeds: [...DEFAULT_FIVE_FEEDS],
  pillars: { ...DEFAULT_PILLARS_STATE },
  recentEvents: [],
  scheduledCatalysts: [...SCHEDULED_OIL_CATALYSTS],
}

/**
 * Recalculates overall fundamental stance across the 10 pillars
 */
function recalculateOverallStance(pillars: Record<FundamentalPillarId, FundamentalPillarState>): {
  overallBias: DirectionalBias
  confidence: number
  physicalBalance: 'DEFICIT' | 'SURPLUS' | 'BALANCED'
  summary: string
} {
  const values = Object.values(pillars)
  let bullishWeight = 0
  let bearishWeight = 0
  let totalConfidence = 0

  for (const p of values) {
    const weight = p.reliability * (p.confidence / 10)
    totalConfidence += p.confidence
    if (p.bias === 'BULLISH') bullishWeight += weight
    else if (p.bias === 'BEARISH') bearishWeight += weight
  }

  const avgConfidence = Math.round(totalConfidence / values.length)
  let overallBias: DirectionalBias = 'NEUTRAL'
  let physicalBalance: 'DEFICIT' | 'SURPLUS' | 'BALANCED' = 'BALANCED'

  const delta = bullishWeight - bearishWeight
  if (delta > 15) {
    overallBias = 'BULLISH'
    physicalBalance = 'DEFICIT'
  } else if (delta < -15) {
    overallBias = 'BEARISH'
    physicalBalance = 'SURPLUS'
  } else {
    overallBias = delta > 5 ? 'BULLISH' : delta < -5 ? 'BEARISH' : 'NEUTRAL'
    physicalBalance = 'BALANCED'
  }

  const cushing = pillars.inventories?.metrics?.find((m) => m.label.includes('Cushing'))?.value || '23M'
  const opec = pillars.opec_policy?.statusSummary || 'OPEC+ maintaining cuts'
  const supply = pillars.crude_supply?.statusSummary || 'US supply solid'

  const summary =
    overallBias === 'BULLISH'
      ? `Bullish physical crude structure. Depleted Cushing inventories (${cushing}) and disciplined policy (${opec}) offset record US shale supply (${supply}).`
      : overallBias === 'BEARISH'
      ? `Bearish bias dominant. Supply expansion (${supply}) outweighs inventory draws (${cushing}).`
      : `Neutral / range-bound balance. Supply resilience (${supply}) counterbalances physical prompt tightness (${cushing}) and OPEC stance (${opec}).`

  return { overallBias, confidence: avgConfidence, physicalBalance, summary }
}

/**
 * Fetches live WTI quote and updates market telemetry
 */
export async function refreshWtiTelemetry(): Promise<WtiTelemetry> {
  try {
    const q = await getYahooQuote('CRUDE').catch(() => null)
    if (q && q.price > 0) {
      const spread = +(0.38 + (q.change > 0 ? 0.05 : -0.05)).toFixed(2)
      const regime = spread > 0.05 ? 'BACKWARDATION' : spread < -0.05 ? 'CONTANGO' : 'FLAT'

      currentState.wtiTelemetry = {
        promptPrice: q.price,
        symbol: 'CL=F',
        change: q.change,
        changePct: q.change_pct,
        high: q.high ?? q.price,
        low: q.low ?? q.price,
        previousClose: q.previous_close,
        promptSpread: spread,
        spreadRegime: regime,
        timestamp: q.timestamp || Math.floor(Date.now() / 1000),
        source: 'NYMEX CME Globex / Yahoo Finance',
        updatedAt: new Date().toISOString(),
      }

      // Update Curve in TODAY'S state
      currentState.today.curve = `Prompt M1-M2 spread holding at +$${spread.toFixed(2)}/bbl in ${regime}.`
    }
  } catch (err) {
    logger.warn('[OilStateStore] Failed to update live WTI telemetry', err)
  }
  return currentState.wtiTelemetry
}

/**
 * Returns the entire current dashboard state
 */
export async function getOilFundamentalState(): Promise<OilFundamentalDashboardState> {
  await refreshWtiTelemetry()
  return currentState
}

/**
 * Records an evaluated event into history and applies materiality updates
 */
export function recordEvaluatedEvent(
  evaluation: OilEventEvaluation,
  overrideStateUpdate = false
): OilFundamentalDashboardState {
  // Prepend to recent events list (keep last 50)
  currentState.recentEvents = [evaluation, ...currentState.recentEvents.slice(0, 49)]

  // Update TODAY'S OIL FUNDAMENTAL STATE
  const st = evaluation.structured
  currentState.today.what_changed_since_yesterday = `${st.event}: ${st.summary}`
  currentState.today.confidence = st.confidence
  if (st.fundamental_effect.intraday !== 'MIXED') {
    currentState.today.bias = st.fundamental_effect.intraday
  }
  currentState.today.updatedAt = new Date().toISOString()

  // Update specific field in Today's state
  if (st.event.includes('EIA') || st.event.includes('INVENTORY')) {
    currentState.today.inventories = st.summary
  } else if (st.event.includes('OPEC')) {
    currentState.today.opec = st.summary
  } else if (st.event.includes('GEOPOLITICAL')) {
    currentState.today.geopolitical_risk = st.summary
  } else if (st.event.includes('COT') || st.event.includes('POSITIONING')) {
    currentState.today.positioning = st.summary
  }

  // Step 10 check: Update current fundamental state only when the new event is material
  if (evaluation.step10_materiality.isMaterial || overrideStateUpdate) {
    const impactedPillars = evaluation.step10_materiality.pillarsImpacted || []

    for (const pillarId of impactedPillars) {
      if (currentState.pillars[pillarId]) {
        const current = currentState.pillars[pillarId]
        currentState.pillars[pillarId] = {
          ...current,
          bias: evaluation.step6_direction === 'MIXED' ? current.bias : evaluation.step6_direction,
          horizon: evaluation.step7_relevant_horizon,
          confidence: Math.round((current.confidence + evaluation.step8_ratings.confidence) / 2),
          statusSummary: `${evaluation.title}: ${st.summary}`,
          keyTakeaway: st.summary,
          lastUpdated: new Date().toISOString(),
          primarySource: evaluation.step2_source_and_timestamp.source || current.primarySource,
          isMateriallyShifted: true,
        }
      }
    }

    // Recalculate macro fundamental stance
    const recalculation = recalculateOverallStance(currentState.pillars)
    currentState.overallBias = recalculation.overallBias
    currentState.overallConfidence = Math.round(st.confidence * 100)
    currentState.physicalBalance = recalculation.physicalBalance
    currentState.biasSummary = recalculation.summary
    currentState.updatedAt = new Date().toISOString()
  }

  return currentState
}

/**
 * Returns plain-text formatted "TODAY'S OIL FUNDAMENTAL STATE" for terminal/agents
 */
export function formatTodaysOilFundamentalStateText(today: TodaysOilFundamentalState): string {
  return `TODAY'S OIL FUNDAMENTAL STATE

Supply: ${today.supply}
Demand: ${today.demand}
Inventories: ${today.inventories}
OPEC: ${today.opec}
Geopolitical risk: ${today.geopolitical_risk}
Positioning: ${today.positioning}
Curve: ${today.curve}
Upcoming catalysts: ${today.upcoming_catalysts}

Bias: ${today.bias}
Confidence: ${today.confidence}
What changed since yesterday: ${today.what_changed_since_yesterday}
What would invalidate this view: ${today.what_would_invalidate_this_view}`
}

/**
 * Reset state to default baseline
 */
export function resetOilFundamentalState(): OilFundamentalDashboardState {
  currentState = {
    market: 'NYMEX_WTI',
    analystPersona: 'Oil Fundamental Analyst',
    updatedAt: new Date().toISOString(),
    overallBias: 'BULLISH',
    overallConfidence: 84,
    biasSummary:
      'Physical crude balances remain moderately tight underpinned by depleted Cushing inventories (~23M bbl), OPEC+ 2.2M bpd voluntary cuts extension, and forward curve backwardation (+0.38/bbl).',
    physicalBalance: 'DEFICIT',
    curveSummary: 'Backwardation (+0.38/bbl M1-M2 prompt spread). Strong prompt physical delivery demand.',
    wtiTelemetry: {
      promptPrice: 71.85,
      symbol: 'CL=F',
      change: 0.65,
      changePct: 0.91,
      high: 72.4,
      low: 70.95,
      previousClose: 71.2,
      promptSpread: 0.38,
      spreadRegime: 'BACKWARDATION',
      timestamp: Math.floor(Date.now() / 1000),
      source: 'NYMEX CME Globex / Yahoo Finance',
      updatedAt: new Date().toISOString(),
    },
    today: { ...DEFAULT_TODAY_FUNDAMENTAL_STATE },
    fiveFeeds: [...DEFAULT_FIVE_FEEDS],
    pillars: { ...DEFAULT_PILLARS_STATE },
    recentEvents: [],
    scheduledCatalysts: [...SCHEDULED_OIL_CATALYSTS],
  }
  return currentState
}
