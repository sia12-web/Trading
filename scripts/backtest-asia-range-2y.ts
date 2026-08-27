/**
 * 2-year M5 replay of the locked Asia recipes on DOW and GOLD.
 * Dow: range < 80, buffer 20, MYM. Gold: range < 60, buffer 10, MGC.
 *
 * Run: npx tsx scripts/backtest-asia-range-2y.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  runAsiaRangeBacktest,
  summarizeAsiaTrades,
  type AsiaBar,
  type AsiaInstrument,
  type AsiaSummary,
  type AsiaTrade,
} from '../lib/trading/asiaRangeSignals'
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

const OUT_DIR = join(process.cwd(), 'bots', 'data', 'asia-range')
const TWO_YEAR_SEC = 730 * 24 * 3600
const CHUNK_SEC = 4 * 24 * 3600
const SPLIT = '2025-08-27'
const LAST6 = '2026-02-27'

type OandaJson = {
  candles?: Array<{
    time: string
    volume?: number
    mid?: { o: string; h: string; l: string; c: string }
  }>
}

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

function er(n: number | null): string {
  return n == null ? '—' : n.toFixed(3)
}

function printSummary(label: string, s: AsiaSummary) {
  console.log(
    [
      label.padEnd(18),
      `n ${s.trades}`.padEnd(8),
      `W/L/F ${s.wins}/${s.losses}/${s.flatten}`.padEnd(18),
      `win ${pct(s.winRate)}`.padEnd(12),
      `PnL ${money(s.netPnl)}`.padEnd(12),
      `E[R] ${er(s.expectR)}`.padEnd(12),
      `PF ${pf(s.profitFactor)}`.padEnd(10),
      `DD ${money(-s.maxDrawdown)}`,
    ].join('  ')
  )
}

function dedupe(bars: AsiaBar[]): AsiaBar[] {
  bars.sort((a, b) => a.time - b.time)
  const out: AsiaBar[] = []
  for (const b of bars) {
    const prev = out[out.length - 1]
    if (prev && prev.time === b.time) out[out.length - 1] = b
    else out.push(b)
  }
  return out
}

function span(bars: AsiaBar[]): string {
  if (!bars.length) return 'empty'
  const t0 = new Date(bars[0]!.time * 1000).toISOString().slice(0, 10)
  const t1 = new Date(bars[bars.length - 1]!.time * 1000).toISOString().slice(0, 10)
  return `${t0} → ${t1}`
}

function exitMix(trades: AsiaTrade[]) {
  const tp = trades.filter((t) => t.exitReason === 'take_profit')
  const sl = trades.filter((t) => t.exitReason === 'stop_hit' || t.exitReason === 'two_way')
  const flat = trades.filter((t) => t.exitReason === 'flatten_1130')
  const sum = (a: AsiaTrade[]) => a.reduce((s, t) => s + t.pnl, 0)
  const sumR = (a: AsiaTrade[]) => a.reduce((s, t) => s + t.rMultiple, 0)
  const resolved = trades.filter((t) => t.exitReason !== 'flatten_1130')
  return {
    takeProfit: { n: tp.length, pnl: sum(tp), sumR: sumR(tp) },
    stop: { n: sl.length, pnl: sum(sl), sumR: sumR(sl) },
    flatten: { n: flat.length, pnl: sum(flat), sumR: sumR(flat) },
    resolved: {
      n: resolved.length,
      pnl: sum(resolved),
      expectR: resolved.length ? sumR(resolved) / resolved.length : null,
    },
  }
}

function printMix(label: string, trades: AsiaTrade[]) {
  const m = exitMix(trades)
  console.log(
    `  ${label} mix  TP ${m.takeProfit.n} ${money(m.takeProfit.pnl)}  SL ${m.stop.n} ${money(m.stop.pnl)}  flat ${m.flatten.n} ${money(m.flatten.pnl)}  resolved n=${m.resolved.n} E[R] ${er(m.resolved.expectR)}`
  )
}

async function fetchOandaChunk(symbol: string, fromUnix: number, toUnix: number): Promise<AsiaBar[]> {
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
    throw new Error(`${symbol} OANDA HTTP ${res.status} ${text.slice(0, 160)}`)
  }
  const json = (await res.json()) as OandaJson
  const bars: AsiaBar[] = []
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

async function loadTwoYear(inst: AsiaInstrument): Promise<{ symbol: string; bars: AsiaBar[] }> {
  const symbol = OANDA_INSTRUMENTS[inst]
  if (!symbol) throw new Error(`no OANDA symbol for ${inst}`)
  const cachePath = join(OUT_DIR, `oanda-${inst}-2y.json`)
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as { symbol: string; bars: AsiaBar[] }
    const spanDays =
      cached.bars?.length > 2
        ? (cached.bars[cached.bars.length - 1]!.time - cached.bars[0]!.time) / 86400
        : 0
    if (cached.bars?.length > 20_000 && spanDays >= 650) {
      console.log(`  ${inst} cache ${cached.bars.length} bars  ${span(cached.bars)}  (${spanDays.toFixed(0)}d)`)
      return cached
    }
  }
  if (!isOandaConfigured()) throw new Error('OANDA not configured')
  const now = Math.floor(Date.now() / 1000)
  const start = now - TWO_YEAR_SEC
  const all: AsiaBar[] = []
  let chunks = 0
  for (let p1 = start; p1 < now; p1 += CHUNK_SEC) {
    const p2 = Math.min(p1 + CHUNK_SEC, now)
    try {
      const chunk = await fetchOandaChunk(symbol, p1, p2)
      all.push(...chunk)
      chunks += 1
      if (chunks % 20 === 0) {
        console.log(`  ${inst} fetched ${chunks} chunks, ${all.length} bars, last ${new Date(p2 * 1000).toISOString().slice(0, 10)}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`  ${inst} chunk ${new Date(p1 * 1000).toISOString().slice(0, 10)}: ${msg}`)
    }
    await new Promise((r) => setTimeout(r, 70))
  }
  const bars = dedupe(all)
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(cachePath, JSON.stringify({ symbol, bars }))
  console.log(`  ${inst} wrote ${cachePath}  ${bars.length} bars  ${span(bars)}`)
  return { symbol, bars }
}

function splitTrades(trades: AsiaTrade[], split: string) {
  const older = trades.filter((t) => t.date < split)
  const newer = trades.filter((t) => t.date >= split)
  return { older, newer }
}

function slim(s: AsiaSummary) {
  return {
    trades: s.trades,
    wins: s.wins,
    losses: s.losses,
    flatten: s.flatten,
    winRate: s.winRate,
    netPnl: s.netPnl,
    expectR: s.expectR,
    profitFactor: s.profitFactor,
    maxDrawdown: s.maxDrawdown,
    sumR: s.sumR,
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log('Asia range 2-year locked recipes')
  console.log('Dow: <80, +20/−20, MYM. Gold: <60, +10/−10, MGC. $50k / 1%, 1.5R, flatten 11:30.\n')

  const gold = await loadTwoYear('GOLD')
  const dow = await loadTwoYear('DOW')

  const goldRun = runAsiaRangeBacktest({
    instrument: 'GOLD',
    candles: gold.bars,
    maxRange: 60,
    buffer: 10,
    requireQty: true,
  })
  const dowRun = runAsiaRangeBacktest({
    instrument: 'DOW',
    candles: dow.bars,
    maxRange: 80,
    buffer: 20,
    requireQty: true,
  })

  const goldSplit = splitTrades(goldRun.trades, SPLIT)
  const dowSplit = splitTrades(dowRun.trades, SPLIT)
  const gold6 = goldRun.trades.filter((t) => t.date >= LAST6)
  const dow6 = dowRun.trades.filter((t) => t.date >= LAST6)

  const last6Cut = Math.floor(Date.parse(`${LAST6}T00:00:00.000Z`) / 1000) - 20 * 3600
  const gold6Run = runAsiaRangeBacktest({
    instrument: 'GOLD',
    candles: gold.bars.filter((b) => b.time >= last6Cut),
    maxRange: 60,
    buffer: 10,
    requireQty: true,
  })
  const dow6Run = runAsiaRangeBacktest({
    instrument: 'DOW',
    candles: dow.bars.filter((b) => b.time >= last6Cut),
    maxRange: 80,
    buffer: 20,
    requireQty: true,
  })

  console.log(`\nGOLD ${gold.symbol}  ${gold.bars.length} bars  ${span(gold.bars)}`)
  printSummary('GOLD 2y <60', goldRun.summary)
  printSummary('  LONG', goldRun.bySide.LONG)
  printSummary('  SHORT', goldRun.bySide.SHORT)
  printSummary(`  < ${SPLIT}`, summarizeAsiaTrades(goldSplit.older, 'gold-older'))
  printSummary(`  >= ${SPLIT}`, summarizeAsiaTrades(goldSplit.newer, 'gold-newer'))
  printMix('2y', goldRun.trades)
  printMix(`< ${SPLIT}`, goldSplit.older)
  printMix(`>= ${SPLIT}`, goldSplit.newer)

  console.log(`\nDOW  ${dow.symbol}  ${dow.bars.length} bars  ${span(dow.bars)}`)
  printSummary('DOW 2y <80', dowRun.summary)
  printSummary('  LONG', dowRun.bySide.LONG)
  printSummary('  SHORT', dowRun.bySide.SHORT)
  printSummary(`  < ${SPLIT}`, summarizeAsiaTrades(dowSplit.older, 'dow-older'))
  printSummary(`  >= ${SPLIT}`, summarizeAsiaTrades(dowSplit.newer, 'dow-newer'))
  printMix('2y', dowRun.trades)
  printMix(`< ${SPLIT}`, dowSplit.older)
  printMix(`>= ${SPLIT}`, dowSplit.newer)

  console.log(`\n=== Last 6 months (>= ${LAST6}) ===`)
  console.log(`GOLD 6m  ${gold6Run.bars} bars  ${span(gold.bars.filter((b) => b.time >= last6Cut))}`)
  printSummary('GOLD 6m <60', gold6Run.summary)
  printSummary('  LONG', gold6Run.bySide.LONG)
  printSummary('  SHORT', gold6Run.bySide.SHORT)
  printMix('6m', gold6Run.trades)

  console.log(`DOW  6m  ${dow6Run.bars} bars`)
  printSummary('DOW 6m <80', dow6Run.summary)
  printSummary('  LONG', dow6Run.bySide.LONG)
  printSummary('  SHORT', dow6Run.bySide.SHORT)
  printMix('6m', dow6Run.trades)

  const payload = {
    generatedAt: new Date().toISOString(),
    split: SPLIT,
    last6: LAST6,
    rules: {
      gold: { maxRange: 60, buffer: 10, contract: 'MGC' },
      dow: { maxRange: 80, buffer: 20, contract: 'MYM' },
    },
    gold: {
      symbol: gold.symbol,
      bars: gold.bars.length,
      from: gold.bars[0] ? new Date(gold.bars[0].time * 1000).toISOString() : '',
      to: gold.bars.length ? new Date(gold.bars[gold.bars.length - 1]!.time * 1000).toISOString() : '',
      all: slim(goldRun.summary),
      long: slim(goldRun.bySide.LONG),
      short: slim(goldRun.bySide.SHORT),
      older: slim(summarizeAsiaTrades(goldSplit.older, 'gold-older')),
      newer: slim(summarizeAsiaTrades(goldSplit.newer, 'gold-newer')),
      mix: exitMix(goldRun.trades),
      mixOlder: exitMix(goldSplit.older),
      mixNewer: exitMix(goldSplit.newer),
      last6: slim(gold6Run.summary),
      last6Long: slim(gold6Run.bySide.LONG),
      last6Short: slim(gold6Run.bySide.SHORT),
      mixLast6: exitMix(gold6Run.trades),
      last6From2y: slim(summarizeAsiaTrades(gold6, 'gold-6m-from-2y')),
      trades: goldRun.trades,
    },
    dow: {
      symbol: dow.symbol,
      bars: dow.bars.length,
      from: dow.bars[0] ? new Date(dow.bars[0].time * 1000).toISOString() : '',
      to: dow.bars.length ? new Date(dow.bars[dow.bars.length - 1]!.time * 1000).toISOString() : '',
      all: slim(dowRun.summary),
      long: slim(dowRun.bySide.LONG),
      short: slim(dowRun.bySide.SHORT),
      older: slim(summarizeAsiaTrades(dowSplit.older, 'dow-older')),
      newer: slim(summarizeAsiaTrades(dowSplit.newer, 'dow-newer')),
      mix: exitMix(dowRun.trades),
      mixOlder: exitMix(dowSplit.older),
      mixNewer: exitMix(dowSplit.newer),
      last6: slim(dow6Run.summary),
      last6Long: slim(dow6Run.bySide.LONG),
      last6Short: slim(dow6Run.bySide.SHORT),
      mixLast6: exitMix(dow6Run.trades),
      last6From2y: slim(summarizeAsiaTrades(dow6, 'dow-6m-from-2y')),
      trades: dowRun.trades,
    },
  }

  const outPath = join(OUT_DIR, 'asia-range-2y.json')
  writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`\nWrote ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
