/**
 * GET /api/trading/levels
 * Fetch all active trading levels for a specific instrument
 *
 * Query params:
 * - instrument: required, one of ['DOW', 'NASDAQ', 'NIKKEI']
 * - include_inactive: optional boolean, default false
 *
 * Returns:
 * {
 *   instrument: string,
 *   levels: TradingLevel[],
 *   total_active: number
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { LevelsResponse, Instrument, TradingLevel } from '@/types/trading'

const VALID_INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']
const DEFAULT_LEVELS: Record<Instrument, Omit<TradingLevel, 'id' | 'user_id' | 'created_at' | 'updated_at'>[]> = {
  DOW: [
    { instrument: 'DOW', level_name: 'Support 1', price: 40000, level_type: 'support', is_active: true },
    { instrument: 'DOW', level_name: 'Pivot', price: 40100, level_type: 'pivot', is_active: true },
    { instrument: 'DOW', level_name: 'Resistance 1', price: 40200, level_type: 'resistance', is_active: true },
  ],
  NASDAQ: [
    { instrument: 'NASDAQ', level_name: 'Support 1', price: 17000, level_type: 'support', is_active: true },
    { instrument: 'NASDAQ', level_name: 'Pivot', price: 17250, level_type: 'pivot', is_active: true },
    { instrument: 'NASDAQ', level_name: 'Resistance 1', price: 17500, level_type: 'resistance', is_active: true },
  ],
  NIKKEI: [
    { instrument: 'NIKKEI', level_name: 'Support 1', price: 32000, level_type: 'support', is_active: true },
    { instrument: 'NIKKEI', level_name: 'Pivot', price: 32250, level_type: 'pivot', is_active: true },
    { instrument: 'NIKKEI', level_name: 'Resistance 1', price: 32500, level_type: 'resistance', is_active: true },
  ],
}

export async function GET(request: NextRequest) {
  try {
    // Validate auth
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const instrument = searchParams.get('instrument') as Instrument | null
    const includeInactive = searchParams.get('include_inactive') === 'true'

    // Validate instrument parameter
    if (!instrument || !VALID_INSTRUMENTS.includes(instrument)) {
      return NextResponse.json(
        { error: `Invalid instrument. Must be one of: ${VALID_INSTRUMENTS.join(', ')}` },
        { status: 400 }
      )
    }

    // Fetch levels from database
    let query = supabase
      .from('trading_levels')
      .select('*')
      .eq('user_id', user.id)
      .eq('instrument', instrument)

    // Add active filter unless include_inactive is true
    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    const { data: userLevels, error: dbError } = await query.order('price', { ascending: true })

    if (dbError) {
      console.error('Error fetching levels from database:', dbError)
      return NextResponse.json({ error: 'Failed to fetch levels' }, { status: 500 })
    }

    // If user has custom levels, use those
    // Otherwise, use default seeded levels
    const levels: TradingLevel[] = userLevels && userLevels.length > 0 ? userLevels : generateDefaultLevels(user.id, instrument)

    const response: LevelsResponse = {
      instrument,
      levels,
      total_active: levels.filter((l) => l.is_active).length,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('Error in GET /api/trading/levels:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Generate default levels for an instrument/user
 * Returns in-memory objects (not persisted to DB in MVP)
 */
function generateDefaultLevels(userId: string, instrument: Instrument): TradingLevel[] {
  const defaults = DEFAULT_LEVELS[instrument]
  const now = new Date().toISOString()

  return defaults.map((level) => ({
    ...level,
    id: `default-${instrument}-${level.price}`,
    user_id: userId,
    created_at: now,
    updated_at: now,
  }))
}
