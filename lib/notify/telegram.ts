/**
 * Telegram Bot API — notifications disabled.
 * All alerts are rendered directly on the website.
 */

export type TelegramSendResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string }

export function telegramConfigured(): boolean {
  return false
}

export async function sendTelegramMessage(
  _text: string
): Promise<TelegramSendResult> {
  return {
    ok: true,
    skipped: true,
    reason: 'Telegram notifications disabled — website only',
  }
}
