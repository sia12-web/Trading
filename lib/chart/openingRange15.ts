/**
 * Opening range — first 15 minutes of cash open (distinct from 30m OR30 and 60m IB).
 *
 *   DOW / NASDAQ: 09:30 → 09:45 ET · ±10 entries 09:45–10:00
 *   NIKKEI:       09:00 → 09:15 JST · ±10 entries 09:15–09:30
 */

import {
  computeInitialBalance,
  ibLineSeriesData,
  type DeskBar,
  type InitialBalanceRange,
} from '@/lib/trading/deskLevels'
import {
  computeRangeBreakRejectSignals,
  type RangeBreakSignal,
} from '@/lib/chart/rangeBreakSignals'
import { deskLocalRangeAsTraderDisplay } from '@/lib/chart/traderDisplayTz'

export const OR15_MINUTES = 15

export const OR15_COLORS = {
  high: '#f59e0b',
  low: '#f59e0b',
} as const

export type Or15Range = InitialBalanceRange & {
  complete: boolean
}

export function isOr15Instrument(
  instrument: string | null | undefined
): boolean {
  return instrument === 'DOW' || instrument === 'NASDAQ' || instrument === 'NIKKEI'
}

export function or15WindowLabel(
  instrument: string | null | undefined,
  now: Date = new Date()
): string {
  if (instrument === 'NIKKEI') {
    return deskLocalRangeAsTraderDisplay('09:00:00', '09:15:00', 'Asia/Tokyo', now)
  }
  return deskLocalRangeAsTraderDisplay(
    '09:30:00',
    '09:45:00',
    'America/New_York',
    now
  )
}

export function computeOr15Range(
  candles: DeskBar[],
  openUnix: number,
  nowUnix: number = Math.floor(Date.now() / 1000)
): Or15Range | null {
  if (!openUnix || candles.length === 0) return null
  if (nowUnix < openUnix) return null

  const endUnix = openUnix + OR15_MINUTES * 60
  const bars = candles.filter(
    (c) => c.time >= openUnix && c.time < endUnix && c.time <= nowUnix
  )
  const complete = nowUnix >= endUnix

  if (bars.length < 2) {
    if (!complete) return null
    const locked = computeInitialBalance(candles, openUnix, nowUnix, OR15_MINUTES)
    return locked ? { ...locked, complete: true } : null
  }

  let hi = -Infinity
  let lo = Infinity
  for (const c of bars) {
    if (c.high > hi) hi = c.high
    if (c.low < lo) lo = c.low
  }
  if (!(hi > lo) || !Number.isFinite(hi) || !Number.isFinite(lo)) return null

  const fromTime = bars[0]!.time as number
  const toTime = bars[bars.length - 1]!.time as number
  if (!(toTime > fromTime)) return null

  return {
    high: Math.round(hi * 100) / 100,
    low: Math.round(lo * 100) / 100,
    openUnix,
    endUnix,
    fromTime,
    toTime,
    complete,
  }
}

export function or15LineSeriesData(
  range: Or15Range,
  extendToUnix?: number
): {
  high: { time: number; value: number }[]
  low: { time: number; value: number }[]
} {
  return ibLineSeriesData(range, extendToUnix)
}

/** OR15 BRK (RVOL) + REJ after the 15m window. Once per side. */
export function computeOr15Signals(
  candles: DeskBar[],
  range: Or15Range | null,
  opts?: { useVol?: boolean; volThresh?: number; volLen?: number }
): RangeBreakSignal[] {
  if (!range) return []
  return computeRangeBreakRejectSignals(candles, range, {
    labelPrefix: 'O15',
    colors: {
      brkLong: '#22c55e',
      brkShort: '#ef4444',
      rejHigh: '#f97316',
      rejLow: '#a855f7',
    },
    signalAfterUnix: range.endUnix,
    useVol: opts?.useVol,
    volThresh: opts?.volThresh,
    volLen: opts?.volLen,
    oncePerSide: true,
  })
}
