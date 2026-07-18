/**
 * GET /api/trading/attendance
 * Today's clock-in status for NY and/or Tokyo desks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  activeClockMarkets,
  canClockInNow,
  getTodayAttendance,
  sessionDateForMarket,
} from '@/lib/trading/deskAttendance'
import type { DeskMarket } from '@/lib/trading/sessionGate'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const markets: DeskMarket[] = ['NY', 'TOKYO']
  const active = activeClockMarkets()

  const rows = await Promise.all(
    markets.map(async (market) => {
      const attendance = await getTodayAttendance(supabase, user.id, market)
      const window = canClockInNow(market)
      return {
        market,
        session_date: sessionDateForMarket(market),
        clock_window_open: window.ok,
        clock_window_reason: window.reason,
        active_now: active.includes(market),
        clocked_in: attendance?.status === 'clocked_in',
        status: attendance?.status ?? null,
        attendance,
      }
    })
  )

  const clockedIn = rows.some((r) => r.clocked_in)
  const canClockIn = rows.some((r) => r.clock_window_open && !r.clocked_in)

  return NextResponse.json({
    ok: true,
    clocked_in: clockedIn,
    can_clock_in: canClockIn,
    markets: rows,
  })
}
