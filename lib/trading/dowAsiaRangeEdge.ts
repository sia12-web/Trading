/**
 * Dow (YM) Asia Narrow Range (<80 pts) Breakout Edge
 *
 * Rules:
 * 1. Condition: YM Asia Session (20:00 ET [8 PM] -> 02:00 ET [2 AM]) High - Low Range < 80 points.
 * 2. Orders:
 *    - Buy Stop: Asia High + 20 points
 *    - Sell Stop: Asia Low - 20 points
 * 3. Stop Loss: Midpoint of Asia Range ((Asia High + Asia Low) / 2)
 * 4. Take Profit: 1.50 * Risk Distance (1.5R)
 *
 * Callers must pass only the 20:00–02:00 ET bars (see selectDowAsiaSessionBars).
 * The previous first-24-bars cap was 2 hours of 5m data — the window is 6 hours.
 */

import { hourInTz, zonedCivilToUnix } from '@/lib/chart/sessionVwap'

const ET = 'America/New_York'
const ASIA_START_HOUR = 20
const ASIA_END_HOUR = 2

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

function addCalendarDaysYmd(ymd: string, delta: number): string {
    const [y, m, d] = ymd.split('-').map(Number)
    const dt = new Date(Date.UTC(y!, m! - 1, d! + delta, 12, 0, 0))
    return dt.toISOString().slice(0, 10)
}

/**
 * Bars whose start time is inside 20:00 ET on the evening before `cashYmd`
 * through 02:00 ET on `cashYmd` (exclusive of 02:00).
 */
export function selectDowAsiaSessionBars<T extends DowAsiaRangeBar>(
    bars: T[],
    cashYmd: string
): T[] {
    const prev = addCalendarDaysYmd(cashYmd, -1)
    const start = zonedCivilToUnix(prev, ASIA_START_HOUR, ET)
    const end = zonedCivilToUnix(cashYmd, ASIA_END_HOUR, ET)
    return bars.filter((b) => {
        if (!Number.isFinite(b.time) || b.time < start || b.time >= end) return false
        const h = hourInTz(b.time, ET)
        return h >= ASIA_START_HOUR || h < ASIA_END_HOUR
    })
}

export function computeDowAsiaRangeEdge(bars: DowAsiaRangeBar[]): DowAsiaRangeResult | null {
    if (bars.length < 12) return null

    let asiaHigh = -Infinity
    let asiaLow = Infinity

    for (let i = 0; i < bars.length; i++) {
        const b = bars[i]!
        if (!Number.isFinite(b.high) || !Number.isFinite(b.low)) continue
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
            directiveSummary: `DOW ASIA RANGE (8PM-2AM: ${asiaRange} pts >= 80 pts): Compression edge inactive.`,
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
        directiveSummary: `⚡ DOW ASIA NARROW RANGE (8PM-2AM <80 PTS EDGE): Asia Range = ${asiaRange} pts. Buy Stop ${buyStopPrice} | Sell Stop ${sellStopPrice} | SL ${asiaMid} | 1.5R TP`,
    }
}

/** Formats an automated Telegram notification exclusively for Dow Asia Edge trade entry. */
export function formatDowAsiaTelegramAlert(args: {
    side: 'LONG' | 'SHORT'
    asiaRange: number
    entryPrice: number
    stopLossPrice: number
    takeProfitPrice: number
    riskDollars: number
}): string {
    const icon = args.side === 'LONG' ? '🟢 BUY STOP TRIGGERED' : '🔴 SELL STOP TRIGGERED'
    const rr = '1.50R'
    return [
        `🚨 DOW ASIA BREAKOUT ENTRY — ${icon}`,
        `Instrument: DOW (YM Futures)`,
        `Setup: Asia Narrow Range (8 PM - 2 AM ET <80 pts Compression)`,
        `Asia Range: ${args.asiaRange} pts`,
        `Direction: ${args.side}`,
        `Entry Order: ${args.entryPrice.toLocaleString('en-US')}`,
        `Stop Loss: ${args.stopLossPrice.toLocaleString('en-US')} (Asia Midpoint)`,
        `Take Profit: ${args.takeProfitPrice.toLocaleString('en-US')} (${rr} Target)`,
        `Tradeify $50K Risk: $${args.riskDollars} (Step 1)`,
        `Timestamp: ${new Date().toISOString()}`,
    ].join('\n')
}

/** Generates a Trade Journal record for automatic database logging. */
export function createDowAsiaJournalPayload(args: {
    side: 'LONG' | 'SHORT'
    asiaRange: number
    entryPrice: number
    stopLossPrice: number
    takeProfitPrice: number
    riskDollars: number
    sessionKey: string
}) {
    return {
        instrument: 'DOW',
        setup_name: 'DOW_ASIA_NARROW_RANGE_BREAKOUT',
        side: args.side,
        entry_price: args.entryPrice,
        stop_loss: args.stopLossPrice,
        take_profit: args.takeProfitPrice,
        risk_dollars: args.riskDollars,
        risk_reward_ratio: 1.5,
        asia_range_pts: args.asiaRange,
        tradeify_session_key: args.sessionKey,
        notes: `Automated 8:00 PM - 2:00 AM ET Asia Breakout execution. Asia Range ${args.asiaRange} pts < 80 pts. SL at Asia Midpoint ${args.stopLossPrice}. 1.5R TP at ${args.takeProfitPrice}.`,
        created_at: new Date().toISOString(),
    }
}
