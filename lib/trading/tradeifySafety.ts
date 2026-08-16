/**
 * Tradeify Growth eval guards that the $400 ladder alone does not cover:
 * open-stop reserve, EOD floor trail, equity-index hedge, red-news lock.
 */

import { tradeifySessionKey } from '@/lib/trading/tradeifyGrowth50k'
import { parseCalendarEventMs } from '@/lib/trading/deskNewsHazard'

export const TRADEIFY_NEWS_LOCK_MS = 5 * 60 * 1000

export type TradeifySafetyFill = {
  instrument?: string | null
  fill_status?: string | null
  entry_timestamp?: string | null
  created_at?: string | null
  exit_timestamp?: string | null
  exit_reason?: string | null
  profit_loss?: number | null
  risk_amount?: number | null
  entry_direction?: string | null
}

const EQUITY_INDEX = new Set(['DOW', 'NASDAQ', 'NIKKEI'])

export function isClosedTradeifyFill(row: TradeifySafetyFill): boolean {
  if (String(row.fill_status || '') !== 'filled') return false
  if (row.exit_timestamp) return true
  return Boolean(row.exit_reason)
}

/** Open fills reserve stop $ (or worse unrealized) against leftover DLL / floor. */
export function openRiskReserved(fills: TradeifySafetyFill[]): number {
  let reserved = 0
  for (const r of fills) {
    if (String(r.fill_status || '') !== 'filled') continue
    if (isClosedTradeifyFill(r)) continue
    const risk = Number(r.risk_amount)
    const pnl = Number(r.profit_loss)
    const fromRisk = Number.isFinite(risk) && risk > 0 ? risk : 0
    const fromUnreal = Number.isFinite(pnl) && pnl < 0 ? -pnl : 0
    reserved += Math.max(fromRisk, fromUnreal)
  }
  return Math.round(reserved * 100) / 100
}

export function realizedSessionPnl(fills: TradeifySafetyFill[]): number {
  let pnl = 0
  for (const r of fills) {
    if (!isClosedTradeifyFill(r)) continue
    const v = Number(r.profit_loss)
    if (Number.isFinite(v)) pnl += v
  }
  return Math.round(pnl * 100) / 100
}

/**
 * Highest closed-session balance. Current 18:00 ET session does not raise the floor.
 */
export function peakEodFromFills(
  rows: TradeifySafetyFill[],
  now: Date = new Date(),
  starting = 50_000
): number {
  const currentKey = tradeifySessionKey(now)
  const bySession = new Map<string, number>()
  for (const r of rows) {
    if (!isClosedTradeifyFill(r)) continue
    const t = r.entry_timestamp || r.created_at
    if (!t) continue
    const key = tradeifySessionKey(new Date(t))
    const v = Number(r.profit_loss)
    if (!Number.isFinite(v)) continue
    bySession.set(key, (bySession.get(key) || 0) + v)
  }
  let balance = starting
  let peak = starting
  for (const key of [...bySession.keys()].sort()) {
    if (key >= currentKey) continue
    balance += bySession.get(key) || 0
    if (balance > peak) peak = balance
  }
  return Math.round(peak * 100) / 100
}

function normSide(raw?: string | null): 'LONG' | 'SHORT' | null {
  const s = String(raw || '').toUpperCase()
  if (s === 'SHORT' || s === 'SELL') return 'SHORT'
  if (s === 'LONG' || s === 'BUY') return 'LONG'
  return null
}

/**
 * Opposite open index vs the next ticket — Tradeify product-group hedge
 * (YM/NQ/NKD), including leftover Tradovate risk we can see on TradePulse.
 */
export function equityIndexHedgeConflict(
  openFills: TradeifySafetyFill[],
  nextInstrument?: string | null,
  nextDirection?: string | null
): boolean {
  const nextInst = String(nextInstrument || '').toUpperCase()
  const nextSide = normSide(nextDirection)
  if (!EQUITY_INDEX.has(nextInst) || !nextSide) return false
  for (const r of openFills) {
    if (String(r.fill_status || '') !== 'filled') continue
    if (isClosedTradeifyFill(r)) continue
    const inst = String(r.instrument || '').toUpperCase()
    const side = normSide(r.entry_direction)
    if (!EQUITY_INDEX.has(inst) || !side) continue
    if (side !== nextSide) return true
  }
  return false
}

export function isTradeifyRedNewsEvent(name?: string | null): boolean {
  const s = String(name || '')
  if (!s.trim()) return false
  return (
    /\b(nfp|non[- ]?farm|payrolls)\b/i.test(s) ||
    /\b(fomc|fed funds|interest rate decision|federal reserve)\b/i.test(s) ||
    /\b(cpi|consumer price)\b/i.test(s)
  )
}

export function tradeifyRedNewsBlocks(
  events: Array<{ time?: string | null; event?: string | null; impact?: string | null }>,
  now: Date = new Date()
): boolean {
  const nowMs = now.getTime()
  for (const ev of events) {
    if (!isTradeifyRedNewsEvent(ev.event)) continue
    const at = parseCalendarEventMs(ev.time, nowMs)
    if (at == null) continue
    if (Math.abs(at - nowMs) <= TRADEIFY_NEWS_LOCK_MS) return true
  }
  return false
}
