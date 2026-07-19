import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import type { StopLossHitRequest, StopLossHitResponse } from '@/types/trading'

const createErrorResponse = (
  position_id: string,
  message: string,
  stop_loss_hit_count = 0,
  market_disabled = false
): StopLossHitResponse => ({
  success: false,
  position_id,
  exit_price: 0,
  profit_loss: 0,
  profit_loss_percent: 0,
  stop_loss_hit_count,
  market_disabled,
  message,
})

const createSuccessResponse = (
  position_id: string,
  exit_price: number,
  profit_loss: number,
  profit_loss_percent: number,
  stop_loss_hit_count: number,
  market_disabled: boolean
): StopLossHitResponse => ({
  success: true,
  position_id,
  exit_price,
  profit_loss,
  profit_loss_percent,
  stop_loss_hit_count,
  market_disabled,
  message: `Position closed. P&L: ${profit_loss > 0 ? '+' : ''}$${profit_loss}${market_disabled ? ' • Market disabled' : ''}`,
})

export async function POST(request: Request): Promise<NextResponse<StopLossHitResponse>> {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json(createErrorResponse('', 'No user found'), { status: 401 })
    }

    const body: StopLossHitRequest = await request.json()
    const { position_id, current_price, hit_timestamp } = body

    if (!position_id || current_price === undefined || !hit_timestamp) {
      return NextResponse.json(createErrorResponse(position_id || '', 'Missing required fields'), { status: 400 })
    }

    const supabase = await createClient()
    const { data: position, error: positionError } = await supabase
      .from('trades_journal')
      .select('id, user_id, instrument, entry_price, entry_direction, position_size, risk_amount, stop_loss_hit_count, exit_timestamp')
      .eq('id', position_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (positionError || !position) {
      return NextResponse.json(createErrorResponse(position_id, 'Position not found'), { status: 404 })
    }

    if (position.exit_timestamp !== null) {
      return NextResponse.json(
        createErrorResponse(position_id, 'Position already closed', position.stop_loss_hit_count),
        { status: 400 }
      )
    }

    let profitLoss: number
    if (position.entry_direction === 'LONG') {
      profitLoss = (current_price - position.entry_price) * position.position_size
    } else {
      profitLoss = (position.entry_price - current_price) * position.position_size
    }
    profitLoss = Math.round(profitLoss * 100) / 100

    const profitLossPercent = (profitLoss / position.risk_amount) * 100
    const profitLossPercentRounded = Math.round(profitLossPercent * 100) / 100
    const newStopLossHitCount = position.stop_loss_hit_count + 1
    // Desk closes on stop; session lock uses day's stop count (max 2) via session-gate.
    const shouldClose = newStopLossHitCount >= 1
    const marketDisabled = newStopLossHitCount >= 2

    if (shouldClose) {
      const { error: updateError } = await supabase
        .from('trades_journal')
        .update({
          exit_timestamp: hit_timestamp,
          exit_price: current_price,
          exit_reason: 'stop_hit',
          profit_loss: profitLoss,
          profit_loss_percent: profitLossPercentRounded,
          stop_loss_hit_count: newStopLossHitCount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', position_id)

      if (updateError) {
        logger.error('POST /api/trading/positions/stop-loss-hit: Update error', { error: updateError })
        return NextResponse.json(
          createErrorResponse(position_id, 'Failed to close position', newStopLossHitCount),
          { status: 500 }
        )
      }

      if (marketDisabled) {
        const todayStr = new Date().toISOString().split('T')[0]
        await supabase
          .from('regime_cache')
          .update({ market_disabled: true, disabled_at: new Date().toISOString() })
          .eq('instrument', position.instrument)
          .eq('date', todayStr)
      }

      return NextResponse.json(
        createSuccessResponse(
          position_id,
          current_price,
          profitLoss,
          profitLossPercentRounded,
          newStopLossHitCount,
          marketDisabled
        ),
        { status: 201 }
      )
    }

    // Hits 1–2: increment only, keep position open
    const { error: bumpError } = await supabase
      .from('trades_journal')
      .update({
        stop_loss_hit_count: newStopLossHitCount,
        stop_loss_hit_at: hit_timestamp,
        updated_at: new Date().toISOString(),
      })
      .eq('id', position_id)

    if (bumpError) {
      return NextResponse.json(
        createErrorResponse(position_id, 'Failed to update stop hit count', newStopLossHitCount),
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        position_id,
        exit_price: 0,
        profit_loss: 0,
        profit_loss_percent: 0,
        stop_loss_hit_count: newStopLossHitCount,
        market_disabled: false,
        message: `Stop hit #${newStopLossHitCount}/3 — position still open`,
      } satisfies StopLossHitResponse,
      { status: 200 }
    )
  } catch (error) {
    logger.error('POST /api/trading/positions/stop-loss-hit: Error', { error })
    return NextResponse.json(createErrorResponse('', 'Internal server error'), { status: 500 })
  }
}
