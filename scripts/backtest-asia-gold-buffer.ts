/**
 * Gold Asia buffer sweep — how far past the 02:00 high/low to place stops.
 * Run: npx tsx scripts/backtest-asia-gold-buffer.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  runAsiaRangeBacktest,
  type AsiaBar,
  type AsiaSummary,
} from '../lib/trading/asiaRangeSignals'

const CACHE = join(process.cwd(), 'bots', 'data', 'auction-year', 'oanda-GOLD.json')
const OUT = join(process.cwd(), 'bots', 'data', 'asia-range', 'asia-gold-buffer.json')

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
      label.padEnd(22),
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
  }
}

function main() {
  if (!existsSync(CACHE)) throw new Error(`Missing ${CACHE}`)
  const gold = JSON.parse(readFileSync(CACHE, 'utf8')) as { symbol: string; bars: AsiaBar[] }
  mkdirSync(join(process.cwd(), 'bots', 'data', 'asia-range'), { recursive: true })

  const maxRange = 60
  const buffers = [5, 8, 10, 12, 15, 20, 25, 30]
  const symmetric: Array<{
    buffer: number
    summary: AsiaSummary
    long: AsiaSummary
    short: AsiaSummary
    fills: number
    noFill: number
  }> = []

  console.log(`GOLD buffer sweep  maxRange <${maxRange}  ${gold.bars.length} XAU M5 bars`)
  console.log('Stops: buy = Asia high + H, sell = Asia low − L. SL mid. TP 1.5R. Fill by 03:30.\n')

  console.log('=== Symmetric H=L (10 vs 20 is the question) ===')
  for (const buffer of buffers) {
    const run = runAsiaRangeBacktest({
      instrument: 'GOLD',
      candles: gold.bars,
      maxRange,
      buffer,
      requireQty: true,
    })
    const noFill = run.sessions.filter((s) => s.skipReason === 'no_fill').length
    printSummary(`buf ${buffer}`, run.summary)
    printSummary('  LONG', run.bySide.LONG)
    printSummary('  SHORT', run.bySide.SHORT)
    console.log('')
    symmetric.push({
      buffer,
      summary: run.summary,
      long: run.bySide.LONG,
      short: run.bySide.SHORT,
      fills: run.trades.length,
      noFill,
    })
  }

  console.log('=== Asymmetric at <60 — high buffer × low buffer ===')
  const highs = [10, 20]
  const lows = [10, 20]
  const grid: Array<{
    bufferHigh: number
    bufferLow: number
    summary: AsiaSummary
    long: AsiaSummary
    short: AsiaSummary
  }> = []
  for (const bufferHigh of highs) {
    for (const bufferLow of lows) {
      const run = runAsiaRangeBacktest({
        instrument: 'GOLD',
        candles: gold.bars,
        maxRange,
        bufferHigh,
        bufferLow,
        requireQty: true,
      })
      printSummary(`H+${bufferHigh} / L−${bufferLow}`, run.summary)
      printSummary('  LONG', run.bySide.LONG)
      printSummary('  SHORT', run.bySide.SHORT)
      console.log('')
      grid.push({
        bufferHigh,
        bufferLow,
        summary: run.summary,
        long: run.bySide.LONG,
        short: run.bySide.SHORT,
      })
    }
  }

  console.log('=== Same 10 vs 20 buffers at <80 (sanity) ===')
  const at80: Array<{ buffer: number; summary: AsiaSummary; long: AsiaSummary; short: AsiaSummary }> = []
  for (const buffer of [10, 20]) {
    const run = runAsiaRangeBacktest({
      instrument: 'GOLD',
      candles: gold.bars,
      maxRange: 80,
      buffer,
      requireQty: true,
    })
    printSummary(`<80 buf ${buffer}`, run.summary)
    printSummary('  LONG', run.bySide.LONG)
    printSummary('  SHORT', run.bySide.SHORT)
    console.log('')
    at80.push({ buffer, summary: run.summary, long: run.bySide.LONG, short: run.bySide.SHORT })
  }

  const ranked = [...symmetric].filter((r) => r.summary.trades >= 8).sort((a, b) => b.summary.netPnl - a.summary.netPnl)
  const best = ranked[0]
  if (best) {
    console.log(
      `Best symmetric (n>=8) at <60: ${best.buffer} pts  ${money(best.summary.netPnl)}  E[R] ${er(best.summary.expectR)}  PF ${pf(best.summary.profitFactor)}  n=${best.summary.trades}`
    )
  }
  const ten = symmetric.find((s) => s.buffer === 10)
  const twenty = symmetric.find((s) => s.buffer === 20)
  if (ten && twenty) {
    console.log(
      `10 vs 20: ${money(ten.summary.netPnl)} / n=${ten.summary.trades}  vs  ${money(twenty.summary.netPnl)} / n=${twenty.summary.trades}`
    )
    console.log(
      `  shorts 10: ${money(ten.short.netPnl)} E[R] ${er(ten.short.expectR)}   shorts 20: ${money(twenty.short.netPnl)} E[R] ${er(twenty.short.expectR)}`
    )
    console.log(
      `  longs  10: ${money(ten.long.netPnl)} E[R] ${er(ten.long.expectR)}   longs  20: ${money(twenty.long.netPnl)} E[R] ${er(twenty.long.expectR)}`
    )
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    maxRange,
    symmetric: symmetric.map((s) => ({
      buffer: s.buffer,
      fills: s.fills,
      noFill: s.noFill,
      all: slim(s.summary),
      long: slim(s.long),
      short: slim(s.short),
    })),
    grid: grid.map((g) => ({
      bufferHigh: g.bufferHigh,
      bufferLow: g.bufferLow,
      all: slim(g.summary),
      long: slim(g.long),
      short: slim(g.short),
    })),
    at80: at80.map((s) => ({
      buffer: s.buffer,
      all: slim(s.summary),
      long: slim(s.long),
      short: slim(s.short),
    })),
  }
  writeFileSync(OUT, JSON.stringify(payload, null, 2))
  console.log(`\nWrote ${OUT}`)
}

main()
