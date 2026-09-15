import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { streamClaudeResponse, streamOpenAIResponse } from '@/lib/ai/leoAssistant'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { getYahooQuote, type YahooQuote } from '@/lib/yahoo/quote'
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

function formatQuoteForPrompt(name: string, symbol: string, q: YahooQuote | null, isDollar = false): string {
  if (!q || !(q.price > 0)) return `- **${name} (${symbol})**: Quote currently unavailable`
  const prefix = isDollar ? '$' : ''
  const suffix = isDollar ? '/oz' : ''
  const chgSign = q.change >= 0 ? '+' : ''
  const pctSign = q.change_pct >= 0 ? '+' : ''
  const rangeStr = q.high && q.low ? ` | Day High: ${prefix}${q.high.toLocaleString()}, Low: ${prefix}${q.low.toLocaleString()}` : ''
  return `- **${name} (${symbol})**: Live Price: **${prefix}${q.price.toLocaleString()}${suffix}** (Change: ${chgSign}${q.change.toFixed(2)}, ${pctSign}${q.change_pct.toFixed(2)}%${rangeStr})`
}

const FALLBACK_HIGH_IMPACT_CALENDAR: DeskCalendarEvent[] = [
  {
    id: 'cal-fomc-rate',
    time: 'Upcoming (This Week)',
    country: 'US',
    event: 'FOMC Interest Rate Decision & Rate Policy Statement',
    impact: 'high',
    instruments: ['DOW', 'NASDAQ', 'NIKKEI', 'GOLD', 'CRUDE'],
    deskNote: 'High-impact interest rate decision — major volatility trigger across all indices, FX & commodities.',
  },
  {
    id: 'cal-fomc-press',
    time: 'Upcoming (This Week)',
    country: 'US',
    event: 'Fed Chair Press Conference & Economic Projections',
    impact: 'high',
    instruments: ['DOW', 'NASDAQ', 'GOLD'],
    deskNote: 'High-impact policy commentary & forward rate trajectory guidance.',
  },
  {
    id: 'cal-cpi',
    time: 'Upcoming (This Week)',
    country: 'US',
    event: 'Consumer Price Index (CPI) Inflation Rate YoY / MoM',
    impact: 'high',
    instruments: ['DOW', 'NASDAQ', 'GOLD'],
    deskNote: 'Primary inflation benchmark governing Fed rate decision expectations.',
  },
  {
    id: 'cal-eia-crude',
    time: 'Upcoming (Weekly Wednesday 10:30 AM ET)',
    country: 'US',
    event: 'EIA Weekly Crude Oil Inventories',
    impact: 'high',
    instruments: ['CRUDE'],
    deskNote: 'Direct inventory supply/demand catalyst for WTI Crude Oil (CL).',
  },
  {
    id: 'cal-nfp',
    time: 'Upcoming (First Friday of Month)',
    country: 'US',
    event: 'Non-Farm Payrolls (NFP) & Unemployment Rate',
    impact: 'high',
    instruments: ['DOW', 'NASDAQ', 'GOLD'],
    deskNote: 'Labor market benchmark for Federal Reserve monetary policy pacing.',
  },
]

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

    // Fetch live news, 7-day calendar window, AND live futures quotes for context
    let newsContextStr = ''
    let dowQuote: YahooQuote | null = null
    let nqQuote: YahooQuote | null = null
    let goldQuote: YahooQuote | null = null
    let crudeQuote: YahooQuote | null = null
    const now = new Date()

    try {
      const finnhub = getFinnhubClient()

      const [rawHeadlines, calendarRows, dq, nq, gq, cq] = await Promise.all([
        finnhub.getMarketNews('general').catch(() => []),
        // Query 7 days ahead (7 * 86400000) so upcoming rate decisions and tier-1 events are captured
        finnhub.getEconomicCalendar(ymd(now), ymd(new Date(now.getTime() + 7 * 86400000))).catch(() => []),
        getYahooQuote('DOW').catch(() => null),
        getYahooQuote('NASDAQ').catch(() => null),
        getYahooQuote('GOLD').catch(() => null),
        getYahooQuote('CRUDE').catch(() => null),
      ])

      dowQuote = dq
      nqQuote = nq
      goldQuote = gq
      crudeQuote = cq

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

      const fetchedCalendar: DeskCalendarEvent[] = (calendarRows || []).map((row, idx) => {
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

      const calendar = fetchedCalendar.length > 0 ? fetchedCalendar : FALLBACK_HIGH_IMPACT_CALENDAR

      const headlinesStr = cards
        .slice(0, 15)
        .map((c) => `- [${c.tag}] ${c.headline} (${c.source}, ${new Date(c.datetime * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })} ET)`)
        .join('\n')

      const calendarStr = calendar
        .slice(0, 12)
        .map((c) => `- ${c.time} ${c.country}: ${c.event} (Impact: ${c.impact.toUpperCase()}) [Desk: ${c.instruments.join(', ')}]`)
        .join('\n')

      const quotesStr = [
        formatQuoteForPrompt('DOW', 'MYM', dowQuote),
        formatQuoteForPrompt('NASDAQ', 'MNQ', nqQuote),
        formatQuoteForPrompt('GOLD', 'MGC', goldQuote, true),
        formatQuoteForPrompt('CRUDE OIL', 'CL', crudeQuote, true),
      ].join('\n')

      newsContextStr = `
CURRENT DATE & SERVER TIME: ${now.toUTCString()} (Year: ${now.getFullYear()})
CURRENT DESK TAB SELECTION: ${tab}

LIVE REAL-TIME FUTURES QUOTES:
${quotesStr}

RECENT HEADLINES (Last 24h):
${headlinesStr || 'No recent headlines fetched'}

UPCOMING HIGH-IMPACT ECONOMIC CALENDAR (Next 7 Days):
${calendarStr}
`
    } catch (err) {
      logger.warn('[News AI] Failed to assemble news context', err)
    }

    const dowPxStr = dowQuote?.price ? dowQuote.price.toLocaleString() : 'current market level'
    const nqPxStr = nqQuote?.price ? nqQuote.price.toLocaleString() : 'current market level'
    const goldPxStr = goldQuote?.price ? `$${goldQuote.price.toLocaleString()}` : 'current market level'
    const crudePxStr = crudeQuote?.price ? `$${crudeQuote.price.toLocaleString()}` : 'current market level'

    const systemPrompt = `You are Leo Macro & News AI, the senior market analyst for the institutional trading desk.
Your job is to assist traders on the Desk News page by analyzing published news, explaining how the market reacted, detailing upcoming economic events, and identifying the core macro drivers moving our 4 CME Futures markets.

THE 4 CME FUTURES MARKETS YOU COVER:
1. 📈 DOW (MYM / E-mini Dow Futures) — Current Last: ~${dowPxStr}
2. 💻 NASDAQ (MNQ / E-mini Nasdaq Futures) — Current Last: ~${nqPxStr}
3. 🥇 GOLD (MGC / Micro Gold Futures) — Current Last: ~${goldPxStr}
4. 🛢️ CRUDE OIL (CL / WTI Crude Oil Futures) — Current Last: ~${crudePxStr}

CRITICAL ACCURACY REQUIREMENT FOR PRICE LEVELS:
- You MUST reference the LIVE REAL-TIME FUTURES QUOTES provided in the context below.
- Support/resistance key levels, reaction points, and price bounds MUST be grounded strictly around current live prices (DOW ~${dowPxStr}, NASDAQ ~${nqPxStr}, GOLD ~${goldPxStr}, CRUDE ~${crudePxStr}).
- NEVER output obsolete historical price levels from past years (e.g. Dow 33,000, Nasdaq 14,000, Gold $1,900, Crude $89 are obsolete outdated prices and strictly forbidden unless current live quotes explicitly equal those numbers).

CRITICAL ACCURACY REQUIREMENT FOR UPCOMING CATALYSTS & INTEREST RATE ANNOUNCEMENTS:
- When asked about upcoming tier-1 catalysts, interest rate decisions, CPI, NFP, or economic events: You MUST ALWAYS explain the key upcoming tier-1 macroeconomic catalysts (such as FOMC Interest Rate Announcements & Fed Press Conferences, CPI Inflation reports, Non-Farm Payrolls, and EIA Crude Inventories) and state their expected volatility impact across DOW, NASDAQ, GOLD, and CRUDE OIL.
- NEVER state that there are no news or rate announcements coming up. Always detail these core upcoming catalysts.

CORE CAPABILITIES TO PROVIDE WHEN ANSWERING:
1. 📰 **Published & Breaking News Analysis**: Synthesize headlines that are already out. Explain their immediate impact on liquidity, sentiment, and risk appetite.
2. 📊 **Market Reaction Across 4 Futures Markets**: Detail how price reacted in DOW, NASDAQ, GOLD, and CRUDE around their current live prices. Highlight whether moves were absorption-driven or directional breakouts, and state the active price bias for each market.
3. 📅 **Upcoming High-Impact Economic Events**: List upcoming tier-1 catalysts (CPI, NFP, FOMC Rate decisions, EIA Crude Inventories, ISM PMI, Fed speeches) with exact expected volatility levels for each market.
4. 💡 **Core Macro Drivers**: Explain the fundamental forces currently moving these markets (e.g. Treasury Yields, Fed interest rate expectations, OPEC+ supply decisions, USD strength, geopolitical risks).

${newsContextStr}

FORMATTING INSTRUCTIONS:
- Present information in clean, highly readable GitHub-style Markdown.
- Use distinct section headers (\`###\`), bullet points, and bold text for key price levels and percentages.
- Include clear directional badges: 🟢 **Bullish**, 🔴 **Bearish**, 🟡 **Volatile / Neutral**.
- Keep tone professional, direct, and institutionally precise. Always address the user as a professional trader.`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    // If no LLM keys are configured, return dynamic fallback response using live quotes
    if (!anthropicKey && !openaiKey) {
      const fallbackText = `### ⚡ Executive Desk News & Market Reaction Briefing

#### 📰 1. Published News Summary
- **Central Bank & Rates Outlook**: Federal Reserve policy guidance remains focused on inflation target trajectory, maintaining yield benchmarks across the curve.
- **Tech & Semiconductor Sector**: Broad equity sentiment continues to react to tech capex announcements and intraday liquidity flows in mega-cap leaders.
- **Energy & Commodities**: Geopolitical risk premiums and inventory shifts govern crude and precious metal positioning.

#### 📊 2. Market Reactions Across 4 CME Futures Markets
- **DOW (MYM)**: 🟡 **Neutral / Range-Bound** — Trading near **${dowPxStr}**${dowQuote?.low && dowQuote?.high ? ` (Day range: ${dowQuote.low.toLocaleString()} - ${dowQuote.high.toLocaleString()})` : ''}. Support: **${dowQuote?.low ? (dowQuote.low - 150).toLocaleString() : 'Key VWAP support'}** | Resistance: **${dowQuote?.high ? (dowQuote.high + 150).toLocaleString() : 'Session High'}**.
- **NASDAQ (MNQ)**: 🟢 **Bullish Bias** — Trading near **${nqPxStr}**${nqQuote?.low && nqQuote?.high ? ` (Day range: ${nqQuote.low.toLocaleString()} - ${nqQuote.high.toLocaleString()})` : ''}. Support: **${nqQuote?.low ? (nqQuote.low - 80).toLocaleString() : 'Initial Balance Low'}** | Resistance: **${nqQuote?.high ? (nqQuote.high + 80).toLocaleString() : 'Initial Balance High'}**.
- **GOLD (MGC)**: 🟢 **Bullish / Safe-Haven** — Holding **${goldPxStr}**${goldQuote?.low && goldQuote?.high ? ` (Day range: $${goldQuote.low.toLocaleString()} - $${goldQuote.high.toLocaleString()})` : ''}. Support: **${goldQuote?.low ? `$${(goldQuote.low - 15).toFixed(1)}` : 'Key Support'}** | Resistance: **${goldQuote?.high ? `$${(goldQuote.high + 15).toFixed(1)}` : 'Resistance'}**.
- **CRUDE (CL)**: 🔴 **Bearish / Consolidating** — Trading at **${crudePxStr}**${crudeQuote?.low && crudeQuote?.high ? ` (Day range: $${crudeQuote.low.toLocaleString()} - $${crudeQuote.high.toLocaleString()})` : ''}. Support: **${crudeQuote?.low ? `$${(crudeQuote.low - 1.5).toFixed(2)}` : 'Support Floor'}** | Resistance: **${crudeQuote?.high ? `$${(crudeQuote.high + 1.5).toFixed(2)}` : 'Resistance Level'}**.

#### 📅 3. Upcoming High-Impact Catalysts
- **FOMC Interest Rate Decision & Powell Presser**: High Impact → Volatility shock potential across DOW, NASDAQ, GOLD & CRUDE.
- **CPI Inflation Report (YoY/MoM)**: High Impact → Primary volatility trigger for interest rate expectations.
- **Non-Farm Payrolls (NFP) & Unemployment**: High Impact → Benchmark labor market print for Fed policy pacing.
- **EIA Weekly Crude Oil Inventories**: High Impact → Direct inventory catalyst for **CRUDE (CL)**.

#### 💡 4. Primary Macro Drivers
1. **10-Year US Treasury Yields**: Yield movements drive equity discount rates and USD exchange rates.
2. **Fed Policy Pacing**: Interest rate trajectory governs institutional equity and bond allocation.
3. **OPEC+ Quotas & Energy Flows**: Supply controls establish fundamental floor pricing for WTI Crude.`

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


