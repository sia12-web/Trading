/**
 * Session cleanup for desk trades:
 * - Expire unfilled working limits after the day's last entry window (not morning entryClose)
 * - Auto-flatten filled opens only at cash close (end of lunch-range window)
 *   — morning/IB books are NOT force-closed at 11:30 (trader confirms)
 *
 * Between-window FLAT cancels stay on the chart client (gate phase). GET /working
 * must never expire — refresh/hydrate is read-only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getESTDateString } from '@/lib/utils/timeUtils'
import { tradeDateForInstrument } from '@/lib/trading/deskAttendance'
import {
  deskMarketFor,
  lunchRangeEntryEndHms,
  sessionFor,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import { shouldExecuteOandaOrders } from '@/lib/oanda/config'
import { closeOandaTrade } from '@/lib/oanda/orders'
import { getOandaPrice } from '@/lib/oanda/pricing'
import type { Instrument } from '@/types/price-feed'
import { logger } from '@/lib/utils/logger'

function localNowSeconds(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  const s = parseInt(parts.find((p) => p.type === 'second')?.value ?? '0', 10)
  const hour = h === 24 ? 0 : h
  return hour * 3600 + m * 60 + s
}

function parseHms(hms: string): number {
  const [h, m, s] = hms.split(':').map(Number)
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0)
}

/** Pure helper — filled opens auto-flatten only at/after cash close (not 11:30 lunch). */
export function shouldAutoFlattenAtCashClose(args: {
  timeSec: number
  marketCloseSec: number
  forceCashClose?: boolean
  /** Tradeify 16:59 ET window — beats instrument cash close and keep-open. */
  tradeifyMustFlatten?: boolean
}): boolean {
  if (args.tradeifyMustFlatten === true) return true
  return args.forceCashClose === true || args.timeSec >= args.marketCloseSec
}

/**
 * Working limits survive morning → IB/US-Range → lunch-range.
 * Expire only after the day's last entry window (or cash close), never at
 * morning entryClose — otherwise refresh during IB/lunch-range kills the book.
 * Between-window FLAT cancel is client-side (gate phase), not this helper.
 */
export function shouldExpireWorkingLimit(args: {
  timeSec: number
  /** End of late-slot entries (NY lunch-range end · Tokyo IB end). */
  lastEntryCloseSec: number
  marketCloseSec: number
  forceExpireWorking?: boolean
  tradeifyMustFlatten?: boolean
}): boolean {
  if (args.forceExpireWorking || args.tradeifyMustFlatten) return true
  return (
    args.timeSec >= args.lastEntryCloseSec || args.timeSec >= args.marketCloseSec
  )
}

export type CleanupResult = {
  expiredWorking: string[]
  /** Filled opens closed at cash close (includes leftovers from morning/IB). */
  cashClosed: string[]
  /** @deprecated alias of cashClosed */
  lunchClosed: string[]
}

export type CleanupOpts = {
  forceExpireWorking?: boolean
  /** Force flatten filled opens (cash close). */
  forceCashClose?: boolean
  /** @deprecated alias of forceCashClose */
  forceLunchClose?: boolean
  /** Tradeify flatten window — flatten every desk, including Nikkei before 02:00. */
  tradeifyMustFlatten?: boolean
}

/** Expire working limits past entry/lunch; flatten filled opens only past cash close. */
export async function cleanupDeskSession(
  supabase: SupabaseClient,
  userId: string,
  opts?: CleanupOpts
): Promise<CleanupResult> {
  const tradeDates = Array.from(
    new Set([getESTDateString(), tradeDateForInstrument('NIKKEI')])
  )
  const nowIso = new Date().toISOString()
  const expiredWorking: string[] = []
  const cashClosed: string[] = []
  const forceCashClose = !!(opts?.forceCashClose || opts?.forceLunchClose)
  const tradeifyMustFlatten = !!opts?.tradeifyMustFlatten

  const { data: openRows } = await supabase
    .from('trades_journal')
    .select(
      'id, instrument, fill_status, entry_price, entry_direction, position_size, risk_amount, oanda_trade_id, stop_loss_price, profit_target_price'
    )
    .eq('user_id', userId)
    .in('trade_date', tradeDates)
    .is('exit_timestamp', null)
    .in('instrument', ['DOW', 'NASDAQ', 'NIKKEI'])

  for (const row of openRows || []) {
    const inst = row.instrument as DeskInstrument
    const sess = sessionFor(inst)
    const t = localNowSeconds(sess.tz)
    const marketClose = parseHms(sess.marketClose)
    const lastEntryClose = parseHms(lunchRangeEntryEndHms(deskMarketFor(inst)))

    if (row.fill_status === 'working') {
      if (
        !shouldExpireWorkingLimit({
          timeSec: t,
          lastEntryCloseSec: lastEntryClose,
          marketCloseSec: marketClose,
          forceExpireWorking: opts?.forceExpireWorking,
          tradeifyMustFlatten,
        })
      ) {
        continue
      }
      const { error } = await supabase
        .from('trades_journal')
        .update({
          fill_status: 'cancelled',
          exit_timestamp: nowIso,
          exit_price: row.entry_price,
          exit_reason: 'limit_expired',
          profit_loss: 0,
          profit_loss_percent: 0,
          exit_notes: 'Working limit never filled — cancelled after entry window',
          updated_at: nowIso,
        })
        .eq('id', row.id)
        .eq('user_id', userId)
        .eq('fill_status', 'working')
        .is('exit_timestamp', null)
      if (!error) expiredWorking.push(row.id)
      else logger.error('cleanup.expire_working_failed', { id: row.id, error })
      continue
    }

    // Filled open past cash close → flatten (lunch-range + any leftover morning/IB)
    if (
      (row.fill_status === 'filled' || !row.fill_status) &&
      shouldAutoFlattenAtCashClose({
        timeSec: t,
        marketCloseSec: marketClose,
        forceCashClose,
        tradeifyMustFlatten,
      })
    ) {
      const entry = Number(row.entry_price)
      const size = Number(row.position_size)
      const dir = String(row.entry_direction || '').toUpperCase()
      let exitPrice: number | null = null
      let priceSource = 'none'
      let brokerPl: number | null = null

      if (shouldExecuteOandaOrders() && row.oanda_trade_id) {
        const closed = await closeOandaTrade(String(row.oanda_trade_id))
        if (closed.ok && closed.fillPrice != null && closed.fillPrice > 0) {
          exitPrice = closed.fillPrice
          priceSource = 'oanda_fill'
        }
        if (closed.ok && closed.realizedPL != null && Number.isFinite(closed.realizedPL)) {
          brokerPl = closed.realizedPL
        }
      }

      if (exitPrice == null) {
        const quote = await getOandaPrice(inst as Instrument)
        if (quote?.price && quote.price > 0) {
          exitPrice = quote.price
          priceSource = 'oanda_mid'
        }
      }

      if (exitPrice == null || !(exitPrice > 0)) {
        logger.error('cleanup.cash_close_no_price', {
          id: row.id,
          entry,
          oanda_trade_id: row.oanda_trade_id,
        })
        continue
      }

      // If broker already closed at/near TP, label as take_profit not cash_close
      const tp = Number(row.profit_target_price)
      const nearTp =
        Number.isFinite(tp) &&
        tp > 0 &&
        Math.abs(exitPrice - tp) / tp < 0.0005
      const exitReason = nearTp ? 'take_profit' : 'cash_close'
      const deskPnl =
        dir === 'LONG' ? (exitPrice - entry) * size : (entry - exitPrice) * size
      const pnlRounded =
        brokerPl != null
          ? Math.round(brokerPl * 100) / 100
          : Math.round(deskPnl * 100) / 100
      const riskAmt = Number(row.risk_amount) || 0
      const pnlPct =
        riskAmt > 0
          ? Math.round((pnlRounded / riskAmt) * 10000) / 100
          : entry * size > 0
            ? Math.round((pnlRounded / (entry * size)) * 10000) / 100
            : 0

      const { error } = await supabase
        .from('trades_journal')
        .update({
          exit_timestamp: nowIso,
          exit_price: exitPrice,
          exit_reason: exitReason,
          profit_loss: pnlRounded,
          profit_loss_percent: pnlPct,
          exit_notes:
            exitReason === 'take_profit'
              ? `Take profit fill @ ${exitPrice} (source ${priceSource}${brokerPl != null ? ', CAD P&L from OANDA' : ''})`
              : `Auto cash-close flatten @ ${exitPrice} (source ${priceSource}${brokerPl != null ? ', CAD P&L from OANDA' : ''})`,
          updated_at: nowIso,
        })
        .eq('id', row.id)
        .eq('user_id', userId)
        .is('exit_timestamp', null)
      if (!error) {
        cashClosed.push(row.id)
        logger.info('cleanup.cash_close', {
          id: row.id,
          entry,
          exitPrice,
          priceSource,
          exitReason,
          pnl: pnlRounded,
        })
      } else logger.error('cleanup.cash_close_failed', { id: row.id, error })
    }
  }

  return { expiredWorking, cashClosed, lunchClosed: cashClosed }
}
