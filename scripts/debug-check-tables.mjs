import pg from 'pg'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    const key = line.slice(0, i).trim()
    let val = line.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
})

try {
  await client.connect()
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY 1`
  )
  console.log('TABLES', JSON.stringify(tables.rows.map((r) => r.table_name)))

  const flags = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='profiles') AS has_profiles,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sessions') AS has_sessions,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='level_history') AS has_level_history,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trades_journal') AS has_trades_journal`
  )
  console.log('FLAGS', JSON.stringify(flags.rows[0]))
} catch (e) {
  console.error('ERR', e.message)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
