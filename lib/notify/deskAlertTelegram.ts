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

/** Null = do not send Telegram. Sends ONLY high-conviction trade entry signals. */
export function deskAlertTelegramText(alert: {
  kind?: string
  telegram?: string | null
  title?: string
  body?: string
}): string | null {
  const kind = String(alert.kind || '').toLowerCase()
  const title = String(alert.title || '').toLowerCase()
  const body = String(alert.body || '').toLowerCase()

  // Suppress price touch and band proximity alerts (toast-only on screen)
  if (
    kind.includes('price_touch') ||
    kind.includes('range_edge') ||
    title.includes('price alert') ||
    title.includes('band') ||
    body.includes('hit your chart alert')
  ) {
    return null
  }

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
