import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { streamClaudeResponse, streamOpenAIResponse } from '@/lib/ai/leoAssistant'
import { getNikkeiFundamentalState } from '@/lib/fundamentals/nikkeiStateStore'
import { NIKKEI_ANALYST_CHAT_PROMPT, NIKKEI_DIVISOR } from '@/lib/fundamentals/nikkeiAnalystConfig'
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
    const boj = state.boj
    const fx = state.fx
    const contrib = state.contribution

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
- Prompt NKD Futures Price: ${t.nkdPrice.toFixed(0)} (${t.nkdChange >= 0 ? '+' : ''}${t.nkdChange.toFixed(0)} pts, ${t.nkdChangePct >= 0 ? '+' : ''}${t.nkdChangePct.toFixed(2)}%)
- USD/JPY Rate: ${fx.usdjpyRate.toFixed(2)} (${fx.usdjpyChangePct >= 0 ? '+' : ''}${fx.usdjpyChangePct.toFixed(2)}%) - Regime: ${fx.fxRegime}
- MOF_INTERVENTION_RISK: ${fx.mofInterventionZone ? 'HIGH' : 'LOW'} | frequency=DERIVED | freshness=RECENT. This is a supplied proxy, not a promise to intervene at a price.
- Bank of Japan Policy Rate: ${boj.uncollateralizedCallRatePct}% | 10Y JGB Yield: ${boj.jgb10yYieldPct}% | Stance: ${boj.policyStance}
- SOX Index (Semiconductors): ${t.soxIndex} (${t.soxChangePct >= 0 ? '+' : ''}${t.soxChangePct.toFixed(2)}%) | Nasdaq-100: ${t.nqPrice}
- Tokyo Cash Session Status: ${t.tokyoCashSessionActive ? 'ACTIVE' : 'CLOSED'} (${t.tokyoSessionPhase})
- CURRENT NIKKEI CONTRIBUTORS (supplied weights, freshness=STALE_FOR_INTRADAY unless a live index feed replaced the baseline). Do not recall a different percentage.
  * Sum of prices: ¥${contrib.sumSharePricesJpy.toLocaleString()}
  * 9983: ${contrib.fastRetailingWeightPct}%
  * 8035: ${contrib.tokyoElectronWeightPct}%
  * 6857: ${contrib.advantestWeightPct}%
  * Combined Top 3 Weight: ${contrib.top3ContributionPct}% (${contrib.weightingConcentration} concentration)
  * Total Semiconductor Share: ${contrib.semiconductorSharePct}%
- Intraday Bias: ${state.today.intraday_bias} | Short-Term: ${state.today.short_term_bias}
- Breadth: ${t.advancersCount} Advancers / ${t.declinersCount} Decliners

CORE DRIVERS:
${driversSummary}

LATEST WIRES:
${state.liveHeadlines.map((h) => `- [${h.indexRelevance}] ${h.headline} (${h.source})`).join('\n') || '- Normal trading conditions on Tokyo and CME tapes.'}

Answer in prose. Describe what to watch. Do not give a trade instruction. Do not invent a point contribution or an intervention price.
`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    if (!anthropicKey && !openaiKey) {
      const nkdHasLive = Number.isFinite(t.nkdPrice) && t.nkdPrice > 0
      const nkdPriceStr = nkdHasLive
        ? `¥${t.nkdPrice.toLocaleString()} (${t.nkdChange >= 0 ? '+' : ''}${t.nkdChange} pts, ${t.nkdChangePct >= 0 ? '+' : ''}${t.nkdChangePct.toFixed(2)}%)`
        : 'UNAVAILABLE'
      const fxStr =
        Number.isFinite(fx.usdjpyRate) && fx.usdjpyRate > 0
          ? `USD/JPY: ${fx.usdjpyRate.toFixed(2)} (${fx.fxRegime})`
          : 'UNAVAILABLE'
      const bojStr = Number.isFinite(boj.uncollateralizedCallRatePct)
        ? `Call Rate: ${boj.uncollateralizedCallRatePct}% | 10Y JGB: ${boj.jgb10yYieldPct}% (${boj.policyStance})`
        : 'UNAVAILABLE'

      const fallbackText = `### NIKKEI 225 INSTITUTIONAL BRIEFING (CME NKD / JPX CASH)

**Market**: CME Nikkei 225 Futures (NKD) | Live Telemetry: **${nkdPriceStr}**  
**FX Channel**: **${fxStr}**  
**BoJ Policy Stance**: **${bojStr}**

---

#### 1. Price-Weighted Index Structure & Tech Concentration
- **Nikkei Divisor Constant**: JPX divisor **${NIKKEI_DIVISOR}** (¥1,000 price change in constituent creates **~33.17 Nikkei points**).
- **Concentration**: ${contrib.top3ContributionPct != null ? `Top 3 movers command **${contrib.top3ContributionPct}%** of index leverage (${contrib.weightingConcentration || 'UNAVAILABLE'} regime).` : 'Concentration metrics: UNAVAILABLE.'}
- **Semiconductors**: SOX Index: ${Number.isFinite(t.soxIndex) ? `${t.soxIndex} (${t.soxChangePct >= 0 ? '+' : ''}${t.soxChangePct}%)` : 'UNAVAILABLE'}.

#### 2. USD/JPY Currency Pass-Through & Intervention Risk
- **Spot FX**: ${fxStr}.
- **MOF_INTERVENTION_RISK**: ${fx.mofInterventionZone != null ? (fx.mofInterventionZone ? 'HIGH (supplied proxy). Not a fixed intervention price.' : 'LOW (supplied proxy).') : 'UNAVAILABLE'}.

#### 3. Bank of Japan Monetary Policy
- **Policy Rates**: ${bojStr}.

#### 4. Active Fundamental Bias
- **Intraday Bias**: **${state.today.intraday_bias || 'UNAVAILABLE'}** | **Short-Term**: **${state.today.short_term_bias || 'UNAVAILABLE'}**
- **Tokyo Session Focus**: 09:00-10:00 JST first-hour Initial Balance.

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
