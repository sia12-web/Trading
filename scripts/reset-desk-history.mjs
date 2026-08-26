import fs from 'fs'

const envContent = fs.readFileSync('.env.local', 'utf8')
const envVars = {}
envContent.split('\n').forEach(line => {
  const trimmed = line.trim()
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=')
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim()
      let val = trimmed.slice(idx + 1).trim()
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
      envVars[key] = val
    }
  }
})

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = envVars.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('ERROR: Missing Supabase URL or Service Role Key')
  process.exit(1)
}

console.log('Performing Complete Purge of Trade History & Desk Sessions...')
console.log('Supabase URL:', supabaseUrl)

const tablesToPurge = [
  'trades_journal',
  'simulation_trades',
  'trading_levels',
  'identified_levels',
  'level_breaks',
  'level_history',
  'management_decisions',
  'live_voice_turns',
  'live_voice_pins',
  'live_voice_sessions',
  'desk_attendance',
  'sessions',
]

async function purgeTable(tableName) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/${tableName}?id=neq.00000000-0000-0000-0000-000000000000`, {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
    })
    if (res.ok) {
      const deleted = await res.json()
      console.log(`✅ Cleaned table '${tableName}' (${Array.isArray(deleted) ? deleted.length : 0} rows deleted)`)
    } else {
      const text = await res.text()
      console.log(`⚠️ Table '${tableName}' note: ${res.status} ${text.slice(0, 150)}`)
    }
  } catch (err) {
    console.error(`❌ Error purging '${tableName}':`, err.message)
  }
}

async function run() {
  for (const table of tablesToPurge) {
    await purgeTable(table)
  }
  console.log('\n🎉 ALL TRADES, POSITIONS, JOURNALS, SESSIONS, AND VOICE TURNS ERASED! DESK IS FRESH 100%!')
}

run()
