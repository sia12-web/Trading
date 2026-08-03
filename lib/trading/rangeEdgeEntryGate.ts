/**
 * Range Edge Entry Gate — entries within ±N index points of the active
 * playbook range high, low, or (where allowed) 50% midpoint.
 *
 * US Range (Nikkei prior NYC) is high/low only — no mid entry band.
 */

export const RANGE_EDGE_BAND_POINTS = 10

/** Chart / fillError copy when a limit lands outside painted ±10 H/Mid/L bands. */
export const RANGE_EDGE_OFF_BAND_MESSAGE =
  'Entry only at highlighted ±10 H/Mid/L.'

/** US Range mid (±10 of 50%) is never a legal entry. */
export const RANGE_EDGE_US_MID_REJECTED_MESSAGE =
  'US Range entries are ±10 of high or low only — 50% mid is not a legal entry.'

export type RangeEdgeLevels = {
  high: number
  low: number
  label?: string | null
}

export type RangeEdgeKind = 'high' | 'low' | 'mid'

export type RangeEdgeBand = {
  edge: RangeEdgeKind
  center: number
  min: number
  max: number
}

/**
 * Whether this range paints / accepts a 50% mid entry band.
 * US Range (Nikkei prior NYC) is H/L only; OR30 / IB / lunch keep mid.
 */
export function rangeAllowsMidEdge(
  range: RangeEdgeLevels | null | undefined
): boolean {
  if (!range?.label) return true
  return !/^us\s*range$/i.test(String(range.label).trim())
}

/** Short band legend for UI: "H / 50% / L" or "H / L" for US Range. */
export function rangeEdgeBandLegend(
  range: RangeEdgeLevels | null | undefined
): string {
  return rangeAllowsMidEdge(range) ? 'H / 50% / L' : 'H / L'
}

/** Exact 50% of a shaped range (H+L)/2. */
export function rangeMidpoint(range: RangeEdgeLevels): number | null {
  const high = Number(range.high)
  const low = Number(range.low)
  if (!Number.isFinite(high) || !Number.isFinite(low) || !(high > low)) return null
  return (high + low) / 2
}

export function rangeEdgeBands(
  range: RangeEdgeLevels,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): RangeEdgeBand[] {
  const high = Number(range.high)
  const low = Number(range.low)
  if (!Number.isFinite(high) || !Number.isFinite(low) || !(high > low)) return []
  const b = Math.max(0, bandPoints)
  const bands: RangeEdgeBand[] = [
    { edge: 'high', center: high, min: high - b, max: high + b },
  ]
  if (rangeAllowsMidEdge(range)) {
    const mid = (high + low) / 2
    bands.push({ edge: 'mid', center: mid, min: mid - b, max: mid + b })
  }
  bands.push({ edge: 'low', center: low, min: low - b, max: low + b })
  return bands
}

export function isEntryWithinRangeEdgeBand(
  entry: number,
  range: RangeEdgeLevels,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): boolean {
  if (!Number.isFinite(entry) || entry <= 0) return false
  return rangeEdgeBands(range, bandPoints).some((band) => entry >= band.min && entry <= band.max)
}

/**
 * Keep (or move) a price into the nearest legal ±band of range H / 50% / L
 * (US Range: H / L only). Already in-band → unchanged. Outside → clamped onto
 * the closest band edge. Returns null when range is missing/invalid.
 */
export function clampPriceToRangeEdgeBands(
  price: number,
  range: RangeEdgeLevels | null | undefined,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): number | null {
  if (!range || !Number.isFinite(price) || !(price > 0)) return null
  const bands = rangeEdgeBands(range, bandPoints)
  if (bands.length === 0) return null
  for (const band of bands) {
    if (price >= band.min && price <= band.max) return price
  }
  let best = bands[0]!.center
  let bestDist = Infinity
  for (const band of bands) {
    const clamped = Math.min(band.max, Math.max(band.min, price))
    const d = Math.abs(price - clamped)
    if (d < bestDist) {
      bestDist = d
      best = clamped
    }
  }
  return best
}

/**
 * Drag / place magnets across multiple painted ±10 zones (e.g. US Range + Tokyo IB).
 * Picks the nearest single-range clamp. Already in any band → unchanged.
 * Entry legality still uses {@link assertRangeEdgeEntry} on the active playbook range.
 *
 * Do **not** call this on every pointermove while dragging — continuous nearest-band
 * clamp traps the pointer on one edge. Prefer {@link clampPriceToRangeEdgeEnvelope}
 * during drag and this helper on pointerup / place.
 */
export function clampPriceToNearestRangeEdgeBands(
  price: number,
  ranges: Array<RangeEdgeLevels | null | undefined>,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): number | null {
  if (!Number.isFinite(price) || !(price > 0)) return null
  let best: number | null = null
  let bestDist = Infinity
  for (const range of ranges) {
    const clamped = clampPriceToRangeEdgeBands(price, range, bandPoints)
    if (clamped == null) continue
    const d = Math.abs(price - clamped)
    if (d < bestDist) {
      bestDist = d
      best = clamped
    }
  }
  return best
}

/**
 * Outer price span covering every ±band across the given ranges
 * (lowest band.min → highest band.max). Used while dragging so the entry
 * can move freely between high and low edges without teleporting.
 */
export function rangeEdgeBandsEnvelope(
  ranges: Array<RangeEdgeLevels | null | undefined>,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const range of ranges) {
    if (!range) continue
    for (const band of rangeEdgeBands(range, bandPoints)) {
      if (band.min < min) min = band.min
      if (band.max > max) max = band.max
    }
  }
  if (!(Number.isFinite(min) && Number.isFinite(max) && max > min)) return null
  return { min, max }
}

/** Soft-clamp into the outer envelope of all ±10 bands (free mid-range drag). */
export function clampPriceToRangeEdgeEnvelope(
  price: number,
  ranges: Array<RangeEdgeLevels | null | undefined>,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): number | null {
  if (!Number.isFinite(price) || !(price > 0)) return null
  const envelope = rangeEdgeBandsEnvelope(ranges, bandPoints)
  if (!envelope) return null
  return Math.min(envelope.max, Math.max(envelope.min, price))
}

export function nearestRangeEdge(
  entry: number,
  range: RangeEdgeLevels
): RangeEdgeKind | null {
  if (!Number.isFinite(entry) || !(range.high > range.low)) return null
  const candidates: Array<{ edge: RangeEdgeKind; d: number }> = [
    { edge: 'high', d: Math.abs(entry - range.high) },
    { edge: 'low', d: Math.abs(entry - range.low) },
  ]
  if (rangeAllowsMidEdge(range)) {
    const mid = (range.high + range.low) / 2
    candidates.push({ edge: 'mid', d: Math.abs(entry - mid) })
  }
  candidates.sort((a, b) => a.d - b.d)
  return candidates[0]!.edge
}

export type RangeEdgeBandHit<T extends RangeEdgeLevels = RangeEdgeLevels> = {
  range: T
  edge: RangeEdgeKind
  /** Band center (H, 50% mid, or L) — place limit here on click-to-enter. */
  center: number
  min: number
  max: number
}

/**
 * Painted ±band containing `price` closest to its center.
 * Used for click-to-enter on chart entry highlights.
 *
 * Generic over the caller's own range shape (e.g. StrategyRangeEdges, which
 * requires a non-optional `label`) so the hit's `.range` keeps that exact
 * type instead of being widened to the base `RangeEdgeLevels`.
 */
export function findRangeEdgeBandHit<T extends RangeEdgeLevels>(
  price: number,
  ranges: Array<T | null | undefined>,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): RangeEdgeBandHit<T> | null {
  if (!Number.isFinite(price) || !(price > 0)) return null
  let best: RangeEdgeBandHit<T> | null = null
  let bestDist = Infinity
  for (const range of ranges) {
    if (!range) continue
    for (const band of rangeEdgeBands(range, bandPoints)) {
      if (price < band.min || price > band.max) continue
      const d = Math.abs(price - band.center)
      if (d < bestDist) {
        bestDist = d
        best = {
          range,
          edge: band.edge,
          center: band.center,
          min: band.min,
          max: band.max,
        }
      }
    }
  }
  return best
}

/**
 * Attribute an entry price to a playbook range when several painted ±10 bands
 * overlap (common on Nikkei: US Range H/L vs Tokyo IB H / 50% / L).
 *
 * Live billing prefers ranges that pass `liveOk` (bucket window open + probes
 * left) so the US Range playbook banner cannot reject as Tokyo IB. Among live
 * candidates, an explicit preferLabel (ticket / active) wins when in-band;
 * otherwise nearest center. If no live candidate contains the price, fall back
 * to all candidates so the caller can surface the unlock / exhaustion message.
 */
export function attributePlaybookBandEntry<T extends RangeEdgeLevels>(args: {
  entry: number
  candidates: Array<T | null | undefined>
  preferLabel?: string | null
  liveOk?: (range: T) => boolean
  bandPoints?: number
}): RangeEdgeBandHit<T> | null {
  const all = args.candidates.filter((r): r is T => !!r)
  if (all.length === 0) return null
  const live = args.liveOk ? all.filter((r) => args.liveOk!(r)) : all

  const pickPreferred = (pool: T[]): RangeEdgeBandHit<T> | null => {
    if (!args.preferLabel) return findRangeEdgeBandHit(args.entry, pool, args.bandPoints)
    const prefer = pool.find((r) => r.label === args.preferLabel)
    if (prefer && isEntryWithinRangeEdgeBand(args.entry, prefer, args.bandPoints)) {
      return findRangeEdgeBandHit(args.entry, [prefer], args.bandPoints)
    }
    return findRangeEdgeBandHit(args.entry, pool, args.bandPoints)
  }

  if (live.length > 0) {
    const liveHit = pickPreferred(live)
    if (liveHit) return liveHit
  }
  // Price only sits in a closed painted band (e.g. Tokyo IB during US Range) —
  // return that hit so the gate can show unlock copy, not silent active fallback.
  return pickPreferred(all)
}

/**
 * Lock a place/click price onto a painted ±10 band center (H / L / mid when allowed).
 * Returns null when the price is not inside any candidate band — callers must reject
 * (never soft-clamp off-band into a placeable entry).
 */
export function snapEntryToOpenBandCenter<T extends RangeEdgeLevels>(args: {
  entry: number
  candidates: Array<T | null | undefined>
  preferLabel?: string | null
  liveOk?: (range: T) => boolean
  bandPoints?: number
}): { price: number; hit: RangeEdgeBandHit<T> } | null {
  const hit = attributePlaybookBandEntry(args)
  if (!hit) return null
  // Prefer live-open bands only for placeable snaps. Closed-band hits are for deny copy.
  if (args.liveOk && !args.liveOk(hit.range)) return null
  return { price: hit.center, hit }
}

export function assertRangeEdgeEntry(args: {
  entry: number
  range: RangeEdgeLevels | null | undefined
  bandPoints?: number
}): { ok: true; range: RangeEdgeLevels } | { ok: false; message: string } {
  const band = args.bandPoints ?? RANGE_EDGE_BAND_POINTS
  const range = args.range
  if (!range || !Number.isFinite(range.high) || !Number.isFinite(range.low) || !(range.high > range.low)) {
    return {
      ok: false,
      message:
        'Active strategy range is not shaped yet — wait for OR30 / IB / lunch (or Nikkei US Range) to lock, then enter within ±10 pts of the painted edge bands.',
    }
  }
  const entry = Number(args.entry)
  if (!Number.isFinite(entry) || entry <= 0) {
    return { ok: false, message: 'Invalid entry price' }
  }
  if (!isEntryWithinRangeEdgeBand(entry, range, band)) {
    if (!rangeAllowsMidEdge(range)) {
      const mid = (range.high + range.low) / 2
      if (Number.isFinite(mid) && Math.abs(entry - mid) <= band) {
        return { ok: false, message: RANGE_EDGE_US_MID_REJECTED_MESSAGE }
      }
      return {
        ok: false,
        message: `Entry only at highlighted ±10 ${rangeEdgeBandLegend(range)}.`,
      }
    }
    return { ok: false, message: RANGE_EDGE_OFF_BAND_MESSAGE }
  }
  return { ok: true, range }
}

/** Keep only levels whose price sits in a ±band of range high, mid, or low. */
export function filterLevelsInRangeEdgeBand<T extends { price: number }>(
  levels: T[],
  range: RangeEdgeLevels | null | undefined,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): T[] {
  if (!range) return []
  return levels.filter((l) => isEntryWithinRangeEdgeBand(Number(l.price), range, bandPoints))
}

export const NO_IN_BAND_LEVELS_MESSAGE =
  'No liquidity levels in the ±10 strategy bands (H / 50% / L) — stand by or place manually at those magnets.'
