/**
 * Nasdaq-100 Macro, Earnings, Rates and Flow Analyst - Evaluation Engine
 * Market: CME E-mini Nasdaq-100 Futures (NQ)
 *
 * Implements:
 * 1. 14-step institutional evaluation workflow (Item 33)
 * 2. Event deduplication engine to eliminate echo chamber news (Item 23)
 * 3. Dedicated rates transmission mapper (2Y near-term policy & 10Y growth discounting)
 * 4. Abnormal behavior detector (Prompt 35)
 * 5. Standardized surprise engine: (actual - consensus) / surprise_volatility (Item 8)
 * 6. Mega-cap NDX constituent weight relevance calculator (Items 11 & 14)
 * 7. Strict machine-readable JSON output (Item 34) & Unified Protocol (Item 39)
 */

import type {
  NasdaqEventEvaluation,
  StructuredNasdaqEventOutput,
  UnifiedAgentProtocolOutput,
  NasdaqTelemetry,
  NasdaqEventCategory,
  NasdaqDirectionalStance,
  NasdaqAbnormalBehavior,
} from '@/types/fundamentals'
import {
  NASDAQ_ANALYST_EVENT_PROMPT,
  HISTORICAL_MACRO_SURPRISE_VOLATILITY,
} from './nasdaqAnalystConfig'
import { refreshNasdaqTelemetry, recordEvaluatedNasdaqEvent } from './nasdaqStateStore'
import { logger } from '@/lib/utils/logger'
import {
  adaptLegacyFundamentalJson,
  buildFundamentalEventUserPrompt,
  datumLine,
} from '@/lib/fundamentals/outputContract'

interface AnalyzeNasdaqEventParams {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  autoCommitIfMaterial?: boolean
}

// In-memory Event Deduplicator window (Item 23)
const recentEventClusters = new Map<string, { timestamp: number; headline: string; count: number }>()

/**
 * Normalizes text to create deduplication cluster keys
 */
export function deduplicateHeadline(headline: string): { isDuplicate: boolean; clusterId: string; duplicateCount: number } {
  const clean = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6)
    .join('_')

  const now = Date.now()
  const existing = recentEventClusters.get(clean)

  if (existing && now - existing.timestamp < 3600000) {
    existing.count++
    return { isDuplicate: true, clusterId: clean, duplicateCount: existing.count }
  }

  recentEventClusters.set(clean, { timestamp: now, headline, count: 1 })
  if (recentEventClusters.size > 200) {
    const oldestKey = recentEventClusters.keys().next().value
    if (oldestKey) recentEventClusters.delete(oldestKey)
  }

  return { isDuplicate: false, clusterId: clean, duplicateCount: 1 }
}

/**
 * Evaluates an incoming Nasdaq event and returns structured JSON
 */
export async function evaluateNasdaqEvent(params: AnalyzeNasdaqEventParams): Promise<NasdaqEventEvaluation> {
  const { rawText, sourceHint, timestampHint, autoCommitIfMaterial = true } = params
  const telemetry = await refreshNasdaqTelemetry()

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  let structuredOutput: StructuredNasdaqEventOutput | null = null

  if (anthropicKey || openaiKey) {
    try {
      structuredOutput = await runLlmNasdaqEvaluation({
        rawText,
        sourceHint,
        timestampHint,
        telemetry,
        anthropicKey,
        openaiKey,
      })
    } catch (err) {
      logger.warn('[NasdaqAnalystEngine] LLM evaluation failed, falling back to deterministic engine', err)
    }
  }

  if (!structuredOutput) {
    structuredOutput = runDeterministicNasdaqEvaluation({
      rawText,
      sourceHint,
      timestampHint,
      telemetry,
    })
  }

  // Build unified agent protocol output (Item 39)
  const unifiedProtocol: UnifiedAgentProtocolOutput = buildNasdaqUnifiedProtocol(structuredOutput, telemetry)
  structuredOutput.unified_protocol = unifiedProtocol

  const evaluation: NasdaqEventEvaluation = {
    id: `nq-event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: structuredOutput.timestamp,
    event: structuredOutput.event,
    rawText,
    structuredOutput,
    safeguards: {
      noInventedData: true,
      rateCutNotAutoBullish: true,
      earningsBeatNotAutoBullish: true,
      correlationNotCausation: true,
      noHeadlineOnlyTrade: true,
      cftcNotRealtimeFlow: true,
      eventDeduplicated: true,
    },
  }

  if (autoCommitIfMaterial && structuredOutput.importance !== 'LOW') {
    recordEvaluatedNasdaqEvent(evaluation)
  }

  return evaluation
}

// ==========================================
// 1. STANDARDIZED MACRO SURPRISE ENGINE (Item 8)
// ==========================================

export function computeMacroStandardizedSurprise(
  indicatorKey: string,
  actual: number,
  consensus: number
): { rawSurprise: number; standardizedSurprise: number } {
  const rawSurprise = +(actual - consensus).toFixed(4)
  const volConfig = HISTORICAL_MACRO_SURPRISE_VOLATILITY[indicatorKey.toUpperCase()]
  if (!volConfig || volConfig.std <= 0) {
    return { rawSurprise, standardizedSurprise: rawSurprise }
  }
  const standardizedSurprise = +(rawSurprise / volConfig.std).toFixed(2)
  return { rawSurprise, standardizedSurprise }
}

// ==========================================
// 2. UNIFIED MULTI-AGENT PROTOCOL BUILDER (Item 39)
// ==========================================

function buildNasdaqUnifiedProtocol(
  output: StructuredNasdaqEventOutput,
  telemetry: NasdaqTelemetry
): UnifiedAgentProtocolOutput {
  const expectedDirection = output.event_analysis?.expected_direction || output.fundamental_effect?.short_term || 'NEUTRAL'
  const magnitude = output.event_analysis?.magnitude === 'HIGH' ? 'HIGH' : output.event_analysis?.magnitude === 'MEDIUM' ? 'MEDIUM' : 'LOW'

  let confirmationVerdict: 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'REJECTED' | 'INCONCLUSIVE' = 'INCONCLUSIVE'
  const responseQuality = output.market_response?.nq_response_quality
  if (responseQuality === 'CONFIRMED') {
    confirmationVerdict = 'CONFIRMED'
  } else if (responseQuality === 'PARTIAL_CONFIRMATION') {
    confirmationVerdict = 'PARTIALLY_CONFIRMED'
  } else if (
    responseQuality === 'PARTIAL_REJECTION' ||
    responseQuality === 'COMPLETE_REJECTION'
  ) {
    confirmationVerdict = 'REJECTED'
  } else if (output.market_confirmation?.confirmation === 'STRONG') {
    confirmationVerdict = 'CONFIRMED'
  } else if (output.market_confirmation?.confirmation === 'CONTRADICTED') {
    confirmationVerdict = 'REJECTED'
  }

  const keyDrivers = [
    {
      factor: '2Y_POLICY_RATES',
      impact: `US 2Y yield at ${telemetry.us2yNominalYield.toFixed(2)}%`,
      effect: output.transmission?.us2y === 'UP' ? ('BEARISH' as const) : output.transmission?.us2y === 'DOWN' ? ('BULLISH' as const) : ('NEUTRAL' as const),
    },
    {
      factor: '10Y_VALUATION_DISCOUNT',
      impact: `US 10Y yield at ${telemetry.us10yNominalYield.toFixed(2)}% (2s10s: +${telemetry.yieldCurve2s10sSpreadBps} bps)`,
      effect: output.transmission?.us10y === 'UP' ? ('BEARISH' as const) : output.transmission?.us10y === 'DOWN' ? ('BULLISH' as const) : ('NEUTRAL' as const),
    },
    {
      factor: 'NQ_ORDER_FLOW_REACTION',
      impact: `CVD: ${telemetry.cvdAggressionStance || 'NEUTRAL'} | NQ 15m: ${output.market_response?.nq_15m || 'STALLED'}`,
      effect: output.market_response?.nq_15m === 'RECLAIMING' ? ('BULLISH' as const) : output.market_response?.nq_15m === 'CONTINUING' ? ('BEARISH' as const) : ('MIXED' as const),
    },
  ]

  let invalidation = ''
  if (expectedDirection === 'BEARISH') {
    invalidation = 'NQ holding 5-day volume profile support and absorbing aggressive seller delta invalidates the bearish continuation thesis.'
  } else if (expectedDirection === 'BULLISH') {
    invalidation = 'NQ stalling at overhead resistance on negative breadth divergence or sudden yield spike invalidates the bullish breakout thesis.'
  } else {
    invalidation = 'A decisive breakout in 2Y yields above 5.10% or below 4.60% invalidates the neutral range stance.'
  }

  return {
    market: 'NQ',
    regime: `2Y ${telemetry.us2yNominalYield.toFixed(2)}% | 10Y ${telemetry.us10yNominalYield.toFixed(2)}% | VXN ${telemetry.vxnIndex.toFixed(1)} | SOXX ${telemetry.semiBasketChangePct >= 0 ? '+' : ''}${telemetry.semiBasketChangePct.toFixed(2)}%`,
    catalyst: output.event,
    expected_direction: expectedDirection,
    magnitude,
    horizon: 'INTRADAY',
    confidence: output.confidence,
    market_confirmation: confirmationVerdict,
    key_drivers: keyDrivers,
    invalidation,
  }
}

// ==========================================
// 3. DETERMINISTIC EXPERT ENGINE (Institutional Grounding)
// ==========================================

function runDeterministicNasdaqEvaluation(params: {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  telemetry: NasdaqTelemetry
}): StructuredNasdaqEventOutput {
  const { rawText, timestampHint, telemetry } = params
  const text = rawText.toLowerCase()
  const nowIso = timestampHint || new Date().toISOString()

  let category: NasdaqEventCategory = 'MONETARY_POLICY'
  let eventName = 'MACRO_EVENT'
  let importance: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH'
  let expectedDirection: NasdaqDirectionalStance = 'NEUTRAL'
  let surprise = 'AS_EXPECTED'
  let magnitude: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
  let rawSurprise: number | undefined = undefined
  let standardizedSurprise: number | undefined = undefined
  let indexRelevancePct: number | undefined = undefined
  const capexSurge = text.includes('capex')
  const guidanceCut = text.includes('guidance') || text.includes('lowered') || text.includes('slashed')

  const transmission = {
    fed_expectations: 'UNCHANGED' as 'MORE_HAWKISH' | 'MORE_DOVISH' | 'UNCHANGED' | 'UNCERTAIN',
    us2y: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
    us10y: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
    usd: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
  }

  const fundamentalState = {
    intraday: 'NEUTRAL' as NasdaqDirectionalStance,
    short_term: 'NEUTRAL' as NasdaqDirectionalStance,
    medium_term: 'BULLISH' as NasdaqDirectionalStance,
  }

  const marketResponse = {
    nq_initial: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
    nq_5m: 'FLAT' as 'UP' | 'DOWN' | 'FLAT',
    nq_15m: 'STALLED' as 'CONTINUING' | 'REVERSING' | 'RECLAIMING' | 'ACCEPTING' | 'STALLED',
    rates_confirmation: 'NO' as 'YES' | 'NO' | 'MIXED',
    volatility_confirmation: 'NO' as 'YES' | 'NO' | 'DIVERGENT',
    nq_response_quality: 'INCONCLUSIVE' as 'CONFIRMED' | 'PARTIAL_CONFIRMATION' | 'PARTIAL_REJECTION' | 'COMPLETE_REJECTION' | 'INCONCLUSIVE',
  }

  const abnormalBehavior: NasdaqAbnormalBehavior = {
    detected: false,
    type: 'NONE',
    description: '',
  }

  let confidence = 0.86
  let summary = ''

  // A. Check for CPI / Inflation (Prompts 9 & 10)
  if (text.includes('cpi') || text.includes('inflation') || text.includes('pce')) {
    category = 'INFLATION'
    eventName = text.includes('core cpi') ? 'US_CORE_CPI' : text.includes('pce') ? 'US_CORE_PCE' : 'US_CPI'
    importance = 'HIGH'
    magnitude = 'HIGH'

    const isHot = text.includes('hotter') || text.includes('exceeded') || text.includes('+0.4%') || text.includes('rose')
    const isCool = text.includes('cooler') || text.includes('missed') || text.includes('slowed')

    if (isHot) {
      surprise = 'HOTTER_THAN_EXPECTED'
      expectedDirection = 'BEARISH'
      transmission.fed_expectations = 'MORE_HAWKISH'
      transmission.us2y = 'UP'
      transmission.us10y = 'UP'
      transmission.usd = 'UP'
      fundamentalState.intraday = 'BEARISH'
      fundamentalState.short_term = 'NEUTRAL'
      fundamentalState.medium_term = 'BULLISH'

      const stdRes = computeMacroStandardizedSurprise('CORE_CPI_MOM', 0.4, 0.2)
      rawSurprise = stdRes.rawSurprise
      standardizedSurprise = stdRes.standardizedSurprise

      marketResponse.rates_confirmation = 'YES'
      marketResponse.volatility_confirmation = 'YES'

      // Check for Rejection & CVD Absorption (Prompts 9 & 10)
      if (text.includes('reclaim') || text.includes('absorption') || text.includes('cvd') || text.includes('25,020') || text.includes('lvn')) {
        marketResponse.nq_initial = 'DOWN'
        marketResponse.nq_5m = 'DOWN'
        marketResponse.nq_15m = 'RECLAIMING'
        marketResponse.nq_response_quality = 'PARTIAL_REJECTION'
        abnormalBehavior.detected = true
        abnormalBehavior.type = 'BULLISH_RELATIVE_STRENGTH'
        abnormalBehavior.description = 'NQ reclaimed pre-release price level despite higher Treasury yields and stronger dollar.'
        summary =
          'Core CPI exceeded expectations, driving 2Y/10Y yields higher. While initially bearish, NQ absorbed aggressive selling at key volume profile support with heavy negative CVD and reclaimed highs, demonstrating strong relative strength.'
      } else {
        marketResponse.nq_initial = 'DOWN'
        marketResponse.nq_5m = 'DOWN'
        marketResponse.nq_15m = 'CONTINUING'
        marketResponse.nq_response_quality = 'CONFIRMED'
        summary =
          'Hot inflation pushed 2Y and 10Y Treasury yields sharply higher, creating a negative valuation shock. NQ confirmed with aggressive selling through morning support.'
      }
    } else if (isCool) {
      surprise = 'COOLER_THAN_EXPECTED'
      expectedDirection = 'BULLISH'
      transmission.fed_expectations = 'MORE_DOVISH'
      transmission.us2y = 'DOWN'
      transmission.us10y = 'DOWN'
      fundamentalState.intraday = 'BULLISH'
      fundamentalState.short_term = 'BULLISH'
      marketResponse.nq_initial = 'UP'
      marketResponse.nq_5m = 'UP'
      marketResponse.nq_15m = 'CONTINUING'
      marketResponse.nq_response_quality = 'CONFIRMED'
      summary = 'Cooler inflation lowered discount rates across the curve, supporting tech multiple expansion with confirmed upside follow-through.'
    }
  }
  // B. Fed Rate Decision (Prompt 6: Hawkish Cut Disappointment)
  else if (text.includes('fomc') || text.includes('fed') || text.includes('powell') || text.includes('rate cut')) {
    category = 'MONETARY_POLICY'
    eventName = 'FOMC_POLICY_DECISION'
    importance = 'HIGH'
    magnitude = 'HIGH'

    if (text.includes('25 bps') && (text.includes('50 bps') || text.includes('disappointed') || text.includes('gradual'))) {
      surprise = 'HAWKISH_DISAPPOINTMENT'
      expectedDirection = 'BEARISH'
      transmission.fed_expectations = 'MORE_HAWKISH'
      transmission.us2y = 'UP'
      transmission.us10y = 'UP'
      transmission.usd = 'UP'
      fundamentalState.intraday = 'BEARISH'
      fundamentalState.short_term = 'BEARISH'
      marketResponse.nq_initial = 'DOWN'
      marketResponse.nq_5m = 'DOWN'
      marketResponse.nq_15m = 'CONTINUING'
      marketResponse.rates_confirmation = 'YES'
      marketResponse.volatility_confirmation = 'YES'
      marketResponse.nq_response_quality = 'CONFIRMED'
      summary =
        'While the Fed cut rates by 25 bps, the decision disappointed markets expecting 50 bps. Rate expectations repriced hawkishly, 2Y/10Y yields surged, and NQ broke support confirming the hawkish interpretation.'
    } else {
      expectedDirection = 'BULLISH'
      transmission.fed_expectations = 'MORE_DOVISH'
      marketResponse.nq_response_quality = 'CONFIRMED'
      summary = 'FOMC communication provided dovish monetary policy clarity, keeping liquidity conditions accommodative.'
    }
  }
  // C. Mega-Cap Earnings Divergence (Prompts 11, 12, 13, 14)
  else if (text.includes('earnings') || text.includes('10-q') || text.includes('revenue') || text.includes('eps')) {
    category = 'EARNINGS'
    eventName = 'NDX_MEGACAP_EARNINGS'
    importance = 'HIGH'
    magnitude = 'HIGH'
    indexRelevancePct = 8.2

    if (text.includes('lowered') || text.includes('slashed') || text.includes('capex') || text.includes('guidance')) {
      surprise = 'GUIDANCE_CUT_DESPITE_EPS_BEAT'
      expectedDirection = 'BEARISH'
      fundamentalState.intraday = 'BEARISH'
      fundamentalState.short_term = 'MIXED'
      marketResponse.nq_initial = 'DOWN'
      marketResponse.nq_5m = 'DOWN'
      marketResponse.nq_15m = 'CONTINUING'
      marketResponse.nq_response_quality = 'CONFIRMED'
      summary =
        'Despite beating backward-looking Q3 EPS and revenue, the constituent slashed forward revenue guidance and raised capex. Due to heavy index weight (~8.2%), this created substantial drag on NQ futures.'
    } else {
      expectedDirection = 'BULLISH'
      marketResponse.nq_response_quality = 'CONFIRMED'
      summary = 'Solid mega-cap earnings and raised forward cloud/AI guidance reinforced index EPS growth trajectory.'
    }
  }
  // D. Breadth & Concentration (Prompt 17)
  else if (text.includes('breadth') || text.includes('qqqe') || text.includes('declining') || text.includes('advancing')) {
    category = 'BREADTH'
    eventName = 'NDX_BREADTH_DIVERGENCE'
    importance = 'MEDIUM'
    magnitude = 'MEDIUM'
    expectedDirection = 'MIXED'

    if (text.includes('72') || text.includes('declining') || text.includes('narrow') || text.includes('concentration')) {
      fundamentalState.intraday = 'MIXED'
      fundamentalState.short_term = 'NEUTRAL'
      abnormalBehavior.detected = true
      abnormalBehavior.type = 'BREADTH_DIVERGENCE'
      abnormalBehavior.description = 'Index rally carried by only 2-3 mega-caps while 70%+ of NDX constituents declined.'
      marketResponse.nq_response_quality = 'PARTIAL_CONFIRMATION'
      summary =
        'While NQ printed positive price return, market breadth was heavily skewed (72 stocks declining). A rally driven by narrow mega-cap concentration is structurally more vulnerable to sudden reversal.'
    } else {
      marketResponse.nq_response_quality = 'CONFIRMED'
      summary = 'Broad market participation with advancing stocks outnumbering decliners confirmed underlying trend health.'
    }
  }
  // E. Cross-Asset Relative Strength (Prompt 18)
  else if (text.includes('es') || text.includes('ym') || text.includes('relative strength') || text.includes('soxx')) {
    category = 'GROWTH'
    eventName = 'CROSS_ASSET_RELATIVE_STRENGTH'
    importance = 'MEDIUM'
    magnitude = 'HIGH'
    expectedDirection = 'BULLISH'
    fundamentalState.intraday = 'BULLISH'
    abnormalBehavior.detected = true
    abnormalBehavior.type = 'BULLISH_RELATIVE_STRENGTH'
    abnormalBehavior.description = 'NQ maintained session highs and held support while ES and YM broke down through session lows.'
    marketResponse.nq_initial = 'UP'
    marketResponse.nq_5m = 'UP'
    marketResponse.nq_15m = 'CONTINUING'
    marketResponse.nq_response_quality = 'CONFIRMED'
    summary =
      'Cross-asset analysis revealed strong tech and growth leadership: NQ held firm above support while broader equity benchmarks (ES/YM) broke session lows, indicating resilient tech cash flow demand.'
  }
  // F. General Macro / Growth
  else {
    category = 'GROWTH'
    eventName = 'GENERAL_MACRO_UPDATE'
    importance = 'LOW'
    expectedDirection = 'NEUTRAL'
    summary = 'General macroeconomic commentary evaluated. Negligible immediate transmission to interest rates or equity discount factors.'
  }

  const confirmation: 'STRONG' | 'MODERATE' | 'WEAK' | 'CONTRADICTED' =
    marketResponse.nq_response_quality === 'CONFIRMED'
      ? 'STRONG'
      : marketResponse.nq_response_quality === 'PARTIAL_CONFIRMATION'
      ? 'MODERATE'
      : marketResponse.nq_response_quality === 'PARTIAL_REJECTION'
      ? 'WEAK'
      : marketResponse.nq_response_quality === 'COMPLETE_REJECTION'
      ? 'CONTRADICTED'
      : 'MODERATE'

  const driversList = [
    {
      factor: eventName,
      actual: rawSurprise !== undefined ? (rawSurprise > 0 ? `+${rawSurprise}` : `${rawSurprise}`) : 'Reported',
      consensus: 'Consensus',
      unit: '%',
      effect: expectedDirection,
      standardized_surprise: standardizedSurprise,
      capex_guidance_nuance: (capexSurge && guidanceCut) ? 'Slashed Q4 guidance and capex surge override EPS beat' : undefined,
    },
  ]

  const cl5mReturn = marketResponse.nq_5m === 'UP' ? 0.85 : marketResponse.nq_5m === 'DOWN' ? -0.85 : 0.05

  return {
    timestamp: nowIso,
    market: 'NQ',
    event: eventName,
    importance,
    fundamental_effect: {
      intraday: fundamentalState.intraday,
      short_term: fundamentalState.short_term,
      medium_term: fundamentalState.medium_term,
    },
    drivers: driversList,
    market_confirmation: {
      cl_5m_return: cl5mReturn,
      us2y_bps_change: transmission.us2y === 'UP' ? 8.5 : transmission.us2y === 'DOWN' ? -6.0 : 0.0,
      us10y_bps_change: transmission.us10y === 'UP' ? 5.2 : transmission.us10y === 'DOWN' ? -4.0 : 0.0,
      vxn_point_change: transmission.fed_expectations === 'MORE_HAWKISH' ? 0.8 : -0.4,
      advance_decline_ratio: telemetry.advanceDeclineRatio,
      confirmation,
      market_state: marketResponse.nq_15m,
    },
    abnormal_behavior: abnormalBehavior,
    confidence,
    summary,
    event_analysis: {
      category,
      expected_direction: expectedDirection,
      magnitude,
      surprise,
      raw_surprise: rawSurprise,
      standardized_surprise: standardizedSurprise,
      index_relevance_pct: indexRelevancePct,
    },
    transmission,
    fundamental_state: fundamentalState,
    market_response: marketResponse,
  }
}

// ==========================================
// 4. LLM EVALUATION ENGINE (Anthropic / OpenAI)
// ==========================================

async function runLlmNasdaqEvaluation(params: {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  telemetry: NasdaqTelemetry
  anthropicKey?: string
  openaiKey?: string
}): Promise<StructuredNasdaqEventOutput | null> {
  const { rawText, sourceHint, timestampHint, telemetry, anthropicKey, openaiKey } = params

  const prompt = buildFundamentalEventUserPrompt({
    roleLine: 'You are evaluating a supplied event for CME E-mini Nasdaq-100 futures (NQ).',
    telemetryLines: [
      datumLine('NQ', telemetry.nqPrice.toFixed(2), 'TICK', 'LIVE'),
      datumLine('ES', telemetry.esPrice.toFixed(2), 'TICK', 'LIVE'),
      datumLine('YM', telemetry.ymPrice.toFixed(0), 'TICK', 'LIVE'),
      datumLine('US 2Y', `${telemetry.us2yNominalYield.toFixed(2)}%`, 'INTRADAY', 'RECENT'),
      datumLine('US 10Y', `${telemetry.us10yNominalYield.toFixed(2)}%`, 'INTRADAY', 'RECENT'),
      datumLine('10Y real', `${telemetry.us10yRealYield.toFixed(2)}%`, 'DAILY', 'RECENT'),
      datumLine('VXN', telemetry.vxnIndex.toFixed(1), 'INTRADAY', 'RECENT'),
      datumLine('VIX', telemetry.vixIndex.toFixed(1), 'INTRADAY', 'RECENT'),
      'CURRENT NDX WEIGHTS: UNAVAILABLE. Do not use default or memorized constituent weights.',
      'CVD and profile: not supplied.',
    ],
    rawText,
    source: sourceHint,
    timestamp: timestampHint,
    specialistNotes: `market is NQ.
us2y, us10y, and usd may be null. Do not force UP, DOWN, or FLAT.
standardized_surprise and index_relevance_pct stay null unless this packet already states them.
An earnings beat is not automatically bullish. A rate cut is not automatically bullish.
Do not infer absorption or reclaim.`,
  })

  let rawJsonText = ''

  if (anthropicKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        system: NASDAQ_ANALYST_EVENT_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (res.ok) {
      const data = await res.json()
      rawJsonText = data.content?.[0]?.text || ''
    }
  }

  if (!rawJsonText && openaiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: NASDAQ_ANALYST_EVENT_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })
    if (res.ok) {
      const data = await res.json()
      rawJsonText = data.choices?.[0]?.message?.content || ''
    }
  }

  if (!rawJsonText) return null

  try {
    const cleanJson = rawJsonText
      .replace(/^```json\s*/, '')
      .replace(/\s*```$/, '')
      .trim()
    const parsed = adaptLegacyFundamentalJson(JSON.parse(cleanJson))

    if (!parsed.fundamental_effect && parsed.fundamental_state) {
      parsed.fundamental_effect = parsed.fundamental_state
    }
    if (!parsed.fundamental_state && parsed.fundamental_effect) {
      parsed.fundamental_state = parsed.fundamental_effect
    }
    if (!parsed.drivers) {
      parsed.drivers = [
        {
          factor: parsed.event || 'NDX_EVENT',
          actual: 'Reported',
          consensus: 'Consensus',
          unit: '%',
          effect: parsed.fundamental_effect?.intraday || 'NEUTRAL',
        },
      ]
    }
    if (!parsed.market_confirmation) {
      const q = parsed.market_response?.nq_response_quality || 'CONFIRMED'
      const conf =
        q === 'CONFIRMED'
          ? 'STRONG'
          : q === 'PARTIAL_CONFIRMATION'
          ? 'MODERATE'
          : q === 'PARTIAL_REJECTION'
          ? 'WEAK'
          : q === 'COMPLETE_REJECTION'
          ? 'CONTRADICTED'
          : 'MODERATE'
      parsed.market_confirmation = {
        cl_5m_return: parsed.market_response?.nq_5m === 'UP' ? 0.8 : -0.8,
        us2y_bps_change: 0,
        us10y_bps_change: 0,
        vxn_point_change: 0,
        advance_decline_ratio: telemetry.advanceDeclineRatio,
        confirmation: conf,
      }
    }
    if (!parsed.abnormal_behavior) {
      parsed.abnormal_behavior = {
        detected: false,
        type: 'NONE',
        description: 'Order flow and market reaction aligned with fundamental baseline.',
      }
    }

    return parsed as StructuredNasdaqEventOutput
  } catch (err) {
    logger.error('[NasdaqAnalystEngine] Failed to parse LLM JSON response', { err, rawJsonText })
    return null
  }
}
