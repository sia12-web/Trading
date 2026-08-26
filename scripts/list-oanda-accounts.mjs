/**
 * List OANDA accounts visible to the current API key.
 */
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
  if (!v.startsWith('"') && !v.startsWith("'") && v.includes(' #')) v = v.split(' #')[0].trim()
  process.env[line.slice(0, i).trim()] = v
}

const key = process.env.OANDA_API_KEY
const env = (process.env.OANDA_ENVIRONMENT || 'practice').toLowerCase()
const bases = [
  env === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com',
  env === 'live' ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com',
]

const headers = {
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

for (const base of [...new Set(bases)]) {
  console.log('\n===', base, '===')
  const res = await fetch(`${base}/v3/accounts`, { headers })
  const text = await res.text()
  console.log('status', res.status)
  try {
    const json = JSON.parse(text)
    console.log(JSON.stringify(json, null, 2))
  } catch {
    console.log(text.slice(0, 500))
  }
}
