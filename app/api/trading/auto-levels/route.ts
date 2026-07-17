/**
 * GET /api/trading/auto-levels?instrument=DOW|NASDAQ|NIKKEI
 * Cron / internal: run Level Finder and archive levels for the live chart.
 * Tokyo: scheduled ~08:45 JST. NY: covered by market-open after recommendation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runAutoLevelPrep } from '@/lib/services/autoLevelPrep'
import { isDeskInstrument, type DeskInstrument } from '@/lib/trading/sessionGate'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  try {
    const param = request.nextUrl.searchParams.get('instrument') || 'NIKKEI'
    if (!isDeskInstrument(param)) {
      return NextResponse.json(
        { error: 'instrument must be DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    // Cron fires at prep open — force so clock skew / DST edges don't skip
    const force = request.nextUrl.searchParams.get('force') !== '0'
    const result = await runAutoLevelPrep(param as DeskInstrument, { force })

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
    console.error('[auto-levels]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
