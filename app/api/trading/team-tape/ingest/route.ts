/**
 * POST /api/trading/team-tape/ingest
 * Questrade watcher → TradePulse. Secret only. Never places an order.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEV_USER_ID, resolveDeskUser } from '@/lib/utils/devAuth'
import { getTodayAttendance } from '@/lib/trading/deskAttendance'
import {
  loadTradeifySessionSnapshot,
} from '@/lib/trading/tradeifySessionState'
import { resolveTradeifyPlace } from '@/lib/trading/tradeifyGrowth50k'
import {
  buildTeamCopyAdvice,
  formatTeamTelegram,
  parseTeamTapeIngest,
  withSignalTarget,
} from '@/lib/trading/teamTape'
import { sendTelegramMessage } from '@/lib/notify/telegram'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

function teamTapeSecretOk(request: Request): boolean {
  const team = process.env.TEAM_TAPE_SECRET?.trim()
  const cron = process.env.CRON_SECRET?.trim()
  const secret = team || cron
  if (process.env.NODE_ENV === 'production' && !secret) return false
  if (!secret) return process.env.NODE_ENV !== 'production'
  const auth = request.headers.get('authorization')
  const header = request.headers.get('x-team-tape-secret')
  if (team && (auth === `Bearer ${team}` || header === team)) return true
  if (cron && (auth === `Bearer ${cron}` || header === cron)) return true
  return false
}

export async function POST(request: Request) {
  if (!teamTapeSecretOk(request)) {
    return NextResponse.json({ error: 'Unauthorized', success: false }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', success: false }, { status: 400 })
  }

  const parsed = parseTeamTapeIngest(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, success: false }, { status: 400 })
  }

  const user = await resolveDeskUser(request)
  const userId =
    process.env.DESK_USER_ID?.trim() || user?.id || DEV_USER_ID
  const supabase = createAdminClient() ?? (await createClient())
  const now = new Date()
  const signal = parsed.signal

  const { data: existing } = await supabase
    .from('team_signals')
    .select('id')
    .eq('user_id', userId)
    .eq('source_id', signal.sourceId)
    .maybeSingle()

  const { error } = await supabase.from('team_signals').upsert(
    {
      user_id: userId,
      source_id: signal.sourceId,
      symbol: signal.symbol,
      side: signal.side,
      quantity: signal.quantity,
      entry: signal.entry,
      stop: signal.stop,
      target: signal.target,
      status: signal.status,
      filled_at: signal.filledAt || now.toISOString(),
      raw: body,
      updated_at: now.toISOString(),
    },
    { onConflict: 'user_id,source_id' }
  )

  if (error) {
    logger.error('team_tape.ingest_failed', { error: error.message })
    return NextResponse.json({ error: error.message, success: false }, { status: 500 })
  }

  const [snap, attendance] = await Promise.all([
    loadTradeifySessionSnapshot(supabase, userId, now),
    getTodayAttendance(supabase, userId, 'NY', now),
  ])
  const place = resolveTradeifyPlace(snap)
  const advice = withSignalTarget(
    buildTeamCopyAdvice({
      place,
      clockedIn: attendance?.status === 'clocked_in',
      now,
    }),
    signal
  )

  const isNew = !existing
  if (isNew && (signal.status === 'filled' || signal.status === 'working')) {
    const sent = await sendTelegramMessage(formatTeamTelegram({ signal, advice }))
    if (!sent.ok) {
      logger.warn('team_tape.telegram_failed', { error: sent.error })
    }
  }

  return NextResponse.json({
    ok: true,
    inserted: isNew,
    signal,
    advice,
  })
}
