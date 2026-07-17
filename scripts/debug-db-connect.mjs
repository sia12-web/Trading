import pg from 'pg'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import dns from 'dns'
import { promisify } from 'util'

const lookup = promisify(dns.lookup)

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    let val = line.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[line.slice(0, i).trim()]) {
      process.env[line.slice(0, i).trim()] = val
    }
  }
}

loadEnvLocal()

const url = process.env.DATABASE_URL
const host = (url.match(/@([^:/?]+)/) || [])[1]
console.log('host', host)

try {
  const a = await lookup(host)
  console.log('dns', a)
} catch (e) {
  console.log('dns_fail', e.code || e.message)
}

// Also probe REST schema for the two tables
const rest = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
for (const table of ['level_history', 'trades_journal', 'profiles', 'sessions']) {
  const res = await fetch(`${rest}/rest/v1/${table}?select=*&limit=0`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  })
  const body = await res.text()
  console.log(
    'rest',
    table,
    res.status,
    body.slice(0, 160).replace(/\s+/g, ' ')
  )
}

try {
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  })
  await client.connect()
  const r = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`
  )
  console.log('tables', r.rows.map((x) => x.table_name))
  await client.end()
} catch (e) {
  console.log('pg_fail', e.code || '', e.message)
}
