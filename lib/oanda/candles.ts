/**
 * OANDA practice/live candle history for desk indices (near-24h).
 * Instruments: US30_USD (DOW), NAS100_USD (NASDAQ), JP225_USD (NIKKEI).
 */

import type { Instrument } from '@/types/price-feed'
import { isOandaConfigured, oandaBaseUrl, oandaHeaders, OANDA_INSTRUMENTS } from '@/lib/oanda/config'

const GRANULARITY: Record<string, string> = {
  '1': 'M1',
  '5': 'M5',
  '15': 'M15',
  '60': 'H1',
  '240': 'H4',
}

export type OandaCandle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function rfc3339(unix: number): string {
  return new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, '.000000000Z')
}

async function fetchChunk(
  instrument: string,
  granularity: string,
  fromUnix: number,
  toUnix: number
): Promise<OandaCandle[]> {
  if (!isOandaConfigured()) return []

  const params = new URLSearchParams({
    granularity,
    price: 'M',
    from: rfc3339(fromUnix),
    to: rfc3339(toUnix),
  })

  const url = `${oandaBaseUrl()}/v3/instruments/${instrument}/candles?${params}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(url, {
      headers: oandaHeaders(),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[OANDA] candles ${res.status} ${instrument}: ${text.slice(0, 200)}`)
      return []
    }

    const json = await res.json()
    const out: OandaCandle[] = []
    for (const c of json.candles || []) {
      if (c.complete === false) continue
      const mid = c.mid
      if (!mid) continue
      const t = Math.floor(new Date(c.time).getTime() / 1000)
      if (!Number.isFinite(t)) continue
      out.push({
        time: t,
        open: parseFloat(mid.o),
        high: parseFloat(mid.h),
        low: parseFloat(mid.l),
        close: parseFloat(mid.c),
        volume: Number(c.volume) || 0,
      })
    }
    return out
  } catch (e) {
    console.error(`[OANDA] candles chunk failed ${instrument}:`, e instanceof Error ? e.message : e)
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch OANDA mid candles for DOW/NASDAQ/NIKKEI over [period1, period2] unix seconds.
 * Chunks by ~3 days for M5; fetches chunks in parallel so sim desk doesn't hang.
 */
export async function getOandaCandlesRange(
  instrument: Instrument,
  resolution: string,
  period1: number,
  period2: number
): Promise<{ candles: OandaCandle[]; symbol: string; source: 'oanda' } | null> {
  if (!isOandaConfigured()) return null
  const symbol = OANDA_INSTRUMENTS[instrument]
  if (!symbol) return null

  const granularity = GRANULARITY[resolution] || 'M5'
  const chunkSec = granularity === 'M1' ? 1 * 86400 : 3 * 86400

  const ranges: Array<{ from: number; to: number }> = []
  let cursor = Math.floor(period1)
  const end = Math.floor(period2)
  while (cursor < end) {
    const chunkEnd = Math.min(cursor + chunkSec, end)
    ranges.push({ from: cursor, to: chunkEnd })
    cursor = chunkEnd
  }

  const parts = await Promise.all(
    ranges.map((r) => fetchChunk(symbol, granularity, r.from, r.to))
  )
  const candles = parts.flat()

  candles.sort((a, b) => a.time - b.time)
  const deduped: OandaCandle[] = []
  for (const c of candles) {
    const prev = deduped[deduped.length - 1]
    if (prev && prev.time === c.time) deduped[deduped.length - 1] = c
    else deduped.push(c)
  }

  if (deduped.length === 0) return null
  return { candles: deduped, symbol, source: 'oanda' }
}

export async function getOandaCandles(
  instrument: Instrument,
  resolution: string,
  days: number
): Promise<{ candles: OandaCandle[]; symbol: string; source: 'oanda' } | null> {
  const end = Math.floor(Date.now() / 1000)
  const start = end - Math.max(days, 1) * 86400
  return getOandaCandlesRange(instrument, resolution, start, end)
}
