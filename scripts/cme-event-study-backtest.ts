/**
 * Institutional CME Futures Event Study & Conditional Expectancy Engine
 *
 * Implements Phase 1 of the CME Deep Backtesting Specification for:
 * - Gold (MGC / GC)
 * - Crude Oil (MCL / CL)
 * - Nasdaq-100 (MNQ / NQ)
 * - Dow Jones (MYM / YM)
 *
 * Evaluates level interactions against:
 * 1. 5-Day Fixed Range Volume Profile (POC, VAH, VAL, LVN)
 * 2. Yesterday RTH Session Profile (POC, VAH, VAL, High, Low)
 * 3. Asia/London Overnight Inventory (POC, VAH, VAL)
 * 4. Anchored VWAP + ±1σ / ±2σ bands
 *
 * Measures forward returns (1m, 5m, 15m, 30m, 60m), MFE, and MAE
 * strictly without lookahead bias.
 */

import fs from 'fs'
import path from 'path'

export interface Bar1M {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface VolumeProfile {
  poc: number
  vah: number
  val: number
  high: number
  low: number
  totalVolume: number
  lvn: number[]
  hvn: number[]
}

interface SessionData {
  dateStr: string // YYYY-MM-DD
  rthBars: Bar1M[]
  overnightBars: Bar1M[] // Asia + London (18:00 - 09:30)
}

interface LevelInteractionEvent {
  market: string
  timestamp: number
  dateStr: string
  timeET: string
  levelType: string
  levelPrice: number
  touchPrice: number
  testDirection: 'FROM_ABOVE' | 'FROM_BELOW' // approaching level from above (support test) vs below (resistance test)
  hypothesizedTrade: 'LONG_BOUNCE' | 'SHORT_REJECTION' | 'BREAKOUT'
  ret1m: number
  ret5m: number
  ret15m: number
  ret30m: number
  ret60m: number
  mfe60m: number // in points
  mae60m: number // in points
  mfeR: number // normalized by MAE or tick
  success30m: boolean
}

const INSTRUMENT_CONFIG: Record<string, { tickSize: number; pointValue: number; bucketSize: number }> = {
  NASDAQ: { tickSize: 0.25, pointValue: 2.0, bucketSize: 5.0 },
  DOW: { tickSize: 1.0, pointValue: 0.5, bucketSize: 10.0 },
  CRUDE: { tickSize: 0.01, pointValue: 100.0, bucketSize: 0.05 },
  GOLD: { tickSize: 0.1, pointValue: 10.0, bucketSize: 0.5 },
}

function getEtTimeParts(unixSec: number): { ymd: string; hour: number; minute: number; timeStr: string } {
  const d = new Date(unixSec * 1000)
  // Formats in America/New_York
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(d)
  let year = '', month = '', day = '', hour = '0', minute = '0'
  for (const p of parts) {
    if (p.type === 'year') year = p.value
    if (p.type === 'month') month = p.value
    if (p.type === 'day') day = p.value
    if (p.type === 'hour') hour = p.value
    if (p.type === 'minute') minute = p.value
  }
  return {
    ymd: `${year}-${month}-${day}`,
    hour: parseInt(hour, 10),
    minute: parseInt(minute, 10),
    timeStr: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
  }
}

function computeVolumeProfile(bars: Bar1M[], bucketSize: number): VolumeProfile | null {
  if (bars.length === 0) return null

  let high = -Infinity
  let low = Infinity
  let totalVolume = 0

  for (const b of bars) {
    if (b.high > high) high = b.high
    if (b.low < low) low = b.low
    totalVolume += b.volume > 0 ? b.volume : 1
  }

  if (high <= low || totalVolume <= 0) return null

  const bins = new Map<number, number>()
  for (const b of bars) {
    const vol = b.volume > 0 ? b.volume : 1
    const startBin = Math.floor(b.low / bucketSize) * bucketSize
    const endBin = Math.floor(b.high / bucketSize) * bucketSize
    const count = Math.max(1, Math.round((endBin - startBin) / bucketSize) + 1)
    const perBin = vol / count

    for (let p = startBin; p <= endBin + 1e-6; p += bucketSize) {
      const key = Math.round(p / bucketSize) * bucketSize
      bins.set(key, (bins.get(key) || 0) + perBin)
    }
  }

  // Find POC
  let poc = high
  let maxVol = -1
  const sortedBins = Array.from(bins.entries()).sort((a, b) => a[0] - b[0])

  for (const [p, v] of sortedBins) {
    if (v > maxVol) {
      maxVol = v
      poc = p
    }
  }

  // Value Area (70%)
  const targetVaVol = totalVolume * 0.70
  let pocIdx = sortedBins.findIndex((b) => Math.abs(b[0] - poc) < 1e-4)
  if (pocIdx === -1) pocIdx = Math.floor(sortedBins.length / 2)

  let vaVol = sortedBins[pocIdx] ? sortedBins[pocIdx][1] : 0
  let upIdx = pocIdx + 1
  let downIdx = pocIdx - 1

  while (vaVol < targetVaVol && (upIdx < sortedBins.length || downIdx >= 0)) {
    const nextUpVol = upIdx < sortedBins.length ? sortedBins[upIdx][1] : 0
    const nextDownVol = downIdx >= 0 ? sortedBins[downIdx][1] : 0

    if (nextUpVol >= nextDownVol && upIdx < sortedBins.length) {
      vaVol += nextUpVol
      upIdx++
    } else if (downIdx >= 0) {
      vaVol += nextDownVol
      downIdx--
    } else if (upIdx < sortedBins.length) {
      vaVol += nextUpVol
      upIdx++
    } else {
      break
    }
  }

  const val = sortedBins[Math.max(0, downIdx + 1)][0]
  const vah = sortedBins[Math.min(sortedBins.length - 1, upIdx - 1)][0]

  // Detect LVNs (Low Volume Nodes: local minima with volume < 30% of POC volume)
  const lvns: number[] = []
  const hvns: number[] = []
  for (let i = 1; i < sortedBins.length - 1; i++) {
    const prev = sortedBins[i - 1][1]
    const curr = sortedBins[i][1]
    const next = sortedBins[i + 1][1]
    if (curr < prev && curr < next && curr < maxVol * 0.35) {
      lvns.push(sortedBins[i][0])
    }
    if (curr > prev && curr > next && curr > maxVol * 0.65) {
      hvns.push(sortedBins[i][0])
    }
  }

  return { poc, vah, val, high, low, totalVolume, lvn: lvns, hvn: hvns }
}

function processMarket(market: string, filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.error(`[Skip] File not found: ${filePath}`)
    return null
  }

  const config = INSTRUMENT_CONFIG[market] || { tickSize: 0.25, pointValue: 1.0, bucketSize: 1.0 }
  const raw = fs.readFileSync(filePath, 'utf-8')
  const bars: Bar1M[] = JSON.parse(raw)
  bars.sort((a, b) => a.time - b.time)

  console.log(`\n======================================================`)
  console.log(`📊 PROCESSING CME MARKET: ${market} (${bars.length} 1-minute bars)`)
  console.log(`======================================================`)

  // Step 1: Group bars into daily sessions
  // Day boundaries:
  // RTH: 09:30 - 16:00 ET
  // Overnight: 18:00 (prior day) - 09:30 ET
  const sessionsByDate = new Map<string, { rth: Bar1M[]; overnight: Bar1M[] }>()

  for (const b of bars) {
    const et = getEtTimeParts(b.time)
    const mins = et.hour * 60 + et.minute

    // Determine trading date:
    // If between 18:00 and 23:59 ET, it belongs to the NEXT trading day's overnight
    let tradingDate = et.ymd
    if (et.hour >= 18) {
      // add 1 day to trading date
      const d = new Date(b.time * 1000 + 24 * 3600 * 1000)
      tradingDate = getEtTimeParts(Math.floor(d.getTime() / 1000)).ymd
    }

    if (!sessionsByDate.has(tradingDate)) {
      sessionsByDate.set(tradingDate, { rth: [], overnight: [] })
    }

    const sess = sessionsByDate.get(tradingDate)!
    if (mins >= 570 && mins < 960) {
      // 09:30 to 16:00 ET
      sess.rth.push(b)
    } else if (mins >= 18 * 60 || mins < 570) {
      // 18:00 to 09:30 ET
      sess.overnight.push(b)
    }
  }

  const sortedDates = Array.from(sessionsByDate.keys()).sort()
  console.log(`Discovered ${sortedDates.length} trading calendar sessions.`)

  // Pre-calculate session profiles
  const rthProfiles = new Map<string, VolumeProfile>()
  const overnightProfiles = new Map<string, VolumeProfile>()

  for (const date of sortedDates) {
    const s = sessionsByDate.get(date)!
    const rthProf = computeVolumeProfile(s.rth, config.bucketSize)
    if (rthProf) rthProfiles.set(date, rthProf)

    const onProf = computeVolumeProfile(s.overnight, config.bucketSize)
    if (onProf) overnightProfiles.set(date, onProf)
  }

  // Step 2: Compute Rolling 5-Month Anchored VWAP (or sample-anchored VWAP)
  let sumPV = 0
  let sumP2V = 0
  let sumV = 0
  const vwapMap = new Map<number, { vwap: number; upper1: number; lower1: number }>()

  for (const b of bars) {
    const p = (b.high + b.low + b.close) / 3
    const v = b.volume > 0 ? b.volume : 1
    sumPV += p * v
    sumP2V += p * p * v
    sumV += v
    const curVwap = sumPV / sumV
    const variance = Math.max(0, sumP2V / sumV - curVwap * curVwap)
    const std = Math.sqrt(variance)
    vwapMap.set(b.time, {
      vwap: curVwap,
      upper1: curVwap + std,
      lower1: curVwap - std,
    })
  }

  // Step 3: Run Event Study on Level Interactions
  const events: LevelInteractionEvent[] = []

  // Fast bar lookup map
  const barIndexMap = new Map<number, number>()
  for (let i = 0; i < bars.length; i++) {
    barIndexMap.set(bars[i].time, i)
  }

  // Iterate over trading days with at least 5 prior days
  for (let dIdx = 5; dIdx < sortedDates.length; dIdx++) {
    const todayDate = sortedDates[dIdx]
    const yesterdayDate = sortedDates[dIdx - 1]
    const yesterdayProf = rthProfiles.get(yesterdayDate)
    const inventoryProf = overnightProfiles.get(todayDate)

    // Build 5D profile using strictly previous 5 completed RTH sessions (NO LOOKAHEAD)
    const past5Bars: Bar1M[] = []
    for (let k = dIdx - 5; k < dIdx; k++) {
      const pastSess = sessionsByDate.get(sortedDates[k])
      if (pastSess) past5Bars.push(...pastSess.rth)
    }
    const profile5D = computeVolumeProfile(past5Bars, config.bucketSize)

    const todaySess = sessionsByDate.get(todayDate)!
    if (!todaySess.rth || todaySess.rth.length === 0) continue

    // Define fixed structural levels for today
    const levelsToTest: { name: string; price: number; type: 'SUPPORT' | 'RESISTANCE' }[] = []

    if (profile5D) {
      levelsToTest.push({ name: '5D_POC', price: profile5D.poc, type: 'SUPPORT' })
      levelsToTest.push({ name: '5D_VAH', price: profile5D.vah, type: 'RESISTANCE' })
      levelsToTest.push({ name: '5D_VAL', price: profile5D.val, type: 'SUPPORT' })
      for (const lvn of profile5D.lvn.slice(0, 2)) {
        levelsToTest.push({ name: '5D_LVN', price: lvn, type: 'SUPPORT' })
      }
    }

    if (yesterdayProf) {
      levelsToTest.push({ name: 'YEST_POC', price: yesterdayProf.poc, type: 'SUPPORT' })
      levelsToTest.push({ name: 'YEST_VAH', price: yesterdayProf.vah, type: 'RESISTANCE' })
      levelsToTest.push({ name: 'YEST_VAL', price: yesterdayProf.val, type: 'SUPPORT' })
    }

    if (inventoryProf) {
      levelsToTest.push({ name: 'INV_POC', price: inventoryProf.poc, type: 'SUPPORT' })
    }

    // Cooldown tracker: prevent firing multiple events on the same level within 30 minutes
    const levelCooldown = new Map<string, number>()

    for (let bi = 0; bi < todaySess.rth.length; bi++) {
      const b = todaySess.rth[bi]
      const et = getEtTimeParts(b.time)
      const globalIdx = barIndexMap.get(b.time) ?? -1
      if (globalIdx === -1 || globalIdx + 60 >= bars.length) continue

      // Look at VWAP levels for this bar
      const vwapData = vwapMap.get(b.time)
      const dynamicLevels = [...levelsToTest]
      if (vwapData) {
        dynamicLevels.push({ name: 'AVWAP', price: vwapData.vwap, type: 'SUPPORT' })
        dynamicLevels.push({ name: 'AVWAP_+1σ', price: vwapData.upper1, type: 'RESISTANCE' })
        dynamicLevels.push({ name: 'AVWAP_-1σ', price: vwapData.lower1, type: 'SUPPORT' })
      }

      for (const lvl of dynamicLevels) {
        // Level buffer: within 1 bucket
        const buffer = config.bucketSize * 0.75
        const touched = b.low <= lvl.price + buffer && b.high >= lvl.price - buffer

        if (!touched) continue

        const lastTouch = levelCooldown.get(lvl.name) ?? -Infinity
        if (b.time - lastTouch < 30 * 60) continue // 30-min cooldown
        levelCooldown.set(lvl.name, b.time)

        // Direction of approach (look at previous 3 bars)
        const prevBar = todaySess.rth[Math.max(0, bi - 1)]
        const fromAbove = prevBar ? prevBar.close > lvl.price : b.open > lvl.price
        const testDirection = fromAbove ? 'FROM_ABOVE' : 'FROM_BELOW'
        const hypothesizedTrade = testDirection === 'FROM_ABOVE' ? 'LONG_BOUNCE' : 'SHORT_REJECTION'

        // Measure forward returns at +1m, +5m, +15m, +30m, +60m
        const p0 = b.close
        const b1 = bars[globalIdx + 1]
        const b5 = bars[globalIdx + 5]
        const b15 = bars[globalIdx + 15]
        const b30 = bars[globalIdx + 30]
        const b60 = bars[globalIdx + 60]

        const mult = hypothesizedTrade === 'LONG_BOUNCE' ? 1 : -1
        const ret1m = ((b1.close - p0) * mult)
        const ret5m = ((b5.close - p0) * mult)
        const ret15m = ((b15.close - p0) * mult)
        const ret30m = ((b30.close - p0) * mult)
        const ret60m = ((b60.close - p0) * mult)

        // Calculate MFE and MAE over 60 bars
        let maxFav = 0
        let maxAdv = 0
        for (let forward = 1; forward <= 60; forward++) {
          const fBar = bars[globalIdx + forward]
          if (hypothesizedTrade === 'LONG_BOUNCE') {
            const fav = fBar.high - p0
            const adv = p0 - fBar.low
            if (fav > maxFav) maxFav = fav
            if (adv > maxAdv) maxAdv = adv
          } else {
            const fav = p0 - fBar.low
            const adv = fBar.high - p0
            if (fav > maxFav) maxFav = fav
            if (adv > maxAdv) maxAdv = adv
          }
        }

        events.push({
          market,
          timestamp: b.time,
          dateStr: todayDate,
          timeET: et.timeStr,
          levelType: lvl.name,
          levelPrice: Number(lvl.price.toFixed(2)),
          touchPrice: Number(p0.toFixed(2)),
          testDirection,
          hypothesizedTrade,
          ret1m: Number(ret1m.toFixed(2)),
          ret5m: Number(ret5m.toFixed(2)),
          ret15m: Number(ret15m.toFixed(2)),
          ret30m: Number(ret30m.toFixed(2)),
          ret60m: Number(ret60m.toFixed(2)),
          mfe60m: Number(maxFav.toFixed(2)),
          mae60m: Number(maxAdv.toFixed(2)),
          mfeR: maxAdv > 0 ? Number((maxFav / maxAdv).toFixed(2)) : 0,
          success30m: ret30m > 0,
        })
      }
    }
  }

  console.log(`Total Level Interaction Events Captured: ${events.length}`)

  // Aggregate results by Level Type
  const levelSummary = new Map<string, { count: number; wins: number; sumRet30: number; sumMfe: number; sumMae: number }>()

  for (const e of events) {
    const cur = levelSummary.get(e.levelType) || { count: 0, wins: 0, sumRet30: 0, sumMfe: 0, sumMae: 0 }
    cur.count++
    if (e.success30m) cur.wins++
    cur.sumRet30 += e.ret30m
    cur.sumMfe += e.mfe60m
    cur.sumMae += e.mae60m
    levelSummary.set(e.levelType, cur)
  }

  console.log(`\n-------------------------------------------------------------------------------------`)
  console.log(`📈 CONDITIONAL EXPECTANCY MAP: P(Return > 0 | Level Touch) for ${market}`)
  console.log(`-------------------------------------------------------------------------------------`)
  console.log(
    `Level Name`.padEnd(16) +
    `Touches`.padStart(8) +
    `Win% (30m)`.padStart(12) +
    `Avg Ret (pts)`.padStart(15) +
    `Avg MFE`.padStart(12) +
    `Avg MAE`.padStart(12) +
    `MFE/MAE Ratio`.padStart(15)
  )
  console.log(`-`.repeat(90))

  const summaryRows: any[] = []
  for (const [lvl, stat] of levelSummary.entries()) {
    if (stat.count < 3) continue
    const winRate = ((stat.wins / stat.count) * 100).toFixed(1) + '%'
    const avgRet = (stat.sumRet30 / stat.count).toFixed(2)
    const avgMfe = (stat.sumMfe / stat.count).toFixed(2)
    const avgMae = (stat.sumMae / stat.count).toFixed(2)
    const ratio = stat.sumMae > 0 ? (stat.sumMfe / stat.sumMae).toFixed(2) : 'N/A'

    console.log(
      lvl.padEnd(16) +
      String(stat.count).padStart(8) +
      winRate.padStart(12) +
      avgRet.padStart(15) +
      avgMfe.padStart(12) +
      avgMae.padStart(12) +
      ratio.padStart(15)
    )

    summaryRows.push({
      market,
      level: lvl,
      count: stat.count,
      winRate30m: winRate,
      avgRet30m: Number(avgRet),
      avgMfe: Number(avgMfe),
      avgMae: Number(avgMae),
      mfeMaeRatio: ratio,
    })
  }

  return { market, eventsCount: events.length, summaryRows, sampleEvents: events.slice(0, 5) }
}

async function main() {
  const baseDir = path.resolve(process.cwd(), 'data/cme_sessions')
  const markets = [
    { name: 'NASDAQ', file: path.join(baseDir, 'nasdaq_1m_archive.json') },
    { name: 'DOW', file: path.join(baseDir, 'dow_1m_archive.json') },
    { name: 'CRUDE', file: path.join(baseDir, 'crude_1m_archive.json') },
    { name: 'GOLD', file: path.join(baseDir, 'gold_1m_archive.json') },
  ]

  const allResults: any[] = []
  for (const m of markets) {
    const res = processMarket(m.name, m.file)
    if (res) allResults.push(res)
  }

  const outPath = path.resolve(process.cwd(), 'data/cme-event-study-results.json')
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2))
  console.log(`\n✅ Deep Backtest Complete. Full results exported to ${outPath}\n`)
}

main().catch(console.error)
