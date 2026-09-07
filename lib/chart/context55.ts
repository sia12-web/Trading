/**
 * Context Oriented 5-5 System
 *
 * 1. 5-Day Fixed Range Volume Profile (FRVP):
 *    Anchored exactly 5 trading days ago at NYC cash open (09:30 America/New_York)
 *    through current live bar. Computes POC, 70% Value Area (VAH / VAL), and histogram.
 *
 * 2. 5-Month Anchored VWAP (AVWAP):
 *    Anchored 5 calendar months ago at cash open.
 *    Computes continuous AVWAP line + ±1σ and ±2σ standard deviation bands.
 *
 * 3. Market Day Type Classifier (for "Out" Button):
 *    Classifies session into Dalton day types:
 *    - Non-Trend Day (NTREND)
 *    - Non-Conviction Day (NCONV)
 *    - Trend Day (Bull / Bear)
 *    - Normal Day
 *    - Normal Variation Day
 *    - Neutral Day
 *    - Day Type Waiting
 */

import {
  cashOpenUnixForYmd,
  deskClockFor,
  isWeekdayYmd,
  nthTradingDayBefore,
  NY_DESK_CLOCK,
  type DeskClock,
} from '@/lib/chart/sessionVwap'
import type { UTCTimestamp } from 'lightweight-charts'

export interface ContextBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface VolumeProfileBin {
  price: number
  volume: number
  inValueArea: boolean
  isPoc: boolean
}

export interface FixedRangeVolumeProfile5D {
  startUnix: number
  endUnix: number
  poc: number
  vah: number
  val: number
  totalVolume: number
  bins: VolumeProfileBin[]
  bucketSize: number
}

export interface AnchoredVwapBands5M {
  anchorUnix: number
  vwap: { time: UTCTimestamp; value: number }[]
  upper1: { time: UTCTimestamp; value: number }[]
  lower1: { time: UTCTimestamp; value: number }[]
  upper2: { time: UTCTimestamp; value: number }[]
  lower2: { time: UTCTimestamp; value: number }[]
  lastVwap: number | null
}

export type MarketDayType =
  | 'WAITING'
  | 'NON_TREND'
  | 'NON_CONVICTION'
  | 'TREND_BULL'
  | 'TREND_BEAR'
  | 'NORMAL'
  | 'NORMAL_VARIATION'
  | 'NEUTRAL'

export interface DayTypeEvaluation {
  type: MarketDayType
  badgeText: string
  title: string
  description: string
}

function bucketWidth(mid: number): number {
  if (!Number.isFinite(mid) || mid <= 0) return 1
  // ~0.015% of price, rounded to readable increments
  const raw = mid * 0.00015
  if (raw >= 10) return Math.round(raw / 5) * 5
  if (raw >= 1) return Math.max(1, Math.round(raw))
  return Math.max(0.1, Math.round(raw * 10) / 10)
}

function roundToBucket(price: number, size: number): number {
  return Math.round(price / size) * size
}

/**
 * Identify the 5-day anchor timestamp (NYC session open 5 trading days ago).
 */
export function get5DayAnchorUnix(
  asOfUnix: number,
  clock: DeskClock = NY_DESK_CLOCK
): number {
  const dt = new Date(asOfUnix * 1000)
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: clock.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt)

  // 5 trading sessions ago (Day -4, Day -3, Day -2, Day -1, Day 0 = 5 sessions)
  const startYmd = nthTradingDayBefore(ymd, 4, clock.timeZone)
  return cashOpenUnixForYmd(startYmd, clock)
}

/**
 * Identify the 5-month anchor timestamp (cash open of first trading day 5 months prior).
 */
export function get5MonthAnchorUnix(
  asOfUnix: number,
  clock: DeskClock = NY_DESK_CLOCK
): number {
  const dt = new Date(asOfUnix * 1000)
  // Step back 5 calendar months
  dt.setUTCMonth(dt.getUTCMonth() - 5)

  let ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: clock.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt)

  // Ensure anchor falls on a weekday trading day
  while (!isWeekdayYmd(ymd, clock.timeZone)) {
    const [y, m, d] = ymd.split('-').map(Number)
    const next = new Date(Date.UTC(y!, m! - 1, d! + 1, 12, 0, 0))
    ymd = next.toISOString().slice(0, 10)
  }

  return cashOpenUnixForYmd(ymd, clock)
}

/**
 * Compute 5-Day Fixed Range Volume Profile (FRVP) starting from NYC open 5 trading days ago.
 */
export function compute5DayFixedRangeVolumeProfile(
  bars: ContextBar[],
  instrument: string = 'DOW',
  asOfUnix?: number
): FixedRangeVolumeProfile5D | null {
  if (!bars || bars.length === 0) return null

  const clock = deskClockFor(instrument)
  const tipTime = asOfUnix ?? bars[bars.length - 1]!.time
  const anchorUnix = get5DayAnchorUnix(tipTime, clock)

  // Filter bars from anchor forward up to tipTime
  const scopedBars = bars.filter(
    (b) =>
      b.time >= anchorUnix &&
      b.time <= tipTime &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      b.high >= b.low
  )

  if (scopedBars.length < 5) return null

  let minPrice = Infinity
  let maxPrice = -Infinity
  let totalVolume = 0

  for (const b of scopedBars) {
    if (b.low < minPrice) minPrice = b.low
    if (b.high > maxPrice) maxPrice = b.high
    totalVolume += Math.max(0, b.volume > 0 ? b.volume : 1)
  }

  if (!(maxPrice > minPrice) || totalVolume <= 0) return null

  const mid = (maxPrice + minPrice) / 2
  const size = bucketWidth(mid)
  const volumeByBucket = new Map<number, number>()

  for (const b of scopedBars) {
    const vol = Math.max(0, b.volume > 0 ? b.volume : 1)
    if (b.high - b.low < size * 0.5) {
      const k = roundToBucket((b.high + b.low + b.close) / 3, size)
      volumeByBucket.set(k, (volumeByBucket.get(k) ?? 0) + vol)
      continue
    }

    const start = roundToBucket(b.low, size)
    const end = roundToBucket(b.high, size)
    const keys: number[] = []
    for (let p = start; p <= end + size * 0.25; p += size) {
      keys.push(roundToBucket(p, size))
    }
    const uniq = Array.from(new Set(keys))
    const share = vol / uniq.length
    for (const k of uniq) {
      volumeByBucket.set(k, (volumeByBucket.get(k) ?? 0) + share)
    }
  }

  if (volumeByBucket.size === 0) return null

  const sortedBuckets = Array.from(volumeByBucket.entries())
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price)

  // Find POC (highest volume bucket)
  let pocIdx = 0
  for (let i = 1; i < sortedBuckets.length; i++) {
    if (sortedBuckets[i]!.volume > sortedBuckets[pocIdx]!.volume) {
      pocIdx = i
    }
  }
  const pocPrice = Number(sortedBuckets[pocIdx]!.price.toFixed(2))

  // Calculate 70% Value Area
  const targetVaVolume = totalVolume * 0.7
  let currentVaVolume = sortedBuckets[pocIdx]!.volume
  let upIdx = pocIdx + 1
  let downIdx = pocIdx - 1
  const vaSet = new Set<number>([pocIdx])

  while (currentVaVolume < targetVaVolume && (upIdx < sortedBuckets.length || downIdx >= 0)) {
    const upVol = upIdx < sortedBuckets.length ? sortedBuckets[upIdx]!.volume : 0
    const downVol = downIdx >= 0 ? sortedBuckets[downIdx]!.volume : 0

    if (upVol >= downVol && upIdx < sortedBuckets.length) {
      currentVaVolume += upVol
      vaSet.add(upIdx)
      upIdx++
    } else if (downIdx >= 0) {
      currentVaVolume += downVol
      vaSet.add(downIdx)
      downIdx--
    } else if (upIdx < sortedBuckets.length) {
      currentVaVolume += upVol
      vaSet.add(upIdx)
      upIdx++
    } else {
      break
    }
  }

  let valPrice = pocPrice
  let vahPrice = pocPrice
  const bins: VolumeProfileBin[] = []

  for (let i = 0; i < sortedBuckets.length; i++) {
    const item = sortedBuckets[i]!
    const inVA = vaSet.has(i)
    if (inVA) {
      if (item.price < valPrice) valPrice = item.price
      if (item.price > vahPrice) vahPrice = item.price
    }
    bins.push({
      price: Number(item.price.toFixed(2)),
      volume: item.volume,
      inValueArea: inVA,
      isPoc: i === pocIdx,
    })
  }

  return {
    startUnix: anchorUnix,
    endUnix: tipTime,
    poc: pocPrice,
    vah: Number(vahPrice.toFixed(2)),
    val: Number(valPrice.toFixed(2)),
    totalVolume,
    bins,
    bucketSize: size,
  }
}

/**
 * Compute 5-Month Anchored VWAP with ±1σ and ±2σ standard deviation bands.
 * Supports optional baseline cumulative sums for lookbacks exceeding candle window.
 */
export function compute5MonthAnchoredVwap(args: {
  bars: ContextBar[]
  instrument?: string
  baseline?: {
    sumPV: number
    sumV: number
    sumP2V: number
    startUnix?: number
  } | null
  asOfUnix?: number
}): AnchoredVwapBands5M | null {
  const { bars, instrument = 'DOW', baseline } = args
  if (!bars || bars.length === 0) return null

  const clock = deskClockFor(instrument)
  const tipTime = args.asOfUnix ?? bars[bars.length - 1]!.time
  const anchorUnix = baseline?.startUnix ?? get5MonthAnchorUnix(tipTime, clock)

  let sumPV = baseline?.sumPV ?? 0
  let sumV = baseline?.sumV ?? 0
  let sumP2V = baseline?.sumP2V ?? 0

  const vwap: { time: UTCTimestamp; value: number }[] = []
  const upper1: { time: UTCTimestamp; value: number }[] = []
  const lower1: { time: UTCTimestamp; value: number }[] = []
  const upper2: { time: UTCTimestamp; value: number }[] = []
  const lower2: { time: UTCTimestamp; value: number }[] = []

  for (const c of bars) {
    if (c.time < anchorUnix && !baseline) continue

    const price = (c.high + c.low + c.close) / 3
    const vol = c.volume > 0 ? c.volume : 1
    sumPV += price * vol
    sumP2V += price * price * vol
    sumV += vol

    if (sumV <= 0) continue

    const v = sumPV / sumV
    const variance = Math.max(0, sumP2V / sumV - v * v)
    const std = Math.sqrt(variance)
    const t = c.time as UTCTimestamp

    vwap.push({ time: t, value: Number(v.toFixed(2)) })
    upper1.push({ time: t, value: Number((v + std).toFixed(2)) })
    lower1.push({ time: t, value: Number((v - std).toFixed(2)) })
    upper2.push({ time: t, value: Number((v + 2 * std).toFixed(2)) })
    lower2.push({ time: t, value: Number((v - 2 * std).toFixed(2)) })
  }

  if (vwap.length === 0) return null

  return {
    anchorUnix,
    vwap,
    upper1,
    lower1,
    upper2,
    lower2,
    lastVwap: vwap[vwap.length - 1]?.value ?? null,
  }
}

/**
 * Classify Market Day Type (Dalton Market Profile framework) for the "Out" button.
 */
export function classifyMarketDayType(args: {
  todayBars: ContextBar[]
  priorDaysBars?: ContextBar[]
  openingType?: string | null
  controlLabel?: string | null
  ydayVah?: number | null
  ydayVal?: number | null
  instrument?: string
  asOfUnix?: number
}): DayTypeEvaluation {
  const { todayBars } = args
  if (!todayBars || todayBars.length < 3) {
    return {
      type: 'WAITING',
      badgeText: 'Day Type Waiting',
      title: 'Day Type Waiting',
      description: 'Insufficient bars to establish day structure (minimum 15m required).',
    }
  }

  let high = -Infinity
  let low = Infinity
  let totalVol = 0

  for (const b of todayBars) {
    if (b.high > high) high = b.high
    if (b.low < low) low = b.low
    totalVol += Math.max(0, b.volume)
  }

  const todayRange = high > low ? high - low : 0

  // 1. Check Non-Trend Day (NTREND: tight compression & dry volume)
  if (todayBars.length >= 6) {
    const avgRangeEstimate = todayBars[0]!.open * 0.003
    if (todayRange > 0 && todayRange < avgRangeEstimate * 0.35) {
      return {
        type: 'NON_TREND',
        badgeText: 'Non-Trend Day',
        title: 'Non-Trend Day (NTREND)',
        description:
          'Extremely narrow range and muted volume. Market is not facilitating trade; stand aside.',
      }
    }
  }

  // 2. Check Non-Conviction Day (NCONV: open in prior VA & trapped inside prior VA)
  if (
    args.ydayVah != null &&
    args.ydayVal != null &&
    args.ydayVah > args.ydayVal &&
    high <= args.ydayVah + 1e-6 &&
    low >= args.ydayVal - 1e-6 &&
    args.controlLabel !== 'ONE-TF BUY' &&
    args.controlLabel !== 'ONE-TF SELL'
  ) {
    return {
      type: 'NON_CONVICTION',
      badgeText: 'Non-Conviction Day',
      title: 'Non-Conviction Day (NCONV)',
      description:
        'Auction contained completely inside yesterday Value Area. Zero directional conviction.',
    }
  }

  // 3. Check Trend Day (Continuous One-Time Framing & range expansion)
  if (args.controlLabel === 'ONE-TF BUY' && todayBars.length >= 6) {
    return {
      type: 'TREND_BULL',
      badgeText: 'Trend Day (Bull)',
      title: 'Bullish Trend Day',
      description:
        'Sustained upward one-time framing with aggressive directional conviction.',
    }
  }
  if (args.controlLabel === 'ONE-TF SELL' && todayBars.length >= 6) {
    return {
      type: 'TREND_BEAR',
      badgeText: 'Trend Day (Bear)',
      title: 'Bearish Trend Day',
      description:
        'Sustained downward one-time framing with aggressive directional conviction.',
    }
  }

  // 4. Initial range checks for Normal vs Normal Variation vs Neutral
  const firstHourBars = todayBars.slice(0, 12) // first 60m of 5m bars
  if (firstHourBars.length >= 8) {
    let ibHigh = -Infinity
    let ibLow = Infinity
    for (const b of firstHourBars) {
      if (b.high > ibHigh) ibHigh = b.high
      if (b.low < ibLow) ibLow = b.low
    }
    const ibRange = ibHigh - ibLow

    const extendedHigh = high > ibHigh + ibRange * 0.15
    const extendedLow = low < ibLow - ibRange * 0.15

    // Neutral Day: extended on both sides
    if (extendedHigh && extendedLow) {
      return {
        type: 'NEUTRAL',
        badgeText: 'Neutral Day',
        title: 'Neutral Day',
        description:
          'Range extended both above and below the morning range. Two-sided auction / reversal.',
      }
    }

    // Normal Variation Day: extended significantly on one side
    if (extendedHigh || extendedLow) {
      return {
        type: 'NORMAL_VARIATION',
        badgeText: 'Normal Variation',
        title: 'Normal Variation Day',
        description:
          'Morning base extended by secondary directional probe (~0.5x to 1x IB range).',
      }
    }

    // Normal Day: stays within initial range
    return {
      type: 'NORMAL',
      badgeText: 'Normal Day',
      title: 'Normal Day',
      description:
        'Wide initial range remains holding. Trading rotates symmetrically around center of balance.',
    }
  }

  return {
    type: 'WAITING',
    badgeText: 'Day Type Waiting',
    title: 'Day Type Waiting',
    description: 'Establishing initial session range; day structure forming.',
  }
}
