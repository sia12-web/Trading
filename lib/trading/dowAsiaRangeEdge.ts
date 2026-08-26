/**
 * Dow (YM) Asia Narrow Range (<80 pts) Breakout Edge
 * 
 * Rules:
 * 1. Condition: YM Asia Session (18:00 ET -> 03:00 ET) High - Low Range < 80 points.
 * 2. Orders:
 *    - Buy Stop: Asia High + 20 points
 *    - Sell Stop: Asia Low - 20 points
 * 3. Stop Loss: Midpoint of Asia Range ((Asia High + Asia Low) / 2)
 * 4. Take Profit: 1.50 * Risk Distance (1.5R)
 */

export type DowAsiaRangeBar = {
    time: number
    open: number
    high: number
    low: number
    close: number
}

export type DowAsiaRangeResult = {
    activeEdge: boolean
    asiaHigh: number
    asiaLow: number
    asiaRange: number
    asiaMid: number
    buyStopPrice: number
    sellStopPrice: number
    stopLossPriceLong: number
    stopLossPriceShort: number
    takeProfitPriceLong: number
    takeProfitPriceShort: number
    directiveSummary: string
}

export function computeDowAsiaRangeEdge(bars: DowAsiaRangeBar[]): DowAsiaRangeResult | null {
    if (bars.length < 12) return null

    let asiaHigh = -Infinity
    let asiaLow = Infinity

    for (let i = 0; i < Math.min(bars.length, 36); i++) {
        const b = bars[i]!
        if (b.high > asiaHigh) asiaHigh = b.high
        if (b.low < asiaLow) asiaLow = b.low
    }

    if (asiaHigh <= asiaLow || !Number.isFinite(asiaHigh) || !Number.isFinite(asiaLow)) {
        return null
    }

    const asiaRange = Math.round((asiaHigh - asiaLow) * 100) / 100
    const activeEdge = asiaRange < 80
    const asiaMid = Math.round(((asiaHigh + asiaLow) / 2) * 100) / 100

    const buyStopPrice = Math.round((asiaHigh + 20) * 100) / 100
    const sellStopPrice = Math.round((asiaLow - 20) * 100) / 100

    const riskDistanceLong = buyStopPrice - asiaMid
    const takeProfitPriceLong = Math.round((buyStopPrice + riskDistanceLong * 1.5) * 100) / 100

    const riskDistanceShort = asiaMid - sellStopPrice
    const takeProfitPriceShort = Math.round((sellStopPrice - riskDistanceShort * 1.5) * 100) / 100

    if (!activeEdge) {
        return {
            activeEdge: false,
            asiaHigh,
            asiaLow,
            asiaRange,
            asiaMid,
            buyStopPrice,
            sellStopPrice,
            stopLossPriceLong: asiaMid,
            stopLossPriceShort: asiaMid,
            takeProfitPriceLong,
            takeProfitPriceShort,
            directiveSummary: `DOW ASIA RANGE (${asiaRange} pts >= 80 pts): Compression edge inactive.`,
        }
    }

    return {
        activeEdge: true,
        asiaHigh,
        asiaLow,
        asiaRange,
        asiaMid,
        buyStopPrice,
        sellStopPrice,
        stopLossPriceLong: asiaMid,
        stopLossPriceShort: asiaMid,
        takeProfitPriceLong,
        takeProfitPriceShort,
        directiveSummary: `⚡ DOW ASIA NARROW RANGE (<80 PTS EDGE): Asia Range = ${asiaRange} pts. Buy Stop ${buyStopPrice} | Sell Stop ${sellStopPrice} | SL ${asiaMid} | 1.5R TP`,
    }
}
