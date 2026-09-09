/**
 * Order Flow & Cumulative Volume Delta (CVD) Engine for CME Futures
 *
 * Computes institutional buy/sell pressure, bar delta, session CVD,
 * and detects volume delta divergences / absorption at key auction levels
 * (5D POC, Y-POC, VAH, VAL, and Anchored VWAP bands).
 */

export interface OrderFlowBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface BarDelta {
  time: number
  buyVolume: number
  sellVolume: number
  delta: number
  cvd: number
  buyRatio: number
}

export interface CvdCandleBar {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export interface OrderFlowSummary {
  sessionCvd: number
  latestBarDelta: number
  latestBuyVolume: number
  latestSellVolume: number
  latestBuyRatio: number
  trend: 'BUYER_DOMINANT' | 'SELLER_DOMINANT' | 'BALANCED'
  divergence: 'BULLISH_ABSORPTION' | 'BEARISH_EXHAUSTION' | 'NONE'
  description: string
  bars: BarDelta[]
}

export function estimateBarDelta(bar: OrderFlowBar): { buyVolume: number; sellVolume: number; delta: number } {
  const vol = Math.max(0, bar.volume || 0)
  if (vol === 0) return { buyVolume: 0, sellVolume: 0, delta: 0 }

  const range = bar.high - bar.low
  if (range <= 0) {
    const half = Math.round(vol / 2)
    return { buyVolume: half, sellVolume: vol - half, delta: 0 }
  }

  const closePos = (bar.close - bar.low) / range
  const body = (bar.close - bar.open) / range
  const rawRatio = 0.5 + body * 0.35 + (closePos - 0.5) * 0.3
  const buyRatio = Math.max(0.05, Math.min(0.95, rawRatio))

  const buyVolume = Math.round(vol * buyRatio)
  const sellVolume = vol - buyVolume
  const delta = buyVolume - sellVolume

  return { buyVolume, sellVolume, delta }
}

export function computeOrderFlowCvd(
  bars: OrderFlowBar[],
  sessionStartUnix?: number
): OrderFlowSummary | null {
  if (!bars || bars.length === 0) return null

  const startIdx = sessionStartUnix
    ? Math.max(0, bars.findIndex((b) => b.time >= sessionStartUnix))
    : 0

  const activeBars = bars.slice(startIdx)
  if (activeBars.length === 0) return null

  let runningCvd = 0
  const barDeltas: BarDelta[] = []

  for (const bar of activeBars) {
    const { buyVolume, sellVolume, delta } = estimateBarDelta(bar)
    runningCvd += delta
    const total = buyVolume + sellVolume
    barDeltas.push({
      time: bar.time,
      buyVolume,
      sellVolume,
      delta,
      cvd: runningCvd,
      buyRatio: total > 0 ? buyVolume / total : 0.5,
    })
  }

  if (barDeltas.length === 0) return null
  const latest = barDeltas[barDeltas.length - 1]
  if (!latest) return null

  const recentDeltas = barDeltas.slice(-5)
  const firstRecent = recentDeltas[0]
  const lastRecent = recentDeltas[recentDeltas.length - 1]
  const recentCvdSlope =
    recentDeltas.length >= 2 && firstRecent && lastRecent
      ? lastRecent.cvd - firstRecent.cvd
      : 0

  let trend: 'BUYER_DOMINANT' | 'SELLER_DOMINANT' | 'BALANCED' = 'BALANCED'
  if (recentCvdSlope > 500 || latest.buyRatio > 0.62) {
    trend = 'BUYER_DOMINANT'
  } else if (recentCvdSlope < -500 || latest.buyRatio < 0.38) {
    trend = 'SELLER_DOMINANT'
  }

  let divergence: 'BULLISH_ABSORPTION' | 'BEARISH_EXHAUSTION' | 'NONE' = 'NONE'
  if (activeBars.length >= 5) {
    const endBar = activeBars[activeBars.length - 1]
    const startBar = activeBars[activeBars.length - 4]
    if (endBar && startBar) {
      const priceChange = endBar.close - startBar.open
      const cvdChange = recentCvdSlope

      if (priceChange < 0 && cvdChange > 200) {
        divergence = 'BULLISH_ABSORPTION'
      } else if (priceChange > 0 && cvdChange < -200) {
        divergence = 'BEARISH_EXHAUSTION'
      }
    }
  }

  let description = `Session CVD: ${runningCvd >= 0 ? '+' : ''}${runningCvd.toLocaleString()} contracts. `
  if (divergence === 'BULLISH_ABSORPTION') {
    description += `⚠️ BULLISH ABSORPTION: Price pressing lower but buyers absorbing sell orders (CVD rising). Potential reversal/spring.`
  } else if (divergence === 'BEARISH_EXHAUSTION') {
    description += `⚠️ BEARISH EXHAUSTION: Price pushing higher on declining/negative delta. Buyers failing to supply follow-through.`
  } else if (trend === 'BUYER_DOMINANT') {
    description += `Aggressive institutional buying flow (${(latest.buyRatio * 100).toFixed(0)}% buy volume).`
  } else if (trend === 'SELLER_DOMINANT') {
    description += `Aggressive institutional selling pressure (${((1 - latest.buyRatio) * 100).toFixed(0)}% sell volume).`
  } else {
    description += `Two-sided balanced auction. No dominant institutional aggressor.`
  }

  return {
    sessionCvd: runningCvd,
    latestBarDelta: latest.delta,
    latestBuyVolume: latest.buyVolume,
    latestSellVolume: latest.sellVolume,
    latestBuyRatio: latest.buyRatio,
    trend,
    divergence,
    description,
    bars: barDeltas,
  }
}

/**
 * Computes candlestick bars for the Cumulative Volume Delta (CVD) sub-pane chart.
 * Each bar represents the Open, High, Low, and Close CVD during that 1-minute period.
 */
export function computeCvdCandleBars(
  bars: OrderFlowBar[],
  sessionStartUnix?: number
): CvdCandleBar[] {
  if (!bars || bars.length === 0) return []

  const startIdx = sessionStartUnix
    ? Math.max(0, bars.findIndex((b) => b.time >= sessionStartUnix))
    : 0

  const activeBars = bars.slice(startIdx)
  if (activeBars.length === 0) return []

  let runningCvd = 0
  const result: CvdCandleBar[] = []

  for (const bar of activeBars) {
    const { buyVolume, sellVolume, delta } = estimateBarDelta(bar)
    const openCvd = runningCvd
    const closeCvd = runningCvd + delta

    // Intrabar delta estimate
    const highCvd = Math.max(openCvd, closeCvd, openCvd + Math.round(buyVolume * 0.75))
    const lowCvd = Math.min(openCvd, closeCvd, openCvd - Math.round(sellVolume * 0.75))

    runningCvd = closeCvd

    result.push({
      time: bar.time,
      open: openCvd,
      high: highCvd,
      low: lowCvd,
      close: closeCvd,
    })
  }

  return result
}
