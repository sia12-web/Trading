/**
 * Live cross-market radar.
 * Volatility indexes and futures prints come from Yahoo. Grades are scored
 * from those prints and the matching 5-minute bars. Nothing here is a sample book.
 */

import { getYahooSymbolCandles } from '@/lib/yahoo/candles'
import { getYahooSymbolQuote } from '@/lib/yahoo/quote'
import {
  ALL_RADAR_MARKETS,
  buildCrossMarketRadarReport,
  deriveRadarMarketInput,
  type CrossMarketRadarReport,
  type MarketInputData,
  type RadarMarket,
} from './crossMarketRadar'
import {
  getCrossMarketVolatility,
  type CrossMarketVolatilityState,
} from './crossMarketVolatility'

const MARKET_FEEDS: Record<RadarMarket, { symbol: string; timeZone: string; bin: number }> = {
  NASDAQ: { symbol: 'MNQ=F', timeZone: 'America/New_York', bin: 5 },
  DOW: { symbol: 'MYM=F', timeZone: 'America/New_York', bin: 10 },
  SP500: { symbol: 'MES=F', timeZone: 'America/New_York', bin: 1 },
  GOLD: { symbol: 'MGC=F', timeZone: 'America/New_York', bin: 1 },
  CRUDE: { symbol: 'CL=F', timeZone: 'America/New_York', bin: 0.05 },
  NIKKEI: { symbol: 'NKD=F', timeZone: 'Asia/Tokyo', bin: 25 },
}

export async function loadLiveRadarInputs(): Promise<Partial<Record<RadarMarket, MarketInputData>>> {
  const rows = await Promise.all(
    ALL_RADAR_MARKETS.map(async (market) => {
      const spec = MARKET_FEEDS[market]
      const [quote, candles] = await Promise.all([
        getYahooSymbolQuote(spec.symbol),
        getYahooSymbolCandles(spec.symbol, '5m', '5d'),
      ])
      if (!quote || !(quote.price > 0)) return null
      return deriveRadarMarketInput({
        market,
        price: quote.price,
        previousClose: quote.previous_close,
        candles: candles ?? [],
        timeZone: spec.timeZone,
        bin: spec.bin,
      })
    })
  )

  const inputs: Partial<Record<RadarMarket, MarketInputData>> = {}
  for (const row of rows) {
    if (row) inputs[row.market] = row
  }
  return inputs
}

export interface LiveCrossMarketSnapshot {
  volatility: CrossMarketVolatilityState
  radar: CrossMarketRadarReport
}

let cachedSnapshot: (LiveCrossMarketSnapshot & { at: number }) | null = null
const SNAPSHOT_TTL_MS = 30_000

/** One 30-second snapshot shared by the chart strip and Leo. */
export async function getLiveCrossMarketSnapshot(): Promise<LiveCrossMarketSnapshot> {
  const now = Date.now()
  if (cachedSnapshot && now - cachedSnapshot.at < SNAPSHOT_TTL_MS) {
    return cachedSnapshot
  }
  const [volatility, inputs] = await Promise.all([
    getCrossMarketVolatility(),
    loadLiveRadarInputs(),
  ])
  const radar = buildCrossMarketRadarReport(volatility, inputs)
  cachedSnapshot = { at: now, volatility, radar }
  return cachedSnapshot
}
