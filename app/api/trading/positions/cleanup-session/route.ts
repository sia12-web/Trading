/**
 * POST /api/trading/positions/cleanup-session
 * Expire unfilled working limits + cash-close flatten filled opens after marketClose.
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
    let forceCashClose = false
    try {
      const body = await request.json()
      forceExpireWorking = !!body?.force_expire_working
      // Prefer force_cash_close; force_lunch_close kept as deprecated alias
      forceCashClose = !!(body?.force_cash_close || body?.force_lunch_close)
    } catch {
      /* empty body ok */
    }

    const supabase = await createClient()
    const { resolveDeskRiskProfileForUser } = await import('@/lib/trading/tradeifyProfileStore')
    const { isTradeifyGrowth50k } = await import('@/lib/trading/tradeifyProfile')
    const { tradeifyMustFlatten } = await import('@/lib/trading/tradeifyGrowth50k')
    const profile = await resolveDeskRiskProfileForUser({
      supabase,
      userId: user.id,
      cookieHeader: request.headers.get('cookie'),
    })
    const tradeifyFlatten =
      isTradeifyGrowth50k(profile) && tradeifyMustFlatten()
    const result = await cleanupDeskSession(supabase, user.id, {
      forceExpireWorking: forceExpireWorking || tradeifyFlatten,
      forceCashClose: forceCashClose || tradeifyFlatten,
      tradeifyMustFlatten: tradeifyFlatten,
    })
    const clockedOutMarkets = await autoLunchClockOut(supabase, user.id)

    logger.info('cleanup-session.done', {
      userId: user.id,
      expired: result.expiredWorking.length,
      cashClosed: result.cashClosed.length,
      lunchClockOut: clockedOutMarkets,
    })

    return NextResponse.json({
      success: true,
      expired_working: result.expiredWorking,
      cash_closed: result.cashClosed,
      lunch_closed: result.lunchClosed,
      lunch_clock_out: clockedOutMarkets,
      message:
        result.expiredWorking.length || result.cashClosed.length || clockedOutMarkets.length
          ? `Cleaned ${result.expiredWorking.length} unfilled limit(s), cash-closed ${result.cashClosed.length} open position(s), clocked out ${clockedOutMarkets.join(',') || '—'}`
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
