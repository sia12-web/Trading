/**
 * Gold Macro, Monetary and Physical Demand Analyst - In-Memory State Store
 * Market: COMEX Gold Futures (GC)
 *
 * Implements:
 * 1. Live market telemetry pipeline (CME GC, SI, GSR, FRED DFII10/DFII5 real yields, DXY)
 * 2. Live Institutional Metals News Wire (Finnhub & Yahoo RSS)
 * 3. 14-Pillar Daily Gold Fundamental State store with revisions tracking
 * 4. Stance recalculation and history audit
 */

import type {
  GoldFundamentalDashboardState,
  GoldTelemetry,
  GoldEventEvaluation,
  LiveGoldHeadline,
  TodaysGoldFundamentalState,
} from '@/types/fundamentals'
import {
  DEFAULT_TODAY_GOLD_STATE,
  DEFAULT_GOLD_DRIVERS,
  DEFAULT_ETF_FLOW_STATE,
  DEFAULT_CFTC_POSITIONING_STATE,
  DEFAULT_COMEX_INVENTORY_STATE,
  DEFAULT_CENTRAL_BANK_STATE,
  DEFAULT_GOLD_TELEMETRY,
  DEFAULT_GOLD_FEEDS,
} from './goldAnalystConfig'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { fetchYahooFinanceHeadlines } from '@/lib/trading/liveEconomicResults'
import { logger } from '@/lib/utils/logger'
import { candidateIsMaterial } from '@/lib/fundamentals/outputContract'
import { blankMetricValues, markFeed, sortByDatetimeDesc, withholdFeeds } from '@/lib/fundamentals/honesty'

// In-memory state singleton for Gold
let currentGoldState: GoldFundamentalDashboardState = {
  market: 'COMEX_GC',
  analystPersona: 'Gold Macro, Monetary and Physical Demand Analyst',
  updatedAt: new Date().toISOString(),
  overallBias: 'NEUTRAL',
  overallConfidence: 0,
  biasSummary: 'Gold, yields, and the dollar update from Yahoo and FRED. ETF tonnes, CFTC, COMEX stocks, and central-bank purchases stay unavailable.',
  goldTelemetry: { ...DEFAULT_GOLD_TELEMETRY, goldCvol: null, goldRealizedVol30d: null, sourced: {} },
  today: {
    ...DEFAULT_TODAY_GOLD_STATE,
    monetary_policy: 'Unavailable',
    real_rate_regime: 'Unavailable',
    usd_regime: 'Unavailable',
    inflation: 'Unavailable',
    growth: 'Unavailable',
    financial_stress: 'Unavailable',
    geopolitical_risk: 'Unavailable',
    etf_flows: 'Unavailable',
    central_bank_demand: 'Unavailable',
    cftc_positioning: 'Unavailable',
    physical_demand: 'Unavailable',
    supply: 'Unavailable',
    comex_inventory_deliveries: 'Unavailable',
    gold_volatility: 'Unavailable',
    main_current_driver: 'Unavailable',
    what_changed_since_yesterday: 'Unavailable',
    intraday_bias: 'NEUTRAL',
    short_term_bias: 'NEUTRAL',
    medium_term_bias: 'NEUTRAL',
  },
  drivers: blankMetricValues(DEFAULT_GOLD_DRIVERS),
  etfFlows: { ...DEFAULT_ETF_FLOW_STATE },
  cftcPositioning: { ...DEFAULT_CFTC_POSITIONING_STATE },
  comexInventory: { ...DEFAULT_COMEX_INVENTORY_STATE },
  centralBankDemand: { ...DEFAULT_CENTRAL_BANK_STATE },
  feeds: withholdFeeds(DEFAULT_GOLD_FEEDS),
  recentEvents: [],
  liveGoldHeadlines: [],
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
 * Refreshes live Gold market telemetry:
 * 1. CME GC price, change, previous close
 * 2. CME SI Silver price & Gold/Silver Ratio (GSR)
 * 3. US 10Y Nominal (^TNX) & 5Y Nominal (^FVX)
 * 4. St. Louis Fed FRED 10Y Real Yield (DFII10), 5Y Real Yield (DFII5), 10Y Breakeven (T10YIE)
 * 5. US Dollar Index (DXY) & EUR/USD, USD/JPY
 */
export async function refreshGoldTelemetry(): Promise<GoldTelemetry> {
  try {
    const [
      gcYahoo,
      siQuote,
      dxyQuote,
      tnxQuote,
      fvxQuote,
      eurQuote,
      jpyQuote,
      fred10yReal,
      fred5yReal,
      fred10yBreakeven,
    ] = await Promise.all([
      getYahooQuote('GOLD').catch(() => null),
      fetchYahooPrice('SI=F'),
      fetchYahooPrice('DX-Y.NYB'),
      fetchYahooPrice('^TNX'),
      fetchYahooPrice('^FVX'),
      fetchYahooPrice('EURUSD=X'),
      fetchYahooPrice('USDJPY=X'),
      fetchFredSeries('DFII10'),
      fetchFredSeries('DFII5'),
      fetchFredSeries('T10YIE'),
    ])

    const t = currentGoldState.goldTelemetry
    t.sourced = { ...(t.sourced || {}) }
    t.goldCvol = null
    t.goldRealizedVol30d = null

    if (gcYahoo && gcYahoo.price > 0) {
      t.goldPrice = gcYahoo.price
      t.goldChange = gcYahoo.change
      t.goldChangePct = gcYahoo.change_pct
      t.sourced.gold = true
      markFeed(currentGoldState.feeds, 'cme_globex_gc', 'ONLINE', new Date().toISOString())
    }

    if (siQuote && siQuote.price > 0) {
      t.sourced.silver = true
      t.silverPrice = siQuote.price
      t.silverChange = +(siQuote.price * (siQuote.changePct / 100)).toFixed(3)
      t.goldSilverRatio = +(t.goldPrice / siQuote.price).toFixed(2)
    }

    if (dxyQuote && dxyQuote.price > 0) {
      t.dxyIndex = dxyQuote.price
      t.dxyChangePct = dxyQuote.changePct
      t.sourced.dxy = true
    }

    if (tnxQuote && tnxQuote.price > 0) {
      t.us10yNominalYield = tnxQuote.price
      t.sourced.us10y = true
    }

    if (fvxQuote && fvxQuote.price > 0) {
      t.us5yNominalYield = fvxQuote.price
      t.sourced.us5y = true
    }

    if (eurQuote && eurQuote.price > 0) {
      t.eurUsd = eurQuote.price
      t.sourced.eurusd = true
    }

    if (jpyQuote && jpyQuote.price > 0) {
      t.usdJpy = jpyQuote.price
      t.sourced.usdjpy = true
    }

    if (fred10yReal !== null) {
      t.us10yRealYield = fred10yReal
      t.sourced.us10yReal = true
      markFeed(currentGoldState.feeds, 'fred_real_yields', 'ONLINE', new Date().toISOString())
    }

    if (fred5yReal !== null) {
      t.us5yRealYield = fred5yReal
      t.sourced.us5yReal = true
    }

    if (fred10yBreakeven !== null) {
      t.us10yBreakeven = fred10yBreakeven
      t.sourced.breakeven = true
    }

    t.timestamp = Math.floor(Date.now() / 1000)
    t.updatedAt = new Date().toISOString()

    // Sync metrics inside drivers
    if (currentGoldState.drivers.real_interest_rates) {
      const realDriver = currentGoldState.drivers.real_interest_rates
      if (realDriver.metrics[0]) realDriver.metrics[0].value = t.sourced.us10yReal ? `${t.us10yRealYield.toFixed(2)}%` : 'Unavailable'
      if (realDriver.metrics[1]) realDriver.metrics[1].value = t.sourced.us5yReal ? `${t.us5yRealYield.toFixed(2)}%` : 'Unavailable'
      if (realDriver.metrics[2]) realDriver.metrics[2].value = t.sourced.breakeven ? `${t.us10yBreakeven.toFixed(2)}%` : 'Unavailable'
    }

    if (currentGoldState.drivers.us_dollar) {
      const usdDriver = currentGoldState.drivers.us_dollar
      if (usdDriver.metrics[0]) usdDriver.metrics[0].value = t.sourced.dxy ? t.dxyIndex.toFixed(2) : 'Unavailable'
      if (usdDriver.metrics[1]) usdDriver.metrics[1].value = t.sourced.eurusd ? t.eurUsd.toFixed(4) : 'Unavailable'
      if (usdDriver.metrics[2]) usdDriver.metrics[2].value = t.sourced.usdjpy ? t.usdJpy.toFixed(2) : 'Unavailable'
    }

    // Update real rate regime in TODAY'S state
    currentGoldState.today.real_rate_regime = t.sourced.us10yReal
      ? `10Y TIPS real yield ${t.us10yRealYield.toFixed(2)}% (FRED DFII10).${t.sourced.breakeven ? ` 10Y breakeven ${t.us10yBreakeven.toFixed(2)}%.` : ''}`
      : 'Unavailable'
    currentGoldState.today.usd_regime = t.sourced.dxy
      ? `DXY ${t.dxyIndex.toFixed(2)} (${t.dxyChangePct >= 0 ? '+' : ''}${t.dxyChangePct.toFixed(2)}%).`
      : 'Unavailable'
    currentGoldState.today.gold_volatility = 'Unavailable'
    currentGoldState.today.etf_flows = 'Unavailable'
    currentGoldState.today.cftc_positioning = 'Unavailable'
    currentGoldState.today.central_bank_demand = 'Unavailable'
    currentGoldState.today.comex_inventory_deliveries = 'Unavailable'
  } catch (err) {
    logger.warn('[GoldStateStore] Failed to update live Gold telemetry', err)
  }

  return currentGoldState.goldTelemetry
}

/**
 * Fetches real breaking gold, precious metals, and monetary news from Finnhub & Yahoo RSS
 */
export async function refreshLiveGoldHeadlines(): Promise<LiveGoldHeadline[]> {
  const headlines: LiveGoldHeadline[] = []
  try {
    const finnhub = getFinnhubClient()
    const generalNews = await finnhub.getMarketNews('general').catch(() => null)

    const goldFilter =
      /gold|bullion|comex|lbma|precious|silver|central bank|pboc|real yields|treasury|fed|fomc|powell|cpi|inflation|safe-haven|dollar index|dxy/i

    if (generalNews && Array.isArray(generalNews)) {
      for (const h of generalNews) {
        if (h.headline && goldFilter.test(h.headline)) {
          headlines.push({
            id: `gold-news-${Math.random().toString(36).slice(2, 8)}`,
            headline: h.headline,
            source: h.source || 'Reuters / Market Wire',
            datetime: h.datetime || Math.floor(Date.now() / 1000),
            url: h.url || null,
            summary: h.summary || null,
          })
        }
      }
    }

    if (headlines.length < 3) {
      const yNews = await fetchYahooFinanceHeadlines().catch(() => [])
      for (const y of yNews) {
        if (y.headline && goldFilter.test(y.headline)) {
          headlines.push({
            id: `y-gold-${Math.random().toString(36).slice(2, 8)}`,
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
      currentGoldState.liveGoldHeadlines = sortByDatetimeDesc(headlines).slice(0, 12)
      markFeed(currentGoldState.feeds, 'reuters_finnhub_metals_wire', 'ONLINE', new Date().toISOString())
    }
  } catch (err) {
    logger.warn('[GoldStateStore] Failed to fetch live gold headlines', err)
  }

  return currentGoldState.liveGoldHeadlines
}

/**
 * Returns the entire current dashboard state for Gold
 */
export async function getGoldFundamentalState(): Promise<GoldFundamentalDashboardState> {
  await Promise.all([
    refreshGoldTelemetry(),
    refreshLiveGoldHeadlines(),
  ])
  currentGoldState.updatedAt = new Date().toISOString()
  return currentGoldState
}

/**
 * Records an evaluated gold event and updates overall stance if material
 */
export function recordEvaluatedGoldEvent(evaluation: GoldEventEvaluation): void {
  currentGoldState.recentEvents.unshift(evaluation)
  if (currentGoldState.recentEvents.length > 20) {
    currentGoldState.recentEvents = currentGoldState.recentEvents.slice(0, 20)
  }

  const out = evaluation.structuredOutput
  if (candidateIsMaterial(out.importance, out.confidence)) {
    currentGoldState.today.intraday_bias = out.fundamental_state.intraday
    currentGoldState.today.short_term_bias = out.fundamental_state.short_term
    currentGoldState.today.medium_term_bias = out.fundamental_state.medium_term
    currentGoldState.today.what_changed_since_yesterday = `${out.event}: ${out.summary}`
    currentGoldState.overallBias = out.fundamental_state.short_term
    currentGoldState.overallConfidence = Math.round(out.confidence * 100)
    currentGoldState.biasSummary = out.summary
  }
}

/**
 * Formats "TODAY'S GOLD FUNDAMENTAL STATE" as plain text for algorithmic trading bots (Item 37)
 */
export function formatTodaysGoldFundamentalStateText(today: TodaysGoldFundamentalState): string {
  return [
    `GOLD FUNDAMENTAL STATE`,
    `Monetary policy: ${today.monetary_policy}`,
    `Real-rate regime: ${today.real_rate_regime}`,
    `USD regime: ${today.usd_regime}`,
    `Inflation: ${today.inflation}`,
    `Growth: ${today.growth}`,
    `Financial stress: ${today.financial_stress}`,
    `Geopolitical risk: ${today.geopolitical_risk}`,
    `ETF flows: ${today.etf_flows}`,
    `Central-bank demand: ${today.central_bank_demand}`,
    `CFTC positioning: ${today.cftc_positioning}`,
    `Physical demand: ${today.physical_demand}`,
    `Supply: ${today.supply}`,
    `COMEX inventory/deliveries: ${today.comex_inventory_deliveries}`,
    `Gold volatility: ${today.gold_volatility}`,
    ``,
    `INTRADAY BIAS: ${today.intraday_bias}`,
    `SHORT-TERM BIAS: ${today.short_term_bias}`,
    `MEDIUM-TERM BIAS: ${today.medium_term_bias}`,
    ``,
    `Main current driver: ${today.main_current_driver}`,
    `Upcoming catalysts: ${today.upcoming_catalysts}`,
    `What changed since yesterday: ${today.what_changed_since_yesterday}`,
    `What would invalidate the current thesis: ${today.what_would_invalidate_this_view}`,
  ].join('\n')
}

/**
 * Resets state back to baseline
 */
export function resetGoldFundamentalState(): GoldFundamentalDashboardState {
  currentGoldState = {
    market: 'COMEX_GC',
    analystPersona: 'Gold Macro, Monetary and Physical Demand Analyst',
    updatedAt: new Date().toISOString(),
    overallBias: 'NEUTRAL',
    overallConfidence: 0,
    biasSummary: 'Gold, yields, and the dollar update from Yahoo and FRED. ETF tonnes, CFTC, COMEX stocks, and central-bank purchases stay unavailable.',
    goldTelemetry: { ...DEFAULT_GOLD_TELEMETRY, goldCvol: null, goldRealizedVol30d: null, sourced: {} },
    today: {
      ...DEFAULT_TODAY_GOLD_STATE,
      monetary_policy: 'Unavailable',
      real_rate_regime: 'Unavailable',
      usd_regime: 'Unavailable',
      inflation: 'Unavailable',
      growth: 'Unavailable',
      financial_stress: 'Unavailable',
      geopolitical_risk: 'Unavailable',
      etf_flows: 'Unavailable',
      central_bank_demand: 'Unavailable',
      cftc_positioning: 'Unavailable',
      physical_demand: 'Unavailable',
      supply: 'Unavailable',
      comex_inventory_deliveries: 'Unavailable',
      gold_volatility: 'Unavailable',
      main_current_driver: 'Unavailable',
      what_changed_since_yesterday: 'Unavailable',
      intraday_bias: 'NEUTRAL',
      short_term_bias: 'NEUTRAL',
      medium_term_bias: 'NEUTRAL',
    },
    drivers: blankMetricValues(DEFAULT_GOLD_DRIVERS),
    etfFlows: { ...DEFAULT_ETF_FLOW_STATE },
    cftcPositioning: { ...DEFAULT_CFTC_POSITIONING_STATE },
    comexInventory: { ...DEFAULT_COMEX_INVENTORY_STATE },
    centralBankDemand: { ...DEFAULT_CENTRAL_BANK_STATE },
    feeds: withholdFeeds(DEFAULT_GOLD_FEEDS),
    recentEvents: [],
    liveGoldHeadlines: [],
  }
  return currentGoldState
}

/** In-memory specialist state. Does not refresh network feeds. */
export function peekGoldFundamentalState(): GoldFundamentalDashboardState {
  return currentGoldState
}
