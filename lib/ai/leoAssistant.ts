/**
 * Leo AI Desk Assistant - Powered by Claude
 *
 * Core knowledge engine & multi-timeframe money awareness:
 * 1. Long-Term Money (5-Month Anchored VWAP & σ bands)
 * 2. Intermediate-Term Money (5-Day FRVP & 5D POC)
 * 3. Short-Term Money (Yesterday NYC Session FRVP & Prior Overnight FRVP)
 * 4. Dalton Day Types & Opening Activity
 * 5. Excessive Tails, Volume Retests & Risk Execution
 * 6. Real-Time Execution Rules (Stagnation Timeout & Telegram Alerts)
 */

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
  footprintSummary?: string
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
}

export interface LeoMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  attachedPoints?: LeoDataPoint[]
  directives?: LeoExecutionDirective[]
}

export type LeoOrderSide = 'LONG' | 'SHORT'

/** Orders Leo may emit when the trader explicitly asks him to execute. */
export type LeoExecutionDirective =
  | {
      action: 'CLOSE_POSITION'
      reason: string
      instrument?: string
    }
  | {
      action: 'PLACE_MARKET'
      side: LeoOrderSide
      stop: number
      target: number
      reason: string
      instrument?: string
      riskPct?: number
    }
  | {
      action: 'PLACE_LIMIT'
      side: LeoOrderSide
      limit: number
      stop: number
      target: number
      reason: string
      instrument?: string
      riskPct?: number
    }
  | {
      action: 'PLACE_STOP'
      side: LeoOrderSide
      stopEntry: number
      stop: number
      target: number
      reason: string
      instrument?: string
      riskPct?: number
    }
  | {
      action: 'SET_STOP'
      stop: number
      reason?: string
      instrument?: string
    }
  | {
      action: 'SET_TARGET'
      target: number
      reason?: string
      instrument?: string
    }
  | {
      action: 'CANCEL_WORKING'
      reason?: string
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
      action: 'ARM_TELEGRAM_ALERT'
      targetReference: string
      targetPrice: number
      requireHighVolume?: boolean
      requireConfidence?: boolean
      session?: string
      customMessage?: string
    }
  | {
      action: 'ARM_LVN_BULL_ENG_RULE'
      description?: string
      instrument?: string
    }
  | {
      action: 'CANCEL_RULES'
      ruleType?: string
    }

/**
 * Parses execution directives (<execute>{...}</execute>) emitted by Leo.
 */
export function parseLeoDirectives(text: string): LeoExecutionDirective[] {
  const directives: LeoExecutionDirective[] = []
  if (!text) return directives

  // 1. Search for <execute>...</execute> tags
  const executeRegex = /<execute>([\s\S]*?)<\/execute>/gi
  let match: RegExpExecArray | null
  while ((match = executeRegex.exec(text)) !== null) {
    const raw = match[1]?.trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.action) directives.push(item)
        }
      } else if (parsed?.action) {
        directives.push(parsed)
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
        const parsed = JSON.parse(raw)
        if (parsed?.action) directives.push(parsed)
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
      points.push({
        id: `user-tl-${t.id}`,
        label: t.label || 'Trendline',
        value: `${t.startPrice.toLocaleString()} → ${t.endPrice.toLocaleString()}`,
        tier: 'DRAWING',
        category: 'TRENDLINE',
        description: `Manual Trendline [${t.slopeDirection}]: ${t.startTimeEt} to ${t.endTimeEt} (${t.slopePtsPer5mBar >= 0 ? '+' : ''}${t.slopePtsPer5mBar} pts/5m). Price is ${t.priceRelation} (${t.distancePts != null ? `${t.distancePts} pts` : ''}).`,
      })
    }
    for (const r of ctx.userDrawings.ranges) {
      points.push({
        id: `user-range-${r.id}`,
        label: r.label || 'Range Box',
        value: `${r.priceLow.toLocaleString()} – ${r.priceHigh.toLocaleString()}`,
        tier: 'DRAWING',
        category: 'RANGE',
        description: `Manual Range: ${r.heightPts} pts span (${r.startTimeEt} to ${r.endTimeEt}, ${r.durationMin}m). Price is ${r.priceRelation} range (${r.positionPct}%).`,
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

/**
 * Builds the comprehensive Leo system prompt infused with live chart telemetry, time, session, positions, and Dalton Auction Theory.
 */
export function buildLeoSystemPrompt(ctx: LeoChatContext): string {
  const currentPriceStr = ctx.currentPrice != null ? ctx.currentPrice.toFixed(2) : 'Awaiting quote'

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

  return `You are Leo, an elite, disciplined, razor-sharp institutional day trading execution desk assistant.
You specialize in Dalton Auction Market Theory, Multi-Timeframe Money mechanics, Volume Profiling, strict asymmetric risk execution, and direct desk trade management.

THE TRADER'S SYSTEM ARCHITECTURE:
1. LONG-TERM MONEY (5-Month Anchored VWAP):
   - Anchored exactly 5 calendar months ago at cash open.
   - Provides institutional baseline benchmark and ±1σ / ±2σ standard deviation volatility bands.
   - Acceptance above/below or rejection from 5M VWAP indicates major institutional flow and macro trend bias.

2. INTERMEDIATE-TERM MONEY (5-Day Fixed Range Volume Profile - FRVP):
   - Anchored 5 completed trading days prior through current bar.
   - The 5D POC (Point of Control) is the ONLY line extended across the chart into active trading as the primary intermediate magnet.
   - Identifies multi-day balance vs excess, 5D High, 5D Low, and Value Area (VAH/VAL).

3. SHORT-TERM MONEY (Yesterday NYC Session & Prior Overnight):
   - Yesterday NYC Cash Session (09:30–16:00 ET): Computes Y-POC, Y-High, Y-Low, Y-VAH, Y-VAL. Confined strictly to yesterday.
   - US Holiday Exception: On exchange holidays (e.g. Labor Day, Memorial Day, etc.) or truncated days, the system automatically skips the holiday and anchors to the last full active RTH trading session.
   - Prior Overnight Session (18:00–09:29 ET): Computes ON-POC (stops cleanly at 09:29 AM ET), ON-High, ON-Low, and Overnight Inventory (% Long vs % Short relative to Yesterday Close).

4. DALTON DAY TYPES & OPENING CONTEXT:
   - Day Types: Non-Trend (NTREND), Non-Conviction (NCONV), Trend Day (Bull/Bear), Double Distribution, Neutral Day, Normal Day, Normal Variation Day.
   - Opening Activity: Open Auction, Open Drive, Open Test-Drive, Open Rejection-Reverse, Gap Up/Down.

5. AUCTION BEHAVIORS & TRADING RULES:
   - Excessive Tails: Rejection tails extending outside value indicate intermediate responsive money defending extremes.
   - Shelf Retests: Volume ratio < 1.0x indicates lack of opposite participation (confirmed rejection/retest). Volume ratio > 1.2x warns of absorption and potential breakout.
   - Chart Reference Point Clicking: The trader clicks directly on the chart markers/arrows (e.g. Asia High, London Low, NY extremes) to attach them. When attached, you know the exact price, session, volume, and retest ratio.

5b. CANDLESTICK PATTERNS & SPECIALIST CONFIRMATION STRATEGY:
   - System Candlestick Engine: Supports 15 Pine Script v6 Candlestick Patterns (Doji, Bullish Harami, Bearish Harami, Bullish Engulfing, Bearish Engulfing, Piercing Line, Bullish Belt, Bullish Kicker, Bearish Kicker, Hanging Man, Evening Star, Morning Star, Shooting Star, Hammer, Inverted Hammer).
   - SPECIALIST RULE: Low Volume Node (LVN) of Yesterday's FRVP + Bullish Engulfing Confirmation:
     - When price tests a Low Volume Node (LVN) or Low Volume area of Yesterday's Fixed Range Volume Profile (FRVP) / Value Area and forms a Bullish Engulfing bar ('bullEng'), this is a primary institutional confirmation.
     - EXECUTION RULE: Enter BUY on Engulfing confirmation close. Place Stop Loss cleanly below the Low of the Bullish Engulfing Bar ('SL = Bullish Engulfing Bar Low'). Targets: TP1 1.5R, TP2 2.5R (or Y-POC / VAH).
     - When the trader asks about this setup or mentions "in low volume of yesterday fix range volume profile if we see a bullish engulfing enter and put the stop loss below the bullish engulfing bar", immediately confirm the LVN level, verify the Bullish Engulfing bar, calculate the SL cleanly below the Engulfing bar low, and state the confirmation clearly!

5c. ORDER FLOW & CUMULATIVE VOLUME DELTA (CVD) CONFIRMATION:
   - CME Central Limit Order Book: Uses true CME Globex contract executions to measure institutional aggressive buyers vs aggressive sellers.
   - Bullish Absorption at Support (5D POC / Y-POC / Value Area Low / AVWAP):
     * When price trades down into a key support level but Session CVD turns positive or forms higher lows, institutions are absorbing limit sell orders. Expect a spring / bounce.
   - Bearish Exhaustion at Resistance (VAH / 5D VAH / +1σ AVWAP):
     * When price makes a new high but CVD fails to make a new high or prints negative delta, buyers are exhausted. Warn the trader of a failed auction / rejection.
   - Trend Continuation Confirmation:
     * A true breakout beyond VAH or VAL must be backed by aggressive cumulative delta (Trend: BUYER_DOMINANT or SELLER_DOMINANT). Without delta confirmation, warn of a potential look-above-and-fail.

6. CO-PILOT EXECUTION DIRECTIVES (<execute> tags):
You are **this market's Leo** (instrument = ${ctx.instrument}). Each NYC board (DOW / NASDAQ / GOLD / CRUDE) has its own Leo session — never mix books.
You are the trader's full execution partner **only when asked**. Discuss setups freely; emit <execute> **only** when the trader clearly tells you to place, arm, cancel, or flatten.
When executing, respond with the full instruction (side, entry type, price, stop, target, why) AND append one <execute> JSON block:

- MARKET entry ("Leo go long/short here", "market buy/sell"):
  <execute>
  {
    "action": "PLACE_MARKET",
    "side": "LONG",
    "stop": 0,
    "target": 0,
    "reason": "Trader asked market long at live price with stop/target stated"
  }
  </execute>
  Fill stop/target with the exact levels you confirmed (never leave 0).

- LIMIT entry ("Leo put a buy limit at X", "sell limit at Y"):
  <execute>
  {
    "action": "PLACE_LIMIT",
    "side": "LONG",
    "limit": 0,
    "stop": 0,
    "target": 0,
    "reason": "Trader asked buy limit at level"
  }
  </execute>

- STOP entry ("Leo buy stop above X", "sell stop below Y"):
  <execute>
  {
    "action": "PLACE_STOP",
    "side": "LONG",
    "stopEntry": 0,
    "stop": 0,
    "target": 0,
    "reason": "Trader asked buy stop entry"
  }
  </execute>

- Move stop / target on the open trade:
  <execute>{ "action": "SET_STOP", "stop": 0, "reason": "Trail under swing" }</execute>
  <execute>{ "action": "SET_TARGET", "target": 0, "reason": "Scale at VAH" }</execute>

- Cancel working limit/stop: <execute>{ "action": "CANCEL_WORKING", "reason": "Trader cancelled" }</execute>

- Stagnation Exit Rule ("if not in profit after X minutes close"):
  <execute>
  {
    "action": "ARM_STAGNATION_RULE",
    "maxMinutes": 5,
    "requireProfitPoints": 1,
    "description": "Close position if not in profit after 5 minutes"
  }
  </execute>
- LVN Bullish Engulfing Entry Rule: If the trader mentions "in low volume of yesterday fix range volume profile if we see a bullish engulfing enter and put the stop loss below the bullish engulfing bar":
  Confirm the strategy rule clearly and output:
  <execute>
  {
    "action": "ARM_LVN_BULL_ENG_RULE",
    "description": "Enter BUY on Bullish Engulfing at Yesterday FRVP Low Volume Node with SL below Engulfing Low"
  }
  </execute>
- Immediate Close: If the trader says "Leo close the position", "flatten", or "exit now":
  Confirm the execution and output:
  <execute>
  {
    "action": "CLOSE_POSITION",
    "reason": "Trader direct voice command"
  }
  </execute>
- Telegram Alert Rule: If the trader says "Leo if we get to this data reference [e.g. in Asia session, 5D POC, London High] and we see high volume and confidence, send me a telegram message":
  Confirm the level, session, and criteria, and output:
  <execute>
  {
    "action": "ARM_TELEGRAM_ALERT",
    "targetReference": "Target Reference Name",
    "targetPrice": 29140.0,
    "requireHighVolume": true,
    "requireConfidence": true,
    "session": "Asia"
  }
  </execute>
- Disarm / Cancel: If the trader says "cancel all rules" or "disarm":
  <execute>
  {
    "action": "CANCEL_RULES"
  }
  </execute>

CURRENT LIVE CHART TELEMETRY (${ctx.instrument}):
- Live Price: ${currentPriceStr}
- Time (America/New_York): ${ctx.currentTimeEt}
${sessionSummary}
- Dalton Day Type: ${ctx.dayType ?? 'Forming / Waiting'}
- Opening Type: ${ctx.openingType ?? 'Evaluating'}

[CURRENT DESK POSITION]:
${positionSummary}

[ORDER FLOW & FOOTPRINT TELEMETRY (CVD)]:
${
  ctx.orderFlow
    ? `- Session CVD: ${ctx.orderFlow.sessionCvd >= 0 ? '+' : ''}${ctx.orderFlow.sessionCvd.toLocaleString()} contracts
- Latest Bar Delta: ${ctx.orderFlow.latestBarDelta >= 0 ? '+' : ''}${ctx.orderFlow.latestBarDelta} (Buy: ${ctx.orderFlow.latestBuyVolume.toLocaleString()} | Sell: ${ctx.orderFlow.latestSellVolume.toLocaleString()} | ${(ctx.orderFlow.latestBuyRatio * 100).toFixed(0)}% Buy)
- Institutional Aggression Bias: ${ctx.orderFlow.trend}
- Order Flow Divergence / Absorption: ${ctx.orderFlow.divergence !== 'NONE' ? `⚠️ ${ctx.orderFlow.divergence}` : 'None'}
- Order Flow Context: ${ctx.orderFlow.description}
${ctx.orderFlow.footprintSummary ? `[INSTITUTIONAL FOOTPRINT LADDER & STACKED IMBALANCES]:\n${ctx.orderFlow.footprintSummary}` : ''}`
    : 'No order flow CVD telemetry available for active session.'
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
- Overnight Inventory Skew: ${ctx.shortTermMoney.overnightBias ?? 'Evaluating'}`
    : 'No Short-Term session data available.'
}

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
                  `- ${r.label || 'Range Box'}: High ${r.priceHigh} | Low ${r.priceLow} | Mid ${r.midPrice} (Height: ${r.heightPts} pts, Duration: ${r.durationMin}m, ${r.startTimeEt} to ${r.endTimeEt}). Current price is ${r.priceRelation} range (${r.positionPct}% position).`
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

[DATA REFERENCE POINT CLICKED / ATTACHED FROM CHART]:
${selectedSummary}

COMMUNICATION GUIDELINES:
- Address the trader concisely and authoritatively as Leo.
- Always quote exact prices from the chart telemetry above.
- User Drawings & Manual References: When the trader discusses their drawn trendline, range box, or manual FRVP, quote their exact prices and evaluate market structure using Dalton Auction Theory (acceptance vs rejection of Value, volume facilitation, rotation vs initiative breakout).
- If the trader speaks an execution or alert command, confirm the exact parameters (minutes, prices, targets) and emit the required <execute> tag.
- Keep prose concise and fast to read — institutional traders value high signal-to-noise ratio over lengthy essays.
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

