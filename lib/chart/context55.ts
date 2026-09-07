/**
 * Context Oriented 5-5 System
 *
 * 1. 5-Day Fixed Range Volume Profile (FRVP) - Short Term Money:
 *    Anchored exactly 5 trading days ago at NYC cash open (09:30 America/New_York)
 *    through current live bar. Computes POC, 70% Value Area (VAH / VAL), 5D High, 5D Low,
 *    and High/Low Volume Nodes (HVN / LVN).
 *
 * 2. 5-Month Anchored VWAP (AVWAP) - Long Term Money:
 *    Anchored 5 calendar months ago at cash open.
 *    Computes true 5-month AVWAP + ±1σ and ±2σ standard deviation volatility bands.
 *    Provides persistent reference levels to detect long-term institutional money response.
 *
 * 3. Yesterday NYC Cash Session (Prior Day RTH 09:30–16:00 ET):
 *    Computes Yesterday High (Y-High), Yesterday Low (Y-Low), Yesterday Close (Y-Close),
 *    and Yesterday Point of Control (Y-POC).
 *
 * 4. Overnight Inventory & Sessions (Asia & London FRVPs):
 *    Computes Fixed Range Volume Profile for Asia (18:00–03:00 ET) and London (03:00–09:30 ET).
 *    Evaluates overnight inventory position (% Long vs % Short relative to Y-Close)
 *    and range relationship (In-Range, Outside-Range, Gap Up, Gap Down).
 *
 * 5. Market Day Type Classifier (for "Out" Button):
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
  isUsMarketHoliday,
  isWeekdayYmd,
  nthTradingDayBefore,
  NY_DESK_CLOCK,
  zonedCivilToUnix,
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
  buyVolume: number
  sellVolume: number
  inValueArea: boolean
  isPoc: boolean
}

export interface FixedRangeVolumeProfile5D {
  startUnix: number
  endUnix: number
  high: number
  low: number
  poc: number
  vah: number
  val: number
  totalVolume: number
  totalBuyVolume?: number
  totalSellVolume?: number
  bins: VolumeProfileBin[]
  bucketSize: number
  hvn: number[]
  lvn: number[]
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

export interface AnchoredVwapBenchmark5M {
  anchorDate: string
  anchorUnix: number
  vwap: number
  sigma1Upper: number
  sigma1Lower: number
  sigma2Upper: number
  sigma2Lower: number
  barCount?: number
}

export interface YesterdayNycSession {
  sessionDate: string
  yh: number
  yl: number
  close: number
  poc: number
  vah: number
  val: number
  volume: number
  openUnix: number
  closeUnix: number
  bins?: VolumeProfileBin[]
  bucketSize?: number
}

export interface SessionVolumeProfile {
  name: 'Asia' | 'London' | 'Overnight'
  startUnix: number
  endUnix: number
  high: number
  low: number
  poc: number
  vah: number
  val: number
  totalVolume: number
  bins?: VolumeProfileBin[]
  bucketSize?: number
}

export interface MultiTimeframeOpportunity {
  id: string
  tier: 'LT' | 'IT' | 'ST' | 'CONFLUENCE'
  type: 'TEST' | 'CONFLUENCE' | 'INVENTORY_REBALANCE' | 'BREAKOUT'
  label: string
  targetLevel: number
  distancePts: number
  distancePct: number
  urgency: 'HIGH' | 'MEDIUM' | 'INFO'
  description: string
}

export type OvernightInventoryBias =
  | '100%_NET_LONG'
  | 'NET_LONG_SKEWED'
  | 'BALANCED'
  | 'NET_SHORT_SKEWED'
  | '100%_NET_SHORT'

export type RangeRelation = 'IN_RANGE' | 'OUTSIDE_RANGE' | 'GAP_UP' | 'GAP_DOWN'

export interface OvernightInventoryEvaluation {
  asia: SessionVolumeProfile | null
  london: SessionVolumeProfile | null
  overnight: SessionVolumeProfile | null
  totalVolume: number
  volumeAboveClose: number
  volumeBelowClose: number
  pctLong: number
  pctShort: number
  bias: OvernightInventoryBias
  biasLabel: string
  rangeRelation: RangeRelation
  rangeLabel: string
  summaryBadge: string
  description: string
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

  const todayCashOpen = cashOpenUnixForYmd(ymd, clock)
  // Prior to 9:30 cash open (e.g. at 9:15 AM), today's cash session hasn't started yet.
  // The 5-day anchor starts from 5 completed trading days prior to 9:29 AM.
  // Once 9:30 AM arrives, today becomes active and rolls the 5 trading days window forward.
  const isBeforeOpen = asOfUnix < todayCashOpen
  const effectiveYmd = isBeforeOpen ? nthTradingDayBefore(ymd, 1, clock.timeZone) : ymd
  const startYmd = nthTradingDayBefore(effectiveYmd, 4, clock.timeZone)
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
  dt.setUTCMonth(dt.getUTCMonth() - 5)

  let ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: clock.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt)

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
  type BucketAccumulator = { volume: number; buyVolume: number; sellVolume: number }
  const volumeByBucket = new Map<number, BucketAccumulator>()

  let totalBuyVolume = 0
  let totalSellVolume = 0

  for (const b of scopedBars) {
    const vol = Math.max(0, b.volume > 0 ? b.volume : 1)
    const isUp = b.close >= b.open
    const buyVol = isUp ? vol : 0
    const sellVol = isUp ? 0 : vol
    totalBuyVolume += buyVol
    totalSellVolume += sellVol

    if (b.high - b.low < size * 0.5) {
      const k = roundToBucket((b.high + b.low + b.close) / 3, size)
      const prev = volumeByBucket.get(k) ?? { volume: 0, buyVolume: 0, sellVolume: 0 }
      volumeByBucket.set(k, {
        volume: prev.volume + vol,
        buyVolume: prev.buyVolume + buyVol,
        sellVolume: prev.sellVolume + sellVol,
      })
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
    const buyShare = buyVol / uniq.length
    const sellShare = sellVol / uniq.length
    for (const k of uniq) {
      const prev = volumeByBucket.get(k) ?? { volume: 0, buyVolume: 0, sellVolume: 0 }
      volumeByBucket.set(k, {
        volume: prev.volume + share,
        buyVolume: prev.buyVolume + buyShare,
        sellVolume: prev.sellVolume + sellShare,
      })
    }
  }

  if (volumeByBucket.size === 0) return null

  const sortedBuckets = Array.from(volumeByBucket.entries())
    .map(([price, data]) => ({
      price,
      volume: data.volume,
      buyVolume: data.buyVolume,
      sellVolume: data.sellVolume,
    }))
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
      buyVolume: Number(item.buyVolume.toFixed(2)),
      sellVolume: Number(item.sellVolume.toFixed(2)),
      inValueArea: inVA,
      isPoc: i === pocIdx,
    })
  }

  // Detect High Volume Nodes (HVNs) and Low Volume Nodes (LVNs)
  const avgVol = totalVolume / Math.max(1, sortedBuckets.length)
  const hvn: number[] = []
  const lvn: number[] = []

  for (let i = 1; i < sortedBuckets.length - 1; i++) {
    const prev = sortedBuckets[i - 1]!.volume
    const cur = sortedBuckets[i]!.volume
    const next = sortedBuckets[i + 1]!.volume

    if (cur > prev && cur > next && cur >= avgVol * 1.25) {
      hvn.push(Number(sortedBuckets[i]!.price.toFixed(2)))
    } else if (cur < prev && cur < next && cur <= avgVol * 0.6) {
      lvn.push(Number(sortedBuckets[i]!.price.toFixed(2)))
    }
  }

  return {
    startUnix: anchorUnix,
    endUnix: tipTime,
    high: Number(maxPrice.toFixed(2)),
    low: Number(minPrice.toFixed(2)),
    poc: pocPrice,
    vah: Number(vahPrice.toFixed(2)),
    val: Number(valPrice.toFixed(2)),
    totalVolume,
    totalBuyVolume: Number(totalBuyVolume.toFixed(2)),
    totalSellVolume: Number(totalSellVolume.toFixed(2)),
    bins,
    bucketSize: size,
    hvn: hvn.slice(0, 5),
    lvn: lvn.slice(0, 5),
  }
}

/**
 * Compute true 5-Month Anchored VWAP + ±1σ, ±2σ bands from daily OHLCV bars.
 */
export function compute5MonthAnchoredVwapFromDailyBars(
  dailyBars: ContextBar[],
  asOfUnix?: number,
  clock: DeskClock = NY_DESK_CLOCK
): AnchoredVwapBenchmark5M | null {
  if (!dailyBars || dailyBars.length === 0) return null

  const tipTime = asOfUnix ?? dailyBars[dailyBars.length - 1]!.time
  const anchorUnix = get5MonthAnchorUnix(tipTime, clock)

  const anchorYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: clock.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(anchorUnix * 1000))

  let sumPV = 0
  let sumP2V = 0
  let sumV = 0
  let barCount = 0

  const sorted = [...dailyBars].sort((a, b) => a.time - b.time)

  for (const b of sorted) {
    if (b.time < anchorUnix - 86400) continue
    if (b.time > tipTime) continue

    const price = (b.high + b.low + b.close) / 3
    const vol = b.volume > 0 ? b.volume : 1

    sumPV += price * vol
    sumP2V += price * price * vol
    sumV += vol
    barCount++
  }

  if (sumV <= 0) return null

  const vwap = sumPV / sumV
  const variance = Math.max(0, sumP2V / sumV - vwap * vwap)
  const std = Math.sqrt(variance)

  return {
    anchorDate: anchorYmd,
    anchorUnix,
    vwap: Number(vwap.toFixed(2)),
    sigma1Upper: Number((vwap + std).toFixed(2)),
    sigma1Lower: Number((vwap - std).toFixed(2)),
    sigma2Upper: Number((vwap + 2 * std).toFixed(2)),
    sigma2Lower: Number((vwap - 2 * std).toFixed(2)),
    barCount,
  }
}

/**
 * Compute 5-Month Anchored VWAP with ±1σ and ±2σ standard deviation bands incrementally.
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
 * Compute Yesterday NYC Cash Session (Prior Day RTH 09:30–16:00 ET).
 */
export function computeYesterdayNycSession(
  bars: ContextBar[],
  asOfUnix?: number,
  clock: DeskClock = NY_DESK_CLOCK
): YesterdayNycSession | null {
  if (!bars || bars.length === 0) return null

  const tipTime = asOfUnix ?? bars[bars.length - 1]!.time
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: clock.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(tipTime * 1000))

  let priorYmd = ''
  let rthBars: ContextBar[] = []

  // Loop back up to 10 days to find the last full active (non-holiday) NYC cash session
  for (let daysBack = 1; daysBack <= 10; daysBack++) {
    const candidateYmd = nthTradingDayBefore(todayYmd, daysBack, clock.timeZone)

    // Skip official US stock & futures exchange holidays (e.g. Labor Day, Memorial Day, MLK, etc.)
    if (isUsMarketHoliday(candidateYmd)) {
      continue
    }

    const openUnix = cashOpenUnixForYmd(candidateYmd, clock)
    const closeUnix = zonedCivilToUnix(candidateYmd, 16, clock.timeZone)

    const candidateBars = bars.filter(
      (b) => b.time >= openUnix && b.time < closeUnix && Number.isFinite(b.high) && Number.isFinite(b.low)
    )

    // Skip truncated / early-close / low-participation sessions (< 15 5-min bars)
    if (candidateBars.length < 15) {
      continue
    }

    let volSum = 0
    for (const b of candidateBars) {
      volSum += Math.max(0, b.volume > 0 ? b.volume : 1)
    }

    if (volSum < 50) {
      continue
    }

    priorYmd = candidateYmd
    rthBars = candidateBars
    break
  }

  // Fallback to simple prior trading day if history is sparse (e.g. synthetic test data)
  if (!priorYmd || rthBars.length < 5) {
    priorYmd = nthTradingDayBefore(todayYmd, 1, clock.timeZone)
    const fallbackOpen = cashOpenUnixForYmd(priorYmd, clock)
    const fallbackClose = zonedCivilToUnix(priorYmd, 16, clock.timeZone)
    rthBars = bars.filter(
      (b) => b.time >= fallbackOpen && b.time < fallbackClose && Number.isFinite(b.high) && Number.isFinite(b.low)
    )
  }

  if (rthBars.length < 5) return null

  const openUnix = cashOpenUnixForYmd(priorYmd, clock)
  const closeUnix = zonedCivilToUnix(priorYmd, 16, clock.timeZone)

  let yh = -Infinity
  let yl = Infinity
  let volume = 0

  for (const b of rthBars) {
    if (b.high > yh) yh = b.high
    if (b.low < yl) yl = b.low
    volume += Math.max(0, b.volume > 0 ? b.volume : 1)
  }

  if (!(yh > yl)) return null

  const closeBar = rthBars[rthBars.length - 1]!
  const close = closeBar.close

  // Compute Volume Profile for Yesterday
  const mid = (yh + yl) / 2
  const size = bucketWidth(mid)
  type BucketAccumulator = { volume: number; buyVolume: number; sellVolume: number }
  const volumeByBucket = new Map<number, BucketAccumulator>()

  for (const b of rthBars) {
    const vol = Math.max(0, b.volume > 0 ? b.volume : 1)
    const isUp = b.close >= b.open
    const buyVol = isUp ? vol : 0
    const sellVol = isUp ? 0 : vol

    if (b.high - b.low < size * 0.5) {
      const k = roundToBucket((b.high + b.low + b.close) / 3, size)
      const prev = volumeByBucket.get(k) ?? { volume: 0, buyVolume: 0, sellVolume: 0 }
      volumeByBucket.set(k, {
        volume: prev.volume + vol,
        buyVolume: prev.buyVolume + buyVol,
        sellVolume: prev.sellVolume + sellVol,
      })
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
    const buyShare = buyVol / uniq.length
    const sellShare = sellVol / uniq.length
    for (const k of uniq) {
      const prev = volumeByBucket.get(k) ?? { volume: 0, buyVolume: 0, sellVolume: 0 }
      volumeByBucket.set(k, {
        volume: prev.volume + share,
        buyVolume: prev.buyVolume + buyShare,
        sellVolume: prev.sellVolume + sellShare,
      })
    }
  }

  const sortedBuckets = Array.from(volumeByBucket.entries())
    .map(([price, d]) => ({
      price,
      volume: d.volume,
      buyVolume: d.buyVolume,
      sellVolume: d.sellVolume,
    }))
    .sort((a, b) => a.price - b.price)

  let pocIdx = 0
  for (let i = 1; i < sortedBuckets.length; i++) {
    if (sortedBuckets[i]!.volume > sortedBuckets[pocIdx]!.volume) {
      pocIdx = i
    }
  }
  const poc = Number(sortedBuckets[pocIdx]!.price.toFixed(2))

  const targetVaVolume = volume * 0.7
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

  let valPrice = poc
  let vahPrice = poc
  for (let i = 0; i < sortedBuckets.length; i++) {
    if (vaSet.has(i)) {
      const p = sortedBuckets[i]!.price
      if (p < valPrice) valPrice = p
      if (p > vahPrice) vahPrice = p
    }
  }

  const bins: VolumeProfileBin[] = sortedBuckets.map((b, idx) => ({
    price: b.price,
    volume: b.volume,
    buyVolume: b.buyVolume,
    sellVolume: b.sellVolume,
    inValueArea: vaSet.has(idx),
    isPoc: idx === pocIdx,
  }))

  return {
    sessionDate: priorYmd,
    yh: Number(yh.toFixed(2)),
    yl: Number(yl.toFixed(2)),
    close: Number(close.toFixed(2)),
    poc,
    vah: Number(vahPrice.toFixed(2)),
    val: Number(valPrice.toFixed(2)),
    volume,
    openUnix,
    closeUnix,
    bins,
    bucketSize: size,
  }
}

/**
 * Compute Session Volume Profile for arbitrary time window.
 */
export function computeSessionVolumeProfile(
  bars: ContextBar[],
  startUnix: number,
  endUnix: number,
  name: 'Asia' | 'London' | 'Overnight'
): SessionVolumeProfile | null {
  const sessionBars = bars.filter(
    (b) => b.time >= startUnix && b.time < endUnix && Number.isFinite(b.high) && Number.isFinite(b.low)
  )

  if (sessionBars.length < 3) return null

  let high = -Infinity
  let low = Infinity
  let totalVolume = 0

  for (const b of sessionBars) {
    if (b.high > high) high = b.high
    if (b.low < low) low = b.low
    totalVolume += Math.max(0, b.volume > 0 ? b.volume : 1)
  }

  if (!(high > low)) return null

  const mid = (high + low) / 2
  const size = bucketWidth(mid)
  type BucketAccumulator = { volume: number; buyVolume: number; sellVolume: number }
  const volumeByBucket = new Map<number, BucketAccumulator>()

  for (const b of sessionBars) {
    const vol = Math.max(0, b.volume > 0 ? b.volume : 1)
    const isUp = b.close >= b.open
    const buyVol = isUp ? vol : 0
    const sellVol = isUp ? 0 : vol

    if (b.high - b.low < size * 0.5) {
      const k = roundToBucket((b.high + b.low + b.close) / 3, size)
      const prev = volumeByBucket.get(k) ?? { volume: 0, buyVolume: 0, sellVolume: 0 }
      volumeByBucket.set(k, {
        volume: prev.volume + vol,
        buyVolume: prev.buyVolume + buyVol,
        sellVolume: prev.sellVolume + sellVol,
      })
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
    const buyShare = buyVol / uniq.length
    const sellShare = sellVol / uniq.length
    for (const k of uniq) {
      const prev = volumeByBucket.get(k) ?? { volume: 0, buyVolume: 0, sellVolume: 0 }
      volumeByBucket.set(k, {
        volume: prev.volume + share,
        buyVolume: prev.buyVolume + buyShare,
        sellVolume: prev.sellVolume + sellShare,
      })
    }
  }

  const sortedBuckets = Array.from(volumeByBucket.entries())
    .map(([price, d]) => ({
      price,
      volume: d.volume,
      buyVolume: d.buyVolume,
      sellVolume: d.sellVolume,
    }))
    .sort((a, b) => a.price - b.price)

  let pocIdx = 0
  for (let i = 1; i < sortedBuckets.length; i++) {
    if (sortedBuckets[i]!.volume > sortedBuckets[pocIdx]!.volume) {
      pocIdx = i
    }
  }
  const poc = Number(sortedBuckets[pocIdx]!.price.toFixed(2))

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

  let val = poc
  let vah = poc
  for (let i = 0; i < sortedBuckets.length; i++) {
    if (vaSet.has(i)) {
      const p = sortedBuckets[i]!.price
      if (p < val) val = p
      if (p > vah) vah = p
    }
  }

  const bins: VolumeProfileBin[] = sortedBuckets.map((b, idx) => ({
    price: b.price,
    volume: b.volume,
    buyVolume: b.buyVolume,
    sellVolume: b.sellVolume,
    inValueArea: vaSet.has(idx),
    isPoc: idx === pocIdx,
  }))

  return {
    name,
    startUnix,
    endUnix,
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    poc,
    vah: Number(vah.toFixed(2)),
    val: Number(val.toFixed(2)),
    totalVolume,
    bins,
    bucketSize: size,
  }
}

/**
 * Compute Overnight Inventory and Asia & London Fixed Range Volume Profiles.
 */
export function computeOvernightInventoryAndSessions(args: {
  bars: ContextBar[]
  yesterday: YesterdayNycSession | null
  asOfUnix?: number
  clock?: DeskClock
}): OvernightInventoryEvaluation | null {
  const { bars, yesterday, clock = NY_DESK_CLOCK } = args
  if (!bars || bars.length === 0 || !yesterday) return null

  const tipTime = args.asOfUnix ?? bars[bars.length - 1]!.time
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: clock.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(tipTime * 1000))

  const todayOpenUnix = cashOpenUnixForYmd(todayYmd, clock)

  const priorYmd = yesterday.sessionDate
  const asiaStartUnix = zonedCivilToUnix(priorYmd, 18, clock.timeZone)
  const asiaEndUnix = zonedCivilToUnix(todayYmd, 3, clock.timeZone)

  const londonStartUnix = asiaEndUnix
  const londonEndUnix = todayOpenUnix

  const overnightStartUnix = asiaStartUnix
  const overnightEndUnix = todayOpenUnix

  const asia = computeSessionVolumeProfile(bars, asiaStartUnix, asiaEndUnix, 'Asia')
  const london = computeSessionVolumeProfile(bars, londonStartUnix, londonEndUnix, 'London')
  const overnight = computeSessionVolumeProfile(bars, overnightStartUnix, overnightEndUnix, 'Overnight')

  // Calculate volume distribution relative to Yesterday Close
  const overnightBars = bars.filter((b) => b.time >= overnightStartUnix && b.time < overnightEndUnix)
  let volAbove = 0
  let volBelow = 0
  let totalVol = 0

  for (const b of overnightBars) {
    const vol = Math.max(0, b.volume > 0 ? b.volume : 1)
    totalVol += vol
    if (b.close > yesterday.close) {
      volAbove += vol
    } else if (b.close < yesterday.close) {
      volBelow += vol
    } else {
      volAbove += vol * 0.5
      volBelow += vol * 0.5
    }
  }

  const effectiveTotal = Math.max(1, totalVol)
  const pctLong = Math.round((volAbove / effectiveTotal) * 100)
  const pctShort = Math.round((volBelow / effectiveTotal) * 100)

  let bias: OvernightInventoryBias = 'BALANCED'
  let biasLabel = 'Balanced'

  if (pctLong >= 95) {
    bias = '100%_NET_LONG'
    biasLabel = '100% Long'
  } else if (pctLong >= 70) {
    bias = 'NET_LONG_SKEWED'
    biasLabel = `${pctLong}% Long Skew`
  } else if (pctShort >= 95) {
    bias = '100%_NET_SHORT'
    biasLabel = '100% Short'
  } else if (pctShort >= 70) {
    bias = 'NET_SHORT_SKEWED'
    biasLabel = `${pctShort}% Short Skew`
  }

  // Determine Range Relationship
  const todayBars = bars.filter((b) => b.time >= todayOpenUnix && b.time <= tipTime)
  const onHigh = overnight?.high ?? (overnightBars.length ? Math.max(...overnightBars.map((b) => b.high)) : yesterday.yh)
  const onLow = overnight?.low ?? (overnightBars.length ? Math.min(...overnightBars.map((b) => b.low)) : yesterday.yl)

  let rangeRelation: RangeRelation = 'IN_RANGE'
  let rangeLabel = 'In-Range'

  if (todayBars.length > 0 && todayBars[0]!.open > yesterday.yh) {
    rangeRelation = 'GAP_UP'
    rangeLabel = 'Gap Up'
  } else if (todayBars.length > 0 && todayBars[0]!.open < yesterday.yl) {
    rangeRelation = 'GAP_DOWN'
    rangeLabel = 'Gap Down'
  } else if (onHigh > yesterday.yh || onLow < yesterday.yl) {
    rangeRelation = 'OUTSIDE_RANGE'
    rangeLabel = 'Outside Range'
  }

  const summaryBadge = `Inv: ${biasLabel} · ${rangeLabel}`

  let description = ''
  if (bias === '100%_NET_LONG') {
    description = `Overnight inventory is 100% net long entering NYC open. If the cash market fails to immediately extend above Y-High, watch for rapid inventory correction (long liquidation) returning toward yesterday close (${yesterday.close}) and Y-POC (${yesterday.poc}).`
  } else if (bias === '100%_NET_SHORT') {
    description = `Overnight inventory is 100% net short entering NYC open. If the cash market fails to sustain below Y-Low, watch for sharp short-covering squeeze toward yesterday close (${yesterday.close}) and Y-POC (${yesterday.poc}).`
  } else if (rangeRelation === 'IN_RANGE') {
    description = `Overnight auction was contained completely within yesterday's range [${yesterday.yl} – ${yesterday.yh}]. Symmetrical two-way auction expected unless catalyst initiates directional conviction.`
  } else {
    description = `Overnight inventory (${biasLabel}) tested outside yesterday's boundaries. Monitor opening acceptance vs rejection at prior extremes.`
  }

  return {
    asia,
    london,
    overnight,
    totalVolume: totalVol,
    volumeAboveClose: volAbove,
    volumeBelowClose: volBelow,
    pctLong,
    pctShort,
    bias,
    biasLabel,
    rangeRelation,
    rangeLabel,
    summaryBadge,
    description,
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
  overnightInventory?: OvernightInventoryEvaluation | null
  instrument?: string
  asOfUnix?: number
}): DayTypeEvaluation {
  const { todayBars, overnightInventory } = args
  if (!todayBars || todayBars.length < 3) {
    const invNote = overnightInventory ? ` (${overnightInventory.summaryBadge})` : ''
    return {
      type: 'WAITING',
      badgeText: `Day Type Waiting${invNote}`,
      title: 'Day Type Waiting',
      description: `Establishing initial session range; day structure forming.${overnightInventory ? ` ${overnightInventory.description}` : ''}`,
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
  const firstHourBars = todayBars.slice(0, 12)
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

/**
 * Detect Multi-Timeframe Money Opportunities and Confluences.
 *
 * Tiers:
 * 1. Long-Term Money (LT): 5-Month Anchored VWAP (Macro institutional benchmark).
 * 2. Intermediate-Term Money (IT): 5-Day Fixed Range Volume Profile (Weekly balance).
 * 3. Short-Term Money (ST): Yesterday Fixed Range & Overnight Inventory Fixed Range.
 */
export function detectMultiTimeframeOpportunities(params: {
  currentPrice: number
  avwap5m?: AnchoredVwapBenchmark5M | null
  frvp5d?: FixedRangeVolumeProfile5D | null
  yesterday?: YesterdayNycSession | null
  overnight?: OvernightInventoryEvaluation | null
}): MultiTimeframeOpportunity[] {
  const { currentPrice, avwap5m, frvp5d, yesterday, overnight } = params
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return []

  const opportunities: MultiTimeframeOpportunity[] = []
  const PROXIMITY_PCT = 0.0025 // within 0.25% considered in reaction zone
  const CONFLUENCE_PCT = 0.002 // within 0.2% considered confluent

  // 1. Check Short-Term Money (ST): Overnight POC & Yesterday POC
  if (overnight?.overnight?.poc) {
    const onPoc = overnight.overnight.poc
    const distPts = Math.abs(currentPrice - onPoc)
    const distPct = distPts / onPoc
    if (distPct <= PROXIMITY_PCT) {
      opportunities.push({
        id: 'st-on-poc',
        tier: 'ST',
        type: 'TEST',
        label: `ST: ON-POC Test (${onPoc.toFixed(2)})`,
        targetLevel: onPoc,
        distancePts: Number(distPts.toFixed(2)),
        distancePct: Number(distPct.toFixed(4)),
        urgency: distPct <= 0.001 ? 'HIGH' : 'MEDIUM',
        description: `Price testing Overnight Point of Control. Key day-trader acceptance/rejection zone (${overnight.biasLabel}).`,
      })
    }
  }

  if (yesterday?.poc) {
    const yPoc = yesterday.poc
    const distPts = Math.abs(currentPrice - yPoc)
    const distPct = distPts / yPoc
    if (distPct <= PROXIMITY_PCT) {
      opportunities.push({
        id: 'st-y-poc',
        tier: 'ST',
        type: 'TEST',
        label: `ST: Y-POC Test (${yPoc.toFixed(2)})`,
        targetLevel: yPoc,
        distancePts: Number(distPts.toFixed(2)),
        distancePct: Number(distPct.toFixed(4)),
        urgency: distPct <= 0.001 ? 'HIGH' : 'MEDIUM',
        description: `Price testing Yesterday Point of Control. Prior day fair value benchmark.`,
      })
    }
  }

  // 2. Check Intermediate-Term Money (IT): 5D POC, VAH, VAL
  if (frvp5d?.poc) {
    const poc5d = frvp5d.poc
    const distPts = Math.abs(currentPrice - poc5d)
    const distPct = distPts / poc5d
    if (distPct <= PROXIMITY_PCT) {
      opportunities.push({
        id: 'it-5d-poc',
        tier: 'IT',
        type: 'TEST',
        label: `IT: 5D POC Test (${poc5d.toFixed(2)})`,
        targetLevel: poc5d,
        distancePts: Number(distPts.toFixed(2)),
        distancePct: Number(distPct.toFixed(4)),
        urgency: distPct <= 0.001 ? 'HIGH' : 'MEDIUM',
        description: `Price testing 5-Day Weekly Point of Control. Major intermediate-term balance pivot.`,
      })
    }
  }

  if (frvp5d?.vah) {
    const vah5d = frvp5d.vah
    const distPts = Math.abs(currentPrice - vah5d)
    const distPct = distPts / vah5d
    if (distPct <= PROXIMITY_PCT) {
      opportunities.push({
        id: 'it-5d-vah',
        tier: 'IT',
        type: 'TEST',
        label: `IT: 5D VAH Test (${vah5d.toFixed(2)})`,
        targetLevel: vah5d,
        distancePts: Number(distPts.toFixed(2)),
        distancePct: Number(distPct.toFixed(4)),
        urgency: 'MEDIUM',
        description: `Price testing 5-Day Value Area High. Weekly balance breakout/acceptance threshold.`,
      })
    }
  }

  if (frvp5d?.val) {
    const val5d = frvp5d.val
    const distPts = Math.abs(currentPrice - val5d)
    const distPct = distPts / val5d
    if (distPct <= PROXIMITY_PCT) {
      opportunities.push({
        id: 'it-5d-val',
        tier: 'IT',
        type: 'TEST',
        label: `IT: 5D VAL Test (${val5d.toFixed(2)})`,
        targetLevel: val5d,
        distancePts: Number(distPts.toFixed(2)),
        distancePct: Number(distPct.toFixed(4)),
        urgency: 'MEDIUM',
        description: `Price testing 5-Day Value Area Low. Weekly balance discount buyer responsive zone.`,
      })
    }
  }

  // 3. Check Long-Term Money (LT): 5M AVWAP
  if (avwap5m?.vwap) {
    const vwap5m = avwap5m.vwap
    const distPts = Math.abs(currentPrice - vwap5m)
    const distPct = distPts / vwap5m
    if (distPct <= PROXIMITY_PCT) {
      opportunities.push({
        id: 'lt-5m-avwap',
        tier: 'LT',
        type: 'TEST',
        label: `LT: 5M AVWAP Test (${vwap5m.toFixed(2)})`,
        targetLevel: vwap5m,
        distancePts: Number(distPts.toFixed(2)),
        distancePct: Number(distPct.toFixed(4)),
        urgency: 'HIGH',
        description: `Price testing 5-Month Anchored VWAP. Major institutional macro liquidity zone.`,
      })
    }
  }

  // 4. Confluences: alignment between ST and IT/LT levels
  if (yesterday?.poc && frvp5d?.val && Math.abs(yesterday.poc - frvp5d.val) / yesterday.poc <= CONFLUENCE_PCT) {
    opportunities.push({
      id: 'conf-ypoc-5dval',
      tier: 'CONFLUENCE',
      type: 'CONFLUENCE',
      label: `CONFLUENCE: ST Y-POC & IT 5D-VAL (${yesterday.poc.toFixed(2)})`,
      targetLevel: yesterday.poc,
      distancePts: Number(Math.abs(currentPrice - yesterday.poc).toFixed(2)),
      distancePct: Number((Math.abs(currentPrice - yesterday.poc) / yesterday.poc).toFixed(4)),
      urgency: 'HIGH',
      description: `Short-Term Y-POC aligns with Intermediate-Term 5D VAL. Strong support/reversal confluence.`,
    })
  }

  if (yesterday?.poc && frvp5d?.poc && Math.abs(yesterday.poc - frvp5d.poc) / yesterday.poc <= CONFLUENCE_PCT) {
    opportunities.push({
      id: 'conf-ypoc-5dpoc',
      tier: 'CONFLUENCE',
      type: 'CONFLUENCE',
      label: `CONFLUENCE: ST Y-POC & IT 5D-POC (${yesterday.poc.toFixed(2)})`,
      targetLevel: yesterday.poc,
      distancePts: Number(Math.abs(currentPrice - yesterday.poc).toFixed(2)),
      distancePct: Number((Math.abs(currentPrice - yesterday.poc) / yesterday.poc).toFixed(4)),
      urgency: 'HIGH',
      description: `Short-Term Y-POC aligns with 5-Day weekly POC. Super-composite volume magnet.`,
    })
  }

  // 5. Overnight Inventory Extreme Rebalancing
  if (overnight && (overnight.bias === '100%_NET_LONG' || overnight.bias === '100%_NET_SHORT')) {
    opportunities.push({
      id: 'inv-rebalance',
      tier: 'ST',
      type: 'INVENTORY_REBALANCE',
      label: `OPPORTUNITY: ${overnight.biasLabel} Inventory Rebalance`,
      targetLevel: yesterday?.close ?? currentPrice,
      distancePts: yesterday?.close ? Number(Math.abs(currentPrice - yesterday.close).toFixed(2)) : 0,
      distancePct: yesterday?.close ? Number((Math.abs(currentPrice - yesterday.close) / yesterday.close).toFixed(4)) : 0,
      urgency: 'HIGH',
      description: `Overnight inventory is ${overnight.biasLabel}. High statistical probability of early liquidation towards Yesterday Close.`,
    })
  }

  return opportunities
}
