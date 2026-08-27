/**
 * 1-year M5 replay of Asia Range Signals (TradingView AsiaSIG) on GOLD,
 * plus a DOW check at the known <80 filter.
 *
 * Run: npx tsx scripts/backtest-asia-range-gold.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  bucketByRange,
  runAsiaRangeBacktest,
  sweepMaxRange,
  type AsiaBar,
  type AsiaInstrument,
  type AsiaSummary,
} from '../lib/trading/asiaRangeSignals'

const CACHE_DIR = join(process.cwd(), 'bots', 'data', 'auction-year')
const OUT_DIR = join(process.cwd(), 'bots', 'data', 'asia-range')

function loadOanda(inst: AsiaInstrument): { symbol: string; bars: AsiaBar[] } {
  const cachePath = join(CACHE_DIR, `oanda-${inst}.json`)
  if (!existsSync(cachePath)) {
    throw new Error(`Missing ${cachePath}. Run npx tsx scripts/backtest-auction-year.ts first.`)
  }
  const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as { symbol: string; bars: AsiaBar[] }
  if (!cached.bars?.length) throw new Error(`${inst} cache empty`)
  return cached
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
      label.padEnd(16),
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

function span(bars: AsiaBar[]): string {
  if (!bars.length) return 'empty'
  const t0 = new Date(bars[0]!.time * 1000).toISOString().slice(0, 10)
  const t1 = new Date(bars[bars.length - 1]!.time * 1000).toISOString().slice(0, 10)
  return `${t0} → ${t1}`
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const gold = loadOanda('GOLD')
  const dow = loadOanda('DOW')

  console.log('Asia Range Signals — Montreal 20:00–02:00 lock, +buffer stops, SL mid, 1.5R')
  console.log('Fill window 02:00–03:30, flatten 11:30. $50k / 1%. Same-bar two-way = -1R.')
  console.log('Conservative stop-before-TP. GOLD = MGC $10/pt buffer 10. DOW = MYM $0.50/pt buffer 20.\n')

  const goldAll = runAsiaRangeBacktest({
    instrument: 'GOLD',
    candles: gold.bars,
    maxRange: 10_000,
    requireQty: true,
  })
  const dowAll = runAsiaRangeBacktest({
    instrument: 'DOW',
    candles: dow.bars,
    maxRange: 10_000,
    requireQty: true,
  })

  console.log(`GOLD ${gold.symbol}  ${gold.bars.length} bars  ${span(gold.bars)}`)
  console.log(`DOW  ${dow.symbol}  ${dow.bars.length} bars  ${span(dow.bars)}\n`)

  const gp = goldAll.rangePercentiles
  const dp = dowAll.rangePercentiles
  if (gp) {
    console.log(
      `GOLD Asia range  n=${goldAll.sessions.length}  min ${gp.min.toFixed(1)}  p25 ${gp.p25.toFixed(1)}  p50 ${gp.p50.toFixed(1)}  p75 ${gp.p75.toFixed(1)}  p90 ${gp.p90.toFixed(1)}  max ${gp.max.toFixed(1)}`
    )
  }
  if (dp) {
    console.log(
      `DOW  Asia range  n=${dowAll.sessions.length}  min ${dp.min.toFixed(1)}  p25 ${dp.p25.toFixed(1)}  p50 ${dp.p50.toFixed(1)}  p75 ${dp.p75.toFixed(1)}  p90 ${dp.p90.toFixed(1)}  max ${dp.max.toFixed(1)}`
    )
  }

  const goldCaps = [12, 15, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50, 55, 60, 70, 80, 100, 120, 10_000]
  const dowCaps = [40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 10_000]

  console.log('\n=== GOLD max-range sweep (trade only if Asia range < cap) ===')
  const goldSweep = sweepMaxRange(goldAll, goldCaps)
  for (const row of goldSweep) {
    const cap = row.maxRange >= 1000 ? 'none' : String(row.maxRange)
    printSummary(
      `<${cap.padStart(4)}`,
      row
    )
    process.stdout.write('')
  }

  console.log('\n=== GOLD range buckets (fills only, not a running cap) ===')
  const goldBuckets = bucketByRange(goldAll, [0, 12, 15, 18, 20, 25, 30, 35, 40, 50, 60, 80, 120, 10_000])
  for (const row of goldBuckets) {
    if (row.trades === 0) continue
    printSummary(row.label, row)
  }

  console.log('\n=== GOLD sides @ best later ===')
  printSummary('GOLD all qty', goldAll.summary)
  printSummary('  LONG', goldAll.bySide.LONG)
  printSummary('  SHORT', goldAll.bySide.SHORT)

  console.log('\n=== DOW max-range sweep (sanity vs known <80) ===')
  const dowSweep = sweepMaxRange(dowAll, dowCaps)
  for (const row of dowSweep) {
    const cap = row.maxRange >= 1000 ? 'none' : String(row.maxRange)
    printSummary(`<${cap.padStart(4)}`, row)
  }
  console.log('\n=== DOW range buckets ===')
  const dowBuckets = bucketByRange(dowAll, [0, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 10_000])
  for (const row of dowBuckets) {
    if (row.trades === 0) continue
    printSummary(row.label, row)
  }

  const goldRanked = [...goldSweep].filter((r) => r.trades >= 8).sort((a, b) => b.netPnl - a.netPnl)
  const goldBestEr = [...goldSweep].filter((r) => r.trades >= 8).sort((a, b) => (b.expectR || -999) - (a.expectR || -999))
  const goldBestPf = [...goldSweep]
    .filter((r) => r.trades >= 8 && r.profitFactor != null)
    .sort((a, b) => (b.profitFactor || 0) - (a.profitFactor || 0))

  const payload = {
    generatedAt: new Date().toISOString(),
    engine: 'asia_range_signals_v1',
    rules: {
      tz: 'America/Toronto',
      asia: '20:00–02:00',
      fillUntil: '03:30',
      flatten: '11:30',
      tpR: 1.5,
      account: 50000,
      riskPct: 1,
      gold: { buffer: 10, pointValue: 10, contract: 'MGC' },
      dow: { buffer: 20, pointValue: 0.5, contract: 'MYM' },
    },
    gold: {
      symbol: gold.symbol,
      bars: gold.bars.length,
      from: gold.bars[0] ? new Date(gold.bars[0].time * 1000).toISOString() : '',
      to: gold.bars.length ? new Date(gold.bars[gold.bars.length - 1]!.time * 1000).toISOString() : '',
      percentiles: gp,
      sessions: goldAll.sessions.length,
      summaryAll: goldAll.summary,
      bySide: goldAll.bySide,
      sweep: goldSweep,
      buckets: goldBuckets,
      bestPnl: goldRanked[0] || null,
      bestExpectR: goldBestEr[0] || null,
      bestPf: goldBestPf[0] || null,
      trades: goldAll.trades,
    },
    dow: {
      symbol: dow.symbol,
      bars: dow.bars.length,
      from: dow.bars[0] ? new Date(dow.bars[0].time * 1000).toISOString() : '',
      to: dow.bars.length ? new Date(dow.bars[dow.bars.length - 1]!.time * 1000).toISOString() : '',
      percentiles: dp,
      sessions: dowAll.sessions.length,
      summaryAll: dowAll.summary,
      bySide: dowAll.bySide,
      sweep: dowSweep,
      buckets: dowBuckets,
    },
  }

  const outPath = join(OUT_DIR, 'asia-range-gold-year.json')
  writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`\nWrote ${outPath}`)

  if (goldRanked[0]) {
    console.log(
      `\nGOLD best $ cap (n>=8): <${goldRanked[0].maxRange >= 1000 ? 'none' : goldRanked[0].maxRange}  ${money(goldRanked[0].netPnl)}  E[R] ${er(goldRanked[0].expectR)}  PF ${pf(goldRanked[0].profitFactor)}  n=${goldRanked[0].trades}`
    )
  }
  if (goldBestEr[0]) {
    console.log(
      `GOLD best E[R] cap (n>=8): <${goldBestEr[0].maxRange >= 1000 ? 'none' : goldBestEr[0].maxRange}  ${money(goldBestEr[0].netPnl)}  E[R] ${er(goldBestEr[0].expectR)}  PF ${pf(goldBestEr[0].profitFactor)}  n=${goldBestEr[0].trades}`
    )
  }
}

main()
