/**
 * GET  /api/trading/asia-signal — current GOLD/DOW Asia OCO overlays
 * POST /api/trading/asia-signal — TradingView webhook (Pine alert JSON or text)
 *     Query: ?hook=$ASIA_WEBHOOK_SECRET (TV cannot send Authorization headers)
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { assertCronAuthorized, getOrCreateUser, resolveDeskUser } from '@/lib/utils/devAuth'
import {
  formatAsiaDeskTelegram,
  asiaTelegramKey,
  overlayFromWebhook,
  parseAsiaWebhookBody,
  type AsiaDeskOverlay,
} from '@/lib/trading/asiaDesk'
import {
  claimAsiaTelegramKey,
  loadAsiaDeskBook,
  overlayForInstrument,
  upsertAsiaOverlay,
} from '@/lib/trading/asiaDeskStore'
import { sendTelegramMessage } from '@/lib/notify/telegram'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

function asiaHookAuthorized(request: Request): boolean {
  if (assertCronAuthorized(request)) return true
  const hook =
    process.env.ASIA_WEBHOOK_SECRET?.trim() || process.env.CRON_SECRET?.trim() || ''
  if (!hook) return process.env.NODE_ENV !== 'production'
  const url = new URL(request.url)
  if (url.searchParams.get('hook') === hook) return true
  const header = request.headers.get('x-asia-hook')
  return header === hook
}

export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const supabase = createAdminClient() ?? (await createClient())
    const row = await loadAsiaDeskBook(supabase, user.id)
    const url = new URL(request.url)
    const inst = url.searchParams.get('instrument')
    const one = overlayForInstrument(row, inst)
    return NextResponse.json({
      success: true,
      overlays: row.overlays || {},
      overlay: one,
    })
  } catch (err) {
    logger.error('asia_signal.get_failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = (await getOrCreateUser(request)) ?? (await resolveDeskUser())
    const hookOk = asiaHookAuthorized(request)
    if (!hookOk && !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const deskUser = user ?? (await resolveDeskUser())
    if (!deskUser) {
      return NextResponse.json({ error: 'No desk user' }, { status: 401 })
    }

    const raw = await request.text()
    let payload = parseAsiaWebhookBody(raw)
    if (!payload) {
      try {
        payload = parseAsiaWebhookBody(JSON.stringify(JSON.parse(raw)))
      } catch {
        payload = null
      }
    }
    if (!payload) {
      return NextResponse.json({ error: 'Unrecognized Asia webhook body' }, { status: 400 })
    }

    const supabase = createAdminClient() ?? (await createClient())
    const row = await loadAsiaDeskBook(supabase, deskUser.id)
    const existing = payload.instrument
      ? overlayForInstrument(row, payload.instrument)
      : row.overlays?.GOLD ?? row.overlays?.DOW ?? null
    const overlay = overlayFromWebhook(payload, existing)
    if (!overlay) {
      return NextResponse.json({ error: 'Webhook missing instrument/levels' }, { status: 400 })
    }

    await upsertAsiaOverlay(supabase, deskUser.id, overlay)
    const text = formatAsiaDeskTelegram(overlay)
    let telegram: { sent: boolean; skipped?: string } = { sent: false }
    if (text) {
      const rowAfter = await loadAsiaDeskBook(supabase, deskUser.id)
      const key = asiaTelegramKey(overlay)
      if ((rowAfter.telegramKeys || []).includes(key)) {
        telegram = { sent: false, skipped: 'deduped' }
      } else {
        const sent = await sendTelegramMessage(text)
        if (sent.ok && !sent.skipped) {
          await claimAsiaTelegramKey(supabase, deskUser.id, key)
          telegram = { sent: true }
        } else {
          telegram = {
            sent: false,
            skipped: sent.ok ? sent.reason : sent.error,
          }
        }
      }
    }

    const overlays: Partial<Record<string, AsiaDeskOverlay>> = {
      ...(row.overlays || {}),
      [overlay.instrument]: overlay,
    }
    return NextResponse.json({ success: true, overlay, overlays, telegram })
  } catch (err) {
    logger.error('asia_signal.post_failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
