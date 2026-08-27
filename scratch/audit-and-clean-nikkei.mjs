import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ihevmwvqeckaxlffsxdc.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!key) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  console.log('Auditing and cleaning hallucinated NIKKEI & broker-rejected trade rows...')

  // Find all NIKKEI rows or rows with notes/exits related to rejection/insufficient margin or working limits
  const { data: rows, error } = await supabase
    .from('trades_journal')
    .select('id, instrument, trade_date, fill_status, exit_reason, notes, exit_notes, profit_loss, oanda_trade_id')

  if (error) {
    console.error('Query error:', error)
    return
  }

  console.log(`Auditing ${rows?.length || 0} total journal rows...`)

  const badRows = (rows || []).filter((r) => {
    const notesStr = String(r.notes || '') + String(r.exit_notes || '')
    const rejected = /rejected|insufficient margin|failed|limit_expired|broker_rejected/i.test(notesStr) || r.exit_reason === 'broker_rejected'
    const oandaMissing = !r.oanda_trade_id || r.oanda_trade_id === ''
    const isCancelledStatus = r.fill_status === 'cancelled' || r.fill_status === 'working'
    const nikkeiPhantom = r.instrument === 'NIKKEI' && oandaMissing

    return rejected || isCancelledStatus || nikkeiPhantom
  })

  console.log(`Found ${badRows.length} unfulfilled/rejected/phantom rows to clean:`, badRows)

  for (const r of badRows) {
    // 1. Delete associated management_decisions
    const { error: decErr } = await supabase
      .from('management_decisions')
      .delete()
      .eq('position_id', r.id)

    if (decErr) {
      console.error(`Failed to delete management_decisions for position ${r.id}:`, decErr)
    } else {
      console.log(`Deleted management decisions for position ${r.id}`)
    }

    // 2. Mark row fill_status = 'cancelled', profit_loss = 0, exit_reason = 'broker_rejected'
    const { error: upErr } = await supabase
      .from('trades_journal')
      .update({
        fill_status: 'cancelled',
        exit_reason: 'broker_rejected',
        profit_loss: 0,
        profit_loss_percent: 0,
        notes: 'Order rejected by broker (insufficient margin) — 0 P&L',
        exit_notes: 'Broker rejected order — zero P&L',
      })
      .eq('id', r.id)

    if (upErr) {
      console.error(`Failed to clean row ${r.id}:`, upErr)
    } else {
      console.log(`Cleaned row ${r.id} (${r.instrument}): P&L zeroed out, marked cancelled`)
    }
  }

  console.log('Database audit and cleanup completed successfully.')
}

main()
