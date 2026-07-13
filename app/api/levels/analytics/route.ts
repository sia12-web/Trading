import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type {
  AnalyticsResponse,
  AnalyticsSummary,
  TypeMetrics,
  TimeframeMetrics,
  LevelPerformance,
  ReliabilityRanking,
} from '@/lib/services/levelFinderAgent/types'

/**
 * Validates query parameters
 */
function validateQueryParams(searchParams: URLSearchParams): { valid: true; params: { instrument: string; days: number } } | { valid: false; error: string } {
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

  return { valid: true, params: { instrument, days } }
}

/**
 * GET /api/levels/analytics
 * Fetch aggregated analytics for level performance
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Validate auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Validate query parameters
    const validation = validateQueryParams(request.nextUrl.searchParams)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { instrument, days } = validation.params
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    // Fetch all levels for this user/instrument within time range
    const { data: levels, error: fetchError } = await supabase
      .from('level_history')
      .select('level, type, conviction, tested_count, success_count, timeframe')
      .eq('user_id', user.id)
      .eq('instrument', instrument)
      .gte('created_at', cutoffDate.toISOString())

    if (fetchError) {
      console.error('[Analytics API] Error fetching levels:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch analytics data' }, { status: 500 })
    }

    // Handle empty results
    if (!levels || levels.length === 0) {
      const emptyResponse: AnalyticsResponse = {
        summary: {
          total_levels: 0,
          total_tests: 0,
          total_successes: 0,
          avg_conviction: 0,
          overall_success_rate: 0,
        },
        by_type: [],
        by_timeframe: [],
        top_performers: [],
        reliability_ranking: {
          most_reliable_type: null,
          least_reliable_type: null,
          most_reliable_timeframe: null,
        },
      }
      return NextResponse.json(emptyResponse, { status: 200 })
    }

    // Calculate summary statistics
    const totalTests = levels.reduce((sum, l: any) => sum + l.tested_count, 0)
    const totalSuccesses = levels.reduce((sum, l: any) => sum + l.success_count, 0)
    const avgConviction = levels.reduce((sum, l: any) => sum + l.conviction, 0) / levels.length
    const overallSuccessRate = totalTests > 0 ? totalSuccesses / totalTests : 0

    const summary: AnalyticsSummary = {
      total_levels: levels.length,
      total_tests: totalTests,
      total_successes: totalSuccesses,
      avg_conviction: parseFloat(avgConviction.toFixed(2)),
      overall_success_rate: parseFloat(overallSuccessRate.toFixed(4)),
    }

    // Calculate metrics by type
    const byTypeMap = new Map<string, any>()
    levels.forEach((level: any) => {
      if (!byTypeMap.has(level.type)) {
        byTypeMap.set(level.type, {
          type: level.type,
          count: 0,
          convictions: [],
          tested_count: 0,
          success_count: 0,
        })
      }
      const typeData = byTypeMap.get(level.type)
      typeData.count++
      typeData.convictions.push(level.conviction)
      typeData.tested_count += level.tested_count
      typeData.success_count += level.success_count
    })

    const by_type: TypeMetrics[] = Array.from(byTypeMap.values()).map((typeData) => ({
      type: typeData.type,
      count: typeData.count,
      avg_conviction: parseFloat((typeData.convictions.reduce((a: number, b: number) => a + b, 0) / typeData.count).toFixed(2)),
      success_rate: typeData.tested_count > 0 ? parseFloat((typeData.success_count / typeData.tested_count).toFixed(4)) : 0,
      tested_count: typeData.tested_count,
      success_count: typeData.success_count,
    }))

    // Calculate metrics by timeframe
    const byTimeframeMap = new Map<string, any>()
    levels.forEach((level: any) => {
      if (!byTimeframeMap.has(level.timeframe)) {
        byTimeframeMap.set(level.timeframe, {
          timeframe: level.timeframe,
          count: 0,
          convictions: [],
          tested_count: 0,
          success_count: 0,
        })
      }
      const timeframeData = byTimeframeMap.get(level.timeframe)
      timeframeData.count++
      timeframeData.convictions.push(level.conviction)
      timeframeData.tested_count += level.tested_count
      timeframeData.success_count += level.success_count
    })

    const by_timeframe: TimeframeMetrics[] = Array.from(byTimeframeMap.values()).map((timeframeData) => ({
      timeframe: timeframeData.timeframe,
      count: timeframeData.count,
      avg_conviction: parseFloat((timeframeData.convictions.reduce((a: number, b: number) => a + b, 0) / timeframeData.count).toFixed(2)),
      success_rate: timeframeData.tested_count > 0 ? parseFloat((timeframeData.success_count / timeframeData.tested_count).toFixed(4)) : 0,
    }))

    // Calculate top performers (success_rate >= 50%, limit 10)
    const top_performers: LevelPerformance[] = levels
      .map((level: any) => ({
        level: level.level,
        type: level.type,
        conviction: level.conviction,
        success_rate: level.tested_count > 0 ? parseFloat((level.success_count / level.tested_count).toFixed(4)) : 0,
        tested_count: level.tested_count,
        success_count: level.success_count,
      }))
      .filter((l) => l.success_rate >= 0.5 && l.tested_count > 0)
      .sort((a, b) => b.success_rate - a.success_rate)
      .slice(0, 10)

    // Calculate reliability rankings
    const typeSuccessRates = by_type.map((t) => ({ type: t.type, rate: t.success_rate }))
    const timeframeSuccessRates = by_timeframe.map((t) => ({ timeframe: t.timeframe, rate: t.success_rate }))

    const most_reliable_type =
      typeSuccessRates.length > 0
        ? typeSuccessRates.reduce((max, current) => (current.rate > max.rate ? current : max)).type
        : null

    const least_reliable_type =
      typeSuccessRates.length > 0
        ? typeSuccessRates.reduce((min, current) => (current.rate < min.rate ? current : min)).type
        : null

    const most_reliable_timeframe =
      timeframeSuccessRates.length > 0
        ? timeframeSuccessRates.reduce((max, current) => (current.rate > max.rate ? current : max)).timeframe
        : null

    const reliability_ranking: ReliabilityRanking = {
      most_reliable_type,
      least_reliable_type,
      most_reliable_timeframe,
    }

    // Return comprehensive analytics response
    const response: AnalyticsResponse = {
      summary,
      by_type,
      by_timeframe,
      top_performers,
      reliability_ranking,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[Analytics API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
