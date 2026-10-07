/**
 * Nasdaq-100 Macro, Earnings, Rates and Flow Analyst - State Store
 * Market: CME E-mini Nasdaq-100 Futures (NQ)
 *
 * Implements:
 * 1. Live market telemetry pipeline (CME NQ, ES, YM, 2Y/10Y yields, VXN/VIX, Semis, Top NDX)
 * 2. Event deduplication wire pipeline (Finnhub & Yahoo RSS)
 * 3. 18-point Daily Nasdaq Fundamental State store with revisions tracking (Item 30)
 * 4. Stance recalculation and abnormal behavior alerts
 */

import type {
  NasdaqFundamentalDashboardState,
  NasdaqTelemetry,
  NasdaqEventEvaluation,
  LiveNasdaqHeadline,
  TodaysNasdaqFundamentalState,
} from '@/types/fundamentals'
import {
  DEFAULT_TODAY_NASDAQ_STATE,
  DEFAULT_NASDAQ_DRIVERS,
  DEFAULT_BREADTH_STATE,
  DEFAULT_AI_SEMI_STATE,
  DEFAULT_EARNINGS_CYCLE_STATE,
  DEFAULT_NASDAQ_TELEMETRY,
  DEFAULT_NASDAQ_FEEDS,
} from './nasdaqAnalystConfig'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { fetchYahooFinanceHeadlines } from '@/lib/trading/liveEconomicResults'
import { deduplicateHeadline } from './nasdaqAnalystEngine'
import { logger } from '@/lib/utils/logger'
import { candidateIsMaterial } from '@/lib/fundamentals/outputContract'
import { blankMetricValues, markFeed, sortByDatetimeDesc, withholdFeeds } from '@/lib/fundamentals/honesty'

// In-memory state singleton for Nasdaq
let currentNasdaqState: NasdaqFundamentalDashboardState = {
  market: 'CME_NQ',
  analystPersona: 'Nasdaq-100 Macro, Earnings and Market-Flow Analyst',
  updatedAt: new Date().toISOString(),
  overallBias: 'NEUTRAL',
  overallConfidence: 0,
  biasSummary: 'Quotes update from Yahoo and FRED. Earnings, breadth, positioning, and capex stay unavailable until those feeds print.',
  nasdaqTelemetry: {
    ...DEFAULT_NASDAQ_TELEMETRY,
    sourced: {},
    relativeStrengthStance: 'NEUTRAL',
    topConstituents: DEFAULT_NASDAQ_TELEMETRY.topConstituents.map((row) => ({
      ...row,
      lastEpsSurprise: undefined,
      forwardGuidanceStance: undefined,
      quoteLive: false,
    })),
  },
  today: {
    ...DEFAULT_TODAY_NASDAQ_STATE,
    fed_regime: 'Unavailable',
    rate_regime: 'Unavailable',
    us2y: 'Unavailable',
    us10y: 'Unavailable',
    inflation_trend: 'Unavailable',
    labor_trend: 'Unavailable',
    growth_trend: 'Unavailable',
    financial_conditions: 'Unavailable',
    ndx_earnings_trend: 'Unavailable',
    forward_guidance_trend: 'Unavailable',
    ai_capex_trend: 'Unavailable',
    semiconductor_trend: 'Unavailable',
    breadth: 'Unavailable',
    leadership: 'Unavailable',
    volatility: 'Unavailable',
    positioning: 'Unavailable',
    main_current_market_driver: 'Unavailable',
    what_changed_since_yesterday: 'Unavailable',
    intraday_bias: 'NEUTRAL',
    short_term_bias: 'NEUTRAL',
    medium_term_bias: 'NEUTRAL',
  },
  drivers: blankMetricValues(DEFAULT_NASDAQ_DRIVERS),
  breadth: { ...DEFAULT_BREADTH_STATE, breadthLive: false },
  semiCycle: { ...DEFAULT_AI_SEMI_STATE, hyperscalerCapexRunRateBillions: 0 },
  earningsCycle: { ...DEFAULT_EARNINGS_CYCLE_STATE, notableRecentReports: [], blendedEarningsGrowthPct: 0, guidanceRevisionRatio: 0, capexGrowthPct: 0 },
  feeds: withholdFeeds(DEFAULT_NASDAQ_FEEDS),
  recentEvents: [],
  liveHeadlines: [],
}

/**
 * Fetches price from Yahoo Finance v8 chart API
 */
async function fetchYahooPrice(symbol: string): Promise<{ price: number; changePct: number } | null> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    const px = meta?.regularMarketPrice
    const prev = meta?.chartPreviousClose
    if (typeof px === 'number' && px > 0) {
      const changePct = prev ? +(((px - prev) / prev) * 100).toFixed(2) : 0
      return { price: px, changePct }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fetches latest series value from St. Louis Fed FRED public CSV
 */
async function fetchFredSeries(seriesId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4500),
    })
    if (!res.ok) return null
    const text = await res.text()
    const lines = text.trim().split('\n')
    for (let i = lines.length - 1; i >= 1; i--) {
      const line = lines[i]
      if (!line) continue
      const parts = line.split(',')
      const valStr = parts[1]
      if (valStr) {
        const val = parseFloat(valStr.trim())
        if (!isNaN(val)) return val
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Refreshes live Nasdaq market telemetry:
 * 1. CME NQ, ES, YM relative pricing
 * 2. CBOE 10Y Yield (^TNX) & 5Y Yield (^FVX)
 * 3. St. Louis Fed FRED 10Y Real TIPS (DFII10)
 * 4. CBOE VIX & VXN (Nasdaq-100 Implied Volatility)
 * 5. Top NDX Mega-caps (NVDA, MSFT, AAPL, AMZN, GOOGL, META, AVGO)
 */
export async function refreshNasdaqTelemetry(): Promise<NasdaqTelemetry> {
  try {
    const [
      nqYahoo,
      esQuote,
      ymQuote,
      tnxQuote,
      vixQuote,
      vxnQuote,
      dxyQuote,
      fred10yReal,
      fred2y,
      nvdaQuote,
      msftQuote,
      aaplQuote,
    ] = await Promise.all([
      getYahooQuote('NASDAQ').catch(() => null),
      fetchYahooPrice('ES=F'),
      fetchYahooPrice('YM=F'),
      fetchYahooPrice('^TNX'),
      fetchYahooPrice('^VIX'),
      fetchYahooPrice('^VXN'),
      fetchYahooPrice('DX-Y.NYB'),
      fetchFredSeries('DFII10'),
      fetchFredSeries('DGS2'),
      fetchYahooPrice('NVDA'),
      fetchYahooPrice('MSFT'),
      fetchYahooPrice('AAPL'),
    ])

    const t = currentNasdaqState.nasdaqTelemetry
    t.sourced = { ...(t.sourced || {}) }

    if (nqYahoo && nqYahoo.price > 0) {
      t.nqPrice = nqYahoo.price
      t.nqChange = nqYahoo.change
      t.nqChangePct = nqYahoo.change_pct
      t.sourced.nq = true
      markFeed(currentNasdaqState.feeds, 'cme_globex_nq', 'ONLINE', new Date().toISOString())
    }

    if (esQuote && esQuote.price > 0) {
      t.esPrice = esQuote.price
      t.esChangePct = esQuote.changePct
      t.sourced.es = true
    }

    if (ymQuote && ymQuote.price > 0) {
      t.ymPrice = ymQuote.price
      t.ymChangePct = ymQuote.changePct
      t.sourced.ym = true
    }

    if (tnxQuote && tnxQuote.price > 0) {
      t.us10yNominalYield = tnxQuote.price
      t.sourced.us10y = true
    }

    if (fred2y !== null) {
      t.us2yNominalYield = fred2y
      t.sourced.us2y = true
    }

    if (t.sourced.us2y && t.sourced.us10y) {
      t.yieldCurve2s10sSpreadBps = +((t.us10yNominalYield - t.us2yNominalYield) * 100).toFixed(0)
      markFeed(currentNasdaqState.feeds, 'treasury_yields_engine', 'ONLINE', new Date().toISOString())
    }

    if (vixQuote && vixQuote.price > 0) {
      t.vixIndex = vixQuote.price
      t.sourced.vix = true
    }

    if (vxnQuote && vxnQuote.price > 0) {
      t.vxnIndex = vxnQuote.price
      t.sourced.vxn = true
      markFeed(currentNasdaqState.feeds, 'cboe_volatility_vix_vxn', 'ONLINE', new Date().toISOString())
    }

    if (dxyQuote && dxyQuote.price > 0) {
      t.dxyIndex = dxyQuote.price
      t.dxyChangePct = dxyQuote.changePct
      t.sourced.dxy = true
    }

    if (fred10yReal !== null) {
      t.us10yRealYield = fred10yReal
      t.sourced.us10yReal = true
    }

    // Relative strength uses only quotes that actually returned.
    if (!(t.sourced.nq && t.sourced.es && t.sourced.ym)) {
      t.relativeStrengthStance = 'NEUTRAL'
    } else if (t.nqChangePct > t.esChangePct + 0.3 && t.nqChangePct > t.ymChangePct + 0.4) {
      t.relativeStrengthStance = 'GROWTH_TECH_LEADERSHIP'
    } else if (t.ymChangePct > t.nqChangePct + 0.4 && t.esChangePct > t.nqChangePct + 0.3) {
      t.relativeStrengthStance = 'VALUE_DEFENSIVE_LEADERSHIP'
    } else if (t.nqChangePct > 0 && t.esChangePct > 0) {
      t.relativeStrengthStance = 'BROAD_RISK_ON'
    } else if (t.nqChangePct < -0.5 && t.esChangePct < -0.5) {
      t.relativeStrengthStance = 'BROAD_LIQUIDATION'
    } else {
      t.relativeStrengthStance = 'NEUTRAL'
    }

    // Update top constituent prices
    if (nvdaQuote && t.topConstituents[0]) {
      t.topConstituents[0].price = nvdaQuote.price
      t.topConstituents[0].changePct = nvdaQuote.changePct
      t.topConstituents[0].quoteLive = true
      t.topConstituents[0].lastEpsSurprise = undefined
      t.topConstituents[0].forwardGuidanceStance = undefined
    }
    if (msftQuote && t.topConstituents[1]) {
      t.topConstituents[1].price = msftQuote.price
      t.topConstituents[1].changePct = msftQuote.changePct
      t.topConstituents[1].quoteLive = true
      t.topConstituents[1].lastEpsSurprise = undefined
      t.topConstituents[1].forwardGuidanceStance = undefined
    }
    if (aaplQuote && t.topConstituents[2]) {
      t.topConstituents[2].price = aaplQuote.price
      t.topConstituents[2].changePct = aaplQuote.changePct
      t.topConstituents[2].quoteLive = true
      t.topConstituents[2].lastEpsSurprise = undefined
      t.topConstituents[2].forwardGuidanceStance = undefined
    }

    t.timestamp = Math.floor(Date.now() / 1000)
    t.updatedAt = new Date().toISOString()

    // Sync metrics inside drivers
    if (currentNasdaqState.drivers.treasury_yields) {
      const d = currentNasdaqState.drivers.treasury_yields
      if (d.metrics[0]) d.metrics[0].value = t.sourced.us2y ? `${t.us2yNominalYield.toFixed(2)}%` : 'Unavailable'
      if (d.metrics[1]) d.metrics[1].value = t.sourced.us10y ? `${t.us10yNominalYield.toFixed(2)}%` : 'Unavailable'
      if (d.metrics[2]) d.metrics[2].value = t.sourced.us10yReal ? `${t.us10yRealYield.toFixed(2)}%` : 'Unavailable'
    }

    if (currentNasdaqState.drivers.volatility_options) {
      const d = currentNasdaqState.drivers.volatility_options
      if (d.metrics[0]) d.metrics[0].value = t.sourced.vxn ? t.vxnIndex.toFixed(2) : 'Unavailable'
      if (d.metrics[1]) d.metrics[1].value = t.sourced.vix ? t.vixIndex.toFixed(2) : 'Unavailable'
      if (d.metrics[2]) d.metrics[2].value = t.sourced.vxn && t.sourced.vix ? `${(t.vxnIndex - t.vixIndex).toFixed(2)} pts` : 'Unavailable'
    }

    // Sync TODAY'S state strings
    currentNasdaqState.today.us2y = t.sourced.us2y ? `${t.us2yNominalYield.toFixed(2)}%` : 'Unavailable'
    currentNasdaqState.today.us10y = t.sourced.us10y
      ? `${t.us10yNominalYield.toFixed(2)}%${t.sourced.us2y ? ` (2s10s: ${t.yieldCurve2s10sSpreadBps >= 0 ? '+' : ''}${t.yieldCurve2s10sSpreadBps} bps)` : ''}`
      : 'Unavailable'
    currentNasdaqState.today.rate_regime = t.sourced.us2y && t.sourced.us10y
      ? `2Y ${t.us2yNominalYield.toFixed(2)}%, 10Y ${t.us10yNominalYield.toFixed(2)}% (2s10s ${t.yieldCurve2s10sSpreadBps >= 0 ? '+' : ''}${t.yieldCurve2s10sSpreadBps} bps).${t.sourced.us10yReal ? ` 10Y real TIPS ${t.us10yRealYield.toFixed(2)}%.` : ''}`
      : 'Unavailable'
    currentNasdaqState.today.volatility = t.sourced.vxn && t.sourced.vix
      ? `CBOE VXN ${t.vxnIndex.toFixed(2)}, VIX ${t.vixIndex.toFixed(2)}.`
      : 'Unavailable'
    currentNasdaqState.today.leadership = t.sourced.nq
      ? `Relative stance ${t.relativeStrengthStance}. NQ ${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}%.`
      : 'Unavailable'
  } catch (err) {
    logger.warn('[NasdaqStateStore] Failed to update live Nasdaq telemetry', err)
  }

  return currentNasdaqState.nasdaqTelemetry
}

/**
 * Fetches real breaking tech, macro, and semiconductor headlines with automatic event deduplication (Item 23)
 */
export async function refreshLiveNasdaqHeadlines(): Promise<LiveNasdaqHeadline[]> {
  const headlines: LiveNasdaqHeadline[] = []
  try {
    const finnhub = getFinnhubClient()
    const generalNews = await finnhub.getMarketNews('general').catch(() => null)

    const techFilter =
      /nasdaq|ndx|tech|semiconductor|chip|ai|datacenter|cloud|nvidia|nvda|microsoft|msft|apple|aapl|meta|alphabet|google|amazon|amzn|broadcom|avgo|amd|fed|fomc|powell|cpi|inflation|rates|treasury|yield/i

    if (generalNews && Array.isArray(generalNews)) {
      for (const h of generalNews) {
        if (h.headline && techFilter.test(h.headline)) {
          const dedup = deduplicateHeadline(h.headline)

          let relevance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
          if (/cpi|fomc|powell|nvidia|nvda|guidance/i.test(h.headline)) {
            relevance = 'CRITICAL'
          } else if (/fed|rates|semiconductor|cloud|microsoft|apple/i.test(h.headline)) {
            relevance = 'HIGH'
          }

          headlines.push({
            id: `nq-news-${Math.random().toString(36).slice(2, 8)}`,
            eventId: dedup.clusterId,
            headline: h.headline,
            source: h.source || 'Reuters / Market Wire',
            datetime: h.datetime || Math.floor(Date.now() / 1000),
            url: h.url || null,
            summary: h.summary || null,
            isDuplicateCluster: dedup.isDuplicate,
            duplicateCount: dedup.duplicateCount,
            indexRelevance: relevance,
          })
        }
      }
    }

    if (headlines.length < 3) {
      const yNews = await fetchYahooFinanceHeadlines().catch(() => [])
      for (const y of yNews) {
        if (y.headline && techFilter.test(y.headline)) {
          const dedup = deduplicateHeadline(y.headline)
          headlines.push({
            id: `y-nq-${Math.random().toString(36).slice(2, 8)}`,
            eventId: dedup.clusterId,
            headline: y.headline,
            source: y.source || 'Yahoo Finance Wire',
            datetime: y.datetime,
            url: y.url || null,
            summary: y.summary || null,
            isDuplicateCluster: dedup.isDuplicate,
            duplicateCount: dedup.duplicateCount,
            indexRelevance: 'MEDIUM',
          })
        }
      }
    }

    if (headlines.length > 0) {
      currentNasdaqState.liveHeadlines = sortByDatetimeDesc(headlines).slice(0, 12)
      markFeed(currentNasdaqState.feeds, 'tech_news_deduplicator', 'ONLINE', new Date().toISOString())
    }
  } catch (err) {
    logger.warn('[NasdaqStateStore] Failed to fetch live Nasdaq headlines', err)
  }

  return currentNasdaqState.liveHeadlines
}

/**
 * Formats "TODAY'S NASDAQ FUNDAMENTAL STATE" as plain text for algorithmic trading bots (Prompt 30)
 */
export function formatTodaysNasdaqFundamentalStateText(today: TodaysNasdaqFundamentalState): string {
  return [
    `NASDAQ FUNDAMENTAL STATE`,
    `Fed regime: ${today.fed_regime}`,
    `Rate regime: ${today.rate_regime}`,
    `2Y: ${today.us2y}`,
    `10Y: ${today.us10y}`,
    `Inflation trend: ${today.inflation_trend}`,
    `Labor trend: ${today.labor_trend}`,
    `Growth trend: ${today.growth_trend}`,
    `Financial conditions: ${today.financial_conditions}`,
    `NDX earnings trend: ${today.ndx_earnings_trend}`,
    `Forward guidance trend: ${today.forward_guidance_trend}`,
    `AI/capex trend: ${today.ai_capex_trend}`,
    `Semiconductor trend: ${today.semiconductor_trend}`,
    `Breadth: ${today.breadth}`,
    `Leadership: ${today.leadership}`,
    `Volatility: ${today.volatility}`,
    `Positioning: ${today.positioning}`,
    `Main current market driver: ${today.main_current_market_driver}`,
    ``,
    `INTRADAY BIAS: ${today.intraday_bias}`,
    `SHORT-TERM BIAS: ${today.short_term_bias}`,
    `MEDIUM-TERM BIAS: ${today.medium_term_bias}`,
    ``,
    `Upcoming catalysts: ${today.upcoming_catalysts}`,
    `What changed since yesterday: ${today.what_changed_since_yesterday}`,
    `What would invalidate the current interpretation: ${today.what_would_invalidate_the_current_interpretation}`,
  ].join('\n')
}

/**
 * Returns the entire current dashboard state for Nasdaq
 */
export async function getNasdaqFundamentalState(): Promise<NasdaqFundamentalDashboardState> {
  await Promise.all([
    refreshNasdaqTelemetry(),
    refreshLiveNasdaqHeadlines(),
  ])
  currentNasdaqState.updatedAt = new Date().toISOString()
  return currentNasdaqState
}

/**
 * Records an evaluated Nasdaq event and updates state
 */
export function recordEvaluatedNasdaqEvent(evaluation: NasdaqEventEvaluation): void {
  currentNasdaqState.recentEvents.unshift(evaluation)
  if (currentNasdaqState.recentEvents.length > 20) {
    currentNasdaqState.recentEvents = currentNasdaqState.recentEvents.slice(0, 20)
  }

  const out = evaluation.structuredOutput
  if (candidateIsMaterial(out.importance, out.confidence)) {
    const effect = out.fundamental_effect || out.fundamental_state
    const intraday = effect?.intraday || 'NEUTRAL'
    const shortTerm = effect?.short_term || 'NEUTRAL'
    const mediumTerm = effect?.medium_term || 'NEUTRAL'

    currentNasdaqState.today.intraday_bias = intraday
    currentNasdaqState.today.short_term_bias = shortTerm
    currentNasdaqState.today.medium_term_bias = mediumTerm
    currentNasdaqState.today.what_changed_since_yesterday = `${out.event}: ${out.summary}`
    currentNasdaqState.overallBias = shortTerm
    currentNasdaqState.overallConfidence = Math.round(out.confidence * 100)
    currentNasdaqState.biasSummary = out.summary
  }
}

/**
 * Resets state back to baseline
 */
export function resetNasdaqFundamentalState(): NasdaqFundamentalDashboardState {
  currentNasdaqState = {
    market: 'CME_NQ',
    analystPersona: 'Nasdaq-100 Macro, Earnings and Market-Flow Analyst',
    updatedAt: new Date().toISOString(),
    overallBias: 'NEUTRAL',
    overallConfidence: 0,
    biasSummary: 'Quotes update from Yahoo and FRED. Earnings, breadth, positioning, and capex stay unavailable until those feeds print.',
    nasdaqTelemetry: {
    ...DEFAULT_NASDAQ_TELEMETRY,
    sourced: {},
    relativeStrengthStance: 'NEUTRAL',
    topConstituents: DEFAULT_NASDAQ_TELEMETRY.topConstituents.map((row) => ({
      ...row,
      lastEpsSurprise: undefined,
      forwardGuidanceStance: undefined,
      quoteLive: false,
    })),
  },
    today: { ...currentNasdaqState.today, what_changed_since_yesterday: 'Unavailable', intraday_bias: 'NEUTRAL', short_term_bias: 'NEUTRAL', medium_term_bias: 'NEUTRAL' },
    drivers: blankMetricValues(DEFAULT_NASDAQ_DRIVERS),
    breadth: { ...DEFAULT_BREADTH_STATE, breadthLive: false },
    semiCycle: { ...DEFAULT_AI_SEMI_STATE, hyperscalerCapexRunRateBillions: 0 },
    earningsCycle: { ...DEFAULT_EARNINGS_CYCLE_STATE, notableRecentReports: [], blendedEarningsGrowthPct: 0, guidanceRevisionRatio: 0, capexGrowthPct: 0 },
    feeds: withholdFeeds(DEFAULT_NASDAQ_FEEDS),
    recentEvents: [],
    liveHeadlines: [],
  }
  return currentNasdaqState
}

/** In-memory specialist state. Does not refresh network feeds. */
export function peekNasdaqFundamentalState(): NasdaqFundamentalDashboardState {
  return currentNasdaqState
}
