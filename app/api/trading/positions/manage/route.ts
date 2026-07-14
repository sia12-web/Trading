/**
 * POST /api/trading/positions/manage
 * Record position management decision (HOLD/TAKE_PROFIT/ADJUST/MONITOR)
 * Creates audit trail in management_decisions table
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getPositionManager } from '@/lib/trading/positionManager'
import { getESTDateString } from '@/lib/utils/timeUtils'
import type { ManagePositionRequest, ManagePositionResponse, TradePosition } from '@/types/trading'

export async function POST(request: Request): Promise<NextResponse<ManagePositionResponse>> {
  try {
    const body = (await request.json()) as ManagePositionRequest

    // Validate required fields
    if (
      !body.position_id ||
      !body.instrument ||
      body.current_price === undefined ||
      !body.decision ||
      !body.reason ||
      body.confidence === undefined
    ) {
      logger.error('POST /api/trading/positions/manage: Missing required fields', { body })
      return NextResponse.json(
        {
          success: false,
          decision_id: '',
          position_id: body.position_id || '',
          decision: body.decision || 'HOLD',
          current_price: body.current_price || 0,
          current_p_l: 0,
          current_p_l_percent: 0,
          message: 'Missing required fields',
        },
        { status: 400 }
      )
    }

    // Validate decision type
    if (!['HOLD', 'TAKE_PROFIT', 'ADJUST', 'MONITOR'].includes(body.decision)) {
      logger.error('POST /api/trading/positions/manage: Invalid decision', {
        decision: body.decision,
      })
      return NextResponse.json(
        {
          success: false,
          decision_id: '',
          position_id: body.position_id,
          decision: body.decision,
          current_price: body.current_price,
          current_p_l: 0,
          current_p_l_percent: 0,
          message: 'Invalid decision type',
        },
        { status: 400 }
      )
    }

    // Validate price
    if (body.current_price <= 0) {
      logger.error('POST /api/trading/positions/manage: Invalid price', {
        price: body.current_price,
      })
      return NextResponse.json(
        {
          success: false,
          decision_id: '',
          position_id: body.position_id,
          decision: body.decision,
          current_price: body.current_price,
          current_p_l: 0,
          current_p_l_percent: 0,
          message: 'Invalid price',
        },
        { status: 400 }
      )
    }

    // Validate confidence
    if (body.confidence < 0 || body.confidence > 100) {
      logger.error('POST /api/trading/positions/manage: Invalid confidence', {
        confidence: body.confidence,
      })
      return NextResponse.json(
        {
          success: false,
          decision_id: '',
          position_id: body.position_id,
          decision: body.decision,
          current_price: body.current_price,
          current_p_l: 0,
          current_p_l_percent: 0,
          message: 'Confidence must be between 0 and 100',
        },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const positionManager = getPositionManager()

    // Get today's date (EST)
    const today = getESTDateString()

    // Query open position
    const { data: position, error: queryError } = await supabase
      .from('trades_journal')
      .select('*')
      .eq('id', body.position_id)
      .is('exit_timestamp', null)
      .maybeSingle()

    if (queryError) {
      logger.error('POST /api/trading/positions/manage: Query error', { error: queryError })
      return NextResponse.json(
        {
          success: false,
          decision_id: '',
          position_id: body.position_id,
          decision: body.decision,
          current_price: body.current_price,
          current_p_l: 0,
          current_p_l_percent: 0,
          message: 'Database error',
        },
        { status: 500 }
      )
    }

    if (!position) {
      logger.error('POST /api/trading/positions/manage: Position not found', {
        position_id: body.position_id,
      })
      return NextResponse.json(
        {
          success: false,
          decision_id: '',
          position_id: body.position_id,
          decision: body.decision,
          current_price: body.current_price,
          current_p_l: 0,
          current_p_l_percent: 0,
          message: 'Position not found or already closed',
        },
        { status: 404 }
      )
    }

    // Calculate current P&L
    const pnl = positionManager.calculateCurrentPnL(
      position as TradePosition,
      body.current_price
    )

    // Insert management decision into management_decisions table
    const { data: decision, error: insertError } = await supabase
      .from('management_decisions')
      .insert({
        position_id: body.position_id,
        instrument: body.instrument,
        trade_date: today,
        decision: body.decision,
        decision_price: body.current_price,
        decision_time: new Date().toISOString(),
        reason: body.reason,
        confidence_at_decision: body.confidence,
        current_p_l: pnl.profitLoss,
        current_p_l_percent: pnl.profitLossPercent,
      })
      .select('id')
      .single()

    if (insertError || !decision) {
      logger.error('POST /api/trading/positions/manage: Insert failed', { error: insertError })
      return NextResponse.json(
        {
          success: false,
          decision_id: '',
          position_id: body.position_id,
          decision: body.decision,
          current_price: body.current_price,
          current_p_l: pnl.profitLoss,
          current_p_l_percent: pnl.profitLossPercent,
          message: 'Failed to record management decision',
        },
        { status: 500 }
      )
    }

    logger.log('POST /api/trading/positions/manage: Decision recorded', {
      position_id: body.position_id,
      decision: body.decision,
      p_l_percent: pnl.profitLossPercent,
    })

    return NextResponse.json(
      {
        success: true,
        decision_id: decision.id,
        position_id: body.position_id,
        decision: body.decision,
        current_price: body.current_price,
        current_p_l: pnl.profitLoss,
        current_p_l_percent: pnl.profitLossPercent,
        message: `Position management decision recorded: ${body.decision}. Current P&L: ${pnl.profitLossPercent.toFixed(2)}%`,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('POST /api/trading/positions/manage: Unexpected error', { error })
    return NextResponse.json(
      {
        success: false,
        decision_id: '',
        position_id: '',
        decision: 'HOLD',
        current_price: 0,
        current_p_l: 0,
        current_p_l_percent: 0,
        message: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
