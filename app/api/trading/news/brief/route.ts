/**
 * POST /api/trading/news/brief
 * Haiku impact brief for desk news (single headline or top-5 digest).
 */

import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  briefOneHeadline,
  briefTop5,
  newsBriefLlmReady,
  type NewsHeadlineInput,
} from '@/lib/trading/newsImpactBrief'
import type { DeskNewsInstrument, DeskNewsTag } from '@/lib/trading/deskNews'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

type Body = {
  mode?: 'one' | 'top5'
  tab?: string
  headline?: Partial<NewsHeadlineInput>
  headlines?: Array<Partial<NewsHeadlineInput>>
}

function asTab(raw: unknown): DeskNewsInstrument | 'ALL' {
  const s = String(raw || 'ALL').toUpperCase()
  if (s === 'DOW' || s === 'NASDAQ' || s === 'NIKKEI' || s === 'ALL') return s
  return 'ALL'
}

function asTag(raw: unknown): DeskNewsTag {
  const s = String(raw || 'OTHER').toUpperCase()
  if (
    s === 'MACRO' ||
    s === 'EARNINGS' ||
    s === 'GEO' ||
    s === 'FLOW' ||
    s === 'OTHER'
  ) {
    return s
  }
  return 'OTHER'
}

function asInstruments(raw: unknown): DeskNewsInstrument[] {
  if (!Array.isArray(raw)) return ['DOW', 'NASDAQ', 'NIKKEI']
  const out: DeskNewsInstrument[] = []
  for (const x of raw) {
    const s = String(x).toUpperCase()
    if (
      (s === 'DOW' || s === 'NASDAQ' || s === 'NIKKEI') &&
      !out.includes(s)
    ) {
      out.push(s)
    }
  }
  return out.length ? out : ['DOW', 'NASDAQ', 'NIKKEI']
}

function normalizeHeadline(
  raw: Partial<NewsHeadlineInput> | undefined
): NewsHeadlineInput | null {
  if (!raw) return null
  const id = String(raw.id || '').trim()
  const headline = String(raw.headline || '').trim()
  if (!id || !headline) return null
  return {
    id: id.slice(0, 160),
    headline: headline.slice(0, 400),
    source: String(raw.source || 'Finnhub').trim().slice(0, 80) || 'Finnhub',
    datetime: Number(raw.datetime) || Math.floor(Date.now() / 1000),
    tag: asTag(raw.tag),
    instruments: asInstruments(raw.instruments),
    summary: raw.summary ? String(raw.summary).slice(0, 600) : null,
    deskNote: raw.deskNote ? String(raw.deskNote).slice(0, 280) : null,
  }
}

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!newsBriefLlmReady()) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Brief unavailable — Anthropic key not configured.',
        },
        { status: 503 }
      )
    }

    const body = (await request.json().catch(() => ({}))) as Body
    const mode = body.mode === 'top5' ? 'top5' : 'one'
    const tab = asTab(body.tab)

    if (mode === 'one') {
      const headline = normalizeHeadline(body.headline)
      if (!headline) {
        return NextResponse.json(
          { ok: false, error: 'headline.id and headline.headline required' },
          { status: 400 }
        )
      }
      const result = await briefOneHeadline({
        userId: user.id,
        headline,
        tab,
      })
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.message },
          { status: result.status }
        )
      }
      return NextResponse.json({ ok: true, mode: 'one', brief: result.brief })
    }

    const headlines = (body.headlines || [])
      .map(normalizeHeadline)
      .filter((h): h is NewsHeadlineInput => !!h)
      .slice(0, 5)
    if (headlines.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'headlines required for top5' },
        { status: 400 }
      )
    }

    const result = await briefTop5({
      userId: user.id,
      tab,
      headlines,
    })
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.message },
        { status: result.status }
      )
    }
    return NextResponse.json({ ok: true, mode: 'top5', digest: result.digest })
  } catch (err) {
    logger.error('news_brief.route_failed', { err })
    return NextResponse.json(
      { ok: false, error: 'Brief unavailable' },
      { status: 500 }
    )
  }
}
