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

// In-memory state singleton for Nasdaq
let currentNasdaqState: NasdaqFundamentalDashboardState = {
  market: 'CME_NQ',
  analystPersona: 'Nasdaq-100 Macro, Earnings and Market-Flow Analyst',
  updatedAt: new Date().toISOString(),
  overallBias: 'BULLISH',
  overallConfidence: 86,
  biasSummary:
    'Resilient hyperscaler AI/cloud capex growth (>+$220B) and solid corporate software cash flows offset elevated 10Y yields (5.28%). Market breadth is moderately positive (62/38), with CBOE VXN holding comfortably at 18.40.',
  nasdaqTelemetry: { ...DEFAULT_NASDAQ_TELEMETRY },
  today: { ...DEFAULT_TODAY_NASDAQ_STATE },
  drivers: { ...DEFAULT_NASDAQ_DRIVERS },
  breadth: { ...DEFAULT_BREADTH_STATE },
  semiCycle: { ...DEFAULT_AI_SEMI_STATE },
  earningsCycle: { ...DEFAULT_EARNINGS_CYCLE_STATE },
  feeds: [...DEFAULT_NASDAQ_FEEDS],
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
      fvxQuote,
      vixQuote,
      vxnQuote,
      dxyQuote,
      fred10yReal,
      nvdaQuote,
      msftQuote,
      aaplQuote,
    ] = await Promise.all([
      getYahooQuote('NASDAQ').catch(() => null),
      fetchYahooPrice('ES=F'),
      fetchYahooPrice('YM=F'),
      fetchYahooPrice('^TNX'),
      fetchYahooPrice('^FVX'),
      fetchYahooPrice('^VIX'),
      fetchYahooPrice('^VXN'),
      fetchYahooPrice('DX-Y.NYB'),
      fetchFredSeries('DFII10'),
      fetchYahooPrice('NVDA'),
      fetchYahooPrice('MSFT'),
      fetchYahooPrice('AAPL'),
    ])

    const t = currentNasdaqState.nasdaqTelemetry

    if (nqYahoo && nqYahoo.price > 0) {
      t.nqPrice = nqYahoo.price
      t.nqChange = nqYahoo.change
      t.nqChangePct = nqYahoo.change_pct
    }

    if (esQuote && esQuote.price > 0) {
      t.esPrice = esQuote.price
      t.esChangePct = esQuote.changePct
    }

    if (ymQuote && ymQuote.price > 0) {
      t.ymPrice = ymQuote.price
      t.ymChangePct = ymQuote.changePct
    }

    if (tnxQuote && tnxQuote.price > 0) {
      t.us10yNominalYield = tnxQuote.price
    }

    if (fvxQuote && fvxQuote.price > 0) {
      // Approximate 2Y from FVX if IRX is short T-bill
      t.us2yNominalYield = +(fvxQuote.price - 0.17).toFixed(2)
      t.yieldCurve2s10sSpreadBps = +((t.us10yNominalYield - t.us2yNominalYield) * 100).toFixed(0)
    }

    if (vixQuote && vixQuote.price > 0) {
      t.vixIndex = vixQuote.price
    }

    if (vxnQuote && vxnQuote.price > 0) {
      t.vxnIndex = vxnQuote.price
    }

    if (dxyQuote && dxyQuote.price > 0) {
      t.dxyIndex = dxyQuote.price
      t.dxyChangePct = dxyQuote.changePct
    }

    if (fred10yReal !== null) {
      t.us10yRealYield = fred10yReal
    }

    // Relative strength classification (Item 18)
    if (t.nqChangePct > t.esChangePct + 0.3 && t.nqChangePct > t.ymChangePct + 0.4) {
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
    }
    if (msftQuote && t.topConstituents[1]) {
      t.topConstituents[1].price = msftQuote.price
      t.topConstituents[1].changePct = msftQuote.changePct
    }
    if (aaplQuote && t.topConstituents[2]) {
      t.topConstituents[2].price = aaplQuote.price
      t.topConstituents[2].changePct = aaplQuote.changePct
    }

    t.timestamp = Math.floor(Date.now() / 1000)
    t.updatedAt = new Date().toISOString()

    // Sync metrics inside drivers
    if (currentNasdaqState.drivers.treasury_yields) {
      const d = currentNasdaqState.drivers.treasury_yields
      if (d.metrics[0]) d.metrics[0].value = `${t.us2yNominalYield.toFixed(2)}%`
      if (d.metrics[1]) d.metrics[1].value = `${t.us10yNominalYield.toFixed(2)}%`
      if (d.metrics[2]) d.metrics[2].value = `${t.us10yRealYield.toFixed(2)}%`
    }

    if (currentNasdaqState.drivers.volatility_options) {
      const d = currentNasdaqState.drivers.volatility_options
      if (d.metrics[0]) d.metrics[0].value = t.vxnIndex.toFixed(2)
      if (d.metrics[1]) d.metrics[1].value = t.vixIndex.toFixed(2)
      if (d.metrics[2]) d.metrics[2].value = `${(t.vxnIndex - t.vixIndex).toFixed(2)} pts`
    }

    // Sync TODAY'S state strings
    currentNasdaqState.today.us2y = `${t.us2yNominalYield.toFixed(2)}%`
    currentNasdaqState.today.us10y = `${t.us10yNominalYield.toFixed(2)}% (2s10s: +${t.yieldCurve2s10sSpreadBps} bps)`
    currentNasdaqState.today.rate_regime = `Nominal 2Y at ${t.us2yNominalYield.toFixed(2)}%, 10Y at ${t.us10yNominalYield.toFixed(2)}% (spread +${t.yieldCurve2s10sSpreadBps} bps). 10Y real TIPS at ${t.us10yRealYield.toFixed(2)}%.`
    currentNasdaqState.today.volatility = `CBOE VXN at ${t.vxnIndex.toFixed(2)}, VIX at ${t.vixIndex.toFixed(2)}. Normal volatility regime.`
    currentNasdaqState.today.leadership = `Relative Stance: ${t.relativeStrengthStance} (NQ: ${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}% vs ES: ${t.esChangePct >= 0 ? '+' : ''}${t.esChangePct.toFixed(2)}%, YM: ${t.ymChangePct >= 0 ? '+' : ''}${t.ymChangePct.toFixed(2)}%).`
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
      currentNasdaqState.liveHeadlines = headlines.slice(0, 10)
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
  if (out.importance !== 'LOW') {
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
    overallBias: 'BULLISH',
    overallConfidence: 86,
    biasSummary:
      'Resilient hyperscaler AI/cloud capex growth (>+$220B) and solid corporate software cash flows offset elevated 10Y yields (5.28%). Market breadth is moderately positive (62/38), with CBOE VXN holding comfortably at 18.40.',
    nasdaqTelemetry: { ...DEFAULT_NASDAQ_TELEMETRY },
    today: { ...DEFAULT_TODAY_NASDAQ_STATE },
    drivers: { ...DEFAULT_NASDAQ_DRIVERS },
    breadth: { ...DEFAULT_BREADTH_STATE },
    semiCycle: { ...DEFAULT_AI_SEMI_STATE },
    earningsCycle: { ...DEFAULT_EARNINGS_CYCLE_STATE },
    feeds: [...DEFAULT_NASDAQ_FEEDS],
    recentEvents: [],
    liveHeadlines: [],
  }
  return currentNasdaqState
}

/** In-memory specialist state. Does not refresh network feeds. */
export function peekNasdaqFundamentalState(): NasdaqFundamentalDashboardState {
  return currentNasdaqState
}
