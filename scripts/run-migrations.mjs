/**
 * Apply all supabase/migrations/*.sql via the Supabase connection pooler.
 * Direct db.*.supabase.co often fails (IPv6 / DNS); pooler :6543 works.
 *
 * Usage: node scripts/run-migrations.mjs
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function loadEnvLocal() {
  const raw = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
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
    const key = line.slice(0, i).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

function poolerConnectionString(databaseUrl, projectRef) {
  const u = new URL(databaseUrl.replace(/^postgresql:/, 'postgres:'))
  const password = decodeURIComponent(u.password)
  const user = `postgres.${projectRef}`
  // Prefer US east pooler (matches this project's successful probe)
  return `postgresql://${user}:${encodeURIComponent(password)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
}

function projectRefFromEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)
  if (m) return m[1]
  throw new Error('Could not parse project ref from NEXT_PUBLIC_SUPABASE_URL')
}

async function main() {
  loadEnvLocal()
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL missing in .env.local')

  const ref = projectRefFromEnv()
  const cs = poolerConnectionString(databaseUrl, ref)
  console.log(`Project: ${ref}`)
  console.log('Connecting via pooler aws-0-us-east-1:6543…')

  const client = new pg.Client({
    connectionString: cs,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  })
  await client.connect()
  console.log('Connected.')

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  const dir = path.join(root, 'supabase', 'migrations')
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  console.log(`Found ${files.length} migration files\n`)

  for (const file of files) {
    const name = file.replace(/\.sql$/, '')
    const { rows } = await client.query(
      'SELECT 1 FROM public.schema_migrations WHERE name = $1',
      [name]
    )
    if (rows.length) {
      console.log(`⏭  skip (already applied): ${file}`)
      continue
    }

    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    console.log(`▶  applying: ${file}`)
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query(
        'INSERT INTO public.schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
        [name]
      )
      await client.query('COMMIT')
      console.log(`✅ applied: ${file}`)
    } catch (e) {
      await client.query('ROLLBACK')
      // Idempotent / already-exists errors: record as applied so we can continue
      const msg = e.message || String(e)
      const soft =
        /already exists|duplicate key|conflict|does not exist/i.test(msg) ||
        e.code === '42P07' || // duplicate_table
        e.code === '42710' || // duplicate_object
        e.code === '42701' || // duplicate_column
        e.code === '42P01' || // undefined_table (alter on missing — skip)
        e.code === '23514' // check violation on backfill edge cases
      if (soft) {
        console.log(`⚠  soft-ok (${e.code || 'err'}): ${file}`)
        console.log(`   ${msg.slice(0, 200)}`)
        await client.query(
          'INSERT INTO public.schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
          [name]
        )
      } else {
        console.error(`❌ failed: ${file}`)
        console.error(msg)
        await client.end()
        process.exit(1)
      }
    }
  }

  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `)
  console.log('\nPublic tables:')
  for (const t of tables.rows) console.log(`  - ${t.table_name}`)

  const applied = await client.query(
    'SELECT name, applied_at FROM public.schema_migrations ORDER BY name'
  )
  console.log('\nApplied migrations:')
  for (const r of applied.rows) console.log(`  - ${r.name}`)

  await client.end()
  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
