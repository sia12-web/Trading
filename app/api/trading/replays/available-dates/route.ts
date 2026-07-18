/**
 * GET /api/trading/replays/available-dates?instrument=DOW|NASDAQ|NIKKEI
 * Last 5 cash trading days for that market's calendar (excluding today).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
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
    const user = await getOrCreateUser(request)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Same client as POST/PATCH so badges match persisted sessions under RLS/dev auth
    const supabase = createAdminClient() ?? (await createClient())

    const tradingDays =
      instrument === 'NIKKEI' ? getLastNTokyoTradingDays(5) : getLastNNycTradingDays(5)

    const { data: userSessions } = await supabase
      .from('simulation_replays')
      .select('replay_date, status, final_pnl, replay_duration_seconds')
      .eq('user_id', user.id)
      .eq('instrument', instrument)

    const sessionByDate = new Map<
      string,
      { status: 'in_progress' | 'completed' }
    >()
    for (const s of userSessions || []) {
      const date = String(s.replay_date)
      // Prefer explicit status; fall back for pre-migration rows
      const completed =
        s.status === 'completed' ||
        (s.status == null &&
          (s.replay_duration_seconds != null || s.final_pnl != null))
      sessionByDate.set(date, {
        status: completed ? 'completed' : 'in_progress',
      })
    }

    const available_dates: AvailableDate[] = tradingDays.map((date) => {
      const sess = sessionByDate.get(date)
      const session_status = sess?.status ?? 'none'
      return {
        date,
        is_available: true,
        has_session: session_status !== 'none',
        session_status,
      }
    })

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
