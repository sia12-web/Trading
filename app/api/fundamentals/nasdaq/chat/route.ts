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
- Prompt NQ Live Price: ${t.nqPrice.toFixed(2)} (${t.nqChange >= 0 ? '+' : ''}${t.nqChange.toFixed(2)}, ${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}%)
- S&P 500 (ES): ${t.esPrice.toFixed(2)} (${t.esChangePct >= 0 ? '+' : ''}${t.esChangePct.toFixed(2)}%) | Dow (YM): ${t.ymPrice.toFixed(0)} (${t.ymChangePct >= 0 ? '+' : ''}${t.ymChangePct.toFixed(2)}%)
- Relative Strength Stance: ${t.relativeStrengthStance}
- US 2Y Yield: ${t.us2yNominalYield.toFixed(2)}% | US 10Y Yield: ${t.us10yNominalYield.toFixed(2)}% (2s10s Spread: +${t.yieldCurve2s10sSpreadBps} bps)
- 10Y Real TIPS Yield (DFII10): ${t.us10yRealYield.toFixed(2)}%
- CBOE Volatility: VXN (Nasdaq-100 Vol) ${t.vxnIndex.toFixed(1)} | VIX ${t.vixIndex.toFixed(1)}
- Semiconductor Basket: ${t.semiBasketChangePct >= 0 ? '+' : ''}${t.semiBasketChangePct.toFixed(2)}%
- Market Breadth: ${state.breadth.advancingCount} Advancing vs ${state.breadth.decliningCount} Declining (Ratio ${state.breadth.advanceDeclineRatio.toFixed(2)}:1) | Stance: ${state.breadth.marketParticipationStance}
- AI / Semi Capex: Hyperscalers pacing ~$${state.semiCycle.hyperscalerCapexRunRateBillions}B/yr | Accelerator Trend: ${state.semiCycle.acceleratorDemandTrend}
- Constituent weights below are supplied state, freshness=STALE_FOR_INTRADAY unless a live index feed replaced the baseline. If a weight is missing, say UNAVAILABLE. Do not substitute a memorized Nasdaq-100 weight.
- Supplied constituents: ${t.topConstituents.slice(0, 5).map((c) => `${c.symbol} (${c.weight}% wt: $${c.price} ${c.changePct >= 0 ? '+' : ''}${c.changePct}%)`).join(', ') || 'UNAVAILABLE'}
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
      const nqHasLive = Number.isFinite(t.nqPrice) && t.nqPrice > 0
      const nqPriceStr = nqHasLive
        ? `${t.nqPrice.toLocaleString()} (${t.nqChange >= 0 ? '+' : ''}${t.nqChange.toFixed(2)} pts, ${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}%)`
        : 'UNAVAILABLE'
      const yieldStr =
        Number.isFinite(t.us2yNominalYield) && Number.isFinite(t.us10yNominalYield)
          ? `2Y: ${t.us2yNominalYield.toFixed(2)}% | 10Y: ${t.us10yNominalYield.toFixed(2)}% (2s10s spread: +${t.yieldCurve2s10sSpreadBps} bps)`
          : 'UNAVAILABLE'
      const realYieldStr = Number.isFinite(t.us10yRealYield) ? `${t.us10yRealYield.toFixed(2)}%` : 'UNAVAILABLE'
      const volStr =
        Number.isFinite(t.vxnIndex) && Number.isFinite(t.vixIndex)
          ? `VXN: ${t.vxnIndex.toFixed(2)} | VIX: ${t.vixIndex.toFixed(2)}`
          : 'UNAVAILABLE'

      const fallbackText = `### NASDAQ-100 FUNDAMENTAL ANALYST BRIEFING (CME NQ)

**Market**: CME E-mini Nasdaq-100 (NQ) | Live Telemetry: **${nqPriceStr}**  
**Treasury Rates**: **${yieldStr}**  
**Volatility Environment**: **${volStr}**

---

#### 1. Rates & Growth Valuation Discounting
- **Treasury Transmission**: ${yieldStr}.
- **10Y Real TIPS Yield**: ${realYieldStr} (FRED DFII10).

#### 2. Cross-Market Leadership & Breadth
- **Relative Strength**: **${t.relativeStrengthStance || 'UNAVAILABLE'}** (NQ vs ES vs YM).
- **Market Breadth**: Advancing: ${state.breadth?.advancingCount ?? 'UNAVAILABLE'} vs Declining: ${state.breadth?.decliningCount ?? 'UNAVAILABLE'} (${state.breadth?.marketParticipationStance || 'UNAVAILABLE'}).
- **Semiconductor Cycle Basket**: ${Number.isFinite(t.semiBasketChangePct) ? `${t.semiBasketChangePct >= 0 ? '+' : ''}${t.semiBasketChangePct.toFixed(2)}%` : 'UNAVAILABLE'}.

#### 3. Volatility & Bias
- **Implied Volatility**: ${volStr}.
- **Active Fundamental Bias**: Intraday: **${state.today.intraday_bias || 'UNAVAILABLE'}** | Short-Term: **${state.today.short_term_bias || 'UNAVAILABLE'}**.
- **Invalidation Trigger**: ${state.today.what_would_invalidate_the_current_interpretation || 'UNAVAILABLE'}

*Notice: Zero-placeholder policy active. Unverified fields are strictly marked UNAVAILABLE.*`

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
