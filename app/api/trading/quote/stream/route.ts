/**
 * GET /api/trading/quote/stream?instrument=DOW
 * Server-Sent Events — OANDA ticks shifted onto CME (Tradovate MYM / MNQ / MGC / CL) scale.
 */

import { getDayPreviousClose, refreshDayPreviousClose } from '@/lib/yahoo/quote'
import {
  getLastStreamedPrice,
  subscribeOandaPriceStream,
} from '@/lib/oanda/pricingStream'
import { isOandaConfigured } from '@/lib/oanda/config'
import {
  applyCmeBasis,
  getCmeBasis,
  warmCmeBasis,
  CME_BASIS_REFRESH_MS,
} from '@/lib/trading/cmeBasis'
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

function payloadFor(
  instrument: Instrument,
  price: number,
  bid: number,
  ask: number,
  timestamp: number,
  source: 'cme' | 'oanda' = 'oanda'
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
  if (!streamGate.open) {
    return new Response(
      JSON.stringify({ error: streamGate.reason, stream: false, frozen: true }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  if (!isOandaConfigured()) {
    return new Response(
      JSON.stringify({ error: 'OANDA not configured', stream: false }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  refreshDayPreviousClose(instrument)

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let basisTimer: ReturnType<typeof setInterval> | null = null
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      // A basis from a live stream, an earlier connection or a REST poll is
      // reusable immediately — only a genuinely cold process waits on Yahoo.
      let basis: number | null = getCmeBasis(instrument)
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
       * Only the newest tick is held, so clearing the gate never replays a
       * backlog. Past UNSHIFTED_AFTER_MS both feeds have definitively failed —
       * emit the raw mid flagged as 'oanda' rather than leave the tip dead.
       */
      const flushPending = () => {
        if (pendingSent || !pending) return
        if (basis == null && Date.now() - openedAt < UNSHIFTED_AFTER_MS) return
        flush(pending)
      }

      const refreshBasis = () => {
        void warmCmeBasis(instrument).then((next) => {
          if (closed) return
          if (next != null) basis = next
          flushPending()
        })
      }

      const cleanup = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = null
        if (basisTimer) clearInterval(basisTimer)
        basisTimer = null
        unsubscribe?.()
        unsubscribe = null
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      // Subscribing replays the hub's last tick, so a warm basis means the first
      // frame leaves here synchronously.
      unsubscribe = subscribeOandaPriceStream(instrument, (quote) => {
        pending = quote
        pendingSent = false
        flushPending()
      })

      if (getCmeBasis(instrument, CME_BASIS_REFRESH_MS) == null) {
        void warmCmeBasis(instrument).then((next) => {
          if (closed) return
          if (next != null) basis = next
          flushPending()
        })
      }

      basisTimer = setInterval(refreshBasis, CME_BASIS_REFRESH_MS)

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
