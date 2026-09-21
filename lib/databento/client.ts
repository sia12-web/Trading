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

/**
 * CME Equity Index Futures (MYM, MNQ, NKD) roll 8 days prior to the 3rd Friday
 * of March (H), June (M), September (U), December (Z).
 */
export function getActiveCmeQuarterlyContract(
  root: 'MYM' | 'MNQ' | 'NKD',
  now: Date = new Date()
): string {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const yearDigit = String(year).slice(-1)

  function getThirdFriday(y: number, m: number): number {
    let fridays = 0
    for (let d = 1; d <= 31; d++) {
      const date = new Date(Date.UTC(y, m - 1, d))
      if (date.getUTCDay() === 5) {
        fridays++
        if (fridays === 3) return d
      }
    }
    return 21
  }

  const getRollThursday = (y: number, m: number) => getThirdFriday(y, m) - 8

  if (month < 3 || (month === 3 && day < getRollThursday(year, 3))) {
    return `${root}H${yearDigit}`
  } else if (month < 6 || (month === 6 && day < getRollThursday(year, 6))) {
    return `${root}M${yearDigit}`
  } else if (month < 9 || (month === 9 && day < getRollThursday(year, 9))) {
    return `${root}U${yearDigit}`
  } else if (month < 12 || (month === 12 && day < getRollThursday(year, 12))) {
    return `${root}Z${yearDigit}`
  } else {
    const nextYearDigit = String(year + 1).slice(-1)
    return `${root}H${nextYearDigit}`
  }
}

const NYMEX_MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'] as const

function nyCivilDate(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value || 0)
  return { y: get('year'), m: get('month'), d: get('day') }
}

function ymdNum(y: number, m: number, d: number): number {
  return y * 10000 + m * 100 + d
}

function isWeekendUtc(y: number, m: number, d: number): boolean {
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return w === 0 || w === 6
}

function prevBusinessDay(y: number, m: number, d: number): [number, number, number] {
  const dt = new Date(Date.UTC(y, m - 1, d))
  do {
    dt.setUTCDate(dt.getUTCDate() - 1)
  } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6)
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()]
}

function businessDaysBefore(y: number, m: number, d: number, n: number): [number, number, number] {
  let cy = y
  let cm = m
  let cd = d
  for (let i = 0; i < n; i++) {
    ;[cy, cm, cd] = prevBusinessDay(cy, cm, cd)
  }
  return [cy, cm, cd]
}

/**
 * CME WTI last trade date: 3 business days prior to the 25th of the month
 * preceding the contract month. If the 25th is a weekend, 3 business days
 * prior to the last business day before the 25th.
 */
function clLastTradeYmd(contractYear: number, contractMonth: number): [number, number, number] {
  let y = contractYear
  let m = contractMonth - 1
  if (m < 1) {
    m = 12
    y -= 1
  }
  let originY = y
  let originM = m
  let originD = 25
  if (isWeekendUtc(y, m, 25)) {
    ;[originY, originM, originD] = prevBusinessDay(y, m, 25)
  }
  return businessDaysBefore(originY, originM, originD, 3)
}

/**
 * Volume-lead WTI month (same contract Tradovate / Yahoo CL=F use).
 * `CL.c.0` is calendar front and stays on the expiring month after volume has
 * already rolled — that was painting October (~97) on a November (~93) book.
 */
export function getActiveCmeClContract(now: Date = new Date()): string {
  const ny = nyCivilDate(now)
  const today = ymdNum(ny.y, ny.m, ny.d)
  // Roll 5 business days before last trade so we follow volume, not the expiry calendar.
  const ROLL_LEAD_BD = 5
  for (let i = 0; i < 14; i++) {
    const dt = new Date(Date.UTC(ny.y, ny.m - 1 + i, 1))
    const cy = dt.getUTCFullYear()
    const cm = dt.getUTCMonth() + 1
    const last = clLastTradeYmd(cy, cm)
    const roll = businessDaysBefore(last[0], last[1], last[2], ROLL_LEAD_BD)
    if (today <= ymdNum(roll[0], roll[1], roll[2])) {
      return `CL${NYMEX_MONTH_CODES[cm - 1]}${String(cy).slice(-1)}`
    }
  }
  return `CL${NYMEX_MONTH_CODES[ny.m - 1]}${String(ny.y).slice(-1)}`
}

export function getDatabentoActiveSymbol(
  instrument: Instrument,
  now: Date = new Date()
): { symbol: string; stype_in: 'raw_symbol' | 'continuous' } {
  if (instrument === 'DOW') {
    return { symbol: getActiveCmeQuarterlyContract('MYM', now), stype_in: 'raw_symbol' }
  }
  if (instrument === 'NASDAQ') {
    return { symbol: getActiveCmeQuarterlyContract('MNQ', now), stype_in: 'raw_symbol' }
  }
  if (instrument === 'NIKKEI') {
    return { symbol: getActiveCmeQuarterlyContract('NKD', now), stype_in: 'raw_symbol' }
  }
  if (instrument === 'GOLD') {
    return { symbol: 'MGC.c.0', stype_in: 'continuous' }
  }
  if (instrument === 'CRUDE') {
    return { symbol: getActiveCmeClContract(now), stype_in: 'raw_symbol' }
  }
  return { symbol: 'MYM.c.0', stype_in: 'continuous' }
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
  const activeSym = getDatabentoActiveSymbol(instrument)
  const symbol = activeSym.symbol

  const cacheKey = `${instrument}:${resolution}:${days}:${symbol}`
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
      stype_in: activeSym.stype_in,
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
      } else {
        const errText = await response.text()
        console.warn(`[Databento] HTTP ${response.status} for ${symbol}: ${errText.slice(0, 150)}`)

        // If requested range extends past dataset end, parse authorized max timestamp and retry query
        const match = errText.match(/and\s+([0-9T:\-\.]+Z)/)
        if (match && match[1]) {
          const validEndIso = match[1].slice(0, 19)
          const validEndSec = Math.floor(new Date(validEndIso).getTime() / 1000)
          const validStartSec = validEndSec - Math.max(days, 5) * 24 * 3600
          const validStartIso = new Date(validStartSec * 1000).toISOString().slice(0, 19)

          const retryParams = new URLSearchParams({
            dataset: 'GLBX.MDP3',
            symbols: symbol,
            schema: 'ohlcv-1m',
            encoding: 'json',
            stype_in: activeSym.stype_in,
            start: validStartIso,
            end: validEndIso,
          })

          const retryRes = await fetch(
            `https://hist.databento.com/v0/timeseries.get_range?${retryParams.toString()}`,
            {
              headers: {
                Authorization: `Basic ${auth}`,
                Accept: 'application/json',
              },
              cache: 'no-store',
              signal: AbortSignal.timeout(15_000),
            }
          )
          if (retryRes.ok) {
            const res = await processDatabentoResponse(retryRes, symbol, resolution, cacheKey)
            if (res?.candles?.length) return res
          }
        }
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
    const resSec =
      resolution === '1'
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
    const finalCandles = resSec > 300 ? aggregateCandles(candles, resSec) : candles
    candleCache.set(cacheKey, { at: Date.now(), candles: finalCandles })
    return { candles: finalCandles, symbol }
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

  const resSec =
    resolution === '1'
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
  const candles = aggregateCandles(m1Candles, resSec)

  candleCache.set(cacheKey, { at: Date.now(), candles })
  return { candles, symbol }
}
