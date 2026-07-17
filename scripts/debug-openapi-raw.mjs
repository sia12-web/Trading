import { readFileSync } from 'fs'
import { resolve } from 'path'

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

const rest = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const res = await fetch(`${rest}/rest/v1/`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/openapi+json',
  },
})
const json = await res.json()
console.log('keys', Object.keys(json))
console.log('pathKeysSample', Object.keys(json.paths || {}).slice(0, 30))
console.log('definitions', Object.keys(json.definitions || json.components?.schemas || {}).slice(0, 40))
