/**
 * Market Situations & Leo Rules Central Manager
 *
 * Provides typed storage, rich condition organization, explicit dating/timestamps,
 * session lifecycle tracking, and cross-tab synchronization for all situations
 * and conditional rules evaluated per market by Leo.
 */

import { isArmedRuleExpired } from '@/lib/trading/sessionGate'

export type MarketInstrument = 'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE'

export const ALL_MARKETS: MarketInstrument[] = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE']

export type RuleType =
  | 'CONDITIONAL_ENTRY'
  | 'DESK_ALERT'
  | 'TELEGRAM_ALERT'
  | 'STAGNATION_TIMEOUT'
  | 'MARKET_SITUATION'
  | 'TRENDLINE_BREAKOUT_SYSTEMATIC'

export function isEntrySituationRule(type: RuleType | string | null | undefined): boolean {
  return (
    type === 'CONDITIONAL_ENTRY' ||
    type === 'MARKET_SITUATION' ||
    type === 'TRENDLINE_BREAKOUT_SYSTEMATIC'
  )
}

export type RuleStatus =
  | 'ARMED'
  | 'TRIGGERED'
  | 'EXECUTED'
  | 'SATISFIED'
  | 'CANCELLED'
  | 'EXPIRED'

export type TradeDirection = 'LONG' | 'SHORT'

export type PricePattern =
  | 'BULLISH_ENGULFING'
  | 'BEARISH_ENGULFING'
  | 'HAMMER'
  | 'INVERTED_HAMMER'
  | 'SHOOTING_STAR'
  | 'REJECTION_TAIL'
  | 'LEVEL_TOUCH'
  | 'SWEEP_REVERSAL'
  | 'ABSORPTION_REVERSAL'
  | 'BREAKOUT_RETEST'
  | 'MOMENTUM_EXPANSION'
  | 'TRENDLINE_BREAKOUT_5M'

export interface ArmedRuleCondition {
  targetReference?: string
  targetPrice?: number
  pattern?: PricePattern | string
  entryTimeframe?: number | string
  cvdDivergence?: boolean
  requireHighVolume?: boolean
  requireConfidence?: boolean
  stopLossMode?: 'BELOW_CANDLE_LOW' | 'ABOVE_CANDLE_HIGH' | 'FIXED_POINTS' | 'DOLLARS_50' | string
  stopLoss?: number
  takeProfitMode?: '1:1' | '1:2' | '1:3' | '1:5' | 'FIXED_POINTS' | string
  takeProfit?: number
  riskReward?: string
  size?: number
  maxMinutes?: number
  requireProfitPoints?: number
  trendlineId?: string
  borningZoneScore?: number
  borningZoneGrade?: string
  higherLowCount?: number
  dynamicSlope?: number
  dynamicExitArmed?: boolean
  minBreakoutTime?: number
}

export interface RuleConditionProgress {
  levelReached?: boolean
  levelReachedAt?: number
  levelReachedPrice?: number
  patternConfirmed?: boolean
  patternConfirmedAt?: number
  patternName?: string
  cvdConfirmed?: boolean
  cvdConfirmedAt?: number
  volumeConfirmed?: boolean
  volumeConfirmedAt?: number
  timeframeConfirmed?: boolean
  sessionConfirmed?: boolean
  trendlineCrossed?: boolean
  trendlineCrossedAt?: number
  bar5mCloseConfirmed?: boolean
  bar5mCloseConfirmedAt?: number
  borningZoneInitiated?: boolean
  borningZoneScore?: number
  borningZoneGrade?: string
  higherLowsCount?: number
  stallingPenaltyActive?: boolean
  dynamicTrendlineExitTriggered?: boolean
  chopShieldActive?: boolean
  chopShieldThreshold?: number
}

export interface ArmedRule {
  id: string
  type: RuleType
  description: string
  userPrompt?: string
  instrument: MarketInstrument
  direction?: TradeDirection
  conditions: ArmedRuleCondition
  conditionProgress?: RuleConditionProgress
  /** Legacy flat fields for backwards compatibility with chart engine */
  targetReference?: string
  targetPrice?: number
  pattern?: string
  stopLossMode?: string
  stopLoss?: number
  takeProfitMode?: string
  takeProfit?: number
  riskReward?: string
  size?: number
  maxMinutes?: number
  requireHighVolume?: boolean
  requireConfidence?: boolean
  trendlineId?: string
  borningZoneScore?: number
  borningZoneGrade?: string
  higherLowCount?: number
  dynamicSlope?: number
  /** Session validity: NYC / Asia / London / 24H */
  session?: string
  isLongTerm?: boolean
  /** Explicit Date & Time Metadata */
  createdAt: number
  createdDateFormatted?: string
  sessionDate?: string
  sessionTime?: string
  status: RuleStatus
  executedAt?: number
  executedPrice?: number
  lastEvaluatedAt?: number
  notes?: string
}

/** Formats a timestamp into human-readable date, time, and session parts */
export function formatRuleDate(timestamp: number): {
  formatted: string
  sessionDate: string
  sessionTime: string
  relative: string
} {
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) {
    return {
      formatted: 'Unknown Date',
      sessionDate: 'Unknown',
      sessionTime: 'Unknown',
      relative: '',
    }
  }

  const sessionDate = d.toISOString().split('T')[0] || ''
  const sessionTime = d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) + ' EDT'

  const formatted = d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ` · ${sessionTime}`

  const diffMs = Date.now() - timestamp
  const diffMin = Math.floor(diffMs / 60000)
  let relative = ''
  if (diffMin < 1) relative = 'Just now'
  else if (diffMin < 60) relative = `${diffMin}m ago`
  else {
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) relative = `${diffHr}h ago`
    else relative = `${Math.floor(diffHr / 24)}d ago`
  }

  return { formatted, sessionDate, sessionTime, relative }
}

/** Normalize raw localStorage rule data to full ArmedRule structure */
export function normalizeArmedRule(raw: any, defaultInst: MarketInstrument = 'DOW'): ArmedRule {
  const createdAt = Number(raw.createdAt) || Date.now()
  const dates = formatRuleDate(createdAt)
  const inst = (raw.instrument?.toUpperCase() || defaultInst) as MarketInstrument

  const conditions: ArmedRuleCondition = {
    targetReference: raw.conditions?.targetReference || raw.targetReference,
    targetPrice: raw.conditions?.targetPrice != null ? Number(raw.conditions.targetPrice) : raw.targetPrice != null ? Number(raw.targetPrice) : undefined,
    pattern: raw.conditions?.pattern || raw.pattern,
    entryTimeframe: raw.conditions?.entryTimeframe ?? raw.entryTimeframe ?? undefined,
    cvdDivergence: Boolean(raw.conditions?.cvdDivergence ?? raw.cvdDivergence),
    requireHighVolume: Boolean(raw.conditions?.requireHighVolume ?? raw.requireHighVolume),
    requireConfidence: Boolean(raw.conditions?.requireConfidence ?? raw.requireConfidence),
    stopLossMode: raw.conditions?.stopLossMode || raw.stopLossMode,
    stopLoss: raw.conditions?.stopLoss != null ? Number(raw.conditions.stopLoss) : raw.stopLoss != null ? Number(raw.stopLoss) : undefined,
    takeProfitMode: raw.conditions?.takeProfitMode || raw.takeProfitMode,
    takeProfit: raw.conditions?.takeProfit != null ? Number(raw.conditions.takeProfit) : raw.takeProfit != null ? Number(raw.takeProfit) : undefined,
    riskReward: raw.conditions?.riskReward || raw.riskReward,
    size: raw.conditions?.size != null ? Number(raw.conditions.size) : raw.size != null ? Number(raw.size) : 1,
    maxMinutes: raw.conditions?.maxMinutes != null ? Number(raw.conditions.maxMinutes) : raw.maxMinutes != null ? Number(raw.maxMinutes) : undefined,
    requireProfitPoints: raw.conditions?.requireProfitPoints != null ? Number(raw.conditions.requireProfitPoints) : raw.requireProfitPoints != null ? Number(raw.requireProfitPoints) : undefined,
    trendlineId: raw.conditions?.trendlineId || raw.trendlineId || undefined,
    borningZoneScore: raw.conditions?.borningZoneScore != null ? Number(raw.conditions.borningZoneScore) : raw.borningZoneScore != null ? Number(raw.borningZoneScore) : undefined,
    borningZoneGrade: raw.conditions?.borningZoneGrade || raw.borningZoneGrade || undefined,
    higherLowCount: raw.conditions?.higherLowCount != null ? Number(raw.conditions.higherLowCount) : raw.higherLowCount != null ? Number(raw.higherLowCount) : undefined,
    dynamicSlope: raw.conditions?.dynamicSlope != null ? Number(raw.conditions.dynamicSlope) : raw.dynamicSlope != null ? Number(raw.dynamicSlope) : undefined,
    dynamicExitArmed: Boolean(raw.conditions?.dynamicExitArmed ?? raw.dynamicExitArmed),
  }

  // Calculate default R:R if target, stop, and takeProfit are present
  if (!conditions.riskReward && conditions.targetPrice && conditions.stopLoss && conditions.takeProfit) {
    const risk = Math.abs(conditions.targetPrice - conditions.stopLoss)
    const reward = Math.abs(conditions.takeProfit - conditions.targetPrice)
    if (risk > 0 && reward > 0) {
      conditions.riskReward = `1:${(reward / risk).toFixed(1)}`
    }
  }

  const conditionProgress: RuleConditionProgress | undefined = raw.conditionProgress
    ? {
        levelReached: Boolean(raw.conditionProgress.levelReached),
        levelReachedAt: raw.conditionProgress.levelReachedAt ? Number(raw.conditionProgress.levelReachedAt) : undefined,
        levelReachedPrice: raw.conditionProgress.levelReachedPrice != null ? Number(raw.conditionProgress.levelReachedPrice) : undefined,
        patternConfirmed: Boolean(raw.conditionProgress.patternConfirmed),
        patternConfirmedAt: raw.conditionProgress.patternConfirmedAt ? Number(raw.conditionProgress.patternConfirmedAt) : undefined,
        patternName: raw.conditionProgress.patternName || undefined,
        cvdConfirmed: Boolean(raw.conditionProgress.cvdConfirmed),
        cvdConfirmedAt: raw.conditionProgress.cvdConfirmedAt ? Number(raw.conditionProgress.cvdConfirmedAt) : undefined,
        volumeConfirmed: Boolean(raw.conditionProgress.volumeConfirmed),
        volumeConfirmedAt: raw.conditionProgress.volumeConfirmedAt ? Number(raw.conditionProgress.volumeConfirmedAt) : undefined,
        timeframeConfirmed: Boolean(raw.conditionProgress.timeframeConfirmed),
        sessionConfirmed: Boolean(raw.conditionProgress.sessionConfirmed),
        trendlineCrossed: Boolean(raw.conditionProgress.trendlineCrossed),
        trendlineCrossedAt: raw.conditionProgress.trendlineCrossedAt ? Number(raw.conditionProgress.trendlineCrossedAt) : undefined,
        bar5mCloseConfirmed: Boolean(raw.conditionProgress.bar5mCloseConfirmed),
        bar5mCloseConfirmedAt: raw.conditionProgress.bar5mCloseConfirmedAt ? Number(raw.conditionProgress.bar5mCloseConfirmedAt) : undefined,
        borningZoneInitiated: Boolean(raw.conditionProgress.borningZoneInitiated),
        borningZoneScore: raw.conditionProgress.borningZoneScore != null ? Number(raw.conditionProgress.borningZoneScore) : undefined,
        borningZoneGrade: raw.conditionProgress.borningZoneGrade || undefined,
        higherLowsCount: raw.conditionProgress.higherLowsCount != null ? Number(raw.conditionProgress.higherLowsCount) : undefined,
        stallingPenaltyActive: Boolean(raw.conditionProgress.stallingPenaltyActive),
        dynamicTrendlineExitTriggered: Boolean(raw.conditionProgress.dynamicTrendlineExitTriggered),
      }
    : undefined

  return {
    id: String(raw.id || `rule-${createdAt}-${Math.random().toString(36).slice(2, 6)}`),
    type: (raw.type || 'CONDITIONAL_ENTRY') as RuleType,
    description: String(raw.description || 'Active Situation Rule'),
    userPrompt: raw.userPrompt || undefined,
    instrument: inst,
    direction: raw.direction === 'LONG' || raw.direction === 'SHORT' ? raw.direction : undefined,
    conditions,
    conditionProgress,
    // Keep legacy top-level mirror for chart listener
    targetReference: conditions.targetReference,
    targetPrice: conditions.targetPrice,
    pattern: conditions.pattern,
    stopLossMode: conditions.stopLossMode,
    stopLoss: conditions.stopLoss,
    takeProfitMode: conditions.takeProfitMode,
    takeProfit: conditions.takeProfit,
    riskReward: conditions.riskReward,
    size: conditions.size,
    maxMinutes: conditions.maxMinutes,
    requireHighVolume: conditions.requireHighVolume,
    requireConfidence: conditions.requireConfidence,
    trendlineId: conditions.trendlineId,
    borningZoneScore: conditions.borningZoneScore,
    borningZoneGrade: conditions.borningZoneGrade,
    higherLowCount: conditions.higherLowCount,
    dynamicSlope: conditions.dynamicSlope,
    session: raw.session || 'NYC',
    isLongTerm: Boolean(raw.isLongTerm),
    createdAt,
    createdDateFormatted: raw.createdDateFormatted || dates.formatted,
    sessionDate: raw.sessionDate || dates.sessionDate,
    sessionTime: raw.sessionTime || dates.sessionTime,
    status: (raw.status || 'ARMED') as RuleStatus,
    executedAt: raw.executedAt ? Number(raw.executedAt) : undefined,
    executedPrice: raw.executedPrice ? Number(raw.executedPrice) : undefined,
    lastEvaluatedAt: raw.lastEvaluatedAt ? Number(raw.lastEvaluatedAt) : undefined,
    notes: raw.notes || undefined,
  }
}

export interface MarketDefaultSituationParams {
  defaultPrice: number
  defaultPoints: number
}

export const MARKET_DEFAULT_PARAMS: Record<MarketInstrument, MarketDefaultSituationParams> = {
  DOW: { defaultPrice: 52218, defaultPoints: 40 },
  NASDAQ: { defaultPrice: 29448, defaultPoints: 20 },
  GOLD: { defaultPrice: 4323, defaultPoints: 5 },
  CRUDE: { defaultPrice: 101.25, defaultPoints: 0.5 },
}

/**
 * Default ready-to-fire 1:1 situations for all 4 futures markets.
 * Simple touch-only condition at current trading level with strict 1:1 risk-to-reward.
 */
export function seedDefaultMarketSituations(market: MarketInstrument, currentPrice?: number): ArmedRule[] {
  const meta = MARKET_DEFAULT_PARAMS[market] || { defaultPrice: 1000, defaultPoints: 10 }
  const now = Date.now()
  const dates = formatRuleDate(now)
  const price = currentPrice && currentPrice > 0 ? currentPrice : meta.defaultPrice
  const riskPts = meta.defaultPoints
  const entryPx = Number(price.toFixed(2))
  const slPx = Number((entryPx - riskPts).toFixed(2))
  const tpPx = Number((entryPx + riskPts).toFixed(2))

  return [
    normalizeArmedRule(
      {
        id: `sit-${market.toLowerCase()}-long-1to1-${now}`,
        type: 'MARKET_SITUATION',
        instrument: market,
        direction: 'LONG',
        description: `Long 1 ${market} on price touch at ${entryPx.toLocaleString()} with 1:1 R:R (${riskPts} pts SL / ${riskPts} pts TP)`,
        userPrompt: `When ${market} price reaches ${entryPx.toLocaleString()}, enter Long 1 contract with 1:1 risk-to-reward (Stop: ${slPx.toLocaleString()}, Target: ${tpPx.toLocaleString()})`,
        targetReference: `Market Level (${entryPx.toLocaleString()})`,
        targetPrice: entryPx,
        pattern: 'LEVEL_TOUCH',
        stopLossMode: 'FIXED_POINTS',
        stopLoss: slPx,
        takeProfitMode: '1:1',
        takeProfit: tpPx,
        riskReward: '1:1',
        size: 1,
        isLongTerm: true,
        session: '24H',
        createdAt: now,
        createdDateFormatted: dates.formatted,
        sessionDate: dates.sessionDate,
        sessionTime: dates.sessionTime,
        status: 'ARMED',
        conditions: {
          targetReference: `Market Level (${entryPx.toLocaleString()})`,
          targetPrice: entryPx,
          pattern: 'LEVEL_TOUCH',
          stopLossMode: 'FIXED_POINTS',
          stopLoss: slPx,
          takeProfitMode: '1:1',
          takeProfit: tpPx,
          riskReward: '1:1',
          size: 1,
        },
      },
      market
    ),
  ]
}

/** Legacy alias for backwards compatibility */
export function seedDefaultNasdaqSituations(currentPrice: number = 29450): ArmedRule[] {
  return seedDefaultMarketSituations('NASDAQ', currentPrice)
}

/**
 * Arm a 1:1 situation immediately for any market at a given price (or current market price).
 * Persists to localStorage and broadcasts update so chart and dashboard reflect it instantly.
 */
export function armMarketOneToOneSituation(
  market: MarketInstrument,
  options?: {
    price?: number
    direction?: TradeDirection
    points?: number
  }
): ArmedRule {
  const meta = MARKET_DEFAULT_PARAMS[market] || { defaultPrice: 1000, defaultPoints: 10 }
  const now = Date.now()
  const dates = formatRuleDate(now)
  const dir = options?.direction || 'LONG'
  const entryPx = options?.price && options.price > 0 ? Number(options.price.toFixed(2)) : meta.defaultPrice
  const pts = options?.points && options.points > 0 ? options.points : meta.defaultPoints

  const slPx = dir === 'LONG' ? Number((entryPx - pts).toFixed(2)) : Number((entryPx + pts).toFixed(2))
  const tpPx = dir === 'LONG' ? Number((entryPx + pts).toFixed(2)) : Number((entryPx - pts).toFixed(2))

  const newRule = normalizeArmedRule(
    {
      id: `sit-${market.toLowerCase()}-${dir.toLowerCase()}-1to1-${now}`,
      type: 'MARKET_SITUATION',
      instrument: market,
      direction: dir,
      description: `${dir === 'LONG' ? 'Long' : 'Short'} 1 ${market} on price touch at ${entryPx.toLocaleString()} with 1:1 R:R (${pts} pts SL / ${pts} pts TP)`,
      userPrompt: `When price touches ${entryPx.toLocaleString()}, enter ${dir} with 1:1 risk-to-reward (Stop: ${slPx.toLocaleString()}, Target: ${tpPx.toLocaleString()})`,
      targetReference: `Live Market Level (${entryPx.toLocaleString()})`,
      targetPrice: entryPx,
      pattern: 'LEVEL_TOUCH',
      stopLossMode: 'FIXED_POINTS',
      stopLoss: slPx,
      takeProfitMode: '1:1',
      takeProfit: tpPx,
      riskReward: '1:1',
      size: 1,
      isLongTerm: true,
      session: '24H',
      createdAt: now,
      createdDateFormatted: dates.formatted,
      sessionDate: dates.sessionDate,
      sessionTime: dates.sessionTime,
      status: 'ARMED',
      conditions: {
        targetReference: `Live Market Level (${entryPx.toLocaleString()})`,
        targetPrice: entryPx,
        pattern: 'LEVEL_TOUCH',
        stopLossMode: 'FIXED_POINTS',
        stopLoss: slPx,
        takeProfitMode: '1:1',
        takeProfit: tpPx,
        riskReward: '1:1',
        size: 1,
      },
    },
    market
  )

  const existing = loadRulesForMarket(market)
  const updated = [newRule, ...existing.filter((r) => r.id !== newRule.id)]
  saveRulesForMarket(market, updated)
  return newRule
}

/** Legacy alias for backwards compatibility */
export function armNasdaqOneToOneSituation(options?: {
  price?: number
  direction?: TradeDirection
  points?: number
}): ArmedRule {
  return armMarketOneToOneSituation('NASDAQ', options)
}

/** Load rules for a specific market */
export function loadRulesForMarket(market: MarketInstrument): ArmedRule[] {
  if (typeof window === 'undefined') {
    return seedDefaultMarketSituations(market)
  }
  try {
    const raw = localStorage.getItem(`leo_armed_rules_${market}`)
    if (!raw) {
      const seeded = seedDefaultMarketSituations(market)
      saveRulesForMarket(market, seeded)
      return seeded
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seeded = seedDefaultMarketSituations(market)
      saveRulesForMarket(market, seeded)
      return seeded
    }
    return parsed.map((r) => {
      const normalized = normalizeArmedRule(r, market)
      if (normalized.status === 'ARMED' && isArmedRuleExpired(normalized)) {
        return { ...normalized, status: 'EXPIRED' as const }
      }
      return normalized
    })
  } catch {
    return []
  }
}

/** Load all rules across all 4 markets */
export function loadAllRules(): Record<MarketInstrument, ArmedRule[]> {
  const result: Record<MarketInstrument, ArmedRule[]> = {
    DOW: [],
    NASDAQ: [],
    GOLD: [],
    CRUDE: [],
  }
  for (const m of ALL_MARKETS) {
    result[m] = loadRulesForMarket(m)
  }
  return result
}

/** Save rules for a specific market and dispatch sync events */
export function saveRulesForMarket(market: MarketInstrument, rules: ArmedRule[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`leo_armed_rules_${market}`, JSON.stringify(rules))
    broadcastRuleUpdate(market)
  } catch (err) {
    console.error(`Failed to save rules for ${market}:`, err)
  }
}

/** Add a new situation or rule with explicit dating and structured conditions */
export function addRule(
  data: Partial<ArmedRule> & { instrument: MarketInstrument; description: string }
): ArmedRule {
  const createdAt = data.createdAt || Date.now()
  const dates = formatRuleDate(createdAt)
  const normalized = normalizeArmedRule({
    ...data,
    createdAt,
    createdDateFormatted: dates.formatted,
    sessionDate: dates.sessionDate,
    sessionTime: dates.sessionTime,
    status: data.status || 'ARMED',
  }, data.instrument)

  const existing = loadRulesForMarket(data.instrument)
  const updated = [normalized, ...existing.filter((r) => r.id !== normalized.id)]
  saveRulesForMarket(data.instrument, updated)
  return normalized
}

/** Update status or fields of an existing rule */
export function updateRule(
  instrument: MarketInstrument,
  ruleId: string,
  updater: Partial<ArmedRule>
): void {
  const current = loadRulesForMarket(instrument)
  const updated = current.map((r) => {
    if (r.id !== ruleId) return r
    return normalizeArmedRule({ ...r, ...updater }, instrument)
  })
  saveRulesForMarket(instrument, updated)
}

/** Re-arm an expired, cancelled, or triggered rule with a new timestamp */
export function rearmRule(instrument: MarketInstrument, ruleId: string): void {
  const current = loadRulesForMarket(instrument)
  const now = Date.now()
  const dates = formatRuleDate(now)
  const updated = current.map((r) => {
    if (r.id !== ruleId) return r
    return normalizeArmedRule({
      ...r,
      status: 'ARMED',
      createdAt: now,
      createdDateFormatted: dates.formatted,
      sessionDate: dates.sessionDate,
      sessionTime: dates.sessionTime,
      executedAt: undefined,
      executedPrice: undefined,
    }, instrument)
  })
  saveRulesForMarket(instrument, updated)
}

/** Delete a rule by ID */
export function deleteRule(instrument: MarketInstrument, ruleId: string): void {
  const current = loadRulesForMarket(instrument)
  const updated = current.filter((r) => r.id !== ruleId)
  saveRulesForMarket(instrument, updated)
}

/** Clear all rules for a market */
export function clearMarketRules(instrument: MarketInstrument): void {
  saveRulesForMarket(instrument, [])
}

/** Trigger cross-tab and cross-component synchronization events */
export function broadcastRuleUpdate(market?: MarketInstrument): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('leo-rules-updated', { detail: { market } }))
  } catch {
    /* ignore */
  }
}

/** Subscribe to rule update events */
export function listenToRuleUpdates(callback: (market?: MarketInstrument) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => {
    const custom = e as CustomEvent
    callback(custom.detail?.market)
  }
  const storageHandler = (e: StorageEvent) => {
    if (e.key && e.key.startsWith('leo_armed_rules_')) {
      const inst = e.key.replace('leo_armed_rules_', '') as MarketInstrument
      callback(inst)
    }
  }
  window.addEventListener('leo-rules-updated', handler)
  window.addEventListener('storage', storageHandler)
  return () => {
    window.removeEventListener('leo-rules-updated', handler)
    window.removeEventListener('storage', storageHandler)
  }
}
