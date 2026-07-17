/**
 * Build railway-vars.local.json from .env.local for Railway Raw Editor paste.
 * Output is gitignored — do not commit.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const raw = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
const out = {}

for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  const i = line.indexOf('=')
  if (i < 0) continue
  let v = line.slice(i + 1).trim()
  // Strip unquoted inline comments: value # comment
  if (!v.startsWith('"') && !v.startsWith("'") && v.includes(' #')) {
    v = v.split(' #')[0].trim()
  }
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1)
  }
  out[line.slice(0, i).trim()] = v
}

out.NODE_ENV = 'production'
out.LOG_LEVEL = out.LOG_LEVEL || 'info'
out.DESK_MODE = out.DESK_MODE || 'single'
if (!out.DESK_USER_ID) {
  out.DESK_USER_ID = '00000000-0000-0000-0000-000000000001'
}
delete out.ALLOW_DEV_AUTH

const dest = path.join(root, 'railway-vars.local.json')
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n')
console.log('Wrote', dest)
console.log('Keys:', Object.keys(out).sort().join(', '))
if (!out.ANTHROPIC_API_KEY || /YOUR_|HERE/i.test(out.ANTHROPIC_API_KEY)) {
  console.warn('WARNING: ANTHROPIC_API_KEY looks like a placeholder — AI levels will fail in prod')
}
