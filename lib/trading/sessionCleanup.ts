/**
 * Session cleanup for desk trades:
 * - Expire unfilled working limits (never reached → leave Positions)
 * - Lunch-flatten filled opens after the morning session
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getESTDateString } from '@/lib/utils/timeUtils'
import {
  isDeskHoursNow,
  sessionFor,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import { shouldExecuteOandaOrders } from '@/lib/oanda/config'
import { closeOandaTrade } from '@/lib/oanda/orders'
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

export type CleanupResult = {
  expiredWorking: string[]
  lunchClosed: string[]
}

/** Expire working limits past entry close / lunch; flatten filled opens past lunch. */
export async function cleanupDeskSession(
  supabase: SupabaseClient,
  userId: string,
  opts?: { forceExpireWorking?: boolean; forceLunchClose?: boolean }
): Promise<CleanupResult> {
  const today = getESTDateString()
  const nowIso = new Date().toISOString()
  const expiredWorking: string[] = []
  const lunchClosed: string[] = []

  const { data: openRows } = await supabase
    .from('trades_journal')
    .select(
      'id, instrument, fill_status, entry_price, entry_direction, position_size, oanda_trade_id, stop_loss_price'
    )
    .eq('user_id', userId)
    .eq('trade_date', today)
    .is('exit_timestamp', null)
    .in('instrument', ['DOW', 'NASDAQ', 'NIKKEI'])

  for (const row of openRows || []) {
    const inst = row.instrument as DeskInstrument
    const sess = sessionFor(inst)
    const t = localNowSeconds(sess.tz)
    const entryClose = parseHms(sess.entryClose)
    const lunch = parseHms(sess.lunchClose)
    const pastEntry = t >= entryClose || !isDeskHoursNow(new Date(), inst).open
    const pastLunch = t >= lunch || opts?.forceLunchClose

    if (row.fill_status === 'working') {
      if (!opts?.forceExpireWorking && !pastEntry && !pastLunch) continue
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

    // Filled open past lunch → flatten so Positions clears
    if ((row.fill_status === 'filled' || !row.fill_status) && pastLunch) {
      let exitPrice = Number(row.entry_price)
      if (shouldExecuteOandaOrders() && row.oanda_trade_id) {
        const closed = await closeOandaTrade(String(row.oanda_trade_id))
        if (closed.ok && closed.fillPrice != null && closed.fillPrice > 0) {
          exitPrice = closed.fillPrice
        }
      }
      const entry = Number(row.entry_price)
      const size = Number(row.position_size)
      const dir = String(row.entry_direction || '').toUpperCase()
      const pnl =
        dir === 'LONG' ? (exitPrice - entry) * size : (entry - exitPrice) * size
      const pnlPct = entry ? (pnl / (entry * size)) * 100 : 0

      const { error } = await supabase
        .from('trades_journal')
        .update({
          exit_timestamp: nowIso,
          exit_price: exitPrice,
          exit_reason: 'lunch_close',
          profit_loss: pnl,
          profit_loss_percent: pnlPct,
          exit_notes: 'Auto lunch flatten — morning session ended',
          updated_at: nowIso,
        })
        .eq('id', row.id)
        .eq('user_id', userId)
        .is('exit_timestamp', null)
      if (!error) lunchClosed.push(row.id)
      else logger.error('cleanup.lunch_close_failed', { id: row.id, error })
    }
  }

  return { expiredWorking, lunchClosed }
}
