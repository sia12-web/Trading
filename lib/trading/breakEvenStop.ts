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

/**
 * Lift an OANDA fill onto the desk (CME) scale used by TP / SL / live quotes.
 * Ticket TP/SL stay on CME; `entry_price` is overwritten with the broker fill.
 * Mixing those spaces makes `inProfit` true while the Tradovate book is losing.
 *
 * Returns null when the books are mixed and cannot be aligned — callers must
 * fail closed (no BE / trail / scale) rather than guess.
 */
export function deskProgressPrices(args: {
  entry: number
  takeProfit: number
  livePrice: number
  isLong: boolean
  stopLoss?: number | null
  brokerFill?: number | null
  liveOanda?: number | null
  riskAmount?: number | null
  positionSize?: number | null
}): { entry: number; takeProfit: number; livePrice: number } | null {
  const entry = Number(args.entry)
  const tp = Number(args.takeProfit)
  const live = Number(args.livePrice)
  if (!(entry > 0) || !(tp > 0) || !(live > 0)) return null

  const sl = Number(args.stopLoss)
  const fill = Number(args.brokerFill)
  const oanda = Number(args.liveOanda)
  const bracketsOk =
    Number.isFinite(sl) && sl > 0
      ? args.isLong
        ? sl < entry && entry < tp
        : tp < entry && entry < sl
      : args.isLong
        ? entry < tp
        : tp < entry

  const entryIsOandaFill =
    fill > 0 && Number.isFinite(fill) && Math.abs(entry - fill) <= 2

  if (bracketsOk && !entryIsOandaFill) {
    return { entry, takeProfit: tp, livePrice: live }
  }

  if (live > 0 && oanda > 0) {
    const basis = live - oanda
    if (Number.isFinite(basis) && Math.abs(basis) / oanda <= 0.01) {
      return { entry: entry + basis, takeProfit: tp, livePrice: live }
    }
  }

  const riskPts =
    Number(args.riskAmount) > 0 && Number(args.positionSize) > 0
      ? Number(args.riskAmount) / Number(args.positionSize)
      : NaN
  if (Number.isFinite(sl) && sl > 0 && Number.isFinite(riskPts) && riskPts > 1) {
    const recovered = args.isLong ? sl + riskPts : sl - riskPts
    const recoveredOk = args.isLong
      ? sl < recovered && recovered < tp
      : tp < recovered && recovered < sl
    if (recoveredOk) return { entry: recovered, takeProfit: tp, livePrice: live }
  }

  if (bracketsOk) return { entry, takeProfit: tp, livePrice: live }
  return null
}

export function alignedTradeTpProgress(
  args: Parameters<typeof deskProgressPrices>[0]
): ReturnType<typeof tradeTpProgress> & { aligned: boolean } {
  const desk = deskProgressPrices(args)
  if (!desk) {
    return { moved: 0, distance: 0, progress: 0, inProfit: false, aligned: false }
  }
  return { ...tradeTpProgress({ ...desk, isLong: args.isLong }), aligned: true }
}

/** True only when live is in profit toward TP by the instrument threshold. */
export function breakEvenShouldOffer(args: {
  instrument: string
  entry: number
  takeProfit: number
  livePrice: number
  isLong: boolean
  stopLoss?: number | null
  brokerFill?: number | null
  liveOanda?: number | null
  riskAmount?: number | null
  positionSize?: number | null
}): boolean {
  const stats = alignedTradeTpProgress(args)
  if (!stats.aligned || !stats.inProfit) return false
  return stats.progress >= breakEvenTpProgressThreshold(args.instrument)
}

export function trailTpProgressThreshold(instrument: string): number {
  if (instrument === 'NASDAQ') return 0.6
  if (instrument === 'NIKKEI') return 0.45
  return 0.3
}

/** Trail only when the desk book is in profit and past the trail threshold. */
export function trailShouldOffer(args: Parameters<typeof breakEvenShouldOffer>[0]): boolean {
  const stats = alignedTradeTpProgress(args)
  if (!stats.aligned || !stats.inProfit) return false
  return stats.progress >= trailTpProgressThreshold(args.instrument)
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
