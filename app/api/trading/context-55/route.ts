/**
 * GET /api/trading/context-55?instrument=DOW|NASDAQ|GOLD|CRUDE
 * Sourcing 5-Month Anchored VWAP reference benchmark from genuine CME Globex daily bars.
 */

import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getCmeDailyBars } from '@/lib/databento/cmeHistorical'
import {
  compute5MonthAnchoredVwapFromDailyBars,
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
        source: 'cme_globex',
      })
    }

    const dailyBars = getCmeDailyBars(instrument)

    if (!dailyBars || dailyBars.length === 0) {
      return NextResponse.json(
        { error: `No CME historical daily bars returned for ${instrument}` },
        { status: 404 }
      )
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
      source: 'cme_globex',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
