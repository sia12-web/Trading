import { NextRequest } from 'next/server'
import {
  buildLeoSystemPrompt,
  streamClaudeResponse,
  streamOpenAIResponse,
  type LeoChatContext,
} from '@/lib/ai/leoAssistant'

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
function buildDeskFallbackResponse(
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

    let pattern: 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'HAMMER' | 'INVERTED_HAMMER' | 'SHOOTING_STAR' | 'REJECTION_TAIL' | 'LEVEL_TOUCH' =
      direction === 'LONG' ? 'BULLISH_ENGULFING' : 'BEARISH_ENGULFING'
    if (/hammer/i.test(lower)) pattern = 'HAMMER'
    else if (/shooting\s*star/i.test(lower)) pattern = 'SHOOTING_STAR'
    else if (/rejection/i.test(lower)) pattern = 'REJECTION_TAIL'
    else if (/bullish\s+engulfing/i.test(lower)) pattern = 'BULLISH_ENGULFING'
    else if (/bearish\s+engulfing/i.test(lower)) pattern = 'BEARISH_ENGULFING'

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
      targetRef = tl ? `${tl.label || 'Trendline'} Support` : 'Trendline Support'
      targetPx = tl ? tl.projectedPrice : (ctx.currentPrice ?? defaultPrice)
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

    const patternLabel = pattern.replace(/_/g, ' ')
    const slLabel =
      stopLossMode === 'BELOW_CANDLE_LOW'
        ? 'Below Bullish Engulfing Bar Low (-2 pts cushion)'
        : stopLossMode === 'ABOVE_CANDLE_HIGH'
        ? 'Above Bar High (+2 pts cushion)'
        : 'Fixed Risk Bracket'

    return `### 🎯 Strategy Saved & Conditional Entry Armed

**Trader Instruction (Saved):**
> "${lastMsg.trim()}"

**Saved Entry Conditions:**
- **Target Reference:** **${targetRef}**
- **Target Level:** **${targetPx.toLocaleString()}**
- **Trigger Pattern:** **${patternLabel}**
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
  "stopLossMode": "${stopLossMode}",
  "takeProfitMode": "${takeProfitMode}",
  "size": 1,
  "description": "${direction} 1 ${inst} on ${patternLabel} at ${targetRef} (${targetPx.toLocaleString()})"
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

  // 4. User Drawings: Trendline analysis
  if (/trendline|trend\s+line/i.test(lower)) {
    const tl = ctx.userDrawings?.trendlines?.[0]
    if (tl) {
      return `### Leo Trendline Assessment (${ctx.instrument} @ ${curPrice})

I've got eyes on your manual **${tl.label || 'Trendline'}**:
- **Trajectory:** From **${tl.startPrice.toLocaleString()}** (${tl.startTimeEt}) to **${tl.endPrice.toLocaleString()}** (${tl.endTimeEt})
- **Slope & Angle:** ${tl.slopeDirection} at ${tl.slopePtsPer5mBar >= 0 ? '+' : ''}${tl.slopePtsPer5mBar.toFixed(1)} pts / 5m candle (${tl.slopePtsPerMin >= 0 ? '+' : ''}${tl.slopePtsPerMin.toFixed(2)} pts/min)
- **Current Dynamic Level:** Projected at **${tl.projectedPrice.toLocaleString()}**
- **Price Action:** Market is currently **${tl.priceRelation}** the trendline${tl.distancePts != null ? ` (${Math.abs(tl.distancePts).toFixed(1)} pts distance)` : ''}.

**Desk Playbook Read:**
${tl.priceRelation === 'TESTING'
  ? `Price is actively testing the trendline. Watch candle close and volume: a rejection wick here confirms responsive support/defense, while heavy 5m bar penetration signals trend breakdown.`
  : tl.priceRelation === 'ABOVE'
    ? `Price is accepted above the trendline. As long as market holds above ${tl.projectedPrice.toLocaleString()}, buyer facilitation remains intact.`
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
