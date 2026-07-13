import { NextRequest, NextResponse } from 'next/server'
import { getPriceFeeder } from '@/lib/services/priceFeeder'
import type { Instrument, PriceUpdate, BroadcastResult } from '@/types/price-feed'

/**
 * POST /api/price-feed/broadcast
 * Broadcast pre-validated price updates to Realtime channels
 *
 * Internal endpoint - should only be called from GET /api/price-feed/update
 * or other internal price distribution logic
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body - must be valid JSON' },
        { status: 400 }
      )
    }

    const { prices } = body as { prices?: Record<string, PriceUpdate> }

    if (!prices || typeof prices !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid prices parameter' },
        { status: 400 }
      )
    }

    // Validate price data structure
    const priceMap = new Map<Instrument, PriceUpdate>()

    for (const [key, priceData] of Object.entries(prices)) {
      const instrument = key as Instrument

      // Validate instrument
      if (!['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument)) {
        console.warn(`[Broadcast API] Invalid instrument: ${instrument}`)
        continue
      }

      // Validate price data
      if (!priceData || typeof priceData !== 'object') {
        console.warn(`[Broadcast API] Invalid price data for ${instrument}`)
        continue
      }

      const p = priceData as Record<string, any>
      if (
        typeof p.price !== 'number' ||
        typeof p.bid !== 'number' ||
        typeof p.ask !== 'number' ||
        typeof p.timestamp !== 'string' ||
        typeof p.change !== 'number' ||
        typeof p.change_pct !== 'number'
      ) {
        console.warn(`[Broadcast API] Missing required fields for ${instrument}`)
        continue
      }

      // Basic validation
      if (p.price <= 0 || p.bid <= 0 || p.ask <= 0) {
        console.warn(`[Broadcast API] Invalid price values for ${instrument}`)
        continue
      }

      priceMap.set(instrument, priceData as PriceUpdate)
    }

    if (priceMap.size === 0) {
      return NextResponse.json(
        { error: 'No valid price data provided' },
        { status: 400 }
      )
    }

    // Broadcast prices using PriceFeeder
    const priceFeeder = getPriceFeeder()
    const result: BroadcastResult = await priceFeeder.broadcastPrices(priceMap)

    return NextResponse.json(
      {
        broadcasted: result.broadcasted,
        failed: result.failed,
        timestamp: result.timestamp,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[Broadcast API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
