/**
 * Tradeify Growth $50k copy for Leo + Telegram (Slice 5).
 * Silent when the profile is off — callers must not print this block.
 */

import { deskLocalHmsAsTraderDisplay } from '@/lib/chart/traderDisplayTz'
import type { LiveJournalInstrument } from '@/lib/trading/journalHistory'
import {
  TRADEIFY_DLL_DOLLARS,
  TRADEIFY_FLATTEN_ET,
  TRADEIFY_GREEN_DAY_LOCK_DOLLARS,
  TRADEIFY_MAX_STOP_OUTS,
  TRADEIFY_PROFIT_TARGET,
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
  return `Session max 3 fills total, win/loss/breakeven all count (${windows}). Tradeify Growth $50k: $${TRADEIFY_RISK_FIRST_DOLLARS} → $${TRADEIFY_RISK_SECOND_DOLLARS} → $${TRADEIFY_RISK_THIRD_DOLLARS} by fill # (auto-shrink to leftover DLL / floor; min $50). Ignore OANDA 2% cash risk. Shared daily $ across Nikkei + NY; session rolls 18:00 ET. Day lock: ${TRADEIFY_MAX_STOP_OUTS} stop-outs or +$${TRADEIFY_GREEN_DAY_LOCK_DOLLARS}. Flatten by ~16:59 Montreal — no overnight, no "pass today". Next window unlocks when prior clock ends or probes are exhausted, but the 3-fill session cap always wins. Working limits do not count until filled. Lunch 11:30 is confirm-close only; unconfirmed books still flatten at the Tradeify cut. Voice never places orders. Range H/L = retail bait. Desk hunts stops just beyond edges with POC/AVWAP confluence. Entries only within ±10 of active range high or low (never 50% mid). Ticket sets initial SL beyond active range (or zone floor) and TP at 1.5R of that stop (1:1.5); post-fill BE/trail manage is separate.`
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
  const order: LiveJournalInstrument[] = ['NIKKEI', 'NASDAQ', 'DOW', 'GOLD', 'CRUDE']
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
      : snap.refuseMessage || `day locked (${snap.refuseReason})`
  const inst = instrumentLine(snap.byInstrument)
  return [
    `TRADEIFY GROWTH $50k (as-of ${snap.asOfIso}):`,
    `Mode ON — ignore OANDA 2% / 1% / 0.5% cash risk. Do not say "pass today". Do not hold overnight.`,
    `Shared session (Nikkei + NY) rolls 18:00 ET.`,
    `Fills ${snap.fillsUsed}/3 · next stop ${money(snap.riskDollars)} (step ${money(snap.stepDollars)}) · stops ${snap.stopOutsToday}/${TRADEIFY_MAX_STOP_OUTS}`,
    `DLL leftover ${money(snap.leftoverDll)} of ${money(snap.dllCap)} (used ${money(snap.dllUsed)}) · floor room ${money(snap.floorRoom)}`,
    `Day P&L ${money(snap.dailyPnl)} · green lock +$${TRADEIFY_GREEN_DAY_LOCK_DOLLARS} · target +$${TRADEIFY_PROFIT_TARGET} · status=${snap.status} · ${lock}`,
    `Flatten by ${snap.flattenMontreal} — no overnight.`,
    inst,
  ]
    .filter(Boolean)
    .join('\n')
}

/** One scannable Telegram paragraph. Empty when profile off. */
export function formatTradeifyTelegramBlock(
  snap: TradeifyLeoSnapshot | null | undefined
): string {
  if (!snap?.active) return ''
  const lock = snap.allowed ? 'can trade' : snap.refuseMessage || 'day locked'
  return [
    `Tradeify $50k · as of ${snap.asOfIso}`,
    `next ${money(snap.riskDollars)} · fills ${snap.fillsUsed}/3 · stops ${snap.stopOutsToday}/${TRADEIFY_MAX_STOP_OUTS}`,
    `DLL left ${money(snap.leftoverDll)} / ${money(TRADEIFY_DLL_DOLLARS)} · floor ${money(snap.floorRoom)} · day ${money(snap.dailyPnl)}`,
    `flatten ${snap.flattenMontreal} · no overnight · no pass-today · ${lock}`,
  ].join('\n')
}

export const LIVE_VOICE_TRADEIFY_ADDENDUM = `
TRADEIFY GROWTH $50k MODE (this desk is always Tradeify — never OANDA cash %)
- Size is $${TRADEIFY_RISK_FIRST_DOLLARS} → $${TRADEIFY_RISK_SECOND_DOLLARS} → $${TRADEIFY_RISK_THIRD_DOLLARS} (auto-shrink to leftover DLL / floor). Min $50.
- SL / TP geometry (live + sim): SL beyond the active range edge or zone floor. TP = 1.5R of that stop (1:1.5). Dragging SL re-locks TP to 1.5R. ATR may inform pad/trail talk only — never replace the structure stop or the 1.5R target.
- Shared daily $ across Nikkei + NY. Session rolls 18:00 ET. Day lock: ${TRADEIFY_MAX_STOP_OUTS} stop-outs or +$${TRADEIFY_GREEN_DAY_LOCK_DOLLARS} realized.
- Never say "pass today". Never suggest holding overnight. Flatten by ~16:59 Montreal (4:59 PM ET); holiday early close 12:59 ET. Cancel Tradovate working orders — TradePulse cannot.
- Do not long one index and short another (YM / NQ / NKD hedge). Open stop $ already counts against leftover DLL.
- Speak leftover DLL, floor room, next stop $, and as-of time from the TRADEIFY block — do not invent those numbers.
`

export function tradeifyScheduleRiskLine(): string {
  return `Ladder 2/2/2 · Tradeify $${TRADEIFY_RISK_FIRST_DOLLARS} → $${TRADEIFY_RISK_SECOND_DOLLARS} → $${TRADEIFY_RISK_THIRD_DOLLARS} · flatten 16:59 Montreal · no overnight · no pass-today`
}
