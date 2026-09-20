/**
 * Auction engine — same theory as TradePulse volume profile / FRVP / AVWAP.
 *
 * Volume-by-price: distribute each bar's volume across buckets from low→high.
 * POC: highest-volume bucket (point of control / fair value).
 * HVN: local volume peak ≥ 1.25× average, not adjacent to POC.
 * LVN: local volume trough ≤ 0.6× average (vacuum / single-print).
 * Value area: 70% of volume grown from POC.
 * Anchored VWAP: Σ(P·V) / ΣV from the 5-month cash-open anchor, with σ bands.
 */

import type { AnchoredVwap, OhlcvBar, VolumeNode, VolumeProfile } from './types'

export function typicalPrice(bar: OhlcvBar): number {
  return (bar.high + bar.low + bar.close) / 3
}

export function bucketWidth(mid: number): number {
  if (!(mid > 0)) return 1
  const raw = mid * 0.00015
  if (raw >= 10) return Math.round(raw / 5) * 5
  if (raw >= 1) return Math.max(1, Math.round(raw))
  return Math.max(0.25, Math.round(raw * 4) / 4)
}

function bucketKey(price: number, size: number): number {
  return Math.round(price / size) * size
}

export function computeVolumeProfile(bars: OhlcvBar[]): VolumeProfile | null {
  const usable = bars.filter(
    (b) => b.high >= b.low && b.high > 0 && (b.volume ?? 0) > 0,
  )
  if (usable.length < 8) return null

  let hi = -Infinity
  let lo = Infinity
  let totalVolume = 0
  for (const b of usable) {
    hi = Math.max(hi, b.high)
    lo = Math.min(lo, b.low)
    totalVolume += b.volume
  }
  if (!(hi > lo) || totalVolume <= 0) return null

  const size = bucketWidth((hi + lo) / 2)
  const volumes = new Map<number, number>()

  for (const b of usable) {
    const vol = b.volume
    if (b.high - b.low < size * 0.5) {
      const k = bucketKey(typicalPrice(b), size)
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
    for (const k of uniq) volumes.set(k, (volumes.get(k) ?? 0) + share)
  }

  const sorted = Array.from(volumes.entries())
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price)
  if (sorted.length < 5) return null

  let pocIdx = 0
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.volume > sorted[pocIdx]!.volume) pocIdx = i
  }

  const avgVol = totalVolume / sorted.length
  let hvnIdx = -1
  let lvnIdx = -1
  let hvnVol = -Infinity
  let lvnVol = Infinity

  for (let i = 1; i < sorted.length - 1; i++) {
    const prev = sorted[i - 1]!.volume
    const cur = sorted[i]!.volume
    const next = sorted[i + 1]!.volume
    const farFromPoc = Math.abs(sorted[i]!.price - sorted[pocIdx]!.price) >= size * 2.5
    if (cur > prev && cur > next && cur >= avgVol * 1.25 && farFromPoc && cur > hvnVol) {
      hvnVol = cur
      hvnIdx = i
    }
    if (cur < prev && cur < next && cur <= avgVol * 0.6 && farFromPoc && cur < lvnVol) {
      lvnVol = cur
      lvnIdx = i
    }
  }

  if (hvnIdx < 0) {
    for (let i = 0; i < sorted.length; i++) {
      if (i === pocIdx) continue
      if (sorted[i]!.volume > hvnVol) {
        hvnVol = sorted[i]!.volume
        hvnIdx = i
      }
    }
  }
  if (lvnIdx < 0) {
    for (let i = 0; i < sorted.length; i++) {
      if (i === pocIdx || i === hvnIdx) continue
      if (sorted[i]!.volume < lvnVol) {
        lvnVol = sorted[i]!.volume
        lvnIdx = i
      }
    }
  }

  const vaTarget = totalVolume * 0.7
  let vaVol = sorted[pocIdx]!.volume
  let loI = pocIdx
  let hiI = pocIdx
  while (vaVol < vaTarget && (loI > 0 || hiI < sorted.length - 1)) {
    const down = loI > 0 ? sorted[loI - 1]!.volume : -1
    const up = hiI < sorted.length - 1 ? sorted[hiI + 1]!.volume : -1
    if (up >= down) {
      hiI++
      vaVol += sorted[hiI]!.volume
    } else {
      loI--
      vaVol += sorted[loI]!.volume
    }
  }

  const node = (idx: number, kind: VolumeNode['kind']): VolumeNode => ({
    price: Number(sorted[idx]!.price.toFixed(2)),
    volume: sorted[idx]!.volume,
    kind,
  })

  return {
    poc: node(pocIdx, 'poc'),
    hvn: node(Math.max(0, hvnIdx), 'hvn'),
    lvn: node(Math.max(0, lvnIdx), 'lvn'),
    vah: Number(sorted[hiI]!.price.toFixed(2)),
    val: Number(sorted[loI]!.price.toFixed(2)),
    high: Number(hi.toFixed(2)),
    low: Number(lo.toFixed(2)),
    totalVolume,
    bucketSize: size,
    bins: sorted.map((b) => ({ price: Number(b.price.toFixed(2)), volume: b.volume })),
  }
}

export function computeAnchoredVwap(bars: OhlcvBar[]): AnchoredVwap | null {
  let sumPV = 0
  let sumP2V = 0
  let sumV = 0
  let n = 0
  for (const b of bars) {
    if (!(b.volume > 0)) continue
    const p = typicalPrice(b)
    sumPV += p * b.volume
    sumP2V += p * p * b.volume
    sumV += b.volume
    n++
  }
  if (sumV <= 0 || n < 4) return null
  const vwap = sumPV / sumV
  const variance = Math.max(0, sumP2V / sumV - vwap * vwap)
  const sigma = Math.sqrt(variance)
  return {
    vwap,
    sigma,
    upper1: vwap + sigma,
    lower1: vwap - sigma,
    upper2: vwap + 2 * sigma,
    lower2: vwap - 2 * sigma,
    sumPV,
    sumP2V,
    sumV,
    barCount: n,
  }
}

/** Incremental AVWAP tick — the five-month store updates constantly. */
export function pushVwapTick(state: AnchoredVwap, price: number, volume: number): AnchoredVwap {
  const v = Math.max(0.0001, volume)
  const sumPV = state.sumPV + price * v
  const sumP2V = state.sumP2V + price * price * v
  const sumV = state.sumV + v
  const vwap = sumPV / sumV
  const sigma = Math.sqrt(Math.max(0, sumP2V / sumV - vwap * vwap))
  return {
    vwap,
    sigma,
    upper1: vwap + sigma,
    lower1: vwap - sigma,
    upper2: vwap + 2 * sigma,
    lower2: vwap - 2 * sigma,
    sumPV,
    sumP2V,
    sumV,
    barCount: state.barCount + 1,
  }
}

/**
 * Volume divergence: does size confirm Price showing up at this node?
 * Positive = participation matches the store's nature.
 * Negative = advertising without the tape (HVN empty) or vacuum flooding (LVN crowded).
 */
export function volumeDivergence(args: {
  kind: VolumeNode['kind'] | 'avwap'
  liveVolume: number
  typicalVolume: number
}): number {
  const ratio = args.liveVolume / Math.max(1, args.typicalVolume)
  if (args.kind === 'hvn' || args.kind === 'poc') {
    return clamp((ratio - 1) / 0.8, -1, 1)
  }
  if (args.kind === 'lvn') {
    return clamp((1 - ratio) / 0.8, -1, 1)
  }
  return clamp((ratio - 1) / 0.6, -1, 1)
}

/**
 * Time opportunity: value is made with time.
 * High = still time to act. Low = this price has already lived here long enough to be fair today.
 */
export function timeOpportunity(args: {
  kind: VolumeNode['kind'] | 'avwap'
  tpoAtPrice: number
  sessionProgress: number
}): { opportunity: number; fairToday: boolean; label: string } {
  const dwell = args.tpoAtPrice
  if (args.kind === 'poc') {
    const fair = dwell >= 4 || args.sessionProgress > 0.55
    const opportunity = clamp(1 - dwell / 8 - args.sessionProgress * 0.25, 0, 1)
    return {
      opportunity,
      fairToday: fair,
      label: fair ? 'Already fair today' : 'Building value — still time',
    }
  }
  if (args.kind === 'hvn') {
    const fair = dwell >= 3
    const opportunity = clamp(1 - dwell / 7, 0, 1)
    return {
      opportunity,
      fairToday: fair,
      label: fair ? 'Accepted — rotation risk' : 'Acceptance not proven yet',
    }
  }
  if (args.kind === 'lvn') {
    const fair = dwell >= 2
    const opportunity = clamp(1 - dwell / 3 - args.sessionProgress * 0.2, 0, 1)
    return {
      opportunity,
      fairToday: fair,
      label: fair ? 'Vacuum filling — window closing' : 'Fast market — act or leave',
    }
  }
  const fair = args.sessionProgress > 0.7 && dwell >= 5
  const opportunity = clamp(0.85 - args.sessionProgress * 0.4, 0.15, 1)
  return {
    opportunity,
    fairToday: fair,
    label: fair ? 'Macro value already printed' : 'Long-term money still in motion',
  }
}

/**
 * Floor occupancy from divergence + time. HVN/POC fill when size confirms and
 * go hollow when advertising empty. LVN stays air unless the tape floods it.
 */
export function stallOccupancy(args: {
  kind: VolumeNode['kind'] | 'avwap'
  divergence: number
  timeOpportunity: number
  shutter: number
  floorAlive: number
  phase: 'preopen' | 'opening' | 'live'
}): {
  occupancy: number
  hollow: boolean
  clogged: boolean
  interior: number
  door: number
} {
  const shut = args.shutter
  let occupancy = 0
  if (args.floorAlive > 0.04) {
    if (args.kind === 'lvn') {
      occupancy = (args.divergence < 0 ? -args.divergence : 0.05) * shut * (0.4 + args.timeOpportunity * 0.6)
    } else {
      occupancy = clamp(0.36 + args.divergence * 0.55, 0, 1) * shut * (0.32 + args.timeOpportunity * 0.68)
    }
  }
  occupancy = clamp(occupancy, 0, 1)
  const door =
    args.phase === 'preopen' ? 0 : args.phase === 'opening' ? shut : clamp(0.18 + args.timeOpportunity * 0.82, 0, 1)
  return {
    occupancy,
    hollow: args.kind !== 'lvn' && occupancy < 0.28,
    clogged: args.kind === 'lvn' && occupancy > 0.38,
    interior: occupancy * args.timeOpportunity * shut,
    door,
  }
}

/** Map a print onto a vertical range (session high–low or AVWAP ±2σ). */
export function rangeHeight(px: number, lo: number, hi: number, minH = 0.28, maxH = 4.05): number {
  const t = (px - lo) / (hi - lo || 1)
  return minH + clamp(t, 0, 1) * (maxH - minH)
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

export function fmtPx(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function fmtPx1(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
