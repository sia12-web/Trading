/**
 * Live desk P&L and quote checks. Micros only (MYM / MNQ).
 * A Dow quote must never close or mark P&L on a Nasdaq book.
 */

export function liveDeskPointValue(instrument: string): number {
  const inst = String(instrument || '').toUpperCase()
  if (inst === 'NASDAQ') return 2
  if (inst === 'DOW') return 0.5
  if (inst === 'NIKKEI') return 5
  return 1
}

/** Cash P&L: points × contracts × $/pt. */
export function deskFuturesCashPnl(args: {
  instrument: string
  direction: string
  entry: number
  exit: number
  qty: number
}): number {
  const entry = Number(args.entry)
  const exit = Number(args.exit)
  const qty = Number(args.qty)
  if (!(entry > 0) || !(exit > 0) || !(qty > 0)) return 0
  const pts =
    String(args.direction || '').toUpperCase() === 'SHORT' ? entry - exit : exit - entry
  return Math.round(pts * qty * liveDeskPointValue(args.instrument) * 100) / 100
}

/**
 * True when `quote` is on the same index as the open book.
 * Blocks a leftover Dow tick (~53k) from taking Nasdaq TP (~30k).
 */
export function quoteBelongsToBook(args: {
  instrument: string
  entry: number
  quote: number
}): boolean {
  const entry = Number(args.entry)
  const quote = Number(args.quote)
  if (!(entry > 0) || !(quote > 0) || !Number.isFinite(entry) || !Number.isFinite(quote)) {
    return false
  }
  if (Math.abs(quote - entry) / entry > 0.12) return false
  const inst = String(args.instrument || '').toUpperCase()
  if (inst === 'NASDAQ' && (quote < 15000 || quote > 42000)) return false
  if (inst === 'DOW' && (quote < 35000 || quote > 70000)) return false
  return true
}
