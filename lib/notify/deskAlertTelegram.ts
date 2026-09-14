/**
 * Desk toasts vs Telegram.
 * Live product: Telegram on CALL-legal setup (`call_setup`) and auction
 * entrance (`auction_setup`). Range lock, clock, news, BE stay on-screen.
 */


export function formatDeskAlertToast(title: string, body: string): string {
  const t = String(title || '').trim()
  const b = String(body || '').trim()
  if (!t) return b
  if (!b) return t
  if (b === t || b.startsWith(`${t} —`) || b.startsWith(`${t} `)) return b
  return `${t} — ${b}`
}

/** Null = do not send Telegram. All Telegram notifications have been removed in favor of on-screen desk alerts and audio chimes. */
export function deskAlertTelegramText(_alert: {
  kind?: string
  telegram?: string | null
  title?: string
  body?: string
}): string | null {
  return null
}
