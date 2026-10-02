/**
 * POST /api/trading/positions/open
 * Open a new trading position within entry window
 * ORDER PLACEMENT DISABLED — Market Monitoring & Situation Notes Mode
 */

import { NextResponse } from 'next/server'
import { logger } from '@/lib/utils/logger'
import type { PositionOpenResponse } from '@/types/trading'
import type { DeskInstrument } from '@/lib/trading/sessionGate'

interface OpenPositionRequest {
  instrument?: DeskInstrument
  entry_price?: number
  entry_direction?: 'LONG' | 'SHORT'
  entry_window?: 1 | 2 | 3
}

export async function POST(request: Request): Promise<NextResponse<PositionOpenResponse>> {
  try {
    const body = (await request.json().catch(() => ({}))) as OpenPositionRequest

    logger.warn('POST /api/trading/positions/open: Order placement is disabled (Monitoring Mode)', { instrument: body.instrument })
    return NextResponse.json(
      {
        success: false,
        position_id: '',
        instrument: body.instrument || 'NASDAQ',
        entry_price: body.entry_price || 0,
        stop_loss_price: 0,
        position_size: 0,
        risk_amount: 0,
        entry_direction: body.entry_direction || 'LONG',
        entry_window: body.entry_window || 1,
        message: 'Order placement is disabled. System is strictly for market monitoring, situations, and notes.',
      },
      { status: 403 }
    )
  } catch (error) {
    logger.error('POST /api/trading/positions/open: Unexpected error', { error })
    return NextResponse.json(
      {
        success: false,
        position_id: '',
        instrument: 'NASDAQ',
        entry_price: 0,
        stop_loss_price: 0,
        position_size: 0,
        risk_amount: 0,
        entry_direction: 'LONG',
        entry_window: 1,
        message: 'Order placement is disabled. System is strictly for market monitoring, situations, and notes.',
      },
      { status: 403 }
    )
  }
}
