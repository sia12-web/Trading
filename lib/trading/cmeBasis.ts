/**
 * Map OANDA CFD mids onto CME futures so live ticks stay on Tradovate scale.
 * Basis is futures last − OANDA mid (typically ~40–80 Dow pts / ~50–90 Nasdaq pts).
 */

/** Reject a basis larger than this fraction of price (wrong product / bad print). */
export const CME_BASIS_MAX_FRAC = 0.01

export function cmeBasisFromPair(
  oandaMid: number,
  futuresLast: number
): number | null {
  if (!(oandaMid > 0) || !(futuresLast > 0)) return null
  const basis = futuresLast - oandaMid
  if (Math.abs(basis) / oandaMid > CME_BASIS_MAX_FRAC) return null
  return basis
}

export function applyCmeBasis(
  oandaPrice: number,
  basis: number | null
): number {
  if (basis == null || !(oandaPrice > 0)) return oandaPrice
  return oandaPrice + basis
}
