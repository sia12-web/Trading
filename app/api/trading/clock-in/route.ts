/**
 * POST /api/trading/clock-in
 * "Today I trade" — unlocks live chart and Level Finder for this market.
 * Window: prep (analyzeStart → cash open) OR late join through cash close.
 * Late join records late_join=true; dead books stay closed.
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
            'No clock-in window. Clock in from prep (15 min before cash open) through cash close (Montreal time). After cash close, wait for the next desk.',
        },
        { status: 403 }
      )
    }

    const supabase = await createClient()
    const result = await clockIn(supabase, user.id, { market, instrument })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 403 })
    }

    const prepInstrument =
      result.row.instrument ||
      instrument ||
      (market === 'TOKYO' ? 'NIKKEI' : null)
    if (prepInstrument) {
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

    const lateJoin = !!(result.row as { late_join?: boolean }).late_join

    logger.info('desk.clock_in', {
      userId: user.id,
      market,
      instrument: prepInstrument,
      lateJoin,
      date: sessionDateForMarket(market),
    })

    if (prepInstrument) {
      try {
        const { formatClockInNote } = await import('@/lib/notify/deskSessionNotes')
        const { sendTelegramMessage } = await import('@/lib/notify/telegram')
        const { resolveDeskRiskProfileForUser } = await import('@/lib/trading/tradeifyProfileStore')
        const { isTradeifyGrowth50k } = await import('@/lib/trading/tradeifyProfile')
        const { loadTradeifyLeoSnapshot } = await import('@/lib/trading/tradeifySessionState')
        const { formatTradeifyTelegramBlock } = await import('@/lib/trading/tradeifyLeoBlock')
        const profile = await resolveDeskRiskProfileForUser({
          supabase,
          userId: user.id,
          cookieHeader: request.headers.get('cookie'),
        })
        const tradeifyOn = isTradeifyGrowth50k(profile)
        const tradeifyLine = tradeifyOn
          ? formatTradeifyTelegramBlock(await loadTradeifyLeoSnapshot(supabase, user.id))
          : null
        const note = formatClockInNote({
          instrument: prepInstrument as DeskInstrument,
          market,
          sessionDate: sessionDateForMarket(market),
          lateJoin,
          tradeify: tradeifyOn,
          tradeifyLine,
        })
        void sendTelegramMessage(note.telegram).then((r) => {
          if (!r.ok) {
            logger.warn('desk.clock_in_telegram_failed', { error: r.error })
          } else if ('skipped' in r && r.skipped) {
            logger.info('desk.clock_in_telegram_skipped', { reason: r.reason })
          } else {
            logger.info('desk.clock_in_telegram_sent', {
              instrument: prepInstrument,
              lateJoin,
            })
          }
        })
      } catch (e) {
        logger.warn('desk.clock_in_telegram_error', { err: e })
      }
    }

    return NextResponse.json({
      ok: true,
      attendance: result.row,
      late_join: lateJoin,
      message: lateJoin
        ? `Late clock-in for ${market} — remaining probes only (dead books stay closed).`
        : `Clocked in for ${market} — live chart unlocked. Levels will be graded today.`,
    })
  } catch (error) {
    logger.error('desk.clock_in_failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
