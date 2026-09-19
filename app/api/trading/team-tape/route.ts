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
} from '@/lib/trading/tradeifyGrowth50k'
import {
  buildTeamCopyAdvice,
  teamTapeTarget1_5R,
  type TeamTapeSide,
  type TeamTapeSignal,
  type TeamTapeStatus,
} from '@/lib/trading/teamTape'
import { loadQuestradeBook } from '@/lib/trading/questradeBook'
import { getSymbolRealName } from '@/lib/trading/symbolNames'

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
  const meta = getSymbolRealName(row.symbol)
  return {
    sourceId: row.source_id,
    symbol: row.symbol,
    companyName: meta.name,
    realName: meta.name,
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
  since.setUTCDate(since.getUTCDate() - 30)

  const [snap, attendance, teamSignalsRes, questradeBook] = await Promise.all([
    loadTradeifySessionSnapshot(supabase, deskId, now),
    getTodayAttendance(supabase, deskId, 'NY', now),
    (async () => {
      try {
        const res = await supabase
          .from('team_signals')
          .select('source_id, symbol, side, quantity, entry, stop, target, status, filled_at')
          .eq('user_id', deskId)
          .gte('created_at', since.toISOString())
          .order('filled_at', { ascending: false, nullsFirst: false })
          .limit(80)
        return res
      } catch {
        return { data: null, error: null }
      }
    })(),
    loadQuestradeBook(supabase, now).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : 'Questrade read failed',
    })),
  ])

  const place = resolveTradeifyPlace(snap)
  const advice = buildTeamCopyAdvice({
    place,
    clockedIn: attendance?.status === 'clocked_in',
    now,
  })

  const storedSignals: TeamTapeSignal[] = (teamSignalsRes.data ?? []).map(asSignal)
  const open: TeamTapeSignal[] = []
  const history: TeamTapeSignal[] = []

  // 1. If Questrade book loaded successfully, merge live open positions, working limits, and recent history
  if (questradeBook.ok) {
    // Merge open positions
    for (const p of questradeBook.openPositions) {
      const storedMatch = storedSignals.find((s) => s.symbol === p.symbol || s.sourceId === p.sourceId)
      const stop = p.stop ?? storedMatch?.stop ?? null
      const target =
        p.target ??
        storedMatch?.target ??
        teamTapeTarget1_5R({ side: p.side, entry: p.entry, stop })
      open.push({
        sourceId: p.sourceId,
        symbol: p.symbol,
        companyName: p.companyName || getSymbolRealName(p.symbol).name,
        realName: p.realName || getSymbolRealName(p.symbol).name,
        side: p.side,
        quantity: p.quantity,
        entry: p.entry,
        stop,
        target,
        status: 'filled',
        filledAt: p.filledAt,
      })
    }

    // Merge working entry limits
    for (const w of questradeBook.workingLimits) {
      if (!open.some((o) => o.sourceId === w.sourceId)) {
        const storedMatch = storedSignals.find((s) => s.sourceId === w.sourceId)
        const stop = w.stop ?? storedMatch?.stop ?? null
        const target =
          w.target ??
          storedMatch?.target ??
          teamTapeTarget1_5R({ side: w.side, entry: w.entry, stop })
        open.push({
          sourceId: w.sourceId,
          symbol: w.symbol,
          companyName: w.companyName || getSymbolRealName(w.symbol).name,
          realName: w.realName || getSymbolRealName(w.symbol).name,
          side: w.side,
          quantity: w.quantity,
          entry: w.entry,
          stop,
          target,
          status: 'working',
          filledAt: w.filledAt,
        })
      }
    }

    // Merge history
    for (const h of questradeBook.history) {
      if (!open.some((o) => o.symbol === h.symbol && o.sourceId === h.sourceId)) {
        const stop = h.stop
        const target =
          h.target ??
          teamTapeTarget1_5R({ side: h.side, entry: h.entry, stop })
        history.push({
          sourceId: h.sourceId,
          symbol: h.symbol,
          companyName: h.companyName || getSymbolRealName(h.symbol).name,
          realName: h.realName || getSymbolRealName(h.symbol).name,
          side: h.side,
          quantity: h.quantity,
          entry: h.entry,
          stop,
          target,
          status: h.status,
          filledAt: h.filledAt,
        })
      }
    }
  }

  // 2. Merge any stored team signals not already accounted for
  for (const s of storedSignals) {
    const inHistory = history.some((h) => h.sourceId === s.sourceId)
    const inOpen = open.some((o) => o.symbol === s.symbol || o.sourceId === s.sourceId)
    if (s.status === 'closed' || s.status === 'cancelled') {
      if (!inHistory) {
        history.push(s)
      }
    } else {
      // Do not resurrect an order into open if it is already in history,
      // or if questrade live book is connected and confirms this symbol is not open in the account.
      const questradeClosedSymbol =
        questradeBook.ok &&
        !questradeBook.openPositions.some((p) => p.symbol === s.symbol) &&
        questradeBook.history.some((h) => h.symbol === s.symbol || h.sourceId === s.sourceId)
      if (!inOpen && !inHistory && !questradeClosedSymbol) {
        open.push(s)
      }
    }
  }

  // Ensure both open and history are consistently sorted newest first
  open.sort((a, b) => String(b.filledAt || '').localeCompare(String(a.filledAt || '')))
  history.sort((a, b) => String(b.filledAt || '').localeCompare(String(a.filledAt || '')))

  const questradeSnapshot = questradeBook.ok ? questradeBook.account : questradeBook

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
    questrade: questradeSnapshot,
  })
}
