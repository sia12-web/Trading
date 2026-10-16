/**
 * Wyckoff Event Lifecycle State Machine
 *
 * Tracks causal transitions across:
 *   RANGE_DETECTED -> BOUNDARY_APPROACH -> BOUNDARY_TEST -> SWEEP ->
 *   RECLAIM / RETURN_INSIDE -> RETEST -> CONFIRMED / FAILED / EXPIRED
 *
 * Enforces that single candlesticks (hammers, engulfings) or M/W shapes never
 * independently establish a Wyckoff event without observable structural auction confirmation.
 */

import { adjustCandlesForContractRollover, resolveWyckoffMarketSpec } from './wyckoffSwingStructure'
import type {
  WyckoffAtrRegime,
  WyckoffCandidateEventType,
  WyckoffCandle,
  WyckoffCvdVolumeIntelligence,
  WyckoffDetectedRange,
  WyckoffEventState,
  WyckoffLifecycleStage,
  WyckoffLifecycleTransition,
  WyckoffTimeframe,
} from './types'

export function evaluateWyckoffEventStateMachine(
  rawCandles: WyckoffCandle[],
  instrumentRaw: string,
  timeframe: WyckoffTimeframe,
  range: WyckoffDetectedRange | null,
  atrRegime: WyckoffAtrRegime,
  cvdVolume: WyckoffCvdVolumeIntelligence
): WyckoffEventState {
  const spec = resolveWyckoffMarketSpec(instrumentRaw)
  const { candles } = adjustCandlesForContractRollover(rawCandles)

  if (!range || candles.length < 5) {
    return {
      timeframe,
      lifecycleStage: 'NONE',
      candidateEvent: 'NONE',
      confirmationStatus: 'NONE',
      directionBias: 'NEUTRAL',
      sweepExtremePrice: null,
      sweepTime: null,
      reclaimPrice: null,
      reclaimTime: null,
      retestPrice: null,
      retestTime: null,
      structuralInvalidationPrice: null,
      invalidationReason: null,
      transitions: [],
      eventSummary: 'No active trading range identified on this timeframe.',
    }
  }

  const effectiveAtr =
    atrRegime.currentAtr && atrRegime.currentAtr > 0
      ? atrRegime.currentAtr
      : Math.max(spec.tickSize * 4, range.widthPts * 0.2)

  const transitions: WyckoffLifecycleTransition[] = []
  let currentStage: WyckoffLifecycleStage = 'RANGE_DETECTED'
  let currentEvent: WyckoffCandidateEventType = 'NONE'
  let confirmationStatus: WyckoffEventState['confirmationStatus'] = 'NONE'
  let directionBias: WyckoffEventState['directionBias'] = 'NEUTRAL'

  let sweepTime: number | null = null
  let reclaimPrice: number | null = null
  let reclaimTime: number | null = null
  let retestPrice: number | null = null
  let retestTime: number | null = null
  let structuralInvalidationPrice: number | null = null
  let invalidationReason: string | null = null

  const pushTransition = (
    toStage: WyckoffLifecycleStage,
    event: WyckoffCandidateEventType,
    timestamp: number,
    price: number,
    evidence: string
  ) => {
    if (currentStage === toStage && currentEvent === event) return
    transitions.push({
      fromStage: currentStage,
      toStage,
      event,
      timestamp,
      price,
      evidence,
    })
    currentStage = toStage
    currentEvent = event
  }

  pushTransition(
    'RANGE_DETECTED',
    'NONE',
    range.firstIdentifiedAt,
    range.rangeMidpoint,
    `Trading range [${range.rangeLow.toFixed(2)} – ${range.rangeHigh.toFixed(2)}] identified.`
  )

  const evalBars = candles.slice(-Math.min(18, candles.length))
  const latestBar = evalBars[evalBars.length - 1]!

  // Track recent excursions and retests across the evaluation window
  let lowerSweepIdx = -1
  let lowerSweepLow = Infinity
  let upperSweepIdx = -1
  let upperSweepHigh = -Infinity
  let breakoutIdx = -1
  let breakdownIdx = -1

  for (let i = 0; i < evalBars.length; i++) {
    const b = evalBars[i]!

    // 1. Boundary approach
    const distToLow = b.low - range.lowerZone.high
    const distToHigh = range.upperZone.low - b.high
    if (
      currentStage === 'RANGE_DETECTED' &&
      distToLow > 0 &&
      distToLow <= effectiveAtr * 0.6
    ) {
      pushTransition(
        'BOUNDARY_APPROACH',
        'SECONDARY_TEST',
        b.time,
        b.low,
        `Approaching lower boundary zone (${range.lowerZone.low.toFixed(2)}–${range.lowerZone.high.toFixed(2)}).`
      )
    } else if (
      currentStage === 'RANGE_DETECTED' &&
      distToHigh > 0 &&
      distToHigh <= effectiveAtr * 0.6
    ) {
      pushTransition(
        'BOUNDARY_APPROACH',
        'SECONDARY_TEST',
        b.time,
        b.high,
        `Approaching upper boundary zone (${range.upperZone.low.toFixed(2)}–${range.upperZone.high.toFixed(2)}).`
      )
    }

    // 2. Boundary test inside zone
    if (b.low <= range.lowerZone.high && b.low >= range.lowerZone.low) {
      if (currentStage === 'RANGE_DETECTED' || currentStage === 'BOUNDARY_APPROACH') {
        pushTransition(
          'BOUNDARY_TEST',
          'SECONDARY_TEST',
          b.time,
          b.low,
          `Testing lower boundary zone at ${b.low.toFixed(2)}.`
        )
      }
    }
    if (b.high >= range.upperZone.low && b.high <= range.upperZone.high) {
      if (currentStage === 'RANGE_DETECTED' || currentStage === 'BOUNDARY_APPROACH') {
        pushTransition(
          'BOUNDARY_TEST',
          'SECONDARY_TEST',
          b.time,
          b.high,
          `Testing upper boundary zone at ${b.high.toFixed(2)}.`
        )
      }
    }

    // 3. Downside sweep below rangeLow
    const minTick = Math.min(spec.tickSize, effectiveAtr * 0.05)
    const sweepBuffer = Math.max(minTick, effectiveAtr * 0.08)

    if (b.low < range.lowerZone.mid - sweepBuffer) {
      if (b.low < lowerSweepLow) {
        lowerSweepLow = b.low
        lowerSweepIdx = i
        sweepTime = b.time
      }
      pushTransition(
        'SWEEP',
        'SPRING',
        b.time,
        b.low,
        `Price swept below support (${range.rangeLow.toFixed(2)}) to ${b.low.toFixed(2)}.`
      )
      if (b.close < range.lowerZone.low && breakdownIdx < 0) {
        breakdownIdx = i
      }
    }

    // 4. Upside sweep above rangeHigh
    if (b.high > range.upperZone.mid + sweepBuffer) {
      if (b.high > upperSweepHigh) {
        upperSweepHigh = b.high
        upperSweepIdx = i
        sweepTime = b.time
      }
      pushTransition(
        'SWEEP',
        'UPTHRUST',
        b.time,
        b.high,
        `Price swept above resistance (${range.rangeHigh.toFixed(2)}) to ${b.high.toFixed(2)}.`
      )
      if (b.close > range.upperZone.high && breakoutIdx < 0) {
        breakoutIdx = i
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CASE 1: Check for Sustained Bearish Breakdown / Failed Spring (Test B)
  // ---------------------------------------------------------------------------
  if (
    lowerSweepIdx >= 0 &&
    latestBar.close < range.lowerZone.low &&
    (cvdVolume.condition === 'SUCCESSFUL_BEARISH_INITIATIVE' ||
      latestBar.low <= lowerSweepLow + spec.tickSize * 2)
  ) {
    pushTransition(
      'FAILED',
      'BREAKDOWN_FAILED_RECLAIM',
      latestBar.time,
      latestBar.close,
      `Selling pressure achieved fresh downside lows (${lowerSweepLow.toFixed(
        2
      )}) with no reclaim of ${range.rangeLow.toFixed(2)}. Spring hypothesis invalidated; bearish breakdown active.`
    )
    confirmationStatus = 'INVALIDATED'
    directionBias = 'BEARISH'
    structuralInvalidationPrice = Number((range.lowerZone.high + effectiveAtr * 0.15).toFixed(4))
    invalidationReason =
      'Sustained bearish initiative and lower lows below support invalidate any bullish spring/accumulation hypothesis.'

    return {
      timeframe,
      lifecycleStage: 'FAILED',
      candidateEvent: 'SIGN_OF_WEAKNESS',
      confirmationStatus,
      directionBias,
      sweepExtremePrice: lowerSweepLow,
      sweepTime,
      reclaimPrice: null,
      reclaimTime: null,
      retestPrice: null,
      retestTime: null,
      structuralInvalidationPrice,
      invalidationReason,
      transitions,
      eventSummary: `BEARISH BREAKDOWN / SOW (${timeframe}): Selling pressure is achieving sustained lower lows (${lowerSweepLow.toFixed(
        2
      )}) below range support (${range.rangeLow.toFixed(2)}). Spring hypothesis invalidated.`,
    }
  }

  // ---------------------------------------------------------------------------
  // CASE 2: Check for Bullish Breakout -> Successful Retest / SOS -> LPS (Test D)
  // ---------------------------------------------------------------------------
  if (
    breakoutIdx >= 0 &&
    latestBar.close > range.upperZone.mid &&
    upperSweepHigh > range.upperZone.high
  ) {
    // Check if after breaking out above upperZone.high, price pulled back to test upperZone
    // and held above range.upperZone.low (successful retest / LPS)
    const postBreakoutBars = evalBars.slice(breakoutIdx + 1)
    const retestBar = postBreakoutBars.find(
      (b) =>
        b.low <= range.upperZone.high + effectiveAtr * 0.25 &&
        b.low >= range.upperZone.low - effectiveAtr * 0.1 &&
        b.close >= range.upperZone.mid
    )

    if (retestBar && latestBar.close >= range.upperZone.high) {
      retestPrice = retestBar.low
      retestTime = retestBar.time
      pushTransition(
        'RETEST',
        'BREAKOUT_RETEST',
        retestBar.time,
        retestBar.low,
        `Breakout above ${range.rangeHigh.toFixed(2)} retested former resistance as support at ${retestBar.low.toFixed(2)}.`
      )
      pushTransition(
        'CONFIRMED',
        'BREAKOUT_RETEST',
        latestBar.time,
        latestBar.close,
        `Bullish breakout and retest (SOS -> LPS) confirmed at ${latestBar.close.toFixed(2)}.`
      )
      confirmationStatus = 'CONFIRMED'
      directionBias = 'BULLISH'
      structuralInvalidationPrice = Number(
        (Math.min(retestBar.low, range.upperZone.low) - effectiveAtr * 0.2).toFixed(4)
      )
      invalidationReason = `Acceptance back below the retested resistance shelf (${structuralInvalidationPrice.toFixed(
        2
      )}) invalidates the bullish breakout continuation.`

      return {
        timeframe,
        lifecycleStage: 'CONFIRMED',
        candidateEvent: 'BREAKOUT_RETEST',
        confirmationStatus,
        directionBias,
        sweepExtremePrice: upperSweepHigh,
        sweepTime,
        reclaimPrice: range.rangeHigh,
        reclaimTime: evalBars[breakoutIdx]!.time,
        retestPrice,
        retestTime,
        structuralInvalidationPrice,
        invalidationReason,
        transitions,
        eventSummary: `CONFIRMED BREAKOUT & RETEST / SOS → LPS (${timeframe}): Price broke above ${range.rangeHigh.toFixed(
          2
        )}, held above former resistance on retest (${retestBar.low.toFixed(
          2
        )}), and resumed higher (${latestBar.close.toFixed(2)}).`,
      }
    }

    // If breakout is holding above upperZone.high without failing back inside
    if (latestBar.close > range.upperZone.high) {
      pushTransition(
        'RETEST',
        'SIGN_OF_STRENGTH',
        latestBar.time,
        latestBar.close,
        `Sign of Strength (SOS) breakout holding above ${range.upperZone.high.toFixed(2)}; awaiting or completing LPS retest.`
      )
      confirmationStatus = 'POTENTIAL'
      directionBias = 'BULLISH'
      structuralInvalidationPrice = Number((range.upperZone.low - effectiveAtr * 0.15).toFixed(4))
      invalidationReason = `Return and acceptance back inside the range below ${structuralInvalidationPrice.toFixed(
        2
      )} would convert the breakout into a failed breakout (Upthrust).`

      return {
        timeframe,
        lifecycleStage: 'RETEST',
        candidateEvent: 'SIGN_OF_STRENGTH',
        confirmationStatus,
        directionBias,
        sweepExtremePrice: upperSweepHigh,
        sweepTime,
        reclaimPrice: null,
        reclaimTime: null,
        retestPrice: null,
        retestTime: null,
        structuralInvalidationPrice,
        invalidationReason,
        transitions,
        eventSummary: `BULLISH BREAKOUT / SOS (${timeframe}): Price broke and held above resistance (${range.rangeHigh.toFixed(
          2
        )}). Monitor for successful LPS retest above ${range.upperZone.low.toFixed(2)}.`,
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CASE 3: Check for Spring Sweep & Reclaim at Support (Test A)
  // ---------------------------------------------------------------------------
  if (lowerSweepIdx >= 0 && lowerSweepIdx >= upperSweepIdx) {
    const postSweepBars = evalBars.slice(lowerSweepIdx)
    const reclaimBar = postSweepBars.find((b) => b.close >= range.lowerZone.mid)

    if (reclaimBar && latestBar.close >= range.lowerZone.mid) {
      reclaimPrice = reclaimBar.close
      reclaimTime = reclaimBar.time
      pushTransition(
        'RECLAIM',
        'SPRING',
        reclaimBar.time,
        reclaimBar.close,
        `Price reclaimed support zone (${range.rangeLow.toFixed(2)}) at ${reclaimBar.close.toFixed(
          2
        )} after sweeping to ${lowerSweepLow.toFixed(2)}.`
      )

      // Check if a secondary higher-low retest occurred or if price firmly cleared lowerZone.high
      const afterReclaimBars = evalBars.slice(evalBars.indexOf(reclaimBar) + 1)
      const retestHoldBar = afterReclaimBars.find(
        (b) => b.low > lowerSweepLow && b.close >= range.lowerZone.high
      )
      const firmlyReclaimed =
        retestHoldBar != null ||
        latestBar.close >= range.lowerZone.high ||
        (cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE' &&
          latestBar.close > range.rangeLow)

      if (retestHoldBar) {
        retestPrice = retestHoldBar.low
        retestTime = retestHoldBar.time
        pushTransition(
          'RETEST',
          'SPRING',
          retestHoldBar.time,
          retestHoldBar.low,
          `Higher-low spring test held at ${retestHoldBar.low.toFixed(2)} above spring low ${lowerSweepLow.toFixed(2)}.`
        )
      }

      if (firmlyReclaimed) {
        pushTransition(
          'CONFIRMED',
          'SPRING',
          latestBar.time,
          latestBar.close,
          `Confirmed Wyckoff Spring: failed downside auction below ${range.rangeLow.toFixed(
            2
          )} followed by structural reclaim to ${latestBar.close.toFixed(2)}.`
        )
        confirmationStatus = 'CONFIRMED'
      } else {
        confirmationStatus = 'POTENTIAL'
      }

      directionBias = 'BULLISH'
      structuralInvalidationPrice = Number(
        (lowerSweepLow - Math.max(spec.tickSize * 2, effectiveAtr * 0.15)).toFixed(4)
      )
      invalidationReason = `A break below the spring low (${structuralInvalidationPrice.toFixed(
        2
      )}) invalidates the spring hypothesis.`

      return {
        timeframe,
        lifecycleStage: firmlyReclaimed ? 'CONFIRMED' : 'RECLAIM',
        candidateEvent: 'SPRING',
        confirmationStatus,
        directionBias,
        sweepExtremePrice: lowerSweepLow,
        sweepTime,
        reclaimPrice,
        reclaimTime,
        retestPrice,
        retestTime,
        structuralInvalidationPrice,
        invalidationReason,
        transitions,
        eventSummary: `${
          firmlyReclaimed ? 'CONFIRMED SPRING' : 'POTENTIAL SPRING RECLAIM'
        } (${timeframe}): Swept support ${range.rangeLow.toFixed(2)} to ${lowerSweepLow.toFixed(
          2
        )} and reclaimed inside range at ${latestBar.close.toFixed(
          2
        )}. Invalidation strictly below ${structuralInvalidationPrice.toFixed(2)}.`,
      }
    }

    // Swept below support, diminishing downside / absorption candidate, but NOT yet reclaimed!
    confirmationStatus = 'UNCONFIRMED'
    directionBias = 'NEUTRAL'
    structuralInvalidationPrice = Number(
      (lowerSweepLow - effectiveAtr * 0.25).toFixed(4)
    )
    invalidationReason = `Must reclaim ${range.rangeLow.toFixed(
      2
    )} to confirm a spring; continued acceptance below ${lowerSweepLow.toFixed(
      2
    )} confirms a bearish breakdown.`

    return {
      timeframe,
      lifecycleStage: 'SWEEP',
      candidateEvent: 'SPRING',
      confirmationStatus,
      directionBias,
      sweepExtremePrice: lowerSweepLow,
      sweepTime,
      reclaimPrice: null,
      reclaimTime: null,
      retestPrice: null,
      retestTime: null,
      structuralInvalidationPrice,
      invalidationReason,
      transitions,
      eventSummary: `UNCONFIRMED DOWNSIDE SWEEP (${timeframe}): Price is below support (${range.rangeLow.toFixed(
        2
      )}) at ${latestBar.close.toFixed(
        2
      )}. Do NOT call a Spring before price reclaims ${range.rangeLow.toFixed(2)}.`,
    }
  }

  // ---------------------------------------------------------------------------
  // CASE 4: Check for Upthrust / UTAD Sweep & Return Below Resistance (Test C)
  // ---------------------------------------------------------------------------
  if (upperSweepIdx >= 0) {
    const postSweepBars = evalBars.slice(upperSweepIdx)
    const returnBar = postSweepBars.find((b) => b.close <= range.upperZone.mid)

    if (returnBar && latestBar.close <= range.upperZone.mid) {
      reclaimPrice = returnBar.close
      reclaimTime = returnBar.time
      pushTransition(
        'RETURN_INSIDE',
        'UPTHRUST',
        returnBar.time,
        returnBar.close,
        `Price rejected above resistance (${range.rangeHigh.toFixed(
          2
        )}, sweep high ${upperSweepHigh.toFixed(2)}) and closed back inside range at ${returnBar.close.toFixed(2)}.`
      )

      const firmlyRejected =
        latestBar.close <= range.upperZone.low ||
        (cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE' &&
          latestBar.close < range.rangeHigh)

      if (firmlyRejected) {
        pushTransition(
          'CONFIRMED',
          'UPTHRUST',
          latestBar.time,
          latestBar.close,
          `Confirmed Upthrust rejection below ${range.rangeHigh.toFixed(
            2
          )} with failed upside progress.`
        )
        confirmationStatus = 'CONFIRMED'
      } else {
        confirmationStatus = 'POTENTIAL'
      }

      directionBias = 'BEARISH'
      structuralInvalidationPrice = Number(
        (upperSweepHigh + Math.max(spec.tickSize * 2, effectiveAtr * 0.15)).toFixed(4)
      )
      invalidationReason = `Acceptance above the upthrust high (${structuralInvalidationPrice.toFixed(
        2
      )}) invalidates the upthrust hypothesis.`

      return {
        timeframe,
        lifecycleStage: firmlyRejected ? 'CONFIRMED' : 'RETURN_INSIDE',
        candidateEvent: 'UPTHRUST',
        confirmationStatus,
        directionBias,
        sweepExtremePrice: upperSweepHigh,
        sweepTime,
        reclaimPrice,
        reclaimTime,
        retestPrice,
        retestTime: null,
        structuralInvalidationPrice,
        invalidationReason,
        transitions,
        eventSummary: `${
          firmlyRejected ? 'CONFIRMED UPTHRUST' : 'POTENTIAL UPTHRUST'
        } (${timeframe}): Swept resistance ${range.rangeHigh.toFixed(
          2
        )} to ${upperSweepHigh.toFixed(
          2
        )}, failed to advance, and returned below resistance at ${latestBar.close.toFixed(
          2
        )}. Invalidation strictly above ${structuralInvalidationPrice.toFixed(2)}.`,
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CASE 5: Boundary Test / Rotational Balance Inside Range (Test A pre-reclaim / Test E)
  // ---------------------------------------------------------------------------
  if (
    range.pricePosition === 'LOWER_BOUNDARY_ZONE' ||
    cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE'
  ) {
    pushTransition(
      'BOUNDARY_TEST',
      'SECONDARY_TEST',
      latestBar.time,
      latestBar.low,
      `Testing lower boundary (${range.rangeLow.toFixed(
        2
      )}); monitoring seller effort vs downside result.`
    )
    confirmationStatus = 'UNCONFIRMED'
    directionBias = 'NEUTRAL'
    structuralInvalidationPrice = Number(
      (range.lowerZone.low - effectiveAtr * 0.25).toFixed(4)
    )
    invalidationReason = `Sustained breakdown below ${structuralInvalidationPrice.toFixed(
      2
    )} invalidates support.`

    return {
      timeframe,
      lifecycleStage: 'BOUNDARY_TEST',
      candidateEvent: 'SECONDARY_TEST',
      confirmationStatus,
      directionBias,
      sweepExtremePrice: null,
      sweepTime: null,
      reclaimPrice: null,
      reclaimTime: null,
      retestPrice: null,
      retestTime: null,
      structuralInvalidationPrice,
      invalidationReason,
      transitions,
      eventSummary: `LOWER BOUNDARY TEST (${timeframe}): Price testing ${range.rangeLow.toFixed(
        2
      )} (${
        cvdVolume.condition === 'BULLISH_ABSORPTION_CANDIDATE'
          ? 'Possible bullish absorption, unconfirmed'
          : 'Awaiting structural reaction'
      }).`,
    }
  }

  if (
    range.pricePosition === 'UPPER_BOUNDARY_ZONE' ||
    cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE'
  ) {
    pushTransition(
      'BOUNDARY_TEST',
      'SECONDARY_TEST',
      latestBar.time,
      latestBar.high,
      `Testing upper boundary (${range.rangeHigh.toFixed(
        2
      )}); monitoring buyer effort vs upside result.`
    )
    confirmationStatus = 'UNCONFIRMED'
    directionBias = 'NEUTRAL'
    structuralInvalidationPrice = Number(
      (range.upperZone.high + effectiveAtr * 0.25).toFixed(4)
    )
    invalidationReason = `Sustained acceptance above ${structuralInvalidationPrice.toFixed(
      2
    )} invalidates resistance.`

    return {
      timeframe,
      lifecycleStage: 'BOUNDARY_TEST',
      candidateEvent: 'SECONDARY_TEST',
      confirmationStatus,
      directionBias,
      sweepExtremePrice: null,
      sweepTime: null,
      reclaimPrice: null,
      reclaimTime: null,
      retestPrice: null,
      retestTime: null,
      structuralInvalidationPrice,
      invalidationReason,
      transitions,
      eventSummary: `UPPER BOUNDARY TEST (${timeframe}): Price testing ${range.rangeHigh.toFixed(
        2
      )} (${
        cvdVolume.condition === 'BEARISH_ABSORPTION_CANDIDATE'
          ? 'Possible bearish absorption, unconfirmed'
          : 'Awaiting structural reaction'
      }).`,
    }
  }

  return {
    timeframe,
    lifecycleStage: currentStage,
    candidateEvent: currentEvent,
    confirmationStatus: 'NONE',
    directionBias: 'NEUTRAL',
    sweepExtremePrice: null,
    sweepTime: null,
    reclaimPrice: null,
    reclaimTime: null,
    retestPrice: null,
    retestTime: null,
    structuralInvalidationPrice: null,
    invalidationReason: null,
    transitions,
    eventSummary: `ROTATIONAL BALANCE (${timeframe}): Price rotating inside [${range.rangeLow.toFixed(
      2
    )} – ${range.rangeHigh.toFixed(2)}] (${range.provisionalPhase}). No confirmed Phase C/D trigger.`,
  }
}
