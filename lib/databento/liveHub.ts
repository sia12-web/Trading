/**
 * Node.js Databento Live Hub
 * Multiplexes local connection to Databento Live CME Gateway Sidecar (127.0.0.1:8765).
 * Delivers zero-latency, tick-level CME Globex exchange prints directly to chart streams.
 */

import { spawn } from 'child_process'
import path from 'path'
import type { Instrument } from '@/types/price-feed'
import { isDatabentoConfigured } from '@/lib/databento/client'
import { recordFeedTick } from '@/lib/databento/feedLatencySelector'

export type DatabentoLiveQuote = {
  instrument: Instrument
  price: number
  bid: number
  ask: number
  size: number
  side?: string
  timestamp: number
  source: 'cme_globex'
}

export type DatabentoLiveListener = (quote: DatabentoLiveQuote) => void

type HubState = {
  listeners: Map<Instrument, Set<DatabentoLiveListener>>
  abort: AbortController | null
  active: boolean
  lastByInstrument: Map<Instrument, DatabentoLiveQuote & { receivedAt: number }>
  lastHealthCheck: number
  isSpawning: boolean
}

const g = globalThis as typeof globalThis & {
  __databentoLiveHub?: HubState
}

const SIDECAR_URL = process.env.DATABENTO_SIDECAR_URL || 'http://127.0.0.1:8765'

function hub(): HubState {
  if (!g.__databentoLiveHub) {
    g.__databentoLiveHub = {
      listeners: new Map(),
      abort: null,
      active: false,
      lastByInstrument: new Map(),
      lastHealthCheck: 0,
      isSpawning: false,
    }
  }
  return g.__databentoLiveHub
}

/** Check if the Databento Live Sidecar is currently active and healthy */
export async function checkDatabentoSidecarHealth(): Promise<boolean> {
  const h = hub()
  try {
    const res = await fetch(`${SIDECAR_URL}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) {
      h.active = false
      return false
    }
    const json = await res.json()
    h.active = json?.status === 'ok' && json?.connected === true
    h.lastHealthCheck = Date.now()
    return h.active
  } catch {
    h.active = false
    return false
  }
}

/**
 * Ensure the Python Databento Live Sidecar is running.
 * If down and Databento is configured, automatically spawns it in the background.
 */
export async function ensureDatabentoSidecarRunning(): Promise<boolean> {
  if (!isDatabentoConfigured()) return false
  const healthy = await checkDatabentoSidecarHealth()
  if (healthy) return true

  const h = hub()
  if (h.isSpawning) return false
  h.isSpawning = true

  try {
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'databento_live_sidecar.py')
    const child = spawn('python', ['-u', scriptPath], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
      windowsHide: true,
    })
    child.unref()

    // Give it 2.5 seconds to initialize socket and bind
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 600))
      const ok = await checkDatabentoSidecarHealth()
      if (ok) {
        h.isSpawning = false
        restartUpstream()
        return true
      }
    }
  } catch (err) {
    console.warn('[Databento LiveHub] Failed to spawn sidecar:', err)
  } finally {
    h.isSpawning = false
  }

  return false
}

function emit(quote: DatabentoLiveQuote) {
  const h = hub()
  const now = Date.now()
  const latency = Math.max(1, Math.min(500, now - quote.timestamp * 1000))
  recordFeedTick('databento_live', Number.isFinite(latency) ? latency : 12, false)

  h.lastByInstrument.set(quote.instrument, { ...quote, receivedAt: now })
  const set = h.listeners.get(quote.instrument)
  if (!set || set.size === 0) return
  for (const fn of set) {
    try {
      fn(quote)
    } catch {
      /* ignore */
    }
  }
}

async function runUpstream() {
  const h = hub()
  const abort = new AbortController()
  h.abort = abort

  try {
    const res = await fetch(`${SIDECAR_URL}/stream`, {
      cache: 'no-store',
      headers: { Accept: 'text/event-stream' },
      signal: abort.signal,
    })

    if (!res.ok || !res.body) {
      h.active = false
      return
    }

    h.active = true
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl = buf.indexOf('\n\n')
      while (nl >= 0) {
        const chunk = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 2)
        if (chunk.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(chunk.slice(6))
            if (parsed?.instrument && parsed?.price) {
              emit({
                instrument: parsed.instrument as Instrument,
                price: Number(parsed.price),
                bid: Number(parsed.bid ?? parsed.price),
                ask: Number(parsed.ask ?? parsed.price),
                size: Number(parsed.size ?? 1),
                side: parsed.side,
                timestamp: Number(parsed.timestamp) || Math.floor(Date.now() / 1000),
                source: 'cme_globex',
              })
            }
          } catch {
            /* ignore */
          }
        }
        nl = buf.indexOf('\n\n')
      }
    }
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') {
      h.active = false
    }
  } finally {
    if (h.abort === abort) h.abort = null
  }
}

function restartUpstream() {
  const h = hub()
  h.abort?.abort()
  h.abort = null
  void runUpstream()
}

/** Subscribe to live CME Globex trade ticks for a desk instrument */
export function subscribeDatabentoLive(
  instrument: Instrument,
  listener: DatabentoLiveListener
): () => void {
  const h = hub()
  let set = h.listeners.get(instrument)
  if (!set) {
    set = new Set()
    h.listeners.set(instrument, set)
  }
  const wasEmpty = set.size === 0
  set.add(listener)

  // Deliver cached recent tick immediately if fresh (< 5s)
  const last = h.lastByInstrument.get(instrument)
  if (last && Date.now() - last.receivedAt < 5000) {
    try {
      listener(last)
    } catch {
      /* ignore */
    }
  }

  // Ensure sidecar and upstream connection are active
  if (wasEmpty || !h.abort) {
    void ensureDatabentoSidecarRunning().then((active) => {
      if (active && !h.abort) {
        restartUpstream()
      }
    })
  }

  return () => {
    const cur = hub().listeners.get(instrument)
    if (!cur) return
    cur.delete(listener)
  }
}

/** Check if Databento Live is streaming for this instrument */
export function isDatabentoLiveActive(instrument?: Instrument): boolean {
  const h = hub()
  if (!h.active) return false
  if (instrument) {
    const last = h.lastByInstrument.get(instrument)
    if (!last) return h.active
    return Date.now() - last.receivedAt < 10_000
  }
  return h.active
}

/** Get latest known CME Globex trade quote from Databento Live */
export function getLatestDatabentoLiveQuote(instrument: Instrument): DatabentoLiveQuote | null {
  const h = hub()
  const row = h.lastByInstrument.get(instrument)
  if (!row) return null
  if (Date.now() - row.receivedAt > 15_000) return null
  const { receivedAt: _, ...quote } = row
  return quote
}

/** Fetch snapshot of all live quotes and forming 1m candles */
export async function fetchDatabentoLiveSnapshot(): Promise<{
  quotes: Record<string, DatabentoLiveQuote>
  forming: Record<string, { time: number; open: number; high: number; low: number; close: number; volume: number }>
} | null> {
  try {
    const res = await fetch(`${SIDECAR_URL}/snapshot`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
