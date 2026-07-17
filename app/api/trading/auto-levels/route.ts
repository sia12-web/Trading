/**
 * GET /api/trading/auto-levels?instrument=DOW|NASDAQ|NIKKEI
 * Cron / internal: run Level Finder and archive levels for the live chart.
 * Tokyo: scheduled ~08:45 JST. NY: covered by market-open after recommendation.
 * Requires Authorization: Bearer $CRON_SECRET in production.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runAutoLevelPrep } from '@/lib/services/autoLevelPrep'
import { isDeskInstrument, type DeskInstrument } from '@/lib/trading/sessionGate'
import { assertCronOrDeskUser } from '@/lib/utils/devAuth'
import { assertProdEnv } from '@/lib/utils/env'
import { logger } from '@/lib/utils/logger'
import { withApiLog } from '@/lib/utils/withApiLog'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handleAutoLevels(request: NextRequest) {
  try {
    if (!(await assertCronOrDeskUser(request))) {
      logger.warn('auto-levels.unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    try {
      assertProdEnv()
    } catch (e) {
      logger.error('auto-levels.env', { err: e })
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Env misconfigured' },
        { status: 500 }
      )
    }

    const param = request.nextUrl.searchParams.get('instrument') || 'NIKKEI'
    if (!isDeskInstrument(param)) {
      return NextResponse.json(
        { error: 'instrument must be DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    // Cron fires at prep open — force so clock skew / DST edges don't skip
    const force = request.nextUrl.searchParams.get('force') !== '0'
    logger.info('auto-levels.start', { instrument: param, force })
    const result = await runAutoLevelPrep(param as DeskInstrument, { force })
    logger.info('auto-levels.done', {
      instrument: result.instrument,
      ok: result.ok,
      levels: result.levels,
      error: result.error ?? null,
    })

    return NextResponse.json(
      {
        success: result.ok,
        instrument: result.instrument,
        levels: result.levels,
        error: result.error ?? null,
        processed_at: new Date().toISOString(),
      },
      { status: result.ok ? 200 : 422 }
    )
  } catch (error) {
    logger.error('auto-levels.failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const GET = withApiLog('trading.auto-levels', handleAutoLevels)

export async function POST(request: NextRequest) {
  return GET(request)
}
