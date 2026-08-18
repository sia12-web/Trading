/**
 * Server-side fetches for manage: 5m RVOL volumes + Yahoo ETF options put/call.
 */

import { getOandaCandles } from '@/lib/oanda/candles'
import { getYahooCandles } from '@/lib/yahoo/candles'
import type { Instrument } from '@/types/price-feed'
import {
  computeRvol,
  optionsProxySymbol,
  summarizeOptionsFlow,
  type OptionsFlowSummary,
} from '@/lib/trading/manageSignals'
import {
  structureFromRangeBrief,
  type ManageBookStructure,
} from '@/lib/trading/manageOpenBook'
import { buildRangeLiquidityBrief } from '@/lib/trading/rangeLiquidityBrief'
import {
  deskPlaybookAnalysisMode,
  resolveDeskPlaybookMode,
} from '@/lib/trading/deskPlaybookMode'

export type ManageRvolSnapshot = {
  rvol: number | null
  lastVolume: number | null
  source: string | null
}

function usableVolumes(volumes: number[]): boolean {
  if (volumes.length < 21) return false
  const recent = volumes.slice(-21)
  const nonzero = recent.filter((v) => v > 0).length
  return nonzero >= 10
}

async function volumesFromYahoo(
  instrument: Instrument
): Promise<{ volumes: number[]; source: string } | null> {
  const res = await getYahooCandles(instrument, '5', 5)
  if (!res?.candles?.length) return null
  const volumes = res.candles.map((c) => Number(c.volume) || 0)
  if (!usableVolumes(volumes)) return null
  return { volumes, source: `yahoo:${res.symbol}` }
}

async function volumesFromYahooProxy(
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
): Promise<{ volumes: number[]; source: string } | null> {
  const proxy = optionsProxySymbol(instrument)
  // Reuse Yahoo chart via temporary Instrument map — fetch chart URL directly
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(proxy)}` +
    `?interval=5m&range=5d`
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradePulse/1.0)',
      Accept: 'application/json',
    },
    cache: 'no-store',
  })
  if (!response.ok) return null
  const json = await response.json()
  const timestamps: number[] = json?.chart?.result?.[0]?.timestamp || []
  const quote = json?.chart?.result?.[0]?.indicators?.quote?.[0]
  if (!timestamps.length || !quote) return null
  const volumes: number[] = []
  for (let i = 0; i < timestamps.length; i++) {
    volumes.push(Number(quote.volume?.[i]) || 0)
  }
  if (!usableVolumes(volumes)) return null
  return { volumes, source: `yahoo:${proxy}` }
}

async function volumesFromOanda(
  instrument: Instrument
): Promise<{ volumes: number[]; source: string } | null> {
  const res = await getOandaCandles(instrument, '5', 3)
  if (!res?.candles?.length) return null
  const volumes = res.candles.map((c) => Number(c.volume) || 0)
  if (!usableVolumes(volumes)) return null
  return { volumes, source: `oanda:${res.symbol}` }
}

/** Prefer real ETF volume (proxy), then index Yahoo, then OANDA tick volume. */
export async function fetchManageRvol(
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
): Promise<ManageRvolSnapshot> {
  try {
    const chain = [
      () => volumesFromYahooProxy(instrument),
      () => volumesFromYahoo(instrument as Instrument),
      () => volumesFromOanda(instrument as Instrument),
    ]
    for (const get of chain) {
      const hit = await get()
      if (!hit) continue
      const rvol = computeRvol(hit.volumes)
      if (rvol == null || !(rvol > 0)) continue
      return {
        rvol,
        lastVolume: hit.volumes[hit.volumes.length - 1] ?? null,
        source: hit.source,
      }
    }
  } catch {
    /* optional */
  }
  return { rvol: null, lastVolume: null, source: null }
}

type YahooOptionContract = {
  volume?: number
  openInterest?: number
}

/** Nearest expiry put/call volume + OI on DIA / QQQ / EWJ. */
export async function fetchManageOptionsFlow(
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
): Promise<OptionsFlowSummary | null> {
  const proxy = optionsProxySymbol(instrument)
  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(proxy)}`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradePulse/1.0)',
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!response.ok) return null
    const json = await response.json()
    const result = json?.optionChain?.result?.[0]
    const chain = result?.options?.[0]
    if (!chain) return null
    const calls = (chain.calls || []) as YahooOptionContract[]
    const puts = (chain.puts || []) as YahooOptionContract[]
    if (!calls.length && !puts.length) return null
    return summarizeOptionsFlow(calls, puts, proxy, 'yahoo-options')
  } catch {
    return null
  }
}

/** Range H/L + Opening / Control / CALL vs this open book. Optional — never blocks scoring. */
export async function fetchManageStructure(args: {
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  tip: number
  direction: 'LONG' | 'SHORT'
  now?: Date
}): Promise<ManageBookStructure | null> {
  try {
    const now = args.now ?? new Date()
    const nowUnix = Math.floor(now.getTime() / 1000)
    const playbookMode = resolveDeskPlaybookMode({
      instrument: args.instrument,
      now,
    })
    const analysisMode = deskPlaybookAnalysisMode(playbookMode, args.instrument)
    const [h1, m5Yahoo, m5Oanda] = await Promise.all([
      getYahooCandles(args.instrument as Instrument, '60', 10),
      getYahooCandles(args.instrument as Instrument, '5', 5),
      getOandaCandles(args.instrument as Instrument, '5', 3).catch(() => null),
    ])
    const m5 = m5Yahoo?.candles?.length ? m5Yahoo : m5Oanda
    const h1Bars = (h1?.candles ?? []).map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Math.max(1, c.volume || 0),
    }))
    const m5Bars = (m5?.candles ?? []).map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Math.max(1, c.volume || 0),
    }))
    if (h1Bars.length < 2 || !(args.tip > 0)) return null
    const brief = buildRangeLiquidityBrief({
      instrument: args.instrument,
      candlesH1: h1Bars,
      tip: args.tip,
      nowUnix,
      analysisMode,
      candles5m: m5Bars.length ? m5Bars : undefined,
      bookLocked: true,
    })
    if (!brief) return null
    return structureFromRangeBrief({
      direction: args.direction,
      tip: args.tip,
      brief,
    })
  } catch {
    return null
  }
}
