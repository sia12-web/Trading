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
import { getYahooSymbolCandles } from '@/lib/yahoo/candles'
import { getYahooSymbolQuote } from '@/lib/yahoo/quote'
import { cloneState, fetchFredLatest, fetchYahooPrint, markFeed } from '@/lib/fundamentals/liveQuotes'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { fetchYahooFinanceHeadlines } from '@/lib/trading/liveEconomicResults'
import { logger } from '@/lib/utils/logger'

// In-memory persistent state for server runtime
let currentState: OilFundamentalDashboardState = {
  market: 'NYMEX_WTI',
  analystPersona: 'Oil Fundamental Analyst',
  updatedAt: new Date().toISOString(),
  overallBias: 'NEUTRAL',
  overallConfidence: 0,
  biasSummary: 'Waiting for the live WTI, Brent, and crack prints.',
  physicalBalance: 'BALANCED',
  curveSummary: 'Front-month curve has not loaded.',
  wtiTelemetry: {
    promptPrice: 0,
    symbol: 'CL=F',
    change: 0,
    changePct: 0,
    high: 0,
    low: 0,
    previousClose: 0,
    promptSpread: 0,
    curveLive: false,
    priceLive: false,
    spreadRegime: 'FLAT',
    timestamp: Math.floor(Date.now() / 1000),
    source: 'WTI quote has not loaded',
    updatedAt: new Date().toISOString(),
  },
  today: cloneState(DEFAULT_TODAY_FUNDAMENTAL_STATE),
  fiveFeeds: cloneState(DEFAULT_FIVE_FEEDS),
  pillars: cloneState(DEFAULT_PILLARS_STATE),
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

  const voting = values.filter((p) => p.confidence > 0 && p.reliability > 0)
  for (const p of voting) {
    const weight = p.reliability * (p.confidence / 10)
    totalConfidence += p.confidence
    if (p.bias === 'BULLISH') bullishWeight += weight
    else if (p.bias === 'BEARISH') bearishWeight += weight
  }

  if (voting.length === 0) {
    return {
      overallBias: 'NEUTRAL',
      confidence: 0,
      physicalBalance: 'BALANCED',
      summary: 'No measured pillar is voting. Unpublished inventory and policy text does not set the stance.',
    }
  }

  const avgConfidence = Math.round(totalConfidence / voting.length)
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

  const cushing = pillars.inventories?.metrics?.find((m) => m.label.includes('Cushing'))?.value
  const cushingText = cushing && cushing !== '—' ? String(cushing) : 'Cushing not on the feed'
  const opec = pillars.opec_policy?.confidence ? pillars.opec_policy.statusSummary : 'OPEC policy not on the feed'
  const supply = pillars.crude_supply?.confidence ? pillars.crude_supply.statusSummary : 'US supply not on the feed'

  const summary =
    overallBias === 'BULLISH'
      ? `Bullish read from pillars that have a measured print. Cushing: ${cushingText}. Policy: ${opec}. Supply: ${supply}.`
      : overallBias === 'BEARISH'
      ? `Bearish read from pillars that have a measured print. Supply: ${supply}. Cushing: ${cushingText}.`
      : `Balanced read from pillars that have a measured print. Supply: ${supply}. Cushing: ${cushingText}. Policy: ${opec}.`

  return { overallBias, confidence: avgConfidence, physicalBalance, summary }
}

/**
 * Fetches live quotes from Yahoo Finance v8 chart API
 */
const WTI_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const WTI_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'] as const

/** Next NYMEX month after the front contract name, e.g. "Crude Oil Nov 26" -> CLZ26.NYM. */
export function nextWtiContractSymbol(shortName: string): string | null {
  const match = shortName.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2})\b/
  )
  if (!match) return null
  const index = WTI_MONTHS.indexOf(match[1] as (typeof WTI_MONTHS)[number])
  if (index < 0) return null
  const year = Number(match[2])
  const nextIndex = (index + 1) % 12
  const nextYear = index === 11 ? year + 1 : year
  return `CL${WTI_CODES[nextIndex]}${String(nextYear).padStart(2, '0')}.NYM`
}

async function fetchYahooMeta(
  symbol: string
): Promise<{ price: number; shortName: string } | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000),
      }
    )
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    const price = Number(meta?.regularMarketPrice)
    if (!(price > 0)) return null
    return { price, shortName: String(meta?.shortName || meta?.longName || '') }
  } catch {
    return null
  }
}

function setPillarMetric(
  pillar: FundamentalPillarState | undefined,
  labelPart: string,
  value: string,
  note: string
): void {
  const metric = pillar?.metrics.find((item) => item.label.includes(labelPart))
  if (!metric) return
  metric.value = value
  metric.note = note
}

function publishMeasuredPillar(pillar: FundamentalPillarState | undefined, summary: string, source: string): void {
  if (!pillar) return
  pillar.statusSummary = summary
  pillar.keyTakeaway = summary
  pillar.bias = 'NEUTRAL'
  pillar.confidence = 8
  pillar.reliability = 8
  pillar.lastUpdated = new Date().toISOString()
  pillar.primarySource = source
}

/**
 * One CL=F print drives the price, the curve, and the crack.
 * The next month is taken from that contract's name, not from a hardcoded spread.
 */
export async function refreshWtiTelemetry(): Promise<WtiTelemetry> {
  try {
    const [front, frontMeta, brent, rbob, heatingOil, dxy, cushing, bars] = await Promise.all([
      getYahooSymbolQuote('CL=F'),
      fetchYahooMeta('CL=F'),
      fetchYahooMeta('BZ=F'),
      fetchYahooMeta('RB=F'),
      fetchYahooMeta('HO=F'),
      fetchYahooPrint('DX-Y.NYB'),
      fetchFredLatest('WCESTUS1'),
      getYahooSymbolCandles('CL=F', '5m', '1d').catch(() => null),
    ])
    const price = front?.price && front.price > 0 ? front.price : frontMeta?.price ?? 0
    markFeed(currentState.fiveFeeds, 'cme_databento', price > 0, 'Yahoo CL, delayed')
    if (!(price > 0)) return currentState.wtiTelemetry

    const brentPx = brent?.price ?? null
    const rbobPx = rbob?.price ?? null
    const hoPx = heatingOil?.price ?? null
    const nextSymbol = frontMeta ? nextWtiContractSymbol(frontMeta.shortName) : null
    const nextMeta = nextSymbol ? await fetchYahooMeta(nextSymbol) : null
    const brentWtiSpread = brentPx ? +(brentPx - price).toFixed(2) : undefined
    let crackSpread321: number | undefined
    if (rbobPx && hoPx) {
      crackSpread321 = +(((2 * rbobPx * 42) + (hoPx * 42) - (3 * price)) / 3).toFixed(2)
    }

    const curveLive = Boolean(nextMeta && nextMeta.price > 0)
    const spread = curveLive ? +(price - nextMeta!.price).toFixed(2) : 0
    const priorSpread = currentState.wtiTelemetry.curveLive ? currentState.wtiTelemetry.promptSpread : null
    const promptSpreadChange = curveLive && priorSpread != null ? +(spread - priorSpread).toFixed(2) : undefined
    const regime = !curveLive ? 'FLAT' : spread > 0.05 ? 'BACKWARDATION' : spread < -0.05 ? 'CONTANGO' : 'FLAT'

    let fiveMinReturnPct: number | undefined
    if (bars && bars.length >= 2) {
      const prevBar = bars[bars.length - 2]!
      const lastBar = bars[bars.length - 1]!
      if (prevBar.close > 0) {
        fiveMinReturnPct = +(((lastBar.close - prevBar.close) / prevBar.close) * 100).toFixed(2)
      }
    }

    const change = front?.change ?? (front?.previous_close ? +(price - front.previous_close).toFixed(2) : 0)
    const changePct = front?.change_pct ?? 0
    currentState.wtiTelemetry = {
      promptPrice: price,
      symbol: 'CL=F',
      change,
      changePct,
      high: front?.high ?? price,
      low: front?.low ?? price,
      previousClose: front?.previous_close ?? price,
      promptSpread: spread,
      curveLive,
      promptSpreadChange,
      fiveMinReturnPct,
      priceLive: true,
      spreadRegime: regime,
      brentPrice: brentPx ?? undefined,
      brentWtiSpread,
      crackSpread321,
      gasolinePrice: rbobPx ?? undefined,
      heatingOilPrice: hoPx ?? undefined,
      timestamp: front?.timestamp || Math.floor(Date.now() / 1000),
      source: curveLive ? `Yahoo CL=F vs ${nextSymbol}` : 'Yahoo CL=F. Next-month contract did not print.',
      updatedAt: new Date().toISOString(),
    }

    const spreadText = curveLive
      ? `M1-M2 ${spread >= 0 ? '+' : ''}$${spread.toFixed(2)}/bbl (${regime}${nextSymbol ? `, ${nextSymbol}` : ''}).`
      : 'M1-M2 spread unavailable. The next listed contract did not print.'
    currentState.today.curve = `${spreadText}${brentWtiSpread !== undefined ? ` Brent-WTI ${brentWtiSpread >= 0 ? '+' : ''}$${brentWtiSpread.toFixed(2)}/bbl.` : ''}`
    currentState.curveSummary = spreadText
    currentState.biasSummary = `WTI ${price.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%). ${spreadText}${crackSpread321 !== undefined ? ` 3:2:1 crack $${crackSpread321.toFixed(2)}.` : ''}`

    if (curveLive && nextSymbol) {
      setPillarMetric(currentState.pillars.curve_structure, 'Prompt Spread', `${spread >= 0 ? '+' : ''}$${spread.toFixed(2)}`, regime)
      setPillarMetric(currentState.pillars.curve_structure, 'Next Contract', nextSymbol, 'Listed month after the front contract')
      setPillarMetric(currentState.pillars.curve_structure, 'Curve Regime', regime, 'Front minus the next month. Positive is backwardation.')
      publishMeasuredPillar(currentState.pillars.curve_structure, spreadText, `Yahoo CL=F vs ${nextSymbol}`)
    }
    if (crackSpread321 !== undefined) {
      setPillarMetric(currentState.pillars.refinery_activity, 'Crack', `$${crackSpread321.toFixed(2)}`, '2*RBOB*42 + HO*42 - 3*WTI, divided by 3')
      publishMeasuredPillar(
        currentState.pillars.refinery_activity,
        `3:2:1 crack $${crackSpread321.toFixed(2)} from RB=F and HO=F. Utilization is not on this feed.`,
        'Yahoo RB=F, HO=F, CL=F'
      )
    }
    if (brentWtiSpread !== undefined) {
      setPillarMetric(
        currentState.pillars.imports_exports,
        'Brent-WTI',
        `${brentWtiSpread >= 0 ? '+' : ''}$${brentWtiSpread.toFixed(2)}`,
        'BZ=F minus CL=F'
      )
      publishMeasuredPillar(
        currentState.pillars.imports_exports,
        `Brent-WTI ${brentWtiSpread >= 0 ? '+' : ''}$${brentWtiSpread.toFixed(2)}/bbl. Export barrels are not on this feed.`,
        'Yahoo BZ=F and CL=F'
      )
    }
    if (dxy && dxy.price > 0) {
      setPillarMetric(
        currentState.pillars.macro_drivers,
        'DXY',
        dxy.price.toFixed(2),
        `${dxy.changePct >= 0 ? '+' : ''}${dxy.changePct.toFixed(2)}% day`
      )
      publishMeasuredPillar(
        currentState.pillars.macro_drivers,
        `DXY ${dxy.price.toFixed(2)} (${dxy.changePct >= 0 ? '+' : ''}${dxy.changePct.toFixed(2)}%). PMI and the policy rate are not on this feed.`,
        'Yahoo DX-Y.NYB'
      )
    }
    if (cushing != null && cushing > 0) {
      setPillarMetric(currentState.pillars.inventories, 'Cushing', cushing.toLocaleString('en-US'), 'FRED WCESTUS1, thousand barrels, latest weekly')
      publishMeasuredPillar(
        currentState.pillars.inventories,
        `Cushing stocks ${cushing.toLocaleString('en-US')} thousand barrels on the latest FRED weekly print. Commercial and SPR stocks are not on this feed.`,
        'FRED WCESTUS1'
      )
      currentState.today.inventories = `Cushing ${cushing.toLocaleString('en-US')} thousand barrels (FRED WCESTUS1). Other stock series are not on this feed.`
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

    currentState.liveOilHeadlines = headlines.slice(0, 10)
    markFeed(currentState.fiveFeeds, 'realtime_news', true, 'Finnhub / Yahoo on load')
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
    biasSummary: 'Waiting for the live WTI, Brent, and crack prints.',
    physicalBalance: 'BALANCED',
    curveSummary: 'Front-month curve has not loaded.',
    wtiTelemetry: {
      promptPrice: 0,
      symbol: 'CL=F',
      change: 0,
      changePct: 0,
      high: 0,
      low: 0,
      previousClose: 0,
      promptSpread: 0,
      curveLive: false,
      priceLive: false,
      spreadRegime: 'FLAT',
      timestamp: Math.floor(Date.now() / 1000),
      source: 'WTI quote has not loaded',
      updatedAt: new Date().toISOString(),
    },
    today: cloneState(DEFAULT_TODAY_FUNDAMENTAL_STATE),
    fiveFeeds: cloneState(DEFAULT_FIVE_FEEDS),
    pillars: cloneState(DEFAULT_PILLARS_STATE),
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
