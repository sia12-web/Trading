/**
 * Deterministic anti-hallucination for level prices.
 * LLMs may invent numbers — we only keep levels that sit near real structure
 * (candle OHLC, session extremes, chart AVWAP bands, or psychological rounds).
 */

import type { Candle, LevelIdentification } from '@/lib/services/levelFinderAgent/types'

export type GroundingAnchor = {
  price: number
  source: string
}

export type GroundedLevel = LevelIdentification & {
  grounded: boolean
  snap_to: number | null
  anchor_source: string | null
  reject_reason?: string
}

const DEFAULT_TOL_PCT = 0.0015 // 0.15% — zone-scale

/** Index / FX-aware psychological handles near a price. */
export function roundNumberSteps(price: number): number[] {
  if (price >= 5000) return [50, 100, 250, 500]
  if (price >= 200) return [1, 5, 10, 25, 50]
  if (price >= 20) return [0.25, 0.5, 1, 5]
  if (price >= 1) return [0.01, 0.05, 0.1, 0.25]
  return [0.0001, 0.0005, 0.001]
}

function roundNumberAnchors(currentPrice: number): GroundingAnchor[] {
  if (!(currentPrice > 0)) return []
  const out: GroundingAnchor[] = []
  const seen = new Set<number>()
  for (const step of roundNumberSteps(currentPrice)) {
    const nearest = Math.round(currentPrice / step) * step
    for (let i = -12; i <= 12; i++) {
      const p = Number((nearest + i * step).toFixed(6))
      if (p <= 0 || seen.has(p)) continue
      // Keep rounds within ~8% of spot (same band as maxDistFromPricePct)
      if (Math.abs(p - currentPrice) / currentPrice > 0.08) continue
      seen.add(p)
      out.push({ price: p, source: 'round_number' })
    }
  }
  return out
}

function collectAnchors(
  candles: Candle[],
  currentPrice: number,
  avwapBands?: number[] | null,
  vpAnchors?: number[] | null
): GroundingAnchor[] {
  const anchors: GroundingAnchor[] = [{ price: currentPrice, source: 'current_price' }]

  for (const c of candles) {
    if (c.open > 0) anchors.push({ price: c.open, source: 'open' })
    if (c.high > 0) anchors.push({ price: c.high, source: 'high' })
    if (c.low > 0) anchors.push({ price: c.low, source: 'low' })
    if (c.close > 0) anchors.push({ price: c.close, source: 'close' })
  }

  if (avwapBands) {
    for (const p of avwapBands) {
      if (Number.isFinite(p) && p > 0) anchors.push({ price: p, source: 'avwap_band' })
    }
  }

  if (vpAnchors) {
    for (const p of vpAnchors) {
      if (Number.isFinite(p) && p > 0) anchors.push({ price: p, source: 'volume_profile' })
    }
  }

  anchors.push(...roundNumberAnchors(currentPrice))

  return anchors
}

function nearestAnchor(
  level: number,
  anchors: GroundingAnchor[],
  tolPct: number
): { anchor: GroundingAnchor; distPct: number } | null {
  let best: { anchor: GroundingAnchor; distPct: number } | null = null
  for (const a of anchors) {
    if (a.price <= 0) continue
    const distPct = Math.abs(level - a.price) / a.price
    if (distPct <= tolPct && (!best || distPct < best.distPct)) {
      best = { anchor: a, distPct }
    }
  }
  return best
}

/**
 * Keep only levels near real market structure. Optionally snap to the nearest anchor.
 */
export function groundLevels(
  levels: LevelIdentification[],
  opts: {
    candles: Candle[]
    currentPrice: number
    avwapBands?: number[] | null
    /** POC / HVN prices from computeVolumeProfile */
    vpAnchors?: number[] | null
    /** Max distance from an anchor as fraction of price (default 0.15%) */
    tolPct?: number
    /** Also reject levels more than this % away from current price (default 8%) */
    maxDistFromPricePct?: number
    snap?: boolean
  }
): GroundedLevel[] {
  const tolPct = opts.tolPct ?? DEFAULT_TOL_PCT
  const maxDist = opts.maxDistFromPricePct ?? 0.08
  const anchors = collectAnchors(
    opts.candles,
    opts.currentPrice,
    opts.avwapBands,
    opts.vpAnchors
  )

  return levels.map((lvl) => {
    if (!Number.isFinite(lvl.level) || lvl.level <= 0) {
      return {
        ...lvl,
        grounded: false,
        snap_to: null,
        anchor_source: null,
        reject_reason: 'invalid_price',
      }
    }

    const fromPrice = Math.abs(lvl.level - opts.currentPrice) / opts.currentPrice
    if (fromPrice > maxDist) {
      return {
        ...lvl,
        grounded: false,
        snap_to: null,
        anchor_source: null,
        reject_reason: `too_far_from_price_${(fromPrice * 100).toFixed(2)}pct`,
      }
    }

    // For stop-pool levels we allow a slightly wider band past extremes
    const hit = nearestAnchor(lvl.level, anchors, tolPct * 2.5)
    if (!hit) {
      return {
        ...lvl,
        grounded: false,
        snap_to: null,
        anchor_source: null,
        reject_reason: 'no_candle_avwap_vp_or_round_anchor',
      }
    }

    const snapTo = opts.snap === false ? lvl.level : hit.anchor.price
    return {
      ...lvl,
      level: opts.snap === false ? lvl.level : Number(snapTo.toFixed(2)),
      grounded: true,
      snap_to: Number(hit.anchor.price.toFixed(2)),
      anchor_source: hit.anchor.source,
    }
  })
}

export function onlyGrounded(levels: GroundedLevel[]): LevelIdentification[] {
  return levels
    .filter((l) => l.grounded)
    .map(({ grounded: _g, snap_to: _s, anchor_source: _a, reject_reason: _r, ...rest }) => rest)
}
