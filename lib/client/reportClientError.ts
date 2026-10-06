/** Send a browser exception to the server log. Never throws. */
export function reportClientError(error: unknown, label: string): void {
  if (typeof window === 'undefined') return
  const err = error instanceof Error ? error : new Error(String(error))
  const payload = {
    message: err.message.slice(0, 500),
    stack: (err.stack || '').slice(0, 2000),
    label: label.slice(0, 80),
    href: window.location.href.slice(0, 300),
  }
  try {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify(payload),
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}
