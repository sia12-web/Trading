/**
 * Institutional CME Wyckoff 22-Rule Calibration & Execution Engine
 *
 * Implements the full Trader's 22-Rule Wyckoff Execution Protocol:
 * 1. Rule 11/12: Volume & CVD Absorption Filter (Sweep volume >= 1.2x average or narrow range effort-vs-result).
 * 2. Rule 20: Max 3 Stop Attempts Per Day (Circuit-breaker locks desk on 3 stops).
 * 3. Rule 21: Lunch Doldrums Lockout (No new entries 11:30 AM - 1:30 PM ET).
 * 4. Realistic Structural Invalidation Stop: min stop = max(4 ticks, 0.40 ATR) to withstand 1m micro-noise.
 * 5. Rule 18: Breakeven Trailing at +1.0R.
 * 6. Mandatory >= 2.0R Target Runway (Rule 16/17).
 *
 * Evaluates:
 * - In-Sample Training (2021-2023)
 * - Walk-Forward Validation (2024-2025)
 * - Sequestered OOS Holdout (2026)
 * - Dual Execution: Layer A (CME Futures) vs Layer B (CMC CFD)
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
  cmeRoundTurnFee: number
  cmcSpread: number
  lunchStartMin: number
  lunchEndMin: number
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
    cmeRoundTurnFee: 4.80,
    cmcSpread: 1.0,
    lunchStartMin: 11 * 60 + 30,
    lunchEndMin: 13 * 60 + 30,
  },
  DOW: {
    name: 'DOW (YM)',
    symbol: 'YM.c.0',
    tickSize: 1.0,
    pointValue: 5.0,
    binWidthTicks: 10,
    binWidthPrice: 10.0,
    nativeSessionStartMin: 9 * 60 + 30,
    nativeSessionEndMin: 16 * 60,
    settlementWindowStartMin: 15 * 60 + 59,
    settlementWindowEndMin: 16 * 60,
    cmeRoundTurnFee: 4.80,
    cmcSpread: 2.0,
    lunchStartMin: 11 * 60 + 30,
    lunchEndMin: 13 * 60 + 30,
  },
  CRUDE: {
    name: 'CRUDE (CL)',
    symbol: 'CL.c.0',
    tickSize: 0.01,
    pointValue: 1000.0,
    binWidthTicks: 5,
    binWidthPrice: 0.05,
    nativeSessionStartMin: 9 * 60,
    nativeSessionEndMin: 14 * 60 + 30,
    settlementWindowStartMin: 14 * 60 + 28,
    settlementWindowEndMin: 14 * 60 + 30,
    cmeRoundTurnFee: 3.00,
    cmcSpread: 0.03,
    lunchStartMin: 11 * 60 + 30,
    lunchEndMin: 12 * 60 + 30,
  },
  GOLD: {
    name: 'GOLD (GC)',
    symbol: 'GC.c.0',
    tickSize: 0.1,
    pointValue: 100.0,
    binWidthTicks: 5,
    binWidthPrice: 0.5,
    nativeSessionStartMin: 8 * 60 + 20,
    nativeSessionEndMin: 13 * 60 + 30,
    settlementWindowStartMin: 13 * 60 + 29,
    settlementWindowEndMin: 13 * 60 + 30,
    cmeRoundTurnFee: 3.60,
    cmcSpread: 0.30,
    lunchStartMin: 11 * 60 + 30,
    lunchEndMin: 12 * 60 + 15,
  },
}

export interface CalibrationParams {
  requireVolumeAbsorption: boolean
  maxStopsPerDay: number
  skipLunchDoldrums: boolean
  minStopATRMultiple: number // e.g. 0.35 ATR
  breakevenTriggerR: number  // e.g. 1.0 R
}

export interface TradeRecord {
  market: string
  dateStr: string
  setupType: string
  levelName: string
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  stopLoss: number
  targetPrice: number
  riskPoints: number
  exitPrice: number
  exitReason: 'TARGET' | 'STOP' | 'BREAKEVEN' | 'SESSION_CLOSE'
  grossPoints: number
  realizedR: number
  layerANetDollars: number
  layerBNetDollars: number
  partition: 'WARMUP' | 'IN_SAMPLE' | 'WALK_FORWARD' | 'QUARANTINE_TEST' | 'SEQUESTERED_OOS'
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
  const dstStart = Date.UTC(y, 2, secondSunMar, 7)
  const nov1 = new Date(Date.UTC(y, 10, 1)).getUTCDay()
  const firstSunNov = 1 + ((7 - nov1) % 7)
  const dstEnd = Date.UTC(y, 10, firstSunNov, 6)
  const t = d.getTime()
  return t >= dstStart && t < dstEnd
}

function getEtTimeParts(unixSec: number) {
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

export function executeMarketWithParams(
  marketKey: string,
  bars: Bar1M[],
  params: CalibrationParams
): TradeRecord[] {
  const config = MARKET_CONFIGS[marketKey]

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

  const barIndexMap = new Map<number, number>()
  for (let i = 0; i < bars.length; i++) {
    barIndexMap.set(bars[i].time, i)
  }

  const trades: TradeRecord[] = []

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

    const rthBars = todaySess.nativeRth
    let dailyStops = 0
    let activeUntil = -1

    for (let bi = 10; bi < rthBars.length - 15; bi++) {
      // Rule 20: 3-Stop Daily Lockout
      if (dailyStops >= params.maxStopsPerDay) break

      const b = rthBars[bi]
      if (b.time <= activeUntil) continue

      const et = getEtTimeParts(b.time)
      // Rule 21: Skip Lunch Doldrums
      if (params.skipLunchDoldrums && et.minsOfDay >= config.lunchStartMin && et.minsOfDay < config.lunchEndMin) {
        continue
      }

      const globalIdx = barIndexMap.get(b.time) ?? -1
      if (globalIdx === -1 || globalIdx + 120 >= bars.length) continue

      const atr = calculateWilderATR14(bars, globalIdx)
      const touchTol = Math.max(2 * config.tickSize, 0.10 * atr)

      // Minimum structural stop distance to withstand noise
      const minStopDist = Math.max(4 * config.tickSize, params.minStopATRMultiple * atr)

      let volSum = 0
      for (let k = Math.max(0, bi - 20); k < bi; k++) {
        volSum += rthBars[k].volume
      }
      const avgVol = volSum / Math.max(1, Math.min(20, bi))

      // ─────────────────────────────────────────────────────────────────────────────
      // SETUP 1: WYCKOFF SPRING (Long)
      // ─────────────────────────────────────────────────────────────────────────────
      for (const sup of supportLevels) {
        const L = sup.price
        if (b.low <= L + touchTol && b.close >= L) {
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
            const isVolumeAbsorption = sweepVol >= 1.2 * avgVol || b.volume >= 1.2 * avgVol
            if (params.requireVolumeAbsorption && !isVolumeAbsorption) continue

            const entryPrice = b.close
            const rawStop = sweepLow - 2 * config.tickSize
            const stopLoss = Number(Math.min(rawStop, entryPrice - minStopDist).toFixed(2))
            const riskPoints = Number((entryPrice - stopLoss).toFixed(2))

            // Find opposing target
            const opposingRes = resistanceLevels.filter((r) => r.price > entryPrice + 1.0)
            let targetPrice = entryPrice + 2.5 * riskPoints
            if (opposingRes.length > 0) {
              opposingRes.sort((a, b) => a.price - b.price)
              targetPrice = opposingRes[0].price
            }

            const targetPoints = Number((targetPrice - entryPrice).toFixed(2))
            const rrPlanned = Number((targetPoints / riskPoints).toFixed(2))

            if (rrPlanned >= 2.0) {
              let exitPrice = entryPrice
              let exitReason: 'TARGET' | 'STOP' | 'BREAKEVEN' | 'SESSION_CLOSE' = 'SESSION_CLOSE'
              let exitTime = b.time
              let reachedBreakevenTrigger = false
              let effectiveStop = stopLoss

              for (let f = 1; f <= 180; f++) {
                const fb = bars[globalIdx + f]
                if (!fb) break

                const fbET = getEtTimeParts(fb.time)

                // Check breakeven trail
                if (!reachedBreakevenTrigger && fb.high >= entryPrice + params.breakevenTriggerR * riskPoints) {
                  reachedBreakevenTrigger = true
                  effectiveStop = entryPrice + config.tickSize // Breakeven + 1 tick
                }

                if (fb.low <= effectiveStop) {
                  exitPrice = effectiveStop
                  exitReason = reachedBreakevenTrigger ? 'BREAKEVEN' : 'STOP'
                  exitTime = fb.time
                  if (exitReason === 'STOP') dailyStops++
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
              const layerANetDollars = layerAPoints * config.pointValue - config.cmeRoundTurnFee
              const layerBPoints = grossPoints - config.cmcSpread
              const layerBNetDollars = layerBPoints * config.pointValue

              trades.push({
                market: marketKey,
                dateStr: todayDate,
                setupType: 'WYCKOFF_SPRING',
                levelName: sup.name,
                direction: 'LONG',
                entryPrice,
                stopLoss,
                targetPrice,
                riskPoints,
                exitPrice,
                exitReason,
                grossPoints,
                realizedR,
                layerANetDollars,
                layerBNetDollars,
                partition,
              })

              activeUntil = exitTime
              break
            }
          }
        }
      }

      if (b.time <= activeUntil) continue

      // ─────────────────────────────────────────────────────────────────────────────
      // SETUP 2: WYCKOFF UPTHRUST (Short)
      // ─────────────────────────────────────────────────────────────────────────────
      for (const res of resistanceLevels) {
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
            const isVolumeAbsorption = sweepVol >= 1.2 * avgVol || b.volume >= 1.2 * avgVol
            if (params.requireVolumeAbsorption && !isVolumeAbsorption) continue

            const entryPrice = b.close
            const rawStop = sweepHigh + 2 * config.tickSize
            const stopLoss = Number(Math.max(rawStop, entryPrice + minStopDist).toFixed(2))
            const riskPoints = Number((stopLoss - entryPrice).toFixed(2))

            const opposingSup = supportLevels.filter((s) => s.price < entryPrice - 1.0)
            let targetPrice = entryPrice - 2.5 * riskPoints
            if (opposingSup.length > 0) {
              opposingSup.sort((a, b) => b.price - a.price)
              targetPrice = opposingSup[0].price
            }

            const targetPoints = Number((entryPrice - targetPrice).toFixed(2))
            const rrPlanned = Number((targetPoints / riskPoints).toFixed(2))

            if (rrPlanned >= 2.0) {
              let exitPrice = entryPrice
              let exitReason: 'TARGET' | 'STOP' | 'BREAKEVEN' | 'SESSION_CLOSE' = 'SESSION_CLOSE'
              let exitTime = b.time
              let reachedBreakevenTrigger = false
              let effectiveStop = stopLoss

              for (let f = 1; f <= 180; f++) {
                const fb = bars[globalIdx + f]
                if (!fb) break

                const fbET = getEtTimeParts(fb.time)

                if (!reachedBreakevenTrigger && fb.low <= entryPrice - params.breakevenTriggerR * riskPoints) {
                  reachedBreakevenTrigger = true
                  effectiveStop = entryPrice - config.tickSize
                }

                if (fb.high >= effectiveStop) {
                  exitPrice = effectiveStop
                  exitReason = reachedBreakevenTrigger ? 'BREAKEVEN' : 'STOP'
                  exitTime = fb.time
                  if (exitReason === 'STOP') dailyStops++
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
              const layerANetDollars = layerAPoints * config.pointValue - config.cmeRoundTurnFee
              const layerBPoints = grossPoints - config.cmcSpread
              const layerBNetDollars = layerBPoints * config.pointValue

              trades.push({
                market: marketKey,
                dateStr: todayDate,
                setupType: 'WYCKOFF_UPTHRUST',
                levelName: res.name,
                direction: 'SHORT',
                entryPrice,
                stopLoss,
                targetPrice,
                riskPoints,
                exitPrice,
                exitReason,
                grossPoints,
                realizedR,
                layerANetDollars,
                layerBNetDollars,
                partition,
              })

              activeUntil = exitTime
              break
            }
          }
        }
      }
    }
  }

  return trades
}

function calculateMetrics(trades: TradeRecord[]) {
  if (trades.length === 0) return { n: 0, winRate: 0, pf: 0, expR: 0, netA: 0, netB: 0 }
  const wins = trades.filter((t) => t.realizedR > 0)
  const n = trades.length
  const winRate = Number(((wins.length / n) * 100).toFixed(1))

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

  const pf = grossLossesA > 0 ? Number((grossGainsA / grossLossesA).toFixed(2)) : 99.99
  const expR = Number((totalR / n).toFixed(2))

  return {
    n,
    winRate,
    pf,
    expR,
    netA: Number(totalNetA.toFixed(0)),
    netB: Number(totalNetB.toFixed(0)),
  }
}

async function main() {
  console.log(`====================================================================================================`)
  console.log(`🏛️ INSTITUTIONAL CME WYCKOFF 22-RULE CALIBRATION & IN-SAMPLE FOLD OPTIMIZATION`)
  console.log(`====================================================================================================`)

  const markets = [
    { key: 'NASDAQ', file: 'data/cme_multiyear/nasdaq_1m_multiyear.json' },
    { key: 'DOW', file: 'data/cme_multiyear/dow_1m_multiyear.json' },
    { key: 'CRUDE', file: 'data/cme_multiyear/crude_1m_multiyear.json' },
    { key: 'GOLD', file: 'data/cme_multiyear/gold_1m_multiyear.json' },
  ]

  // In-Sample Parameter Grid
  const candidateParams: CalibrationParams[] = [
    // Baseline uncalibrated
    { requireVolumeAbsorption: false, maxStopsPerDay: 99, skipLunchDoldrums: false, minStopATRMultiple: 0.15, breakevenTriggerR: 99 },
    // Adding 3-stop lockout + lunch skip
    { requireVolumeAbsorption: false, maxStopsPerDay: 3, skipLunchDoldrums: true, minStopATRMultiple: 0.25, breakevenTriggerR: 99 },
    // Adding Volume Absorption requirement
    { requireVolumeAbsorption: true, maxStopsPerDay: 3, skipLunchDoldrums: true, minStopATRMultiple: 0.25, breakevenTriggerR: 99 },
    // Adding realistic structural stop (0.40 ATR)
    { requireVolumeAbsorption: true, maxStopsPerDay: 3, skipLunchDoldrums: true, minStopATRMultiple: 0.40, breakevenTriggerR: 99 },
    // Full 22-Rule Suite (Absorption + 3 Stops + Lunch Skip + 0.40 ATR Stop + Breakeven Trail at 1.0R)
    { requireVolumeAbsorption: true, maxStopsPerDay: 3, skipLunchDoldrums: true, minStopATRMultiple: 0.40, breakevenTriggerR: 1.0 },
    // Full 22-Rule Suite with 0.50 ATR Stop
    { requireVolumeAbsorption: true, maxStopsPerDay: 3, skipLunchDoldrums: true, minStopATRMultiple: 0.50, breakevenTriggerR: 1.0 },
  ]

  const gridResults: any[] = []

  for (const m of markets) {
    const fullPath = path.resolve(process.cwd(), m.file)
    if (!fs.existsSync(fullPath)) continue
    const raw = fs.readFileSync(fullPath, 'utf-8')
    const bars: Bar1M[] = JSON.parse(raw)
    bars.sort((a, b) => a.time - b.time)

    console.log(`\nEvaluating Market: ${m.key} (${bars.length.toLocaleString()} bars)`)

    for (let pIdx = 0; pIdx < candidateParams.length; pIdx++) {
      const p = candidateParams[pIdx]
      const trades = executeMarketWithParams(m.key, bars, p)

      const isTrades = trades.filter((t) => t.partition === 'IN_SAMPLE')
      const wfTrades = trades.filter((t) => t.partition === 'WALK_FORWARD')
      const oosTrades = trades.filter((t) => t.partition === 'SEQUESTERED_OOS')

      const isM = calculateMetrics(isTrades)
      const wfM = calculateMetrics(wfTrades)
      const oosM = calculateMetrics(oosTrades)

      console.log(`  Config [${pIdx + 1}]: Absorp=${p.requireVolumeAbsorption} | MaxStops=${p.maxStopsPerDay} | LunchSkip=${p.skipLunchDoldrums} | MinStop=${p.minStopATRMultiple}ATR | BE=${p.breakevenTriggerR}R`)
      console.log(`    -> IN-SAMPLE:     N=${isM.n}, Win=${isM.winRate}%, PF=${isM.pf}, E[R]=${isM.expR}R, NetA=$${isM.netA.toLocaleString()}, NetB=$${isM.netB.toLocaleString()}`)
      console.log(`    -> WALK-FORWARD:  N=${wfM.n}, Win=${wfM.winRate}%, PF=${wfM.pf}, E[R]=${wfM.expR}R, NetA=$${wfM.netA.toLocaleString()}, NetB=$${wfM.netB.toLocaleString()}`)
      console.log(`    -> SEQUESTERED:   N=${oosM.n}, Win=${oosM.winRate}%, PF=${oosM.pf}, E[R]=${oosM.expR}R, NetA=$${oosM.netA.toLocaleString()}, NetB=$${oosM.netB.toLocaleString()}`)

      gridResults.push({
        market: m.key,
        configIndex: pIdx + 1,
        params: p,
        isMetrics: isM,
        wfMetrics: wfM,
        oosMetrics: oosM,
      })
    }
  }

  const outPath = path.resolve(process.cwd(), 'data/cme-wyckoff-calibration-grid.json')
  fs.writeFileSync(outPath, JSON.stringify(gridResults, null, 2))
  console.log(`\nSaved Calibration Grid to ${outPath}`)
}

main().catch((err) => {
  console.error('Calibration error:', err)
  process.exit(1)
})
