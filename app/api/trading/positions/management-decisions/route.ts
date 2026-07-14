/**
 * POST /api/trading/positions/management-decisions
 * Record a management decision (HOLD, TAKE_PROFIT, ADJUST) for an open position
 * Validates user owns the position and decision type is valid
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import type { ManagementDecisionResponse } from '@/types/trading'

const VALID_DECISION_TYPES = ['HOLD', 'TAKE_PROFIT', 'ADJUST'] as const

export async function POST(request: Request): Promise<NextResponse<ManagementDecisionResponse>> {
  try {
    // CRITICAL: Validate auth before proceeding
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      logger.error('POST /api/trading/positions/management-decisions: Unauthorized', {
        error: authError,
      })
      return NextResponse.json(
        {
          success: false,
          decision: null as any,
          message: 'Unauthorized',
        },
        { status: 401 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { position_id, decision_type, notes } = body

    // Validate required fields
    if (!position_id || !decision_type) {
      logger.error('POST /api/trading/positions/management-decisions: Missing required fields', {
        user_id: user.id,
        position_id,
        decision_type,
      })
      return NextResponse.json(
        {
          success: false,
          decision: null as any,
          message: 'Missing required fields: position_id, decision_type',
        },
        { status: 400 }
      )
    }

    // Validate decision_type
    if (!VALID_DECISION_TYPES.includes(decision_type)) {
      logger.error('POST /api/trading/positions/management-decisions: Invalid decision_type', {
        user_id: user.id,
        decision_type,
      })
      return NextResponse.json(
        {
          success: false,
          decision: null as any,
          message: `Invalid decision_type. Must be one of: ${VALID_DECISION_TYPES.join(', ')}`,
        },
        { status: 400 }
      )
    }

    // Validate notes length if provided
    if (notes && typeof notes === 'string' && notes.length > 500) {
      logger.error('POST /api/trading/positions/management-decisions: Notes too long', {
        user_id: user.id,
        notes_length: notes.length,
      })
      return NextResponse.json(
        {
          success: false,
          decision: null as any,
          message: 'Notes must be 500 characters or less',
        },
        { status: 400 }
      )
    }

    // Verify position exists and belongs to user
    const { data: position, error: positionError } = await supabase
      .from('trades_journal')
      .select('id, user_id, instrument, trade_date, exit_timestamp')
      .eq('id', position_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (positionError) {
      logger.error('POST /api/trading/positions/management-decisions: Database error querying position', {
        error: positionError,
      })
      return NextResponse.json(
        {
          success: false,
          decision: null as any,
          message: 'Database error',
        },
        { status: 500 }
      )
    }

    if (!position) {
      logger.error('POST /api/trading/positions/management-decisions: Position not found or not owned by user', {
        user_id: user.id,
        position_id,
      })
      return NextResponse.json(
        {
          success: false,
          decision: null as any,
          message: 'Position not found or does not belong to you',
        },
        { status: 404 }
      )
    }

    // Verify position is still open (exit_timestamp is null)
    if (position.exit_timestamp !== null) {
      logger.error('POST /api/trading/positions/management-decisions: Position already closed', {
        user_id: user.id,
        position_id,
        exit_timestamp: position.exit_timestamp,
      })
      return NextResponse.json(
        {
          success: false,
          decision: null as any,
          message: 'Cannot record decision for closed position',
        },
        { status: 400 }
      )
    }

    // Insert decision record
    const { data: decision, error: insertError } = await supabase
      .from('management_decisions')
      .insert({
        user_id: user.id,
        position_id: position_id,
        instrument: position.instrument,
        trade_date: position.trade_date,
        decision_type: decision_type,
        notes: notes || null,
      })
      .select()
      .single()

    if (insertError) {
      logger.error('POST /api/trading/positions/management-decisions: Database insert error', {
        error: insertError,
      })
      return NextResponse.json(
        {
          success: false,
          decision: null as any,
          message: 'Failed to record decision',
        },
        { status: 500 }
      )
    }

    logger.log('POST /api/trading/positions/management-decisions: Decision recorded', {
      decision_id: decision.id,
      user_id: user.id,
      position_id: position_id,
      decision_type: decision_type,
    })

    return NextResponse.json(
      {
        success: true,
        decision: decision,
        message: `Decision recorded: ${decision_type}`,
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('POST /api/trading/positions/management-decisions: Unexpected error', { error })
    return NextResponse.json(
      {
        success: false,
        decision: null as any,
        message: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
