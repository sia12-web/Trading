/**
 * Dow volume-bar FAIL — same Pine recipe, 5m / 10m / 15m, 1 year.
 *
 * Rules (TradingView "auction volume-bar — Dow 15M fail"):
 *   15-minute range 09:30–09:45 NY. Arm volume bar 09:45–10:00.
 *   FAIL only (opposite side of the tagged bar). Wait 5 bars. 1.5R.
 *   $50k / 1%, MYM $0.50/pt, stop = volume-bar extreme + 5 ticks.
 *
 * Run: npx tsx scripts/backtest-dow-volbar-tf.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getOandaCandlesRange } from '../lib/oanda/candles'
import { isOandaConfigured } from '../lib/oanda/config'
import {
  runVolumeBreakBacktest,
  type AuctionBar,
} from '../lib/trading/auctionVolumeBreak'

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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null) process.env[key] = val
  }
}

loadEnvLocal()

const CACHE = join(process.cwd(), 'bots', 'data', 'auction-year', 'oanda-DOW.json')
const OUT = join(process.cwd(), 'bots', 'data', 'auction-year', 'dow-volbar-tf.json')
const YEAR_SEC = 365 * 24 * 3600

const PINE = {
  waitBars: 5,
  rr: 1.5,
  slBufferTicks: 5,
  rvolMult: 1.2,
  minRangeMult: 1.0,
  maxDaily: 3,
  onlyKind: 'FAIL' as const,
  onlyRange: '15M' as const,
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

function resample(bars: AuctionBar[], seconds: number): AuctionBar[] {
  const buckets = new Map<number, AuctionBar>()
  for (const b of bars) {
    const t = Math.floor(b.time / seconds) * seconds
    const prev = buckets.get(t)
    if (!prev) {
      buckets.set(t, {
        time: t,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0,
      })
    } else {
      prev.high = Math.max(prev.high, b.high)
      prev.low = Math.min(prev.low, b.low)
      prev.close = b.close
      prev.volume = (prev.volume || 0) + (b.volume || 0)
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time)
}

async function loadDowM5(): Promise<AuctionBar[]> {
  if (existsSync(CACHE)) {
    const raw = JSON.parse(readFileSync(CACHE, 'utf8')) as { bars?: AuctionBar[] }
    if (raw.bars && raw.bars.length > 10_000) {
      console.log(`cache ${CACHE}  n=${raw.bars.length}`)
      return raw.bars
    }
  }
  if (!isOandaConfigured()) {
    throw new Error('OANDA not configured and no oanda-DOW.json cache')
  }
  const end = Math.floor(Date.now() / 1000)
  const start = end - YEAR_SEC
  console.log('fetching OANDA US30 M5 …')
  const pack = await getOandaCandlesRange('DOW', '5', start, end)
  if (!pack?.candles?.length) throw new Error('OANDA returned no DOW M5')
  const bars: AuctionBar[] = pack.candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))
  mkdirSync(join(process.cwd(), 'bots', 'data', 'auction-year'), { recursive: true })
  writeFileSync(CACHE, JSON.stringify({ bars, fetchedAt: new Date().toISOString() }))
  return bars
}

async function main() {
  const m5 = await loadDowM5()
  const t0 = m5[0] ? new Date(m5[0].time * 1000).toISOString().slice(0, 10) : '?'
  const t1 = m5[m5.length - 1]
    ? new Date(m5[m5.length - 1]!.time * 1000).toISOString().slice(0, 10)
    : '?'
  console.log(`DOW M5 ${m5.length} bars  ${t0} → ${t1}`)
  console.log(
    'Recipe: 15M range · FAIL only · wait 5 · 1.5R · MYM $0.50/pt · $50k/1%\n'
  )

  const frames: Array<{ tf: string; seconds: number; waitMinutes: number }> = [
    { tf: '5m', seconds: 300, waitMinutes: 25 },
    { tf: '10m', seconds: 600, waitMinutes: 50 },
    { tf: '15m', seconds: 900, waitMinutes: 75 },
  ]

  const rows = []
  for (const f of frames) {
    const candles = f.seconds === 300 ? m5 : resample(m5, f.seconds)
    const ran = runVolumeBreakBacktest({
      instrument: 'DOW',
      candles,
      params: PINE,
    })
    const shorts = ran.bySide.SHORT
    const longs = ran.bySide.LONG
    rows.push({
      tf: f.tf,
      bars: candles.length,
      waitMinutes: f.waitMinutes,
      n: ran.summary.trades,
      wins: ran.summary.wins,
      losses: ran.summary.losses,
      eod: ran.summary.eod,
      winRate: ran.summary.winRate,
      netPnl: ran.summary.netPnl,
      expectR: ran.summary.expectR,
      profitFactor: ran.summary.profitFactor,
      maxDrawdown: ran.summary.maxDrawdown,
      expiredSetups: ran.expiredSetups,
      shortN: shorts.trades,
      shortPnl: shorts.netPnl,
      shortWr: shorts.winRate,
      longN: longs.trades,
      longPnl: longs.netPnl,
      longWr: longs.winRate,
    })
    console.log(
      [
        f.tf.padEnd(6),
        `wait ${f.waitMinutes}m`.padEnd(10),
        `n ${ran.summary.trades}`.padEnd(8),
        `W/L/EOD ${ran.summary.wins}/${ran.summary.losses}/${ran.summary.eod}`.padEnd(20),
        `win ${pct(ran.summary.winRate)}`.padEnd(12),
        `PnL ${money(ran.summary.netPnl)}`.padEnd(12),
        `E[R] ${ran.summary.expectR == null ? '—' : ran.summary.expectR.toFixed(2)}`.padEnd(12),
        `PF ${pf(ran.summary.profitFactor)}`.padEnd(10),
        `DD ${money(-ran.summary.maxDrawdown)}`,
      ].join('  ')
    )
    console.log(
      `       shorts ${shorts.trades} ${money(shorts.netPnl)}  wr ${pct(shorts.winRate)}   longs ${longs.trades} ${money(longs.netPnl)}  wr ${pct(longs.winRate)}   expired setups ${ran.expiredSetups}`
    )
  }

  mkdirSync(join(process.cwd(), 'bots', 'data', 'auction-year'), { recursive: true })
  writeFileSync(
    OUT,
    JSON.stringify({ from: t0, to: t1, recipe: PINE, rows }, null, 2)
  )
  console.log(`\nwrote ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
