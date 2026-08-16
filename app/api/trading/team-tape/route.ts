/**
 * GET /api/trading/team-tape
 * See-only NYC team book + leftover Tradeify fill advice.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEV_USER_ID, getOrCreateUser } from '@/lib/utils/devAuth'
import { getTodayAttendance } from '@/lib/trading/deskAttendance'
import { loadTradeifySessionSnapshot } from '@/lib/trading/tradeifySessionState'
import {
  resolveTradeifyPlace,
  tradeifySessionWindow,
} from '@/lib/trading/tradeifyGrowth50k'
import {
  buildTeamCopyAdvice,
  teamTapeTarget1_5R,
  type TeamTapeSide,
  type TeamTapeSignal,
  type TeamTapeStatus,
} from '@/lib/trading/teamTape'
import { loadQuestradeAccountSnapshot } from '@/lib/trading/questradeSession'

export const dynamic = 'force-dynamic'

function asSignal(row: {
  source_id: string
  symbol: string
  side: string
  quantity: number | string
  entry: number | string
  stop: number | string | null
  target: number | string | null
  status: string
  filled_at: string | null
}): TeamTapeSignal {
  const side = (row.side === 'SELL' ? 'SELL' : 'BUY') as TeamTapeSide
  const status = (
    row.status === 'working' ||
    row.status === 'closed' ||
    row.status === 'cancelled'
      ? row.status
      : 'filled'
  ) as TeamTapeStatus
  const entry = Number(row.entry)
  const stop = row.stop == null ? null : Number(row.stop)
  const targetIn = row.target == null ? null : Number(row.target)
  return {
    sourceId: row.source_id,
    symbol: row.symbol,
    side,
    quantity: Number(row.quantity),
    entry,
    stop: stop != null && stop > 0 ? stop : null,
    target:
      targetIn != null && targetIn > 0
        ? targetIn
        : teamTapeTarget1_5R({ side, entry, stop: stop != null && stop > 0 ? stop : null }),
    status,
    filledAt: row.filled_at,
  }
}

export async function GET(request: Request) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const deskId = process.env.DESK_USER_ID?.trim() || user.id || DEV_USER_ID
  const supabase = createAdminClient() ?? (await createClient())
  const now = new Date()
  const since = new Date(now)
  since.setUTCDate(since.getUTCDate() - 14)

  const [snap, attendance, { data, error }, questrade] = await Promise.all([
    loadTradeifySessionSnapshot(supabase, deskId, now),
    getTodayAttendance(supabase, deskId, 'NY', now),
    supabase
      .from('team_signals')
      .select('source_id, symbol, side, quantity, entry, stop, target, status, filled_at')
      .eq('user_id', deskId)
      .gte('created_at', since.toISOString())
      .order('filled_at', { ascending: false, nullsFirst: false })
      .limit(80),
    loadQuestradeAccountSnapshot(supabase),
  ])

  if (error) {
    return NextResponse.json({ error: error.message, ok: false }, { status: 500 })
  }

  const place = resolveTradeifyPlace(snap)
  const advice = buildTeamCopyAdvice({
    place,
    clockedIn: attendance?.status === 'clocked_in',
    now,
  })
  const { startIso } = tradeifySessionWindow(now)
  const signals = (data ?? []).map(asSignal)
  const open = signals.filter((s) => {
    if (s.status === 'closed' || s.status === 'cancelled') return false
    if (!s.filledAt) return true
    return s.filledAt >= startIso
  })
  const history = signals.filter((s) => !open.some((o) => o.sourceId === s.sourceId))

  return NextResponse.json({
    ok: true,
    advice,
    open,
    history,
    session: {
      fillsUsed: advice.fillsUsed,
      fillsLeft: advice.fillsLeft,
      riskDollars: advice.riskDollars,
      clockedIn: advice.clockedIn,
      mustFlatten: advice.mustFlatten,
    },
    questrade,
  })
}
