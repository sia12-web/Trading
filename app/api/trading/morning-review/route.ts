/**
 * Morning review — the "evaluation mode" step of the desk cadence.
 *
 * LIVE only. Runs in the BACKGROUND after lunch for memory — the live
 * chart stays frozen (no afternoon bars). Simulation has no afternoon
 * session and does not call this route.
 *
 * NY:     cron ~11:35 ET  → DOW/NASDAQ morning (09:30–11:30 ET)
 * Tokyo:  cron ~11:35 JST → NIKKEI morning (09:00–11:30 JST)
 *
 * Next day: only yesterday range + overnight matter; these verdicts feed
 * that memory, then age out of the active level set (history days=1).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateLevelsAgainstMarket } from '@/lib/services/levelValidation'
import { getESTDateString } from '@/lib/utils/timeUtils'
import { deskMarketFor, isDeskInstrument, sessionFor } from '@/lib/trading/sessionGate'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'

function localDateInTz(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

async function resolveInstrument(
  request: NextRequest,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Instrument> {
  const param = request.nextUrl.searchParams.get('instrument')
  if (param && isDeskInstrument(param)) return param

  // Prefer Tokyo when TSE morning just ended / is lunch; else NY recommendation
  const tokyo = sessionFor('NIKKEI')
  const now = new Date()
  const tokyoTime = new Intl.DateTimeFormat('en-US', {
    timeZone: tokyo.tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
  const [th, tm] = tokyoTime.replace('24:', '00:').split(':').map(Number)
  const tokyoMins = (th ?? 0) * 60 + (tm ?? 0)
  const lunchMins = 11 * 60 + 30
  // Around Tokyo lunch window (±2h) default to NIKKEI if no explicit param
  if (tokyoMins >= lunchMins - 15 && tokyoMins <= lunchMins + 120) {
    return 'NIKKEI'
  }

  const todayNy = getESTDateString()
  const { data: rec } = await supabase
    .from('market_recommendations')
    .select('recommended_instrument')
    .eq('date', todayNy)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return rec?.recommended_instrument === 'NASDAQ' ? 'NASDAQ' : 'DOW'
}

async function runMorningReview(request: NextRequest) {
  try {
    const { assertCronOrDeskUser, resolveDeskUser } = await import('@/lib/utils/devAuth')
    if (!(await assertCronOrDeskUser(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await resolveDeskUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()
    const instrument = await resolveInstrument(request, supabase)
    const market = deskMarketFor(instrument)
    const sess = sessionFor(instrument)
    const todayLocal = localDateInTz(sess.tz)

    // Grade stored levels against real morning candles — memory only
    const result = await validateLevelsAgainstMarket(supabase, user.id, instrument, 2)

    const respected = result.verdicts.filter((v) => v.verdict === 'respected')
    const broken = result.verdicts.filter((v) => v.verdict === 'broken')
    const contested = result.verdicts.filter((v) => v.verdict === 'contested')

    const afternoonCandidates = [
      ...broken.map((v) => ({
        level: v.level,
        original_type: v.type,
        candidate_type: v.type === 'support' ? 'resistance' : 'support',
        play: 'FLIP',
        note: `Morning broke this ${v.type} — flip candidate for afternoon memory only (not live-traded).`,
      })),
      ...respected.map((v) => ({
        level: v.level,
        original_type: v.type,
        candidate_type: v.type,
        play: 'RETEST',
        note: `Held ${v.holds}/${v.tests} morning test${v.tests === 1 ? '' : 's'} — retest candidate for afternoon memory only.`,
      })),
    ]

    const sessionLabel =
      market === 'TOKYO'
        ? 'morning (09:00–11:30 JST)'
        : 'morning (09:30–11:30 ET)'

    return NextResponse.json(
      {
        date: todayLocal,
        instrument,
        market,
        session_reviewed: sessionLabel,
        levels_judged: result.validated,
        memory_updated: result.updated,
        verdicts: {
          respected: respected.map(({ level, type, tests, holds }) => ({
            level,
            type,
            tests,
            holds,
          })),
          broken: broken.map(({ level, type, tests, breaks }) => ({
            level,
            type,
            tests,
            breaks,
          })),
          contested: contested.map(({ level, type, tests, holds, breaks }) => ({
            level,
            type,
            tests,
            holds,
            breaks,
          })),
        },
        afternoon_playbook: {
          enabled: false,
          visible_on_live_chart: false,
          note:
            'Afternoon review updates AI/system memory only. Live chart stays frozen at lunch — no afternoon bars.',
          candidates: afternoonCandidates,
        },
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[Morning Review] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Cron / manual GET */
export async function GET(request: NextRequest) {
  return runMorningReview(request)
}

/** Manual trigger from the dashboard */
export async function POST(request: NextRequest) {
  return runMorningReview(request)
}
