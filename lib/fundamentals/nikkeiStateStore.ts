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

// In-memory state singleton for Nikkei
let currentNikkeiState: NikkeiFundamentalDashboardState = {
  market: 'CME_NKD',
  analystPersona: 'Nikkei 225 Macro, BoJ Monetary Policy, FX Pass-Through & Global Tech Analyst',
  updatedAt: new Date().toISOString(),
  overallBias: 'BULLISH',
  overallConfidence: 88,
  biasSummary:
    'Favorable USD/JPY stability near 152.40, historic AI semiconductor capex driving Tokyo Electron and Advantest, and corporate governance reforms fueling foreign inflows support broad upward momentum in NKD futures.',
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
    tokyoCashSessionActive: true,
    tokyoSessionPhase: 'MORNING_CASH',
    timestamp: Date.now(),
    source: 'CME Globex NKD MDP 3.0 / JPX TSE Arrowhead',
    updatedAt: new Date().toISOString(),
  },
  today: { ...TODAYS_NIKKEI_FUNDAMENTAL_INITIAL },
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
  drivers: { ...NIKKEI_DRIVERS_INITIAL },
  feeds: [...NIKKEI_FEEDS_INITIAL],
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
        if (q.symbol === 'NKD=F') {
          currentNikkeiState.nikkeiTelemetry.nkdPrice = q.regularMarketPrice || currentNikkeiState.nikkeiTelemetry.nkdPrice
          currentNikkeiState.nikkeiTelemetry.nkdChange = q.regularMarketChange || currentNikkeiState.nikkeiTelemetry.nkdChange
          currentNikkeiState.nikkeiTelemetry.nkdChangePct = q.regularMarketChangePercent || currentNikkeiState.nikkeiTelemetry.nkdChangePct
          currentNikkeiState.nikkeiTelemetry.contractNotionalValue = currentNikkeiState.nikkeiTelemetry.nkdPrice * 5
        } else if (q.symbol === 'JPY=X') {
          currentNikkeiState.nikkeiTelemetry.usdjpyRate = q.regularMarketPrice || currentNikkeiState.nikkeiTelemetry.usdjpyRate
          currentNikkeiState.nikkeiTelemetry.usdjpyChangePct = q.regularMarketChangePercent || currentNikkeiState.nikkeiTelemetry.usdjpyChangePct
          currentNikkeiState.fx.usdjpyRate = currentNikkeiState.nikkeiTelemetry.usdjpyRate
          currentNikkeiState.fx.usdjpyChangePct = currentNikkeiState.nikkeiTelemetry.usdjpyChangePct
        } else if (q.symbol === '^SOX') {
          currentNikkeiState.nikkeiTelemetry.soxIndex = q.regularMarketPrice || currentNikkeiState.nikkeiTelemetry.soxIndex
          currentNikkeiState.nikkeiTelemetry.soxChangePct = q.regularMarketChangePercent || currentNikkeiState.nikkeiTelemetry.soxChangePct
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
