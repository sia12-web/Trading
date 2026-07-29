/**
 * POST /api/trading/positions/working
 * Persist a WORKING limit (not filled). Positions page ignores these until fill.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getESTDateString } from '@/lib/utils/timeUtils'
import {
  assertCanOpenPosition,
  isLiveDeskInstrument,
  isNyDeskInstrument,
  isDeskHoursNow,
  resolveSessionGate,
  deskMarketFor,
  instrumentsForDeskMarket,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import {
  assertBucketEntryEligible,
  attemptLadderFromCounts,
  bucketForRangeLabel,
  deskClockSeconds,
} from '@/lib/trading/attemptLadder'
import { getTodayAttendance, tradeDateForInstrument } from '@/lib/trading/deskAttendance'
import { logger } from '@/lib/utils/logger'
import { normalizeEntrySource } from '@/lib/trading/positionSizing'
import { assertServerRangeEdgeEntry } from '@/lib/trading/serverPlaybookRange'
import { logEntryDenied, logWorkingPlaced } from '@/lib/utils/deskAuditLog'
import { WORKING_LIMIT_ALREADY_MESSAGE } from '@/lib/trading/workingLimitGate'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const instrument = body.instrument
    if (!isLiveDeskInstrument(instrument)) {
      return NextResponse.json({ error: 'Invalid instrument' }, { status: 400 })
    }

    const level = Number(body.level ?? body.entry_price)
    const direction = String(body.entry_direction || body.direction || '').toUpperCase()
    if (!Number.isFinite(level) || level <= 0 || (direction !== 'LONG' && direction !== 'SHORT')) {
      return NextResponse.json({ error: 'Invalid level or direction' }, { status: 400 })
    }

    const supabase = await createClient()
    const tradeDate = tradeDateForInstrument(instrument)
    // NY recommendation row is keyed by EST calendar date
    const nyRecDate = getESTDateString()
    const market = deskMarketFor(instrument)
    const marketInstruments = instrumentsForDeskMarket(market)

    // One working limit at a time — never silently replace
    const { data: existingWorking } = await supabase
      .from('trades_journal')
      .select('id, instrument, entry_price, entry_direction')
      .eq('user_id', user.id)
      .eq('trade_date', tradeDate)
      .in('instrument', marketInstruments)
      .eq('fill_status', 'working')
      .is('exit_timestamp', null)
      .maybeSingle()

    if (existingWorking) {
      const msg = WORKING_LIMIT_ALREADY_MESSAGE
      logEntryDenied({
        route: 'working',
        reason: 'already_working',
        instrument,
        message: msg,
        status: 409,
        entry: level,
        direction,
      })
      return NextResponse.json(
        {
          error: msg,
          working_id: existingWorking.id,
          existing_instrument: existingWorking.instrument,
          existing_level: existingWorking.entry_price,
          existing_direction: existingWorking.entry_direction,
        },
        { status: 409 }
      )
    }

    const { data: filledOpen } = await supabase
      .from('trades_journal')
      .select('id')
      .eq('user_id', user.id)
      .eq('instrument', instrument)
      .eq('trade_date', tradeDate)
      .eq('fill_status', 'filled')
      .is('exit_timestamp', null)
      .maybeSingle()

    if (filledOpen) {
      logEntryDenied({
        route: 'working',
        reason: 'already_open',
        instrument,
        message: 'Already in a filled position today',
        status: 409,
        entry: level,
        direction,
      })
      return NextResponse.json(
        { error: 'Already in a filled position today', position_id: filledOpen.id },
        { status: 409 }
      )
    }

    const { data: rec } = await supabase
      .from('market_recommendations')
      .select('recommended_instrument')
      .eq('date', nyRecDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // NY lock from recommendation / regime only — never from client body (Sentinel C2)
    let locked: DeskInstrument | null =
      rec?.recommended_instrument && isNyDeskInstrument(rec.recommended_instrument)
        ? rec.recommended_instrument
        : null
    if (!locked) {
      const { data: regimes } = await supabase
        .from('regime_cache')
        .select('instrument, recommendation_confidence')
        .eq('date', nyRecDate)
        .in('instrument', ['DOW', 'NASDAQ'])
        .order('recommendation_confidence', { ascending: false })
        .limit(1)
      const top = regimes?.[0]
      if (top?.instrument && isNyDeskInstrument(top.instrument)) {
        locked = top.instrument
      }
    }
    // Fallback: check today's clocked-in attendance instrument
    if (!locked && isNyDeskInstrument(instrument)) {
      const attend = await getTodayAttendance(supabase, user.id, 'NY')
      if (attend?.instrument && isNyDeskInstrument(attend.instrument)) {
        locked = attend.instrument
      }
    }
    if (instrument === 'NIKKEI' || isDeskHoursNow(new Date(), 'NIKKEI').open) {
      locked = 'NIKKEI'
    }

    if (isNyDeskInstrument(instrument) && !locked) {
      return NextResponse.json(
        { error: 'No locked NY instrument yet — wait for morning recommendation' },
        { status: 403 }
      )
    }

    const [filledRes, openRes, attendance] = await Promise.all([
      supabase
        .from('trades_journal')
        .select('id, instrument, exit_reason, entry_timestamp, created_at')
        .eq('user_id', user.id)
        .eq('trade_date', tradeDate)
        .in('instrument', marketInstruments)
        .eq('fill_status', 'filled'),
      supabase
        .from('trades_journal')
        .select('id')
        .eq('user_id', user.id)
        .eq('trade_date', tradeDate)
        .in('instrument', marketInstruments)
        .eq('fill_status', 'filled')
        .is('exit_timestamp', null)
        .maybeSingle(),
      getTodayAttendance(supabase, user.id, market),
    ])

    const filledRows = filledRes.data ?? []
    const attemptFills = filledRows.map((t) => ({
      instrument: (t.instrument as string) || instrument,
      entryTimestamp: t.entry_timestamp || t.created_at || null,
      exitReason: (t.exit_reason as string) || null,
    }))
    const gate = resolveSessionGate({
      lockedInstrument: locked,
      hasOpenPosition: !!openRes.data,
      attemptsUsed: filledRows.length,
      stopLossHitCount: filledRows.filter((t) => t.exit_reason === 'stop_hit').length,
      attemptFills,
      viewingInstrument: instrument,
      clockedIn: attendance?.status === 'clocked_in',
      attendedToday: !!attendance,
    })
    const gateCheck = assertCanOpenPosition(instrument, gate)
    if (!gateCheck.ok) {
      // See open/route.ts: the blanket gate follows the single sequential
      // "active" range and can deny a click on a range with its own budget
      // left (e.g. IB still 1/2 while the clock highlight has moved to
      // Lunch). Universal blocks always win; otherwise allow the
      // range-specific bucket to override — assertServerRangeEdgeEntry below
      // re-verifies authoritatively regardless.
      const universalBlock =
        !gate.clockedIn || gate.dayLocked || gate.phase === 'MANAGE' || gate.phase === 'CLOSED'
      let rangeOverrideOk = false
      if (!universalBlock && body.range_label) {
        const bucket = bucketForRangeLabel(instrument, body.range_label)
        if (bucket) {
          const rangeLadder = attemptLadderFromCounts({
            morningAttempts: gate.morningAttempts,
            ibAttempts: gate.ibAttempts,
            lunchAttempts: gate.lunchAttempts,
            now: new Date(),
            instrument,
          })
          const bucketCheck = assertBucketEntryEligible({
            instrument,
            market,
            timeSec: deskClockSeconds(instrument),
            ladder: rangeLadder,
            rangeLabel: body.range_label,
          })
          rangeOverrideOk = bucketCheck.ok
        }
      }

      if (!rangeOverrideOk) {
        logEntryDenied({
          route: 'working',
          reason: 'session_gate',
          instrument,
          message: gateCheck.message,
          status: gateCheck.status,
          phase: gate.phase,
          canPlaceEntry: gate.canPlaceEntry,
          clockedIn: gate.clockedIn,
          dayLocked: gate.dayLocked,
          revengeLocked: gate.revengeLocked,
          ladder: gate.attemptLadderLabel,
          rangeStrategy: gate.rangeStrategy,
          entry: level,
          direction,
          entrySource: body.entry_source ?? null,
        })
        return NextResponse.json({ error: gateCheck.message }, { status: gateCheck.status })
      }
    }

    const edgeCheck = await assertServerRangeEdgeEntry({
      instrument,
      entry: level,
      clientRange:
        body.range_high != null && body.range_low != null
          ? {
              high: Number(body.range_high),
              low: Number(body.range_low),
              label: body.range_label ?? null,
            }
          : null,
      rangeStrategy: gate.rangeStrategy,
      morningAttempts: gate.morningAttempts,
      ibAttempts: gate.ibAttempts,
      lunchAttempts: gate.lunchAttempts,
    })
    if (!edgeCheck.ok) {
      logEntryDenied({
        route: 'working',
        reason: 'range_edge',
        instrument,
        message: edgeCheck.message,
        status: 400,
        phase: gate.phase,
        ladder: gate.attemptLadderLabel,
        rangeStrategy: gate.rangeStrategy,
        entry: level,
        direction,
        rangeHigh: body.range_high != null ? Number(body.range_high) : null,
        rangeLow: body.range_low != null ? Number(body.range_low) : null,
        rangeLabel: body.range_label ?? null,
        entrySource: body.entry_source ?? null,
      })
      return NextResponse.json({ error: edgeCheck.message }, { status: 400 })
    }

    const stop = Number(body.stop_loss_price ?? body.stopLoss)
    const target = Number(body.profit_target_price ?? body.profitTarget)
    const size = Number(body.position_size ?? body.positionSize)
    const risk = Number(body.risk_amount ?? body.riskAmount)
    const account = Number(body.account_size ?? body.accountSize) || 100000
    const entryWindow = Number(body.entry_window ?? body.entryWindow) || 1
    const regime = body.regime || 'bullish'
    const regimeConf = Number(body.regime_confidence ?? body.regimeConfidence) || 70

    if (!Number.isFinite(stop) || stop <= 0 || !Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: 'Invalid stop or size' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { data: row, error } = await supabase
      .from('trades_journal')
      .insert({
        user_id: user.id,
        instrument,
        trade_date: tradeDate,
        entry_window: entryWindow,
        entry_timestamp: now,
        entry_price: level,
        entry_direction: direction,
        stop_loss_price: stop,
        stop_loss_hit_count: 0,
        position_size: size,
        risk_amount: risk || 0,
        account_size: account,
        exit_timestamp: null,
        exit_price: null,
        exit_reason: null,
        profit_loss: null,
        profit_loss_percent: null,
        regime,
        regime_confidence: regimeConf,
        profit_target_price: Number.isFinite(target) ? target : null,
        entry_reason:
          typeof body.entry_reason === 'string' && body.entry_reason.trim()
            ? body.entry_reason.trim().slice(0, 2000)
            : `WORKING ${direction} limit @ ${level}`,
        entry_source: normalizeEntrySource(body.entry_source),
        fill_status: 'working',
        notes: 'Working limit — not filled yet',
      })
      .select('id')
      .single()

    if (error || !row) {
      // Soft-fallback if entry_source migration not applied yet
      if (error && /entry_source/i.test(error.message || '')) {
        const retry = await supabase
          .from('trades_journal')
          .insert({
            user_id: user.id,
            instrument,
            trade_date: tradeDate,
            entry_window: entryWindow,
            entry_timestamp: now,
            entry_price: level,
            entry_direction: direction,
            stop_loss_price: stop,
            stop_loss_hit_count: 0,
            position_size: size,
            risk_amount: risk || 0,
            account_size: account,
            exit_timestamp: null,
            exit_price: null,
            exit_reason: null,
            profit_loss: null,
            profit_loss_percent: null,
            regime,
            regime_confidence: regimeConf,
            profit_target_price: Number.isFinite(target) ? target : null,
            entry_reason:
              typeof body.entry_reason === 'string' && body.entry_reason.trim()
                ? body.entry_reason.trim().slice(0, 2000)
                : `WORKING ${direction} limit @ ${level}`,
            fill_status: 'working',
            notes: 'Working limit — not filled yet',
          })
          .select('id')
          .single()
        if (!retry.error && retry.data) {
          logWorkingPlaced({
            workingId: retry.data.id,
            instrument,
            level,
            direction,
            phase: gate.phase,
            ladder: gate.attemptLadderLabel,
            rangeStrategy: gate.rangeStrategy,
            rangeHigh: body.range_high != null ? Number(body.range_high) : null,
            rangeLow: body.range_low != null ? Number(body.range_low) : null,
            rangeLabel: body.range_label ?? null,
            entrySource: normalizeEntrySource(body.entry_source),
          })
          return NextResponse.json({
            success: true,
            working_id: retry.data.id,
            instrument,
            level,
            direction,
            fill_status: 'working',
          })
        }
      }
      logger.error('working.place_failed', { error })
      return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
    }

    logWorkingPlaced({
      workingId: row.id,
      instrument,
      level,
      direction,
      phase: gate.phase,
      ladder: gate.attemptLadderLabel,
      rangeStrategy: gate.rangeStrategy,
      rangeHigh: body.range_high != null ? Number(body.range_high) : null,
      rangeLow: body.range_low != null ? Number(body.range_low) : null,
      rangeLabel: body.range_label ?? null,
      entrySource: normalizeEntrySource(body.entry_source),
    })

    return NextResponse.json({
      success: true,
      working_id: row.id,
      instrument,
      level,
      direction,
      fill_status: 'working',
      message: 'Working limit placed — not on Positions until filled',
    })
  } catch (error) {
    logger.error('working.place_unexpected', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
