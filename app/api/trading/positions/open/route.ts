/**
 * POST /api/trading/positions/open
 * Read-Only Mode — Market Monitoring & Situation Notes
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

    logger.warn('POST /api/trading/positions/open: Rejected (System is Read-Only Monitoring Mode)', { instrument: body.instrument })
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
        message: 'The system is always in Read-Only Market Monitoring Mode and never places orders.',
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
        message: 'The system is always in Read-Only Market Monitoring Mode and never places orders.',
      },
      { status: 403 }
    )
  }
}
