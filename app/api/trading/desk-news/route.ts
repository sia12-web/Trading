/**
 * GET /api/trading/desk-news
 * Finnhub-backed desk news for DOW / NASDAQ / NIKKEI + economic calendar.
 * Soft-fails (empty lists) if Finnhub is down — never blocks the desk.
 */

import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { liveFocusMarket } from '@/lib/trading/sessionGate'
import {
  buildDeskNewsCards,
  deskNoteForCalendar,
  filterCardsForDesk,
  instrumentsForCalendarEvent,
  type DeskCalendarEvent,
  type DeskNewsInstrument,
  type DeskNewsWindowHours,
  type RawDeskHeadline,
} from '@/lib/trading/deskNews'
import { isHighImpact, parseCalendarEventMs } from '@/lib/trading/deskNewsHazard'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const windowRaw = Number(searchParams.get('window') || '12')
    const windowHours = ([2, 12, 24].includes(windowRaw) ? windowRaw : 12) as DeskNewsWindowHours
    const deskParam = (searchParams.get('desk') || 'ALL').toUpperCase()
    const desk = (
      deskParam === 'DOW' || deskParam === 'NASDAQ' || deskParam === 'NIKKEI'
        ? deskParam
        : 'ALL'
    ) as DeskNewsInstrument | 'ALL'
    const sessionFilter = searchParams.get('session') !== '0'
    const calendarOnly = searchParams.get('calendarOnly') === '1'
    const now = new Date()
    const focus = liveFocusMarket(now)

    const finnhub = getFinnhubClient()
    const instruments: DeskNewsInstrument[] = ['DOW', 'NASDAQ', 'NIKKEI', 'GOLD', 'CRUDE']

    const calendarRowsPromise = finnhub.getEconomicCalendar(
      ymd(now),
      ymd(new Date(now.getTime() + 2 * 86400000))
    )

    let allCards = buildDeskNewsCards([], {
      windowHours,
      nowUnix: Math.floor(now.getTime() / 1000),
      limitPerDesk: 10,
    })
    let calendarRows: Awaited<ReturnType<typeof finnhub.getEconomicCalendar>> = []

    if (calendarOnly) {
      calendarRows = await calendarRowsPromise
    } else {
      const [companySets, generalNews, forexNews, cal] = await Promise.all([
        Promise.all(instruments.map((inst) => finnhub.getCompanyNewsItems(inst))),
        finnhub.getMarketNews('general'),
        finnhub.getMarketNews('forex'),
        calendarRowsPromise,
      ])
      calendarRows = cal

      const raw: RawDeskHeadline[] = []
      for (let i = 0; i < instruments.length; i++) {
        const rows = companySets[i]
        if (!rows) continue
        for (const r of rows) {
          raw.push({
            headline: r.headline,
            source: r.source,
            datetime: r.datetime,
            url: r.url,
            summary: r.summary,
            related: r.related,
            origin: r.origin,
          })
        }
      }
      for (const set of [generalNews, forexNews]) {
        if (!set) continue
        for (const r of set) {
          raw.push({
            headline: r.headline,
            source: r.source,
            datetime: r.datetime,
            url: r.url,
            summary: r.summary,
            related: r.related,
            origin: r.origin,
          })
        }
      }

      allCards = buildDeskNewsCards(raw, {
        windowHours,
        nowUnix: Math.floor(now.getTime() / 1000),
        limitPerDesk: 10,
      })
    }

    // Session filter only shapes ALL — per-desk tabs stay complete off-focus
    const sessionOpts = {
      sessionFilter,
      focusMarket: sessionFilter ? focus : null,
    }
    const byDesk = {
      DOW: filterCardsForDesk(allCards, 'DOW', 10),
      NASDAQ: filterCardsForDesk(allCards, 'NASDAQ', 10),
      NIKKEI: filterCardsForDesk(allCards, 'NIKKEI', 10),
      GOLD: filterCardsForDesk(allCards, 'GOLD', 10),
      CRUDE: filterCardsForDesk(allCards, 'CRUDE', 10),
      ALL: filterCardsForDesk(allCards, 'ALL', 12, sessionOpts),
    }

    const nowMs = now.getTime()
    const mapped: DeskCalendarEvent[] = calendarRows
      .filter((e) => e.event && e.time)
      .map((e, idx) => {
        const instrumentsHit = instrumentsForCalendarEvent(e.country, e.event)
        return {
          id: `cal-${idx}-${e.time}-${e.event}`.slice(0, 80),
          time: e.time,
          country: e.country,
          event: e.event,
          impact: e.impact || 'low',
          instruments: instrumentsHit,
          deskNote: deskNoteForCalendar(instrumentsHit, e.impact || 'low'),
        }
      })

    // Prefer HIGH impact first so a dense low-impact flood never drops CPI/FOMC/BoJ.
    // Then sort by clock. Cap after prioritization.
    const high = mapped.filter((e) => isHighImpact(e.impact))
    const rest = mapped.filter((e) => !isHighImpact(e.impact))
    const byTime = (a: DeskCalendarEvent, b: DeskCalendarEvent) => {
      const am = parseCalendarEventMs(a.time, nowMs) ?? Number.POSITIVE_INFINITY
      const bm = parseCalendarEventMs(b.time, nowMs) ?? Number.POSITIVE_INFINITY
      return am - bm
    }
    high.sort(byTime)
    rest.sort(byTime)
    let calendar = [...high, ...rest].slice(0, 40)

    // Optional desk filter for chart banner polls
    if (desk !== 'ALL') {
      calendar = calendar.filter((e) => e.instruments.includes(desk))
    }

    return NextResponse.json(
      {
        ok: true,
        updatedAt: now.toISOString(),
        windowHours,
        focusMarket: focus,
        sessionFilter,
        desk,
        items: byDesk[desk],
        byDesk,
        calendar,
        calendarOnly,
        source: 'finnhub',
        disclaimer: 'Context only — not a trade signal.',
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    )
  } catch (error) {
    logger.error('desk-news.failed', { err: error })
    return NextResponse.json(
      {
        ok: false,
        updatedAt: new Date().toISOString(),
        items: [],
        byDesk: { DOW: [], NASDAQ: [], NIKKEI: [], GOLD: [], CRUDE: [], ALL: [] },
        calendar: [],
        error: 'News unavailable',
        disclaimer: 'Context only — not a trade signal.',
      },
      { status: 200 }
    )
  }
}
