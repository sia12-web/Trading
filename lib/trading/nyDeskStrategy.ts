/**
 * The only live NY strategy. CALL + Perf + Region + Sit + the ticket.
 * HTF / Leo / Asia / mid-fade / 2R are not this product.
 *
 * Windows: Open range → OR30 → IB (session cap 3 fills, 2 stop-outs = out).
 * Hunt: CALL-legal ±10 only (LONG below low, SHORT above high). Never 50% mid.
 * Ticket: SL beyond active range · TP 1.5R · $400 → $250 → $150.
 * Stay-out (NTREND / NCONV) is a per-name CALL WAIT after OR30. Does not flatten.
 */

import type { DeskCallSide } from '@/lib/trading/deskCall'
import type { RangeEdgeKind } from '@/lib/trading/rangeEdgeEntryGate'

export const NY_DESK_STRATEGY_ID = 'ny_call_legal_band_v1' as const

export const NY_TICKET_R = 1.5
export const NY_RISK_LADDER_DOLLARS = [400, 250, 150] as const
export const NY_MAX_FILLS = 3
export const NY_MAX_STOP_OUTS = 2
export const NY_WINDOWS = ['morning', 'or30', 'ib'] as const

/** Telegram kinds that leave the phone — CALL ±10 and auction entrance. */
export const NY_TELEGRAM_KIND = 'call_setup' as const
export const AUCTION_TELEGRAM_KIND = 'auction_setup' as const

export function isNyTelegramKind(kind: string | null | undefined): boolean {
  const k = String(kind || '').toLowerCase()
  return k === NY_TELEGRAM_KIND || k === AUCTION_TELEGRAM_KIND
}

/** True when CALL is hunting and price is on the legal edge (not mid, not the opposite). */
export function isNyCallSetup(args: {
  side: DeskCallSide | null | undefined
  edge?: RangeEdgeKind | null
  bookLocked?: boolean
}): boolean {
  if (args.bookLocked) return false
  if (args.side !== 'LONG' && args.side !== 'SHORT') return false
  if (args.edge !== 'high' && args.edge !== 'low') return false
  return args.side === 'LONG' ? args.edge === 'low' : args.edge === 'high'
}

export function formatCallSetupTelegram(args: {
  instrument: string
  side: 'LONG' | 'SHORT'
  rangeKey: string
  entryPrice: number
  edge: 'high' | 'low'
  livePrice: number
}): string {
  const edge = args.edge === 'low' ? 'LOW' : 'HIGH'
  return [
    `SETUP ${args.instrument} · CALL ${args.side}`,
    `${args.rangeKey} legal ±10 ${edge} @ ${args.entryPrice.toLocaleString()}`,
    `Live ${args.livePrice.toLocaleString()}`,
    `Ticket: SL beyond range · TP ${NY_TICKET_R}R · $${NY_RISK_LADDER_DOLLARS[0]}→$${NY_RISK_LADDER_DOLLARS[1]}→$${NY_RISK_LADDER_DOLLARS[2]}`,
  ].join('\n')
}
