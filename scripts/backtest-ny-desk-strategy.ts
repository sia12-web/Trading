/**
 * Replay ny_call_legal_band_v1 on Yahoo CME 5m bars (DOW, NASDAQ, GOLD, CRUDE).
 * No simulated prices or win rates — computeDeskCall + ticket geometry only.
 *
 * Run: npx tsx scripts/backtest-ny-desk-strategy.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { YAHOO_CME_SYMBOLS } from '../lib/yahoo/symbols'
import {
  NY_BACKTEST_INSTRUMENTS,
  runNyDeskBoardBacktest,
  runNyDeskInstrumentBacktest,
  summarizeNyBacktestTrades,
  type NyBacktestBar,
  type NyBacktestInstrument,
  type NyBacktestSummary,
  type NyBacktestTrade,
} from '../lib/trading/nyDeskBacktest'

const YAHOO_CACHE = join(process.cwd(), 'tmp-ny-desk-yahoo-5m.json')

type YahooCacheFile = {
  fetchedAt: string
  instruments: Record<NyBacktestInstrument, { symbol: string; bars: NyBacktestBar[] }>
}

const FALLBACK: Record<NyBacktestInstrument, string[]> = {
  DOW: [YAHOO_CME_SYMBOLS.DOW, 'YM=F'],
  NASDAQ: [YAHOO_CME_SYMBOLS.NASDAQ, 'NQ=F'],
  GOLD: [YAHOO_CME_SYMBOLS.GOLD, 'GC=F'],
  CRUDE: [YAHOO_CME_SYMBOLS.CRUDE, 'CL=F'],
}

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: { quote?: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume?: number[] }> }
    }>
    error?: { description?: string }
  }
}

async function fetchYahoo5m(symbol: string, range: string): Promise<NyBacktestBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&includePrePost=true&range=${range}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradePulseBacktest/1.0)',
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`${symbol} HTTP ${res.status} range=${range}`)
  const json = (await res.json()) as YahooChart
  const result = json.chart?.result?.[0]
  if (!result) {
    throw new Error(`${symbol} ${json.chart?.error?.description || 'no chart result'}`)
  }
  const timestamps = result.timestamp || []
  const quote = result.indicators?.quote?.[0]
  if (!quote) return []
  const bars: NyBacktestBar[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i]!
    const o = quote.open[i]
    const h = quote.high[i]
    const l = quote.low[i]
    const c = quote.close[i]
    if (o == null || h == null || l == null || c == null) continue
    if (!(h >= l)) continue
    bars.push({
      time: t,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: quote.volume?.[i] || 0,
    })
  }
  return bars
}

async function loadInstrument(
  inst: NyBacktestInstrument
): Promise<{ symbol: string; bars: NyBacktestBar[] }> {
  let lastErr: Error | null = null
  for (const symbol of FALLBACK[inst]) {
    for (const range of ['60d', '1mo'] as const) {
      try {
        const bars = await fetchYahoo5m(symbol, range)
        if (bars.length >= 200) return { symbol, bars }
        lastErr = new Error(`${symbol} ${range} only ${bars.length} bars`)
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e))
      }
    }
  }
  throw lastErr || new Error(`no bars for ${inst}`)
}

function money(n: number): string {
  const s = n.toFixed(0)
  return n >= 0 ? `+$${s}` : `-$${s.slice(1)}`
}

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}

function printSummary(label: string, s: NyBacktestSummary) {
  console.log(
    [
      label.padEnd(10),
      `days ${s.days}`.padEnd(10),
      `n ${s.trades}`.padEnd(8),
      `W/L/EOD ${s.wins}/${s.losses}/${s.eod}`.padEnd(18),
      `win ${pct(s.winRate)}`.padEnd(12),
      `PnL ${money(s.netPnl)}`.padEnd(12),
      `E[R] ${s.expectR == null ? '—' : s.expectR.toFixed(2)}`,
    ].join('  ')
  )
}

async function main() {
  console.log('NY desk strategy backtest — Yahoo CME 5m (range 60d / 1mo)')
  console.log('Engine: computeDeskCall + CALL-legal ±10 + SL beyond range + TP 1.5R')
  console.log('Same-bar SL+TP counts as stop (pessimistic). No invented fills.\n')

  const candles = {} as Record<NyBacktestInstrument, NyBacktestBar[]>
  const sources: Record<string, { symbol: string; bars: number }> = {}

  let cache: YahooCacheFile | null = null
  if (existsSync(YAHOO_CACHE)) {
    try {
      const raw = JSON.parse(readFileSync(YAHOO_CACHE, 'utf8')) as YahooCacheFile
      const ok = NY_BACKTEST_INSTRUMENTS.every(
        (i) => (raw.instruments?.[i]?.bars?.length || 0) >= 200
      )
      if (ok) cache = raw
    } catch {
      cache = null
    }
  }

  if (cache) {
    console.log(`Using cached Yahoo bars from ${cache.fetchedAt}`)
    for (const inst of NY_BACKTEST_INSTRUMENTS) {
      const loaded = cache.instruments[inst]
      candles[inst] = loaded.bars
      sources[inst] = { symbol: loaded.symbol, bars: loaded.bars.length }
      const t0 = loaded.bars[0]!.time
      const t1 = loaded.bars[loaded.bars.length - 1]!.time
      console.log(
        `  ${inst.padEnd(8)} ${loaded.symbol.padEnd(8)} ${String(loaded.bars.length).padStart(5)} bars  ${new Date(t0 * 1000).toISOString().slice(0, 10)} → ${new Date(t1 * 1000).toISOString().slice(0, 10)}`
      )
    }
  } else {
    const fetched: YahooCacheFile['instruments'] = {} as YahooCacheFile['instruments']
    for (const inst of NY_BACKTEST_INSTRUMENTS) {
      const loaded = await loadInstrument(inst)
      candles[inst] = loaded.bars
      sources[inst] = { symbol: loaded.symbol, bars: loaded.bars.length }
      fetched[inst] = loaded
      const t0 = loaded.bars[0]!.time
      const t1 = loaded.bars[loaded.bars.length - 1]!.time
      console.log(
        `  ${inst.padEnd(8)} ${loaded.symbol.padEnd(8)} ${String(loaded.bars.length).padStart(5)} bars  ${new Date(t0 * 1000).toISOString().slice(0, 10)} → ${new Date(t1 * 1000).toISOString().slice(0, 10)}`
      )
    }
    writeFileSync(
      YAHOO_CACHE,
      JSON.stringify({ fetchedAt: new Date().toISOString(), instruments: fetched })
    )
    console.log(`Cached Yahoo bars → ${YAHOO_CACHE}`)
  }

  const LAST = 20
  const runOpts = { lastSessions: LAST as number }

  function packIndependent(
    rows: Record<string, ReturnType<typeof runNyDeskInstrumentBacktest>>
  ) {
    return Object.fromEntries(
      NY_BACKTEST_INSTRUMENTS.map((i) => [
        i,
        { summary: rows[i]!.summary, trades: rows[i]!.trades.map(slimTrade) },
      ])
    )
  }

  function threeName(rows: Record<string, ReturnType<typeof runNyDeskInstrumentBacktest>>) {
    const trades = ['DOW', 'NASDAQ', 'GOLD'].flatMap((i) => rows[i]!.trades)
    return summarizeNyBacktestTrades(trades, { instrument: 'DOW+NASDAQ+GOLD' })
  }

  console.log('\n=== 20 NY sessions — baseline (stay-out OFF) ===')
  console.log('Independent book (own 3 fills / 2 stops per name)')
  const baseInd: Record<string, ReturnType<typeof runNyDeskInstrumentBacktest>> = {}
  for (const inst of NY_BACKTEST_INSTRUMENTS) {
    baseInd[inst] = runNyDeskInstrumentBacktest({
      instrument: inst,
      candles: candles[inst],
      stayOutEnabled: false,
      ...runOpts,
    })
    printSummary(inst, baseInd[inst].summary)
  }
  const baseThree = threeName(baseInd)
  printSummary('3-NAME', baseThree)

  console.log('\nShared NY board — baseline')
  const baseBoard = runNyDeskBoardBacktest({
    candles,
    stayOutEnabled: false,
    ...runOpts,
  })
  printSummary('BOARD', baseBoard.summary)

  console.log('\n=== 20 NY sessions — stay-out ON ===')
  console.log('Independent book')
  const outInd: Record<string, ReturnType<typeof runNyDeskInstrumentBacktest>> = {}
  for (const inst of NY_BACKTEST_INSTRUMENTS) {
    outInd[inst] = runNyDeskInstrumentBacktest({
      instrument: inst,
      candles: candles[inst],
      stayOutEnabled: true,
      ...runOpts,
    })
    printSummary(inst, outInd[inst].summary)
  }
  const outThree = threeName(outInd)
  printSummary('3-NAME', outThree)

  console.log('\nShared NY board — stay-out ON')
  const outBoard = runNyDeskBoardBacktest({
    candles,
    stayOutEnabled: true,
    ...runOpts,
  })
  printSummary('BOARD', outBoard.summary)

  const erDrop =
    baseThree.expectR != null && outThree.expectR != null
      ? baseThree.expectR - outThree.expectR
      : null
  console.log(
    `\nThree-name E[R] drop (baseline − stay-out): ${
      erDrop == null ? '—' : erDrop.toFixed(3)
    }  (ship gate if ≤ 0.10)`
  )

  const payload = {
    strategy: 'ny_call_legal_band_v1',
    stayOut: 'ntrend_nconv_or30',
    source: 'Yahoo Finance 5m CME',
    fetchedAt: new Date().toISOString(),
    lastSessions: LAST,
    sources,
    notes: [
      'Last 20 NY cash sessions on the cached Yahoo 5m tape.',
      'A/B: stay-out OFF vs ON (NTREND + NCONV CALL WAIT after OR30).',
      'Headline = DOW+NASDAQ+GOLD. Crude ±10 is $10 — footnote only.',
      'Same-bar SL+TP counts as a stop. No invented fills.',
    ],
    baseline: {
      independent: packIndependent(baseInd),
      threeName: baseThree,
      board: { summary: baseBoard.summary, trades: baseBoard.trades.map(slimTrade) },
    },
    stayOutOn: {
      independent: packIndependent(outInd),
      threeName: outThree,
      board: { summary: outBoard.summary, trades: outBoard.trades.map(slimTrade) },
    },
    threeNameExpectRDrop: erDrop,
  }

  const out = join(process.cwd(), 'tmp-ny-desk-stayout-ab.json')
  writeFileSync(out, JSON.stringify(payload, null, 2))
  console.log(`\nWrote ${out}`)
}

function slimTrade(t: NyBacktestTrade) {
  return {
    instrument: t.instrument,
    date: t.date,
    window: t.window,
    side: t.side,
    entry: t.entry,
    stop: t.stop,
    target: t.target,
    exit: t.exit,
    exitReason: t.exitReason,
    pnl: Math.round(t.pnl * 100) / 100,
    r: Math.round(t.rMultiple * 100) / 100,
    contracts: t.contracts,
    risk: t.riskDollars,
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
