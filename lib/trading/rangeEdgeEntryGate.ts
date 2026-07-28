/**
 * Range Edge Entry Gate — entries only within ±N index points of
 * the active playbook range high or low.
 */

export const RANGE_EDGE_BAND_POINTS = 10

export type RangeEdgeLevels = {
  high: number
  low: number
  label?: string | null
}

export type RangeEdgeBand = {
  edge: 'high' | 'low'
  center: number
  min: number
  max: number
}

export function rangeEdgeBands(
  range: RangeEdgeLevels,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): RangeEdgeBand[] {
  const high = Number(range.high)
  const low = Number(range.low)
  if (!Number.isFinite(high) || !Number.isFinite(low) || !(high > low)) return []
  const b = Math.max(0, bandPoints)
  return [
    { edge: 'high', center: high, min: high - b, max: high + b },
    { edge: 'low', center: low, min: low - b, max: low + b },
  ]
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
 * Keep (or move) a price into the nearest legal ±band of range H/L.
 * Already in-band → unchanged. Mid-range / outside → clamped onto the
 * closest band edge so Market/Limit tools open on the highlighted zones.
 * Returns null when range is missing/invalid.
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

export function nearestRangeEdge(
  entry: number,
  range: RangeEdgeLevels
): 'high' | 'low' | null {
  if (!Number.isFinite(entry) || !(range.high > range.low)) return null
  return Math.abs(entry - range.high) <= Math.abs(entry - range.low) ? 'high' : 'low'
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
        'Active strategy range is not shaped yet — wait for OR30 / IB / lunch (or Nikkei US Range) to lock, then enter within ±10 pts of high or low.',
    }
  }
  const entry = Number(args.entry)
  if (!Number.isFinite(entry) || entry <= 0) {
    return { ok: false, message: 'Invalid entry price' }
  }
  if (!isEntryWithinRangeEdgeBand(entry, range, band)) {
    const label = range.label ? `${range.label} ` : ''
    return {
      ok: false,
      message: `Entry must be within ${band} pts of ${label}range high (${range.high}) or low (${range.low}).`,
    }
  }
  return { ok: true, range }
}

/** Keep only levels whose price sits in a ±band of range high or low. */
export function filterLevelsInRangeEdgeBand<T extends { price: number }>(
  levels: T[],
  range: RangeEdgeLevels | null | undefined,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): T[] {
  if (!range) return []
  return levels.filter((l) => isEntryWithinRangeEdgeBand(Number(l.price), range, bandPoints))
}

export const NO_IN_BAND_LEVELS_MESSAGE =
  'No liquidity levels in the ±10 strategy band — stand by or place manually at the range edge.'
