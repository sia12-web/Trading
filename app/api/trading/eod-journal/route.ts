/**
 * POST/GET /api/trading/eod-journal
 * End-of-day level reaction journal for the market the trader clocked into.
 * NY ~16:00 ET (DOW/NASDAQ) · Tokyo ~15:00 JST (NIKKEI).
 * Skips if trader never clocked in that day.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assertCronOrDeskUser, resolveDeskUser } from '@/lib/utils/devAuth'
import { validateLevelsAgainstMarket } from '@/lib/services/levelValidation'
import {
  getTodayAttendance,
  saveEodJournal,
  sessionDateForMarket,
} from '@/lib/trading/deskAttendance'
import {
  deskMarketFor,
  isDeskInstrument,
  sessionFor,
  type DeskInstrument,
  type DeskMarket,
} from '@/lib/trading/sessionGate'
import { logger } from '@/lib/utils/logger'
import { withApiLog } from '@/lib/utils/withApiLog'

export const dynamic = 'force-dynamic'

function localMins(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  let h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  if (h === 24) h = 0
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  return h * 60 + m
}

async function resolveMarket(
  request: NextRequest,
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<{ market: DeskMarket; instrument: DeskInstrument } | null> {
  const param = request.nextUrl.searchParams.get('instrument')
  if (param && isDeskInstrument(param)) {
    return { market: deskMarketFor(param), instrument: param }
  }

  // Prefer a market past cash close that has attendance today
  for (const market of ['NY', 'TOKYO'] as DeskMarket[]) {
    const probe = market === 'TOKYO' ? 'NIKKEI' : 'DOW'
    const s = sessionFor(probe)
    const closeMins =
      parseInt(s.marketClose.slice(0, 2), 10) * 60 +
      parseInt(s.marketClose.slice(3, 5), 10)
    const nowMins = localMins(s.tz)
    // Run from cash close through +2h
    if (nowMins < closeMins || nowMins > closeMins + 120) continue

    const att = await getTodayAttendance(supabase, userId, market)
    if (!att) continue

    const instrument =
      (att.traded_instrument && isDeskInstrument(att.traded_instrument)
        ? att.traded_instrument
        : null) ||
      (att.instrument && isDeskInstrument(att.instrument) ? att.instrument : null) ||
      (market === 'TOKYO' ? 'NIKKEI' : 'DOW')

    return { market, instrument }
  }

  return null
}

async function runEodJournal(request: NextRequest) {
  try {
    if (!(await assertCronOrDeskUser(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = await resolveDeskUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()
    const resolved = await resolveMarket(request, supabase, user.id)
    if (!resolved) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'No clocked-in market at cash close right now',
      })
    }

    const { market, instrument } = resolved
    const attendance = await getTodayAttendance(supabase, user.id, market)
    if (!attendance) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'Never clocked in — no EOD journal',
        market,
        date: sessionDateForMarket(market),
      })
    }

    // Already written?
    if (attendance.eod_journal && Object.keys(attendance.eod_journal).length > 2) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'EOD journal already saved',
        eod_journal: attendance.eod_journal,
      })
    }

    const result = await validateLevelsAgainstMarket(supabase, user.id, instrument, 1)
    const respected = result.verdicts.filter((v) => v.verdict === 'respected')
    const broken = result.verdicts.filter((v) => v.verdict === 'broken')
    const contested = result.verdicts.filter((v) => v.verdict === 'contested')
    const untested = result.verdicts.filter((v) => v.verdict === 'untested')

    const journal = {
      written_at: new Date().toISOString(),
      instrument,
      market,
      session_date: attendance.session_date,
      clocked_in: true,
      traded_instrument: attendance.traded_instrument,
      morning_journal: attendance.morning_journal,
      afternoon_levels: attendance.afternoon_levels,
      levels_judged: result.validated,
      reactions: {
        validated: respected.map((v) => ({
          level: v.level,
          type: v.type,
          tests: v.tests,
          holds: v.holds,
          note: 'Respected — initial thesis held',
        })),
        rejected: broken.map((v) => ({
          level: v.level,
          type: v.type,
          tests: v.tests,
          breaks: v.breaks,
          note: 'Rejected — level broke',
        })),
        contested: contested.map((v) => ({
          level: v.level,
          type: v.type,
          tests: v.tests,
          holds: v.holds,
          breaks: v.breaks,
        })),
        untested: untested.map((v) => ({ level: v.level, type: v.type })),
      },
      summary: `${instrument} EOD: ${respected.length} validated, ${broken.length} rejected, ${contested.length} contested of ${result.validated} levels (clocked-in day).`,
    }

    await saveEodJournal(supabase, attendance.id, journal)

    logger.info('eod-journal.done', {
      instrument,
      market,
      judged: result.validated,
      validated: respected.length,
      rejected: broken.length,
    })

    return NextResponse.json({ ok: true, eod_journal: journal })
  } catch (error) {
    logger.error('eod-journal.failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const GET = withApiLog('trading.eod-journal', runEodJournal)
export async function POST(request: NextRequest) {
  return GET(request)
}
