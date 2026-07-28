/**
 * Telegram Bot API — soft-fail when env is missing.
 */

import { logger } from '@/lib/utils/logger'

export type TelegramSendResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string }

export function telegramConfigured(): boolean {
  return !!(
    process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim()
  )
}

export async function sendTelegramMessage(
  text: string
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
  if (!token || !chatId) {
    return {
      ok: true,
      skipped: true,
      reason: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set',
    }
  }
  const body = String(text || '').trim()
  if (!body) {
    return { ok: false, error: 'Empty telegram message' }
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: body.slice(0, 3900),
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.error('telegram.send_failed', {
        status: res.status,
        err: errText.slice(0, 200),
      })
      return { ok: false, error: `Telegram HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    logger.error('telegram.send_error', { err })
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Telegram send failed',
    }
  }
}
