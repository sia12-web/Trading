/**
 * Open positions and working limits share one quote SSE per instrument.
 * REST polling is only the fallback while that stream is disconnected.
 * Run: npx tsx __tests__/position_price_subscription.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const hookSrc = fs.readFileSync(
  path.join(root, 'lib/hooks/usePositionPriceSubscription.ts'),
  'utf8'
)

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}`)
  assert.ok(start !== -1, `missing function ${name}`)
  const brace = src.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(brace + 1, i)
    }
  }
  throw new Error(`unterminated function ${name}`)
}

assert.ok(hookSrc.includes('new EventSource'), 'hook opens an EventSource')
assert.ok(
  hookSrc.includes('/api/trading/quote/stream'),
  'hook subscribes to /api/trading/quote/stream'
)
assert.match(
  hookSrc,
  /const\s+streamsByInstrument\s*=\s*new Map/,
  'a module-level map caches one stream per instrument'
)

const hookBody = functionBody(hookSrc, 'usePositionPriceSubscription')
assert.ok(
  !hookBody.includes('new EventSource'),
  'the hook body must reuse the shared map instead of opening its own EventSource'
)
assert.ok(
  !/return\s*\{\s*isConnected:\s*false\s*,\s*lastPrice:\s*null\s*,\s*lastUpdateTime:\s*null/.test(
    hookSrc
  ),
  'hardcoded disconnected stub return is gone'
)
assert.match(hookBody, /return feed/, 'hook returns the live feed snapshot')

const opener = functionBody(hookSrc, 'openInstrumentStream')
const esAt = opener.indexOf('new EventSource')
assert.ok(esAt !== -1, 'openInstrumentStream constructs the EventSource')
const cacheCheck = opener.lastIndexOf('streamsByInstrument.get', esAt)
assert.ok(
  cacheCheck !== -1 && cacheCheck < esAt,
  'openInstrumentStream returns the cached EventSource before constructing another'
)
assert.match(opener, /if\s*\(\s*cached\s*\)\s*return cached/)
assert.match(
  opener,
  /typeof window === 'undefined'\s*\|\|\s*typeof EventSource === 'undefined'/
)

assert.match(
  hookSrc,
  /subscribers\.size === 0[\s\S]{0,180}\.close\(\)/,
  'the EventSource closes when the last subscriber for that instrument unmounts'
)
assert.match(hookSrc, /msg\.instrument[\s\S]{0,120}!== instrument/, 'frames for another instrument are ignored')
assert.match(hookSrc, /stream\.isConnected = true/, 'a valid price marks the stream connected')
assert.match(hookSrc, /source\.onerror[\s\S]{0,160}isConnected = false/, 'errors drop isConnected until the next price')
assert.match(hookSrc, /subscriber\(price, timestamp\)/, 'every subscriber receives the price')

console.log('position_price_subscription: ok')
