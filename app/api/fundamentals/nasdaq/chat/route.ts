import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { streamClaudeResponse, streamOpenAIResponse } from '@/lib/ai/leoAssistant'
import { getNasdaqFundamentalState } from '@/lib/fundamentals/nasdaqStateStore'
import { NASDAQ_ANALYST_CHAT_PROMPT } from '@/lib/fundamentals/nasdaqAnalystConfig'
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
        : [{ role: 'user' as const, content: 'Give me a complete macro, rates, earnings, and market breadth assessment for Nasdaq-100 (NQ).' }]

    // Fetch live state and telemetry
    const state = await getNasdaqFundamentalState()
    const t = state.nasdaqTelemetry

    const driversSummary = Object.values(state.drivers)
      .map(
        (d) =>
          `- **${d.name}** [Stance: ${d.stance} | Intraday: ${'★'.repeat(d.intradayStars)}${'☆'.repeat(5 - d.intradayStars)} | Long-Term: ${'★'.repeat(d.longTermStars)}${'☆'.repeat(5 - d.longTermStars)}]: ${d.summary} (${d.metrics.map((m) => `${m.label}: ${m.value}`).join(', ')})`
      )
      .join('\n')

    const contextPrompt = `
${NASDAQ_ANALYST_CHAT_PROMPT}

SUPPLIED NASDAQ STATE (not a live monitor; interpret only this packet):
- Market: CME E-mini Nasdaq-100 Futures (NQ)
- Current Date & Server Time: ${new Date().toUTCString()}
- Prompt NQ Live Price: ${t.sourced?.nq ? `${t.nqPrice.toFixed(2)} (${t.nqChange >= 0 ? '+' : ''}${t.nqChange.toFixed(2)}, ${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}%)` : 'Unavailable'}
- S&P 500 (ES): ${t.sourced?.es ? `${t.esPrice.toFixed(2)} (${t.esChangePct >= 0 ? '+' : ''}${t.esChangePct.toFixed(2)}%)` : 'Unavailable'} | Dow (YM): ${t.sourced?.ym ? `${t.ymPrice.toFixed(0)} (${t.ymChangePct >= 0 ? '+' : ''}${t.ymChangePct.toFixed(2)}%)` : 'Unavailable'}
- Relative Strength Stance: ${t.sourced?.nq && t.sourced?.es && t.sourced?.ym ? t.relativeStrengthStance : 'Unavailable'}
- US 2Y Yield: ${t.sourced?.us2y ? `${t.us2yNominalYield.toFixed(2)}%` : 'Unavailable'} | US 10Y Yield: ${t.sourced?.us10y ? `${t.us10yNominalYield.toFixed(2)}%` : 'Unavailable'}${t.sourced?.us2y && t.sourced?.us10y ? ` (2s10s Spread: ${t.yieldCurve2s10sSpreadBps >= 0 ? '+' : ''}${t.yieldCurve2s10sSpreadBps} bps)` : ''}
- 10Y Real TIPS Yield (DFII10): ${t.sourced?.us10yReal ? `${t.us10yRealYield.toFixed(2)}%` : 'Unavailable'}
- CBOE Volatility: VXN ${t.sourced?.vxn ? t.vxnIndex.toFixed(1) : 'Unavailable'} | VIX ${t.sourced?.vix ? t.vixIndex.toFixed(1) : 'Unavailable'}
- Semiconductor basket: Unavailable
- Market breadth: Unavailable
- AI / semi capex: Unavailable
- Constituent index weights: Unavailable. Quoted prices: ${t.topConstituents.filter((c) => c.quoteLive).map((c) => `${c.symbol} $${c.price.toFixed(2)} (${c.changePct >= 0 ? '+' : ''}${c.changePct.toFixed(2)}%)`).join(', ') || 'Unavailable'}
- Stance: Intraday=${state.today.intraday_bias} | Short-Term=${state.today.short_term_bias} | Medium-Term=${state.today.medium_term_bias}
- Invalidation Criteria: ${state.today.what_would_invalidate_the_current_interpretation}

ACTIVE 11 DRIVERS STATUS:
${driversSummary}

Use this as fundamental context only. Do not infer CVD, absorption, or a reclaim.
Never invent missing data. Never treat an earnings beat as automatically bullish. Never treat a rate cut as automatically bullish. Do not issue a trade.
`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    if (!anthropicKey && !openaiKey) {
      const fallbackText = `### NASDAQ-100 FUNDAMENTAL ANALYST BRIEFING (CME NQ)

#### 1. Rates & Growth Valuation Discounting
- **Treasury Rates Transmission**: US 2Y is **${t.sourced?.us2y ? `${t.us2yNominalYield.toFixed(2)}%` : 'Unavailable'}** and 10Y is **${t.sourced?.us10y ? `${t.us10yNominalYield.toFixed(2)}%` : 'Unavailable'}**.
- **Real Yield Anchor**: 10Y real TIPS is **${t.sourced?.us10yReal ? `${t.us10yRealYield.toFixed(2)}%` : 'Unavailable'}**.

#### 2. Cross-market
- **Relative strength**: **${t.sourced?.nq && t.sourced?.es && t.sourced?.ym ? t.relativeStrengthStance : 'Unavailable'}**.
- **Market breadth**: Unavailable.
- **Semiconductor cycle**: Unavailable.

#### 3. Volatility
- **CBOE Volatility**: VXN **${t.sourced?.vxn ? t.vxnIndex.toFixed(2) : 'Unavailable'}**, VIX **${t.sourced?.vix ? t.vixIndex.toFixed(2) : 'Unavailable'}**.
- **Current Bias**: Intraday **${state.today.intraday_bias}** | Short-Term **${state.today.short_term_bias}** | Medium-Term **${state.today.medium_term_bias}**.
- **Invalidation**: ${state.today.what_would_invalidate_the_current_interpretation}

*Trading Guidance: Use this fundamental context alongside Volume Profile levels and CVD delta absorption to identify high-probability setups.*`

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
            logger.warn('[Nasdaq Chat API] Claude streaming failed, trying OpenAI', err)
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
            logger.error('[Nasdaq Chat API] OpenAI streaming failed', err)
          }
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ text: 'Unable to stream nasdaq analysis at this time.' })}\n\ndata: [DONE]\n\n`
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
    logger.error('[Nasdaq Fundamentals Chat API] Failed to stream chat', err)
    return NextResponse.json({ error: 'Chat stream failed' }, { status: 500 })
  }
}
