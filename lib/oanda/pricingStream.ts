/**
 * Process-level OANDA pricing stream hub.
 * One upstream connection multiplexes desk instruments; fans out to SSE subscribers.
 */

import type { Instrument } from '@/types/price-feed'
import {
  fromOandaInstrument,
  isOandaConfigured,
  oandaAccountId,
  oandaApiKey,
  oandaStreamBaseUrl,
  OANDA_INSTRUMENTS,
  toOandaInstrument,
} from '@/lib/oanda/config'
import type { OandaPriceQuote } from '@/lib/oanda/pricing'

export type PriceTickListener = (quote: OandaPriceQuote) => void

type MidSample = { tMs: number; mid: number }

type HubState = {
  listeners: Map<Instrument, Set<PriceTickListener>>
  abort: AbortController | null
  runId: number
  lastByInstrument: Map<Instrument, OandaPriceQuote & { receivedAt: number }>
  midHistory: Map<Instrument, MidSample[]>
}

/** Keep enough mids to pair a 10-minute delayed CME print. */
const MID_HISTORY_TTL_MS = 12 * 60_000
/** Downsample so a 50ms tick burst does not fill RAM. */
const MID_HISTORY_MIN_STEP_MS = 250

const g = globalThis as typeof globalThis & {
  __oandaPricingHub?: HubState
}

function hub(): HubState {
  if (!g.__oandaPricingHub) {
    g.__oandaPricingHub = {
      listeners: new Map(),
      abort: null,
      runId: 0,
      lastByInstrument: new Map(),
      midHistory: new Map(),
    }
  }
  // HMR may revive an older hub shape
  if (!g.__oandaPricingHub.midHistory) {
    g.__oandaPricingHub.midHistory = new Map()
  }
  return g.__oandaPricingHub
}

function pruneMidHistory(rows: MidSample[], nowMs: number): MidSample[] {
  const floor = nowMs - MID_HISTORY_TTL_MS
  let i = 0
  while (i < rows.length && rows[i]!.tMs < floor) i++
  return i > 0 ? rows.slice(i) : rows
}

/** Record a mid so a delayed Yahoo print can pair with the same-age OANDA book. */
export function recordOandaMidSample(
  instrument: Instrument,
  mid: number,
  tMs: number = Date.now()
): void {
  if (!(mid > 0) || !Number.isFinite(tMs)) return
  const h = hub()
  const prev = h.midHistory.get(instrument) ?? []
  const last = prev[prev.length - 1]
  if (last && tMs >= last.tMs && tMs - last.tMs < MID_HISTORY_MIN_STEP_MS) {
    last.tMs = tMs
    last.mid = mid
    h.midHistory.set(instrument, pruneMidHistory(prev, Date.now()))
    return
  }
  prev.push({ tMs, mid })
  if (last && tMs < last.tMs) {
    prev.sort((a, b) => a.tMs - b.tMs)
  }
  h.midHistory.set(instrument, pruneMidHistory(prev, Date.now()))
}

/**
 * OANDA mid nearest to a unix-second timestamp, or null if nothing is inside
 * maxDeltaMs. Used to pair delayed CME lasts with a contemporaneous CFD mid.
 */
export function getStreamedMidNear(
  instrument: Instrument,
  unixSec: number,
  maxDeltaMs = 2_000
): number | null {
  if (!(unixSec > 0)) return null
  const rows = hub().midHistory.get(instrument)
  if (!rows || rows.length === 0) return null
  const target = unixSec * 1000
  let best: MidSample | null = null
  let bestDelta = Infinity
  for (const row of rows) {
    const d = Math.abs(row.tMs - target)
    if (d < bestDelta) {
      bestDelta = d
      best = row
    }
  }
  if (!best || bestDelta > maxDeltaMs) return null
  return best.mid
}

export function __resetOandaMidHistoryForTest(): void {
  hub().midHistory = new Map()
}

function wantedSymbols(): string[] {
  const h = hub()
  const out: string[] = []
  for (const instrument of h.listeners.keys()) {
    if ((h.listeners.get(instrument)?.size ?? 0) === 0) continue
    const sym = toOandaInstrument(instrument)
    if (sym) out.push(sym)
  }
  return out.sort()
}

function emit(quote: OandaPriceQuote, instrument: Instrument) {
  const h = hub()
  h.lastByInstrument.set(instrument, { ...quote, receivedAt: Date.now() })
  recordOandaMidSample(instrument, quote.price)
  const set = h.listeners.get(instrument)
  if (!set || set.size === 0) return
  for (const fn of set) {
    try {
      fn(quote)
    } catch {
      /* ignore listener errors */
    }
  }
}

function parsePriceLine(line: string): OandaPriceQuote | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let json: any
  try {
    json = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (json?.type !== 'PRICE') return null
  const symbol = String(json.instrument || '')
  const instrument = fromOandaInstrument(symbol)
  if (!instrument) return null
  const bid = parseFloat(json?.bids?.[0]?.price ?? json?.closeoutBid)
  const ask = parseFloat(json?.asks?.[0]?.price ?? json?.closeoutAsk)
  if (!(bid > 0) || !(ask > 0)) return null
  const price = (bid + ask) / 2
  const timeRaw = json?.time
  const timestamp = timeRaw
    ? Math.floor(new Date(timeRaw).getTime() / 1000)
    : Math.floor(Date.now() / 1000)
  return {
    symbol,
    price,
    bid,
    ask,
    timestamp,
    source: 'oanda',
  }
}

async function runUpstream(runId: number, symbols: string[]): Promise<number | null> {
  if (!isOandaConfigured() || symbols.length === 0) return null

  const accountId = oandaAccountId()
  const url =
    `${oandaStreamBaseUrl()}/v3/accounts/${encodeURIComponent(accountId)}` +
    `/pricing/stream?instruments=${encodeURIComponent(symbols.join(','))}`

  const abort = new AbortController()
  const h = hub()
  h.abort = abort

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${oandaApiKey()}`,
        Accept: 'application/octet-stream',
      },
      cache: 'no-store',
      signal: abort.signal,
    })
    if (!res.ok || !res.body) {
      if (res.status !== 403) {
        console.warn(`[OANDA] pricing stream ${res.status}`)
      }
      return res.status
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      if (hub().runId !== runId) {
        abort.abort()
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl = buf.indexOf('\n')
      while (nl >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        const quote = parsePriceLine(line)
        if (quote) {
          const instrument = fromOandaInstrument(quote.symbol)
          if (instrument) emit(quote, instrument)
        }
        nl = buf.indexOf('\n')
      }
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return null
    console.error(
      '[OANDA] pricing stream failed:',
      e instanceof Error ? e.message : e
    )
    return null
  } finally {
    if (hub().abort === abort) hub().abort = null
  }
  return null
}

function restartUpstream() {
  const h = hub()
  const symbols = wantedSymbols()
  h.abort?.abort()
  h.abort = null
  if (symbols.length === 0) return
  const runId = ++h.runId
  void (async () => {
    // Reconnect loop while this run is current and listeners remain
    while (hub().runId === runId && wantedSymbols().length > 0) {
      const syms = wantedSymbols()
      const status = await runUpstream(runId, syms)
      if (hub().runId !== runId) break
      if (wantedSymbols().length === 0) break
      const delay = status === 403 ? 30_000 : 750
      await new Promise((r) => setTimeout(r, delay))
    }
  })()
}

/**
 * Subscribe to live mid ticks for a desk instrument.
 * Returns unsubscribe. Last tick (if any) is delivered immediately.
 */
export function subscribeOandaPriceStream(
  instrument: Instrument,
  listener: PriceTickListener
): () => void {
  if (!OANDA_INSTRUMENTS[instrument]) {
    return () => {}
  }

  const h = hub()
  let set = h.listeners.get(instrument)
  if (!set) {
    set = new Set()
    h.listeners.set(instrument, set)
  }
  const wasEmpty = set.size === 0
  set.add(listener)

  const last = h.lastByInstrument.get(instrument)
  if (last) {
    try {
      const { receivedAt: _at, ...quote } = last
      listener(quote)
    } catch {
      /* ignore */
    }
  }

  if (wasEmpty) restartUpstream()

  return () => {
    const cur = hub().listeners.get(instrument)
    if (!cur) return
    cur.delete(listener)
    if (cur.size === 0) {
      hub().listeners.delete(instrument)
      restartUpstream()
    }
  }
}

export function getLastStreamedPrice(
  instrument: Instrument,
  maxAgeMs = 2_000
): OandaPriceQuote | null {
  const row = hub().lastByInstrument.get(instrument)
  if (!row) return null
  if (Date.now() - row.receivedAt > maxAgeMs) return null
  const { receivedAt: _, ...quote } = row
  return quote
}

/** Test helper — parse one NDJSON PRICE line */
export function __parseOandaPriceLineForTest(line: string) {
  return parsePriceLine(line)
}
