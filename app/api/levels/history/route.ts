import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import type { HistoryResponse, LevelHistory } from '@/lib/services/levelFinderAgent/types'

/**
 * Validates query parameters
 */
function validateQueryParams(searchParams: URLSearchParams): { valid: true; params: { instrument: string; days: number; limit: number; min_conviction: number } } | { valid: false; error: string } {
  // Validate instrument (required)
  const instrument = searchParams.get('instrument')
  if (!instrument) {
    return { valid: false, error: 'Missing required query parameter: instrument' }
  }

  if (!['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument)) {
    return { valid: false, error: 'Invalid instrument (must be DOW, NASDAQ, or NIKKEI)' }
  }

  // Validate days (optional, default 30, max 90)
  let days = 30
  const daysParam = searchParams.get('days')
  if (daysParam) {
    const daysParsed = parseInt(daysParam)
    if (isNaN(daysParsed) || daysParsed < 1 || daysParsed > 90) {
      return { valid: false, error: 'Days must be between 1 and 90' }
    }
    days = daysParsed
  }

  // Validate limit (optional, default 50, max 100)
  let limit = 50
  const limitParam = searchParams.get('limit')
  if (limitParam) {
    const limitParsed = parseInt(limitParam)
    if (isNaN(limitParsed) || limitParsed < 1 || limitParsed > 100) {
      return { valid: false, error: 'Limit must be between 1 and 100' }
    }
    limit = limitParsed
  }

  // Validate min_conviction (optional, default 1, max 10)
  let min_conviction = 1
  const minConvictionParam = searchParams.get('min_conviction')
  if (minConvictionParam) {
    const minConvictionParsed = parseInt(minConvictionParam)
    // Check for NaN BEFORE range validation
    if (isNaN(minConvictionParsed)) {
      return { valid: false, error: 'Min conviction must be a valid integer' }
    }
    if (minConvictionParsed < 1 || minConvictionParsed > 10) {
      return { valid: false, error: 'Min conviction must be between 1 and 10' }
    }
    min_conviction = minConvictionParsed
  }

  return { valid: true, params: { instrument, days, limit, min_conviction } }
}

/**
 * Calculates days ago from created_at
 */
function calculateDaysAgo(createdAt: string): number {
  const created = new Date(createdAt).getTime()
  const now = new Date().getTime()
  return Math.floor((now - created) / (1000 * 60 * 60 * 24))
}

/**
 * Calculates success rate (handles divide by zero)
 */
function calculateSuccessRate(successCount: number, testedCount: number): number {
  if (testedCount === 0) return 0
  return Math.round((successCount / testedCount) * 100)
}

/**
 * GET /api/levels/history?instrument=DOW&days=30&limit=50
 * Fetches historical level context for a trader or Claude prompt generation
 * Returns past N days of levels for user + instrument, sorted by created_at DESC
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Use dev auth (works without real session in development)
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Validate query parameters
    const validation = validateQueryParams(request.nextUrl.searchParams)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { instrument, days, limit, min_conviction } = validation.params

    // Fetch historical levels from database
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const { data: levels, error: fetchError } = await supabase
      .from('level_history')
      .select('*')
      .eq('user_id', user.id)
      .eq('instrument', instrument)
      .gte('created_at', cutoffDate.toISOString())
      .gte('conviction', min_conviction)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (fetchError) {
      console.warn('[History API] DB query failed (table may not exist):', fetchError.message)
      return NextResponse.json({
        levels: [],
        total_count: 0,
        query_params: { instrument, days, limit, min_conviction },
        _warning: 'No level history found. Run the AI Level Finder to generate levels.',
      }, { status: 200 })
    }

    // Transform data to include calculated fields (success_rate, days_ago)
    const transformedLevels: LevelHistory[] = (levels || []).map((level: any) => ({
      id: level.id,
      user_id: level.user_id,
      session_id: level.session_id,
      instrument: level.instrument,
      level: level.level,
      type: level.type,
      conviction: level.conviction,
      reasoning: level.reasoning,
      timeframe: level.timeframe,
      tested_count: level.tested_count,
      success_count: level.success_count,
      success_rate: calculateSuccessRate(level.success_count, level.tested_count),
      last_tested_date: level.last_tested_date,
      created_at: level.created_at,
      days_ago: calculateDaysAgo(level.created_at),
    }))

    // Return response
    return NextResponse.json(
      {
        levels: transformedLevels,
        total_count: transformedLevels.length,
        query_params: {
          instrument,
          days,
          limit,
        },
      } as HistoryResponse,
      { status: 200 }
    )
  } catch (error) {
    console.error('[History API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
