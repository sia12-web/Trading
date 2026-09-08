/**
 * Databento CME Globex MDP 3.0 client.
 * Official CME exchange 1-minute OHLCV candles, aggregated to 5m / desk resolutions.
 */

import type { Instrument } from '@/types/price-feed'
import { getCme5mRange } from '@/lib/databento/cmeHistorical'

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
    const auth = Buffer.from(`${apiKey}:`).toString('base64')
    const res = await fetch('https://hist.databento.com/v0/metadata.get_dataset_range?dataset=GLBX.MDP3', {
      headers: { Authorization: `Basic ${auth}` },
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
export async function getDatabentoCandles(
  instrument: Instrument,
  resolution: string = '5',
  days: number = 5
): Promise<{ candles: DatabentoCandle[]; symbol: string } | null> {
  const apiKey = process.env.DATABENTO_API_KEY?.trim()
  const symbol = DATABENTO_SYMBOLS[instrument] || 'MYM.c.0'

  const cacheKey = `${instrument}:${resolution}:${days}`
  const cached = candleCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { candles: cached.candles, symbol }
  }

  if (apiKey) {
    const maxEnd = await getAvailableDatasetEnd(apiKey)
    const endSec = maxEnd ? Math.floor(new Date(maxEnd).getTime() / 1000) : Math.floor(Date.now() / 1000) - 300
    const startSec = endSec - Math.max(days, 5) * 24 * 3600

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

    const auth = Buffer.from(`${apiKey}:`).toString('base64')

    try {
      const response = await fetch(
        `https://hist.databento.com/v0/timeseries.get_range?${params.toString()}`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        }
      )

      if (response.ok) {
        const res = await processDatabentoResponse(response, symbol, resolution, cacheKey)
        if (res?.candles?.length) return res
      }
    } catch (err) {
      console.error(`[Databento] Fetch failed for ${symbol}:`, err)
    }
  }

  // Fallback to extracted CME 6-month historical 5m bars
  const nowSec = Math.floor(Date.now() / 1000)
  const startSec = nowSec - Math.max(days, 5) * 24 * 3600
  const cme5m = getCme5mRange(instrument, startSec, nowSec)
  if (cme5m.length > 0) {
    const candles: DatabentoCandle[] = cme5m.map((b) => ({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }))
    candleCache.set(cacheKey, { at: Date.now(), candles })
    return { candles, symbol }
  }

  return null
}

async function processDatabentoResponse(
  response: Response,
  symbol: string,
  resolution: string,
  cacheKey: string
): Promise<{ candles: DatabentoCandle[]; symbol: string } | null> {
  const text = await response.text()
  if (!text || text.trim().length === 0) return null

  const lines = text.trim().split('\n').filter(Boolean)
  const m1Candles: DatabentoCandle[] = []

  for (const line of lines) {
    try {
      const row = JSON.parse(line)
      if (!row.hd?.ts_event || row.close == null) continue
      const time = Math.floor(Number(row.hd.ts_event) / 1e9)
      const open = Number(row.open) / 1e9
      const high = Number(row.high) / 1e9
      const low = Number(row.low) / 1e9
      const close = Number(row.close) / 1e9
      const volume = Number(row.volume) || 0

      if (
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

  const resSec = resolution === '1' ? 60 : resolution === '15' ? 900 : resolution === '60' ? 3600 : resolution === '240' ? 14400 : 300
  const candles = aggregateCandles(m1Candles, resSec)

  candleCache.set(cacheKey, { at: Date.now(), candles })
  return { candles, symbol }
}
