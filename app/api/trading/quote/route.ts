/**
 * GET /api/trading/quote?instrument=DOW
 * Prefer OANDA mid (same feed as desk candles) then Yahoo — lowest latency tip.
 */

import { NextResponse } from 'next/server'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { isLiveDeskInstrument } from '@/lib/trading/sessionGate'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Session previous close for day change% — refreshed from Yahoo off the hot path */
const dayPrevClose = new Map<string, number>()

function refreshDayPrevClose(instrument: Instrument) {
  void getYahooQuote(instrument)
    .then((q) => {
      if (q?.previous_close && q.previous_close > 0) {
        dayPrevClose.set(instrument, q.previous_close)
      }
    })
    .catch(() => {})
}

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

    const headers = {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    }

    // OANDA first — matches TradingView OANDA CFD tip; do not await Yahoo here
    const oanda = await getOandaPrice(instrument)
    if (oanda?.price && oanda.price > 0) {
      const prev = dayPrevClose.get(instrument)
      if (!prev) refreshDayPrevClose(instrument)
      else if (Math.random() < 0.02) refreshDayPrevClose(instrument) // occasional refresh

      const previous_close = prev ?? oanda.price
      const change = oanda.price - previous_close
      const change_pct = previous_close ? (change / previous_close) * 100 : 0

      return NextResponse.json(
        {
          instrument,
          source: 'oanda',
          price: oanda.price,
          bid: oanda.bid,
          ask: oanda.ask,
          change,
          change_pct,
          previous_close,
          timestamp: oanda.timestamp,
        },
        { headers }
      )
    }

    const quote = await getYahooQuote(instrument)
    if (!quote) {
      return NextResponse.json(
        { error: 'No quote', instrument, price: null },
        { status: 200, headers }
      )
    }

    if (quote.previous_close > 0) {
      dayPrevClose.set(instrument, quote.previous_close)
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
      { headers }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote fetch failed'
    console.error('[quote]', message)
    return NextResponse.json({ error: message, price: null }, { status: 500 })
  }
}
