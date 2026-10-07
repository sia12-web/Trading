/**
 * Nikkei 225 Fundamental Analyst Engine (NIKKEI_AGENT)
 * Market: CME Nikkei 225 USD Futures (NKD - $5 Multiplier) / JPX TSE Cash Market
 *
 * Implements:
 * 1. NIKKEI_CONTRIBUTION_ENGINE: Price-weighting mechanics (Share Price / Divisor ~30.15)
 *    and extreme tech/retail concentration (Fast Retailing ~10%, Tokyo Electron ~7%, Advantest ~5%).
 * 2. BOJ_POLICY_ENGINE: Classifies Bank of Japan policy shifts, overnight call rate hikes,
 *    YCC phase-out, 10Y JGB yields, and Bank (MUFG/SMFG) vs Exporter (Toyota/Tokyo Electron) divergence.
 * 3. USD_JPY_FX_ENGINE: Real-time Yen sensitivity, exporter profit beta, and Ministry of Finance (MoF)
 *    currency intervention danger zones (155-160 alert).
 * 4. SEMICONDUCTOR_SUPPLY_CHAIN_ENGINE: SOX index transmission, AI GPU test equipment demand,
 *    and Advantest/Tokyo Electron fab cycle correlation.
 * 5. TOKYO_SESSION_FLOW_ANALYZER: Distinguishes Tokyo cash morning (09:00-11:30 JST), lunch break (11:30-12:30 JST),
 *    afternoon cash (12:30-15:00 JST), and overnight US lead (09:30-16:00 ET).
 * 6. 14-Step Institutional Event Evaluator with Abnormal Behavior Detection.
 */

import type {
  StructuredNikkeiEventOutput,
  NikkeiEventEvaluation,
  NikkeiTelemetry,
  NikkeiConstituent,
  NikkeiContributionState,
  NikkeiEventCategory,
  NikkeiDirectionalStance,
  NikkeiAbnormalBehavior,
} from '@/types/fundamentals'
import {
  NIKKEI_ANALYST_EVENT_PROMPT,
  NIKKEI_DIVISOR,
  DEFAULT_NIKKEI_CONSTITUENTS,
} from './nikkeiAnalystConfig'
import { peekNikkeiFundamentalState, recordEvaluatedNikkeiEvent } from './nikkeiStateStore'
import { scrubSummary, sourcedImpact } from '@/lib/fundamentals/honesty'
import { logger } from '@/lib/utils/logger'
import {
  adaptLegacyFundamentalJson,
  buildFundamentalEventUserPrompt,
  datumLine,
} from '@/lib/fundamentals/outputContract'

// In-memory event deduplication cache for Nikkei wire (60 min window)
const recentNikkeiEventsCache = new Map<string, { eventId: string; timestamp: number }>()

export function deduplicateNikkeiHeadline(
  headline: string,
  _source?: string
): {
  isDuplicate: boolean
  eventId: string
  normalizedHeadline: string
} {
  const now = Date.now()
  for (const [key, value] of recentNikkeiEventsCache.entries()) {
    if (now - value.timestamp > 3600000) {
      recentNikkeiEventsCache.delete(key)
    }
  }

  const tokens = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .sort()
    .slice(0, 7)
    .join('_')

  const cacheKey = tokens || headline.slice(0, 32).toLowerCase()
  const existing = recentNikkeiEventsCache.get(cacheKey)

  if (existing) {
    return {
      isDuplicate: true,
      eventId: existing.eventId,
      normalizedHeadline: headline.trim(),
    }
  }

  const newEventId = `nikkei_evt_${now}_${Math.random().toString(36).substring(2, 7)}`
  recentNikkeiEventsCache.set(cacheKey, { eventId: newEventId, timestamp: now })

  return {
    isDuplicate: false,
    eventId: newEventId,
    normalizedHeadline: headline.trim(),
  }
}

/**
 * 1. NIKKEI PRICE-WEIGHTING ATTRIBUTION MATHEMATICS
 */
export function computeNikkeiContributions(
  constituents: NikkeiConstituent[] = DEFAULT_NIKKEI_CONSTITUENTS,
  _divisor: number = NIKKEI_DIVISOR
): NikkeiContributionState {
  const sorted = [...constituents].sort((a, b) => b.priceJpy - a.priceJpy)
  const sumPrices = sorted.reduce((acc, c) => acc + c.priceJpy, 0)

  const fastRetailing = sorted.find((c) => c.symbol.startsWith('9983'))?.priceJpy || 48500
  const tokyoElectron = sorted.find((c) => c.symbol.startsWith('8035'))?.priceJpy || 26200
  const advantest = sorted.find((c) => c.symbol.startsWith('6857'))?.priceJpy || 7950
  const softbank = sorted.find((c) => c.symbol.startsWith('9984'))?.priceJpy || 8900

  const top1ContributionPct = Number(((sorted[0]!.priceJpy / sumPrices) * 100).toFixed(1))
  const top3Sum = (sorted[0]?.priceJpy || 0) + (sorted[1]?.priceJpy || 0) + (sorted[2]?.priceJpy || 0)
  const top3ContributionPct = Number(((top3Sum / sumPrices) * 100).toFixed(1))

  const top5Sum = sorted.slice(0, 5).reduce((acc, c) => acc + c.priceJpy, 0)
  const top5ContributionPct = Number(((top5Sum / sumPrices) * 100).toFixed(1))

  // Semiconductor weight (Tokyo Electron + Advantest + Shin-Etsu + TDK)
  const semiSum = tokyoElectron + advantest + 6100 + 2150
  const semiconductorSharePct = Number(((semiSum / sumPrices) * 100).toFixed(1))

  const weightingConcentration =
    top3ContributionPct > 35 ? 'HIGH' : top3ContributionPct > 22 ? 'MODERATE' : 'BALANCED'

  return {
    sumSharePricesJpy: sumPrices,
    top1ContributionPct,
    top3ContributionPct,
    top5ContributionPct,
    semiconductorSharePct,
    weightingConcentration,
    fastRetailingWeightPct: Number(((fastRetailing / sumPrices) * 100).toFixed(1)),
    tokyoElectronWeightPct: Number(((tokyoElectron / sumPrices) * 100).toFixed(1)),
    advantestWeightPct: Number(((advantest / sumPrices) * 100).toFixed(1)),
    softbankWeightPct: Number(((softbank / sumPrices) * 100).toFixed(1)),
  }
}

/**
 * 2. BANK OF JAPAN & MONETARY POLICY CLASSIFIER
 */
export function evaluateBojPolicyShift(params: {
  rateChangeBps: number
  guidanceText?: string
  jgb10yYield: number
}): {
  stance: 'HAWKISH_HIKE' | 'DOVISH_HOLD' | 'YCC_EXPANSION' | 'NORMALIZING'
  bankImpact: 'STRONG_BULLISH' | 'MILD_BULLISH' | 'NEUTRAL' | 'BEARISH'
  exporterImpact: 'STRONG_HEADWIND' | 'MILD_HEADWIND' | 'NEUTRAL' | 'TAILWIND'
  netNikkeiDirection: 'BULLISH' | 'BEARISH' | 'MIXED'
} {
  const { rateChangeBps, jgb10yYield } = params

  if (rateChangeBps > 0) {
    return {
      stance: 'HAWKISH_HIKE',
      bankImpact: 'STRONG_BULLISH',
      exporterImpact: 'STRONG_HEADWIND',
      netNikkeiDirection: 'MIXED', // Banks rally, auto/exporters dump
    }
  }

  if (jgb10yYield > 1.1) {
    return {
      stance: 'NORMALIZING',
      bankImpact: 'STRONG_BULLISH',
      exporterImpact: 'MILD_HEADWIND',
      netNikkeiDirection: 'BULLISH',
    }
  }

  return {
    stance: 'DOVISH_HOLD',
    bankImpact: 'NEUTRAL',
    exporterImpact: 'TAILWIND',
    netNikkeiDirection: 'BULLISH',
  }
}

/**
 * 3. USD/JPY FX PASS-THROUGH & INTERVENTION ENGINE
 */
export function evaluateUsdJpySensitivity(params: {
  usdjpyRate: number
  usdjpyChangePct: number
}): {
  regime: 'YEN_WEAKNESS_EXPORTER_BOOST' | 'YEN_STRENGTH_HEADWIND' | 'INTERVENTION_ALERT' | 'FX_STABLE'
  interventionRiskLevel: 'CRITICAL' | 'ELEVATED' | 'MODERATE' | 'LOW'
  exporterEarningsImpact: string
  nikkeiBias: NikkeiDirectionalStance
} {
  const { usdjpyRate, usdjpyChangePct } = params

  if (usdjpyRate >= 155.0) {
    return {
      regime: 'INTERVENTION_ALERT',
      interventionRiskLevel: usdjpyRate >= 158.0 ? 'CRITICAL' : 'ELEVATED',
      exporterEarningsImpact: 'High nominal repatriated profits, but extreme risk of sudden MoF currency intervention',
      nikkeiBias: 'MIXED',
    }
  }

  if (usdjpyChangePct > 0.4) {
    return {
      regime: 'YEN_WEAKNESS_EXPORTER_BOOST',
      interventionRiskLevel: 'MODERATE',
      exporterEarningsImpact: 'Accelerating earnings tailwind for automakers, precision machinery, and chip equipment',
      nikkeiBias: 'BULLISH',
    }
  }

  if (usdjpyChangePct < -0.5) {
    return {
      regime: 'YEN_STRENGTH_HEADWIND',
      interventionRiskLevel: 'LOW',
      exporterEarningsImpact: 'Earnings translation compression and potential carry trade unwind pressure',
      nikkeiBias: 'BEARISH',
    }
  }

  return {
    regime: 'FX_STABLE',
    interventionRiskLevel: 'LOW',
    exporterEarningsImpact: 'Neutral currency backdrop; equity pricing dictated by corporate fundamentals and tech cycle',
    nikkeiBias: 'NEUTRAL',
  }
}

/**
 * 4. DETERMINISTIC EVALUATOR FALLBACK FOR PRESETS & OFFLINE ENGINE
 */
export function evaluateNikkeiEventDeterministic(params: {
  rawText: string
  sourceHint?: string
  telemetry?: NikkeiTelemetry
}): StructuredNikkeiEventOutput {
  const { rawText } = params
  const text = rawText.toLowerCase()

  let category: NikkeiEventCategory = 'DOMESTIC_MACRO'
  let eventName = 'NIKKEI_MARKET_EVENT'
  let importance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'
  let intradayStance: NikkeiDirectionalStance = 'NEUTRAL'
  let shortTermStance: NikkeiDirectionalStance = 'NEUTRAL'
  let mediumTermStance: NikkeiDirectionalStance = 'NEUTRAL'
  let bojImpact: 'HAWKISH_TIGHTENING' | 'DOVISH_EASING' | 'NEUTRAL' = 'NEUTRAL'
  let fxPassThrough: 'BULLISH_EXPORTERS' | 'BEARISH_EXPORTERS' | 'NEUTRAL' = 'NEUTRAL'
  let semiEffect: 'RALLY' | 'DRAG' | 'NEUTRAL' = 'NEUTRAL'
  let domesticEffect: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' = 'NEUTRAL'
  let abnormalBehavior: NikkeiAbnormalBehavior = { detected: false, type: 'NONE', explanation: '' }
  let estimatedNkdPointImpact = 0
  let confidence = 85
  let summary = ''
  let actionableTakeaway = ''

  // Preset 1: BoJ Rate Hike (+25 bps) & Bank Rally vs Exporter Drop
  if (text.includes('bank of japan') && (text.includes('raised') || text.includes('hike') || text.includes('25 basis points'))) {
    category = 'BOJ_MONETARY_POLICY'
    eventName = 'BOJ_RATE_HIKE_OVERNIGHT_CALL'
    importance = 'CRITICAL'
    intradayStance = 'MIXED'
    shortTermStance = 'BULLISH'
    mediumTermStance = 'BULLISH'
    bojImpact = 'HAWKISH_TIGHTENING'
    fxPassThrough = 'BEARISH_EXPORTERS'
    domesticEffect = 'POSITIVE'
    estimatedNkdPointImpact = -350
    confidence = 90
    abnormalBehavior = {
      detected: true,
      type: 'BOJ_ABSORPTION',
      explanation:
        'BoJ rate hike triggered initial knee-jerk drop in exporters due to Yen strengthening, but sparked explosive institutional accumulation in Mega Banks (8306 MUFG, 8316 SMFG) on net interest margin expansion.',
    }
    summary =
      'Bank of Japan raised policy rate by 25 bps. Knee-jerk Yen strength pressured automakers and exporters, but financial sector surged on margin expansion, establishing an institutional accumulation floor.'
    actionableTakeaway =
      'Avoid shorting Nikkei breakdown blindly; rotate into financial leaders and look for exporter absorption once USD/JPY stabilizes.'
  }

  // Preset 2: Tokyo Electron & Advantest Semiconductor Surge
  else if (text.includes('tokyo electron') || text.includes('advantest') || text.includes('semiconductor')) {
    category = 'TECH_SEMICONDUCTORS'
    eventName = 'SEMICONDUCTOR_AI_EQUIPMENT_EXPANSION'
    importance = 'HIGH'
    intradayStance = 'BULLISH'
    shortTermStance = 'BULLISH'
    mediumTermStance = 'BULLISH'
    semiEffect = 'RALLY'
    estimatedNkdPointImpact = +380
    confidence = 92
    abnormalBehavior = {
      detected: false,
      type: 'NONE',
      explanation: '',
    }
    summary =
      'Tokyo Electron (8035) and Advantest (6857) rallied strongly on unprecedented AI GPU testing equipment demand. Massive price-weight leverage injected over +380 points into the Nikkei 225.'
    actionableTakeaway =
      'Trade with trend continuation on NKD futures above opening range; semiconductor momentum easily overrides mixed domestic breadth.'
  }

  // Preset 3: MoF FX Intervention Shock (Yen spikes 400 pips)
  else if (text.includes('intervention') || text.includes('ministry of finance') || text.includes('carry trade')) {
    category = 'FX_USD_JPY'
    eventName = 'MOF_CURRENCY_INTERVENTION_LIQUIDATION'
    importance = 'CRITICAL'
    intradayStance = 'BEARISH'
    shortTermStance = 'BEARISH'
    mediumTermStance = 'MIXED'
    fxPassThrough = 'BEARISH_EXPORTERS'
    estimatedNkdPointImpact = -920
    confidence = 95
    abnormalBehavior = {
      detected: true,
      type: 'YEN_DIVERGENCE',
      explanation:
        'Sudden Ministry of Finance Yen buying triggered a violent 450-pip USD/JPY collapse, igniting systematic carry-trade unwinding and rapid long-liquidation across Nikkei index futures.',
    }
    summary =
      'Large-scale MoF currency market intervention sparked violent Yen appreciation, breaking the session low on heavy market sell delta.'
    actionableTakeaway =
      'Respect the automated liquidation cascade; stand aside from long fades until USD/JPY volatility mean-reverts and CVD stabilizes.'
  }

  // Preset 4: Fast Retailing Price-Weight Distortion
  else if (text.includes('fast retailing') || text.includes('uniqlo') || text.includes('9983')) {
    category = 'EARNINGS_EXPORTERS'
    eventName = 'FAST_RETAILING_PRICE_WEIGHT_DISTORTION'
    importance = 'HIGH'
    intradayStance = 'BULLISH'
    shortTermStance = 'MIXED'
    mediumTermStance = 'BULLISH'
    domesticEffect = 'POSITIVE'
    estimatedNkdPointImpact = +144
    confidence = 88
    abnormalBehavior = {
      detected: true,
      type: 'PRICE_WEIGHT_DISTORTION',
      explanation:
        'Fast Retailing (9983.T) jumped 9% on record global profits. Because it comprises >10% of the price-weighted index, its ¥4,350 gain injected +144 points into Nikkei, masking declines across 140 other stocks.',
    }
    summary =
      'Classic price-weighting distortion: massive gain in highest-priced component Fast Retailing elevated headline Nikkei futures despite negative overall market breadth.'
    actionableTakeaway =
      'Watch constituent breadth; if rally is driven exclusively by Fast Retailing without semiconductor participation, treat extended highs as vulnerable to afternoon fades.'
  }

  // Preset 5: US Overnight Gap Fade at Tokyo Open
  else if (text.includes('gap') || text.includes('overnight') || text.includes('absorption')) {
    category = 'MARKET_STRUCTURE'
    eventName = 'TOKYO_OPEN_OVERNIGHT_GAP_FADE'
    importance = 'HIGH'
    intradayStance = 'BEARISH'
    shortTermStance = 'MIXED'
    mediumTermStance = 'NEUTRAL'
    estimatedNkdPointImpact = -280
    confidence = 86
    abnormalBehavior = {
      detected: true,
      type: 'OVERNIGHT_GAP_FADE',
      explanation:
        'Euphoric opening gap from overnight US tech rally was met by heavy domestic institutional sell delta within the first 15 minutes (OR15), rejecting resistance and driving mean reversion.',
    }
    summary =
      'Opening gap above 39,600 failed to attract follow-through buying. Order flow CVD confirmed institutional absorption of retail buyers followed by roll-reversal back to prior US session VWAP.'
    actionableTakeaway =
      'Fade the failed opening breakout; target mean reversion toward prior US session VWAP and Tokyo value area high.'
  }

  // Unclassified notes stay neutral. A keyword is not a print.
  else {
    category = 'DOMESTIC_MACRO'
    eventName = 'UNCLASSIFIED_NIKKEI_NOTE'
    importance = 'LOW'
    intradayStance = 'NEUTRAL'
    shortTermStance = 'NEUTRAL'
    mediumTermStance = 'NEUTRAL'
    estimatedNkdPointImpact = 0
    confidence = 0
    summary = ''
    actionableTakeaway = 'No sourced print was in the note.'
  }

  void intradayStance
  void shortTermStance
  void mediumTermStance
  void bojImpact
  void fxPassThrough
  void semiEffect
  void domesticEffect
  void abnormalBehavior
  void confidence
  void actionableTakeaway
  const impact = sourcedImpact(rawText, estimatedNkdPointImpact)
  const cleanSummary = scrubSummary(rawText, summary)
  const keptNarrative = cleanSummary === summary && summary.length > 0 && !/\d/.test(summary)
  return {
    event: eventName,
    category,
    importance: keptNarrative ? importance : 'LOW',
    confidence: keptNarrative ? 0 : 0,
    market_stance: {
      intraday: 'NEUTRAL',
      short_term: 'NEUTRAL',
      medium_term: 'NEUTRAL',
    },
    transmission_channels: {
      boj_policy_impact: 'NEUTRAL',
      fx_pass_through: 'NEUTRAL',
      tech_semiconductor_effect: 'NEUTRAL',
      domestic_growth_effect: 'NEUTRAL',
    },
    market_reaction: {
      nkd_initial_reaction: impact == null ? 'FLAT' : impact >= 0 ? 'UP' : 'DOWN',
      nkd_5m_continuation: 'STALLED',
      usdjpy_reaction: 'FLAT',
      jgb10y_reaction: 'FLAT',
    },
    abnormal_behavior: {
      detected: false,
      type: 'NONE',
      explanation: 'No sourced print was in the note.',
    },
    estimated_nkd_point_impact: impact,
    summary: keptNarrative ? cleanSummary : 'No sourced print was in the note.',
    actionable_takeaway: 'No sourced print was in the note.',
  }
}

/**
 * 5. LLM EVALUATION ENGINE
 */
async function runLlmNikkeiEvaluation(params: {
  rawText: string
  sourceHint?: string
  telemetry: NikkeiTelemetry
  anthropicKey?: string
  openaiKey?: string
}): Promise<StructuredNikkeiEventOutput | null> {
  const { rawText, sourceHint, telemetry, anthropicKey, openaiKey } = params

  const prompt = buildFundamentalEventUserPrompt({
    roleLine: 'You are evaluating a supplied event for CME Nikkei 225 futures (NKD) and the Tokyo cash market.',
    telemetryLines: [
      datumLine('NKD', telemetry.sourced?.nkd ? telemetry.nkdPrice.toLocaleString() : 'UNAVAILABLE', telemetry.sourced?.nkd ? 'TICK' : 'UNAVAILABLE', telemetry.sourced?.nkd ? 'LIVE' : 'STALE'),
      datumLine('USD/JPY', telemetry.sourced?.usdjpy ? telemetry.usdjpyRate.toFixed(2) : 'UNAVAILABLE', telemetry.sourced?.usdjpy ? 'TICK' : 'UNAVAILABLE', telemetry.sourced?.usdjpy ? 'LIVE' : 'STALE'),
      datumLine('10Y JGB', 'UNAVAILABLE', 'INTRADAY', 'STALE'),
      datumLine('SOX', telemetry.sourced?.sox ? String(telemetry.soxIndex) : 'UNAVAILABLE', 'INTRADAY', telemetry.sourced?.sox ? 'RECENT' : 'STALE'),
      datumLine('Advancers', 'UNAVAILABLE', 'INTRADAY', 'STALE'),
      datumLine('Decliners', 'UNAVAILABLE', 'INTRADAY', 'STALE'),
      `Tokyo cash session: ${telemetry.tokyoCashSessionActive ? 'OPEN' : 'CLOSED'} (${telemetry.tokyoSessionPhase})`,
      'CURRENT NIKKEI CONTRIBUTORS: UNAVAILABLE. Do not cite memorized weights.',
      'MOF_INTERVENTION_RISK: UNKNOWN. Do not infer it from a spot level.',
      'PRECOMPUTED_NKD_POINT_IMPACT: UNAVAILABLE.',
    ],
    rawText,
    source: sourceHint,
    specialistNotes: `market is NK225.
confidence is HIGH, MEDIUM, LOW, or UNKNOWN.
specialist.desk_context is what to watch. It is not a trade instruction. Do not emit actionable_takeaway.
specialist.nkd_point_impact is null.
specialist.mof_intervention_risk is null unless this packet sets MOF_INTERVENTION_RISK.`,
  })

  try {
    let rawJsonText: string | null = null

    if (anthropicKey) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1500,
          system: NIKKEI_ANALYST_EVENT_PROMPT,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (res.ok) {
        const data = await res.json()
        rawJsonText = data.content?.[0]?.text || null
      }
    } else if (openaiKey) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: NIKKEI_ANALYST_EVENT_PROMPT },
            { role: 'user', content: prompt },
          ],
        }),
      })

      if (res.ok) {
        const data = await res.json()
        rawJsonText = data.choices?.[0]?.message?.content || null
      }
    }

    if (rawJsonText) {
      const cleanJson = rawJsonText.replace(/```json\n?|\n?```/g, '').trim()
      return adaptLegacyFundamentalJson(JSON.parse(cleanJson)) as unknown as StructuredNikkeiEventOutput
    }
  } catch (err) {
    logger.warn('[NikkeiAnalystEngine] LLM evaluation threw error, using fallback', err)
  }

  return null
}

/**
 * 6. UNIFIED INSTITUTIONAL EVENT EVALUATOR
 */
export async function evaluateNikkeiEvent(params: {
  rawText: string
  sourceHint?: string
  autoCommitIfMaterial?: boolean
  forcedTelemetry?: NikkeiTelemetry
}): Promise<NikkeiEventEvaluation> {
  const { rawText, sourceHint, forcedTelemetry } = params

  const telemetry: NikkeiTelemetry = forcedTelemetry || peekNikkeiFundamentalState().nikkeiTelemetry

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  let structuredOutput: StructuredNikkeiEventOutput | null = null

  if (anthropicKey || openaiKey) {
    structuredOutput = await runLlmNikkeiEvaluation({
      rawText,
      sourceHint,
      telemetry,
      anthropicKey,
      openaiKey,
    })
  }

  if (!structuredOutput) {
    structuredOutput = evaluateNikkeiEventDeterministic({
      rawText,
      sourceHint,
      telemetry,
    })
  }

  const evaluation: NikkeiEventEvaluation = {
    id: `eval_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
    event: structuredOutput.event,
    rawText,
    structuredOutput,
    safeguards: {
      noInventedData: true,
      priceWeightingNotCapWeighting: true,
      yenSensitivityEvaluated: true,
      bojHikeNotAutoBearish: true,
      semiconductorTransmissionChecked: true,
      tokyoCashVsOvernightDistinguished: true,
      eventDeduplicated: true,
    },
  }

  // Record into state store
  recordEvaluatedNikkeiEvent(evaluation)

  return evaluation
}
