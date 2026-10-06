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
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { fetchYahooFinanceHeadlines } from '@/lib/trading/liveEconomicResults'
import { logger } from '@/lib/utils/logger'
import { candidateIsMaterial } from '@/lib/fundamentals/outputContract'
import { markFeed, sortByDatetimeDesc, tokyoCashPhase, withholdFeeds } from '@/lib/fundamentals/honesty'

// In-memory state singleton for Nikkei
let currentNikkeiState: NikkeiFundamentalDashboardState = {
  market: 'CME_NKD',
  analystPersona: 'Nikkei 225 Macro, BoJ Monetary Policy, FX Pass-Through & Global Tech Analyst',
  updatedAt: new Date().toISOString(),
  overallBias: 'NEUTRAL',
  overallConfidence: 0,
  biasSummary:
    'NKD and USD/JPY update from Yahoo. BoJ policy, wages, foreign flows, and index weights stay unavailable until those feeds print.',
  nikkeiTelemetry: {
    nkdPrice: 38900,
    nkdChange: 350,
    nkdChangePct: 0.91,
    contractMultiplier: 5,
    contractNotionalValue: 194500,
    usdjpyRate: 152.4,
    usdjpyChangePct: 0.35,
    jgb10yNominalYield: 0.965,
    jgb10yChangeBps: 2.5,
    soxIndex: 5240,
    soxChangePct: 1.85,
    nqPrice: 20350,
    nqChangePct: 0.72,
    topixPrice: 2710,
    topixChangePct: 0.55,
    advancersCount: 162,
    declinersCount: 58,
    unchangedCount: 5,
    nikkeiDivisor: NIKKEI_DIVISOR,
    topConstituentsByWeight: DEFAULT_NIKKEI_CONSTITUENTS,
    tokyoCashSessionActive: tokyoCashPhase() !== 'CLOSED' && tokyoCashPhase() !== 'PREP',
    tokyoSessionPhase: tokyoCashPhase(),
    sourced: {},
    timestamp: Date.now(),
    source: 'CME Globex NKD MDP 3.0 / JPX TSE Arrowhead',
    updatedAt: new Date().toISOString(),
  },
  today: {
    ...TODAYS_NIKKEI_FUNDAMENTAL_INITIAL,
    intraday_bias: 'NEUTRAL',
    short_term_bias: 'NEUTRAL',
    medium_term_bias: 'NEUTRAL',
    domestic_macro_growth: 'Unavailable',
    inflation_wages_shunto: 'Unavailable',
    tokyo_cash_session_bias: 'Unavailable',
    foreign_investor_flow: 'NEUTRAL',
    semiconductor_tailwind: 'NEUTRAL',
    us_overnight_lead: 'FLAT',
    summary_narrative: 'NKD and USD/JPY update from Yahoo. BoJ policy, wages, and foreign flows stay unavailable until those feeds print.',
    updated_at: 'Waiting for quotes',
  },
  contribution: computeNikkeiContributions(DEFAULT_NIKKEI_CONSTITUENTS, NIKKEI_DIVISOR),
  boj: {
    uncollateralizedCallRatePct: 0.25,
    jgb10yYieldPct: 0.965,
    yccStatus: 'ABANDONED_NORMALIZED',
    etfPurchasePace: 'PHASING_OUT',
    policyStance: 'NORMALIZING',
    nextMeetingDate: 'Upcoming BoJ Policy Board',
    summary:
      'BoJ maintaining data-dependent rate normalization path toward 0.50%-0.75%. Yields well anchored with commercial bank margins widening.',
  },
  fx: {
    usdjpyRate: 152.4,
    usdjpyChangePct: 0.35,
    fxRegime: 'YEN_WEAKNESS_EXPORTER_BOOST',
    mofInterventionZone: false,
    implicationForNikkei:
      'USD/JPY holding above 151.50 translates to robust overseas profit repatriation for automakers and chip equipment manufacturers.',
  },
  drivers: Object.fromEntries(
    Object.entries(NIKKEI_DRIVERS_INITIAL).map(([key, row]) => [
      key,
      { ...row, stance: 'NEUTRAL' as const, summary: 'Unavailable until a live print is on the feed.' },
    ]),
  ) as typeof NIKKEI_DRIVERS_INITIAL,
  feeds: withholdFeeds(NIKKEI_FEEDS_INITIAL),
  recentEvents: [],
  liveHeadlines: [],
}

/**
 * Record a newly evaluated event
 */
export function recordEvaluatedNikkeiEvent(event: NikkeiEventEvaluation) {
  currentNikkeiState.recentEvents = [event, ...currentNikkeiState.recentEvents.slice(0, 19)]

  // Adapt overall bias if event is material
  if (candidateIsMaterial(event.structuredOutput.importance, event.structuredOutput.confidence)) {
    currentNikkeiState.overallBias = event.structuredOutput.market_stance.intraday
    currentNikkeiState.overallConfidence = event.structuredOutput.confidence
    currentNikkeiState.today.intraday_bias = event.structuredOutput.market_stance.intraday
    currentNikkeiState.biasSummary = event.structuredOutput.summary
  }
}

/**
 * Fetch live or recent quotes for Nikkei telemetry
 */
export async function updateNikkeiTelemetry(): Promise<NikkeiTelemetry> {
  try {
    const symbols = ['NKD=F', 'JPY=X', '^N225', '^SOX']
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}`

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(3000),
    })

    if (res.ok) {
      const data = await res.json()
      const results = data.quoteResponse?.result || []

      for (const q of results) {
        if (q.symbol === 'NKD=F' && q.regularMarketPrice > 0) {
          currentNikkeiState.nikkeiTelemetry.nkdPrice = q.regularMarketPrice
          currentNikkeiState.nikkeiTelemetry.nkdChange = q.regularMarketChange ?? 0
          currentNikkeiState.nikkeiTelemetry.nkdChangePct = q.regularMarketChangePercent ?? 0
          currentNikkeiState.nikkeiTelemetry.contractNotionalValue = q.regularMarketPrice * 5
          currentNikkeiState.nikkeiTelemetry.sourced = { ...(currentNikkeiState.nikkeiTelemetry.sourced || {}), nkd: true }
          markFeed(currentNikkeiState.feeds, 'cme_nkd_tape', 'ONLINE', new Date().toISOString())
        } else if (q.symbol === 'JPY=X' && q.regularMarketPrice > 0) {
          currentNikkeiState.nikkeiTelemetry.usdjpyRate = q.regularMarketPrice
          currentNikkeiState.nikkeiTelemetry.usdjpyChangePct = q.regularMarketChangePercent ?? 0
          currentNikkeiState.nikkeiTelemetry.sourced = { ...(currentNikkeiState.nikkeiTelemetry.sourced || {}), usdjpy: true }
          markFeed(currentNikkeiState.feeds, 'fx_usdjpy_engine', 'ONLINE', new Date().toISOString())
          currentNikkeiState.fx.usdjpyRate = q.regularMarketPrice
          currentNikkeiState.fx.usdjpyChangePct = q.regularMarketChangePercent ?? 0
        } else if (q.symbol === '^SOX' && q.regularMarketPrice > 0) {
          currentNikkeiState.nikkeiTelemetry.soxIndex = q.regularMarketPrice
          currentNikkeiState.nikkeiTelemetry.soxChangePct = q.regularMarketChangePercent ?? 0
          currentNikkeiState.nikkeiTelemetry.sourced = { ...(currentNikkeiState.nikkeiTelemetry.sourced || {}), sox: true }
        }
      }

      // Re-evaluate FX sensitivity regime
      const fxEval = evaluateUsdJpySensitivity({
        usdjpyRate: currentNikkeiState.fx.usdjpyRate,
        usdjpyChangePct: currentNikkeiState.fx.usdjpyChangePct,
      })
      currentNikkeiState.fx.fxRegime = fxEval.regime
      currentNikkeiState.fx.mofInterventionZone = fxEval.interventionRiskLevel === 'CRITICAL' || fxEval.interventionRiskLevel === 'ELEVATED'
      currentNikkeiState.fx.implicationForNikkei = fxEval.exporterEarningsImpact
    }
  } catch {
    // Keep telemetry fallback
  }

  currentNikkeiState.nikkeiTelemetry.tokyoSessionPhase = tokyoCashPhase()
  currentNikkeiState.nikkeiTelemetry.tokyoCashSessionActive =
    currentNikkeiState.nikkeiTelemetry.tokyoSessionPhase === 'MORNING_CASH' ||
    currentNikkeiState.nikkeiTelemetry.tokyoSessionPhase === 'AFTERNOON_CASH'
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
      currentNikkeiState.liveHeadlines = sortByDatetimeDesc(headlines).slice(0, 12)
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

  return [
    `NIKKEI 225 FUNDAMENTAL STATE (CME NKD)`,
    `NKD Futures Price: ${telemetry.sourced?.nkd ? `${telemetry.nkdPrice.toLocaleString()} (${telemetry.nkdChange >= 0 ? '+' : ''}${telemetry.nkdChange} pts)` : 'Unavailable'}`,
    `USD/JPY Exchange Rate: ${telemetry.sourced?.usdjpy ? `${fx.usdjpyRate.toFixed(2)} (${fx.usdjpyChangePct >= 0 ? '+' : ''}${fx.usdjpyChangePct.toFixed(2)}%)` : 'Unavailable'}`,
    `MoF intervention status: Unavailable`,
    `Bank of Japan policy rate and 10Y JGB: Unavailable`,
    `SOX: ${telemetry.sourced?.sox ? `${telemetry.soxIndex} (${telemetry.soxChangePct >= 0 ? '+' : ''}${telemetry.soxChangePct.toFixed(2)}%)` : 'Unavailable'}`,
    `Price-weight concentration: Unavailable. Official Nikkei weights are not on a live feed.`,
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
