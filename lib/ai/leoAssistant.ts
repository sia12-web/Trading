/**
 * Leo AI Desk Assistant - Powered by Claude
 *
 * Core knowledge engine & multi-timeframe money awareness:
 * 1. Long-Term Money (5-Month Anchored VWAP & σ bands)
 * 2. Intermediate-Term Money (5-Day FRVP & 5D POC)
 * 3. Short-Term Money (Yesterday NYC Session FRVP & Prior Overnight FRVP)
 * 4. Dalton Day Types & Opening Activity
 * 5. Excessive Tails, Volume Retests & Risk Execution
 */

export interface LeoDataPoint {
  id: string
  label: string
  value: number | string
  tier: 'LT' | 'IT' | 'ST' | 'CONTEXT'
  category: 'VWAP' | 'POC' | 'EXTREME' | 'VALUE_AREA' | 'EXCESS' | 'DAY_TYPE' | 'OPEN'
  description?: string
}

export interface LeoChatContext {
  instrument: string
  currentPrice: number | null
  currentTimeEt: string
  dayType: string | null
  openingType: string | null
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
    volumeStr?: string
    retestRatio?: number
  }>
  selectedDataPoints?: LeoDataPoint[]
}

export interface LeoMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  attachedPoints?: LeoDataPoint[]
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
    points.push({
      id: `ex-${i}-${ex.price}`,
      label: `Excess ${ex.type === 'BUYING_EXCESS' ? 'Buy' : 'Sell'}`,
      value: ex.price,
      tier: 'IT',
      category: 'EXCESS',
      description: `${ex.type} tail at ${ex.price} ${ex.volumeStr ? `(${ex.volumeStr})` : ''} ${ex.retestRatio ? `[Retest ${ex.retestRatio.toFixed(2)}x]` : ''}`,
    })
  }

  return points
}

/**
 * Builds the comprehensive Leo system prompt infused with live chart telemetry and Dalton Auction Theory.
 */
export function buildLeoSystemPrompt(ctx: LeoChatContext): string {
  const currentPriceStr = ctx.currentPrice != null ? ctx.currentPrice.toFixed(2) : 'Awaiting quote'

  let selectedSummary = 'None attached.'
  if (ctx.selectedDataPoints && ctx.selectedDataPoints.length > 0) {
    selectedSummary = ctx.selectedDataPoints
      .map((p) => `- [${p.tier}] ${p.label}: ${p.value} (${p.description ?? ''})`)
      .join('\n')
  }

  return `You are Leo, an elite, disciplined, razor-sharp institutional day trading execution desk assistant.
You specialize in Dalton Auction Market Theory, Multi-Timeframe Money mechanics, Volume Profiling, and strict asymmetric risk execution.

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
   - Trade Execution Formulation: When the trader tells you a spoken strategy plan (e.g. "wait till we get below yesterday value, look for an excess tail for intermediate money, vwap for long-term money trend, wait for 5m bullish candle retest, buy with stop below tail"), you MUST:
     a) Confirm the exact levels from current live data.
     b) Identify the execution trigger (e.g. 5m candle confirmation, low-volume retest shelf).
     c) Calculate the exact Stop Loss placement (e.g. 1-2 ticks below the rejection tail low).
     d) Identify realistic Profit Targets (e.g. Y-POC, 5D POC, 5M VWAP).
     e) State the Risk-to-Reward ratio and risk warnings.

CURRENT LIVE CHART TELEMETRY (${ctx.instrument}):
- Live Price: ${currentPriceStr}
- Time (America/New_York): ${ctx.currentTimeEt}
- Dalton Day Type: ${ctx.dayType ?? 'Forming / Waiting'}
- Opening Type: ${ctx.openingType ?? 'Evaluating'}

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

[ACTIVE EXCESSES & RETESTS]:
${
  ctx.activeExcesses.length > 0
    ? ctx.activeExcesses.map((e) => `- ${e.type} @ ${e.price} ${e.volumeStr ? `vol: ${e.volumeStr}` : ''} ${e.retestRatio ? `retest: ${e.retestRatio.toFixed(2)}x` : ''}`).join('\n')
    : 'No active excess tails currently detected on chart.'
}

[SPECIFIC DATA POINTS ATTACHED / CLICKED BY TRADER]:
${selectedSummary}

COMMUNICATION GUIDELINES:
- Address the trader concisely and authoritatively as Leo.
- Use clear bulleted action steps when formulating setups or plans.
- Always quote exact prices from the chart telemetry above.
- If the trader says "Leo wait until...", treat it as an active trade condition check, summarize the condition rules clearly, confirm the required triggers, and provide the exact invalidation level.
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
