/**
 * GET /api/trading/context-55?instrument=DOW|NASDAQ|GOLD|CRUDE
 * Sourcing 5-Month Anchored VWAP reference benchmark from daily bars.
 */

import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { YAHOO_CME_SYMBOLS } from '@/lib/yahoo/symbols'
import {
  compute5MonthAnchoredVwapFromDailyBars,
  type ContextBar,
  type AnchoredVwapBenchmark5M,
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
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const rawInstrument = (searchParams.get('instrument') || 'DOW').toUpperCase() as Instrument

    const validInstruments: Instrument[] = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE', 'NIKKEI']
    const instrument = validInstruments.includes(rawInstrument) ? rawInstrument : 'DOW'

    const cached = cache.get(instrument)
    const now = Date.now()
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({
        ok: true,
        instrument,
        avwap5m: cached.benchmark,
        cached: true,
      })
    }

    const symbol = YAHOO_CME_SYMBOLS[instrument] || 'MYM=F'
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=1d&range=6mo`

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradePulse/1.0)',
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch daily candles for ${instrument}` },
        { status: 502 }
      )
    }

    const json = await res.json()
    const result = json?.chart?.result?.[0]
    const timestamps: number[] = result?.timestamp || []
    const quote = result?.indicators?.quote?.[0]

    if (!timestamps.length || !quote) {
      return NextResponse.json(
        { error: `No historical bars returned for ${instrument}` },
        { status: 404 }
      )
    }

    const dailyBars: ContextBar[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open?.[i]
      const high = quote.high?.[i]
      const low = quote.low?.[i]
      const close = quote.close?.[i]
      const volume = quote.volume?.[i] ?? 0
      const time = timestamps[i]!

      if (
        typeof open === 'number' &&
        typeof high === 'number' &&
        typeof low === 'number' &&
        typeof close === 'number' &&
        Number.isFinite(high) &&
        Number.isFinite(low)
      ) {
        dailyBars.push({ time, open, high, low, close, volume })
      }
    }

    const benchmark = compute5MonthAnchoredVwapFromDailyBars(dailyBars)
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
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
