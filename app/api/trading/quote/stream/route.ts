/**
 * GET /api/trading/quote/stream?instrument=DOW
 * Server-Sent Events — live OANDA mid pushed on every PRICE tick.
 */

import { getYahooQuote } from '@/lib/yahoo/quote'
import {
  getLastStreamedPrice,
  subscribeOandaPriceStream,
} from '@/lib/oanda/pricingStream'
import { isOandaConfigured } from '@/lib/oanda/config'
import { isLiveDeskInstrument } from '@/lib/trading/sessionGate'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** Railway / long-lived SSE — keep connection open through the cash session */
export const maxDuration = 300

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
  timestamp: number
) {
  const prev = dayPrevClose.get(instrument)
  if (!prev) refreshDayPrevClose(instrument)
  const previous_close = prev ?? price
  const change = price - previous_close
  const change_pct = previous_close ? (change / previous_close) * 100 : 0
  return {
    instrument,
    source: 'oanda' as const,
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
  const { searchParams } = new URL(request.url)
  const instrument = (searchParams.get('instrument') || 'DOW') as Instrument

  if (!isLiveDeskInstrument(instrument)) {
    return new Response(JSON.stringify({ error: 'Invalid instrument' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
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
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
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

      const cleanup = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = null
        unsubscribe?.()
        unsubscribe = null
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      // Snapshot if hub already has a tick
      const last = getLastStreamedPrice(instrument, 60_000)
      if (last) {
        send(
          payloadFor(
            instrument,
            last.price,
            last.bid,
            last.ask,
            last.timestamp
          )
        )
      }

      unsubscribe = subscribeOandaPriceStream(instrument, (quote) => {
        send(
          payloadFor(
            instrument,
            quote.price,
            quote.bid,
            quote.ask,
            quote.timestamp
          )
        )
      })

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
