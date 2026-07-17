/**
 * GET /api/trading/candles?instrument=DOW|NASDAQ|NIKKEI&timeframe=5m&days=5
 * NY indices: OANDA then Yahoo. NIKKEI: Yahoo ^N225.
 * Morning session only (open→lunch). Afternoon bars are never returned —
 * live freezes at lunch; simulation has no afternoon session.
 */

import { NextResponse } from 'next/server'
import { getYahooCandles, getYahooCandlesRange } from '@/lib/yahoo/candles'
import { getOandaCandles, getOandaCandlesRange } from '@/lib/oanda/candles'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { clipAfternoonBars, isLiveDeskInstrument, sessionFor } from '@/lib/trading/sessionGate'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import type { Instrument } from '@/types/price-feed'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const RES_MAP: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1H': '60',
  '4H': '240',
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const instrument = (searchParams.get('instrument') || 'DOW') as Instrument
    const timeframe = searchParams.get('timeframe') || '5m'
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '5', 10), 1), 30)
    const endDate = searchParams.get('date') || searchParams.get('end_date')
    const asOfParam = searchParams.get('as_of')
    const asOf = asOfParam ? parseInt(asOfParam, 10) : null

    if (!isLiveDeskInstrument(instrument)) {
      return NextResponse.json(
        { error: 'Desk chart supports DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    const resolution = RES_MAP[timeframe] || '5'
    const sess = sessionFor(instrument)
    const toUnix = instrument === 'NIKKEI' ? tokyoDateTimeToUnix : nyDateTimeToUnix
    const [lh, lm] = sess.lunchClose.split(':').map(Number)

    let candles: Array<{
      time: number
      open: number
      high: number
      low: number
      close: number
      volume: number
    }> | null = null
    let source: 'oanda' | 'yahoo' | 'empty' = 'empty'

    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      // Sim / dated: end at lunch so morning session is the visible window
      const endUnix = toUnix(endDate, lh!, lm || 0) + 60
      const startUnix = endUnix - Math.max(days, 5) * 24 * 3600 - 2 * 24 * 3600

      if (instrument !== 'NIKKEI') {
        const oanda = await getOandaCandlesRange(instrument, resolution, startUnix, endUnix)
        if (oanda?.candles?.length) {
          candles = oanda.candles
          source = 'oanda'
        }
      }
      if (!candles?.length) {
        const yahoo = await getYahooCandlesRange(instrument, resolution, startUnix, endUnix)
        candles = yahoo?.candles ?? null
        source = candles?.length ? 'yahoo' : 'empty'
      }
      // Morning + overnight only (no afternoon on any day in the window)
      if (candles?.length) {
        candles = clipAfternoonBars(candles, instrument)
      }
    } else {
      if (instrument !== 'NIKKEI') {
        const oanda = await getOandaCandles(instrument, resolution, days)
        if (oanda?.candles?.length) {
          candles = oanda.candles
          source = 'oanda'
        }
      }
      if (!candles?.length) {
        const yahoo = await getYahooCandles(instrument, resolution, days)
        candles = yahoo?.candles ?? null
        source = candles?.length ? 'yahoo' : 'empty'
      }

      // Live: never show afternoon bars (any day). Overnight + morning only.
      if (candles?.length) {
        candles = clipAfternoonBars(candles, instrument)
      }
    }

    if (candles && asOf != null && Number.isFinite(asOf)) {
      candles = candles.filter((c) => c.time <= asOf)
    }

    if (!candles || candles.length === 0) {
      return NextResponse.json(
        {
          error: 'No candle data',
          instrument,
          candles: [],
          source: 'empty',
        },
        {
          status: 200,
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        }
      )
    }

    let quote: {
      price: number
      change: number
      change_pct: number
      previous_close?: number
    } | null = null
    try {
      const q = await getYahooQuote(instrument)
      if (q) {
        quote = {
          price: q.price,
          change: q.change,
          change_pct: q.change_pct,
          previous_close: q.previous_close,
        }
      }
    } catch {
      const last = candles[candles.length - 1]!
      quote = { price: last.close, change: 0, change_pct: 0 }
    }

    return NextResponse.json(
      {
        instrument,
        timeframe,
        source,
        candles: candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
        quote,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Candle fetch failed'
    logger.error('candles.failed', { err: error, message })
    return NextResponse.json({ error: message, candles: [] }, { status: 500 })
  }
}
