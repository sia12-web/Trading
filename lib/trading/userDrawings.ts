import type { ContextBar, VolumeProfileBin } from '@/lib/chart/context55'

export interface UserTrendline {
  id: string
  type: 'TRENDLINE'
  p1: { time: number; price: number }
  p2: { time: number; price: number }
  color?: string
  label?: string
  instrument?: string
  sessionOrigin?: 'Asia' | 'London' | 'NYC'
  isCarriedFromOvernight?: boolean
  breakCountOvernight?: number
  direction?: 'BEARISH' | 'BULLISH'
  isAutoDetected?: boolean
  isActionTrendline?: boolean
  isReactionTrendline?: boolean
  parentActionTrendlineId?: string
  actionBreakoutConfirmed?: boolean
  breakoutTime?: number
  breakoutPrice?: number
  isInitialOvernight?: boolean
}

export interface UserRangeBox {
  id: string
  type: 'RANGE'
  p1: { time: number; price: number }
  p2: { time: number; price: number }
  color?: string
  label?: string
  instrument?: string
  timeframe?: string
}

export interface UserManualFRVP {
  id: string
  type: 'FRVP'
  timeStart: number
  timeEnd: number
  poc: number
  vah: number
  val: number
  high: number
  low: number
  totalVolume: number
  buyVolume: number
  sellVolume: number
  bucketSize: number
  bins: VolumeProfileBin[]
  label?: string
  color?: string
  instrument?: string
}

export interface UserMeasure {
  id: string
  type: 'MEASURE'
  p1: { time: number; price: number }
  p2: { time: number; price: number }
  instrument?: string
}

export interface UserAnchoredVwapBands {
  band1Enabled: boolean
  band1Mult: number
  band1Color?: string
  band2Enabled: boolean
  band2Mult: number
  band2Color?: string
  band3Enabled: boolean
  band3Mult: number
  band3Color?: string
  fillEnabled: boolean
}

export interface UserAnchoredVwap {
  id: string
  type: 'AVWAP'
  anchorTime: number
  anchorPrice?: number
  instrument?: string
  label?: string
  color: string
  lineWidth?: number
  bands: UserAnchoredVwapBands
}

export interface ComputedAvwapPoint {
  time: number
  typicalPrice: number
  vwap: number
  sigma: number
  upper1: number
  lower1: number
  upper2: number
  lower2: number
  upper3: number
  lower3: number
}

export interface ComputedUserAvwapResult {
  id: string
  anchorTime: number
  color: string
  lineWidth: number
  bands: UserAnchoredVwapBands
  points: ComputedAvwapPoint[]
  latest: ComputedAvwapPoint | null
}

export interface UserDrawingsState {
  trendlines: UserTrendline[]
  ranges: UserRangeBox[]
  frvps: UserManualFRVP[]
  measures?: UserMeasure[]
  avwaps?: UserAnchoredVwap[]
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

export function formatEtTime(unixSec: number): string {
  try {
    const d = new Date(unixSec * 1000)
    return (
      d.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' ET'
    )
  } catch {
    return `${unixSec}`
  }
}

/**
 * Computes a Fixed Range Volume Profile across an arbitrary user-selected candle span.
 * Uses the exact institutional volume bucket and 70% Value Area algorithm as the desk 5D profile.
 */
export function computeCustomFixedRangeVolumeProfile(
  bars: ContextBar[],
  startUnix: number,
  endUnix: number,
  id: string = `frvp-${Date.now()}`
): UserManualFRVP | null {
  if (!bars || bars.length === 0) return null

  const minT = Math.min(startUnix, endUnix)
  const maxT = Math.max(startUnix, endUnix)

  const scopedBars = bars.filter(
    (b) =>
      b.time >= minT &&
      b.time <= maxT &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      b.high >= b.low
  )

  if (scopedBars.length === 0) return null

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
      price: item.price,
      volume: item.volume,
      buyVolume: item.buyVolume,
      sellVolume: item.sellVolume,
      inValueArea: inVA,
      isPoc: i === pocIdx,
    })
  }

  return {
    id,
    type: 'FRVP',
    timeStart: minT,
    timeEnd: maxT,
    poc: pocPrice,
    vah: Number(vahPrice.toFixed(2)),
    val: Number(valPrice.toFixed(2)),
    high: Number(maxPrice.toFixed(2)),
    low: Number(minPrice.toFixed(2)),
    totalVolume: Math.round(totalVolume),
    buyVolume: Math.round(totalBuyVolume),
    sellVolume: Math.round(totalSellVolume),
    bucketSize: size,
    bins,
    label: `Manual FRVP (${formatEtTime(minT)} – ${formatEtTime(maxT)})`,
  }
}

/**
 * Computes trendline metrics: slope, direction, projected price, and distance to current price.
 */
export function computeTrendlineMetrics(
  p1: { time: number; price: number },
  p2: { time: number; price: number },
  currentPrice?: number | null,
  currentTime?: number
) {
  const tDiffSec = p2.time - p1.time
  const pDiff = p2.price - p1.price

  const slopePtsPerSec = tDiffSec !== 0 ? pDiff / tDiffSec : 0
  const slopePtsPerMin = slopePtsPerSec * 60
  const slopePtsPer5mBar = slopePtsPerSec * 300

  const direction: 'ASCENDING' | 'DESCENDING' | 'FLAT' =
    Math.abs(pDiff) < 1 ? 'FLAT' : pDiff > 0 ? 'ASCENDING' : 'DESCENDING'

  const refTime = currentTime ?? (tDiffSec > 0 ? p2.time : p1.time)
  const projectedPrice = p1.price + slopePtsPerSec * (refTime - p1.time)

  let distancePts: number | null = null
  let priceRelation: 'ABOVE' | 'BELOW' | 'TESTING' = 'TESTING'

  if (currentPrice != null && Number.isFinite(currentPrice)) {
    distancePts = Number((currentPrice - projectedPrice).toFixed(2))
    if (Math.abs(distancePts) <= 3) {
      priceRelation = 'TESTING'
    } else if (distancePts > 3) {
      priceRelation = 'ABOVE'
    } else {
      priceRelation = 'BELOW'
    }
  }

  return {
    pDiff: Number(pDiff.toFixed(2)),
    slopePtsPerMin: Number(slopePtsPerMin.toFixed(2)),
    slopePtsPer5mBar: Number(slopePtsPer5mBar.toFixed(2)),
    direction,
    projectedPrice: Number(projectedPrice.toFixed(2)),
    distancePts,
    priceRelation,
  }
}

/**
 * Computes rectangle/square range metrics: High, Low, Mid, Height, and relation to current price.
 */
export function computeRangeMetrics(
  p1: { time: number; price: number },
  p2: { time: number; price: number },
  currentPrice?: number | null,
  candles?: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>
) {
  const p1Price = p1 && Number.isFinite(p1.price) ? p1.price : 0
  const p2Price = p2 && Number.isFinite(p2.price) ? p2.price : 0
  const priceHigh = Math.max(p1Price, p2Price)
  const priceLow = Math.min(p1Price, p2Price)
  const midPrice = Number(((priceHigh + priceLow) / 2).toFixed(2))
  const heightPts = Number((priceHigh - priceLow).toFixed(2))

  const p1Time = p1 && typeof p1.time === 'number' ? p1.time : 0
  const p2Time = p2 && typeof p2.time === 'number' ? p2.time : 0
  const timeStart = Math.min(p1Time, p2Time)
  const timeEnd = Math.max(p1Time, p2Time)
  const durationMin = Math.round((timeEnd - timeStart) / 60)

  let priceRelation: 'INSIDE' | 'ABOVE' | 'BELOW' = 'INSIDE'
  let positionPct = 50

  if (currentPrice != null && Number.isFinite(currentPrice)) {
    if (currentPrice > priceHigh) {
      priceRelation = 'ABOVE'
      positionPct = 100 + ((currentPrice - priceHigh) / (heightPts || 1)) * 100
    } else if (currentPrice < priceLow) {
      priceRelation = 'BELOW'
      positionPct = -(((priceLow - currentPrice) / (heightPts || 1)) * 100)
    } else {
      priceRelation = 'INSIDE'
      positionPct = heightPts > 0 ? Math.round(((currentPrice - priceLow) / heightPts) * 100) : 50
    }
  }

  let totalVolume: number | undefined
  let volumeRatePerMin: number | undefined
  let buyVolume: number | undefined
  let sellVolume: number | undefined
  let delta: number | undefined
  let buyRatioPct: number | undefined
  let poc: number | undefined

  if (candles && candles.length > 0) {
    let tot = 0
    let buyTot = 0
    let sellTot = 0
    const bucketStep = heightPts > 0 ? Math.max(0.25, heightPts / 20) : 1
    const bucketMap = new Map<number, number>()

    const scoped = candles.filter((c) => {
      if (!Number.isFinite(c.time) || !Number.isFinite(c.high) || !Number.isFinite(c.low)) return false
      return c.time >= timeStart - 60 && c.time <= timeEnd + 60
    })

    for (const c of scoped) {
      const vol = Math.max(0, c.volume > 0 ? c.volume : 1)
      tot += vol
      if (c.close >= c.open) {
        buyTot += vol
      } else {
        sellTot += vol
      }
      const candleMid = (c.high + c.low + c.close) / 3
      const bucket = Math.round(candleMid / bucketStep) * bucketStep
      bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + vol)
    }

    if (tot > 0) {
      totalVolume = Math.round(tot)
      buyVolume = Math.round(buyTot)
      sellVolume = Math.round(sellTot)
      delta = buyVolume - sellVolume
      buyRatioPct = Math.round((buyVolume / totalVolume) * 100)
      volumeRatePerMin = Number((totalVolume / Math.max(1, durationMin)).toFixed(1))

      let maxBVol = -1
      let bestPoc = midPrice
      for (const [p, v] of bucketMap.entries()) {
        if (v > maxBVol) {
          maxBVol = v
          bestPoc = Number(p.toFixed(2))
        }
      }
      poc = bestPoc
    }
  }

  return {
    priceHigh,
    priceLow,
    midPrice,
    heightPts,
    timeStart,
    timeEnd,
    durationMin,
    priceRelation,
    positionPct: Math.round(positionPct),
    totalVolume,
    volumeRatePerMin,
    buyVolume,
    sellVolume,
    delta,
    buyRatioPct,
    poc,
  }
}

/**
 * Computes institutional Anchored VWAP and ±1σ, ±2σ, ±3σ volume-weighted standard deviation bands.
 * Anchored strictly from `avwap.anchorTime` forward to the latest available bar.
 */
export function computeUserAnchoredVwapSeries(
  bars: Array<{ time: number; high: number; low: number; close: number; volume?: number }>,
  avwap: UserAnchoredVwap
): ComputedUserAvwapResult | null {
  if (!bars || bars.length === 0) return null

  // Filter bars from anchorTime forward
  const scoped = bars.filter(
    (b) => b.time >= avwap.anchorTime && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close)
  )
  if (scoped.length === 0) return null

  let sumPV = 0
  let sumV = 0
  let sumP2V = 0

  const m1 = avwap.bands?.band1Mult ?? 1.0
  const m2 = avwap.bands?.band2Mult ?? 2.0
  const m3 = avwap.bands?.band3Mult ?? 3.0

  const points: ComputedAvwapPoint[] = []

  for (const b of scoped) {
    const p = (b.high + b.low + b.close) / 3
    const v = Math.max(1, b.volume && b.volume > 0 ? b.volume : 1)

    sumPV += p * v
    sumP2V += p * p * v
    sumV += v

    if (sumV <= 0) continue

    const currentVwap = sumPV / sumV
    const variance = Math.max(0, sumP2V / sumV - currentVwap * currentVwap)
    const sigma = Math.sqrt(variance)

    points.push({
      time: b.time,
      typicalPrice: Number(p.toFixed(2)),
      vwap: Number(currentVwap.toFixed(2)),
      sigma: Number(sigma.toFixed(2)),
      upper1: Number((currentVwap + m1 * sigma).toFixed(2)),
      lower1: Number((currentVwap - m1 * sigma).toFixed(2)),
      upper2: Number((currentVwap + m2 * sigma).toFixed(2)),
      lower2: Number((currentVwap - m2 * sigma).toFixed(2)),
      upper3: Number((currentVwap + m3 * sigma).toFixed(2)),
      lower3: Number((currentVwap - m3 * sigma).toFixed(2)),
    })
  }

  if (points.length === 0) return null

  return {
    id: avwap.id,
    anchorTime: avwap.anchorTime,
    color: avwap.color || '#06b6d4',
    lineWidth: avwap.lineWidth || 2,
    bands: avwap.bands || {
      band1Enabled: true,
      band1Mult: 1.0,
      band2Enabled: true,
      band2Mult: 2.0,
      band3Enabled: false,
      band3Mult: 3.0,
      fillEnabled: true,
    },
    points,
    latest: points[points.length - 1] ?? null,
  }
}

