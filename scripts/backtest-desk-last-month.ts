/**
 * Fetch Yahoo 5m MYM=F / MNQ=F and replay the live desk for the last
 * ~22 NY cash sessions. Writes docs/LAST_MONTH_DESK_BACKTEST.md
 *
 *   npx tsx scripts/backtest-desk-last-month.ts
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import { getYahooCandlesRange, type YahooCandle } from '../lib/yahoo/candles'
import {
  renderDeskBacktestMarkdown,
  replayDeskMonth,
  type BtBar,
} from '../lib/trading/deskMonthBacktest'

const ET = 'America/New_York'

function ymdInTz(unix: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000))
}

function addYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta, 12, 0, 0))
  return dt.toISOString().slice(0, 10)
}

function asBt(c: YahooCandle): BtBar {
  return {
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }
}

async function fetchChunks(
  instrument: 'DOW' | 'NASDAQ',
  period1: number,
  period2: number
): Promise<YahooCandle[]> {
  const WEEK = 7 * 24 * 3600
  const all: YahooCandle[] = []
  for (let t = period1; t < period2; t += WEEK) {
    const end = Math.min(t + WEEK + 3600, period2)
    const pack = await getYahooCandlesRange(instrument, '5', t, end)
    if (pack?.candles?.length) all.push(...pack.candles)
    await new Promise((r) => setTimeout(r, 200))
  }
  const byTime = new Map<number, YahooCandle>()
  for (const c of all) byTime.set(c.time, c)
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

async function main() {
  const now = Math.floor(Date.now() / 1000)
  const toYmd = ymdInTz(now, ET)
  const fromYmd = addYmd(toYmd, -32)
  const period1 = now - 40 * 24 * 3600
  const period2 = now + 3600

  console.log(`Fetching 5m MYM=F / MNQ=F  ${fromYmd} → ${toYmd} …`)
  const [dowPack, nqPack] = await Promise.all([
    fetchChunks('DOW', period1, period2),
    fetchChunks('NASDAQ', period1, period2),
  ])
  if (dowPack.length < 100 || nqPack.length < 100) {
    console.error('Not enough 5m bars', { dow: dowPack.length, nq: nqPack.length })
    process.exit(1)
  }
  console.log(`MYM bars ${dowPack.length}  MNQ bars ${nqPack.length}`)

  const result = replayDeskMonth({
    dow: dowPack.map(asBt),
    nasdaq: nqPack.map(asBt),
    fromYmd,
    toYmd,
  })

  const md = renderDeskBacktestMarkdown(result, {
    dowSymbol: 'MYM=F',
    nasdaqSymbol: 'MNQ=F',
    barCountDow: dowPack.length,
    barCountNasdaq: nqPack.length,
  })
  const out = join(process.cwd(), 'docs/LAST_MONTH_DESK_BACKTEST.md')
  writeFileSync(out, md)
  console.log(`Wrote ${out}`)
  console.log(
    `Trades ${result.trades.length}  net ${result.endingEquity - result.startingEquity}  equity ${result.endingEquity}`
  )
  for (const t of result.trades) {
    console.log(
      `#${t.id} ${t.cashYmd} ${t.instrument} ${t.setup} ${t.side} @ ${t.entry} → ${t.exit} ${t.exitReason} PnL ${t.pnl}`
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
