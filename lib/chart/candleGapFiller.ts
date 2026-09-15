/**
 * Candle Gap Filler Engine for TradePulse
 * Ensures continuous, zero-gap candlestick series for intraday timeframes (1m, 5m, 15m, 30m, 1H, 4H).
 * Eliminates visual gaps and pattern distortions on charts by carrying forward close prices
 * during active market hours while respecting standard session pauses (17:00-18:00 ET and weekends).
 */

import type { Instrument } from '@/types/price-feed'

export interface BaseCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

const TIMEFRAME_SECONDS: Record<string, number> = {
  '1m': 60,
  '1': 60,
  '5m': 300,
  '5': 300,
  '15m': 900,
  '15': 900,
  '30m': 1800,
  '30': 1800,
  '1H': 3600,
  '60': 3600,
  '4H': 14400,
  '240': 14400,
}

/** Max gap slots to fill in one go to prevent infinite loops (e.g. 5 days of 1m = 7,200 bars) */
const MAX_GAP_FILL_BARS = 10_000

/**
 * Checks if a given UTC timestamp falls during the daily CME maintenance halt
 * (5:00 PM to 6:00 PM US Eastern Time) or weekend market close (Fri 5:00 PM ET to Sun 6:00 PM ET).
 */
export function isCmeMarketHalt(unixSec: number): boolean {
  const date = new Date(unixSec * 1000)

  // Format date parts in US Eastern Time
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date)

  let weekday = ''
  let hour = 0

  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value
    if (part.type === 'hour') hour = parseInt(part.value, 10)
  }

  // CME Weekend close: Friday 17:00 ET through Sunday 18:00 ET
  if (weekday === 'Fri' && hour >= 17) return true
  if (weekday === 'Sat') return true
  if (weekday === 'Sun' && hour < 18) return true

  // Daily CME maintenance break: 17:00 - 18:00 ET Mon-Thu
  if (hour === 17) return true

  return false
}

/**
 * Fills missing timeframe intervals in a candlestick array with carry-forward flat bars.
 * Guaranteed continuous sequence with zero missing time slots during market hours.
 */
export function fillCandleGaps<T extends BaseCandle>(
  candles: T[],
  timeframe: string = '5m',
  _instrument: Instrument = 'NASDAQ'
): T[] {
  if (!Array.isArray(candles) || candles.length < 2) {
    return candles ? [...candles] : []
  }

  const step = TIMEFRAME_SECONDS[timeframe] || TIMEFRAME_SECONDS['5m']!
  if (timeframe === '1D' || timeframe === 'D' || !step) {
    return candles
  }

  // Ensure initial input is strictly sorted by time
  const sorted = [...candles].sort((a, b) => a.time - b.time)
  const result: T[] = []

  let filledCount = 0

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!
    if (!cur || !Number.isFinite(cur.time) || !Number.isFinite(cur.close) || cur.close <= 0) {
      continue
    }

    if (result.length === 0) {
      // Normalize timestamp to bar boundary
      const bucketTime = Math.floor(cur.time / step) * step
      result.push({ ...cur, time: bucketTime })
      continue
    }

    const prev = result[result.length - 1]!
    const targetTime = Math.floor(cur.time / step) * step
    const expectedNextTime = prev.time + step

    if (targetTime === prev.time) {
      // Duplicate bar timestamp - update with latest OHLC
      result[result.length - 1] = {
        ...prev,
        high: Math.max(prev.high, cur.high),
        low: Math.min(prev.low, cur.low),
        close: cur.close,
        volume: (prev.volume || 0) + (cur.volume || 0),
      }
      continue
    }

    // If there is a gap between expectedNextTime and targetTime, fill it
    let cursorTime = expectedNextTime
    while (cursorTime < targetTime && filledCount < MAX_GAP_FILL_BARS) {
      if (!isCmeMarketHalt(cursorTime)) {
        const carryPrice = prev.close
        const gapBar: BaseCandle = {
          time: cursorTime,
          open: carryPrice,
          high: carryPrice,
          low: carryPrice,
          close: carryPrice,
          volume: 0,
        }
        result.push(gapBar as T)
        filledCount++
      }
      cursorTime += step
    }

    result.push({ ...cur, time: targetTime })
  }

  return result
}
