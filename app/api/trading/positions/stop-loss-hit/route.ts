/**
 * POST /api/trading/positions/stop-loss-hit
 * Handle stop loss hits, increment counter, disable market if needed, close position
 * First 45 minutes: Allow 2 hits (2nd hit disables market + closes)
 * After 10:15 AM: Any hit closes position
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getStopLossMonitor } from '@/lib/trading/stopLossMonitor'
import { getESTDateString } from '@/lib/utils/timeUtils'
import type { StopLossHitRequest, StopLossHitResponse, TradePosition } from '@/types/trading'

export async function POST(request: Request): Promise<NextResponse<StopLossHitResponse>> {
  try {
    const body = (await request.json()) as StopLossHitRequest

    // Validate required fields
    if (!body.instrument || !body.position_id || body.current_price === undefined || !body.hit_timestamp) {
      logger.error('POST /api/trading/positions/stop-loss-hit: Missing required fields', { body })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id || '',
          instrument: body.instrument,
          stop_loss_hit_count: 0,
          position_closed: false,
          market_disabled: false,
          exit_price: null,
          message: 'Missing required fields',
        },
        { status: 400 }
      )
    }

    // Validate price
    if (body.current_price <= 0) {
      logger.error('POST /api/trading/positions/stop-loss-hit: Invalid price', {
        price: body.current_price,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id,
          instrument: body.instrument,
          stop_loss_hit_count: 0,
          position_closed: false,
          market_disabled: false,
          exit_price: null,
          message: 'Invalid price',
        },
        { status: 400 }
      )
    }

    // Validate instrument
    if (!['DOW', 'NASDAQ', 'NIKKEI'].includes(body.instrument)) {
      logger.error('POST /api/trading/positions/stop-loss-hit: Invalid instrument', {
        instrument: body.instrument,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id,
          instrument: body.instrument,
          stop_loss_hit_count: 0,
          position_closed: false,
          market_disabled: false,
          exit_price: null,
          message: 'Invalid instrument',
        },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const stopLossMonitor = getStopLossMonitor()

    // Get today's date (EST)
    const today = getESTDateString()

    // Query open position
    const { data: position, error: queryError } = await supabase
      .from('trades_journal')
      .select('*')
      .eq('instrument', body.instrument)
      .eq('trade_date', today)
      .is('exit_timestamp', null)
      .maybeSingle()

    if (queryError) {
      logger.error('POST /api/trading/positions/stop-loss-hit: Query error', { error: queryError })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id,
          instrument: body.instrument,
          stop_loss_hit_count: 0,
          position_closed: false,
          market_disabled: false,
          exit_price: null,
          message: 'Database error',
        },
        { status: 500 }
      )
    }

    if (!position) {
      logger.error('POST /api/trading/positions/stop-loss-hit: No open position found', {
        instrument: body.instrument,
        date: today,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: body.position_id,
          instrument: body.instrument,
          stop_loss_hit_count: 0,
          position_closed: false,
          market_disabled: false,
          exit_price: null,
          message: 'No open position found',
        },
        { status: 400 }
      )
    }

    // Idempotency check: If stop loss already recorded within last 5 seconds with same price, skip
    if (position.stop_loss_hit_at) {
      const lastHitTime = new Date(position.stop_loss_hit_at).getTime()
      const currentTime = new Date(body.hit_timestamp).getTime()
      const timeDiffMs = Math.abs(currentTime - lastHitTime)
      const priceDiff = Math.abs(body.current_price - position.stop_loss_price) / position.stop_loss_price

      // If within 5 seconds and price difference < 0.1%, treat as duplicate
      if (timeDiffMs < 5000 && priceDiff < 0.001) {
        logger.log('POST /api/trading/positions/stop-loss-hit: Duplicate stop loss hit (idempotent), returning existing state', {
          position_id: position.id,
          timeDiffMs,
          priceDiff,
        })

        // CRITICAL FIX: Check if market is actually disabled instead of hardcoding false
        const { data: regimeData } = await supabase
          .from('regime_cache')
          .select('market_disabled')
          .eq('instrument', body.instrument)
          .eq('date', today)
          .maybeSingle()

        const marketDisabled = regimeData?.market_disabled ?? false

        // Return success with current state (no change made)
        return NextResponse.json(
          {
            success: true,
            position_id: position.id,
            instrument: body.instrument,
            stop_loss_hit_count: position.stop_loss_hit_count,
            position_closed: !!position.exit_timestamp,
            market_disabled: marketDisabled,
            exit_price: position.exit_price,
            message: '(idempotent) Stop loss already processed',
          },
          { status: 200 }
        )
      }
    }

    // Check if price actually hits stop loss
    const action = stopLossMonitor.determineAction(
      position as TradePosition,
      body.current_price
    )

    if (!action) {
      // Price did not touch stop loss
      logger.debug('POST /api/trading/positions/stop-loss-hit: Price did not touch stop loss', {
        current_price: body.current_price,
        stop_loss_price: position.stop_loss_price,
        direction: position.entry_direction,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: position.id,
          instrument: body.instrument,
          stop_loss_hit_count: position.stop_loss_hit_count,
          position_closed: false,
          market_disabled: false,
          exit_price: null,
          message: 'Price did not touch stop loss level',
        },
        { status: 200 }
      )
    }

    // Update position with incremented counter
    const newHitCount = position.stop_loss_hit_count + 1
    const hitTimestamp = body.hit_timestamp

    // Prepare update data
    const updateData: Record<string, unknown> = {
      stop_loss_hit_count: newHitCount,
      stop_loss_hit_at: hitTimestamp,
      updated_at: new Date().toISOString(),
    }

    // If position should close, set exit details
    if (action.close_position) {
      updateData.exit_timestamp = hitTimestamp
      updateData.exit_price = body.current_price
      updateData.exit_reason = 'stop_hit'

      // Calculate P&L
      const pnl = stopLossMonitor.calculateStopLossPnL(
        position.entry_price,
        body.current_price,
        position.position_size,
        position.entry_direction
      )
      updateData.profit_loss = pnl.profit_loss
      updateData.profit_loss_percent = pnl.profit_loss_percent
    }

    // Update trades_journal
    const { error: updateError } = await supabase
      .from('trades_journal')
      .update(updateData)
      .eq('id', position.id)

    if (updateError) {
      logger.error('POST /api/trading/positions/stop-loss-hit: Update failed', { error: updateError })
      return NextResponse.json(
        {
          success: false,
          position_id: position.id,
          instrument: body.instrument,
          stop_loss_hit_count: position.stop_loss_hit_count,
          position_closed: false,
          market_disabled: false,
          exit_price: null,
          message: 'Failed to update position',
        },
        { status: 500 }
      )
    }

    // If market should be disabled, update regime_cache
    if (action.disable_market) {
      const { error: marketError } = await supabase
        .from('regime_cache')
        .update({
          market_disabled: true,
          updated_at: new Date().toISOString(),
        })
        .eq('instrument', body.instrument)
        .eq('date', today)

      if (marketError) {
        logger.error('POST /api/trading/positions/stop-loss-hit: Failed to disable market', {
          error: marketError,
        })
        // Continue - market flag is secondary to position update
      }

      logger.log('POST /api/trading/positions/stop-loss-hit: Market disabled', {
        instrument: body.instrument,
        date: today,
      })
    }

    logger.log('POST /api/trading/positions/stop-loss-hit: Stop loss processed', {
      position_id: position.id,
      instrument: body.instrument,
      hit_number: newHitCount,
      position_closed: action.close_position,
      market_disabled: action.disable_market,
    })

    return NextResponse.json(
      {
        success: true,
        position_id: position.id,
        instrument: body.instrument,
        stop_loss_hit_count: newHitCount,
        position_closed: action.close_position,
        market_disabled: action.disable_market,
        exit_price: action.close_position ? body.current_price : null,
        message: action.close_position
          ? action.disable_market
            ? `🛑 STOP LOSS HIT #${newHitCount}. Position closed at $${body.current_price}. Market DISABLED for ${body.instrument}.`
            : `🛑 STOP LOSS HIT. Position closed at $${body.current_price}.`
          : `⚠️ STOP LOSS HIT #${newHitCount}. Position still open. Be ready for final hit.`,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('POST /api/trading/positions/stop-loss-hit: Unexpected error', { error })
    return NextResponse.json(
      {
        success: false,
        position_id: '',
        instrument: 'DOW',
        stop_loss_hit_count: 0,
        position_closed: false,
        market_disabled: false,
        exit_price: null,
        message: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
