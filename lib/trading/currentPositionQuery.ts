/**
 * Query scope for GET /api/trading/current-position.
 * Must use the same trade_date basis as open/working/management-status
 * (ET for NY, JST for NIKKEI) — never EST-only for Nikkei, or US Range
 * evening books vanish and the chart false-closes while Live Positions stays open.
 */

import { getESTDateString } from '@/lib/utils/timeUtils'
import { tradeDateForInstrument } from '@/lib/trading/deskAttendance'

export type DeskInstrumentParam = 'DOW' | 'NASDAQ' | 'NIKKEI'

export function scopeForCurrentPositionQuery(args: {
  instrument: DeskInstrumentParam | null
  anyNy: boolean
  now?: Date
}): {
  instruments: DeskInstrumentParam[]
  /** Dates to match trades_journal.trade_date (instrument session calendar). */
  tradeDates: string[]
} {
  const now = args.now ?? new Date()
  if (args.anyNy || !args.instrument) {
    return {
      instruments: ['DOW', 'NASDAQ'],
      tradeDates: [getESTDateString(now)],
    }
  }
  const tradeDate = tradeDateForInstrument(args.instrument, now)
  return {
    instruments: [args.instrument],
    tradeDates: [tradeDate],
  }
}

/**
 * Chart / manage poll: only treat as broker exit when reconcile positively closed,
 * or when both filled-open and working are confirmed absent.
 * Never treat a lone `position: null` (wrong trade_date, race, etc.) as a close.
 */
export function shouldClearChartAsClosed(args: {
  reconciledClosed: boolean
  hasFilledOpen: boolean
  /** When true, a working limit still exists — never toast "position closed". */
  hasWorkingLimit: boolean
}): boolean {
  if (args.reconciledClosed) return true
  if (args.hasFilledOpen) return false
  if (args.hasWorkingLimit) return false
  return true
}
