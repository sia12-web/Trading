/**
 * GET /api/trading/candles?instrument=DOW|NASDAQ|NIKKEI&timeframe=5m&days=5
 * CME futures first (MYM / MNQ / NKD) so IB matches Tradovate; OANDA CFD fallback.
 * Live: full day continuum (morning + afternoon + overnight). Trading stays morning-only.
 * Sim/dated: full cash session continuum (entries still morning-gated in the UI).
 */

import { NextResponse } from 'next/server'
import { getYahooCandles, getYahooCandlesRange } from '@/lib/yahoo/candles'
import { getOandaCandles, getOandaCandlesRange } from '@/lib/oanda/candles'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { getDayPreviousClose } from '@/lib/yahoo/quote'
import {
  applyCmeBasis,
  applyCmeBasisToCandles,
  getCmeBasis,
  getLastKnownCmeBasis,
  warmCmeBasis,
  CME_BASIS_REFRESH_MS,
} from '@/lib/trading/cmeBasis'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  clipAfternoonBars,
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
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const instrument = (searchParams.get('instrument') || 'DOW') as Instrument
    const timeframe = searchParams.get('timeframe') || '5m'
    // Cap lookback — AVWAP needs ~5 sessions; hard max 14 calendar days
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '5', 10), 1), 14)
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
      // Sim / dated: full cash session (open → close) so afternoon chart keeps printing.
      // Entries stay morning-gated in the sim desk UI — not by truncating candles.
      const [ch, cm] = sess.marketClose.split(':').map(Number)
      const endUnix = toUnix(endDate, ch!, cm || 0) + 60
      // Extra lead-in for Tokyo overnight + Yahoo/OANDA gaps
      const leadDays = instrument === 'NIKKEI' ? 3 : 2
      const startUnix =
        endUnix - Math.max(days, 5) * 24 * 3600 - leadDays * 24 * 3600

      const [yahoo, oanda] = await Promise.all([
        getYahooCandlesRange(instrument, resolution, startUnix, endUnix),
        getOandaCandlesRange(instrument, resolution, startUnix, endUnix),
      ])
      if (yahoo?.candles?.length) {
        candles = yahoo.candles
        source = 'yahoo'
      } else if (oanda?.candles?.length) {
        candles = oanda.candles
        source = 'oanda'
      }
      // Keep afternoon bars on the replay day (and priors) — matches live continuum
    } else {
      // Live desk: CME futures (MYM / MNQ / NKD) then OANDA CFD if Yahoo is dark
      // Floor must cover AVWAP 5-trading-day-prior anchor (weekends truncate `days=5`)
      const fetchDays = Math.max(days, AVWAP_CANDLE_FETCH_CALENDAR_DAYS)
      const [yahoo, oanda] = await Promise.all([
        getYahooCandles(instrument, resolution, fetchDays),
        getOandaCandles(instrument, resolution, fetchDays),
      ])
      if (yahoo?.candles?.length) {
        candles = yahoo.candles
        source = 'yahoo'
      } else if (oanda?.candles?.length) {
        // CFD bars must share the live-tip (CME) scale or ±10 entries miss the range.
        if (getCmeBasis(instrument) == null && getLastKnownCmeBasis(instrument) == null) {
          await warmCmeBasis(instrument)
        }
        const basis =
          getCmeBasis(instrument) ?? getLastKnownCmeBasis(instrument)
        candles = applyCmeBasisToCandles(oanda.candles, basis)
        source = 'oanda'
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
        // Live tip on CME scale (same path as /quote) so painted ±10 bands
        // and the streaming last share one book. Delayed Yahoo last is not a tip.
        const o = await getOandaPrice(instrument)
        const basis =
          getCmeBasis(instrument) ?? getLastKnownCmeBasis(instrument)
        if (!endDate && (basis == null || getCmeBasis(instrument, CME_BASIS_REFRESH_MS) == null)) {
          void warmCmeBasis(instrument)
        }
        if (!endDate && o?.price && o.price > 0) {
          const price = applyCmeBasis(o.price, basis)
          const previous_close = getDayPreviousClose(instrument) ?? price
          const change = price - previous_close
          quote = {
            price,
            change,
            change_pct: previous_close ? (change / previous_close) * 100 : 0,
            previous_close,
          }
        }
        if (!quote) {
          const last = candles[candles.length - 1]!
          quote = { price: last.close, change: 0, change_pct: 0 }
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
