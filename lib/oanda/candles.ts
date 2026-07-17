/**
 * OANDA practice/live candle history for NY desk indices (near-24h).
 * Instruments: US30_USD (DOW), NAS100_USD (NASDAQ).
 */

import type { Instrument } from '@/types/price-feed'

const OANDA_INSTRUMENTS: Partial<Record<Instrument, string>> = {
  DOW: 'US30_USD',
  NASDAQ: 'NAS100_USD',
}

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

function baseUrl(): string {
  const env = (process.env.OANDA_ENVIRONMENT || 'practice').toLowerCase()
  return env === 'live'
    ? 'https://api-fxtrade.oanda.com'
    : 'https://api-fxpractice.oanda.com'
}

function rfc3339(unix: number): string {
  return new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, '.000000000Z')
}

function isConfigured(): boolean {
  return Boolean(process.env.OANDA_API_KEY && process.env.OANDA_ACCOUNT_ID)
}

async function fetchChunk(
  instrument: string,
  granularity: string,
  fromUnix: number,
  toUnix: number
): Promise<OandaCandle[]> {
  const key = process.env.OANDA_API_KEY
  if (!key) return []

  const params = new URLSearchParams({
    granularity,
    price: 'M',
    from: rfc3339(fromUnix),
    to: rfc3339(toUnix),
  })

  const url = `${baseUrl()}/v3/instruments/${instrument}/candles?${params}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
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
}

/**
 * Fetch OANDA mid candles for DOW/NASDAQ over [period1, period2] unix seconds.
 * Chunks by ~3 days for M5 to stay under API limits.
 */
export async function getOandaCandlesRange(
  instrument: Instrument,
  resolution: string,
  period1: number,
  period2: number
): Promise<{ candles: OandaCandle[]; symbol: string; source: 'oanda' } | null> {
  if (!isConfigured()) return null
  const symbol = OANDA_INSTRUMENTS[instrument]
  if (!symbol) return null

  const granularity = GRANULARITY[resolution] || 'M5'
  const chunkSec = granularity === 'M1' ? 1 * 86400 : 3 * 86400
  const candles: OandaCandle[] = []

  let cursor = Math.floor(period1)
  const end = Math.floor(period2)
  while (cursor < end) {
    const chunkEnd = Math.min(cursor + chunkSec, end)
    const part = await fetchChunk(symbol, granularity, cursor, chunkEnd)
    candles.push(...part)
    cursor = chunkEnd
  }

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
