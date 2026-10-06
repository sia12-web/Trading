/**
 * Quote SSE reconnects must not pay a fresh auth round trip or sit on a
 * stashed frame until the browser refreshes.
 * Run: npx tsx __tests__/quote_stream_latency.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const src = fs.readFileSync(
  path.join(root, 'app/api/trading/quote/stream/route.ts'),
  'utf8'
)

function sliceBlock(source: string, marker: string): string {
  const at = source.indexOf(marker)
  assert.ok(at >= 0, `missing ${marker}`)
  let i = source.indexOf('{', at)
  assert.ok(i >= 0, `missing block for ${marker}`)
  const start = i
  let depth = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i)
      if (i < 0) break
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2)
      if (i < 0) break
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      const q = c
      i++
      while (i < n && source[i] !== q) {
        if (source[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === '`') {
      i++
      while (i < n && source[i] !== '`') {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2
          let d = 1
          while (i < n && d > 0) {
            const e = source[i]
            if (e === "'" || e === '"') {
              i++
              while (i < n && source[i] !== e) {
                if (source[i] === '\\') i++
                i++
              }
              i++
              continue
            }
            if (e === '{') d++
            else if (e === '}') d--
            if (d > 0) i++
          }
          i++
          continue
        }
        i++
      }
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
    i++
  }
  throw new Error(`unclosed ${marker}`)
}

const resolver = sliceBlock(src, 'async function resolveDeskUserCached')
assert.match(src, /const AUTH_TTL_MS = 5_000/, 'auth cache TTL is 5s')
assert.match(resolver, /AUTH_TTL_MS/, 'resolver honors the TTL')
assert.match(src, /startsWith\('sb-'\)/, 'cache key uses sb- cookies')
assert.match(src, /headers\.get\('authorization'\)/, 'cache key uses authorization')
assert.match(src, /headers\.get\('x-desk-secret'\)/, 'cache key uses x-desk-secret')

const rejectAt = resolver.indexOf('if (!user)')
const setAt = resolver.indexOf('authCache.set')
assert.ok(rejectAt >= 0, 'unauthorized branch exists')
assert.ok(setAt > rejectAt, 'cache write is after the unauthorized return')
const rejectBody = resolver.slice(rejectAt, setAt)
assert.match(rejectBody, /return null/, 'unauthorized returns null')
assert.equal(
  rejectBody.includes('authCache.set'),
  false,
  'unauthorized results are not cached'
)
assert.match(resolver, /never cached/i, 'rejections are explicitly never cached')
assert.match(resolver, /authCache\.delete\(key\)/, 'a failed verify drops any stale key')
assert.match(
  src.slice(src.indexOf('export async function GET')),
  /resolveDeskUserCached\(request\)/,
  'stream open uses the auth cache'
)

const flushFn = sliceBlock(src, 'const flushStashedFrame = () =>')
assert.match(flushFn, /pendingFrame/, 'scheduled flush reads pendingFrame')
assert.match(flushFn, /controller\.desiredSize/, 'scheduled flush waits until the queue has room')
assert.match(flushFn, /controller\.enqueue\(/, 'scheduled flush enqueues the stashed frame')
assert.match(
  flushFn,
  /setTimeout\(\s*flushStashedFrame\s*,\s*0\s*\)/,
  'full queue retries on a zero-delay timer'
)
assert.match(
  src,
  /queueMicrotask\(\s*\(\)\s*=>\s*\{\s*flushStashedFrame\(\)\s*\}\s*\)/,
  'pendingFrame is flushed from a scheduled callback, not only pull()'
)
assert.match(
  src,
  /pendingFrame = obj\s*scheduleStashFlush\(\)/,
  'stashing the newest frame schedules a flush'
)
const pullAt = src.indexOf('pull(controller)')
assert.ok(pullAt > src.indexOf('const flushStashedFrame'), 'pull() is not the only flush path')
assert.match(src.slice(pullAt, src.indexOf('cancel()')), /pendingFrame/, 'pull() still flushes')

const hbAt = src.indexOf(': hb')
assert.ok(hbAt >= 0, 'heartbeat is an SSE comment')
const hbWindow = src.slice(hbAt, hbAt + 280)
assert.equal(hbWindow.includes('data:'), false, 'heartbeat is not a data event')
const hbMs = hbWindow.match(/,\s*([0-9][0-9_]*)\s*\)/)
assert.ok(hbMs, 'heartbeat interval is a numeric literal')
const heartbeatMs = Number(hbMs[1].replace(/_/g, ''))
assert.ok(
  heartbeatMs > 0 && heartbeatMs <= 5000,
  `heartbeat interval ${heartbeatMs}ms must be <= 5000`
)

const dbCb = sliceBlock(src, 'subscribeDatabentoLive(instrument, (trade) =>')
assert.equal(
  /\bawait\b/.test(dbCb),
  false,
  'Databento listener callback must not contain await'
)
assert.match(dbCb, /\bsend\(/, 'Databento listener sends the tick')
assert.equal(
  dbCb.includes('getYahooQuote'),
  false,
  'Databento listener does not call Yahoo'
)

const earlyAt = src.indexOf('if (!isDatabentoConfigured() && pending && basis != null)')
const warmCall = src.indexOf('void warmCmeBasis(instrument).then')
assert.ok(earlyAt >= 0, 'cached OANDA price and CME basis enqueue inside start()')
assert.equal(
  src.includes('void refreshBook()'),
  false,
  'live stream does not poll Yahoo to gate ticks'
)
assert.equal(
  src.includes('databentoAgreesWithBook'),
  false,
  'a delayed Yahoo last cannot drop a Databento tick'
)
assert.ok(warmCall > earlyAt, 'cached frame is before warmCmeBasis')
assert.match(
  src.slice(earlyAt, earlyAt + 700),
  /source:\s*'cme'|'\s*cme\s*'/,
  'shifted cached frame is labeled cme'
)
assert.match(src, /if \(basis == null\)/, 'unshifted OANDA is still withheld without a basis')
assert.match(
  src,
  /basis != null \? 'cme' : 'oanda'/,
  'missing basis is not labeled as CME'
)
assert.match(src, /controller\.desiredSize/, 'SSE path still applies backpressure')
assert.ok(
  src.includes("feed?: 'databento'") && src.includes("'databento'"),
  'direct exchange frames stay on the databento feed'
)

console.log('quote_stream_latency: all passed')
