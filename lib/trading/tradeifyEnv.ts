/**
 * Personal Futures account labels from env.
 * Order id stays server-only — never send it to the browser.
 */

export function personalFuturesAccountName(): string | null {
  const name =
    process.env.FUTURES_ACCOUNT_NAME?.trim() ||
    process.env.PERSONAL_FUTURES_ACCOUNT?.trim() ||
    process.env.ACCOUNT_NAME?.trim()
  if (name) return name
  const id = process.env.FUTURES_ACCOUNT_ID?.trim() || process.env.ACCOUNT_ID?.trim()
  return id || 'Personal Futures'
}
export const tradeifyAccountName = personalFuturesAccountName

export function personalFuturesOrderId(): string | null {
  const id = process.env.FUTURES_ORDER_ID?.trim() || process.env.ORDER_ID?.trim()
  return id || null
}
export const tradeifyOrderId = personalFuturesOrderId
