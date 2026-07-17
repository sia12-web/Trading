/**
 * One-shot table existence check for debug session (no secrets logged).
 */
import pg from 'pg'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    let val = line.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[line.slice(0, i).trim()]) process.env[line.slice(0, i).trim()] = val
  }
}

loadEnvLocal()
const parsed = new URL(process.env.DATABASE_URL)
const password = decodeURIComponent(parsed.password)
const ref = 'ihevmwvqeckaxlffsxdc'

const client = new pg.Client({
  host: 'aws-0-us-east-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.${ref}`,
  password,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
})

await client.connect()
const r = await client.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN ('regime_cache','market_recommendations','trades_journal','level_history','profiles')
   ORDER BY 1`
)
const payload = {
  sessionId: '624454',
  runId: 'pre-fix',
  hypothesisId: 'A,B',
  location: 'scripts/debug-check-regime-tables.mjs',
  message: 'table existence check',
  data: { tables: r.rows.map((x) => x.table_name) },
  timestamp: Date.now(),
}
console.log(JSON.stringify(payload))
await fetch('http://127.0.0.1:7854/ingest/12861b9b-f890-41df-9c4f-bff921b2361a', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '624454' },
  body: JSON.stringify(payload),
}).catch(() => {})
await client.end()
