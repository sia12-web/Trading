/** Live order-history rows. Working limits and broker ghosts stay off the tape. */

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
