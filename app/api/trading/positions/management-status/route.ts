/**
 * GET /api/trading/positions/management-status?instrument=DOW
 * Get current open position with all data needed for position display and real-time P&L calculation
 * P&L is calculated on frontend from Realtime prices (<100ms latency)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getESTDateString } from '@/lib/utils/timeUtils'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import type { PositionStatusResponse, PositionStatus } from '@/types/positionManagement'
import type { Instrument } from '@/types/trading'

const LUNCH_CLOSE_TIME = '11:30:00'

function calculateProfitTarget(
  entryPrice: number,
  entryDirection: 'LONG' | 'SHORT',
  regimeConfidence: number
): number {
  let targetPercent: number

  if (regimeConfidence >= 75) {
    targetPercent = 0.015 // 1.5% for high confidence
  } else if (regimeConfidence >= 50) {
    targetPercent = 0.010 // 1.0% for medium confidence
  } else {
    targetPercent = 0.005 // 0.5% for lower confidence
  }

  if (entryDirection === 'LONG') {
    return entryPrice * (1 + targetPercent)
  } else {
    return entryPrice * (1 - targetPercent)
  }
}

export async function GET(request: Request): Promise<NextResponse<PositionStatusResponse>> {
  try {
    // Development: Use dev user instead of auth
    const user = await getOrCreateUser()

    if (!user) {
      logger.error('GET /api/trading/positions/management-status: No user found', {})
      return NextResponse.json(
        {
          success: false,
          position: null,
          current_time: new Date().toISOString(),
          lunch_close_time: LUNCH_CLOSE_TIME,
          message: 'Unauthorized',
        },
        { status: 401 }
      )
    }

    const supabase = await createClient()

    // Parse query params
    const url = new URL(request.url)
    const instrumentParam = url.searchParams.get('instrument')

    if (!instrumentParam) {
      logger.error('GET /api/trading/positions/management-status: Missing instrument param')
      return NextResponse.json(
        {
          success: false,
          position: null,
          current_time: new Date().toISOString(),
          lunch_close_time: LUNCH_CLOSE_TIME,
          message: 'instrument query parameter required',
        },
        { status: 400 }
      )
    }

    // Validate instrument
    const validInstruments: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']
    if (!validInstruments.includes(instrumentParam as Instrument)) {
      logger.error('GET /api/trading/positions/management-status: Invalid instrument', {
        instrument: instrumentParam,
      })
      return NextResponse.json(
        {
          success: false,
          position: null,
          current_time: new Date().toISOString(),
          lunch_close_time: LUNCH_CLOSE_TIME,
          message: 'Invalid instrument',
        },
        { status: 400 }
      )
    }

    const instrument = instrumentParam as Instrument
    const today = getESTDateString()

    // Query open position for this user, instrument, and today
    const { data: positionData, error: queryError } = await supabase
      .from('trades_journal')
      .select(
        `
        id,
        user_id,
        instrument,
        trade_date,
        entry_window,
        entry_timestamp,
        entry_price,
        entry_direction,
        position_size,
        account_size,
        risk_amount,
        stop_loss_price,
        stop_loss_distance,
        stop_loss_percent,
        regime,
        regime_confidence,
        stop_loss_hit_count
      `
      )
      .eq('user_id', user.id)
      .eq('instrument', instrument)
      .eq('trade_date', today)
      .is('exit_timestamp', null) // Only open positions
      .maybeSingle()

    // #region agent log
    fetch('http://127.0.0.1:7854/ingest/12861b9b-f890-41df-9c4f-bff921b2361a',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'624454'},body:JSON.stringify({sessionId:'624454',runId:'post-fix',hypothesisId:'A',location:'management-status/route.ts:query',message:'trades_journal query result',data:{hasError:!!queryError,errorCode:queryError?.code??null,errorMessage:queryError?.message??null,hasPosition:!!positionData,supabaseHost:(process.env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/^https?:\/\//,'').split('/')[0],userIdPrefix:user.id?.slice(0,8),instrument,today},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (queryError) {
      logger.error('GET /api/trading/positions/management-status: Database query error', {
        error: queryError,
      })
      return NextResponse.json(
        {
          success: false,
          position: null,
          current_time: new Date().toISOString(),
          lunch_close_time: LUNCH_CLOSE_TIME,
          message: 'Database error',
        },
        { status: 500 }
      )
    }

    // No position found - return null position (not an error)
    if (!positionData) {
      logger.log('GET /api/trading/positions/management-status: No open position', {
        user_id: user.id,
        instrument,
        date: today,
      })
      return NextResponse.json(
        {
          success: true,
          position: null,
          current_time: new Date().toISOString(),
          lunch_close_time: LUNCH_CLOSE_TIME,
          message: `No open position for ${instrument} today`,
        },
        { status: 200 }
      )
    }

    // Build position status with calculated fields
    const profitTarget = calculateProfitTarget(
      positionData.entry_price,
      positionData.entry_direction,
      positionData.regime_confidence
    )

    const positionStatus: PositionStatus = {
      id: positionData.id,
      user_id: positionData.user_id,
      instrument: positionData.instrument,
      trade_date: positionData.trade_date,
      entry_price: positionData.entry_price,
      entry_direction: positionData.entry_direction,
      entry_timestamp: positionData.entry_timestamp,
      entry_window: positionData.entry_window,
      position_size: positionData.position_size,
      account_size: positionData.account_size,
      risk_amount: positionData.risk_amount,
      stop_loss_price: positionData.stop_loss_price,
      stop_loss_distance: positionData.stop_loss_distance,
      stop_loss_percent: positionData.stop_loss_percent,
      regime: positionData.regime,
      regime_confidence: positionData.regime_confidence,
      profit_target_price: profitTarget,
      stop_loss_hit_count: positionData.stop_loss_hit_count,
    }

    logger.log('GET /api/trading/positions/management-status: Position fetched', {
      position_id: positionStatus.id,
      instrument,
      entry_price: positionStatus.entry_price,
    })

    return NextResponse.json(
      {
        success: true,
        position: positionStatus,
        current_time: new Date().toISOString(),
        lunch_close_time: LUNCH_CLOSE_TIME,
        message: `Position open for ${instrument}`,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('GET /api/trading/positions/management-status: Unexpected error', { error })
    return NextResponse.json(
      {
        success: false,
        position: null,
        current_time: new Date().toISOString(),
        lunch_close_time: LUNCH_CLOSE_TIME,
        message: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
