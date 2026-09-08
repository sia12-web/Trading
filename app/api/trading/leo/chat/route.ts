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

  // 2. Stagnation rule command: "if we are in a position and we have not moved to profit after X minutes close"
  if (/not\s+moved\s+to\s+(the\s+)?profit|stagnat|close\s+.*after\s+\d+\s*min/i.test(lower)) {
    const matchMin = lower.match(/(\d+)\s*(?:minutes?|mins?|m\b)/)
    const minutes = matchMin ? parseInt(matchMin[1]!, 10) : 5
    const pos = ctx.activePosition

    return `Understood. Stagnation rule armed: If our ${pos ? `${pos.direction} position on ${pos.instrument} (entry: ${pos.entryPrice.toFixed(2)})` : `${ctx.instrument} position`} does not move into positive profit within ${minutes} minutes, I will automatically execute a market close to protect capital from dead auction chop.\n\n<execute>\n{\n  "action": "ARM_STAGNATION_RULE",\n  "maxMinutes": ${minutes},\n  "requireProfitPoints": 1,\n  "description": "Close position if not in profit after ${minutes} minutes"\n}\n</execute>`
  }

  // 3. Telegram alert command: "send me a telegram message" or "telegram"
  if (/telegram|notify\s+me|send\s+me\s+a\s+message/i.test(lower)) {
    const attached = ctx.selectedDataPoints?.[0]
    const targetRef = attached?.label ?? (ctx.intermediateMoney?.poc5d ? '5D POC' : 'Target Reference')
    const targetPrice =
      typeof attached?.value === 'number'
        ? attached.value
        : ctx.intermediateMoney?.poc5d ?? (ctx.currentPrice ?? 29500)

    const sessionMatch = lower.match(/\b(asia|london|new york|nyc)\b/i)
    const session = sessionMatch ? sessionMatch[1]!.toUpperCase() : ctx.sessionDetails?.sessionName ?? 'Current Session'

    return `Understood. Telegram alert armed for **${targetRef}** (${targetPrice.toLocaleString()}) during ${session}.\n\nWhen price tests this reference zone with confirmed high volume and execution confidence, I will dispatch an instant alert to your Telegram.\n\n<execute>\n{\n  "action": "ARM_TELEGRAM_ALERT",\n  "targetReference": "${targetRef}",\n  "targetPrice": ${targetPrice},\n  "requireHighVolume": true,\n  "requireConfidence": true,\n  "session": "${session}"\n}\n</execute>`
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
- **Desk Telemetry:** Standing by to monitor session references, execute stagnation timeout exits, or dispatch Telegram alerts.`
}
