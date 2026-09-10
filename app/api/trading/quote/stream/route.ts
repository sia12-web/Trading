/**
 * GET /api/trading/quote/stream?instrument=DOW
 * Server-Sent Events — prefer Databento Live CME trades (TCP+CRAM); else OANDA+basis; else Yahoo.
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
import { isDatabentoConfigured } from '@/lib/databento/client'
import {
  getLastDatabentoLivePrice,
  subscribeDatabentoLive,
} from '@/lib/databento/liveHub'
import { getOrCreateUser } from '@/lib/utils/devAuth'
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
/** Prefer Databento Live prints while this fresh; then OANDA+basis may fill gaps. */
const DATABENTO_TIP_FRESH_MS = 4_000

function payloadFor(
  instrument: Instrument,
  price: number,
  bid: number,
  ask: number,
  timestamp: number,
  source: 'cme' | 'oanda' | 'databento' = 'oanda'
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
  }
}

export async function GET(request: Request) {
  const user = await getOrCreateUser(request)
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
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let basisTimer: ReturnType<typeof setInterval> | null = null
  let cmePoller: ReturnType<typeof setInterval> | null = null
  let closed = false
  let lastDatabentoAt = 0

  const stream = new ReadableStream({
    start(controller) {
      // A basis from a live stream, an earlier connection or a REST poll is
      // reusable immediately — fallback basis ensures immediate scaling.
      const staticBasis =
        instrument === 'DOW' ? 60.5 : instrument === 'NASDAQ' ? 36.5 : instrument === 'GOLD' ? 48.0 : 0
      let basis: number | null = getCmeBasis(instrument) ?? getLastKnownCmeBasis(instrument) ?? staticBasis
      let pending: ReturnType<typeof getLastStreamedPrice> = getLastStreamedPrice(
        instrument,
        60_000
      )
      let pendingSent = false
      const openedAt = Date.now()

      const send = (obj: unknown) => {
        if (closed) return
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
       * Also withheld while Databento Live is fresh (native CME tip wins).
       */
      const flushPending = () => {
        if (pendingSent || !pending) return
        if (Date.now() - lastDatabentoAt < DATABENTO_TIP_FRESH_MS) return
        if (basis == null) {
          if (instrument === 'GOLD' || instrument === 'CRUDE') return
          if (Date.now() - openedAt < UNSHIFTED_AFTER_MS) return
        }
        flush(pending)
      }

      const refreshBasis = () => {
        void warmCmeBasis(instrument).then((next) => {
          if (closed) return
          if (next != null) basis = next
          flushPending()
        })
      }

      const pollCme = async () => {
        if (closed) return
        if (Date.now() - lastDatabentoAt < DATABENTO_TIP_FRESH_MS) return
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
        unsubscribe?.()
        unsubscribe = null
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      // Primary: Databento Live Raw trades (Standard plan Live entitlement — TCP+CRAM)
      if (isDatabentoConfigured()) {
        const seed = getLastDatabentoLivePrice(instrument, 30_000)
        if (seed) {
          lastDatabentoAt = Date.now()
          send(
            payloadFor(
              instrument,
              seed.price,
              seed.bid,
              seed.ask,
              seed.timestamp,
              'databento'
            )
          )
        }
        unsubscribeDb = subscribeDatabentoLive(instrument, (q) => {
          lastDatabentoAt = Date.now()
          send(
            payloadFor(instrument, q.price, q.bid, q.ask, q.timestamp, 'databento')
          )
        })
      }

      if (isOandaConfigured()) {
        // Subscribing replays the hub's last tick, so a warm basis means the first
        // frame leaves here synchronously — skipped while Databento Live is fresh.
        unsubscribe = subscribeOandaPriceStream(instrument, (quote) => {
          pending = quote
          pendingSent = false
          flushPending()
        })

        // Seed initial live quote immediately without waiting for first stream tick or delayed Yahoo
        if (!pending && Date.now() - lastDatabentoAt >= DATABENTO_TIP_FRESH_MS) {
          void getOandaPrice(instrument).then((op) => {
            if (closed || !op || pendingSent) return
            if (Date.now() - lastDatabentoAt < DATABENTO_TIP_FRESH_MS) return
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
        // Fallback only when neither Databento Live nor OANDA is available
        void pollCme()
        cmePoller = setInterval(pollCme, 1500)
      } else {
        // Databento only — Yahoo poll if Live goes quiet (weekend / gap)
        cmePoller = setInterval(pollCme, 5_000)
      }

      // Keep proxies / browsers from treating the connection as idle
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`))
        } catch {
          cleanup()
        }
      }, 15_000)

      request.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      if (basisTimer) clearInterval(basisTimer)
      if (cmePoller) clearInterval(cmePoller)
      unsubscribeDb?.()
      unsubscribe?.()
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
