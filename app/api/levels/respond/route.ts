/**
 * POST /api/levels/respond
 * After a stop / take-profit (or any exit), re-judge stored levels against
 * real candles so the next chart load shows updated memory — not stale zones.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { validateLevelsAgainstMarket } from '@/lib/services/levelValidation'
import { isDeskInstrument } from '@/lib/trading/sessionGate'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { instrument?: string; exit_reason?: string } = {}
    try {
      body = await request.json()
    } catch {
      /* empty */
    }

    const instrument = body.instrument
    if (!instrument || !isDeskInstrument(instrument)) {
      return NextResponse.json(
        { error: 'instrument must be DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const result = await validateLevelsAgainstMarket(supabase, user.id, instrument, 2)

    return NextResponse.json({
      success: true,
      instrument,
      exit_reason: body.exit_reason ?? null,
      levels_judged: result.validated,
      memory_updated: result.updated,
      verdicts: result.verdicts.map((v) => ({
        level: v.level,
        type: v.type,
        verdict: v.verdict,
        tests: v.tests,
        holds: v.holds,
        breaks: v.breaks,
      })),
    })
  } catch (error) {
    console.error('[levels/respond]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
