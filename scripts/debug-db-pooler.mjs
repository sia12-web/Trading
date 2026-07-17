import pg from 'pg'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import dns from 'dns'

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
const password = decodeURIComponent(parsed.password)
const ref = 'ihevmwvqeckaxlffsxdc'
const regions = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-southeast-1',
  'ap-northeast-1',
]

for (const region of regions) {
  const host = `aws-0-${region}.pooler.supabase.com`
  try {
    const addrs = await dns.promises.lookup(host, { all: true })
    console.log('dns_ok', host, addrs.map((a) => `${a.family}:${a.address}`).join(','))
  } catch (e) {
    console.log('dns_fail', host, e.code || e.message)
    continue
  }

  for (const port of [6543, 5432]) {
    const client = new pg.Client({
      host,
      port,
      user: `postgres.${ref}`,
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    })
    try {
      await client.connect()
      const r = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`
      )
      console.log('CONNECTED', host, port)
      console.log('tables', JSON.stringify(r.rows.map((x) => x.table_name)))
      await client.end()
      process.exit(0)
    } catch (e) {
      console.log('fail', host, port, e.code || '', e.message.slice(0, 120))
      await client.end().catch(() => {})
    }
  }
}

console.log('No pooler connection succeeded')
process.exit(1)
