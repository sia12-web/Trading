/**
 * GET /api/trading/session-gate
 * Returns desk phase, locks, and trading permissions.
 * LIVE focus: NY only (DOW/NASDAQ). Nikkei is Simulation.
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
  liveFocusMarket,
  isAnyLiveFocusWindowActive,
  instrumentsForDeskMarket,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import {
  getTodayAttendance,
  autoLunchClockOut,
  tradeDateForInstrument,
  attendanceCallMode,
} from '@/lib/trading/deskAttendance'
import { noteSessionGateTransition } from '@/lib/utils/deskAuditLog'
import { loadTradeifySessionSnapshot } from '@/lib/trading/tradeifySessionState'
import {
  resolveTradeifyPlace,
  tradeifyDeskStatus,
  tradeifyDllUsed,
  tradeifyMustFlatten,
  TRADEIFY_DLL_DOLLARS,
} from '@/lib/trading/tradeifyGrowth50k'
import { tradeifyFlattenMontreal } from '@/lib/trading/tradeifyLeoBlock'
import { LIVE_CLOCK_REFUSE } from '@/lib/trading/liveDeskBook'

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
    const viewingInstrument = isNyDeskInstrument(viewingParam || '')
      ? (viewingParam as DeskInstrument)
      : null

    const supabase = await createClient()
    const now = new Date()
    const focusMarket = liveFocusMarket(now)
    const marketInstruments = instrumentsForDeskMarket(focusMarket)
    const nyRecDate = getESTDateString()

    /** Soft AI / regime pick — never collapses NY tabs by itself */
    let suggestedInstrument: DeskInstrument | null = null
    /** Ranked 9:15 board across DOW / NASDAQ / GOLD / CRUDE */
    let rankedBoard: Array<{ instrument: DeskInstrument; confidence: number }> = []
    /** Hard lock — attendance or open book (NY only). Never auto-lock Nikkei. */
    let lockedInstrument: DeskInstrument | null = null

    if (focusMarket === 'NY') {
      const { data: rec } = await supabase
        .from('market_recommendations')
        .select('recommended_instrument, all_recommendations')
        .eq('date', nyRecDate)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (rec?.recommended_instrument && isNyDeskInstrument(rec.recommended_instrument)) {
        suggestedInstrument = rec.recommended_instrument
      }

      const { data: regimes } = await supabase
        .from('regime_cache')
        .select('instrument, recommendation_confidence')
        .eq('date', nyRecDate)
        .in('instrument', ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'])
        .order('recommendation_confidence', { ascending: false })

      rankedBoard = (regimes || [])
        .filter((r) => isNyDeskInstrument(r.instrument))
        .map((r) => ({
          instrument: r.instrument as DeskInstrument,
          confidence: Number(r.recommendation_confidence) || 0,
        }))

      if (!suggestedInstrument) {
        const top = rankedBoard[0]
        if (top?.instrument) suggestedInstrument = top.instrument
      }

      if (rankedBoard.length === 0 && rec?.all_recommendations) {
        try {
          const parsed = JSON.parse(String(rec.all_recommendations)) as Array<{
            instrument?: string
            confidence?: number
          }>
          if (Array.isArray(parsed)) {
            rankedBoard = parsed
              .filter((r) => isNyDeskInstrument(r.instrument || ''))
              .map((r) => ({
                instrument: r.instrument as DeskInstrument,
                confidence: Number(r.confidence) || 0,
              }))
          }
        } catch {
          /* ignore */
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

    const [openPosRes, filledRes, tradeifySnap] = await Promise.all([
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
        .select(
          'id, instrument, exit_timestamp, exit_reason, entry_timestamp, created_at, range_bucket'
        )
        .eq('user_id', user.id)
        .eq('trade_date', tradeDate)
        .in('instrument', marketInstruments)
        .eq('fill_status', 'filled'),
      loadTradeifySessionSnapshot(supabase, user.id, now),
    ])

    const openPos = openPosRes.data
    if (openPos?.instrument && isNyDeskInstrument(openPos.instrument)) {
      lockedInstrument = openPos.instrument
    }

    const filledTrades = filledRes.data ?? []
    const attemptsUsed = filledTrades.length
    const stopHits = filledTrades.filter((t) => t.exit_reason === 'stop_hit').length
    const attemptFills = filledTrades.map((t) => ({
      instrument: (t.instrument as string) || lockedInstrument || 'DOW',
      entryTimestamp: t.entry_timestamp || t.created_at || null,
      exitReason: (t.exit_reason as string) || null,
      rangeBucket:
        (t as { range_bucket?: string | null }).range_bucket as
          | 'morning'
          | 'ib'
          | 'lunch_range'
          | 'other'
          | null
          | undefined,
    }))

    await autoLunchClockOut(supabase, user.id)

    const attendance = await getTodayAttendance(supabase, user.id, focusMarket, now)
    const clockedIn = attendance?.status === 'clocked_in'
    const attendedToday = !!attendance

    const attendanceFocus =
      (attendance?.traded_instrument &&
      isNyDeskInstrument(attendance.traded_instrument)
        ? attendance.traded_instrument
        : null) ||
      (attendance?.instrument && isNyDeskInstrument(attendance.instrument)
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

    const tradeify = resolveTradeifyPlace(tradeifySnap)

    const liveTokyoOff =
      focusMarket === 'TOKYO' ||
      viewingForGate === 'NIKKEI' ||
      gate.market === 'TOKYO'
    const liveGate = liveTokyoOff
      ? {
          ...gate,
          canClockIn: false,
          canPlaceEntry: false,
          glanceOnly: true,
          canViewLiveChart: true,
          canFetchLiveBars: true,
          message: LIVE_CLOCK_REFUSE,
        }
      : gate

    noteSessionGateTransition({
      userId: user.id,
      viewing: viewingForGate,
      snap: {
        phase: liveGate.phase,
        canPlaceEntry: liveGate.canPlaceEntry,
        canManagePosition: liveGate.canManagePosition,
        clockedIn: liveGate.clockedIn,
        dayLocked: liveGate.dayLocked,
        revengeLocked: liveGate.revengeLocked,
        rangeStrategy: liveGate.rangeStrategy,
        ladder: liveGate.attemptLadderLabel,
        lockedInstrument: liveGate.lockedInstrument,
        openPositionId: openPos?.id ?? null,
        message: liveGate.message,
      },
    })

    return NextResponse.json(
      {
        success: true,
        ...liveGate,
        rankedBoard,
        suggested_instrument: liveGate.suggestedInstrument,
        open_position_id: openPos?.id ?? null,
        open_instrument: openPos?.instrument ?? null,
        trade_date: tradeDate,
        server_now_et: gate.timeEst,
        attendance_id: attendance?.id ?? null,
        attendance_status: attendance?.status ?? null,
        useCall: clockedIn ? attendanceCallMode(attendance?.morning_journal) : null,
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
        tradeify: {
          sessionKey: tradeify.sessionKey,
          fillsUsed: tradeify.fillsUsed,
          dailyPnl: tradeifySnap.dailyPnl ?? 0,
          stopOutsToday: tradeifySnap.stopOutsToday ?? 0,
          leftoverDll: tradeify.leftoverDll,
          dllUsed: tradeifyDllUsed(tradeifySnap.dailyPnl),
          dllCap: TRADEIFY_DLL_DOLLARS,
          floorRoom: tradeify.floorRoom,
          allowed: tradeify.allowed,
          refuseReason: tradeify.refuseReason,
          refuseMessage: tradeify.refuseMessage,
          dayLocked: !tradeify.allowed,
          mustFlatten: tradeifyMustFlatten(now),
          status: tradeifyDeskStatus(tradeify, now),
          flattenMontreal: tradeifyFlattenMontreal(now),
        },
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
