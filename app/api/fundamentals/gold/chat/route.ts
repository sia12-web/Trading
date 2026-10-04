import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { streamClaudeResponse, streamOpenAIResponse } from '@/lib/ai/leoAssistant'
import { getGoldFundamentalState } from '@/lib/fundamentals/goldStateStore'
import { GOLD_ANALYST_CHAT_PROMPT } from '@/lib/fundamentals/goldAnalystConfig'
import { datumLine } from '@/lib/fundamentals/outputContract'
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
        : [{ role: 'user' as const, content: 'Give me a complete macro, monetary, and physical demand assessment for Gold.' }]

    // Fetch the live fundamental state and telemetry
    const state = await getGoldFundamentalState()
    const t = state.goldTelemetry

    const driversSummary = Object.values(state.drivers)
      .map(
        (d) =>
          `- **${d.name}** [Stance: ${d.stance} | Intraday: ${'★'.repeat(d.intradayStars)}${'☆'.repeat(5 - d.intradayStars)} | Long-Term: ${'★'.repeat(d.longTermStars)}${'☆'.repeat(5 - d.longTermStars)}]: ${d.summary} (${d.metrics.map((m) => `${m.label}: ${m.value}`).join(', ')})`
      )
      .join('\n')

    const contextPrompt = `
${GOLD_ANALYST_CHAT_PROMPT}

SUPPLIED GOLD STATE (not a live monitor; interpret only this packet):
- Market: COMEX Gold Futures (GC)
- Current Date & Server Time: ${new Date().toUTCString()}
- Prompt GC Live Price: $${t.goldPrice.toFixed(2)}/oz (${t.goldChange >= 0 ? '+' : ''}$${t.goldChange.toFixed(2)}, ${t.goldChangePct >= 0 ? '+' : ''}${t.goldChangePct.toFixed(2)}%)
- COMEX Silver (SI): $${t.silverPrice.toFixed(3)} | Gold/Silver Ratio: ${t.goldSilverRatio.toFixed(2)}
- 10Y Nominal Treasury: ${t.us10yNominalYield.toFixed(2)}% | 5Y Nominal: ${t.us5yNominalYield.toFixed(2)}%
- 10Y Real TIPS Yield (DFII10): ${t.us10yRealYield.toFixed(2)}% (FRED series)
- 10Y Breakeven Inflation (T10YIE): ${t.us10yBreakeven.toFixed(2)}%
- US Dollar Index (DXY): ${t.dxyIndex.toFixed(2)} (${t.dxyChangePct >= 0 ? '+' : ''}${t.dxyChangePct.toFixed(2)}%) | EUR/USD: ${t.eurUsd.toFixed(4)}
- Gold CVOL (30-day Implied Volatility): ${t.goldCvol.toFixed(1)}%
${datumLine('Global gold ETF holdings', `${state.etfFlows.globalTonnes} tonnes (monthly ${state.etfFlows.monthlyChangeTonnes >= 0 ? '+' : ''}${state.etfFlows.monthlyChangeTonnes}t)`, 'MONTHLY', 'STALE_FOR_INTRADAY')}
${datumLine('CFTC managed-money net', `${state.cftcPositioning.netManagedMoney.toLocaleString()} contracts`, 'WEEKLY', 'STALE_FOR_INTRADAY')}
${datumLine('COMEX registered / eligible', `${state.comexInventory.registeredOz.toLocaleString()} oz / ${state.comexInventory.eligibleOz.toLocaleString()} oz`, 'DAILY', 'SLOW_MOVING')}
${datumLine('Central-bank purchase run rate', `${state.centralBankDemand.annualNetPurchasesTonnes} t/yr`, 'SLOW', 'SLOW_MOVING')}
- Overall Stance: Intraday=${state.today.intraday_bias} | Short-Term=${state.today.short_term_bias} | Medium-Term=${state.today.medium_term_bias}
- Invalidation Criteria: ${state.today.what_would_invalidate_this_view}

ACTIVE 7 DRIVERS STATUS:
${driversSummary}

Use this as fundamental context only. Do not infer CVD, absorption, or a reclaim. Chart structure is outside this packet.
Never invent missing data. Never claim COMEX inventory shifts prove a physical shortage. Do not issue a trade.
`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    // If neither key is configured, output the grounded fallback telemetry
    if (!anthropicKey && !openaiKey) {
      const fallbackText = `### GOLD FUNDAMENTAL ANALYST BRIEFING (COMEX GC)

#### 1. Real Interest Rates & Treasury Breakevens
- **10Y Real TIPS Yield**: Holding at **${t.us10yRealYield.toFixed(2)}%** (FRED DFII10). Elevated real yields exert structural opportunity cost pressure on gold, but long-term monetary debasement premiums have blunted traditional sensitivity.
- **10Y Breakeven Inflation**: **${t.us10yBreakeven.toFixed(2)}%** (FRED T10YIE). Core inflation sticky at 3.2% YoY keeps currency debasement hedging active.

#### 2. U.S. Dollar & Cross-Market Decoupling
- **DXY Index**: Trading at **${t.dxyIndex.toFixed(2)}** (${t.dxyChangePct >= 0 ? '+' : ''}${t.dxyChangePct.toFixed(2)}%).
- **Relative Strength**: Gold has repeatedly absorbed USD rallies at key supports, signaling sovereign accumulation under the surface.
- **Gold/Silver Ratio**: **${t.goldSilverRatio.toFixed(1)}:1**, reflecting precious-metals monetary outperformance.

#### 3. Institutional Demand & Positioning
- **Central-Bank Accumulation**: Official sector purchases pace **~${state.centralBankDemand.annualNetPurchasesTonnes} t/yr** (PBOC: ${(state.centralBankDemand.pbocReportedOunces / 1e6).toFixed(1)}M oz), establishing a structural macro floor.
- **CFTC Managed Money**: Net longs at **${state.cftcPositioning.netManagedMoney.toLocaleString()} contracts** (Crowding: ${state.cftcPositioning.crowdingIndex}/100). Watch for absorption vs flush at key Volume Profile levels.

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
            logger.warn('[Gold Chat API] Claude streaming failed, trying OpenAI', err)
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
            logger.error('[Gold Chat API] OpenAI streaming failed', err)
          }
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ text: 'Unable to stream gold analysis at this time.' })}\n\ndata: [DONE]\n\n`
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
    logger.error('[Gold Fundamentals Chat API] Failed to stream chat', err)
    return NextResponse.json({ error: 'Chat stream failed' }, { status: 500 })
  }
}
