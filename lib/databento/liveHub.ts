/**
 * Node.js Databento Live Hub
 * Multiplexes local connection to Databento Live CME Gateway Sidecar (127.0.0.1:8765).
 * Delivers zero-latency, tick-level CME Globex exchange prints directly to chart streams.
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
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
  /** Exact forming 1m OHLCV from every exchange print. */
  bar?: DatabentoLiveBar
}

export type DatabentoLiveListener = (quote: DatabentoLiveQuote) => void

type HubState = {
  listeners: Map<Instrument, Set<DatabentoLiveListener>>
  abort: AbortController | null
  active: boolean
  lastByInstrument: Map<Instrument, DatabentoLiveQuote & { receivedAt: number }>
  lastHealthCheck: number
  isSpawning: boolean
  lastTickAt: number
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  /** Epoch ms until which the sidecar is treated as down, so callers skip the timeout. */
  downUntil: number
}

const g = globalThis as typeof globalThis & {
  __databentoLiveHub?: HubState
}

const SIDECAR_URL = process.env.DATABENTO_SIDECAR_URL || 'http://127.0.0.1:8765'

/** A feed delivering prints inside this window is live regardless of health-probe latency. */
const TICK_LIVE_WINDOW_MS = 45_000
/** How long to skip sidecar HTTP probes after a failure, so requests never pay the timeout. */
const DOWN_BACKOFF_MS = 15_000

function hub(): HubState {
  if (!g.__databentoLiveHub) {
    g.__databentoLiveHub = {
      listeners: new Map(),
      abort: null,
      active: false,
      lastByInstrument: new Map(),
      lastHealthCheck: 0,
      isSpawning: false,
      lastTickAt: 0,
      reconnectAttempts: 0,
      reconnectTimer: null,
      downUntil: 0,
    }
  }
  return g.__databentoLiveHub
}

/** True when exchange prints arrived recently enough to trust the feed without probing. */
function hasRecentTicks(h: HubState = hub()): boolean {
  return h.lastTickAt > 0 && Date.now() - h.lastTickAt < TICK_LIVE_WINDOW_MS
}

/** True when the sidecar is inside its failure backoff and should not be probed. */
export function isDatabentoSidecarDown(): boolean {
  return Date.now() < hub().downUntil
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
      h.downUntil = Date.now() + DOWN_BACKOFF_MS
      // A probe failure must not silence a stream that is still delivering prints,
      // or the desk flaps onto a slower feed mid-session.
      if (!hasRecentTicks(h)) h.active = false
      return false
    }
    const json = await res.json()
    h.downUntil = 0
    h.active = (json?.status === 'ok' && json?.connected === true) || hasRecentTicks(h)
    h.lastHealthCheck = Date.now()
    return h.active
  } catch {
    h.downUntil = Date.now() + DOWN_BACKOFF_MS
    if (!hasRecentTicks(h)) h.active = false
    return false
  }
}

/**
 * Python interpreter used for the sidecar. The deploy image installs `databento` into
 * /opt/venv, which a bare `python3` would not see.
 */
function resolvePythonBin(): string {
  const explicit = process.env.DATABENTO_SIDECAR_PYTHON?.trim()
  if (explicit) return explicit
  if (process.platform === 'win32') return 'python'
  for (const candidate of ['/opt/venv/bin/python3', '/opt/venv/bin/python']) {
    if (existsSync(candidate)) return candidate
  }
  return 'python3'
}

/** Set when spawning is pointless (no interpreter, managed externally) to stop retry churn. */
let spawnBlockedUntil = 0

/**
 * Ensure the Python Databento Live Sidecar is running.
 * If down and Databento is configured, automatically spawns it in the background.
 * Spawning is skipped when the sidecar is managed externally (DATABENTO_SIDECAR_URL set
 * to a remote host) or when a previous spawn attempt proved the interpreter is missing.
 */
export async function ensureDatabentoSidecarRunning(): Promise<boolean> {
  if (!isDatabentoConfigured()) return false
  const healthy = await checkDatabentoSidecarHealth()
  if (healthy) return true

  const h = hub()
  if (h.isSpawning) return false
  if (Date.now() < spawnBlockedUntil) return false
  if (process.env.DATABENTO_SIDECAR_URL) return false
  h.isSpawning = true

  try {
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'databento_live_sidecar.py')
    const pythonBin = resolvePythonBin()
    const child = spawn(pythonBin, ['-u', scriptPath], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
      windowsHide: true,
    })
    let spawnFailed = false
    child.on('error', (err) => {
      spawnFailed = true
      console.warn(`[Databento LiveHub] Cannot start sidecar (${pythonBin}):`, err.message)
    })
    child.unref()

    // Give it 3 seconds to install its handler, bind the socket and reach the gateway
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 600))
      if (spawnFailed) break
      // The failure backoff would otherwise make every probe in this loop a no-op
      h.downUntil = 0
      const ok = await checkDatabentoSidecarHealth()
      if (ok) {
        h.isSpawning = false
        restartUpstream()
        return true
      }
    }
    if (spawnFailed) {
      // No usable interpreter — stop paying 3s of spawn+probe on every subscribe.
      spawnBlockedUntil = Date.now() + 10 * 60_000
    }
  } catch (err) {
    spawnBlockedUntil = Date.now() + 10 * 60_000
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

  // An arriving exchange print is the strongest possible liveness signal.
  h.active = true
  h.lastTickAt = now
  h.downUntil = 0
  h.reconnectAttempts = 0

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
                bar:
                  parsed.bar && Number(parsed.bar.close) > 0
                    ? {
                        time: Number(parsed.bar.time),
                        open: Number(parsed.bar.open),
                        high: Number(parsed.bar.high),
                        low: Number(parsed.bar.low),
                        close: Number(parsed.bar.close),
                        volume: Number(parsed.bar.volume) || 0,
                      }
                    : undefined,
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
      if (!hasRecentTicks(h)) h.active = false
    }
  } finally {
    if (h.abort === abort) {
      h.abort = null
      // The stream ended on its own (sidecar restart, gateway drop). Without this the
      // feed stays dark until some future subscriber happens to re-arm it.
      if (!abort.signal.aborted) scheduleReconnect()
    }
  }
}

/**
 * Reconnect the sidecar stream with capped exponential backoff. Only one timer is ever
 * pending, so overlapping drops cannot fan out into a reconnect storm.
 */
function scheduleReconnect() {
  const h = hub()
  if (h.reconnectTimer) return

  let anyListeners = false
  for (const set of h.listeners.values()) {
    if (set.size > 0) {
      anyListeners = true
      break
    }
  }
  if (!anyListeners) return

  const attempt = Math.min(h.reconnectAttempts++, 5)
  const delay = Math.min(250 * 2 ** attempt, 8_000)
  h.reconnectTimer = setTimeout(() => {
    h.reconnectTimer = null
    void ensureDatabentoSidecarRunning().then((ok) => {
      if (ok && !h.abort) restartUpstream()
      else scheduleReconnect()
    })
  }, delay)
  h.reconnectTimer.unref?.()
}

function restartUpstream() {
  const h = hub()
  const prev = h.abort
  h.abort = null
  prev?.abort()
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
    // A local SSE socket can be connected before the Databento gateway has
    // delivered this instrument. Treating the socket itself as market data
    // silences OANDA and leaves the chart frozen on startup/reconnect.
    if (!last) return false
    // Wide window prevents quiet market periods from flapping to secondary feeds
    return Date.now() - last.receivedAt < TICK_LIVE_WINDOW_MS
  }
  return h.active
}

/** Get latest known CME Globex trade quote from Databento Live */
export function getLatestDatabentoLiveQuote(instrument: Instrument): DatabentoLiveQuote | null {
  const h = hub()
  const row = h.lastByInstrument.get(instrument)
  if (!row) return null
  if (Date.now() - row.receivedAt > TICK_LIVE_WINDOW_MS) return null
  const { receivedAt: _, ...quote } = row
  return quote
}

export type DatabentoLiveBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function isTimeoutError(err: unknown): boolean {
  const name = (err as Error)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

/**
 * Real 1m bars the sidecar assembled from live CME prints, from `sinceSec` onward and
 * including the forming bar. Historical bar vendors lag the tape by several minutes, so
 * this is the only true source for the most recent bars.
 */
export async function fetchDatabentoLiveBars(
  instrument: Instrument,
  sinceSec: number
): Promise<DatabentoLiveBar[] | null> {
  const h = hub()
  // Ticks flowing means the sidecar is up — a prior HTTP timeout must not
  // blackout the bar overlay for 15s (that is visible delay + gaps).
  if (isDatabentoSidecarDown() && !hasRecentTicks(h)) return null
  try {
    const res = await fetch(
      `${SIDECAR_URL}/bars?instrument=${encodeURIComponent(instrument)}&since=${Math.floor(sinceSec)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(2_000) }
    )
    if (!res.ok) {
      if (!hasRecentTicks(h)) h.downUntil = Date.now() + DOWN_BACKOFF_MS
      return null
    }
    const json = await res.json()
    const bars = json?.bars?.[instrument]
    if (!Array.isArray(bars)) return null
    return bars.filter(
      (b: DatabentoLiveBar) =>
        Number.isFinite(b?.time) && Number.isFinite(b?.close) && b.close > 0
    )
  } catch (err) {
    if (!isTimeoutError(err) && !hasRecentTicks(h)) {
      h.downUntil = Date.now() + DOWN_BACKOFF_MS
    }
    return null
  }
}

/**
 * Latest real CME print, preferring in-process hub state and falling back to the sidecar.
 * The hub is only warm in a process that holds an open upstream stream, so routes that do
 * not subscribe (candles) would otherwise silently drop to a basis-shifted proxy.
 */
export async function resolveDatabentoLiveQuote(
  instrument: Instrument
): Promise<DatabentoLiveQuote | null> {
  const local = getLatestDatabentoLiveQuote(instrument)
  if (local) return local
  const snap = await fetchDatabentoLiveSnapshot()
  const row = snap?.quotes?.[instrument]
  if (!row || !(Number(row.price) > 0)) return null
  // The sidecar retains the last print indefinitely, so an idle or closed market would
  // otherwise hand back a quote from hours ago as if it were live.
  const ageMs = Date.now() - Number(row.timestamp) * 1000
  if (!Number.isFinite(ageMs) || ageMs > TICK_LIVE_WINDOW_MS) return null
  return {
    instrument,
    price: Number(row.price),
    bid: Number(row.bid ?? row.price),
    ask: Number(row.ask ?? row.price),
    size: Number(row.size ?? 1),
    side: row.side,
    timestamp: Number(row.timestamp) || Math.floor(Date.now() / 1000),
    source: 'cme_globex',
    bar: row.bar,
  }
}

/** Fetch snapshot of all live quotes and forming 1m candles */
export async function fetchDatabentoLiveSnapshot(): Promise<{
  quotes: Record<string, DatabentoLiveQuote>
  forming: Record<string, { time: number; open: number; high: number; low: number; close: number; volume: number }>
} | null> {
  const h = hub()
  // Request paths await this snapshot, so a down sidecar must fail instantly rather than
  // adding the full timeout to every candle response.
  if (isDatabentoSidecarDown() && !hasRecentTicks(h)) return null
  try {
    const res = await fetch(`${SIDECAR_URL}/snapshot`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    })
    if (!res.ok) {
      if (!hasRecentTicks(h)) h.downUntil = Date.now() + DOWN_BACKOFF_MS
      return null
    }
    return await res.json()
  } catch (err) {
    if (!isTimeoutError(err) && !hasRecentTicks(h)) {
      h.downUntil = Date.now() + DOWN_BACKOFF_MS
    }
    return null
  }
}
