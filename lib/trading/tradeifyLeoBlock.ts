/**
 * Personal Futures Desk Risk copy for Leo + Telegram.
 * Clean personal risk model — no prop firm eval rules.
 */

import { deskLocalHmsAsTraderDisplay } from '@/lib/chart/traderDisplayTz'
import type { LiveJournalInstrument } from '@/lib/trading/journalHistory'
import {
  TRADEIFY_DLL_DOLLARS,
  TRADEIFY_FLATTEN_ET,
  TRADEIFY_RISK_FIRST_DOLLARS,
  TRADEIFY_RISK_SECOND_DOLLARS,
  TRADEIFY_RISK_THIRD_DOLLARS,
  type TradeifyDeskStatus,
  type TradeifyRefuseReason,
} from '@/lib/trading/tradeifyGrowth50k'
type InstrumentPnl = { fills: number; pnl: number }

export type TradeifyLeoSnapshot = {
  active: true
  asOfIso: string
  flattenMontreal: string
  leftoverDll: number
  dllUsed: number
  dllCap: number
  floorRoom: number
  fillsUsed: number
  stepDollars: number
  riskDollars: number
  dailyPnl: number
  stopOutsToday: number
  status: TradeifyDeskStatus
  refuseReason: TradeifyRefuseReason | string
  refuseMessage: string
  allowed: boolean
  byInstrument?: Record<LiveJournalInstrument, InstrumentPnl>
}

export function tradeifyFlattenMontreal(now: Date = new Date()): string {
  return `${deskLocalHmsAsTraderDisplay(TRADEIFY_FLATTEN_ET, 'America/New_York', now)} Montreal`
}

export function tradeifyLeoEntryRule(instrument: string): string {
  const tokyo = instrument === 'NIKKEI'
  const windows = tokyo
    ? 'up to 2 each: AM/OR30 + US Range + IB'
    : 'up to 2 each: AM/OR30 + IB + LN'
  return `Session max 3 fills total (${windows}). Personal Futures: $${TRADEIFY_RISK_FIRST_DOLLARS} → $${TRADEIFY_RISK_SECOND_DOLLARS} → $${TRADEIFY_RISK_THIRD_DOLLARS} by fill #. Shared daily risk across Nikkei + NY; session rolls 18:00 ET. Next window unlocks when prior clock ends or probes are exhausted, but the 3-fill session cap always wins. Working limits do not count until filled. Voice and AI never place orders. Range H/L = retail bait. Desk hunts stops just beyond edges with POC/AVWAP confluence. Entries only within ±10 of active range high or low (never 50% mid). Ticket sets initial SL beyond active range (or zone floor) and TP at 1.5R of that stop (1:1.5); post-fill BE/trail manage is separate.`
}

function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function instrumentLine(
  by: TradeifyLeoSnapshot['byInstrument']
): string | null {
  if (!by) return null
  const order: LiveJournalInstrument[] = ['NIKKEI', 'NASDAQ', 'DOW', 'GOLD', 'CRUDE', 'SILVER', 'RUSSELL']
  const parts = order
    .filter((k) => {
      const row = by[k]
      if (!row) return k === 'NIKKEI' || k === 'NASDAQ' || k === 'DOW'
      return k === 'NIKKEI' || k === 'NASDAQ' || k === 'DOW' || row.fills > 0 || row.pnl !== 0
    })
    .map((k) => {
      const row = by[k] ?? { fills: 0, pnl: 0 }
      return `${k} ${row.fills} fills / ${money(row.pnl)}`
    })
  return `Shared already used: ${parts.join(' · ')}`
}

/** Ground-truth block for Leo DESK CONTEXT. Empty string if snapshot missing. */
export function formatTradeifyLeoBlock(snap: TradeifyLeoSnapshot | null | undefined): string {
  if (!snap?.active) return ''
  const lock =
    snap.allowed
      ? 'entries open'
      : snap.refuseMessage || `desk locked (${snap.refuseReason})`
  const inst = instrumentLine(snap.byInstrument)
  return [
    `PERSONAL FUTURES RISK $50k (as-of ${snap.asOfIso}):`,
    `Mode ON.`,
    `Shared session (Nikkei + NY) rolls 18:00 ET.`,
    `Fills ${snap.fillsUsed}/3 · next stop ${money(snap.riskDollars)} (step ${money(snap.stepDollars)})`,
    `DLL leftover ${money(snap.leftoverDll)} of ${money(snap.dllCap)} (used ${money(snap.dllUsed)})`,
    `Day P&L ${money(snap.dailyPnl)} · status=${snap.status} · ${lock}`,
    inst,
  ]
    .filter(Boolean)
    .join('\n')
}

/** One scannable Telegram paragraph. */
export function formatTradeifyTelegramBlock(
  snap: TradeifyLeoSnapshot | null | undefined
): string {
  if (!snap?.active) return ''
  const lock = snap.allowed ? 'can trade' : snap.refuseMessage || 'desk locked'
  return [
    `Personal Futures $50k · as of ${snap.asOfIso}`,
    `next ${money(snap.riskDollars)} · fills ${snap.fillsUsed}/3`,
    `DLL left ${money(snap.leftoverDll)} / ${money(TRADEIFY_DLL_DOLLARS)} · day ${money(snap.dailyPnl)} · ${lock}`,
  ].join('\n')
}

export function tradeifyScheduleRiskLine(): string {
  return `Ladder 2/2/2 · Personal Futures $${TRADEIFY_RISK_FIRST_DOLLARS} → $${TRADEIFY_RISK_SECOND_DOLLARS} → $${TRADEIFY_RISK_THIRD_DOLLARS}`
}

export const personalScheduleRiskLine = tradeifyScheduleRiskLine
export const formatPersonalTelegramBlock = formatTradeifyTelegramBlock
export const personalLeoEntryRule = tradeifyLeoEntryRule
export const personalFlattenMontreal = tradeifyFlattenMontreal
