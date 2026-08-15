/**
 * POST /api/trading/late-desk-brief
 * Cron: Late Desk Brief Telegram digest for traders who are NOT clocked in.
 *
 * NY (~10:00 Montreal / ET): 0 14 * * 1-5 UTC (EDT)
 * Tokyo (after first hour ~10:00 JST): 0 1 * * 1-5 UTC
 *
 * If already clocked in for that desk → skip (normal alerts only).
 * Telegram does NOT clock in — inform only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assertCronOrDeskUser, resolveDeskUser } from '@/lib/utils/devAuth'
import {
  getTodayAttendance,
  isClockedIn,
  sessionDateForMarket,
} from '@/lib/trading/deskAttendance'
import { loadLiveDeskBrief } from '@/lib/trading/liveDeskBriefServer'
import {
  formatLiveDeskBriefText,
} from '@/lib/trading/liveDeskBrief'
import { formatLateDeskBriefNote } from '@/lib/notify/deskSessionNotes'
import { sendTelegramMessage, telegramConfigured } from '@/lib/notify/telegram'
import {
  claimServerDeskNoteOnce,
  releaseServerDeskNoteClaim,
} from '@/lib/notify/deskNoteServerClaim'
import type { DeskMarket } from '@/lib/trading/sessionGate'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

function resolveFocusMarket(request: NextRequest): DeskMarket {
  const q = request.nextUrl.searchParams.get('market')
  if (q === 'TOKYO' || q === 'NY') return q
  // Default by wall clock: Tokyo digest overnight Montreal; NY mid-morning.
  const hourToronto = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      hour: '2-digit',
      hour12: false,
    }).format(new Date())
  )
  // 18:00–05:00 Montreal → Tokyo session focus; else NY
  if (hourToronto >= 18 || hourToronto < 6) return 'TOKYO'
  return 'NY'
}

export async function POST(request: NextRequest) {
  try {
    if (!(await assertCronOrDeskUser(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await resolveDeskUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const market = resolveFocusMarket(request)
    const now = new Date()
    const supabase = await createClient()

    const clocked = await isClockedIn(supabase, user.id, market, now)
    if (clocked) {
      logger.info('late_desk_brief.skipped_clocked_in', {
        userId: user.id,
        market,
        date: sessionDateForMarket(market, now),
      })
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'Already clocked in — late brief not sent (normal alerts only)',
        market,
      })
    }

    // Also skip if they attended earlier today (clocked out) — they got the desk
    const attendance = await getTodayAttendance(supabase, user.id, market, now)
    if (attendance) {
      logger.info('late_desk_brief.skipped_attended', {
        userId: user.id,
        market,
        status: attendance.status,
      })
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'Already attended today — late brief not sent',
        market,
      })
    }

    const brief = await loadLiveDeskBrief({ now, focusMarket: market })
    const body = formatLiveDeskBriefText(brief)
    const { resolveDeskRiskProfileForUser } = await import('@/lib/trading/tradeifyProfileStore')
    const { isTradeifyGrowth50k } = await import('@/lib/trading/tradeifyProfile')
    const { loadTradeifyLeoSnapshot } = await import('@/lib/trading/tradeifySessionState')
    const { formatTradeifyTelegramBlock } = await import('@/lib/trading/tradeifyLeoBlock')
    const profile = await resolveDeskRiskProfileForUser({
      supabase,
      userId: user.id,
      cookieHeader: request.headers.get('cookie'),
    })
    const tradeifyLine = isTradeifyGrowth50k(profile)
      ? formatTradeifyTelegramBlock(await loadTradeifyLeoSnapshot(supabase, user.id, now))
      : null
    const note = formatLateDeskBriefNote({
      body,
      asOfDisplay: brief.asOfDisplay,
      focus: market,
      tradeifyLine,
    })

    if (!telegramConfigured()) {
      logger.info('late_desk_brief.telegram_unset', { market })
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'Telegram not configured',
        market,
        brief,
        preview: note.telegram,
      })
    }

    const dedupeKey = `late_desk_brief:${market}:${sessionDateForMarket(market, now)}:${user.id}`
    if (!claimServerDeskNoteOnce(dedupeKey)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'Already sent this session (dedupe)',
        market,
      })
    }

    const sent = await sendTelegramMessage(note.telegram)
    if (!sent.ok) {
      releaseServerDeskNoteClaim(dedupeKey)
      logger.warn('late_desk_brief.telegram_failed', { error: sent.error, market })
      return NextResponse.json(
        { ok: false, error: sent.error || 'Telegram send failed', market },
        { status: 502 }
      )
    }

    logger.info('late_desk_brief.sent', {
      userId: user.id,
      market,
      suggestion: brief.suggestion.kind,
    })

    return NextResponse.json({
      ok: true,
      sent: true,
      market,
      asOf: brief.asOfDisplay,
      suggestion: brief.suggestion,
    })
  } catch (error) {
    logger.error('late_desk_brief.failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
