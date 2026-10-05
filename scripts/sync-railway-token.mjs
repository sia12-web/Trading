/**
 * Materialize railway-vars.local.json from RAILWAY_TOKEN (Cursor secret / env).
 * Safe to run on every Cloud Agent boot — never prints the token.
 *
 * Usage: node scripts/sync-railway-token.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const outPath = path.join(root, 'railway-vars.local.json')
const token = (process.env.RAILWAY_TOKEN || '').trim()

if (!token) {
  if (fs.existsSync(outPath)) {
    console.log('[sync-railway-token] railway-vars.local.json already present (no RAILWAY_TOKEN env)')
    process.exit(0)
  }
  console.warn(
    '[sync-railway-token] RAILWAY_TOKEN missing — set Cursor secret RAILWAY_TOKEN for Day Trading deploys'
  )
  process.exit(0)
}

const existing = fs.existsSync(outPath)
  ? JSON.parse(fs.readFileSync(outPath, 'utf8'))
  : {}

const next = {
  ...existing,
  RAILWAY_TOKEN: token,
  RAILWAY_PROJECT_ID:
    existing.RAILWAY_PROJECT_ID || '673bbfd3-ad02-4293-a6b6-7910d11d102d',
  RAILWAY_SERVICE: existing.RAILWAY_SERVICE || 'Trading',
  RAILWAY_ENVIRONMENT: existing.RAILWAY_ENVIRONMENT || 'production',
}

fs.writeFileSync(outPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
console.log('[sync-railway-token] wrote railway-vars.local.json from RAILWAY_TOKEN')
