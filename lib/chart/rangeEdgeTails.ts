/**
 * Range-edge tails — rejection wicks at the ±10 band after the playbook range locks.
 *
 * Prefer/assist only (not a hard entry gate):
 *   - light  ≥ 0.25 × body
 *   - good   ≥ 0.40 × body  (desk default highlight)
 *   - strong ≥ 0.50 × body
 *
 * Same thresholds for DOW / NASDAQ / NIKKEI on the 5m desk chart.
 */

import {
  RANGE_EDGE_BAND_POINTS,
  nearestRangeEdge,
  rangeEdgeBands,
  type RangeEdgeLevels,
} from '@/lib/trading/rangeEdgeEntryGate'

export const TAIL_RATIO_LIGHT = 0.25
export const TAIL_RATIO_GOOD = 0.4
export const TAIL_RATIO_STRONG = 0.5

/** Floor body so dojis do not explode wick/body ratios. */
export const TAIL_BODY_FLOOR_POINTS = 1

export type RangeEdgeTailBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type RangeEdgeTailTier = 'light' | 'good' | 'strong'

export type RangeEdgeTail = {
  time: number
  edge: 'high' | 'low'
  tier: RangeEdgeTailTier
  ratio: number
  wickPts: number
  bodyPts: number
  /** Tip of the wick (high for high-edge, low for low-edge). */
  price: number
  text: string
  color: string
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown'
  label: string
}

export type ShapedRangeForTails = RangeEdgeLevels & {
  /** Must be true — forming ranges emit no tails. */
  complete: boolean
  /** Unix when the range locked (signals only after this). */
  lockedUnix?: number
}

export const RANGE_EDGE_TAIL_COLORS = {
  light: '#94a3b8',
  good: '#eab308',
  strong: '#f59e0b',
} as const

function tierForRatio(ratio: number): RangeEdgeTailTier | null {
  if (ratio >= TAIL_RATIO_STRONG) return 'strong'
  if (ratio >= TAIL_RATIO_GOOD) return 'good'
  if (ratio >= TAIL_RATIO_LIGHT) return 'light'
  return null
}

export function candleWickMetrics(bar: RangeEdgeTailBar): {
  bodyPts: number
  upperWickPts: number
  lowerWickPts: number
  upperRatio: number
  lowerRatio: number
} {
  const bodyRaw = Math.abs(bar.close - bar.open)
  const bodyPts = Math.max(bodyRaw, TAIL_BODY_FLOOR_POINTS)
  const upperWickPts = Math.max(0, bar.high - Math.max(bar.open, bar.close))
  const lowerWickPts = Math.max(0, Math.min(bar.open, bar.close) - bar.low)
  return {
    bodyPts,
    upperWickPts,
    lowerWickPts,
    upperRatio: upperWickPts / bodyPts,
    lowerRatio: lowerWickPts / bodyPts,
  }
}

function barTouchesBand(
  bar: RangeEdgeTailBar,
  min: number,
  max: number
): boolean {
  return bar.high >= min && bar.low <= max
}

function prefixLabel(label?: string | null): string {
  const t = String(label || '').trim()
  if (!t) return 'RANGE'
  if (/or15|open\s*range/i.test(t)) return 'O15'
  if (/or30/i.test(t)) return 'OR30'
  if (/lunch/i.test(t)) return 'LN'
  if (/us\s*range/i.test(t)) return 'US'
  if (/tokyo\s*ib/i.test(t)) return 'IB'
  if (/^ib$/i.test(t) || /\bib\b/i.test(t)) return 'IB'
  return t.slice(0, 6).toUpperCase()
}

/**
 * Walk 5m bars and emit tails at the ±10 high/low bands after the range locks.
 */
export function computeRangeEdgeTails(
  candles: RangeEdgeTailBar[],
  range: ShapedRangeForTails | null | undefined,
  opts?: {
    bandPoints?: number
    /** Only emit good/strong (skip light) — default false. */
    minTier?: RangeEdgeTailTier
    /** Cap markers per edge (anti-spam). Default 3. */
    maxPerEdge?: number
  }
): RangeEdgeTail[] {
  if (!range || range.complete !== true) return []
  if (!(range.high > range.low) || candles.length === 0) return []

  const bandPoints = opts?.bandPoints ?? RANGE_EDGE_BAND_POINTS
  const bands = rangeEdgeBands(range, bandPoints)
  if (bands.length === 0) return []

  const highBand = bands.find((b) => b.edge === 'high')
  const lowBand = bands.find((b) => b.edge === 'low')
  const lockedUnix = range.lockedUnix ?? 0
  const maxPerEdge = Math.max(1, opts?.maxPerEdge ?? 3)
  const minTier = opts?.minTier ?? 'light'
  const minRank = minTier === 'strong' ? 3 : minTier === 'good' ? 2 : 1
  const tierRank = (t: RangeEdgeTailTier) =>
    t === 'strong' ? 3 : t === 'good' ? 2 : 1

  const label = prefixLabel(range.label)
  const out: RangeEdgeTail[] = []
  let highCount = 0
  let lowCount = 0

  for (const c of candles) {
    if (c.time < lockedUnix) continue
    if (
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close)
    ) {
      continue
    }

    const m = candleWickMetrics(c)

    if (highBand && highCount < maxPerEdge && barTouchesBand(c, highBand.min, highBand.max)) {
      const tier = tierForRatio(m.upperRatio)
      if (tier && tierRank(tier) >= minRank) {
        highCount += 1
        out.push({
          time: c.time,
          edge: 'high',
          tier,
          ratio: Math.round(m.upperRatio * 100) / 100,
          wickPts: Math.round(m.upperWickPts * 100) / 100,
          bodyPts: Math.round(m.bodyPts * 100) / 100,
          price: c.high,
          text: `${label} TAIL H · ${tier === 'strong' ? '0.5' : tier === 'good' ? '0.4' : '0.25'}`,
          color: RANGE_EDGE_TAIL_COLORS[tier],
          position: 'aboveBar',
          shape: 'arrowDown',
          label: range.label || label,
        })
      }
    }

    if (lowBand && lowCount < maxPerEdge && barTouchesBand(c, lowBand.min, lowBand.max)) {
      const tier = tierForRatio(m.lowerRatio)
      if (tier && tierRank(tier) >= minRank) {
        lowCount += 1
        out.push({
          time: c.time,
          edge: 'low',
          tier,
          ratio: Math.round(m.lowerRatio * 100) / 100,
          wickPts: Math.round(m.lowerWickPts * 100) / 100,
          bodyPts: Math.round(m.bodyPts * 100) / 100,
          price: c.low,
          text: `${label} TAIL L · ${tier === 'strong' ? '0.5' : tier === 'good' ? '0.4' : '0.25'}`,
          color: RANGE_EDGE_TAIL_COLORS[tier],
          position: 'belowBar',
          shape: 'arrowUp',
          label: range.label || label,
        })
      }
    }
  }

  return out.sort((a, b) => a.time - b.time)
}

/** Latest good/strong tail (for Leo / status strip). */
export function latestQualityTail(
  tails: RangeEdgeTail[],
  minTier: RangeEdgeTailTier = 'good'
): RangeEdgeTail | null {
  const minRank = minTier === 'strong' ? 3 : minTier === 'good' ? 2 : 1
  const rank = (t: RangeEdgeTailTier) =>
    t === 'strong' ? 3 : t === 'good' ? 2 : 1
  for (let i = tails.length - 1; i >= 0; i--) {
    const t = tails[i]!
    if (rank(t.tier) >= minRank) return t
  }
  return null
}

/**
 * Boost in-band levels whose price sits on an edge with a recent good/strong tail.
 * Does not invent off-band levels — only reorders / bumps conviction.
 */
export function preferLevelsWithRangeEdgeTail<
  T extends { price: number; conviction?: number | null }
>(
  levels: T[],
  range: RangeEdgeLevels | null | undefined,
  tails: RangeEdgeTail[],
  opts?: { boost?: number; maxAgeBars?: number; nowUnix?: number; barSeconds?: number }
): T[] {
  if (!range || levels.length === 0) return levels
  const quality = tails.filter((t) => t.tier === 'good' || t.tier === 'strong')
  if (quality.length === 0) return levels

  const nowUnix = opts?.nowUnix ?? Math.floor(Date.now() / 1000)
  const barSec = opts?.barSeconds ?? 300
  const maxAge = (opts?.maxAgeBars ?? 12) * barSec
  const recent = quality.filter((t) => nowUnix - t.time <= maxAge)
  if (recent.length === 0) return levels

  const edges = new Set(recent.map((t) => t.edge))
  const boost = opts?.boost ?? 2
  /** Prefer levels near the printed edge (strictly inside half of ±10). */
  const edgeProximity = RANGE_EDGE_BAND_POINTS / 2

  return [...levels]
    .map((l) => {
      const px = Number(l.price)
      const nearest = nearestRangeEdge(px, range)
      if (!nearest || nearest === 'mid' || !edges.has(nearest)) return l
      const center = nearest === 'high' ? range.high : range.low
      if (!(Math.abs(px - center) < edgeProximity)) return l
      const conv = Number(l.conviction)
      return {
        ...l,
        conviction: Number.isFinite(conv)
          ? Math.min(10, conv + boost)
          : (l.conviction ?? null),
      }
    })
    .sort((a, b) => (Number(b.conviction) || 0) - (Number(a.conviction) || 0))
}
