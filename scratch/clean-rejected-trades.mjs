import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ihevmwvqeckaxlffsxdc.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!key) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  console.log('Cleaning up rejected/cancelled trade rows in trades_journal...')

  const { data: cancelledRows, error: findError } = await supabase
    .from('trades_journal')
    .select('id, instrument, trade_date, fill_status, exit_reason, notes, profit_loss')
    .or('fill_status.eq.cancelled,exit_reason.eq.broker_rejected,notes.ilike.%rejected%,notes.ilike.%failed%')

  if (findError) {
    console.error('Error finding cancelled rows:', findError)
    return
  }

  console.log(`Found ${cancelledRows?.length || 0} cancelled/rejected rows:`, cancelledRows)

  if (cancelledRows && cancelledRows.length > 0) {
    for (const row of cancelledRows) {
      const { error: updateErr } = await supabase
        .from('trades_journal')
        .update({
          fill_status: 'cancelled',
          profit_loss: 0,
          profit_loss_percent: 0,
          notes: row.notes || 'Order rejected by broker — 0 P&L',
        })
        .eq('id', row.id)

      if (updateErr) {
        console.error(`Failed to clean row ${row.id}:`, updateErr)
      } else {
        console.log(`Cleaned row ${row.id} (${row.instrument}): P&L zeroed out`)
      }
    }
  }

  console.log('Cleanup complete.')
}

main()
