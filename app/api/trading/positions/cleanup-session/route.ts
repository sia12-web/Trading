/**
 * POST /api/trading/positions/cleanup-session
 * Expire unfilled working limits + lunch-flatten filled opens after morning session.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser, assertCronOrDeskUser, resolveDeskUser } from '@/lib/utils/devAuth'
import { cleanupDeskSession } from '@/lib/trading/sessionCleanup'
import { autoLunchClockOut } from '@/lib/trading/deskAttendance'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const cronOk = await assertCronOrDeskUser(request)
    const user = cronOk
      ? await resolveDeskUser(request)
      : await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let forceExpireWorking = false
    let forceLunchClose = false
    try {
      const body = await request.json()
      forceExpireWorking = !!body?.force_expire_working
      forceLunchClose = !!body?.force_lunch_close
    } catch {
      /* empty body ok */
    }

    const supabase = await createClient()
    const result = await cleanupDeskSession(supabase, user.id, {
      forceExpireWorking,
      forceLunchClose,
    })
    const clockedOutMarkets = await autoLunchClockOut(supabase, user.id)

    logger.info('cleanup-session.done', {
      userId: user.id,
      expired: result.expiredWorking.length,
      lunchClosed: result.lunchClosed.length,
      lunchClockOut: clockedOutMarkets,
    })

    return NextResponse.json({
      success: true,
      expired_working: result.expiredWorking,
      lunch_closed: result.lunchClosed,
      lunch_clock_out: clockedOutMarkets,
      message:
        result.expiredWorking.length || result.lunchClosed.length || clockedOutMarkets.length
          ? `Cleaned ${result.expiredWorking.length} unfilled limit(s), flattened ${result.lunchClosed.length} open position(s), clocked out ${clockedOutMarkets.join(',') || '—'}`
          : 'Nothing to clean',
    })
  } catch (error) {
    logger.error('cleanup-session.failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return POST(request)
}
