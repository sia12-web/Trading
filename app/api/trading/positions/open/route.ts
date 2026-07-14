/**
 * POST /api/trading/positions/open
 * Open a new trading position within entry window
 * Triggered automatically when deep entry detected
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getWindowManager } from '@/lib/trading/windowManager'
import { getPositionSizer } from '@/lib/trading/positionSizing'
import { getESTDateString } from '@/lib/utils/timeUtils'
import type { PositionOpenResponse, TradePosition } from '@/types/trading'

interface OpenPositionRequest {
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  entry_price: number
  entry_direction: 'LONG' | 'SHORT'
  entry_window: 1 | 2 | 3
  account_size: number
  regime: 'bullish' | 'bearish' | 'choppy'
  regime_confidence: number
  best_level_break_confidence?: number | null
  best_break_level?: number | null
}

export async function POST(request: Request): Promise<NextResponse<PositionOpenResponse>> {
  try {
    const body = (await request.json()) as OpenPositionRequest

    // CRITICAL FIX: Validate auth before proceeding
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      logger.error('POST /api/trading/positions/open: Unauthorized', { error: authError })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument || 'DOW',
          entry_price: body.entry_price || 0,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction || 'LONG',
          entry_window: body.entry_window || 1,
          message: 'Unauthorized',
        },
        { status: 401 }
      )
    }

    // Validate required fields
    if (!body.instrument || !body.entry_price || !body.entry_direction || !body.entry_window) {
      logger.error('POST /api/trading/positions/open: Missing required fields', { body })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Missing required fields',
        },
        { status: 400 }
      )
    }

    // Validate entry price
    if (body.entry_price <= 0) {
      logger.error('POST /api/trading/positions/open: Invalid entry price', {
        price: body.entry_price,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Invalid entry price',
        },
        { status: 400 }
      )
    }

    // Validate account size
    if (body.account_size <= 0) {
      logger.error('POST /api/trading/positions/open: Invalid account size', {
        size: body.account_size,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Invalid account size',
        },
        { status: 400 }
      )
    }

    // IMPORTANT FIX: Verify account size is reasonable (prevent accidental large trades)
    // Minimum account size $5,000, maximum $1,000,000
    const MINIMUM_ACCOUNT_SIZE = 5000
    const MAXIMUM_ACCOUNT_SIZE = 1000000
    if (body.account_size < MINIMUM_ACCOUNT_SIZE || body.account_size > MAXIMUM_ACCOUNT_SIZE) {
      logger.error('POST /api/trading/positions/open: Account size out of bounds', {
        size: body.account_size,
        min: MINIMUM_ACCOUNT_SIZE,
        max: MAXIMUM_ACCOUNT_SIZE,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: `Account size must be between $${MINIMUM_ACCOUNT_SIZE} and $${MAXIMUM_ACCOUNT_SIZE}`,
        },
        { status: 400 }
      )
    }

    const windowManager = getWindowManager()
    const positionSizer = getPositionSizer()

    // IMPORTANT FIX: Validate entry time is within window boundaries AND in EST timezone
    const now = new Date()
    if (!windowManager.validateEntryTiming(now, body.entry_window)) {
      logger.error('POST /api/trading/positions/open: Entry outside window boundaries', {
        time: now.toISOString(),
        window: body.entry_window,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Entry time outside window boundaries',
        },
        { status: 400 }
      )
    }

    // IMPORTANT FIX: Validate entry price is within 0.001% of window extreme (deep entry requirement)
    // Get window extremes from cache to verify deep entry condition
    const { data: cacheData } = await supabase
      .from('entry_discipline_cache')
      .select('highest_price_in_window, lowest_price_in_window')
      .eq('user_id', user.id)
      .eq('instrument', body.instrument)
      .eq('trade_date', getESTDateString())
      .maybeSingle()

    const ENTRY_TOLERANCE = 0.00001 // 0.001% tolerance
    const entryPriceIsDeep = (() => {
      if (!cacheData) return true // Cache not yet populated, allow entry on first trade

      if (body.entry_direction === 'LONG' && cacheData.highest_price_in_window) {
        // For LONG: price must be within 0.001% of highest
        return body.entry_price >= cacheData.highest_price_in_window * (1 - ENTRY_TOLERANCE)
      } else if (body.entry_direction === 'SHORT' && cacheData.lowest_price_in_window) {
        // For SHORT: price must be within 0.001% of lowest
        return body.entry_price <= cacheData.lowest_price_in_window * (1 + ENTRY_TOLERANCE)
      }
      return true
    })()

    if (!entryPriceIsDeep) {
      logger.error('POST /api/trading/positions/open: Entry price not deep enough (not within 0.001% of extreme)', {
        entry_price: body.entry_price,
        direction: body.entry_direction,
        highest: cacheData?.highest_price_in_window,
        lowest: cacheData?.lowest_price_in_window,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Entry price not deep enough - must be within 0.001% of window extreme',
        },
        { status: 400 }
      )
    }

    // Calculate position sizing
    const sizing = positionSizer.calculatePosition(body.entry_price, body.account_size, body.entry_direction)
    if (!sizing) {
      logger.error('POST /api/trading/positions/open: Position sizing failed', { body })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Position sizing calculation failed',
        },
        { status: 400 }
      )
    }

    // IMPORTANT FIX: Validate stop loss precision
    // Stop loss should be exactly ±5% from entry price
    const STOP_LOSS_PERCENT = 0.05
    const expectedStopLoss = body.entry_direction === 'LONG'
      ? body.entry_price * (1 - STOP_LOSS_PERCENT)
      : body.entry_price * (1 + STOP_LOSS_PERCENT)

    const stopLossPrecisionTolerance = body.entry_price * 0.001 // 0.1% tolerance for rounding
    const stopLossError = Math.abs(sizing.stop_loss_price - expectedStopLoss)

    if (stopLossError > stopLossPrecisionTolerance) {
      logger.error('POST /api/trading/positions/open: Stop loss precision error', {
        calculated: sizing.stop_loss_price,
        expected: expectedStopLoss,
        error: stopLossError,
        tolerance: stopLossPrecisionTolerance,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: sizing.stop_loss_price,
          position_size: sizing.position_size,
          risk_amount: sizing.risk_amount,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Stop loss calculation precision error - contact support',
        },
        { status: 500 }
      )
    }

    // Get today's date in YYYY-MM-DD format (EST)
    const today = getESTDateString()

    // Check for existing open position (only one per instrument per day)
    const { data: existingPosition, error: queryError } = await supabase
      .from('trades_journal')
      .select('id, entry_price, stop_loss_price, position_size, risk_amount')
      .eq('instrument', body.instrument)
      .eq('trade_date', today)
      .is('exit_timestamp', null)
      .maybeSingle()

    if (queryError) {
      logger.error('POST /api/trading/positions/open: Database query error', { error: queryError })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Database error',
        },
        { status: 500 }
      )
    }

    // If position exists, return it (idempotent)
    if (existingPosition) {
      logger.log('POST /api/trading/positions/open: Position already exists (idempotent)', {
        instrument: body.instrument,
        position_id: existingPosition.id,
      })
      return NextResponse.json(
        {
          success: true,
          position_id: existingPosition.id,
          instrument: body.instrument,
          entry_price: existingPosition.entry_price,
          stop_loss_price: existingPosition.stop_loss_price,
          position_size: existingPosition.position_size,
          risk_amount: existingPosition.risk_amount,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Position already open for this instrument today',
        },
        { status: 200 }
      )
    }

    // CRITICAL FIX: Always use authenticated user's ID, never trust request body
    // Insert new position into trades_journal
    const tradePosition: Omit<TradePosition, 'id' | 'created_at' | 'updated_at'> = {
      user_id: user.id, // Always use authenticated user
      instrument: body.instrument,
      trade_date: today,
      entry_window: body.entry_window,
      entry_timestamp: now.toISOString(),
      entry_price: body.entry_price,
      entry_direction: body.entry_direction,
      stop_loss_price: sizing.stop_loss_price,
      stop_loss_hit_at: null,
      stop_loss_hit_count: 0,
      position_size: sizing.position_size,
      risk_amount: sizing.risk_amount,
      account_size: body.account_size,
      exit_timestamp: null,
      exit_price: null,
      exit_reason: null,
      profit_loss: null,
      profit_loss_percent: null,
      regime: body.regime,
      regime_confidence: body.regime_confidence,
      best_level_break_confidence: body.best_level_break_confidence || null,
      best_break_level: body.best_break_level || null,
    }

    const { data: newPosition, error: insertError } = await supabase
      .from('trades_journal')
      .insert(tradePosition)
      .select('id')
      .single()

    if (insertError || !newPosition) {
      logger.error('POST /api/trading/positions/open: Insert failed', { error: insertError })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: sizing.stop_loss_price,
          position_size: sizing.position_size,
          risk_amount: sizing.risk_amount,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Failed to insert position',
        },
        { status: 500 }
      )
    }

    logger.log('POST /api/trading/positions/open: Position opened successfully', {
      position_id: newPosition.id,
      instrument: body.instrument,
      entry_price: body.entry_price,
      stop_loss_price: sizing.stop_loss_price,
      position_size: sizing.position_size,
    })

    return NextResponse.json(
      {
        success: true,
        position_id: newPosition.id,
        instrument: body.instrument,
        entry_price: body.entry_price,
        stop_loss_price: sizing.stop_loss_price,
        position_size: sizing.position_size,
        risk_amount: sizing.risk_amount,
        entry_direction: body.entry_direction,
        entry_window: body.entry_window,
        message: `Position opened at $${body.entry_price}. Stop Loss: $${sizing.stop_loss_price}`,
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('POST /api/trading/positions/open: Unexpected error', { error })
    return NextResponse.json(
      {
        success: false,
        position_id: '',
        instrument: 'DOW',
        entry_price: 0,
        stop_loss_price: 0,
        position_size: 0,
        risk_amount: 0,
        entry_direction: 'LONG',
        entry_window: 1,
        message: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
