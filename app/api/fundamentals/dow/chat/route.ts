import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { streamClaudeResponse, streamOpenAIResponse } from '@/lib/ai/leoAssistant'
import { getDowFundamentalState } from '@/lib/fundamentals/dowStateStore'
import { DOW_ANALYST_CHAT_PROMPT } from '@/lib/fundamentals/dowAnalystConfig'
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
        : [{ role: 'user' as const, content: 'Give me a complete macro, cyclical, price-weighting, and sector rotation assessment for CME E-mini Dow futures (YM).' }]

    // Fetch live state and telemetry
    const state = await getDowFundamentalState()
    const t = state.dowTelemetry
    const rot = state.rotation
    const cred = state.credit

    const driversSummary = Object.values(state.drivers)
      .map(
        (d) =>
          `- **${d.name}** [Stance: ${d.stance} | Intraday: ${'★'.repeat(d.intradayStars)}${'☆'.repeat(5 - d.intradayStars)} | Long-Term: ${'★'.repeat(d.longTermStars)}${'☆'.repeat(5 - d.longTermStars)}]: ${d.summary} (${d.metrics.map((m) => `${m.label}: ${m.value}`).join(', ')})`
      )
      .join('\n')

    const contextPrompt = `
${DOW_ANALYST_CHAT_PROMPT}

SUPPLIED DOW STATE (not a live monitor; interpret only this packet):
- Market: CME E-mini Dow Futures (YM, $5 Multiplier)
- Current Date & Server Time: ${new Date().toUTCString()}
- Prompt YM Live Price: ${t.sourced?.ym ? `${t.ymPrice.toFixed(0)} (${t.ymChange >= 0 ? '+' : ''}${t.ymChange.toFixed(0)} pts, ${t.ymChangePct >= 0 ? '+' : ''}${t.ymChangePct.toFixed(2)}%)` : t.ymPriceSource === 'CASH_DJI' ? `cash DJIA ${t.ymPrice.toFixed(0)}, not the YM future` : 'Unavailable'}
- S&P 500 (ES): ${t.sourced?.es ? `${t.esPrice.toFixed(2)} (${t.esChangePct >= 0 ? '+' : ''}${t.esChangePct.toFixed(2)}%)` : 'Unavailable'} | Nasdaq (NQ): ${t.sourced?.nq ? `${t.nqPrice.toFixed(2)} (${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}%)` : 'Unavailable'} | Russell (RTY): ${t.sourced?.rty ? `${t.rtyPrice.toFixed(1)} (${t.rtyChangePct >= 0 ? '+' : ''}${t.rtyChangePct.toFixed(2)}%)` : 'Unavailable'}
- Sector rotation: ${t.sourced?.ym && t.sourced?.es && t.sourced?.nq && t.sourced?.rty ? `${rot.rotationRegime} (Leading: ${rot.leadershipSector} | Lagging: ${rot.laggingSector} | YM vs NQ: ${rot.ymVsNqSpreadPct}%)` : 'Unavailable'}
- US 2Y Yield: ${t.sourced?.us2y ? `${t.us2yNominalYield.toFixed(2)}%` : 'Unavailable'} | US 10Y Yield: ${t.sourced?.us10y ? `${t.us10yNominalYield.toFixed(2)}%` : 'Unavailable'}${t.sourced?.us2y && t.sourced?.us10y ? ` (2s10s Spread: ${t.yieldCurve2s10sSpreadBps >= 0 ? '+' : ''}${t.yieldCurve2s10sSpreadBps} bps)` : ''}
- Yield Move Driver: ${t.yieldMoveDriver} (Categorized as Growth-Driven vs Inflation-Driven vs Fed-Driven)
- Growth/Inflation Quadrant: ${t.growthInflationQuadrant}
- Credit Health: HY OAS ${t.sourced?.hyOas ? `${cred.highYieldSpreadBps} bps (${cred.creditStressRegime})` : 'Unavailable'} | HYG: ${t.sourced?.hyg ? `$${cred.hygPrice.toFixed(2)} (${cred.hygChangePct >= 0 ? '+' : ''}${cred.hygChangePct}%)` : 'Unavailable'} | LQD: ${t.sourced?.lqd ? `$${cred.lqdPrice.toFixed(2)}` : 'Unavailable'} | Investment-grade OAS: Unavailable
- DJIA official divisor and full 30-name contribution: Unavailable
- Quoted Dow names this refresh: ${t.advancersCount} advancing vs ${t.declinersCount} declining among names that returned a quote. Do not scale that count to 30.
- Stance: Intraday=${state.today.intraday_bias} | Short-Term=${state.today.short_term_bias} | Medium-Term=${state.today.medium_term_bias}
- Invalidation Criteria: ${state.today.what_would_invalidate_the_current_interpretation}

ACTIVE 11 DRIVERS STATUS:
${driversSummary}

Use this as fundamental context only. Do not infer volume-profile support or CVD absorption.
Growth-driven yield increases may be supportive for cyclical and financial relative performance. That is not a law.
Never invent a Dow-point impact. Use only a contribution already computed in this packet.
Do not issue a trade.
`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    if (!anthropicKey && !openaiKey) {
      const fallbackText = `### DOW JONES INDUSTRIAL AVERAGE FUNDAMENTAL BRIEFING (CME YM)

#### 1. Price-Weighting & Contribution Dynamics
- **Price weighting**: Official DJIA divisor and point contribution are unavailable.

#### 2. Macro, Rates & Cyclical Transmission
- **Treasury Rates**: 2Y **${t.sourced?.us2y ? `${t.us2yNominalYield.toFixed(2)}%` : 'Unavailable'}**, 10Y **${t.sourced?.us10y ? `${t.us10yNominalYield.toFixed(2)}%` : 'Unavailable'}**. YM price source: **${t.ymPriceSource === 'CME_YM' ? 'CME YM' : t.ymPriceSource === 'CASH_DJI' ? 'cash DJIA, not the YM future' : 'Unavailable'}**.
- **Yield Classification**: Classified as **${t.yieldMoveDriver}** — supportive for cyclical industrials and commercial bank margins.
- **Economic Quadrant**: **${t.growthInflationQuadrant}**.

#### 3. Sector Rotation & Credit Health
- **Rotation Regime**: **${t.sourced?.ym && t.sourced?.nq && t.sourced?.es && t.sourced?.rty ? rot.rotationRegime : 'Unavailable'}**.
- **Credit Conditions**: High-yield OAS **${t.sourced?.hyOas ? `${cred.highYieldSpreadBps} bps` : 'Unavailable'}**. HYG **${t.sourced?.hyg ? `$${cred.hygPrice.toFixed(2)}` : 'Unavailable'}**.

#### 4. Active Fundamental Bias
- **Intraday Bias**: **${state.today.intraday_bias}** | **Short-Term**: **${state.today.short_term_bias}** | **Medium-Term**: **${state.today.medium_term_bias}**
- **Invalidation Trigger**: ${state.today.what_would_invalidate_the_current_interpretation}

*Trading Guidance: Fundamental context informs positioning bias. Enter strictly on Volume Profile key levels and CVD delta absorption.*`

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
            logger.warn('[Dow Chat API] Claude streaming failed, trying OpenAI', err)
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
            logger.error('[Dow Chat API] OpenAI streaming failed', err)
          }
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ text: 'Unable to stream Dow analysis at this time.' })}\n\ndata: [DONE]\n\n`
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
    logger.error('[Dow Fundamentals Chat API] Failed to stream chat', err)
    return NextResponse.json({ error: 'Chat stream failed' }, { status: 500 })
  }
}
