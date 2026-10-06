import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { streamClaudeResponse, streamOpenAIResponse } from '@/lib/ai/leoAssistant'
import { getNikkeiFundamentalState } from '@/lib/fundamentals/nikkeiStateStore'
import { NIKKEI_ANALYST_CHAT_PROMPT } from '@/lib/fundamentals/nikkeiAnalystConfig'
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
        : [{ role: 'user' as const, content: 'Give me a complete macro, BoJ, USD/JPY currency pass-through, and semiconductor supply chain assessment for CME Nikkei 225 futures (NKD).' }]

    const state = await getNikkeiFundamentalState()
    const t = state.nikkeiTelemetry
    const fx = state.fx

    const driversSummary = Object.values(state.drivers)
      .map(
        (d) =>
          `- **${d.name}** [Stance: ${d.stance} | Intraday: ${'★'.repeat(d.intradayStars)}${'☆'.repeat(5 - d.intradayStars)}]: ${d.summary}`
      )
      .join('\n')

    const contextPrompt = `
${NIKKEI_ANALYST_CHAT_PROMPT}

CURRENT ACTIVE NIKKEI 225 FUNDAMENTAL STATE:
- Market: CME Nikkei 225 USD Futures (Globex: NKD, $5 Multiplier)
- Current Server Time: ${new Date().toUTCString()}
- Prompt NKD Futures Price: ${t.sourced?.nkd ? `${t.nkdPrice.toFixed(0)} (${t.nkdChange >= 0 ? '+' : ''}${t.nkdChange.toFixed(0)} pts, ${t.nkdChangePct >= 0 ? '+' : ''}${t.nkdChangePct.toFixed(2)}%)` : 'Unavailable'}
- USD/JPY Rate: ${t.sourced?.usdjpy ? `${fx.usdjpyRate.toFixed(2)} (${fx.usdjpyChangePct >= 0 ? '+' : ''}${fx.usdjpyChangePct.toFixed(2)}%)` : 'Unavailable'}
- MoF intervention status: Unavailable
- Bank of Japan policy rate and 10Y JGB: Unavailable
- SOX: ${t.sourced?.sox ? `${t.soxIndex} (${t.soxChangePct >= 0 ? '+' : ''}${t.soxChangePct.toFixed(2)}%)` : 'Unavailable'}
- Tokyo cash session phase: ${t.tokyoSessionPhase} (${t.tokyoCashSessionActive ? 'cash session open' : 'cash session closed'})
- Nikkei weights, divisor contribution, and breadth: Unavailable
- Intraday Bias: ${state.today.intraday_bias} | Short-Term: ${state.today.short_term_bias}

CORE DRIVERS:
${driversSummary}

LATEST WIRES:
${state.liveHeadlines.map((h) => `- [${h.indexRelevance}] ${h.headline} (${h.source})`).join('\n') || '- Normal trading conditions on Tokyo and CME tapes.'}

Answer in prose. Describe what to watch. Do not give a trade instruction. Do not invent a point contribution or an intervention price.
`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    if (!anthropicKey && !openaiKey) {
      const fallbackText = `### NIKKEI 225 INSTITUTIONAL BRIEFING (CME NKD / JPX CASH)

#### 1. Price-Weighted Index Structure & Tech Concentration
- **Index weights**: Unavailable.
- **SOX**: **${t.sourced?.sox ? t.soxIndex : 'Unavailable'}**.

#### 2. USD/JPY Currency Pass-Through & MoF Danger Zone
- **Spot FX**: USD/JPY **${t.sourced?.usdjpy ? fx.usdjpyRate.toFixed(2) : 'Unavailable'}**.
- **MoF intervention**: Unavailable.

#### 3. Bank of Japan Monetary Normalization
- **Policy target**: Overnight call rate and 10Y JGB are unavailable.
- **Wages**: Shunto prints are unavailable.

#### 4. Active Fundamental Bias
- **Intraday Bias**: **${state.today.intraday_bias}** | **Short-Term**: **${state.today.short_term_bias}**
- **Tokyo Session Focus**: 09:00-10:00 JST cash open. Watch for absorption on large overnight US gap opens. Do not use Initial Balance.`

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
            logger.warn('[Nikkei Chat API] Claude streaming failed, trying OpenAI', err)
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
            logger.error('[Nikkei Chat API] OpenAI streaming failed', err)
          }
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ text: 'Unable to stream Nikkei analysis at this time.' })}\n\ndata: [DONE]\n\n`
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
    logger.error('[Nikkei Fundamentals Chat API] Chat failed', err)
    return NextResponse.json({ error: 'Internal chat error' }, { status: 500 })
  }
}
