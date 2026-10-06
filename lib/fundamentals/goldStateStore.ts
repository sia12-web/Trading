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
import { blankDriverCards, cloneState, fetchFredLatest, fetchYahooPrint, markFeed, markFeedsDisconnected } from '@/lib/fundamentals/liveQuotes'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { fetchYahooFinanceHeadlines } from '@/lib/trading/liveEconomicResults'
import { logger } from '@/lib/utils/logger'
import { candidateIsMaterial } from '@/lib/fundamentals/outputContract'

const NOT_ON_FEED = 'Not on this feed.'

function freshGoldState(): GoldFundamentalDashboardState {
  const telemetry = cloneState(DEFAULT_GOLD_TELEMETRY)
  telemetry.goldPrice = 0
  telemetry.goldChange = 0
  telemetry.goldChangePct = 0
  telemetry.silverPrice = 0
  telemetry.silverChange = 0
  telemetry.goldSilverRatio = 0
  telemetry.us10yNominalYield = 0
  telemetry.us5yNominalYield = 0
  telemetry.us2yNominalYield = 0
  telemetry.us30yNominalYield = 0
  telemetry.us10yRealYield = 0
  telemetry.us5yRealYield = 0
  telemetry.us10yBreakeven = 0
  telemetry.dxyIndex = 0
  telemetry.dxyChangePct = 0
  telemetry.eurUsd = 0
  telemetry.usdJpy = 0
  telemetry.goldCvol = 0
  telemetry.goldRealizedVol30d = 0
  telemetry.cvdAggressionStance = 'NEUTRAL'
  telemetry.source = 'Quotes have not loaded'
  const today = cloneState(DEFAULT_TODAY_GOLD_STATE)
  for (const key of Object.keys(today) as (keyof typeof today)[]) {
    const value = today[key]
    if (typeof value !== 'string' || key === 'upcoming_catalysts') continue
    if (value === 'BULLISH' || value === 'BEARISH' || value === 'MIXED') today[key] = 'NEUTRAL' as never
    else if (/\d/.test(value)) today[key] = NOT_ON_FEED as never
  }
  today.real_rate_regime = '10Y real yield loads from FRED DFII10.'
  today.usd_regime = 'DXY loads from Yahoo.'
  today.intraday_bias = 'NEUTRAL'
  today.short_term_bias = 'NEUTRAL'
  today.medium_term_bias = 'NEUTRAL'
  const drivers = cloneState(DEFAULT_GOLD_DRIVERS)
  blankDriverCards(drivers)
  const etfFlows = cloneState(DEFAULT_ETF_FLOW_STATE)
  etfFlows.globalTonnes = 0
  etfFlows.weeklyChangeTonnes = 0
  etfFlows.monthlyChangeTonnes = 0
  etfFlows.gldHoldingsTonnes = 0
  etfFlows.iauHoldingsTonnes = 0
  etfFlows.divergenceSignal = 'NEUTRAL'
  etfFlows.notes = NOT_ON_FEED
  const cftcPositioning = cloneState(DEFAULT_CFTC_POSITIONING_STATE)
  cftcPositioning.reportDate = 'Not connected'
  cftcPositioning.managedMoneyLong = 0
  cftcPositioning.managedMoneyShort = 0
  cftcPositioning.netManagedMoney = 0
  cftcPositioning.weeklyChangeContracts = 0
  cftcPositioning.longShortRatio = 0
  cftcPositioning.fourWeekTrend = []
  cftcPositioning.crowdingIndex = 0
  cftcPositioning.liquidationRisk = 'LOW'
  cftcPositioning.openInterest = 0
  const comexInventory = cloneState(DEFAULT_COMEX_INVENTORY_STATE)
  comexInventory.reportDate = 'Not connected'
  comexInventory.registeredOz = 0
  comexInventory.eligibleOz = 0
  comexInventory.totalOz = 0
  comexInventory.dailyReceivedOz = 0
  comexInventory.dailyWithdrawnOz = 0
  comexInventory.deliveryNotices = 0
  comexInventory.change1dOz = 0
  comexInventory.change5dOz = 0
  comexInventory.change20dOz = 0
  const centralBankDemand = cloneState(DEFAULT_CENTRAL_BANK_STATE)
  centralBankDemand.annualNetPurchasesTonnes = 0
  centralBankDemand.quarterlyRunRateTonnes = 0
  centralBankDemand.pbocReportedOunces = 0
  centralBankDemand.pbocPurchasesStatus = NOT_ON_FEED
  centralBankDemand.reserveDiversificationPace = 'STEADY'
  centralBankDemand.imfDataTimestamp = 'Not connected'
  return {
    market: 'COMEX_GC',
    analystPersona: 'Gold Macro, Monetary and Physical Demand Analyst',
    updatedAt: new Date().toISOString(),
    overallBias: 'NEUTRAL',
    overallConfidence: 0,
    biasSummary: 'Waiting for the live gold, real-yield, and dollar prints.',
    goldTelemetry: telemetry,
    today,
    drivers,
    etfFlows,
    cftcPositioning,
    comexInventory,
    centralBankDemand,
    feeds: markFeedsDisconnected(cloneState(DEFAULT_GOLD_FEEDS)),
    recentEvents: [],
    liveGoldHeadlines: [],
  }
}

let currentGoldState: GoldFundamentalDashboardState = freshGoldState()

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
      fetchYahooPrint('SI=F'),
      fetchYahooPrint('DX-Y.NYB'),
      fetchYahooPrint('^TNX'),
      fetchYahooPrint('^FVX'),
      fetchYahooPrint('EURUSD=X'),
      fetchYahooPrint('USDJPY=X'),
      fetchFredLatest('DFII10'),
      fetchFredLatest('DFII5'),
      fetchFredLatest('T10YIE'),
    ])

    const t = currentGoldState.goldTelemetry

    if (gcYahoo && gcYahoo.price > 0) {
      t.goldPrice = gcYahoo.price
      t.goldChange = gcYahoo.change
      t.goldChangePct = gcYahoo.change_pct
    }

    if (siQuote && siQuote.price > 0) {
      t.silverPrice = siQuote.price
      t.silverChange = siQuote.previousClose
        ? +(siQuote.price - siQuote.previousClose).toFixed(3)
        : +(siQuote.price * (siQuote.changePct / 100)).toFixed(3)
    }
    if (gcYahoo && gcYahoo.price > 0 && siQuote && siQuote.price > 0) {
      t.goldSilverRatio = +(gcYahoo.price / siQuote.price).toFixed(2)
    } else {
      t.goldSilverRatio = 0
    }

    if (dxyQuote && dxyQuote.price > 0) {
      t.dxyIndex = dxyQuote.price
      t.dxyChangePct = dxyQuote.changePct
    }

    if (tnxQuote && tnxQuote.price > 0) {
      t.us10yNominalYield = tnxQuote.price
    }

    if (fvxQuote && fvxQuote.price > 0) {
      t.us5yNominalYield = fvxQuote.price
    }

    if (eurQuote && eurQuote.price > 0) {
      t.eurUsd = eurQuote.price
    }

    if (jpyQuote && jpyQuote.price > 0) {
      t.usdJpy = jpyQuote.price
    }

    t.us10yRealYield = fred10yReal != null ? fred10yReal : 0
    t.us5yRealYield = fred5yReal != null ? fred5yReal : 0
    t.us10yBreakeven = fred10yBreakeven != null ? fred10yBreakeven : 0
    if (!(tnxQuote && tnxQuote.price > 0)) t.us10yNominalYield = 0
    if (!(fvxQuote && fvxQuote.price > 0)) t.us5yNominalYield = 0

    t.timestamp = Math.floor(Date.now() / 1000)
    t.updatedAt = new Date().toISOString()

    // Sync metrics inside drivers
    if (currentGoldState.drivers.real_interest_rates) {
      const realDriver = currentGoldState.drivers.real_interest_rates
      if (realDriver.metrics[0]) realDriver.metrics[0].value = t.us10yRealYield !== 0 ? `${t.us10yRealYield.toFixed(2)}%` : '—'
      if (realDriver.metrics[1]) realDriver.metrics[1].value = t.us5yRealYield !== 0 ? `${t.us5yRealYield.toFixed(2)}%` : '—'
      if (realDriver.metrics[2]) realDriver.metrics[2].value = t.us10yBreakeven !== 0 ? `${t.us10yBreakeven.toFixed(2)}%` : '—'
      realDriver.summary = `10Y real ${t.us10yRealYield !== 0 ? t.us10yRealYield.toFixed(2) + '%' : 'UNAVAILABLE'}. 5Y real ${t.us5yRealYield !== 0 ? t.us5yRealYield.toFixed(2) + '%' : 'UNAVAILABLE'}. 10Y breakeven ${t.us10yBreakeven !== 0 ? t.us10yBreakeven.toFixed(2) + '%' : 'UNAVAILABLE'}.`
    }

    if (currentGoldState.drivers.us_dollar) {
      const usdDriver = currentGoldState.drivers.us_dollar
      if (usdDriver.metrics[0]) usdDriver.metrics[0].value = t.dxyIndex > 0 ? t.dxyIndex.toFixed(2) : '—'
      if (usdDriver.metrics[1]) usdDriver.metrics[1].value = t.eurUsd > 0 ? t.eurUsd.toFixed(4) : '—'
      if (usdDriver.metrics[2]) usdDriver.metrics[2].value = t.usdJpy > 0 ? t.usdJpy.toFixed(2) : '—'
      usdDriver.summary = t.dxyIndex > 0
        ? `DXY ${t.dxyIndex.toFixed(2)} (${t.dxyChangePct >= 0 ? '+' : ''}${t.dxyChangePct.toFixed(2)}%).`
        : 'DXY did not print.'
    }

    // Update real rate regime in TODAY'S state
    currentGoldState.today.real_rate_regime = `10Y TIPS real yield ${t.us10yRealYield !== 0 ? t.us10yRealYield.toFixed(2) + '% (DFII10)' : 'UNAVAILABLE'}. 10Y breakeven ${t.us10yBreakeven !== 0 ? t.us10yBreakeven.toFixed(2) + '%' : 'UNAVAILABLE'}.`
    currentGoldState.today.usd_regime = t.dxyIndex > 0
      ? `DXY ${t.dxyIndex.toFixed(2)} (${t.dxyChangePct >= 0 ? '+' : ''}${t.dxyChangePct.toFixed(2)}%). EUR/USD ${t.eurUsd > 0 ? t.eurUsd.toFixed(4) : '—'}.`
      : 'DXY did not print.'
    if (t.goldPrice > 0) {
      currentGoldState.biasSummary = `Gold ${t.goldPrice.toFixed(2)} (${t.goldChangePct >= 0 ? '+' : ''}${t.goldChangePct.toFixed(2)}%). 10Y real ${t.us10yRealYield !== 0 ? t.us10yRealYield.toFixed(2) + '%' : '—'}. DXY ${t.dxyIndex > 0 ? t.dxyIndex.toFixed(2) : '—'}. Gold/silver ${t.goldSilverRatio > 0 ? t.goldSilverRatio.toFixed(2) : '—'}.`
    }
    markFeed(currentGoldState.feeds, 'cme_globex_gc', Boolean(gcYahoo && gcYahoo.price > 0))
    markFeed(currentGoldState.feeds, 'fred_real_yields', fred10yReal != null || fred5yReal != null || fred10yBreakeven != null, 'FRED')
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

    currentGoldState.liveGoldHeadlines = headlines.slice(0, 10)
    markFeed(currentGoldState.feeds, 'reuters_finnhub_metals_wire', true, 'Finnhub / Yahoo on load')
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
  currentGoldState = freshGoldState()
  return currentGoldState
}

/** In-memory specialist state. Does not refresh network feeds. */
export function peekGoldFundamentalState(): GoldFundamentalDashboardState {
  return currentGoldState
}
