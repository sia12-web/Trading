/**
 * Questrade stock ticket → Tradeify look-book.
 * Stock prices are the reason. Index levels use the stock R% on DOW/NASDAQ.
 * Never auto-places.
 */

import { takeProfitFromStopR } from '@/lib/trading/positionSizing'
import {
  buildTradovateMirrorTicket,
  type DeskIndex,
  type TradovateMirrorTicket,
} from '@/lib/trading/tradovateMirror'
import { suggestTradeifyIndex, type QuestradeBookRow } from '@/lib/trading/questradeOrders'
import type { TeamCopyAdvice } from '@/lib/trading/teamTape'
import { teamTapeTarget1_5R, withSignalTarget } from '@/lib/trading/teamTape'

export type QuestradeTradeifyTransfer = {
  sourceId: string
  symbol: string
  side: 'BUY' | 'SELL'
  instrument: DeskIndex
  stockEntry: number
  stockStop: number | null
  stockTarget: number | null
  stockQty: number
  stockRiskDollars: number | null
  stockRiskPct: number | null
  indexEntry: number | null
  indexStop: number | null
  indexTarget: number | null
  tradeifyRiskDollars: number
  advice: TeamCopyAdvice
  ticket: TradovateMirrorTicket | null
  note: string
}

export function stockRiskPct(entry: number, stop: number | null): number | null {
  const e = Number(entry)
  const s = Number(stop)
  if (!(e > 0) || !(s > 0) || e === s) return null
  return Math.round((Math.abs(e - s) / e) * 10000) / 10000
}

export function indexLevelsFromStockR(args: {
  side: 'BUY' | 'SELL'
  indexEntry: number
  riskPct: number | null
  stockStop: number | null
  stockEntry: number
}): { stop: number | null; target: number | null } {
  const entry = Number(args.indexEntry)
  if (!(entry > 0)) return { stop: null, target: null }
  const pct = args.riskPct
  if (pct == null || !(pct > 0)) return { stop: null, target: null }
  const stop =
    args.side === 'SELL' ? entry * (1 + pct) : entry * (1 - pct)
  const target = takeProfitFromStopR({
    entry,
    stop,
    direction: args.side === 'SELL' ? 'SHORT' : 'LONG',
  })
  return {
    stop: Math.round(stop * 100) / 100,
    target: Math.round(target * 100) / 100,
  }
}

export function buildQuestradeTradeifyTransfer(args: {
  row: QuestradeBookRow
  advice: TeamCopyAdvice
  indexLast?: Partial<Record<DeskIndex, number>>
  instrument?: DeskIndex
  accountName?: string | null
}): QuestradeTradeifyTransfer {
  const instrument = args.instrument || suggestTradeifyIndex(args.row.symbol)
  const pct = stockRiskPct(args.row.entry, args.row.stop)
  const indexEntry = args.indexLast?.[instrument] ?? null
  const levels =
    indexEntry != null
      ? indexLevelsFromStockR({
          side: args.row.side,
          indexEntry,
          riskPct: pct,
          stockStop: args.row.stop,
          stockEntry: args.row.entry,
        })
      : { stop: null, target: null }
  const stockTarget =
    args.row.target ??
    teamTapeTarget1_5R({
      side: args.row.side,
      entry: args.row.entry,
      stop: args.row.stop,
    })
  const advice = withSignalTarget(args.advice, {
    sourceId: args.row.sourceId,
    symbol: args.row.symbol,
    side: args.row.side,
    quantity: args.row.quantity,
    entry: args.row.entry,
    stop: args.row.stop,
    target: stockTarget,
    status: args.row.status,
  })
  let ticket: TradovateMirrorTicket | null = null
  if (
    indexEntry != null &&
    levels.stop != null &&
    levels.target != null &&
    args.advice.riskDollars > 0
  ) {
    ticket = buildTradovateMirrorTicket({
      instrument,
      direction: args.row.side === 'SELL' ? 'SHORT' : 'LONG',
      entry: indexEntry,
      stop: levels.stop,
      target: levels.target,
      riskDollars: args.advice.riskDollars,
      accountName: args.accountName,
    })
  }
  const note = [
    `${args.row.symbol} ${args.row.side} × ${args.row.quantity} is the reason — not your Tradovate size.`,
    args.row.kind === 'entry_limit'
      ? 'Questrade working limit. Copy on Tradeify only if you still have a fill and NY is open.'
      : 'Open/filled Questrade book. Growth cannot hold overnight — flatten 16:59 ET.',
    ticket
      ? `Index preview uses ${instrument} last × their stop % (${pct != null ? (pct * 100).toFixed(2) : '—'}%). Recheck at NY open.`
      : 'No index last yet — look at their SL/TP here, then size $ on DOW or NASDAQ at the open.',
  ].join(' ')

  return {
    sourceId: args.row.sourceId,
    symbol: args.row.symbol,
    side: args.row.side,
    instrument,
    stockEntry: args.row.entry,
    stockStop: args.row.stop,
    stockTarget,
    stockQty: args.row.quantity,
    stockRiskDollars: args.row.stockRiskDollars,
    stockRiskPct: pct,
    indexEntry,
    indexStop: levels.stop,
    indexTarget: levels.target,
    tradeifyRiskDollars: args.advice.riskDollars,
    advice,
    ticket,
    note,
  }
}
