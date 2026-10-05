import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { streamClaudeResponse, streamOpenAIResponse } from '@/lib/ai/leoAssistant'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { getYahooQuote, yahooPrintAgeSec, type YahooQuote } from '@/lib/yahoo/quote'
import { buildDeskNewsSystemPrompt } from '@/lib/trading/deskNewsPrompt'
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

function sourceReliability(source: string): 'PRIMARY' | 'SECONDARY' | 'UNKNOWN' {
  const s = source.toLowerCase()
  if (/\b(reuters|bloomberg|dow jones|associated press|ap news|bls|federal reserve|bank of japan|ministry of finance|opec)\b/.test(s)) {
    return 'PRIMARY'
  }
  if (!s.trim()) return 'UNKNOWN'
  return 'SECONDARY'
}

function formatQuoteForPrompt(
  analysis: string,
  executionAlias: string,
  q: YahooQuote | null
): string {
  if (!q || !(q.price > 0)) {
    return `- **${analysis}** (execution alias ${executionAlias}): Quote unavailable`
  }
  const age = yahooPrintAgeSec(q)
  const ageStr = age == null ? 'unknown' : `${Math.round(age)}s`
  const ts = q.timestamp > 0 ? new Date(q.timestamp * 1000).toISOString() : 'unknown'
  const freshness =
    q.delayedBySec > 0
      ? `DELAYED (provider advertises ~${q.delayedBySec}s; not exchange-grade)`
      : 'UNVERIFIED (do not treat as exchange-grade real-time)'
  const chgSign = q.change >= 0 ? '+' : ''
  const pctSign = q.change_pct >= 0 ? '+' : ''
  return `- **${analysis}** (execution alias ${executionAlias}): LATEST AVAILABLE QUOTE — Provider: Yahoo — Price: ${q.price.toLocaleString()} — Change vs previous close: ${chgSign}${q.change.toFixed(2)} (${pctSign}${q.change_pct.toFixed(2)}%) — Quote timestamp: ${ts} — Age: ${ageStr} — Freshness: ${freshness}`
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
      : [{
          role: 'user' as const,
          content: 'What material events are on the desk, which markets do they affect, and which specialist should own each one?',
        }]

    const tab = body.tab || 'ALL'

    let quotesStr = 'Quote feed unavailable.'
    let headlinesStr = 'Headline feed unavailable.'
    let calendarBlock = 'UPCOMING CALENDAR DATA UNAVAILABLE.'
    const now = new Date()

    try {
      const finnhub = getFinnhubClient()

      const [rawHeadlines, calendarRows, dq, nq, gq, cq, nkq] = await Promise.all([
        finnhub.getMarketNews('general').catch(() => null),
        finnhub.getEconomicCalendar(ymd(now), ymd(new Date(now.getTime() + 7 * 86400000))).catch(() => null),
        getYahooQuote('DOW').catch(() => null),
        getYahooQuote('NASDAQ').catch(() => null),
        getYahooQuote('GOLD').catch(() => null),
        getYahooQuote('CRUDE').catch(() => null),
        getYahooQuote('NIKKEI').catch(() => null),
      ])

      const cards: DeskNewsCard[] = rawHeadlines
        ? buildDeskNewsCards(
            rawHeadlines.map((h) => ({
              headline: h.headline,
              source: h.source,
              datetime: h.datetime,
              url: h.url,
              summary: h.summary,
            })),
            { windowHours: 24 }
          )
        : []

      headlinesStr = !rawHeadlines
        ? 'Headline feed unavailable.'
        : cards.length === 0
          ? 'No deduplicated events in the last 24 hours.'
          : cards
              .slice(0, 15)
              .map((c) => {
                const published = new Date(c.datetime * 1000).toISOString()
                return `- event_id: ${c.id}
  headline: ${c.headline}
  tag: ${c.tag}
  affected_desks: ${c.instruments.join(', ') || 'unspecified'}
  source: ${c.source || 'unknown'}
  reliability: ${sourceReliability(c.source || '')}
  published_at: ${published}
  verification: single supplied source after headline-key dedup (not an independent second confirmation)`
              })
              .join('\n')

      if (calendarRows == null) {
        calendarBlock = 'UPCOMING CALENDAR DATA UNAVAILABLE.'
      } else {
        const fetchedCalendar: DeskCalendarEvent[] = calendarRows.map((row, idx) => {
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
        const tier1 = fetchedCalendar.filter((c) => c.impact === 'high')
        const listed = (tier1.length > 0 ? tier1 : fetchedCalendar).slice(0, 12)
        const lines = listed
          .map((c) => `- ${c.time} ${c.country}: ${c.event} (Impact: ${c.impact.toUpperCase()}) [Desks: ${c.instruments.join(', ') || 'unspecified'}]`)
          .join('\n')
        calendarBlock = tier1.length === 0
          ? `NO VERIFIED TIER-1 EVENT IN CURRENT CALENDAR WINDOW.\n${lines}`
          : lines
      }

      quotesStr = [
        formatQuoteForPrompt('YM', 'MYM', dq),
        formatQuoteForPrompt('NQ', 'MNQ', nq),
        formatQuoteForPrompt('NKD', 'NKD', nkq),
        formatQuoteForPrompt('GC', 'MGC', gq),
        formatQuoteForPrompt('CL', 'MCL', cq),
      ].join('\n')
    } catch (err) {
      logger.warn('[News AI] Failed to assemble news context', err)
    }

    const newsContextStr = `
CURRENT DATE & SERVER TIME: ${now.toUTCString()}
CURRENT DESK TAB SELECTION: ${tab}
ANALYSIS MARKETS: YM, NQ, NKD, GC, CL
JPY_INTERVENTION_RISK: UNKNOWN (not supplied)
options_implied_event_move: NOT SUPPLIED
MARKET REACTION ENGINE: NOT SUPPLIED
Do not infer a 5-minute or 15-minute reaction path from the last prints below.

LATEST AVAILABLE QUOTES (Yahoo; not labeled real-time):
${quotesStr}

DEDUPLICATED EVENTS (one row = one headline cluster; repeats already removed):
${headlinesStr}

VERIFIED ECONOMIC CALENDAR (fetched window only):
${calendarBlock}
`

    const systemPrompt = buildDeskNewsSystemPrompt(newsContextStr)

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    if (!anthropicKey && !openaiKey) {
      const fallbackText = `### Desk News Agent

No language model is configured. This is the supplied event context only. It is not a market regime and it does not contain technical levels.

#### Latest available quotes
${quotesStr}

#### Deduplicated events
${headlinesStr}

#### Verified calendar
${calendarBlock}

Market reaction status: PENDING_REACTION_ENGINE.

Deeper interpretation belongs to OIL_AGENT, GOLD_AGENT, NQ_AGENT, DOW_AGENT, and NIKKEI_AGENT. Chart Leo owns price location.`

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


