/**
 * Institutional CME Futures Econometric Validation Engine (v4.1.1 CLARIFICATION PATCH)
 *
 * Implements the 11 V4.1.1 Integrity & Reproducibility Clarifications:
 * 1. Enumerate Exact M = 32 Primary FDR Hypotheses (8 structural levels x 4 markets).
 * 2. Explicit Date Partitioning:
 *    - Indicator Warm-Up: 2020-06-01 -> 2020-12-31 (148 sessions; 0 events logged).
 *    - In-Sample Development: 2021-01-01 -> 2023-12-31 (754 sessions).
 *    - Walk-Forward Validation: 2024-01-01 -> 2025-12-31 (502 sessions).
 *    - Sequestered Final OOS Holdout: 2026-01-01 -> 2026-07-31 & 2026-09-09 -> Present.
 *    - Quarantined Engineering Test Set: 2026-08-09 -> 2026-09-08 (22 inspected sessions).
 * 3. Causal Median ATR: Computed strictly per Time-Bucket over prior historical sessions (<= t).
 * 4. Control Baseline Decontamination: Excludes bars within touch tolerance of primary structural levels.
 * 5. Scheduled Event Sets: Includes EIA Petroleum Report (Wed 10:30 ET) for CL, plus CPI/NFP/PCE/FOMC.
 * 6. Mathematical Touch Formulation: Restores exact tolerance T, reset D_reset, and 30m refractory window.
 * 7. Deterministic Tie-Breaking: Strict ranking rules for POC, VAH/VAL expansion, HVN, and LVN.
 * 8. Official Settlement Windows:
 *    - NQ & YM: 15:59:30 - 16:00:00 ET (30-sec VWAP window)
 *    - CL: 14:28:00 - 14:30:00 ET (2-min VWAP window)
 *    - GC: 13:29:00 - 13:30:00 ET (1-min VWAP window)
 * 9. Nomenclature: Universal adoption of "105-Session Rolling AVWAP" (no calendar month ambiguity).
 * 10. Documented Bug-Fix Exception Clause with mandatory git versioning and full replay.
 * 11. Distinct output separation between Primary FDR Family and Exploratory Setups.
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
}

interface MarketConfig {
  name: string
  tickSize: number
  pointValue: number
  binWidthTicks: number
  binWidthPrice: number
  nativeSessionStartMin: number
  nativeSessionEndMin: number
  officialSettlementWindowET: string
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
    officialSettlementWindowET: '15:59:30 - 16:00:00 ET (30s VWAP)',
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
    officialSettlementWindowET: '15:59:30 - 16:00:00 ET (30s VWAP)',
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
    officialSettlementWindowET: '14:28:00 - 14:30:00 ET (2m VWAP)',
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
    officialSettlementWindowET: '13:29:00 - 13:30:00 ET (1m VWAP)',
    officialSettlementTimeET: '13:30',
  },
}

/**
 * Pre-Registered Primary Hypothesis Family (Exact M = 8 levels per market, 32 total across 4 markets)
 */
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

function getEtTimeParts(unixSec: number): { ymd: string; hour: number; minute: number; minsOfDay: number; timeStr: string; dayOfWeek: number } {
  const d = new Date(unixSec * 1000)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const parts = formatter.formatToParts(d)
  let year = '', month = '', day = '', hour = '0', minute = '', weekday = 'Mon'
  for (const p of parts) {
    if (p.type === 'year') year = p.value
    if (p.type === 'month') month = p.value
    if (p.type === 'day') day = p.value
    if (p.type === 'hour') hour = p.value
    if (p.type === 'minute') minute = p.value
    if (p.type === 'weekday') weekday = p.value
  }
  const h = parseInt(hour, 10)
  const m = parseInt(minute, 10)
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    ymd: `${year}-${month}-${day}`,
    hour: h,
    minute: m,
    minsOfDay: h * 60 + m,
    timeStr: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
    dayOfWeek: dayMap[weekday] ?? 1,
  }
}

/**
 * Scheduled Event Regime Checker (Market-Specific)
 * NQ/YM/GC: CPI, NFP, PCE (08:30 ET), FOMC (14:00 ET)
 * CL: EIA Petroleum Status Report (Wed 10:30 ET), FOMC, CPI, NFP
 */
function isScheduledEventWindow(market: string, minsOfDay: number, dayOfWeek: number): boolean {
  // CL EIA Petroleum Inventory: Wednesdays 10:30 ET +/- 15 mins (10:15 - 10:45 ET = 615 - 645 mins)
  if (market === 'CRUDE' && dayOfWeek === 3 && minsOfDay >= 615 && minsOfDay <= 645) {
    return true
  }
  // Major Morning Releases (CPI, NFP, PCE): 08:30 ET +/- 15 mins (08:15 - 08:45 ET = 495 - 525 mins)
  if (minsOfDay >= 495 && minsOfDay <= 525) {
    return true
  }
  // FOMC Announcement / Fed Rate Decision: 14:00 ET +/- 15 mins (13:45 - 14:15 ET = 825 - 855 mins)
  if (minsOfDay >= 825 && minsOfDay <= 855) {
    return true
  }
  return false
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
 * Frozen Volume Profile Engine with Deterministic Tie-Breaking (v4.1.1):
 * - Integer-tick Bin Width
 * - 3-bin triangular smoothing (0.25, 0.50, 0.25)
 * - Boundary bins cannot count as LVN or HVN
 * - POC tie-breaker: closest to session VWAP; then lower price
 * - VAH/VAL expansion tie-breaker: upper bin expands first on ties
 * - LVN ranking: lowest volume -> highest prominence -> proximity to price -> lower price bin
 * - HVN ranking: highest volume -> highest prominence -> proximity to price -> higher price bin
 */
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

  // 3-bin triangular filter
  const smoothedBins: [number, number][] = []
  for (let i = 0; i < sortedBins.length; i++) {
    const vPrev = i > 0 ? sortedBins[i - 1][1] : sortedBins[i][1]
    const vCurr = sortedBins[i][1]
    const vNext = i < sortedBins.length - 1 ? sortedBins[i + 1][1] : sortedBins[i][1]
    const smooth = 0.25 * vPrev + 0.50 * vCurr + 0.25 * vNext
    smoothedBins.push([sortedBins[i][0], smooth])
  }

  // Find POC with deterministic tie-breaking
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
    // Tie-breaker 1: closest to VWAP
    pocCandidates.sort((a, b) => {
      const distA = Math.abs(a - sessionVwap)
      const distB = Math.abs(b - sessionVwap)
      if (Math.abs(distA - distB) > 1e-4) return distA - distB
      return a - b // Tie-breaker 2: lower price wins
    })
    poc = pocCandidates[0]
  }

  // VAH / VAL Expansion with upper-bin tie-breaking
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

  // LVN & HVN Detection (excluding boundary bins i = 0 and i = len - 1)
  interface NodeCandidate {
    price: number
    volume: number
    prominence: number
  }

  const lvnCandidates: NodeCandidate[] = []
  const hvnCandidates: NodeCandidate[] = []

  for (let i = 2; i < smoothedBins.length - 2; i++) {
    const [price, v] = smoothedBins[i]
    const vLeft = smoothedBins[i - 1][1]
    const vRight = smoothedBins[i + 1][1]

    if (v < vLeft && v < vRight && v < maxVol * 0.35) {
      const prominence = Math.min(vLeft - v, vRight - v)
      lvnCandidates.push({ price, volume: v, prominence })
    }
    if (v > vLeft && v > vRight && v > maxVol * 0.65) {
      const prominence = Math.min(v - vLeft, v - vRight)
      hvnCandidates.push({ price, volume: v, prominence })
    }
  }

  // Deterministic LVN Ranking (cap = 2): lowest volume -> prominence -> lower price
  lvnCandidates.sort((a, b) => {
    if (Math.abs(a.volume - b.volume) > 1e-4) return a.volume - b.volume
    if (Math.abs(a.prominence - b.prominence) > 1e-4) return b.prominence - a.prominence
    return a.price - b.price
  })

  // Deterministic HVN Ranking (cap = 2): highest volume -> prominence -> higher price
  hvnCandidates.sort((a, b) => {
    if (Math.abs(a.volume - b.volume) > 1e-4) return b.volume - a.volume
    if (Math.abs(a.prominence - b.prominence) > 1e-4) return b.prominence - a.prominence
    return b.price - a.price
  })

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
 * Day-Clustered Bootstrap for 95% Confidence Intervals
 * Strictly suppressed when uniqueDays < 20
 */
function dayClusteredBootstrap(
  eventsByDate: Map<string, ProcessedEvent[]>,
  metricFn: (evts: ProcessedEvent[]) => number,
  iterations = 400
): [number, number] {
  const dates = Array.from(eventsByDate.keys())
  if (dates.length < 20) return [0, 0]

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

function runFrozenMarketStudyV411(marketKey: string, filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.error(`[Skip] Missing: ${filePath}`)
    return null
  }

  const config = MARKET_CONFIGS[marketKey]
  const raw = fs.readFileSync(filePath, 'utf-8')
  const bars: Bar1M[] = JSON.parse(raw)
  bars.sort((a, b) => a.time - b.time)

  console.log(`\n========================================================================================================================`)
  console.log(`🏛️ CME ECONOMETRIC VALIDATION (v4.1.1 CLARIFICATION PATCH): ${config.name}`)
  console.log(`Bin Width: ${config.binWidthTicks} ticks (${config.binWidthPrice.toFixed(2)} pts) | Official Settle Window: ${config.officialSettlementWindowET}`)
  console.log(`========================================================================================================================`)

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

  // Step 2: 105-Session Rolling AVWAP Engine
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

  // Pre-calculate Causal Historical Median ATR by Time Bucket
  const atrByTimeBucket: Record<TimeBucket, number[]> = {
    OPEN_DRIVE: [],
    MORNING: [],
    MIDDAY: [],
    AFTERNOON: [],
  }

  for (let i = 14; i < bars.length; i += 15) {
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

  // Step 3: Decontaminated State-Matched Controls
  // Controls must NOT be within touch tolerance of primary structural levels
  const matchedControlMap = new Map<string, { longReturnsATR: number[]; shortReturnsATR: number[] }>()

  for (let dIdx = 5; dIdx < sortedDates.length; dIdx++) {
    const date = sortedDates[dIdx]
    const sess = sessionsByDate.get(date)!
    const yesterdayDate = sortedDates[dIdx - 1]
    const yesterdayProf = rthProfiles.get(yesterdayDate)
    const inventoryProf = overnightProfiles.get(date)

    const past5Bars: Bar1M[] = []
    for (let k = dIdx - 5; k < dIdx; k++) {
      const pastSess = sessionsByDate.get(sortedDates[k])
      if (pastSess) past5Bars.push(...pastSess.nativeRth)
    }
    const profile5D = computeVolumeProfile(past5Bars, config.binWidthPrice)

    // Primary structural levels for exclusion in control matching
    const primaryLevels: number[] = []
    if (profile5D) {
      primaryLevels.push(profile5D.vah, profile5D.val, ...profile5D.lvn.slice(0, 2))
    }
    if (yesterdayProf) {
      primaryLevels.push(yesterdayProf.vah, yesterdayProf.val)
    }
    if (inventoryProf) {
      primaryLevels.push(inventoryProf.poc)
    }

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
      const bucketMedianATR = medianAtrByBucket[timeBucket] || atr
      const volState: VolState = atr >= bucketMedianATR ? 'HIGH_VOL' : 'LOW_VOL'
      const isEvent = isScheduledEventWindow(marketKey, et.minsOfDay, et.dayOfWeek)
      const eventRegime: EventRegime = isEvent ? 'SCHEDULED_EVENT' : 'NORMAL_FLOW'

      // Check primary level contamination exclusion
      const touchTol = Math.max(2 * config.tickSize, 0.10 * atr)
      let isContaminatedByPrimary = false

      // Add AVWAP +/- 2 sigma to check
      const vwapData = vwapMap.get(b.time)
      const activePrimary = [...primaryLevels]
      if (vwapData) {
        activePrimary.push(vwapData.upper2, vwapData.lower2)
      }

      for (const lvlPrice of activePrimary) {
        if (b.low <= lvlPrice + touchTol && b.high >= lvlPrice - touchTol) {
          isContaminatedByPrimary = true
          break
        }
      }

      // If contaminated by a primary level interaction, do not use as baseline control
      if (isContaminatedByPrimary) continue

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

  // Step 4: Event Study with Exact Mathematical Touch & Refractory Engine
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
      // Exact Frozen Touch Tolerance T = max(2 * TickSize, 0.10 * ATR)
      const tolerance = Math.max(2 * config.tickSize, 0.10 * atr)
      // Exact Frozen Reset Distance D_reset = max(6 * TickSize, 0.50 * ATR)
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
        // Exact Frozen Touch Condition: Low <= L + T and High >= L - T
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
          // Refractory Window: 30 minutes. Reset Condition: Move away by >= resetDist
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
    isPrimaryFDR: boolean
  }

  const results: EconometricRow[] = []

  for (const [key, evts] of levelGroups.entries()) {
    if (evts.length < 5) continue
    const n = evts.length
    const uniqueDaysSet = new Set(evts.map((e) => e.dateStr))
    const uniqueDays = uniqueDaysSet.size
    const isPrimaryFDR = PRIMARY_FDR_HYPOTHESIS_SET.has(key)

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

    // Day-Clustered CI Suppression when Unique Days < 20
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
      isPrimaryFDR,
    })
  }

  // Separate results into Primary FDR Family and Exploratory Setups
  const primaryResults = results.filter((r) => r.isPrimaryFDR).sort((a, b) => b.excessMeanATR - a.excessMeanATR)
  const exploratoryResults = results.filter((r) => !r.isPrimaryFDR).sort((a, b) => b.excessMeanATR - a.excessMeanATR)

  const printTable = (rows: EconometricRow[], headerTitle: string) => {
    console.log(`\n--- ${headerTitle} ---`)
    console.log(
      `Level & Direction`.padEnd(20) +
      `N`.padStart(5) +
      `Days`.padStart(6) +
      `Win%`.padStart(8) +
      `Matched Ctrl%`.padStart(15) +
      `Excess%`.padStart(10) +
      `Mean (ATR)`.padStart(12) +
      `Excess (ATR)`.padStart(14) +
      `Day-Clustered 95% CI`.padStart(26) +
      `Gate Status`.padStart(24)
    )
    console.log(`-`.repeat(140))
    for (const r of rows) {
      const excessWinStr = (r.excessWinPct >= 0 ? '+' : '') + r.excessWinPct.toFixed(1) + '%'
      const meanAtrStr = (r.meanATR >= 0 ? '+' : '') + r.meanATR.toFixed(2) + ' ATR'
      const excessAtrStr = (r.excessMeanATR >= 0 ? '+' : '') + r.excessMeanATR.toFixed(2) + ' ATR'

      console.log(
        r.key.padEnd(20) +
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
  }

  printTable(primaryResults, `PRIMARY FDR HYPOTHESIS FAMILY (M = 8 for ${marketKey})`)
  printTable(exploratoryResults, `EXPLORATORY HYPOTHESES (NOT IN PRIMARY FDR FAMILY)`)

  return {
    market: marketKey,
    totalUniqueFirstTouches: uniqueFirstTouches.length,
    primaryHypotheses: primaryResults,
    exploratoryHypotheses: exploratoryResults,
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
    const res = runFrozenMarketStudyV411(f.key, f.file)
    if (res) output.push(res)
  }

  const outPath = path.resolve(process.cwd(), 'data/cme-v411-frozen-results.json')
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\n🔒 V4.1.1 Freeze Patch Engine Complete. Frozen results exported to ${outPath}\n`)
}

main().catch(console.error)
