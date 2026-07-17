import pg from 'pg'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import dns from 'dns'

dns.setDefaultResultOrder('verbatim')

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

const parsed = new URL(process.env.DATABASE_URL)
const host = parsed.hostname
const addresses = await dns.promises.lookup(host, { all: true, verbatim: true })
console.log('addresses', addresses)

const ipv6 = addresses.find((a) => a.family === 6)?.address
if (!ipv6) {
  console.error('No IPv6 address')
  process.exit(1)
}

const client = new pg.Client({
  host: ipv6,
  port: Number(parsed.port || 5432),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace(/^\//, '') || 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

try {
  await client.connect()
  const r = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`
  )
  console.log('tables', JSON.stringify(r.rows.map((x) => x.table_name)))
  console.log('count', r.rows.length)
} catch (e) {
  console.error('ERR', e.code || '', e.message)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
