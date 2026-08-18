/**
 * Break-even protective stop — one tick past entry on the protective side.
 *
 * Never set SL exactly at entry: client auto-exit seeds/compares with entry and
 * `price <= stop` would market-close a still-profitable book the moment BE is
 * confirmed. OANDA also treats stops at/through market as immediate fills.
 */

import { snapStopToTick } from '@/lib/trading/instrumentTicks'

export type BreakEvenDirection = 'LONG' | 'SHORT' | 'long' | 'short'

/** BE is offered only after this fraction of Entry→TP (must match the →TP bar). */
export function breakEvenTpProgressThreshold(instrument: string): number {
  if (instrument === 'NASDAQ') return 0.5
  if (instrument === 'NIKKEI') return 0.35
  return 0.25
}

export function tradeTpProgress(args: {
  entry: number
  takeProfit: number
  livePrice: number
  isLong: boolean
}): { moved: number; distance: number; progress: number; inProfit: boolean } {
  const entry = Number(args.entry)
  const tp = Number(args.takeProfit)
  const live = Number(args.livePrice)
  const distance = args.isLong ? tp - entry : entry - tp
  const moved = args.isLong ? live - entry : entry - live
  const inProfit = Number.isFinite(moved) && moved > 0
  const progress =
    Number.isFinite(distance) && distance > 0
      ? Math.max(0, Math.min(1, moved / distance))
      : 0
  return { moved, distance, progress, inProfit }
}

/** True only when live is in profit toward TP by the instrument threshold. */
export function breakEvenShouldOffer(args: {
  instrument: string
  entry: number
  takeProfit: number
  livePrice: number
  isLong: boolean
}): boolean {
  const { inProfit, progress } = tradeTpProgress(args)
  return inProfit && progress >= breakEvenTpProgressThreshold(args.instrument)
}

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
