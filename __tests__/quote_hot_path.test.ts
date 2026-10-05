/**
 * GET /api/trading/quote must return a fresh in-memory Databento print
 * without waiting on Yahoo, the sidecar, or a basis refresh.
 * Run: npx tsx __tests__/quote_hot_path.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { GET as getQuote } from '../app/api/trading/quote/route'
import { getLatestDatabentoLiveQuote } from '../lib/databento/liveHub'
import { getLastStreamedPrice } from '../lib/oanda/pricingStream'
import {
  __resetCmeBasisForTest,
  setCmeBasis,
} from '../lib/trading/cmeBasis'
import {
  __setCachedYahooQuoteForTest,
  peekCachedYahooQuote,
  type YahooQuote,
} from '../lib/yahoo/quote'
import type { Instrument } from '../types/price-feed'

const routeSrc = fs.readFileSync(
  path.join(process.cwd(), 'app/api/trading/quote/route.ts'),
  'utf8'
)

function between(src: string, start: string, end: string): string {
  const from = src.indexOf(start)
  const to = src.indexOf(end, from + start.length)
  assert.ok(from >= 0, `missing start marker: ${start}`)
  assert.ok(to > from, `missing end marker after: ${start}`)
  return src.slice(from, to)
}

const sampleQuote = (timestamp: number): YahooQuote => ({
  symbol: 'MYM=F',
  price: 48_010,
  change: 20,
  change_pct: 0.04,
  previous_close: 47_990,
  timestamp,
  open: 47_990,
  high: 48_050,
  low: 47_980,
  delayedBySec: 600,
})

test('peekCachedYahooQuote reads the cache and does not fetch', async () => {
  const originalFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = (async () => {
    fetches += 1
    throw new Error('peekCachedYahooQuote must not fetch')
  }) as typeof fetch

  try {
    __setCachedYahooQuoteForTest('DOW', null)
    assert.equal(peekCachedYahooQuote('DOW'), null)

    const fresh = sampleQuote(1_700_000_000)
    __setCachedYahooQuoteForTest('DOW', fresh)
    assert.deepEqual(peekCachedYahooQuote('DOW'), fresh)

    const stale = sampleQuote(1_700_000_100)
    __setCachedYahooQuoteForTest('DOW', stale, Date.now() - 60_000)
    assert.deepEqual(
      peekCachedYahooQuote('DOW'),
      stale,
      'a quote older than the fetch TTL is still visible to the sync peek'
    )
    assert.equal(fetches, 0)
  } finally {
    __setCachedYahooQuoteForTest('DOW', null)
    globalThis.fetch = originalFetch
  }
})

test('in-memory Databento quote is returned before any awaited Yahoo or sidecar call', () => {
  const authAt = routeSrc.indexOf('resolveDeskUserCached')
  const frozenAt = routeSrc.indexOf('frozen: true')
  const memoryAt = routeSrc.indexOf(
    'const memoryQuote = getLatestDatabentoLiveQuote(instrument)'
  )
  assert.ok(authAt >= 0 && frozenAt > authAt && memoryAt > frozenAt)

  const hot = between(
    routeSrc,
    'const memoryQuote = getLatestDatabentoLiveQuote(instrument)',
    'await resolveDatabentoLiveQuote(instrument)'
  )

  assert.match(hot, /peekCachedYahooQuote\(instrument\)/)
  assert.match(hot, /liveQuoteDisagreesWithReference\(/)
  assert.match(hot, /void getYahooQuote\(instrument\)/)
  assert.match(
    hot,
    /return databentoLiveResponse\(instrument, memoryQuote, headers\)/
  )
  assert.doesNotMatch(hot, /await\s/)
  assert.doesNotMatch(hot, /await\s+getYahooQuote/)
  assert.doesNotMatch(hot, /resolveDatabentoLiveQuote/)
  assert.doesNotMatch(hot, /warmCmeBasis/)
  assert.doesNotMatch(hot, /getOandaPrice/)

  const memoryReturnAt = routeSrc.indexOf(
    'return databentoLiveResponse(instrument, memoryQuote, headers)'
  )
  const awaitYahooAt = routeSrc.indexOf('await getYahooQuote')
  assert.ok(memoryReturnAt > memoryAt)
  assert.ok(
    awaitYahooAt > memoryReturnAt,
    'getYahooQuote is not awaited before the in-memory Databento return'
  )

  const responseFn = between(
    routeSrc,
    'function databentoLiveResponse(',
    'const AUTH_TTL_MS'
  )
  assert.match(responseFn, /source:\s*'cme'/)
  assert.match(responseFn, /feed:\s*'databento'/)
  assert.match(responseFn, /price:\s*quote\.price/)
  assert.match(responseFn, /bid:\s*quote\.bid/)
  assert.match(responseFn, /ask:\s*quote\.ask/)
  assert.match(responseFn, /change,/)
  assert.match(responseFn, /change_pct,/)
  assert.match(responseFn, /previous_close,/)
  assert.match(responseFn, /timestamp:\s*quote\.timestamp/)
  assert.match(responseFn, /bar:\s*quote\.bar/)
  assert.doesNotMatch(responseFn, /await\s/)
  assert.doesNotMatch(responseFn, /getYahooQuote/)
})

/** Monday 14:00 America/New_York — NY desk is open, so the route is not frozen. */
const NY_OPEN_MS = Date.parse('2026-10-05T18:00:00.000Z')

function withClock<T>(fn: () => Promise<T> | T): Promise<T> {
  const realNow = Date.now
  Date.now = () => NY_OPEN_MS
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Date.now = realNow
    })
}

function installHangingFetch(): { urls: string[]; restore: () => void } {
  const urls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    return new Promise(() => {})
  }) as typeof fetch
  return {
    urls,
    restore() {
      globalThis.fetch = original
    },
  }
}

function seedMemoryQuote(instrument: Instrument, price: number) {
  getLatestDatabentoLiveQuote(instrument)
  const hub = (
    globalThis as typeof globalThis & {
      __databentoLiveHub?: {
        lastByInstrument: Map<string, Record<string, unknown>>
        lastTickAt: number
      }
    }
  ).__databentoLiveHub
  assert.ok(hub, 'databento hub initializes on read')
  const nowMs = Date.now()
  hub.lastByInstrument.set(instrument, {
    instrument,
    price,
    bid: price - 1,
    ask: price + 1,
    size: 2,
    timestamp: Math.floor(nowMs / 1000),
    source: 'cme_globex',
    receivedAt: nowMs,
    bar: {
      time: Math.floor(nowMs / 1000) - (Math.floor(nowMs / 1000) % 60),
      open: price - 4,
      high: price + 4,
      low: price - 5,
      close: price,
      volume: 9,
    },
  })
  hub.lastTickAt = nowMs
}

function clearMemoryQuote(instrument: Instrument) {
  const hub = (
    globalThis as typeof globalThis & {
      __databentoLiveHub?: { lastByInstrument: Map<string, unknown> }
    }
  ).__databentoLiveHub
  hub?.lastByInstrument.delete(instrument)
}

function seedStreamedOanda(instrument: Instrument, price: number) {
  getLastStreamedPrice(instrument)
  const hub = (
    globalThis as typeof globalThis & {
      __oandaPricingHub?: { lastByInstrument: Map<string, Record<string, unknown>> }
    }
  ).__oandaPricingHub
  assert.ok(hub, 'oanda hub initializes on read')
  const nowMs = Date.now()
  hub.lastByInstrument.set(instrument, {
    symbol: 'NAS100_USD',
    price,
    bid: price - 1,
    ask: price + 1,
    timestamp: Math.floor(nowMs / 1000),
    source: 'oanda',
    receivedAt: nowMs,
  })
}

test('GET returns the in-memory CME print while Yahoo and the sidecar hang', async () => {
  const previousKey = process.env.DATABENTO_API_KEY
  process.env.DATABENTO_API_KEY = 'db-hotpath-test'
  const http = installHangingFetch()
  try {
    await withClock(async () => {
      seedMemoryQuote('DOW', 48_123)
      const delayed = sampleQuote(Math.floor(Date.now() / 1000) - 600)
      delayed.price = 100
      __setCachedYahooQuoteForTest('DOW', delayed, Date.now())
      const pending = getQuote(
        new Request('http://localhost/api/trading/quote?instrument=DOW')
      )
      const res = await Promise.race([
        pending,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('in-memory quote waited on HTTP')), 400)
        ),
      ])
      const data = await res.json()
      assert.equal(data.instrument, 'DOW')
      assert.equal(data.source, 'cme')
      assert.equal(data.feed, 'databento')
      assert.equal(data.price, 48_123)
      assert.equal(data.bid, 48_122)
      assert.equal(data.ask, 48_124)
      assert.equal(typeof data.change, 'number')
      assert.equal(typeof data.change_pct, 'number')
      assert.equal(typeof data.previous_close, 'number')
      assert.equal(typeof data.timestamp, 'number')
      assert.equal(data.bar.close, 48_123)
      assert.equal(
        http.urls.some((url) => url.includes('8765') || url.includes('/snapshot')),
        false,
        'fresh in-memory quote must not call the sidecar'
      )
    })
  } finally {
    clearMemoryQuote('DOW')
    __setCachedYahooQuoteForTest('DOW', null)
    http.restore()
    if (previousKey == null) delete process.env.DATABENTO_API_KEY
    else process.env.DATABENTO_API_KEY = previousKey
  }
})

test('a close cached Yahoo book that disagrees skips the in-memory print', async () => {
  const previousKey = process.env.DATABENTO_API_KEY
  process.env.DATABENTO_API_KEY = 'db-hotpath-test'
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response('no', { status: 503 })) as typeof fetch
  try {
    await withClock(async () => {
      __resetCmeBasisForTest()
      seedMemoryQuote('CRUDE', 80)
      const nowSec = Math.floor(Date.now() / 1000)
      __setCachedYahooQuoteForTest('CRUDE', {
        symbol: 'CL=F',
        price: 70,
        change: 0,
        change_pct: 0,
        previous_close: 70,
        timestamp: nowSec,
        open: 70,
        high: 70,
        low: 70,
        delayedBySec: 600,
      })
      const res = await getQuote(
        new Request('http://localhost/api/trading/quote?instrument=CRUDE')
      )
      const data = await res.json()
      assert.notEqual(data.feed, 'databento')
      assert.notEqual(data.price, 80)
    })
  } finally {
    clearMemoryQuote('CRUDE')
    __setCachedYahooQuoteForTest('CRUDE', null)
    __resetCmeBasisForTest()
    globalThis.fetch = original
    if (previousKey == null) delete process.env.DATABENTO_API_KEY
    else process.env.DATABENTO_API_KEY = previousKey
  }
})

test('a last-known CME basis returns without waiting on basis or Yahoo HTTP', async () => {
  const previousKey = process.env.DATABENTO_API_KEY
  delete process.env.DATABENTO_API_KEY
  const http = installHangingFetch()
  try {
    await withClock(async () => {
      __resetCmeBasisForTest()
      clearMemoryQuote('NASDAQ')
      setCmeBasis('NASDAQ', 73)
      const store = (
        globalThis as typeof globalThis & {
          __cmeBasis?: Map<string, { basis: number; at: number }>
        }
      ).__cmeBasis
      const row = store?.get('NASDAQ')
      assert.ok(row)
      row.at = Date.now() - 120_000
      seedStreamedOanda('NASDAQ', 21_000)
      const pending = getQuote(
        new Request('http://localhost/api/trading/quote?instrument=NASDAQ')
      )
      const res = await Promise.race([
        pending,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('stale basis waited on HTTP')), 400)
        ),
      ])
      const data = await res.json()
      assert.equal(data.instrument, 'NASDAQ')
      assert.equal(data.source, 'cme')
      assert.equal(data.price, 21_073)
      assert.equal(data.bid, 21_072)
      assert.equal(data.ask, 21_074)
      assert.equal(data.feed, undefined)
    })
  } finally {
    __resetCmeBasisForTest()
    http.restore()
    if (previousKey == null) delete process.env.DATABENTO_API_KEY
    else process.env.DATABENTO_API_KEY = previousKey
  }
})

test('sidecar and basis fallbacks stay behind the in-memory return', () => {
  const sidecar = between(
    routeSrc,
    'await resolveDatabentoLiveQuote(instrument)',
    'return databentoLiveResponse(instrument, dbLive, headers)'
  )
  assert.match(sidecar, /peekCachedYahooQuote\(instrument\)/)
  assert.match(sidecar, /void getYahooQuote\(instrument\)/)
  assert.doesNotMatch(sidecar, /await\s+getYahooQuote/)
  assert.doesNotMatch(sidecar, /warmCmeBasis/)

  const basisHot = between(
    routeSrc,
    'const knownBasis = getCmeBasis(instrument) ?? getLastKnownCmeBasis(instrument)',
    'await warmCmeBasis('
  )
  assert.match(basisHot, /void warmCmeBasis\(/)
  assert.match(basisHot, /return NextResponse\.json\(/)
  assert.doesNotMatch(basisHot, /await\s/)
  assert.doesNotMatch(basisHot, /getYahooQuote/)

  assert.match(routeSrc, /const yq = await getYahooQuote\(instrument\)/)
})
