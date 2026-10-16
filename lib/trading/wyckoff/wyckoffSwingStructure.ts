/**
 * Wyckoff Causal Swing Structure, Market Specs, Rollover Normalization & Timeframe Resampling
 *
 * Guarantees:
 * - Zero lookahead / non-repainting: a swing at index `p` is confirmed strictly at bar `p + rightBars`
 *   using only bars `<= p + rightBars`. Future candles after the confirmation bar cannot alter it.
 * - Futures contract rollover handling: adjusts price level discontinuities when `contractSymbol` rolls
 *   so contract basis jumps are never misclassified as initiative breakouts or selling climaxes.
 * - Market-specific tick sizes, exchanges, and session calendars for NQ, YM, GC, CL, and NK225.
 */

import { resolveCanonicalMarketId } from '@/lib/ai/canonicalMarkets'
import type {
  SwingLabel,
  WyckoffCandle,
  WyckoffInstrument,
  WyckoffMarketSpec,
  WyckoffSwingPoint,
  WyckoffSwingStructure,
  WyckoffTimeframe,
} from './types'

export const WYCKOFF_MARKET_SPECS: Record<WyckoffInstrument, WyckoffMarketSpec> = {
  NASDAQ: {
    instrument: 'NASDAQ',
    canonicalId: 'NQ',
    exchange: 'CME_GLOBEX',
    primaryContract: 'NQ',
    microContract: 'MNQ',
    tickSize: 0.25,
    pointValue: 20,
    sessionCalendar: {
      timezone: 'America/New_York',
      cashOpenLocal: '09:30',
      cashCloseLocal: '16:00',
      globexResetHourEt: 18,
    },
    rolloverCycleMonths: [3, 6, 9, 12],
  },
  DOW: {
    instrument: 'DOW',
    canonicalId: 'YM',
    exchange: 'CBOT',
    primaryContract: 'YM',
    microContract: 'MYM',
    tickSize: 1.0,
    pointValue: 5,
    sessionCalendar: {
      timezone: 'America/New_York',
      cashOpenLocal: '09:30',
      cashCloseLocal: '16:00',
      globexResetHourEt: 18,
    },
    rolloverCycleMonths: [3, 6, 9, 12],
  },
  GOLD: {
    instrument: 'GOLD',
    canonicalId: 'GC',
    exchange: 'COMEX',
    primaryContract: 'GC',
    microContract: 'MGC',
    tickSize: 0.1,
    pointValue: 100,
    sessionCalendar: {
      timezone: 'America/New_York',
      cashOpenLocal: '08:20',
      cashCloseLocal: '13:30',
      globexResetHourEt: 18,
    },
    rolloverCycleMonths: [2, 4, 6, 8, 10, 12],
  },
  CRUDE: {
    instrument: 'CRUDE',
    canonicalId: 'CL',
    exchange: 'NYMEX',
    primaryContract: 'CL',
    microContract: 'MCL',
    tickSize: 0.01,
    pointValue: 1000,
    sessionCalendar: {
      timezone: 'America/New_York',
      cashOpenLocal: '09:00',
      cashCloseLocal: '14:30',
      globexResetHourEt: 18,
    },
    rolloverCycleMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
  NIKKEI: {
    instrument: 'NIKKEI',
    canonicalId: 'NK225',
    exchange: 'OSE_CME',
    primaryContract: 'NKD',
    microContract: 'NIY',
    tickSize: 5.0,
    pointValue: 5,
    sessionCalendar: {
      timezone: 'Asia/Tokyo',
      cashOpenLocal: '09:00',
      cashCloseLocal: '15:00',
      globexResetHourEt: 18,
    },
    rolloverCycleMonths: [3, 6, 9, 12],
  },
}

export function resolveWyckoffMarketSpec(rawInstrument: string): WyckoffMarketSpec {
  const canonical = resolveCanonicalMarketId(rawInstrument)
  switch (canonical) {
    case 'YM':
      return WYCKOFF_MARKET_SPECS.DOW
    case 'GC':
      return WYCKOFF_MARKET_SPECS.GOLD
    case 'CL':
      return WYCKOFF_MARKET_SPECS.CRUDE
    case 'NK225':
      return WYCKOFF_MARKET_SPECS.NIKKEI
    case 'NQ':
    default:
      return WYCKOFF_MARKET_SPECS.NASDAQ
  }
}

/** Normalize bar timestamps to Unix seconds and sort chronologically without mutating input. */
export function normalizeWyckoffCandles(raw: WyckoffCandle[]): WyckoffCandle[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const cleaned: WyckoffCandle[] = []
  for (const b of raw) {
    if (
      !b ||
      !Number.isFinite(b.time) ||
      !Number.isFinite(b.open) ||
      !Number.isFinite(b.high) ||
      !Number.isFinite(b.low) ||
      !Number.isFinite(b.close)
    ) {
      continue
    }
    const timeSec = b.time > 1e11 ? Math.floor(b.time / 1000) : Math.floor(b.time)
    cleaned.push({
      ...b,
      time: timeSec,
      volume: Number.isFinite(b.volume) && b.volume >= 0 ? b.volume : 0,
    })
  }
  cleaned.sort((a, b) => a.time - b.time)
  // Deduplicate identical timestamps (keep latest update for same timestamp)
  const deduped: WyckoffCandle[] = []
  for (const bar of cleaned) {
    const prev = deduped[deduped.length - 1]
    if (prev && prev.time === bar.time) {
      deduped[deduped.length - 1] = bar
    } else {
      deduped.push(bar)
    }
  }
  return deduped
}

/**
 * Back-adjusts prior contract bars when `contractSymbol` rolls to a new front month,
 * preserving exact bar ranges, volume, and delta while removing artificial roll basis gaps.
 */
export function adjustCandlesForContractRollover(candles: WyckoffCandle[]): {
  candles: WyckoffCandle[]
  rolloverAdjusted: boolean
} {
  const normalized = normalizeWyckoffCandles(candles)
  if (normalized.length < 2) {
    return { candles: normalized, rolloverAdjusted: false }
  }

  // Detect any contractSymbol transitions
  const rollOffsets = new Array<number>(normalized.length).fill(0)
  let cumulativeBasisShift = 0
  let rolloverDetected = false

  for (let i = normalized.length - 1; i >= 1; i--) {
    const curr = normalized[i]!
    const prev = normalized[i - 1]!
    if (
      curr.contractSymbol &&
      prev.contractSymbol &&
      curr.contractSymbol !== prev.contractSymbol
    ) {
      // Basis gap between new contract open and old contract close
      const basisGap = curr.open - prev.close
      cumulativeBasisShift += basisGap
      rolloverDetected = true
    }
    rollOffsets[i - 1] = cumulativeBasisShift
  }

  if (!rolloverDetected) {
    return { candles: normalized, rolloverAdjusted: false }
  }

  const adjusted = normalized.map((b, idx) => {
    const shift = rollOffsets[idx] ?? 0
    if (shift === 0) return b
    return {
      ...b,
      open: Number((b.open + shift).toFixed(4)),
      high: Number((b.high + shift).toFixed(4)),
      low: Number((b.low + shift).toFixed(4)),
      close: Number((b.close + shift).toFixed(4)),
    }
  })

  return { candles: adjusted, rolloverAdjusted: true }
}

/**
 * Resamples lower-timeframe candles (e.g. 1m or 5m) into target WyckoffTimeframe ('5m', '30m', '1D')
 * causally, preserving aggressor buy/sell volumes and running CVD.
 */
export function resampleWyckoffCandles(
  rawCandles: WyckoffCandle[],
  targetTimeframe: WyckoffTimeframe
): WyckoffCandle[] {
  const { candles } = adjustCandlesForContractRollover(rawCandles)
  if (candles.length === 0) return []

  const bucketSec =
    targetTimeframe === '1D'
      ? 86400
      : targetTimeframe === '4H'
      ? 14400
      : targetTimeframe === '30m'
      ? 1800
      : 300

  // Check if already at or above bucket spacing
  if (candles.length >= 2) {
    const diffs: number[] = []
    for (let i = 1; i < Math.min(candles.length, 15); i++) {
      const d = candles[i]!.time - candles[i - 1]!.time
      if (d > 0) diffs.push(d)
    }
    diffs.sort((a, b) => a - b)
    const medianDiff = diffs[Math.floor(diffs.length / 2)] ?? bucketSec
    if (medianDiff >= bucketSec * 0.9 && medianDiff <= bucketSec * 1.2) {
      return candles
    }
  }

  const buckets = new Map<number, WyckoffCandle>()
  for (const b of candles) {
    const bucketStart = Math.floor(b.time / bucketSec) * bucketSec
    const existing = buckets.get(bucketStart)
    if (!existing) {
      buckets.set(bucketStart, {
        ...b,
        time: bucketStart,
      })
    } else {
      existing.high = Math.max(existing.high, b.high)
      existing.low = Math.min(existing.low, b.low)
      existing.close = b.close
      existing.volume += b.volume
      if (b.buyVolume != null) {
        existing.buyVolume = (existing.buyVolume ?? 0) + b.buyVolume
      }
      if (b.sellVolume != null) {
        existing.sellVolume = (existing.sellVolume ?? 0) + b.sellVolume
      }
      if (b.delta != null) {
        existing.delta = (existing.delta ?? 0) + b.delta
      }
      if (b.cvd != null) {
        existing.cvd = b.cvd
      }
      if (b.isEstimatedCvd != null) {
        existing.isEstimatedCvd = existing.isEstimatedCvd || b.isEstimatedCvd
      }
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time)
}

/**
 * Computes causal, non-repainting swing highs and lows.
 *
 * A swing at index `p` is confirmed strictly at bar `p + rightBars` using only bars
 * `[p - leftBars, p + rightBars]`. No bars after `p + rightBars` are ever inspected.
 */
export function computeWyckoffSwingStructure(
  rawCandles: WyckoffCandle[],
  instrumentOrTimeframe: string,
  timeframeOrOptions?:
    | WyckoffTimeframe
    | {
        leftBars?: number
        rightBars?: number
        equalToleranceAtrFrac?: number
      },
  maybeOptions?: {
    leftBars?: number
    rightBars?: number
    equalToleranceAtrFrac?: number
  }
): WyckoffSwingStructure {
  const isSecondArgTf =
    instrumentOrTimeframe === '1D' ||
    instrumentOrTimeframe === '4H' ||
    instrumentOrTimeframe === '30m' ||
    instrumentOrTimeframe === '5m'
  const timeframe: WyckoffTimeframe = isSecondArgTf
    ? (instrumentOrTimeframe as WyckoffTimeframe)
    : typeof timeframeOrOptions === 'string'
      ? (timeframeOrOptions as WyckoffTimeframe)
      : '5m'
  const options = isSecondArgTf
    ? typeof timeframeOrOptions === 'object'
      ? timeframeOrOptions
      : undefined
    : maybeOptions

  const { candles, rolloverAdjusted } = adjustCandlesForContractRollover(rawCandles)
  const leftBars = options?.leftBars ?? (timeframe === '1D' || timeframe === '4H' ? 2 : timeframe === '30m' ? 2 : 3)
  const rightBars = options?.rightBars ?? (timeframe === '1D' || timeframe === '4H' ? 2 : timeframe === '30m' ? 2 : 2)
  const eqTolFrac = options?.equalToleranceAtrFrac ?? 0.15

  if (candles.length < leftBars + rightBars + 1) {
    return {
      timeframe,
      swings: [],
      latestSwingHigh: null,
      latestSwingLow: null,
      priorSwingHigh: null,
      priorSwingLow: null,
      higherHighCount: 0,
      higherLowCount: 0,
      lowerHighCount: 0,
      lowerLowCount: 0,
      equalHighCount: 0,
      equalLowCount: 0,
      structuralTrend: 'UNKNOWN',
      priorTrendBeforeRange: 'UNKNOWN',
      rolloverAdjusted,
      summary: 'UNKNOWN (Insufficient bars for causal swing confirmation)',
    }
  }

  // Compute causal rolling average bar range for equality tolerance
  const avgRangeAt = (idx: number): number => {
    const start = Math.max(0, idx - 14)
    let sum = 0
    let count = 0
    for (let k = start; k <= idx; k++) {
      sum += Math.max(0.0001, candles[k]!.high - candles[k]!.low)
      count++
    }
    return count > 0 ? sum / count : 1
  }

  const swings: WyckoffSwingPoint[] = []
  let lastHighPrice: number | null = null
  let lastLowPrice: number | null = null

  let higherHighCount = 0
  let higherLowCount = 0
  let lowerHighCount = 0
  let lowerLowCount = 0
  let equalHighCount = 0
  let equalLowCount = 0

  // Iterate causally by confirmation bar `confirmIdx = pivotIdx + rightBars`
  for (let confirmIdx = leftBars + rightBars; confirmIdx < candles.length; confirmIdx++) {
    const pivotIdx = confirmIdx - rightBars
    const pivotBar = candles[pivotIdx]!
    const confirmBar = candles[confirmIdx]!
    const eqTol = avgRangeAt(confirmIdx) * eqTolFrac

    let isSwingHigh = true
    let isSwingLow = true

    for (let j = pivotIdx - leftBars; j <= pivotIdx + rightBars; j++) {
      if (j === pivotIdx) continue
      const neighbor = candles[j]!
      // Strict inequality on the right side prevents duplicate adjacent pivots on flat tops/bottoms
      if (j < pivotIdx) {
        if (neighbor.high > pivotBar.high) isSwingHigh = false
        if (neighbor.low < pivotBar.low) isSwingLow = false
      } else {
        if (neighbor.high >= pivotBar.high) isSwingHigh = false
        if (neighbor.low <= pivotBar.low) isSwingLow = false
      }
    }

    if (isSwingHigh) {
      let label: SwingLabel = 'HH'
      if (lastHighPrice !== null) {
        if (Math.abs(pivotBar.high - lastHighPrice) <= eqTol) {
          label = 'EQH'
          equalHighCount++
        } else if (pivotBar.high > lastHighPrice) {
          label = 'HH'
          higherHighCount++
        } else {
          label = 'LH'
          lowerHighCount++
        }
      }
      lastHighPrice = pivotBar.high
      swings.push({
        index: pivotIdx,
        pivotTime: pivotBar.time,
        confirmedAtTime: confirmBar.time,
        price: pivotBar.high,
        type: 'HIGH',
        label,
        volumeAtPivot: pivotBar.volume,
        cvdAtPivot: pivotBar.cvd ?? null,
      })
    }

    if (isSwingLow) {
      let label: SwingLabel = 'HL'
      if (lastLowPrice !== null) {
        if (Math.abs(pivotBar.low - lastLowPrice) <= eqTol) {
          label = 'EQL'
          equalLowCount++
        } else if (pivotBar.low > lastLowPrice) {
          label = 'HL'
          higherLowCount++
        } else {
          label = 'LL'
          lowerLowCount++
        }
      }
      lastLowPrice = pivotBar.low
      swings.push({
        index: pivotIdx,
        pivotTime: pivotBar.time,
        confirmedAtTime: confirmBar.time,
        price: pivotBar.low,
        type: 'LOW',
        label,
        volumeAtPivot: pivotBar.volume,
        cvdAtPivot: pivotBar.cvd ?? null,
      })
    }
  }

  const highSwings = swings.filter((s) => s.type === 'HIGH')
  const lowSwings = swings.filter((s) => s.type === 'LOW')

  const latestSwingHigh = highSwings[highSwings.length - 1] ?? null
  const priorSwingHigh = highSwings[highSwings.length - 2] ?? null
  const latestSwingLow = lowSwings[lowSwings.length - 1] ?? null
  const priorSwingLow = lowSwings[lowSwings.length - 2] ?? null

  // Determine current structural trend from the most recent swing highs & lows
  let structuralTrend: WyckoffSwingStructure['structuralTrend'] = 'ROTATIONAL'
  if (latestSwingHigh && latestSwingLow && priorSwingHigh && priorSwingLow) {
    const recentHighUp = latestSwingHigh.label === 'HH'
    const recentLowUp = latestSwingLow.label === 'HL'
    const recentHighDown = latestSwingHigh.label === 'LH'
    const recentLowDown = latestSwingLow.label === 'LL'

    if (recentHighUp && recentLowUp) {
      structuralTrend = 'UPTREND'
    } else if (recentHighDown && recentLowDown) {
      structuralTrend = 'DOWNTREND'
    } else if ((recentHighUp && recentLowDown) || (recentHighDown && recentLowUp)) {
      structuralTrend = 'ROTATIONAL'
    } else {
      structuralTrend = 'TRANSITIONING'
    }
  } else if (candles.length >= 6) {
    const firstSlice = candles.slice(0, Math.floor(candles.length / 2))
    const secondSlice = candles.slice(Math.floor(candles.length / 2))
    const avg1 = firstSlice.reduce((s, b) => s + b.close, 0) / firstSlice.length
    const avg2 = secondSlice.reduce((s, b) => s + b.close, 0) / secondSlice.length
    const totalHigh = Math.max(...candles.map((b) => b.high))
    const totalLow = Math.min(...candles.map((b) => b.low))
    const span = Math.max(0.0001, totalHigh - totalLow)
    if (avg2 - avg1 > span * 0.25) structuralTrend = 'UPTREND'
    else if (avg1 - avg2 > span * 0.25) structuralTrend = 'DOWNTREND'
    else structuralTrend = 'ROTATIONAL'
  }

  // Determine prior trend before the latest range window (first third of history vs middle third)
  let priorTrendBeforeRange: WyckoffSwingStructure['priorTrendBeforeRange'] = 'UNKNOWN'
  if (candles.length >= 12) {
    const third = Math.max(3, Math.floor(candles.length / 3))
    const earlyAvg = candles.slice(0, third).reduce((s, b) => s + b.close, 0) / third
    const midAvg = candles.slice(third, third * 2).reduce((s, b) => s + b.close, 0) / third
    const span = Math.max(
      0.0001,
      Math.max(...candles.slice(0, third * 2).map((b) => b.high)) -
        Math.min(...candles.slice(0, third * 2).map((b) => b.low))
    )
    if (midAvg - earlyAvg > span * 0.18) priorTrendBeforeRange = 'UPTREND'
    else if (earlyAvg - midAvg > span * 0.18) priorTrendBeforeRange = 'DOWNTREND'
    else priorTrendBeforeRange = 'FLAT'
  }

  const summaryParts: string[] = [
    `${timeframe} Structure: ${structuralTrend}`,
    latestSwingHigh ? `Last Swing High ${latestSwingHigh.price.toFixed(2)} (${latestSwingHigh.label})` : 'Swing High PENDING',
    latestSwingLow ? `Last Swing Low ${latestSwingLow.price.toFixed(2)} (${latestSwingLow.label})` : 'Swing Low PENDING',
  ]
  if (rolloverAdjusted) summaryParts.push('[Rollover Basis Adjusted]')

  return {
    timeframe,
    swings,
    latestSwingHigh,
    latestSwingLow,
    priorSwingHigh,
    priorSwingLow,
    higherHighCount,
    higherLowCount,
    lowerHighCount,
    lowerLowCount,
    equalHighCount,
    equalLowCount,
    structuralTrend,
    priorTrendBeforeRange,
    rolloverAdjusted,
    summary: summaryParts.join(' · '),
  }
}
