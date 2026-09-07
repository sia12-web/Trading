import { NextRequest } from 'next/server'
import {
  buildLeoSystemPrompt,
  streamClaudeResponse,
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

    const apiKey = process.env.ANTHROPIC_API_KEY
    const selectedModel =
      model ||
      process.env.LLM_PROPOSER_MODEL ||
      'claude-3-7-sonnet-20250219'

    const systemPrompt = buildLeoSystemPrompt(chartContext)

    // If no Anthropic key configured, provide a live desk heuristic response
    if (!apiKey) {
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

    // Stream Claude SSE response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await streamClaudeResponse({
            apiKey,
            model: selectedModel,
            systemPrompt,
            messages,
            onChunk: (chunk) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
            },
          })
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (err: any) {
          // If primary model fails, try fallback model claude-3-5-sonnet-20241022
          try {
            await streamClaudeResponse({
              apiKey,
              model: 'claude-3-5-sonnet-20241022',
              systemPrompt,
              messages,
              onChunk: (chunk) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
              },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch (secondErr: any) {
            const fallback = buildDeskFallbackResponse(messages, chartContext)
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  text: `*(Live API stream reconnecting - Desk Offline Heuristic)*\n\n${fallback}`,
                })}\n\ndata: [DONE]\n\n`
              )
            )
            controller.close()
          }
        }
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
 * Deterministic institutional trade planner fallback when external API is unreachable.
 */
function buildDeskFallbackResponse(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ctx: LeoChatContext
): string {
  const lastMsg = messages[messages.length - 1]?.content ?? ''
  const curPrice = ctx.currentPrice != null ? ctx.currentPrice.toFixed(2) : 'active price'
  const yval = ctx.shortTermMoney?.yval != null ? ctx.shortTermMoney.yval.toFixed(2) : 'Y-VAL'
  const ypoc = ctx.shortTermMoney?.ypoc != null ? ctx.shortTermMoney.ypoc.toFixed(2) : 'Y-POC'
  const poc5d = ctx.intermediateMoney?.poc5d != null ? ctx.intermediateMoney.poc5d.toFixed(2) : '5D POC'
  const vwap5m = ctx.longTermMoney?.avwap5m != null ? ctx.longTermMoney.avwap5m.toFixed(2) : '5M VWAP'

  return `### Leo Trade Assessment (${ctx.instrument} @ ${curPrice})

**Plan Summary for "${lastMsg.slice(0, 80)}..."**:
- **Condition 1 (Short-Term Location):** Price trading relative to ${yval} (Yesterday Value Area Low).
- **Condition 2 (Intermediate Excess):** Awaiting 5m rejection tail showing responsive intermediate buyers.
- **Condition 3 (Long-Term Flow):** 5-Month Anchored VWAP is at **${vwap5m}**. Retest must hold above macro support.
- **Execution Trigger:** Wait for a 5-minute bullish reversal candle confirming the rejection shelf.
- **Stop Loss:** Strict invalidation 2 ticks below the lowest wick of the excess tail.
- **Targets:**
  1. Target 1 (Short-Term): **${ypoc}** (Yesterday POC)
  2. Target 2 (Intermediate Magnet): **${poc5d}** (5D POC extended line)
  3. Target 3 (Macro Trend): **${vwap5m}** (5M AVWAP)

*Standing by for trigger confirmation.*`
}
