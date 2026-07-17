import { readFileSync } from 'fs'
import { resolve } from 'path'

const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
const env = {}
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
  env[line.slice(0, i).trim()] = val
}

const url = env.DATABASE_URL || ''
const host = (url.match(/@([^:/?]+)/) || [])[1] || 'missing'
console.log(JSON.stringify({ hasDbUrl: !!url, host, urlLen: url.length }))
