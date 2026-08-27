/**
 * 1-year sweep of the auction volume-bar break on DOW / NASDAQ / GOLD / CRUDE.
 * Wait bars 3–8 × R 1.00 / 1.25 / 1.50. Uses cached OANDA M5.
 *
 * Run: npx tsx scripts/backtest-auction-volume-year.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  AUCTION_INSTRUMENTS,
  runVolumeBreakBacktest,
  summarizeAuctionTrades,
  type AuctionBar,
  type AuctionInstrument,
  type AuctionSummary,
  type VolumeBreakParams,
} from '../lib/trading/auctionVolumeBreak'

const CACHE_DIR = join(process.cwd(), 'bots', 'data', 'auction-year')
const WAIT_BARS = [3, 4, 5, 6, 7, 8]
const RR = [1.0, 1.25, 1.5]
const SL_TICKS = 5

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

function loadCached(inst: AuctionInstrument): AuctionBar[] {
  const p = join(CACHE_DIR, `oanda-${inst}.json`)
  if (!existsSync(p)) throw new Error(`missing cache ${p} — run backtest-auction-year.ts first`)
  const raw = JSON.parse(readFileSync(p, 'utf8')) as { bars: AuctionBar[] }
  return raw.bars || []
}

function print(label: string, s: AuctionSummary) {
  console.log(
    [
      label.padEnd(18),
      `n ${s.trades}`.padEnd(8),
      `W/L/EOD ${s.wins}/${s.losses}/${s.eod}`.padEnd(20),
      `win ${pct(s.winRate)}`.padEnd(12),
      `PnL ${money(s.netPnl)}`.padEnd(12),
      `E[R] ${s.expectR == null ? '—' : s.expectR.toFixed(2)}`.padEnd(12),
      `PF ${pf(s.profitFactor)}`,
    ].join('  ')
  )
}

type Cell = {
  wait: number
  rr: number
  instrument: string
  summary: AuctionSummary
  byKind: ReturnType<typeof runVolumeBreakBacktest>['byKind']
  bySide: ReturnType<typeof runVolumeBreakBacktest>['bySide']
  byRange: ReturnType<typeof runVolumeBreakBacktest>['byRange']
  expiredSetups: number
}

async function main() {
  console.log('Auction volume-bar break — 5m, $50k / 1%, SL = volume-bar extreme − 5 ticks')
  console.log('Green tags range high → break high = LONG, break low = SHORT (fail)')
  console.log('Red tags range low  → break low  = SHORT, break high = LONG (fail)')
  console.log(`Wait ${WAIT_BARS.join('/')} bars × R ${RR.join('/')} · flatten 16:00 ET\n`)

  const candles = {} as Record<AuctionInstrument, AuctionBar[]>
  for (const inst of AUCTION_INSTRUMENTS) {
    candles[inst] = loadCached(inst)
    const b = candles[inst]
    const t0 = b[0] ? new Date(b[0].time * 1000).toISOString().slice(0, 10) : '?'
    const t1 = b.length ? new Date(b[b.length - 1]!.time * 1000).toISOString().slice(0, 10) : '?'
    console.log(`  ${inst.padEnd(8)} ${String(b.length).padStart(6)} bars  ${t0} → ${t1}`)
  }

  const cells: Cell[] = []

  for (const wait of WAIT_BARS) {
    for (const rr of RR) {
      const params: Partial<VolumeBreakParams> = {
        waitBars: wait,
        rr,
        slBufferTicks: SL_TICKS,
      }
      console.log(`\n=== wait=${wait}  R=${rr.toFixed(2)} ===`)
      const allTrades = []
      for (const inst of AUCTION_INSTRUMENTS) {
        const result = runVolumeBreakBacktest({
          instrument: inst,
          candles: candles[inst],
          params,
        })
        print(inst, result.summary)
        print('  CONTINUE', result.byKind.CONTINUE)
        print('  FAIL', result.byKind.FAIL)
        cells.push({
          wait,
          rr,
          instrument: inst,
          summary: result.summary,
          byKind: result.byKind,
          bySide: result.bySide,
          byRange: result.byRange,
          expiredSetups: result.expiredSetups,
        })
        allTrades.push(
          ...result.trades.map((t) => ({
            ...t,
            pattern: 'ABSORB_BREAKOUT' as const,
            openType: 'Analyzing...' as const,
          }))
        )
      }
      print('ALL', summarizeAuctionTrades(allTrades, 'ALL'))
    }
  }

  // Best config per instrument by net PnL (min 20 trades).
  const bestByInst: Record<string, Cell> = {}
  for (const inst of AUCTION_INSTRUMENTS) {
    const pool = cells.filter((c) => c.instrument === inst && c.summary.trades >= 20)
    pool.sort((a, b) => b.summary.netPnl - a.summary.netPnl)
    if (pool[0]) bestByInst[inst] = pool[0]
  }

  console.log('\n=== Best wait × R per market (n≥20) ===')
  for (const inst of AUCTION_INSTRUMENTS) {
    const b = bestByInst[inst]
    if (!b) {
      console.log(`${inst}: no config with ≥20 trades`)
      continue
    }
    print(`${inst} w${b.wait} R${b.rr}`, b.summary)
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    engine: 'auction_volume_bar_break',
    slBufferTicks: SL_TICKS,
    waitBars: WAIT_BARS,
    rr: RR,
    bestByInst: Object.fromEntries(
      Object.entries(bestByInst).map(([k, v]) => [
        k,
        { wait: v.wait, rr: v.rr, summary: v.summary, byKind: v.byKind, bySide: v.bySide, byRange: v.byRange },
      ])
    ),
    grid: cells.map((c) => ({
      wait: c.wait,
      rr: c.rr,
      instrument: c.instrument,
      expiredSetups: c.expiredSetups,
      summary: c.summary,
      byKind: c.byKind,
      bySide: c.bySide,
      byRange: c.byRange,
    })),
  }

  mkdirSync(CACHE_DIR, { recursive: true })
  const out = join(CACHE_DIR, 'auction-volume-break-year.json')
  writeFileSync(out, JSON.stringify(payload, null, 2))
  console.log(`\nWrote ${out}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
