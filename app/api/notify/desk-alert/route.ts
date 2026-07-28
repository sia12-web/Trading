/**
 * POST /api/notify/desk-alert
 * Authenticated desk alerts → Telegram (soft-fail if not configured).
 */

import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { sendTelegramMessage, telegramConfigured } from '@/lib/notify/telegram'
import { logger } from '@/lib/utils/logger'

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
    const telegramText =
      (typeof json.telegram === 'string' && json.telegram.trim()) ||
      [json.title, json.body].filter(Boolean).join('\n')

    if (!telegramText) {
      return NextResponse.json({ error: 'Empty alert' }, { status: 400 })
    }

    const result = await sendTelegramMessage(telegramText)
    if (!result.ok) {
      return NextResponse.json(
        { success: false, telegram: result, configured: telegramConfigured() },
        { status: 502 }
      )
    }

    return NextResponse.json({
      success: true,
      kind: json.kind ?? 'desk_alert',
      telegram: result,
      configured: telegramConfigured(),
    })
  } catch (err) {
    logger.error('desk-alert.failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
