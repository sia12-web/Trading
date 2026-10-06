/**
 * Shared contract for the five fundamental agents.
 * Code calculates. The model interprets supplied data only.
 * Event evaluation is machine JSON. Chat is prose.
 */

export type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

export type DirectionLabel = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED' | 'UNKNOWN'

export type Freshness = 'LIVE' | 'RECENT' | 'SLOW_MOVING' | 'STALE' | 'STALE_FOR_INTRADAY'

export type FundamentalEnvelope = {
  schema_version: '1.0'
  market: string
  event_id: string | null
  event_type: string
  source: {
    name: string | null
    published_at: string | null
    reliability: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
  }
  expected_effect: {
    direction: DirectionLabel | null
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW' | null
  }
  state: {
    intraday: DirectionLabel | null
    short_term: DirectionLabel | null
    medium_term: DirectionLabel | null
  }
  market_reaction: {
    status: string | null
  }
  abnormal_behavior: {
    detected: boolean
    type: string | null
  }
  confidence: ConfidenceLabel
  invalidation: string | null
  specialist: Record<string, unknown>
  evidence?: {
    facts: string[]
    estimates: string[]
    interpretations: string[]
    unknowns: string[]
    conflicts: string[]
  }
}

export const FUNDAMENTAL_SHARED_RULES = `SHARED RULES (all fundamental agents):
- Analyze only events and telemetry that were supplied. You do not continuously monitor markets. The backend supplies data. You interpret that packet.
- Never invent a missing number, weight, surprise, point contribution, spread change, breadth figure, or reaction.
- Almost every observation may be null or UNKNOWN. If a field was not supplied, set it null and data_status UNAVAILABLE. Do not guess UP, DOWN, or FLAT.
- Every supplied datum should be read with its freshness: LIVE, RECENT, SLOW_MOVING, STALE, or STALE_FOR_INTRADAY. Weekly and monthly figures are background regime evidence. They are not information from the last minute.
- Do not calculate statistics or index points. If standardized_surprise, index point impact, breadth, or spread change is absent, leave it null. Code computes those before the prompt.
- Do not independently infer a technical reaction. You do not see CVD, delta, volume profile, or reclaim unless a MARKET_REACTION block is supplied. If that block says UNAVAILABLE, market_reaction.status is null and abnormal_behavior.detected is false.
- This output is a candidate interpretation for one lifecycle point (T0 expected effect, or a later sample if MARKET_REACTION is present). You do not flip the stored regime. A state reducer decides whether state changes.
- Separate FACT, ESTIMATE, INTERPRETATION, and UNKNOWN. If the schema includes evidence, fill those lists. Otherwise say what is unknown in invalidation or the summary.
- Never issue a trade. Never treat a headline as a trade.`

export const FUNDAMENTAL_EVENT_OUTPUT_RULES = `EVENT EVALUATOR OUTPUT:
Return one JSON object and nothing else. No markdown. This is machine-to-machine.
Use this envelope. Market-specific fields go only in specialist.
{
  "schema_version": "1.0",
  "market": "NQ",
  "event_id": null,
  "event_type": "US_CPI",
  "source": { "name": null, "published_at": null, "reliability": "UNKNOWN" },
  "expected_effect": { "direction": "BEARISH", "magnitude": "HIGH" },
  "state": { "intraday": null, "short_term": null, "medium_term": null },
  "market_reaction": { "status": null },
  "abnormal_behavior": { "detected": false, "type": null },
  "confidence": "HIGH",
  "invalidation": null,
  "evidence": { "facts": [], "estimates": [], "interpretations": [], "unknowns": [], "conflicts": [] },
  "specialist": {}
}
confidence is HIGH, MEDIUM, LOW, or UNKNOWN. Not a 0-1 score and not 0-100.
state is the candidate, not a committed regime change.
Direction values are BULLISH, BEARISH, NEUTRAL, MIXED, or UNKNOWN, or null.`

export const FUNDAMENTAL_CHAT_RULES = `FUNDAMENTALS CHAT:
Answer the human in concise prose. Do not emit the event JSON envelope.
Say when a figure is stale or missing. Do not give an order. Do not invent CVD, profile, or reclaim behavior.
If the trader asks what to do, describe what the supplied fundamental context supports or contradicts, then stop.`

export function composeAnalystPrompts(core: string, specialistNotes: string): {
  core: string
  event: string
  chat: string
} {
  const trimmed = core.trim()
  return {
    core: trimmed,
    event: `${trimmed}\n\n${FUNDAMENTAL_SHARED_RULES}\n\n${FUNDAMENTAL_EVENT_OUTPUT_RULES}\n\nSPECIALIST FIELDS:\n${specialistNotes.trim()}`,
    chat: `${trimmed}\n\n${FUNDAMENTAL_SHARED_RULES}\n\n${FUNDAMENTAL_CHAT_RULES}`,
  }
}

export function formatSignedNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return 'UNAVAILABLE'
  if (value === 0) return (0).toFixed(digits)
  const sign = value > 0 ? '+' : '-'
  return `${sign}${Math.abs(value).toFixed(digits)}`
}

/** Signed dollar amount. Negative values render as -$0.24, never +$-0.24. */
export function formatSignedDollars(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return 'UNAVAILABLE'
  const body = Math.abs(value).toFixed(digits)
  if (value > 0) return `+$${body}`
  if (value < 0) return `-$${body}`
  return `$${body}`
}

export function datumLine(label: string, value: string, frequency: string, freshness: Freshness): string {
  return `- ${label}: ${value} | frequency=${frequency} | freshness=${freshness}`
}

export function buildFundamentalEventUserPrompt(args: {
  roleLine: string
  telemetryLines: string[]
  rawText: string
  source?: string
  timestamp?: string
  specialistNotes: string
  marketReaction?: string | null
}): string {
  const reaction =
    args.marketReaction && args.marketReaction.trim().length > 0
      ? args.marketReaction.trim()
      : `UNAVAILABLE
Do not infer price path, CVD, delta, volume, profile, or reclaim.
Set market_reaction.status to null.
Set abnormal_behavior.detected to false and abnormal_behavior.type to null.`

  return `${args.roleLine.trim()}

SUPPLIED TELEMETRY:
${args.telemetryLines.map((line) => (line.startsWith('-') ? line : `- ${line}`)).join('\n')}

MARKET_REACTION:
${reaction}

EVENT:
Source: ${args.source || 'UNAVAILABLE'}
Published at: ${args.timestamp || 'UNAVAILABLE'}
"""
${args.rawText}
"""

${args.specialistNotes.trim()}

Return only the common JSON envelope. Copy numbers from this packet. Do not calculate new ones.`
}

const CONFIDENCE_LABELS: Record<string, ConfidenceLabel> = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  UNKNOWN: 'UNKNOWN',
}

export function confidenceToUnit(raw: unknown): number | null {
  if (typeof raw === 'string') {
    const label = CONFIDENCE_LABELS[raw.trim().toUpperCase()]
    if (label === 'HIGH') return 0.8
    if (label === 'MEDIUM') return 0.55
    if (label === 'LOW') return 0.35
    return null
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 1 && raw <= 100) return raw / 100
    if (raw >= 0 && raw <= 1) return raw
  }
  return null
}

export function confidenceToLabel(raw: unknown): ConfidenceLabel {
  if (typeof raw === 'string') {
    const label = CONFIDENCE_LABELS[raw.trim().toUpperCase()]
    if (label) return label
  }
  const unit = confidenceToUnit(raw)
  if (unit == null) return 'UNKNOWN'
  if (unit >= 0.75) return 'HIGH'
  if (unit >= 0.5) return 'MEDIUM'
  return 'LOW'
}

/** A single headline does not flip stored state unless it is important and not low-confidence. */
export function candidateIsMaterial(importance: unknown, confidence: unknown): boolean {
  const imp = String(importance || '').toUpperCase()
  if (imp === 'LOW') return false
  const unit = confidenceToUnit(confidence)
  if (unit == null || unit < 0.5) return false
  return imp === 'HIGH' || imp === 'CRITICAL' || imp === 'MEDIUM'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Accept the common envelope or the older per-market JSON and expose both
 * so existing state stores can keep reading fundamental_state / market_stance.
 */
export function adaptLegacyFundamentalJson(raw: unknown): any {
  const input = asRecord(raw) ?? {}
  const p: Record<string, unknown> = { ...input }
  const specialist = asRecord(p.specialist) ?? {}
  const state =
    asRecord(p.state) ||
    asRecord(p.fundamental_state) ||
    asRecord(p.fundamental_effect) ||
    asRecord(p.market_stance)

  if (state) {
    p.state = state
    if (!p.fundamental_state) p.fundamental_state = state
    if (!p.fundamental_effect) p.fundamental_effect = state
    if (!p.market_stance) p.market_stance = state
  }

  const unit = confidenceToUnit(p.confidence)
  if (unit != null) p.confidence = unit

  if (!p.event && typeof p.event_type === 'string') p.event = p.event_type
  if (!p.summary && typeof p.invalidation === 'string') p.summary = p.invalidation

  const deskContext = specialist.desk_context ?? specialist.what_to_watch
  if (!p.actionable_takeaway && typeof deskContext === 'string') {
    p.actionable_takeaway = deskContext
  }

  const reaction = asRecord(p.market_reaction)
  if (reaction && !p.market_response) {
    const status = reaction.status ?? null
    p.market_response = {
      gc_15m: status,
      nq_15m: status,
      nq_response_quality: status,
      gold_response_quality: status,
      confirmation: status,
      nkd_initial_reaction: null,
      nkd_5m_continuation: null,
    }
  }

  const expected = asRecord(p.expected_effect)
  if (expected && !p.event_analysis) {
    p.event_analysis = {
      expected_direction: expected.direction ?? null,
      expected_gold_effect: expected.direction ?? null,
      magnitude: expected.magnitude ?? null,
      standardized_surprise: null,
      estimated_dow_point_impact: specialist.dow_point_impact ?? null,
    }
  }

  if (specialist.dow_point_impact != null && asRecord(p.event_analysis)) {
    const analysis = asRecord(p.event_analysis) as Record<string, unknown>
    if (analysis.estimated_dow_point_impact == null) {
      analysis.estimated_dow_point_impact = specialist.dow_point_impact
    }
  }

  return p
}
