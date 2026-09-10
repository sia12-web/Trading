/**
 * GET /api/trading/context-55?instrument=DOW|NASDAQ|GOLD|CRUDE
 * Sourcing 5-Month Anchored VWAP reference benchmark from genuine CME Globex daily bars.
 */

import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getCmeDailyBars } from '@/lib/databento/cmeHistorical'
import { mergeCandleSeries, type DatabentoCandle } from '@/lib/databento/client'
import { getYahooCandlesRange } from '@/lib/yahoo/candles'
import {
  compute5MonthAnchoredVwapFromDailyBars,
  type ContextBar,
} from '@/lib/chart/context55'
import {
  invalidateContext55Cache,
  readContext55Cache,
  writeContext55Cache,
} from '@/lib/chart/context55Cache'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

    const refresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true'
    if (refresh) invalidateContext55Cache(instrument)

    const cached = readContext55Cache(instrument)
    const now = Date.now()
    if (!refresh && cached && now - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({
        ok: true,
        instrument,
        avwap5m: cached.benchmark,
        dailyBars: cached.dailyBars,
        cached: true,
        source: cached.source,
      })
    }

    let dailyBars = getCmeDailyBars(instrument)
    let source: 'cme_globex' | 'yahoo_cme' = 'cme_globex'
    try {
      const nowSec = Math.floor(Date.now() / 1000)
      const yahoo = await getYahooCandlesRange(
        instrument,
        'D',
        nowSec - 160 * 24 * 3600,
        nowSec
      )
      if (yahoo?.candles?.length) {
        dailyBars = mergeCandleSeries(
          (dailyBars || []) as DatabentoCandle[],
          yahoo.candles as DatabentoCandle[]
        ) as ContextBar[]
        if (!getCmeDailyBars(instrument)?.length) source = 'yahoo_cme'
      }
    } catch {
      /* archive-only fallback */
    }

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

    const slimDaily: ContextBar[] = dailyBars
      .filter((b) => b.time >= (benchmark.anchorUnix ?? 0) - 86400)
      .map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }))

    writeContext55Cache(instrument, {
      benchmark,
      dailyBars: slimDaily,
      source,
      timestamp: now,
    })

    return NextResponse.json({
      ok: true,
      instrument,
      avwap5m: benchmark,
      dailyBars: slimDaily,
      cached: false,
      source,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
