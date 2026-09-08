/**
 * CME Globex 6-Month Historical Data Library.
 * Loaded from pre-processed official CME Globex archive (GLBX-20260908-B8NKHSUC8L.zip).
 * Serves 5-Month Anchored VWAP and historical 5-minute candles.
 */

import fs from 'fs'
import path from 'path'
import type { Instrument } from '@/types/price-feed'
import {
  compute5MonthAnchoredVwapFromDailyBars,
  type ContextBar,
  type AnchoredVwapBenchmark5M,
} from '@/lib/chart/context55'

interface DailyBarsData {
  NASDAQ: ContextBar[]
  DOW: ContextBar[]
  GOLD: ContextBar[]
  CRUDE: ContextBar[]
}

interface FiveMinBarsData {
  NASDAQ: ContextBar[]
  DOW: ContextBar[]
  GOLD: ContextBar[]
  CRUDE: ContextBar[]
}

let cachedDailyBars: DailyBarsData | null = null
let cached5mBars: FiveMinBarsData | null = null

function getHistoryDir(): string {
  return path.join(process.cwd(), 'data', 'cme-history')
}

export function loadCmeDailyBars(): DailyBarsData | null {
  if (cachedDailyBars) return cachedDailyBars
  try {
    const filePath = path.join(getHistoryDir(), 'daily_bars.json')
    if (!fs.existsSync(filePath)) return null
    const content = fs.readFileSync(filePath, 'utf-8')
    cachedDailyBars = JSON.parse(content) as DailyBarsData
    return cachedDailyBars
  } catch (err) {
    console.error('[CME History] Failed to load daily bars:', err)
    return null
  }
}

export function loadCme5mBars(): FiveMinBarsData | null {
  if (cached5mBars) return cached5mBars
  try {
    const filePath = path.join(getHistoryDir(), 'recent_5m_bars.json')
    if (!fs.existsSync(filePath)) return null
    const content = fs.readFileSync(filePath, 'utf-8')
    cached5mBars = JSON.parse(content) as FiveMinBarsData
    return cached5mBars
  } catch (err) {
    console.error('[CME History] Failed to load 5m bars:', err)
    return null
  }
}

/**
 * Get CME Daily Bars for an instrument over the last 6 months.
 */
export function getCmeDailyBars(instrument: Instrument): ContextBar[] {
  const data = loadCmeDailyBars()
  if (!data) return []
  const key = instrument === 'NIKKEI' ? 'NASDAQ' : (instrument as keyof DailyBarsData)
  return data[key] || []
}

/**
 * Compute 5-Month Anchored VWAP from official CME Globex daily bars.
 */
export function getCme5MonthAnchoredVwap(
  instrument: Instrument
): AnchoredVwapBenchmark5M | null {
  const bars = getCmeDailyBars(instrument)
  if (!bars || bars.length === 0) return null
  return compute5MonthAnchoredVwapFromDailyBars(bars)
}

/**
 * Get CME 5m bars for an instrument within a unix timestamp range.
 */
export function getCme5mRange(
  instrument: Instrument,
  startUnix: number,
  endUnix: number
): ContextBar[] {
  const data = loadCme5mBars()
  if (!data) return []
  const key = instrument === 'NIKKEI' ? 'NASDAQ' : (instrument as keyof FiveMinBarsData)
  const bars = data[key] || []
  return bars.filter((b) => b.time >= startUnix && b.time <= endUnix)
}
