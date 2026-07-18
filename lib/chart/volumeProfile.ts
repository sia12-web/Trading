/**
 * Deterministic volume-by-price (MVP).
 * Builds a simple profile from OHLC+V bars: POC + up to 2 HVN.
 * Used as factual anchors for Level Finder (same role as AVWAP bands).
 *
 * Note: cash-index Yahoo volume can be thin/noisy (esp. Nikkei). Prefer
 * futures-quality bars (OANDA) when available upstream.
 */

export type VolumeBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type VolumeProfileNode = {
  price: number
  volume: number
  kind: 'poc' | 'hvn'
}

export type VolumeProfileResult = {
  poc: VolumeProfileNode
  hvn: VolumeProfileNode[]
  /** All nodes for grounding: POC + HVNs */
  anchors: number[]
  bucketSize: number
  totalVolume: number
  barCount: number
}

function bucketWidth(mid: number): number {
  if (!Number.isFinite(mid) || mid <= 0) return 1
  // ~0.015% of price, min 1 — DOW ~6–7 pts, NASDAQ ~3 pts, NIKKEI ~5–6
  const raw = mid * 0.00015
  if (raw >= 10) return Math.round(raw / 5) * 5
  if (raw >= 1) return Math.max(1, Math.round(raw))
  return Math.max(0.25, Math.round(raw * 4) / 4)
}

function bucketKey(price: number, size: number): number {
  return Math.round(price / size) * size
}

/**
 * Distribute each bar's volume evenly across price buckets from low→high.
 * Falls back to typical price when high≈low.
 */
export function computeVolumeProfile(
  bars: VolumeBar[],
  opts: { maxHvn?: number } = {}
): VolumeProfileResult | null {
  const maxHvn = opts.maxHvn ?? 2
  const usable = bars.filter(
    (b) =>
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      b.high > 0 &&
      b.low > 0 &&
      b.high >= b.low &&
      (b.volume ?? 0) > 0
  )
  if (usable.length < 8) return null

  let hi = -Infinity
  let lo = Infinity
  let totalVolume = 0
  for (const b of usable) {
    hi = Math.max(hi, b.high)
    lo = Math.min(lo, b.low)
    totalVolume += Math.max(0, b.volume)
  }
  if (!(hi > lo) || totalVolume <= 0) return null

  const mid = (hi + lo) / 2
  const size = bucketWidth(mid)
  const volumes = new Map<number, number>()

  for (const b of usable) {
    const vol = Math.max(0, b.volume)
    if (vol <= 0) continue
    if (b.high - b.low < size * 0.5) {
      const k = bucketKey((b.high + b.low + b.close) / 3, size)
      volumes.set(k, (volumes.get(k) ?? 0) + vol)
      continue
    }
    const start = bucketKey(b.low, size)
    const end = bucketKey(b.high, size)
    const keys: number[] = []
    for (let p = start; p <= end + size * 0.25; p += size) {
      keys.push(bucketKey(p, size))
    }
    const uniq = Array.from(new Set(keys))
    const share = vol / uniq.length
    for (const k of uniq) {
      volumes.set(k, (volumes.get(k) ?? 0) + share)
    }
  }

  if (volumes.size === 0) return null

  const sorted = Array.from(volumes.entries())
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price)

  let pocIdx = 0
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.volume > sorted[pocIdx]!.volume) pocIdx = i
  }
  const pocRow = sorted[pocIdx]!
  const poc: VolumeProfileNode = {
    price: Number(pocRow.price.toFixed(2)),
    volume: pocRow.volume,
    kind: 'poc',
  }

  // HVN = local volume peaks excluding POC (and not adjacent buckets to POC)
  const peaks: Array<{ price: number; volume: number; idx: number }> = []
  for (let i = 0; i < sorted.length; i++) {
    if (i === pocIdx) continue
    const v = sorted[i]!.volume
    const left = i > 0 ? sorted[i - 1]!.volume : 0
    const right = i < sorted.length - 1 ? sorted[i + 1]!.volume : 0
    if (v >= left && v >= right && v > 0) {
      // Skip if too close to POC (within 2 buckets)
      if (Math.abs(sorted[i]!.price - poc.price) < size * 2.5) continue
      peaks.push({ price: sorted[i]!.price, volume: v, idx: i })
    }
  }
  peaks.sort((a, b) => b.volume - a.volume)

  const hvn: VolumeProfileNode[] = peaks.slice(0, maxHvn).map((p) => ({
    price: Number(p.price.toFixed(2)),
    volume: p.volume,
    kind: 'hvn' as const,
  }))

  return {
    poc,
    hvn,
    anchors: [poc.price, ...hvn.map((h) => h.price)],
    bucketSize: size,
    totalVolume,
    barCount: usable.length,
  }
}
