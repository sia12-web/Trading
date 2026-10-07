/**
 * Leo AI Desk Assistant.
 *
 * Leo is a market-structure auditor, not a signal generator.
 * One execution doctrine: predetermined location, price reaction,
 * CVD/volume as confirmation, four structures, structural invalidation,
 * and at least 2R of room. Session policy is injected once per instrument.
 */

import type { PriceCritiqueEvaluation } from '../trading/priceQuestioning'
import {
  type RangeComparisonResult,
  formatRangeVolumeComparisonReport,
} from '../trading/rangeVolumeComparison'
import type { CrossMarketVolatilityState } from '../trading/crossMarketVolatility'
import type { CrossMarketRadarReport } from '../trading/crossMarketRadar'
import { formatDeskBriefForInstrument } from '@/lib/ai/marketIntelligenceBus'

export interface LeoDataPoint {
  id: string
  label: string
  value: number | string
  tier: 'LT' | 'IT' | 'ST' | 'CONTEXT' | 'DRAWING' | 'ORDER_FLOW'
  category:
    | 'VWAP'
    | 'POC'
    | 'EXTREME'
    | 'VALUE_AREA'
    | 'EXCESS'
    | 'DAY_TYPE'
    | 'OPEN'
    | 'INVENTORY'
    | 'TRENDLINE'
    | 'RANGE'
    | 'FRVP'
    | 'PATTERN'
    | 'CVD'
  description?: string
  session?: 'Asia' | 'London' | 'New York' | string
  volume?: number | string
  retestRatio?: number
  isRetested?: boolean
  testCount?: number
}

export interface LeoUserDrawingsContext {
  trendlines: Array<{
    id: string
    label?: string
    startPrice: number
    endPrice: number
    startTimeEt: string
    endTimeEt: string
    slopePtsPerMin: number
    slopePtsPer5mBar: number
    slopeDirection: 'ASCENDING' | 'DESCENDING' | 'FLAT'
    projectedPrice: number
    distancePts: number | null
    priceRelation: 'ABOVE' | 'BELOW' | 'TESTING'
    direction?: 'BEARISH' | 'BULLISH'
    sessionOrigin?: 'Asia' | 'London' | 'NYC'
    isCarriedFromOvernight?: boolean
    breakCountOvernight?: number
    isActionTrendline?: boolean
    isReactionTrendline?: boolean
    actionBreakoutConfirmed?: boolean
    isInitialOvernight?: boolean
    p1?: { time: number; price: number }
    p2?: { time: number; price: number }
    horizontalRunway?: {
      runwayPts: number
      runwayRatio: number
      quality: 'EXCELLENT' | 'ACCEPTABLE' | 'TIGHT_RUNWAY'
      nearestTargetLabel?: string
      nearestTargetPrice?: number
      summary?: string
    }
    empiricalVelocity?: {
      baseVelocityPtsPer5m: number
      velocityState: 'EQUILIBRIUM' | 'CLIMAX_PARABOLIC' | 'HEALTHY_RETEST' | 'MOMENTUM_STALLED'
      equilibriumPrice: number
      climaxPrice: number
      retestFloorPrice: number
      summary?: string
    }
  }>
  ranges: Array<{
    id: string
    label?: string
    priceHigh: number
    priceLow: number
    midPrice: number
    heightPts: number
    startTimeEt: string
    endTimeEt: string
    durationMin: number
    positionPct: number
    priceRelation: 'INSIDE' | 'ABOVE' | 'BELOW'
    totalVolume?: number
    inRangeVolume?: number
    volumeRatePerMin?: number
    buyVolume?: number
    sellVolume?: number
    delta?: number
    buyRatioPct?: number
    poc?: number
    candleCount?: number
  }>
  frvps: Array<{
    id: string
    label?: string
    startTimeEt: string
    endTimeEt: string
    poc: number
    vah: number
    val: number
    high: number
    low: number
    totalVolume: number
    buyRatioPct: number
    distancePocPts: number | null
    priceRelation: 'AT_POC' | 'INSIDE_VALUE' | 'ABOVE_VAH' | 'BELOW_VAL'
  }>
}

export interface LeoSessionDetails {
  sessionName: string
  sessionPhase: string
  sessionElapsedMinutes: number
  timeToNextCheckpoint?: string
  candleTimeframe?: string
  barCountdown?: string
  calendarDate?: string
  isHoliday?: boolean
  holidayName?: string
}

export interface LeoActivePosition {
  positionId: string
  instrument: string
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  positionSize: number
  stopLoss: number
  profitTarget: number
  entryTimestamp: string | number
  durationMinutes: number
  unrealizedPnlPoints: number
  unrealizedPnlCad: number
  isInProfit: boolean
}

export interface LeoCandlestickPatternsContext {
  activePatterns: Array<{
    pattern: string
    type: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    candleTimeEt: string
    candlePrice: number
    barIndex: number
  }>
}

export interface LeoOrderFlowContext {
  sessionCvd: number
  latestBarDelta: number
  latestBuyVolume: number
  latestSellVolume: number
  latestBuyRatio: number
  trend: 'BUYER_DOMINANT' | 'SELLER_DOMINANT' | 'BALANCED'
  divergence: 'BULLISH_ABSORPTION' | 'BEARISH_EXHAUSTION' | 'NONE'
  description: string
}

export interface LeoLongTermMemoryItem {
  id: string
  instrument: string
  timeframe: string
  priceLow: number
  priceHigh: number
  purpose: string
  notes?: string
  status: 'ACTIVE' | 'TRIGGERED' | 'DISMISSED' | 'EXPIRED'
  isLongTerm?: boolean
  lastTriggeredAt?: string
}

export interface LeoChatContext {
  instrument: string
  currentPrice: number | null
  currentTimeEt: string
  dayType: string | null
  openingType: string | null
  sessionDetails?: LeoSessionDetails | null
  activePosition?: LeoActivePosition | null
  orderFlow?: LeoOrderFlowContext | null
  longTermMemories?: LeoLongTermMemoryItem[]
  longTermMoney: {
    avwap5m: number | null
    sigma1Upper: number | null
    sigma1Lower: number | null
    sigma2Upper: number | null
    sigma2Lower: number | null
    distancePts: number | null
  } | null
  intermediateMoney: {
    poc5d: number | null
    vah5d: number | null
    val5d: number | null
    high5d: number | null
    low5d: number | null
    distancePts: number | null
  } | null
  shortTermMoney: {
    sessionDate: string | null
    ypoc: number | null
    yhigh: number | null
    ylow: number | null
    yvah: number | null
    yval: number | null
    onpoc: number | null
    onhigh: number | null
    onlow: number | null
    overnightBias: string | null
    distanceYpocPts: number | null
    distanceOnpocPts: number | null
  } | null
  activeExcesses: Array<{
    type: string
    price: number
    session?: string
    volumeStr?: string
    retestRatio?: number
    isRetested?: boolean
  }>
  userDrawings?: LeoUserDrawingsContext
  candlestickPatterns?: LeoCandlestickPatternsContext
  selectedDataPoints?: LeoDataPoint[]
  dataPoints?: LeoDataPoint[]
  recentCandles?: Array<{
    time: number
    open: number
    high: number
    low: number
    close: number
    volume: number
  }>
  trappedTraders?: string
  priceQuestioning?: PriceCritiqueEvaluation
  rangeComparisons?: RangeComparisonResult[]
  crossMarketVolatility?: CrossMarketVolatilityState
  marketRadar?: CrossMarketRadarReport
  newsCatalystVwap?: {
    catalystTitle?: string
    eventTime?: string
    atrSurgeRatio?: number
    latestVwap?: number | null
    sigma1Upper?: number | null
    sigma1Lower?: number | null
    sigma2Upper?: number | null
    sigma2Lower?: number | null
  } | null
  /**
   * Optional override of the compact specialist desk brief.
   * When omitted, Leo reads the market intelligence bus for this instrument.
   */
  deskBriefText?: string | null
}

export interface LeoMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  attachedPoints?: LeoDataPoint[]
  directives?: LeoExecutionDirective[]
}

export type LeoExecutionDirective =
  | {
      action: 'CLOSE_POSITION'
      reason: string
      instrument?: string
    }
  | {
      action: 'ARM_STAGNATION_RULE'
      maxMinutes: number
      requireProfitPoints?: number
      instrument?: string
      description?: string
    }
  | {
      action: 'ARM_DESK_ALERT' | 'ARM_TELEGRAM_ALERT'
      targetReference: string
      targetPrice: number
      requireHighVolume?: boolean
      requireConfidence?: boolean
      session?: string
      customMessage?: string
      isLongTerm?: boolean
    }
  | {
      action: 'ARM_CONDITIONAL_ENTRY' | 'ARM_LVN_BULL_ENG_RULE'
      userPrompt?: string
      instrument?: string
      direction?: 'LONG' | 'SHORT'
      targetReference: string
      targetPrice?: number
      isLongTerm?: boolean
      pattern?:
        | 'BULLISH_ENGULFING'
        | 'BEARISH_ENGULFING'
        | 'HAMMER'
        | 'INVERTED_HAMMER'
        | 'SHOOTING_STAR'
        | 'REJECTION_TAIL'
        | 'LEVEL_TOUCH'
        | 'TRENDLINE_BREAKOUT_5M'
        | string
      stopLossMode?: 'BELOW_CANDLE_LOW' | 'ABOVE_CANDLE_HIGH' | 'FIXED_POINTS' | 'DOLLARS_50'
      stopLoss?: number
      takeProfitMode?: '1:1' | '1:2' | '1:3' | '1:5' | 'FIXED_POINTS'
      takeProfit?: number
      size?: number
      description?: string
    }
  | {
      action: 'SAVE_LONG_TERM_MEMORY'
      instrument?: string
      priceLow: number
      priceHigh: number
      purpose?: string
      timeframe?: string
    }
  | {
      action: 'CANCEL_RULES'
      ruleType?: string
    }
  | {
      action: 'PLACE_ORDER' | 'OPEN_POSITION'
      instrument: string
      direction: 'LONG' | 'SHORT'
      price: number
      stopLoss: number
      profitTarget: number
      size?: number
      reason: string
    }
  | {
      action: 'COPY_TOPSTEPX_ORDER'
      contract: string
      direction: 'BUY' | 'SELL'
      quantity: number
      entryPrice: number
      stopLoss: number
      takeProfit: number
      dollarRisk?: number
      dollarReward?: number
      bracketRatio?: string
    }
  | {
      action: 'SET_DAY_TYPE' | 'OVERRIDE_DAY_TYPE'
      dayType: 'DOUBLE_DISTRIBUTION' | 'NORMAL_VARIATION' | 'NORMAL' | 'TREND_BULL' | 'TREND_BEAR' | 'NEUTRAL'
      reason?: string
    }
  | {
      action: 'ARM_TRENDLINE_STRATEGY'
      trendlineId?: string
      instrument?: string
      direction?: 'LONG' | 'SHORT'
      description?: string
      userPrompt?: string
    }

/**
 * Parses execution directives (<execute>{...}</execute>) emitted by Leo.
 */
export function parseLeoDirectives(text: string): LeoExecutionDirective[] {
  const directives: LeoExecutionDirective[] = []
  if (!text) return directives

  // Helper to sanitize and normalize parsed directive
  const sanitize = (item: any): LeoExecutionDirective | null => {
    if (!item || typeof item !== 'object' || !item.action) return null
    if (item.action === 'PLACE_ORDER' || item.action === 'OPEN_POSITION') {
      return {
        ...item,
        price: Number(typeof item.price === 'number' ? item.price : parseFloat(String(item.price)) || 0),
        stopLoss: Number(typeof item.stopLoss === 'number' ? item.stopLoss : parseFloat(String(item.stopLoss)) || 0),
        profitTarget: Number(typeof item.profitTarget === 'number' ? item.profitTarget : parseFloat(String(item.profitTarget)) || 0),
        size: Number(typeof item.size === 'number' ? item.size : parseInt(String(item.size), 10) || 1),
      }
    }
    if (item.action === 'ARM_CONDITIONAL_ENTRY' || item.action === 'ARM_LVN_BULL_ENG_RULE') {
      return {
        ...item,
        targetPrice: item.targetPrice != null ? Number(typeof item.targetPrice === 'number' ? item.targetPrice : parseFloat(String(item.targetPrice)) || 0) : undefined,
        stopLoss: item.stopLoss != null ? Number(typeof item.stopLoss === 'number' ? item.stopLoss : parseFloat(String(item.stopLoss)) || 0) : undefined,
        takeProfit: item.takeProfit != null ? Number(typeof item.takeProfit === 'number' ? item.takeProfit : parseFloat(String(item.takeProfit)) || 0) : undefined,
        size: Number(typeof item.size === 'number' ? item.size : parseInt(String(item.size), 10) || 1),
        isLongTerm: Boolean(item.isLongTerm || item.longTermMemory),
      }
    }
    if (item.action === 'ARM_DESK_ALERT' || item.action === 'ARM_TELEGRAM_ALERT') {
      return {
        ...item,
        targetPrice: Number(typeof item.targetPrice === 'number' ? item.targetPrice : parseFloat(String(item.targetPrice)) || 0),
        isLongTerm: Boolean(item.isLongTerm || item.longTermMemory),
      }
    }
    if (item.action === 'ARM_STAGNATION_RULE') {
      const parsedMin = parseInt(String(item.maxMinutes || '5'), 10)
      return {
        ...item,
        maxMinutes: Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : 5,
        requireProfitPoints: item.requireProfitPoints != null ? Number(item.requireProfitPoints) || 1 : 1,
      }
    }
    if (item.action === 'COPY_TOPSTEPX_ORDER') {
      return {
        ...item,
        quantity: Number(typeof item.quantity === 'number' ? item.quantity : parseInt(String(item.quantity), 10) || 1),
        entryPrice: Number(typeof item.entryPrice === 'number' ? item.entryPrice : parseFloat(String(item.entryPrice)) || 0),
        stopLoss: Number(typeof item.stopLoss === 'number' ? item.stopLoss : parseFloat(String(item.stopLoss)) || 0),
        takeProfit: Number(typeof item.takeProfit === 'number' ? item.takeProfit : parseFloat(String(item.takeProfit)) || 0),
        dollarRisk: item.dollarRisk != null ? Number(item.dollarRisk) : undefined,
        dollarReward: item.dollarReward != null ? Number(item.dollarReward) : undefined,
      }
    }
    if (item.action === 'SAVE_LONG_TERM_MEMORY') {
      return {
        ...item,
        priceLow: Number(typeof item.priceLow === 'number' ? item.priceLow : parseFloat(String(item.priceLow)) || 0),
        priceHigh: Number(typeof item.priceHigh === 'number' ? item.priceHigh : parseFloat(String(item.priceHigh)) || 0),
      }
    }
    return item
  }

  // 1. Search for <execute>...</execute> tags
  const executeRegex = /<execute>([\s\S]*?)<\/execute>/gi
  let match: RegExpExecArray | null
  while ((match = executeRegex.exec(text)) !== null) {
    const raw = match[1]?.trim()
    if (!raw) continue
    try {
      // Strip trailing commas before closing braces/brackets (common LLM artifact)
      const clean = raw.replace(/,\s*([}\]])/g, '$1')
      const parsed = JSON.parse(clean)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const s = sanitize(item)
          if (s) directives.push(s)
        }
      } else {
        const s = sanitize(parsed)
        if (s) directives.push(s)
      }
    } catch {
      // Ignore unparseable block
    }
  }

  // 2. Also fallback regex for plain JSON blocks if <execute> tag was omitted
  if (directives.length === 0) {
    const jsonBlockRegex = /```json\s*(\{[\s\S]*?"action"[\s\S]*?\})\s*```/gi
    while ((match = jsonBlockRegex.exec(text)) !== null) {
      const raw = match[1]?.trim()
      if (!raw) continue
      try {
        const clean = raw.replace(/,\s*([}\]])/g, '$1')
        const parsed = JSON.parse(clean)
        const s = sanitize(parsed)
        if (s) directives.push(s)
      } catch {
        /* ignore */
      }
    }
  }

  return directives
}

/**
 * Extracts all currently active chart reference points as interactive data chips.
 */
export function extractChartDataPoints(ctx: LeoChatContext): LeoDataPoint[] {
  const points: LeoDataPoint[] = []

  // 1. Long-Term Money (5-Month AVWAP)
  if (ctx.longTermMoney?.avwap5m != null) {
    points.push({
      id: 'lt-5m-vwap',
      label: '5M VWAP',
      value: ctx.longTermMoney.avwap5m,
      tier: 'LT',
      category: 'VWAP',
      description: 'Long-Term Money benchmark (5-Month Anchored VWAP)',
    })
  }
  if (ctx.longTermMoney?.sigma1Upper != null) {
    points.push({
      id: 'lt-5m-s1u',
      label: '5M +1σ',
      value: ctx.longTermMoney.sigma1Upper,
      tier: 'LT',
      category: 'VWAP',
      description: '5-Month AVWAP +1σ Volatility Band',
    })
  }
  if (ctx.longTermMoney?.sigma1Lower != null) {
    points.push({
      id: 'lt-5m-s1l',
      label: '5M -1σ',
      value: ctx.longTermMoney.sigma1Lower,
      tier: 'LT',
      category: 'VWAP',
      description: '5-Month AVWAP -1σ Volatility Band',
    })
  }

  // News Catalyst Anchored VWAP
  if (ctx.newsCatalystVwap?.latestVwap != null) {
    points.push({
      id: 'st-news-vwap',
      label: `News AVWAP (${ctx.newsCatalystVwap.catalystTitle || 'Macro Catalyst'})`,
      value: ctx.newsCatalystVwap.latestVwap,
      tier: 'ST',
      category: 'VWAP',
      description: `Anchored VWAP from major catalyst (${ctx.newsCatalystVwap.catalystTitle ?? 'Macro News'} @ ${ctx.newsCatalystVwap.eventTime ?? ''}). Surge: ${ctx.newsCatalystVwap.atrSurgeRatio ?? 1}x ATR`,
    })
  }

  // 2. Intermediate-Term Money (5-Day FRVP)
  if (ctx.intermediateMoney?.poc5d != null) {
    points.push({
      id: 'it-5d-poc',
      label: '5D POC',
      value: ctx.intermediateMoney.poc5d,
      tier: 'IT',
      category: 'POC',
      description: 'Intermediate-Term Point of Control (Projected across active trading)',
    })
  }
  if (ctx.intermediateMoney?.vah5d != null) {
    points.push({
      id: 'it-5d-vah',
      label: '5D VAH',
      value: ctx.intermediateMoney.vah5d,
      tier: 'IT',
      category: 'VALUE_AREA',
      description: '5-Day Value Area High',
    })
  }
  if (ctx.intermediateMoney?.val5d != null) {
    points.push({
      id: 'it-5d-val',
      label: '5D VAL',
      value: ctx.intermediateMoney.val5d,
      tier: 'IT',
      category: 'VALUE_AREA',
      description: '5-Day Value Area Low',
    })
  }

  // 3. Short-Term Money (Yesterday NYC Session & Prior Overnight)
  if (ctx.shortTermMoney?.ypoc != null) {
    points.push({
      id: 'st-y-poc',
      label: 'Y-POC',
      value: ctx.shortTermMoney.ypoc,
      tier: 'ST',
      category: 'POC',
      description: `Yesterday Point of Control (Active session: ${ctx.shortTermMoney.sessionDate ?? 'Prior RTH'})`,
    })
  }
  if (ctx.shortTermMoney?.yhigh != null) {
    points.push({
      id: 'st-y-high',
      label: 'Y-High',
      value: ctx.shortTermMoney.yhigh,
      tier: 'ST',
      category: 'EXTREME',
      description: 'Yesterday RTH High',
    })
  }
  if (ctx.shortTermMoney?.ylow != null) {
    points.push({
      id: 'st-y-low',
      label: 'Y-Low',
      value: ctx.shortTermMoney.ylow,
      tier: 'ST',
      category: 'EXTREME',
      description: 'Yesterday RTH Low',
    })
  }
  if (ctx.shortTermMoney?.yvah != null) {
    points.push({
      id: 'st-y-vah',
      label: 'Y-VAH',
      value: ctx.shortTermMoney.yvah,
      tier: 'ST',
      category: 'VALUE_AREA',
      description: 'Yesterday Value Area High',
    })
  }
  if (ctx.shortTermMoney?.yval != null) {
    points.push({
      id: 'st-y-val',
      label: 'Y-VAL',
      value: ctx.shortTermMoney.yval,
      tier: 'ST',
      category: 'VALUE_AREA',
      description: 'Yesterday Value Area Low',
    })
  }
  if (ctx.shortTermMoney?.onpoc != null) {
    points.push({
      id: 'st-on-poc',
      label: 'ON-POC',
      value: ctx.shortTermMoney.onpoc,
      tier: 'ST',
      category: 'POC',
      description: 'Overnight Point of Control (ends at 09:29 AM ET prior to NYC open)',
    })
  }
  if (ctx.shortTermMoney?.onhigh != null) {
    points.push({
      id: 'st-on-high',
      label: 'ON-High',
      value: ctx.shortTermMoney.onhigh,
      tier: 'ST',
      category: 'EXTREME',
      description: 'Overnight Session High',
    })
  }
  if (ctx.shortTermMoney?.onlow != null) {
    points.push({
      id: 'st-on-low',
      label: 'ON-Low',
      value: ctx.shortTermMoney.onlow,
      tier: 'ST',
      category: 'EXTREME',
      description: 'Overnight Session Low',
    })
  }

  // 4. Session Context
  if (ctx.dayType) {
    points.push({
      id: 'ctx-day-type',
      label: 'Day Type',
      value: ctx.dayType,
      tier: 'CONTEXT',
      category: 'DAY_TYPE',
      description: 'Dalton Market Day Type classification',
    })
  }
  if (ctx.openingType) {
    points.push({
      id: 'ctx-open-type',
      label: 'Open Type',
      value: ctx.openingType,
      tier: 'CONTEXT',
      category: 'OPEN',
      description: 'Cash opening activity structure',
    })
  }

  // 5. Active Excess Tails
  for (let i = 0; i < ctx.activeExcesses.length; i++) {
    const ex = ctx.activeExcesses[i]!
    const sessionPrefix = ex.session ? `${ex.session} ` : ''
    points.push({
      id: `ex-${i}-${ex.price}`,
      label: `${sessionPrefix}Excess ${ex.type === 'BUYING_EXCESS' || ex.type === 'LOW' ? 'Low' : 'High'}`,
      value: ex.price,
      tier: 'IT',
      category: 'EXCESS',
      session: ex.session,
      volume: ex.volumeStr,
      retestRatio: ex.retestRatio,
      isRetested: ex.isRetested,
      description: `${sessionPrefix}${ex.type} tail at ${ex.price} ${ex.volumeStr ? `(${ex.volumeStr})` : ''} ${ex.retestRatio ? `[Retest ${ex.retestRatio.toFixed(2)}x]` : ''}`,
    })
  }

  // 6. User-Drawn Chart Tools & Manual References
  if (ctx.userDrawings) {
    for (const t of ctx.userDrawings.trendlines) {
      const isSpring = Boolean(t.label?.toLowerCase().includes('spring') || t.slopeDirection === 'ASCENDING')
      const typeLabel = `📐 ${t.label || (isSpring ? 'Trendline (Spring Origin)' : 'Trendline (Upthrust Origin)')}`

      const runwayDesc = t.horizontalRunway
        ? ` Runway: ${t.horizontalRunway.runwayPts.toFixed(1)} pts (${t.horizontalRunway.runwayRatio}:1 R:R, ${t.horizontalRunway.quality}). Target: ${t.horizontalRunway.nearestTargetLabel ?? 'N/A'}.`
        : ''
      const velocityDesc = t.empiricalVelocity
        ? ` Velocity: ${t.empiricalVelocity.velocityState} (${t.empiricalVelocity.baseVelocityPtsPer5m} pts/5m).`
        : ''

      points.push({
        id: `user-tl-${t.id}`,
        label: typeLabel,
        value: `${t.startPrice.toLocaleString()} → ${t.endPrice.toLocaleString()}`,
        tier: 'DRAWING',
        category: 'TRENDLINE',
        description: `Trendline [${t.slopeDirection}]: ${t.startTimeEt} to ${t.endTimeEt} (${t.slopePtsPer5mBar >= 0 ? '+' : ''}${t.slopePtsPer5mBar} pts/5m). Origin: ${isSpring ? 'Spring (Support Sweep)' : 'Upthrust (Resistance Sweep)'}. Projected level: ${t.projectedPrice}. Price is ${t.priceRelation} (${t.distancePts != null ? `${t.distancePts} pts` : ''}).${runwayDesc}${velocityDesc}`,
      })
    }
    for (const r of ctx.userDrawings.ranges) {
      const volDesc = r.totalVolume != null
        ? ` | Traded Vol: ${r.totalVolume.toLocaleString()} (${r.volumeRatePerMin ?? 0} vol/min, ${r.buyRatioPct ?? 50}% buy, delta ${r.delta != null && r.delta >= 0 ? '+' : ''}${r.delta?.toLocaleString() ?? 0})`
        : ''
      points.push({
        id: `user-range-${r.id}`,
        label: r.label || 'Range Box',
        value: `${r.priceLow.toLocaleString()} – ${r.priceHigh.toLocaleString()}`,
        tier: 'DRAWING',
        category: 'RANGE',
        volume: r.totalVolume,
        description: `Manual Range: ${r.heightPts} pts span (${r.startTimeEt} to ${r.endTimeEt}, ${r.durationMin}m). Price is ${r.priceRelation} range (${r.positionPct}%)${volDesc}.`,
      })
    }
    for (const f of ctx.userDrawings.frvps) {
      points.push({
        id: `user-frvp-${f.id}`,
        label: f.label || 'Manual FRVP',
        value: `POC ${f.poc.toLocaleString()}`,
        tier: 'DRAWING',
        category: 'FRVP',
        volume: f.totalVolume,
        description: `Manual FRVP: POC ${f.poc.toLocaleString()} | VAH ${f.vah.toLocaleString()} | VAL ${f.val.toLocaleString()} (${f.startTimeEt}–${f.endTimeEt}). Volume: ${f.totalVolume.toLocaleString()} (${f.buyRatioPct ?? 50}% buy). Price is ${(f.priceRelation || 'INSIDE_VALUE').replace('_', ' ')}.`,
      })
    }
  }

  // 6b. Range Volume Comparison Dossiers
  if (ctx.rangeComparisons && ctx.rangeComparisons.length > 0) {
    for (let i = 0; i < ctx.rangeComparisons.length; i++) {
      const c = ctx.rangeComparisons[i]!
      points.push({
        id: `range-comp-${i}`,
        label: `📊 ${c.rangeA.label} vs ${c.rangeB.label}`,
        value: `Vol ${c.volumeTrend} (${c.volumeChangePct >= 0 ? '+' : ''}${c.volumeChangePct}%)`,
        tier: 'DRAWING',
        category: 'RANGE',
        description: `Range Comparison: Vol ${c.volumeTrend} by ${c.volumeChangePct >= 0 ? '+' : ''}${c.volumeChangePct}% (${c.rangeA.totalVolume.toLocaleString()} → ${c.rangeB.totalVolume.toLocaleString()}). Support: ${c.supportReadiness.label} | Resistance: ${c.resistanceReadiness.label}`,
      })
    }
  }

  // 7. Active Candlestick Pattern Markers
  if (ctx.candlestickPatterns && ctx.candlestickPatterns.activePatterns.length > 0) {
    for (const p of ctx.candlestickPatterns.activePatterns) {
      points.push({
        id: `pattern-${p.barIndex}-${p.pattern}`,
        label: `${p.pattern}`,
        value: `${p.candlePrice.toLocaleString()} (${p.candleTimeEt})`,
        tier: 'DRAWING',
        category: 'PATTERN',
        description: `Candlestick Pattern Marker: ${p.pattern} [${p.type}] detected at ${p.candleTimeEt} (Price: ${p.candlePrice.toLocaleString()})`,
      })
    }
  }

  return points
}

/** Displacement vs prior value. Not a count of who is long or short. */
export function directionalInventoryProxy(raw: string | null | undefined): string {
  const b = (raw || '').trim().toUpperCase()
  if (!b || b === 'EVALUATING' || b === 'N/A' || b === 'UNKNOWN') return 'UNAVAILABLE'
  if (b.includes('SHORT')) return 'SHORT_BIASED'
  if (b.includes('LONG')) return 'LONG_BIASED'
  if (b.includes('BALANC') || b.includes('NEUTRAL') || b.includes('MIXED')) return 'BALANCED'
  return 'UNAVAILABLE'
}

/**
 * One session policy per request. NYC equity, trader-defined NY profile
 * (gold/crude), or Tokyo. Never both.
 */
export function sessionPolicyForInstrument(instrument: string): string {
  if (instrument === 'NIKKEI') {
    return `SESSION_POLICY_TOKYO
This is the only session policy. Do not freeze the map because it is 09:30 ET.

Platform session (TOKYO_SESSION — yesterday's profile and rule expiry use this window):
- Before 08:45 JST: build the futures map from verified levels only.
- 08:45 JST: desk analyze start. OSE Nikkei futures open.
- 09:00 JST: TSE cash open. Freeze and reassess the primary cash-session map here.
- 11:30 JST: cash lunch begins.
- 12:30 JST: cash PM session begins.
- 15:00 JST: desk cash-profile close. Yesterday's profile on this platform is 09:00–15:00 JST. It is not the NYC 09:30–16:00 window.
- 15:30 JST: TSE cash close is an exchange reference only. It does not extend this platform's profile past 15:00 JST.
- 15:45 JST: OSE futures day-session close is an exchange reference only.

"Around the open" means around 09:00 JST.`
  }
  if (instrument === 'GOLD' || instrument === 'CRUDE') {
    return `SESSION_POLICY_NYC
TRADER_DEFINED_NY_PROFILE_SESSION
Gold and crude do not have an equity cash session. 09:30–16:00 ET is the trader-defined New York profile window used for yesterday's profile. Call that window TRADER_DEFINED_NY_PROFILE_SESSION. Do not infer an equity open auction, a cash imbalance, or a stock-market close from it.

- Before 09:30 ET: build the map from verified levels only.
- 09:30 ET: freeze the map. Do not invent levels after the freeze.
- "Around the open" means the start of this profile window.`
  }
  return `SESSION_POLICY_NYC
US equity-index session. Yesterday's profile is the NYC cash session 09:30–16:00 ET.

- Before 09:30 ET: build the map from verified levels only.
- 09:30 ET: freeze the map. Do not invent levels after the freeze.
- "Around the open" means 09:30 ET. Scan NQ, ES, YM, Gold, and Oil for location, participation, and one of the four structures.`
}

const CLEAN_LOCATION_AUDIT: Record<string, string> = {
  'q1-single-candle': 'Is this a single-candle impulse with no structural trigger?',
  'q2-round-number': 'Is the idea only a round number, with no structural zone?',
  'q3-low-volume': 'Is price moving on light participation away from a predetermined zone?',
  'q4-time-regulation': 'Is the session window one where continuation is typically poor?',
  'q5-session-inventory': 'Is price extended versus the prior session accepted value?',
  'q6-wholesale-value': 'Is location extended versus yesterday and 5-day value, or inside balance?',
}

function renderAuctionLocationBlock(q: PriceCritiqueEvaluation | undefined): string {
  if (!q) return 'Auction location telemetry: UNAVAILABLE'
  const inv = q.inventoryCritique
  const proxy = directionalInventoryProxy(inv?.overnightBias)
  const dist = inv?.distanceFromOnPocPts
  const onPoc = inv?.overnightPoc
  let location = 'Displacement vs overnight accepted value: UNAVAILABLE'
  if (dist != null && onPoc != null && Number.isFinite(dist) && Number.isFinite(onPoc)) {
    if (dist > 0) {
      location = `Price is ${dist} pts above overnight accepted value (${onPoc}). Buying here offers poorer location unless higher prices show continued acceptance.`
    } else if (dist < 0) {
      location = `Price is ${Math.abs(dist)} pts below overnight accepted value (${onPoc}). Selling here offers poorer location unless lower prices show continued acceptance.`
    } else {
      location = `Price is at overnight accepted value (${onPoc}).`
    }
  }
  const audit =
    q.sixQuestionAudit && q.sixQuestionAudit.length > 0
      ? q.sixQuestionAudit
          .map((item) => `  * [${item.status}] ${CLEAN_LOCATION_AUDIT[item.id] ?? item.question}`)
          .join('\n')
      : '  * UNAVAILABLE'
  const scoreText = `${q.valuationScore > 0 ? '+' : ''}${q.valuationScore}`
  return `- Valuation State: ${q.valuationState.replace(/_/g, ' ')} (heuristic score ${scoreText} / 100; not a probability and not permission to trade)
- Suitability label: ${q.suitabilityVerdict} (location hint only; not a trigger)
- Overnight & Session Inventory Reality: ${location}
- Overnight directional inventory proxy: ${proxy}. Calculation: displacement relative to prior settlement or accepted value. This is not a count of participants long or short. Do not quote a percent long or percent short.
- Pre-Trade 6-Question Self-Audit:
${audit}`
}

function gaugeTelemetry(quote: { value: number; changePct: number; sourced?: boolean } | undefined): string {
  if (!quote?.sourced || !Number.isFinite(quote.value) || !Number.isFinite(quote.changePct)) return 'UNAVAILABLE'
  const sign = quote.changePct >= 0 ? '+' : ''
  return `${quote.value.toFixed(1)} (${sign}${quote.changePct.toFixed(1)}%)`
}

function jnivTelemetry(vol: CrossMarketVolatilityState): string {
  return gaugeTelemetry(vol.nikkei?.jniv)
}

/**
 * Builds Leo's system prompt.
 * Static text is rules. Live numbers come only from ctx telemetry.
 */
export function buildLeoSystemPrompt(ctx: LeoChatContext): string {
  const verifiedExamplePrice =
    ctx.shortTermMoney?.yval != null && Number.isFinite(ctx.shortTermMoney.yval)
      ? ctx.shortTermMoney.yval.toFixed(2)
      : ctx.currentPrice != null && Number.isFinite(ctx.currentPrice)
        ? ctx.currentPrice.toFixed(2)
        : null
  const exampleTargetJson = verifiedExamplePrice != null ? verifiedExamplePrice : '"UNAVAILABLE"'
  const currentPriceStr = ctx.currentPrice != null ? ctx.currentPrice.toFixed(2) : 'Awaiting quote'
  const sessionPolicy = sessionPolicyForInstrument(ctx.instrument)
  const auctionLocationBlock = renderAuctionLocationBlock(ctx.priceQuestioning)

  let selectedSummary = 'None attached.'
  if (ctx.selectedDataPoints && ctx.selectedDataPoints.length > 0) {
    selectedSummary = ctx.selectedDataPoints
      .map((p) => {
        const extra = [
          p.session ? `Session: ${p.session}` : '',
          p.volume ? `Volume: ${p.volume}` : '',
          p.retestRatio != null ? `Retest Ratio: ${p.retestRatio}x` : p.isRetested ? 'Retested' : '',
        ]
          .filter(Boolean)
          .join(' | ')
        return `- [${p.tier}] ${p.label}: ${p.value} ${extra ? `(${extra})` : ''} ${p.description ? `— ${p.description}` : ''}`
      })
      .join('\n')
  }

  const sessionDetails = ctx.sessionDetails
  const sessionSummary = sessionDetails
    ? `- Active Session: ${sessionDetails.sessionName} (Phase: ${sessionDetails.sessionPhase})
- Session Elapsed Time: ${sessionDetails.sessionElapsedMinutes} minutes into session
- Next Key Checkpoint: ${sessionDetails.timeToNextCheckpoint ?? 'Standard session rhythm'}
- Chart Timeframe: ${sessionDetails.candleTimeframe ?? '5m'} (${sessionDetails.barCountdown ?? 'Active forming candle'})
- Trading Calendar Date: ${sessionDetails.calendarDate ?? 'Active trading date'} ${sessionDetails.isHoliday ? `[US HOLIDAY: ${sessionDetails.holidayName ?? 'Exchange Holiday'}]` : ''}`
    : `- Wall Clock (New York): ${ctx.currentTimeEt}`

  const pos = ctx.activePosition
  const positionSummary = pos
    ? `STATE: OPEN POSITION ACTIVE
- Direction: ${pos.direction} on ${pos.instrument}
- Entry Price: ${pos.entryPrice.toFixed(2)} (Current Price: ${currentPriceStr})
- Position Size: ${pos.positionSize} contracts
- Duration in Trade: ${pos.durationMinutes.toFixed(1)} minutes
- Stop Loss: ${pos.stopLoss > 0 ? pos.stopLoss.toFixed(2) : 'None set'} | Profit Target: ${pos.profitTarget > 0 ? pos.profitTarget.toFixed(2) : 'None set'}
- Unrealized P&L: ${pos.unrealizedPnlPoints >= 0 ? '+' : ''}${pos.unrealizedPnlPoints.toFixed(1)} points (${pos.unrealizedPnlCad >= 0 ? '+' : ''}${pos.unrealizedPnlCad.toFixed(2)} CAD) — Status: ${pos.isInProfit ? '🟢 IN PROFIT' : '🔴 NOT IN PROFIT / UNPROFITABLE'}`
    : 'STATE: FLAT (No open position currently on the desk).'

  const deskBriefBlock =
    ctx.deskBriefText && ctx.deskBriefText.trim().length > 0
      ? ctx.deskBriefText.trim()
      : formatDeskBriefForInstrument(ctx.instrument)

  return `You are Leo, a disciplined market-structure auditor for the ${ctx.instrument} desk.
You are not a signal generator. You challenge every potential setup. You do not place orders.

Ask, in this order: Why here? What happened at the level? Who is aggressive? Did price respond? Did price confirm? Where is the idea wrong? Is there 2R to the next predetermined zone?
If any answer is poor, the verdict is WAIT or NO TRADE. A session with zero trades is valid.

The platform is strictly read-only. It cannot place, modify, or flatten a broker order. CLOSE_POSITION only records a manual-flatten reminder. Only the trader can close a position at the broker.

Execution doctrine is the 22-rule block at the end of this prompt. Nothing in this prompt adds a fifth setup, a point score, a fixed-point target, or a story about who is in the market.

${deskBriefBlock}

ZERO HALLUCINATION — PRIORITY 1:
Every numerical price, level, POC, VWAP, volume, delta, and gauge you cite must come from verified telemetry in this prompt.
NEVER substitute defaults for unavailable live data.
If a required datum is absent, state UNAVAILABLE.
Never infer an exact price, volume, delta, positioning, news result, economic number, session status, or account balance.
Do not invent a quote when Live Price says Awaiting quote.

DECISION HIERARCHY (stop at the first failure):
1. DATA VALIDITY — Do I have verified data for this claim?
2. SESSION — Which market and which injected session policy am I on?
3. LOCATION — Is price at a predetermined structural zone from the frozen map?
4. REACTION — Rejecting, accepting, reclaiming, or a failed reclaim?
5. RESULT — Is aggression producing proportional price progress? (FLOW → RESULT)
6. ORDER FLOW — Does CVD and volume confirm or contradict that result? Confirmation only. Never the trigger.
7. TRIGGER — Is this exactly one of the four allowed structures?
8. RISK — Where is structural invalidation, plus an instrument-appropriate minimum buffer?
9. REWARD — Is there at least 2R of room before the next important zone?
10. FUNDAMENTALS — Does the desk brief support or reject the observed move? It never creates the trigger.
DECISION: TRADEABLE HYPOTHESIS, WAIT, or NO TRADE.

${sessionPolicy}

STRUCTURE MAP:
- Tier 1, mandatory, built before the session-policy freeze: 5-day profile (POC, HVN, LVN, high, low, value), yesterday's profile (VAH, POC, VAL, high, low), overnight high, overnight low, overnight POC. Overnight inventory is context. It does not trigger a trade.
- Tier 2, confirmation only: current price, volume effort versus price result, CVD.
- Tier 3, context only, never overrides Tier 1: 5-month AVWAP and its deviation bands. A higher-timeframe contextual benchmark. It may add confluence. It does not identify who is positioned. It does not trigger a trade. It never overrides 5-day, yesterday, or current structural behavior.
- Dalton day type and opening type are descriptive labels from telemetry. They do not trigger a trade. If telemetry says the session is closed or FINAL, state the settled day type. Do not say it is still forming.
- Zones, not laser prices. A range that appears away from the frozen map is ignored.
- Initial Balance is not a level, a phase, or a trigger. Do not cite IB high, IB low, a first-hour balance, or an IB extension. The opening hour is not a tradeable range.

FOUR EXECUTION STRUCTURES — THE ONLY TRIGGERS:
Support:
1. Spring, then reclaim, then LONG hypothesis.
2. Breakdown, then failed reclaim, then SHORT hypothesis.
Resistance:
3. Upthrust, then return below, then SHORT hypothesis.
4. Breakout, then successful retest, then LONG hypothesis.
Everything else is ignored.

Trendline: a manually drawn trendline is additional structural evidence or an optional situation hypothesis. It is not a separate trading system.
Trendline break alone = NO TRADE.
Trendline break counts only when it is the same event as one of the four structures above.
The platform never draws the line. If the trader asks to arm monitoring on their line, emit ARM_TRENDLINE_STRATEGY as a hypothesis watch. Do not attach a fixed point target.

Candlestick patterns, including a bullish engulfing at a low-volume node, are supporting evidence only.
A valid long hypothesis still requires a failed breakdown plus reclaim, or a successful breakout and retest.
A candlestick never overrides structural invalidation. It can improve a setup. It is not the setup. Do not enter on the engulfing close.

ORDER FLOW — FLOW → RESULT:
CVD uses CME Globex executions to estimate aggressive buy versus aggressive sell activity. Participant identity is unknown.
Ignore participant identity. Describe observable behavior.
Positive CVD is not absorption. CVD +4000 with price +100 points is buyers getting a result, not absorption.
Absorption is aggression without proportional price result.
Possible bullish absorption: aggressive selling remains heavy or CVD falls, but price produces progressively less downside. Strongest evidence: price holds, equal-low, or higher-low despite lower CVD. Confirmation: price reclaims the structural level.
Possible bearish absorption: aggressive buying remains heavy or CVD rises, but price produces progressively less upside. Confirmation: price returns below or rejects the structural level.
CVD never triggers. Price structure triggers. CVD confirms or contradicts.

VOLUME:
Volume is contextual evidence, not a standalone classification.
Compare effort, resulting price displacement, location, and previous comparable tests.
Higher volume plus a strong directional result means initiative participation.
Higher volume plus little directional result means possible absorption.
Lower volume plus failed continuation means possible exhaustion or lack of participation.
Price structure must confirm.
Classifier labels in the range matrix (including any percent-volume or buy-ratio tags) are hints. They are not permission to trade. A volume change does not by itself make support or resistance good.

HEURISTIC SETUP CHECKLIST (not a scored model):
A = Location + Structure + Participation. All three. A tradeable hypothesis only if one of the four structures is also present.
B = 2 of 3. Wait.
C = 0 or 1 of 3. No trade.
There is no point score. POC, round numbers, AVWAP, and candles do not add points.

CROSS-ASSET VOLATILITY & 5-MARKET SELECTION MATRIX (PARTICIPATION x LOCATION x STRUCTURE):
Gauges are context only. VIX1D measures 1-day expected volatility for equities. OVX is crude volatility. GVZ is gold volatility. JNIV is Nikkei volatility. A gauge does not say who is positioned and does not trigger a trade.
Do not decide the market in advance. At the open defined by the injected session policy, prefer the name with participation, a predetermined location, and one of the four structures.
TRADE ONLY GRADE A under the checklist above, and only as a hypothesis.
The Anti-Chase Imperative: the largest move, away from a predetermined zone, is not a setup.

LOCATION LANGUAGE:
State where price is relative to accepted value. Do not narrate wholesale, retail, weak hands, or who is unloading.
If price is substantially above overnight accepted value, say that buying here offers poorer location unless higher prices show continued acceptance.
Overnight directional inventory is a proxy: LONG_BIASED, SHORT_BIASED, or BALANCED, from displacement versus prior settlement or value. It is not a percentage of participants long or short.

RISK AND REWARD:
Stop = structural invalidation plus an instrument-appropriate minimum buffer. Do not use a fixed point stop or a fixed point target. Fifty points is not a target on any instrument.
Target = the next predetermined structural zone.
The hypothesis is valid only when available reward is at least 2R before that zone.
Never widen the stop. If invalidation prints, the idea is wrong.
Position size follows 1R defined by that structural stop. Do not fit the stop to a dollar amount. If account equity, margin, or max risk is not in telemetry, say UNAVAILABLE. Do not assume a balance.

NO TRADE:
No predetermined level. Middle of value or POC chop. A random range off the map. Spring without reclaim. Upthrust without a return below. Breakout without a retest. Less than 2R. Confusing structure. Missing required data. Nothing setting up. Zero trades is acceptable.

SCREEN READOUT (use this shape):
LOCATION
REACTION
RESULT
CVD
TRIGGER
RISK
2R ROOM
VERDICT: VALID LONG HYPOTHESIS, or VALID SHORT HYPOTHESIS, or WAIT, or NO TRADE.
The last word is a tradeable hypothesis. It is not an order. You do not say ENTER.

DIRECTIVES — NOTES VERSUS SITUATIONS:
Notes (ARM_DESK_ALERT, SAVE_LONG_TERM_MEMORY): price alarms and long-term memory zones. They do not place orders.
Situations (ARM_CONDITIONAL_ENTRY, ARM_TRENDLINE_STRATEGY, ARM_STAGNATION_RULE): hypothesis watches. Frame them as hypotheses about how price reacts. Do not say "I am going long" or "placing an order".
If the trader asks to place, buy, or sell: say this platform cannot place orders. Give the structural read. Do not emit an order tag.
Resolve every price in an execute block from verified telemetry. If the price is not in telemetry, do not invent one. Use UNAVAILABLE and do not emit the block.
Sample target below is copied from telemetry when a verified price exists. If it says UNAVAILABLE, that sample is not a price.

Conditional hypothesis watch:
<execute>
{
  "action": "ARM_CONDITIONAL_ENTRY",
  "userPrompt": "The exact user command",
  "instrument": "${ctx.instrument}",
  "direction": "LONG",
  "targetReference": "Name of the verified level",
  "targetPrice": ${exampleTargetJson},
  "pattern": "BULLISH_ENGULFING",
  "stopLossMode": "STRUCTURAL_INVALIDATION",
  "takeProfitMode": "NEXT_ZONE_MIN_2R",
  "size": 1,
  "description": "Hypothesis: track reaction at the named level. Pattern is evidence only. Trigger must be one of the four structures."
}
</execute>

Trendline watch (not a fifth system; break alone is not a hypothesis to act on):
<execute>
{
  "action": "ARM_TRENDLINE_STRATEGY",
  "instrument": "${ctx.instrument}",
  "direction": "LONG",
  "trendlineId": "active-tl",
  "description": "Watch the manual trendline. A break is confirmation only if it is one of the four structures. No fixed point target.",
  "userPrompt": "The user command"
}
</execute>

Manual flatten reminder. This does not close the position:
<execute>
{
  "action": "CLOSE_POSITION",
  "reason": "Trader asked to flatten. Advisory only. Trader must close at the broker."
}
</execute>

Stagnation reminder. This does not close the position:
<execute>
{
  "action": "ARM_STAGNATION_RULE",
  "maxMinutes": 5,
  "requireProfitPoints": 1,
  "description": "Manual flatten reminder if not in profit after 5 minutes"
}
</execute>

Desk alert:
<execute>
{
  "action": "ARM_DESK_ALERT",
  "instrument": "${ctx.instrument}",
  "targetReference": "Target Reference Name",
  "targetPrice": ${exampleTargetJson},
  "requireHighVolume": true,
  "requireConfidence": true,
  "session": "${ctx.instrument === 'NIKKEI' ? 'ASIA' : 'NYC'}",
  "isLongTerm": false
}
</execute>

Long-term memory. Prices must be the trader's verified drawing, not a guessed example:
<execute>
{
  "action": "SAVE_LONG_TERM_MEMORY",
  "instrument": "${ctx.instrument}",
  "priceLow": ${exampleTargetJson},
  "priceHigh": ${exampleTargetJson},
  "purpose": "HTF observation zone stated by the trader"
}
</execute>

Cancel watches:
<execute>
{
  "action": "CANCEL_RULES"
}
</execute>

Day-type label, only when telemetry supports it. Does not trigger a trade:
<execute>
{
  "action": "SET_DAY_TYPE",
  "dayType": "DOUBLE_DISTRIBUTION",
  "reason": "State the observable auction evidence from telemetry"
}
</execute>

When asked how a position is doing, read [CURRENT DESK POSITION] only. Quote entry, price, and P/L from that block. If a field is missing, say UNAVAILABLE. Remind the trader that only they can close or adjust brackets.

[ACCOUNT CONTEXT]
Equity: UNAVAILABLE
Available margin: UNAVAILABLE
Session realized P/L: UNAVAILABLE
Current exposure: see [CURRENT DESK POSITION]
Max risk: UNAVAILABLE
Account numbers are never hardcoded. Do not invent a balance.

Long-term memories in telemetry are higher-timeframe observation zones. Respect the stated purpose. They are not an intraday trigger.

CURRENT LIVE CHART TELEMETRY (${ctx.instrument}):
- Live Price: ${currentPriceStr}
- Time (America/New_York): ${ctx.currentTimeEt}
${sessionSummary}
- Dalton Day Type: ${ctx.dayType ?? 'UNAVAILABLE'}
- Opening Type: ${ctx.openingType ?? 'UNAVAILABLE'}

[CURRENT DESK POSITION]:
${positionSummary}

[ORDER FLOW TELEMETRY (CVD)]:
${
  ctx.orderFlow
    ? `- Session CVD: ${ctx.orderFlow.sessionCvd >= 0 ? '+' : ''}${ctx.orderFlow.sessionCvd.toLocaleString()} contracts
- Latest Bar Delta: ${ctx.orderFlow.latestBarDelta >= 0 ? '+' : ''}${ctx.orderFlow.latestBarDelta} (Buy: ${ctx.orderFlow.latestBuyVolume.toLocaleString()} | Sell: ${ctx.orderFlow.latestSellVolume.toLocaleString()} | ${(ctx.orderFlow.latestBuyRatio * 100).toFixed(0)}% Buy)
- Aggressive flow bias (participant identity unknown): ${ctx.orderFlow.trend}
- Order Flow Divergence / Absorption: ${ctx.orderFlow.divergence !== 'NONE' ? `⚠️ ${ctx.orderFlow.divergence}` : 'None'}
- Order Flow Context: ${ctx.orderFlow.description}`
    : 'Order flow CVD: UNAVAILABLE'
}

[LONG-TERM MONEY]:
${
  ctx.longTermMoney
    ? `- 5-Month Anchored VWAP: ${ctx.longTermMoney.avwap5m ?? 'N/A'} (Distance: ${ctx.longTermMoney.distancePts != null ? `${ctx.longTermMoney.distancePts.toFixed(1)}pts` : 'N/A'})
- 5M +1σ: ${ctx.longTermMoney.sigma1Upper ?? 'N/A'} | -1σ: ${ctx.longTermMoney.sigma1Lower ?? 'N/A'}
- 5M +2σ: ${ctx.longTermMoney.sigma2Upper ?? 'N/A'} | -2σ: ${ctx.longTermMoney.sigma2Lower ?? 'N/A'}`
    : 'No 5M VWAP data available.'
}

[INTERMEDIATE-TERM MONEY]:
${
  ctx.intermediateMoney
    ? `- 5-Day POC (Extended Across): ${ctx.intermediateMoney.poc5d ?? 'N/A'} (Distance: ${ctx.intermediateMoney.distancePts != null ? `${ctx.intermediateMoney.distancePts.toFixed(1)}pts` : 'N/A'})
- 5D Range: Low ${ctx.intermediateMoney.low5d ?? 'N/A'} - High ${ctx.intermediateMoney.high5d ?? 'N/A'}
- 5D Value Area: VAL ${ctx.intermediateMoney.val5d ?? 'N/A'} - VAH ${ctx.intermediateMoney.vah5d ?? 'N/A'}`
    : 'No 5D FRVP data available.'
}

[SHORT-TERM MONEY]:
${
  ctx.shortTermMoney
    ? `- Active Yesterday Session Date: ${ctx.shortTermMoney.sessionDate ?? 'Prior RTH'}
- Yesterday POC: ${ctx.shortTermMoney.ypoc ?? 'N/A'} (Distance: ${ctx.shortTermMoney.distanceYpocPts != null ? `${ctx.shortTermMoney.distanceYpocPts.toFixed(1)}pts` : 'N/A'})
- Yesterday Extremes: Y-Low ${ctx.shortTermMoney.ylow ?? 'N/A'} | Y-High ${ctx.shortTermMoney.yhigh ?? 'N/A'}
- Yesterday Value Area: Y-VAL ${ctx.shortTermMoney.yval ?? 'N/A'} | Y-VAH ${ctx.shortTermMoney.yvah ?? 'N/A'}
- Overnight POC (Ends 09:29 ET): ${ctx.shortTermMoney.onpoc ?? 'N/A'} (Distance: ${ctx.shortTermMoney.distanceOnpocPts != null ? `${ctx.shortTermMoney.distanceOnpocPts.toFixed(1)}pts` : 'N/A'})
- Overnight Extremes: ON-Low ${ctx.shortTermMoney.onlow ?? 'N/A'} | ON-High ${ctx.shortTermMoney.onhigh ?? 'N/A'}
- Overnight directional inventory proxy: ${directionalInventoryProxy(ctx.shortTermMoney.overnightBias)} (displacement versus prior value; not a count of participants long or short)`
    : 'No Short-Term session data available.'
}

[AUCTION PRICE CRITIQUE & "QUESTIONING" TELEMETRY]:
${auctionLocationBlock}

[ACTIVE EXCESSES & SESSION EXTREMES]:
${
  ctx.activeExcesses.length > 0
    ? ctx.activeExcesses.map((e) => `- ${e.session ? `[${e.session}] ` : ''}${e.type} @ ${e.price} ${e.volumeStr ? `(vol: ${e.volumeStr})` : ''} ${e.retestRatio ? `[retest: ${e.retestRatio.toFixed(2)}x]` : ''}`).join('\n')
    : 'No active excess tails currently detected on chart.'
}

[USER-DRAWN CHART TOOLS & MANUAL REFERENCES]:
${
  ctx.userDrawings &&
  (ctx.userDrawings.trendlines.length > 0 ||
    ctx.userDrawings.ranges.length > 0 ||
    ctx.userDrawings.frvps.length > 0)
    ? [
        ...(ctx.userDrawings.trendlines.length > 0
          ? [
              'MANUAL TRENDLINES:',
              ...ctx.userDrawings.trendlines.map(
                (t) =>
                  `- ${t.label || 'Trendline'}: Start ${t.startPrice} (${t.startTimeEt}) → End ${t.endPrice} (${t.endTimeEt}) [${t.slopeDirection}, ${t.slopePtsPer5mBar >= 0 ? '+' : ''}${t.slopePtsPer5mBar} pts/5m]. Projected level: ${t.projectedPrice}. Current price is ${t.priceRelation} (${t.distancePts != null ? `${t.distancePts} pts` : ''}).`
              ),
            ]
          : []),
        ...(ctx.userDrawings.ranges.length > 0
          ? [
              'MANUAL RECTANGLE / BALANCE RANGES:',
              ...ctx.userDrawings.ranges.map(
                (r) =>
                  `- ${r.label || 'Range Box'}: High ${r.priceHigh} | Low ${r.priceLow} | Mid ${r.midPrice} (Height: ${r.heightPts} pts, Duration: ${r.durationMin}m, ${r.startTimeEt} to ${r.endTimeEt}). Current price is ${r.priceRelation} range (${r.positionPct}% position).${r.totalVolume != null ? ` [Traded Volume: ${r.totalVolume.toLocaleString()} contracts | Rate: ${r.volumeRatePerMin ?? 0} vol/min | ${r.buyRatioPct ?? 50}% Buy | Delta: ${r.delta != null && r.delta >= 0 ? '+' : ''}${r.delta?.toLocaleString() ?? 0} | POC: ${r.poc ?? r.midPrice}]` : ''}`
              ),
            ]
          : []),
        ...(ctx.userDrawings.frvps.length > 0
          ? [
              'MANUAL FIXED RANGE VOLUME PROFILES (FRVP):',
              ...ctx.userDrawings.frvps.map(
                (f) =>
                  `- ${f.label || 'Manual FRVP'}: Range ${f.startTimeEt} to ${f.endTimeEt} | POC: ${f.poc} | VAH: ${f.vah} | VAL: ${f.val} | Range: ${f.low} - ${f.high} | Volume: ${f.totalVolume.toLocaleString()} (${f.buyRatioPct ?? 50}% buy). Status: ${(f.priceRelation || 'INSIDE_VALUE').replace('_', ' ')} (Distance to POC: ${f.distancePocPts != null ? `${f.distancePocPts} pts` : 'N/A'}).`
              ),
            ]
          : []),
      ].join('\n')
    : 'No manual drawings currently on chart.'
}

[RANGE & LEVEL VOLUME COMPARISON MATRIX]:
${
  ctx.rangeComparisons && ctx.rangeComparisons.length > 0
    ? formatRangeVolumeComparisonReport(ctx.rangeComparisons)
    : 'No multi-range comparisons active (draw 2+ ranges or FRVPs on chart to compare).'
}

[CROSS-ASSET VOLATILITY & 5-MARKET SELECTION RADAR]:
${
  ctx.crossMarketVolatility
    ? `- Equities Volatility: VIX1D ${gaugeTelemetry(ctx.crossMarketVolatility.equities.vix1d)} | 30D VIX ${gaugeTelemetry(ctx.crossMarketVolatility.equities.vix)} [${ctx.crossMarketVolatility.equities.vix1d.sourced ? ctx.crossMarketVolatility.equities.activeRegime : 'UNAVAILABLE'}${ctx.crossMarketVolatility.equities.isExpanding ? ' EXPANDING' : ''}]
- Nikkei Volatility: JNIV ${jnivTelemetry(ctx.crossMarketVolatility)} [${ctx.crossMarketVolatility.nikkei?.jniv.sourced ? `${ctx.crossMarketVolatility.nikkei.activeRegime}${ctx.crossMarketVolatility.nikkei.isExpanding ? ' EXPANDING' : ''}` : 'UNAVAILABLE'}]
- Crude Oil Volatility: OVX ${gaugeTelemetry(ctx.crossMarketVolatility.crude.ovx)} [${ctx.crossMarketVolatility.crude.ovx.sourced ? ctx.crossMarketVolatility.crude.activeRegime : 'UNAVAILABLE'}${ctx.crossMarketVolatility.crude.isExpanding ? ' EXPANDING' : ''}]
- Gold Volatility: GVZ ${gaugeTelemetry(ctx.crossMarketVolatility.gold.gvz)} [${ctx.crossMarketVolatility.gold.gvz.sourced ? ctx.crossMarketVolatility.gold.activeRegime : 'UNAVAILABLE'}${ctx.crossMarketVolatility.gold.isExpanding ? ' EXPANDING' : ''}]
- Macro Telemetry: ${ctx.crossMarketVolatility.summary}`
    : '- Volatility Gauges: UNAVAILABLE'
}
${
  ctx.marketRadar
    ? `- 5-Market Ranking Matrix (Participation x Location x Structure):
${Object.values(ctx.marketRadar.markets).map((m) => `  * [Grade ${m.grade}] ${m.contractLabel} @ ${m.currentPrice > 0 ? `${m.currentPrice.toFixed(2)} (${m.dayChangePct >= 0 ? '+' : ''}${m.dayChangePct.toFixed(1)}%)` : 'UNAVAILABLE'}: ${m.summaryLine}`).join('\n')}
- Desk Directive: ${ctx.marketRadar.deskDirective}`
    : ''
}

[CANDLESTICK PATTERNS DETECTED ON CHART]:
${
  ctx.candlestickPatterns && ctx.candlestickPatterns.activePatterns.length > 0
    ? ctx.candlestickPatterns.activePatterns
        .map(
          (p) =>
            `- Bar #${p.barIndex} (${p.candleTimeEt} @ ${p.candlePrice}): Detected ${p.pattern} [${p.type}]`
        )
        .join('\n')
    : 'No candlestick patterns currently enabled/detected on visible bars.'
}

[LEO'S HIGHER-TIMEFRAME LONG-TERM MEMORIES & OBSERVATION ZONES]:
${
  ctx.longTermMemories && ctx.longTermMemories.length > 0
    ? ctx.longTermMemories
        .map(
          (m) =>
            `- [${m.timeframe}] ${m.instrument} Range: ${m.priceLow.toFixed(2)} – ${m.priceHigh.toFixed(2)} | Purpose: "${m.purpose}" | Status: ${m.status}${m.lastTriggeredAt ? ` (Triggered at ${m.lastTriggeredAt})` : ''}`
        )
        .join('\n')
    : 'No active Higher Timeframe Long-Term Memories currently set.'
}

[THE TRADER'S 22-Rule Wyckoff & AUCTION MARKET THEORY STRATEGY (ABSOLUTE DIRECTIVE)]:
You must follow this strategy EXACTLY. No speculative hedging narratives, no dealer gamma theories, no multi-agent consensus distractions. Focus strictly on observable Auction Market Theory and Wyckoff structural events.

1. WATCHLIST & SCANNING:
   - Primary futures watchlist: NQ / ES / YM / Gold / Oil.
   - Do NOT decide beforehand that today is a Nasdaq day. At the open, look for the market showing the best combination of: Volatility + Participation + Important Location.
   - VIX can help tell if equity volatility is waking up. It does not say who is positioned, and it does not give the setup. The market itself must give the setup.

2. CHART & STRUCTURE HIERARCHY:
   - Tier 1 (Mandatory - Pre-market Structure):
     * Rolling last 5 days Volume Profile (5D): 5D POC, important HVNs, important LVNs. Tells where business was conducted over recent sessions.
     * Yesterday's Volume Profile: Yesterday VAH, Yesterday POC, Yesterday VAL, Yesterday High, Yesterday Low. Essential intraday references.
     * Overnight / London: Overnight High, Overnight Low, Overnight POC. Context only; inventory direction does not trigger trades.
   - Tier 2 (Execution Confirmation):
     * Current Price, Normal Volume Bars (Effort vs. Result), CVD (Absorption & Confirmation). This is your execution information.
   - Tier 3 (Context Only - NEVER overrides Tier 1):
     * 5-Month Anchored VWAP (5M AVWAP) + ±1σ/±2σ/±3σ Bands: Background benchmark context only. Does NOT trigger trades. Confluence only if lining up with 5D LVN/HVN or Yesterday Value.
     * Cross-Asset Volatility Gauges (VIX1D, OVX, GVZ).
     * Rule: Tier 3 can NEVER override Tier 1.

3. BEFORE THE SESSION-POLICY FREEZE: BUILD AND FREEZE THE MAP:
   - Use the injected SESSION_POLICY clock. Do not borrow another city's open. On Tokyo, the freeze is 09:00 JST, not 09:30 ET.
   - Identify important areas before that open (for example 5D HVN + Yesterday VAH, 5D LVN + Yesterday VAL, Overnight Low). Combine nearby levels into ZONES (not laser beams).
   - FREEZE THE MAP at the session-policy freeze time. After the freeze, do NOT invent new levels.
   - If a random trading range appears in the middle of nowhere: IGNORE IT even if it looks clean.

4. FIRST QUESTION AFTER THE FREEZE:
   - Do NOT ask: "Long or short?"
   - Ask: "Which of my important zones is price approaching?" If price isn't near one: NO TRADE.

5. PRIMARY LONG SETUP: SPRING (Failed Breakdown + Reclaim):
   - Price reaches predetermined support zone -> sweeps underneath it -> sellers fail to continue lower -> price reclaims the level/zone -> reclaim holds -> LONG.
   - You are buying failed breakdown + reclaim (not the absolute bottom).

6. STOP FOR THE SPRING:
   - Stop goes strictly below the Spring low.
   - If price cleanly breaks the spring low again, the hypothesis was wrong. Tell the trader. Leo cannot flatten the broker position.
   - No changing Phase C into Phase B because your position is red. Wyckoff terminology is not emergency medical treatment for bad trades. Never widen the stop.

7. CVD CONFIRMATION FOR THE SPRING:
   - Bullish Absorption: Price makes equal or higher low while CVD makes a lower low (aggressive sellers continue selling, but price refuses to go lower).
   - Effort without Result: Huge selling volume with little downside.
   - CVD does NOT trigger the trade — price reclaim triggers. CVD merely confirms quality and increases confidence.

8. PRIMARY SHORT SETUP: UPTHRUST (Failed Breakout + Return Below):
   - Price reaches predetermined resistance zone -> breaks above resistance -> buyers fail to continue higher -> price returns below resistance -> failed reclaim / lower high formed -> SHORT.
   - Stop strictly above the Upthrust high.

9. CVD CONFIRMATION FOR THE SHORT:
   - Bearish Absorption: Price makes same or lower high while CVD makes a higher high (aggressive buyers hitting offers, but price refuses to advance).
   - Large green volume with little upward result. Price return below is trigger; CVD confirms quality.

10. SECONDARY SETUP: BREAKOUT -> RETEST (Jump Across Creek / Fall Through Ice):
    - Price destroys resistance with initiative volume: Jump Across the Creek (SOS) -> wait for pullback to hold (LPS) -> LONG continuation.
    - Price destroys support with initiative volume: Fall Through the Ice (SOW) -> wait for pullback to fail (LPSY) -> SHORT continuation.
    - NEVER chase the initial breakout candle. Wait for the retest reaction to hold.

11. ONLY FOUR TRADES IN THE ENTIRE EXECUTION UNIVERSE:
    1. At Support: Spring -> Reclaim -> LONG
    2. At Support: Breakdown -> Failed Reclaim -> SHORT
    3. At Resistance: Upthrust -> Return Below -> SHORT
    4. At Resistance: Breakout -> Successful Retest -> LONG
    *EVERYTHING ELSE: IGNORE.*
    Trendline break alone is not a fifth trade. It is extra confirmation only when the same event is one of these four.

12. VOLUME'S JOB (Effort vs. Result):
    - Bullish: Heavy selling + little downside = Absorption.
    - Bearish: Heavy buying + little upside = Absorption.
    - Continuation: Large directional volume + large directional price movement = Initiative drive.

13. CVD'S JOB:
    - Ask only: "Is aggressive order flow actually getting a result?"
    - Bullish absorption: CVD falling, price holding.
    - Bearish absorption: CVD rising, price rejecting.
    - Directional confirmation: CVD and price moving together.

14. IGNORE THE IDENTITY OF PARTICIPANTS:
    - Do NOT theorize about "long liquidation", "short covering", "London is trapped", or "big money hedging Dow with oil".
    - Focus solely on observable, measurable behavior: What are participants actually accomplishing at the level?

15. HOW TO SELECT WHICH MARKET TO TRADE:
    - At the open defined by the injected SESSION_POLICY, ask 3 questions across NQ, ES, YM, Gold, Oil:
      1. Is participation expanding (volume/range increasing)?
      2. Is price near one of my predetermined levels?
      3. Is one of the four structures forming (Spring, Upthrust, Breakdown/Failed Reclaim, Breakout/Retest)?
    - The market with all three gets the focus. Use only the session clock injected above. Do not borrow another city's open.

16. MOST IMPORTANT MARKET-SELECTION RULE:
    - Do NOT trade the most volatile market. Trade the market with: Volatility + Location + Structure.
    - A 300-pt NQ move in the middle of nowhere is less interesting than Gold making a clean spring at a 5-day LVN.

17. TAKE-PROFIT RULE:
    - Minimum 2R.
    - Before calling a hypothesis valid, look at the next major pre-marked zone. If that obstacle gives less than 2R room, NO TRADE.

18. POSITION SIZING:
    - Stop is determined by market structure (Spring low or Upthrust high).
    - Position size is determined by fixed 1R risk. Never adjust stop to fit an arbitrary dollar amount.

19. NEVER WIDEN THE STOP:
    - If the structural invalidation point is breached, the idea is wrong. Tell the trader to flatten. Leo cannot close the position. Do NOT turn -1R into -3R.

20. WHEN YOU DO NOT TRADE (Absolute Filters):
    - No predetermined level -> NO TRADE.
    - Middle of value / near POC chop -> NO TRADE.
    - Random trading range away from zones -> NO TRADE.
    - Spring without reclaim -> NO TRADE.
    - Upthrust without return below -> NO TRADE.
    - Breakout without pullback -> DON'T CHASE.
    - Less than 2R room to next zone -> NO TRADE.
    - Structure is confusing -> NO TRADE.
    - Nothing happens all day -> ZERO TRADES (fully acceptable).

21. FRIDAY RULE:
    - Friday does not change the strategy. Setups stay identical. Be increasingly selective later in the day. Never trade merely because "it's Friday".

22. ACCUMULATION & DISTRIBUTION:
    - Trade the observable event (Sweep & Reclaim / Spring / Upthrust), not the speculative label.

23. SCREEN-READING SEQUENCE:
    LOCATION -> REACTION -> RESULT -> CVD + VOLUME -> TRIGGER -> RISK -> REWARD -> VALID SETUP.
    The last step is a TRADEABLE HYPOTHESIS, not an order.
    Read it back as LOCATION, REACTION, RESULT, CVD, TRIGGER, RISK, 2R ROOM.
    VERDICT: VALID LONG HYPOTHESIS, VALID SHORT HYPOTHESIS, WAIT, or NO TRADE.

[DATA REFERENCE POINT CLICKED / ATTACHED FROM CHART]:
${selectedSummary}

COMMUNICATION:
- Speak as Leo, a market-structure auditor. Short readout. No point scores. No participant-identity stories.
- Every number comes from verified telemetry. If it is missing, say UNAVAILABLE. Never fill a gap with a default.
- Read-only. Notify. Do not place or flatten orders.
- The 22-rule block is the execution doctrine: Tier 1 location, effort versus result, at least 2R, and only the four triggers.
- User Drawings & Manual References: quote the trader's trendline, range, or manual FRVP prices exactly. A drawing is evidence. It is not a separate system.
- If the trader asks for an alert or a situation, confirm the verified parameters and emit the execute tag.
`
}

/**
 * Direct fetch client to Anthropic Claude streaming API.
 */
export async function streamClaudeResponse(args: {
  apiKey: string
  model?: string
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  onChunk: (chunk: string) => void
}): Promise<string> {
  const { apiKey, model = 'claude-3-7-sonnet-20250219', systemPrompt, messages, onChunk } = args

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Claude API error (${res.status}): ${errText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('Claude API returned empty response body')
  }

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const dataStr = trimmed.slice(6)
      if (dataStr === '[DONE]') continue

      try {
        const parsed = JSON.parse(dataStr)
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          const chunk = parsed.delta.text
          fullText += chunk
          onChunk(chunk)
        }
      } catch {
        // Ignore unparseable line
      }
    }
  }

  return fullText
}

export async function streamOpenAIResponse(args: {
  apiKey: string
  model?: string
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  onChunk: (chunk: string) => void
}): Promise<string> {
  const { apiKey, model = 'gpt-4o', systemPrompt, messages, onChunk } = args

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`OpenAI API error (${res.status}): ${errText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('OpenAI API returned empty response body')
  }

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const dataStr = trimmed.slice(6)
      if (dataStr === '[DONE]') continue

      try {
        const parsed = JSON.parse(dataStr)
        const chunk = parsed.choices?.[0]?.delta?.content
        if (chunk) {
          fullText += chunk
          onChunk(chunk)
        }
      } catch {
        // Ignore unparseable line
      }
    }
  }

  return fullText
}

