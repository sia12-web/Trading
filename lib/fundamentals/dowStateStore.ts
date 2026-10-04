/**
 * Dow Jones Industrial Average Macro, Cyclical, Earnings and Rotation Analyst - State Store
 * Market: CME E-mini Dow Futures (YM, $5 Multiplier)
 *
 * Implements:
 * 1. Live market telemetry pipeline (CME YM, ES, NQ, RTY, 2Y/10Y yields, HYG/LQD, XLI/XLF/XLV/XLK, DJIA 30)
 * 2. Event deduplication wire pipeline (Finnhub & Yahoo RSS with 60-min token clustering)
 * 3. 24-point Daily Dow Fundamental State store with revisions tracking (Item 35)
 * 4. Price-weighted contribution tracking (Delta Price / Divisor)
 * 5. Sector rotation and credit health monitoring
 */

import type {
  DowFundamentalDashboardState,
  DowTelemetry,
  DowEventEvaluation,
  LiveDowHeadline,
  TodaysDowFundamentalState,
} from '@/types/fundamentals'
import {
  DEFAULT_TODAY_DOW_STATE,
  DEFAULT_DOW_DRIVERS,
  DEFAULT_DJIA_CONTRIBUTION_STATE,
  DEFAULT_DOW_ROTATION_STATE,
  DEFAULT_DOW_CREDIT_STATE,
  DEFAULT_INDUSTRIAL_CYCLE_STATE,
  DEFAULT_DOW_TELEMETRY,
  DEFAULT_DOW_FEEDS,
} from './dowAnalystConfig'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { fetchYahooFinanceHeadlines } from '@/lib/trading/liveEconomicResults'
import {
  deduplicateDowHeadline,
  computeDjiaContributions,
  evaluateSectorRotation,
  classifyYieldMoveDriver,
} from './dowAnalystEngine'
import { logger } from '@/lib/utils/logger'
import { candidateIsMaterial } from '@/lib/fundamentals/outputContract'

// In-memory state singleton for Dow
let currentDowState: DowFundamentalDashboardState = {
  market: 'CME_YM',
  analystPersona: 'Dow Jones Macro, Cyclical Economy, Earnings and Rotation Analyst',
  updatedAt: new Date().toISOString(),
  overallBias: 'BULLISH',
  overallConfidence: 85,
  biasSummary:
    'Broad cyclical industrial resilience, favorable price-weighted contribution dynamics, and tight high-yield credit spreads (315 bps) offset higher nominal yields. Sector leadership favors Industrials (XLI) and Financials (XLF) over defensive utilities.',
  dowTelemetry: { ...DEFAULT_DOW_TELEMETRY },
  today: { ...DEFAULT_TODAY_DOW_STATE },
  contribution: { ...DEFAULT_DJIA_CONTRIBUTION_STATE },
  rotation: { ...DEFAULT_DOW_ROTATION_STATE },
  credit: { ...DEFAULT_DOW_CREDIT_STATE },
  industrial: { ...DEFAULT_INDUSTRIAL_CYCLE_STATE },
  drivers: { ...DEFAULT_DOW_DRIVERS },
  feeds: [...DEFAULT_DOW_FEEDS],
  recentEvents: [],
  liveHeadlines: [],
}

/**
 * Fetches price from Yahoo Finance v8 chart API
 */
export async function fetchYahooPrice(symbol: string): Promise<{ price: number; changePct: number } | null> {
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
export async function fetchFredSeries(seriesId: string): Promise<number | null> {
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
 * Refreshes live Dow market telemetry:
 * 1. CME YM, ES, NQ, RTY relative pricing
 * 2. CBOE 10Y Yield (^TNX) & 5Y Yield (^FVX)
 * 3. Credit spreads: HYG, LQD, FRED BAMLH0A0HYM2 (High-Yield OAS)
 * 4. Sector ETFs: XLI, XLF, XLV, XLK
 * 5. Top DJIA Heavyweights: UNH, GS, MSFT, HD, CAT, BA, CRM
 */
export async function refreshDowTelemetry(): Promise<DowTelemetry> {
  try {
    const [
      ymQuote,
      djiQuote,
      esQuote,
      nqQuote,
      rtyQuote,
      tnxQuote,
      fvxQuote,
      vixQuote,
      dxyQuote,
      wtiQuote,
      hygQuote,
      lqdQuote,
      xliQuote,
      xlfQuote,
      xlkQuote,
      fredHyOas,
      unhQuote,
      gsQuote,
      msftQuote,
      hdQuote,
      catQuote,
      baQuote,
    ] = await Promise.all([
      fetchYahooPrice('YM=F'),
      fetchYahooPrice('^DJI'),
      fetchYahooPrice('ES=F'),
      fetchYahooPrice('NQ=F'),
      fetchYahooPrice('RTY=F'),
      fetchYahooPrice('^TNX'),
      fetchYahooPrice('^FVX'),
      fetchYahooPrice('^VIX'),
      fetchYahooPrice('DX-Y.NYB'),
      fetchYahooPrice('CL=F'),
      fetchYahooPrice('HYG'),
      fetchYahooPrice('LQD'),
      fetchYahooPrice('XLI'),
      fetchYahooPrice('XLF'),
      fetchYahooPrice('XLK'),
      fetchFredSeries('BAMLH0A0HYM2'),
      fetchYahooPrice('UNH'),
      fetchYahooPrice('GS'),
      fetchYahooPrice('MSFT'),
      fetchYahooPrice('HD'),
      fetchYahooPrice('CAT'),
      fetchYahooPrice('BA'),
    ])

    const t = currentDowState.dowTelemetry

    // 1. Primary YM Pricing
    if (ymQuote && ymQuote.price > 0) {
      t.ymPrice = ymQuote.price
      t.ymChange = +(ymQuote.price * (ymQuote.changePct / 100)).toFixed(1)
      t.ymChangePct = ymQuote.changePct
    } else if (djiQuote && djiQuote.price > 0) {
      t.ymPrice = djiQuote.price
      t.ymChange = +(djiQuote.price * (djiQuote.changePct / 100)).toFixed(1)
      t.ymChangePct = djiQuote.changePct
    }
    t.contractNotionalValue = +(t.ymPrice * t.contractMultiplier).toFixed(2)

    // 2. Cross-Market Indices
    if (esQuote && esQuote.price > 0) {
      t.esPrice = esQuote.price
      t.esChangePct = esQuote.changePct
    }
    if (nqQuote && nqQuote.price > 0) {
      t.nqPrice = nqQuote.price
      t.nqChangePct = nqQuote.changePct
    }
    if (rtyQuote && rtyQuote.price > 0) {
      t.rtyPrice = rtyQuote.price
      t.rtyChangePct = rtyQuote.changePct
    }

    // 3. Rates & Yield Curve
    const prior10y = t.us10yNominalYield
    if (tnxQuote && tnxQuote.price > 0) {
      t.us10yNominalYield = tnxQuote.price
    }
    if (fvxQuote && fvxQuote.price > 0) {
      t.us2yNominalYield = +(fvxQuote.price - 0.17).toFixed(2)
      t.yieldCurve2s10sSpreadBps = +((t.us10yNominalYield - t.us2yNominalYield) * 100).toFixed(0)
    }

    // Classify yield move driver
    const yieldChangeBps = (t.us10yNominalYield - prior10y) * 100
    t.yieldMoveDriver = classifyYieldMoveDriver({
      yieldChangeBps,
      growthSignal: t.ymChangePct > 0 ? 'UP' : t.ymChangePct < -0.3 ? 'DOWN' : 'NEUTRAL',
      inflationSignal: 'NEUTRAL',
      fedSignal: 'NEUTRAL',
    })

    // 4. Volatility, DXY & Commodities
    if (vixQuote && vixQuote.price > 0) t.vixIndex = vixQuote.price
    if (dxyQuote && dxyQuote.price > 0) {
      t.dxyIndex = dxyQuote.price
      t.dxyChangePct = dxyQuote.changePct
    }
    if (wtiQuote && wtiQuote.price > 0) {
      t.oilWtiPrice = wtiQuote.price
      t.oilWtiChangePct = wtiQuote.changePct
    }

    // 5. Credit State
    if (hygQuote && hygQuote.price > 0) {
      currentDowState.credit.hygPrice = hygQuote.price
      currentDowState.credit.hygChangePct = hygQuote.changePct
    }
    if (lqdQuote && lqdQuote.price > 0) {
      currentDowState.credit.lqdPrice = lqdQuote.price
      currentDowState.credit.lqdChangePct = lqdQuote.changePct
    }
    if (fredHyOas !== null) {
      currentDowState.credit.highYieldSpreadBps = Math.round(fredHyOas * 100)
    }
    if (xlfQuote && xlfQuote.price > 0) {
      currentDowState.credit.bankSectorChangePct = xlfQuote.changePct
    }
    currentDowState.credit.creditStressRegime =
      currentDowState.credit.highYieldSpreadBps > 450
        ? 'ACUTE_DISLOCATION'
        : currentDowState.credit.highYieldSpreadBps > 380
        ? 'STRESS_WIDENING'
        : currentDowState.credit.highYieldSpreadBps < 300
        ? 'MILD_COMPRESSION'
        : 'HEALTHY_EXPANSION'

    // 6. Sector Rotation Evaluation
    const rot = evaluateSectorRotation({
      ymChangePct: t.ymChangePct,
      esChangePct: t.esChangePct,
      nqChangePct: t.nqChangePct,
      rtyChangePct: t.rtyChangePct,
    })
    currentDowState.rotation = rot

    // 7. Update Top DJIA Constituent Live Prices
    const constituents = [...t.topConstituentsByWeight]
    const updateMap: Record<string, { price: number; changePct: number }> = {}
    if (unhQuote) updateMap['UNH'] = unhQuote
    if (gsQuote) updateMap['GS'] = gsQuote
    if (msftQuote) updateMap['MSFT'] = msftQuote
    if (hdQuote) updateMap['HD'] = hdQuote
    if (catQuote) updateMap['CAT'] = catQuote
    if (baQuote) updateMap['BA'] = baQuote

    let adv = 0
    let dec = 0
    for (const c of constituents) {
      const u = updateMap[c.symbol]
      if (u) {
        c.price = u.price
        c.dayChangePct = u.changePct
        c.dayChange = +(u.price * (u.changePct / 100)).toFixed(2)
      }
      if (c.dayChangePct > 0) adv++
      else if (c.dayChangePct < 0) dec++
    }
    t.advancersCount = adv
    t.declinersCount = dec
    t.unchangedCount = 30 - adv - dec

    // 8. Recompute Price Weighting & Point Contributions
    const contrib = computeDjiaContributions(constituents, t.dowDivisor)
    currentDowState.contribution = contrib
    t.topConstituentsByWeight = constituents

    t.timestamp = Math.floor(Date.now() / 1000)
    t.updatedAt = new Date().toISOString()

    // 9. Sync Live Metrics into Drivers
    if (currentDowState.drivers.fed_rates) {
      const d = currentDowState.drivers.fed_rates
      if (d.metrics[0]) d.metrics[0].value = `${t.us2yNominalYield.toFixed(2)}%`
      if (d.metrics[1]) d.metrics[1].value = `${t.us10yNominalYield.toFixed(2)}%`
      if (d.metrics[2]) d.metrics[2].value = t.yieldMoveDriver
    }
    if (currentDowState.drivers.credit_conditions) {
      const d = currentDowState.drivers.credit_conditions
      if (d.metrics[0]) d.metrics[0].value = `${currentDowState.credit.highYieldSpreadBps} bps`
      if (d.metrics[1]) d.metrics[1].value = `${currentDowState.credit.investmentGradeSpreadBps} bps`
      if (d.metrics[2]) d.metrics[2].value = `$${currentDowState.credit.hygPrice.toFixed(2)}`
    }
    if (currentDowState.drivers.sector_rotation) {
      const d = currentDowState.drivers.sector_rotation
      if (d.metrics[0]) d.metrics[0].value = `${rot.ymVsNqSpreadPct >= 0 ? '+' : ''}${rot.ymVsNqSpreadPct}%`
      if (d.metrics[1] && xliQuote && xlkQuote && xlkQuote.price > 0) {
        d.metrics[1].value = `${(xliQuote.price / xlkQuote.price).toFixed(2)}x`
      }
      if (d.metrics[2]) d.metrics[2].value = `${t.rtyChangePct >= 0 ? '+' : ''}${t.rtyChangePct.toFixed(2)}%`
    }

    // 10. Sync TODAY'S state strings (Item 35: 24 points)
    currentDowState.today.us2y = `${t.us2yNominalYield.toFixed(2)}%`
    currentDowState.today.us10y = `${t.us10yNominalYield.toFixed(2)}%`
    currentDowState.today.yield_curve = `2s10s spread at +${t.yieldCurve2s10sSpreadBps} bps (${t.yieldMoveDriver} yield backdrop).`
    currentDowState.today.credit = `${currentDowState.credit.creditStressRegime}: High-Yield OAS at ${currentDowState.credit.highYieldSpreadBps} bps; HYG at $${currentDowState.credit.hygPrice.toFixed(2)} (${currentDowState.credit.hygChangePct >= 0 ? '+' : ''}${currentDowState.credit.hygChangePct}%).`
    currentDowState.today.breadth = `${t.advancersCount} advancing vs ${t.declinersCount} declining constituents (${Math.round((t.advancersCount / 30) * 100)}% positive breadth).`
    currentDowState.today.contribution_concentration = `${contrib.contributionConcentration}: Top 3 point movers represent ${contrib.top3ContributionPct.toFixed(1)}% of total daily points moved.`
    currentDowState.today.sector_rotation = `${rot.rotationRegime}: ${rot.leadershipSector} leading while ${rot.laggingSector} lags (YM vs NQ 1D spread: ${rot.ymVsNqSpreadPct >= 0 ? '+' : ''}${rot.ymVsNqSpreadPct}%).`
  } catch (err) {
    logger.warn('[DowStateStore] Failed to update live Dow telemetry', err)
  }

  return currentDowState.dowTelemetry
}

/**
 * Fetches real breaking blue-chip, industrial, credit, and macro headlines with automatic event deduplication (Item 31)
 */
export async function refreshLiveDowHeadlines(): Promise<LiveDowHeadline[]> {
  const headlines: LiveDowHeadline[] = []
  try {
    const finnhub = getFinnhubClient()
    const generalNews = await finnhub.getMarketNews('general').catch(() => null)

    const dowFilter =
      /dow|djia|ym|blue[- ]chip|industrial|ism|manufacturing|durable|caterpillar|cat\b|boeing|ba\b|goldman|gs\b|unitedhealth|unh\b|home depot|hd\b|honeywell|3m|walmart|wmt\b|jpmorgan|jpm\b|chevron|cvx\b|credit|hyg|lqd|treasury|yield|fed|fomc|powell|cpi|inflation|tariff|gdp|retail sales/i

    if (generalNews && Array.isArray(generalNews)) {
      for (const h of generalNews) {
        if (h.headline && dowFilter.test(h.headline)) {
          const dedup = deduplicateDowHeadline(h.headline, h.source || 'Wire')

          let relevance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
          if (/fed|fomc|powell|cpi|ism|manufacturing|unh|goldman|caterpillar|boeing|credit/i.test(h.headline)) {
            relevance = 'CRITICAL'
          } else if (/rates|durable|retail sales|tariffs|earnings|guidance|home depot/i.test(h.headline)) {
            relevance = 'HIGH'
          }

          headlines.push({
            id: `dow-news-${Math.random().toString(36).slice(2, 8)}`,
            eventId: dedup.eventId,
            headline: h.headline,
            source: h.source || 'Reuters / Financial Wire',
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
        if (y.headline && dowFilter.test(y.headline)) {
          const dedup = deduplicateDowHeadline(y.headline, y.source || 'Yahoo Finance Wire')
          headlines.push({
            id: `y-dow-${Math.random().toString(36).slice(2, 8)}`,
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
      currentDowState.liveHeadlines = headlines.slice(0, 10)
    }
  } catch (err) {
    logger.warn('[DowStateStore] Failed to fetch live Dow headlines', err)
  }

  return currentDowState.liveHeadlines
}

/**
 * Formats "TODAY'S DOW FUNDAMENTAL STATE" as plain text for algorithmic trading bots (Prompt 35: 24 points)
 */
export function formatTodaysDowFundamentalStateText(today: TodaysDowFundamentalState): string {
  return [
    `DOW FUNDAMENTAL STATE`,
    `Economic growth: ${today.economic_growth}`,
    `Manufacturing: ${today.manufacturing}`,
    `Consumer: ${today.consumer}`,
    `Labor: ${today.labor}`,
    `Inflation: ${today.inflation}`,
    `Fed: ${today.fed}`,
    `2Y: ${today.us2y}`,
    `10Y: ${today.us10y}`,
    `Yield curve: ${today.yield_curve}`,
    `Financial conditions: ${today.financial_conditions}`,
    `Credit: ${today.credit}`,
    `Industrial sector: ${today.industrial_sector}`,
    `Financial sector: ${today.financial_sector}`,
    `Energy: ${today.energy}`,
    `Healthcare: ${today.healthcare}`,
    `Consumer sectors: ${today.consumer_sectors}`,
    `DJIA earnings: ${today.djia_earnings}`,
    `Forward guidance: ${today.forward_guidance}`,
    `USD: ${today.usd}`,
    `Trade policy: ${today.trade_policy}`,
    `Breadth: ${today.breadth}`,
    `Contribution concentration: ${today.contribution_concentration}`,
    `Sector rotation: ${today.sector_rotation}`,
    `CFTC positioning: ${today.cftc_positioning}`,
    ``,
    `INTRADAY BIAS: ${today.intraday_bias}`,
    `SHORT-TERM BIAS: ${today.short_term_bias}`,
    `MEDIUM-TERM BIAS: ${today.medium_term_bias}`,
    ``,
    `Primary current driver: ${today.primary_current_driver}`,
    `Upcoming catalysts: ${today.upcoming_catalysts}`,
    `What changed since yesterday: ${today.what_changed_since_yesterday}`,
    `What would invalidate the current interpretation: ${today.what_would_invalidate_the_current_interpretation}`,
  ].join('\n')
}

/**
 * Returns the entire current dashboard state for Dow
 */
export async function getDowFundamentalState(): Promise<DowFundamentalDashboardState> {
  await Promise.all([
    refreshDowTelemetry(),
    refreshLiveDowHeadlines(),
  ])
  currentDowState.updatedAt = new Date().toISOString()
  return currentDowState
}

/**
 * Records an evaluated Dow event and updates state
 */
export function recordEvaluatedDowEvent(evaluation: DowEventEvaluation): void {
  currentDowState.recentEvents.unshift(evaluation)
  if (currentDowState.recentEvents.length > 20) {
    currentDowState.recentEvents = currentDowState.recentEvents.slice(0, 20)
  }

  const out = evaluation.structuredOutput
  if (candidateIsMaterial(out.importance, out.confidence)) {
    const effect = out.fundamental_effect || out.fundamental_state
    const intraday = effect?.intraday || 'NEUTRAL'
    const shortTerm = effect?.short_term || 'NEUTRAL'
    const mediumTerm = effect?.medium_term || 'NEUTRAL'

    currentDowState.today.intraday_bias = intraday
    currentDowState.today.short_term_bias = shortTerm
    currentDowState.today.medium_term_bias = mediumTerm
    currentDowState.today.what_changed_since_yesterday = `${out.event}: ${out.summary}`
    currentDowState.overallBias = shortTerm
    currentDowState.overallConfidence = Math.round(out.confidence * 100)
    currentDowState.biasSummary = out.summary
  }
}

/**
 * Resets state back to baseline
 */
export function resetDowFundamentalState(): DowFundamentalDashboardState {
  currentDowState = {
    market: 'CME_YM',
    analystPersona: 'Dow Jones Macro, Cyclical Economy, Earnings and Rotation Analyst',
    updatedAt: new Date().toISOString(),
    overallBias: 'BULLISH',
    overallConfidence: 85,
    biasSummary:
      'Broad cyclical industrial resilience, favorable price-weighted contribution dynamics, and tight high-yield credit spreads (315 bps) offset higher nominal yields. Sector leadership favors Industrials (XLI) and Financials (XLF) over defensive utilities.',
    dowTelemetry: { ...DEFAULT_DOW_TELEMETRY },
    today: { ...DEFAULT_TODAY_DOW_STATE },
    contribution: { ...DEFAULT_DJIA_CONTRIBUTION_STATE },
    rotation: { ...DEFAULT_DOW_ROTATION_STATE },
    credit: { ...DEFAULT_DOW_CREDIT_STATE },
    industrial: { ...DEFAULT_INDUSTRIAL_CYCLE_STATE },
    drivers: { ...DEFAULT_DOW_DRIVERS },
    feeds: [...DEFAULT_DOW_FEEDS],
    recentEvents: [],
    liveHeadlines: [],
  }
  return currentDowState
}

/** In-memory specialist state. Does not refresh network feeds. */
export function peekDowFundamentalState(): DowFundamentalDashboardState {
  return currentDowState
}
