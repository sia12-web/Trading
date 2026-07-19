/**
 * POST /api/trading/positions/cancel-working
 * Thin cancel — expire today's working limits only (no lunch flatten / OANDA closes).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getESTDateString } from '@/lib/utils/timeUtils'
import { isLiveDeskInstrument } from '@/lib/trading/sessionGate'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const instrument = body.instrument as string | undefined
    if (instrument && !isLiveDeskInstrument(instrument)) {
      return NextResponse.json({ error: 'Invalid instrument' }, { status: 400 })
    }

    const supabase = await createClient()
    const today = getESTDateString()
    const now = new Date().toISOString()

    let q = supabase
      .from('trades_journal')
      .update({
        fill_status: 'cancelled',
        exit_timestamp: now,
        exit_reason: 'limit_expired',
        notes: 'Working limit cancelled by trader',
        updated_at: now,
      })
      .eq('user_id', user.id)
      .eq('trade_date', today)
      .eq('fill_status', 'working')

    if (instrument) {
      q = q.eq('instrument', instrument)
    } else {
      q = q.in('instrument', ['DOW', 'NASDAQ', 'NIKKEI'])
    }

    const { data, error } = await q.select('id')

    if (error) {
      logger.error('cancel-working.failed', { error })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      cancelled: data?.length ?? 0,
      instrument: instrument ?? null,
    })
  } catch (err) {
    logger.error('cancel-working.unexpected', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
