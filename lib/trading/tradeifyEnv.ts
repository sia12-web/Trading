/**
 * Personal Futures account labels from env.
 * Order id stays server-only — never send it to the browser.
 */

export function tradeifyAccountName(): string | null {
  const name = process.env.FUTURES_ACCOUNT_NAME?.trim() || process.env.TRADEIFY_ACCOUNT_NAME?.trim()
  if (name) return name
  const id = process.env.FUTURES_ACCOUNT_ID?.trim() || process.env.TRADEIFY_ACCOUNT_ID?.trim()
  return id || 'Personal Futures'
}

export function tradeifyOrderId(): string | null {
  const id = process.env.FUTURES_ORDER_ID?.trim() || process.env.TRADEIFY_ORDER_ID?.trim()
  return id || null
}
