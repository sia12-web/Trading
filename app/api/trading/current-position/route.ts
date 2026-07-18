/**
 * GET /api/trading/current-position
 * Get current open position for the locked instrument
 * Returns today's open position or null if no position
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getWindowManager } from '@/lib/trading/windowManager'
import { getESTDateString } from '@/lib/utils/timeUtils'
import type { CurrentPositionResponse, TradePosition } from '@/types/trading'

export async function GET(request: Request): Promise<NextResponse<CurrentPositionResponse>> {
  try {
    const { searchParams } = new URL(request.url)
    const instrument = searchParams.get('instrument') as 'DOW' | 'NASDAQ' | 'NIKKEI' | null
    const anyNy = searchParams.get('any') === '1'

    if (!anyNy && (!instrument || !['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument))) {
      logger.error('GET /api/trading/current-position: Invalid or missing instrument', { instrument })
      return NextResponse.json(
        {
          position: null,
          locked_instrument: null,
          entry_window_active: null,
          next_entry_window: null,
          market_disabled: false,
          message: 'Invalid instrument parameter',
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
          position: null,
          locked_instrument: instrument,
          entry_window_active: null,
          next_entry_window: null,
          market_disabled: false,
          message: 'Unauthorized',
        },
        { status: 401 }
      )
    }

    const windowManager = getWindowManager()
    const now = new Date()
    const today = getESTDateString()

    // Query for today's open position (ET date) for this user only
    let query = supabase
      .from('trades_journal')
      .select(
        `id, instrument, trade_date, entry_window, entry_timestamp, entry_price,
         entry_direction, stop_loss_price, stop_loss_hit_at, stop_loss_hit_count,
         position_size, risk_amount, account_size, exit_timestamp, exit_price,
         exit_reason, profit_loss, profit_loss_percent, regime, regime_confidence,
         best_level_break_confidence, best_break_level, profit_target_price,
         created_at, updated_at`
      )
      .eq('user_id', user.id)
      .eq('trade_date', today)
      .eq('fill_status', 'filled')
      .is('exit_timestamp', null)

    if (anyNy || !instrument) {
      query = query.in('instrument', ['DOW', 'NASDAQ'])
    } else {
      query = query.eq('instrument', instrument)
    }

    const { data: position, error: queryError } = await query.maybeSingle()

    if (queryError) {
      logger.error('GET /api/trading/current-position: Query error', { error: queryError })
      return NextResponse.json(
        {
          position: null,
          locked_instrument: instrument,
          entry_window_active: windowManager.getCurrentWindow(now),
          next_entry_window: windowManager.getNextWindow(now),
          market_disabled: false,
          message: 'Database error',
        },
        { status: 500 }
      )
    }

    const currentWindow = windowManager.getCurrentWindow(now)
    const nextWindow = windowManager.getNextWindow(now)
    const entryWindowsClosed = windowManager.areEntryWindowsClosed(now)

    // Check if market is disabled (2 stop loss hits = market disabled)
    let marketDisabled = false
    if (position && position.stop_loss_hit_count >= 3) {
      marketDisabled = true
      logger.log('GET /api/trading/current-position: Market disabled (2 stops)', {
        instrument,
        stops: position.stop_loss_hit_count,
      })
    }

    logger.debug('GET /api/trading/current-position: Position retrieved', {
      instrument,
      has_position: !!position,
      current_window: currentWindow,
      market_disabled: marketDisabled,
    })

    const locked =
      (position?.instrument as 'DOW' | 'NASDAQ' | 'NIKKEI' | undefined) ?? instrument ?? null

    return NextResponse.json(
      {
        position: position as TradePosition | null,
        locked_instrument: locked,
        entry_window_active: currentWindow,
        next_entry_window: nextWindow,
        market_disabled: marketDisabled,
        message: position
          ? `Position open at $${position.entry_price} (Stop: $${position.stop_loss_price})`
          : entryWindowsClosed
            ? 'Entry windows closed for today'
            : 'No open position',
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('GET /api/trading/current-position: Unexpected error', { error })
    return NextResponse.json(
      {
        position: null,
        locked_instrument: null,
        entry_window_active: null,
        next_entry_window: null,
        market_disabled: false,
        message: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
