/**
 * Deterministic anti-hallucination for level prices.
 * LLMs may invent numbers — we only keep levels that sit near real structure
 * (candle OHLC, session extremes, or chart AVWAP bands).
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
        reject_reason: 'no_candle_avwap_or_vp_anchor',
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
