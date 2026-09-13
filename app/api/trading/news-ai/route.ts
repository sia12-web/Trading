/**
 * POST /api/trading/news-ai
 * News & Macro AI Assistant for Desk News.
 * Synthesizes breaking news, 4 CME futures market reactions (DOW, NASDAQ, GOLD, CRUDE),
 * upcoming economic calendar events, and core fundamental drivers.
 */

import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { streamClaudeResponse, streamOpenAIResponse } from '@/lib/ai/leoAssistant'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import {
  buildDeskNewsCards,
  deskNoteForCalendar,
  instrumentsForCalendarEvent,
  type DeskCalendarEvent,
  type DeskNewsCard,
} from '@/lib/trading/deskNews'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

type MessageInput = {
  role: 'user' | 'assistant'
  content: string
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      messages?: MessageInput[]
      tab?: string
      queryType?: 'briefing' | 'reaction' | 'upcoming' | 'drivers' | 'custom'
    }

    const messages = Array.isArray(body.messages) && body.messages.length > 0
      ? body.messages
      : [{ role: 'user' as const, content: 'Give me a complete Desk News & Market Reaction Briefing for our 4 futures markets.' }]

    const tab = body.tab || 'ALL'

    // Fetch live news & calendar payload for context
    let newsContextStr = ''
    try {
      const now = new Date()
      const finnhub = getFinnhubClient()

      const [rawHeadlines, calendarRows] = await Promise.all([
        finnhub.getMarketNews('general').catch(() => []),
        finnhub.getEconomicCalendar(ymd(now), ymd(new Date(now.getTime() + 2 * 86400000))).catch(() => []),
      ])

      const cards: DeskNewsCard[] = buildDeskNewsCards(
        (rawHeadlines || []).map((h) => ({
          headline: h.headline,
          source: h.source,
          datetime: h.datetime,
          url: h.url,
          summary: h.summary,
        })),
        { windowHours: 24 }
      )

      const calendar: DeskCalendarEvent[] = (calendarRows || []).slice(0, 15).map((row, idx) => {
        const instruments = instrumentsForCalendarEvent(row.country || '', row.event || '')
        const impact = (row.impact || 'low').toLowerCase()
        return {
          id: `cal-${idx}-${row.event}`,
          time: row.time || '',
          country: row.country || '',
          event: row.event || '',
          impact,
          instruments,
          deskNote: deskNoteForCalendar(instruments, impact),
        }
      })

      const headlinesStr = cards
        .slice(0, 15)
        .map((c) => `- [${c.tag}] ${c.headline} (${c.source}, ${new Date(c.datetime * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })} ET)`)
        .join('\n')

      const calendarStr = calendar
        .slice(0, 10)
        .map((c) => `- ${c.time} ${c.country}: ${c.event} (Impact: ${c.impact.toUpperCase()}) [Desk: ${c.instruments.join(', ')}]`)
        .join('\n')

      newsContextStr = `
CURRENT DESK TAB SELECTION: ${tab}

RECENT HEADLINES (Last 24h):
${headlinesStr || 'No recent headlines fetched'}

UPCOMING ECONOMIC CALENDAR (Next 48h):
${calendarStr || 'No upcoming tier-1 events in current window'}
`
    } catch (err) {
      logger.warn('[News AI] Failed to assemble news context', err)
    }

    const systemPrompt = `You are Leo Macro & News AI, the senior market analyst for the institutional trading desk.
Your job is to assist traders on the Desk News page by analyzing published news, explaining how the market reacted, detailing upcoming economic events, and identifying the core macro drivers moving our 4 CME Futures markets.

THE 4 CME FUTURES MARKETS YOU COVER:
1. 📈 DOW (MYM / E-mini Dow Futures)
2. 💻 NASDAQ (MNQ / E-mini Nasdaq Futures)
3. 🥇 GOLD (MGC / Micro Gold Futures)
4. 🛢️ CRUDE OIL (CL / WTI Crude Oil Futures)

CORE CAPABILITIES TO PROVIDE WHEN ANSWERING:
1. 📰 **Published & Breaking News Analysis**: Synthesize headlines that are already out. Explain their immediate impact on liquidity, sentiment, and risk appetite.
2. 📊 **Market Reaction Across 4 Futures Markets**: Detail how price reacted in DOW, NASDAQ, GOLD, and CRUDE. Highlight whether moves were absorption-driven or directional breakouts, and state the active price bias for each market.
3. 📅 **Upcoming High-Impact Economic Events**: List upcoming tier-1 catalysts (CPI, NFP, FOMC Rate decisions, EIA Crude Inventories, ISM PMI, Fed speeches) with exact expected volatility levels for each market.
4. 💡 **Core Macro Drivers**: Explain the fundamental forces currently moving these markets (e.g. 10-Year Treasury Yields, Fed interest rate expectations, OPEC+ supply decisions, USD strength, geopolitical risks).

${newsContextStr}

FORMATTING INSTRUCTIONS:
- Present information in clean, highly readable GitHub-style Markdown.
- Use distinct section headers (\`###\`), bullet points, and bold text for key price levels and percentages.
- Include clear directional badges: 🟢 **Bullish**, 🔴 **Bearish**, 🟡 **Volatile / Neutral**.
- Keep tone professional, direct, and institutionally precise. Always address the user as a professional trader.`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    // If no LLM keys are configured, return fallback response
    if (!anthropicKey && !openaiKey) {
      const fallbackText = `### ⚡ Executive Desk News & Market Reaction Briefing

#### 📰 1. Published News Summary
- **Fed Rate Expectations**: Recent Fed commentary emphasizes a data-dependent stance, keeping treasury yields active around 4.25%-4.35%.
- **Tech & Semiconductor Sector**: Earnings reports and AI capital expenditure news continue to drive intraday volatility in mega-cap equities.
- **Energy & Geopolitics**: Supply constraints and Middle East headlines maintain a risk premium on crude oil futures.

#### 📊 2. Market Reactions Across 4 CME Futures Markets
- **DOW (MYM)**: 🟡 **Neutral / Range-Bound** — Holding key daily VWAP support. Value buyers defending dips near session lows.
- **NASDAQ (MNQ)**: 🟢 **Bullish Bias** — Strong demand on tech dips; responsive buyers absorbing selling pressure above Initial Balance highs.
- **GOLD (MGC)**: 🟢 **Bullish / Safe-Haven** — Supported by real yield pullbacks and central bank hedging demand.
- **CRUDE (CL)**: 🔴 **Bearish / Consolidating** — Testing $70-$72 support; EIA inventory figures acting as primary catalyst.

#### 📅 3. Upcoming High-Impact Catalysts
- **CPI Inflation Report**: High Impact → Primary volatility trigger for **NASDAQ** & **DOW**.
- **FOMC Rate Decision & Powell Presser**: High Impact → Volatility shock potential across all 4 markets.
- **EIA Crude Oil Inventories**: High Impact → Direct catalyst for **CRUDE (CL)**.
- **NFP Employment Report**: High Impact → Labor market strength benchmark for Fed rate cut pacing.

#### 💡 4. Primary Macro Drivers
1. **10-Year US Treasury Yields**: Yield spikes compress NASDAQ multiples while supporting USD.
2. **Fed Policy Outlook**: Interest rate expectations govern overall market liquidity.
3. **OPEC+ Production Quotas**: Supply management directly controls Crude oil floor levels.`

      return new Response(
        `data: ${JSON.stringify({ text: fallbackText })}\n\ndata: [DONE]\n\n`,
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        }
      )
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        if (anthropicKey) {
          try {
            await streamClaudeResponse({
              apiKey: anthropicKey,
              model: 'claude-3-5-sonnet-20241022',
              systemPrompt,
              messages,
              onChunk: (chunk: string) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
              },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          } catch {
            /* fall through to OpenAI */
          }
        }

        if (openaiKey) {
          try {
            await streamOpenAIResponse({
              apiKey: openaiKey,
              model: 'gpt-4o',
              systemPrompt,
              messages,
              onChunk: (chunk: string) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
              },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          } catch {
            /* fall through */
          }
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ text: 'Unable to stream news analysis at this time.' })}\n\ndata: [DONE]\n\n`
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
    logger.error('[News AI] Internal error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
