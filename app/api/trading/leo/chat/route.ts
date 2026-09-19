import { NextRequest } from 'next/server'
import {
  buildLeoSystemPrompt,
  streamClaudeResponse,
  streamOpenAIResponse,
  type LeoChatContext,
} from '@/lib/ai/leoAssistant'
import { getLatestDatabentoLiveQuote } from '@/lib/databento/liveHub'
import { detectCandlestickPatterns } from '@/lib/trading/candlestickPatterns'
import { evaluatePriceQuestioning, isPriceQuestioningSessionActive } from '@/lib/trading/priceQuestioning'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ChatRequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  chartContext: LeoChatContext
  model?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody
    const { messages, chartContext, model } = body

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Messages array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Zero-latency live market data injection for Leo
    if (chartContext) {
      // 1. Live Databento CME Globex Quote check
      const liveQuote = getLatestDatabentoLiveQuote(chartContext.instrument as any)
      if (liveQuote && Number.isFinite(liveQuote.price) && liveQuote.price > 0) {
        chartContext.currentPrice = liveQuote.price
      }

      // 2. Server-verified candlestick patterns across recent candles
      if (chartContext.recentCandles && chartContext.recentCandles.length > 0) {
        const bars = chartContext.recentCandles
        const activePatterns: Array<{
          pattern: string
          type: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
          candleTimeEt: string
          candlePrice: number
          barIndex: number
        }> = []
        const startIdx = Math.max(0, bars.length - 30)
        for (let i = startIdx; i < bars.length; i++) {
          const res = detectCandlestickPatterns(bars, i)
          const b = bars[i]!
          const timeEt = new Date(b.time * 1000).toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
          })
          if (res.bullEng) activePatterns.push({ pattern: 'Bullish Engulfing', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.bearEng) activePatterns.push({ pattern: 'Bearish Engulfing', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.hammer) activePatterns.push({ pattern: 'Hammer', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.invHammer) activePatterns.push({ pattern: 'Inverted Hammer', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.shootingStar) activePatterns.push({ pattern: 'Shooting Star', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.hangingMan) activePatterns.push({ pattern: 'Hanging Man', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.morningStar) activePatterns.push({ pattern: 'Morning Star', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.eveningStar) activePatterns.push({ pattern: 'Evening Star', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.bullHarami) activePatterns.push({ pattern: 'Bullish Harami', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.bearHarami) activePatterns.push({ pattern: 'Bearish Harami', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.buyingExcess) activePatterns.push({ pattern: 'Buying Excess Tail', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.low, barIndex: i })
          if (res.sellingExcess) activePatterns.push({ pattern: 'Selling Excess Tail', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.high, barIndex: i })
        }
        if (activePatterns.length > 0) {
          chartContext.candlestickPatterns = { activePatterns }
        }
      }
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY
    const selectedModel =
      model ||
      process.env.LLM_PROPOSER_MODEL ||
      'claude-3-7-sonnet-20250219'

    const systemPrompt = buildLeoSystemPrompt(chartContext)

    // If neither key is configured, provide heuristic response
    if (!anthropicKey && !openaiKey) {
      const fallbackResponse = buildDeskFallbackResponse(messages, chartContext)
      return new Response(
        `data: ${JSON.stringify({ text: fallbackResponse })}\n\ndata: [DONE]\n\n`,
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        }
      )
    }

    // Stream SSE response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        // 1. Try Anthropic Claude if key present
        if (anthropicKey) {
          try {
            await streamClaudeResponse({
              apiKey: anthropicKey,
              model: selectedModel,
              systemPrompt,
              messages,
              onChunk: (chunk) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
              },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          } catch {
            // Secondary Claude model attempt
            try {
              await streamClaudeResponse({
                apiKey: anthropicKey,
                model: 'claude-3-5-sonnet-20241022',
                systemPrompt,
                messages,
                onChunk: (chunk) => {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
                },
              })
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
              return
            } catch {
              // Fall through to OpenAI if available
            }
          }
        }

        // 2. Try OpenAI (GPT-4o) if available
        if (openaiKey) {
          try {
            await streamOpenAIResponse({
              apiKey: openaiKey,
              model: 'gpt-4o',
              systemPrompt,
              messages,
              onChunk: (chunk) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
              },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          } catch (openaiErr: any) {
            // Secondary OpenAI attempt with gpt-4o-mini
            try {
              await streamOpenAIResponse({
                apiKey: openaiKey,
                model: 'gpt-4o-mini',
                systemPrompt,
                messages,
                onChunk: (chunk) => {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
                },
              })
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
              return
            } catch {
              // Fall through to offline heuristic
            }
          }
        }

        // 3. Last-resort fallback
        const fallback = buildDeskFallbackResponse(messages, chartContext)
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              text: `*(Live API stream reconnecting - Desk Offline Heuristic)*\n\n${fallback}`,
            })}\n\ndata: [DONE]\n\n`
          )
        )
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message ?? 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/**
 * Deterministic institutional trade planner & execution fallback when external API is unreachable.
 */
export function buildDeskFallbackResponse(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ctx: LeoChatContext
): string {
  const lastMsg = messages[messages.length - 1]?.content ?? ''
  const lower = lastMsg.toLowerCase()
  const curPrice = ctx.currentPrice != null ? ctx.currentPrice.toFixed(2) : 'active price'
  const sessionName = ctx.sessionDetails?.sessionName ?? 'Active Session'

  // 1. Immediate close command
  if (/close\s+(the\s+)?position|flatten|exit\s+now|close\s+now/i.test(lower)) {
    return `Roger that. Executing immediate market close on ${ctx.instrument} at ${curPrice}. Flattening desk position.\n\n<execute>\n{\n  "action": "CLOSE_POSITION",\n  "reason": "Trader voice command: Close position"\n}\n</execute>`
  }

  // 2. Conditional Entry Strategy & Drawing Monitor (e.g. "monitor price for yesterday FRVP low volume node; if we see a bullish engulfing enter long...", "in low volume of yesterday fix range volume profile if we see a bullish engulfing enter")
  if (
    /\b(monitor|if\s+we\s+see|if\s+you\s+see|when\s+price|in\s+low\s+volume|low\s+volume\s+node|bullish\s+engulfing|bearish\s+engulfing|hammer|rejection\s+tail)\b/i.test(lower) &&
    /\b(enter|buy|long|sell|short)\b/i.test(lower)
  ) {
    const isShort = /\b(sell|short)\b/i.test(lower)
    const direction: 'LONG' | 'SHORT' = isShort ? 'SHORT' : 'LONG'
    
    let inst = ctx.instrument || 'NASDAQ'
    if (/\bdow\b|ym/i.test(lower)) inst = 'DOW'
    else if (/\bnasdaq\b|nq/i.test(lower)) inst = 'NASDAQ'
    else if (/\bgold\b|gc/i.test(lower)) inst = 'GOLD'
    else if (/\bcrude\b|oil|cl/i.test(lower)) inst = 'CRUDE'

    // Only assign a candlestick pattern if the user actually mentioned one.
    // If they just said "buy above this level" with no pattern language → LEVEL_TOUCH.
    const userMentionedPattern =
      /bullish\s+engulfing|bearish\s+engulfing|hammer|shooting\s*star|rejection\s*(tail|wick)|level\s+touch|absorption|sweep/i.test(lower)

    let pattern: 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'HAMMER' | 'INVERTED_HAMMER' | 'SHOOTING_STAR' | 'REJECTION_TAIL' | 'LEVEL_TOUCH' =
      'LEVEL_TOUCH' // default: enter when price touches the level — no candle pattern required
    if (userMentionedPattern) {
      if (/hammer/i.test(lower)) pattern = 'HAMMER'
      else if (/shooting\s*star/i.test(lower)) pattern = 'SHOOTING_STAR'
      else if (/rejection/i.test(lower)) pattern = 'REJECTION_TAIL'
      else if (/bullish\s+engulfing/i.test(lower)) pattern = 'BULLISH_ENGULFING'
      else if (/bearish\s+engulfing/i.test(lower)) pattern = 'BEARISH_ENGULFING'
      else pattern = direction === 'LONG' ? 'BULLISH_ENGULFING' : 'BEARISH_ENGULFING'
    }

    // Detect entry timeframe — null means "any timeframe, Leo monitors all"
    let entryTimeframe: string | null = null
    const tfMatch = lower.match(/\b(1|2|3|4|5|6|8|10|12|15|20|25|30|45|60|90|120|240|480|D|W)\s*(?:min(?:ute)?s?|m\b|h(?:our)?s?|hr?s?|d(?:ay)?s?|w(?:eek)?s?)/i)
    if (tfMatch) {
      const raw = tfMatch[1]!.toUpperCase()
      // Normalize to minutes for standard values
      if (/^d$/i.test(raw)) entryTimeframe = '1440'
      else if (/^w$/i.test(raw)) entryTimeframe = '10080'
      else entryTimeframe = raw
    }

    // Detect CVD divergence requirement
    const cvdDivergence = /\bcvd\b|\bcumulative\s+volume\s+delta|\bdivergence\b/i.test(lower)

    let stopLossMode: 'BELOW_CANDLE_LOW' | 'ABOVE_CANDLE_HIGH' | 'FIXED_POINTS' | 'DOLLARS_50' =
      direction === 'LONG' ? 'BELOW_CANDLE_LOW' : 'ABOVE_CANDLE_HIGH'
    if (/below\s+(the\s+)?(candle|bar|engulfing)\s*low/i.test(lower)) stopLossMode = 'BELOW_CANDLE_LOW'
    else if (/above\s+(the\s+)?(candle|bar|engulfing)\s*high/i.test(lower)) stopLossMode = 'ABOVE_CANDLE_HIGH'
    else if (/50|fifty/i.test(lower)) stopLossMode = 'DOLLARS_50'

    let takeProfitMode: '1:1' | '1:2' | '1:3' | '1:5' | 'FIXED_POINTS' = '1:2'
    if (/1\s*:\s*1|1\s+to\s+1/i.test(lower)) takeProfitMode = '1:1'
    else if (/1\s*:\s*3|1\s+to\s+3/i.test(lower)) takeProfitMode = '1:3'
    else if (/1\s*:\s*5|1\s+to\s+5/i.test(lower)) takeProfitMode = '1:5'

    const defaultPrice =
      inst === 'DOW' ? 52500 : inst === 'GOLD' ? 4350 : inst === 'CRUDE' ? 104 : 29500

    let targetRef = 'Key Reference Level'
    let targetPx = ctx.currentPrice ?? defaultPrice

    if (/frvp|volume\s*profile|low\s*volume|lvn/i.test(lower)) {
      const frvp = ctx.userDrawings?.frvps?.[0]
      targetRef = frvp ? `Manual FRVP (${frvp.startTimeEt}) LVN` : 'Yesterday FRVP Low Volume Node'
      targetPx = frvp ? frvp.val : (ctx.shortTermMoney?.yval ?? (ctx.currentPrice ?? defaultPrice))
    } else if (/trendline/i.test(lower)) {
      const tl = ctx.userDrawings?.trendlines?.[0]
      const tlLabel = tl?.isReactionTrendline
        ? 'Reaction Trendline'
        : tl?.isActionTrendline
        ? 'Action Trendline'
        : (tl?.label || 'Trendline')
      const nearestTarget = tl?.horizontalRunway?.nearestTargetLabel
        ? `${tlLabel} Breakout → ${tl.horizontalRunway.nearestTargetLabel}`
        : `${tlLabel} Support`
      targetRef = tl ? nearestTarget : 'Trendline Breakout Support'
      targetPx = tl ? (tl.horizontalRunway?.nearestTargetPrice ?? tl.projectedPrice) : (ctx.currentPrice ?? defaultPrice)
    } else if (/range|box/i.test(lower)) {
      const r = ctx.userDrawings?.ranges?.[0]
      targetRef = r ? `${r.label || 'Range'} ${direction === 'LONG' ? 'Low' : 'High'}` : 'Range Boundary'
      targetPx = r ? (direction === 'LONG' ? r.priceLow : r.priceHigh) : (ctx.currentPrice ?? defaultPrice)
    }

    const matchPrice = lower.match(/(?:at|@|price|around)\s*([\d,]+(?:\.\d+)?)/i)
    if (matchPrice) {
      const p = parseFloat(matchPrice[1]!.replace(/,/g, ''))
      if (Number.isFinite(p) && p > 0) targetPx = p
    }

    const patternLabel =
      pattern === 'LEVEL_TOUCH' ? 'Price Touch at Level' : pattern.replace(/_/g, ' ')
    const slLabel =
      stopLossMode === 'BELOW_CANDLE_LOW'
        ? 'Below Entry Bar Low (-2 pts cushion)'
        : stopLossMode === 'ABOVE_CANDLE_HIGH'
        ? 'Above Entry Bar High (+2 pts cushion)'
        : 'Fixed Risk Bracket'

    const triggerLine =
      pattern === 'LEVEL_TOUCH'
        ? `- **Trigger:** **Price reaches level** (no candle pattern required)`
        : `- **Trigger Pattern:** **${patternLabel}**`

    const tfLine = entryTimeframe
      ? `- **Timeframe:** **${entryTimeframe}m chart** (Leo watches this TF)`
      : `- **Timeframe:** **Any** — Leo monitors all timeframes for the level`
    const cvdLine = cvdDivergence
      ? `- **CVD Condition:** ✅ CVD divergence required at the level`
      : ''

    return `### 🎯 Strategy Saved & Conditional Entry Armed

**Trader Instruction (Saved):**
> "${lastMsg.trim()}"

**Saved Entry Conditions:**
- **Target Reference:** **${targetRef}**
- **Target Level:** **${targetPx.toLocaleString()}**
${triggerLine}
${tfLine}${cvdLine ? '\n' + cvdLine : ''}
- **Direction:** **${direction}**
- **Dynamic Stop Loss:** ${slLabel}
- **Profit Target:** **${takeProfitMode} Risk:Reward**
- **Execution Desk:** Armed & actively monitoring live ticks. Leo will automatically execute the order on ${inst} as soon as conditions confirm.

<execute>
{
  "action": "ARM_CONDITIONAL_ENTRY",
  "userPrompt": "${lastMsg.replace(/["\\]/g, '')}",
  "instrument": "${inst}",
  "direction": "${direction}",
  "targetReference": "${targetRef}",
  "targetPrice": ${targetPx},
  "pattern": "${pattern}",
  "entryTimeframe": ${entryTimeframe ? `"${entryTimeframe}"` : 'null'},
  "cvdDivergence": ${cvdDivergence},
  "stopLossMode": "${stopLossMode}",
  "takeProfitMode": "${takeProfitMode}",
  "size": 1,
  "description": "${direction} 1 ${inst} — ${pattern === 'LEVEL_TOUCH' ? 'enter at level' : patternLabel}${entryTimeframe ? ` on ${entryTimeframe}m` : ''}${cvdDivergence ? ' + CVD div' : ''} at ${targetRef} (${targetPx.toLocaleString()})"
}
</execute>`
  }

  // 3. Direct order placement command (e.g. "Leo buy 1 NQ", "Leo enter long", "Leo sell DOW", "place order")
  if (/\b(buy|long|sell|short|enter|place\s+order|open\s+position|take\s+(a\s+)?trade)\b/i.test(lower)) {
    const isShort = /\b(sell|short)\b/i.test(lower)
    const direction: 'LONG' | 'SHORT' = isShort ? 'SHORT' : 'LONG'
    
    // Resolve instrument
    let inst = ctx.instrument || 'NASDAQ'
    if (/\bdow\b|ym/i.test(lower)) inst = 'DOW'
    else if (/\bnasdaq\b|nq/i.test(lower)) inst = 'NASDAQ'
    else if (/\bgold\b|gc/i.test(lower)) inst = 'GOLD'
    else if (/\bcrude\b|oil|cl/i.test(lower)) inst = 'CRUDE'
    else if (/\bnikkei\b|nk/i.test(lower)) inst = 'NIKKEI'

    // Resolve price
    const matchPrice = lower.match(/(?:at|@|price)\s*([\d,]+(?:\.\d+)?)/i)
    const fallbackPrice =
      inst === 'DOW' ? 52500 : inst === 'GOLD' ? 4350 : inst === 'CRUDE' ? 104 : 29500
    const rawPrice = matchPrice ? parseFloat(matchPrice[1]!.replace(/,/g, '')) : (ctx.currentPrice ?? fallbackPrice)
    const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : fallbackPrice

    // Resolve SL and TP brackets
    const slDist =
      inst === 'DOW' ? 60 : inst === 'GOLD' ? 5 : inst === 'CRUDE' ? 0.5 : inst === 'NIKKEI' ? 100 : 25
    const tpDist =
      inst === 'DOW' ? 120 : inst === 'GOLD' ? 10 : inst === 'CRUDE' ? 1.0 : inst === 'NIKKEI' ? 200 : 50

    const matchSl = lower.match(/(?:stop|sl)\s*(?:at\s*)?([\d,]+(?:\.\d+)?)/i)
    const matchTp = lower.match(/(?:target|tp|profit)\s*(?:at\s*)?([\d,]+(?:\.\d+)?)/i)

    const stopLoss = matchSl
      ? parseFloat(matchSl[1]!.replace(/,/g, ''))
      : (direction === 'LONG' ? price - slDist : price + slDist)

    const profitTarget = matchTp
      ? parseFloat(matchTp[1]!.replace(/,/g, ''))
      : (direction === 'LONG' ? price + tpDist : price - tpDist)

    return `### 🚀 Leo Order Placed & Journaled

Executing **${direction}** on **${inst}** at **${price.toLocaleString()}**:
- **Direction:** ${direction}
- **Entry Price:** ${price.toLocaleString()}
- **Stop Loss:** ${stopLoss.toLocaleString()} (${direction === 'LONG' ? '-' : '+'}${Math.abs(price - stopLoss).toFixed(1)} pts)
- **Profit Target:** ${profitTarget.toLocaleString()} (${direction === 'LONG' ? '+' : '-'}${Math.abs(profitTarget - price).toFixed(1)} pts)
- **Order History:** ✅ Transmitted to execution desk and saved in Order History.
- **Chart Tracking:** ✅ Active on chart — monitoring live price and P&L tick-by-tick.

*(Note: AI never auto-exits; only you or your bracket stops/targets close the position).*

<execute>
{
  "action": "PLACE_ORDER",
  "instrument": "${inst}",
  "direction": "${direction}",
  "price": ${price},
  "stopLoss": ${stopLoss},
  "profitTarget": ${profitTarget},
  "size": 1,
  "reason": "Trader command: ${lastMsg.replace(/["\\]/g, '')}"
}
</execute>`
  }

  // 3. Trade status command: "how is my trade going", "position status", "how are we doing"
  if (/how\s+is\s+(the|my)?\s*(trade|order|position)\s*(going)?|position\s+status|trade\s+status|how\s+are\s+we\s+doing/i.test(lower)) {
    const pos = ctx.activePosition
    if (!pos) {
      return `### Desk Status: FLAT (${ctx.instrument} @ ${curPrice})

There is currently **no open position** on the desk. All brackets are clear. Standing by for your next level, chart reference, or voice entry instruction.`
    }
    const sign = pos.unrealizedPnlPoints >= 0 ? '+' : ''
    return `### 📊 Live Trade Status (${pos.instrument} · ${pos.direction})

- **Entry Price:** ${pos.entryPrice.toLocaleString()}
- **Current Price:** ${curPrice}
- **Unrealized P&L:** **${sign}${pos.unrealizedPnlPoints.toFixed(1)} pts** (${sign}$${pos.unrealizedPnlCad.toFixed(2)} CAD)
- **Trade Health:** ${pos.isInProfit ? '🟢 **IN PROFIT**' : '🔴 **IN DRAWDOWN**'}
- **Brackets:** Stop Loss **${pos.stopLoss > 0 ? pos.stopLoss.toLocaleString() : 'None'}** | Take Profit **${pos.profitTarget > 0 ? pos.profitTarget.toLocaleString() : 'None'}**
- **Duration in Trade:** ${pos.durationMinutes.toFixed(1)} minutes
- **Chart Sync:** Displayed live on the chart canvas.
- **Management Rule:** Only you can exit this trade. AI never auto-exits.`
  }

  // 4. Stagnation rule command: "if we are in a position and we have not moved to profit after X minutes close"
  if (/not\s+moved\s+to\s+(the\s+)?profit|stagnat|close\s+.*after\s+\d+\s*min/i.test(lower)) {
    const matchMin = lower.match(/(\d+)\s*(?:minutes?|mins?|m\b)/)
    const minutes = matchMin ? parseInt(matchMin[1]!, 10) : 5
    const pos = ctx.activePosition

    return `Understood. Stagnation rule armed: If our ${pos ? `${pos.direction} position on ${pos.instrument} (entry: ${pos.entryPrice.toFixed(2)})` : `${ctx.instrument} position`} does not move into positive profit within ${minutes} minutes, I will automatically execute a market close to protect capital from dead auction chop.\n\n<execute>\n{\n  "action": "ARM_STAGNATION_RULE",\n  "maxMinutes": ${minutes},\n  "requireProfitPoints": 1,\n  "description": "Close position if not in profit after ${minutes} minutes"\n}\n</execute>`
  }

  // 5. Telegram alert command: "send me a telegram message" or "telegram"
  if (/telegram|notify\s+me|send\s+me\s+a\s+message/i.test(lower)) {
    return `External Telegram notifications are currently disabled desk-wide. All live alerts, auction updates, and risk monitors are streamed directly to the website dashboard and chart in real time.`
  }

  // 5b. Auction Price Critique & "Questioning" Inquiry:
  // e.g. "critique price", "questioning", "why should i buy here", "why the hell should i buy", "is price too expensive", "who bought overnight", "am i trapped"
  if (
    lower.includes('critique') ||
    /\b(questioning|why\s+(should\s+i|the\s+hell\s+should\s+i|would\s+i)\s+(buy|sell|short)|is\s+(the\s+)?price\s+too\s+(high|expensive|low|cheap)|who\s+bought\s+overnight|am\s+i\s+chasing|am\s+i\s+trapped|why\s+buy\s+now|why\s+short\s+now|market\s+is\s+a\s+place\s+to\s+do\s+business|weak\s+hand)\b/i.test(
      lower
    ) ||
    ctx.selectedDataPoints?.some(
      (p) => p.id === 'price-critique-dossier' || p.label.toLowerCase().includes('price critique')
    )
  ) {
    const isCritiqueActive = isPriceQuestioningSessionActive(Date.now(), '09:00')
    if (!isCritiqueActive && !ctx.priceQuestioning) {
      return `### ⏱️ Leo Auction Price Critique & Questioning Desk (${ctx.instrument} @ ${curPrice})

> *"The market is a place to do business. If price is not suitable for us, we never force a trade."*

⚠️ **Questioning Desk Off-Session:**
The Auction Price Critique & Questioning Desk is active during the **New York Session (09:00 AM / 09:15 AM – 16:00 ET)**.

- **Current Global Session:** ${sessionName}
- **Status:** Inactive during Asian and London sessions.
- **Next Desk Activation:** 09:00 AM / 09:15 AM ET (New York Pre-Market Open Preparation).

Participants in Asia and London are currently establishing initial overnight inventory and volume profiles. Stand by until New York pre-market to critique price location against accumulated overnight wholesale inventory.`
    }

    const pq = ctx.priceQuestioning || evaluatePriceQuestioning({
      currentPrice: ctx.currentPrice || 0,
      instrument: ctx.instrument,
      currentTimeEt: ctx.currentTimeEt,
      yesterday: ctx.shortTermMoney ? {
        poc: ctx.shortTermMoney.ypoc,
        high: ctx.shortTermMoney.yhigh,
        low: ctx.shortTermMoney.ylow,
        vah: ctx.shortTermMoney.yvah,
        val: ctx.shortTermMoney.yval,
      } : null,
      overnight: ctx.shortTermMoney ? {
        overnight: {
          poc: ctx.shortTermMoney.onpoc,
          high: ctx.shortTermMoney.onhigh,
          low: ctx.shortTermMoney.onlow,
        },
        biasLabel: ctx.shortTermMoney.overnightBias,
      } : null,
      frvp5d: ctx.intermediateMoney ? {
        poc: ctx.intermediateMoney.poc5d,
        vah: ctx.intermediateMoney.vah5d,
        val: ctx.intermediateMoney.val5d,
        high: ctx.intermediateMoney.high5d,
        low: ctx.intermediateMoney.low5d,
      } : null,
      avwap5m: ctx.longTermMoney ? {
        vwap: ctx.longTermMoney.avwap5m,
        sigma1Upper: ctx.longTermMoney.sigma1Upper,
        sigma1Lower: ctx.longTermMoney.sigma1Lower,
        sigma2Upper: ctx.longTermMoney.sigma2Upper,
        sigma2Lower: ctx.longTermMoney.sigma2Lower,
      } : null,
      orderFlow: ctx.orderFlow ? {
        sessionCvd: ctx.orderFlow.sessionCvd,
        trend: ctx.orderFlow.trend,
        divergence: ctx.orderFlow.divergence,
      } : null,
    })

    return `### Leo Auction Price Critique & Questioning Desk (${ctx.instrument} @ ${curPrice})

> *"The market is a place to do business. If price is not suitable for us, we never force a trade. Price advertises opportunity: when discounted we buy, when premium we short."*

---

### 1. Valuation & Location Read
- **Auction State:** **${pq.valuationState.replace('_', ' ')}** (Valuation Score: **${pq.valuationScore > 0 ? '+' : ''}${pq.valuationScore} / 100**)
- **Suitability Verdict:** \`${pq.suitabilityVerdict}\`
- **Wholesale Reference Target:** **${pq.wholesaleTarget != null ? pq.wholesaleTarget.toFixed(2) : 'Awaiting rotation'}**

---

### 2. Overnight & Global Session Inventory Reality
${pq.inventoryCritique.critiqueSummary}
- **Overnight POC:** ${pq.inventoryCritique.overnightPoc ?? 'N/A'}${pq.inventoryCritique.distanceFromOnPocPts != null ? ` (${pq.inventoryCritique.distanceFromOnPocPts > 0 ? '+' : ''}${pq.inventoryCritique.distanceFromOnPocPts} pts distance)` : ''}
- **Inventory Skew:** ${pq.inventoryCritique.overnightBias ?? 'Evaluating'} (${pq.inventoryCritique.pctLong}% Long / ${pq.inventoryCritique.pctShort}% Short)
- **Multi-Horizon POCs:** Yesterday POC @ **${pq.multiHorizonLevels.yesterdayPoc ?? 'N/A'}** | 5D-POC @ **${pq.multiHorizonLevels.fiveDayPoc ?? 'N/A'}** | 5M AVWAP @ **${pq.multiHorizonLevels.fiveMonthAvwap ?? 'N/A'}**

---

### 3. Weak-Hand Trap & Emotional Risk Radar
${pq.weakHandTrap.isTrapRisk ? `⚠️ **ACTIVE TRAP ALERT:** ${pq.weakHandTrap.warning}` : `✅ **STRUCTURAL HEALTH:** No acute weak-hand trap detected. Auction participation is structural.`}
*Remember: Emotional traders buy tops on a single green candle and sell bottoms in panic. Strong money lets weak hands push price to exhaustion, traps them, and punishes them on reversal.*

---

### 4. The 6-Question Pre-Trade Self-Audit
${pq.sixQuestionAudit.map(q => `- **[${q.status}] ${q.question}**\n  ↳ *${q.headline}*: ${q.detail}`).join('\n')}

---

### Desk Directive:
${pq.deskGuidance}`
  }

  // Gann Fan / Geometric Angle inquiry: "can we use gann fan to enhance that strategy or that is just illusion"
  if (/gann|gann\s*fan|fan\s*line|geometric\s*angle/i.test(lower)) {
    return `### Institutional Reality Check: Gann Fans vs. Empirical Velocity

**The Short Answer:** Traditional Gann Fans on modern electronic charts are largely an **optical illusion**, but their core intuition—comparing Price Velocity against Time (ΔP / Δt)—is valid when computed quantitatively.

---

### Why Static Gann Fans Fail on Modern Electronic Charts
1. **Geometric Scale Distortion:**
   W.D. Gann drew his fans by hand on physical square grid paper where 1 point = 1 day (a true 45° angle was 1×1). On modern electronic charts with dynamic auto-scaling, window resizing, and zooming, the visual degree angle changes every time you zoom or resize your browser. A 45° line on your desktop turns into 20° on a laptop!
2. **The "Curving" Trap:**
   Relying solely on diagonal lines leads traders to continuously redraw and curve lines to fit recent price wicks, creating false entries and confirmation bias.
3. **Horizontal Liquidity Blindness:**
   A diagonal line does not tell you if you are buying directly beneath an institutional supply wall (e.g. Yesterday NYC POC, Overnight High, 5-Day POC, or +2σ AVWAP). Entering a diagonal breakout into an overhead supply shelf creates a lethal bull trap.

---

### The Desk's Quantitative Standard:
1. **Scale-Invariant Empirical Velocity Corridor (ΔP / Δt):**
   Instead of drawing fixed degree angles, our engine calculates the **empirical velocity** directly from the initiating swing:
   - **1.0x Equilibrium Ray:** The sustainable baseline impulse velocity (pts/sec and pts/5m).
   - **1.5x Climax / Parabolic Ray:** Momentum acceleration threshold where price goes parabolic. Warns you to scale out profits rather than chase.
   - **0.5x Retest Floor Ray:** Defines the minimum speed required to maintain trend structure. A close below signals momentum stall.
2. **Horizontal S/R Runway Assessment:**
   Every Action Trendline breakout is matched against our Multi-Timeframe Institutional Levels (Overnight High/Low, Yesterday POC/VAH/VAL, 5D-POC, AVWAP ±1σ / ±2σ):
   - **Clear Runway (≥ 2.5:1):** High-probability setup with open air pocket to target.
   - **Tight Runway (< 1.5:1):** ⚠️ Trap warning! Price is breaking out right into heavy institutional supply.

**Desk Verdict:** Leave the subjective geometric Gann Fans behind. Trade the **Action/Reaction Trendlines** backed by **Horizontal S/R Runway** and the **Empirical Velocity Corridor** for true institutional mathematical edge.`
  }

  // 4. User Drawings: Trendline analysis
  if (/trendline|trend\s+line|reaction\s+line|action\s+line/i.test(lower)) {
    const tl = ctx.userDrawings?.trendlines?.[0]
    if (tl) {
      const typeLabel = tl.isReactionTrendline
        ? 'Reaction Trendline'
        : tl.isActionTrendline || tl.isInitialOvernight
        ? 'Action Trendline'
        : (tl.label || 'Trendline')

      const runwayBlock = tl.horizontalRunway
        ? `\n- **Horizontal S/R Runway:** **${tl.horizontalRunway.runwayPts.toFixed(1)} pts** (${tl.horizontalRunway.runwayRatio}:1 R:R, **${tl.horizontalRunway.quality}**)
- **Nearest Target:** ${tl.horizontalRunway.nearestTargetLabel ?? 'Rotational Target'} @ **${tl.horizontalRunway.nearestTargetPrice?.toFixed(1) ?? 'N/A'}**
- **Runway Assessment:** ${tl.horizontalRunway.summary}`
        : ''

      const velocityBlock = tl.empiricalVelocity
        ? `\n- **Empirical Velocity:** **${tl.empiricalVelocity.velocityState}** (${tl.empiricalVelocity.baseVelocityPtsPer5m} pts / 5m candle)
- **Velocity Corridor:** Equilibrium @ **${tl.empiricalVelocity.equilibriumPrice.toFixed(1)}** | Climax (1.5x) @ **${tl.empiricalVelocity.climaxPrice.toFixed(1)}** | Retest Floor (0.5x) @ **${tl.empiricalVelocity.retestFloorPrice.toFixed(1)}**
- **Velocity Read:** ${tl.empiricalVelocity.summary}`
        : ''

      return `### Leo ${typeLabel} Assessment (${ctx.instrument} @ ${curPrice})

I've got eyes on your manual **${typeLabel}**:
- **Trajectory:** From **${tl.startPrice.toLocaleString()}** (${tl.startTimeEt}) to **${tl.endPrice.toLocaleString()}** (${tl.endTimeEt})
- **Slope & Angle:** ${tl.slopeDirection} at ${tl.slopePtsPer5mBar >= 0 ? '+' : ''}${tl.slopePtsPer5mBar.toFixed(1)} pts / 5m candle (${tl.slopePtsPerMin >= 0 ? '+' : ''}${tl.slopePtsPerMin.toFixed(2)} pts/min)
- **Current Dynamic Level:** Projected at **${tl.projectedPrice.toLocaleString()}**
- **Price Action:** Market is currently **${tl.priceRelation}** the trendline${tl.distancePts != null ? ` (${Math.abs(tl.distancePts).toFixed(1)} pts distance)` : ''}.${runwayBlock}${velocityBlock}

**Desk Playbook Read:**
${tl.priceRelation === 'TESTING'
  ? `Price is actively testing the ${typeLabel}. Watch candle close and volume: a rejection wick here confirms responsive support/defense, while heavy 5m bar penetration signals trend breakdown.`
  : tl.priceRelation === 'ABOVE'
    ? `Price is accepted above the ${typeLabel}. As long as market holds above ${tl.projectedPrice.toLocaleString()}, buyer facilitation remains intact.`
    : `Price is trading below the line. Look for responsive re-acceptance above ${tl.projectedPrice.toLocaleString()} before trusting long momentum.`}`
    }
  }

  // 5. User Drawings: Range / Box analysis
  if (/range|box|rectangle|square|consolidation/i.test(lower)) {
    const r = ctx.userDrawings?.ranges?.[0]
    if (r) {
      return `### Leo Range / Bracket Assessment (${ctx.instrument} @ ${curPrice})

Tracking your drawn **${r.label || 'Range Box'}**:
- **Boundary Extremes:** High **${r.priceHigh.toLocaleString()}** | Low **${r.priceLow.toLocaleString()}**
- **Bracket Dimensions:** **${r.heightPts.toFixed(1)} pts** span across **${r.durationMin} minutes** (${r.startTimeEt} – ${r.endTimeEt})
- **Equilibrium (Midpoint):** **${r.midPrice.toLocaleString()}**
- **Location Status:** Market is **${r.priceRelation}** the range (${r.positionPct}% of bracket).

**Dalton Auction Theory Read:**
${r.priceRelation === 'INSIDE'
  ? `We are in a balanced, two-sided rotational market. Responsive buyers defend near **${r.priceLow.toLocaleString()}** and responsive sellers cap near **${r.priceHigh.toLocaleString()}**. Do not chase moves inside the mid-band (${r.midPrice.toLocaleString()}) — trade only edges or wait for confirmed breakout.`
  : r.priceRelation === 'ABOVE'
    ? `Initiative expansion above the range high (**${r.priceHigh.toLocaleString()}**). If the market tests ${r.priceHigh.toLocaleString()} from above with low volume and holds, old resistance becomes new institutional support.`
    : `Initiative breakdown below the range low (**${r.priceLow.toLocaleString()}**). Sellers facilitating price lower. Watch for test of ${r.priceLow.toLocaleString()} as overhead ceiling.`}`
    }
  }

  // 6. User Drawings: Manual FRVP analysis
  if (/frvp|volume\s+profile|manual\s+profile|poc/i.test(lower)) {
    const f = ctx.userDrawings?.frvps?.[0]
    if (f) {
      const buyPct = f.buyRatioPct.toFixed(1)
      return `### Leo Manual FRVP Assessment (${ctx.instrument} @ ${curPrice})

Analyzing your manual **Fixed Range Volume Profile** (${f.startTimeEt} – ${f.endTimeEt}):
- **Point of Control (POC):** **${f.poc.toLocaleString()}** (Highest traded volume node)
- **Value Area (70%):** VAH **${f.vah.toLocaleString()}** | VAL **${f.val.toLocaleString()}**
- **Auction Extremes:** High **${f.high.toLocaleString()}** | Low **${f.low.toLocaleString()}**
- **Profile Volume:** **${f.totalVolume.toLocaleString()}** contracts (${buyPct}% buy-side delta)
- **Current Relationship:** Market is **${f.priceRelation.replace('_', ' ')}**${f.distancePocPts != null ? ` (${Math.abs(f.distancePocPts).toFixed(1)} pts from manual POC)` : ''}.

**Auction Liquidity Read:**
${f.priceRelation === 'AT_POC'
  ? `Price is revolving directly at high-volume equilibrium (**${f.poc.toLocaleString()}**). High two-way trade facilitation. Expect consolidation or rotational chop until initiative volume picks a direction.`
  : f.priceRelation === 'ABOVE_VAH'
    ? `Price is accepted above Value Area High (**${f.vah.toLocaleString()}**). Initiative buyers are in control and rejecting lower value. Extension target remains active.`
    : f.priceRelation === 'BELOW_VAL'
      ? `Price is rejected below Value Area Low (**${f.val.toLocaleString()}**). Initiative sellers are probing lower prices looking for responsive buyers.`
      : `Price is trading inside the 70% Value Area (${f.val.toLocaleString()} – ${f.vah.toLocaleString()}). Expect rotational pull back toward POC **${f.poc.toLocaleString()}**.`}`
    }
  }

  // 7. General auction assessment
  const yval = ctx.shortTermMoney?.yval != null ? ctx.shortTermMoney.yval.toFixed(2) : 'Y-VAL'
  const ypoc = ctx.shortTermMoney?.ypoc != null ? ctx.shortTermMoney.ypoc.toFixed(2) : 'Y-POC'
  const poc5d = ctx.intermediateMoney?.poc5d != null ? ctx.intermediateMoney.poc5d.toFixed(2) : '5D POC'
  const vwap5m = ctx.longTermMoney?.avwap5m != null ? ctx.longTermMoney.avwap5m.toFixed(2) : '5M VWAP'

  return `### Leo Trade Assessment (${ctx.instrument} @ ${curPrice} · ${sessionName})

**Reviewing Auction Context**:
- **Location:** Trading relative to ${yval} (Yesterday Value Area Low), ${ypoc} (Yesterday POC) & ${poc5d} (5D POC extended).
- **Intermediate Flow:** Tracking 5-Day POC magnet and excessive rejection wicks.
- **Long-Term Benchmark:** 5-Month Anchored VWAP is at **${vwap5m}**.
- **Desk Telemetry:** Standing by to monitor session references, execute stagnation timeout exits, and track auction levels on your desk.`
}
