/**
 * POST /api/trading/clock-out
 * Manual clock-out. Lunch also auto clock-outs via cleanup-session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { clockOut } from '@/lib/trading/deskAttendance'
import {
  deskMarketFor,
  isDeskInstrument,
  type DeskInstrument,
  type DeskMarket,
} from '@/lib/trading/sessionGate'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { market?: string; instrument?: string; reason?: string } = {}
    try {
      body = await request.json()
    } catch {
      /* empty */
    }

    const instrument = isDeskInstrument(body.instrument || '')
      ? (body.instrument as DeskInstrument)
      : null
    const market: DeskMarket =
      body.market === 'TOKYO' || body.market === 'NY'
        ? body.market
        : deskMarketFor(instrument ?? 'DOW')

    const supabase = await createClient()
    const result = await clockOut(supabase, user.id, {
      market,
      reason: body.reason === 'eod' ? 'eod' : 'manual',
      tradedInstrument: instrument,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    logger.info('desk.clock_out', { userId: user.id, market, reason: 'manual' })
    return NextResponse.json({ ok: true, attendance: result.row })
  } catch (error) {
    logger.error('desk.clock_out_failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
