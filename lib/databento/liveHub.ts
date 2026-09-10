/**
 * Process-level Databento Live Raw hub (TCP + CRAM).
 * Subscribes to CME Globex trades for desk continuous contracts and fans last prints
 * to quote SSE — no webhook. Callers keep OANDA / Yahoo if this is quiet.
 *
 * Docs: https://databento.com/docs/api-reference-live/basics/authentication
 */

import { createConnection, type Socket } from 'net'
import type { Instrument } from '@/types/price-feed'
import {
  DATABENTO_SYMBOLS,
  isDatabentoConfigured,
  parseDatabentoPx,
  parseDatabentoTs,
} from '@/lib/databento/client'
import {
  DATABENTO_LIVE_PORT,
  databentoLiveAuthControlLine,
  databentoLiveCramAuth,
  databentoLiveGatewayHost,
} from '@/lib/databento/liveCram'

const DATASET = 'GLBX.MDP3'
const DESK_LIVE: Instrument[] = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE']

export type DatabentoLiveQuote = {
  instrument: Instrument
  price: number
  bid: number
  ask: number
  timestamp: number
  source: 'databento'
}

export type DatabentoLiveListener = (quote: DatabentoLiveQuote) => void

type HubState = {
  listeners: Map<Instrument, Set<DatabentoLiveListener>>
  lastByInstrument: Map<Instrument, DatabentoLiveQuote & { receivedAt: number }>
  idToInstrument: Map<number, Instrument>
  continuousToInstrument: Map<string, Instrument>
  socket: Socket | null
  runId: number
  buf: string
  phase: 'greeting' | 'cram' | 'auth' | 'streaming'
}

const g = globalThis as typeof globalThis & {
  __databentoLiveHub?: HubState
}

function hub(): HubState {
  if (!g.__databentoLiveHub) {
    g.__databentoLiveHub = {
      listeners: new Map(),
      lastByInstrument: new Map(),
      idToInstrument: new Map(),
      continuousToInstrument: new Map(),
      socket: null,
      runId: 0,
      buf: '',
      phase: 'greeting',
    }
  }
  return g.__databentoLiveHub
}

function continuousMap(): Map<string, Instrument> {
  const m = new Map<string, Instrument>()
  for (const inst of DESK_LIVE) {
    m.set(DATABENTO_SYMBOLS[inst], inst)
  }
  return m
}

function hasListeners(): boolean {
  for (const set of Array.from(hub().listeners.values())) {
    if (set.size > 0) return true
  }
  return false
}

function emit(quote: DatabentoLiveQuote) {
  const h = hub()
  h.lastByInstrument.set(quote.instrument, { ...quote, receivedAt: Date.now() })
  const set = h.listeners.get(quote.instrument)
  if (!set || set.size === 0) return
  for (const fn of Array.from(set)) {
    try {
      fn(quote)
    } catch {
      /* ignore */
    }
  }
}

function parseKvLine(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of line.trim().split('|')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

function handleSymbolMapping(row: Record<string, unknown>) {
  const id = Number(row.instrument_id)
  if (!Number.isFinite(id) || id <= 0) return
  const continuous = hub().continuousToInstrument
  const instrument =
    continuous.get(String(row.stype_in_symbol ?? '')) ??
    continuous.get(String(row.stype_out_symbol ?? ''))
  if (!instrument) return
  hub().idToInstrument.set(id, instrument)
}

function handleTrade(row: Record<string, unknown>) {
  const id = Number(
    row.instrument_id ??
      (row.hd as { instrument_id?: number } | undefined)?.instrument_id
  )
  let instrument = Number.isFinite(id) ? hub().idToInstrument.get(id) ?? null : null
  if (!instrument) {
    const sym = String(row.symbol ?? row.raw_symbol ?? '')
    instrument = hub().continuousToInstrument.get(sym) ?? null
  }
  if (!instrument) return

  const price = parseDatabentoPx(row.price)
  if (!(price > 0)) return

  const hd = row.hd as { ts_event?: unknown } | undefined
  const ts = parseDatabentoTs(hd?.ts_event ?? row.ts_event ?? row.ts_recv)
  const timestamp = Number.isFinite(ts) && ts > 0 ? ts : Math.floor(Date.now() / 1000)

  emit({
    instrument,
    price,
    bid: price,
    ask: price,
    timestamp,
    source: 'databento',
  })
}

function handleJsonRecord(line: string) {
  let row: Record<string, unknown>
  try {
    row = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }
  if (row.stype_in_symbol != null || row.stype_out_symbol != null) {
    handleSymbolMapping(row)
    return
  }
  if (row.price != null && (row.size != null || row.action != null || row.side != null)) {
    handleTrade(row)
    return
  }
  const msg = typeof row.msg === 'string' ? row.msg : ''
  const code =
    row.err != null ? String(row.err) : row.code != null ? String(row.code) : ''
  if (msg && !/heartbeat/i.test(msg)) {
    console.warn('[Databento Live]', code || 'msg', msg.slice(0, 200))
  }
}

function sendLine(socket: Socket, line: string) {
  socket.write(line.endsWith('\n') ? line : `${line}\n`)
}

function closeSocket() {
  const h = hub()
  const sock = h.socket
  h.socket = null
  h.buf = ''
  h.phase = 'greeting'
  if (sock) {
    try {
      sock.destroy()
    } catch {
      /* ignore */
    }
  }
}

async function runSession(runId: number): Promise<void> {
  const apiKey = process.env.DATABENTO_API_KEY?.trim()
  if (!apiKey || !apiKey.startsWith('db-')) return
  if (!hasListeners()) return

  const h = hub()
  h.continuousToInstrument = continuousMap()
  h.idToInstrument = new Map()
  h.buf = ''
  h.phase = 'greeting'

  const host = databentoLiveGatewayHost(DATASET)
  const socket = createConnection({ host, port: DATABENTO_LIVE_PORT })
  h.socket = socket

  await new Promise<void>((resolve, reject) => {
    const onErr = (err: Error) => {
      cleanup()
      reject(err)
    }
    const onClose = () => {
      cleanup()
      resolve()
    }
    const cleanup = () => {
      socket.off('error', onErr)
      socket.off('close', onClose)
      socket.off('data', onData)
    }

    const onData = (chunk: Buffer) => {
      if (hub().runId !== runId) {
        socket.destroy()
        return
      }
      h.buf += chunk.toString('utf8')
      let nl = h.buf.indexOf('\n')
      while (nl >= 0) {
        const line = h.buf.slice(0, nl)
        h.buf = h.buf.slice(nl + 1)
        nl = h.buf.indexOf('\n')
        if (!line.trim()) continue

        if (h.phase === 'greeting') {
          h.phase = 'cram'
          continue
        }
        if (h.phase === 'cram') {
          const kv = parseKvLine(line)
          const cram = kv.cram
          if (!cram) {
            console.warn('[Databento Live] missing cram challenge')
            socket.destroy()
            return
          }
          const token = databentoLiveCramAuth(cram, apiKey)
          sendLine(socket, databentoLiveAuthControlLine(token, DATASET))
          h.phase = 'auth'
          continue
        }
        if (h.phase === 'auth') {
          const kv = parseKvLine(line)
          if (kv.success !== '1') {
            console.warn('[Databento Live] auth failed', line.slice(0, 160))
            socket.destroy()
            return
          }
          const symbols = DESK_LIVE.map((i) => DATABENTO_SYMBOLS[i]).join(',')
          sendLine(socket, `schema=trades|stype_in=continuous|symbols=${symbols}`)
          sendLine(socket, 'start_session=1')
          h.phase = 'streaming'
          continue
        }
        if (line.includes('=') && !line.trimStart().startsWith('{')) {
          const kv = parseKvLine(line)
          if (kv.success === '0') {
            console.warn('[Databento Live] session error', line.slice(0, 160))
            socket.destroy()
          }
          continue
        }
        handleJsonRecord(line)
      }
    }

    socket.on('error', onErr)
    socket.on('close', onClose)
    socket.on('data', onData)
    socket.setKeepAlive(true, 30_000)
    socket.setTimeout(0)
  }).catch((e) => {
    if (hub().runId === runId) {
      console.warn(
        '[Databento Live] session ended:',
        e instanceof Error ? e.message : e
      )
    }
  })

  if (hub().socket === socket) closeSocket()
}

function restartUpstream() {
  const h = hub()
  closeSocket()
  if (!isDatabentoConfigured() || !hasListeners()) return
  const runId = ++h.runId
  void (async () => {
    while (hub().runId === runId && hasListeners()) {
      await runSession(runId)
      if (hub().runId !== runId) break
      if (!hasListeners()) break
      await new Promise((r) => setTimeout(r, 1_250))
    }
  })()
}

/**
 * Subscribe to Databento Live last trade for a desk instrument.
 * Returns unsubscribe. Replays last print immediately when available.
 */
export function subscribeDatabentoLive(
  instrument: Instrument,
  listener: DatabentoLiveListener
): () => void {
  if (!DESK_LIVE.includes(instrument) || !isDatabentoConfigured()) {
    return () => {}
  }

  const h = hub()
  const shouldStart = !hasListeners()
  let set = h.listeners.get(instrument)
  if (!set) {
    set = new Set()
    h.listeners.set(instrument, set)
  }
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

  if (shouldStart) restartUpstream()

  return () => {
    const cur = hub().listeners.get(instrument)
    if (!cur) return
    cur.delete(listener)
    if (cur.size === 0) hub().listeners.delete(instrument)
    if (!hasListeners()) {
      hub().runId++
      closeSocket()
    }
  }
}

export function getLastDatabentoLivePrice(
  instrument: Instrument,
  maxAgeMs = 5_000
): DatabentoLiveQuote | null {
  const row = hub().lastByInstrument.get(instrument)
  if (!row) return null
  if (Date.now() - row.receivedAt > maxAgeMs) return null
  const { receivedAt: _, ...quote } = row
  return quote
}

/** Test helpers */
export function __handleDatabentoLiveJsonForTest(line: string) {
  hub().continuousToInstrument = continuousMap()
  handleJsonRecord(line)
}

export function __resetDatabentoLiveHubForTest() {
  closeSocket()
  g.__databentoLiveHub = {
    listeners: new Map(),
    lastByInstrument: new Map(),
    idToInstrument: new Map(),
    continuousToInstrument: continuousMap(),
    socket: null,
    runId: 0,
    buf: '',
    phase: 'greeting',
  }
}

export function __mapDatabentoInstrumentForTest(
  instrumentId: number,
  instrument: Instrument
) {
  hub().idToInstrument.set(instrumentId, instrument)
}
