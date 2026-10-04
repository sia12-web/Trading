/**
 * Cross-Market Opportunity Radar & Selection Engine
 *
 * Implements the 3-Factor Market Selection Matrix across the 5 core traded markets:
 * - NASDAQ (NQ / MNQ)
 * - DOW (YM / MYM)
 * - S&P 500 (ES / MES)
 * - GOLD (GC / MGC)
 * - CRUDE (CL / MCL)
 *
 * The 3 Pillars:
 * 1. PARTICIPATION: Is volatility (VIX1D / OVX / GVZ), volume, and range expanding?
 * 2. LOCATION: Is price interacting with a high-timeframe structural shelf (5D LVN, 5D POC, 5M AVWAP, Y-VAL/VAH)?
 * 3. STRUCTURE: Is there an asymmetric entry pattern (Wyckoff Spring/Upthrust, Bullish Engulfing at LVN, Absorption)?
 *
 * The Grade Matrix:
 * - Grade A: All 3 factors present -> FOCUS TRADE
 * - Grade B: Exactly 2 factors present -> ARMED / STAND ASIDE (Do not chase)
 * - Grade C: 0 or 1 factor present -> CHOP / IGNORE
 *
 * Anti-Chase Rule:
 * A market moving the most (+4%) in the middle of nowhere without profile location is Grade B/C.
 * A market moving +0.5% at a 5-day LVN with a clean spring is Grade A. Trade only Grade A.
 */

import {
  type CrossMarketVolatilityState,
  type VolatilitySymbol,
  mapInstrumentToVolatilityGauge,
} from './crossMarketVolatility'

export type RadarMarket = 'NASDAQ' | 'DOW' | 'SP500' | 'GOLD' | 'CRUDE' | 'NIKKEI'

export const ALL_RADAR_MARKETS: RadarMarket[] = [
  'NASDAQ',
  'DOW',
  'SP500',
  'GOLD',
  'CRUDE',
  'NIKKEI',
]

export type OpportunityGrade = 'A' | 'B' | 'C'

export interface MarketFactorEvaluation {
  present: boolean
  score: number // 0 to 100
  headline: string
  details: string[]
}

export interface MarketOpportunityCard {
  market: RadarMarket
  tickerRoot: string
  contractLabel: string
  volatilityGauge: VolatilitySymbol
  volatilityValue: number
  volatilityRegime: string
  isVolatilityExpanding: boolean
  currentPrice: number
  dayChangePct: number
  participation: MarketFactorEvaluation
  location: MarketFactorEvaluation
  structure: MarketFactorEvaluation
  grade: OpportunityGrade
  verdict: 'FOCUS_TRADE' | 'ARMED_STAND_ASIDE' | 'IGNORE_CHOP'
  summaryLine: string
  invalidationLevel?: number
  targetLevel?: number
  isTopPick: boolean
}

export interface CrossMarketRadarReport {
  asOfIso: string
  topPick: RadarMarket | null
  gradeACount: number
  gradeBCount: number
  gradeCCount: number
  markets: Record<RadarMarket, MarketOpportunityCard>
  deskDirective: string
}

export interface MarketInputData {
  market: RadarMarket
  currentPrice: number
  dayOpenPrice?: number
  dayChangePct?: number
  recentVolumeRatio?: number // RVOL (e.g. 1.4x)
  cvdTrend?: 'BUYER_DOMINANT' | 'SELLER_DOMINANT' | 'BALANCED'
  cvdDivergence?: 'BULLISH_ABSORPTION' | 'BEARISH_EXHAUSTION' | 'NONE'
  // Profile Location
  nearestLevel?: {
    type: '5D_LVN' | '5D_POC' | '5M_AVWAP' | 'Y_POC' | 'Y_VAH' | 'Y_VAL' | 'ON_HIGH' | 'ON_LOW' | 'NONE'
    price: number
    distancePts: number
    thresholdPts: number
  }
  // Structure & Wyckoff
  candlestickPattern?: string | null
  wyckoffPattern?: 'SPRING' | 'UPTHRUST' | 'ABSORPTION' | 'BREAKOUT_RETEST' | 'NONE'
  actionTrendlineBreak?: boolean
  runwayRatio?: number
}

const MARKET_TICKER_CONFIG: Record<
  RadarMarket,
  { root: string; label: string; locationThresholdPts: number }
> = {
  NASDAQ: { root: 'MNQ', label: 'Nasdaq · MNQ', locationThresholdPts: 15 },
  DOW: { root: 'MYM', label: 'Dow · MYM', locationThresholdPts: 30 },
  SP500: { root: 'MES', label: 'S&P 500 · MES', locationThresholdPts: 4 },
  GOLD: { root: 'MGC', label: 'Gold · MGC', locationThresholdPts: 3.5 },
  CRUDE: { root: 'CL', label: 'Crude Oil · CL', locationThresholdPts: 0.35 },
  NIKKEI: { root: 'NKD', label: 'Nikkei · NKD', locationThresholdPts: 35 },
}

/**
 * Evaluates a single market across the 3 pillars.
 */
export function evaluateMarket(
  input: MarketInputData,
  volState: CrossMarketVolatilityState
): MarketOpportunityCard {
  const config = MARKET_TICKER_CONFIG[input.market]
  const volMapping = mapInstrumentToVolatilityGauge(input.market)

  const volQuote =
    volMapping.primaryGauge === 'OVX'
      ? volState.crude.ovx
      : volMapping.primaryGauge === 'GVZ'
      ? volState.gold.gvz
      : volState.equities.vix1d

  // 1. PARTICIPATION FACTOR
  const volExpanding = volQuote.isExpanding
  const volRegime = volQuote.regime
  const rvol = input.recentVolumeRatio ?? 1.0
  const isRvolHigh = rvol >= 1.25
  const cvdActive =
    input.cvdTrend === 'BUYER_DOMINANT' ||
    input.cvdTrend === 'SELLER_DOMINANT' ||
    input.cvdDivergence === 'BULLISH_ABSORPTION' ||
    input.cvdDivergence === 'BEARISH_EXHAUSTION'

  // Participation is present if volatility is expanding OR volume is significantly surging with CVD
  const participationPresent = volExpanding || (isRvolHigh && cvdActive)
  const participationScore = Math.min(
    100,
    (volExpanding ? 45 : volRegime === 'ELEVATED' ? 25 : 10) +
      (isRvolHigh ? 35 : rvol >= 1.0 ? 15 : 0) +
      (cvdActive ? 20 : 5)
  )

  const participationDetails: string[] = [
    `${volQuote.symbol} (${volQuote.value.toFixed(1)}) is ${volRegime}${volExpanding ? ' [EXPANDING 🔥]' : ''}`,
    `RVOL: ${rvol.toFixed(2)}x ${isRvolHigh ? '(High Institutional Volume)' : '(Average/Low Volume)'}`,
    `CVD: ${input.cvdTrend || 'BALANCED'} ${input.cvdDivergence && input.cvdDivergence !== 'NONE' ? `(${input.cvdDivergence})` : ''}`,
  ]

  // 2. LOCATION FACTOR (ANTI-CHASE FILTER)
  const lvl = input.nearestLevel
  const isAtKeyLevel = Boolean(
    lvl &&
    lvl.type !== 'NONE' &&
    lvl.distancePts <= (lvl.thresholdPts || config.locationThresholdPts)
  )

  const locationScore = isAtKeyLevel
    ? Math.max(70, Math.min(100, 100 - (lvl!.distancePts / config.locationThresholdPts) * 30))
    : Math.max(10, 50 - (lvl ? (lvl.distancePts / config.locationThresholdPts) * 20 : 40))

  const locationDetails: string[] = []
  if (isAtKeyLevel && lvl) {
    locationDetails.push(
      `Directly at ${lvl.type.replace(/_/g, ' ')} (${lvl.price.toFixed(2)}) — Distance: ${lvl.distancePts.toFixed(1)} pts`
    )
  } else if (lvl && lvl.type !== 'NONE') {
    locationDetails.push(
      `Floating off-level — Nearest shelf is ${lvl.type.replace(/_/g, ' ')} (${lvl.price.toFixed(2)}) ${lvl.distancePts.toFixed(1)} pts away`
    )
  } else {
    locationDetails.push('No high-timeframe structural shelf nearby. Suspended in middle of nowhere.')
  }

  // 3. STRUCTURE FACTOR (WYCKOFF / ORDER FLOW / INVALIDATION)
  const hasWyckoff =
    input.wyckoffPattern === 'SPRING' ||
    input.wyckoffPattern === 'UPTHRUST' ||
    input.wyckoffPattern === 'ABSORPTION' ||
    input.wyckoffPattern === 'BREAKOUT_RETEST'
  const hasCandleConfirmation = Boolean(
    input.candlestickPattern &&
    (input.candlestickPattern.includes('Engulfing') ||
      input.candlestickPattern.includes('Hammer') ||
      input.candlestickPattern.includes('Excess'))
  )
  const hasTrendline = Boolean(input.actionTrendlineBreak)
  const hasRunway = (input.runwayRatio ?? 2.0) >= 1.5

  const structurePresent = (hasWyckoff || hasCandleConfirmation || hasTrendline) && hasRunway
  const structureScore = Math.min(
    100,
    (hasWyckoff ? 40 : 0) +
      (hasCandleConfirmation ? 30 : 0) +
      (hasTrendline ? 20 : 0) +
      (hasRunway ? 20 : 0)
  )

  const structureDetails: string[] = []
  if (hasWyckoff) structureDetails.push(`Wyckoff Event: ${input.wyckoffPattern}`)
  if (input.candlestickPattern) structureDetails.push(`Candlestick: ${input.candlestickPattern}`)
  if (hasTrendline) structureDetails.push('Action Trendline 5m Breakout Confirmed')
  if (input.runwayRatio != null) {
    structureDetails.push(`Horizontal Runway Ratio: ${input.runwayRatio.toFixed(1)}:1 (${hasRunway ? 'Clean runway' : 'Tight congestion'})`)
  }
  if (structureDetails.length === 0) {
    structureDetails.push('No distinct structural spring/retest pattern confirmed.')
  }

  // GRADE MATRIX (Strictly enforces the trader's philosophy)
  // Grade A = All 3 present
  // Grade B = Exactly 2 present (e.g. big move in middle of nowhere, or at level with 0 volume)
  // Grade C = 0 or 1 present
  const factorCount = (participationPresent ? 1 : 0) + (isAtKeyLevel ? 1 : 0) + (structurePresent ? 1 : 0)

  let grade: OpportunityGrade = 'C'
  let verdict: 'FOCUS_TRADE' | 'ARMED_STAND_ASIDE' | 'IGNORE_CHOP' = 'IGNORE_CHOP'

  if (factorCount === 3) {
    grade = 'A'
    verdict = 'FOCUS_TRADE'
  } else if (factorCount === 2) {
    grade = 'B'
    verdict = 'ARMED_STAND_ASIDE'
  } else {
    grade = 'C'
    verdict = 'IGNORE_CHOP'
  }

  // Summary generation
  let summaryLine = ''
  if (grade === 'A') {
    summaryLine = `★ GRADE A: Volatility expansion (${volQuote.symbol}) meeting ${lvl?.type.replace(/_/g, ' ') || 'key level'} with clean ${input.wyckoffPattern || input.candlestickPattern || 'structural trigger'}. High conviction setup.`
  } else if (grade === 'B') {
    if (!isAtKeyLevel) {
      summaryLine = `⚠️ GRADE B (Trap Risk): Moving with high volume/volatility, but floating in the middle of nowhere without profile location. DO NOT CHASE.`
    } else if (!participationPresent) {
      summaryLine = `⏳ GRADE B (Awaiting Participation): Sitting directly at ${lvl?.type.replace(/_/g, ' ')}, but volume and volatility are asleep. Wait for expansion.`
    } else {
      summaryLine = `⏳ GRADE B (Awaiting Structure): Participation & location confirmed, but awaiting Wyckoff spring or candle close invalidation.`
    }
  } else {
    summaryLine = `GRADE C (Chop): Low participation, inside-value rotation, or random drift. Stand aside.`
  }

  return {
    market: input.market,
    tickerRoot: config.root,
    contractLabel: config.label,
    volatilityGauge: volQuote.symbol,
    volatilityValue: volQuote.value,
    volatilityRegime: volRegime,
    isVolatilityExpanding: volExpanding,
    currentPrice: input.currentPrice,
    dayChangePct: input.dayChangePct ?? 0,
    participation: {
      present: participationPresent,
      score: participationScore,
      headline: participationPresent ? 'Expanding Participation' : 'Balanced / Muted Flow',
      details: participationDetails,
    },
    location: {
      present: isAtKeyLevel,
      score: locationScore,
      headline: isAtKeyLevel ? `At Key Shelf: ${lvl!.type.replace(/_/g, ' ')}` : 'Off-Level / Airspace',
      details: locationDetails,
    },
    structure: {
      present: structurePresent,
      score: structureScore,
      headline: structurePresent ? 'Clean Structural Trigger' : 'No Validated Invalidation',
      details: structureDetails,
    },
    grade,
    verdict,
    summaryLine,
    invalidationLevel: lvl?.price,
    isTopPick: false, // determined in batch ranking
  }
}

/**
 * Builds the full 5-market cross-asset radar report and ranks the top pick.
 */
export function buildCrossMarketRadarReport(
  volState: CrossMarketVolatilityState,
  marketInputs: Partial<Record<RadarMarket, MarketInputData>>
): CrossMarketRadarReport {
  const defaultInputs: Record<RadarMarket, MarketInputData> = {
    NASDAQ: {
      market: 'NASDAQ',
      currentPrice: 20150,
      dayChangePct: -0.2,
      recentVolumeRatio: 0.9,
      cvdTrend: 'BALANCED',
      nearestLevel: { type: '5D_POC', price: 20140, distancePts: 10, thresholdPts: 15 },
    },
    DOW: {
      market: 'DOW',
      currentPrice: 42100,
      dayChangePct: -0.7,
      recentVolumeRatio: 1.1,
      cvdTrend: 'SELLER_DOMINANT',
      nearestLevel: { type: '5D_LVN', price: 41980, distancePts: 120, thresholdPts: 30 },
    },
    SP500: {
      market: 'SP500',
      currentPrice: 5740,
      dayChangePct: -0.3,
      recentVolumeRatio: 1.0,
      cvdTrend: 'BALANCED',
      nearestLevel: { type: 'Y_VAL', price: 5732, distancePts: 8, thresholdPts: 4 },
    },
    GOLD: {
      market: 'GOLD',
      currentPrice: 2680,
      dayChangePct: 0.1,
      recentVolumeRatio: 0.8,
      cvdTrend: 'BALANCED',
      nearestLevel: { type: 'NONE', price: 0, distancePts: 999, thresholdPts: 3.5 },
    },
    CRUDE: {
      market: 'CRUDE',
      currentPrice: 72.8,
      dayChangePct: 2.4,
      recentVolumeRatio: 1.85,
      cvdTrend: 'BUYER_DOMINANT',
      cvdDivergence: 'BULLISH_ABSORPTION',
      nearestLevel: { type: '5D_LVN', price: 72.7, distancePts: 0.1, thresholdPts: 0.35 },
      wyckoffPattern: 'SPRING',
      candlestickPattern: 'Bullish Engulfing',
      runwayRatio: 2.8,
    },
    NIKKEI: {
      market: 'NIKKEI',
      currentPrice: 38900,
      dayChangePct: 0.6,
      recentVolumeRatio: 1.25,
      cvdTrend: 'BUYER_DOMINANT',
      nearestLevel: { type: '5D_LVN', price: 38850, distancePts: 50, thresholdPts: 35 },
    },
  }

  const results: Partial<Record<RadarMarket, MarketOpportunityCard>> = {}
  let topPick: RadarMarket | null = null
  let maxScore = -1
  let aCount = 0
  let bCount = 0
  let cCount = 0

  for (const market of ALL_RADAR_MARKETS) {
    const input = marketInputs[market] || defaultInputs[market]
    const card = evaluateMarket(input, volState)
    results[market] = card

    if (card.grade === 'A') aCount++
    else if (card.grade === 'B') bCount++
    else cCount++

    // Composite ranking score: Participation(40%) + Location(35%) + Structure(25%)
    // But Grade A always trumps Grade B, and Grade B always trumps Grade C
    const gradeWeight = card.grade === 'A' ? 1000 : card.grade === 'B' ? 500 : 0
    const composite =
      gradeWeight +
      card.participation.score * 0.4 +
      card.location.score * 0.35 +
      card.structure.score * 0.25

    if (composite > maxScore) {
      maxScore = composite
      topPick = market
    }
  }

  if (topPick && results[topPick]) {
    results[topPick]!.isTopPick = true
  }

  let deskDirective = ''
  if (aCount > 0 && topPick) {
    const pickCard = results[topPick]!
    deskDirective = `DESK FOCUS: ${topPick} (${pickCard.contractLabel}) is the sole Grade A candidate today. OVX/VIX and profile location align. Ignore Grade B/C chop on peer markets.`
  } else if (bCount > 0) {
    deskDirective = `DESK DIRECTIVE: No Grade A setups active across the 5 markets. Stand aside or monitor Grade B candidates awaiting location/volume confirmation.`
  } else {
    deskDirective = `DESK DIRECTIVE: All markets in Grade C rotation / inside value. Maintain 0-probe discipline.`
  }

  return {
    asOfIso: new Date().toISOString(),
    topPick,
    gradeACount: aCount,
    gradeBCount: bCount,
    gradeCCount: cCount,
    markets: results as Record<RadarMarket, MarketOpportunityCard>,
    deskDirective,
  }
}
