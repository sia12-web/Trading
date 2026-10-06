/**
 * Nikkei 225 Fundamental Analyst Engine - State Store (NIKKEI_AGENT)
 * Market: CME Nikkei 225 USD Futures (NKD - $5 Multiplier) / JPX TSE Cash Market
 *
 * Implements:
 * 1. Live market telemetry pipeline (CME NKD, USD/JPY, 10Y JGB yields, SOX Index, Topix, Nikkei 225)
 * 2. Event deduplication wire pipeline (Finnhub & Yahoo Finance with 60-min token clustering)
 * 3. Daily Nikkei Fundamental State store with revisions tracking
 * 4. Price-weighted contribution tracking (Fast Retailing, Tokyo Electron, Advantest)
 * 5. Bank of Japan & FX regime monitoring
 * 6. Plain-text generator format for Leo AI Assistant system prompt
 */

import type {
  NikkeiFundamentalDashboardState,
  NikkeiTelemetry,
  NikkeiEventEvaluation,
  LiveNikkeiHeadline,
  TodaysNikkeiFundamentalState,
} from '@/types/fundamentals'
import {
  NIKKEI_DIVISOR,
  DEFAULT_NIKKEI_CONSTITUENTS,
  NIKKEI_DRIVERS_INITIAL,
  NIKKEI_FEEDS_INITIAL,
  TODAYS_NIKKEI_FUNDAMENTAL_INITIAL,
} from './nikkeiAnalystConfig'
import {
  computeNikkeiContributions,
  evaluateUsdJpySensitivity,
  deduplicateNikkeiHeadline,
} from './nikkeiAnalystEngine'
import { getYahooSymbolQuote } from '@/lib/yahoo/quote'
import { blankDriverCards, cloneState, markFeed, markFeedsDisconnected } from '@/lib/fundamentals/liveQuotes'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { fetchYahooFinanceHeadlines } from '@/lib/trading/liveEconomicResults'
import { logger } from '@/lib/utils/logger'
import { candidateIsMaterial } from '@/lib/fundamentals/outputContract'

// In-memory state singleton for Nikkei
let currentNikkeiState: NikkeiFundamentalDashboardState = {
  market: 'CME_NKD',
  analystPersona: 'Nikkei 225 Macro, BoJ Monetary Policy, FX Pass-Through & Global Tech Analyst',
  updatedAt: new Date().toISOString(),
  overallBias: 'NEUTRAL',
  overallConfidence: 0,
  biasSummary: 'Waiting for the live NKD and USD/JPY prints.',
  nikkeiTelemetry: {
    nkdPrice: 0,
    nkdChange: 0,
    nkdChangePct: 0,
    contractMultiplier: 5,
    contractNotionalValue: 0,
    usdjpyRate: 0,
    usdjpyChangePct: 0,
    jgb10yNominalYield: 0,
    jgb10yChangeBps: 0,
    soxIndex: 0,
    soxChangePct: 0,
    nqPrice: 0,
    nqChangePct: 0,
    topixPrice: 0,
    topixChangePct: 0,
    advancersCount: 0,
    declinersCount: 0,
    unchangedCount: 0,
    nikkeiDivisor: NIKKEI_DIVISOR,
    topConstituentsByWeight: DEFAULT_NIKKEI_CONSTITUENTS.map((row) => ({ ...row, priceJpy: 0 })),
    tokyoCashSessionActive: true,
    tokyoSessionPhase: 'MORNING_CASH',
    timestamp: Date.now(),
    source: 'Nikkei quote has not loaded',
    updatedAt: new Date().toISOString(),
  },
  today: { ...TODAYS_NIKKEI_FUNDAMENTAL_INITIAL },
  contribution: computeNikkeiContributions(
    DEFAULT_NIKKEI_CONSTITUENTS.map((row) => ({ ...row, priceJpy: 0 })),
    NIKKEI_DIVISOR
  ),
  boj: {
    uncollateralizedCallRatePct: 0,
    jgb10yYieldPct: 0,
    yccStatus: 'ABANDONED_NORMALIZED',
    etfPurchasePace: 'PHASING_OUT',
    policyStance: 'NORMALIZING',
    nextMeetingDate: 'Not on this feed',
    summary: 'The policy rate and 10Y JGB yield are not on this feed.',
  },
  fx: {
    usdjpyRate: 0,
    usdjpyChangePct: 0,
    fxRegime: 'FX_STABLE',
    mofInterventionZone: false,
    implicationForNikkei: 'USD/JPY has not loaded.',
  },
  drivers: (() => {
    const drivers = cloneState(NIKKEI_DRIVERS_INITIAL)
    blankDriverCards(drivers)
    return drivers
  })(),
  feeds: markFeedsDisconnected(cloneState(NIKKEI_FEEDS_INITIAL)),
  recentEvents: [],
  liveHeadlines: [],
}

currentNikkeiState.today.summary_narrative = 'Waiting for the live NKD and USD/JPY prints.'
currentNikkeiState.today.foreign_investor_flow = 'NEUTRAL'
currentNikkeiState.today.us_overnight_lead = 'FLAT'
currentNikkeiState.today.tokyo_cash_session_bias = 'The cash phase comes from the Tokyo clock. Breadth is not on this feed.'
currentNikkeiState.today.domestic_macro_growth = 'Not on this feed.'
currentNikkeiState.today.inflation_wages_shunto = 'Not on this feed.'
currentNikkeiState.today.intraday_bias = 'NEUTRAL'
currentNikkeiState.today.short_term_bias = 'NEUTRAL'
currentNikkeiState.today.medium_term_bias = 'NEUTRAL'
currentNikkeiState.today.semiconductor_tailwind = 'NEUTRAL'
currentNikkeiState.today.fx_regime = 'FX_STABLE'
currentNikkeiState.today.key_risks = ['No live risk premium is computed on this feed.']

/**
 * Record a newly evaluated event
 */
export function recordEvaluatedNikkeiEvent(event: NikkeiEventEvaluation) {
  currentNikkeiState.recentEvents = [event, ...currentNikkeiState.recentEvents.slice(0, 19)]

  // Adapt overall bias if event is material
  if (candidateIsMaterial(event.structuredOutput.importance, event.structuredOutput.confidence)) {
    currentNikkeiState.overallBias = event.structuredOutput.market_stance.intraday
    currentNikkeiState.today.intraday_bias = event.structuredOutput.market_stance.intraday
    currentNikkeiState.biasSummary = event.structuredOutput.summary
  }
}

function tokyoCashPhase(now = new Date()): {
  phase: NikkeiTelemetry['tokyoSessionPhase']
  active: boolean
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now)
  let weekday = 'Sun'
  let hour = 0
  let minute = 0
  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value
    if (part.type === 'hour') hour = Number(part.value)
    if (part.type === 'minute') minute = Number(part.value)
  }
  if (weekday === 'Sat' || weekday === 'Sun') return { phase: 'CLOSED', active: false }
  const mins = hour * 60 + minute
  if (mins >= 8 * 60 && mins < 9 * 60) return { phase: 'PREP', active: false }
  if (mins >= 9 * 60 && mins < 11 * 60 + 30) return { phase: 'MORNING_CASH', active: true }
  if (mins >= 11 * 60 + 30 && mins < 12 * 60 + 30) return { phase: 'LUNCH_BREAK', active: false }
  if (mins >= 12 * 60 + 30 && mins < 15 * 60) return { phase: 'AFTERNOON_CASH', active: true }
  return { phase: 'CLOSED', active: false }
}

/**
 * Fetch live or recent quotes for Nikkei telemetry
 */
export async function updateNikkeiTelemetry(): Promise<NikkeiTelemetry> {
  try {
    const [nkd, usdjpy, sox, topix, nq] = await Promise.all([
      getYahooSymbolQuote('NKD=F'),
      getYahooSymbolQuote('USDJPY=X'),
      getYahooSymbolQuote('^SOX'),
      getYahooSymbolQuote('^TOPX'),
      getYahooSymbolQuote('MNQ=F'),
    ])
    const t = currentNikkeiState.nikkeiTelemetry
    const session = tokyoCashPhase()
    t.tokyoSessionPhase = session.phase
    t.tokyoCashSessionActive = session.active

    if (nkd && nkd.price > 0) {
      t.nkdPrice = nkd.price
      t.nkdChange = nkd.change
      t.nkdChangePct = nkd.change_pct
      t.contractNotionalValue = nkd.price * t.contractMultiplier
      t.source = 'Yahoo NKD=F'
    }
    if (usdjpy && usdjpy.price > 0) {
      t.usdjpyRate = usdjpy.price
      t.usdjpyChangePct = usdjpy.change_pct
      currentNikkeiState.fx.usdjpyRate = usdjpy.price
      currentNikkeiState.fx.usdjpyChangePct = usdjpy.change_pct
    }
    if (sox && sox.price > 0) {
      t.soxIndex = sox.price
      t.soxChangePct = sox.change_pct
    }
    if (topix && topix.price > 0) {
      t.topixPrice = topix.price
      t.topixChangePct = topix.change_pct
    }
    if (nq && nq.price > 0) {
      t.nqPrice = nq.price
      t.nqChangePct = nq.change_pct
    }

    if (currentNikkeiState.fx.usdjpyRate > 0) {
      const fxEval = evaluateUsdJpySensitivity({
        usdjpyRate: currentNikkeiState.fx.usdjpyRate,
        usdjpyChangePct: currentNikkeiState.fx.usdjpyChangePct,
      })
      currentNikkeiState.fx.fxRegime = fxEval.regime
      currentNikkeiState.fx.mofInterventionZone =
        fxEval.interventionRiskLevel === 'CRITICAL' || fxEval.interventionRiskLevel === 'ELEVATED'
      currentNikkeiState.fx.implicationForNikkei = fxEval.exporterEarningsImpact
    }

    const fxDriver = currentNikkeiState.drivers.usdjpy_fx_flow
    if (fxDriver && t.usdjpyRate > 0) {
      fxDriver.summary = `USD/JPY ${t.usdjpyRate.toFixed(2)} (${t.usdjpyChangePct >= 0 ? '+' : ''}${t.usdjpyChangePct.toFixed(2)}%).`
      const spot = fxDriver.metrics[0]
      if (spot && 'currentValue' in spot) spot.currentValue = +t.usdjpyRate.toFixed(2)
    }
    const semiDriver = currentNikkeiState.drivers.tokyo_electron_semis
    if (semiDriver && t.soxIndex > 0) {
      semiDriver.summary = `SOX ${t.soxIndex.toFixed(2)} (${t.soxChangePct >= 0 ? '+' : ''}${t.soxChangePct.toFixed(2)}%). Tokyo share prices are not on this feed.`
      const soxMetric = semiDriver.metrics[0]
      if (soxMetric && 'currentValue' in soxMetric) soxMetric.currentValue = +t.soxIndex.toFixed(2)
    }
    const spill = currentNikkeiState.drivers.global_risk_us_spillover
    if (spill && t.nqPrice > 0) {
      spill.summary = `Nasdaq-100 future ${t.nqPrice.toFixed(2)} (${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}%).`
      const nqMetric = spill.metrics[0]
      if (nqMetric && 'currentValue' in nqMetric) nqMetric.currentValue = +t.nqPrice.toFixed(2)
      currentNikkeiState.today.us_overnight_lead =
        t.nqChangePct >= 1 ? 'STRONG_BULLISH'
        : t.nqChangePct >= 0.25 ? 'MILD_BULLISH'
        : t.nqChangePct <= -1 ? 'STRONG_BEARISH'
        : t.nqChangePct <= -0.25 ? 'MILD_BEARISH'
        : 'FLAT'
    }
    currentNikkeiState.today.foreign_investor_flow = 'NEUTRAL'
    if (t.nkdPrice > 0) {
      const fxText = t.usdjpyRate > 0
        ? ` USD/JPY ${t.usdjpyRate.toFixed(2)} (${t.usdjpyChangePct >= 0 ? '+' : ''}${t.usdjpyChangePct.toFixed(2)}%).`
        : ''
      currentNikkeiState.biasSummary = `NKD ${t.nkdPrice.toFixed(0)} (${t.nkdChangePct >= 0 ? '+' : ''}${t.nkdChangePct.toFixed(2)}%).${fxText} ${currentNikkeiState.fx.implicationForNikkei}`
      currentNikkeiState.today.summary_narrative = currentNikkeiState.biasSummary
    }
    markFeed(currentNikkeiState.feeds, 'cme_nkd_tape', t.nkdPrice > 0)
    markFeed(currentNikkeiState.feeds, 'fx_usdjpy_engine', t.usdjpyRate > 0, 'Yahoo USDJPY=X')
    markFeed(currentNikkeiState.feeds, 'semi_supply_chain_feed', t.soxIndex > 0, 'Yahoo ^SOX')
  } catch (err) {
    logger.warn('[NikkeiStateStore] Failed to update live Nikkei telemetry', err)
  }

  currentNikkeiState.nikkeiTelemetry.updatedAt = new Date().toISOString()
  return currentNikkeiState.nikkeiTelemetry
}

/**
 * Fetch live Nikkei news wire
 */
export async function refreshLiveNikkeiNewsWire(): Promise<LiveNikkeiHeadline[]> {
  const finnhub = getFinnhubClient()
  const nikkeiFilter = /nikkei|japan|boj|bank of japan|yen|usdjpy|tokyo electron|advantest|fast retailing|uniqlo|jgb|ueda|softbank/i

  try {
    const headlines: LiveNikkeiHeadline[] = []

    if (finnhub) {
      const news = (await finnhub.getMarketNews('general')) || []
      for (const h of news) {
        if (h.headline && nikkeiFilter.test(h.headline)) {
          const dedup = deduplicateNikkeiHeadline(h.headline, h.source)
          let relevance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
          if (/boj|bank of japan|ueda|rate hike|intervention|usdjpy|tokyo electron/i.test(h.headline)) {
            relevance = 'CRITICAL'
          } else if (/nikkei|advantest|fast retailing|jgb|wages|shunto/i.test(h.headline)) {
            relevance = 'HIGH'
          }

          headlines.push({
            id: `nikkei-news-${Math.random().toString(36).slice(2, 8)}`,
            eventId: dedup.eventId,
            headline: h.headline,
            source: h.source || 'Reuters / Tokyo News Wire',
            datetime: h.datetime || Math.floor(Date.now() / 1000),
            url: h.url || null,
            summary: h.summary || null,
            isDuplicateCluster: dedup.isDuplicate,
            duplicateCount: dedup.isDuplicate ? 2 : 1,
            indexRelevance: relevance,
          })
        }
      }
    }

    if (headlines.length < 3) {
      const yNews = await fetchYahooFinanceHeadlines().catch(() => [])
      for (const y of yNews) {
        if (y.headline && nikkeiFilter.test(y.headline)) {
          const dedup = deduplicateNikkeiHeadline(y.headline, y.source || 'Yahoo Finance Wire')
          headlines.push({
            id: `y-nikkei-${Math.random().toString(36).slice(2, 8)}`,
            eventId: dedup.eventId,
            headline: y.headline,
            source: y.source || 'Yahoo Finance Wire',
            datetime: y.datetime,
            url: y.url || null,
            summary: y.summary || null,
            isDuplicateCluster: dedup.isDuplicate,
            duplicateCount: dedup.isDuplicate ? 2 : 1,
            indexRelevance: 'MEDIUM',
          })
        }
      }
    }

    if (headlines.length > 0) {
      currentNikkeiState.liveHeadlines = headlines.slice(0, 10)
    }
  } catch (err) {
    logger.warn('[NikkeiStateStore] Failed to fetch live Nikkei headlines', err)
  }

  return currentNikkeiState.liveHeadlines
}

/**
 * Formats "TODAY'S NIKKEI FUNDAMENTAL STATE" as plain text for Leo AI Assistant
 */
export function formatTodaysNikkeiFundamentalStateText(today: TodaysNikkeiFundamentalState): string {
  const telemetry = currentNikkeiState.nikkeiTelemetry
  const fx = currentNikkeiState.fx
  const boj = currentNikkeiState.boj
  const contrib = currentNikkeiState.contribution

  return [
    `NIKKEI 225 FUNDAMENTAL STATE (CME NKD)`,
    `NKD Futures Price: ${telemetry.nkdPrice.toLocaleString()} ($5 multiplier, ${telemetry.nkdChange >= 0 ? '+' : ''}${telemetry.nkdChange} pts)`,
    `USD/JPY Exchange Rate: ${fx.usdjpyRate.toFixed(2)} (${fx.usdjpyChangePct >= 0 ? '+' : ''}${fx.usdjpyChangePct.toFixed(2)}%) - Regime: ${fx.fxRegime}`,
    `MoF Currency Intervention Danger Zone: ${fx.mofInterventionZone ? 'CRITICAL ALERT (155-160 zone)' : 'NORMAL / LOW RISK'}`,
    `Bank of Japan Policy Rate: ${boj.uncollateralizedCallRatePct}% (10Y JGB: ${boj.jgb10yYieldPct}%) - Stance: ${boj.policyStance}`,
    `Semiconductor Momentum: SOX Index ${telemetry.soxIndex} (${telemetry.soxChangePct >= 0 ? '+' : ''}${telemetry.soxChangePct.toFixed(2)}%) - Tailwind: ${today.semiconductor_tailwind}`,
    `Price-Weighting Leverage: Top 3 constituents command ${contrib.top3ContributionPct}% of index (Fast Retailing ${contrib.fastRetailingWeightPct}%, Tokyo Electron ${contrib.tokyoElectronWeightPct}%, Advantest ${contrib.advantestWeightPct}%)`,
    `Domestic Macro & Growth: ${today.domestic_macro_growth}`,
    `Shunto Wages & Inflation: ${today.inflation_wages_shunto}`,
    `Foreign Institutional Flow: ${today.foreign_investor_flow}`,
    `US Overnight Lead: ${today.us_overnight_lead}`,
    `Tokyo Cash Session Stance: ${today.tokyo_cash_session_bias}`,
    ``,
    `INTRADAY BIAS: ${today.intraday_bias}`,
    `SHORT-TERM BIAS: ${today.short_term_bias}`,
    `MEDIUM-TERM BIAS: ${today.medium_term_bias}`,
    ``,
    `Key Risks:`,
    ...today.key_risks.map((r) => ` - ${r}`),
    `Top Catalysts:`,
    ...today.top_catalysts.map((c) => ` - ${c}`),
    `Summary Narrative: ${today.summary_narrative}`,
  ].join('\n')
}

/**
 * Returns complete dashboard state for Nikkei
 */
export async function getNikkeiFundamentalState(): Promise<NikkeiFundamentalDashboardState> {
  await Promise.all([updateNikkeiTelemetry(), refreshLiveNikkeiNewsWire()])
  currentNikkeiState.updatedAt = new Date().toISOString()
  return currentNikkeiState
}

/** In-memory specialist state. Does not refresh network feeds. */
export function peekNikkeiFundamentalState(): NikkeiFundamentalDashboardState {
  return currentNikkeiState
}
