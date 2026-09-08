/**
 * POST /api/trading/leo/notify
 * Sends Leo Desk notifications directly to the trader via Telegram.
 */

import { NextResponse } from 'next/server'
import { sendTelegramMessage, telegramConfigured } from '@/lib/notify/telegram'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

interface LeoNotifyBody {
  type: 'TELEGRAM_ALERT' | 'STAGNATION_CLOSE' | 'POSITION_CLOSE'
  instrument: string
  session?: string
  referencePoint?: string
  price: number
  volume?: string
  retestRatio?: number
  confidence?: string
  message?: string
  pnlPoints?: number
  pnlCad?: number
  durationMinutes?: number
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as LeoNotifyBody

    if (!body.instrument) {
      return NextResponse.json({ error: 'Missing instrument' }, { status: 400 })
    }

    let text = ''

    if (body.type === 'STAGNATION_CLOSE') {
      text = [
        `🛑 *LEO DESK EXECUTION: STAGNATION EXIT*`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `• *Instrument*: ${body.instrument}`,
        `• *Exit Price*: ${body.price.toFixed(2)}`,
        `• *Duration in Trade*: ${body.durationMinutes != null ? `${body.durationMinutes.toFixed(1)}m` : 'Timed out'}`,
        `• *Result*: ${body.pnlPoints != null ? `${body.pnlPoints >= 0 ? '+' : ''}${body.pnlPoints.toFixed(1)} pts` : 'Flat'}${body.pnlCad != null ? ` (${body.pnlCad >= 0 ? '+' : ''}${body.pnlCad.toFixed(2)} CAD)` : ''}`,
        `• *Reason*: Stagnation timeout triggered after failing to move into profit.`,
        `• *Status*: Position flattened on desk & broker.`,
      ].join('\n')
    } else if (body.type === 'POSITION_CLOSE') {
      text = [
        `⚡ *LEO DESK EXECUTION: POSITION CLOSED*`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `• *Instrument*: ${body.instrument}`,
        `• *Exit Price*: ${body.price.toFixed(2)}`,
        `• *P&L*: ${body.pnlPoints != null ? `${body.pnlPoints >= 0 ? '+' : ''}${body.pnlPoints.toFixed(1)} pts` : ''}`,
        `• *Reason*: ${body.message ?? 'Direct trader command'}`,
      ].join('\n')
    } else {
      // TELEGRAM_ALERT for reference level touch / volume / confidence
      const sessionStr = body.session ? ` [${body.session}]` : ''
      const volStr = body.volume ? ` (${body.volume})` : ''
      const retestStr = body.retestRatio != null ? ` [Retest ${body.retestRatio.toFixed(2)}x]` : ''
      const confStr = body.confidence ? `\n• *Confidence*: ${body.confidence}` : ''

      text = [
        `🚨 *LEO DESK ALERT${sessionStr}*`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `• *Instrument*: ${body.instrument}`,
        `• *Reference Level*: ${body.referencePoint ?? 'Chart Reference'}${volStr}${retestStr}`,
        `• *Current Price*: ${body.price.toFixed(2)}`,
        ...(body.volume ? [`• *Volume Confirmation*: ${body.volume}`] : []),
        ...(body.retestRatio != null ? [`• *Retest Ratio*: ${body.retestRatio.toFixed(2)}x`] : []),
        confStr,
        `• *Note*: ${body.message ?? 'Price reached target reference zone. Review chart auction action.'}`,
      ]
        .filter(Boolean)
        .join('\n')
    }

    logger.info('leo.telegram_notify', {
      type: body.type,
      instrument: body.instrument,
      price: body.price,
      configured: telegramConfigured(),
    })

    const sendRes = await sendTelegramMessage(text)

    return NextResponse.json({
      success: sendRes.ok,
      telegramConfigured: telegramConfigured(),
      skipped: 'skipped' in sendRes ? sendRes.skipped : false,
      reason: 'reason' in sendRes ? sendRes.reason : undefined,
      text,
    })
  } catch (err: any) {
    logger.error('leo.telegram_notify_failed', { err: err?.message })
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 })
  }
}
