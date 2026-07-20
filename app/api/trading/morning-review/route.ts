/**
 * Morning review — the "evaluation mode" step of the desk cadence.
 *
 * LIVE only. Runs in the BACKGROUND after lunch for memory — the live
 * chart continues printing afternoon bars (trading stays morning-only).
 * Simulation has no afternoon session and does not call this route.
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
import {
  getTodayAttendance,
  saveMorningJournal,
  autoLunchClockOut,
} from '@/lib/trading/deskAttendance'
import type { Instrument } from '@/types/price-feed'
import { logger } from '@/lib/utils/logger'
import { withApiLog } from '@/lib/utils/withApiLog'

export const dynamic = 'force-dynamic'

function localDateInTz(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isSimJournalRequest(request: NextRequest): boolean {
  const simFlag =
    request.nextUrl.searchParams.get('sim') ||
    request.nextUrl.searchParams.get('tier') ||
    request.nextUrl.searchParams.get('mode')
  return !!simFlag && /^(1|true|sim|simulation)$/i.test(simFlag)
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
    if (isSimJournalRequest(request)) {
      return NextResponse.json(
        { error: 'Morning journal is live desk only — simulation has no journal' },
        { status: 403 }
      )
    }

    const { assertCronOrDeskUser, resolveDeskUser } = await import('@/lib/utils/devAuth')
    if (!(await assertCronOrDeskUser(request))) {
      logger.warn('morning-review.unauthorized')
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

    // Lunch clock-out first
    await autoLunchClockOut(supabase, user.id)

    const attendance = await getTodayAttendance(supabase, user.id, market)
    if (!attendance) {
      logger.info('morning-review.skipped_no_clock_in', { instrument, market, date: todayLocal })
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'Not clocked in today — no level reaction journal or afternoon update',
        date: todayLocal,
        instrument,
        market,
      })
    }

    logger.info('morning-review.start', { instrument, market, date: todayLocal })

    // Grade stored levels against real morning candles — only when clocked in
    const result = await validateLevelsAgainstMarket(supabase, user.id, instrument, 2)

    const respected = result.verdicts.filter((v) => v.verdict === 'respected')
    const broken = result.verdicts.filter((v) => v.verdict === 'broken')
    const contested = result.verdicts.filter((v) => v.verdict === 'contested')

    logger.info('morning-review.done', {
      instrument,
      judged: result.validated,
      memoryUpdated: result.updated,
      respected: respected.length,
      broken: broken.length,
      contested: contested.length,
    })

    const afternoonCandidates = [
      ...broken.map((v) => ({
        level: v.level,
        original_type: v.type,
        candidate_type: v.type === 'support' ? 'resistance' : 'support',
        play: 'FLIP',
        note: `Morning broke this ${v.type} — flip for afternoon memory (watch reaction into cash close).`,
      })),
      ...respected.map((v) => ({
        level: v.level,
        original_type: v.type,
        candidate_type: v.type,
        play: 'RETEST',
        note: `Held ${v.holds}/${v.tests} morning test${v.tests === 1 ? '' : 's'} — retest candidate into afternoon.`,
      })),
    ]

    const morningJournal = {
      written_at: new Date().toISOString(),
      instrument,
      market,
      session: market === 'TOKYO' ? 'morning (09:00–11:30 JST)' : 'morning (09:30–11:30 ET)',
      filled_or_not: 'journaled regardless of fill',
      reactions: {
        validated: respected.map(({ level, type, tests, holds }) => ({
          level,
          type,
          tests,
          holds,
          thesis: type === 'resistance' || String(type).includes('resist') ? 'deep short' : 'deep buy',
          outcome: 'validated',
        })),
        rejected: broken.map(({ level, type, tests, breaks }) => ({
          level,
          type,
          tests,
          breaks,
          thesis: type === 'resistance' || String(type).includes('resist') ? 'deep short' : 'deep buy',
          outcome: 'rejected',
        })),
        contested: contested.map(({ level, type, tests, holds, breaks }) => ({
          level,
          type,
          tests,
          holds,
          breaks,
          outcome: 'contested',
        })),
      },
      summary: `${instrument} morning: ${respected.length} validated, ${broken.length} rejected, ${contested.length} contested.`,
    }

    await saveMorningJournal(supabase, attendance.id, morningJournal, afternoonCandidates)

    // Refresh AI levels for afternoon memory (clocked-in days only; force past lunch)
    try {
      const { runAutoLevelPrep } = await import('@/lib/services/autoLevelPrep')
      await runAutoLevelPrep(instrument as Instrument, { force: true })
    } catch (err) {
      logger.warn('morning-review.afternoon_levels_failed', { err })
    }

    const sessionLabel =
      market === 'TOKYO'
        ? 'morning (09:00–11:30 JST)'
        : 'morning (09:30–11:30 ET)'

    return NextResponse.json(
      {
        ok: true,
        date: todayLocal,
        instrument,
        market,
        clocked_in: true,
        session_reviewed: sessionLabel,
        levels_judged: result.validated,
        memory_updated: result.updated,
        morning_journal: morningJournal,
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
          enabled: true,
          visible_on_live_chart: true,
          note:
            'Afternoon levels paint on the live chart as watch-only (FLIP/RETEST + IB). Trading stays morning-only until next session.',
          candidates: afternoonCandidates,
        },
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('morning-review.failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Cron / manual GET */
export const GET = withApiLog('trading.morning-review', runMorningReview)

/** Manual trigger from the dashboard */
export async function POST(request: NextRequest) {
  return GET(request)
}
