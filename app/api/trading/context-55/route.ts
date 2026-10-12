/**
 * GET /api/trading/context-55?instrument=DOW|NASDAQ|GOLD|CRUDE
 * Sourcing 5-Month Anchored VWAP reference benchmark from genuine CME Globex daily bars.
 */

import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getCmeDailyBars } from '@/lib/databento/cmeHistorical'
import { getYahooCandles } from '@/lib/yahoo/candles'
import { deskClockFor } from '@/lib/chart/sessionVwap'
import {
  compute5MonthAnchoredVwapFromDailyBars,
  type AnchoredVwapBenchmark5M,
  type ContextBar,
} from '@/lib/chart/context55'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface CacheEntry {
  benchmark: AnchoredVwapBenchmark5M
  timestamp: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function GET(request: Request) {
  try {
    try {
      await getOrCreateUser(request)
    } catch {
      // Non-blocking in local development / desk feed
    }

    const { searchParams } = new URL(request.url)
    const rawInstrument = (searchParams.get('instrument') || 'DOW').toUpperCase() as Instrument

    const validInstruments: Instrument[] = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE', 'SILVER', 'NIKKEI']
    const instrument = validInstruments.includes(rawInstrument) ? rawInstrument : 'DOW'

    const cached = cache.get(instrument)
    const now = Date.now()
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({
        ok: true,
        instrument,
        avwap5m: cached.benchmark,
        cached: true,
        source: instrument === 'NIKKEI' ? 'yahoo_jp225' : 'cme_globex',
      })
    }

    let dailyBars: ContextBar[] = []
    let source = 'cme_globex'

    if (instrument === 'NIKKEI') {
      const yahoo = await getYahooCandles('NIKKEI', 'D', 180)
      if (yahoo?.candles?.length) {
        dailyBars = yahoo.candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
        source = 'yahoo_jp225'
      }
    } else {
      dailyBars = getCmeDailyBars(instrument)
    }

    if (!dailyBars || dailyBars.length === 0) {
      return NextResponse.json(
        { error: `No historical daily bars returned for ${instrument}` },
        { status: 404 }
      )
    }

    const clock = deskClockFor(instrument)
    const benchmark = compute5MonthAnchoredVwapFromDailyBars(dailyBars, undefined, clock)
    if (!benchmark) {
      return NextResponse.json(
        { error: `Could not calculate 5M AVWAP for ${instrument}` },
        { status: 500 }
      )
    }

    cache.set(instrument, { benchmark, timestamp: now })

    return NextResponse.json({
      ok: true,
      instrument,
      avwap5m: benchmark,
      cached: false,
      source,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
