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

import { computeOrderFlowCvd } from './orderFlowDelta'
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
  markets: Partial<Record<RadarMarket, MarketOpportunityCard>>
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
      : volMapping.primaryGauge === 'JNIV'
      ? volState.nikkei.jniv
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
  const hasRunway = input.runwayRatio != null && input.runwayRatio >= 1.5

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

export interface RadarBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function radarLocationThresholdPts(market: RadarMarket): number {
  return MARKET_TICKER_CONFIG[market].locationThresholdPts
}

function sessionDateKey(timeSec: number, timeZone: string): string {
  const sec = timeSec > 1e12 ? Math.floor(timeSec / 1000) : timeSec
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(sec * 1000))
}

function groupSessions(bars: RadarBar[], timeZone: string): RadarBar[][] {
  const groups: RadarBar[][] = []
  let key = ''
  for (const bar of bars) {
    const day = sessionDateKey(bar.time, timeZone)
    if (day !== key) {
      key = day
      groups.push([])
    }
    groups[groups.length - 1]!.push(bar)
  }
  return groups
}

function sumVolume(bars: RadarBar[], count?: number): number {
  const slice = count == null ? bars : bars.slice(0, count)
  return slice.reduce((sum, bar) => sum + (Number.isFinite(bar.volume) ? bar.volume : 0), 0)
}

function relativeVolume(sessions: RadarBar[][]): number | undefined {
  if (sessions.length < 2) return undefined
  const current = sessions[sessions.length - 1]!
  if (current.length === 0) return undefined
  const elapsed = current.length
  const currentVol = sumVolume(current)
  const samples = sessions
    .slice(0, -1)
    .slice(-5)
    .map((session) => sumVolume(session, elapsed))
    .filter((vol) => vol > 0)
  if (samples.length === 0 || !(currentVol > 0)) return undefined
  const average = samples.reduce((sum, vol) => sum + vol, 0) / samples.length
  return average > 0 ? currentVol / average : undefined
}

function profileLevels(bars: RadarBar[], bin: number): {
  high: number
  low: number
  poc: number | null
  vah: number | null
  val: number | null
} | null {
  if (bars.length === 0 || !(bin > 0)) return null
  let high = -Infinity
  let low = Infinity
  const buckets = new Map<number, number>()
  let total = 0
  for (const bar of bars) {
    high = Math.max(high, bar.high)
    low = Math.min(low, bar.low)
    const vol = Number.isFinite(bar.volume) ? bar.volume : 0
    const px = Math.round(((bar.high + bar.low) / 2) / bin) * bin
    buckets.set(px, (buckets.get(px) || 0) + vol)
    total += vol
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null
  if (!(total > 0)) return { high, low, poc: null, vah: null, val: null }

  let poc = bars[0]!.close
  let best = -1
  for (const [px, vol] of buckets) {
    if (vol > best) {
      best = vol
      poc = px
    }
  }
  const prices = [...buckets.keys()].sort((a, b) => a - b)
  let idx = 0
  let nearest = Infinity
  for (let i = 0; i < prices.length; i++) {
    const dist = Math.abs(prices[i]! - poc)
    if (dist < nearest) {
      nearest = dist
      idx = i
    }
  }
  let acc = buckets.get(prices[idx]!) || 0
  let lo = idx
  let hi = idx
  while (acc < total * 0.7 && (lo > 0 || hi < prices.length - 1)) {
    const up = hi < prices.length - 1 ? buckets.get(prices[hi + 1]!) || 0 : -1
    const down = lo > 0 ? buckets.get(prices[lo - 1]!) || 0 : -1
    if (up >= down) {
      hi += 1
      acc += Math.max(up, 0)
    } else {
      lo -= 1
      acc += Math.max(down, 0)
    }
  }
  return { high, low, poc, vah: prices[hi]!, val: prices[lo]! }
}

function averageTrueRange(bars: RadarBar[]): number {
  if (bars.length < 2) return 0
  let sum = 0
  let count = 0
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!
    const bar = bars[i]!
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prev.close),
      Math.abs(bar.low - prev.close)
    )
    sum += tr
    count += 1
  }
  return count > 0 ? sum / count : 0
}

function readStructure(bars: RadarBar[], priorHigh: number | null, priorLow: number | null): {
  candlestickPattern: string | null
  wyckoffPattern: MarketInputData['wyckoffPattern']
  runwayRatio?: number
} {
  if (bars.length < 2) {
    return { candlestickPattern: null, wyckoffPattern: 'NONE' }
  }
  const last = bars[bars.length - 1]!
  const prev = bars[bars.length - 2]!
  const prevBodyTop = Math.max(prev.open, prev.close)
  const prevBodyBot = Math.min(prev.open, prev.close)
  const lastBodyTop = Math.max(last.open, last.close)
  const lastBodyBot = Math.min(last.open, last.close)
  const bullishEngulf =
    prev.close < prev.open &&
    last.close > last.open &&
    lastBodyBot <= prevBodyBot &&
    lastBodyTop >= prevBodyTop
  const bearishEngulf =
    prev.close > prev.open &&
    last.close < last.open &&
    lastBodyBot <= prevBodyBot &&
    lastBodyTop >= prevBodyTop
  const body = Math.abs(last.close - last.open)
  const lowerWick = Math.min(last.open, last.close) - last.low
  const upperWick = last.high - Math.max(last.open, last.close)
  const hammer = body > 0 && lowerWick >= body * 2 && upperWick <= body
  const upperExcess = body > 0 && upperWick >= body * 2 && lowerWick <= body
  const candlestickPattern = bullishEngulf
    ? 'Bullish Engulfing'
    : bearishEngulf
      ? 'Bearish Engulfing'
      : hammer
        ? 'Hammer'
        : upperExcess
          ? 'Upper Excess'
          : null

  let wyckoffPattern: MarketInputData['wyckoffPattern'] = 'NONE'
  if (bars.length >= 8) {
    const window = bars.slice(-8)
    const base = window.slice(0, 5)
    const tail = window.slice(5)
    const baseLow = Math.min(...base.map((bar) => bar.low))
    const baseHigh = Math.max(...base.map((bar) => bar.high))
    const probedBelow = tail.some((bar) => bar.low < baseLow)
    const probedAbove = tail.some((bar) => bar.high > baseHigh)
    if (probedBelow && last.close > baseLow && last.close < baseHigh) wyckoffPattern = 'SPRING'
    else if (probedAbove && last.close < baseHigh && last.close > baseLow) wyckoffPattern = 'UPTHRUST'
  }

  const bullish = wyckoffPattern === 'SPRING' || bullishEngulf || hammer
  const bearish = wyckoffPattern === 'UPTHRUST' || bearishEngulf || upperExcess
  const atr = averageTrueRange(bars.slice(-14))
  let runwayRatio: number | undefined
  if (bullish || bearish) {
    const room = bullish
      ? priorHigh != null
        ? Math.max(0, priorHigh - last.close)
        : 0
      : priorLow != null
        ? Math.max(0, last.close - priorLow)
        : 0
    const risk = Math.max(
      bullish ? last.close - last.low : last.high - last.close,
      atr * 0.25
    )
    if (risk > 0) runwayRatio = room / risk
  }

  return { candlestickPattern, wyckoffPattern, runwayRatio }
}

/**
 * Scores one market from a live print and its own candles.
 * Missing history stays missing. Nothing here is a sample book.
 */
export function deriveRadarMarketInput(args: {
  market: RadarMarket
  price: number
  previousClose: number
  candles: RadarBar[]
  timeZone: string
  bin: number
}): MarketInputData | null {
  if (!(args.price > 0)) return null
  const sessions = groupSessions(args.candles, args.timeZone)
  const current = sessions[sessions.length - 1] ?? []
  const prior = sessions.length >= 2 ? sessions[sessions.length - 2]! : null
  const threshold = radarLocationThresholdPts(args.market)
  const profile = prior ? profileLevels(prior, args.bin) : null

  let nearestLevel: MarketInputData['nearestLevel'] = {
    type: 'NONE',
    price: 0,
    distancePts: threshold * 100,
    thresholdPts: threshold,
  }
  if (profile) {
    const shelves: Array<{ type: NonNullable<MarketInputData['nearestLevel']>['type']; price: number }> = []
    if (profile.poc != null) shelves.push({ type: 'Y_POC', price: profile.poc })
    if (profile.vah != null) shelves.push({ type: 'Y_VAH', price: profile.vah })
    if (profile.val != null) shelves.push({ type: 'Y_VAL', price: profile.val })
    shelves.push({ type: 'ON_HIGH', price: profile.high }, { type: 'ON_LOW', price: profile.low })
    let best = shelves[0]!
    let bestDist = Math.abs(args.price - best.price)
    for (const shelf of shelves.slice(1)) {
      const dist = Math.abs(args.price - shelf.price)
      if (dist < bestDist) {
        best = shelf
        bestDist = dist
      }
    }
    nearestLevel = {
      type: best.type,
      price: best.price,
      distancePts: bestDist,
      thresholdPts: threshold,
    }
  }

  const flow = current.length > 0 ? computeOrderFlowCvd(current) : null
  const structure = readStructure(current, profile?.high ?? null, profile?.low ?? null)
  const prev = args.previousClose > 0 ? args.previousClose : args.price
  const rvol = relativeVolume(sessions)

  return {
    market: args.market,
    currentPrice: args.price,
    dayChangePct: prev > 0 ? ((args.price - prev) / prev) * 100 : 0,
    recentVolumeRatio: rvol,
    cvdTrend: flow?.trend ?? 'BALANCED',
    cvdDivergence: flow?.divergence ?? 'NONE',
    nearestLevel,
    candlestickPattern: structure.candlestickPattern,
    wyckoffPattern: structure.wyckoffPattern,
    runwayRatio: structure.runwayRatio,
  }
}

/**
 * Builds the cross-market radar from the inputs that were actually supplied.
 * A missing market is left off the report. Sample books are not filled in.
 */
export function buildCrossMarketRadarReport(
  volState: CrossMarketVolatilityState,
  marketInputs: Partial<Record<RadarMarket, MarketInputData>>
): CrossMarketRadarReport {
  const results: Partial<Record<RadarMarket, MarketOpportunityCard>> = {}
  let topPick: RadarMarket | null = null
  let maxScore = -1
  let aCount = 0
  let bCount = 0
  let cCount = 0

  for (const market of ALL_RADAR_MARKETS) {
    const input = marketInputs[market]
    if (!input || !(input.currentPrice > 0)) continue
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
  if (Object.keys(results).length === 0) {
    deskDirective = 'DESK DIRECTIVE: Live market radar has no priced contracts right now.'
  } else if (aCount > 0 && topPick) {
    const pickCard = results[topPick]!
    deskDirective = `DESK FOCUS: ${topPick} (${pickCard.contractLabel}) is the sole Grade A candidate today. OVX/VIX and profile location align. Ignore Grade B/C chop on peer markets.`
  } else if (bCount > 0) {
    deskDirective = `DESK DIRECTIVE: No Grade A setups active across the markets. Stand aside or monitor Grade B candidates awaiting location/volume confirmation.`
  } else {
    deskDirective = `DESK DIRECTIVE: All priced markets are Grade C. Maintain 0-probe discipline.`
  }

  return {
    asOfIso: new Date().toISOString(),
    topPick,
    gradeACount: aCount,
    gradeBCount: bCount,
    gradeCCount: cCount,
    markets: results,
    deskDirective,
  }
}
