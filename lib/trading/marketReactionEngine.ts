/**
 * Market Reaction Engine
 * Computes live, cross-asset price reactions and percentage moves across CME futures
 * (YM/MYM, NQ/MNQ, NKD, GC/MGC, SI/SIL, CL/MCL) following Tier-1 macro catalysts
 * (CPI, Core CPI, PPI, NFP, Unemployment, FOMC Rate Decisions, Retail Sales).
 */

import type { YahooQuote } from '@/lib/yahoo/quote'
import type { DeskCalendarEvent, DeskNewsInstrument } from '@/lib/trading/deskNews'
import { isHighImpact, parseCalendarEventMs } from '@/lib/trading/deskNewsHazard'

export type AnalysisMarket = 'YM' | 'NQ' | 'NKD' | 'GC' | 'SI' | 'CL'

export interface MarketReactionAssetTelemetry {
  instrument: AnalysisMarket
  deskInstrument: DeskNewsInstrument
  symbol: string
  executionAlias: string
  name: string
  price: number
  change: number
  changePct: number
  high: number | null
  low: number | null
  rangeLocationPct: number | null
  posture: string
  detail: string
}

export interface MarketReactionReport {
  status: 'ACTIVE_REACTION_VERIFIED' | 'ACTIVE_SESSION_TELEMETRY' | 'UNAVAILABLE'
  primaryEvent: DeskCalendarEvent | null
  elapsedMinutes: number | null
  assets: MarketReactionAssetTelemetry[]
  crossAssetSummary: string
  systemPromptBlock: string
}

function calculateRangeLocationPct(price: number, high: number | null, low: number | null): number | null {
  if (high == null || low == null || high <= low || price < low || price > high) return null
  return Math.round(((price - low) / (high - low)) * 100)
}

function rangeLocationLabel(pct: number | null): string {
  if (pct == null) return ''
  if (pct <= 20) return ` (${pct}% of day range — pinning session lows)`
  if (pct <= 35) return ` (${pct}% of day range — lower third)`
  if (pct >= 80) return ` (${pct}% of day range — pinning session highs)`
  if (pct >= 65) return ` (${pct}% of day range — upper third)`
  return ` (${pct}% of day range — mid-session rotation)`
}

function formatChg(val: number): string {
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(2)}`
}

export function buildMarketReactionReport(params: {
  quotes: {
    YM: YahooQuote | null
    NQ: YahooQuote | null
    NKD: YahooQuote | null
    GC: YahooQuote | null
    SI: YahooQuote | null
    CL: YahooQuote | null
  }
  calendarEvents: DeskCalendarEvent[]
  now?: Date
}): MarketReactionReport {
  const now = params.now || new Date()
  const nowMs = now.getTime()

  // 1. Identify most recent released Tier-1 or macro-moving event within the last 48 hours
  const releasedEvents = (params.calendarEvents || []).filter((e) => {
    const isRel = !!(e.isReleased || (e.actual != null && String(e.actual).trim() !== ''))
    if (!isRel) return false
    const evText = (e.event || '').toLowerCase()
    const isMacroMover =
      isHighImpact(e.impact) ||
      /\b(cpi|inflation|pce|nonfarm|payroll|fomc|fed funds|rate decision|ppi|retail sales|jobless claims)\b/i.test(evText)
    if (!isMacroMover) return false

    const ms = parseCalendarEventMs(e.time, nowMs)
    if (ms == null) return true
    // Released within past 48 hours and not in future
    return nowMs >= ms && nowMs - ms <= 48 * 3600 * 1000
  })

  // Sort by event time descending (most recent first)
  releasedEvents.sort((a, b) => {
    const am = parseCalendarEventMs(a.time, nowMs) ?? 0
    const bm = parseCalendarEventMs(b.time, nowMs) ?? 0
    return bm - am
  })

  const primaryEvent = releasedEvents[0] || null
  const eventMs = primaryEvent ? parseCalendarEventMs(primaryEvent.time, nowMs) : null
  const elapsedMinutes = eventMs != null && nowMs >= eventMs ? Math.round((nowMs - eventMs) / 60000) : null

  // 2. Build asset telemetry
  const meta: Record<
    AnalysisMarket,
    { deskInstrument: DeskNewsInstrument; symbol: string; alias: string; name: string }
  > = {
    NQ: { deskInstrument: 'NASDAQ', symbol: 'NQ', alias: 'MNQ', name: 'Nasdaq 100 Futures' },
    YM: { deskInstrument: 'DOW', symbol: 'YM', alias: 'MYM', name: 'Dow Jones Futures' },
    NKD: { deskInstrument: 'NIKKEI', symbol: 'NKD', alias: 'NKD', name: 'Nikkei 225 Futures' },
    GC: { deskInstrument: 'GOLD', symbol: 'GC', alias: 'MGC', name: 'Gold Futures' },
    SI: { deskInstrument: 'SILVER', symbol: 'SI', alias: 'SIL', name: 'Silver Futures' },
    CL: { deskInstrument: 'CRUDE', symbol: 'CL', alias: 'MCL', name: 'Crude Oil Futures' },
  }

  const assets: MarketReactionAssetTelemetry[] = []

  const instruments: AnalysisMarket[] = ['NQ', 'YM', 'NKD', 'GC', 'SI', 'CL']
  for (const inst of instruments) {
    const q = params.quotes[inst]
    const m = meta[inst]
    if (!q || !(q.price > 0)) {
      assets.push({
        instrument: inst,
        deskInstrument: m.deskInstrument,
        symbol: m.symbol,
        executionAlias: m.alias,
        name: m.name,
        price: 0,
        change: 0,
        changePct: 0,
        high: null,
        low: null,
        rangeLocationPct: null,
        posture: 'QUOTE_UNAVAILABLE',
        detail: 'Quote feed unavailable',
      })
      continue
    }

    const rangePct = calculateRangeLocationPct(q.price, q.high, q.low)
    let posture = 'BALANCED_ROTATION'

    if (inst === 'NQ' || inst === 'YM' || inst === 'NKD') {
      if (q.change_pct <= -1.0) posture = 'AGGRESSIVE_LIQUIDATION'
      else if (q.change_pct <= -0.4) posture = 'BEARISH_EXPANSION'
      else if (q.change_pct < -0.1) posture = 'DEFENSIVE_DRIFT'
      else if (q.change_pct >= 1.0) posture = 'STRONG_RISK_ON_RALLY'
      else if (q.change_pct >= 0.4) posture = 'BULLISH_EXPANSION'
      else if (q.change_pct > 0.1) posture = 'BUYER_INITIATIVE'
    } else if (inst === 'GC' || inst === 'SI') {
      if (q.change_pct >= 0.7) posture = 'STRONG_INFLATION_HEDGE_BID'
      else if (q.change_pct >= 0.25) posture = 'INFLATION_HEDGE_BID'
      else if (q.change_pct <= -0.7) posture = 'HEAVY_YIELD_PRESSURE'
      else if (q.change_pct <= -0.25) posture = 'USD_STRENGTH_HEADWIND'
    } else if (inst === 'CL') {
      if (q.change_pct >= 1.0) posture = 'SUPPLY_CONCERN_SURGE'
      else if (q.change_pct >= 0.3) posture = 'DEMAND_EXPANSION'
      else if (q.change_pct <= -1.0) posture = 'RECESSION_GROWTH_CONCERN'
      else if (q.change_pct <= -0.3) posture = 'DISINFLATION_CRUDE_PULLBACK'
    }

    const rangeNote = rangeLocationLabel(rangePct)
    const detail = `${q.price.toLocaleString()} (${formatChg(q.change)} pts, ${formatChg(q.change_pct)}%)${rangeNote}`

    assets.push({
      instrument: inst,
      deskInstrument: m.deskInstrument,
      symbol: m.symbol,
      executionAlias: m.alias,
      name: m.name,
      price: q.price,
      change: q.change,
      changePct: q.change_pct,
      high: q.high,
      low: q.low,
      rangeLocationPct: rangePct,
      posture,
      detail,
    })
  }

  // 3. Cross-market synthesis
  const nq = assets.find((a) => a.instrument === 'NQ')
  const ym = assets.find((a) => a.instrument === 'YM')
  const gc = assets.find((a) => a.instrument === 'GC')
  const cl = assets.find((a) => a.instrument === 'CL')

  let crossAssetSummary = 'Cross-market telemetry active.'

  const isHotInflation =
    primaryEvent &&
    /cpi|inflation|ppi|pce/i.test(primaryEvent.event) &&
    (primaryEvent.outcome === 'BEAT' || /hot/i.test(primaryEvent.deskNote || ''))

  const isCoolInflation =
    primaryEvent &&
    /cpi|inflation|ppi|pce/i.test(primaryEvent.event) &&
    (primaryEvent.outcome === 'MISS' || /cool/i.test(primaryEvent.deskNote || ''))

  if (isHotInflation) {
    if (nq && nq.changePct < 0) {
      crossAssetSummary =
        'Verified Hot Macro Repricing: Hot inflation print triggered an immediate interest rate repricing across CME desks. Tech and long-duration equities (NQ/MNQ) are experiencing multiple compression under yield pressure. Gold is providing relative resilience as an inflation store.'
    } else {
      crossAssetSummary =
        'Divergent Resilience: Despite hotter inflation data, equities are absorbing selling pressure and holding key session levels.'
    }
  } else if (isCoolInflation) {
    if (nq && nq.changePct > 0) {
      crossAssetSummary =
        'Verified Disinflation Relief Rally: Cooling inflation reading relieved bond yields, prompting aggressive risk-on bids across growth equities (NQ/MNQ) and value (YM/MYM).'
    } else {
      crossAssetSummary =
        'Subdued Disinflation Response: Inflation cooled vs consensus, but broader macro concerns are restraining equity expansion.'
    }
  } else if (nq && ym && gc) {
    const eqAvg = (nq.changePct + ym.changePct) / 2
    if (eqAvg < -0.3 && gc.changePct > 0.2) {
      crossAssetSummary =
        'Risk-Off / Defensive Posture: Equities drifting lower while capital rotates into safe-haven precious metals (GC/SI).'
    } else if (eqAvg > 0.3) {
      crossAssetSummary =
        'Broad Risk-On Posture: Consistent buying initiative across both tech (NQ) and cyclicals (YM).'
    } else {
      crossAssetSummary =
        'Balanced Cross-Asset State: Mixed performance across equities and commodities; no uniform one-way macro trend currently dominating the tape.'
    }
  }

  if (cl && Math.abs(cl.changePct) >= 0.4) {
    const energyNote = cl.changePct > 0
      ? `Crude oil (CL) is expanding +${cl.changePct.toFixed(2)}% on supply/inflation sensitivity.`
      : `Crude oil (CL) is pulling back ${cl.changePct.toFixed(2)}% on demand/growth caution.`
    crossAssetSummary += ` ${energyNote}`
  }

  // 4. Build prompt block
  const status: MarketReactionReport['status'] = primaryEvent
    ? 'ACTIVE_REACTION_VERIFIED'
    : assets.some((a) => a.price > 0)
      ? 'ACTIVE_SESSION_TELEMETRY'
      : 'UNAVAILABLE'

  let eventHeader = 'NO MAJOR TIER-1 RELEASE IN LAST 48 HOURS'
  if (primaryEvent) {
    const elapsedStr =
      elapsedMinutes != null
        ? elapsedMinutes < 60
          ? `${elapsedMinutes}m ago`
          : `${(elapsedMinutes / 60).toFixed(1)}h ago`
        : 'recent'

    const actStr = primaryEvent.actual != null ? `Actual: ${primaryEvent.actual}` : 'Actual: RELEASED'
    const estStr = primaryEvent.estimate != null ? `Consensus Est: ${primaryEvent.estimate}` : 'Consensus: N/A'
    const prevStr = primaryEvent.prev != null ? `Previous: ${primaryEvent.prev}` : 'Prev: N/A'
    const outcomeStr = primaryEvent.outcome ? ` [OUTCOME: ${primaryEvent.outcome}]` : ''
    const headline = primaryEvent.resultHeadline ? ` · ${primaryEvent.resultHeadline}` : ''

    eventHeader = `PRIMARY CATALYST: ${primaryEvent.country} — ${primaryEvent.event} (${actStr} vs ${estStr} | ${prevStr}${outcomeStr}${headline}) — Released ${primaryEvent.time} (~${elapsedStr})`
  }

  const assetLines = assets
    .map((a) => {
      return `- **${a.symbol}** (${a.executionAlias}): ${a.detail} | Posture: \`${a.posture}\``
    })
    .join('\n')

  const systemPromptBlock = `MARKET REACTION ENGINE:
Status: ${status}
${eventHeader}

OBSERVABLE ASSET TELEMETRY:
${assetLines}

CROSS-ASSET SYNTHESIS:
${crossAssetSummary}
(Do not invent technical levels or execution setups. Route deeper interpretation to NQ_AGENT, DOW_AGENT, GOLD_AGENT, OIL_AGENT, NIKKEI_AGENT, and SILVER_AGENT.)`

  return {
    status,
    primaryEvent,
    elapsedMinutes,
    assets,
    crossAssetSummary,
    systemPromptBlock,
  }
}
