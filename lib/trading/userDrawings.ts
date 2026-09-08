import type { ContextBar, VolumeProfileBin } from '@/lib/chart/context55'

export interface UserTrendline {
  id: string
  type: 'TRENDLINE'
  p1: { time: number; price: number }
  p2: { time: number; price: number }
  color?: string
  label?: string
}

export interface UserRangeBox {
  id: string
  type: 'RANGE'
  p1: { time: number; price: number }
  p2: { time: number; price: number }
  color?: string
  label?: string
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
}

export interface UserDrawingsState {
  trendlines: UserTrendline[]
  ranges: UserRangeBox[]
  frvps: UserManualFRVP[]
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
  currentPrice?: number | null
) {
  const priceHigh = Math.max(p1.price, p2.price)
  const priceLow = Math.min(p1.price, p2.price)
  const midPrice = Number(((priceHigh + priceLow) / 2).toFixed(2))
  const heightPts = Number((priceHigh - priceLow).toFixed(2))

  const timeStart = Math.min(p1.time, p2.time)
  const timeEnd = Math.max(p1.time, p2.time)
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
  }
}
