import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { sendTelegramMessage, telegramConfigured } from '@/lib/notify/telegram'
import { logger } from '@/lib/utils/logger'
import { logDeskAlert } from '@/lib/utils/deskAuditLog'

export const dynamic = 'force-dynamic'

type Body = {
  kind?: string
  title?: string
  body?: string
  telegram?: string
}

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const json = (await request.json().catch(() => ({}))) as Body
    const kind = json.kind ?? 'desk_alert'
    const telegramText =
      (typeof json.telegram === 'string' && json.telegram.trim()) ||
      [json.title, json.body].filter(Boolean).join('\n')

    if (!telegramText) {
      logDeskAlert({
        kind,
        ok: false,
        telegramConfigured: telegramConfigured(),
        error: 'Empty alert',
      })
      return NextResponse.json({ error: 'Empty alert' }, { status: 400 })
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
