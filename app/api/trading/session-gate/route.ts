/**
 * GET /api/trading/session-gate
 * Returns desk phase, locks, and trading permissions.
 * LIVE focus: one market at a time (Tokyo → NIKKEI only; NY → DOW/NASDAQ).
 * NY 09:00–09:30: both DOW+NASDAQ visible; AI suggest at 09:15; hard lock only after clock-in.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getESTDateString } from '@/lib/utils/timeUtils'
import { logger } from '@/lib/utils/logger'
import {
  resolveSessionGate,
  isNyDeskInstrument,
  isLiveDeskInstrument,
  liveFocusMarket,
  isAnyLiveFocusWindowActive,
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
    const now = new Date()
    const focusMarket = liveFocusMarket(now)
    const marketInstruments = instrumentsForDeskMarket(focusMarket)
    const nyRecDate = getESTDateString()

    /** Soft AI / regime pick — never collapses NY tabs by itself */
    let suggestedInstrument: DeskInstrument | null = null
    /** Hard lock — attendance, open book, or Tokyo-only desk */
    let lockedInstrument: DeskInstrument | null = null

    if (focusMarket === 'TOKYO') {
      lockedInstrument = 'NIKKEI'
    } else {
      const { data: rec } = await supabase
        .from('market_recommendations')
        .select('recommended_instrument')
        .eq('date', nyRecDate)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (rec?.recommended_instrument && isNyDeskInstrument(rec.recommended_instrument)) {
        suggestedInstrument = rec.recommended_instrument
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
          suggestedInstrument = top.instrument
        }
      }
    }

    const tradeDate = tradeDateForInstrument(
      lockedInstrument ??
        viewingInstrument ??
        suggestedInstrument ??
        marketInstruments[0] ??
        'DOW',
      now
    )

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
        .select('id, instrument, exit_timestamp, exit_reason, entry_timestamp, created_at')
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
    const attemptFills = filledTrades.map((t) => ({
      instrument: (t.instrument as string) || lockedInstrument || 'DOW',
      entryTimestamp: t.entry_timestamp || t.created_at || null,
      exitReason: (t.exit_reason as string) || null,
    }))

    await autoLunchClockOut(supabase, user.id)

    const attendance = await getTodayAttendance(supabase, user.id, focusMarket, now)
    const clockedIn = attendance?.status === 'clocked_in'
    const attendedToday = !!attendance

    const attendanceFocus =
      (attendance?.traded_instrument &&
      isLiveDeskInstrument(attendance.traded_instrument)
        ? attendance.traded_instrument
        : null) ||
      (attendance?.instrument && isLiveDeskInstrument(attendance.instrument)
        ? attendance.instrument
        : null)

    // Hard lock only from clock-in / open book (not AI suggest or viewing tab)
    if (attendanceFocus && marketInstruments.includes(attendanceFocus)) {
      lockedInstrument = attendanceFocus
    }

    const focusLive = isAnyLiveFocusWindowActive(now)
    const viewingForGate =
      focusLive
        ? viewingInstrument && marketInstruments.includes(viewingInstrument)
          ? viewingInstrument
          : lockedInstrument ?? suggestedInstrument ?? marketInstruments[0] ?? null
        : viewingInstrument ?? lockedInstrument

    const gate = resolveSessionGate({
      lockedInstrument,
      suggestedInstrument,
      hasOpenPosition: !!openPos,
      attemptsUsed,
      stopLossHitCount: stopHits,
      attemptFills,
      viewingInstrument: viewingForGate,
      clockedIn,
      attendedToday,
      now,
    })

    return NextResponse.json(
      {
        success: true,
        ...gate,
        suggested_instrument: gate.suggestedInstrument,
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
        morning_attempts: gate.morningAttempts,
        ib_attempts: gate.ibAttempts,
        lunch_attempts: gate.lunchAttempts,
        attempt_ladder: gate.attemptLadderLabel,
        revenge_locked: gate.revengeLocked,
        day_locked: gate.dayLocked,
        focus_market: focusMarket,
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
