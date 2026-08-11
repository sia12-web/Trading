/**
 * GET  /api/trading/positions/working — hydrate chart overlay from durable row
 * POST /api/trading/positions/working — persist a WORKING limit (not filled)
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
  liveFocusMarket,
  sessionFor,
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
import {
  normalizeEntrySource,
  riskPercentForEntrySource,
  getPositionSizer,
} from '@/lib/trading/positionSizing'
import { assertServerRangeEdgeEntry } from '@/lib/trading/serverPlaybookRange'
import { logEntryDenied, logWorkingPlaced } from '@/lib/utils/deskAuditLog'
import { formatWorkingLimitAlreadyMessage } from '@/lib/trading/workingLimitGate'
import {
  shouldExpireWorkingLimit,
} from '@/lib/trading/sessionCleanup'
import { assertProtectiveStop } from '@/lib/trading/stopLossGuard'

export const dynamic = 'force-dynamic'

const WORKING_SELECT =
  'id, instrument, trade_date, entry_price, entry_direction, stop_loss_price, profit_target_price, position_size, risk_amount, account_size, entry_window, regime, regime_confidence, entry_timestamp, entry_reason, entry_source'

function tradeDatesForMarket(instruments: DeskInstrument[], now = new Date()): string[] {
  return Array.from(new Set(instruments.map((i) => tradeDateForInstrument(i, now))))
}

function localNowSeconds(tz: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  const s = parseInt(parts.find((p) => p.type === 'second')?.value ?? '0', 10)
  const hour = h === 24 ? 0 : h
  return hour * 3600 + m * 60 + s
}

function parseHms(hms: string): number {
  const [h, m, sec] = hms.split(':').map(Number)
  return (h || 0) * 3600 + (m || 0) * 60 + (sec || 0)
}

/** GET — return today's durable working limit for the active desk market (if any). */
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

    const now = new Date()
    const focusMarket = liveFocusMarket(now)
    const marketInstruments = instrumentsForDeskMarket(focusMarket)
    const tradeDates = tradeDatesForMarket(marketInstruments, now)

    const supabase = await createClient()
    const { data: row, error } = await supabase
      .from('trades_journal')
      .select(WORKING_SELECT)
      .eq('user_id', user.id)
      .in('instrument', marketInstruments)
      .in('trade_date', tradeDates)
      .eq('fill_status', 'working')
      .is('exit_timestamp', null)
      .maybeSingle()

    if (error) {
      logger.error('working.fetch_failed', { error })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!row) {
      return NextResponse.json({ success: true, working: null })
    }

    const inst = row.instrument as DeskInstrument
    const sess = sessionFor(inst)
    const t = localNowSeconds(sess.tz, now)
    const expired = shouldExpireWorkingLimit({
      timeSec: t,
      entryCloseSec: parseHms(sess.entryClose),
      lunchCloseSec: parseHms(sess.lunchClose),
      deskHoursOpen: isDeskHoursNow(now, inst).open,
    })

    if (expired) {
      const nowIso = now.toISOString()
      await supabase
        .from('trades_journal')
        .update({
          fill_status: 'cancelled',
          exit_timestamp: nowIso,
          exit_price: row.entry_price,
          exit_reason: 'limit_expired',
          profit_loss: 0,
          profit_loss_percent: 0,
          exit_notes: 'Working limit never filled — auto-expired on fetch',
          updated_at: nowIso,
        })
        .eq('id', row.id)
        .eq('user_id', user.id)
        .eq('fill_status', 'working')
        .is('exit_timestamp', null)
      return NextResponse.json({ success: true, working: null, expired_id: row.id })
    }

    return NextResponse.json({
      success: true,
      working: row,
      viewing_instrument: viewingInstrument,
    })
  } catch (error) {
    logger.error('working.fetch_unexpected', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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
    const tradeDates = tradeDatesForMarket(marketInstruments)

    // One working limit at a time — never silently replace
    const { data: existingWorking } = await supabase
      .from('trades_journal')
      .select(WORKING_SELECT)
      .eq('user_id', user.id)
      .in('trade_date', tradeDates)
      .in('instrument', marketInstruments)
      .eq('fill_status', 'working')
      .is('exit_timestamp', null)
      .maybeSingle()

    if (existingWorking) {
      const msg = formatWorkingLimitAlreadyMessage({
        instrument: existingWorking.instrument,
        direction: existingWorking.entry_direction,
        level: Number(existingWorking.entry_price),
      })
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
          working: existingWorking,
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
        .select('id, instrument, exit_reason, entry_timestamp, created_at, range_bucket')
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
      rangeBucket:
        (t as { range_bucket?: string | null }).range_bucket as
          | 'morning'
          | 'ib'
          | 'lunch_range'
          | 'other'
          | null
          | undefined,
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

    const stop = Number(body.stop_loss_price ?? body.stopLoss)
    const target = Number(body.profit_target_price ?? body.profitTarget)
    const account = Number(body.account_size ?? body.accountSize) || 100000
    const entryWindow = Number(body.entry_window ?? body.entryWindow) || 1
    const regime = body.regime || 'bullish'
    const regimeConf = Number(body.regime_confidence ?? body.regimeConfidence) || 70
    const entrySource = normalizeEntrySource(body.entry_source)

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

    if (!Number.isFinite(stop) || stop <= 0) {
      return NextResponse.json({ error: 'Invalid stop' }, { status: 400 })
    }

    const stopGuard = assertProtectiveStop({
      instrument,
      entry: level,
      stop,
      direction: direction as 'LONG' | 'SHORT',
      plannedStop: stop,
    })
    if (!stopGuard.ok) {
      logEntryDenied({
        route: 'working',
        reason: 'stop_guard',
        instrument,
        message: stopGuard.message,
        status: 400,
        entry: level,
        direction,
        entrySource,
      })
      return NextResponse.json({ error: stopGuard.message }, { status: 400 })
    }
    const stopLossPrice = stopGuard.stop

    // Server-authoritative progressive risk (2% → 1% → 0.5%) from filled
    // session attempts — ignore client-claimed size/risk so chart/ticket can't
    // under/over-size vs the ladder.
    const riskPct = riskPercentForEntrySource(entrySource, gate.attemptsUsed)
    const sizing = getPositionSizer().calculatePosition(
      level,
      account,
      direction,
      stopLossPrice,
      riskPct
    )
    if (!sizing) {
      return NextResponse.json({ error: 'Invalid stop or account for sizing' }, { status: 400 })
    }
    const size = sizing.position_size
    const risk = sizing.risk_amount

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
        stop_loss_price: stopLossPrice,
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
        entry_source: entrySource,
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
            stop_loss_price: stopLossPrice,
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
            entrySource,
          })
          return NextResponse.json({
            success: true,
            working_id: retry.data.id,
            instrument,
            level,
            direction,
            fill_status: 'working',
            position_size: size,
            risk_amount: risk,
            risk_percent: riskPct,
            account_size: account,
            stop_loss_price: stopLossPrice,
            profit_target_price: Number.isFinite(target) ? target : null,
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
      entrySource,
    })

    return NextResponse.json({
      success: true,
      working_id: row.id,
      instrument,
      level,
      direction,
      fill_status: 'working',
      position_size: size,
      risk_amount: risk,
      risk_percent: riskPct,
      account_size: account,
      stop_loss_price: stopLossPrice,
      profit_target_price: Number.isFinite(target) ? target : null,
      message: 'Working limit placed — not on Positions until filled',
    })
  } catch (error) {
    logger.error('working.place_unexpected', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
