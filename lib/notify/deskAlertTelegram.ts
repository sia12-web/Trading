/**
 * Desk toasts vs Telegram.
 * Live product: Telegram on CALL-legal setup (`call_setup`) and auction
 * entrance (`auction_setup`). Range lock, clock, news, BE stay on-screen.
 */

import { isNyTelegramKind } from '@/lib/trading/nyDeskStrategy'

export function formatDeskAlertToast(title: string, body: string): string {
  const t = String(title || '').trim()
  const b = String(body || '').trim()
  if (!t) return b
  if (!b) return t
  if (b === t || b.startsWith(`${t} —`) || b.startsWith(`${t} `)) return b
  return `${t} — ${b}`
}

/** Null = do not send Telegram. Allowlist: CALL-legal setup only. */
export function deskAlertTelegramText(alert: {
  kind?: string
  telegram?: string | null
  title?: string
  body?: string
}): string | null {
  if (!isNyTelegramKind(alert.kind)) return null
  if (typeof alert.telegram === 'string') {
    const trimmed = alert.telegram.trim()
    return trimmed || null
  }
  const fallback = [alert.title, alert.body]
    .filter((s) => typeof s === 'string' && s.trim())
    .join('\n')
    .trim()
  return fallback || null
}
