/**
 * Multi-Year CME Historical Ingestion Engine (v4.1.1 Frozen Protocol)
 *
 * Downloads continuous CME Globex 1-minute data for NQ, YM, CL, and GC
 * covering 2020-06-01 (120-session pre-test indicator warm-up) through present.
 *
 * Features:
 * - Chunks requests in 3-month batches to prevent timeouts or memory buffer overruns.
 * - Auto-resumes from last saved checkpoint if interrupted.
 * - Normalizes prices to native decimal scale (from Databento 1e9 fixed-point integer format).
 * - Saves consolidated clean JSON files to data/cme_multiyear/.
 *
 * Usage:
 *   npx tsx scripts/fetch-cme-multiyear-historical.ts [--dry-run] [--market=NQ|YM|CL|GC]
 */

import fs from 'fs'
import path from 'path'

interface Bar1M {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface ContractConfig {
  symbol: string
  filePrefix: string
  name: string
}

const CONTRACTS: Record<string, ContractConfig> = {
  NASDAQ: { symbol: 'NQ.c.0', filePrefix: 'nasdaq_1m_multiyear', name: 'Nasdaq-100 (NQ)' },
  DOW: { symbol: 'YM.c.0', filePrefix: 'dow_1m_multiyear', name: 'Dow Jones (YM)' },
  CRUDE: { symbol: 'CL.c.0', filePrefix: 'crude_1m_multiyear', name: 'Crude Oil (CL)' },
  GOLD: { symbol: 'GC.c.0', filePrefix: 'gold_1m_multiyear', name: 'Gold (GC)' },
}

async function fetchChunkWithRetry(
  apiKey: string,
  symbol: string,
  startIso: string,
  endIso: string,
  maxRetries = 3
): Promise<Bar1M[]> {
  const auth = Buffer.from(`${apiKey}:`).toString('base64')
  const params = new URLSearchParams({
    dataset: 'GLBX.MDP3',
    symbols: symbol,
    schema: 'ohlcv-1m',
    encoding: 'json',
    stype_in: 'continuous',
    start: startIso,
    end: endIso,
  })

  const url = `https://hist.databento.com/v0/timeseries.get_range?${params.toString()}`

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 150)}`)
      }

      const text = await res.text()
      const lines = text.trim().split('\n').filter(Boolean)
      const bars: Bar1M[] = []

      for (const line of lines) {
        const row = JSON.parse(line)
        bars.push({
          time: Math.floor(Number(row.hd.ts_event) / 1e9),
          open: Number(row.open) / 1e9,
          high: Number(row.high) / 1e9,
          low: Number(row.low) / 1e9,
          close: Number(row.close) / 1e9,
          volume: Number(row.volume) || 0,
        })
      }

      return bars
    } catch (err: any) {
      console.warn(`    [Attempt ${attempt}/${maxRetries} failed: ${err.message}]`)
      if (attempt === maxRetries) throw err
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt))
    }
  }

  return []
}

async function ingestMarketMultiYear(
  marketKey: string,
  apiKey: string,
  startDate: string = '2020-06-01',
  endDate: string = '2026-10-04'
) {
  const config = CONTRACTS[marketKey]
  if (!config) throw new Error(`Unknown market: ${marketKey}`)

  const outDir = path.resolve(process.cwd(), 'data/cme_multiyear')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const finalPath = path.join(outDir, `${config.filePrefix}.json`)
  const checkpointPath = path.join(outDir, `${config.filePrefix}_checkpoint.json`)

  console.log(`\n========================================================================================`)
  console.log(`🚀 INGESTING MULTI-YEAR DATA: ${config.name} (${config.symbol})`)
  console.log(`Range: ${startDate} -> ${endDate} | Storage: ${finalPath}`)
  console.log(`========================================================================================`)

  // Generate 90-day interval windows
  const windows: { start: string; end: string }[] = []
  let cur = new Date(`${startDate}T00:00:00Z`)
  const targetEnd = new Date(`${endDate}T00:00:00Z`)

  while (cur < targetEnd) {
    const next = new Date(cur.getTime() + 90 * 24 * 3600 * 1000)
    const chunkEnd = next > targetEnd ? targetEnd : next
    windows.push({
      start: cur.toISOString().slice(0, 19),
      end: chunkEnd.toISOString().slice(0, 19),
    })
    cur = next
  }

  console.log(`Planned ${windows.length} quarterly chunks covering 6.3 years.`)

  // Check existing bars from checkpoint or final file
  let allBars: Bar1M[] = []
  let completedChunks = 0

  if (fs.existsSync(checkpointPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'))
      allBars = saved.bars || []
      completedChunks = saved.completedChunks || 0
      console.log(`Resuming from checkpoint: ${allBars.length} bars already loaded (${completedChunks}/${windows.length} chunks).`)
    } catch {
      allBars = []
    }
  }

  for (let i = completedChunks; i < windows.length; i++) {
    const w = windows[i]
    console.log(`  Downloading chunk [${i + 1}/${windows.length}]: ${w.start.slice(0, 10)} -> ${w.end.slice(0, 10)}...`)
    const chunkBars = await fetchChunkWithRetry(apiKey, config.symbol, w.start, w.end)
    allBars.push(...chunkBars)
    console.log(`    + Received ${chunkBars.length.toLocaleString()} bars (Total cumulative: ${allBars.length.toLocaleString()})`)

    // Save checkpoint every 2 chunks
    if ((i + 1) % 2 === 0 || i === windows.length - 1) {
      fs.writeFileSync(
        checkpointPath,
        JSON.stringify({ completedChunks: i + 1, bars: allBars }, null, 0)
      )
    }

    // Gentle pacing to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 800))
  }

  // Deduplicate and sort
  const seenTimes = new Set<number>()
  const dedupedBars: Bar1M[] = []
  allBars.sort((a, b) => a.time - b.time)

  for (const b of allBars) {
    if (!seenTimes.has(b.time)) {
      seenTimes.add(b.time)
      dedupedBars.push(b)
    }
  }

  fs.writeFileSync(finalPath, JSON.stringify(dedupedBars, null, 0))
  if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath)

  console.log(`\n✅ Completed ${config.name}! Saved ${dedupedBars.length.toLocaleString()} clean 1m bars to ${finalPath}`)
  return dedupedBars.length
}

async function main() {
  const apiKey = process.env.DATABENTO_API_KEY?.trim()
  if (!apiKey) {
    console.error('ERROR: DATABENTO_API_KEY not found in .env.local')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')
  const marketArg = args.find((a) => a.startsWith('--market='))?.split('=')[1]?.toUpperCase()

  if (isDryRun) {
    console.log(`\n========================================================================================`)
    console.log(`🔍 DATABENTO MULTI-YEAR PRE-FLIGHT COST & STORAGE AUDIT (2020-06-01 -> 2026-10-04)`)
    console.log(`========================================================================================\n`)

    const auth = Buffer.from(`${apiKey}:`).toString('base64')
    for (const [key, c] of Object.entries(CONTRACTS)) {
      const urlCost = `https://hist.databento.com/v0/metadata.get_cost?dataset=GLBX.MDP3&symbols=${c.symbol}&stype_in=continuous&schema=ohlcv-1m&start=2020-06-01T00:00:00&end=2026-10-04T00:00:00`
      const urlSize = `https://hist.databento.com/v0/metadata.get_billable_size?dataset=GLBX.MDP3&symbols=${c.symbol}&stype_in=continuous&schema=ohlcv-1m&start=2020-06-01T00:00:00&end=2026-10-04T00:00:00`
      const urlRec = `https://hist.databento.com/v0/metadata.get_record_count?dataset=GLBX.MDP3&symbols=${c.symbol}&stype_in=continuous&schema=ohlcv-1m&start=2020-06-01T00:00:00&end=2026-10-04T00:00:00`

      const [cRes, sRes, rRes] = await Promise.all([
        fetch(urlCost, { headers: { Authorization: `Basic ${auth}` } }),
        fetch(urlSize, { headers: { Authorization: `Basic ${auth}` } }),
        fetch(urlRec, { headers: { Authorization: `Basic ${auth}` } }),
      ])

      const cost = (await cRes.text()).trim()
      const sizeBytes = Number((await sRes.text()).trim())
      const records = Number((await rRes.text()).trim())

      console.log(
        `${c.name.padEnd(20)} | Symbol: ${c.symbol.padEnd(8)} | Bars: ${records.toLocaleString().padStart(11)} | ` +
        `Size: ${(sizeBytes / (1024 * 1024)).toFixed(1).padStart(6)} MB | API Cost: $${cost}`
      )
    }

    console.log(`\nReady to proceed with ingestion. Run without --dry-run to start downloading.`)
    return
  }

  const marketsToDownload = marketArg ? [marketArg] : ['GOLD', 'CRUDE', 'DOW', 'NASDAQ']

  for (const m of marketsToDownload) {
    await ingestMarketMultiYear(m, apiKey)
  }
}

main().catch(console.error)
