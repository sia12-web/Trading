'use client'

/**
 * Shared live-price subscription for open positions and working limits.
 * One EventSource per instrument for the whole tab; cards subscribe to it.
 */

import { useEffect, useRef, useState } from 'react'
import type { Instrument } from '@/types/trading'

const LIVE_INSTRUMENTS: readonly Instrument[] = [
  'DOW',
  'NASDAQ',
  'NIKKEI',
  'GOLD',
  'CRUDE',
]

type PriceSubscriber = (price: number, timestamp: string) => void

interface InstrumentPriceStream {
  source: EventSource
  subscribers: Set<PriceSubscriber>
  listeners: Set<() => void>
  isConnected: boolean
  lastPrice: number | null
  lastUpdateTime: string | null
}

/** Module-level cache: one SSE connection per instrument, shared by every card. */
const streamsByInstrument = new Map<string, InstrumentPriceStream>()

interface FeedSnapshot {
  isConnected: boolean
  lastPrice: number | null
  lastUpdateTime: string | null
}

const DISCONNECTED_FEED: FeedSnapshot = {
  isConnected: false,
  lastPrice: null,
  lastUpdateTime: null,
}

function isLiveInstrument(value: Instrument | null): value is Instrument {
  return value != null && (LIVE_INSTRUMENTS as readonly string[]).includes(value)
}

function timestampToString(timestamp: unknown): string {
  if (typeof timestamp === 'string' && timestamp.length > 0) return timestamp
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000
    return new Date(ms).toISOString()
  }
  return new Date().toISOString()
}

function notifyListeners(stream: InstrumentPriceStream) {
  for (const listener of stream.listeners) {
    try {
      listener()
    } catch {
      /* one card's render error must not drop the socket */
    }
  }
}

function publishPrice(stream: InstrumentPriceStream, price: number, timestamp: string) {
  stream.isConnected = true
  stream.lastPrice = price
  stream.lastUpdateTime = timestamp
  for (const subscriber of stream.subscribers) {
    try {
      subscriber(price, timestamp)
    } catch {
      /* one subscriber must not block the rest */
    }
  }
  notifyListeners(stream)
}

function bindStream(stream: InstrumentPriceStream, instrument: Instrument) {
  stream.source.onmessage = (event) => {
    let msg: { price?: unknown; timestamp?: unknown; instrument?: unknown }
    try {
      msg = JSON.parse(event.data) as typeof msg
    } catch {
      return
    }
    if (
      typeof msg.instrument === 'string' &&
      msg.instrument.toUpperCase() !== instrument
    ) {
      return
    }
    if (typeof msg.price !== 'number' || !Number.isFinite(msg.price) || msg.price <= 0) {
      return
    }
    publishPrice(stream, msg.price, timestampToString(msg.timestamp))
  }

  stream.source.onerror = () => {
    stream.isConnected = false
    notifyListeners(stream)
  }
}

/**
 * Opens the quote stream once per instrument. Later callers reuse the cached
 * EventSource instead of opening another socket.
 */
function openInstrumentStream(instrument: Instrument): InstrumentPriceStream | null {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return null
  const cached = streamsByInstrument.get(instrument)
  if (cached) return cached

  const source = new EventSource(
    `/api/trading/quote/stream?instrument=${encodeURIComponent(instrument)}`
  )
  const stream: InstrumentPriceStream = {
    source,
    subscribers: new Set(),
    listeners: new Set(),
    isConnected: false,
    lastPrice: null,
    lastUpdateTime: null,
  }
  bindStream(stream, instrument)
  streamsByInstrument.set(instrument, stream)
  return stream
}

function releaseInstrumentStream(
  instrument: Instrument,
  subscriber: PriceSubscriber,
  listener: () => void
) {
  const stream = streamsByInstrument.get(instrument)
  if (!stream) return
  stream.subscribers.delete(subscriber)
  stream.listeners.delete(listener)
  if (stream.subscribers.size === 0) {
    try {
      stream.source.close()
    } catch {
      /* already closed */
    }
    streamsByInstrument.delete(instrument)
  }
}

export function usePositionPriceSubscription(
  instrument: Instrument | null,
  onPriceUpdate: (price: number, timestamp: string) => void
): FeedSnapshot {
  const [feed, setFeed] = useState<FeedSnapshot>(DISCONNECTED_FEED)
  const onPriceRef = useRef(onPriceUpdate)
  onPriceRef.current = onPriceUpdate

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return
    if (!isLiveInstrument(instrument)) return

    const stream = openInstrumentStream(instrument)
    if (!stream) return

    const subscriber: PriceSubscriber = (price, timestamp) => {
      onPriceRef.current(price, timestamp)
    }
    stream.subscribers.add(subscriber)

    const sync = () => {
      setFeed((prev) => {
        if (
          prev.isConnected === stream.isConnected &&
          prev.lastPrice === stream.lastPrice &&
          prev.lastUpdateTime === stream.lastUpdateTime
        ) {
          return prev
        }
        return {
          isConnected: stream.isConnected,
          lastPrice: stream.lastPrice,
          lastUpdateTime: stream.lastUpdateTime,
        }
      })
    }
    stream.listeners.add(sync)
    sync()
    if (stream.lastPrice != null && stream.lastUpdateTime != null) {
      subscriber(stream.lastPrice, stream.lastUpdateTime)
    }

    return () => {
      releaseInstrumentStream(instrument, subscriber, sync)
    }
  }, [instrument])

  return feed
}
