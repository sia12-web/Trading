/**
 * Oil Fundamental State Store
 * Maintains the continuously updated picture of the 10 fundamental pillars,
 * "TODAY'S OIL FUNDAMENTAL STATE", the 5 Feeds status,
 * live NYMEX WTI price, Brent-WTI spread, 3:2:1 crack margins,
 * real live Finnhub/Reuters oil wire headlines, and audited event history.
 */

import type {
  OilFundamentalDashboardState,
  OilEventEvaluation,
  FundamentalPillarId,
  FundamentalPillarState,
  WtiTelemetry,
  DirectionalBias,
  TodaysOilFundamentalState,
  LiveOilHeadline,
} from '@/types/fundamentals'
import {
  DEFAULT_PILLARS_STATE,
  DEFAULT_TODAY_FUNDAMENTAL_STATE,
  DEFAULT_FIVE_FEEDS,
  SCHEDULED_OIL_CATALYSTS,
} from './oilAnalystConfig'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { fetchYahooFinanceHeadlines } from '@/lib/trading/liveEconomicResults'
import { logger } from '@/lib/utils/logger'
import { markFeed, sortByDatetimeDesc, withholdFeeds } from '@/lib/fundamentals/honesty'

const UNSOURCED_OIL_TODAY: Partial<TodaysOilFundamentalState> = {
  supply: 'Unavailable',
  demand: 'Unavailable',
  inventories: 'Unavailable',
  opec: 'Unavailable',
  geopolitical_risk: 'Unavailable',
  positioning: 'Unavailable',
  curve: 'M1-M2 calendar spread is unavailable.',
  bias: 'NEUTRAL',
  confidence: 0,
  what_changed_since_yesterday: 'Unavailable',
  what_would_invalidate_this_view: 'A sourced inventory, OPEC, or curve print.',
}

function blankWtiTelemetry(): WtiTelemetry {
  return {
    promptPrice: 0,
    symbol: 'CL=F',
    change: 0,
    changePct: 0,
    high: 0,
    low: 0,
    previousClose: 0,
    promptSpread: null,
    spreadRegime: 'UNKNOWN',
    sourced: {},
    timestamp: Math.floor(Date.now() / 1000),
    source: 'Unavailable until Yahoo quotes return',
    updatedAt: new Date().toISOString(),
  }
}

function blankOilPillars(
  pillars: Record<FundamentalPillarId, FundamentalPillarState>,
): Record<FundamentalPillarId, FundamentalPillarState> {
  const next = { ...pillars }
  for (const id of Object.keys(next) as FundamentalPillarId[]) {
    const pillar = next[id]
    next[id] = {
      ...pillar,
      bias: 'NEUTRAL',
      confidence: 0,
      statusSummary: 'Unavailable. No live print is connected for this pillar.',
      keyTakeaway: 'Unavailable until a sourced print arrives.',
      metrics: pillar.metrics.map((metric) => ({ label: metric.label, value: 'Unavailable' })),
      sourced: false,
    }
  }
  return next
}

// In-memory persistent state for server runtime
let currentState: OilFundamentalDashboardState = {
  market: 'NYMEX_WTI',
  analystPersona: 'Oil Fundamental Analyst',
  updatedAt: new Date().toISOString(),
  overallBias: 'NEUTRAL',
  overallConfidence: 0,
  biasSummary:
    'Live WTI, Brent, and crack quotes update from Yahoo. Inventories, OPEC flows, positioning, and the M1-M2 calendar spread stay unavailable until those feeds print.',
  physicalBalance: 'BALANCED',
  curveSummary: 'M1-M2 calendar spread is unavailable. No curve feed is connected.',
  wtiTelemetry: blankWtiTelemetry(),
  today: { ...DEFAULT_TODAY_FUNDAMENTAL_STATE, ...UNSOURCED_OIL_TODAY },
  fiveFeeds: withholdFeeds(DEFAULT_FIVE_FEEDS),
  pillars: blankOilPillars(DEFAULT_PILLARS_STATE),
  recentEvents: [],
  scheduledCatalysts: [...SCHEDULED_OIL_CATALYSTS],
  liveOilHeadlines: [],
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
 * Fetches live quotes from Yahoo Finance v8 chart API
 */
async function fetchYahooPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const px = json?.chart?.result?.[0]?.meta?.regularMarketPrice
    return typeof px === 'number' && px > 0 ? px : null
  } catch {
    return null
  }
}

/**
 * Fetches live WTI, Brent, RBOB Gasoline, Heating Oil and computes verified market metrics
 */
export async function refreshWtiTelemetry(): Promise<WtiTelemetry> {
  try {
    const [q, brentPx, rbobPx, hoPx] = await Promise.all([
      getYahooQuote('CRUDE').catch(() => null),
      fetchYahooPrice('BZ=F'),
      fetchYahooPrice('RB=F'),
      fetchYahooPrice('HO=F'),
    ])

    if (q && q.price > 0) {
      // Calculate real Brent-WTI spread if Brent is available
      const brentWtiSpread = brentPx ? +(brentPx - q.price).toFixed(2) : undefined

      // Real NYMEX 3:2:1 crack: ((2 * RBOB*42) + (HO*42) - (3 * WTI)) / 3
      let crackSpread321: number | undefined = undefined
      if (rbobPx && hoPx) {
        crackSpread321 = +(((2 * rbobPx * 42) + (hoPx * 42) - (3 * q.price)) / 3).toFixed(2)
      }

      currentState.wtiTelemetry = {
        promptPrice: q.price,
        symbol: 'CL=F',
        change: q.change,
        changePct: q.change_pct,
        high: q.high ?? q.price,
        low: q.low ?? q.price,
        previousClose: q.previous_close,
        promptSpread: null,
        spreadRegime: 'UNKNOWN',
        brentPrice: brentPx ?? undefined,
        brentWtiSpread,
        crackSpread321,
        gasolinePrice: rbobPx ?? undefined,
        heatingOilPrice: hoPx ?? undefined,
        sourced: {
          prompt: true,
          brent: brentPx != null,
          crack: crackSpread321 != null,
        },
        timestamp: q.timestamp || Math.floor(Date.now() / 1000),
        source: 'Yahoo CL=F, BZ=F, RB=F, HO=F',
        updatedAt: new Date().toISOString(),
      }

      const brentNote = brentWtiSpread !== undefined ? ` Brent-WTI: $${brentWtiSpread}/bbl.` : ''
      const crackNote = crackSpread321 !== undefined ? ` 3:2:1 crack: $${crackSpread321.toFixed(2)}/bbl.` : ''
      currentState.today.curve = `M1-M2 calendar spread is unavailable.${brentNote}${crackNote}`
      markFeed(currentState.fiveFeeds, 'cme_databento', 'ONLINE', new Date().toISOString())

      // Update Refinery Crack in Pillar state if calculated
      if (crackSpread321 !== undefined && currentState.pillars.refinery_activity) {
        const crackMetric = currentState.pillars.refinery_activity.metrics.find((m) => m.label.includes('Crack'))
        if (crackMetric) {
          crackMetric.value = `$${crackSpread321.toFixed(2)}`
        }
      }
    }
  } catch (err) {
    logger.warn('[OilStateStore] Failed to update live WTI telemetry', err)
  }
  return currentState.wtiTelemetry
}

/**
 * Fetches real breaking oil news from Finnhub & Yahoo RSS
 */
export async function refreshLiveOilHeadlines(): Promise<LiveOilHeadline[]> {
  const headlines: LiveOilHeadline[] = []
  try {
    const finnhub = getFinnhubClient()
    const generalNews = await finnhub.getMarketNews('general').catch(() => null)

    const oilFilter = /oil|crude|wti|brent|energy|opec|petroleum|gasoline|refiner|tanker|cushing|rigs/i

    if (generalNews && Array.isArray(generalNews)) {
      for (const h of generalNews) {
        if (h.headline && oilFilter.test(h.headline)) {
          headlines.push({
            id: `news-${Math.random().toString(36).slice(2, 8)}`,
            headline: h.headline,
            source: h.source || 'Reuters / Market Wire',
            datetime: h.datetime || Math.floor(Date.now() / 1000),
            url: h.url || null,
            summary: h.summary || null,
          })
        }
      }
    }

    // Fallback to Yahoo RSS if Finnhub returned few results
    if (headlines.length < 3) {
      const yNews = await fetchYahooFinanceHeadlines().catch(() => [])
      for (const y of yNews) {
        if (y.headline && oilFilter.test(y.headline)) {
          headlines.push({
            id: `y-news-${Math.random().toString(36).slice(2, 8)}`,
            headline: y.headline,
            source: y.source || 'Yahoo Finance Wire',
            datetime: y.datetime,
            url: y.url || null,
            summary: y.summary || null,
          })
        }
      }
    }

    if (headlines.length > 0) {
      currentState.liveOilHeadlines = sortByDatetimeDesc(headlines).slice(0, 12)
      markFeed(currentState.fiveFeeds, 'realtime_news', 'ONLINE', new Date().toISOString())
    }
  } catch (err) {
    logger.warn('[OilStateStore] Failed to fetch live oil headlines', err)
  }

  return currentState.liveOilHeadlines
}

/**
 * Returns the entire current dashboard state with live telemetry & news
 */
export async function getOilFundamentalState(): Promise<OilFundamentalDashboardState> {
  await Promise.all([
    refreshWtiTelemetry(),
    refreshLiveOilHeadlines(),
  ])
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
    overallBias: 'NEUTRAL',
    overallConfidence: 0,
    biasSummary:
      'Live WTI, Brent, and crack quotes update from Yahoo. Inventories, OPEC flows, positioning, and the M1-M2 calendar spread stay unavailable until those feeds print.',
    physicalBalance: 'BALANCED',
    curveSummary: 'M1-M2 calendar spread is unavailable. No curve feed is connected.',
    wtiTelemetry: blankWtiTelemetry(),
    today: { ...DEFAULT_TODAY_FUNDAMENTAL_STATE, ...UNSOURCED_OIL_TODAY },
    fiveFeeds: withholdFeeds(DEFAULT_FIVE_FEEDS),
    pillars: blankOilPillars(DEFAULT_PILLARS_STATE),
    recentEvents: [],
    scheduledCatalysts: [...SCHEDULED_OIL_CATALYSTS],
    liveOilHeadlines: [],
  }
  return currentState
}

/** In-memory specialist state. Does not refresh network feeds. */
export function peekOilFundamentalState(): OilFundamentalDashboardState {
  return currentState
}
