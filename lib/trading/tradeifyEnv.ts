/**
 * Tradeify / Tradovate account labels from env.
 * Order id stays server-only — never send it to the browser.
 */

export function tradeifyAccountName(): string | null {
  const name = process.env.TRADEIFY_ACCOUNT_NAME?.trim()
  if (name) return name
  const id = process.env.TRADEIFY_ACCOUNT_ID?.trim()
  return id || null
}

export function tradeifyOrderId(): string | null {
  const id = process.env.TRADEIFY_ORDER_ID?.trim()
  return id || null
}
