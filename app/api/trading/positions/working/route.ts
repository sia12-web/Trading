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
  resolveSessionGate,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import { logger } from '@/lib/utils/logger'

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
    const today = getESTDateString()

    // Cancel any prior working limit for today on this instrument
    await supabase
      .from('trades_journal')
      .update({
        fill_status: 'cancelled',
        exit_timestamp: new Date().toISOString(),
        exit_price: level,
        exit_reason: 'limit_expired',
        profit_loss: 0,
        profit_loss_percent: 0,
        exit_notes: 'Replaced by a new working limit',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('instrument', instrument)
      .eq('trade_date', today)
      .eq('fill_status', 'working')
      .is('exit_timestamp', null)

    const { data: filledOpen } = await supabase
      .from('trades_journal')
      .select('id')
      .eq('user_id', user.id)
      .eq('instrument', instrument)
      .eq('trade_date', today)
      .eq('fill_status', 'filled')
      .is('exit_timestamp', null)
      .maybeSingle()

    if (filledOpen) {
      return NextResponse.json(
        { error: 'Already in a filled position today', position_id: filledOpen.id },
        { status: 409 }
      )
    }

    const { data: rec } = await supabase
      .from('market_recommendations')
      .select('recommended_instrument')
      .eq('date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let locked: DeskInstrument | null =
      rec?.recommended_instrument && isNyDeskInstrument(rec.recommended_instrument)
        ? rec.recommended_instrument
        : null
    if (!locked) locked = instrument

    const gate = resolveSessionGate({
      lockedInstrument: locked,
      hasOpenPosition: false,
      stopLossHitCount: 0,
      dayDone: false,
      viewingInstrument: instrument,
    })
    const gateCheck = assertCanOpenPosition(instrument, gate)
    if (!gateCheck.ok) {
      return NextResponse.json({ error: gateCheck.message }, { status: gateCheck.status })
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
        trade_date: today,
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

    if (error || !row) {
      logger.error('working.place_failed', { error })
      return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
    }

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
