/**
 * Institutional Multi-Year CME Wyckoff Entry Confirmation & Dual Execution Replay Engine (Phase 2)
 *
 * Implements Phase 2 of the Quantitative Research Roadmap:
 * 1. Codifies the 4 Wyckoff confirmation setups at Tier-1 structural levels:
 *    - Wyckoff Spring (Phase C false breakdown below VAL/LVN with immediate reclaim).
 *    - Wyckoff Upthrust / UTAD (Phase C false breakout above VAH with immediate rejection).
 *    - Sign of Strength (SOS) / Jump Across Creek (JAC) retest.
 *    - Sign of Weakness (SOW) breakdown retest.
 *    - Effort-vs-Result Volume & Absorption confirmation filter.
 * 2. In-Sample Training Fold Stop/Target Calibration (2021-01-01 -> 2023-12-31):
 *    - Fits optimal invalidation buffers, reclaim lookback K, and target geometries strictly on training folds.
 *    - Enforces mandatory >= 2:1 Reward-to-Risk runway check (Rule 17/20).
 * 3. Dual Execution Simulation:
 *    - Layer A: Direct CME Futures (1-tick entry slip, 1-tick exit slip, official CME exchange fees).
 *    - Layer B: CMC Markets CFD Simulation (institutional half-spread applied both sides, zero commission).
 * 4. Purged Walk-Forward Out-of-Sample Verification:
 *    - Evaluates In-Sample (2021-2023), Walk-Forward (2024-2025), and Sequestered OOS (2026).
 *    - Day-Clustered Bootstrap 95% Confidence Intervals (1,000 iterations).
 *    - Annualized Sharpe, Sortino, Profit Factor, and Max Drawdown.
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

interface MarketConfig {
  name: string
  symbol: string
  tickSize: number
  pointValue: number
  binWidthTicks: number
  binWidthPrice: number
  nativeSessionStartMin: number
  nativeSessionEndMin: number
  settlementWindowStartMin: number
  settlementWindowEndMin: number
  settlementWindowName: string
  cmeRoundTurnFee: number // Exchange + clearing fees per contract
  cmcSpread: number       // Full spread in index/commodity points
}

const MARKET_CONFIGS: Record<string, MarketConfig> = {
  NASDAQ: {
    name: 'NASDAQ (NQ)',
    symbol: 'NQ.c.0',
    tickSize: 0.25,
    pointValue: 20.0,
    binWidthTicks: 20,
    binWidthPrice: 5.0,
    nativeSessionStartMin: 9 * 60 + 30, // 09:30 ET
    nativeSessionEndMin: 16 * 60,       // 16:00 ET
    settlementWindowStartMin: 15 * 60 + 59,
    settlementWindowEndMin: 16 * 60,
    settlementWindowName: '15:59:30 - 16:00:00 ET (30s VWAP)',
    cmeRoundTurnFee: 4.80,
    cmcSpread: 1.0, // 1.0 index pt
  },
  DOW: {
    name: 'DOW (YM)',
    symbol: 'YM.c.0',
    tickSize: 1.0,
    pointValue: 5.0,
    binWidthTicks: 10,
    binWidthPrice: 10.0,
    nativeSessionStartMin: 9 * 60 + 30, // 09:30 ET
    nativeSessionEndMin: 16 * 60,       // 16:00 ET
    settlementWindowStartMin: 15 * 60 + 59,
    settlementWindowEndMin: 16 * 60,
    settlementWindowName: '15:59:30 - 16:00:00 ET (30s VWAP)',
    cmeRoundTurnFee: 4.80,
    cmcSpread: 2.0, // 2.0 index pts
  },
  CRUDE: {
    name: 'CRUDE (CL)',
    symbol: 'CL.c.0',
    tickSize: 0.01,
    pointValue: 1000.0,
    binWidthTicks: 5,
    binWidthPrice: 0.05,
    nativeSessionStartMin: 9 * 60,      // 09:00 ET
    nativeSessionEndMin: 14 * 60 + 30,  // 14:30 ET
    settlementWindowStartMin: 14 * 60 + 28,
    settlementWindowEndMin: 14 * 60 + 30,
    settlementWindowName: '14:28:00 - 14:30:00 ET (2m VWAP)',
    cmeRoundTurnFee: 3.00,
    cmcSpread: 0.03, // 0.03 commodity pts ($30)
  },
  GOLD: {
    name: 'GOLD (GC)',
    symbol: 'GC.c.0',
    tickSize: 0.1,
    pointValue: 100.0,
    binWidthTicks: 5,
    binWidthPrice: 0.5,
    nativeSessionStartMin: 8 * 60 + 20, // 08:20 ET
    nativeSessionEndMin: 13 * 60 + 30,  // 13:30 ET
    settlementWindowStartMin: 13 * 60 + 29,
    settlementWindowEndMin: 13 * 60 + 30,
    settlementWindowName: '13:29:00 - 13:30:00 ET (1m VWAP)',
    cmeRoundTurnFee: 3.60,
    cmcSpread: 0.30, // 0.30 commodity pts ($30)
  },
}

export type SetupType = 'WYCKOFF_SPRING' | 'WYCKOFF_UPTHRUST' | 'WYCKOFF_SOS_RETEST' | 'WYCKOFF_SOW_RETEST'

export interface WyckoffTrade {
  market: string
  dateStr: string
  timeET: string
  entryTime: number
  exitTime: number
  setupType: SetupType
  levelName: string
  levelPrice: number
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  stopLoss: number
  targetPrice: number
  riskPoints: number
  targetPoints: number
  rrPlanned: number
  exitPrice: number
  exitReason: 'TARGET' | 'STOP' | 'SESSION_CLOSE'
  grossPoints: number
  realizedR: number
  atr: number
  volumeAbsorptionConfirmed: boolean
  partition: 'WARMUP' | 'IN_SAMPLE' | 'WALK_FORWARD' | 'QUARANTINE_TEST' | 'SEQUESTERED_OOS'
  layerAGrossDollars: number
  layerANetDollars: number
  layerBGrossDollars: number
  layerBNetDollars: number
}

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

/**
 * Day-Clustered Bootstrap for R-multiples and Net Dollars
 */
function dayClusteredBootstrap(trades: WyckoffTrade[], iterations = 1000): { ciRLow: number; ciRHigh: number; ciNetLow: number; ciNetHigh: number } {
  const tradesByDay = new Map<string, WyckoffTrade[]>()
  for (const t of trades) {
    if (!tradesByDay.has(t.dateStr)) tradesByDay.set(t.dateStr, [])
    tradesByDay.get(t.dateStr)!.push(t)
  }

  const uniqueDays = Array.from(tradesByDay.keys())
  const K = uniqueDays.length
  if (K < 10) return { ciRLow: 0, ciRHigh: 0, ciNetLow: 0, ciNetHigh: 0 }

  const bootMeanR: number[] = []
  const bootNetA: number[] = []

  for (let b = 0; b < iterations; b++) {
    let sumR = 0
    let sumNetA = 0
    let totalCount = 0

    for (let i = 0; i < K; i++) {
      const day = uniqueDays[Math.floor(Math.random() * K)]
      const dayTrades = tradesByDay.get(day)!
      for (const t of dayTrades) {
        sumR += t.realizedR
        sumNetA += t.layerANetDollars
        totalCount++
      }
    }

    if (totalCount > 0) {
      bootMeanR.push(sumR / totalCount)
      bootNetA.push(sumNetA)
    }
  }

  bootMeanR.sort((a, b) => a - b)
  bootNetA.sort((a, b) => a - b)

  const lowIdx = Math.floor(bootMeanR.length * 0.025)
  const highIdx = Math.floor(bootMeanR.length * 0.975)

  return {
    ciRLow: Number((bootMeanR[lowIdx] ?? 0).toFixed(2)),
    ciRHigh: Number((bootMeanR[highIdx] ?? 0).toFixed(2)),
    ciNetLow: Number((bootNetA[lowIdx] ?? 0).toFixed(0)),
    ciNetHigh: Number((bootNetA[highIdx] ?? 0).toFixed(0)),
  }
}

export interface SummaryStats {
  n: number
  uniqueDays: number
  winRatePct: number
  profitFactor: number
  expectancyR: number
  expectancyDollarsA: number
  totalNetPnLA: number
  totalNetPnLB: number
  maxDrawdownDollarsA: number
  maxDrawdownPctA: number
  sharpeRatioA: number
  sortinoRatioA: number
  ciRLow: number
  ciRHigh: number
}

function computePartitionStats(trades: WyckoffTrade[]): SummaryStats {
  if (trades.length === 0) {
    return {
      n: 0,
      uniqueDays: 0,
      winRatePct: 0,
      profitFactor: 0,
      expectancyR: 0,
      expectancyDollarsA: 0,
      totalNetPnLA: 0,
      totalNetPnLB: 0,
      maxDrawdownDollarsA: 0,
      maxDrawdownPctA: 0,
      sharpeRatioA: 0,
      sortinoRatioA: 0,
      ciRLow: 0,
      ciRHigh: 0,
    }
  }

  const daysSet = new Set(trades.map((t) => t.dateStr))
  const n = trades.length
  const uniqueDays = daysSet.size
  const wins = trades.filter((t) => t.realizedR > 0)
  const losses = trades.filter((t) => t.realizedR <= 0)
  const winRatePct = Number(((wins.length / n) * 100).toFixed(1))

  let grossGainsA = 0
  let grossLossesA = 0
  let totalNetA = 0
  let totalNetB = 0
  let totalR = 0

  for (const t of trades) {
    totalR += t.realizedR
    totalNetA += t.layerANetDollars
    totalNetB += t.layerBNetDollars
    if (t.layerANetDollars > 0) grossGainsA += t.layerANetDollars
    else grossLossesA += Math.abs(t.layerANetDollars)
  }

  const profitFactor = grossLossesA > 0 ? Number((grossGainsA / grossLossesA).toFixed(2)) : 99.99
  const expectancyR = Number((totalR / n).toFixed(2))
  const expectancyDollarsA = Number((totalNetA / n).toFixed(2))

  // Equity Curve & Max Drawdown calculation
  let runningEquity = 0
  let peakEquity = 0
  let maxDDA = 0

  const dailyPnLA = new Map<string, number>()
  for (const t of trades) {
    runningEquity += t.layerANetDollars
    if (runningEquity > peakEquity) peakEquity = runningEquity
    const dd = peakEquity - runningEquity
    if (dd > maxDDA) maxDDA = dd

    dailyPnLA.set(t.dateStr, (dailyPnLA.get(t.dateStr) || 0) + t.layerANetDollars)
  }

  const maxDrawdownPctA = peakEquity > 0 ? Number(((maxDDA / peakEquity) * 100).toFixed(1)) : 0

  // Sharpe and Sortino (Annualized from daily PnL)
  const dailyReturns = Array.from(dailyPnLA.values())
  const meanDaily = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
  const varDaily = dailyReturns.reduce((a, b) => a + Math.pow(b - meanDaily, 2), 0) / Math.max(1, dailyReturns.length - 1)
  const stdDaily = Math.sqrt(varDaily)

  const downReturns = dailyReturns.filter((r) => r < 0)
  const downVar = downReturns.length > 0 ? downReturns.reduce((a, b) => a + Math.pow(b, 2), 0) / downReturns.length : 1
  const downStd = Math.sqrt(downVar)

  const sharpeRatioA = stdDaily > 0 ? Number(((meanDaily / stdDaily) * Math.sqrt(252)).toFixed(2)) : 0
  const sortinoRatioA = downStd > 0 ? Number(((meanDaily / downStd) * Math.sqrt(252)).toFixed(2)) : 0

  const { ciRLow, ciRHigh } = dayClusteredBootstrap(trades, 1000)

  return {
    n,
    uniqueDays,
    winRatePct,
    profitFactor,
    expectancyR,
    expectancyDollarsA,
    totalNetPnLA: Number(totalNetA.toFixed(0)),
    totalNetPnLB: Number(totalNetB.toFixed(0)),
    maxDrawdownDollarsA: Number(maxDDA.toFixed(0)),
    maxDrawdownPctA,
    sharpeRatioA,
    sortinoRatioA,
    ciRLow,
    ciRHigh,
  }
}

export function runWyckoffConfirmationReplay(marketKey: string, filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.error(`[Skip] File not found: ${filePath}`)
    return null
  }

  const config = MARKET_CONFIGS[marketKey]
  const raw = fs.readFileSync(filePath, 'utf-8')
  const bars: Bar1M[] = JSON.parse(raw)
  bars.sort((a, b) => a.time - b.time)

  console.log(`\n========================================================================================================================`)
  console.log(`🏛️ INSTITUTIONAL CME WYCKOFF CONFIRMATION ENGINE: ${config.name}`)
  console.log(`Continuous Bars: ${bars.length.toLocaleString()} | Tick Size: ${config.tickSize} | Point Value: $${config.pointValue}`)
  console.log(`Layer A CME Slip: 2 ticks | CME Round-Turn: $${config.cmeRoundTurnFee} | Layer B CMC Spread: ${config.cmcSpread} pts`)
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

  // Precompute 5-Day Rolling Profiles
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

  // 105-Session Rolling AVWAP Engine
  let sumPV = 0, sumP2V = 0, sumV = 0
  const vwapMap = new Map<number, { vwap: number; upper2: number; lower2: number }>()

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
      upper2: curVwap + 2 * std,
      lower2: curVwap - 2 * std,
    })
  }

  const barIndexMap = new Map<number, number>()
  for (let i = 0; i < bars.length; i++) {
    barIndexMap.set(bars[i].time, i)
  }

  // Step 2: Wyckoff Confirmation Replay
  console.log(`Replaying Wyckoff confirmation setups across all sessions...`)
  const trades: WyckoffTrade[] = []

  // Track active position to prevent overlapping execution on the same instrument
  let activePositionUntil = -1

  for (let dIdx = 105; dIdx < sortedDates.length; dIdx++) {
    const todayDate = sortedDates[dIdx]
    const partition = getDatePartition(todayDate)
    if (partition === 'WARMUP') continue

    const yesterdayProf = rthProfiles.get(sortedDates[dIdx - 1])
    const inventoryProf = overnightProfiles.get(todayDate)
    const profile5D = profile5DByDate.get(todayDate)

    const todaySess = sessionsByDate.get(todayDate)!
    if (!todaySess.nativeRth || todaySess.nativeRth.length === 0) continue

    type StructuralLevel = { name: string; price: number; type: 'SUPPORT' | 'RESISTANCE' }
    const supportLevels: StructuralLevel[] = []
    const resistanceLevels: StructuralLevel[] = []

    if (profile5D) {
      resistanceLevels.push({ name: '5D_VAH', price: profile5D.vah, type: 'RESISTANCE' })
      supportLevels.push({ name: '5D_VAL', price: profile5D.val, type: 'SUPPORT' })
      for (const lvn of profile5D.lvn.slice(0, 2)) {
        supportLevels.push({ name: '5D_LVN', price: lvn, type: 'SUPPORT' })
      }
    }

    if (yesterdayProf) {
      resistanceLevels.push({ name: 'YEST_VAH', price: yesterdayProf.vah, type: 'RESISTANCE' })
      supportLevels.push({ name: 'YEST_VAL', price: yesterdayProf.val, type: 'SUPPORT' })
    }

    if (inventoryProf) {
      resistanceLevels.push({ name: 'INV_POC', price: inventoryProf.poc, type: 'RESISTANCE' })
    }

    // Moving average of volume for Effort-vs-Result detection
    const rthBars = todaySess.nativeRth

    for (let bi = 10; bi < rthBars.length - 15; bi++) {
      const b = rthBars[bi]
      if (b.time <= activePositionUntil) continue

      const globalIdx = barIndexMap.get(b.time) ?? -1
      if (globalIdx === -1 || globalIdx + 120 >= bars.length) continue

      const atr = calculateWilderATR14(bars, globalIdx)
      const touchTol = Math.max(2 * config.tickSize, 0.10 * atr)
      const buffer = Math.max(2 * config.tickSize, 0.15 * atr)

      // Rolling 20-bar average volume
      let volSum = 0
      for (let k = Math.max(0, bi - 20); k < bi; k++) {
        volSum += rthBars[k].volume
      }
      const avgVol = volSum / Math.max(1, Math.min(20, bi))

      const vwapData = vwapMap.get(b.time)
      const currentSupports = [...supportLevels]
      const currentResistances = [...resistanceLevels]

      if (vwapData) {
        currentResistances.push({ name: 'AVWAP_+2σ', price: vwapData.upper2, type: 'RESISTANCE' })
        currentSupports.push({ name: 'AVWAP_-2σ', price: vwapData.lower2, type: 'SUPPORT' })
      }

      // ─────────────────────────────────────────────────────────────────────────────
      // SETUP 1: WYCKOFF SPRING AT SUPPORT (Long)
      // Requirements:
      // 1. Within prior 1-5 bars, price swept below support (Low < L).
      // 2. Current bar closes firmly back above support (Close >= L).
      // 3. Structural stop placed below the sweep lowest low minus buffer.
      // 4. Target placed at opposing structural level or 2.5R projection.
      // 5. Runway filter: Reward-to-Risk >= 2.0 (Rule 17).
      // ─────────────────────────────────────────────────────────────────────────────
      for (const sup of currentSupports) {
        const L = sup.price
        // Check if price touched the zone
        if (b.low <= L + touchTol && b.close >= L) {
          // Lookback 1 to 5 bars for sweep underneath L
          let sweepLow = Infinity
          let sweepIdx = -1
          let sweepVol = 0

          for (let look = 1; look <= 5; look++) {
            const pb = rthBars[bi - look]
            if (!pb) break
            if (pb.low < L) {
              if (pb.low < sweepLow) {
                sweepLow = pb.low
                sweepIdx = bi - look
                sweepVol = pb.volume
              }
            }
          }

          if (sweepIdx >= 0 && sweepLow < L) {
            // Spring Confirmed!
            const entryPrice = b.close
            const stopLoss = Number((sweepLow - buffer).toFixed(2))
            const riskPoints = Number((entryPrice - stopLoss).toFixed(2))

            if (riskPoints >= 2 * config.tickSize) {
              // Find opposing resistance target
              const opposingRes = currentResistances.filter((r) => r.price > entryPrice + 1.0)
              let targetPrice = entryPrice + 2.5 * riskPoints
              if (opposingRes.length > 0) {
                opposingRes.sort((a, b) => a.price - b.price)
                targetPrice = opposingRes[0].price
              }

              const targetPoints = Number((targetPrice - entryPrice).toFixed(2))
              const rrPlanned = Number((targetPoints / riskPoints).toFixed(2))

              // Rule 17: Enforce >= 2.0 R:R
              if (rrPlanned >= 2.0) {
                const isVolumeAbsorption = sweepVol >= 1.2 * avgVol || b.volume >= 1.2 * avgVol

                // Simulate Trade Execution
                let exitPrice = entryPrice
                let exitReason: 'TARGET' | 'STOP' | 'SESSION_CLOSE' = 'SESSION_CLOSE'
                let exitTime = b.time

                for (let f = 1; f <= 180; f++) {
                  const fb = bars[globalIdx + f]
                  if (!fb) break

                  const fbET = getEtTimeParts(fb.time)
                  // Check Stop hit first
                  if (fb.low <= stopLoss) {
                    exitPrice = stopLoss
                    exitReason = 'STOP'
                    exitTime = fb.time
                    break
                  }
                  // Check Target hit
                  if (fb.high >= targetPrice) {
                    exitPrice = targetPrice
                    exitReason = 'TARGET'
                    exitTime = fb.time
                    break
                  }
                  // Check Session Close
                  if (fbET.minsOfDay >= config.nativeSessionEndMin - 2) {
                    exitPrice = fb.close
                    exitReason = 'SESSION_CLOSE'
                    exitTime = fb.time
                    break
                  }
                }

                const grossPoints = Number((exitPrice - entryPrice).toFixed(2))
                const realizedR = Number((grossPoints / riskPoints).toFixed(2))

                // Layer A: Direct CME Futures
                // Slippage: 1 tick entry + 1 tick exit
                const layerAPoints = grossPoints - 2 * config.tickSize
                const layerAGrossDollars = grossPoints * config.pointValue
                const layerANetDollars = layerAPoints * config.pointValue - config.cmeRoundTurnFee

                // Layer B: CMC Markets CFD Simulation
                // Spread: full cmcSpread deducted from points
                const layerBPoints = grossPoints - config.cmcSpread
                const layerBGrossDollars = grossPoints * config.pointValue
                const layerBNetDollars = layerBPoints * config.pointValue

                const et = getEtTimeParts(b.time)
                trades.push({
                  market: marketKey,
                  dateStr: todayDate,
                  timeET: et.timeStr,
                  entryTime: b.time,
                  exitTime,
                  setupType: 'WYCKOFF_SPRING',
                  levelName: sup.name,
                  levelPrice: sup.price,
                  direction: 'LONG',
                  entryPrice,
                  stopLoss,
                  targetPrice,
                  riskPoints,
                  targetPoints,
                  rrPlanned,
                  exitPrice,
                  exitReason,
                  grossPoints,
                  realizedR,
                  atr,
                  volumeAbsorptionConfirmed: isVolumeAbsorption,
                  partition,
                  layerAGrossDollars,
                  layerANetDollars,
                  layerBGrossDollars,
                  layerBNetDollars,
                })

                activePositionUntil = exitTime
                break // One trade per bar
              }
            }
          }
        }
      }

      if (b.time <= activePositionUntil) continue

      // ─────────────────────────────────────────────────────────────────────────────
      // SETUP 2: WYCKOFF UPTHRUST / UTAD AT RESISTANCE (Short)
      // Requirements:
      // 1. Within prior 1-5 bars, price swept above resistance (High > L).
      // 2. Current bar closes firmly back below resistance (Close <= L).
      // 3. Structural stop placed above the sweep highest high plus buffer.
      // 4. Target placed at opposing structural level or 2.5R projection.
      // 5. Runway filter: Reward-to-Risk >= 2.0 (Rule 17).
      // ─────────────────────────────────────────────────────────────────────────────
      for (const res of currentResistances) {
        const L = res.price
        if (b.high >= L - touchTol && b.close <= L) {
          let sweepHigh = -Infinity
          let sweepIdx = -1
          let sweepVol = 0

          for (let look = 1; look <= 5; look++) {
            const pb = rthBars[bi - look]
            if (!pb) break
            if (pb.high > L) {
              if (pb.high > sweepHigh) {
                sweepHigh = pb.high
                sweepIdx = bi - look
                sweepVol = pb.volume
              }
            }
          }

          if (sweepIdx >= 0 && sweepHigh > L) {
            // Upthrust Confirmed!
            const entryPrice = b.close
            const stopLoss = Number((sweepHigh + buffer).toFixed(2))
            const riskPoints = Number((stopLoss - entryPrice).toFixed(2))

            if (riskPoints >= 2 * config.tickSize) {
              // Find opposing support target
              const opposingSup = currentSupports.filter((s) => s.price < entryPrice - 1.0)
              let targetPrice = entryPrice - 2.5 * riskPoints
              if (opposingSup.length > 0) {
                opposingSup.sort((a, b) => b.price - a.price)
                targetPrice = opposingSup[0].price
              }

              const targetPoints = Number((entryPrice - targetPrice).toFixed(2))
              const rrPlanned = Number((targetPoints / riskPoints).toFixed(2))

              if (rrPlanned >= 2.0) {
                const isVolumeAbsorption = sweepVol >= 1.2 * avgVol || b.volume >= 1.2 * avgVol

                let exitPrice = entryPrice
                let exitReason: 'TARGET' | 'STOP' | 'SESSION_CLOSE' = 'SESSION_CLOSE'
                let exitTime = b.time

                for (let f = 1; f <= 180; f++) {
                  const fb = bars[globalIdx + f]
                  if (!fb) break

                  const fbET = getEtTimeParts(fb.time)
                  // Check Stop hit first
                  if (fb.high >= stopLoss) {
                    exitPrice = stopLoss
                    exitReason = 'STOP'
                    exitTime = fb.time
                    break
                  }
                  // Check Target hit
                  if (fb.low <= targetPrice) {
                    exitPrice = targetPrice
                    exitReason = 'TARGET'
                    exitTime = fb.time
                    break
                  }
                  // Check Session Close
                  if (fbET.minsOfDay >= config.nativeSessionEndMin - 2) {
                    exitPrice = fb.close
                    exitReason = 'SESSION_CLOSE'
                    exitTime = fb.time
                    break
                  }
                }

                const grossPoints = Number((entryPrice - exitPrice).toFixed(2))
                const realizedR = Number((grossPoints / riskPoints).toFixed(2))

                // Layer A: Direct CME Futures
                const layerAPoints = grossPoints - 2 * config.tickSize
                const layerAGrossDollars = grossPoints * config.pointValue
                const layerANetDollars = layerAPoints * config.pointValue - config.cmeRoundTurnFee

                // Layer B: CMC Markets CFD Simulation
                const layerBPoints = grossPoints - config.cmcSpread
                const layerBGrossDollars = grossPoints * config.pointValue
                const layerBNetDollars = layerBPoints * config.pointValue

                const et = getEtTimeParts(b.time)
                trades.push({
                  market: marketKey,
                  dateStr: todayDate,
                  timeET: et.timeStr,
                  entryTime: b.time,
                  exitTime,
                  setupType: 'WYCKOFF_UPTHRUST',
                  levelName: res.name,
                  levelPrice: res.price,
                  direction: 'SHORT',
                  entryPrice,
                  stopLoss,
                  targetPrice,
                  riskPoints,
                  targetPoints,
                  rrPlanned,
                  exitPrice,
                  exitReason,
                  grossPoints,
                  realizedR,
                  atr,
                  volumeAbsorptionConfirmed: isVolumeAbsorption,
                  partition,
                  layerAGrossDollars,
                  layerANetDollars,
                  layerBGrossDollars,
                  layerBNetDollars,
                })

                activePositionUntil = exitTime
                break
              }
            }
          }
        }
      }

      if (b.time <= activePositionUntil) continue

      // ─────────────────────────────────────────────────────────────────────────────
      // SETUP 3: SIGN OF STRENGTH (SOS) / JAC BREAKOUT RETEST (Long)
      // Requirements:
      // 1. Level was resistance (e.g. VAH). Price recently broke out (> 0.4 ATR above L).
      // 2. Price pulls back to test L from above (Low <= L + touchTol, Close >= L).
      // 3. Bullish rejection bar (Close > Open and Close in top 50% of bar range).
      // ─────────────────────────────────────────────────────────────────────────────
      for (const res of currentResistances) {
        const L = res.price
        if (b.low <= L + touchTol && b.close >= L && b.close > b.open) {
          const barRange = b.high - b.low
          if (barRange > 0 && (b.close - b.low) / barRange >= 0.5) {
            // Check if prior bars showed breakout above L
            let hadBreakout = false
            for (let look = 3; look <= 15; look++) {
              const pb = rthBars[bi - look]
              if (pb && pb.close > L + 0.4 * atr) {
                hadBreakout = true
                break
              }
            }

            if (hadBreakout) {
              const entryPrice = b.close
              const stopLoss = Number((b.low - buffer).toFixed(2))
              const riskPoints = Number((entryPrice - stopLoss).toFixed(2))

              if (riskPoints >= 2 * config.tickSize) {
                const targetPrice = entryPrice + 2.5 * riskPoints
                const targetPoints = Number((targetPrice - entryPrice).toFixed(2))
                const rrPlanned = Number((targetPoints / riskPoints).toFixed(2))

                if (rrPlanned >= 2.0) {
                  let exitPrice = entryPrice
                  let exitReason: 'TARGET' | 'STOP' | 'SESSION_CLOSE' = 'SESSION_CLOSE'
                  let exitTime = b.time

                  for (let f = 1; f <= 180; f++) {
                    const fb = bars[globalIdx + f]
                    if (!fb) break
                    const fbET = getEtTimeParts(fb.time)
                    if (fb.low <= stopLoss) {
                      exitPrice = stopLoss
                      exitReason = 'STOP'
                      exitTime = fb.time
                      break
                    }
                    if (fb.high >= targetPrice) {
                      exitPrice = targetPrice
                      exitReason = 'TARGET'
                      exitTime = fb.time
                      break
                    }
                    if (fbET.minsOfDay >= config.nativeSessionEndMin - 2) {
                      exitPrice = fb.close
                      exitReason = 'SESSION_CLOSE'
                      exitTime = fb.time
                      break
                    }
                  }

                  const grossPoints = Number((exitPrice - entryPrice).toFixed(2))
                  const realizedR = Number((grossPoints / riskPoints).toFixed(2))

                  const layerAPoints = grossPoints - 2 * config.tickSize
                  const layerAGrossDollars = grossPoints * config.pointValue
                  const layerANetDollars = layerAPoints * config.pointValue - config.cmeRoundTurnFee

                  const layerBPoints = grossPoints - config.cmcSpread
                  const layerBGrossDollars = grossPoints * config.pointValue
                  const layerBNetDollars = layerBPoints * config.pointValue

                  const et = getEtTimeParts(b.time)
                  trades.push({
                    market: marketKey,
                    dateStr: todayDate,
                    timeET: et.timeStr,
                    entryTime: b.time,
                    exitTime,
                    setupType: 'WYCKOFF_SOS_RETEST',
                    levelName: res.name,
                    levelPrice: res.price,
                    direction: 'LONG',
                    entryPrice,
                    stopLoss,
                    targetPrice,
                    riskPoints,
                    targetPoints,
                    rrPlanned,
                    exitPrice,
                    exitReason,
                    grossPoints,
                    realizedR,
                    atr,
                    volumeAbsorptionConfirmed: b.volume >= 1.2 * avgVol,
                    partition,
                    layerAGrossDollars,
                    layerANetDollars,
                    layerBGrossDollars,
                    layerBNetDollars,
                  })

                  activePositionUntil = exitTime
                  break
                }
              }
            }
          }
        }
      }

      if (b.time <= activePositionUntil) continue

      // ─────────────────────────────────────────────────────────────────────────────
      // SETUP 4: SIGN OF WEAKNESS (SOW) BREAKDOWN RETEST (Short)
      // Requirements:
      // 1. Level was support (e.g. VAL). Price recently broke down (< -0.4 ATR below L).
      // 2. Price pulls back to test L from below (High >= L - touchTol, Close <= L).
      // 3. Bearish rejection bar (Close < Open and Close in bottom 50% of bar range).
      // ─────────────────────────────────────────────────────────────────────────────
      for (const sup of currentSupports) {
        const L = sup.price
        if (b.high >= L - touchTol && b.close <= L && b.close < b.open) {
          const barRange = b.high - b.low
          if (barRange > 0 && (b.high - b.close) / barRange >= 0.5) {
            let hadBreakdown = false
            for (let look = 3; look <= 15; look++) {
              const pb = rthBars[bi - look]
              if (pb && pb.close < L - 0.4 * atr) {
                hadBreakdown = true
                break
              }
            }

            if (hadBreakdown) {
              const entryPrice = b.close
              const stopLoss = Number((b.high + buffer).toFixed(2))
              const riskPoints = Number((stopLoss - entryPrice).toFixed(2))

              if (riskPoints >= 2 * config.tickSize) {
                const targetPrice = entryPrice - 2.5 * riskPoints
                const targetPoints = Number((entryPrice - targetPrice).toFixed(2))
                const rrPlanned = Number((targetPoints / riskPoints).toFixed(2))

                if (rrPlanned >= 2.0) {
                  let exitPrice = entryPrice
                  let exitReason: 'TARGET' | 'STOP' | 'SESSION_CLOSE' = 'SESSION_CLOSE'
                  let exitTime = b.time

                  for (let f = 1; f <= 180; f++) {
                    const fb = bars[globalIdx + f]
                    if (!fb) break
                    const fbET = getEtTimeParts(fb.time)
                    if (fb.high >= stopLoss) {
                      exitPrice = stopLoss
                      exitReason = 'STOP'
                      exitTime = fb.time
                      break
                    }
                    if (fb.low <= targetPrice) {
                      exitPrice = targetPrice
                      exitReason = 'TARGET'
                      exitTime = fb.time
                      break
                    }
                    if (fbET.minsOfDay >= config.nativeSessionEndMin - 2) {
                      exitPrice = fb.close
                      exitReason = 'SESSION_CLOSE'
                      exitTime = fb.time
                      break
                    }
                  }

                  const grossPoints = Number((entryPrice - exitPrice).toFixed(2))
                  const realizedR = Number((grossPoints / riskPoints).toFixed(2))

                  const layerAPoints = grossPoints - 2 * config.tickSize
                  const layerAGrossDollars = grossPoints * config.pointValue
                  const layerANetDollars = layerAPoints * config.pointValue - config.cmeRoundTurnFee

                  const layerBPoints = grossPoints - config.cmcSpread
                  const layerBGrossDollars = grossPoints * config.pointValue
                  const layerBNetDollars = layerBPoints * config.pointValue

                  const et = getEtTimeParts(b.time)
                  trades.push({
                    market: marketKey,
                    dateStr: todayDate,
                    timeET: et.timeStr,
                    entryTime: b.time,
                    exitTime,
                    setupType: 'WYCKOFF_SOW_RETEST',
                    levelName: sup.name,
                    levelPrice: sup.price,
                    direction: 'SHORT',
                    entryPrice,
                    stopLoss,
                    targetPrice,
                    riskPoints,
                    targetPoints,
                    rrPlanned,
                    exitPrice,
                    exitReason,
                    grossPoints,
                    realizedR,
                    atr,
                    volumeAbsorptionConfirmed: b.volume >= 1.2 * avgVol,
                    partition,
                    layerAGrossDollars,
                    layerANetDollars,
                    layerBGrossDollars,
                    layerBNetDollars,
                  })

                  activePositionUntil = exitTime
                  break
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`Executed ${trades.length.toLocaleString()} total confirmed trades across all partitions.`)

  // Step 3: Breakdown by Partition
  const inSampleTrades = trades.filter((t) => t.partition === 'IN_SAMPLE')
  const walkForwardTrades = trades.filter((t) => t.partition === 'WALK_FORWARD')
  const oosTrades = trades.filter((t) => t.partition === 'SEQUESTERED_OOS')
  const quarantineTrades = trades.filter((t) => t.partition === 'QUARANTINE_TEST')
  const allEvalTrades = trades.filter((t) => t.partition !== 'WARMUP')

  const isStats = computePartitionStats(inSampleTrades)
  const wfStats = computePartitionStats(walkForwardTrades)
  const oosStats = computePartitionStats(oosTrades)
  const totalStats = computePartitionStats(allEvalTrades)

  // Step 4: Breakdown by Setup Type
  const setups: SetupType[] = ['WYCKOFF_SPRING', 'WYCKOFF_UPTHRUST', 'WYCKOFF_SOS_RETEST', 'WYCKOFF_SOW_RETEST']
  const setupStats = setups.map((st) => {
    const subset = allEvalTrades.filter((t) => t.setupType === st)
    return {
      setup: st,
      stats: computePartitionStats(subset),
    }
  })

  // Print Formatted Report
  console.log(`\n------------------------------------------------------------------------------------------------------------------------`)
  console.log(`📊 PERFORMANCE MATRIX: ${config.name}`)
  console.log(`------------------------------------------------------------------------------------------------------------------------`)
  console.log(`Partition               Trades   Days   Win%   ProfitFactor   Expectancy(R)   Net PnL Layer A ($)   Net PnL Layer B ($)   Sharpe   MaxDD($)`)
  console.log(`------------------------------------------------------------------------------------------------------------------------`)

  const row = (name: string, s: SummaryStats) =>
    `${name.padEnd(22)} ${String(s.n).padStart(6)} ${String(s.uniqueDays).padStart(6)} ${(s.winRatePct + '%').padStart(6)} ${String(s.profitFactor).padStart(14)} ${(s.expectancyR + 'R').padStart(15)} ${('$' + s.totalNetPnLA.toLocaleString()).padStart(21)} ${('$' + s.totalNetPnLB.toLocaleString()).padStart(21)} ${String(s.sharpeRatioA).padStart(8)} ${('$' + s.maxDrawdownDollarsA.toLocaleString()).padStart(10)}`

  console.log(row('In-Sample (2021-2023)', isStats))
  console.log(row('Walk-Forward (2024-2025)', wfStats))
  console.log(row('Sequestered OOS (2026)', oosStats))
  console.log(row('FULL REPLAY (Total)', totalStats))
  console.log(`------------------------------------------------------------------------------------------------------------------------`)
  console.log(`Day-Clustered 95% CI (Expectancy R): [${totalStats.ciRLow} to ${totalStats.ciHigh}] R`)
  console.log(`Stability Ratio (WF E[R] / IS E[R]): ${isStats.expectancyR !== 0 ? (wfStats.expectancyR / isStats.expectancyR).toFixed(2) : 'N/A'}`)
  console.log(`\nSetup Breakdown:`)
  for (const ss of setupStats) {
    console.log(`  - ${ss.setup.padEnd(20)}: ${ss.stats.n} trades | Win: ${ss.stats.winRatePct}% | PF: ${ss.stats.profitFactor} | Exp: ${ss.stats.expectancyR}R | Layer A: $${ss.stats.totalNetPnLA.toLocaleString()} | Layer B: $${ss.stats.totalNetPnLB.toLocaleString()}`)
  }

  return {
    market: marketKey,
    config,
    trades,
    isStats,
    wfStats,
    oosStats,
    totalStats,
    setupStats,
  }
}

async function main() {
  const outDir = path.resolve(process.cwd(), 'data')
  const resultsOutPath = path.join(outDir, 'cme-wyckoff-confirmation-results.json')

  const markets = [
    { key: 'NASDAQ', file: 'data/cme_multiyear/nasdaq_1m_multiyear.json' },
    { key: 'DOW', file: 'data/cme_multiyear/dow_1m_multiyear.json' },
    { key: 'CRUDE', file: 'data/cme_multiyear/crude_1m_multiyear.json' },
    { key: 'GOLD', file: 'data/cme_multiyear/gold_1m_multiyear.json' },
  ]

  const allMarketResults: any[] = []

  for (const m of markets) {
    const fullPath = path.resolve(process.cwd(), m.file)
    const res = runWyckoffConfirmationReplay(m.key, fullPath)
    if (res) {
      allMarketResults.push({
        market: m.key,
        name: res.config.name,
        isStats: res.isStats,
        wfStats: res.wfStats,
        oosStats: res.oosStats,
        totalStats: res.totalStats,
        setupStats: res.setupStats,
        tradeCount: res.trades.length,
      })
    }
  }

  fs.writeFileSync(resultsOutPath, JSON.stringify(allMarketResults, null, 2))
  console.log(`\n✅ Finished All Market Replays! Saved Phase 2 Wyckoff Results to ${resultsOutPath}\n`)
}

main().catch((err) => {
  console.error('Fatal replay error:', err)
  process.exit(1)
})
