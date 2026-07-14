/**
 * GET /api/trading/replays/available-dates?instrument=DOW
 * Returns list of available dates for past 30 days
 * Uses cached availability data from replay_availability_cache table
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import type { AvailableDatesResponse, AvailableDate, Instrument } from '@/types/trading'
import { getLastNDays } from '@/lib/utils/dateUtils'

const VALID_INSTRUMENTS = ['DOW', 'NASDAQ', 'NIKKEI'] as const

function isValidInstrument(instrument: unknown): instrument is Instrument {
  return typeof instrument === 'string' && VALID_INSTRUMENTS.includes(instrument as any)
}

export async function GET(request: Request): Promise<NextResponse<any>> {
  try {
    const { searchParams } = new URL(request.url)
    const instrumentParam = searchParams.get('instrument')

    // Validate instrument
    if (!instrumentParam || !isValidInstrument(instrumentParam)) {
      logger.error('GET /api/trading/replays/available-dates: Invalid instrument', {
        instrument: instrumentParam,
      })
      return NextResponse.json(
        { error: 'Invalid instrument: must be DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    const instrument = instrumentParam

    // Get authenticated user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      logger.error('GET /api/trading/replays/available-dates: Unauthorized', { error: authError })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get last 30 days
    const last30Days = getLastNDays(30)

    // Fetch user's replay sessions for this instrument
    const { data: userSessions, error: sessionsError } = await supabase
      .from('simulation_replays')
      .select('replay_date')
      .eq('user_id', user.id)
      .eq('instrument', instrument)

    if (sessionsError) {
      logger.error('GET /api/trading/replays/available-dates: Failed to fetch sessions', {
        error: sessionsError,
      })
    }

    const sessionDates = new Set((userSessions || []).map(s => s.replay_date))

    // Fetch cache entries for these dates
    const { data: cacheEntries, error: cacheError } = await supabase
      .from('replay_availability_cache')
      .select('replay_date, is_available')
      .eq('instrument', instrument)
      .in('replay_date', last30Days)

    if (cacheError && cacheError.code !== 'PGRST116') {
      logger.error('GET /api/trading/replays/available-dates: Cache query failed', {
        error: cacheError,
      })
    }

    const cacheMap = new Map((cacheEntries || []).map(e => [e.replay_date, e.is_available]))

    // Build response: assume all dates are available until proven otherwise
    // (Slice 3 will validate actual data availability when user creates session)
    const availableDates: AvailableDate[] = last30Days.map(date => ({
      date,
      is_available: cacheMap.get(date) !== false, // Default to true if not in cache
      has_session: sessionDates.has(date),
    }))

    logger.log('GET /api/trading/replays/available-dates: Fetched', {
      instrument,
      dates_count: availableDates.length,
      sessions_count: userSessions?.length || 0,
    })

    return NextResponse.json(
      {
        instrument,
        available_dates: availableDates,
        total_available: availableDates.filter(d => d.is_available).length,
        total_checked: last30Days.length,
      } as AvailableDatesResponse,
      { status: 200 }
    )
  } catch (error) {
    logger.error('GET /api/trading/replays/available-dates: Unexpected error', { error })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
