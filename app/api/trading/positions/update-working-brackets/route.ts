/**
 * POST /api/trading/positions/update-working-brackets
 * Trader-driven TP change on an unfilled working limit.
 * Stop loss is locked at place time (sets progressive risk sizing).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'
import { validateWorkingBracketUpdate } from '@/lib/trading/workingBracketUpdate'

interface Body {
  working_id?: string
  instrument?: string
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
    if (!body.working_id && !body.instrument) {
      return NextResponse.json(
        { error: 'working_id or instrument required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    let query = supabase
      .from('trades_journal')
      .select(
        'id, instrument, entry_price, entry_direction, stop_loss_price, profit_target_price, fill_status, exit_timestamp'
      )
      .eq('user_id', user.id)
      .eq('fill_status', 'working')
      .is('exit_timestamp', null)

    if (body.working_id) {
      query = query.eq('id', body.working_id)
    } else {
      query = query.eq('instrument', body.instrument!)
    }

    const { data: row, error } = await query.maybeSingle()

    if (error) {
      logger.error('update-working-brackets.fetch_failed', { err: error })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!row) {
      return NextResponse.json({ error: 'Working limit not found' }, { status: 404 })
    }

    const validated = validateWorkingBracketUpdate({
      entryPrice: Number(row.entry_price),
      direction: row.entry_direction as 'LONG' | 'SHORT',
      stopLossPrice:
        body.stop_loss_price !== undefined && body.stop_loss_price !== null
          ? Number(body.stop_loss_price)
          : undefined,
      profitTargetPrice:
        body.profit_target_price !== undefined && body.profit_target_price !== null
          ? Number(body.profit_target_price)
          : undefined,
      currentStopLoss: Number(row.stop_loss_price),
      currentProfitTarget:
        row.profit_target_price != null ? Number(row.profit_target_price) : null,
    })

    if (!validated.ok) {
      const status = validated.slLocked ? 403 : 400
      return NextResponse.json({ error: validated.error, sl_locked: !!validated.slLocked }, { status })
    }

    const { error: updateError } = await supabase
      .from('trades_journal')
      .update({ profit_target_price: validated.profitTargetPrice })
      .eq('id', row.id)
      .eq('user_id', user.id)
      .eq('fill_status', 'working')

    if (updateError) {
      logger.error('update-working-brackets.db_failed', {
        err: updateError,
        workingId: row.id,
      })
      return NextResponse.json({ error: 'Failed to save take profit' }, { status: 500 })
    }

    logger.info('update-working-brackets.ok', {
      workingId: row.id,
      stopLoss: validated.stopLossPrice,
      takeProfit: validated.profitTargetPrice,
    })

    return NextResponse.json({
      ok: true,
      working_id: row.id,
      stop_loss_price: validated.stopLossPrice,
      profit_target_price: validated.profitTargetPrice,
      sl_locked: true,
    })
  } catch (err) {
    logger.error('update-working-brackets.failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
