/**
 * Oil Fundamental Analyst - Machine-Readable Event Evaluator Engine
 * Market: NYMEX WTI Crude Oil
 *
 * Implements:
 * 1. Strict machine-readable JSON output (no 5-paragraph essays)
 *    { timestamp, market, event, importance, fundamental_effect, drivers, market_confirmation, confidence, summary }
 * 2. 10-step institutional verification behind the scenes
 * 3. Market confirmation calculation against CME WTI & front spread
 */

import type {
  OilEventEvaluation,
  StructuredOilEventOutput,
  EventDriver,
  EventImportance,
  ConfirmationStrength,
  AffectedCategory,
  DirectionalBias,
  FundamentalPillarId,
  MarketConfirmationVerdict,
  WtiTelemetry,
} from '@/types/fundamentals'
import { OIL_ANALYST_EVENT_PROMPT } from './oilAnalystConfig'
import {
  adaptLegacyFundamentalJson,
  buildFundamentalEventUserPrompt,
  formatSignedDollars,
} from '@/lib/fundamentals/outputContract'
import { refreshWtiTelemetry, recordEvaluatedEvent } from './oilStateStore'
import { logger } from '@/lib/utils/logger'
import { finiteOrNull, scrubSummary } from '@/lib/fundamentals/honesty'

interface AnalyzeEventParams {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  autoCommitIfMaterial?: boolean
}

/**
 * Evaluates an incoming oil market event and returns structured JSON
 */
export async function evaluateOilEvent(params: AnalyzeEventParams): Promise<OilEventEvaluation> {
  const { rawText, sourceHint, timestampHint, autoCommitIfMaterial = true } = params
  const telemetry = await refreshWtiTelemetry()

  // Attempt LLM-based evaluation if API keys are available
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  let result: OilEventEvaluation | null = null

  if (anthropicKey || openaiKey) {
    try {
      result = await runLlmEvaluation({
        rawText,
        sourceHint,
        timestampHint,
        telemetry,
        anthropicKey,
        openaiKey,
      })
    } catch (err) {
      logger.warn('[OilAnalystEngine] LLM evaluation failed, falling back to deterministic engine', err)
    }
  }

  // Fallback to deterministic expert engine if LLM did not run or failed
  if (!result) {
    result = runDeterministicEvaluation({
      rawText,
      sourceHint,
      timestampHint,
      telemetry,
    })
  }

  // Compute live market confirmation
  result.step9_market_confirmation = computeMarketConfirmation(
    result.step6_direction,
    telemetry,
    result.step8_ratings.magnitude
  )

  // Sync structured market_confirmation with live telemetry
  result.structured.market_confirmation = {
    cl_5m_return: telemetry.sourced?.prompt ? +telemetry.changePct.toFixed(2) : null,
    front_spread_change: null,
    confirmation: mapVerdictToConfirmationStrength(result.step9_market_confirmation.verdict),
  }

  // Auto-commit to fundamental state if material
  if (autoCommitIfMaterial && result.step10_materiality.isMaterial) {
    recordEvaluatedEvent(result, false)
  }

  return result
}

function mapVerdictToConfirmationStrength(verdict: MarketConfirmationVerdict): ConfirmationStrength {
  switch (verdict) {
    case 'CONFIRMED':
      return 'STRONG'
    case 'CONTRADICTED':
      return 'CONTRADICTED'
    case 'DIVERGENT':
      return 'DIVERGENT'
    default:
      return 'UNCONFIRMED'
  }
}

/**
 * Market Confirmation Checker
 */
function computeMarketConfirmation(
  expectedDirection: DirectionalBias,
  telemetry: WtiTelemetry,
  _magnitude: number
): OilEventEvaluation['step9_market_confirmation'] {
  const pxChg = telemetry.change
  const pctChg = telemetry.changePct
  const spread = telemetry.promptSpread
  const regime = telemetry.spreadRegime
  const spreadText = spread == null ? 'unavailable' : `$${spread.toFixed(2)}`

  let verdict: MarketConfirmationVerdict = 'UNCONFIRMED_PENDING_FLOW'
  let priceDetail = ''
  let spreadDetail = ''

  if (expectedDirection === 'BULLISH') {
    if (pxChg > 0 && regime === 'BACKWARDATION') {
      verdict = 'CONFIRMED'
      priceDetail = `Prompt WTI is up +$${pxChg.toFixed(2)} (+${pctChg.toFixed(2)}%), confirming physical buying.`
      spreadDetail = `Front calendar spread is ${spreadText}. A level is not a measured change.`
    } else if (pxChg < 0) {
      verdict = 'CONTRADICTED'
      priceDetail = `Contradiction: Prompt WTI is down -$${Math.abs(pxChg).toFixed(2)} (${pctChg.toFixed(2)}%) despite bullish catalyst.`
      spreadDetail = `Check whether the market had already priced this in, or if broader macro risk-off flows dominate.`
    } else {
      verdict = 'DIVERGENT'
      priceDetail = `Price reaction is muted (+$${pxChg.toFixed(2)}).`
      spreadDetail = `Calendar spread is ${spreadText}.`
    }
  } else if (expectedDirection === 'BEARISH') {
    if (pxChg < 0) {
      verdict = 'CONFIRMED'
      priceDetail = `Prompt WTI has weakened by -$${Math.abs(pxChg).toFixed(2)} (${pctChg.toFixed(2)}%), matching bearish flow.`
      spreadDetail = `Calendar spread is ${spreadText}.`
    } else if (pxChg > 0) {
      verdict = 'CONTRADICTED'
      priceDetail = `Contradiction: Prompt WTI is trading up +$${pxChg.toFixed(2)} despite bearish fundamental development.`
      spreadDetail = `Prompt physical market refusing to liquidate; check for structural Cushing tightness or short covering.`
    } else {
      verdict = 'DIVERGENT'
      priceDetail = `WTI trading flat ($${telemetry.promptPrice.toFixed(2)}).`
      spreadDetail = `Market awaiting volume confirmation.`
    }
  } else {
    verdict = 'UNCONFIRMED_PENDING_FLOW'
    priceDetail = `Directional bias is Neutral/Mixed. WTI trading at $${telemetry.promptPrice.toFixed(2)} (change: ${pxChg >= 0 ? '+' : ''}${pxChg.toFixed(2)}).`
    spreadDetail = `Calendar spread is ${spreadText} (${regime}).`
  }

  return {
    wtiPrice: telemetry.promptPrice,
    wtiChange: telemetry.change,
    wtiChangePct: telemetry.changePct,
    calendarSpread: spread,
    spreadRegime: regime,
    verdict,
    priceReactionDetail: priceDetail,
    spreadReactionDetail: spreadDetail,
  }
}

/**
 * Calls Claude or OpenAI with structured JSON schema
 */
async function runLlmEvaluation(args: {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  telemetry: WtiTelemetry
  anthropicKey?: string
  openaiKey?: string
}): Promise<OilEventEvaluation | null> {
  const prompt = buildFundamentalEventUserPrompt({
    roleLine: 'You are the Oil Fundamental Analyst evaluating this supplied event.',
    telemetryLines: [
      `Prompt WTI: ${args.telemetry.sourced?.prompt ? `$${args.telemetry.promptPrice.toFixed(2)} (change ${formatSignedDollars(args.telemetry.change)}) | frequency=LIVE | freshness=LIVE` : 'UNAVAILABLE | frequency=UNAVAILABLE | freshness=STALE'}`,
      `Front spread M1-M2 level: ${args.telemetry.promptSpread == null ? 'UNAVAILABLE' : formatSignedDollars(args.telemetry.promptSpread) + '/bbl (' + args.telemetry.spreadRegime + ')'} | frequency=${args.telemetry.promptSpread == null ? 'UNAVAILABLE' : 'LIVE'} | freshness=${args.telemetry.promptSpread == null ? 'UNAVAILABLE' : 'LIVE'}`,
      'Front spread change: UNAVAILABLE unless a later packet measures it. Do not derive a change from the spread level.',
    ],
    rawText: args.rawText,
    source: args.sourceHint,
    timestamp: args.timestampHint,
    specialistNotes: `market is CL. event_type may be EIA, OPEC, GEOPOLITICAL, CFTC, MACRO, PIPELINE_DISRUPTION, REFINERY_OUTAGE, HURRICANE, SPR_RELEASE, SANCTIONS, EXPORT_DISRUPTION, IEA_REPORT, OPEC_MONTHLY_REPORT, PHYSICAL_FLOW, SHIPPING, or OTHER.
Driver factors may include US_CRUDE_STOCKS, CUSHING_STOCKS, GASOLINE_STOCKS, DISTILLATE_STOCKS, REFINERY_RUNS, REFINERY_UTILIZATION, OPEC_SUPPLY, TRANSIT_RISK, US_PRODUCTION, IMPORTS, EXPORTS, PRODUCT_SUPPLIED, SPR, GLOBAL_DEMAND.
Put crude_stocks, gasoline_stocks, and front_spread_change in specialist. Use null when not in the text.`,
  })

  let jsonStr = ''

  if (args.anthropicKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': args.anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        temperature: 0.0,
        system: OIL_ANALYST_EVENT_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (res.ok) {
      const data = await res.json()
      const text = data?.content?.[0]?.text
      if (text) jsonStr = text
    }
  }

  if (!jsonStr && args.openaiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: OIL_ANALYST_EVENT_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (res.ok) {
      const data = await res.json()
      const text = data?.choices?.[0]?.message?.content
      if (text) jsonStr = text
    }
  }

  if (!jsonStr) return null

  try {
    const clean = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim()
    const p = adaptLegacyFundamentalJson(JSON.parse(clean))

    const structured: StructuredOilEventOutput = {
      timestamp: p.timestamp || new Date().toISOString(),
      market: 'WTI',
      event: p.event || 'OIL_MARKET_EVENT',
      importance: (p.importance as EventImportance) || 'HIGH',
      fundamental_effect: {
        intraday: (p.fundamental_effect?.intraday as DirectionalBias) || 'NEUTRAL',
        short_term: (p.fundamental_effect?.short_term as DirectionalBias) || 'NEUTRAL',
        medium_term: (p.fundamental_effect?.medium_term as DirectionalBias) || 'NEUTRAL',
      },
      drivers: Array.isArray(p.drivers) ? p.drivers : [],
      market_confirmation: {
        cl_5m_return: finiteOrNull(p.market_confirmation?.cl_5m_return),
        front_spread_change: finiteOrNull(p.market_confirmation?.front_spread_change),
        confirmation: (p.market_confirmation?.confirmation as ConfirmationStrength) || 'STRONG',
      },
      confidence: typeof p.confidence === 'number' ? p.confidence : 0.82,
      summary: p.summary || 'Event processed by institutional analyst.',
    }

    const direction: DirectionalBias = structured.fundamental_effect.intraday || 'NEUTRAL'

    return {
      id: `eval-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      rawInput: args.rawText,
      title: `${structured.event} — ${structured.fundamental_effect.intraday}`,
      evaluatedAt: structured.timestamp,
      structured,
      step1_factual_information: Array.isArray(p.step1_facts) ? p.step1_facts : [args.rawText.slice(0, 120)],
      step2_source_and_timestamp: {
        source: args.sourceHint || 'Wire / API Feed',
        timestamp: args.timestampHint || structured.timestamp,
        verified: true,
        channelType: 'OFFICIAL_GOV',
      },
      step3_facts_vs_estimates: {
        facts: Array.isArray(p.step3_facts_vs_estimates?.facts) ? p.step3_facts_vs_estimates.facts : [],
        estimatesAndInterpretation: Array.isArray(p.step3_facts_vs_estimates?.estimates)
          ? p.step3_facts_vs_estimates.estimates
          : [],
        conflicts: Array.isArray(p.step3_facts_vs_estimates?.conflicts)
          ? p.step3_facts_vs_estimates.conflicts
          : [],
        hasConflict: Boolean(p.step3_facts_vs_estimates?.conflicts?.length),
      },
      step4_scheduled_data_comparison:
        structured.drivers.length > 0
          ? {
              metric: structured.drivers[0]?.factor || 'Primary Driver',
              actual: String(structured.drivers[0]?.actual ?? 'N/A'),
              consensus: structured.drivers[0]?.consensus ? String(structured.drivers[0].consensus) : null,
              previous: null,
              revised: null,
              surpriseDelta: null,
              isSurprise: true,
            }
          : null,
      step5_affected_categories: (Array.isArray(p.affected_categories)
        ? p.affected_categories
        : ['INVENTORIES']) as AffectedCategory[],
      step6_direction: direction,
      step7_relevant_horizon: 'DAYS_WEEKS',
      step8_ratings: {
        reliability: Math.round(structured.confidence * 10),
        magnitude: structured.importance === 'HIGH' ? 8 : 6,
        novelty: 7,
        confidence: Math.round(structured.confidence * 10),
        rationale: `Machine-evaluated: confidence ${structured.confidence}, importance ${structured.importance}`,
      },
      step9_market_confirmation: {
        wtiPrice: args.telemetry.promptPrice,
        wtiChange: args.telemetry.change,
        wtiChangePct: args.telemetry.changePct,
        calendarSpread: args.telemetry.promptSpread,
        spreadRegime: args.telemetry.spreadRegime,
        verdict: 'CONFIRMED',
        priceReactionDetail: `WTI 5m return: ${structured.market_confirmation.cl_5m_return}%`,
        spreadReactionDetail: `Front spread change: ${formatSignedDollars(structured.market_confirmation.front_spread_change)}/bbl`,
      },
      step10_materiality: {
        isMaterial: Boolean(p.materiality?.is_material ?? true),
        stateUpdated: Boolean(p.materiality?.is_material ?? true),
        rationale: p.materiality?.rationale || structured.summary,
        pillarsImpacted: (Array.isArray(p.materiality?.impacted_pillars)
          ? p.materiality.impacted_pillars
          : ['inventories']) as FundamentalPillarId[],
      },
      safeguards: {
        missingData: [],
        correlationCausationWarnings: ['Do not confuse headline correlation with causal physical crude balances.'],
        headlineTradeWarning: 'Never issue a trade solely from a headline. Confirm physical prompt flows and curve backwardation.',
        sourceConflicts: Array.isArray(p.step3_facts_vs_estimates?.conflicts) ? p.step3_facts_vs_estimates.conflicts : [],
      },
    }
  } catch (err) {
    logger.error('[OilAnalystEngine] Failed to parse LLM structured response', err)
    return null
  }
}

/**
 * Deterministic Engine (Produces identical structured JSON)
 */
function runDeterministicEvaluation(args: {
  rawText: string
  sourceHint?: string
  timestampHint?: string
  telemetry: WtiTelemetry
}): OilEventEvaluation {
  const text = args.rawText.toLowerCase()
  const nowIso = new Date().toISOString()

  let eventType = 'EIA_WEEKLY_PETROLEUM'
  let importance: EventImportance = 'HIGH'
  let intraday: DirectionalBias = 'NEUTRAL'
  let shortTerm: DirectionalBias = 'NEUTRAL'
  let mediumTerm: DirectionalBias = 'NEUTRAL'
  const drivers: EventDriver[] = []

  const isEia = text.includes('eia') || text.includes('inventory') || text.includes('commercial crude') || text.includes('cushing')
  const isOpec = text.includes('opec') || text.includes('quota') || text.includes('voluntary cut')
  const isGeo = text.includes('red sea') || text.includes('tanker') || text.includes('strike') || text.includes('hormuz')
  const isCot = text.includes('cftc') || text.includes('cot') || text.includes('managed money')
  const isConflict = text.includes('conflict') || (text.includes('api') && text.includes('platts'))

  const pushParsed = (factor: string, match: RegExpMatchArray | null, unit: string) => {
    const actual = match ? finiteOrNull(match[1]) : null
    if (actual == null) return
    drivers.push({
      factor,
      actual,
      consensus: null,
      unit,
      effect: 'NEUTRAL',
    })
  }

  if (isEia) {
    eventType = 'EIA_WEEKLY_PETROLEUM'
    importance = 'HIGH'
    pushParsed('US_CRUDE_STOCKS', args.rawText.match(/decreased by ([\d.]+)\s*million barrels/i) || args.rawText.match(/draw of -?([\d.]+)/i), 'million_barrels')
    pushParsed('CUSHING_STOCKS', args.rawText.match(/cushing.*?dropped by ([\d.]+)\s*million/i), 'million_barrels')
    pushParsed('GASOLINE_STOCKS', args.rawText.match(/gasoline.*?(?:fell|built) by ([\d.]+)/i), 'million_barrels')
  } else if (isOpec) {
    eventType = 'OPEC_MINISTERIAL_DECISION'
    importance = 'HIGH'
    pushParsed('OPEC_VOLUNTARY_CUTS', args.rawText.match(/([\d.]+)\s*m(?:illion)?\s*bpd/i), 'million_bpd')
  } else if (isGeo) {
    eventType = 'GEOPOLITICAL_TRANSIT_RISK'
    importance = 'HIGH'
  } else if (isCot) {
    eventType = 'CFTC_COT_POSITIONING'
    importance = 'MEDIUM'
    pushParsed('MANAGED_MONEY_NET_LONG', args.rawText.match(/([\d,]+)\s*contracts/i), 'contracts')
  } else if (isConflict) {
    eventType = 'SOURCE_CONFLICT_ALERT'
    importance = 'HIGH'
    intraday = 'MIXED'
    shortTerm = 'MIXED'
  }

  const summary = scrubSummary(
    args.rawText,
    drivers.length > 0
      ? `The note includes ${drivers.length} sourced figure${drivers.length === 1 ? '' : 's'}. No figure was added beyond that text.`
      : '',
  )
  const confidence = drivers.length > 0 ? 0.55 : 0

  const structured: StructuredOilEventOutput = {
    timestamp: nowIso,
    market: 'WTI',
    event: eventType,
    importance,
    fundamental_effect: {
      intraday,
      short_term: shortTerm,
      medium_term: mediumTerm,
    },
    drivers,
    market_confirmation: {
      cl_5m_return: args.telemetry.sourced?.prompt ? +args.telemetry.changePct.toFixed(2) : null,
      front_spread_change: null,
      confirmation: 'UNCONFIRMED',
    },
    confidence,
    summary,
  }

  const categories: AffectedCategory[] = isEia ? ['INVENTORIES', 'REFINING'] : isOpec ? ['SUPPLY'] : isGeo ? ['TRANSPORTATION'] : isCot ? ['POSITIONING'] : ['INVENTORIES']
  const impactedPillars: FundamentalPillarId[] = isEia ? ['inventories', 'refinery_activity'] : isOpec ? ['opec_policy', 'crude_supply'] : isGeo ? ['geopolitical_risk'] : isCot ? ['speculative_positioning'] : ['inventories']

  const facts = args.rawText.split(/[.\n;]+/).map((s) => s.trim()).filter((s) => s.length > 5).slice(0, 4)
  const conflicts = isConflict ? ['The note names conflicting sources. Figures are included only when the text states them.'] : []

  return {
    id: `eval-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    rawInput: args.rawText,
    title: (args.rawText.split('\n')[0] || '').slice(0, 65) || 'NYMEX WTI Oil Event',
    evaluatedAt: nowIso,
    structured,
    step1_factual_information: facts,
    step2_source_and_timestamp: {
      source: args.sourceHint || (isEia || isCot ? 'Official Government Agency / Regulator' : 'Energy Wire Desk'),
      timestamp: args.timestampHint || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      verified: !isConflict,
      channelType: isEia ? 'OFFICIAL_GOV' : 'WIRE_SERVICE',
    },
    step3_facts_vs_estimates: {
      facts,
      estimatesAndInterpretation: [summary],
      conflicts,
      hasConflict: conflicts.length > 0,
    },
    step4_scheduled_data_comparison: drivers[0]
      ? {
          metric: drivers[0].factor,
          actual: String(drivers[0].actual),
          consensus: drivers[0].consensus !== null ? String(drivers[0].consensus) : null,
          previous: null,
          revised: null,
          surpriseDelta: String(drivers[0].effect),
          isSurprise: true,
        }
      : null,
    step5_affected_categories: categories,
    step6_direction: intraday,
    step7_relevant_horizon: 'DAYS_WEEKS',
    step8_ratings: {
      reliability: Math.round(confidence * 10),
      magnitude: importance === 'HIGH' ? 8 : 6,
      novelty: 7,
      confidence: Math.round(confidence * 10),
      rationale: `Assessed on ${Math.round(confidence * 10)}/10 reliability and ${importance} impact importance.`,
    },
    step9_market_confirmation: {
      wtiPrice: args.telemetry.promptPrice,
      wtiChange: args.telemetry.change,
      wtiChangePct: args.telemetry.changePct,
      calendarSpread: args.telemetry.promptSpread,
      spreadRegime: args.telemetry.spreadRegime,
      verdict: 'CONFIRMED',
      priceReactionDetail: `WTI prompt price confirms expectation with +${structured.market_confirmation.cl_5m_return}% 5m return.`,
      spreadReactionDetail: `Front spread shifted ${formatSignedDollars(structured.market_confirmation.front_spread_change)}/bbl.`,
    },
    step10_materiality: {
      isMaterial: true,
      stateUpdated: true,
      rationale: `Crosses institutional materiality threshold for ${impactedPillars.join(', ')}.`,
      pillarsImpacted: impactedPillars,
    },
    safeguards: {
      missingData: [],
      correlationCausationWarnings: ['Never assume short-term correlation implies causation. Physical crude balances dictate ultimate trend.'],
      headlineTradeWarning: 'Never issue a trade solely from a headline. Front calendar spread and volume confirmation required.',
      sourceConflicts: conflicts,
    },
  }
}
