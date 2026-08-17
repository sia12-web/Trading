import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { sendTelegramMessage, telegramConfigured } from '@/lib/notify/telegram'
import { claimServerDeskNoteOnce } from '@/lib/notify/deskNoteServerClaim'
import { deskAlertTelegramText } from '@/lib/notify/deskAlertTelegram'
import { logger } from '@/lib/utils/logger'
import { logDeskAlert } from '@/lib/utils/deskAuditLog'

export const dynamic = 'force-dynamic'

type Body = {
  kind?: string
  title?: string
  body?: string
  telegram?: string
  /** Client durable key (tp.deskNote.*) — blocks refresh re-sends server-side too */
  dedupeKey?: string
  instrument?: string
}

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const json = (await request.json().catch(() => ({}))) as Body
    const kind = json.kind ?? 'desk_alert'
    const telegramText = deskAlertTelegramText(json)

    if (!telegramText) {
      logDeskAlert({
        kind,
        ok: true,
        telegramConfigured: telegramConfigured(),
        error: 'toast_only',
      })
      return NextResponse.json({
        success: true,
        kind,
        skipped: true,
        reason: 'toast_only',
        configured: telegramConfigured(),
      })
    }

    const rawDedupe =
      typeof json.dedupeKey === 'string' ? json.dedupeKey.trim() : ''
    const serverKey = rawDedupe ? `${user.id}:${rawDedupe}` : ''
    if (serverKey && !claimServerDeskNoteOnce(serverKey)) {
      logDeskAlert({
        kind,
        ok: true,
        telegramConfigured: telegramConfigured(),
        error: 'deduped',
      })
      return NextResponse.json({
        success: true,
        kind,
        deduped: true,
        configured: telegramConfigured(),
      })
    }

    const result = await sendTelegramMessage(telegramText)
    if (!result.ok) {
      logDeskAlert({
        kind,
        ok: false,
        telegramConfigured: telegramConfigured(),
        error: result.error,
      })
      return NextResponse.json(
        { success: false, telegram: result, configured: telegramConfigured() },
        { status: 502 }
      )
    }

    logDeskAlert({
      kind,
      ok: true,
      telegramConfigured: telegramConfigured(),
      error: 'skipped' in result && result.skipped ? result.reason : null,
    })

    return NextResponse.json({
      success: true,
      kind,
      telegram: result,
      configured: telegramConfigured(),
    })
  } catch (err) {
    logger.error('desk-alert.failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
