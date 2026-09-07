/**
 * Auction Market Theory - 5-Day Excesses & Rounded Numbers
 *
 * Excesses:
 * Areas where price was aggressively advertised and rejected by other-timeframe
 * market participants (responsive buyers or sellers), creating buying or selling tails.
 * These act as critical reference points of strong rejection / support & resistance.
 * When market retests these points, comparing volume reveals whether the rejection is
 * holding (absorption / low volume retest) or failing (breakout / high volume).
 *
 * Rounded Numbers:
 * Key psychological whole numbers where institutional and retail orders cluster.
 */

export interface MarketExcess {
  id: string
  type: 'BUYING_EXCESS' | 'SELLING_EXCESS'
  time: number
  price: number
  volume: number
  candleOpen: number
  candleClose: number
  candleHigh: number
  candleLow: number
  isRetested: boolean
  retestTime?: number
  retestVolume?: number
  retestVolumeRatio?: number
}

export interface ExcessBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const ROUNDED_NUMBER_STEP: Record<string, number> = {
  DOW: 500,
  NASDAQ: 250,
  NIKKEI: 500,
  GOLD: 50,
  CRUDE: 5,
}

/**
 * Return psychological rounded numbers spanning [minPrice, maxPrice].
 */
export function getRoundedNumbers(
  minPrice: number,
  maxPrice: number,
  instrument: string = 'DOW'
): number[] {
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice >= maxPrice) {
    return []
  }

  const instUpper = instrument.toUpperCase()
  const step = ROUNDED_NUMBER_STEP[instUpper] ?? 100

  const start = Math.ceil(minPrice / step) * step
  const rounded: number[] = []

  for (let p = start; p <= maxPrice; p += step) {
    rounded.push(Number(p.toFixed(2)))
  }

  return rounded
}

/**
 * Detect buying and selling excesses across the bars.
 * A buying excess has a long lower wick (>= 40% of candle range) and forms a local low.
 * A selling excess has a long upper wick (>= 40% of candle range) and forms a local high.
 */
export function detect5DayExcesses(
  bars: ExcessBar[],
  _instrument: string = 'DOW',
  anchorUnix?: number
): MarketExcess[] {
  if (!bars || bars.length < 5) return []

  const scoped = anchorUnix != null
    ? bars.filter((b) => b.time >= anchorUnix)
    : bars

  if (scoped.length < 5) return []

  const excesses: MarketExcess[] = []

  for (let i = 2; i < scoped.length - 2; i++) {
    const b = scoped[i]!
    const range = b.high - b.low
    if (range <= 0) continue

    const upperWick = b.high - Math.max(b.open, b.close)
    const lowerWick = Math.min(b.open, b.close) - b.low
    const vol = Math.max(0, b.volume > 0 ? b.volume : 1)

    // Check Selling Excess (upper tail rejection)
    if (
      upperWick / range >= 0.4 &&
      b.high > scoped[i - 1]!.high &&
      b.high > scoped[i + 1]!.high &&
      b.high >= scoped[i - 2]!.high &&
      b.high >= scoped[i + 2]!.high
    ) {
      // Look forward for retests
      let isRetested = false
      let retestTime: number | undefined
      let retestVolume: number | undefined
      const tol = Math.max(range * 0.15, b.high * 0.0008)

      for (let j = i + 1; j < scoped.length; j++) {
        const next = scoped[j]!
        if (Math.abs(next.high - b.high) <= tol || (next.high >= b.high - tol && next.low <= b.high)) {
          isRetested = true
          retestTime = next.time
          retestVolume = Math.max(0, next.volume > 0 ? next.volume : 1)
          break
        }
      }

      const ratio = retestVolume != null && vol > 0 ? Number((retestVolume / vol).toFixed(2)) : undefined

      excesses.push({
        id: `sell-excess-${b.time}-${b.high}`,
        type: 'SELLING_EXCESS',
        time: b.time,
        price: Number(b.high.toFixed(2)),
        volume: vol,
        candleOpen: b.open,
        candleClose: b.close,
        candleHigh: b.high,
        candleLow: b.low,
        isRetested,
        retestTime,
        retestVolume,
        retestVolumeRatio: ratio,
      })
    }

    // Check Buying Excess (lower tail rejection)
    if (
      lowerWick / range >= 0.4 &&
      b.low < scoped[i - 1]!.low &&
      b.low < scoped[i + 1]!.low &&
      b.low <= scoped[i - 2]!.low &&
      b.low <= scoped[i + 2]!.low
    ) {
      let isRetested = false
      let retestTime: number | undefined
      let retestVolume: number | undefined
      const tol = Math.max(range * 0.15, b.low * 0.0008)

      for (let j = i + 1; j < scoped.length; j++) {
        const next = scoped[j]!
        if (Math.abs(next.low - b.low) <= tol || (next.low <= b.low + tol && next.high >= b.low)) {
          isRetested = true
          retestTime = next.time
          retestVolume = Math.max(0, next.volume > 0 ? next.volume : 1)
          break
        }
      }

      const ratio = retestVolume != null && vol > 0 ? Number((retestVolume / vol).toFixed(2)) : undefined

      excesses.push({
        id: `buy-excess-${b.time}-${b.low}`,
        type: 'BUYING_EXCESS',
        time: b.time,
        price: Number(b.low.toFixed(2)),
        volume: vol,
        candleOpen: b.open,
        candleClose: b.close,
        candleHigh: b.high,
        candleLow: b.low,
        isRetested,
        retestTime,
        retestVolume,
        retestVolumeRatio: ratio,
      })
    }
  }

  return excesses
}
