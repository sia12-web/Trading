/**
 * Desk money is account currency — match OANDA home currency (practice = CAD).
 */

export const DESK_CURRENCY = (
  process.env.DESK_CURRENCY ||
  process.env.NEXT_PUBLIC_DESK_CURRENCY ||
  'CAD'
).toUpperCase()

/** Format for UI — always show currency code so it is never mistaken for USD. */
export function formatDeskMoney(
  n: number | null | undefined,
  opts?: { signed?: boolean; compact?: boolean }
): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const signed = opts?.signed === true
  const abs = Math.abs(n).toLocaleString('en-CA', {
    minimumFractionDigits: opts?.compact ? 0 : 2,
    maximumFractionDigits: 2,
  })
  const body = `${DESK_CURRENCY} ${abs}`
  if (!signed) return body
  return `${n >= 0 ? '+' : '−'}${body}`
}

export function deskCurrencyLabel(): string {
  return DESK_CURRENCY
}
