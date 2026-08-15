/**
 * Load Tradeify Growth $50k session snapshot from trades_journal.
 * Counts DOW + NASDAQ + NIKKEI fills inside the 18:00 ET session window.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveTradeifyPlace,
  tradeifyDeskStatus,
  tradeifyDllUsed,
  tradeifySessionWindow,
  TRADEIFY_DLL_DOLLARS,
  TRADEIFY_FLATTEN_ET,
  TRADEIFY_GREEN_DAY_LOCK_DOLLARS,
  TRADEIFY_PROFIT_TARGET,
  TRADEIFY_STARTING_BALANCE,
  TRADEIFY_TRAILING_DD_DOLLARS,
  type TradeifyPlaceDecision,
  type TradeifyPlaceInput,
} from '@/lib/trading/tradeifyGrowth50k'
import {
  tradeifyFlattenMontreal,
  type TradeifyLeoSnapshot,
} from '@/lib/trading/tradeifyLeoBlock'

export type TradeifyFillRow = {
  instrument?: string | null
  fill_status?: string | null
  entry_timestamp?: string | null
  created_at?: string | null
  exit_timestamp?: string | null
  exit_reason?: string | null
  profit_loss?: number | null
  risk_amount?: number | null
}

export type TradeifyInstrumentBreak = {
  fills: number
  pnl: number
  risked: number
  stops: number
}

export function emptyInstrumentBreak(): Record<'DOW' | 'NASDAQ' | 'NIKKEI', TradeifyInstrumentBreak> {
  return {
    DOW: { fills: 0, pnl: 0, risked: 0, stops: 0 },
    NASDAQ: { fills: 0, pnl: 0, risked: 0, stops: 0 },
    NIKKEI: { fills: 0, pnl: 0, risked: 0, stops: 0 },
  }
}

export function instrumentBreakFromFills(
  fills: TradeifyFillRow[]
): Record<'DOW' | 'NASDAQ' | 'NIKKEI', TradeifyInstrumentBreak> {
  const out = emptyInstrumentBreak()
  for (const r of fills) {
    const inst = String(r.instrument || '').toUpperCase()
    if (inst !== 'DOW' && inst !== 'NASDAQ' && inst !== 'NIKKEI') continue
    out[inst].fills += 1
    const pnl = Number(r.profit_loss)
    if (Number.isFinite(pnl)) out[inst].pnl += pnl
    const risk = Number(r.risk_amount)
    if (Number.isFinite(risk)) out[inst].risked += risk
    if (r.exit_reason === 'stop_hit') out[inst].stops += 1
  }
  for (const k of ['DOW', 'NASDAQ', 'NIKKEI'] as const) {
    out[k].pnl = Math.round(out[k].pnl * 100) / 100
    out[k].risked = Math.round(out[k].risked * 100) / 100
  }
  return out
}

export function fillInTradeifyWindow(
  row: TradeifyFillRow,
  startIso: string,
  endIso: string
): boolean {
  if (String(row.fill_status || '') !== 'filled') return false
  const t = row.entry_timestamp || row.created_at
  if (!t) return false
  return t >= startIso && t < endIso
}

export function summarizeTradeifyFills(
  rows: TradeifyFillRow[],
  now: Date = new Date()
): TradeifyPlaceInput & { sessionKey: string; fills: TradeifyFillRow[] } {
  const { sessionKey, startIso, endIso } = tradeifySessionWindow(now)
  const fills = rows.filter((r) => fillInTradeifyWindow(r, startIso, endIso))
  let dailyPnl = 0
  let stopOutsToday = 0
  for (const r of fills) {
    const pnl = Number(r.profit_loss)
    if (Number.isFinite(pnl)) dailyPnl += pnl
    if (r.exit_reason === 'stop_hit') stopOutsToday += 1
  }
  return {
    now,
    sessionKey,
    fillsUsed: fills.length,
    dailyPnl: Math.round(dailyPnl * 100) / 100,
    stopOutsToday,
    fills,
  }
}

export async function loadTradeifySessionSnapshot(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<TradeifyPlaceInput & { sessionKey: string; fills: TradeifyFillRow[] }> {
  const { startIso, endIso, sessionKey } = tradeifySessionWindow(now)
  const { data, error } = await supabase
    .from('trades_journal')
    .select(
      'instrument, fill_status, entry_timestamp, created_at, exit_timestamp, exit_reason, profit_loss, risk_amount'
    )
    .eq('user_id', userId)
    .in('instrument', ['DOW', 'NASDAQ', 'NIKKEI'])
    .eq('fill_status', 'filled')
    .gte('entry_timestamp', startIso)
    .lt('entry_timestamp', endIso)

  if (error) {
    return { now, sessionKey, fillsUsed: 0, dailyPnl: 0, stopOutsToday: 0, fills: [] }
  }
  const summarized = summarizeTradeifyFills(data ?? [], now)
  return {
    now,
    sessionKey: summarized.sessionKey,
    fillsUsed: summarized.fillsUsed,
    dailyPnl: summarized.dailyPnl,
    stopOutsToday: summarized.stopOutsToday,
    fills: summarized.fills,
  }
}

export function buildTradeifyDashboardPayload(
  snap: TradeifyPlaceInput & { sessionKey: string; fills?: TradeifyFillRow[] },
  now: Date = new Date()
) {
  const decision = resolveTradeifyPlace(snap)
  const byInstrument = instrumentBreakFromFills(snap.fills ?? [])
  const dailyPnl = snap.dailyPnl ?? 0
  const dllUsed = tradeifyDllUsed(dailyPnl)
  const status = tradeifyDeskStatus(decision, now)
  return {
    ok: true as const,
    sessionKey: decision.sessionKey,
    fillsUsed: decision.fillsUsed,
    stepDollars: decision.stepDollars,
    riskDollars: decision.riskDollars,
    leftoverDll: decision.leftoverDll,
    dllUsed,
    dllCap: TRADEIFY_DLL_DOLLARS,
    floorRoom: decision.floorRoom,
    trailingDd: TRADEIFY_TRAILING_DD_DOLLARS,
    dailyPnl,
    stopOutsToday: snap.stopOutsToday ?? 0,
    greenLockAt: TRADEIFY_GREEN_DAY_LOCK_DOLLARS,
    profitTarget: TRADEIFY_PROFIT_TARGET,
    startingBalance: TRADEIFY_STARTING_BALANCE,
    todayTowardTargetPct: Math.max(
      0,
      Math.min(100, Math.round((dailyPnl / TRADEIFY_PROFIT_TARGET) * 1000) / 10)
    ),
    suggestedPaceLow: 200,
    suggestedPaceHigh: 400,
    flattenEt: TRADEIFY_FLATTEN_ET,
    byInstrument,
    allowed: decision.allowed,
    refuseReason: decision.refuseReason,
    refuseMessage: decision.refuseMessage,
    status,
  }
}

export function toTradeifyLeoSnapshot(
  snap: TradeifyPlaceInput & { sessionKey: string; fills?: TradeifyFillRow[] },
  now: Date = new Date()
): TradeifyLeoSnapshot {
  const payload = buildTradeifyDashboardPayload(snap, now)
  return {
    ...payload,
    active: true,
    asOfIso: now.toISOString(),
    flattenMontreal: tradeifyFlattenMontreal(now),
  }
}

export async function loadTradeifyLeoSnapshot(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<TradeifyLeoSnapshot> {
  const snap = await loadTradeifySessionSnapshot(supabase, userId, now)
  return toTradeifyLeoSnapshot(snap, now)
}

export async function resolveServerTradeifyPlace(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<TradeifyPlaceDecision> {
  const snap = await loadTradeifySessionSnapshot(supabase, userId, now)
  return resolveTradeifyPlace(snap)
}
