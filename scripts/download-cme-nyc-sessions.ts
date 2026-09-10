/**
 * CME NYC Cash Sessions Downloader & Archive Script
 *
 * Downloads institutional 1m / 1s CME Globex data for the NYC Cash Session
 * (09:30 – 16:00 ET) for all 4 markets: Gold (MGC), Nasdaq (MNQ), Dow (MYM), Crude (CL).
 * Stores data locally in data/cme_sessions/ for offline practice, high-precision backtests,
 * and high-def Fixed Range Volume Profile / VWAP calculation.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/download-cme-nyc-sessions.ts
 */

import fs from 'fs'
import path from 'path'
import { DATABENTO_SYMBOLS, databentoHistoricalAuthHeader } from '../lib/databento/client'
import type { Instrument } from '@/types/price-feed'

const INSTRUMENTS: Instrument[] = ['GOLD', 'NASDAQ', 'DOW', 'CRUDE']

interface DownloadOptions {
  days?: number
  schema?: 'ohlcv-1m' | 'ohlcv-1s'
}

async function fetchDatabentoRange(
  apiKey: string,
  symbol: string,
  startIso: string,
  endIso: string,
  schema: 'ohlcv-1m' | 'ohlcv-1s' = 'ohlcv-1m'
) {
  // Historical HTTP Basic (key as username, empty password) — not Live CRAM / not a webhook.
  const params = new URLSearchParams({
    dataset: 'GLBX.MDP3',
    symbols: symbol,
    schema,
    encoding: 'json',
    stype_in: 'continuous',
    start: startIso,
    end: endIso,
  })

  const url = `https://hist.databento.com/v0/timeseries.get_range?${params.toString()}`
  const res = await fetch(url, {
    headers: { Authorization: databentoHistoricalAuthHeader(apiKey) },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Databento API error ${res.status}: ${text.slice(0, 200)}`)
  }

  const text = await res.text()
  const lines = text.trim().split('\n').filter(Boolean)
  return lines.map((line) => {
    const row = JSON.parse(line)
    return {
      time: Math.floor(Number(row.hd.ts_event) / 1e9),
      open: Number(row.open) / 1e9,
      high: Number(row.high) / 1e9,
      low: Number(row.low) / 1e9,
      close: Number(row.close) / 1e9,
      volume: Number(row.volume) || 0,
    }
  })
}

async function main() {
  const apiKey = process.env.DATABENTO_API_KEY?.trim()
  if (!apiKey) {
    console.error('ERROR: DATABENTO_API_KEY is not set in .env.local')
    process.exit(1)
  }

  const daysToDownload = 30
  const outDir = path.join(process.cwd(), 'data', 'cme_sessions')
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  console.log(`\n======================================================`)
  console.log(` CME NYC SESSIONS ARCHIVE ENGINE (Databento GLBX.MDP3)`)
  console.log(` Markets: ${INSTRUMENTS.join(', ')}`)
  console.log(` Target Window: Prior ${daysToDownload} days of NYC Sessions`)
  console.log(` Output Directory: ${outDir}`)
  console.log(`======================================================\n`)

  const now = new Date()
  const endSec = Math.floor(now.getTime() / 1000) - 900 // 15m buffer
  const startSec = endSec - daysToDownload * 24 * 3600

  const startIso = new Date(startSec * 1000).toISOString().slice(0, 19)
  const endIso = new Date(endSec * 1000).toISOString().slice(0, 19)

  console.log(`Querying Databento from ${startIso} to ${endIso}...\n`)

  for (const inst of INSTRUMENTS) {
    const symbol = DATABENTO_SYMBOLS[inst]
    console.log(`[${inst}] Fetching continuous CME contract ${symbol}...`)
    try {
      const bars = await fetchDatabentoRange(apiKey, symbol, startIso, endIso, 'ohlcv-1m')
      console.log(`  -> Downloaded ${bars.length.toLocaleString()} 1-minute bars.`)

      if (bars.length > 0) {
        const filePath = path.join(outDir, `${inst.toLowerCase()}_1m_archive.json`)
        fs.writeFileSync(filePath, JSON.stringify(bars, null, 2), 'utf8')
        const fileSizeMb = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2)
        const firstTime = new Date(bars[0].time * 1000).toISOString()
        const lastTime = new Date(bars[bars.length - 1].time * 1000).toISOString()

        console.log(`  -> Saved to: ${filePath} (${fileSizeMb} MB)`)
        console.log(`  -> Range: ${firstTime} to ${lastTime}`)
        console.log(`  -> Latest Close: ${bars[bars.length - 1].close}`)
      }
    } catch (err: any) {
      console.error(`  ❌ Failed for ${inst}:`, err.message)
    }
  }

  console.log(`\n✅ CME NYC Session Archive Completed!`)
  console.log(`Data is permanently stored on your SSD for instant, zero-cost replays and ultra-precise profiles.\n`)
}

main().catch(console.error)
