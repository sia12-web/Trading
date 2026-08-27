/**
 * 1-year 5-minute replay of the TradingView "auction" indicator
 * on DOW (MYM), NASDAQ (MNQ), GOLD (MGC), CRUDE (CL).
 *
 * Prefers OANDA M5 (CFD, typically ~1y). Also pulls Yahoo CME 5m
 * as far as Yahoo stores it (~60d) for a same-scale check.
 *
 * Run: npx tsx scripts/backtest-auction-year.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  AUCTION_INSTRUMENTS,
  runAuctionBacktest,
  summarizeAuctionTrades,
  type AuctionBar,
  type AuctionInstrument,
  type AuctionRangeFocus,
  type AuctionSummary,
  type AuctionTrade,
} from '../lib/trading/auctionStrategy'
import { YAHOO_CME_SYMBOLS } from '../lib/yahoo/symbols'
import { OANDA_INSTRUMENTS, oandaBaseUrl, oandaHeaders, isOandaConfigured } from '../lib/oanda/config'

function loadEnvLocal() {
  const p = join(process.cwd(), '.env.local')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    let val = trimmed.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null) process.env[key] = val
  }
}

loadEnvLocal()

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open: number[]
          high: number[]
          low: number[]
          close: number[]
          volume?: number[]
        }>
      }
    }>
    error?: { description?: string }
  }
}

const CACHE_DIR = join(process.cwd(), 'bots', 'data', 'auction-year')
const YEAR_SEC = 365 * 24 * 3600
const CHUNK_SEC = 5 * 24 * 3600

function money(n: number): string {
  const abs = Math.abs(n).toFixed(0)
  return n >= 0 ? `+$${abs}` : `-$${abs}`
}

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}

function pf(n: number | null): string {
  if (n == null) return '—'
  if (!Number.isFinite(n)) return '∞'
  return n.toFixed(2)
}

function parseBarsFromYahoo(json: YahooChart): AuctionBar[] {
  const result = json.chart?.result?.[0]
  if (!result) return []
  const timestamps = result.timestamp || []
  const quote = result.indicators?.quote?.[0]
  if (!quote) return []
  const bars: AuctionBar[] = []
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

function dedupe(bars: AuctionBar[]): AuctionBar[] {
  bars.sort((a, b) => a.time - b.time)
  const out: AuctionBar[] = []
  for (const b of bars) {
    const prev = out[out.length - 1]
    if (prev && prev.time === b.time) out[out.length - 1] = b
    else out.push(b)
  }
  return out
}

async function fetchYahooChunk(symbol: string, period1: number, period2: number): Promise<AuctionBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&includePrePost=true&period1=${period1}&period2=${period2}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradePulseAuctionBacktest/1.0)',
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`${symbol} Yahoo HTTP ${res.status}`)
  return parseBarsFromYahoo((await res.json()) as YahooChart)
}

async function loadYahoo5m(inst: AuctionInstrument): Promise<{ symbol: string; bars: AuctionBar[] }> {
  const symbols = [YAHOO_CME_SYMBOLS[inst], inst === 'DOW' ? 'YM=F' : inst === 'NASDAQ' ? 'NQ=F' : inst === 'GOLD' ? 'GC=F' : 'CL=F']
  const now = Math.floor(Date.now() / 1000)
  const start = now - YEAR_SEC
  let lastErr: Error | null = null
  for (const symbol of symbols) {
    const all: AuctionBar[] = []
    try {
      for (let p1 = start; p1 < now; p1 += 50 * 86400) {
        const p2 = Math.min(p1 + 50 * 86400, now)
        const chunk = await fetchYahooChunk(symbol, p1, p2)
        all.push(...chunk)
        await new Promise((r) => setTimeout(r, 120))
      }
      const bars = dedupe(all)
      if (bars.length >= 200) return { symbol, bars }
      lastErr = new Error(`${symbol} only ${bars.length} bars`)
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw lastErr || new Error(`no Yahoo bars for ${inst}`)
}

type OandaJson = {
  candles?: Array<{
    time: string
    volume?: number
    complete?: boolean
    mid?: { o: string; h: string; l: string; c: string }
  }>
}

async function fetchOandaChunk(symbol: string, fromUnix: number, toUnix: number): Promise<AuctionBar[]> {
  const rfc = (u: number) => new Date(u * 1000).toISOString().replace(/\.\d{3}Z$/, '.000000000Z')
  const params = new URLSearchParams({
    granularity: 'M5',
    price: 'M',
    from: rfc(fromUnix),
    to: rfc(toUnix),
  })
  const url = `${oandaBaseUrl()}/v3/instruments/${symbol}/candles?${params}`
  const res = await fetch(url, { headers: oandaHeaders() })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${symbol} OANDA HTTP ${res.status} ${text.slice(0, 120)}`)
  }
  const json = (await res.json()) as OandaJson
  const bars: AuctionBar[] = []
  for (const c of json.candles || []) {
    const mid = c.mid
    if (!mid) continue
    const t = Math.floor(new Date(c.time).getTime() / 1000)
    const o = parseFloat(mid.o)
    const h = parseFloat(mid.h)
    const l = parseFloat(mid.l)
    const cl = parseFloat(mid.c)
    if (![t, o, h, l, cl].every(Number.isFinite) || !(h >= l)) continue
    bars.push({ time: t, open: o, high: h, low: l, close: cl, volume: Number(c.volume) || 0 })
  }
  return bars
}

async function loadOanda5m(inst: AuctionInstrument): Promise<{ symbol: string; bars: AuctionBar[] }> {
  const symbol = OANDA_INSTRUMENTS[inst]
  if (!symbol) throw new Error(`no OANDA symbol for ${inst}`)
  const cachePath = join(CACHE_DIR, `oanda-${inst}.json`)
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as { symbol: string; bars: AuctionBar[] }
    if (cached.bars?.length > 1000) return cached
  }
  const now = Math.floor(Date.now() / 1000)
  const start = now - YEAR_SEC
  const all: AuctionBar[] = []
  for (let p1 = start; p1 < now; p1 += CHUNK_SEC) {
    const p2 = Math.min(p1 + CHUNK_SEC, now)
    try {
      const chunk = await fetchOandaChunk(symbol, p1, p2)
      all.push(...chunk)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`  ${inst} OANDA chunk ${new Date(p1 * 1000).toISOString().slice(0, 10)}: ${msg}`)
    }
    await new Promise((r) => setTimeout(r, 80))
  }
  const bars = dedupe(all)
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(cachePath, JSON.stringify({ symbol, bars }))
  return { symbol, bars }
}

function printSummary(label: string, s: AuctionSummary) {
  console.log(
    [
      label.padEnd(12),
      `n ${s.trades}`.padEnd(8),
      `W/L/EOD ${s.wins}/${s.losses}/${s.eod}`.padEnd(20),
      `win ${pct(s.winRate)}`.padEnd(12),
      `PnL ${money(s.netPnl)}`.padEnd(12),
      `E[R] ${s.expectR == null ? '—' : s.expectR.toFixed(2)}`.padEnd(12),
      `PF ${pf(s.profitFactor)}`.padEnd(10),
      `DD ${money(-s.maxDrawdown)}`,
    ].join('  ')
  )
}

function spanDays(bars: AuctionBar[]): string {
  if (!bars.length) return 'empty'
  const t0 = new Date(bars[0]!.time * 1000).toISOString().slice(0, 10)
  const t1 = new Date(bars[bars.length - 1]!.time * 1000).toISOString().slice(0, 10)
  return `${t0} → ${t1}`
}

function coverageDays(bars: AuctionBar[]): number {
  if (bars.length < 2) return 0
  return (bars[bars.length - 1]!.time - bars[0]!.time) / 86400
}

type SourceRun = {
  source: 'oanda' | 'yahoo'
  byInstrument: Record<
    string,
    {
      symbol: string
      bars: number
      from: string
      to: string
      coverageDays: number
      result: ReturnType<typeof runAuctionBacktest>
    }
  >
  allTrades: AuctionTrade[]
}

async function runSource(
  source: 'oanda' | 'yahoo',
  loader: (inst: AuctionInstrument) => Promise<{ symbol: string; bars: AuctionBar[] }>
): Promise<SourceRun> {
  const byInstrument: SourceRun['byInstrument'] = {}
  const allTrades: AuctionTrade[] = []
  for (const inst of AUCTION_INSTRUMENTS) {
    const loaded = await loader(inst)
    const result = runAuctionBacktest({ instrument: inst, candles: loaded.bars })
    byInstrument[inst] = {
      symbol: loaded.symbol,
      bars: loaded.bars.length,
      from: loaded.bars[0] ? new Date(loaded.bars[0].time * 1000).toISOString() : '',
      to: loaded.bars.length
        ? new Date(loaded.bars[loaded.bars.length - 1]!.time * 1000).toISOString()
        : '',
      coverageDays: coverageDays(loaded.bars),
      result,
    }
    allTrades.push(...result.trades)
    console.log(
      `  ${inst.padEnd(8)} ${loaded.symbol.padEnd(12)} ${String(loaded.bars.length).padStart(6)} bars  ${spanDays(loaded.bars)}  trades ${result.trades.length}`
    )
    printSummary(inst, result.summary)
    printSummary('  LONG', result.bySide.LONG)
    printSummary('  SHORT', result.bySide.SHORT)
    for (const rng of ['15M', '30M', 'IB'] as AuctionRangeFocus[]) {
      printSummary(`  ${rng}`, result.byRange[rng])
    }
    console.log('')
  }
  return { source, byInstrument, allTrades }
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true })
  console.log('Auction sequential absorb-breakout — 5m close, 1% of $50k, max 3/day, flatten 16:00 ET')
  console.log('Windows: 15M 09:45-10:00 → 30M 10:00-10:30 → IB 10:30-11:30. Fake tail + VWAP/EMA20, TP 1.5R')
  console.log('Same-bar SL+TP counts as stop. One position at a time.\n')

  const runs: SourceRun[] = []

  if (isOandaConfigured()) {
    console.log('=== OANDA M5 (US30 / NAS100 / XAU / WTICO) — target 365d ===')
    runs.push(await runSource('oanda', loadOanda5m))
  } else {
    console.log('OANDA not configured — skipping year CFD series\n')
  }

  if (process.env.AUCTION_INCLUDE_YAHOO === '1') {
    console.log('=== Yahoo CME 5m (MYM=F / MNQ=F / MGC=F / CL=F) — Yahoo typically ~60d ===')
    try {
      runs.push(await runSource('yahoo', loadYahoo5m))
    } catch (e) {
      console.warn('Yahoo load failed:', e instanceof Error ? e.message : e)
    }
  }

  if (!runs.length) {
    console.error('No data loaded.')
    process.exit(1)
  }

  const primary = runs.reduce((a, b) => {
    const aDays = Math.min(...Object.values(a.byInstrument).map((x) => x.coverageDays))
    const bDays = Math.min(...Object.values(b.byInstrument).map((x) => x.coverageDays))
    return bDays > aDays ? b : a
  })

  const combined = summarizeAuctionTrades(primary.allTrades, 'ALL')
  const bySide = {
    LONG: summarizeAuctionTrades(
      primary.allTrades.filter((t) => t.side === 'LONG'),
      'LONG'
    ),
    SHORT: summarizeAuctionTrades(
      primary.allTrades.filter((t) => t.side === 'SHORT'),
      'SHORT'
    ),
  }
  const byRange = {
    '15M': summarizeAuctionTrades(
      primary.allTrades.filter((t) => t.rangeFocus === '15M'),
      '15M'
    ),
    '30M': summarizeAuctionTrades(
      primary.allTrades.filter((t) => t.rangeFocus === '30M'),
      '30M'
    ),
    IB: summarizeAuctionTrades(
      primary.allTrades.filter((t) => t.rangeFocus === 'IB'),
      'IB'
    ),
  }

  console.log(`\n=== Combined ${primary.source.toUpperCase()} (all four markets) ===`)
  printSummary('ALL', combined)
  printSummary('LONG', bySide.LONG)
  printSummary('SHORT', bySide.SHORT)
  printSummary('15M', byRange['15M'])
  printSummary('30M', byRange['30M'])
  printSummary('IB', byRange.IB)

  const ranked = [bySide.LONG, bySide.SHORT, byRange['15M'], byRange['30M'], byRange.IB].sort(
    (a, b) => b.netPnl - a.netPnl
  )

  const payload = {
    generatedAt: new Date().toISOString(),
    engine: 'absorb_breakout_v2',
    primarySource: primary.source,
    accountSize: 50000,
    riskPct: 1,
    rr: 1.5,
    maxDaily: 3,
    combined,
    bySide,
    byRange,
    ranked: ranked.map((s) => s.key),
    runs: runs.map((r) => ({
      source: r.source,
      combined: summarizeAuctionTrades(r.allTrades, 'ALL'),
      bySide: {
        LONG: summarizeAuctionTrades(
          r.allTrades.filter((t) => t.side === 'LONG'),
          'LONG'
        ),
        SHORT: summarizeAuctionTrades(
          r.allTrades.filter((t) => t.side === 'SHORT'),
          'SHORT'
        ),
      },
      byRange: {
        '15M': summarizeAuctionTrades(
          r.allTrades.filter((t) => t.rangeFocus === '15M'),
          '15M'
        ),
        '30M': summarizeAuctionTrades(
          r.allTrades.filter((t) => t.rangeFocus === '30M'),
          '30M'
        ),
        IB: summarizeAuctionTrades(
          r.allTrades.filter((t) => t.rangeFocus === 'IB'),
          'IB'
        ),
      },
      instruments: Object.fromEntries(
        Object.entries(r.byInstrument).map(([k, v]) => [
          k,
          {
            symbol: v.symbol,
            bars: v.bars,
            from: v.from,
            to: v.to,
            coverageDays: v.coverageDays,
            summary: v.result.summary,
            bySide: v.result.bySide,
            byRange: v.result.byRange,
            trades: v.result.trades,
          },
        ])
      ),
    })),
  }

  const outPath = join(CACHE_DIR, 'auction-year-results.json')
  writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`\nWrote ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
