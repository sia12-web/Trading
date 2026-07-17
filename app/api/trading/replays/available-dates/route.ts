/**
 * GET /api/trading/replays/available-dates?instrument=DOW|NASDAQ|NIKKEI
 * Last 5 cash trading days for that market's calendar (excluding today).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getLastNNycTradingDays, getLastNTokyoTradingDays } from '@/lib/utils/dateUtils'
import type { AvailableDatesResponse, AvailableDate, Instrument } from '@/types/trading'

const VALID_INSTRUMENTS = ['DOW', 'NASDAQ', 'NIKKEI'] as const

function isValidInstrument(instrument: unknown): instrument is Instrument {
  return typeof instrument === 'string' && VALID_INSTRUMENTS.includes(instrument as any)
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request): Promise<NextResponse<any>> {
  try {
    const { searchParams } = new URL(request.url)
    const instrumentParam = searchParams.get('instrument')

    if (!instrumentParam || !isValidInstrument(instrumentParam)) {
      return NextResponse.json(
        { error: 'Invalid instrument: must be DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    const instrument = instrumentParam
    const supabase = await createClient()
    const user = await getOrCreateUser(request)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tradingDays =
      instrument === 'NIKKEI' ? getLastNTokyoTradingDays(5) : getLastNNycTradingDays(5)

    const { data: userSessions } = await supabase
      .from('simulation_replays')
      .select('replay_date')
      .eq('user_id', user.id)
      .eq('instrument', instrument)

    const sessionDates = new Set((userSessions || []).map((s) => s.replay_date))

    const available_dates: AvailableDate[] = tradingDays.map((date) => ({
      date,
      is_available: true,
      has_session: sessionDates.has(date),
    }))

    const response: AvailableDatesResponse = {
      instrument,
      available_dates,
      total_available: available_dates.filter((d) => d.is_available).length,
      total_checked: tradingDays.length,
    }

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  } catch (error) {
    logger.error('[available-dates]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
