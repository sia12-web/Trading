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
${datumLine('WTI', `$${state.wtiTelemetry.promptPrice.toFixed(2)} (change ${formatSignedDollars(state.wtiTelemetry.change)}, ${formatSignedNumber(state.wtiTelemetry.changePct)}%)`, 'TICK', 'LIVE')}
${datumLine('Day range', `$${state.wtiTelemetry.low.toFixed(2)} - $${state.wtiTelemetry.high.toFixed(2)}`, 'SESSION', 'LIVE')}
${datumLine('Front spread M1-M2 level', `${formatSignedDollars(state.wtiTelemetry.promptSpread)}/bbl (${state.wtiTelemetry.spreadRegime})`, 'TICK', 'LIVE')}
- Physical Balance Status: ${state.physicalBalance}
- Overall Fundamental Bias: ${state.overallBias} (${state.overallConfidence}/10 confidence)
- Macro Synthesis: ${state.biasSummary}

THE 10 ACTIVE FUNDAMENTAL PILLARS:
${pillarsSummary}

STRICT ANALYST DIRECTIVES:
1. Always frame answers around the 10 fundamental pillars and the physical cash market.
2. Reference the supplied WTI price ($${state.wtiTelemetry.promptPrice.toFixed(2)}) and front spread level (${formatSignedDollars(state.wtiTelemetry.promptSpread)}/bbl ${state.wtiTelemetry.spreadRegime}). Do not invent a spread change.
3. Never invent missing data.
4. Never assume correlation implies causation.
5. Never issue a trade solely from a headline.
6. If sources conflict, explicitly report the conflict.
`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    // If no LLM keys are configured, provide an institutional fallback stream
    if (!anthropicKey && !openaiKey) {
      const hasTelemetry = Number.isFinite(state.wtiTelemetry.promptPrice) && state.wtiTelemetry.promptPrice > 0
      const promptStr = hasTelemetry
        ? `$${state.wtiTelemetry.promptPrice.toFixed(2)} (${state.wtiTelemetry.change >= 0 ? '+' : ''}$${state.wtiTelemetry.change.toFixed(2)})`
        : 'UNAVAILABLE'
      const spreadStr = hasTelemetry
        ? `${formatSignedDollars(state.wtiTelemetry.promptSpread)}/bbl (${state.wtiTelemetry.spreadRegime})`
        : 'UNAVAILABLE'

      const fallbackText = `### 🛢️ Oil Fundamental Analyst Executive Assessment

**Market**: NYMEX WTI Crude Oil (${state.wtiTelemetry.symbol}) | Live Prompt: **${promptStr}**  
**Curve Structure**: **${spreadStr}**  
**Macro Physical Balance**: **${state.physicalBalance || 'UNAVAILABLE'}** | Fundamental Stance: **${state.overallBias}** (${state.overallConfidence}/10 confidence)

---

#### 1. Physical Supply & Inventories Balance
- **Prompt Cash Spread**: Front calendar spread level is **${spreadStr}**.
- **Commercial Stocks & Storage**: Official inventory telemetry status: ${state.today.inventories || 'UNAVAILABLE'}. Zero placeholder policy: no speculative estimates fabricated.
- **Domestic Supply**: Physical supply status: ${state.today.supply || 'UNAVAILABLE'}.

#### 2. OPEC+ Policy & Geopolitical Supply Risks
- **OPEC+ Policy**: ${state.today.opec || 'UNAVAILABLE'}.
- **Geopolitical Hazard**: ${state.today.geopolitical_risk || 'UNAVAILABLE'}.

#### 3. Curve Structure & Positioning
- **Curve Structure**: ${state.today.curve || 'UNAVAILABLE'}.
- **Speculative Positioning**: ${state.today.positioning || 'UNAVAILABLE'}.

*Notice: Strict anti-hallucination policy active. Telemetry not supplied by live verified feeds is explicitly reported as UNAVAILABLE.*`

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
