/**
 * GET /api/trading/quote/stream?instrument=DOW
 * Server-Sent Events — OANDA ticks shifted onto CME (Tradovate MYM / MNQ / MGC / CL) scale.
 */

import { getDayPreviousClose, refreshDayPreviousClose, getYahooQuote } from '@/lib/yahoo/quote'
import { activeDeskSessionsAt } from '@/lib/chart/sessionVwap'
import {
  getLastStreamedPrice,
  subscribeOandaPriceStream,
} from '@/lib/oanda/pricingStream'
import { isOandaConfigured } from '@/lib/oanda/config'
import { getOandaPrice } from '@/lib/oanda/pricing'
import {
  applyCmeBasis,
  getCmeBasis,
  getLastKnownCmeBasis,
  warmCmeBasis,
  CME_BASIS_REFRESH_MS,
} from '@/lib/trading/cmeBasis'
import { getOrCreateUser, type DeskUser } from '@/lib/utils/devAuth'
import {
  subscribeDatabentoLive,
  isDatabentoLiveActive,
  getLatestDatabentoLiveQuote,
  type DatabentoLiveBar,
} from '@/lib/databento/liveHub'
import { isDatabentoConfigured } from '@/lib/databento/client'
import {
  isChartStreamAllowed,
  isLiveDeskInstrument,
} from '@/lib/trading/sessionGate'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** Railway / long-lived SSE — keep connection open through the cash session */
/** Long-lived SSE — Railway hobby/pro allow up to 800s; client EventSource reconnects on drop */
export const maxDuration = 800

/** Both Yahoo paths time out well inside this, so reaching it means a real outage. */
const UNSHIFTED_AFTER_MS = 10_000

/**
 * EventSource reconnects re-enter this route. The desk otherwise pays a
 * Supabase auth.getUser() round trip on every open. Keyed on the credential
 * itself (Supabase auth cookies + desk secret headers) so a different,
 * missing or forged token can never hit another session's entry; only
 * verified users are cached, and only long enough to cover one poll cycle.
 */
const AUTH_TTL_MS = 5_000
const AUTH_CACHE_MAX = 64
const authCache = new Map<string, { at: number; user: DeskUser }>()

function authKey(request: Request): string {
  const supabaseCookies = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('sb-'))
    .sort()
    .join(';')
  return [
    supabaseCookies,
    request.headers.get('authorization') ?? '',
    request.headers.get('x-desk-secret') ?? '',
  ].join('|')
}

async function resolveDeskUserCached(request: Request): Promise<DeskUser | null> {
  const key = authKey(request)
  const hit = authCache.get(key)
  if (hit && Date.now() - hit.at < AUTH_TTL_MS) return hit.user

  const user = await getOrCreateUser(request)
  if (!user) {
    // Rejections are never cached — an unauthorized request always re-verifies.
    authCache.delete(key)
    return null
  }
  if (authCache.size >= AUTH_CACHE_MAX) authCache.clear()
  authCache.set(key, { at: Date.now(), user })
  return user
}

function payloadFor(
  instrument: Instrument,
  price: number,
  bid: number,
  ask: number,
  timestamp: number,
  source: 'cme' | 'oanda' = 'oanda',
  bar?: DatabentoLiveBar,
  feed?: 'databento'
) {
  const previous_close = getDayPreviousClose(instrument) ?? price
  const change = price - previous_close
  const change_pct = previous_close ? (change / previous_close) * 100 : 0
  return {
    instrument,
    source,
    price,
    bid,
    ask,
    change,
    change_pct,
    previous_close,
    timestamp,
    bar,
    feed,
  }
}

export async function GET(request: Request) {
  const user = await resolveDeskUserCached(request)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { searchParams } = new URL(request.url)
  const instrument = (searchParams.get('instrument') || 'DOW') as Instrument

  if (!isLiveDeskInstrument(instrument)) {
    return new Response(JSON.stringify({ error: 'Invalid instrument' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const streamGate = isChartStreamAllowed(instrument)
  const active = activeDeskSessionsAt(Math.floor(Date.now() / 1000))
  if (!streamGate.open && active.length === 0) {
    return new Response(
      JSON.stringify({ error: streamGate.reason, stream: false, frozen: true }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  refreshDayPreviousClose(instrument)

  const encoder = new TextEncoder()
  let unsubscribeDb: (() => void) | null = null
  let unsubscribeOanda: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let basisTimer: ReturnType<typeof setInterval> | null = null
  let cmePoller: ReturnType<typeof setInterval> | null = null
  let closed = false
  let pendingFrame: unknown = null
  let stashFlushScheduled = false

  const stream = new ReadableStream({
    start(controller) {
      // A basis from a live stream, an earlier connection or a REST poll is
      // reusable immediately — fallback basis ensures immediate scaling.
      let basis: number | null = getCmeBasis(instrument) ?? getLastKnownCmeBasis(instrument)
      let pending: ReturnType<typeof getLastStreamedPrice> = getLastStreamedPrice(
        instrument,
        60_000
      )
      let pendingSent = false
      let dbOnBook = true
      const openedAt = Date.now()

      const cleanup = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = null
        if (basisTimer) clearInterval(basisTimer)
        basisTimer = null
        if (cmePoller) clearInterval(cmePoller)
        cmePoller = null
        unsubscribeDb?.()
        unsubscribeDb = null
        unsubscribeOanda?.()
        unsubscribeOanda = null
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      /**
       * pull() is not guaranteed to run when the HTTP queue drains. After a
       * full queue, retry until desiredSize recovers and enqueue only the
       * newest stashed frame.
       */
      const flushStashedFrame = () => {
        if (closed || pendingFrame == null) {
          stashFlushScheduled = false
          return
        }
        if ((controller.desiredSize ?? 1) <= 0) {
          setTimeout(flushStashedFrame, 0)
          return
        }
        stashFlushScheduled = false
        const frame = pendingFrame
        pendingFrame = null
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)
          )
        } catch {
          cleanup()
        }
      }

      const scheduleStashFlush = () => {
        if (stashFlushScheduled) return
        stashFlushScheduled = true
        queueMicrotask(() => {
          flushStashedFrame()
        })
      }

      const send = (obj: unknown, force = false) => {
        if (closed) return
        // Bound queue growth. During a volatility burst a slow browser needs
        // the newest exchange state, not thousands of stale prints. Databento
        // frames include exact forming-bar OHLCV, so coalescing preserves the
        // candle high/low while preventing seconds of replay lag.
        if (!force && (controller.desiredSize ?? 1) <= 0) {
          const incomingTs = Number(
            (obj as { timestamp?: unknown } | null)?.timestamp
          )
          const pendingTs = Number(
            (pendingFrame as { timestamp?: unknown } | null)?.timestamp
          )
          if (
            pendingFrame != null &&
            Number.isFinite(incomingTs) &&
            Number.isFinite(pendingTs) &&
            incomingTs > 0 &&
            pendingTs > incomingTs
          ) {
            return
          }
          pendingFrame = obj
          scheduleStashFlush()
          return
        }
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)
          )
        } catch {
          cleanup()
        }
      }

      const flush = (q: NonNullable<typeof pending>) => {
        pendingSent = true
        const src = basis != null ? 'cme' : 'oanda'
        send(
          payloadFor(
            instrument,
            applyCmeBasis(q.price, basis),
            applyCmeBasis(q.bid, basis),
            applyCmeBasis(q.ask, basis),
            q.timestamp,
            src
          )
        )
      }

      /**
       * Ticks are withheld until a basis exists: an unshifted OANDA mid is tens
       * of points off Tradovate and nothing downstream can tell the two apart.
       */
      const flushPending = () => {
        if (pendingSent || !pending) return
        if (isDatabentoLiveActive(instrument) && dbOnBook) return
        if (basis == null) {
          // Never send unshifted OANDA quotes on CME instruments when Databento is configured
          if (isDatabentoConfigured() && dbOnBook) return
          if (instrument === 'GOLD' || instrument === 'CRUDE') return
          if (Date.now() - openedAt < UNSHIFTED_AFTER_MS) return
        }
        flush(pending)
      }

      const refreshBasis = () => {
        void warmCmeBasis(instrument, { oandaMid: pending?.price }).then((next) => {
          if (closed) return
          if (next != null) basis = next
          flushPending()
        })
      }

      const pollCme = async () => {
        if (closed) return
        try {
          const yq = await getYahooQuote(instrument)
          if (closed || !yq?.price) return
          send(
            payloadFor(
              instrument,
              yq.price,
              yq.price,
              yq.price,
              yq.timestamp || Math.floor(Date.now() / 1000),
              'cme'
            )
          )
        } catch {
          /* ignore */
        }
      }

      // Last streamed OANDA print plus a last-known CME basis, only when the
      // desk has no CME key. A configured Databento book opens on the exchange print.
      if (!isDatabentoConfigured() && pending && basis != null) {
        pendingSent = true
        send(
          payloadFor(
            instrument,
            applyCmeBasis(pending.price, basis),
            applyCmeBasis(pending.bid, basis),
            applyCmeBasis(pending.ask, basis),
            pending.timestamp,
            'cme'
          ),
          true
        )
      }

      // Tier 1: Real-time CME Globex exchange feed directly from Databento Live
      if (isDatabentoConfigured()) {
        unsubscribeDb = subscribeDatabentoLive(instrument, (trade) => {
          dbOnBook = true
          send(
            payloadFor(
              instrument,
              trade.price,
              trade.bid,
              trade.ask,
              trade.timestamp,
              'cme',
              trade.bar,
              'databento'
            )
          )
        })

        // Seed the latest exchange print immediately. A delayed Yahoo last
        // is not consulted, so a fast move cannot be dropped.
        const dbSeed = getLatestDatabentoLiveQuote(instrument)
        if (dbSeed && dbSeed.price > 0) {
          dbOnBook = true
          send(
            payloadFor(
              instrument,
              dbSeed.price,
              dbSeed.bid,
              dbSeed.ask,
              dbSeed.timestamp,
              'cme',
              dbSeed.bar,
              'databento'
            )
          )
        }
      }

      // Tier 2: OANDA 24/7 continuous CFDs + CME basis fallback
      if (isOandaConfigured()) {
        unsubscribeOanda = subscribeOandaPriceStream(instrument, (quote) => {
          // If Databento Live is active and delivering the volume-month book, silence OANDA
          if (isDatabentoLiveActive(instrument) && dbOnBook) return
          pending = quote
          pendingSent = false
          flushPending()
        })

        // Seed initial live quote immediately without waiting for first stream tick or delayed Yahoo
        if (!pending && !(isDatabentoLiveActive(instrument) && dbOnBook)) {
          void getOandaPrice(instrument).then((op) => {
            if (closed || !op || pendingSent || (isDatabentoLiveActive(instrument) && dbOnBook)) return
            pending = op
            flushPending()
          })
        }

        if (getCmeBasis(instrument, CME_BASIS_REFRESH_MS) == null) {
          void warmCmeBasis(instrument).then((next) => {
            if (closed) return
            if (next != null) basis = next
            flushPending()
          })
        }

        basisTimer = setInterval(refreshBasis, CME_BASIS_REFRESH_MS)
      } else if (!isDatabentoConfigured()) {
        // Fallback only when both Databento and OANDA are completely unconfigured.
        // Production live data never takes this Yahoo poll.
        void pollCme()
        cmePoller = setInterval(pollCme, 1500)
      }

      // Keep proxies / browsers from treating the connection as idle.
      // Comments (not data events) more often than 5s avoid idle buffering.
      heartbeat = setInterval(() => {
        if (closed) return
        if ((controller.desiredSize ?? 1) <= 0) return
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`))
        } catch {
          cleanup()
        }
      }, 5_000)

      request.signal.addEventListener('abort', cleanup)
    },
    pull(controller) {
      if (closed || pendingFrame == null) return
      const frame = pendingFrame
      pendingFrame = null
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)
        )
      } catch {
        /* cancellation cleanup owns the subscriptions */
      }
    },
    cancel() {
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      if (basisTimer) clearInterval(basisTimer)
      if (cmePoller) clearInterval(cmePoller)
      unsubscribeDb?.()
      unsubscribeOanda?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
