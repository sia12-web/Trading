/**
 * Desk toasts vs Telegram.
 * Explicit empty `telegram` = on-screen only (CALL WAIT / off-band deny).
 * Do not fall back to title+body — that spammed Telegram on every band click.
 */

export function formatDeskAlertToast(title: string, body: string): string {
  const t = String(title || '').trim()
  const b = String(body || '').trim()
  if (!t) return b
  if (!b) return t
  if (b === t || b.startsWith(`${t} —`) || b.startsWith(`${t} `)) return b
  return `${t} — ${b}`
}

/** Null = do not send Telegram. */
export function deskAlertTelegramText(alert: {
  telegram?: string | null
  title?: string
  body?: string
}): string | null {
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
