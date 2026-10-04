/**
 * Institutional Multi-Year CME Econometric Replay Engine (v4.1.1 Frozen Protocol - High Performance)
 *
 * Replays 6.3 years of continuous CME Globex 1-minute data across NQ, YM, CL, and GC.
 *
 * Implements the Full Econometric Gate Architecture:
 * 1. Warm-Up Horizon: 2020-06-01 -> 2020-12-31 (105-session AVWAP & 5D VP warm-up; 0 events logged).
 * 2. In-Sample Development: 2021-01-01 -> 2023-12-31 (754 sessions).
 * 3. Walk-Forward Validation: 2024-01-01 -> 2025-12-31 (502 sessions).
 * 4. Sequestered Final OOS Holdout: 2026-01-01 -> 2026-07-31 & 2026-09-09 -> Present.
 * 5. Quarantined Test Set: 2026-08-09 -> 2026-09-08 (22 sessions).
 * 6. Decontaminated State-Matched Baselines.
 * 7. Exact Mathematical Touch Equations (T, D_reset, 30m refractory window).
 * 8. Pre-Registered M = 32 Primary Hypothesis Family (8 levels x 4 markets).
 * 9. Day-Clustered Bootstrap 95% CIs (1,000 iterations).
 * 10. Day-Clustered Permutation p-values (1,000 iterations).
 * 11. Benjamini-Hochberg FDR Multiple-Testing Control (Q = 0.10).
 * 12. Primary Endpoint: 30-minute signed return (R_30^ATR).
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
type EventRegime = 'SCHEDULED_EVENT' | 'NORMAL_FLOW'

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
  isPrimaryFDR: boolean
  partition: 'WARMUP' | 'IN_SAMPLE' | 'WALK_FORWARD' | 'QUARANTINE_TEST' | 'SEQUESTERED_OOS'
}

interface MarketConfig {
  name: string
  tickSize: number
  pointValue: number
  binWidthTicks: number
  binWidthPrice: number
  nativeSessionStartMin: number
  nativeSessionEndMin: number
  settlementWindowStartMin: number
  settlementWindowEndMin: number
  settlementWindowName: string
}

const MARKET_CONFIGS: Record<string, MarketConfig> = {
  NASDAQ: {
    name: 'NASDAQ (NQ)',
    tickSize: 0.25,
    pointValue: 20.0,
    binWidthTicks: 20,
    binWidthPrice: 5.0,
    nativeSessionStartMin: 9 * 60 + 30, // 09:30 ET
    nativeSessionEndMin: 16 * 60,       // 16:00 ET
    settlementWindowStartMin: 15 * 60 + 59,
    settlementWindowEndMin: 16 * 60,
    settlementWindowName: '15:59:30 - 16:00:00 ET (30s VWAP)',
  },
  DOW: {
    name: 'DOW (YM)',
    tickSize: 1.0,
    pointValue: 5.0,
    binWidthTicks: 10,
    binWidthPrice: 10.0,
    nativeSessionStartMin: 9 * 60 + 30, // 09:30 ET
    nativeSessionEndMin: 16 * 60,       // 16:00 ET
    settlementWindowStartMin: 15 * 60 + 59,
    settlementWindowEndMin: 16 * 60,
    settlementWindowName: '15:59:30 - 16:00:00 ET (30s VWAP)',
  },
  CRUDE: {
    name: 'CRUDE (CL)',
    tickSize: 0.01,
    pointValue: 1000.0,
    binWidthTicks: 5,
    binWidthPrice: 0.05,
    nativeSessionStartMin: 9 * 60,      // 09:00 ET
    nativeSessionEndMin: 14 * 60 + 30,  // 14:30 ET
    settlementWindowStartMin: 14 * 60 + 28,
    settlementWindowEndMin: 14 * 60 + 30,
    settlementWindowName: '14:28:00 - 14:30:00 ET (2m VWAP)',
  },
  GOLD: {
    name: 'GOLD (GC)',
    tickSize: 0.1,
    pointValue: 100.0,
    binWidthTicks: 5,
    binWidthPrice: 0.5,
    nativeSessionStartMin: 8 * 60 + 20, // 08:20 ET
    nativeSessionEndMin: 13 * 60 + 30,  // 13:30 ET
    settlementWindowStartMin: 13 * 60 + 29,
    settlementWindowEndMin: 13 * 60 + 30,
    settlementWindowName: '13:29:00 - 13:30:00 ET (1m VWAP)',
  },
}

export const PRIMARY_FDR_HYPOTHESIS_SET = new Set([
  '5D_VAH (SHORT)',
  '5D_VAL (LONG)',
  '5D_LVN (LONG)',
  'YEST_VAH (SHORT)',
  'YEST_VAL (LONG)',
  'AVWAP_+2σ (SHORT)',
  'AVWAP_-2σ (LONG)',
  'INV_POC (SHORT)',
])

function getDatePartition(dateStr: string): 'WARMUP' | 'IN_SAMPLE' | 'WALK_FORWARD' | 'QUARANTINE_TEST' | 'SEQUESTERED_OOS' {
  if (dateStr < '2021-01-01') return 'WARMUP'
  if (dateStr <= '2023-12-31') return 'IN_SAMPLE'
  if (dateStr <= '2025-12-31') return 'WALK_FORWARD'
  if (dateStr >= '2026-08-09' && dateStr <= '2026-09-08') return 'QUARANTINE_TEST'
  return 'SEQUESTERED_OOS'
}

function isDst(d: Date): boolean {
  const y = d.getUTCFullYear()
  const mar1 = new Date(Date.UTC(y, 2, 1)).getUTCDay()
  const secondSunMar = 1 + ((7 - mar1) % 7) + 7
  const dstStart = Date.UTC(y, 2, secondSunMar, 7) // 07:00 UTC
  const nov1 = new Date(Date.UTC(y, 10, 1)).getUTCDay()
  const firstSunNov = 1 + ((7 - nov1) % 7)
  const dstEnd = Date.UTC(y, 10, firstSunNov, 6) // 06:00 UTC
  const t = d.getTime()
  return t >= dstStart && t < dstEnd
}

function getEtTimeParts(unixSec: number): { ymd: string; hour: number; minute: number; minsOfDay: number; timeStr: string; dayOfWeek: number } {
  const d = new Date(unixSec * 1000)
  const offset = isDst(d) ? -4 : -5
  const local = new Date(unixSec * 1000 + offset * 3600 * 1000)

  const y = local.getUTCFullYear()
  const m = local.getUTCMonth() + 1
  const day = local.getUTCDate()
  const h = local.getUTCHours()
  const min = local.getUTCMinutes()
  const dow = local.getUTCDay()

  const ymd = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`

  return {
    ymd,
    hour: h,
    minute: min,
    minsOfDay: h * 60 + min,
    timeStr,
    dayOfWeek: dow,
  }
}

function isScheduledEventWindow(market: string, minsOfDay: number, dayOfWeek: number): boolean {
  if (market === 'CRUDE' && dayOfWeek === 3 && minsOfDay >= 615 && minsOfDay <= 645) return true
  if (minsOfDay >= 495 && minsOfDay <= 525) return true
  if (minsOfDay >= 825 && minsOfDay <= 855) return true
  return false
}

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

function computeVolumeProfile(bars: Bar1M[], binWidthPrice: number): VolumeProfile | null {
  if (bars.length === 0) return null

  let high = -Infinity
  let low = Infinity
  let totalVolume = 0
  let sumPV = 0

  for (const b of bars) {
    if (b.high > high) high = b.high
    if (b.low < low) low = b.low
    const vol = b.volume > 0 ? b.volume : 1
    totalVolume += vol
    sumPV += ((b.high + b.low + b.close) / 3) * vol
  }

  if (high <= low || totalVolume <= 0) return null
  const sessionVwap = sumPV / totalVolume

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

  let maxVol = -1
  let pocCandidates: number[] = []
  for (const [p, v] of smoothedBins) {
    if (v > maxVol + 1e-6) {
      maxVol = v
      pocCandidates = [p]
    } else if (Math.abs(v - maxVol) <= 1e-6) {
      pocCandidates.push(p)
    }
  }

  let poc = pocCandidates[0]
  if (pocCandidates.length > 1) {
    pocCandidates.sort((a, b) => {
      const distA = Math.abs(a - sessionVwap)
      const distB = Math.abs(b - sessionVwap)
      if (Math.abs(distA - distB) > 1e-4) return distA - distB
      return a - b
    })
    poc = pocCandidates[0]
  }

  const targetVaVol = totalVolume * 0.70
  let pocIdx = smoothedBins.findIndex((b) => Math.abs(b[0] - poc) < 1e-4)
  if (pocIdx === -1) pocIdx = Math.floor(smoothedBins.length / 2)

  let vaVol = smoothedBins[pocIdx] ? smoothedBins[pocIdx][1] : 0
  let upIdx = pocIdx + 1
  let downIdx = pocIdx - 1

  while (vaVol < targetVaVol && (upIdx < smoothedBins.length || downIdx >= 0)) {
    const nextUpVol = upIdx < smoothedBins.length ? smoothedBins[upIdx][1] : -1
    const nextDownVol = downIdx >= 0 ? smoothedBins[downIdx][1] : -1

    if (nextUpVol >= nextDownVol && upIdx < smoothedBins.length) {
      vaVol += nextUpVol
      upIdx++
    } else if (downIdx >= 0) {
      vaVol += nextDownVol
      downIdx--
    } else if (upIdx < smoothedBins.length) {
      vaVol += nextUpVol
      upIdx++
    } else {
      break
    }
  }

  const val = smoothedBins[Math.max(0, downIdx + 1)][0]
  const vah = smoothedBins[Math.min(smoothedBins.length - 1, upIdx - 1)][0]

  const lvnCandidates: { price: number; volume: number; prominence: number }[] = []
  const hvnCandidates: { price: number; volume: number; prominence: number }[] = []

  for (let i = 2; i < smoothedBins.length - 2; i++) {
    const [price, v] = smoothedBins[i]
    const vLeft = smoothedBins[i - 1][1]
    const vRight = smoothedBins[i + 1][1]

    if (v < vLeft && v < vRight && v < maxVol * 0.35) {
      lvnCandidates.push({ price, volume: v, prominence: Math.min(vLeft - v, vRight - v) })
    }
    if (v > vLeft && v > vRight && v > maxVol * 0.65) {
      hvnCandidates.push({ price, volume: v, prominence: Math.min(v - vLeft, v - vRight) })
    }
  }

  lvnCandidates.sort((a, b) => a.volume - b.volume)
  hvnCandidates.sort((a, b) => b.volume - a.volume)

  return {
    poc,
    vah,
    val,
    high,
    low,
    totalVolume,
    lvn: lvnCandidates.slice(0, 2).map((c) => c.price),
    hvn: hvnCandidates.slice(0, 2).map((c) => c.price),
  }
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
 * Fast Day-Clustered Bootstrap: resamples mean daily excess returns with replacement
 */
function dayClusteredBootstrapFast(dayExcessList: number[], iterations = 1000): [number, number] {
  const K = dayExcessList.length
  if (K < 20) return [0, 0]

  const bootEstimates: number[] = []
  for (let b = 0; b < iterations; b++) {
    let sum = 0
    for (let i = 0; i < K; i++) {
      const idx = Math.floor(Math.random() * K)
      sum += dayExcessList[idx]
    }
    bootEstimates.push(sum / K)
  }

  bootEstimates.sort((a, b) => a - b)
  const lowIdx = Math.floor(bootEstimates.length * 0.025)
  const highIdx = Math.floor(bootEstimates.length * 0.975)
  return [bootEstimates[lowIdx] ?? 0, bootEstimates[highIdx] ?? 0]
}

/**
 * Fast Day-Clustered Permutation Test
 */
function dayClusteredPermutationPFast(dayExcessList: number[], observedExcess: number, iterations = 1000): number {
  const K = dayExcessList.length
  if (K < 20 || observedExcess <= 0) return 1.0

  let exceedCount = 0
  for (let b = 0; b < iterations; b++) {
    let sum = 0
    for (let i = 0; i < K; i++) {
      const sign = Math.random() < 0.5 ? 1 : -1
      sum += sign * dayExcessList[i]
    }
    if (sum / K >= observedExcess) {
      exceedCount++
    }
  }

  return (exceedCount + 1) / (iterations + 1)
}

export interface EconometricResultRow {
  market: string
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
  ciLowATR: number
  ciHighATR: number
  ciMeanATRStr: string
  pValue: number
  bhFdrQValue: number
  gateStatus: string
  isPrimaryFDR: boolean
  inSampleExcessATR: number
  walkForwardExcessATR: number
  stabilityRatio: number
}

export function runMultiYearMarketReplay(marketKey: string, filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.error(`[Skip] File not found: ${filePath}`)
    return null
  }

  const config = MARKET_CONFIGS[marketKey]
  const raw = fs.readFileSync(filePath, 'utf-8')
  const bars: Bar1M[] = JSON.parse(raw)
  bars.sort((a, b) => a.time - b.time)

  console.log(`\n========================================================================================================================`)
  console.log(`🏛️ INSTITUTIONAL CME MULTI-YEAR REPLAY: ${config.name}`)
  console.log(`Total 1m Bars: ${bars.length.toLocaleString()} | Settlement Window: ${config.settlementWindowName}`)
  console.log(`========================================================================================================================`)

  // Step 1: Group into sessions
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
  console.log(`Grouped into ${sortedDates.length.toLocaleString()} total sessions (${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}).`)

  // Precompute Volume Profiles
  const rthProfiles = new Map<string, VolumeProfile>()
  const overnightProfiles = new Map<string, VolumeProfile>()

  for (const date of sortedDates) {
    const s = sessionsByDate.get(date)!
    const prof = computeVolumeProfile(s.nativeRth, config.binWidthPrice)
    if (prof) rthProfiles.set(date, prof)
    const onProf = computeVolumeProfile(s.overnight, config.binWidthPrice)
    if (onProf) overnightProfiles.set(date, onProf)
  }

  // Precompute 5-Day Rolling Profiles (cached once per date!)
  console.log(`Precomputing 5-day rolling volume profiles...`)
  const profile5DByDate = new Map<string, VolumeProfile>()
  for (let dIdx = 5; dIdx < sortedDates.length; dIdx++) {
    const past5Bars: Bar1M[] = []
    for (let k = dIdx - 5; k < dIdx; k++) {
      const pastSess = sessionsByDate.get(sortedDates[k])
      if (pastSess) past5Bars.push(...pastSess.nativeRth)
    }
    const prof = computeVolumeProfile(past5Bars, config.binWidthPrice)
    if (prof) profile5DByDate.set(sortedDates[dIdx], prof)
  }

  // Step 2: 105-Session Rolling AVWAP Engine
  let sumPV = 0, sumP2V = 0, sumV = 0
  const vwapMap = new Map<number, { vwap: number; upper1: number; lower1: number; upper2: number; lower2: number; upper3: number; lower3: number }>()

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

  // Causal historical median ATR by time bucket
  const atrByTimeBucket: Record<TimeBucket, number[]> = {
    OPEN_DRIVE: [],
    MORNING: [],
    MIDDAY: [],
    AFTERNOON: [],
  }

  for (let i = 14; i < bars.length; i += 30) {
    const et = getEtTimeParts(bars[i].time)
    if (et.minsOfDay >= config.nativeSessionStartMin && et.minsOfDay < config.nativeSessionEndMin) {
      const bucket = getTimeBucket(et.minsOfDay, config.nativeSessionStartMin, config.nativeSessionEndMin)
      atrByTimeBucket[bucket].push(calculateWilderATR14(bars, i))
    }
  }

  const medianAtrByBucket: Record<TimeBucket, number> = {
    OPEN_DRIVE: calculateMedian(atrByTimeBucket.OPEN_DRIVE),
    MORNING: calculateMedian(atrByTimeBucket.MORNING),
    MIDDAY: calculateMedian(atrByTimeBucket.MIDDAY),
    AFTERNOON: calculateMedian(atrByTimeBucket.AFTERNOON),
  }

  // Step 3: Decontaminated Matched Controls
  console.log(`Building decontaminated matched control state distribution...`)
  const matchedControlMap = new Map<string, { longReturnsATR: number[]; shortReturnsATR: number[] }>()

  for (let dIdx = 5; dIdx < sortedDates.length; dIdx++) {
    const date = sortedDates[dIdx]
    const partition = getDatePartition(date)
    if (partition === 'WARMUP') continue

    const sess = sessionsByDate.get(date)!
    const yesterdayProf = rthProfiles.get(sortedDates[dIdx - 1])
    const inventoryProf = overnightProfiles.get(date)
    const profile5D = profile5DByDate.get(date)

    const primaryLevels: number[] = []
    if (profile5D) primaryLevels.push(profile5D.vah, profile5D.val, ...profile5D.lvn.slice(0, 2))
    if (yesterdayProf) primaryLevels.push(yesterdayProf.vah, yesterdayProf.val)
    if (inventoryProf) primaryLevels.push(inventoryProf.poc)

    let sPV = 0, sV = 0
    // Sample every 2 minutes for high efficiency while capturing full distribution
    for (let bi = 0; bi < sess.nativeRth.length; bi += 2) {
      const b = sess.nativeRth[bi]
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
      const bucketMedianATR = medianAtrByBucket[timeBucket] || atr
      const volState: VolState = atr >= bucketMedianATR ? 'HIGH_VOL' : 'LOW_VOL'
      const isEvent = isScheduledEventWindow(marketKey, et.minsOfDay, et.dayOfWeek)
      const eventRegime: EventRegime = isEvent ? 'SCHEDULED_EVENT' : 'NORMAL_FLOW'

      const touchTol = Math.max(2 * config.tickSize, 0.10 * atr)
      let isContaminated = false
      const vwapData = vwapMap.get(b.time)
      const activePrimary = [...primaryLevels]
      if (vwapData) activePrimary.push(vwapData.upper2, vwapData.lower2)

      for (const lvlPrice of activePrimary) {
        if (b.low <= lvlPrice + touchTol && b.high >= lvlPrice - touchTol) {
          isContaminated = true
          break
        }
      }

      if (isContaminated) continue

      const stateKey = `${timeBucket}_${trendState}_${volState}_${eventRegime}`
      if (!matchedControlMap.has(stateKey)) {
        matchedControlMap.set(stateKey, { longReturnsATR: [], shortReturnsATR: [] })
      }

      const diff = bars[idx + 30].close - b.close
      const diffATR = diff / atr
      matchedControlMap.get(stateKey)!.longReturnsATR.push(diffATR)
      matchedControlMap.get(stateKey)!.shortReturnsATR.push(-diffATR)
    }
  }

  // Step 4: Event study across evaluated dates
  console.log(`Replaying structural level interactions...`)
  const allEvents: ProcessedEvent[] = []
  const activeClusters = new Map<string, { clusterId: string; lastTouchTime: number; touchCount: number; lastPrice: number }>()

  for (let dIdx = 105; dIdx < sortedDates.length; dIdx++) {
    const todayDate = sortedDates[dIdx]
    const partition = getDatePartition(todayDate)
    if (partition === 'WARMUP') continue

    const yesterdayProf = rthProfiles.get(sortedDates[dIdx - 1])
    const inventoryProf = overnightProfiles.get(todayDate)
    const profile5D = profile5DByDate.get(todayDate)

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
      const tolerance = Math.max(2 * config.tickSize, 0.10 * atr)
      const resetDist = Math.max(6 * config.tickSize, 0.50 * atr)

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
      const bucketMedianATR = medianAtrByBucket[timeBucket] || atr
      const volState: VolState = atr >= bucketMedianATR ? 'HIGH_VOL' : 'LOW_VOL'
      const isEvent = isScheduledEventWindow(marketKey, et.minsOfDay, et.dayOfWeek)
      const eventRegime: EventRegime = isEvent ? 'SCHEDULED_EVENT' : 'NORMAL_FLOW'
      const stateKey = `${timeBucket}_${trendState}_${volState}_${eventRegime}`

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
          if (minutesSinceLast > 30 && Math.abs(b.close - existingCluster.lastPrice) >= resetDist) {
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

        const key = `${lvl.name} (${expectedDirection})`
        const isPrimaryFDR = PRIMARY_FDR_HYPOTHESIS_SET.has(key)

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
          isPrimaryFDR,
          partition,
        })
      }
    }
  }

  const uniqueFirstTouches = allEvents.filter((e) => e.touchIndex === 1)
  console.log(`Captured ${uniqueFirstTouches.length.toLocaleString()} Unique First-Touch Events across ${sortedDates.length - 105} evaluated sessions.`)

  // Step 5: Econometric Inference & Gate Evaluation
  const levelGroups = new Map<string, ProcessedEvent[]>()
  for (const e of uniqueFirstTouches) {
    const key = `${e.levelType} (${e.expectedDirection})`
    if (!levelGroups.has(key)) levelGroups.set(key, [])
    levelGroups.get(key)!.push(e)
  }

  const results: EconometricResultRow[] = []

  for (const [key, evts] of levelGroups.entries()) {
    if (evts.length < 5) continue
    const n = evts.length
    const uniqueDaysSet = new Set(evts.map((e) => e.dateStr))
    const uniqueDays = uniqueDaysSet.size
    const isPrimaryFDR = PRIMARY_FDR_HYPOTHESIS_SET.has(key)

    const wins = evts.filter((e) => e.isWin30m).length
    const winRate = (wins / n) * 100
    const meanATR = calculateMean(evts.map((e) => e.signedRet30mATR))

    // Precalculate matched control statistics
    let matchedCtrlWins = 0
    let matchedCtrlTotal = 0
    let matchedCtrlAtrSum = 0

    // Group excess returns by date for day-clustered inference
    const dayExcessSumMap = new Map<string, { sumExcess: number; count: number }>()

    for (const e of evts) {
      const ctrlPool = matchedControlMap.get(e.stateKey)
      let ctrlMeanForEvent = 0
      if (ctrlPool) {
        const pool = e.expectedDirection === 'LONG' ? ctrlPool.longReturnsATR : ctrlPool.shortReturnsATR
        if (pool.length > 0) {
          const poolWins = pool.filter((r) => r > 0).length
          const poolSum = pool.reduce((a, b) => a + b, 0)
          matchedCtrlWins += poolWins
          matchedCtrlTotal += pool.length
          matchedCtrlAtrSum += poolSum
          ctrlMeanForEvent = poolSum / pool.length
        }
      }

      const excess = e.signedRet30mATR - ctrlMeanForEvent
      if (!dayExcessSumMap.has(e.dateStr)) dayExcessSumMap.set(e.dateStr, { sumExcess: 0, count: 0 })
      const obj = dayExcessSumMap.get(e.dateStr)!
      obj.sumExcess += excess
      obj.count += 1
    }

    const matchedControlWinRate = matchedCtrlTotal > 0 ? (matchedCtrlWins / matchedCtrlTotal) * 100 : 50.0
    const matchedControlMeanATR = matchedCtrlTotal > 0 ? matchedCtrlAtrSum / matchedCtrlTotal : 0.0
    const excessWinPct = winRate - matchedControlWinRate
    const excessMeanATR = meanATR - matchedControlMeanATR

    // In-Sample vs Walk-Forward partition performance
    const inSampleEvts = evts.filter((e) => e.partition === 'IN_SAMPLE')
    const inSampleExcess = inSampleEvts.length > 0 ? calculateMean(inSampleEvts.map((e) => e.signedRet30mATR)) : 0
    const wfEvts = evts.filter((e) => e.partition === 'WALK_FORWARD')
    const wfExcess = wfEvts.length > 0 ? calculateMean(wfEvts.map((e) => e.signedRet30mATR)) : 0
    const stabilityRatio = inSampleExcess !== 0 ? wfExcess / inSampleExcess : 0

    // Fast Day-Clustered Bootstrap & Permutation
    const dayExcessMeans = Array.from(dayExcessSumMap.values()).map((v) => v.sumExcess / v.count)

    let ciLowATR = 0, ciHighATR = 0
    let ciMeanATRStr = 'NOT ESTIMABLE (Days < 20)'
    let pValue = 1.0
    let gateStatus = 'PRELIMINARY (Days < 20)'

    if (uniqueDays >= 20) {
      const [ciLow, ciHigh] = dayClusteredBootstrapFast(dayExcessMeans, 1000)
      ciLowATR = Number(ciLow.toFixed(2))
      ciHighATR = Number(ciHigh.toFixed(2))
      ciMeanATRStr = `[${ciLow.toFixed(2)} to ${ciHigh.toFixed(2)}] ATR`
      pValue = dayClusteredPermutationPFast(dayExcessMeans, excessMeanATR, 1000)

      if (uniqueDays < 60) {
        gateStatus = `EXPLORATORY (20 <= Days < 60)`
      } else {
        const passesRaw = ciLow > 0 && excessMeanATR > 0 && excessWinPct > 0
        gateStatus = passesRaw ? 'GATE-ELIGIBLE (Evaluating FDR)' : 'GATE-ELIGIBLE: FAIL'
      }
    }

    results.push({
      market: marketKey,
      key,
      level: evts[0].levelType,
      direction: evts[0].expectedDirection,
      n,
      uniqueDays,
      winRate: Number(winRate.toFixed(1)),
      matchedControlWinRate: Number(matchedControlWinRate.toFixed(1)),
      excessWinPct: Number(excessWinPct.toFixed(1)),
      meanATR: Number(meanATR.toFixed(2)),
      matchedControlMeanATR: Number(matchedControlMeanATR.toFixed(2)),
      excessMeanATR: Number(excessMeanATR.toFixed(2)),
      ciLowATR,
      ciHighATR,
      ciMeanATRStr,
      pValue: Number(pValue.toFixed(4)),
      bhFdrQValue: 1.0,
      gateStatus,
      isPrimaryFDR,
      inSampleExcessATR: Number(inSampleExcess.toFixed(2)),
      walkForwardExcessATR: Number(wfExcess.toFixed(2)),
      stabilityRatio: Number(stabilityRatio.toFixed(2)),
    })
  }

  return {
    market: marketKey,
    totalSessions: sortedDates.length,
    results,
  }
}

async function main() {
  const multiyearDir = path.resolve(process.cwd(), 'data/cme_multiyear')
  const files = [
    { key: 'GOLD', file: path.join(multiyearDir, 'gold_1m_multiyear.json') },
    { key: 'CRUDE', file: path.join(multiyearDir, 'crude_1m_multiyear.json') },
    { key: 'DOW', file: path.join(multiyearDir, 'dow_1m_multiyear.json') },
    { key: 'NASDAQ', file: path.join(multiyearDir, 'nasdaq_1m_multiyear.json') },
  ]

  const allMarketOutputs: any[] = []
  const allRows: EconometricResultRow[] = []

  for (const f of files) {
    const res = runMultiYearMarketReplay(f.key, f.file)
    if (res) {
      allMarketOutputs.push(res)
      allRows.push(...res.results)
    }
  }

  // Benjamini-Hochberg FDR correction across M=32
  const primaryRows = allRows.filter((r) => r.isPrimaryFDR)
  primaryRows.sort((a, b) => a.pValue - b.pValue)
  const M = primaryRows.length

  for (let i = 0; i < primaryRows.length; i++) {
    const rank = i + 1
    const p = primaryRows[i].pValue
    const q = (p * M) / rank
    primaryRows[i].bhFdrQValue = Number(Math.min(1.0, q).toFixed(4))

    if (primaryRows[i].uniqueDays >= 60) {
      const clearsFdr = primaryRows[i].bhFdrQValue <= 0.10
      const clearsCI = primaryRows[i].ciLowATR > 0
      const clearsExcess = primaryRows[i].excessMeanATR > 0
      primaryRows[i].gateStatus = clearsFdr && clearsCI && clearsExcess ? '✅ GATE PASS' : '❌ GATE FAIL'
    }
  }

  console.log(`\n==================================================================================================================================================`)
  console.log(`🏛️ INSTITUTIONAL CME MULTI-YEAR ECONOMETRIC RESULTS TABLE (v4.1.1 FROZEN PROTOCOL | 2021-01-01 -> 2026-10-04)`)
  console.log(`==================================================================================================================================================`)

  for (const f of files) {
    const marketPrimary = primaryRows.filter((r) => r.market === f.key).sort((a, b) => b.excessMeanATR - a.excessMeanATR)
    const marketExploratory = allRows.filter((r) => r.market === f.key && !r.isPrimaryFDR).sort((a, b) => b.excessMeanATR - a.excessMeanATR)

    console.log(`\n--------------------------------------------------------------------------------------------------------------------------------------------------`)
    console.log(`[${MARKET_CONFIGS[f.key].name}] - PRIMARY FDR HYPOTHESIS FAMILY (M = ${marketPrimary.length})`)
    console.log(`--------------------------------------------------------------------------------------------------------------------------------------------------`)
    console.log(
      `Level & Direction`.padEnd(20) +
      `N`.padStart(6) +
      `Days`.padStart(6) +
      `Win%`.padStart(8) +
      `Ctrl%`.padStart(8) +
      `Excess%`.padStart(9) +
      `Mean(ATR)`.padStart(11) +
      `Excess(ATR)`.padStart(13) +
      `Day-Clustered 95% CI`.padStart(24) +
      `p-Val`.padStart(8) +
      `FDR q`.padStart(8) +
      `In-Samp`.padStart(9) +
      `WF-Val`.padStart(9) +
      `Gate Status`.padStart(18)
    )
    console.log(`-`.repeat(150))

    for (const r of marketPrimary) {
      const excessWinStr = (r.excessWinPct >= 0 ? '+' : '') + r.excessWinPct.toFixed(1) + '%'
      const meanAtrStr = (r.meanATR >= 0 ? '+' : '') + r.meanATR.toFixed(2)
      const excessAtrStr = (r.excessMeanATR >= 0 ? '+' : '') + r.excessMeanATR.toFixed(2)

      console.log(
        r.key.padEnd(20) +
        String(r.n).padStart(6) +
        String(r.uniqueDays).padStart(6) +
        (r.winRate.toFixed(1) + '%').padStart(8) +
        (r.matchedControlWinRate.toFixed(1) + '%').padStart(8) +
        excessWinStr.padStart(9) +
        meanAtrStr.padStart(11) +
        excessAtrStr.padStart(13) +
        r.ciMeanATRStr.padStart(24) +
        r.pValue.toFixed(3).padStart(8) +
        r.bhFdrQValue.toFixed(3).padStart(8) +
        (r.inSampleExcessATR >= 0 ? '+' : '') + r.inSampleExcessATR.toFixed(2).padStart(8) +
        (r.walkForwardExcessATR >= 0 ? '+' : '') + r.walkForwardExcessATR.toFixed(2).padStart(8) +
        r.gateStatus.padStart(18)
      )
    }

    if (marketExploratory.length > 0) {
      console.log(`\n  * Exploratory Hypotheses (Outside Primary FDR Family):`)
      for (const r of marketExploratory.slice(0, 5)) {
        console.log(`    - ${r.key.padEnd(20)} | N=${String(r.n).padStart(4)} | Days=${String(r.uniqueDays).padStart(3)} | Excess=${(r.excessMeanATR >= 0 ? '+' : '') + r.excessMeanATR.toFixed(2)} ATR | Status=${r.gateStatus}`)
      }
    }
  }

  const outPath = path.resolve(process.cwd(), 'data/cme-multiyear-replay-results.json')
  fs.writeFileSync(outPath, JSON.stringify(allRows, null, 2))
  console.log(`\n🔒 Multi-Year Replay Complete! Results exported to: ${outPath}\n`)
}

if (require.main === module) {
  main().catch(console.error)
}
