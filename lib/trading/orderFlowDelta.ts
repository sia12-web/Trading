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

export interface FootprintTick {
  price: number
  bidVol: number
  askVol: number
  totalVol: number
  delta: number
  isBuyImbalance: boolean
  isSellImbalance: boolean
}

export interface StackedImbalance {
  type: 'BUY' | 'SELL'
  startPrice: number
  endPrice: number
  consecutiveTicks: number
  totalVolume: number
  netDelta: number
}

export interface FootprintBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  candlePocPrice: number
  totalVolume: number
  netDelta: number
  ticks: FootprintTick[]
  stackedBuyImbalances: StackedImbalance[]
  stackedSellImbalances: StackedImbalance[]
  unfinishedAuction: { highZeroBid: boolean; lowZeroAsk: boolean }
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

/**
 * Computes price tick-level Bid x Ask footprint bars, stacked imbalances,
 * and Candle POC for a list of OHLCV bars.
 */
export function computeFootprintBars(
  bars: OrderFlowBar[],
  tickSize = 0.25
): FootprintBar[] {
  if (!bars || bars.length === 0) return []

  const footprintBars: FootprintBar[] = []

  for (const bar of bars) {
    const vol = Math.max(1, bar.volume || 1)
    const range = bar.high - bar.low
    const { delta } = estimateBarDelta(bar)

    const numTicks = range > 0 ? Math.max(1, Math.round(range / tickSize) + 1) : 1
    const ticks: FootprintTick[] = []

    let maxTickVol = -1
    let candlePocPrice = bar.close

    for (let i = 0; i < numTicks; i++) {
      const price = Number((bar.low + i * tickSize).toFixed(2))
      const mid = (bar.open + bar.close) / 2
      const dist = range > 0 ? Math.abs(price - mid) / range : 0
      const weight = Math.exp(-dist * dist * 3)

      const tickVol = Math.max(1, Math.round((vol / numTicks) * (0.4 + weight)))

      const closePos = range > 0 ? (bar.close - bar.low) / range : 0.5
      const tickBuyRatio = Math.max(0.05, Math.min(0.95, closePos + (price > mid ? 0.15 : -0.15)))

      const askVol = Math.round(tickVol * tickBuyRatio)
      const bidVol = Math.max(1, tickVol - askVol)
      const tickDelta = askVol - bidVol

      const isBuyImbalance = askVol >= bidVol * 3.0 && askVol >= 5
      const isSellImbalance = bidVol >= askVol * 3.0 && bidVol >= 5

      if (tickVol > maxTickVol) {
        maxTickVol = tickVol
        candlePocPrice = price
      }

      ticks.push({
        price,
        bidVol,
        askVol,
        totalVol: tickVol,
        delta: tickDelta,
        isBuyImbalance,
        isSellImbalance,
      })
    }

    const stackedBuyImbalances: StackedImbalance[] = []
    const stackedSellImbalances: StackedImbalance[] = []

    let buyRun: FootprintTick[] = []
    let sellRun: FootprintTick[] = []

    for (const t of ticks) {
      if (t.isBuyImbalance) {
        buyRun.push(t)
      } else {
        if (buyRun.length >= 3) {
          const first = buyRun[0]!
          const last = buyRun[buyRun.length - 1]!
          const totV = buyRun.reduce((acc, x) => acc + x.totalVol, 0)
          const netD = buyRun.reduce((acc, x) => acc + x.delta, 0)
          stackedBuyImbalances.push({
            type: 'BUY',
            startPrice: first.price,
            endPrice: last.price,
            consecutiveTicks: buyRun.length,
            totalVolume: totV,
            netDelta: netD,
          })
        }
        buyRun = []
      }

      if (t.isSellImbalance) {
        sellRun.push(t)
      } else {
        if (sellRun.length >= 3) {
          const first = sellRun[0]!
          const last = sellRun[sellRun.length - 1]!
          const totV = sellRun.reduce((acc, x) => acc + x.totalVol, 0)
          const netD = sellRun.reduce((acc, x) => acc + x.delta, 0)
          stackedSellImbalances.push({
            type: 'SELL',
            startPrice: first.price,
            endPrice: last.price,
            consecutiveTicks: sellRun.length,
            totalVolume: totV,
            netDelta: netD,
          })
        }
        sellRun = []
      }
    }

    if (buyRun.length >= 3) {
      const first = buyRun[0]!
      const last = buyRun[buyRun.length - 1]!
      stackedBuyImbalances.push({
        type: 'BUY',
        startPrice: first.price,
        endPrice: last.price,
        consecutiveTicks: buyRun.length,
        totalVolume: buyRun.reduce((acc, x) => acc + x.totalVol, 0),
        netDelta: buyRun.reduce((acc, x) => acc + x.delta, 0),
      })
    }

    if (sellRun.length >= 3) {
      const first = sellRun[0]!
      const last = sellRun[sellRun.length - 1]!
      stackedSellImbalances.push({
        type: 'SELL',
        startPrice: first.price,
        endPrice: last.price,
        consecutiveTicks: sellRun.length,
        totalVolume: sellRun.reduce((acc, x) => acc + x.totalVol, 0),
        netDelta: sellRun.reduce((acc, x) => acc + x.delta, 0),
      })
    }

    const topTick = ticks[ticks.length - 1]
    const bottomTick = ticks[0]
    const unfinishedAuction = {
      highZeroBid: topTick ? topTick.bidVol === 0 : false,
      lowZeroAsk: bottomTick ? bottomTick.askVol === 0 : false,
    }

    footprintBars.push({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      candlePocPrice,
      totalVolume: vol,
      netDelta: delta,
      ticks,
      stackedBuyImbalances,
      stackedSellImbalances,
      unfinishedAuction,
    })
  }

  return footprintBars
}

/**
 * Summarizes recent footprint bars & stacked imbalances into structured,
 * actionable algorithmic text for Leo AI assistant.
 */
export function summarizeFootprintForLeo(
  footprintBars: FootprintBar[],
  orderFlow: OrderFlowSummary | null
): string {
  if (!footprintBars || footprintBars.length === 0) {
    return 'No active footprint order flow bars available.'
  }

  const recentBars = footprintBars.slice(-10)
  const lastBar = recentBars[recentBars.length - 1]

  const activeBuyStacked: StackedImbalance[] = []
  const activeSellStacked: StackedImbalance[] = []

  for (const b of recentBars) {
    activeBuyStacked.push(...b.stackedBuyImbalances)
    activeSellStacked.push(...b.stackedSellImbalances)
  }

  let lines: string[] = []
  lines.push(`- Recent Footprint Bars Analyzed: Last 10 1m candles`)
  if (lastBar) {
    lines.push(`- Active Bar Candle POC: ${lastBar.candlePocPrice.toFixed(2)} (Highest Vol Level: ${lastBar.totalVolume.toLocaleString()} contracts)`)
  }

  if (activeBuyStacked.length > 0) {
    const b = activeBuyStacked[activeBuyStacked.length - 1]!
    lines.push(`- 🟢 STACKED BUY IMBALANCE (Support Zone): ${b.startPrice.toFixed(2)} - ${b.endPrice.toFixed(2)} (${b.consecutiveTicks} consecutive buy imbalance ticks, +${b.netDelta} Δ)`)
  } else {
    lines.push(`- Stacked Buy Imbalances: None active in recent 10 bars`)
  }

  if (activeSellStacked.length > 0) {
    const s = activeSellStacked[activeSellStacked.length - 1]!
    lines.push(`- 🔴 STACKED SELL IMBALANCE (Resistance Zone): ${s.startPrice.toFixed(2)} - ${s.endPrice.toFixed(2)} (${s.consecutiveTicks} consecutive sell imbalance ticks, ${s.netDelta} Δ)`)
  } else {
    lines.push(`- Stacked Sell Imbalances: None active in recent 10 bars`)
  }

  if (lastBar?.unfinishedAuction.highZeroBid) {
    lines.push(`- ⚡ UNFINISHED AUCTION: High printed zero bid volume — potential auction continuation upwards.`)
  } else if (lastBar?.unfinishedAuction.lowZeroAsk) {
    lines.push(`- ⚡ UNFINISHED AUCTION: Low printed zero ask volume — potential auction continuation downwards.`)
  }

  if (orderFlow?.divergence === 'BULLISH_ABSORPTION') {
    lines.push(`- 🛡️ INSTITUTIONAL ABSORPTION: Aggressive limit buyers absorbing market sell orders at support. Spring / bullish reversal expected.`)
  } else if (orderFlow?.divergence === 'BEARISH_EXHAUSTION') {
    lines.push(`- 🛡️ INSTITUTIONAL EXHAUSTION: Aggressive buyers failing to lift ask prices. Rejection / bearish roll expected.`)
  }

  return lines.join('\n')
}
