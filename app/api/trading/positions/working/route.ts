/**
 * GET  /api/trading/positions/working — hydrate an existing row
 * POST /api/trading/positions/working — refused. The desk does not place working limits.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  isLiveDeskInstrument,
  instrumentsForDeskMarket,
  liveFocusMarket,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import { tradeDateForInstrument } from '@/lib/trading/deskAttendance'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

const WORKING_SELECT =
  'id, instrument, trade_date, entry_price, entry_direction, stop_loss_price, profit_target_price, position_size, risk_amount, account_size, entry_window, regime, regime_confidence, entry_timestamp, entry_reason, entry_source'

function tradeDatesForMarket(instruments: DeskInstrument[], now = new Date()): string[] {
  return Array.from(new Set(instruments.map((i) => tradeDateForInstrument(i, now))))
}

/** GET — return today's durable working limit for the active desk market (if any). */
export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const viewingParam = searchParams.get('instrument')
    const viewingInstrument = isLiveDeskInstrument(viewingParam || '')
      ? (viewingParam as DeskInstrument)
      : null

    const now = new Date()
    const focusMarket = liveFocusMarket(now)
    const marketInstruments = instrumentsForDeskMarket(focusMarket)
    const tradeDates = tradeDatesForMarket(marketInstruments, now)

    const supabase = await createClient()
    const { data: row, error } = await supabase
      .from('trades_journal')
      .select(WORKING_SELECT)
      .eq('user_id', user.id)
      .in('instrument', marketInstruments)
      .in('trade_date', tradeDates)
      .eq('fill_status', 'working')
      .is('exit_timestamp', null)
      .maybeSingle()

    if (error) {
      logger.error('working.fetch_failed', { error })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!row) {
      return NextResponse.json({ success: true, working: null })
    }

    // Read-only hydrate — NEVER cancel/expire here.
    // Refresh/remount must re-paint the working ghost; expiry is cleanup-session,
    // explicit cancel-working, or intentional gate rules (FLAT / clock-out transition).
    return NextResponse.json({
      success: true,
      working: row,
      viewing_instrument: viewingInstrument,
    })
  } catch (error) {
    logger.error('working.fetch_unexpected', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  logger.warn('POST /api/trading/positions/working: Rejected (desk does not place positions or working limits)')
  void request
  return NextResponse.json(
    {
      success: false,
      error: 'The desk does not place positions or working limits.',
    },
    { status: 403 }
  )
}
