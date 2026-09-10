/**
 * Databento CME Globex MDP 3.0 client (Historical HTTP API).
 *
 * Auth (hist): HTTP Basic with API key as username and empty password
 *   Authorization: Basic base64(`${DATABENTO_API_KEY}:`)
 *   Host: https://hist.databento.com
 *   Docs: https://databento.com/docs/api-reference-historical/basics/authentication
 *
 * Live Raw API (not used here) is a TCP gateway with CRAM challenge-response —
 * there is no Databento "webhook". Live docs:
 *   https://databento.com/docs/api-reference-live/basics/authentication
 *
 * Portal: Dataset = CME Globex MDP 3.0 (GLBX.MDP3). API key is 32 chars, `db-…`.
 */

import type { Instrument } from '@/types/price-feed'
import { getCme5mRange } from '@/lib/databento/cmeHistorical'

/** Historical HTTP Basic header — key as username, blank password (never Live CRAM). */
export function databentoHistoricalAuthHeader(apiKey: string): string {
  const key = apiKey.trim()
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`
}

export const DATABENTO_SYMBOLS: Record<Instrument, string> = {
  DOW: 'MYM.c.0',
  NASDAQ: 'MNQ.c.0',
  NIKKEI: 'NKD.c.0',
  GOLD: 'MGC.c.0',
  CRUDE: 'CL.c.0',
}

export interface DatabentoCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * Databento JSON may send prices as 1e-9 fixed-point integers OR already-decimal
 * floats / numeric strings (pretty_px). Gold ~4500 and Dow ~53000 must not be
 * divided by 1e9 (that collapses them to 0.00 and the chart falls back / gaps).
 */
export function parseDatabentoPx(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw.replace(/,/g, '')) : Number(raw)
  if (!Number.isFinite(n) || n === 0) return NaN
  if (Math.abs(n) >= 1e6) return n / 1e9
  return n
}

/** hd.ts_event is usually nanoseconds; some encodings already use ms or seconds. */
export function parseDatabentoTs(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return NaN
  if (n > 1e16) return Math.floor(n / 1e9)
  if (n > 1e14) return Math.floor(n / 1e9)
  if (n > 1e12) return Math.floor(n / 1e3)
  return Math.floor(n)
}

/** Union two OHLCV series by bar time. `primary` wins on overlap (live API over archive). */
export function mergeCandleSeries(
  primary: DatabentoCandle[],
  fallback: DatabentoCandle[]
): DatabentoCandle[] {
  if (primary.length === 0) return fallback.slice()
  if (fallback.length === 0) return primary.slice()
  const byTime = new Map<number, DatabentoCandle>()
  for (const c of fallback) {
    if (c.time > 0 && c.close > 0) byTime.set(c.time, c)
  }
  for (const c of primary) {
    if (c.time > 0 && c.close > 0) byTime.set(c.time, c)
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time)
}

// In-memory cache to avoid re-fetching historical ranges
interface CacheEntry {
  at: number
  candles: DatabentoCandle[]
}

const candleCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000 // 1 minute cache

let cachedDatasetEnd: { at: number; end: string } | null = null

export function isDatabentoConfigured(): boolean {
  const key = process.env.DATABENTO_API_KEY?.trim()
  return !!(key && key.startsWith('db-'))
}

/** Get maximum authorized dataset end timestamp from Databento metadata. */
export async function getAvailableDatasetEnd(apiKey: string): Promise<string | null> {
  if (cachedDatasetEnd && Date.now() - cachedDatasetEnd.at < CACHE_TTL_MS) {
    return cachedDatasetEnd.end
  }
  try {
    const res = await fetch('https://hist.databento.com/v0/metadata.get_dataset_range?dataset=GLBX.MDP3', {
      headers: { Authorization: databentoHistoricalAuthHeader(apiKey) },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null
    const json = await res.json()
    if (json?.end && typeof json.end === 'string') {
      cachedDatasetEnd = { at: Date.now(), end: json.end }
      return json.end
    }
  } catch {
    /* fallback */
  }
  return null
}

/** Aggregate 1m bars into 5m / higher resolutions. */
export function aggregateCandles(
  candles: DatabentoCandle[],
  bucketSeconds: number
): DatabentoCandle[] {
  if (candles.length === 0 || bucketSeconds <= 60) return candles
  const out: DatabentoCandle[] = []
  let cur: DatabentoCandle | null = null
  let curBucket = -1

  for (const c of candles) {
    const bucket = Math.floor(c.time / bucketSeconds) * bucketSeconds
    if (!cur || bucket !== curBucket) {
      if (cur) out.push(cur)
      curBucket = bucket
      cur = {
        time: bucket,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }
    } else {
      cur.high = Math.max(cur.high, c.high)
      cur.low = Math.min(cur.low, c.low)
      cur.close = c.close
      cur.volume += c.volume
    }
  }
  if (cur) out.push(cur)
  return out
}

/**
 * Fetch CME Globex 1m candles from Databento and aggregate to desk resolution.
 * Falls back to extracted 6-month CME archive if offline or unconfigured.
 */
export function invalidateDatabentoCandleCache(instrument?: string): void {
  if (!instrument) {
    candleCache.clear()
    cachedDatasetEnd = null
    return
  }
  for (const key of candleCache.keys()) {
    if (key.startsWith(`${instrument}:`)) candleCache.delete(key)
  }
}

export async function getDatabentoCandles(
  instrument: Instrument,
  resolution: string = '5',
  days: number = 5,
  opts?: { bypassCache?: boolean }
): Promise<{ candles: DatabentoCandle[]; symbol: string } | null> {
  const apiKey = process.env.DATABENTO_API_KEY?.trim()
  const symbol = DATABENTO_SYMBOLS[instrument] || 'MYM.c.0'

  const cacheKey = `${instrument}:${resolution}:${days}`
  const cached = candleCache.get(cacheKey)
  if (!opts?.bypassCache && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { candles: cached.candles, symbol }
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const lookbackSec = Math.max(days, 5) * 24 * 3600
  const archiveStart = nowSec - lookbackSec
  const archive5m = getCme5mRange(instrument, archiveStart, nowSec)
  const resSec = resolutionSeconds(resolution)
  const archiveCandles: DatabentoCandle[] = aggregateCandles(
    archive5m.map((b) => ({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    })),
    resSec
  )

  let apiCandles: DatabentoCandle[] = []

  if (apiKey) {
    const maxEnd = await getAvailableDatasetEnd(apiKey)
    const endSec = maxEnd ? Math.floor(new Date(maxEnd).getTime() / 1000) : nowSec - 60
    const startSec = Math.min(archiveStart, endSec - lookbackSec)

    const startDateStr = new Date(startSec * 1000).toISOString().slice(0, 19)
    const endDateStr = new Date(endSec * 1000).toISOString().slice(0, 19)

    const params = new URLSearchParams({
      dataset: 'GLBX.MDP3',
      symbols: symbol,
      schema: 'ohlcv-1m',
      encoding: 'json',
      stype_in: 'continuous',
      start: startDateStr,
      end: endDateStr,
    })

    try {
      const response = await fetch(
        `https://hist.databento.com/v0/timeseries.get_range?${params.toString()}`,
        {
          headers: {
            Authorization: databentoHistoricalAuthHeader(apiKey),
            Accept: 'application/json',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(20_000),
        }
      )

      if (response.ok) {
        const res = await processDatabentoResponse(response, symbol, resolution)
        if (res?.candles?.length) apiCandles = res.candles
      } else {
        const errText = await response.text()
        console.warn(`[Databento] HTTP ${response.status} for ${symbol}: ${errText.slice(0, 150)}`)
      }
    } catch (err) {
      console.error(`[Databento] Fetch failed for ${symbol}:`, err)
    }
  }

  const candles = mergeCandleSeries(apiCandles, archiveCandles)
  if (candles.length > 0) {
    candleCache.set(cacheKey, { at: Date.now(), candles })
    return { candles, symbol }
  }

  return null
}

function resolutionSeconds(resolution: string): number {
  return resolution === '1'
    ? 60
    : resolution === '15'
    ? 900
    : resolution === '30'
    ? 1800
    : resolution === '60'
    ? 3600
    : resolution === '240'
    ? 14400
    : 300
}

async function processDatabentoResponse(
  response: Response,
  symbol: string,
  resolution: string
): Promise<{ candles: DatabentoCandle[]; symbol: string } | null> {
  const text = await response.text()
  if (!text || text.trim().length === 0) return null

  const lines = text.trim().split('\n').filter(Boolean)
  const m1Candles: DatabentoCandle[] = []

  for (const line of lines) {
    try {
      const row = JSON.parse(line)
      if (!row.hd?.ts_event || row.close == null) continue
      const time = parseDatabentoTs(row.hd.ts_event)
      const open = parseDatabentoPx(row.open)
      const high = parseDatabentoPx(row.high)
      const low = parseDatabentoPx(row.low)
      const close = parseDatabentoPx(row.close)
      const volume = Number(row.volume) || 0

      if (
        Number.isFinite(time) &&
        time > 0 &&
        Number.isFinite(open) &&
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        Number.isFinite(close) &&
        close > 0
      ) {
        m1Candles.push({
          time,
          open: Number(open.toFixed(2)),
          high: Number(high.toFixed(2)),
          low: Number(low.toFixed(2)),
          close: Number(close.toFixed(2)),
          volume,
        })
      }
    } catch {
      /* skip malformed line */
    }
  }

  if (m1Candles.length === 0) return null

  m1Candles.sort((a, b) => a.time - b.time)

  const candles = aggregateCandles(m1Candles, resolutionSeconds(resolution))
  return { candles, symbol }
}
