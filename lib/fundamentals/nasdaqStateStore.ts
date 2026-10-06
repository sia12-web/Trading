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
import { blankDriverCards, cloneState, fetchFredLatest, fetchYahooPrint, markFeed, markFeedsDisconnected } from '@/lib/fundamentals/liveQuotes'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { fetchYahooFinanceHeadlines } from '@/lib/trading/liveEconomicResults'
import { deduplicateHeadline } from './nasdaqAnalystEngine'
import { logger } from '@/lib/utils/logger'
import { candidateIsMaterial } from '@/lib/fundamentals/outputContract'

const NOT_ON_FEED = 'Not on this feed.'

function freshNasdaqState(): NasdaqFundamentalDashboardState {
  const telemetry = cloneState(DEFAULT_NASDAQ_TELEMETRY)
  telemetry.nqPrice = 0
  telemetry.nqChange = 0
  telemetry.nqChangePct = 0
  telemetry.esPrice = 0
  telemetry.esChangePct = 0
  telemetry.ymPrice = 0
  telemetry.ymChangePct = 0
  telemetry.relativeStrengthStance = 'NEUTRAL'
  telemetry.us2yNominalYield = 0
  telemetry.us10yNominalYield = 0
  telemetry.yieldCurve2s10sSpreadBps = 0
  telemetry.us10yRealYield = 0
  telemetry.dxyIndex = 0
  telemetry.dxyChangePct = 0
  telemetry.vixIndex = 0
  telemetry.vxnIndex = 0
  telemetry.semiBasketChangePct = 0
  telemetry.advanceDeclineRatio = 0
  telemetry.cvdAggressionStance = 'NEUTRAL'
  telemetry.source = 'Quotes have not loaded'
  telemetry.topConstituents = telemetry.topConstituents.map((row) => ({
    ...row,
    price: 0,
    changePct: 0,
    lastEpsSurprise: undefined,
    forwardGuidanceStance: undefined,
  }))

  const today = cloneState(DEFAULT_TODAY_NASDAQ_STATE)
  today.fed_regime = NOT_ON_FEED
  today.rate_regime = 'Yields load when the 2Y and 10Y print.'
  today.us2y = 'UNAVAILABLE'
  today.us10y = 'UNAVAILABLE'
  today.inflation_trend = NOT_ON_FEED
  today.labor_trend = NOT_ON_FEED
  today.growth_trend = NOT_ON_FEED
  today.financial_conditions = NOT_ON_FEED
  today.ndx_earnings_trend = NOT_ON_FEED
  today.forward_guidance_trend = NOT_ON_FEED
  today.ai_capex_trend = NOT_ON_FEED
  today.semiconductor_trend = NOT_ON_FEED
  today.breadth = 'Nasdaq-100 advance/decline is not on this feed.'
  today.leadership = 'Relative strength loads when NQ, ES, and YM all print.'
  today.volatility = 'VIX and VXN load on refresh.'
  today.positioning = NOT_ON_FEED
  today.main_current_market_driver = 'Waiting for the live NQ print.'
  today.intraday_bias = 'NEUTRAL'
  today.short_term_bias = 'NEUTRAL'
  today.medium_term_bias = 'NEUTRAL'
  today.what_changed_since_yesterday = 'No measured change until a live print arrives.'
  today.what_would_invalidate_the_current_interpretation = 'A live print that contradicts the read.'

  const drivers = cloneState(DEFAULT_NASDAQ_DRIVERS)
  blankDriverCards(drivers)
  const breadth = cloneState(DEFAULT_BREADTH_STATE)
  breadth.advancingCount = 0
  breadth.decliningCount = 0
  breadth.advanceDeclineRatio = 0
  breadth.pctAbove20dMa = 0
  breadth.pctAbove50dMa = 0
  breadth.pctAbove200dMa = 0
  breadth.pctAboveVwap = 0
  breadth.qqqVsQqqeRatio = 0
  breadth.marketParticipationStance = 'NEUTRAL'
  const semiCycle = cloneState(DEFAULT_AI_SEMI_STATE)
  semiCycle.acceleratorDemandTrend = 'STEADY'
  semiCycle.hyperscalerCapexRunRateBillions = 0
  semiCycle.semiconductorEquipmentCycle = NOT_ON_FEED
  semiCycle.exportRestrictionsStatus = NOT_ON_FEED
  semiCycle.aiLeadershipStance = 'NARROW_CHIP_CONCENTRATION'
  const earningsCycle = cloneState(DEFAULT_EARNINGS_CYCLE_STATE)
  earningsCycle.blendedEarningsGrowthPct = 0
  earningsCycle.guidanceRevisionRatio = 0
  earningsCycle.capexGrowthPct = 0
  earningsCycle.notableRecentReports = []

  return {
    market: 'CME_NQ',
    analystPersona: 'Nasdaq-100 Macro, Earnings and Market-Flow Analyst',
    updatedAt: new Date().toISOString(),
    overallBias: 'NEUTRAL',
    overallConfidence: 0,
    biasSummary: 'Waiting for the live NQ, yield, and volatility prints.',
    nasdaqTelemetry: telemetry,
    today,
    drivers,
    breadth,
    semiCycle,
    earningsCycle,
    feeds: markFeedsDisconnected(cloneState(DEFAULT_NASDAQ_FEEDS)),
    recentEvents: [],
    liveHeadlines: [],
  }
}

let currentNasdaqState: NasdaqFundamentalDashboardState = freshNasdaqState()

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
      fetchYahooPrint('ES=F'),
      fetchYahooPrint('YM=F'),
      fetchYahooPrint('^TNX'),
      fetchYahooPrint('^VIX'),
      fetchYahooPrint('^VXN'),
      fetchYahooPrint('DX-Y.NYB'),
      fetchFredLatest('DFII10'),
      fetchFredLatest('DGS2'),
      fetchYahooPrint('NVDA'),
      fetchYahooPrint('MSFT'),
      fetchYahooPrint('AAPL'),
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
    } else {
      t.us10yNominalYield = 0
    }

    if (fred2y != null && fred2y > 0) {
      t.us2yNominalYield = fred2y
    } else {
      t.us2yNominalYield = 0
      t.yieldCurve2s10sSpreadBps = 0
    }
    if (fred2y != null && fred2y > 0 && t.us10yNominalYield > 0) {
      t.yieldCurve2s10sSpreadBps = Math.round((t.us10yNominalYield - t.us2yNominalYield) * 100)
    }

    t.vixIndex = vixQuote && vixQuote.price > 0 ? vixQuote.price : 0
    t.vxnIndex = vxnQuote && vxnQuote.price > 0 ? vxnQuote.price : 0

    if (dxyQuote && dxyQuote.price > 0) {
      t.dxyIndex = dxyQuote.price
      t.dxyChangePct = dxyQuote.changePct
    }

    t.us10yRealYield = fred10yReal != null && fred10yReal > 0 ? fred10yReal : 0

    const quotesThisLoad = Boolean(nqYahoo && nqYahoo.price > 0 && esQuote && ymQuote)
    if (!quotesThisLoad) {
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
    const twoYearText = fred2y != null && fred2y > 0 ? `${t.us2yNominalYield.toFixed(2)}%` : 'UNAVAILABLE'
    const tenYearText = tnxQuote && t.us10yNominalYield > 0 ? `${t.us10yNominalYield.toFixed(2)}%` : 'UNAVAILABLE'
    const realText = t.us10yRealYield > 0 ? `${t.us10yRealYield.toFixed(2)}%` : 'UNAVAILABLE'
    const curveText = fred2y != null && fred2y > 0 && t.us10yNominalYield > 0
      ? `${t.yieldCurve2s10sSpreadBps >= 0 ? '+' : ''}${t.yieldCurve2s10sSpreadBps} bps`
      : 'UNAVAILABLE'
    if (currentNasdaqState.drivers.treasury_yields) {
      const d = currentNasdaqState.drivers.treasury_yields
      d.summary = `2Y ${twoYearText}, 10Y ${tenYearText}, 10Y real ${realText}.`
      if (d.metrics[0]) d.metrics[0].value = twoYearText
      if (d.metrics[1]) d.metrics[1].value = tenYearText
      if (d.metrics[2]) d.metrics[2].value = realText
    }

    const volReady = t.vixIndex > 0 && t.vxnIndex > 0
    const volWord = !volReady
      ? 'unavailable'
      : t.vixIndex >= 24 || t.vxnIndex >= 28
        ? 'elevated'
        : t.vixIndex <= 13 && t.vxnIndex <= 16
          ? 'compressed'
          : 'ordinary'
    if (currentNasdaqState.drivers.volatility_options) {
      const d = currentNasdaqState.drivers.volatility_options
      d.summary = volReady
        ? `VXN ${t.vxnIndex.toFixed(2)}, VIX ${t.vixIndex.toFixed(2)}. ${volWord} volatility.`
        : 'VIX or VXN did not print.'
      if (d.metrics[0]) d.metrics[0].value = t.vxnIndex > 0 ? t.vxnIndex.toFixed(2) : '—'
      if (d.metrics[1]) d.metrics[1].value = t.vixIndex > 0 ? t.vixIndex.toFixed(2) : '—'
      if (d.metrics[2]) d.metrics[2].value = volReady ? `${(t.vxnIndex - t.vixIndex).toFixed(2)} pts` : '—'
    }
    if (currentNasdaqState.drivers.usd_financial_conditions && dxyQuote && t.dxyIndex > 0) {
      const d = currentNasdaqState.drivers.usd_financial_conditions
      d.summary = `DXY ${t.dxyIndex.toFixed(2)} (${t.dxyChangePct >= 0 ? '+' : ''}${t.dxyChangePct.toFixed(2)}%). NFCI and credit OAS are not on this Nasdaq feed.`
      if (d.metrics[0]) d.metrics[0].value = t.dxyIndex.toFixed(2)
    }

    currentNasdaqState.today.us2y = twoYearText
    currentNasdaqState.today.us10y = `${tenYearText} (2s10s: ${curveText})`
    currentNasdaqState.today.rate_regime = `2Y ${twoYearText}, 10Y ${tenYearText} (2s10s ${curveText}). 10Y real TIPS ${realText}.`
    currentNasdaqState.today.volatility = volReady
      ? `CBOE VXN ${t.vxnIndex.toFixed(2)}, VIX ${t.vixIndex.toFixed(2)}. ${volWord} volatility.`
      : 'VIX or VXN did not print.'
    currentNasdaqState.today.leadership = quotesThisLoad
      ? `Relative stance ${t.relativeStrengthStance}. NQ ${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}%, ES ${t.esChangePct >= 0 ? '+' : ''}${t.esChangePct.toFixed(2)}%, YM ${t.ymChangePct >= 0 ? '+' : ''}${t.ymChangePct.toFixed(2)}%.`
      : 'Relative strength waits until NQ, ES, and YM all print.'
    currentNasdaqState.biasSummary = t.nqPrice > 0
      ? `NQ ${t.nqPrice.toFixed(2)} (${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}%). VIX ${t.vixIndex > 0 ? t.vixIndex.toFixed(2) : '—'}, VXN ${t.vxnIndex > 0 ? t.vxnIndex.toFixed(2) : '—'}. 10Y ${tenYearText}. ${t.relativeStrengthStance}.`
      : 'Waiting for the live NQ print.'
    markFeed(currentNasdaqState.feeds, 'cme_globex_nq', Boolean(nqYahoo && nqYahoo.price > 0))
    markFeed(currentNasdaqState.feeds, 'treasury_yields_engine', Boolean(tnxQuote || (fred2y != null && fred2y > 0) || fred10yReal != null), 'Yahoo ^TNX / FRED')
    markFeed(currentNasdaqState.feeds, 'cboe_volatility_vix_vxn', volReady, 'Yahoo ^VIX and ^VXN')
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

    currentNasdaqState.liveHeadlines = headlines.slice(0, 10)
    markFeed(currentNasdaqState.feeds, 'tech_news_deduplicator', true, 'Finnhub / Yahoo on load')
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
  currentNasdaqState = freshNasdaqState()
  return currentNasdaqState
}

/** In-memory specialist state. Does not refresh network feeds. */
export function peekNasdaqFundamentalState(): NasdaqFundamentalDashboardState {
  return currentNasdaqState
}
