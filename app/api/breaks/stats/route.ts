/**
 * Break Statistics API Endpoint
 * GET /api/breaks/stats - Get aggregate statistics for breaks
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BreakStatistics } from '@/types/database'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const instrument = searchParams.get('instrument')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const minConfidence = searchParams.get('minConfidence')

    // Validate instrument if provided
    if (instrument && !['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument)) {
      return NextResponse.json(
        { error: 'Invalid instrument' },
        { status: 400 }
      )
    }

    // Parse confidence threshold
    const minConf = minConfidence ? parseInt(minConfidence, 10) : undefined

    // Fetch all breaks with filters applied
    const baseQuery = supabase.from('level_breaks').select('*')

    // Apply filters step by step
    const queryWithInstrument =
      instrument ? baseQuery.eq('instrument', instrument) : baseQuery

    const queryWithStartDate =
      startDate ? queryWithInstrument.gte('break_timestamp', startDate) : queryWithInstrument

    const queryWithEndDate =
      endDate ? queryWithStartDate.lte('break_timestamp', endDate) : queryWithStartDate

    const finalQuery =
      minConf !== undefined && !isNaN(minConf)
        ? queryWithEndDate.gte('confidence', minConf)
        : queryWithEndDate

    const { data, error } = await finalQuery

    if (error) {
      console.error('[Stats API] Database error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch statistics' },
        { status: 500 }
      )
    }

    const breaks = data || []

    // Calculate statistics
    const totalBreaks = breaks.length
    const upBreaks = breaks.filter((b: any) => b.direction === 'up').length
    const downBreaks = breaks.filter((b: any) => b.direction === 'down').length

    let averageConfidence = 0
    let maxConfidence = 0
    let minConfidenceVal = 100

    if (totalBreaks > 0) {
      const confidences = breaks.map((b: any) => b.confidence)
      averageConfidence =
        Math.round((confidences.reduce((a: number, b: number) => a + b, 0) / totalBreaks) * 10) /
        10
      maxConfidence = Math.max(...confidences)
      minConfidenceVal = Math.min(...confidences)
    }

    // Calculate confidence distribution
    const veryHigh = breaks.filter((b: any) => b.confidence >= 80).length // 80-100
    const high = breaks.filter((b: any) => b.confidence >= 65 && b.confidence < 80).length // 65-79
    const medium = breaks.filter((b: any) => b.confidence >= 50 && b.confidence < 65).length // 50-64
    const low = breaks.filter((b: any) => b.confidence < 50).length // 0-49

    // Get time range
    let oldest: string | null = null
    let newest: string | null = null

    if (totalBreaks > 0) {
      const timestamps = breaks.map((b: any) => new Date(b.break_timestamp).getTime())
      oldest = new Date(Math.min(...timestamps)).toISOString()
      newest = new Date(Math.max(...timestamps)).toISOString()
    }

    const statistics: BreakStatistics = {
      ...(instrument && { instrument: instrument as 'DOW' | 'NASDAQ' | 'NIKKEI' }),
      totalBreaks,
      upBreaks,
      downBreaks,
      averageConfidence,
      maxConfidence: totalBreaks > 0 ? maxConfidence : 0,
      minConfidence: totalBreaks > 0 ? minConfidenceVal : 0,
      confidenceDistribution: {
        veryHigh,
        high,
        medium,
        low,
      },
      timeRange: {
        oldest,
        newest,
      },
    }

    return NextResponse.json(statistics, { status: 200 })
  } catch (error) {
    console.error('[Stats API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
