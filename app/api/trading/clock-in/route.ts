/**
 * POST /api/trading/clock-in
 * "Today I trade" — unlocks live chart and enables level reaction AI for this market.
 * Window: 15 min before cash open → lunch (NY 9:15 ET / Tokyo 8:45 JST).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  activeClockMarkets,
  clockIn,
  sessionDateForMarket,
} from '@/lib/trading/deskAttendance'
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

    let body: { market?: string; instrument?: string } = {}
    try {
      body = await request.json()
    } catch {
      /* empty body ok */
    }

    const instrument = isDeskInstrument(body.instrument || '')
      ? (body.instrument as DeskInstrument)
      : null

    let market: DeskMarket | null = null
    if (body.market === 'NY' || body.market === 'TOKYO') {
      market = body.market
    } else if (instrument) {
      market = deskMarketFor(instrument)
    } else {
      const active = activeClockMarkets()
      market = active[0] ?? null
    }

    if (!market) {
      return NextResponse.json(
        {
          error:
            'No clock-in window open. Clock in from 9:15 ET (DOW/NASDAQ) or 8:45 JST (NIKKEI).',
        },
        { status: 403 }
      )
    }

    const supabase = await createClient()
    const result = await clockIn(supabase, user.id, { market, instrument })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 403 })
    }

    // Kick level prep when we know the instrument (NY waits for recommendation via banner)
    const prepInstrument =
      result.row.instrument ||
      instrument ||
      (market === 'TOKYO' ? 'NIKKEI' : null)
    if (prepInstrument) {
      // Fire-and-forget — do not await (keeps clock-in snappy). Absolute URL can fail
      // behind proxies; relative fetch on same host via nextUrl is fine for desk.
      const origin = request.nextUrl.origin
      void fetch(
        `${origin}/api/trading/auto-levels?instrument=${encodeURIComponent(prepInstrument)}&force=1`,
        {
          method: 'POST',
          headers: {
            cookie: request.headers.get('cookie') || '',
            authorization: request.headers.get('authorization') || '',
          },
        }
      ).catch(() => {})
    }

    logger.info('desk.clock_in', {
      userId: user.id,
      market,
      instrument: prepInstrument,
      date: sessionDateForMarket(market),
    })

    return NextResponse.json({
      ok: true,
      attendance: result.row,
      message: `Clocked in for ${market} — live chart unlocked. Levels will be graded today.`,
    })
  } catch (error) {
    logger.error('desk.clock_in_failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
