/**
 * GET /api/trading/afternoon-playbook?instrument=DOW
 * Morning-review FLIP/RETEST candidates for afternoon chart watch (read-only).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  deskMarketFor,
  isLiveDeskInstrument,
  isAfternoonWatchWindow,
} from '@/lib/trading/sessionGate'
import { getTodayAttendance } from '@/lib/trading/deskAttendance'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const instrument = (searchParams.get('instrument') || 'DOW') as Instrument
    if (!isLiveDeskInstrument(instrument)) {
      return NextResponse.json({ error: 'Invalid instrument' }, { status: 400 })
    }

    const market = deskMarketFor(instrument)
    const supabase = await createClient()
    const attendance = await getTodayAttendance(supabase, user.id, market)
    const candidates = Array.isArray(attendance?.afternoon_levels)
      ? attendance!.afternoon_levels
      : []

    return NextResponse.json({
      ok: true,
      instrument,
      market,
      afternoon_watch: isAfternoonWatchWindow(new Date(), instrument),
      attended: !!attendance,
      candidates,
      note:
        'Afternoon levels are watch-only — morning reaction + IB context. No new orders after lunch.',
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
