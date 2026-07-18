import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/utils/logger'
import type { LlmUsage } from '@/lib/llm/types'

export type LlmUsageLogInput = {
  usage: LlmUsage
  route: string
  instrument?: string | null
  sessionId?: string | null
  success: boolean
  levelsProposed?: number | null
  levelsAccepted?: number | null
  levelsRejected?: number | null
  errorMessage?: string | null
  meta?: Record<string, unknown>
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** llm_usage.session_id is UUID — sim uses string keys like sim-NASDAQ-2026-07-16. */
function sessionIdForDb(sessionId?: string | null): {
  uuid: string | null
  ref: string | null
} {
  if (!sessionId) return { uuid: null, ref: null }
  if (UUID_RE.test(sessionId)) return { uuid: sessionId, ref: null }
  return { uuid: null, ref: sessionId }
}

/** Rough USD estimates for dashboard (not billing-grade). */
export function estimateCostUsd(provider: string, model: string, input: number, output: number): number {
  const m = model.toLowerCase()
  // Approximate per-1M token rates
  let inRate = 3
  let outRate = 15
  if (provider === 'gemini' || m.includes('gemini') || m.includes('flash')) {
    inRate = 0.1
    outRate = 0.4
  } else if (m.includes('opus')) {
    inRate = 15
    outRate = 75
  } else if (m.includes('sonnet')) {
    inRate = 3
    outRate = 15
  } else if (m.includes('haiku')) {
    // Haiku 4.5 list price ~$1 / $5 per MTok
    inRate = 1
    outRate = 5
  }
  return (input * inRate + output * outRate) / 1_000_000
}

export async function logLlmUsage(row: LlmUsageLogInput): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) {
      logger.warn('llm.usage_log_skipped_no_admin')
      return
    }

    const cost = estimateCostUsd(
      row.usage.provider,
      row.usage.model,
      row.usage.input_tokens,
      row.usage.output_tokens
    )

    const { uuid, ref } = sessionIdForDb(row.sessionId)
    const meta = {
      ...(row.meta ?? {}),
      ...(ref ? { session_ref: ref } : {}),
    }

    const { error } = await admin.from('llm_usage').insert({
      provider: row.usage.provider,
      model: row.usage.model,
      role: row.usage.role,
      route: row.route,
      instrument: row.instrument ?? null,
      session_id: uuid,
      input_tokens: row.usage.input_tokens,
      output_tokens: row.usage.output_tokens,
      estimated_cost_usd: cost,
      success: row.success,
      levels_proposed: row.levelsProposed ?? null,
      levels_accepted: row.levelsAccepted ?? null,
      levels_rejected: row.levelsRejected ?? null,
      error_message: row.errorMessage ?? null,
      meta,
    })

    if (error) {
      logger.warn('llm.usage_log_failed', { error: error.message })
    }
  } catch (err) {
    logger.warn('llm.usage_log_exception', { err })
  }
}
