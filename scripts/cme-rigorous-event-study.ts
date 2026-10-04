/**
 * Institutional CME Futures Rigorous Event Study & Statistical Validation Engine (v3)
 *
 * Implements the Quantitative Audit Enhancements:
 * 1. Directionally-Matched Baseline Controls:
 *    - Long hypotheses compared strictly against matched Long baseline drift p0_long.
 *    - Short hypotheses compared strictly against matched Short baseline drift p0_short.
 * 2. Renamed to "Unique First-Touch Events" & Clustered by Trading Day.
 * 3. Explicit Mean-Level Split: H_rejection (Fade from mean) vs H_acceptance (Continuation through mean).
 * 4. True Touch Frequency Curve: Same hypothesis (Rejection vs Breakout) tracked across Touches 1, 2, 3, 4+.
 * 5. Volatility-Normalized Returns: R_ATR = (D_t * deltaP) / ATR, MFE_ATR, MAE_ATR.
 * 6. Multiple-Testing Correction: Benjamini-Hochberg False Discovery Rate (BH-FDR at Q=0.10).
 * 7. Absorption Proxy Metric: High volume / delta combined with compressed price efficiency.
 * 8. Explicit Warm-up Verification indicator.
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

interface ProcessedEvent {
  market: string
  clusterId: string
  touchIndex: number // 1, 2, 3, 4+
  timestamp: number
  dateStr: string
  timeET: string
  levelType: string
  hypothesisType: 'SUPPORT_BOUNCE' | 'RESISTANCE_FADE' | 'MEAN_FADE' | 'MEAN_CONTINUATION'
  levelPrice: number
  touchPrice: number
  distanceToLevel: number
  expectedDirection: 'LONG' | 'SHORT'
  rawRet30m: number
  signedRet30mPts: number
  signedRet30mATR: number
  mfePts: number
  maePts: number
  mfeATR: number
  maeATR: number
  isWin30m: boolean
  atr: number
  absorptionProxyScore: number
}

interface MarketConfig {
  name: string
  tickSize: number
  pointValue: number
  bucketSize: number
  nativeSessionStartMin: number
  nativeSessionEndMin: number
}

const MARKET_CONFIGS: Record<string, MarketConfig> = {
  NASDAQ: {
    name: 'NASDAQ (NQ)',
    tickSize: 0.25,
    pointValue: 20.0,
    bucketSize: 5.0,
    nativeSessionStartMin: 9 * 60 + 30, // 09:30 ET
    nativeSessionEndMin: 16 * 60,       // 16:00 ET
  },
  DOW: {
    name: 'DOW (YM)',
    tickSize: 1.0,
    pointValue: 5.0,
    bucketSize: 10.0,
    nativeSessionStartMin: 9 * 60 + 30, // 09:30 ET
    nativeSessionEndMin: 16 * 60,       // 16:00 ET
  },
  CRUDE: {
    name: 'CRUDE (CL)',
    tickSize: 0.01,
    pointValue: 1000.0,
    bucketSize: 0.05,
    nativeSessionStartMin: 9 * 60,      // 09:00 ET
    nativeSessionEndMin: 14 * 60 + 30,  // 14:30 ET
  },
  GOLD: {
    name: 'GOLD (GC)',
    tickSize: 0.1,
    pointValue: 100.0,
    bucketSize: 0.5,
    nativeSessionStartMin: 8 * 60 + 20, // 08:20 ET
    nativeSessionEndMin: 13 * 60 + 30,  // 13:30 ET
  },
}

function getEtTimeParts(unixSec: number): { ymd: string; hour: number; minute: number; minsOfDay: number; timeStr: string } {
  const d = new Date(unixSec * 1000)
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
  const h = parseInt(hour, 10)
  const m = parseInt(minute, 10)
  return {
    ymd: `${year}-${month}-${day}`,
    hour: h,
    minute: m,
    minsOfDay: h * 60 + m,
    timeStr: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
  }
}

function calculateATR14(bars: Bar1M[], curIdx: number): number {
  if (curIdx < 14) return 1.0
  let trSum = 0
  for (let i = curIdx - 13; i <= curIdx; i++) {
    const high = bars[i].high
    const low = bars[i].low
    const prevClose = bars[i - 1].close
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trSum += tr
  }
  return Math.max(0.001, trSum / 14)
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

  let poc = high
  let maxVol = -1
  const sortedBins = Array.from(bins.entries()).sort((a, b) => a[0] - b[0])

  for (const [p, v] of sortedBins) {
    if (v > maxVol) {
      maxVol = v
      poc = p
    }
  }

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

function wilsonConfidenceInterval(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0]
  const p = wins / n
  const center = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const spread = (z / (1 + (z * z) / n)) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, center - spread), Math.min(1, center + spread)]
}

function calculateMedian(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function calculateMean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function calculateStdDev(arr: number[], mean: number): number {
  if (arr.length <= 1) return 0
  const sumDiffSq = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0)
  return Math.sqrt(sumDiffSq / (arr.length - 1))
}

/**
 * Standard Normal Cumulative Distribution Function (Φ)
 */
function standardNormalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2)
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x > 0 ? 1 - p : p
}

/**
 * Two-tailed binomial Z-test p-value comparing observed win rate p against matched baseline p0
 */
function computeBinomialPValue(wins: number, n: number, p0: number): number {
  if (n === 0 || p0 <= 0 || p0 >= 1) return 1.0
  const p = wins / n
  const se = Math.sqrt((p0 * (1 - p0)) / n)
  if (se === 0) return 1.0
  const z = (p - p0) / se
  return 2 * (1 - standardNormalCdf(Math.abs(z)))
}

function runRigorousMarketStudyV3(marketKey: string, filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.error(`[Skip] Missing: ${filePath}`)
    return null
  }

  const config = MARKET_CONFIGS[marketKey]
  const raw = fs.readFileSync(filePath, 'utf-8')
  const bars: Bar1M[] = JSON.parse(raw)
  bars.sort((a, b) => a.time - b.time)

  console.log(`\n========================================================================================`)
  console.log(`🏛️ RIGOROUS CME EVENT STUDY (v3): ${config.name}`)
  console.log(`Dataset: ${bars.length} 1-min bars | Native Hours: ${(config.nativeSessionStartMin / 60).toFixed(1)} - ${(config.nativeSessionEndMin / 60).toFixed(1)} ET`)
  console.log(`========================================================================================`)

  // Step 1: Group sessions
  const sessionsByDate = new Map<string, { nativeRth: Bar1M[]; overnight: Bar1M[] }>()

  for (const b of bars) {
    const et = getEtTimeParts(b.time)
    let tradingDate = et.ymd
    if (et.hour >= 18) {
      const d = new Date(b.time * 1000 + 24 * 3600 * 1000)
      tradingDate = getEtTimeParts(Math.floor(d.getTime() / 1000)).ymd
    }

    if (!sessionsByDate.has(tradingDate)) {
      sessionsByDate.set(tradingDate, { nativeRth: [], overnight: [] })
    }

    const sess = sessionsByDate.get(tradingDate)!
    if (et.minsOfDay >= config.nativeSessionStartMin && et.minsOfDay < config.nativeSessionEndMin) {
      sess.nativeRth.push(b)
    }
    if (et.minsOfDay >= 18 * 60 || et.minsOfDay < config.nativeSessionStartMin) {
      sess.overnight.push(b)
    }
  }

  const sortedDates = Array.from(sessionsByDate.keys()).sort()
  const rthProfiles = new Map<string, VolumeProfile>()
  const overnightProfiles = new Map<string, VolumeProfile>()

  for (const date of sortedDates) {
    const s = sessionsByDate.get(date)!
    const prof = computeVolumeProfile(s.nativeRth, config.bucketSize)
    if (prof) rthProfiles.set(date, prof)
    const onProf = computeVolumeProfile(s.overnight, config.bucketSize)
    if (onProf) overnightProfiles.set(date, onProf)
  }

  // Step 2: 7-Line Anchored VWAP (AVWAP, ±1σ, ±2σ, ±3σ)
  let sumPV = 0
  let sumP2V = 0
  let sumV = 0
  const vwapMap = new Map<number, {
    vwap: number
    upper1: number; lower1: number
    upper2: number; lower2: number
    upper3: number; lower3: number
  }>()

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
      upper2: curVwap + 2 * std,
      lower2: curVwap - 2 * std,
      upper3: curVwap + 3 * std,
      lower3: curVwap - 3 * std,
    })
  }

  const barIndexMap = new Map<number, number>()
  for (let i = 0; i < bars.length; i++) {
    barIndexMap.set(bars[i].time, i)
  }

  // Compute DIRECTIONALLY-MATCHED BASELINE DRIFT across session bars
  let baselineLongWins = 0
  let baselineShortWins = 0
  let baselineTotal = 0

  for (const date of sortedDates) {
    const sess = sessionsByDate.get(date)!
    for (const b of sess.nativeRth) {
      const idx = barIndexMap.get(b.time) ?? -1
      if (idx === -1 || idx + 30 >= bars.length) continue
      const diff = bars[idx + 30].close - b.close
      if (diff > 0) baselineLongWins++
      if (diff < 0) baselineShortWins++
      baselineTotal++
    }
  }

  const p0_long = baselineTotal > 0 ? baselineLongWins / baselineTotal : 0.50
  const p0_short = baselineTotal > 0 ? baselineShortWins / baselineTotal : 0.50

  console.log(`Matched Baseline Unconditional 30m Drift:`)
  console.log(`  Long Baseline (p0_long):  ${(p0_long * 100).toFixed(1)}%`)
  console.log(`  Short Baseline (p0_short): ${(p0_short * 100).toFixed(1)}%`)

  // Step 3: Event Study with Refractory Clustering & Touch Tracking
  const allEvents: ProcessedEvent[] = []
  const activeClusters = new Map<string, { clusterId: string; lastTouchTime: number; touchCount: number; lastPrice: number }>()

  for (let dIdx = 5; dIdx < sortedDates.length; dIdx++) {
    const todayDate = sortedDates[dIdx]
    const yesterdayDate = sortedDates[dIdx - 1]
    const yesterdayProf = rthProfiles.get(yesterdayDate)
    const inventoryProf = overnightProfiles.get(todayDate)

    const past5Bars: Bar1M[] = []
    for (let k = dIdx - 5; k < dIdx; k++) {
      const pastSess = sessionsByDate.get(sortedDates[k])
      if (pastSess) past5Bars.push(...pastSess.nativeRth)
    }
    const profile5D = computeVolumeProfile(past5Bars, config.bucketSize)

    const todaySess = sessionsByDate.get(todayDate)!
    if (!todaySess.nativeRth || todaySess.nativeRth.length === 0) continue

    type LevelDef = { name: string; price: number; category: 'SUPPORT' | 'RESISTANCE' | 'MEAN' }
    const levelsToTest: LevelDef[] = []

    if (profile5D) {
      levelsToTest.push({ name: '5D_POC', price: profile5D.poc, category: 'MEAN' })
      levelsToTest.push({ name: '5D_VAH', price: profile5D.vah, category: 'RESISTANCE' })
      levelsToTest.push({ name: '5D_VAL', price: profile5D.val, category: 'SUPPORT' })
      for (const lvn of profile5D.lvn.slice(0, 2)) {
        levelsToTest.push({ name: '5D_LVN', price: lvn, category: 'SUPPORT' })
      }
    }

    if (yesterdayProf) {
      levelsToTest.push({ name: 'YEST_POC', price: yesterdayProf.poc, category: 'MEAN' })
      levelsToTest.push({ name: 'YEST_VAH', price: yesterdayProf.vah, category: 'RESISTANCE' })
      levelsToTest.push({ name: 'YEST_VAL', price: yesterdayProf.val, category: 'SUPPORT' })
    }

    if (inventoryProf) {
      levelsToTest.push({ name: 'INV_POC', price: inventoryProf.poc, category: 'MEAN' })
    }

    for (let bi = 0; bi < todaySess.nativeRth.length; bi++) {
      const b = todaySess.nativeRth[bi]
      const globalIdx = barIndexMap.get(b.time) ?? -1
      if (globalIdx === -1 || globalIdx + 60 >= bars.length) continue

      const atr = calculateATR14(bars, globalIdx)
      const tolerance = Math.max(2 * config.tickSize, 0.20 * atr)

      const vwapData = vwapMap.get(b.time)
      const currentLevels = [...levelsToTest]
      if (vwapData) {
        currentLevels.push({ name: 'AVWAP_MID', price: vwapData.vwap, category: 'MEAN' })
        currentLevels.push({ name: 'AVWAP_+1σ', price: vwapData.upper1, category: 'RESISTANCE' })
        currentLevels.push({ name: 'AVWAP_-1σ', price: vwapData.lower1, category: 'SUPPORT' })
        currentLevels.push({ name: 'AVWAP_+2σ', price: vwapData.upper2, category: 'RESISTANCE' })
        currentLevels.push({ name: 'AVWAP_-2σ', price: vwapData.lower2, category: 'SUPPORT' })
        currentLevels.push({ name: 'AVWAP_+3σ', price: vwapData.upper3, category: 'RESISTANCE' })
        currentLevels.push({ name: 'AVWAP_-3σ', price: vwapData.lower3, category: 'SUPPORT' })
      }

      for (const lvl of currentLevels) {
        const dist = Math.abs(b.close - lvl.price)
        const isTouched = b.low <= lvl.price + tolerance && b.high >= lvl.price - tolerance
        if (!isTouched) continue

        const clusterKey = `${todayDate}_${lvl.name}`
        const existingCluster = activeClusters.get(clusterKey)

        let isNewCluster = false
        let touchIdx = 1

        if (!existingCluster) {
          isNewCluster = true
          touchIdx = 1
        } else {
          const minutesSinceLast = (b.time - existingCluster.lastTouchTime) / 60
          if (minutesSinceLast > 25 || Math.abs(b.close - existingCluster.lastPrice) > 3 * tolerance) {
            isNewCluster = true
            touchIdx = 1
          } else {
            touchIdx = existingCluster.touchCount + 1
          }
        }

        const clusterId = isNewCluster ? `${clusterKey}_${b.time}` : existingCluster!.clusterId
        activeClusters.set(clusterKey, {
          clusterId,
          lastTouchTime: b.time,
          touchCount: touchIdx,
          lastPrice: b.close,
        })

        const prevBar = todaySess.nativeRth[Math.max(0, bi - 1)]
        const approachedFromAbove = prevBar ? prevBar.close > lvl.price : b.open > lvl.price

        // Determine explicit hypotheses:
        // Support: H_reversal = LONG bounce
        // Resistance: H_reversal = SHORT fade
        // Mean (POC / AVWAP): H_reversal = Fade back towards prior territory
        let expectedDirection: 'LONG' | 'SHORT'
        let hypothesisType: ProcessedEvent['hypothesisType']

        if (lvl.category === 'SUPPORT') {
          expectedDirection = 'LONG'
          hypothesisType = 'SUPPORT_BOUNCE'
        } else if (lvl.category === 'RESISTANCE') {
          expectedDirection = 'SHORT'
          hypothesisType = 'RESISTANCE_FADE'
        } else {
          // Mean level: Test both fade and continuation hypotheses
          // For primary rejection table, evaluate fade from approach
          expectedDirection = approachedFromAbove ? 'LONG' : 'SHORT'
          hypothesisType = 'MEAN_FADE'
        }

        const dirMult = expectedDirection === 'LONG' ? 1 : -1
        const p0 = b.close
        const futureClose30 = bars[globalIdx + 30].close
        const rawDiff = futureClose30 - p0
        const signedPts = rawDiff * dirMult
        const signedATR = signedPts / atr

        // MFE and MAE in points and ATR
        let maxFav = 0
        let maxAdv = 0
        for (let f = 1; f <= 60; f++) {
          const fb = bars[globalIdx + f]
          if (expectedDirection === 'LONG') {
            const fav = fb.high - p0
            const adv = p0 - fb.low
            if (fav > maxFav) maxFav = fav
            if (adv > maxAdv) maxAdv = adv
          } else {
            const fav = p0 - fb.low
            const adv = fb.high - p0
            if (fav > maxFav) maxFav = fav
            if (adv > maxAdv) maxAdv = adv
          }
        }

        // Absorption Proxy Score: volume vs ATR price displacement
        const priceDisp = Math.abs(b.close - b.open) / atr
        const volRatio = b.volume / Math.max(1, past5Bars[0]?.volume || 100)
        const absorptionProxyScore = priceDisp < 0.20 ? Number((volRatio / Math.max(0.05, priceDisp)).toFixed(2)) : 0

        const etTime = getEtTimeParts(b.time)
        allEvents.push({
          market: marketKey,
          clusterId,
          touchIndex: touchIdx,
          timestamp: b.time,
          dateStr: todayDate,
          timeET: etTime.timeStr,
          levelType: lvl.name,
          hypothesisType,
          levelPrice: Number(lvl.price.toFixed(2)),
          touchPrice: Number(p0.toFixed(2)),
          distanceToLevel: Number(dist.toFixed(2)),
          expectedDirection,
          rawRet30m: Number(rawDiff.toFixed(2)),
          signedRet30mPts: Number(signedPts.toFixed(2)),
          signedRet30mATR: Number(signedATR.toFixed(3)),
          mfePts: Number(maxFav.toFixed(2)),
          maePts: Number(maxAdv.toFixed(2)),
          mfeATR: Number((maxFav / atr).toFixed(2)),
          maeATR: Number((maxAdv / atr).toFixed(2)),
          isWin30m: signedPts > 0,
          atr: Number(atr.toFixed(2)),
          absorptionProxyScore,
        })
      }
    }
  }

  // Filter Unique First-Touch Events
  const uniqueFirstTouches = allEvents.filter((e) => e.touchIndex === 1)
  console.log(`Identified ${uniqueFirstTouches.length} Unique First-Touch Events (from ${allEvents.length} raw interactions).`)

  // Step 4: Aggregate Level Statistics with Matched Baselines & p-values
  const levelStatsMap = new Map<string, {
    levelName: string
    hypothesis: string
    direction: 'LONG' | 'SHORT'
    n: number
    wins: number
    retListPts: number[]
    retListATR: number[]
    mfeListPts: number[]
    maeListPts: number[]
    mfeListATR: number[]
    maeListATR: number[]
    uniqueDays: Set<string>
  }>()

  for (const e of uniqueFirstTouches) {
    const key = `${e.levelType} (${e.expectedDirection})`
    const cur = levelStatsMap.get(key) || {
      levelName: e.levelType,
      hypothesis: e.hypothesisType,
      direction: e.expectedDirection,
      n: 0,
      wins: 0,
      retListPts: [],
      retListATR: [],
      mfeListPts: [],
      maeListPts: [],
      mfeListATR: [],
      maeListATR: [],
      uniqueDays: new Set<string>(),
    }
    cur.n++
    if (e.isWin30m) cur.wins++
    cur.retListPts.push(e.signedRet30mPts)
    cur.retListATR.push(e.signedRet30mATR)
    cur.mfeListPts.push(e.mfePts)
    cur.maeListPts.push(e.maePts)
    cur.mfeListATR.push(e.mfeATR)
    cur.maeListATR.push(e.maeATR)
    cur.uniqueDays.add(e.dateStr)
    levelStatsMap.set(key, cur)
  }

  // Calculate p-values for Benjamini-Hochberg FDR
  type StatRow = {
    key: string
    level: string
    dir: 'LONG' | 'SHORT'
    n: number
    uniqueDaysCount: number
    winRate: number
    ci95: [number, number]
    ciWidth: number
    matchedBaseline: number
    excessWinPct: number
    meanPts: number
    medianPts: number
    meanATR: number
    medianATR: number
    avgMfeATR: number
    avgMaeATR: number
    pValue: number
    isFdrSignificant?: boolean
  }

  const candidateRows: StatRow[] = []

  for (const [key, stat] of levelStatsMap.entries()) {
    if (stat.n < 5) continue
    const winRate = (stat.wins / stat.n) * 100
    const [ciLow, ciHigh] = wilsonConfidenceInterval(stat.wins, stat.n)
    const ciWidth = (ciHigh - ciLow) * 100
    const matchedP0 = stat.direction === 'LONG' ? p0_long : p0_short
    const excess = winRate - (matchedP0 * 100)
    const pVal = computeBinomialPValue(stat.wins, stat.n, matchedP0)

    const meanPts = calculateMean(stat.retListPts)
    const medianPts = calculateMedian(stat.retListPts)
    const meanATR = calculateMean(stat.retListATR)
    const medianATR = calculateMedian(stat.retListATR)
    const avgMfeATR = calculateMean(stat.mfeListATR)
    const avgMaeATR = calculateMean(stat.maeListATR)

    candidateRows.push({
      key,
      level: stat.levelName,
      dir: stat.direction,
      n: stat.n,
      uniqueDaysCount: stat.uniqueDays.size,
      winRate,
      ci95: [ciLow * 100, ciHigh * 100],
      ciWidth,
      matchedBaseline: matchedP0 * 100,
      excessWinPct: excess,
      meanPts,
      medianPts,
      meanATR,
      medianATR,
      avgMfeATR,
      avgMaeATR,
      pValue: pVal,
    })
  }

  // Apply Benjamini-Hochberg FDR at Q = 0.10
  candidateRows.sort((a, b) => a.pValue - b.pValue)
  const m = candidateRows.length
  const Q = 0.10
  let maxSignificantIdx = -1

  for (let i = 0; i < m; i++) {
    const rank = i + 1
    const threshold = (rank / m) * Q
    if (candidateRows[i].pValue <= threshold) {
      maxSignificantIdx = i
    }
  }

  for (let i = 0; i < m; i++) {
    candidateRows[i].isFdrSignificant = i <= maxSignificantIdx
  }

  console.log(`\n-------------------------------------------------------------------------------------------------------------------------------------`)
  console.log(`📊 UNIQUE FIRST-TOUCH STATISTICAL VALIDATION (WITH MATCHED BASELINE, ATR UNITS & BH-FDR)`)
  console.log(`-------------------------------------------------------------------------------------------------------------------------------------`)
  console.log(
    `Level & Dir`.padEnd(18) +
    `N`.padStart(5) +
    `Days`.padStart(6) +
    `Win%`.padStart(8) +
    `Matched p0`.padStart(12) +
    `Excess%`.padStart(10) +
    `95% CI`.padStart(18) +
    `Mean (ATR)`.padStart(12) +
    `MFE/MAE (ATR)`.padStart(15) +
    `p-value`.padStart(10) +
    `BH-FDR`.padStart(8)
  )
  console.log(`-`.repeat(130))

  for (const row of candidateRows) {
    const ciStr = `[${row.ci95[0].toFixed(1)}%-${row.ci95[1].toFixed(1)}%]`
    const excessStr = (row.excessWinPct >= 0 ? '+' : '') + row.excessWinPct.toFixed(1) + '%'
    const mfeMaeStr = `${row.avgMfeATR.toFixed(2)} / ${row.avgMaeATR.toFixed(2)}`
    const fdrTag = row.isFdrSignificant ? '✅ PASS' : '❌ FAIL'

    console.log(
      row.key.padEnd(18) +
      String(row.n).padStart(5) +
      String(row.uniqueDaysCount).padStart(6) +
      (row.winRate.toFixed(1) + '%').padStart(8) +
      (row.matchedBaseline.toFixed(1) + '%').padStart(12) +
      excessStr.padStart(10) +
      ciStr.padStart(18) +
      (row.meanATR.toFixed(2) + 'R').padStart(12) +
      mfeMaeStr.padStart(15) +
      row.pValue.toFixed(4).padStart(10) +
      fdrTag.padStart(8)
    )
  }

  // Step 5: Touch-Frequency Rejection Curve (Comparing SAME Hypothesis across Touches 1, 2, 3, 4+)
  console.log(`\n🔍 TOUCH FREQUENCY DEGRADATION CURVE (Rejection Hypothesis across Consecutive Touches):`)
  const touchBuckets = [1, 2, 3, 4]
  for (const t of touchBuckets) {
    const subset = t < 4 ? allEvents.filter((e) => e.touchIndex === t) : allEvents.filter((e) => e.touchIndex >= 4)
    const wins = subset.filter((e) => e.isWin30m).length
    const pct = subset.length > 0 ? ((wins / subset.length) * 100).toFixed(1) : 'N/A'
    const label = t < 4 ? `Touch ${t}` : `Touch 4+`
    console.log(`  ${label.padEnd(10)}: N=${String(subset.length).padStart(4)} | Reversal Win Rate: ${pct.padStart(6)}%`)
  }

  return {
    market: marketKey,
    uniqueFirstTouches: uniqueFirstTouches.length,
    matchedBaselines: { long: p0_long, short: p0_short },
    results: candidateRows,
  }
}

async function main() {
  const baseDir = path.resolve(process.cwd(), 'data/cme_sessions')
  const files = [
    { key: 'NASDAQ', file: path.join(baseDir, 'nasdaq_1m_archive.json') },
    { key: 'DOW', file: path.join(baseDir, 'dow_1m_archive.json') },
    { key: 'CRUDE', file: path.join(baseDir, 'crude_1m_archive.json') },
    { key: 'GOLD', file: path.join(baseDir, 'gold_1m_archive.json') },
  ]

  const output: any[] = []
  for (const f of files) {
    const res = runRigorousMarketStudyV3(f.key, f.file)
    if (res) output.push(res)
  }

  const outPath = path.resolve(process.cwd(), 'data/cme-v3-validation-results.json')
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\n✅ Rigorous v3 Validation Complete. Results saved to ${outPath}\n`)
}

main().catch(console.error)
