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
  deltaPct: number
  trappedTraders: 'TRAPPED_BUYERS' | 'TRAPPED_SELLERS' | 'NONE'
  ticks: FootprintTick[]
  stackedBuyImbalances: StackedImbalance[]
  stackedSellImbalances: StackedImbalance[]
  unfinishedAuction: { highZeroBid: boolean; lowZeroAsk: boolean }
}

export interface NakedPoc {
  price: number
  time: number
  tested: boolean
  totalVolume: number
}

export interface UnfinishedAuctionLevel {
  type: 'HIGH' | 'LOW'
  price: number
  time: number
  tested: boolean
}

export interface AggregatedFootprintRow {
  lowPrice: number
  highPrice: number
  midPrice: number
  bidVol: number
  askVol: number
  totalVol: number
  delta: number
  isBuyImbalance: boolean
  isSellImbalance: boolean
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
      let bidVol = Math.max(0, tickVol - askVol)
      let adjAsk = askVol
      // Sierra poor high / poor low: zero opposing volume at the extreme tick
      if (i === numTicks - 1 && askVol >= bidVol * 2) bidVol = 0
      if (i === 0 && bidVol >= askVol * 2) adjAsk = 0
      const tickDelta = adjAsk - bidVol

      if (tickVol > maxTickVol) {
        maxTickVol = tickVol
        candlePocPrice = price
      }

      ticks.push({
        price,
        bidVol,
        askVol: adjAsk,
        totalVol: bidVol + adjAsk,
        delta: tickDelta,
        isBuyImbalance: false,
        isSellImbalance: false,
      })
    }

    markDiagonalImbalances(ticks, 3)

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

    const deltaPct = vol > 0 ? Number(((delta / vol) * 100).toFixed(1)) : 0
    let trappedTraders: 'TRAPPED_BUYERS' | 'TRAPPED_SELLERS' | 'NONE' = 'NONE'

    const prevBar = footprintBars[footprintBars.length - 1]
    if (prevBar) {
      // Trapped Buyers: Bar pushed to/above prevBar high with negative delta & closed red
      if (bar.high >= prevBar.high && delta < -Math.abs(vol * 0.04) && bar.close < bar.open) {
        trappedTraders = 'TRAPPED_BUYERS'
      }
      // Trapped Sellers: Bar pushed to/below prevBar low with positive delta & closed green
      else if (bar.low <= prevBar.low && delta > Math.abs(vol * 0.04) && bar.close > bar.open) {
        trappedTraders = 'TRAPPED_SELLERS'
      }
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
      deltaPct,
      trappedTraders,
      ticks,
      stackedBuyImbalances,
      stackedSellImbalances,
      unfinishedAuction,
    })
  }

  return footprintBars
}

/** Sierra / Tradovate: ask at P vs bid at P−1 tick (300% default). */
export function markDiagonalImbalances(ticks: FootprintTick[], ratio = 3): void {
  if (ticks.length === 0) return
  const sorted = [...ticks].sort((a, b) => a.price - b.price)
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!
    const below = i > 0 ? sorted[i - 1]! : null
    const above = i < sorted.length - 1 ? sorted[i + 1]! : null
    cur.isBuyImbalance = below != null && cur.askVol >= below.bidVol * ratio && cur.askVol >= 5
    cur.isSellImbalance = above != null && cur.bidVol >= above.askVol * ratio && cur.bidVol >= 5
  }
}

/**
 * Dynamically aggregates high-resolution footprint ticks into readable rows
 * based on the visible vertical pixel height, preventing overlapping text.
 */
export function aggregateFootprintTicks(
  ticks: FootprintTick[],
  maxBuckets: number
): AggregatedFootprintRow[] {
  if (!ticks || ticks.length === 0) return []
  if (ticks.length <= maxBuckets || maxBuckets <= 1) {
    return ticks.map((t) => ({
      lowPrice: t.price,
      highPrice: t.price,
      midPrice: t.price,
      bidVol: t.bidVol,
      askVol: t.askVol,
      totalVol: t.totalVol,
      delta: t.delta,
      isBuyImbalance: t.isBuyImbalance,
      isSellImbalance: t.isSellImbalance,
    }))
  }

  const sorted = [...ticks].sort((a, b) => a.price - b.price)
  const bucketSize = Math.ceil(sorted.length / maxBuckets)
  const rows: AggregatedFootprintRow[] = []

  for (let i = 0; i < sorted.length; i += bucketSize) {
    const slice = sorted.slice(i, i + bucketSize)
    if (slice.length === 0) continue

    const lowPrice = slice[0]!.price
    const highPrice = slice[slice.length - 1]!.price
    const midPrice = Number(((lowPrice + highPrice) / 2).toFixed(2))

    let bidVol = 0
    let askVol = 0
    let totalVol = 0

    for (const s of slice) {
      bidVol += s.bidVol
      askVol += s.askVol
      totalVol += s.totalVol
    }

    const delta = askVol - bidVol
    const isBuyImbalance = askVol >= bidVol * 3.0 && askVol >= 5
    const isSellImbalance = bidVol >= askVol * 3.0 && bidVol >= 5

    rows.push({
      lowPrice,
      highPrice,
      midPrice,
      bidVol,
      askVol,
      totalVol,
      delta,
      isBuyImbalance,
      isSellImbalance,
    })
  }

  return rows
}

/**
 * Detects Naked (Virgin) POCs from recent footprint bars that have not been
 * re-tested by subsequent price action, acting as key liquidity targets.
 */
export function findNakedPocs(bars: FootprintBar[]): NakedPoc[] {
  if (!bars || bars.length < 2) return []
  const result: NakedPoc[] = []

  for (let i = 0; i < bars.length - 1; i++) {
    const b = bars[i]!
    const poc = b.candlePocPrice
    let tested = false

    for (let j = i + 1; j < bars.length; j++) {
      const next = bars[j]!
      if (next.low <= poc && next.high >= poc) {
        tested = true
        break
      }
    }

    if (!tested) {
      result.push({
        price: poc,
        time: b.time,
        tested: false,
        totalVolume: b.totalVolume,
      })
    }
  }

  return result
}

/**
 * Finds active Unfinished Auction levels (poor highs/lows) that have not been completed.
 */
export function findActiveUnfinishedAuctions(bars: FootprintBar[]): UnfinishedAuctionLevel[] {
  if (!bars || bars.length === 0) return []
  const result: UnfinishedAuctionLevel[] = []

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    if (b.unfinishedAuction.highZeroBid) {
      let tested = false
      for (let j = i + 1; j < bars.length; j++) {
        if (bars[j]!.high >= b.high) {
          tested = true
          break
        }
      }
      if (!tested) {
        result.push({
          type: 'HIGH',
          price: b.high,
          time: b.time,
          tested: false,
        })
      }
    }

    if (b.unfinishedAuction.lowZeroAsk) {
      let tested = false
      for (let j = i + 1; j < bars.length; j++) {
        if (bars[j]!.low <= b.low) {
          tested = true
          break
        }
      }
      if (!tested) {
        result.push({
          type: 'LOW',
          price: b.low,
          time: b.time,
          tested: false,
        })
      }
    }
  }

  return result
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

  const nakedPocs = findNakedPocs(recentBars)
  const unfinishedAuctions = findActiveUnfinishedAuctions(recentBars)

  let lines: string[] = []
  lines.push(`- Recent Footprint Bars Analyzed: Last 10 1m candles`)
  if (lastBar) {
    lines.push(`- Active Bar Candle POC: ${lastBar.candlePocPrice.toFixed(2)} (Highest Vol Level: ${lastBar.totalVolume.toLocaleString()} contracts, Delta: ${lastBar.netDelta >= 0 ? '+' : ''}${lastBar.netDelta} / ${lastBar.deltaPct}%)`)
  }

  // Trapped Traders Alert
  const recentTrapped = recentBars.filter((b) => b.trappedTraders !== 'NONE')
  if (recentTrapped.length > 0) {
    const latestTrapped = recentTrapped[recentTrapped.length - 1]!
    if (latestTrapped.trappedTraders === 'TRAPPED_BUYERS') {
      lines.push(`- ⚠️ TRAPPED BUYERS: High of ${latestTrapped.high.toFixed(2)} met with aggressive limit absorption (Negative Delta ${latestTrapped.netDelta} Δ). High likelihood of downside rejection.`)
    } else if (latestTrapped.trappedTraders === 'TRAPPED_SELLERS') {
      lines.push(`- ⚠️ TRAPPED SELLERS: Low of ${latestTrapped.low.toFixed(2)} met with aggressive limit absorption (Positive Delta +${latestTrapped.netDelta} Δ). High likelihood of upside bounce.`)
    }
  }

  // Naked POCs
  if (nakedPocs.length > 0) {
    const pocList = nakedPocs.map((p) => p.price.toFixed(2)).join(', ')
    lines.push(`- 🎯 UNTESTED NAKED POCs (Liquidity Magnets): ${pocList}`)
  }

  // Unfinished Auctions
  if (unfinishedAuctions.length > 0) {
    const uaList = unfinishedAuctions.map((ua) => `${ua.type === 'HIGH' ? 'High' : 'Low'} @ ${ua.price.toFixed(2)}`).join(', ')
    lines.push(`- ⚡ UNFINISHED AUCTION TARGETS: ${uaList} (Expected to complete in subsequent rotations)`)
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
