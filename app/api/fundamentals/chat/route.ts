import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { streamClaudeResponse, streamOpenAIResponse } from '@/lib/ai/leoAssistant'
import { getOilFundamentalState } from '@/lib/fundamentals/oilStateStore'
import { OIL_ANALYST_CHAT_PROMPT } from '@/lib/fundamentals/oilAnalystConfig'
import { datumLine, formatSignedDollars, formatSignedNumber } from '@/lib/fundamentals/outputContract'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

type MessageInput = {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      messages?: MessageInput[]
    }

    const messages =
      Array.isArray(body.messages) && body.messages.length > 0
        ? body.messages
        : [{ role: 'user' as const, content: 'Give me a complete physical balance sheet and curve structure assessment for WTI.' }]

    // Fetch the continuously updated fundamental state and live telemetry
    const state = await getOilFundamentalState()

    const pillarsSummary = Object.values(state.pillars)
      .map(
        (p) =>
          `- **${p.name}** [Bias: ${p.bias} | Horizon: ${p.horizon} | Conf: ${p.confidence}/10]: ${p.statusSummary} (Key Metrics: ${p.metrics.map((m) => `${m.label}: ${m.value}${m.unit ? ` ${m.unit}` : ''}`).join(', ')})`
      )
      .join('\n')

    const contextPrompt = `
${OIL_ANALYST_CHAT_PROMPT}

SUPPLIED OIL STATE (not a live monitor; interpret only this packet):
- Market: NYMEX WTI Crude Oil (CL)
${datumLine('WTI', state.wtiTelemetry.sourced?.prompt ? `$${state.wtiTelemetry.promptPrice.toFixed(2)} (change ${formatSignedDollars(state.wtiTelemetry.change)}, ${formatSignedNumber(state.wtiTelemetry.changePct)}%)` : 'UNAVAILABLE', state.wtiTelemetry.sourced?.prompt ? 'TICK' : 'UNAVAILABLE', state.wtiTelemetry.sourced?.prompt ? 'LIVE' : 'STALE')}
${datumLine('Day range', state.wtiTelemetry.sourced?.prompt ? `$${state.wtiTelemetry.low.toFixed(2)} - $${state.wtiTelemetry.high.toFixed(2)}` : 'UNAVAILABLE', state.wtiTelemetry.sourced?.prompt ? 'SESSION' : 'UNAVAILABLE', state.wtiTelemetry.sourced?.prompt ? 'LIVE' : 'STALE')}
${datumLine('Front spread M1-M2 level', state.wtiTelemetry.promptSpread == null ? 'UNAVAILABLE' : `${formatSignedDollars(state.wtiTelemetry.promptSpread)}/bbl (${state.wtiTelemetry.spreadRegime})`, state.wtiTelemetry.promptSpread == null ? 'UNAVAILABLE' : 'TICK', state.wtiTelemetry.promptSpread == null ? 'STALE' : 'LIVE')}
- Physical Balance Status: ${state.physicalBalance}
- Overall Fundamental Bias: ${state.overallBias} (${state.overallConfidence}/10 confidence)
- Macro Synthesis: ${state.biasSummary}

THE 10 ACTIVE FUNDAMENTAL PILLARS:
${pillarsSummary}

STRICT ANALYST DIRECTIVES:
1. Always frame answers around the 10 fundamental pillars and the physical cash market.
2. Reference the supplied WTI price (${state.wtiTelemetry.sourced?.prompt ? `$${state.wtiTelemetry.promptPrice.toFixed(2)}` : 'Unavailable'}) and front spread level (${formatSignedDollars(state.wtiTelemetry.promptSpread)}/bbl ${state.wtiTelemetry.spreadRegime}). Do not invent a spread change.
3. Never invent missing data.
4. Never assume correlation implies causation.
5. Never issue a trade solely from a headline.
6. If sources conflict, explicitly report the conflict.
`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    // If no LLM keys are configured, provide an institutional fallback stream
    if (!anthropicKey && !openaiKey) {
      const fallbackText = `### 🛢️ Oil Fundamental Analyst Executive Assessment

**Market**: NYMEX WTI Crude Oil (${state.wtiTelemetry.symbol}) | Prompt: **${state.wtiTelemetry.sourced?.prompt ? `$${state.wtiTelemetry.promptPrice.toFixed(2)} (${state.wtiTelemetry.change >= 0 ? '+' : ''}$${state.wtiTelemetry.change.toFixed(2)})` : 'Unavailable'}**  
**Curve Structure**: **${state.wtiTelemetry.spreadRegime}** (Prompt Spread M1-M2: **${formatSignedDollars(state.wtiTelemetry.promptSpread)}/bbl**)  
**Macro Physical Balance**: **${state.physicalBalance}** | Fundamental Stance: **${state.overallBias}** (${state.overallConfidence}/10 confidence)

---

#### 1. What is on the tape
- **WTI**: ${state.wtiTelemetry.sourced?.prompt ? `$${state.wtiTelemetry.promptPrice.toFixed(2)}` : 'Unavailable'}
- **Brent-WTI**: ${state.wtiTelemetry.brentWtiSpread != null ? `$${state.wtiTelemetry.brentWtiSpread.toFixed(2)}/bbl` : 'Unavailable'}
- **3:2:1 crack**: ${state.wtiTelemetry.crackSpread321 != null ? `$${state.wtiTelemetry.crackSpread321.toFixed(2)}/bbl` : 'Unavailable'}
- **M1-M2 calendar spread**: Unavailable
- **Cushing, commercial stocks, OPEC flows, refinery utilization, and CFTC positioning**: Unavailable. Those feeds are not connected.

*Mandate Reminder: Never trade solely from a headline. Front calendar spread confirmation and inventory trajectory must validate any directional thesis.*`

      return new Response(`data: ${JSON.stringify({ text: fallbackText })}\n\ndata: [DONE]\n\n`, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        if (anthropicKey) {
          try {
            await streamClaudeResponse({
              apiKey: anthropicKey,
              model: 'claude-3-5-sonnet-20241022',
              systemPrompt: contextPrompt,
              messages,
              onChunk: (chunk: string) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
              },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          } catch (err) {
            logger.warn('[Oil Chat API] Claude streaming failed, trying OpenAI', err)
          }
        }

        if (openaiKey) {
          try {
            await streamOpenAIResponse({
              apiKey: openaiKey,
              model: 'gpt-4o',
              systemPrompt: contextPrompt,
              messages,
              onChunk: (chunk: string) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
              },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          } catch (err) {
            logger.error('[Oil Chat API] OpenAI streaming failed', err)
          }
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ text: 'Unable to stream oil analysis at this time.' })}\n\ndata: [DONE]\n\n`
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
  } catch (err) {
    logger.error('[Oil Chat API] Internal error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
