/**
 * Shared level-history context for Level Finder prompts (live + sim).
 * Same shape / summary rules so sim and live get the identical prompt enrichment.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ContextSummary,
  HistoricalContext,
  HistoricalLevelData,
} from './types'

export async function fetchLevelHistoricalContext(
  supabase: SupabaseClient,
  userId: string,
  instrument: string,
  opts: {
    days?: number
    limit?: number
    /** When set (sim replay), only include memory created before this instant */
    asOfIso?: string
  } = {}
): Promise<HistoricalContext | null> {
  try {
    const days = opts.days ?? 30
    const limit = opts.limit ?? 20
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    let q = supabase
      .from('level_history')
      .select(
        'level, type, conviction, reasoning, timeframe, tested_count, success_count, last_tested_date, created_at'
      )
      .eq('user_id', userId)
      .eq('instrument', instrument)
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit)

    if (opts.asOfIso) {
      q = q.lt('created_at', opts.asOfIso)
    }

    const { data: levels, error: fetchError } = await q

    if (fetchError || !levels || levels.length === 0) {
      return null
    }

    const historicalLevels: HistoricalLevelData[] = levels.map((level) => ({
      level: level.level,
      type: level.type,
      conviction: level.conviction,
      reasoning: level.reasoning,
      timeframe: level.timeframe,
      tested_count: level.tested_count,
      success_count: level.success_count,
      success_rate:
        level.tested_count > 0 ? level.success_count / level.tested_count : 0,
      last_tested_date: level.last_tested_date,
    }))

    const avgConviction =
      historicalLevels.reduce((sum, l) => sum + l.conviction, 0) /
      historicalLevels.length
    const avgSuccessRate =
      historicalLevels.reduce((sum, l) => sum + l.success_rate, 0) /
      historicalLevels.length

    const typeStats = historicalLevels.reduce(
      (acc, l) => {
        acc[l.type] = (acc[l.type] || 0) + l.success_rate
        return acc
      },
      {} as Record<string, number>
    )
    const entries = Object.entries(typeStats)
    const mostReliableType =
      entries.length > 0
        ? ((entries.sort(([, a], [, b]) => b - a)[0]?.[0] as
            | 'support'
            | 'resistance'
            | 'vwap'
            | undefined) ?? null)
        : null

    const successfulLevels = historicalLevels.filter((l) => l.success_rate >= 0.6)
    const unreliableLevels = historicalLevels.filter((l) => l.success_rate < 0.4)

    const summary: ContextSummary = {
      total_levels: historicalLevels.length,
      avg_conviction: avgConviction,
      avg_success_rate: avgSuccessRate,
      most_reliable_type: mostReliableType,
      successful_levels: successfulLevels.sort((a, b) => b.success_rate - a.success_rate),
      unreliable_levels: unreliableLevels.sort((a, b) => a.success_rate - b.success_rate),
    }

    return { levels: historicalLevels, summary }
  } catch (error) {
    console.error('[Level Finder] Error fetching historical context:', error)
    return null
  }
}
