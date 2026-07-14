/**
 * POST /api/trading/replays
 * Create a new replay session
 *
 * GET /api/trading/replays
 * List all replay sessions for current user (paginated)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import type {
  CreateReplaySessionRequest,
  SimulationReplay,
} from '@/types/trading'

// Validation constants
const VALID_INSTRUMENTS = ['DOW', 'NASDAQ', 'NIKKEI'] as const
const VALID_SPEEDS = [1, 2, 4, 16] as const
const MAX_REPLAY_HISTORY_DAYS = 30
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function isValidInstrument(instrument: unknown): instrument is 'DOW' | 'NASDAQ' | 'NIKKEI' {
  return typeof instrument === 'string' && VALID_INSTRUMENTS.includes(instrument as any)
}

function isValidSpeed(speed: unknown): speed is 1 | 2 | 4 | 16 {
  return typeof speed === 'number' && VALID_SPEEDS.includes(speed as any)
}

function isValidDate(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/
  if (!regex.test(dateString)) return false

  const date = new Date(dateString + 'T00:00:00Z')
  return !isNaN(date.getTime())
}

function isDateWithinLimit(dateString: string, days: number): boolean {
  const replayDate = new Date(dateString + 'T00:00:00Z')
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const diffTime = today.getTime() - replayDate.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return diffDays >= 0 && diffDays <= days
}

/**
 * POST /api/trading/replays
 * Create a new replay session
 */
export async function POST(request: Request): Promise<NextResponse<any>> {
  try {
    const body = (await request.json()) as CreateReplaySessionRequest

    // Validate required fields
    if (!body.instrument || !body.replay_date || body.playback_speed === undefined) {
      logger.error('POST /api/trading/replays: Missing required fields', { body })
      return NextResponse.json(
        { error: 'Missing required fields: instrument, replay_date, playback_speed' },
        { status: 400 }
      )
    }

    // Validate instrument
    if (!isValidInstrument(body.instrument)) {
      logger.error('POST /api/trading/replays: Invalid instrument', { instrument: body.instrument })
      return NextResponse.json(
        { error: 'Invalid instrument: must be DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    // Validate date format
    if (!isValidDate(body.replay_date)) {
      logger.error('POST /api/trading/replays: Invalid date format', { date: body.replay_date })
      return NextResponse.json(
        { error: 'Invalid date format: must be YYYY-MM-DD' },
        { status: 400 }
      )
    }

    // Validate date within history limit
    if (!isDateWithinLimit(body.replay_date, MAX_REPLAY_HISTORY_DAYS)) {
      logger.error('POST /api/trading/replays: Date out of range', { date: body.replay_date })
      return NextResponse.json(
        { error: `Invalid date: must be within last ${MAX_REPLAY_HISTORY_DAYS} days` },
        { status: 400 }
      )
    }

    // Validate playback speed
    if (!isValidSpeed(body.playback_speed)) {
      logger.error('POST /api/trading/replays: Invalid playback speed', { speed: body.playback_speed })
      return NextResponse.json(
        { error: 'Invalid playback speed: must be 1, 2, 4, or 16' },
        { status: 400 }
      )
    }

    // Get authenticated user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      logger.error('POST /api/trading/replays: Unauthorized', { error: authError })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Insert replay session
    const { data: newSession, error: insertError } = await supabase
      .from('simulation_replays')
      .insert({
        user_id: user.id,
        instrument: body.instrument,
        replay_date: body.replay_date,
        playback_speed: body.playback_speed,
        final_pnl: null,
        final_pnl_percent: null,
        trades_count: 0,
        replay_duration_seconds: null,
        notes: null,
      })
      .select()
      .single()

    if (insertError || !newSession) {
      logger.error('POST /api/trading/replays: Insert failed', { error: insertError })
      return NextResponse.json(
        { error: 'Failed to create replay session' },
        { status: 500 }
      )
    }

    logger.log('POST /api/trading/replays: Session created', {
      session_id: newSession.id,
      instrument: body.instrument,
      replay_date: body.replay_date,
      speed: body.playback_speed,
    })

    return NextResponse.json(
      {
        id: newSession.id,
        user_id: newSession.user_id,
        instrument: newSession.instrument,
        replay_date: newSession.replay_date,
        playback_speed: newSession.playback_speed,
        final_pnl: null,
        final_pnl_percent: null,
        trades_count: 0,
        replay_duration_seconds: null,
        notes: null,
        created_at: newSession.created_at,
        updated_at: newSession.updated_at,
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('POST /api/trading/replays: Unexpected error', { error })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/trading/replays
 * List all replay sessions (paginated)
 */
export async function GET(request: Request): Promise<NextResponse<any>> {
  try {
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')
    const instrumentParam = searchParams.get('instrument')

    // Validate limit
    let limit = DEFAULT_LIMIT
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10)
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
        logger.error('GET /api/trading/replays: Invalid limit', { limit: limitParam })
        return NextResponse.json(
          { error: `Invalid limit: must be 1-${MAX_LIMIT}` },
          { status: 400 }
        )
      }
      limit = parsedLimit
    }

    // Validate offset
    let offset = 0
    if (offsetParam) {
      const parsedOffset = parseInt(offsetParam, 10)
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        logger.error('GET /api/trading/replays: Invalid offset', { offset: offsetParam })
        return NextResponse.json(
          { error: 'Invalid offset: must be >= 0' },
          { status: 400 }
        )
      }
      offset = parsedOffset
    }

    // Validate instrument filter (optional)
    if (instrumentParam && !isValidInstrument(instrumentParam)) {
      logger.error('GET /api/trading/replays: Invalid instrument filter', { instrument: instrumentParam })
      return NextResponse.json(
        { error: 'Invalid instrument: must be DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    // Get authenticated user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      logger.error('GET /api/trading/replays: Unauthorized', { error: authError })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Build query
    let query = supabase
      .from('simulation_replays')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    // Add instrument filter if provided
    if (instrumentParam) {
      query = query.eq('instrument', instrumentParam)
    }

    // Execute query
    const { data: sessions, count, error: queryError } = await query

    if (queryError) {
      logger.error('GET /api/trading/replays: Query failed', { error: queryError })
      return NextResponse.json(
        { error: 'Failed to fetch replay sessions' },
        { status: 500 }
      )
    }

    logger.log('GET /api/trading/replays: Sessions fetched', {
      count: sessions?.length || 0,
      total: count || 0,
      limit,
      offset,
    })

    return NextResponse.json(
      {
        sessions: (sessions || []) as SimulationReplay[],
        total: count || 0,
        limit,
        offset,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('GET /api/trading/replays: Unexpected error', { error })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
