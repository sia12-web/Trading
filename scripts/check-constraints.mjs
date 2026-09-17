import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const raw = fs.readFileSync('.env.local', 'utf8')
const env = {}
for (const line of raw.split(/\r?\n/)) {
  const i = line.indexOf('=')
  if (i === -1 || line.startsWith('#')) continue
  const k = line.slice(0, i).trim()
  let v = line.slice(i + 1).trim()
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
  env[k] = v
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// Test inserting a dummy trade with instrument GOLD
console.log("Testing insert GOLD into trades_journal...")
const { data, error } = await supabase.from('trades_journal').insert({
  user_id: env.DESK_USER_ID,
  instrument: 'GOLD',
  trade_date: new Date().toISOString().split('T')[0],
  entry_window: 1,
  entry_timestamp: new Date().toISOString(),
  entry_price: 4345.24,
  entry_direction: 'LONG',
  stop_loss_price: 4340.24,
  position_size: 1,
  risk_amount: 50,
  account_size: 50000,
  regime: 'bullish',
}).select().single()

console.log("Result error:", error)
console.log("Result data:", data)

// If inserted, delete it
if (data?.id) {
  await supabase.from('trades_journal').delete().eq('id', data.id)
  console.log("Cleaned up test row.")
}
