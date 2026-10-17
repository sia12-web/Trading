import { NextRequest, NextResponse } from 'next/server'
import {
  formatWyckoffMultiTimeframeBriefForLeo,
  generateAndPersistWyckoffReport,
  getPersistedWyckoffMarketState,
  resolveWyckoffMarketSpec,
  type WyckoffCandle,
  type WyckoffInstrument,
} from '@/lib/trading/wyckoff'
import { getCrossMarketVolatility } from '@/lib/trading/crossMarketVolatility'
import { getLiveCrossMarketRadarReport } from '@/lib/trading/crossMarketRadar'
import { YAHOO_SYMBOLS } from '@/lib/yahoo/symbols'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const YAHOO_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

async function fetchYahooChartCandles(
  instrument: WyckoffInstrument,
  interval: '1d' | '30m' | '5m',
  range: string
): Promise<WyckoffCandle[]> {
  const yahooSym = YAHOO_SYMBOLS[instrument] ?? 'MNQ=F'
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSym
  )}?interval=${interval}&range=${range}`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': YAHOO_UA },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    const timestamps: number[] = result?.timestamp ?? []
    const quote = result?.indicators?.quote?.[0] ?? {}
    const opens: Array<number | null> = quote.open ?? []
    const highs: Array<number | null> = quote.high ?? []
    const lows: Array<number | null> = quote.low ?? []
    const closes: Array<number | null> = quote.close ?? []
    const volumes: Array<number | null> = quote.volume ?? []

    const out: WyckoffCandle[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i]
      const o = opens[i]
      const h = highs[i]
      const l = lows[i]
      const c = closes[i]
      const v = volumes[i]
      if (
        t != null &&
        o != null &&
        h != null &&
        l != null &&
        c != null &&
        Number.isFinite(o) &&
        Number.isFinite(h) &&
        Number.isFinite(l) &&
        Number.isFinite(c)
      ) {
        out.push({
          time: t,
          open: Number(o),
          high: Number(h),
          low: Number(l),
          close: Number(c),
          volume: Number.isFinite(v) && v != null ? Number(v) : 0,
          isEstimatedCvd: true,
        })
      }
    }
    return out
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const instrumentParam = searchParams.get('instrument') || 'NASDAQ'
    const spec = resolveWyckoffMarketSpec(instrumentParam)

    const [dailyCandles, m30Candles, m5Candles, vol] = await Promise.all([
      fetchYahooChartCandles(spec.instrument, '1d', '3mo'),
      fetchYahooChartCandles(spec.instrument, '30m', '10d'),
      fetchYahooChartCandles(spec.instrument, '5m', '5d'),
      getCrossMarketVolatility().catch(() => null),
    ])
    const radar = vol
      ? await getLiveCrossMarketRadarReport(vol).catch(() => null)
      : null

    const report = generateAndPersistWyckoffReport({
      instrumentRaw: spec.instrument,
      dailyCandles,
      m30Candles,
      m5Candles,
      dataSource: `${spec.exchange}:${spec.primaryContract} (Yahoo Futures Feed)`,
      crossMarketVolatility: vol,
      marketRadar: radar,
    })

    return NextResponse.json({
      ok: true,
      report,
      leoBrief: formatWyckoffMultiTimeframeBriefForLeo(report),
      persistedState: getPersistedWyckoffMarketState(spec.instrument),
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to evaluate Wyckoff engine' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const instrumentRaw = body?.instrument || 'NASDAQ'
    const spec = resolveWyckoffMarketSpec(instrumentRaw)

    let dailyCandles: WyckoffCandle[] = Array.isArray(body?.dailyCandles)
      ? body.dailyCandles
      : []
    let m30Candles: WyckoffCandle[] = Array.isArray(body?.m30Candles)
      ? body.m30Candles
      : []
    let m5Candles: WyckoffCandle[] = Array.isArray(body?.m5Candles)
      ? body.m5Candles
      : []
    const intradayCandles: WyckoffCandle[] = Array.isArray(body?.intradayCandles)
      ? body.intradayCandles
      : []

    if (
      dailyCandles.length === 0 &&
      m30Candles.length === 0 &&
      m5Candles.length === 0 &&
      intradayCandles.length === 0
    ) {
      ;[dailyCandles, m30Candles, m5Candles] = await Promise.all([
        fetchYahooChartCandles(spec.instrument, '1d', '3mo'),
        fetchYahooChartCandles(spec.instrument, '30m', '10d'),
        fetchYahooChartCandles(spec.instrument, '5m', '5d'),
      ])
    }

    const vol =
      body?.crossMarketVolatility ??
      (await getCrossMarketVolatility().catch(() => null))
    const radar =
      body?.marketRadar ??
      (vol ? await getLiveCrossMarketRadarReport(vol).catch(() => null) : null)

    const report = generateAndPersistWyckoffReport(
      {
        instrumentRaw: spec.instrument,
        dailyCandles,
        m30Candles,
        m5Candles,
        intradayCandles,
        dataSource: body?.dataSource ?? `${spec.exchange}:${spec.primaryContract}`,
        externalObstacles: body?.externalObstacles,
        crossMarketVolatility: vol,
        marketRadar: radar,
      },
      {
        bypassDeduplication: Boolean(body?.bypassDeduplication),
      }
    )

    return NextResponse.json({
      ok: true,
      report,
      leoBrief: formatWyckoffMultiTimeframeBriefForLeo(report),
      persistedState: getPersistedWyckoffMarketState(spec.instrument),
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to evaluate Wyckoff engine' },
      { status: 500 }
    )
  }
}

