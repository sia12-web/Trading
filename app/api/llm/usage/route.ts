/**
 * GET /api/llm/usage — desk LLM usage dashboard data
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { llmConfigSnapshot } from '@/lib/llm/config'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') || 30), 1), 90)
  const since = new Date(Date.now() - days * 86400000).toISOString()

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Admin client unavailable' }, { status: 503 })
  }

  const { data, error } = await admin
    .from('llm_usage')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    logger.error('llm.usage_query_failed', { error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = data || []
  const totalInput = rows.reduce((s, r) => s + Number(r.input_tokens || 0), 0)
  const totalOutput = rows.reduce((s, r) => s + Number(r.output_tokens || 0), 0)
  const totalCost = rows.reduce((s, r) => s + Number(r.estimated_cost_usd || 0), 0)
  const failures = rows.filter((r) => !r.success).length

  const byProvider: Record<string, { calls: number; input: number; output: number; cost: number }> =
    {}
  const byModel: Record<string, { calls: number; input: number; output: number; cost: number }> = {}
  const byRoute: Record<string, { calls: number; cost: number }> = {}

  for (const r of rows) {
    const p = String(r.provider)
    const m = String(r.model)
    const route = String(r.route)
    const inp = Number(r.input_tokens || 0)
    const out = Number(r.output_tokens || 0)
    const cost = Number(r.estimated_cost_usd || 0)

    byProvider[p] = byProvider[p] || { calls: 0, input: 0, output: 0, cost: 0 }
    byProvider[p].calls++
    byProvider[p].input += inp
    byProvider[p].output += out
    byProvider[p].cost += cost

    byModel[m] = byModel[m] || { calls: 0, input: 0, output: 0, cost: 0 }
    byModel[m].calls++
    byModel[m].input += inp
    byModel[m].output += out
    byModel[m].cost += cost

    byRoute[route] = byRoute[route] || { calls: 0, cost: 0 }
    byRoute[route].calls++
    byRoute[route].cost += cost
  }

  return NextResponse.json({
    ok: true,
    days,
    config: llmConfigSnapshot(),
    summary: {
      calls: rows.length,
      failures,
      input_tokens: totalInput,
      output_tokens: totalOutput,
      estimated_cost_usd: Number(totalCost.toFixed(4)),
    },
    by_provider: byProvider,
    by_model: byModel,
    by_route: byRoute,
    recent: rows.slice(0, 50).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      provider: r.provider,
      model: r.model,
      role: r.role,
      route: r.route,
      instrument: r.instrument,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      estimated_cost_usd: Number(r.estimated_cost_usd),
      success: r.success,
      levels_proposed: r.levels_proposed,
      levels_accepted: r.levels_accepted,
      levels_rejected: r.levels_rejected,
      error_message: r.error_message,
    })),
  })
}
