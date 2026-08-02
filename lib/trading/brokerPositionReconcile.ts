/**
 * Sync journal when OANDA broker already closed (SL/TP hit server-side).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getPositionManager } from '@/lib/trading/positionManager'
import { shouldExecuteOandaOrders } from '@/lib/oanda/config'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { getOandaTradeSnapshot } from '@/lib/oanda/orders'
import { logger } from '@/lib/utils/logger'
import type { Instrument } from '@/types/price-feed'
import type { TradePosition } from '@/types/trading'

export type BrokerReconcileResult =
  | { changed: false }
  | {
      changed: true
      exit_reason: 'stop_hit' | 'take_profit' | 'manual'
      exit_price: number
      profit_loss: number
      profit_loss_percent: number
    }

function inferExitReason(args: {
  exitPrice: number
  entry: number
  stopLoss: number
  profitTarget: number
  isLong: boolean
}): 'stop_hit' | 'take_profit' | 'manual' {
  const { exitPrice, stopLoss, profitTarget } = args
  const slDist = Math.abs(exitPrice - stopLoss)
  const tpDist =
    Number.isFinite(profitTarget) && profitTarget > 0
      ? Math.abs(exitPrice - profitTarget)
      : Infinity
  if (slDist <= tpDist && slDist / Math.max(Math.abs(stopLoss), 1) < 0.002) {
    return 'stop_hit'
  }
  if (tpDist < slDist && tpDist / Math.max(Math.abs(profitTarget), 1) < 0.002) {
    return 'take_profit'
  }
  if (slDist <= tpDist) return 'stop_hit'
  return 'take_profit'
}

type OpenJournalRow = {
  id: string
  user_id: string
  instrument: string
  trade_date: string
  entry_price: number | string
  entry_direction: string
  position_size: number | string
  risk_amount: number | string
  stop_loss_price: number | string | null
  profit_target_price: number | string | null
  stop_loss_hit_count?: number | null
  oanda_trade_id?: string | null
}

/** Close journal row when broker trade is already flat (SL/TP on OANDA). */
export async function reconcileBrokerClosedPosition(
  supabase: SupabaseClient,
  row: OpenJournalRow
): Promise<BrokerReconcileResult> {
  if (!shouldExecuteOandaOrders()) return { changed: false }

  const tradeId = row.oanda_trade_id ? String(row.oanda_trade_id) : ''
  if (!tradeId) return { changed: false }

  const snap = await getOandaTradeSnapshot(tradeId)
  // 'unknown' = broker check inconclusive (network/5xx/rate-limit/auth hiccup) —
  // never force-close the journal on an inconclusive read. Only a confirmed
  // 'closed' or 'missing' (trade id no longer exists on OANDA) proceeds.
  if (snap.state === 'open' || snap.state === 'unknown') return { changed: false }

  const entry = Number(row.entry_price)
  const dir = String(row.entry_direction || '').toUpperCase()
  const isLong = dir === 'LONG'
  const stopLoss = Number(row.stop_loss_price)
  const profitTarget = Number(row.profit_target_price)
  const inst = row.instrument as Instrument
  const nowIso = new Date().toISOString()

  let exitPrice = snap.fillPrice
  if (exitPrice == null || !(exitPrice > 0)) {
    try {
      const quote = await getOandaPrice(inst)
      if (quote?.price && quote.price > 0) exitPrice = quote.price
    } catch {
      /* fallback below */
    }
  }
  if (exitPrice == null || !(exitPrice > 0)) {
    if (Number.isFinite(stopLoss) && stopLoss > 0) exitPrice = stopLoss
    else if (Number.isFinite(profitTarget) && profitTarget > 0) exitPrice = profitTarget
    else exitPrice = entry
  }

  const exitReason = inferExitReason({
    exitPrice,
    entry,
    stopLoss,
    profitTarget,
    isLong,
  })

  const positionManager = getPositionManager()
  const deskPnl = positionManager.calculateCurrentPnL(row as TradePosition, exitPrice)
  let profitLoss = deskPnl.profitLoss
  let profitLossPercent = deskPnl.profitLossPercent
  if (snap.realizedPL != null && Number.isFinite(snap.realizedPL)) {
    profitLoss = Math.round(snap.realizedPL * 100) / 100
    const risk = Number(row.risk_amount) || 0
    if (risk > 0) {
      profitLossPercent = Math.round((profitLoss / risk) * 10000) / 100
    }
  }

  const updatePayload: Record<string, unknown> = {
    exit_timestamp: nowIso,
    exit_price: exitPrice,
    exit_reason: exitReason,
    exit_notes: `Broker reconcile — ${exitReason} @ ${exitPrice}`,
    profit_loss: profitLoss,
    profit_loss_percent: profitLossPercent,
    updated_at: nowIso,
  }
  if (exitReason === 'stop_hit') {
    updatePayload.stop_loss_hit_at = nowIso
    updatePayload.stop_loss_hit_count = (row.stop_loss_hit_count || 0) + 1
  }

  const { data: claimed, error } = await supabase
    .from('trades_journal')
    .update(updatePayload)
    .eq('id', row.id)
    .eq('user_id', row.user_id)
    .is('exit_timestamp', null)
    .select('id')
    .maybeSingle()

  if (error || !claimed) {
    if (error) {
      logger.warn('brokerReconcile.update_failed', { id: row.id, error })
    }
    return { changed: false }
  }

  logger.info('brokerReconcile.closed', {
    position_id: row.id,
    tradeId,
    exitReason,
    exitPrice,
    profitLoss,
  })

  return {
    changed: true,
    exit_reason: exitReason,
    exit_price: exitPrice,
    profit_loss: profitLoss,
    profit_loss_percent: profitLossPercent,
  }
}
