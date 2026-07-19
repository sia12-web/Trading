/**
 * GET /api/trading/candles?instrument=DOW|NASDAQ|NIKKEI&timeframe=5m&days=5
 * All desk indices: OANDA first (incl. JP225 for NIKKEI), Yahoo fallback.
 * Live: full day continuum (morning + afternoon + overnight). Trading stays morning-only.
 * Sim/dated: morning window only.
 */

import { NextResponse } from 'next/server'
import { getYahooCandles, getYahooCandlesRange } from '@/lib/yahoo/candles'
import { getOandaCandles, getOandaCandlesRange } from '@/lib/oanda/candles'
import { getYahooQuote } from '@/lib/yahoo/quote'
import {
  clipAfternoonBars,
  clipAllAfternoonBars,
  isLiveDeskInstrument,
  sessionFor,
} from '@/lib/trading/sessionGate'
import { AVWAP_CANDLE_FETCH_CALENDAR_DAYS } from '@/lib/chart/sessionVwap'
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
    const includeQuote = searchParams.get('quote') !== '0'

    type CandleRow = {
      time: number
      open: number
      high: number
      low: number
      close: number
      volume: number
    }
    let candles: CandleRow[] | null = null
    let source: 'oanda' | 'yahoo' | 'empty' = 'empty'

    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      // Sim / dated: end at lunch so morning session is the visible window
      const endUnix = toUnix(endDate, lh!, lm || 0) + 60
      // Extra lead-in for Tokyo overnight + Yahoo/OANDA gaps
      const leadDays = instrument === 'NIKKEI' ? 3 : 2
      const startUnix =
        endUnix - Math.max(days, 5) * 24 * 3600 - leadDays * 24 * 3600

      const [oanda, yahoo] = await Promise.all([
        getOandaCandlesRange(instrument, resolution, startUnix, endUnix),
        getYahooCandlesRange(instrument, resolution, startUnix, endUnix),
      ])
      if (oanda?.candles?.length) {
        candles = oanda.candles
        source = 'oanda'
      } else if (yahoo?.candles?.length) {
        candles = yahoo.candles
        source = 'yahoo'
      }
      // Sim: strip afternoon on every day (morning replay only)
      if (candles?.length) {
        candles = clipAllAfternoonBars(candles, instrument)
      }
    } else {
      // Live desk: OANDA (US30 / NAS100 / JP225) then Yahoo — same path for all three
      // Floor must cover AVWAP 5-trading-day-prior anchor (weekends truncate `days=5`)
      const fetchDays = Math.max(days, AVWAP_CANDLE_FETCH_CALENDAR_DAYS)
      const [oanda, yahoo] = await Promise.all([
        getOandaCandles(instrument, resolution, fetchDays),
        getYahooCandles(instrument, resolution, fetchDays),
      ])
      if (oanda?.candles?.length) {
        candles = oanda.candles
        source = 'oanda'
      } else if (yahoo?.candles?.length) {
        candles = yahoo.candles
        source = 'yahoo'
      }
      // Live: afternoon included (lunch freeze off); sim still strips via clipAllAfternoonBars
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
    if (includeQuote) {
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
    } else {
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
