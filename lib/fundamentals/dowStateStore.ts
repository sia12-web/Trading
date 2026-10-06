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
import {
  blankDriverCards,
  cloneState,
  fetchFredLatest,
  fetchYahooPrint,
  markFeed,
  markFeedsDisconnected,
  oasToBps,
} from '@/lib/fundamentals/liveQuotes'
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

const NOT_ON_FEED = 'Not on this feed.'

function freshDowState(): DowFundamentalDashboardState {
  const telemetry = cloneState(DEFAULT_DOW_TELEMETRY)
  telemetry.ymPrice = 0
  telemetry.ymChange = 0
  telemetry.ymChangePct = 0
  telemetry.contractNotionalValue = 0
  telemetry.esPrice = 0
  telemetry.esChangePct = 0
  telemetry.nqPrice = 0
  telemetry.nqChangePct = 0
  telemetry.rtyPrice = 0
  telemetry.rtyChangePct = 0
  telemetry.us2yNominalYield = 0
  telemetry.us10yNominalYield = 0
  telemetry.yieldCurve2s10sSpreadBps = 0
  telemetry.yieldMoveDriver = 'UNKNOWN'
  telemetry.growthInflationQuadrant = 'UNMEASURED'
  telemetry.dxyIndex = 0
  telemetry.dxyChangePct = 0
  telemetry.oilWtiPrice = 0
  telemetry.oilWtiChangePct = 0
  telemetry.vixIndex = 0
  telemetry.advancersCount = 0
  telemetry.declinersCount = 0
  telemetry.unchangedCount = 0
  telemetry.cvdAggressionStance = 'NEUTRAL'
  telemetry.source = 'Quotes have not loaded'
  telemetry.topConstituentsByWeight = telemetry.topConstituentsByWeight.map((row) => ({
    ...row,
    price: 0,
    dayChange: 0,
    dayChangePct: 0,
    pointContribution: 0,
    priceWeightPct: 0,
    lastEpsSurprise: undefined,
    forwardGuidance: undefined,
  }))
  const today = cloneState(DEFAULT_TODAY_DOW_STATE)
  for (const key of Object.keys(today) as (keyof typeof today)[]) {
    const value = today[key]
    if (typeof value !== 'string' || key === 'upcoming_catalysts') continue
    if (value === 'BULLISH' || value === 'BEARISH' || value === 'MIXED') {
      today[key] = 'NEUTRAL' as never
    } else if (/\d/.test(value) || /Healthy|Robust|Expanding|Leading|Strong/.test(value)) {
      today[key] = NOT_ON_FEED as never
    }
  }
  today.us2y = 'UNAVAILABLE'
  today.us10y = 'UNAVAILABLE'
  today.yield_curve = '2s10s loads when both yields print.'
  today.breadth = 'DJIA name breadth loads from the names that print.'
  today.intraday_bias = 'NEUTRAL'
  today.short_term_bias = 'NEUTRAL'
  today.medium_term_bias = 'NEUTRAL'
  const drivers = cloneState(DEFAULT_DOW_DRIVERS)
  blankDriverCards(drivers)
  const credit = cloneState(DEFAULT_DOW_CREDIT_STATE)
  credit.hygPrice = 0
  credit.hygChangePct = 0
  credit.lqdPrice = 0
  credit.lqdChangePct = 0
  credit.highYieldSpreadBps = 0
  credit.investmentGradeSpreadBps = 0
  credit.bankSectorChangePct = 0
  const industrial = cloneState(DEFAULT_INDUSTRIAL_CYCLE_STATE)
  industrial.ismManufacturingHeadline = 0
  industrial.ismNewOrders = 0
  industrial.ismPricesPaid = 0
  industrial.ismProduction = 0
  industrial.durableGoodsMomPct = 0
  industrial.coreCapitalGoodsOrdersMomPct = 0
  industrial.cyclePhase = 'EXPANSION'
  const contribution = cloneState(DEFAULT_DJIA_CONTRIBUTION_STATE)
  contribution.sumSharePrices = 0
  contribution.totalDayPointsMove = 0
  contribution.top1ContributionPct = 0
  contribution.top3ContributionPct = 0
  contribution.top5ContributionPct = 0
  contribution.equalWeight30ReturnPct = 0
  contribution.priceWeightedDjiaReturnPct = 0
  contribution.contributionConcentration = 'LOW'
  const rotation = cloneState(DEFAULT_DOW_ROTATION_STATE)
  rotation.ymChangePct = 0
  rotation.esChangePct = 0
  rotation.nqChangePct = 0
  rotation.rtyChangePct = 0
  rotation.ymVsNqSpreadPct = 0
  rotation.rotationRegime = 'BALANCED'
  rotation.leadershipSector = 'No sector is leading until YM and NQ both print'
  rotation.laggingSector = 'No sector is lagging until YM and NQ both print'
  return {
    market: 'CME_YM',
    analystPersona: 'Dow Jones Macro, Cyclical Economy, Earnings and Rotation Analyst',
    updatedAt: new Date().toISOString(),
    overallBias: 'NEUTRAL',
    overallConfidence: 0,
    biasSummary: 'Waiting for the live YM, yield, and credit prints.',
    dowTelemetry: telemetry,
    today,
    contribution,
    rotation,
    credit,
    industrial,
    drivers,
    feeds: markFeedsDisconnected(cloneState(DEFAULT_DOW_FEEDS)),
    recentEvents: [],
    liveHeadlines: [],
  }
}

let currentDowState: DowFundamentalDashboardState = freshDowState()

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
      fred2y,
      vixQuote,
      dxyQuote,
      wtiQuote,
      hygQuote,
      lqdQuote,
      xliQuote,
      xlfQuote,
      xlkQuote,
      fredHyOas,
      fredIgOas,
      unhQuote,
      gsQuote,
      msftQuote,
      hdQuote,
      catQuote,
      baQuote,
    ] = await Promise.all([
      fetchYahooPrint('YM=F'),
      fetchYahooPrint('^DJI'),
      fetchYahooPrint('ES=F'),
      fetchYahooPrint('NQ=F'),
      fetchYahooPrint('RTY=F'),
      fetchYahooPrint('^TNX'),
      fetchFredLatest('DGS2'),
      fetchYahooPrint('^VIX'),
      fetchYahooPrint('DX-Y.NYB'),
      fetchYahooPrint('CL=F'),
      fetchYahooPrint('HYG'),
      fetchYahooPrint('LQD'),
      fetchYahooPrint('XLI'),
      fetchYahooPrint('XLF'),
      fetchYahooPrint('XLK'),
      fetchFredLatest('BAMLH0A0HYM2'),
      fetchFredLatest('BAMLC0A0CM'),
      fetchYahooPrint('UNH'),
      fetchYahooPrint('GS'),
      fetchYahooPrint('MSFT'),
      fetchYahooPrint('HD'),
      fetchYahooPrint('CAT'),
      fetchYahooPrint('BA'),
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
    const had10y = prior10y > 0
    if (tnxQuote && tnxQuote.price > 0) {
      t.us10yNominalYield = tnxQuote.price
    }
    if (fred2y != null && fred2y > 0) {
      t.us2yNominalYield = fred2y
    }
    if (fred2y != null && fred2y > 0 && t.us10yNominalYield > 0) {
      t.yieldCurve2s10sSpreadBps = Math.round((t.us10yNominalYield - t.us2yNominalYield) * 100)
    } else {
      t.yieldCurve2s10sSpreadBps = 0
    }

    if (tnxQuote && tnxQuote.price > 0 && had10y) {
      const yieldChangeBps = (t.us10yNominalYield - prior10y) * 100
      t.yieldMoveDriver = classifyYieldMoveDriver({
        yieldChangeBps,
        growthSignal: t.ymChangePct > 0 ? 'UP' : t.ymChangePct < -0.3 ? 'DOWN' : 'NEUTRAL',
        inflationSignal: 'NEUTRAL',
        fedSignal: 'NEUTRAL',
      })
    } else if (!(tnxQuote && tnxQuote.price > 0)) {
      t.yieldMoveDriver = 'UNKNOWN'
    }

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
      currentDowState.credit.highYieldSpreadBps = oasToBps(fredHyOas)
    }
    if (fredIgOas !== null) {
      currentDowState.credit.investmentGradeSpreadBps = oasToBps(fredIgOas)
    }
    if (xlfQuote && xlfQuote.price > 0) {
      currentDowState.credit.bankSectorChangePct = xlfQuote.changePct
    }
    const hyBps = currentDowState.credit.highYieldSpreadBps
    if (fredHyOas !== null && hyBps > 0) {
      currentDowState.credit.creditStressRegime =
        hyBps > 450 ? 'ACUTE_DISLOCATION' : hyBps > 380 ? 'STRESS_WIDENING' : hyBps < 300 ? 'MILD_COMPRESSION' : 'HEALTHY_EXPANSION'
    }

    const rotationReady = Boolean(ymQuote && esQuote && nqQuote)
    const rot = rotationReady
      ? evaluateSectorRotation({
          ymChangePct: t.ymChangePct,
          esChangePct: t.esChangePct,
          nqChangePct: t.nqChangePct,
          rtyChangePct: rtyQuote ? t.rtyChangePct : 0,
        })
      : currentDowState.rotation
    if (rotationReady) currentDowState.rotation = rot

    // 7. Update Top DJIA Constituent Live Prices
    const constituents = [...t.topConstituentsByWeight]
    const updateMap: Record<string, { price: number; changePct: number; previousClose: number | null }> = {}
    if (unhQuote) updateMap['UNH'] = unhQuote
    if (gsQuote) updateMap['GS'] = gsQuote
    if (msftQuote) updateMap['MSFT'] = msftQuote
    if (hdQuote) updateMap['HD'] = hdQuote
    if (catQuote) updateMap['CAT'] = catQuote
    if (baQuote) updateMap['BA'] = baQuote

    let adv = 0
    let dec = 0
    let priced = 0
    for (const c of constituents) {
      const u = updateMap[c.symbol]
      if (!u) continue
      priced += 1
      c.price = u.price
      c.dayChangePct = u.changePct
      c.dayChange = u.previousClose ? +(u.price - u.previousClose).toFixed(2) : +(u.price * (u.changePct / 100)).toFixed(2)
      if (c.dayChangePct > 0) adv++
      else if (c.dayChangePct < 0) dec++
    }
    t.advancersCount = adv
    t.declinersCount = dec
    t.unchangedCount = Math.max(0, priced - adv - dec)

    // 8. Recompute Price Weighting & Point Contributions
    const pricedNamesForMath = constituents.filter((row) => row.price > 0)
    const contrib = computeDjiaContributions(pricedNamesForMath.length > 0 ? pricedNamesForMath : [], t.dowDivisor)
    currentDowState.contribution = contrib
    t.topConstituentsByWeight = constituents

    t.timestamp = Math.floor(Date.now() / 1000)
    t.updatedAt = new Date().toISOString()

    // 9. Sync Live Metrics into Drivers
    if (currentDowState.drivers.fed_rates) {
      const d = currentDowState.drivers.fed_rates
      if (d.metrics[0]) {
        d.metrics[0].value = fred2y != null && fred2y > 0 ? `${t.us2yNominalYield.toFixed(2)}%` : 'UNAVAILABLE'
      }
      if (d.metrics[1]) d.metrics[1].value = tnxQuote && t.us10yNominalYield > 0 ? `${t.us10yNominalYield.toFixed(2)}%` : 'UNAVAILABLE'
      if (d.metrics[2]) d.metrics[2].value = t.yieldMoveDriver
      d.summary = `2Y ${fred2y != null && fred2y > 0 ? t.us2yNominalYield.toFixed(2) + '%' : 'UNAVAILABLE'}, 10Y ${tnxQuote && t.us10yNominalYield > 0 ? t.us10yNominalYield.toFixed(2) + '%' : 'UNAVAILABLE'}.`
    }
    if (currentDowState.drivers.credit_conditions) {
      const d = currentDowState.drivers.credit_conditions
      if (d.metrics[0]) {
        d.metrics[0].value = currentDowState.credit.highYieldSpreadBps > 0 ? `${currentDowState.credit.highYieldSpreadBps} bps` : '—'
      }
      if (d.metrics[1]) {
        d.metrics[1].value = currentDowState.credit.investmentGradeSpreadBps > 0 ? `${currentDowState.credit.investmentGradeSpreadBps} bps` : '—'
      }
      if (d.metrics[2]) {
        d.metrics[2].value = currentDowState.credit.hygPrice > 0 ? `$${currentDowState.credit.hygPrice.toFixed(2)}` : '—'
      }
      d.summary = currentDowState.credit.highYieldSpreadBps > 0
        ? `High-yield OAS ${currentDowState.credit.highYieldSpreadBps} bps. Investment-grade OAS ${currentDowState.credit.investmentGradeSpreadBps > 0 ? `${currentDowState.credit.investmentGradeSpreadBps} bps` : 'did not print'}.`
        : 'Credit OAS did not print.'
    }
    if (currentDowState.drivers.sector_rotation) {
      const d = currentDowState.drivers.sector_rotation
      if (d.metrics[0]) {
        d.metrics[0].value = rotationReady ? `${rot.ymVsNqSpreadPct >= 0 ? '+' : ''}${rot.ymVsNqSpreadPct}%` : '—'
      }
      if (d.metrics[1] && xliQuote && xlkQuote && xlkQuote.price > 0) {
        d.metrics[1].value = `${(xliQuote.price / xlkQuote.price).toFixed(2)}x`
      }
      if (d.metrics[2]) d.metrics[2].value = rtyQuote ? `${t.rtyChangePct >= 0 ? '+' : ''}${t.rtyChangePct.toFixed(2)}%` : '—'
      d.summary = rotationReady ? `${rot.rotationRegime}. ${rot.leadershipSector}.` : 'Rotation waits until YM, ES, and NQ all print.'
    }

    // 10. Sync TODAY'S state strings (Item 35: 24 points)
    const twoYearText = fred2y != null && fred2y > 0 ? `${t.us2yNominalYield.toFixed(2)}%` : 'UNAVAILABLE'
    const curveBps = t.yieldCurve2s10sSpreadBps
    currentDowState.today.us2y = twoYearText
    currentDowState.today.us10y = tnxQuote && t.us10yNominalYield > 0 ? `${t.us10yNominalYield.toFixed(2)}%` : 'UNAVAILABLE'
    currentDowState.today.yield_curve = fred2y != null && fred2y > 0 && t.us10yNominalYield > 0
      ? `2s10s ${curveBps >= 0 ? '+' : ''}${curveBps} bps (${t.yieldMoveDriver}).`
      : '2s10s is unavailable until both the 2Y and 10Y print.'
    currentDowState.today.credit = currentDowState.credit.highYieldSpreadBps > 0
      ? `${currentDowState.credit.creditStressRegime}: High-yield OAS ${currentDowState.credit.highYieldSpreadBps} bps${currentDowState.credit.hygPrice > 0 ? `; HYG $${currentDowState.credit.hygPrice.toFixed(2)}` : ''}.`
      : 'High-yield OAS did not print.'
    const pricedNames = t.advancersCount + t.declinersCount + t.unchangedCount
    currentDowState.today.breadth = pricedNames > 0
      ? `${t.advancersCount} up, ${t.declinersCount} down, ${t.unchangedCount} unchanged among ${pricedNames} DJIA names with a live print.`
      : 'DJIA name breadth unavailable.'
    const tenYearLabel = tnxQuote && t.us10yNominalYield > 0 ? `${t.us10yNominalYield.toFixed(2)}%` : '—'
    const oasLabel = currentDowState.credit.highYieldSpreadBps > 0 ? `${currentDowState.credit.highYieldSpreadBps} bps` : '—'
    currentDowState.biasSummary = t.ymPrice > 0
      ? `YM ${t.ymPrice.toFixed(2)} (${t.ymChangePct >= 0 ? '+' : ''}${t.ymChangePct.toFixed(2)}%). 10Y ${tenYearLabel}. HY OAS ${oasLabel}.`
      : 'Waiting for the live YM print.'
    currentDowState.today.contribution_concentration = pricedNamesForMath.length > 0
      ? `${contrib.contributionConcentration}: among ${pricedNamesForMath.length} priced names, the top 3 point movers are ${contrib.top3ContributionPct.toFixed(1)}% of the absolute points.`
      : 'DJIA point contribution waits for live share prices.'
    currentDowState.today.sector_rotation = rotationReady
      ? `${rot.rotationRegime}: ${rot.leadershipSector}. YM vs NQ ${rot.ymVsNqSpreadPct >= 0 ? '+' : ''}${rot.ymVsNqSpreadPct}%.`
      : 'Rotation waits until YM, ES, and NQ all print.'
    markFeed(currentDowState.feeds, 'cme_globex_ym', Boolean((ymQuote && ymQuote.price > 0) || (djiQuote && djiQuote.price > 0)))
    markFeed(currentDowState.feeds, 'rates_yield_curve_engine', Boolean(tnxQuote || (fred2y != null && fred2y > 0)), 'Yahoo ^TNX / FRED')
    markFeed(currentDowState.feeds, 'credit_corporate_bonds', fredHyOas != null, 'FRED OAS')
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

    currentDowState.liveHeadlines = headlines.slice(0, 10)
    markFeed(currentDowState.feeds, 'institutional_wire_deduplicator', true, 'Finnhub / Yahoo on load')
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
  currentDowState = freshDowState()
  return currentDowState
}

/** In-memory specialist state. Does not refresh network feeds. */
export function peekDowFundamentalState(): DowFundamentalDashboardState {
  return currentDowState
}
