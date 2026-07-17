/**
 * GET /api/trading/quote?instrument=DOW
 * Low-latency last price for the chart desk (Yahoo index symbols).
 */

import { NextResponse } from 'next/server'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { isLiveDeskInstrument } from '@/lib/trading/sessionGate'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const instrument = (searchParams.get('instrument') || 'DOW') as Instrument

    if (!isLiveDeskInstrument(instrument)) {
      return NextResponse.json(
        { error: 'Desk quote supports DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    const quote = await getYahooQuote(instrument)
    if (!quote) {
      return NextResponse.json(
        { error: 'No quote', instrument, price: null },
        {
          status: 200,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        }
      )
    }

    return NextResponse.json(
      {
        instrument,
        source: 'yahoo',
        price: quote.price,
        change: quote.change,
        change_pct: quote.change_pct,
        previous_close: quote.previous_close,
        timestamp: quote.timestamp,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote fetch failed'
    console.error('[quote]', message)
    return NextResponse.json({ error: message, price: null }, { status: 500 })
  }
}
