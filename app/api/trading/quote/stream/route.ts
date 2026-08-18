/**
 * GET /api/trading/quote/stream?instrument=DOW
 * Server-Sent Events — OANDA ticks shifted onto CME (Tradovate MYM / MNQ / NKD) scale.
 */

import { getYahooQuote } from '@/lib/yahoo/quote'
import {
  getLastStreamedPrice,
  subscribeOandaPriceStream,
} from '@/lib/oanda/pricingStream'
import { isOandaConfigured } from '@/lib/oanda/config'
import { applyCmeBasis, cmeBasisFromPair } from '@/lib/trading/cmeBasis'
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

const dayPrevClose = new Map<string, number>()

function refreshDayPrevClose(instrument: Instrument) {
  void getYahooQuote(instrument)
    .then((q) => {
      if (q?.previous_close && q.previous_close > 0) {
        dayPrevClose.set(instrument, q.previous_close)
      }
    })
    .catch(() => {})
}

function payloadFor(
  instrument: Instrument,
  price: number,
  bid: number,
  ask: number,
  timestamp: number,
  source: 'cme' | 'oanda' = 'oanda'
) {
  const prev = dayPrevClose.get(instrument)
  if (!prev) refreshDayPrevClose(instrument)
  const previous_close = prev ?? price
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

  refreshDayPrevClose(instrument)

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let basisTimer: ReturnType<typeof setInterval> | null = null
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      let basis: number | null = null
      let primed = false
      let pending: ReturnType<typeof getLastStreamedPrice> = getLastStreamedPrice(
        instrument,
        60_000
      )

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

      const refreshBasis = () => {
        void getYahooQuote(instrument)
          .then((y) => {
            if (closed || !(y?.price && y.price > 0)) return
            const o = getLastStreamedPrice(instrument, 8_000)
            if (!(o?.price && o.price > 0)) return
            const next = cmeBasisFromPair(o.price, y.price)
            if (next != null) basis = next
          })
          .catch(() => {})
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

      void getYahooQuote(instrument)
        .then((y) => {
          if (closed) return
          const o = getLastStreamedPrice(instrument, 60_000)
          if (y?.price && o?.price) {
            basis = cmeBasisFromPair(o.price, y.price)
          }
          primed = true
          if (pending) flush(pending)
        })
        .catch(() => {
          primed = true
          if (!closed && pending) flush(pending)
        })

      unsubscribe = subscribeOandaPriceStream(instrument, (quote) => {
        pending = quote
        if (!primed) return
        flush(quote)
      })

      basisTimer = setInterval(refreshBasis, 2_000)

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
