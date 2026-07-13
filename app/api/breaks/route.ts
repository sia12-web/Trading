/**
 * Break API Endpoints
 * GET /api/breaks - List breaks with filtering and pagination
 * POST /api/breaks - Store a break detected by the detector service
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import type { BreakListResponse, LevelBreak } from '@/types/database'
import type { BreakEvent } from '@/lib/ai/types'

/**
 * GET /api/breaks
 * List breaks with filtering and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const instrument = searchParams.get('instrument')
    const minConfidence = searchParams.get('minConfidence')
    const maxConfidence = searchParams.get('maxConfidence')
    const minLevel = searchParams.get('minLevel')
    const maxLevel = searchParams.get('maxLevel')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const direction = searchParams.get('direction')
    const sortBy = searchParams.get('sortBy') || 'timestamp'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    // Validate and parse limit/offset
    let limit = 50
    let offset = 0

    if (searchParams.has('limit')) {
      const parsedLimit = parseInt(searchParams.get('limit') || '50', 10)
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
        return NextResponse.json(
          { error: 'limit must be between 1 and 500' },
          { status: 400 }
        )
      }
      limit = parsedLimit
    }

    if (searchParams.has('offset')) {
      const parsedOffset = parseInt(searchParams.get('offset') || '0', 10)
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return NextResponse.json(
          { error: 'offset must be >= 0' },
          { status: 400 }
        )
      }
      offset = parsedOffset
    }

    // Validate instrument
    if (instrument && !['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument)) {
      return NextResponse.json(
        { error: 'Invalid instrument' },
        { status: 400 }
      )
    }

    // Validate direction
    if (direction && !['up', 'down'].includes(direction)) {
      return NextResponse.json(
        { error: 'Invalid direction' },
        { status: 400 }
      )
    }

    // Validate sortBy
    const validSortByValues = ['timestamp', 'confidence', 'price']
    if (!validSortByValues.includes(sortBy)) {
      return NextResponse.json(
        { error: 'sortBy must be one of: timestamp, confidence, price' },
        { status: 400 }
      )
    }

    // Validate sortOrder
    if (!['asc', 'desc'].includes(sortOrder)) {
      return NextResponse.json(
        { error: 'sortOrder must be asc or desc' },
        { status: 400 }
      )
    }

    // Validate confidence ranges
    const minConf = minConfidence ? parseInt(minConfidence, 10) : undefined
    const maxConf = maxConfidence ? parseInt(maxConfidence, 10) : undefined

    if (minConf !== undefined && (isNaN(minConf) || minConf < 0 || minConf > 100)) {
      return NextResponse.json(
        { error: 'minConfidence must be 0-100' },
        { status: 400 }
      )
    }

    if (maxConf !== undefined && (isNaN(maxConf) || maxConf < 0 || maxConf > 100)) {
      return NextResponse.json(
        { error: 'maxConfidence must be 0-100' },
        { status: 400 }
      )
    }

    // Build WHERE clause
    let query = supabase.from('level_breaks').select('*', { count: 'exact' })

    if (instrument) {
      query = query.eq('instrument', instrument)
    }

    if (minConf !== undefined) {
      query = query.gte('confidence', minConf)
    }

    if (maxConf !== undefined) {
      query = query.lte('confidence', maxConf)
    }

    if (minLevel) {
      const minLevelNum = parseFloat(minLevel)
      if (!isNaN(minLevelNum)) {
        query = query.gte('level', minLevelNum)
      }
    }

    if (maxLevel) {
      const maxLevelNum = parseFloat(maxLevel)
      if (!isNaN(maxLevelNum)) {
        query = query.lte('level', maxLevelNum)
      }
    }

    if (startDate) {
      query = query.gte('break_timestamp', startDate)
    }

    if (endDate) {
      query = query.lte('break_timestamp', endDate)
    }

    if (direction) {
      query = query.eq('direction', direction)
    }

    // Add sorting
    let orderColumn = 'break_timestamp'
    if (sortBy === 'confidence') {
      orderColumn = 'confidence'
    } else if (sortBy === 'price') {
      orderColumn = 'level'
    }

    const isAsc = sortOrder === 'asc'
    query = query.order(orderColumn, { ascending: isAsc })

    // Add pagination
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      logger.error('[Breaks API] Database error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch breaks' },
        { status: 500 }
      )
    }

    // Transform database response to API format
    const breaks: LevelBreak[] = (data || []).map((row: any) => ({
      id: row.id,
      instrument: row.instrument,
      level: row.level,
      direction: row.direction,
      confidence: row.confidence,
      entryPrice: row.entry_price,
      breakPrice: row.break_price,
      volume: row.volume,
      reasoning: row.reasoning,
      scoreBreakdown: row.score_breakdown,
      breakTimestamp: row.break_timestamp,
      createdAt: row.created_at,
    }))

    const response: BreakListResponse = {
      breaks,
      total: count || 0,
      limit,
      offset,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    logger.error('[Breaks API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/breaks
 * Store a break detected by the detector service
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json() as BreakEvent

    // Validate required fields
    if (!body.instrument || !['DOW', 'NASDAQ', 'NIKKEI'].includes(body.instrument)) {
      return NextResponse.json(
        { error: 'Invalid or missing instrument' },
        { status: 400 }
      )
    }

    if (typeof body.level !== 'number' || body.level <= 0) {
      return NextResponse.json(
        { error: 'Invalid level' },
        { status: 400 }
      )
    }

    if (!body.direction || !['up', 'down'].includes(body.direction)) {
      return NextResponse.json(
        { error: 'Invalid direction' },
        { status: 400 }
      )
    }

    if (typeof body.confidence !== 'number' || body.confidence < 0 || body.confidence > 100) {
      return NextResponse.json(
        { error: 'Invalid confidence (must be 0-100)' },
        { status: 400 }
      )
    }

    if (typeof body.entryPrice !== 'number' || body.entryPrice <= 0) {
      return NextResponse.json(
        { error: 'Invalid entryPrice' },
        { status: 400 }
      )
    }

    if (typeof body.breakPrice !== 'number' || body.breakPrice <= 0) {
      return NextResponse.json(
        { error: 'Invalid breakPrice' },
        { status: 400 }
      )
    }

    if (!body.reasoning || typeof body.reasoning !== 'string' || body.reasoning.length > 500) {
      return NextResponse.json(
        { error: 'Reasoning must be a string between 1-500 characters' },
        { status: 400 }
      )
    }

    if (!body.scoreBreakdown || typeof body.scoreBreakdown !== 'object' || Array.isArray(body.scoreBreakdown)) {
      return NextResponse.json(
        { error: 'scoreBreakdown must be a valid JSON object' },
        { status: 400 }
      )
    }

    // Validate timestamp
    if (!body.timestamp) {
      return NextResponse.json(
        { error: 'Missing timestamp' },
        { status: 400 }
      )
    }

    const breakTime = new Date(body.timestamp)
    if (isNaN(breakTime.getTime())) {
      return NextResponse.json(
        { error: 'Invalid timestamp format' },
        { status: 400 }
      )
    }

    // Check timestamp is not too old (±5 seconds tolerance)
    const now = Date.now()
    const timeDiff = Math.abs(now - breakTime.getTime())
    if (timeDiff > 5000) {
      return NextResponse.json(
        { error: 'Timestamp too old' },
        { status: 400 }
      )
    }

    // Check for duplicates within 1-second window
    const windowStart = new Date(breakTime.getTime() - 1000).toISOString()
    const windowEnd = new Date(breakTime.getTime() + 1000).toISOString()

    const { data: existing } = await supabase
      .from('level_breaks')
      .select('id')
      .eq('instrument', body.instrument)
      .eq('level', body.level)
      .eq('direction', body.direction)
      .gte('break_timestamp', windowStart)
      .lte('break_timestamp', windowEnd)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: 'Duplicate break detected' },
        { status: 409 }
      )
    }

    // Insert break into database
    const { data, error } = await supabase
      .from('level_breaks')
      .insert({
        instrument: body.instrument,
        level: body.level,
        direction: body.direction,
        confidence: body.confidence,
        entry_price: body.entryPrice,
        break_price: body.breakPrice,
        volume: body.volume || null,
        reasoning: body.reasoning,
        score_breakdown: body.scoreBreakdown,
        break_timestamp: breakTime.toISOString(),
      })
      .select('id, created_at, break_timestamp')
      .single()

    if (error) {
      logger.error('[Breaks API] Insert error:', error)
      return NextResponse.json(
        { error: 'Failed to store break' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        id: data.id,
        createdAt: data.created_at,
        breakTimestamp: data.break_timestamp,
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('[Breaks API] POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
