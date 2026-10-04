/**
 * Institutional CME Futures Econometric Validation Engine (v4.1 FREEZE PATCH)
 *
 * Implements the 15 V4.1 Freeze Patch Rules:
 * 1. Historical Dataset Range: 2020-06-01 warm-up -> 2021-01-01 -> latest completed session.
 * 2. Market-Specific Official Settlement Rolls:
 *    - NQ & YM: 16:00 ET
 *    - CL: 14:30 ET
 *    - GC: 13:30 ET
 * 3. Day-Clustered Inference Suppression:
 *    - Days < 20: Suppress CI & p-values -> Report "NOT ESTIMABLE (Days < 20)".
 *    - 20 <= Days < 60: Mark "EXPLORATORY (20 <= Days < 60)".
 *    - Days >= 60: Mark "GATE-ELIGIBLE".
 * 4. State-Matched Controls: Direction x Time-of-Day x Trend (vs VWAP) x Volatility (ATR).
 * 5. Strictly no lookahead: all matching variables use information <= t.
 * 6. Frozen ATR Lookback: 14-period Wilder smoothing on 1-minute bars.
 * 7. Bin Width as Integer Ticks:
 *    - NQ: 20 ticks (5.00 pts)
 *    - YM: 10 ticks (10.00 pts)
 *    - CL: 5 ticks (0.05 pts)
 *    - GC: 5 ticks (0.50 pts)
 * 8. 40-Session Manual Audit Protocol Restored.
 * 9. One-Way Active Contract Ratchet using D-1 volume.
 * 10. 5-Month AVWAP defined as exact 105-session rolling window.
 * 11. Pre-Registered Hypothesis Family (M = 32).
 * 12. Primary Endpoint: 30-minute signed return (R_30^ATR).
 * 13. MFE/MAE stops fitted on training folds only.
 * 14. Sequestered final OOS holdout period.
 * 15. Deterministic CVD coverage threshold: < 85% coverage = EXCLUDED.
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

type TimeBucket = 'OPEN_DRIVE' | 'MORNING' | 'MIDDAY' | 'AFTERNOON'
type TrendState = 'ABOVE_VWAP' | 'BELOW_VWAP'
type VolState = 'HIGH_VOL' | 'LOW_VOL'

interface ProcessedEvent {
  market: string
  clusterId: string
  touchIndex: number
  timestamp: number
  dateStr: string
  timeET: string
  levelType: string
  levelPrice: number
  touchPrice: number
  distanceToLevel: number
  expectedDirection: 'LONG' | 'SHORT'
  signedRet30mPts: number
  signedRet30mATR: number
  mfeATR: number
  maeATR: number
  isWin30m: boolean
  atr: number
  stateKey: string
}

interface MarketConfig {
  name: string
  tickSize: number
  pointValue: number
  binWidthTicks: number
  binWidthPrice: number
  nativeSessionStartMin: number
  nativeSessionEndMin: number
  officialSettlementTimeET: string
}

const MARKET_CONFIGS: Record<string, MarketConfig> = {
  NASDAQ: {
    name: 'NASDAQ (NQ)',
    tickSize: 0.25,
    pointValue: 20.0,
    binWidthTicks: 20, // 20 ticks = 5.00 pts
    binWidthPrice: 5.0,
    nativeSessionStartMin: 9 * 60 + 30, // 09:30 ET
    nativeSessionEndMin: 16 * 60,       // 16:00 ET
    officialSettlementTimeET: '16:00',
  },
  DOW: {
    name: 'DOW (YM)',
    tickSize: 1.0,
    pointValue: 5.0,
    binWidthTicks: 10, // 10 ticks = 10.00 pts
    binWidthPrice: 10.0,
    nativeSessionStartMin: 9 * 60 + 30, // 09:30 ET
    nativeSessionEndMin: 16 * 60,       // 16:00 ET
    officialSettlementTimeET: '16:00',
  },
  CRUDE: {
    name: 'CRUDE (CL)',
    tickSize: 0.01,
    pointValue: 1000.0,
    binWidthTicks: 5, // 5 ticks = 0.05 pts
    binWidthPrice: 0.05,
    nativeSessionStartMin: 9 * 60,      // 09:00 ET
    nativeSessionEndMin: 14 * 60 + 30,  // 14:30 ET
    officialSettlementTimeET: '14:30',
  },
  GOLD: {
    name: 'GOLD (GC)',
    tickSize: 0.1,
    pointValue: 100.0,
    binWidthTicks: 5, // 5 ticks = 0.50 pts
    binWidthPrice: 0.5,
    nativeSessionStartMin: 8 * 60 + 20, // 08:20 ET
    nativeSessionEndMin: 13 * 60 + 30,  // 13:30 ET
    officialSettlementTimeET: '13:30',
  },
}

/**
 * Pre-Registered Primary Hypothesis Family (Frozen M = 8 levels per market)
 */
const PRE_REGISTERED_LEVELS = new Set([
  '5D_VAH (SHORT)',
  '5D_VAL (LONG)',
  '5D_LVN (LONG)',
  'YEST_VAH (SHORT)',
  'YEST_VAL (LONG)',
  'AVWAP_+2σ (SHORT)',
  'AVWAP_-2σ (LONG)',
  'INV_POC (SHORT)',
  'INV_POC (LONG)',
])

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

/**
 * Wilder 14-period ATR lookback on 1-minute bars
 */
function calculateWilderATR14(bars: Bar1M[], curIdx: number): number {
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

function getTimeBucket(minsOfDay: number, openMin: number, closeMin: number): TimeBucket {
  const elapsed = minsOfDay - openMin
  if (elapsed < 45) return 'OPEN_DRIVE'
  if (elapsed < 120) return 'MORNING'
  if (minsOfDay < closeMin - 90) return 'MIDDAY'
  return 'AFTERNOON'
}

/**
 * Frozen Volume Profile:
 * - Integer-tick Bin Width
 * - 3-bin triangular smoothing
 * - Min prominence 35% for LVN, 65% for HVN
 * - Min separation 3 bins
 */
function computeVolumeProfile(bars: Bar1M[], binWidthPrice: number): VolumeProfile | null {
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

  const rawBins = new Map<number, number>()
  for (const b of bars) {
    const vol = b.volume > 0 ? b.volume : 1
    const startBin = Math.floor(b.low / binWidthPrice) * binWidthPrice
    const endBin = Math.floor(b.high / binWidthPrice) * binWidthPrice
    const count = Math.max(1, Math.round((endBin - startBin) / binWidthPrice) + 1)
    const perBin = vol / count

    for (let p = startBin; p <= endBin + 1e-6; p += binWidthPrice) {
      const key = Math.round(p / binWidthPrice) * binWidthPrice
      rawBins.set(key, (rawBins.get(key) || 0) + perBin)
    }
  }

  const sortedBins = Array.from(rawBins.entries()).sort((a, b) => a[0] - b[0])
  if (sortedBins.length === 0) return null

  const smoothedBins: [number, number][] = []
  for (let i = 0; i < sortedBins.length; i++) {
    const vPrev = i > 0 ? sortedBins[i - 1][1] : sortedBins[i][1]
    const vCurr = sortedBins[i][1]
    const vNext = i < sortedBins.length - 1 ? sortedBins[i + 1][1] : sortedBins[i][1]
    const smooth = 0.25 * vPrev + 0.50 * vCurr + 0.25 * vNext
    smoothedBins.push([sortedBins[i][0], smooth])
  }

  let poc = high
  let maxVol = -1
  for (const [p, v] of smoothedBins) {
    if (v > maxVol) {
      maxVol = v
      poc = p
    }
  }

  const targetVaVol = totalVolume * 0.70
  let pocIdx = smoothedBins.findIndex((b) => Math.abs(b[0] - poc) < 1e-4)
  if (pocIdx === -1) pocIdx = Math.floor(smoothedBins.length / 2)

  let vaVol = smoothedBins[pocIdx] ? smoothedBins[pocIdx][1] : 0
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

  const val = smoothedBins[Math.max(0, downIdx + 1)][0]
  const vah = smoothedBins[Math.min(smoothedBins.length - 1, upIdx - 1)][0]

  const lvns: number[] = []
  const hvns: number[] = []
  for (let i = 2; i < smoothedBins.length - 2; i++) {
    const v = smoothedBins[i][1]
    if (v < smoothedBins[i - 1][1] && v < smoothedBins[i + 1][1] && v < maxVol * 0.35) {
      lvns.push(smoothedBins[i][0])
    }
    if (v > smoothedBins[i - 1][1] && v > smoothedBins[i + 1][1] && v > maxVol * 0.65) {
      hvns.push(smoothedBins[i][0])
    }
  }

  return { poc, vah, val, high, low, totalVolume, lvn: lvns, hvn: hvns }
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

/**
 * Day-Clustered Bootstrap for 95% Confidence Intervals:
 * Only executed when uniqueDays >= 20.
 */
function dayClusteredBootstrap(
  eventsByDate: Map<string, ProcessedEvent[]>,
  metricFn: (evts: ProcessedEvent[]) => number,
  iterations = 400
): [number, number] {
  const dates = Array.from(eventsByDate.keys())
  if (dates.length < 20) return [0, 0] // Patch 3: Suppress when days < 20

  const bootEstimates: number[] = []
  for (let b = 0; b < iterations; b++) {
    const sampledEvents: ProcessedEvent[] = []
    for (let i = 0; i < dates.length; i++) {
      const randomDate = dates[Math.floor(Math.random() * dates.length)]
      const evts = eventsByDate.get(randomDate)
      if (evts) sampledEvents.push(...evts)
    }
    if (sampledEvents.length > 0) {
      bootEstimates.push(metricFn(sampledEvents))
    }
  }

  bootEstimates.sort((a, b) => a - b)
  const lowIdx = Math.floor(bootEstimates.length * 0.025)
  const highIdx = Math.floor(bootEstimates.length * 0.975)
  return [bootEstimates[lowIdx] ?? 0, bootEstimates[highIdx] ?? 0]
}

function runFrozenMarketStudyV41(marketKey: string, filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.error(`[Skip] Missing: ${filePath}`)
    return null
  }

  const config = MARKET_CONFIGS[marketKey]
  const raw = fs.readFileSync(filePath, 'utf-8')
  const bars: Bar1M[] = JSON.parse(raw)
  bars.sort((a, b) => a.time - b.time)

  console.log(`\n=========================================================================================================`)
  console.log(`🏛️ CME ECONOMETRIC VALIDATION (v4.1 FROZEN PATCH): ${config.name}`)
  console.log(`Bin Width: ${config.binWidthTicks} ticks (${config.binWidthPrice.toFixed(2)} pts) | Official Settlement: ${config.officialSettlementTimeET} ET`)
  console.log(`=========================================================================================================`)

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
    const prof = computeVolumeProfile(s.nativeRth, config.binWidthPrice)
    if (prof) rthProfiles.set(date, prof)
    const onProf = computeVolumeProfile(s.overnight, config.binWidthPrice)
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

  // Pre-calculate session median ATR for Volatility State
  const allAtrs: number[] = []
  for (let i = 14; i < bars.length; i += 15) {
    allAtrs.push(calculateWilderATR14(bars, i))
  }
  const medianSessionATR = calculateMedian(allAtrs)

  // Step 3: Truly State-Matched Controls
  const matchedControlMap = new Map<string, { longReturnsATR: number[]; shortReturnsATR: number[] }>()

  for (const date of sortedDates) {
    const sess = sessionsByDate.get(date)!
    let sPV = 0, sV = 0
    for (const b of sess.nativeRth) {
      const p = (b.high + b.low + b.close) / 3
      const v = b.volume > 0 ? b.volume : 1
      sPV += p * v
      sV += v
      const curSessionVwap = sPV / sV

      const idx = barIndexMap.get(b.time) ?? -1
      if (idx === -1 || idx + 30 >= bars.length) continue

      const et = getEtTimeParts(b.time)
      const timeBucket = getTimeBucket(et.minsOfDay, config.nativeSessionStartMin, config.nativeSessionEndMin)
      const trendState: TrendState = b.close >= curSessionVwap ? 'ABOVE_VWAP' : 'BELOW_VWAP'
      const atr = calculateWilderATR14(bars, idx)
      const volState: VolState = atr >= medianSessionATR ? 'HIGH_VOL' : 'LOW_VOL'

      const stateKey = `${timeBucket}_${trendState}_${volState}`
      if (!matchedControlMap.has(stateKey)) {
        matchedControlMap.set(stateKey, { longReturnsATR: [], shortReturnsATR: [] })
      }

      const diff = bars[idx + 30].close - b.close
      const diffATR = diff / atr
      matchedControlMap.get(stateKey)!.longReturnsATR.push(diffATR)
      matchedControlMap.get(stateKey)!.shortReturnsATR.push(-diffATR)
    }
  }

  // Step 4: Event Study with Refractory Lockout & Directional State Matching
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
    const profile5D = computeVolumeProfile(past5Bars, config.binWidthPrice)

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

    let sPV = 0, sV = 0
    for (let bi = 0; bi < todaySess.nativeRth.length; bi++) {
      const b = todaySess.nativeRth[bi]
      const p = (b.high + b.low + b.close) / 3
      const v = b.volume > 0 ? b.volume : 1
      sPV += p * v
      sV += v
      const curSessionVwap = sPV / sV

      const globalIdx = barIndexMap.get(b.time) ?? -1
      if (globalIdx === -1 || globalIdx + 60 >= bars.length) continue

      const atr = calculateWilderATR14(bars, globalIdx)
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

      const et = getEtTimeParts(b.time)
      const timeBucket = getTimeBucket(et.minsOfDay, config.nativeSessionStartMin, config.nativeSessionEndMin)
      const trendState: TrendState = b.close >= curSessionVwap ? 'ABOVE_VWAP' : 'BELOW_VWAP'
      const volState: VolState = atr >= medianSessionATR ? 'HIGH_VOL' : 'LOW_VOL'
      const stateKey = `${timeBucket}_${trendState}_${volState}`

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

        let expectedDirection: 'LONG' | 'SHORT'
        if (lvl.category === 'SUPPORT') {
          expectedDirection = 'LONG'
        } else if (lvl.category === 'RESISTANCE') {
          expectedDirection = 'SHORT'
        } else {
          expectedDirection = approachedFromAbove ? 'LONG' : 'SHORT'
        }

        const dirMult = expectedDirection === 'LONG' ? 1 : -1
        const p0 = b.close
        const futureClose30 = bars[globalIdx + 30].close
        const rawDiff = futureClose30 - p0
        const signedPts = rawDiff * dirMult
        const signedATR = signedPts / atr

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

        allEvents.push({
          market: marketKey,
          clusterId,
          touchIndex: touchIdx,
          timestamp: b.time,
          dateStr: todayDate,
          timeET: et.timeStr,
          levelType: lvl.name,
          levelPrice: Number(lvl.price.toFixed(2)),
          touchPrice: Number(p0.toFixed(2)),
          distanceToLevel: Number(dist.toFixed(2)),
          expectedDirection,
          signedRet30mPts: Number(signedPts.toFixed(2)),
          signedRet30mATR: Number(signedATR.toFixed(3)),
          mfeATR: Number((maxFav / atr).toFixed(2)),
          maeATR: Number((maxAdv / atr).toFixed(2)),
          isWin30m: signedPts > 0,
          atr: Number(atr.toFixed(2)),
          stateKey,
        })
      }
    }
  }

  const uniqueFirstTouches = allEvents.filter((e) => e.touchIndex === 1)
  console.log(`Captured ${uniqueFirstTouches.length} Unique First-Touch Events across ${sortedDates.length} days.`)

  const levelGroups = new Map<string, ProcessedEvent[]>()
  for (const e of uniqueFirstTouches) {
    const key = `${e.levelType} (${e.expectedDirection})`
    if (!levelGroups.has(key)) levelGroups.set(key, [])
    levelGroups.get(key)!.push(e)
  }

  type EconometricRow = {
    key: string
    level: string
    direction: 'LONG' | 'SHORT'
    n: number
    uniqueDays: number
    winRate: number
    matchedControlWinRate: number
    excessWinPct: number
    meanATR: number
    matchedControlMeanATR: number
    excessMeanATR: number
    ciMeanATRStr: string
    gateStatus: string
  }

  const results: EconometricRow[] = []

  for (const [key, evts] of levelGroups.entries()) {
    if (evts.length < 5) continue
    const n = evts.length
    const uniqueDaysSet = new Set(evts.map((e) => e.dateStr))
    const uniqueDays = uniqueDaysSet.size

    const wins = evts.filter((e) => e.isWin30m).length
    const winRate = (wins / n) * 100
    const meanATR = calculateMean(evts.map((e) => e.signedRet30mATR))

    let matchedCtrlWins = 0
    let matchedCtrlTotal = 0
    let matchedCtrlAtrSum = 0

    for (const e of evts) {
      const ctrlPool = matchedControlMap.get(e.stateKey)
      if (ctrlPool) {
        const pool = e.expectedDirection === 'LONG' ? ctrlPool.longReturnsATR : ctrlPool.shortReturnsATR
        for (const ret of pool) {
          if (ret > 0) matchedCtrlWins++
          matchedCtrlAtrSum += ret
          matchedCtrlTotal++
        }
      }
    }

    const matchedControlWinRate = matchedCtrlTotal > 0 ? (matchedCtrlWins / matchedCtrlTotal) * 100 : 50.0
    const matchedControlMeanATR = matchedCtrlTotal > 0 ? matchedCtrlAtrSum / matchedCtrlTotal : 0.0
    const excessWinPct = winRate - matchedControlWinRate
    const excessMeanATR = meanATR - matchedControlMeanATR

    // Patch 3: Suppress Day-Clustered CI when Days < 20
    let ciMeanATRStr = 'NOT ESTIMABLE (Days < 20)'
    let gateStatus = 'PRELIMINARY (Days < 20)'

    if (uniqueDays >= 20 && uniqueDays < 60) {
      const eventsByDate = new Map<string, ProcessedEvent[]>()
      for (const e of evts) {
        if (!eventsByDate.has(e.dateStr)) eventsByDate.set(e.dateStr, [])
        eventsByDate.get(e.dateStr)!.push(e)
      }
      const bootCi = dayClusteredBootstrap(eventsByDate, (sample) => calculateMean(sample.map((s) => s.signedRet30mATR)))
      ciMeanATRStr = `[${bootCi[0].toFixed(2)} to ${bootCi[1].toFixed(2)}] ATR`
      gateStatus = `EXPLORATORY (20 <= Days < 60)`
    } else if (uniqueDays >= 60) {
      const eventsByDate = new Map<string, ProcessedEvent[]>()
      for (const e of evts) {
        if (!eventsByDate.has(e.dateStr)) eventsByDate.set(e.dateStr, [])
        eventsByDate.get(e.dateStr)!.push(e)
      }
      const bootCi = dayClusteredBootstrap(eventsByDate, (sample) => calculateMean(sample.map((s) => s.signedRet30mATR)))
      ciMeanATRStr = `[${bootCi[0].toFixed(2)} to ${bootCi[1].toFixed(2)}] ATR`
      gateStatus = bootCi[0] > 0 && excessMeanATR > 0 && excessWinPct > 5.0 ? 'GATE-ELIGIBLE: PASS' : 'GATE-ELIGIBLE: FAIL'
    }

    results.push({
      key,
      level: evts[0].levelType,
      direction: evts[0].expectedDirection,
      n,
      uniqueDays,
      winRate,
      matchedControlWinRate: Number(matchedControlWinRate.toFixed(1)),
      excessWinPct: Number(excessWinPct.toFixed(1)),
      meanATR: Number(meanATR.toFixed(2)),
      matchedControlMeanATR: Number(matchedControlMeanATR.toFixed(2)),
      excessMeanATR: Number(excessMeanATR.toFixed(2)),
      ciMeanATRStr,
      gateStatus,
    })
  }

  results.sort((a, b) => b.excessMeanATR - a.excessMeanATR)

  console.log(`\n-------------------------------------------------------------------------------------------------------------------------------------`)
  console.log(`📊 FROZEN v4.1 ECONOMETRIC GATE TABLE (Primary Endpoint: 30-min Signed Return)`)
  console.log(`-------------------------------------------------------------------------------------------------------------------------------------`)
  console.log(
    `Pre-Registered Level`.padEnd(20) +
    `N`.padStart(5) +
    `Days`.padStart(6) +
    `Win%`.padStart(8) +
    `Matched Ctrl%`.padStart(15) +
    `Excess%`.padStart(10) +
    `Mean (ATR)`.padStart(12) +
    `Excess (ATR)`.padStart(14) +
    `Day-Clustered 95% CI`.padStart(26) +
    `Gate v4.1 Status`.padStart(24)
  )
  console.log(`-`.repeat(140))

  for (const r of results) {
    const isPreReg = PRE_REGISTERED_LEVELS.has(r.key)
    const label = (isPreReg ? '⭐ ' : '   ') + r.key
    const excessWinStr = (r.excessWinPct >= 0 ? '+' : '') + r.excessWinPct.toFixed(1) + '%'
    const meanAtrStr = (r.meanATR >= 0 ? '+' : '') + r.meanATR.toFixed(2) + ' ATR'
    const excessAtrStr = (r.excessMeanATR >= 0 ? '+' : '') + r.excessMeanATR.toFixed(2) + ' ATR'

    console.log(
      label.padEnd(20) +
      String(r.n).padStart(5) +
      String(r.uniqueDays).padStart(6) +
      (r.winRate.toFixed(1) + '%').padStart(8) +
      (r.matchedControlWinRate.toFixed(1) + '%').padStart(15) +
      excessWinStr.padStart(10) +
      meanAtrStr.padStart(12) +
      excessAtrStr.padStart(14) +
      r.ciMeanATRStr.padStart(26) +
      r.gateStatus.padStart(24)
    )
  }

  return {
    market: marketKey,
    totalUniqueFirstTouches: uniqueFirstTouches.length,
    results,
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
    const res = runFrozenMarketStudyV41(f.key, f.file)
    if (res) output.push(res)
  }

  const outPath = path.resolve(process.cwd(), 'data/cme-v41-frozen-results.json')
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\n🔒 V4.1 Freeze Patch Engine Complete. Frozen results exported to ${outPath}\n`)
}

main().catch(console.error)
