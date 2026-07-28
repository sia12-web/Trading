/**
 * NIKKEI only — print the last New York (US) session range high/low.
 *
 * Uses the same chart bands as the live desk:
 *   New York (build H/L): JST 22:30 → 09:00
 *   Tokyo cash (BRK/REJ): JST 09:00 → 15:00
 *   Never London / post-cash dead zone
 *
 * Run:
 *   npm run nikkei:ny-range
 *   npx tsx scripts/nikkei-last-ny-session-range.ts
 */

import fs from 'fs'
import path from 'path'
import {
  inNikkeiUsBuildSession,
  lastNikkeiUsSessionRange,
  listNikkeiUsSessionRanges,
} from '../lib/chart/nikkeiUsRangeBreakout'
import { getOandaCandles } from '../lib/oanda/candles'

function loadEnvLocal() {
  const p = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
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

function fmtTz(unix: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(unix * 1000))
}

function fmtPts(n: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

async function main() {
  loadEnvLocal()

  console.log('══════════════════════════════════════════════════')
  console.log('  NIKKEI — last New York (US) session range')
  console.log('  Instrument: JP225 only (not DOW / NASDAQ)')
  console.log('  Build H/L: chart New York band (JST 22:30–09:00)')
  console.log('  BRK/REJ: Tokyo cash only (JST 09:00–15:00) — not London/dead')
  console.log('══════════════════════════════════════════════════')

  const pack = await getOandaCandles('NIKKEI', '5', 5)
  if (!pack || pack.candles.length === 0) {
    console.error(
      'No JP225 candles. Check OANDA_API_KEY / OANDA_ACCOUNT_ID / OANDA_ENVIRONMENT in .env.local'
    )
    process.exit(1)
  }

  const bars = pack.candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))

  const tip = bars[bars.length - 1]!
  const nowInUs = inNikkeiUsBuildSession(Math.floor(Date.now() / 1000))
  const sessions = listNikkeiUsSessionRanges(bars)
  const lastCompleted = lastNikkeiUsSessionRange(bars, { preferCompleted: true })
  const latest = lastNikkeiUsSessionRange(bars, { preferCompleted: false })

  console.log(`Candles: ${bars.length} × M5 from OANDA ${pack.symbol}`)
  console.log(
    `Tip: ${fmtTz(tip.time, 'America/New_York')} ET · ${fmtTz(tip.time, 'Asia/Tokyo')} JST · close ${fmtPts(tip.close)}`
  )
  console.log(`US clock now: ${nowInUs ? 'OPEN (range still forming)' : 'CLOSED'}`)
  console.log('')

  if (!lastCompleted && !latest) {
    console.error('No US session range found in the last ~5 days of JP225 bars.')
    process.exit(1)
  }

  const show = lastCompleted ?? latest!
  console.log('── Last NYC session (NIKKEI) ──────────────────────')
  console.log(`  Status : ${show.complete ? 'COMPLETE' : 'IN PROGRESS'}`)
  console.log(`  Start  : ${fmtTz(show.fromTime, 'America/New_York')} ET`)
  console.log(`           ${fmtTz(show.fromTime, 'UTC')} UTC`)
  console.log(`  End    : ${fmtTz(show.toTime, 'America/New_York')} ET`)
  console.log(`           ${fmtTz(show.toTime, 'UTC')} UTC`)
  console.log(`  Open   : ${fmtPts(show.open)}`)
  console.log(`  High   : ${fmtPts(show.high)}   ← US H`)
  console.log(`  Low    : ${fmtPts(show.low)}   ← US L`)
  console.log(`  Close  : ${fmtPts(show.close)}`)
  console.log(`  Range  : ${fmtPts(show.rangePts)} pts`)
  console.log('')

  if (
    latest &&
    lastCompleted &&
    !latest.complete &&
    (latest.fromTime !== lastCompleted.fromTime ||
      latest.high !== lastCompleted.high ||
      latest.low !== lastCompleted.low)
  ) {
    console.log('── Today US session (still forming) ───────────────')
    console.log(`  Start  : ${fmtTz(latest.fromTime, 'America/New_York')} ET`)
    console.log(`  High   : ${fmtPts(latest.high)}`)
    console.log(`  Low    : ${fmtPts(latest.low)}`)
    console.log(`  Range  : ${fmtPts(latest.rangePts)} pts so far`)
    console.log('')
  }

  console.log(`Sessions found (last ${sessions.length}):`)
  for (const s of sessions.slice(-5)) {
    const mark = s === show ? ' ← shown' : ''
    console.log(
      `  ${s.complete ? '✓' : '…'} ${fmtTz(s.fromTime, 'America/New_York')} ET  H ${fmtPts(s.high)}  L ${fmtPts(s.low)}  (${fmtPts(s.rangePts)} pts)${mark}`
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
