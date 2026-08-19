/** Live order-history rows. Working limits and broker ghosts stay off the tape. */

import { TRADEIFY_STARTING_BALANCE } from '@/lib/trading/tradeifyGrowth50k'

export const LIVE_JOURNAL_INSTRUMENTS = ['DOW', 'NASDAQ', 'NIKKEI', 'GOLD', 'CRUDE'] as const
export type LiveJournalInstrument = (typeof LIVE_JOURNAL_INSTRUMENTS)[number]

const LIVE_JOURNAL_INSTRUMENT_SET = new Set<string>(LIVE_JOURNAL_INSTRUMENTS)

export function isLiveJournalInstrument(
  value: string | null | undefined
): value is LiveJournalInstrument {
  return LIVE_JOURNAL_INSTRUMENT_SET.has(String(value || '').toUpperCase())
}

export function isVisibleLiveJournalRow(row: {
  fill_status?: string | null
  exit_reason?: string | null
  notes?: string | null
}): boolean {
  if (String(row.fill_status || '') === 'cancelled') return false
  if (String(row.fill_status || '') === 'working') return false
  if (String(row.exit_reason || '') === 'broker_rejected') return false
  if (/failed|rejected|insufficient margin/i.test(String(row.notes || ''))) return false
  return true
}

export type JournalEquityRow = {
  id?: string | number | null
  account_size?: number | string | null
  exit_timestamp?: string | null
  profit_loss?: number | string | null
  entry_timestamp?: string | null
  created_at?: string | null
}

/** Tradeify ticket trail — never OANDA balance / NAV / margin. */
export function journalTicketEquity(rows: readonly JournalEquityRow[]): {
  startingAccount: number
  endingEquity: number
  equityChange: number
  equityBefore: Map<string, number>
  equityAfter: Map<string, number>
  equitySource: 'journal_ticket'
} {
  const chrono = [...rows].sort((a, b) => {
    const ta = new Date(a.entry_timestamp || a.created_at || 0).getTime()
    const tb = new Date(b.entry_timestamp || b.created_at || 0).getTime()
    return ta - tb
  })
  const sized = chrono.find((t) => Number(t.account_size) > 0)
  const startingAccount = sized ? Number(sized.account_size) : TRADEIFY_STARTING_BALANCE

  let running = startingAccount
  const equityAfter = new Map<string, number>()
  const equityBefore = new Map<string, number>()
  for (const t of chrono) {
    const id = String(t.id ?? '')
    if (!id) continue
    equityBefore.set(id, Math.round(running * 100) / 100)
    if (t.exit_timestamp && t.profit_loss != null) {
      running += Number(t.profit_loss) || 0
    }
    equityAfter.set(id, Math.round(running * 100) / 100)
  }

  const endingEquity = Math.round(running * 100) / 100
  return {
    startingAccount,
    endingEquity,
    equityChange: Math.round((endingEquity - startingAccount) * 100) / 100,
    equityBefore,
    equityAfter,
    equitySource: 'journal_ticket',
  }
}
