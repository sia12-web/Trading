/**
 * Wyckoff Automatic Trading-Range Detector (1D, 30m, 5m)
 *
 * Implements causal, non-repainting range discovery using:
 * - Confirmed swing highs/lows and quantile cluster anchors
 * - ATR-normalized upper and lower boundary zones (never brittle single-tick lines)
 * - Rotational bar overlap ratio & time spent within boundaries
 * - Volume profile (POC, 70% VAH/VAL, HVN/LVN nodes)
 * - Upper/lower boundary tests, sweeps, and failed breakouts/breakdowns
 * - Strict classification (BALANCE / POSSIBLE_ACCUMULATION / POSSIBLE_DISTRIBUTION /
 *   POSSIBLE_REACCUMULATION / POSSIBLE_REDISTRIBUTION / BREAKOUT / BREAKDOWN / UNDETERMINED)
 */

import { adjustCandlesForContractRollover, resolveWyckoffMarketSpec } from './wyckoffSwingStructure'
import { enrichCandlesWithCvd } from './wyckoffCvdDivergence'
import type {
  WyckoffAtrRegime,
  WyckoffBoundaryTest,
  WyckoffBoundaryZone,
  WyckoffCandle,
  WyckoffCvdVolumeIntelligence,
  WyckoffDetectedRange,
  WyckoffProvisionalPhase,
  WyckoffRangeClassification,
  WyckoffSwingStructure,
  WyckoffTimeframe,
} from './types'

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sorted[base + 1]
  return next !== undefined
    ? sorted[base]! + rest * (next - sorted[base]!)
    : sorted[base]!
}

function computeRangeVolumeProfile(
  bars: WyckoffCandle[],
  low: number,
  high: number,
  numBins = 24
): {
  poc: number | null
  vah: number | null
  val: number | null
  hvnPrices: number[]
  lvnPrices: number[]
} {
  const span = high - low
  const totalVol = bars.reduce((s, b) => s + Math.max(0, b.volume || 0), 0)
  if (bars.length === 0 || !(span > 0) || !(totalVol > 0)) {
    return { poc: null, vah: null, val: null, hvnPrices: [], lvnPrices: [] }
  }

  const binSize = span / numBins
  const bins = new Array<number>(numBins).fill(0)

  for (const b of bars) {
    const vol = Math.max(0, b.volume || 0)
    if (vol === 0) continue
    const bLow = Math.max(low, b.low)
    const bHigh = Math.min(high, b.high)
    if (bHigh < bLow) {
      const idx = Math.min(
        numBins - 1,
        Math.max(0, Math.floor(((b.close - low) / span) * numBins))
      )
      bins[idx] = (bins[idx] ?? 0) + vol
      continue
    }
    const startBin = Math.max(0, Math.floor((bLow - low) / binSize))
    const endBin = Math.min(numBins - 1, Math.floor((bHigh - low) / binSize))
    const count = Math.max(1, endBin - startBin + 1)
    const share = vol / count
    for (let k = startBin; k <= endBin; k++) {
      bins[k] = (bins[k] ?? 0) + share
    }
  }

  let pocBin = 0
  let maxBinVol = -1
  for (let i = 0; i < numBins; i++) {
    if (bins[i]! > maxBinVol) {
      maxBinVol = bins[i]!
      pocBin = i
    }
  }

  const binCenter = (idx: number) => Number((low + (idx + 0.5) * binSize).toFixed(4))
  const poc = binCenter(pocBin)

  // Expand 70% Value Area outward from POC
  const targetVaVol = totalVol * 0.7
  let accVol = bins[pocBin]!
  let vaLowBin = pocBin
  let vaHighBin = pocBin

  while (accVol < targetVaVol && (vaLowBin > 0 || vaHighBin < numBins - 1)) {
    const nextLowVol = vaLowBin > 0 ? bins[vaLowBin - 1]! : -1
    const nextHighVol = vaHighBin < numBins - 1 ? bins[vaHighBin + 1]! : -1
    if (nextHighVol >= nextLowVol && vaHighBin < numBins - 1) {
      vaHighBin++
      accVol += bins[vaHighBin]!
    } else if (vaLowBin > 0) {
      vaLowBin--
      accVol += bins[vaLowBin]!
    } else {
      break
    }
  }

  const val = Number((low + vaLowBin * binSize).toFixed(4))
  const vah = Number((low + (vaHighBin + 1) * binSize).toFixed(4))

  const avgBinVol = totalVol / numBins
  const hvnPrices: number[] = []
  const lvnPrices: number[] = []

  for (let i = 1; i < numBins - 1; i++) {
    const v = bins[i]!
    if (v >= avgBinVol * 1.35 && v >= bins[i - 1]! && v >= bins[i + 1]!) {
      hvnPrices.push(binCenter(i))
    } else if (v > 0 && v <= avgBinVol * 0.55 && v <= bins[i - 1]! && v <= bins[i + 1]!) {
      lvnPrices.push(binCenter(i))
    }
  }

  return {
    poc,
    vah,
    val,
    hvnPrices: hvnPrices.slice(0, 3),
    lvnPrices: lvnPrices.slice(0, 3),
  }
}

export interface RangeDetectionOutput {
  range: WyckoffDetectedRange | null
  boundaryTestBarIndices: number[]
  sweepBarIndices: number[]
  reclaimBarIndices: number[]
}

export function detectWyckoffTradingRange(
  rawCandles: WyckoffCandle[],
  instrumentRaw: string,
  timeframe: WyckoffTimeframe,
  swingStructure: WyckoffSwingStructure,
  atrRegime: WyckoffAtrRegime,
  _cvdVolume?: WyckoffCvdVolumeIntelligence
): RangeDetectionOutput {
  const spec = resolveWyckoffMarketSpec(instrumentRaw)
  const { candles } = adjustCandlesForContractRollover(rawCandles)
  const minBars = timeframe === '1D' ? 6 : timeframe === '30m' ? 8 : 8

  if (candles.length < minBars) {
    return {
      range: null,
      boundaryTestBarIndices: [],
      sweepBarIndices: [],
      reclaimBarIndices: [],
    }
  }

  const { bars } = enrichCandlesWithCvd(candles)
  const lookbackCount = Math.min(
    timeframe === '1D' ? 30 : timeframe === '30m' ? 40 : 48,
    bars.length
  )
  const windowStartIdx = bars.length - lookbackCount
  const rangeBars = bars.slice(windowStartIdx)

  const effectiveAtr =
    atrRegime.currentAtr && atrRegime.currentAtr > 0
      ? atrRegime.currentAtr
      : rangeBars.reduce((s, b) => s + Math.max(spec.tickSize, b.high - b.low), 0) /
        rangeBars.length

  // Determine core range boundaries causally using core body/wick distribution
  // Exclude the last 3 bars when anchoring core range high/low so an active sweep/breakout
  // on the tail is evaluated *against* the established range rather than stretching the range box!
  const anchorBars =
    rangeBars.length > 6 ? rangeBars.slice(0, rangeBars.length - 3) : rangeBars

  const sortedHighs = anchorBars.map((b) => b.high).sort((a, b) => a - b)
  const sortedLows = anchorBars.map((b) => b.low).sort((a, b) => a - b)
  const sortedCloses = anchorBars.map((b) => b.close).sort((a, b) => a - b)

  // Use 95th / 5th percentile of anchor highs/lows so normal range boundaries are respected
  // while genuine tail excursions beyond the established range are captured cleanly.
  const qHigh = Math.max(quantile(sortedHighs, 0.95), quantile(sortedCloses, 0.96))
  const qLow = Math.min(quantile(sortedLows, 0.05), quantile(sortedCloses, 0.04))

  const rangeHigh = Number(qHigh.toFixed(4))
  const rangeLow = Number(qLow.toFixed(4))
  const rangeMidpoint = Number(((rangeHigh + rangeLow) / 2).toFixed(4))
  const widthPts = Number(Math.max(spec.tickSize, rangeHigh - rangeLow).toFixed(4))
  const widthAtr = Number((widthPts / Math.max(0.0001, effectiveAtr)).toFixed(2))

  // ATR-normalized boundary zone thickness (typically 0.20 ATR half-width)
  const minTick = Math.min(spec.tickSize, effectiveAtr * 0.05)
  const zoneHalfWidth = Math.max(minTick * 2, effectiveAtr * 0.2)
  const toleranceAtr = Number((zoneHalfWidth / Math.max(0.0001, effectiveAtr)).toFixed(2))

  const upperZone: WyckoffBoundaryZone = {
    low: Number((rangeHigh - zoneHalfWidth).toFixed(4)),
    mid: rangeHigh,
    high: Number((rangeHigh + zoneHalfWidth).toFixed(4)),
    toleranceAtr,
  }

  const lowerZone: WyckoffBoundaryZone = {
    low: Number((rangeLow - zoneHalfWidth).toFixed(4)),
    mid: rangeLow,
    high: Number((rangeLow + zoneHalfWidth).toFixed(4)),
    toleranceAtr,
  }

  // Compute rotational overlap ratio across rangeBars
  let overlappingCount = 0
  for (let i = 1; i < rangeBars.length; i++) {
    const prev = rangeBars[i - 1]!
    const curr = rangeBars[i]!
    const overlap = Math.max(
      0,
      Math.min(prev.high, curr.high) - Math.max(prev.low, curr.low)
    )
    const minSpan = Math.max(
      0.0001,
      Math.min(prev.high - prev.low, curr.high - curr.low)
    )
    if (overlap / minSpan >= 0.25 || (curr.close <= upperZone.high && curr.close >= lowerZone.low)) {
      overlappingCount++
    }
  }
  const overlapRatio = Number(
    (overlappingCount / Math.max(1, rangeBars.length - 1)).toFixed(2)
  )

  const avgVol =
    rangeBars.reduce((s, b) => s + Math.max(1, b.volume), 0) / rangeBars.length

  const upperTests: WyckoffBoundaryTest[] = []
  const lowerTests: WyckoffBoundaryTest[] = []
  const failedBreakouts: WyckoffBoundaryTest[] = []
  const failedBreakdowns: WyckoffBoundaryTest[] = []
  const boundaryTestBarIndices: number[] = []
  const sweepBarIndices: number[] = []
  const reclaimBarIndices: number[] = []

  const sweepBuffer = Math.max(minTick, effectiveAtr * 0.08)

  for (let i = 0; i < rangeBars.length; i++) {
    const b = rangeBars[i]!
    const globalIdx = windowStartIdx + i
    const rvol = Number((b.volume / Math.max(1, avgVol)).toFixed(2))

    // Check Upper Boundary Test / Sweep
    if (b.high >= upperZone.low) {
      const sweptBeyondZone = b.high > upperZone.mid + sweepBuffer
      // Check if bar itself or next 2 causal bars returned inside <= upperZone.mid
      let reclaimedInside = b.close <= upperZone.mid
      if (!reclaimedInside) {
        for (let k = i + 1; k <= Math.min(rangeBars.length - 1, i + 2); k++) {
          if (rangeBars[k]!.close <= upperZone.mid) {
            reclaimedInside = true
            reclaimBarIndices.push(windowStartIdx + k)
            break
          }
        }
      } else if (sweptBeyondZone) {
        reclaimBarIndices.push(globalIdx)
      }

      const prevUpper = upperTests[upperTests.length - 1]
      const diminishingProgress = prevUpper
        ? b.high - prevUpper.extremePrice < effectiveAtr * 0.25
        : false

      const testObj: WyckoffBoundaryTest = {
        time: b.time,
        side: 'UPPER',
        extremePrice: b.high,
        closePrice: b.close,
        volume: b.volume,
        relativeVolume: rvol,
        cvdAtTest: b.computedCvd,
        sweptBeyondZone,
        reclaimedInside,
        diminishingProgress,
      }
      upperTests.push(testObj)
      boundaryTestBarIndices.push(globalIdx)
      if (sweptBeyondZone) {
        sweepBarIndices.push(globalIdx)
        if (reclaimedInside) failedBreakouts.push(testObj)
      }
    }

    // Check Lower Boundary Test / Sweep
    if (b.low <= lowerZone.high) {
      const sweptBeyondZone = b.low < lowerZone.mid - sweepBuffer
      let reclaimedInside = b.close >= lowerZone.mid
      if (!reclaimedInside) {
        for (let k = i + 1; k <= Math.min(rangeBars.length - 1, i + 2); k++) {
          if (rangeBars[k]!.close >= lowerZone.mid) {
            reclaimedInside = true
            reclaimBarIndices.push(windowStartIdx + k)
            break
          }
        }
      } else if (sweptBeyondZone) {
        reclaimBarIndices.push(globalIdx)
      }

      const prevLower = lowerTests[lowerTests.length - 1]
      const diminishingProgress = prevLower
        ? prevLower.extremePrice - b.low < effectiveAtr * 0.25
        : false

      const testObj: WyckoffBoundaryTest = {
        time: b.time,
        side: 'LOWER',
        extremePrice: b.low,
        closePrice: b.close,
        volume: b.volume,
        relativeVolume: rvol,
        cvdAtTest: b.computedCvd,
        sweptBeyondZone,
        reclaimedInside,
        diminishingProgress,
      }
      lowerTests.push(testObj)
      boundaryTestBarIndices.push(globalIdx)
      if (sweptBeyondZone) {
        sweepBarIndices.push(globalIdx)
        if (reclaimedInside) failedBreakdowns.push(testObj)
      }
    }
  }

  const profile = computeRangeVolumeProfile(rangeBars, rangeLow, rangeHigh)
  const latestBar = rangeBars[rangeBars.length - 1]!
  const prevBar = rangeBars[rangeBars.length - 2] ?? latestBar

  let pricePosition: WyckoffDetectedRange['pricePosition'] = 'MIDPOINT'
  if (latestBar.close > upperZone.high) {
    pricePosition = 'ABOVE_RANGE'
  } else if (latestBar.close >= upperZone.low || latestBar.high >= upperZone.mid) {
    pricePosition = 'UPPER_BOUNDARY_ZONE'
  } else if (latestBar.close < lowerZone.low) {
    pricePosition = 'BELOW_RANGE'
  } else if (latestBar.close <= lowerZone.high || latestBar.low <= lowerZone.mid) {
    pricePosition = 'LOWER_BOUNDARY_ZONE'
  } else if (Math.abs(latestBar.close - rangeMidpoint) <= widthPts * 0.12) {
    pricePosition = 'MIDPOINT'
  } else if (latestBar.close > rangeMidpoint) {
    pricePosition = 'UPPER_HALF'
  } else {
    pricePosition = 'LOWER_HALF'
  }

  // Determine range duration
  const startTime = rangeBars[0]!.time
  const firstIdentifiedIndex = Math.min(rangeBars.length - 1, minBars - 1)
  const firstIdentifiedAt = rangeBars[firstIdentifiedIndex]!.time
  const lastUpdatedAt = latestBar.time
  const durationMinutes = Math.max(
    5,
    Math.round((lastUpdatedAt - startTime) / 60)
  )

  // Evaluate classification & provisional phase
  const sustainedAbove =
    latestBar.close > upperZone.high && prevBar.close >= upperZone.mid
  const sustainedBelow =
    latestBar.close < lowerZone.low && prevBar.close <= lowerZone.mid

  const hasValidCvd = rangeBars[0]?.cvdSource !== 'UNAVAILABLE'
  const netRangeCvd =
    rangeBars[rangeBars.length - 1]!.computedCvd - rangeBars[0]!.computedCvd

  let classification: WyckoffRangeClassification = 'BALANCE'
  let provisionalPhase: WyckoffProvisionalPhase = 'PHASE_B'
  let phaseExplanation = ''

  if (sustainedAbove) {
    classification = 'BREAKOUT'
    provisionalPhase = 'PHASE_D'
    phaseExplanation = `Price has accepted above the upper boundary zone (${upperZone.high.toFixed(
      2
    )}), transitioning from balance into Phase D/E bullish markup.`
  } else if (sustainedBelow) {
    classification = 'BREAKDOWN'
    provisionalPhase = 'PHASE_D'
    phaseExplanation = `Price has accepted below the lower boundary zone (${lowerZone.low.toFixed(
      2
    )}), transitioning from balance into Phase D/E bearish markdown.`
  } else if (
    atrRegime.atrTrend === 'CONTRACTING' &&
    failedBreakdowns.length === 0 &&
    failedBreakouts.length === 0 &&
    (!hasValidCvd || Math.abs(netRangeCvd) < avgVol * 1.5)
  ) {
    // Test E: ATR decreases inside a range without reliable CVD or directional confirmation -> BALANCE / UNDETERMINED
    classification = hasValidCvd ? 'BALANCE' : 'UNDETERMINED'
    provisionalPhase = 'PHASE_B'
    phaseExplanation =
      'ATR is contracting inside rotational boundaries without a confirmed spring/upthrust or decisive order-flow divergence. Classified as rotational BALANCE (falling ATR is not proof of accumulation or distribution).'
  } else if (
    failedBreakdowns.length > 0 &&
    latestBar.close >= lowerZone.mid
  ) {
    classification =
      swingStructure.priorTrendBeforeRange === 'UPTREND'
        ? 'POSSIBLE_REACCUMULATION'
        : 'POSSIBLE_ACCUMULATION'
    provisionalPhase = 'PHASE_C'
    phaseExplanation = `Lower boundary zone (${lowerZone.mid.toFixed(
      2
    )}) was swept and reclaimed (${failedBreakdowns.length} failed breakdown(s)), consistent with a provisional Phase C spring test.`
  } else if (
    failedBreakouts.length > 0 &&
    latestBar.close <= upperZone.mid
  ) {
    classification =
      swingStructure.priorTrendBeforeRange === 'DOWNTREND'
        ? 'POSSIBLE_REDISTRIBUTION'
        : 'POSSIBLE_DISTRIBUTION'
    provisionalPhase = 'PHASE_C'
    phaseExplanation = `Upper boundary zone (${upperZone.mid.toFixed(
      2
    )}) was swept and rejected back inside (${failedBreakouts.length} failed breakout(s)), consistent with a provisional Phase C upthrust test.`
  } else if (swingStructure.higherLowCount > swingStructure.lowerLowCount + 1 && netRangeCvd > 0) {
    classification =
      swingStructure.priorTrendBeforeRange === 'UPTREND'
        ? 'POSSIBLE_REACCUMULATION'
        : 'POSSIBLE_ACCUMULATION'
    provisionalPhase = 'PHASE_B'
    phaseExplanation =
      'Rotational Phase B cause-building with higher lows and constructive net order flow, but awaiting Phase C test or Phase D breakout confirmation.'
  } else if (swingStructure.lowerHighCount > swingStructure.higherHighCount + 1 && netRangeCvd < 0) {
    classification =
      swingStructure.priorTrendBeforeRange === 'DOWNTREND'
        ? 'POSSIBLE_REDISTRIBUTION'
        : 'POSSIBLE_DISTRIBUTION'
    provisionalPhase = 'PHASE_B'
    phaseExplanation =
      'Rotational Phase B cause-building with lower highs and negative net order flow, but awaiting Phase C upthrust or Phase D breakdown confirmation.'
  } else {
    classification = 'BALANCE'
    provisionalPhase =
      upperTests.length + lowerTests.length <= 2 ? 'PHASE_A' : 'PHASE_B'
    phaseExplanation =
      'Two-sided rotational equilibrium between upper and lower boundary zones. Neither buyers nor sellers have established structural dominance.'
  }

  const range: WyckoffDetectedRange = {
    rangeId: `${spec.canonicalId}_${timeframe}_${startTime}`,
    instrument: spec.instrument,
    timeframe,
    rangeHigh,
    rangeLow,
    rangeMidpoint,
    upperZone,
    lowerZone,
    poc: profile.poc,
    vah: profile.vah,
    val: profile.val,
    hvnPrices: profile.hvnPrices,
    lvnPrices: profile.lvnPrices,
    widthPts,
    widthAtr,
    durationBars: rangeBars.length,
    durationMinutes,
    startTime,
    firstIdentifiedAt,
    lastUpdatedAt,
    overlapRatio,
    upperTests,
    lowerTests,
    failedBreakouts,
    failedBreakdowns,
    pricePosition,
    classification,
    provisionalPhase,
    phaseExplanation,
  }

  return {
    range,
    boundaryTestBarIndices,
    sweepBarIndices,
    reclaimBarIndices,
  }
}
