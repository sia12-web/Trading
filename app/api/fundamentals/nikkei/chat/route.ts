import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { streamClaudeResponse, streamOpenAIResponse } from '@/lib/ai/leoAssistant'
import { getNikkeiFundamentalState } from '@/lib/fundamentals/nikkeiStateStore'
import { NIKKEI_ANALYST_SYSTEM_PROMPT, NIKKEI_DIVISOR } from '@/lib/fundamentals/nikkeiAnalystConfig'
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
${NIKKEI_ANALYST_SYSTEM_PROMPT}

CURRENT ACTIVE NIKKEI 225 FUNDAMENTAL STATE:
- Market: CME Nikkei 225 USD Futures (Globex: NKD, $5 Multiplier)
- Current Server Time: ${new Date().toUTCString()}
- Prompt NKD Futures Price: ${t.nkdPrice.toFixed(0)} (${t.nkdChange >= 0 ? '+' : ''}${t.nkdChange.toFixed(0)} pts, ${t.nkdChangePct >= 0 ? '+' : ''}${t.nkdChangePct.toFixed(2)}%)
- USD/JPY Rate: ${fx.usdjpyRate.toFixed(2)} (${fx.usdjpyChangePct >= 0 ? '+' : ''}${fx.usdjpyChangePct.toFixed(2)}%) - Regime: ${fx.fxRegime}
- MoF Intervention Alert Status: ${fx.mofInterventionZone ? 'CRITICAL ALERT (155-160 zone)' : 'NORMAL / MODERATE RISK'}
- Bank of Japan Policy Rate: ${boj.uncollateralizedCallRatePct}% | 10Y JGB Yield: ${boj.jgb10yYieldPct}% | Stance: ${boj.policyStance}
- SOX Index (Semiconductors): ${t.soxIndex} (${t.soxChangePct >= 0 ? '+' : ''}${t.soxChangePct.toFixed(2)}%) | Nasdaq-100: ${t.nqPrice}
- Tokyo Cash Session Status: ${t.tokyoCashSessionActive ? 'ACTIVE' : 'CLOSED'} (${t.tokyoSessionPhase})
- Price-Weighting Attribution:
  * Sum of Prices: ¥${contrib.sumSharePricesJpy.toLocaleString()}
  * Top 1 (Fast Retailing): ${contrib.fastRetailingWeightPct}%
  * Top 2 (Tokyo Electron): ${contrib.tokyoElectronWeightPct}%
  * Top 3 (Advantest): ${contrib.advantestWeightPct}%
  * Combined Top 3 Weight: ${contrib.top3ContributionPct}% (${contrib.weightingConcentration} concentration)
  * Total Semiconductor Share: ${contrib.semiconductorSharePct}%
- Intraday Bias: ${state.today.intraday_bias} | Short-Term: ${state.today.short_term_bias}
- Breadth: ${t.advancersCount} Advancers / ${t.declinersCount} Decliners

CORE DRIVERS:
${driversSummary}

LATEST WIRES:
${state.liveHeadlines.map((h) => `- [${h.indexRelevance}] ${h.headline} (${h.source})`).join('\n') || '- Normal trading conditions on Tokyo and CME tapes.'}

Answer with institutional depth, exact index point mechanics, currency beta calculations, and clear session execution guidance.
`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    if (!anthropicKey && !openaiKey) {
      const fallbackText = `### NIKKEI 225 INSTITUTIONAL BRIEFING (CME NKD / JPX CASH)

#### 1. Price-Weighted Index Structure & Tech Concentration
- **Nikkei Divisor**: Using divisor **${NIKKEI_DIVISOR}**, a ¥1,000 price change in any constituent creates **~33.17 Nikkei points** ($165.84 per NKD contract).
- **Concentration**: Top 3 movers (Fast Retailing ${contrib.fastRetailingWeightPct}%, Tokyo Electron ${contrib.tokyoElectronWeightPct}%, Advantest ${contrib.advantestWeightPct}%) command **${contrib.top3ContributionPct}%** of index leverage (**${contrib.weightingConcentration}** regime).
- **Semiconductors**: SOX Index is at **${t.soxIndex}** (+${t.soxChangePct}%), driving positive opening gap momentum for Tokyo Electron fab equipment and Advantest testing hardware.

#### 2. USD/JPY Currency Pass-Through & MoF Danger Zone
- **Spot FX**: USD/JPY holding at **${fx.usdjpyRate.toFixed(2)}** (**${fx.fxRegime}**).
- **Intervention Risk**: ${fx.mofInterventionZone ? 'CRITICAL ALERT (155-160 zone): High risk of rapid Yen short-squeeze.' : 'Normal range: Repatriated exporter earnings remain strong.'}

#### 3. Bank of Japan Monetary Normalization
- **Policy Target**: Overnight call rate at **${boj.uncollateralizedCallRatePct}%**, 10Y JGB at **${boj.jgb10yYieldPct}%** (**${boj.policyStance}**).
- **Sector Rotation**: Rate hikes provide net interest margin expansion for Mega Banks (MUFG 8306) while Shunto wage growth (+5.1%) cements the domestic virtuous wage-inflation loop.

#### 4. Active Fundamental Bias
- **Intraday Bias**: **${state.today.intraday_bias}** | **Short-Term**: **${state.today.short_term_bias}**
- **Tokyo Session Focus**: 09:00-10:00 JST first-hour Initial Balance. Watch for absorption on large overnight US gap opens.`

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
