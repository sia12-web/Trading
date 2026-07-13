import { NextRequest, NextResponse } from 'next/server'
import { getPriceFeeder } from '@/lib/services/priceFeeder'
import type { Instrument, PriceFeedResponse } from '@/types/price-feed'

/**
 * GET /api/price-feed/update
 * Fetch latest prices from Finnhub and trigger broadcast to Realtime
 *
 * Query params:
 *   - instruments: Comma-separated list (DOW,NASDAQ,NIKKEI). Default: all
 */
export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const instrumentsParam = request.nextUrl.searchParams.get('instruments')
    let instruments: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']

    if (instrumentsParam) {
      const parsed = instrumentsParam.split(',').filter((i) => i.trim())
      instruments = parsed.filter((i) => ['DOW', 'NASDAQ', 'NIKKEI'].includes(i)) as Instrument[]

      if (instruments.length === 0) {
        return NextResponse.json(
          { error: 'Invalid instruments parameter. Must be DOW, NASDAQ, or NIKKEI' },
          { status: 400 }
        )
      }
    }

    const priceFeeder = getPriceFeeder()

    // Fetch latest prices
    const prices = await priceFeeder.fetchLatestPrices(instruments)

    if (prices.size === 0) {
      console.warn('[Price Feed API] No valid prices fetched')
      const response: PriceFeedResponse = {
        success: false,
        prices: {},
        last_update: new Date().toISOString(),
        next_update: new Date(Date.now() + 1000).toISOString(),
        error: 'Failed to fetch prices from Finnhub',
      }
      return NextResponse.json(response, { status: 200 })
    }

    // Broadcast prices to Realtime
    const broadcastResult = await priceFeeder.broadcastPrices(prices)

    // Build response
    const pricesMap: Record<string, any> = {}
    for (const [instrument, priceUpdate] of prices.entries()) {
      pricesMap[instrument] = priceUpdate
    }

    const response: PriceFeedResponse = {
      success: broadcastResult.failed.length === 0,
      prices: pricesMap,
      last_update: new Date().toISOString(),
      next_update: new Date(Date.now() + 1000).toISOString(),
      ...(broadcastResult.failed.length > 0 && {
        error: `Failed to broadcast to channels: ${broadcastResult.failed.join(', ')}`,
      }),
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[Price Feed API] Unexpected error:', error)
    const response: PriceFeedResponse = {
      success: false,
      prices: {},
      last_update: new Date().toISOString(),
      next_update: new Date(Date.now() + 1000).toISOString(),
      error: 'Internal server error',
    }
    return NextResponse.json(response, { status: 500 })
  }
}
