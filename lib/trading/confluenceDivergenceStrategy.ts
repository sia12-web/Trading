/**
 * Confluence Divergence Strategy (Market Profile + VWAP + John Kurisko Divergence)
 *
 * Combines:
 * 1. Location: Yesterday Value Area (VAH, VAL, POC), Session VWAP ±1σ bands, HTF Trendlines.
 * 2. Context: Auction market rotation vs trend continuation.
 * 3. Trigger: John Kurisko (DayTraderRockStar) Multi-Timeframe Stochastic (14,3,3) Divergence.
 * 4. Risk: Fixed structural brackets with 70% scale-out at POC/VWAP midline and BE runner.
 */

import type { Instrument } from '@/types/price-feed'

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface StochasticPoint {
  time: number
  k: number
  d: number
}

export interface ValueAreaLevels {
  vah: number
  val: number
  poc: number
  high?: number
  low?: number
}

export interface VwapBands {
  vwap: number
  upper1: number
  lower1: number
  upper2?: number
  lower2?: number
}

export type SetupDirection = 'BUY' | 'SELL'

export interface ConfluenceSignal {
  time: number
  instrument: Instrument
  direction: SetupDirection
  entryPrice: number
  stopLoss: number
  tp1: number
  tp2: number
  riskPoints: number
  rMultipleTp1: number
  rMultipleTp2: number
  locationReason: string
  triggerReason: string
  stochK: number
  stochD: number
}

/**
 * Calculate Fast/Slow Stochastic Oscillator (%K, %D)
 * @param bars OHLCV candle bars
 * @param kPeriod Lookback period for highest high & lowest low (default 14)
 * @param kSlowing Smoothing period for %K (default 3)
 * @param dPeriod Smoothing period for %D (default 3)
 */
export function calculateStochastic(
  bars: Candle[],
  kPeriod = 14,
  kSlowing = 3,
  dPeriod = 3
): StochasticPoint[] {
  if (bars.length < kPeriod) return []

  const rawK: { time: number; val: number }[] = []

  for (let i = kPeriod - 1; i < bars.length; i++) {
    let highest = -Infinity
    let lowest = Infinity
    for (let j = i - kPeriod + 1; j <= i; j++) {
      const b = bars[j]!
      if (b.high > highest) highest = b.high
      if (b.low < lowest) lowest = b.low
    }

    const range = highest - lowest
    const c = bars[i]!.close
    const val = range > 0 ? ((c - lowest) / range) * 100 : 50
    rawK.push({ time: bars[i]!.time, val })
  }

  // Smooth rawK by kSlowing
  const smoothedK: { time: number; k: number }[] = []
  for (let i = kSlowing - 1; i < rawK.length; i++) {
    let sum = 0
    for (let j = i - kSlowing + 1; j <= i; j++) {
      sum += rawK[j]!.val
    }
    smoothedK.push({ time: rawK[i]!.time, k: sum / kSlowing })
  }

  // Calculate %D as moving average of smoothedK by dPeriod
  const result: StochasticPoint[] = []
  for (let i = dPeriod - 1; i < smoothedK.length; i++) {
    let sum = 0
    for (let j = i - dPeriod + 1; j <= i; j++) {
      sum += smoothedK[j]!.k
    }
    const d = sum / dPeriod
    result.push({
      time: smoothedK[i]!.time,
      k: Number(smoothedK[i]!.k.toFixed(2)),
      d: Number(d.toFixed(2)),
    })
  }

  return result
}

export type DivergenceType = 'BULLISH' | 'BEARISH' | 'NONE'

export interface DivergenceResult {
  type: DivergenceType
  time: number
  swingPrice1: number
  swingPrice2: number
  stoch1: number
  stoch2: number
  stochCross: boolean
}

/**
 * Detect John Kurisko Stochastic Divergence on recent bars
 * Looks back over a window of 5 to 25 bars for swing divergences in oversold (<25) / overbought (>75) zones
 */
export function detectStochasticDivergence(
  bars: Candle[],
  stochPoints: StochasticPoint[],
  lookback = 20
): DivergenceResult {
  const n = bars.length
  if (n < 6 || stochPoints.length < 6) {
    return { type: 'NONE', time: 0, swingPrice1: 0, swingPrice2: 0, stoch1: 0, stoch2: 0, stochCross: false }
  }

  const currentStoch = stochPoints[stochPoints.length - 1]!
  const prevStoch = stochPoints[stochPoints.length - 2]!

  // Map stoch by timestamp for accurate lookup
  const stochMap = new Map<number, StochasticPoint>()
  for (const sp of stochPoints) {
    stochMap.set(sp.time, sp)
  }

  // 1. Check Bullish Divergence (Oversold condition: stoch <= 30)
  const bullCross = (prevStoch.k <= prevStoch.d && currentStoch.k > currentStoch.d) ||
                    (prevStoch.k <= 20 && currentStoch.k > 20)

  if (currentStoch.k <= 30 && (bullCross || currentStoch.k > currentStoch.d)) {
    const currentPriceLow = bars[n - 1]!.low
    const currentK = currentStoch.k

    const startIdx = Math.max(0, n - lookback)
    for (let i = n - 2; i >= startIdx; i--) {
      const b = bars[i]!
      const sp = stochMap.get(b.time)
      if (!sp) continue

      const isSwingLow =
        i === 0 || i === n - 1 || (b.low <= bars[i - 1]!.low && b.low <= (bars[i + 1]?.low ?? b.low))

      if (isSwingLow && sp.k <= 28) {
        const priceLowerOrEqual = currentPriceLow <= b.low * 1.0008
        const stochHigher = currentK >= sp.k + 1.5

        if (priceLowerOrEqual && stochHigher) {
          return {
            type: 'BULLISH',
            time: bars[n - 1]!.time,
            swingPrice1: b.low,
            swingPrice2: currentPriceLow,
            stoch1: sp.k,
            stoch2: currentK,
            stochCross: bullCross,
          }
        }
      }
    }
  }

  // 2. Check Bearish Divergence (Overbought condition: stoch >= 70)
  const bearCross = (prevStoch.k >= prevStoch.d && currentStoch.k < currentStoch.d) ||
                    (prevStoch.k >= 80 && currentStoch.k < 80)

  if (currentStoch.k >= 70 && (bearCross || currentStoch.k < currentStoch.d)) {
    const currentPriceHigh = bars[n - 1]!.high
    const currentK = currentStoch.k

    const startIdx = Math.max(0, n - lookback)
    for (let i = n - 2; i >= startIdx; i--) {
      const b = bars[i]!
      const sp = stochMap.get(b.time)
      if (!sp) continue

      const isSwingHigh =
        i === 0 || i === n - 1 || (b.high >= bars[i - 1]!.high && b.high >= (bars[i + 1]?.high ?? b.high))

      if (isSwingHigh && sp.k >= 72) {
        const priceHigherOrEqual = currentPriceHigh >= b.high * 0.9992
        const stochLower = currentK <= sp.k - 1.5

        if (priceHigherOrEqual && stochLower) {
          return {
            type: 'BEARISH',
            time: bars[n - 1]!.time,
            swingPrice1: b.high,
            swingPrice2: currentPriceHigh,
            stoch1: sp.k,
            stoch2: currentK,
            stochCross: bearCross,
          }
        }
      }
    }
  }

  return { type: 'NONE', time: 0, swingPrice1: 0, swingPrice2: 0, stoch1: 0, stoch2: 0, stochCross: false }
}

const LEVEL_PROXIMITY_PCT = 0.0025

function isNear(price: number, level: number, tolerancePct = LEVEL_PROXIMITY_PCT): boolean {
  if (!(price > 0) || !(level > 0)) return false
  return Math.abs(price - level) / level <= tolerancePct
}

export const TICK_SIZES: Record<Instrument, number> = {
  DOW: 1.0,
  NASDAQ: 0.25,
  NIKKEI: 5.0,
  GOLD: 0.1,
  CRUDE: 0.01,
}

export const STRUCTURAL_BUFFERS: Record<Instrument, number> = {
  DOW: 12.0,     // 12 pts beyond swing wick (~$6 on MYM)
  NASDAQ: 12.0,  // 12 pts beyond swing wick (~$24 on MNQ)
  NIKKEI: 25.0,
  GOLD: 2.0,     // $2.00 beyond swing wick (~$20 on MGC)
  CRUDE: 0.20,   // $0.20 beyond swing wick (~$20 on MCL)
}

export function evaluateConfluenceSignal(params: {
  instrument: Instrument
  bars: Candle[]
  stochPoints: StochasticPoint[]
  valueArea: ValueAreaLevels | null
  vwap: VwapBands | null
  htfSupport?: number | null
  htfResistance?: number | null
}): ConfluenceSignal | null {
  const { instrument, bars, stochPoints, valueArea, vwap, htfSupport, htfResistance } = params
  if (bars.length < 6 || stochPoints.length < 6) return null

  const cur = bars[bars.length - 1]!
  const curStoch = stochPoints[stochPoints.length - 1]!
  const tickSize = TICK_SIZES[instrument] || 1.0

  const divergence = detectStochasticDivergence(bars, stochPoints)
  if (divergence.type === 'NONE') return null

  // 1. Long Confluence (Bullish Divergence at Key Support: VAL, Lower VWAP Band, or HTF Support)
  if (divergence.type === 'BULLISH') {
    let supportLevel: number | null = null
    let reason = ''

    if (valueArea?.val && isNear(cur.low, valueArea.val)) {
      supportLevel = valueArea.val
      reason = 'Yesterday VAL Support'
    } else if (vwap?.lower1 && isNear(cur.low, vwap.lower1)) {
      supportLevel = vwap.lower1
      reason = 'VWAP -1σ Lower Band Support'
    } else if (htfSupport && isNear(cur.low, htfSupport)) {
      supportLevel = htfSupport
      reason = 'HTF Trendline Support'
    }

    const buffer = STRUCTURAL_BUFFERS[instrument] ?? (3 * tickSize)

    if (supportLevel != null) {
      const entryPrice = cur.close
      const swingLow = Math.min(divergence.swingPrice1, divergence.swingPrice2, cur.low)
      const stopLoss = Number((swingLow - buffer).toFixed(2))
      const riskPoints = Math.max(entryPrice - stopLoss, buffer)

      const midTarget = valueArea?.poc && valueArea.poc > entryPrice
        ? valueArea.poc
        : vwap?.vwap && vwap.vwap > entryPrice
        ? vwap.vwap
        : entryPrice + riskPoints * 1.5

      const tp1 = Number(midTarget.toFixed(2))
      const tp2Target = valueArea?.vah && valueArea.vah > tp1
        ? valueArea.vah
        : entryPrice + riskPoints * 2.0
      const tp2 = Number(tp2Target.toFixed(2))

      const rMultipleTp1 = Number(((tp1 - entryPrice) / riskPoints).toFixed(2))
      const rMultipleTp2 = Number(((tp2 - entryPrice) / riskPoints).toFixed(2))

      if (rMultipleTp1 >= 0.8) {
        return {
          time: cur.time,
          instrument,
          direction: 'BUY',
          entryPrice,
          stopLoss,
          tp1,
          tp2,
          riskPoints,
          rMultipleTp1,
          rMultipleTp2,
          locationReason: reason,
          triggerReason: `Bullish Stoch Divergence (%K: ${curStoch.k.toFixed(1)} vs prior ${divergence.stoch1.toFixed(1)})`,
          stochK: curStoch.k,
          stochD: curStoch.d,
        }
      }
    }
  }

  // 2. Short Confluence (Bearish Divergence at Key Resistance: VAH, Upper VWAP Band, or HTF Resistance)
  if (divergence.type === 'BEARISH') {
    let resistanceLevel: number | null = null
    let reason = ''

    if (valueArea?.vah && isNear(cur.high, valueArea.vah)) {
      resistanceLevel = valueArea.vah
      reason = 'Yesterday VAH Resistance'
    } else if (vwap?.upper1 && isNear(cur.high, vwap.upper1)) {
      resistanceLevel = vwap.upper1
      reason = 'VWAP +1σ Upper Band Resistance'
    } else if (htfResistance && isNear(cur.high, htfResistance)) {
      resistanceLevel = htfResistance
      reason = 'HTF Trendline Resistance'
    }

    const buffer = STRUCTURAL_BUFFERS[instrument] ?? (3 * tickSize)

    if (resistanceLevel != null) {
      const entryPrice = cur.close
      const swingHigh = Math.max(divergence.swingPrice1, divergence.swingPrice2, cur.high)
      const stopLoss = Number((swingHigh + buffer).toFixed(2))
      const riskPoints = Math.max(stopLoss - entryPrice, buffer)

      const midTarget = valueArea?.poc && valueArea.poc < entryPrice
        ? valueArea.poc
        : vwap?.vwap && vwap.vwap < entryPrice
        ? vwap.vwap
        : entryPrice - riskPoints * 1.5

      const tp1 = Number(midTarget.toFixed(2))
      const tp2Target = valueArea?.val && valueArea.val < tp1
        ? valueArea.val
        : entryPrice - riskPoints * 2.0
      const tp2 = Number(tp2Target.toFixed(2))

      const rMultipleTp1 = Number(((entryPrice - tp1) / riskPoints).toFixed(2))
      const rMultipleTp2 = Number(((entryPrice - tp2) / riskPoints).toFixed(2))

      if (rMultipleTp1 >= 0.8) {
        return {
          time: cur.time,
          instrument,
          direction: 'SELL',
          entryPrice,
          stopLoss,
          tp1,
          tp2,
          riskPoints,
          rMultipleTp1,
          rMultipleTp2,
          locationReason: reason,
          triggerReason: `Bearish Stoch Divergence (%K: ${curStoch.k.toFixed(1)} vs prior ${divergence.stoch1.toFixed(1)})`,
          stochK: curStoch.k,
          stochD: curStoch.d,
        }
      }
    }
  }

  return null
}
