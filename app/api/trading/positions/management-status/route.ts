/**
 * GET /api/trading/positions/management-status?instrument=DOW
 * Get current position management status and decision history
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getPositionManager } from '@/lib/trading/positionManager'
import { getESTDateString } from '@/lib/utils/timeUtils'
import type { ManagementStatusResponse, TradePosition, ManagementDecisionRecord } from '@/types/trading'

export async function GET(request: Request): Promise<NextResponse<ManagementStatusResponse>> {
  try {
    const { searchParams } = new URL(request.url)
    const instrument = searchParams.get('instrument') as 'DOW' | 'NASDAQ' | 'NIKKEI' | null

    if (!instrument || !['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument)) {
      logger.error('GET /api/trading/positions/management-status: Invalid instrument', {
        instrument,
      })
      return NextResponse.json(
        {
          position: null,
          current_price: null,
          current_p_l: null,
          current_p_l_percent: null,
          profit_target_price: null,
          management_decisions: [],
          time_to_lunch_close_minutes: null,
          should_auto_close_soon: false,
          message: 'Invalid instrument',
        },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const positionManager = getPositionManager()

    // Get today's date (EST)
    const today = getESTDateString()

    // Query open position
    const { data: position, error: positionError } = await supabase
      .from('trades_journal')
      .select('*')
      .eq('instrument', instrument)
      .eq('trade_date', today)
      .is('exit_timestamp', null)
      .maybeSingle()

    if (positionError) {
      logger.error('GET /api/trading/positions/management-status: Position query error', {
        error: positionError,
      })
      return NextResponse.json(
        {
          position: null,
          current_price: null,
          current_p_l: null,
          current_p_l_percent: null,
          profit_target_price: null,
          management_decisions: [],
          time_to_lunch_close_minutes: null,
          should_auto_close_soon: false,
          message: 'Database error',
        },
        { status: 500 }
      )
    }

    let currentPrice: number | null = null
    let currentPnL: number | null = null
    let currentPnLPercent: number | null = null
    let profitTargetPrice: number | null = null
    let managementDecisions: ManagementDecisionRecord[] = []

    if (position) {
      // Query management decisions for this position
      const { data: decisions, error: decisionsError } = await supabase
        .from('management_decisions')
        .select('*')
        .eq('position_id', position.id)
        .order('created_at', { ascending: false })

      if (!decisionsError && decisions && decisions.length > 0) {
        managementDecisions = decisions as ManagementDecisionRecord[]
        // Get latest price from most recent decision
        const latestDecision = managementDecisions[0]
        if (latestDecision) {
          currentPrice = latestDecision.decision_price
          currentPnL = latestDecision.current_p_l
          currentPnLPercent = latestDecision.current_p_l_percent
        }
      }

      // Calculate profit target price if we have position and recent confidence
      if (position.best_level_break_confidence) {
        const rules = positionManager.getManagementRules(position.best_level_break_confidence)
        profitTargetPrice = positionManager.calculateProfitTargetPrice(
          position as TradePosition,
          rules
        )
      }
    }

    const now = new Date()
    const minutesToLunch = positionManager.getMinutesUntilLunchClose(now)
    const shouldAutoClose = positionManager.shouldAutoCloseSoon(now)

    let message = 'No open position'
    if (position) {
      if (shouldAutoClose) {
        message = `Position open - LUNCH CLOSE IN ${minutesToLunch} MINUTES`
      } else if (minutesToLunch !== null) {
        message = `Position open - ${minutesToLunch} minutes until lunch close`
      } else {
        message = 'Position open - Lunch close window has passed'
      }
    }

    logger.debug('GET /api/trading/positions/management-status: Status retrieved', {
      instrument,
      has_position: !!position,
      decisions_count: managementDecisions.length,
      time_to_lunch: minutesToLunch,
    })

    return NextResponse.json(
      {
        position: position as TradePosition | null,
        current_price: currentPrice,
        current_p_l: currentPnL,
        current_p_l_percent: currentPnLPercent,
        profit_target_price: profitTargetPrice,
        management_decisions: managementDecisions,
        time_to_lunch_close_minutes: minutesToLunch,
        should_auto_close_soon: shouldAutoClose,
        message,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('GET /api/trading/positions/management-status: Unexpected error', { error })
    return NextResponse.json(
      {
        position: null,
        current_price: null,
        current_p_l: null,
        current_p_l_percent: null,
        profit_target_price: null,
        management_decisions: [],
        time_to_lunch_close_minutes: null,
        should_auto_close_soon: false,
        message: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
