/**
 * GET /api/trading/session-gate
 * Returns desk phase, locks, and trading permissions.
 * LIVE focus: NY only (DOW/NASDAQ). Nikkei is Simulation.
 * NY 09:00–09:30: both DOW+NASDAQ visible; AI suggest at 09:15; hard lock only after clock-in.
 */

import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'
import {
  resolveSessionGate,
  isNyDeskInstrument,
  liveFocusMarket,
  isAnyLiveFocusWindowActive,
  instrumentsForDeskMarket,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import { tradeDateForInstrument } from '@/lib/trading/deskAttendance'
import { noteSessionGateTransition } from '@/lib/utils/deskAuditLog'
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

    const now = new Date()
    const focusMarket = liveFocusMarket(now)
    const marketInstruments = instrumentsForDeskMarket(focusMarket)

    /** Soft AI / regime pick — never collapses NY tabs by itself */
    let suggestedInstrument: DeskInstrument | null = viewingInstrument || marketInstruments[0] || 'DOW'
    /** Ranked board across DOW / NASDAQ / GOLD / CRUDE */
    const rankedBoard: Array<{ instrument: DeskInstrument; confidence: number }> = [
      { instrument: 'DOW', confidence: 0.8 },
      { instrument: 'NASDAQ', confidence: 0.8 },
      { instrument: 'GOLD', confidence: 0.7 },
      { instrument: 'CRUDE', confidence: 0.7 },
    ]
    const lockedInstrument: DeskInstrument | null = null

    const tradeDate = tradeDateForInstrument(
      viewingInstrument ?? suggestedInstrument ?? 'DOW',
      now
    )

    const openPos: { id: string; instrument: string } | null = null
    const attemptsUsed = 0
    const stopHits = 0
    const attemptFills: any[] = []
    const tradeifySnap = {
      sessionKey: tradeDate,
      fillsUsed: 0,
      dailyPnl: 0,
      stopOutsToday: 0,
      leftoverDll: 1500,
      dllUsed: 0,
      allowed: true,
    }

    const clockedIn = true
    const attendedToday = true

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
      : {
          ...gate,
          canClockIn: false,
          clockedIn: true,
          attendedToday: true,
          canViewLiveChart: true,
          canFetchLiveBars: true,
          canManagePosition: true,
          canPlaceEntry: !gate.dayLocked && (gate.attemptsUsed ?? 0) < (gate.maxAttempts ?? 3),
        }

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
        openPositionId: null,
        message: liveGate.message,
      },
    })

    return NextResponse.json(
      {
        success: true,
        ...liveGate,
        rankedBoard,
        suggested_instrument: liveGate.suggestedInstrument,
        open_position_id: null,
        open_instrument: null,
        trade_date: tradeDate,
        server_now_et: gate.timeEst,
        attendance_id: null,
        attendance_status: null,
        useCall: false,
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
