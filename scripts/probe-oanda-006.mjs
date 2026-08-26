import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const raw = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  const i = line.indexOf('=')
  if (i < 0) continue
  let v = line.slice(i + 1).trim()
  if (!v.startsWith('"') && !v.startsWith("'") && v.includes(' #')) {
    v = v.split(' #')[0].trim()
  }
  process.env[line.slice(0, i).trim()] = v
}

const key = process.env.OANDA_API_KEY
const id = '101-002-36082256-006'
const base = 'https://api-fxpractice.oanda.com'
const headers = {
  Authorization: `Bearer ${key}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

const paths = [
  `/v3/accounts/${id}`,
  `/v3/accounts/${id}/summary`,
  `/v3/accounts/${id}/instruments?instruments=US30_USD`,
  `/v3/accounts/${id}/pricing?instruments=US30_USD`,
]

for (const p of paths) {
  const r = await fetch(base + p, { headers })
  const t = await r.text()
  console.log(p, r.status, t.slice(0, 400))
  console.log('---')
}

// Also try -005 for comparison
const r5 = await fetch(`${base}/v3/accounts/101-002-36082256-005/summary`, { headers })
console.log('005 summary', r5.status, (await r5.text()).slice(0, 300))
