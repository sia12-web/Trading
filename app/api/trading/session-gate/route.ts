/**
 * GET /api/trading/session-gate
 * Returns desk phase, locks, and trading permissions.
 * NY: DOW/NASDAQ from morning recommendation. Tokyo: NIKKEI when TSE morning is live.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getESTDateString } from '@/lib/utils/timeUtils'
import { logger } from '@/lib/utils/logger'
import {
  resolveSessionGate,
  isDeskHoursNow,
  isNyDeskInstrument,
  isLiveDeskInstrument,
  deskMarketFor,
  instrumentsForDeskMarket,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import {
  getTodayAttendance,
  autoLunchClockOut,
  tradeDateForInstrument,
} from '@/lib/trading/deskAttendance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const viewingParam = searchParams.get('instrument')
    const viewingInstrument = isLiveDeskInstrument(viewingParam || '')
      ? (viewingParam as DeskInstrument)
      : null

    const supabase = await createClient()
    const nyRecDate = getESTDateString()

    // Resolve lock first so attempt book is scoped to the active desk market
    const { data: rec } = await supabase
      .from('market_recommendations')
      .select('recommended_instrument')
      .eq('date', nyRecDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let lockedInstrument: DeskInstrument | null = null

    if (rec?.recommended_instrument && isNyDeskInstrument(rec.recommended_instrument)) {
      lockedInstrument = rec.recommended_instrument
    } else {
      const { data: regimes } = await supabase
        .from('regime_cache')
        .select('instrument, recommendation_confidence')
        .eq('date', nyRecDate)
        .in('instrument', ['DOW', 'NASDAQ'])
        .order('recommendation_confidence', { ascending: false })
        .limit(1)

      const top = regimes?.[0]
      if (top?.instrument && isNyDeskInstrument(top.instrument)) {
        lockedInstrument = top.instrument
      }
    }

    if (isDeskHoursNow(new Date(), 'NIKKEI').open) {
      lockedInstrument = 'NIKKEI'
    }

    const market = deskMarketFor(lockedInstrument ?? viewingInstrument ?? 'DOW')
    const marketInstruments = instrumentsForDeskMarket(market)
    const tradeDate = tradeDateForInstrument(lockedInstrument ?? viewingInstrument ?? 'DOW')

    const [openPosRes, filledRes] = await Promise.all([
      supabase
        .from('trades_journal')
        .select('id, instrument, stop_loss_hit_count')
        .eq('user_id', user.id)
        .eq('trade_date', tradeDate)
        .in('instrument', marketInstruments)
        .eq('fill_status', 'filled')
        .is('exit_timestamp', null)
        .maybeSingle(),
      supabase
        .from('trades_journal')
        .select('id, exit_timestamp, exit_reason, stop_loss_hit_count')
        .eq('user_id', user.id)
        .eq('trade_date', tradeDate)
        .in('instrument', marketInstruments)
        .eq('fill_status', 'filled'),
    ])

    const openPos = openPosRes.data
    if (openPos?.instrument && isLiveDeskInstrument(openPos.instrument)) {
      lockedInstrument = openPos.instrument as DeskInstrument
    }

    const filledTrades = filledRes.data ?? []
    const attemptsUsed = filledTrades.length
    const stopHits = filledTrades.filter((t) => t.exit_reason === 'stop_hit').length

    // Lunch may have hit while the tab was open — auto clock-out
    await autoLunchClockOut(supabase, user.id)

    const attendance = await getTodayAttendance(supabase, user.id, market)
    const clockedIn = attendance?.status === 'clocked_in'
    const attendedToday = !!attendance

    const gate = resolveSessionGate({
      lockedInstrument,
      hasOpenPosition: !!openPos,
      attemptsUsed,
      stopLossHitCount: stopHits,
      viewingInstrument: viewingInstrument ?? lockedInstrument,
      clockedIn,
      attendedToday,
    })

    return NextResponse.json(
      {
        success: true,
        ...gate,
        open_position_id: openPos?.id ?? null,
        open_instrument: openPos?.instrument ?? null,
        trade_date: tradeDate,
        server_now_et: gate.timeEst,
        attendance_id: attendance?.id ?? null,
        attendance_status: attendance?.status ?? null,
        attempts_used: gate.attemptsUsed,
        max_attempts: gate.maxAttempts,
        stop_hits: gate.stopHits,
        max_stop_hits: gate.maxStopHits,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    )
  } catch (error) {
    logger.error('session-gate.failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
