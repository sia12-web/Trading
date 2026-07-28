/**
 * POST /api/trading/positions/update-brackets
 * Trader-driven SL/TP change on a filled open position.
 * Syncs OANDA first (when linked), then trades_journal.
 * Partial OANDA success is always persisted so broker and journal stay aligned.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'
import { isOandaConfigured } from '@/lib/oanda/config'
import {
  updateOandaTradeStopLoss,
  updateOandaTradeTakeProfit,
} from '@/lib/oanda/orders'
import { validateBracketUpdate } from '@/lib/trading/bracketUpdate'
import type { Instrument } from '@/types/trading'

interface Body {
  position_id?: string
  stop_loss_price?: number
  profit_target_price?: number
}

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as Body
    if (!body.position_id) {
      return NextResponse.json({ error: 'position_id required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: position, error } = await supabase
      .from('trades_journal')
      .select(
        'id, user_id, instrument, entry_price, entry_direction, stop_loss_price, profit_target_price, oanda_trade_id, fill_status, exit_timestamp, trade_date'
      )
      .eq('id', body.position_id)
      .eq('user_id', user.id)
      .eq('fill_status', 'filled')
      .is('exit_timestamp', null)
      .maybeSingle()

    if (error || !position) {
      return NextResponse.json({ error: 'Open filled position not found' }, { status: 404 })
    }

    const validated = validateBracketUpdate({
      entryPrice: Number(position.entry_price),
      direction: position.entry_direction as 'LONG' | 'SHORT',
      stopLossPrice:
        body.stop_loss_price !== undefined && body.stop_loss_price !== null
          ? Number(body.stop_loss_price)
          : undefined,
      profitTargetPrice:
        body.profit_target_price !== undefined && body.profit_target_price !== null
          ? Number(body.profit_target_price)
          : undefined,
      currentStopLoss: Number(position.stop_loss_price),
      currentProfitTarget:
        position.profit_target_price != null ? Number(position.profit_target_price) : null,
    })

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }

    const instrument = position.instrument as Instrument
    const oandaTradeId = position.oanda_trade_id ? String(position.oanda_trade_id) : null
    const useOanda = !!(oandaTradeId && isOandaConfigured())

    let slApplied = !validated.changedSl
    let tpApplied = !validated.changedTp
    let oandaError: string | null = null

    if (useOanda && oandaTradeId) {
      if (validated.changedSl) {
        const slRes = await updateOandaTradeStopLoss(
          oandaTradeId,
          validated.stopLossPrice,
          instrument
        )
        slApplied = slRes.ok
        if (!slRes.ok) oandaError = `OANDA stop loss update failed: ${slRes.error}`
      }
      if (validated.changedTp && validated.profitTargetPrice != null) {
        const tpRes = await updateOandaTradeTakeProfit(
          oandaTradeId,
          validated.profitTargetPrice,
          instrument
        )
        tpApplied = tpRes.ok
        if (!tpRes.ok) {
          oandaError = oandaError
            ? `${oandaError}; OANDA take profit update failed: ${tpRes.error}`
            : `OANDA take profit update failed: ${tpRes.error}`
        }
      }
    } else {
      slApplied = true
      tpApplied = true
    }

    const nextSl = slApplied && validated.changedSl
      ? validated.stopLossPrice
      : Number(position.stop_loss_price)
    const nextTp =
      tpApplied && validated.changedTp
        ? validated.profitTargetPrice
        : position.profit_target_price != null
          ? Number(position.profit_target_price)
          : null

    const patch: Record<string, number | null> = {}
    if (slApplied && validated.changedSl) patch.stop_loss_price = validated.stopLossPrice
    if (tpApplied && validated.changedTp) patch.profit_target_price = validated.profitTargetPrice

    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await supabase
        .from('trades_journal')
        .update(patch)
        .eq('id', position.id)
        .eq('user_id', user.id)

      if (updateError) {
        logger.error('update-brackets.db_failed', { err: updateError, positionId: position.id })
        return NextResponse.json(
          {
            error: 'Failed to save brackets',
            stop_loss_price: nextSl,
            profit_target_price: nextTp,
            partial: Object.keys(patch).length > 0,
          },
          { status: 500 }
        )
      }
    }

    const anySucceeded =
      (validated.changedSl && slApplied) || (validated.changedTp && tpApplied)
    const anyFailed =
      (validated.changedSl && !slApplied) || (validated.changedTp && !tpApplied)

    if (oandaError && !anySucceeded) {
      return NextResponse.json(
        {
          error: oandaError,
          stop_loss_price: Number(position.stop_loss_price),
          profit_target_price:
            position.profit_target_price != null ? Number(position.profit_target_price) : null,
        },
        { status: 502 }
      )
    }

    if (oandaError && anyFailed && anySucceeded) {
      // Partial broker success — journal already matches what OANDA accepted
      logger.warn('update-brackets.partial', {
        positionId: position.id,
        oandaError,
        stopLoss: nextSl,
        takeProfit: nextTp,
      })
      try {
        await supabase.from('management_decisions').insert({
          user_id: user.id,
          position_id: position.id,
          instrument,
          trade_date: position.trade_date,
          decision_type: 'ADJUST',
          notes: `Partial bracket adjust — SL ${nextSl}${
            nextTp != null ? ` / TP ${nextTp}` : ''
          }. ${oandaError}`,
        })
      } catch {
        /* non-fatal */
      }
      return NextResponse.json(
        {
          ok: false,
          partial: true,
          error: oandaError,
          position_id: position.id,
          stop_loss_price: nextSl,
          profit_target_price: nextTp,
        },
        { status: 502 }
      )
    }

    try {
      await supabase.from('management_decisions').insert({
        user_id: user.id,
        position_id: position.id,
        instrument,
        trade_date: position.trade_date,
        decision_type: 'ADJUST',
        notes: `Trader adjusted brackets — SL ${nextSl}${
          nextTp != null ? ` / TP ${nextTp}` : ''
        }`,
      })
    } catch {
      /* non-fatal audit */
    }

    logger.info('update-brackets.ok', {
      positionId: position.id,
      stopLoss: nextSl,
      takeProfit: nextTp,
      oanda: useOanda,
    })

    return NextResponse.json({
      ok: true,
      position_id: position.id,
      stop_loss_price: nextSl,
      profit_target_price: nextTp,
    })
  } catch (err) {
    logger.error('update-brackets.failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
