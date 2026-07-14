/**
 * GET /api/trading/market-status?instrument=DOW
 * Check if market is disabled for the day (prevents new entries after 2 stop losses)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import type { MarketStatusResponse } from '@/types/trading'

export async function GET(request: Request): Promise<NextResponse<MarketStatusResponse>> {
  try {
    const { searchParams } = new URL(request.url)
    const instrument = searchParams.get('instrument') as 'DOW' | 'NASDAQ' | 'NIKKEI' | null

    if (!instrument || !['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument)) {
      logger.error('GET /api/trading/market-status: Invalid or missing instrument', { instrument })
      return NextResponse.json(
        {
          instrument: 'DOW',
          market_disabled: false,
          disabled_reason: 'Invalid instrument',
          stop_loss_hit_count: null,
          disabled_at: null,
        },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Get today's date
    const today = new Date().toISOString().split('T')[0] || ''

    // Query regime_cache for market disabled status
    const { data: regimeData, error: regimeError } = await supabase
      .from('regime_cache')
      .select('market_disabled, updated_at')
      .eq('instrument', instrument)
      .eq('date', today)
      .maybeSingle()

    if (regimeError) {
      logger.error('GET /api/trading/market-status: Regime query error', { error: regimeError })
      return NextResponse.json(
        {
          instrument,
          market_disabled: false,
          disabled_reason: 'Database error',
          stop_loss_hit_count: null,
          disabled_at: null,
        },
        { status: 500 }
      )
    }

    const marketDisabled = regimeData?.market_disabled === true
    const disabledAt = marketDisabled ? regimeData.updated_at : null

    // Get open position to show hit count context
    let stopLossHitCount: number | null = null
    if (marketDisabled) {
      const { data: position, error: positionError } = await supabase
        .from('trades_journal')
        .select('stop_loss_hit_count')
        .eq('instrument', instrument)
        .eq('trade_date', today)
        .is('exit_timestamp', null)
        .maybeSingle()

      if (!positionError && position) {
        stopLossHitCount = position.stop_loss_hit_count
      }
    }

    const disabledReason = marketDisabled
      ? `Market disabled after ${stopLossHitCount || 2} stop loss hits in first 45 minutes`
      : null

    logger.debug('GET /api/trading/market-status: Status retrieved', {
      instrument,
      market_disabled: marketDisabled,
      stop_loss_hit_count: stopLossHitCount,
    })

    return NextResponse.json(
      {
        instrument,
        market_disabled: marketDisabled,
        disabled_reason: disabledReason,
        stop_loss_hit_count: stopLossHitCount,
        disabled_at: disabledAt,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('GET /api/trading/market-status: Unexpected error', { error })
    return NextResponse.json(
      {
        instrument: 'DOW',
        market_disabled: false,
        disabled_reason: 'Internal server error',
        stop_loss_hit_count: null,
        disabled_at: null,
      },
      { status: 500 }
    )
  }
}
