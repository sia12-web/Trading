/**
 * Break-even protective stop — one tick past entry on the protective side.
 *
 * Never set SL exactly at entry: client auto-exit seeds/compares with entry and
 * `price <= stop` would market-close a still-profitable book the moment BE is
 * confirmed. OANDA also treats stops at/through market as immediate fills.
 */

import { snapStopToTick } from '@/lib/trading/instrumentTicks'

export type BreakEvenDirection = 'LONG' | 'SHORT' | 'long' | 'short'

export function breakEvenStopPrice(
  instrument: string,
  entryPrice: number,
  direction: BreakEvenDirection
): number {
  const entry = Number(entryPrice)
  const dir = direction === 'long' || direction === 'LONG' ? 'LONG' : 'SHORT'
  if (!(entry > 0) || !Number.isFinite(entry)) return entry
  // snapStopToTick(entry, entry) steps one tick to the protective side
  return snapStopToTick(instrument, entry, entry, dir)
}

/** True when a proposed BE/trail stop would immediately trigger vs live mid. */
export function stopSafeVersusMarket(args: {
  stop: number
  currentPrice: number
  isLong: boolean
  /** Points of cushion beyond the stop (indices ≈ 2–5 pts) */
  pad?: number
}): boolean {
  const pad = args.pad ?? 2
  const { stop, currentPrice, isLong } = args
  if (!(stop > 0) || !(currentPrice > 0)) return false
  return isLong ? stop < currentPrice - pad : stop > currentPrice + pad
}

/**
 * Client/server guard: refuse a claimed stop-hit market close when live price
 * is still clearly on the profitable side of the stop (false BE flatten).
 */
export function livePriceConfirmsStopHit(args: {
  currentPrice: number
  stopLoss: number
  isLong: boolean
  /** Allow a small touch tolerance in points */
  tolerance?: number
}): boolean {
  const tol = args.tolerance ?? 1
  const { currentPrice, stopLoss, isLong } = args
  if (!(currentPrice > 0) || !(stopLoss > 0)) return false
  return isLong
    ? currentPrice <= stopLoss + tol
    : currentPrice >= stopLoss - tol
}
