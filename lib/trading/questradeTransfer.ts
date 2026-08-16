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
import {
  TRADEIFY_RISK_FIRST_DOLLARS,
  tradeifyRiskStepDollars,
} from '@/lib/trading/tradeifyGrowth50k'

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
  fillNumber: number
  fillsUsed: number
  fillsLeft: number
  riskLabel: string
  sessionReset: boolean
  canSize: boolean
  advice: TeamCopyAdvice
  ticket: TradovateMirrorTicket | null
  note: string
}

export type QuestradeCopyRisk = {
  fillNumber: number
  fillsUsed: number
  fillsLeft: number
  riskDollars: number
  canSize: boolean
  sessionReset: boolean
  label: string
}

/** Next leftover NYC fill. Flatten / new session → fill 1 at $400. */
export function questradeCopyRisk(advice: TeamCopyAdvice): QuestradeCopyRisk {
  if (advice.mustFlatten) {
    return {
      fillNumber: 1,
      fillsUsed: 0,
      fillsLeft: 3,
      riskDollars: TRADEIFY_RISK_FIRST_DOLLARS,
      canSize: false,
      sessionReset: true,
      label: 'Session over · next is fill 1/3 · $400',
    }
  }
  if (advice.fillsLeft <= 0) {
    return {
      fillNumber: 3,
      fillsUsed: 3,
      fillsLeft: 0,
      riskDollars: TRADEIFY_RISK_FIRST_DOLLARS,
      canSize: false,
      sessionReset: false,
      label: '3/3 used · no Tradeify size until 18:00 ET',
    }
  }
  const step = tradeifyRiskStepDollars(advice.fillsUsed)
  const risk = advice.riskDollars > 0 ? advice.riskDollars : step
  return {
    fillNumber: advice.nextFillNumber,
    fillsUsed: advice.fillsUsed,
    fillsLeft: advice.fillsLeft,
    riskDollars: risk,
    canSize: true,
    sessionReset: advice.fillsUsed === 0,
    label: `Fill ${advice.nextFillNumber}/3 · $${risk}`,
  }
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
  const copyRisk = questradeCopyRisk(args.advice)
  const useStockR = args.row.asset === 'stock'
  const pct = useStockR ? stockRiskPct(args.row.entry, args.row.stop) : null
  const indexEntry = args.indexLast?.[instrument] ?? null
  const levels =
    useStockR && indexEntry != null
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
    (copyRisk.canSize || copyRisk.sessionReset) &&
    indexEntry != null &&
    levels.stop != null &&
    levels.target != null &&
    copyRisk.riskDollars > 0
  ) {
    ticket = buildTradovateMirrorTicket({
      instrument,
      direction: args.row.side === 'SELL' ? 'SHORT' : 'LONG',
      entry: indexEntry,
      stop: levels.stop,
      target: levels.target,
      riskDollars: copyRisk.riskDollars,
      accountName: args.accountName,
    })
  }
  const note = [
    `${args.row.label || args.row.symbol} ${args.row.side} × ${args.row.quantity} is the reason — not your Tradovate size.`,
    `Your leftover NYC fill is ${copyRisk.label}.`,
    args.row.kind === 'entry_limit'
      ? 'Questrade working limit. Copy on Tradeify only if you still have a fill and NY is open.'
      : 'Open/filled Questrade book. Growth cannot hold overnight — flatten 16:59 ET.',
    copyRisk.sessionReset
      ? 'Session ended — size is back to fill 1/3 · $400 until you take the next NYC trade.'
      : null,
    !copyRisk.canSize && !copyRisk.sessionReset
      ? 'No Tradeify fill left this session. After 18:00 ET the book resets to fill 1/3 · $400.'
      : null,
    ticket
      ? `Index preview uses ${instrument} last × their stop % (${pct != null ? (pct * 100).toFixed(2) : '—'}%) at $${copyRisk.riskDollars}. Recheck at NY open.`
      : args.row.asset === 'option'
        ? `Option — do not copy their contract size. Next Tradeify risk is $${copyRisk.riskDollars} on ${instrument}.`
        : 'No index last yet — look at their SL/TP here, then size $ on DOW or NASDAQ at the open.',
  ]
    .filter(Boolean)
    .join(' ')

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
    tradeifyRiskDollars: copyRisk.riskDollars,
    fillNumber: copyRisk.fillNumber,
    fillsUsed: copyRisk.fillsUsed,
    fillsLeft: copyRisk.fillsLeft,
    riskLabel: copyRisk.label,
    sessionReset: copyRisk.sessionReset,
    canSize: copyRisk.canSize,
    advice,
    ticket,
    note,
  }
}
