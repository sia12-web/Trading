/**
 * Questioning & Auction Price Critique Engine
 *
 * Core Trading Philosophy:
 * 1. The Market is a Place to Do Business (Auction Market Theory):
 *    - Price advertises opportunity. When discounted (wholesale), institutions buy;
 *      when premium (retail), institutions sell.
 *    - If price is not suitable, NEVER force a trade. Patience is the primary edge.
 * 2. Session Inventory Reality Check:
 *    - "Why the hell should I buy at 9:30 AM when London and Asian participants
 *      accumulated 30 points lower overnight?"
 *    - Avoid buying retail from overnight longs seeking exit liquidity, or shorting
 *      into overnight shorts at session extremes.
 * 3. Multi-Horizon Valuation:
 *    - Short-Term: Yesterday NYC POC, Overnight POC, Overnight Inventory % Long/% Short.
 *    - Intermediate-Term: 5-Day Fixed Range Volume Profile (5D POC extended).
 *    - Long-Term: 5-Month Anchored VWAP (±1σ, ±2σ volatility bands).
 * 4. Weak-Hand & Emotional Retail Trap Protection:
 *    - Emotional traders buy on highs (FOMO after seeing a single green candle, round number,
 *      or low volume pop) and sell on lows.
 *    - Good/strong traders let weak hands push price to extremes, trap them, and punish them.
 * 5. 6-Point Questioning Self-Audit Checklist:
 *    - Q1: Single-Candle Impulse Trap
 *    - Q2: Psychological Round Number Magnet
 *    - Q3: Liquidity Vacuum / Low Volume Push
 *    - Q4: Time Regulation (Time-of-Day Context)
 *    - Q5: Overnight & Global Session Inventory
 *    - Q6: Wholesale vs. Retail Value Assessment
 */

export type AuctionValuationState =
  | 'DEEP_DISCOUNT'
  | 'DISCOUNT'
  | 'FAIR_VALUE'
  | 'PREMIUM'
  | 'EXTREME_PREMIUM'

export type CritiqueSessionStart = '09:00' | '09:15'

/**
 * Checks whether the Price Critique & Questioning desk is currently active.
 *
 * Requirements:
 * 1. Mon - Fri only (excludes Saturday and Sunday).
 * 2. Active strictly during New York Session window (starts at 09:00 ET or 09:15 ET; ends at 16:00 ET Cash Close).
 * 3. Inactive (hidden) during Asian session (18:00 - 03:00 ET) and London session (03:00 - 09:00 ET).
 *
 * Uses IANA timezone 'America/New_York' via Intl.DateTimeFormat for Daylight Saving Time accuracy.
 */
export function isPriceQuestioningSessionActive(
  now: Date | number = Date.now(),
  start: CritiqueSessionStart | string = '09:00'
): boolean {
  const d = typeof now === 'number' ? new Date(now) : now
  const tz = 'America/New_York'

  // Monday through Friday only
  const dayStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)
  if (dayStr === 'Sat' || dayStr === 'Sun') return false

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const s = parts.find((p) => p.type === 'second')?.value ?? '00'
  const timeStr = `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`

  const startHms = start.startsWith('09:15') ? '09:15:00' : '09:00:00'
  return timeStr >= startHms && timeStr < '16:00:00'
}

export type QuestioningAuditStatus = 'PASSED' | 'WARNING' | 'DANGER'

export interface QuestioningAuditItem {
  id: string
  question: string
  status: QuestioningAuditStatus
  headline: string
  detail: string
}

export interface PriceCritiqueEvaluation {
  currentPrice: number
  instrument: string
  isSessionActive?: boolean
  sessionPhase?: string
  valuationState: AuctionValuationState
  valuationScore: number // -100 (Deep Discount) to +100 (Extreme Premium)
  suitabilityVerdict:
    | 'SUITABLE_DISCOUNT_BUY'
    | 'SUITABLE_PREMIUM_SELL'
    | 'HOLD_PATIENT_DO_NOT_FORCE'
    | 'WEAK_HAND_TRAP_RISK'
  inventoryCritique: {
    asiaPoc: number | null
    londonPoc: number | null
    overnightPoc: number | null
    overnightHigh: number | null
    overnightLow: number | null
    overnightBias: string | null
    pctLong: number
    pctShort: number
    distanceFromOnPocPts: number | null
    distanceFromLondonPocPts: number | null
    critiqueSummary: string
  }
  multiHorizonLevels: {
    yesterdayPoc: number | null
    yesterdayVah: number | null
    yesterdayVal: number | null
    fiveDayPoc: number | null
    fiveDayVah: number | null
    fiveDayVal: number | null
    fiveMonthAvwap: number | null
    fiveMonthSigma1Upper: number | null
    fiveMonthSigma1Lower: number | null
    fiveMonthSigma2Upper: number | null
    fiveMonthSigma2Lower: number | null
  }
  weakHandTrap: {
    isTrapRisk: boolean
    trapType: 'NONE' | 'SINGLE_CANDLE_FOMO' | 'ROUND_NUMBER_MAGNET' | 'THIN_LIQUIDITY_VACUUM' | 'LUNCH_DOLDRUMS_CHOP'
    warning: string
  }
  sixQuestionAudit: QuestioningAuditItem[]
  deskGuidance: string
  wholesaleTarget: number | null
}

export interface EvaluatePriceQuestioningParams {
  currentPrice: number
  instrument?: string
  currentTimeEt?: string // e.g. "09:35:12" or "14:15"
  now?: Date | number
  sessionStart?: CritiqueSessionStart
  yesterday?: {
    poc?: number | null
    vah?: number | null
    val?: number | null
    high?: number | null
    low?: number | null
  } | null
  overnight?: {
    overnight?: { poc?: number | null; high?: number | null; low?: number | null } | null
    asia?: { poc?: number | null; high?: number | null; low?: number | null } | null
    london?: { poc?: number | null; high?: number | null; low?: number | null } | null
    biasLabel?: string | null
    pctLong?: number | null
    pctShort?: number | null
  } | null
  frvp5d?: {
    poc?: number | null
    vah?: number | null
    val?: number | null
    high?: number | null
    low?: number | null
  } | null
  avwap5m?: {
    vwap?: number | null
    sigma1Upper?: number | null
    sigma1Lower?: number | null
    sigma2Upper?: number | null
    sigma2Lower?: number | null
  } | null
  orderFlow?: {
    sessionCvd?: number | null
    trend?: string | null
    divergence?: string | null
  } | null
  lastCandle?: {
    open: number
    high: number
    low: number
    close: number
    volume?: number
    isBullish?: boolean
  } | null
  averageVolume?: number | null
}

function getInstrumentStdScale(instrument: string): number {
  switch (instrument.toUpperCase()) {
    case 'GOLD':
      return 5.0
    case 'CRUDE':
      return 0.75
    case 'DOW':
      return 100.0
    case 'NASDAQ':
    default:
      return 35.0
  }
}

function isRoundNumber(price: number, instrument: string): boolean {
  const inst = instrument.toUpperCase()
  if (inst === 'GOLD') {
    // Century $10 (e.g. 2750, 2760) or $5 half-handle
    const mod5 = Math.abs(price % 5)
    return mod5 < 0.25 || mod5 > 4.75
  }
  if (inst === 'CRUDE') {
    // $1.00 or $0.50
    const modHalf = Math.abs((price * 10) % 5)
    return modHalf < 0.5 || modHalf > 4.5
  }
  if (inst === 'DOW') {
    // 500 or 100 handles
    const mod100 = Math.abs(price % 100)
    return mod100 < 5 || mod100 > 95
  }
  // NASDAQ default: Century (100) or Half-Century (50) handles
  const mod50 = Math.abs(price % 50)
  return mod50 < 3 || mod50 > 47
}

export function evaluatePriceQuestioning(
  params: EvaluatePriceQuestioningParams
): PriceCritiqueEvaluation {
  const { currentPrice } = params
  const instrument = (params.instrument || 'NASDAQ').toUpperCase()
  const stdScale = getInstrumentStdScale(instrument)

  const yPoc = params.yesterday?.poc ?? null
  const yVah = params.yesterday?.vah ?? null
  const yVal = params.yesterday?.val ?? null

  const onPoc = params.overnight?.overnight?.poc ?? null
  const onHigh = params.overnight?.overnight?.high ?? null
  const onLow = params.overnight?.overnight?.low ?? null
  const asiaPoc = params.overnight?.asia?.poc ?? null
  const londonPoc = params.overnight?.london?.poc ?? null
  const overnightBias = params.overnight?.biasLabel ?? 'BALANCED'
  const pctLong = params.overnight?.pctLong ?? 50
  const pctShort = params.overnight?.pctShort ?? 50

  const poc5d = params.frvp5d?.poc ?? null
  const vah5d = params.frvp5d?.vah ?? null
  const val5d = params.frvp5d?.val ?? null

  const avwap5m = params.avwap5m?.vwap ?? null
  const s1U = params.avwap5m?.sigma1Upper ?? null
  const s1L = params.avwap5m?.sigma1Lower ?? null
  const s2U = params.avwap5m?.sigma2Upper ?? null
  const s2L = params.avwap5m?.sigma2Lower ?? null

  // 1. Multi-Horizon Valuation Score Calculation
  // Short-Term (Yesterday POC 30%, Overnight POC 30%), Intermediate (5D POC 25%), Macro (5M AVWAP 15%)
  let totalWeight = 0
  let weightedDeviation = 0

  if (yPoc != null) {
    const dev = (currentPrice - yPoc) / stdScale
    weightedDeviation += dev * 0.3
    totalWeight += 0.3
  }
  if (onPoc != null) {
    const dev = (currentPrice - onPoc) / stdScale
    weightedDeviation += dev * 0.3
    totalWeight += 0.3
  }
  if (poc5d != null) {
    const dev = (currentPrice - poc5d) / stdScale
    weightedDeviation += dev * 0.25
    totalWeight += 0.25
  }
  if (avwap5m != null) {
    const dev = (currentPrice - avwap5m) / (stdScale * 2)
    weightedDeviation += dev * 0.15
    totalWeight += 0.15
  }

  const normDev = totalWeight > 0 ? weightedDeviation / totalWeight : 0
  // Map normalized deviation (-2.0 to +2.0 stdDev) into valuationScore (-100 to +100)
  const rawScore = Math.max(-100, Math.min(100, Math.round(normDev * 50)))
  const valuationScore = rawScore

  let valuationState: AuctionValuationState = 'FAIR_VALUE'
  if (valuationScore >= 50) {
    valuationState = 'EXTREME_PREMIUM'
  } else if (valuationScore >= 18) {
    valuationState = 'PREMIUM'
  } else if (valuationScore <= -50) {
    valuationState = 'DEEP_DISCOUNT'
  } else if (valuationScore <= -18) {
    valuationState = 'DISCOUNT'
  } else {
    valuationState = 'FAIR_VALUE'
  }

  // 2. Inventory Critique (Overnight, Asia, London)
  const distOnPoc = onPoc != null ? Number((currentPrice - onPoc).toFixed(1)) : null
  const distLondonPoc = londonPoc != null ? Number((currentPrice - londonPoc).toFixed(1)) : null
  const timeStr = params.currentTimeEt || '09:30 ET'

  let inventorySummary = ''
  if (onPoc != null && distOnPoc != null) {
    if (distOnPoc > stdScale * 0.75) {
      const lowerAccumulator = londonPoc ? `London (${londonPoc})` : asiaPoc ? `Asia (${asiaPoc})` : `Overnight (${onPoc})`
      inventorySummary = `⚠️ Retail Premium Overhang: At ${timeStr}, ${lowerAccumulator} accumulated much lower. Current price is +${distOnPoc} pts above ON-POC. Overnight inventory is ${pctLong}% Net Long. Buying here pays top retail to overnight longs looking to unload onto late emotional buyers.`
    } else if (distOnPoc < -stdScale * 0.75) {
      const higherSeller = londonPoc ? `London (${londonPoc})` : asiaPoc ? `Asia (${asiaPoc})` : `Overnight (${onPoc})`
      inventorySummary = `⚠️ Deep Discount / Trap Short: At ${timeStr}, ${higherSeller} sold much higher. Current price is ${distOnPoc} pts below ON-POC. Overnight inventory is ${pctShort}% Net Short. Shorting into this floor invites a violent short-covering squeeze against weak-hand sellers.`
    } else {
      inventorySummary = `Balanced Globex Rotation: Current price (${currentPrice.toFixed(1)}) is trading within rotational tolerance of Overnight POC (${onPoc}). Overnight inventory is ${overnightBias} (${pctLong}% L / ${pctShort}% S).`
    }
  } else {
    inventorySummary = `Evaluating session inventory against prior closes. Standing by for Globex POC benchmarks.`
  }

  // 3. Weak-Hand Trap & Emotional Risk Detection
  let isTrapRisk = false
  let trapType: PriceCritiqueEvaluation['weakHandTrap']['trapType'] = 'NONE'
  let trapWarning = 'No acute weak-hand trap detected.'

  // Check 3a: Single Candle FOMO
  const candle = params.lastCandle
  if (candle) {
    const range = candle.high - candle.low
    const body = Math.abs(candle.close - candle.open)
    const isBigCandle = range > stdScale * 0.8 && body / Math.max(0.01, range) > 0.65

    if (isBigCandle && candle.isBullish && valuationState === 'EXTREME_PREMIUM') {
      isTrapRisk = true
      trapType = 'SINGLE_CANDLE_FOMO'
      trapWarning = `Bullish Candle FOMO Trap: Price just printed an aggressive green bar, but is extended into Extreme Premium. Weak-hand buyers often chase this bar right into institutional supply.`
    } else if (isBigCandle && !candle.isBullish && valuationState === 'DEEP_DISCOUNT') {
      isTrapRisk = true
      trapType = 'SINGLE_CANDLE_FOMO'
      trapWarning = `Bearish Candle Panic Trap: Price printed a large red bar directly into Deep Discount support. Weak-hand sellers dump at the low right before responsive absorption.`
    }
  }

  // Check 3b: Round Number Magnet without Volume
  if (!isTrapRisk && isRoundNumber(currentPrice, instrument)) {
    if (valuationState === 'PREMIUM' || valuationState === 'EXTREME_PREMIUM') {
      isTrapRisk = true
      trapType = 'ROUND_NUMBER_MAGNET'
      trapWarning = `Psychological Round Number Magnet: Price is hovering near a key psychological handle (${currentPrice.toFixed(0)}) in Premium territory. Without institutional volume confirmation, weak hands get trapped buying the round handle.`
    } else if (valuationState === 'DISCOUNT' || valuationState === 'DEEP_DISCOUNT') {
      isTrapRisk = true
      trapType = 'ROUND_NUMBER_MAGNET'
      trapWarning = `Round Number Psychological Floor: Price is testing a major round handle (${currentPrice.toFixed(0)}) in Discount territory. Beware of shorting into psychological defense.`
    }
  }

  // Check 3c: Thin Liquidity / Low Volume Push
  if (!isTrapRisk && params.averageVolume && candle?.volume) {
    if (candle.volume < params.averageVolume * 0.6) {
      if (valuationState === 'EXTREME_PREMIUM' || valuationState === 'DEEP_DISCOUNT') {
        isTrapRisk = true
        trapType = 'THIN_LIQUIDITY_VACUUM'
        trapWarning = `Thin Liquidity Vacuum: Market extended to price extremes on anemic volume (${candle.volume} vs avg ${params.averageVolume}). Lack of institutional backing signals an imminent trap reversal.`
      }
    }
  }

  // Check 3d: Lunch Doldrums / Time Regulation
  const timeLower = timeStr.toLowerCase()
  const isLunchChop =
    timeLower.includes('11:4') ||
    timeLower.includes('11:5') ||
    timeLower.includes('12:') ||
    timeLower.includes('13:0') ||
    timeLower.includes('13:1') ||
    timeLower.includes('13:2')

  if (!isTrapRisk && isLunchChop) {
    isTrapRisk = true
    trapType = 'LUNCH_DOLDRUMS_CHOP'
    trapWarning = `Time Regulation Failure (Lunch Doldrums): During 11:30–13:30 ET, institutional participation drops. Time cannot regulate efficient price discovery; rotational chop traps impatient breakout traders.`
  }

  // 4. Six-Question Self-Audit Checklist
  const sixQuestionAudit: QuestioningAuditItem[] = [
    // Q1: Single Candle FOMO
    {
      id: 'q1-single-candle',
      question: 'Why enter now? Is it just because you saw a single bullish or bearish candle?',
      status: trapType === 'SINGLE_CANDLE_FOMO' ? 'DANGER' : 'PASSED',
      headline:
        trapType === 'SINGLE_CANDLE_FOMO'
          ? '⚠️ Emotional Candle Chase Warning'
          : '✅ Multi-Bar Structural Context',
      detail:
        trapType === 'SINGLE_CANDLE_FOMO'
          ? 'You are reacting emotionally to a single candle extension. Strong money lets weak hands push the candle to exhaustion and traps them.'
          : 'Trade premise is anchored to multi-horizon structure and value areas, not impulse candle chasing.',
    },
    // Q2: Round Number Magnet
    {
      id: 'q2-round-number',
      question: 'Are you reacting just because price is at a rounded number handle?',
      status: trapType === 'ROUND_NUMBER_MAGNET' ? 'WARNING' : 'PASSED',
      headline: isRoundNumber(currentPrice, instrument)
        ? '⚠️ Psychological Handle Proximity'
        : '✅ Clean Auction Level',
      detail: isRoundNumber(currentPrice, instrument)
        ? `Price is within range of a major rounded handle. Ensure institutional resting volume confirms the level; never trade round numbers in isolation.`
        : 'Level is governed by true volume POCs and value area shelves rather than arbitrary round numbers.',
    },
    // Q3: Low Volume Vacuum
    {
      id: 'q3-low-volume',
      question: 'Is price moving in low volume where institutions set up traps?',
      status: trapType === 'THIN_LIQUIDITY_VACUUM' ? 'DANGER' : 'PASSED',
      headline:
        trapType === 'THIN_LIQUIDITY_VACUUM'
          ? '⚠️ Low Volume Vacuum Extension'
          : '✅ Adequate Auction Facilitation',
      detail:
        trapType === 'THIN_LIQUIDITY_VACUUM'
          ? 'Thin volume indicates lack of opposite institutional participation. Breakouts in low volume are prime candidates for look-above/below-and-fail.'
          : 'Volume profile confirms continuous two-way auction trade facilitation.',
    },
    // Q4: Time Regulation
    {
      id: 'q4-time-regulation',
      question: 'Can time regulate value right now (Session Phase & Rhythm)?',
      status: isLunchChop ? 'WARNING' : 'PASSED',
      headline: isLunchChop ? '⚠️ Midday Lunch Stagnation' : '✅ Active Institutional Time Phase',
      detail: isLunchChop
        ? 'New York lunch session (11:30–13:30 ET). Volume dries up and time cannot regulate value. Do not force trades during dead midday rotations.'
        : `Active session window (${timeStr}). Institutional order flow is present to facilitate genuine price discovery.`,
    },
    // Q5: Overnight & Global Session Inventory
    {
      id: 'q5-session-inventory',
      question: 'Where did Asian, London & Overnight participants do business?',
      status: Math.abs(distOnPoc ?? 0) > stdScale ? 'WARNING' : 'PASSED',
      headline:
        (distOnPoc ?? 0) > stdScale
          ? '⚠️ Buying Above Global Inventory'
          : (distOnPoc ?? 0) < -stdScale
          ? '⚠️ Selling Below Global Inventory'
          : '✅ Aligned with Globex Inventory',
      detail: inventorySummary,
    },
    // Q6: Wholesale Discount vs Retail Premium
    {
      id: 'q6-wholesale-value',
      question: 'Is current price a wholesale discount or an expensive retail premium?',
      status:
        valuationState === 'EXTREME_PREMIUM' || valuationState === 'DEEP_DISCOUNT'
          ? 'WARNING'
          : 'PASSED',
      headline: `Valuation: ${valuationState.replace('_', ' ')} (${valuationScore > 0 ? '+' : ''}${valuationScore} pts)`,
      detail:
        valuationState === 'DISCOUNT' || valuationState === 'DEEP_DISCOUNT'
          ? `Wholesale Value: Price is discounted relative to multi-session POCs (Y-POC: ${yPoc ?? 'N/A'}, 5D-POC: ${poc5d ?? 'N/A'}). Favorable for buyer accumulation.`
          : valuationState === 'PREMIUM' || valuationState === 'EXTREME_PREMIUM'
          ? `Retail Premium: Price is expensive relative to multi-session POCs. Favorable for seller distribution / shorting; unfavorable for long chasing.`
          : `Fair Value: Price is trading near high-volume consensus (${yPoc ?? poc5d ?? 'POC'}). Two-way rotational balance.`,
    },
  ]

  // 5. Suitability Verdict & Desk Guidance
  let suitabilityVerdict: PriceCritiqueEvaluation['suitabilityVerdict'] = 'HOLD_PATIENT_DO_NOT_FORCE'
  let deskGuidance = ''
  let wholesaleTarget: number | null = null

  if (isTrapRisk) {
    suitabilityVerdict = 'WEAK_HAND_TRAP_RISK'
    deskGuidance = `⚠️ STAND ASIDE / DO NOT FORCE: ${trapWarning} Be patient and let the auction develop.`
  } else if (valuationState === 'DISCOUNT' || valuationState === 'DEEP_DISCOUNT') {
    suitabilityVerdict = 'SUITABLE_DISCOUNT_BUY'
    wholesaleTarget = yPoc ?? onPoc ?? currentPrice
    deskGuidance = `✅ ADVANTAGEOUS WHOLESALE BUY: Price is discounted (-${Math.abs(valuationScore)} pts). Good location to do business for Longs if responsive confirmation forms.`
  } else if (valuationState === 'PREMIUM' || valuationState === 'EXTREME_PREMIUM') {
    suitabilityVerdict = 'SUITABLE_PREMIUM_SELL'
    wholesaleTarget = yPoc ?? onPoc ?? currentPrice
    deskGuidance = `✅ ADVANTAGEOUS RETAIL SHORT: Price is advertising at premium (+${valuationScore} pts). Good location to do business for Shorts if responsive rejection wicks confirm.`
  } else {
    suitabilityVerdict = 'HOLD_PATIENT_DO_NOT_FORCE'
    wholesaleTarget = yPoc ?? poc5d ?? null
    deskGuidance = `⚖️ BALANCED ROTATION: Market is at fair value. Do not force directional bias inside the chop. Wait for an excursion to discount or premium edges.`
  }

  return {
    currentPrice,
    instrument,
    isSessionActive: isPriceQuestioningSessionActive(params.now ?? Date.now(), params.sessionStart ?? '09:00'),
    valuationState,
    valuationScore,
    suitabilityVerdict,
    inventoryCritique: {
      asiaPoc,
      londonPoc,
      overnightPoc: onPoc,
      overnightHigh: onHigh,
      overnightLow: onLow,
      overnightBias,
      pctLong,
      pctShort,
      distanceFromOnPocPts: distOnPoc,
      distanceFromLondonPocPts: distLondonPoc,
      critiqueSummary: inventorySummary,
    },
    multiHorizonLevels: {
      yesterdayPoc: yPoc,
      yesterdayVah: yVah,
      yesterdayVal: yVal,
      fiveDayPoc: poc5d,
      fiveDayVah: vah5d,
      fiveDayVal: val5d,
      fiveMonthAvwap: avwap5m,
      fiveMonthSigma1Upper: s1U,
      fiveMonthSigma1Lower: s1L,
      fiveMonthSigma2Upper: s2U,
      fiveMonthSigma2Lower: s2L,
    },
    weakHandTrap: {
      isTrapRisk,
      trapType,
      warning: trapWarning,
    },
    sixQuestionAudit,
    deskGuidance,
    wholesaleTarget,
  }
}
