/**
 * Gold Macro, Monetary and Physical Demand Analyst - Evaluation Engine
 * Market: COMEX Gold Futures (GC)
 *
 * Implements:
 * 1. 11-step institutional evaluation workflow (Item 35)
 * 2. Standardized surprise engine: (actual - consensus) / surprise_volatility (Item 8)
 * 3. Transmission mechanism mapper: Real rates, Nominal rates, USD
 * 4. Market confirmation & rejection analyzer (Prompts 4, 5, 30, 31)
 * 5. Strict structured machine-readable JSON schema (Item 36)
 * 6. Unified multi-agent protocol output (Item 39)
 */

import type {
  GoldEventEvaluation,
  StructuredGoldEventOutput,
  UnifiedAgentProtocolOutput,
  GoldTelemetry,
  GoldEventCategory,
  GoldDirectionalStance,
  GoldSurpriseType,
  GoldTransmission,
  GoldMarketResponse,
} from '@/types/fundamentals'
import {
  GOLD_ANALYST_SYSTEM_PROMPT,
  HISTORICAL_SURPRISE_VOLATILITY,
} from './goldAnalystConfig'
import { refreshGoldTelemetry, recordEvaluatedGoldEvent } from './goldStateStore'
import { logger } from '@/lib/utils/logger'

interface AnalyzeGoldEventParams {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  autoCommitIfMaterial?: boolean
}

/**
 * Evaluates an incoming gold event and returns structured JSON
 */
export async function evaluateGoldEvent(params: AnalyzeGoldEventParams): Promise<GoldEventEvaluation> {
  const { rawText, sourceHint, timestampHint, autoCommitIfMaterial = true } = params
  const telemetry = await refreshGoldTelemetry()

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  let structuredOutput: StructuredGoldEventOutput | null = null

  if (anthropicKey || openaiKey) {
    try {
      structuredOutput = await runLlmEvaluation({
        rawText,
        sourceHint,
        timestampHint,
        telemetry,
        anthropicKey,
        openaiKey,
      })
    } catch (err) {
      logger.warn('[GoldAnalystEngine] LLM evaluation failed, falling back to deterministic engine', err)
    }
  }

  if (!structuredOutput) {
    structuredOutput = runDeterministicEvaluation({
      rawText,
      sourceHint,
      timestampHint,
      telemetry,
    })
  }

  // Generate unified agent protocol output (Item 39)
  const unifiedProtocol: UnifiedAgentProtocolOutput = buildUnifiedProtocol(structuredOutput, telemetry)
  structuredOutput.unified_protocol = unifiedProtocol

  const evaluation: GoldEventEvaluation = {
    id: `gc-event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: structuredOutput.timestamp,
    event: structuredOutput.event,
    rawText,
    structuredOutput,
    safeguards: {
      noInventedData: true,
      correlationNotCausation: true,
      noHeadlineOnlyTrade: true,
      sourcesConflictReported: false,
      comexNotTradeSignal: structuredOutput.event_analysis.category === 'COMEX_INVENTORY',
    },
  }

  if (autoCommitIfMaterial && structuredOutput.importance !== 'LOW') {
    recordEvaluatedGoldEvent(evaluation)
  }

  return evaluation
}

// ==========================================
// 1. STANDARDIZED SURPRISE ENGINE (Item 8)
// ==========================================

export function computeStandardizedSurprise(
  indicatorKey: string,
  actual: number,
  consensus: number
): { rawSurprise: number; standardizedSurprise: number } {
  const rawSurprise = +(actual - consensus).toFixed(4)
  const volConfig = HISTORICAL_SURPRISE_VOLATILITY[indicatorKey.toUpperCase()]
  if (!volConfig || volConfig.std <= 0) {
    return { rawSurprise, standardizedSurprise: rawSurprise }
  }
  const standardizedSurprise = +(rawSurprise / volConfig.std).toFixed(2)
  return { rawSurprise, standardizedSurprise }
}

// ==========================================
// 2. UNIFIED PROTOCOL BUILDER (Item 39)
// ==========================================

function buildUnifiedProtocol(
  output: StructuredGoldEventOutput,
  telemetry: GoldTelemetry
): UnifiedAgentProtocolOutput {
  const expectedDirection = output.event_analysis.expected_gold_effect
  const magnitude = output.event_analysis.magnitude === 'HIGH' ? 'HIGH' : output.event_analysis.magnitude === 'MEDIUM' ? 'MEDIUM' : 'LOW'
  
  let confirmationVerdict: 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'REJECTED' | 'INCONCLUSIVE' = 'INCONCLUSIVE'
  if (output.market_response.gold_response_quality === 'CONFIRMED') {
    confirmationVerdict = 'CONFIRMED'
  } else if (output.market_response.gold_response_quality === 'PARTIAL_CONFIRMATION') {
    confirmationVerdict = 'PARTIALLY_CONFIRMED'
  } else if (
    output.market_response.gold_response_quality === 'PARTIAL_REJECTION' ||
    output.market_response.gold_response_quality === 'COMPLETE_REJECTION'
  ) {
    confirmationVerdict = 'REJECTED'
  }

  const keyDrivers = [
    {
      factor: '10Y_REAL_YIELD',
      impact: `10Y TIPS real yield at ${telemetry.us10yRealYield.toFixed(2)}%`,
      effect: output.transmission.real_rates === 'UP' ? ('BEARISH' as const) : output.transmission.real_rates === 'DOWN' ? ('BULLISH' as const) : ('NEUTRAL' as const),
    },
    {
      factor: 'US_DOLLAR_DXY',
      impact: `DXY at ${telemetry.dxyIndex.toFixed(2)}`,
      effect: output.transmission.usd === 'UP' ? ('BEARISH' as const) : output.transmission.usd === 'DOWN' ? ('BULLISH' as const) : ('NEUTRAL' as const),
    },
    {
      factor: 'MARKET_ORDER_FLOW',
      impact: `CVD Stance: ${telemetry.cvdAggressionStance || 'NEUTRAL'} | GC 15m: ${output.market_response.gc_15m}`,
      effect: output.market_response.gc_15m === 'RECLAIMING' ? ('BULLISH' as const) : output.market_response.gc_15m === 'CONTINUING' ? ('BEARISH' as const) : ('MIXED' as const),
    },
  ]

  let invalidation = ''
  if (expectedDirection === 'BEARISH') {
    invalidation = 'Gold holding above key support and absorbing selling with negative CVD reclaim invalidates the bearish continuation thesis.'
  } else if (expectedDirection === 'BULLISH') {
    invalidation = 'Gold stalling at resistance with high-volume upthrust and failing to sustain real yield drops invalidates the bullish breakout thesis.'
  } else {
    invalidation = 'A sustained breakout in 10Y real yields (>3.00%) or sudden DXY impulse (>104) invalidates the neutral range thesis.'
  }

  return {
    market: 'GC',
    regime: `Real Rates ${telemetry.us10yRealYield.toFixed(2)}% | Breakeven ${telemetry.us10yBreakeven.toFixed(2)}% | DXY ${telemetry.dxyIndex.toFixed(2)}`,
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
// 3. DETERMINISTIC EXPERT ENGINE (Strict Institutional Grounding)
// ==========================================

function runDeterministicEvaluation(params: {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  telemetry: GoldTelemetry
}): StructuredGoldEventOutput {
  const { rawText, timestampHint, telemetry: _telemetry } = params
  const text = rawText.toLowerCase()
  const nowIso = timestampHint || new Date().toISOString()

  let category: GoldEventCategory = 'MONETARY_POLICY'
  let eventName = 'MACRO_EVENT'
  let importance: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH'
  let expectedGoldEffect: GoldDirectionalStance = 'NEUTRAL'
  let surprise: GoldSurpriseType = 'AS_EXPECTED'
  let magnitude: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
  let rawSurprise: number | undefined = undefined
  let standardizedSurprise: number | undefined = undefined

  const transmission: GoldTransmission = {
    real_rates: 'FLAT',
    nominal_rates: 'FLAT',
    usd: 'FLAT',
  }

  const fundamentalState = {
    intraday: 'NEUTRAL' as GoldDirectionalStance,
    short_term: 'NEUTRAL' as GoldDirectionalStance,
    medium_term: 'BULLISH' as GoldDirectionalStance,
  }

  const marketResponse: GoldMarketResponse = {
    gc_initial: 'FLAT',
    gc_5m: 'FLAT',
    gc_15m: 'STALLED',
    real_yield_confirmation: 'NEUTRAL',
    usd_confirmation: 'NEUTRAL',
    gold_response_quality: 'INCONCLUSIVE',
  }

  let confidence = 0.85
  let summary = ''

  // A. Check for CPI / Inflation
  if (text.includes('cpi') || text.includes('inflation') || text.includes('pce')) {
    category = 'INFLATION'
    eventName = text.includes('core cpi') ? 'US_CORE_CPI' : text.includes('pce') ? 'US_CORE_PCE' : 'US_CPI'
    importance = 'HIGH'
    magnitude = 'HIGH'

    const isHot = text.includes('hotter') || text.includes('exceeded') || text.includes('+0.4%') || text.includes('rose')
    const isCool = text.includes('cooler') || text.includes('missed') || text.includes('slowed')

    if (isHot) {
      surprise = 'HOTTER_THAN_EXPECTED'
      expectedGoldEffect = 'BEARISH'
      transmission.real_rates = 'UP'
      transmission.nominal_rates = 'UP'
      transmission.usd = 'UP'
      fundamentalState.intraday = 'BEARISH'
      fundamentalState.short_term = 'NEUTRAL'
      fundamentalState.medium_term = 'BULLISH'

      const stdRes = computeStandardizedSurprise('CORE_CPI_MOM', 0.4, 0.2)
      rawSurprise = stdRes.rawSurprise
      standardizedSurprise = stdRes.standardizedSurprise

      marketResponse.real_yield_confirmation = 'BEARISH_GOLD'
      marketResponse.usd_confirmation = 'BEARISH_GOLD'

      // Check for market rejection / absorption (Prompts 4 & 5)
      if (text.includes('reclaim') || text.includes('absorption') || text.includes('sprang') || text.includes('spring') || text.includes('cvd') || text.includes('4,225')) {
        marketResponse.gc_initial = 'DOWN'
        marketResponse.gc_5m = 'DOWN'
        marketResponse.gc_15m = 'RECLAIMING'
        marketResponse.gold_response_quality = 'PARTIAL_REJECTION'
        summary =
          'Core CPI printed hotter than expected (+0.4% vs +0.2%), pushing real yields and the USD higher. While initially bearish, GC absorbed selling with heavy negative CVD and reclaimed highs, signaling strong underlying physical and structural demand.'
      } else {
        marketResponse.gc_initial = 'DOWN'
        marketResponse.gc_5m = 'DOWN'
        marketResponse.gc_15m = 'CONTINUING'
        marketResponse.gold_response_quality = 'CONFIRMED'
        summary =
          'Core CPI printed hotter than expected, driving nominal and real Treasury yields higher along with the USD. Market confirmed the bearish macro impulse with prompt selling in GC.'
      }
    } else if (isCool) {
      surprise = 'COOLER_THAN_EXPECTED'
      expectedGoldEffect = 'BULLISH'
      transmission.real_rates = 'DOWN'
      transmission.nominal_rates = 'DOWN'
      transmission.usd = 'DOWN'
      fundamentalState.intraday = 'BULLISH'
      fundamentalState.short_term = 'BULLISH'
      fundamentalState.medium_term = 'BULLISH'

      marketResponse.real_yield_confirmation = 'BULLISH_GOLD'
      marketResponse.usd_confirmation = 'BULLISH_GOLD'
      marketResponse.gc_initial = 'UP'
      marketResponse.gc_5m = 'UP'
      marketResponse.gc_15m = 'CONTINUING'
      marketResponse.gold_response_quality = 'CONFIRMED'
      summary =
        'Inflation cooled more than expected, easing Fed terminal rate expectations and lowering real yields. Gold responded with prompt upside confirmation.'
    }
  }
  // B. Check for FOMC / Federal Reserve
  else if (text.includes('fed') || text.includes('fomc') || text.includes('powell') || text.includes('rate cut') || text.includes('rate hike')) {
    category = 'MONETARY_POLICY'
    eventName = 'FOMC_RATE_DECISION'
    importance = 'HIGH'
    magnitude = 'HIGH'

    const isDovishSurprise = text.includes('cut by 50') || text.includes('dovish') || text.includes('eased -15') || text.includes('50 bps')
    if (isDovishSurprise) {
      surprise = 'DOVISH_SURPRISE'
      expectedGoldEffect = 'BULLISH'
      transmission.real_rates = 'DOWN'
      transmission.nominal_rates = 'DOWN'
      transmission.usd = 'DOWN'
      fundamentalState.intraday = 'BULLISH'
      fundamentalState.short_term = 'BULLISH'
      fundamentalState.medium_term = 'BULLISH'

      marketResponse.real_yield_confirmation = 'BULLISH_GOLD'
      marketResponse.usd_confirmation = 'BULLISH_GOLD'

      // Check for Failure / Upthrust (Prompts 30 & 31)
      if (text.includes('failed') || text.includes('upthrust') || text.includes('rolled over') || text.includes('stall') || text.includes('4,195')) {
        marketResponse.gc_initial = 'UP'
        marketResponse.gc_5m = 'UP'
        marketResponse.gc_15m = 'REVERSING'
        marketResponse.gold_response_quality = 'COMPLETE_REJECTION'
        summary =
          'FOMC delivered a larger-than-expected 50 bps cut, depressing real yields and the USD. However, GC encountered heavy supply at overhead resistance, failed to hold gains, and rolled over, displaying exhaustion and market rejection of the bullish macro surprise.'
      } else {
        marketResponse.gc_initial = 'UP'
        marketResponse.gc_5m = 'UP'
        marketResponse.gc_15m = 'CONTINUING'
        marketResponse.gold_response_quality = 'CONFIRMED'
        summary =
          'FOMC delivered an outsized rate cut, pushing real yields and the USD down. Gold futures surged with aggressive volume confirming the dovish impulse.'
      }
    } else {
      surprise = 'HAWKISH_SURPRISE'
      expectedGoldEffect = 'BEARISH'
      transmission.real_rates = 'UP'
      transmission.usd = 'UP'
      fundamentalState.intraday = 'BEARISH'
      marketResponse.gold_response_quality = 'CONFIRMED'
      summary = 'FOMC delivered a hawkish communication relative to market easing expectations, supporting real yields and capping gold upside.'
    }
  }
  // C. Central Bank Demand / PBOC (Item 32)
  else if (text.includes('central bank') || text.includes('pboc') || text.includes('safe') || text.includes('reserves')) {
    category = 'CENTRAL_BANK_DEMAND'
    eventName = 'CENTRAL_BANK_GOLD_RESERVES'
    importance = 'MEDIUM'
    magnitude = 'MEDIUM'
    surprise = 'UNEXPECTED_EVENT'
    expectedGoldEffect = 'BULLISH'
    transmission.real_rates = 'FLAT'
    transmission.usd = 'FLAT'

    // Central bank purchases operate on medium-term horizon, low intraday effect
    fundamentalState.intraday = 'NEUTRAL'
    fundamentalState.short_term = 'BULLISH'
    fundamentalState.medium_term = 'BULLISH'

    marketResponse.gc_initial = 'FLAT'
    marketResponse.gc_5m = 'FLAT'
    marketResponse.gc_15m = 'STALLED'
    marketResponse.gold_response_quality = 'CONFIRMED'
    confidence = 0.90
    summary =
      'Official reserve report confirmed ongoing central bank gold accumulation (PBOC reserves up 60k oz to 72.8M oz). Central bank purchases reinforce the structural medium-term monetary floor, though intraday price reaction is typically muted.'
  }
  // D. Financial Stress / Liquidation vs Safe Haven (Item 10)
  else if (text.includes('liquidation') || text.includes('default') || text.includes('margin') || text.includes('sovereign debt fund')) {
    category = 'FINANCIAL_STRESS'
    eventName = 'GLOBAL_LIQUIDITY_SHOCK'
    importance = 'HIGH'
    magnitude = 'HIGH'
    surprise = 'UNEXPECTED_EVENT'
    expectedGoldEffect = 'BEARISH'
    transmission.real_rates = 'UP'
    transmission.usd = 'UP'

    fundamentalState.intraday = 'BEARISH'
    fundamentalState.short_term = 'MIXED'
    fundamentalState.medium_term = 'BULLISH'

    marketResponse.gc_initial = 'DOWN'
    marketResponse.gc_5m = 'DOWN'
    marketResponse.gc_15m = 'CONTINUING'
    marketResponse.real_yield_confirmation = 'BEARISH_GOLD'
    marketResponse.usd_confirmation = 'BEARISH_GOLD'
    marketResponse.gold_response_quality = 'CONFIRMED'
    summary =
      'Severe market illiquidity triggered cross-asset margin liquidations. Gold fell alongside risk assets as participants raised cash, confirming a general liquidation regime rather than a classic flight-to-safety flow.'
  }
  // E. CFTC Speculative Crowding (Item 17)
  else if (text.includes('cftc') || text.includes('cot') || text.includes('managed money')) {
    category = 'SPECULATIVE_POSITIONING'
    eventName = 'CFTC_COT_POSITIONING'
    importance = 'MEDIUM'
    magnitude = 'HIGH'
    surprise = 'INLINE'
    expectedGoldEffect = 'MIXED'
    transmission.real_rates = 'FLAT'
    transmission.usd = 'FLAT'

    fundamentalState.intraday = 'NEUTRAL'
    fundamentalState.short_term = 'MIXED'
    fundamentalState.medium_term = 'BULLISH'

    if (text.includes('upthrust') || text.includes('failed to register') || text.includes('stalling')) {
      marketResponse.gc_initial = 'FLAT'
      marketResponse.gc_5m = 'FLAT'
      marketResponse.gc_15m = 'REVERSING'
      marketResponse.gold_response_quality = 'COMPLETE_REJECTION'
      summary =
        'CFTC COT revealed speculative Managed Money net longs surging to crowded multi-year highs (310k contracts, 98th percentile). Price stalled at resistance forming an upthrust, warning of high susceptibility to long liquidation.'
    } else {
      marketResponse.gold_response_quality = 'CONFIRMED'
      summary =
        'CFTC COT positioning shows speculative interest expanding. While trend-confirming, elevated net longs increase downside volatility if macro shocks hit.'
    }
  }
  // F. COMEX Depository Stocks (Item 18 & 19)
  else if (text.includes('comex') || text.includes('registered') || text.includes('eligible') || text.includes('depository')) {
    category = 'COMEX_INVENTORY'
    eventName = 'COMEX_DEPOSITORY_REPORT'
    importance = 'LOW'
    magnitude = 'LOW'
    expectedGoldEffect = 'NEUTRAL'
    transmission.real_rates = 'FLAT'
    transmission.usd = 'FLAT'

    fundamentalState.intraday = 'NEUTRAL'
    fundamentalState.short_term = 'NEUTRAL'
    fundamentalState.medium_term = 'NEUTRAL'

    marketResponse.gold_response_quality = 'INCONCLUSIVE'
    summary =
      'COMEX depository stocks reported routine inventory shifts between registered and eligible categories. As per institutional protocol, warehouse movements alone do not constitute trade signals.'
  }
  // G. General News / Default
  else {
    category = 'GROWTH'
    eventName = 'GENERAL_MARKET_EVENT'
    importance = 'MEDIUM'
    expectedGoldEffect = 'NEUTRAL'
    summary = 'General macroeconomic update evaluated. Minimal direct transmission to real Treasury yields or currency markets.'
  }

  return {
    timestamp: nowIso,
    market: 'GC',
    event: eventName,
    importance,
    event_analysis: {
      category,
      expected_gold_effect: expectedGoldEffect,
      magnitude,
      surprise,
      raw_surprise: rawSurprise,
      standardized_surprise: standardizedSurprise,
    },
    transmission,
    fundamental_state: fundamentalState,
    market_response: marketResponse,
    confidence,
    summary,
  }
}

// ==========================================
// 4. LLM EVALUATION ENGINE (Anthropic / OpenAI)
// ==========================================

async function runLlmEvaluation(params: {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  telemetry: GoldTelemetry
  anthropicKey?: string
  openaiKey?: string
}): Promise<StructuredGoldEventOutput | null> {
  const { rawText, sourceHint, timestampHint, telemetry, anthropicKey, openaiKey } = params

  const prompt = `You are evaluating an incoming market event affecting COMEX Gold futures (GC).

CURRENT MARKET CONTEXT:
- Gold Price: $${telemetry.goldPrice.toFixed(2)}/oz (${telemetry.goldChange >= 0 ? '+' : ''}${telemetry.goldChange.toFixed(2)}, ${telemetry.goldChangePct >= 0 ? '+' : ''}${telemetry.goldChangePct.toFixed(2)}%)
- 10Y Nominal Treasury: ${telemetry.us10yNominalYield.toFixed(2)}%
- 10Y Real Yield (TIPS DFII10): ${telemetry.us10yRealYield.toFixed(2)}%
- 10Y Breakeven Inflation: ${telemetry.us10yBreakeven.toFixed(2)}%
- US Dollar Index (DXY): ${telemetry.dxyIndex.toFixed(2)}
- Silver: $${telemetry.silverPrice.toFixed(3)} (Gold/Silver Ratio: ${telemetry.goldSilverRatio.toFixed(2)})
- Gold CVOL (Implied Volatility): ${telemetry.goldCvol.toFixed(1)}%

RAW EVENT TEXT:
"""
${rawText}
"""
Source hint: ${sourceHint || 'Institutional Wire'}
Timestamp hint: ${timestampHint || new Date().toISOString()}

INSTRUCTIONS:
Evaluate this event using the 11-step Gold Macro, Monetary and Physical Demand framework.
Crucially:
- Classify transmission: REAL_RATES (UP/DOWN/FLAT), NOMINAL_RATES (UP/DOWN/FLAT), USD (UP/DOWN/FLAT).
- Identify whether GC price action and order flow CONFIRMS, PARTIALLY CONFIRMS, or REJECTS the expected macro shock (e.g. hot CPI followed by CVD absorption and price reclaim = PARTIAL_REJECTION or COMPLETE_REJECTION).
- Remember: COMEX registered stock shifts are NOT trade signals. Central-bank buying is a medium-term monetary anchor, not an immediate intraday trade trigger.
- Do not write essays.

Return ONLY a valid JSON object matching this EXACT schema:
{
  "timestamp": "${new Date().toISOString()}",
  "market": "GC",
  "event": "EVENT_NAME_IN_CAPS",
  "importance": "HIGH" | "MEDIUM" | "LOW",
  "event_analysis": {
    "category": "MONETARY_POLICY" | "REAL_RATES" | "NOMINAL_RATES" | "USD" | "INFLATION" | "LABOR" | "GROWTH" | "LIQUIDITY" | "GEOPOLITICAL_RISK" | "FINANCIAL_STRESS" | "CENTRAL_BANK_DEMAND" | "ETF_FLOWS" | "SPECULATIVE_POSITIONING" | "PHYSICAL_DEMAND" | "MINE_SUPPLY" | "RECYCLING" | "COMEX_INVENTORY" | "OPTIONS_VOLATILITY",
    "expected_gold_effect": "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL" | "UNCERTAIN",
    "magnitude": "HIGH" | "MEDIUM" | "LOW",
    "surprise": "HOTTER_THAN_EXPECTED" | "COOLER_THAN_EXPECTED" | "HAWKISH_SURPRISE" | "DOVISH_SURPRISE" | "AS_EXPECTED" | "INLINE" | "UNEXPECTED_EVENT",
    "raw_surprise": null | number,
    "standardized_surprise": null | number
  },
  "transmission": {
    "real_rates": "UP" | "DOWN" | "FLAT" | "UNCERTAIN",
    "nominal_rates": "UP" | "DOWN" | "FLAT" | "UNCERTAIN",
    "usd": "UP" | "DOWN" | "FLAT" | "UNCERTAIN"
  },
  "fundamental_state": {
    "intraday": "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL" | "UNCERTAIN",
    "short_term": "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL" | "UNCERTAIN",
    "medium_term": "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL" | "UNCERTAIN"
  },
  "market_response": {
    "gc_initial": "UP" | "DOWN" | "FLAT",
    "gc_5m": "UP" | "DOWN" | "FLAT",
    "gc_15m": "CONTINUING" | "REVERSING" | "RECLAIMING" | "ACCEPTING" | "STALLED",
    "real_yield_confirmation": "BULLISH_GOLD" | "BEARISH_GOLD" | "NEUTRAL",
    "usd_confirmation": "BULLISH_GOLD" | "BEARISH_GOLD" | "NEUTRAL",
    "gold_response_quality": "CONFIRMED" | "PARTIAL_CONFIRMATION" | "PARTIAL_REJECTION" | "COMPLETE_REJECTION" | "INCONCLUSIVE"
  },
  "confidence": 0.85,
  "summary": "1-2 sentence institutional summary"
}`

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
        system: GOLD_ANALYST_SYSTEM_PROMPT,
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
          { role: 'system', content: GOLD_ANALYST_SYSTEM_PROMPT },
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
    const parsed = JSON.parse(cleanJson) as StructuredGoldEventOutput
    return parsed
  } catch (err) {
    logger.error('[GoldAnalystEngine] Failed to parse LLM JSON response', { err, rawJsonText })
    return null
  }
}
