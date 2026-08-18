/**
 * GET /api/trading/quote?instrument=DOW
 * CME last (MYM / MNQ / NKD) first so the tip matches Tradovate IB; OANDA+basis if needed.
 */

import { NextResponse } from 'next/server'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { applyCmeBasis, cmeBasisFromPair } from '@/lib/trading/cmeBasis'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  isChartStreamAllowed,
  isLiveDeskInstrument,
} from '@/lib/trading/sessionGate'
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
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    // Focus window only (open − 30m → cash close) — no overnight/pre-focus OANDA burn
    const stream = isChartStreamAllowed(instrument)
    if (!stream.open) {
      return NextResponse.json(
        { error: stream.reason, instrument, price: null, frozen: true },
        { status: 200, headers }
      )
    }

    // CME last first (Tradovate scale). If OANDA is faster, shift it by the live basis.
    const [yahoo, oanda] = await Promise.all([
      getYahooQuote(instrument),
      getOandaPrice(instrument),
    ])

    if (yahoo?.price && yahoo.price > 0) {
      const basis = oanda?.price
        ? cmeBasisFromPair(oanda.price, yahoo.price)
        : null
      const price =
        oanda?.price && basis != null
          ? applyCmeBasis(oanda.price, basis)
          : yahoo.price
      if (yahoo.previous_close > 0) {
        dayPrevClose.set(instrument, yahoo.previous_close)
      }
      const previous_close =
        dayPrevClose.get(instrument) ?? yahoo.previous_close ?? price
      const change = price - previous_close
      const change_pct = previous_close ? (change / previous_close) * 100 : 0

      return NextResponse.json(
        {
          instrument,
          source: 'cme',
          price,
          bid: oanda?.bid && basis != null ? applyCmeBasis(oanda.bid, basis) : undefined,
          ask: oanda?.ask && basis != null ? applyCmeBasis(oanda.ask, basis) : undefined,
          change,
          change_pct,
          previous_close,
          timestamp: oanda?.timestamp ?? yahoo.timestamp,
        },
        { headers }
      )
    }

    if (oanda?.price && oanda.price > 0) {
      const prev = dayPrevClose.get(instrument)
      if (!prev) refreshDayPrevClose(instrument)
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

    return NextResponse.json(
      { error: 'No quote', instrument, price: null },
      { status: 200, headers }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote fetch failed'
    console.error('[quote]', message)
    return NextResponse.json({ error: message, price: null }, { status: 500 })
  }
}
