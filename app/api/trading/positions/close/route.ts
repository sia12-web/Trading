/**
 * POST /api/trading/positions/close
 * Close position immediately (lunch close, manual, or AI signal)
 * Calculate final P&L and record closure decision
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getPositionManager } from '@/lib/trading/positionManager'
import { getESTDateString } from '@/lib/utils/timeUtils'
import { shouldExecuteOandaOrders } from '@/lib/oanda/config'
import { closeOandaTrade } from '@/lib/oanda/orders'
import type { ClosePositionRequest, ClosePositionResponse, TradePosition } from '@/types/trading'

export async function POST(request: Request): Promise<NextResponse<ClosePositionResponse>> {
  try {
    const body = (await request.json()) as ClosePositionRequest

    // Validate required fields
    if (!body.position_id || !body.instrument || body.exit_price === undefined || !body.exit_reason) {
      logger.error('POST /api/trading/positions/close: Missing required fields', { body })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id || '',
          instrument: body.instrument,
          exit_price: body.exit_price || 0,
          entry_price: 0,
          position_size: 0,
          profit_loss: 0,
          profit_loss_percent: 0,
          exit_reason: body.exit_reason || 'manual',
          message: 'Missing required fields',
        },
        { status: 400 }
      )
    }

    // Validate exit reason
    if (
      !['stop_hit', 'manual', 'lunch_close', 'ai_signal', 'take_profit', 'limit_expired'].includes(
        body.exit_reason
      )
    ) {
      logger.error('POST /api/trading/positions/close: Invalid exit reason', {
        reason: body.exit_reason,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id,
          instrument: body.instrument,
          exit_price: body.exit_price,
          entry_price: 0,
          position_size: 0,
          profit_loss: 0,
          profit_loss_percent: 0,
          exit_reason: body.exit_reason,
          message: 'Invalid exit reason',
        },
        { status: 400 }
      )
    }

    // Validate price
    if (body.exit_price <= 0) {
      logger.error('POST /api/trading/positions/close: Invalid exit price', {
        price: body.exit_price,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id,
          instrument: body.instrument,
          exit_price: body.exit_price,
          entry_price: 0,
          position_size: 0,
          profit_loss: 0,
          profit_loss_percent: 0,
          exit_reason: body.exit_reason,
          message: 'Invalid exit price',
        },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { resolveDeskUser } = await import('@/lib/utils/devAuth')
    const user = await resolveDeskUser(request)
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id || '',
          instrument: body.instrument,
          exit_price: body.exit_price || 0,
          entry_price: 0,
          position_size: 0,
          profit_loss: 0,
          profit_loss_percent: 0,
          exit_reason: body.exit_reason || 'manual',
          message: 'Unauthorized',
        },
        { status: 401 }
      )
    }

    const positionManager = getPositionManager()

    // Get today's date (EST)
    const today = getESTDateString()
    const closeTime = new Date().toISOString()

    // Query open position owned by this desk user
    const { data: position, error: queryError } = await supabase
      .from('trades_journal')
      .select('*')
      .eq('id', body.position_id)
      .eq('user_id', user.id)
      .is('exit_timestamp', null)
      .maybeSingle()

    if (queryError) {
      logger.error('POST /api/trading/positions/close: Query error', { error: queryError })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id,
          instrument: body.instrument,
          exit_price: body.exit_price,
          entry_price: 0,
          position_size: 0,
          profit_loss: 0,
          profit_loss_percent: 0,
          exit_reason: body.exit_reason,
          message: 'Database error',
        },
        { status: 500 }
      )
    }

    if (!position) {
      logger.error('POST /api/trading/positions/close: Position not found or already closed', {
        position_id: body.position_id,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id,
          instrument: body.instrument,
          exit_price: body.exit_price,
          entry_price: 0,
          position_size: 0,
          profit_loss: 0,
          profit_loss_percent: 0,
          exit_reason: body.exit_reason,
          message: 'Position not found or already closed',
        },
        { status: 404 }
      )
    }

    // Calculate final P&L
    const pnl = positionManager.calculateCurrentPnL(
      position as TradePosition,
      body.exit_price
    )

    // Close on OANDA when this journal row has a broker trade id
    let brokerExitPrice: number | null = null
    if (shouldExecuteOandaOrders()) {
      const tradeId = (position as { oanda_trade_id?: string | null }).oanda_trade_id
      if (tradeId) {
        const broker = await closeOandaTrade(tradeId)
        if (!broker.ok) {
          logger.error('POST /api/trading/positions/close: OANDA close failed', {
            error: broker.error,
            tradeId,
            instrument: body.instrument,
          })
          return NextResponse.json(
            {
              success: false,
              position_id: body.position_id,
              instrument: body.instrument,
              exit_price: body.exit_price,
              entry_price: Number(position.entry_price),
              position_size: Number(position.position_size),
              profit_loss: 0,
              profit_loss_percent: 0,
              exit_reason: body.exit_reason,
              message: `OANDA close failed: ${broker.error}`,
            },
            { status: 502 }
          )
        }
        brokerExitPrice = broker.fillPrice
        logger.info('POST /api/trading/positions/close: OANDA closed', {
          tradeId: broker.tradeId,
          fillPrice: brokerExitPrice,
        })
      } else {
        logger.warn('POST /api/trading/positions/close: no oanda_trade_id — journal-only close', {
          position_id: body.position_id,
        })
      }
    }

    const exitPrice = brokerExitPrice && brokerExitPrice > 0 ? brokerExitPrice : body.exit_price
    const pnlFinal =
      brokerExitPrice && brokerExitPrice > 0
        ? positionManager.calculateCurrentPnL(position as TradePosition, exitPrice)
        : pnl

    // Update position with closure details
    const exitNotes =
      body.reason ||
      (body.exit_reason === 'stop_hit'
        ? `Stop loss hit at ${exitPrice}`
        : body.exit_reason === 'take_profit'
          ? `Take profit hit at ${exitPrice}`
          : body.exit_reason === 'ai_signal'
            ? `AI exit at ${exitPrice}`
            : `Closed via ${body.exit_reason} at ${exitPrice}`)

    const updatePayload: Record<string, unknown> = {
      exit_timestamp: closeTime,
      exit_price: exitPrice,
      exit_reason: body.exit_reason,
      exit_notes: exitNotes,
      profit_loss: pnlFinal.profitLoss,
      profit_loss_percent: pnlFinal.profitLossPercent,
      updated_at: closeTime,
    }
    if (body.exit_reason === 'stop_hit') {
      updatePayload.stop_loss_hit_at = closeTime
      updatePayload.stop_loss_hit_count = (position.stop_loss_hit_count || 0) + 1
    }

    let { error: updateError } = await supabase
      .from('trades_journal')
      .update(updatePayload)
      .eq('id', body.position_id)
      .eq('user_id', user.id)

    // Soft-fallback if take_profit / exit_notes columns not migrated yet
    if (updateError && /take_profit|exit_notes|exit_reason/i.test(updateError.message || '')) {
      const fallback = {
        exit_timestamp: closeTime,
        exit_price: exitPrice,
        exit_reason: body.exit_reason === 'take_profit' ? 'manual' : body.exit_reason,
        profit_loss: pnlFinal.profitLoss,
        profit_loss_percent: pnlFinal.profitLossPercent,
        updated_at: closeTime,
        ...(body.exit_reason === 'stop_hit'
          ? {
              stop_loss_hit_at: closeTime,
              stop_loss_hit_count: (position.stop_loss_hit_count || 0) + 1,
            }
          : {}),
      }
      const retry = await supabase
        .from('trades_journal')
        .update(fallback)
        .eq('id', body.position_id)
        .eq('user_id', user.id)
      updateError = retry.error
    }

    if (updateError) {
      logger.error('POST /api/trading/positions/close: Update failed', { error: updateError })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id,
          instrument: body.instrument,
          exit_price: exitPrice,
          entry_price: position.entry_price,
          position_size: position.position_size,
          profit_loss: pnlFinal.profitLoss,
          profit_loss_percent: pnlFinal.profitLossPercent,
          exit_reason: body.exit_reason,
          message: 'Failed to close position',
        },
        { status: 500 }
      )
    }

    // Record closure decision in management_decisions for audit trail
    const closureReason = body.reason || `Position closed via ${body.exit_reason}`
    const { error: decisionError } = await supabase.from('management_decisions').insert({
      position_id: body.position_id,
      instrument: body.instrument,
      trade_date: today,
      decision: 'TAKE_PROFIT',
      decision_price: exitPrice,
      decision_time: closeTime,
      reason: closureReason,
      confidence_at_decision: position.best_level_break_confidence || 0,
      current_p_l: pnlFinal.profitLoss,
      current_p_l_percent: pnlFinal.profitLossPercent,
    })

    if (decisionError) {
      logger.error('POST /api/trading/positions/close: Failed to record decision', {
        error: decisionError,
      })
      // Continue - position was closed, just decision not recorded
    }

    logger.log('POST /api/trading/positions/close: Position closed', {
      position_id: body.position_id,
      instrument: body.instrument,
      exit_price: exitPrice,
      exit_reason: body.exit_reason,
      p_l: pnlFinal.profitLoss,
      p_l_percent: pnlFinal.profitLossPercent,
      oanda_trade_id: (position as { oanda_trade_id?: string | null }).oanda_trade_id ?? null,
    })

    const messagePrefix =
      body.exit_reason === 'lunch_close'
        ? '🍽️ LUNCH CLOSE'
        : body.exit_reason === 'stop_hit'
          ? '🛑 STOP LOSS'
          : body.exit_reason === 'ai_signal'
            ? '🤖 AI SIGNAL'
            : '📍 POSITION CLOSED'

    return NextResponse.json(
      {
        success: true,
        position_id: body.position_id,
        instrument: body.instrument,
        exit_price: exitPrice,
        entry_price: position.entry_price,
        position_size: position.position_size,
        profit_loss: pnlFinal.profitLoss,
        profit_loss_percent: pnlFinal.profitLossPercent,
        exit_reason: body.exit_reason,
        message: `${messagePrefix}: Position closed at $${exitPrice}. P&L: ${pnlFinal.profitLoss >= 0 ? '+' : ''}$${pnlFinal.profitLoss.toFixed(2)} (${pnlFinal.profitLossPercent.toFixed(2)}%)`,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('POST /api/trading/positions/close: Unexpected error', { error })
    return NextResponse.json(
      {
        success: false,
        position_id: '',
        instrument: 'DOW',
        exit_price: 0,
        entry_price: 0,
        position_size: 0,
        profit_loss: 0,
        profit_loss_percent: 0,
        exit_reason: 'manual',
        message: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
