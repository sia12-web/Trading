import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ihevmwvqeckaxlffsxdc.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!key) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  console.log('Searching for hallucinated NIKKEI trade from Jul 22, 2026...')

  // Query trades_journal for NIKKEI on Jul 22 / Jul 21 / Jul 20 or entry_price around 66638
  const { data: trades, error } = await supabase
    .from('trades_journal')
    .select('*')
    .or('instrument.eq.NIKKEI,entry_price.eq.66638')

  if (error) {
    console.error('Error fetching trades:', error)
    return
  }

  console.log(`Found ${trades?.length || 0} matching trades:`)
  for (const t of trades || []) {
    console.log(`- ID: ${t.id} | Instrument: ${t.instrument} | Direction: ${t.entry_direction} | Entry: ${t.entry_price} | PnL: ${t.profit_loss} | Date: ${t.trade_date} | Created: ${t.created_at}`)
  }

  if (!trades || trades.length === 0) {
    console.log('No matching trade found.')
    return
  }

  for (const t of trades) {
    console.log(`Deleting hallucinated position ${t.id}...`)

    // Delete management decisions linked to this position
    const { error: mErr } = await supabase
      .from('management_decisions')
      .delete()
      .eq('position_id', t.id)

    if (mErr) {
      console.error(`Error deleting management_decisions for ${t.id}:`, mErr)
    } else {
      console.log(`Deleted management decisions for ${t.id}`)
    }

    // Delete trade from trades_journal
    const { error: tErr } = await supabase
      .from('trades_journal')
      .delete()
      .eq('id', t.id)

    if (tErr) {
      console.error(`Error deleting trade ${t.id}:`, tErr)
    } else {
      console.log(`Deleted hallucinated NIKKEI trade ${t.id} from trades_journal!`)
    }
  }

  console.log('Done!')
}

main()
