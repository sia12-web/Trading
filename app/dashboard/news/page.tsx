'use client'

/**
 * Desk news — Finnhub headlines + calendar for DOW / NASDAQ.
 * Optional Haiku impact briefs (on demand). Context only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type {
  DeskCalendarEvent,
  DeskNewsCard,
  DeskNewsInstrument,
  DeskNewsTag,
  DeskNewsWindowHours,
} from '@/lib/trading/deskNews'
import type {
  NewsImpactBrief,
  Top5NewsDigest,
} from '@/lib/trading/newsImpactBrief'

const BRIEF_DISCLAIMER =
  'Context only — not an entry signal. Do not trade from this brief alone.'

type DeskTab = DeskNewsInstrument | 'ALL'

type NewsPayload = {
  ok: boolean
  updatedAt: string
  windowHours: DeskNewsWindowHours
  focusMarket: 'NY' | 'TOKYO'
  sessionFilter: boolean
  byDesk: Record<DeskTab, DeskNewsCard[]>
  calendar: DeskCalendarEvent[]
  disclaimer?: string
  error?: string
}

const EMPTY_BY_DESK: Record<DeskTab, DeskNewsCard[]> = {
  ALL: [],
  DOW: [],
  NASDAQ: [],
  NIKKEI: [],
}

const TABS: { id: DeskTab; label: string }[] = [
  { id: 'ALL', label: 'All desks' },
  { id: 'DOW', label: 'DOW' },
  { id: 'NASDAQ', label: 'NASDAQ' },
]

const WINDOWS: DeskNewsWindowHours[] = [2, 12, 24]

const TAG_STYLE: Record<DeskNewsTag, string> = {
  MACRO: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  EARNINGS: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  GEO: 'bg-red-500/20 text-red-200 border-red-500/40',
  FLOW: 'bg-sky-500/20 text-sky-200 border-sky-500/40',
  OTHER: 'bg-white/10 text-gray-300 border-white/15',
}

const BIAS_STYLE: Record<string, string> = {
  bullish: 'text-emerald-300',
  bearish: 'text-red-300',
  mixed: 'text-amber-200',
  noise: 'text-gray-400',
}

function formatAge(unix: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor(nowMs / 1000) - unix)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function formatClock(unix: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(unix * 1000))
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  )
}

function cardToPayload(card: DeskNewsCard) {
  return {
    id: card.id,
    headline: card.headline,
    source: card.source,
    datetime: card.datetime,
    tag: card.tag,
    instruments: card.instruments,
    summary: card.summary,
    deskNote: card.deskNote,
  }
}

export default function DeskNewsPage() {
  const [tab, setTab] = useState<DeskTab>('DOW')
  const [windowHours, setWindowHours] = useState<DeskNewsWindowHours>(12)
  const [sessionFilter, setSessionFilter] = useState(true)
  const [data, setData] = useState<NewsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [briefs, setBriefs] = useState<Record<string, NewsImpactBrief>>({})
  const [openBriefIds, setOpenBriefIds] = useState<Record<string, boolean>>({})
  const [briefLoadingId, setBriefLoadingId] = useState<string | null>(null)
  const [briefErrors, setBriefErrors] = useState<Record<string, string>>({})
  const [digest, setDigest] = useState<Top5NewsDigest | null>(null)
  const [digestOpen, setDigestOpen] = useState(false)
  const [digestLoading, setDigestLoading] = useState(false)
  const [digestError, setDigestError] = useState<string | null>(null)
  const reqSeq = useRef(0)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const seq = ++reqSeq.current
      try {
        const res = await fetch(
          `/api/trading/desk-news?window=${windowHours}&desk=${tab}&session=${sessionFilter ? '1' : '0'}&_=${Date.now()}`,
          { cache: 'no-store', signal }
        )
        if (signal?.aborted || seq !== reqSeq.current) return
        if (res.status === 401) {
          setError('Sign in required')
          setData(null)
          return
        }
        const json = (await res.json()) as NewsPayload
        if (signal?.aborted || seq !== reqSeq.current) return
        setData({
          ...json,
          byDesk: json.byDesk || EMPTY_BY_DESK,
          calendar: Array.isArray(json.calendar) ? json.calendar : [],
        })
        setError(json.error || null)
      } catch (err) {
        if (isAbortError(err) || seq !== reqSeq.current) return
        setError('News feed unavailable')
      } finally {
        if (!signal?.aborted && seq === reqSeq.current) setLoading(false)
      }
    },
    [windowHours, tab, sessionFilter]
  )

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setDigestOpen(false)
    setDigestError(null)
    void load(ac.signal)
    const id = window.setInterval(() => {
      if (!ac.signal.aborted) void load(ac.signal)
    }, 60_000)
    return () => {
      ac.abort()
      window.clearInterval(id)
    }
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  const items = useMemo(() => {
    if (!data?.byDesk) return []
    return data.byDesk[tab] || []
  }, [data, tab])

  const calendar = useMemo(() => {
    const rows = data?.calendar || []
    if (tab === 'ALL') return rows
    return rows.filter((ev) => ev.instruments.includes(tab))
  }, [data?.calendar, tab])

  const updatedLabel = data?.updatedAt
    ? formatAge(Math.floor(new Date(data.updatedAt).getTime() / 1000), nowMs)
    : null

  const explainOne = useCallback(
    async (card: DeskNewsCard) => {
      if (openBriefIds[card.id]) {
        setOpenBriefIds((prev) => ({ ...prev, [card.id]: false }))
        return
      }
      if (briefs[card.id]) {
        setOpenBriefIds((prev) => ({ ...prev, [card.id]: true }))
        return
      }
      setBriefLoadingId(card.id)
      setBriefErrors((prev) => {
        const next = { ...prev }
        delete next[card.id]
        return next
      })
      try {
        const res = await fetch('/api/trading/news/brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'one',
            tab,
            headline: cardToPayload(card),
          }),
        })
        const json = await res.json()
        if (!res.ok || !json?.ok || !json.brief) {
          setBriefErrors((prev) => ({
            ...prev,
            [card.id]: json?.error || 'Brief unavailable',
          }))
          return
        }
        setBriefs((prev) => ({ ...prev, [card.id]: json.brief as NewsImpactBrief }))
        setOpenBriefIds((prev) => ({ ...prev, [card.id]: true }))
      } catch {
        setBriefErrors((prev) => ({
          ...prev,
          [card.id]: 'Brief unavailable',
        }))
      } finally {
        setBriefLoadingId((cur) => (cur === card.id ? null : cur))
      }
    },
    [briefs, openBriefIds, tab]
  )

  const briefTop5 = useCallback(async () => {
    if (digestOpen) {
      setDigestOpen(false)
      return
    }
    if (digest && digest.tab === tab) {
      setDigestOpen(true)
      return
    }
    const top = items.slice(0, 5)
    if (top.length === 0) return
    setDigestLoading(true)
    setDigestError(null)
    try {
      const res = await fetch('/api/trading/news/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'top5',
          tab,
          headlines: top.map(cardToPayload),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok || !json.digest) {
        setDigestError(json?.error || 'Brief unavailable')
        return
      }
      setDigest(json.digest as Top5NewsDigest)
      setDigestOpen(true)
    } catch {
      setDigestError('Brief unavailable')
    } finally {
      setDigestLoading(false)
    }
  }, [digest, digestOpen, items, tab])

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Desk News</h1>
          <p className="mt-1 text-sm text-gray-400 max-w-xl leading-relaxed">
            Catalysts that can move DOW and NASDAQ — including Korea→US
            transmission. Haiku briefs on demand. Context only, not entries.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          {updatedLabel && <span>Updated {updatedLabel}</span>}
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              void load()
            }}
            className="rounded border border-white/15 px-2 py-1 text-gray-300 hover:bg-white/10"
          >
            Refresh
          </button>
          <Link
            href="/dashboard/chart"
            className="rounded border border-brand-500/40 bg-brand-600/20 px-2 py-1 text-brand-200 hover:bg-brand-600/30"
          >
            Live chart →
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border transition ${
              tab === t.id
                ? 'border-brand-500/50 bg-brand-600/30 text-brand-100'
                : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWindowHours(w)}
            className={`rounded-md px-2 py-1 text-[10px] font-semibold tabular-nums border ${
              windowHours === w
                ? 'border-violet-500/50 bg-violet-600/25 text-violet-100'
                : 'border-white/10 text-gray-500 hover:text-gray-300'
            }`}
          >
            {w}h
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSessionFilter((v) => !v)}
          className={`rounded-md px-2 py-1 text-[10px] font-semibold border ${
            sessionFilter
              ? 'border-emerald-500/40 bg-emerald-600/20 text-emerald-100'
              : 'border-white/10 text-gray-500'
          }`}
          title="When on, All desks prefers the active live focus market. Desk tabs always show that desk."
        >
          {sessionFilter ? 'Session filter on' : 'Show all'}
        </button>
      </div>

      {calendar.length > 0 && (
        <section className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-amber-200">
              Economic calendar
            </h2>
            <span className="text-[10px] text-amber-200/60">Next ~48h · Finnhub</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {calendar.slice(0, 8).map((ev) => (
              <CalendarCard key={ev.id} event={ev} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
            Headlines · {tab}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={digestLoading || items.length === 0}
              onClick={() => void briefTop5()}
              className="rounded border border-violet-500/40 bg-violet-600/20 px-2 py-1 text-[10px] font-semibold text-violet-100 hover:bg-violet-600/30 disabled:opacity-40"
            >
              {digestLoading
                ? 'Briefing…'
                : digestOpen
                  ? 'Hide top 5'
                  : 'Brief top 5'}
            </button>
            <span className="text-[10px] text-gray-600">{data?.disclaimer}</span>
          </div>
        </div>

        {digestError && (
          <p className="rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
            {digestError}
          </p>
        )}
        {digestOpen && digest && (
          <div className="rounded-xl border border-violet-500/30 bg-violet-950/25 px-3.5 py-3 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-violet-200">
              Session news bias · Haiku
              {digest.cached ? ' · cached' : ''}
            </div>
            <p className="text-sm text-violet-50 leading-relaxed">{digest.sessionBias}</p>
            <ul className="space-y-1.5">
              {digest.ranked.map((r) => (
                <li key={r.headlineId} className="text-[11px] text-gray-300">
                  <span className={`font-semibold uppercase ${BIAS_STYLE[r.bias] || ''}`}>
                    {r.bias}
                  </span>
                  <span className="text-gray-500"> · </span>
                  {r.oneLiner}
                </li>
              ))}
            </ul>
            {digest.koreaNote && (
              <p className="text-[11px] text-sky-200/90 border-t border-white/10 pt-2">
                <span className="font-semibold text-sky-100">Korea→US: </span>
                {digest.koreaNote}
              </p>
            )}
            <p className="text-[10px] text-gray-500">{digest.disclaimer}</p>
          </div>
        )}

        {loading && !data && (
          <p className="text-sm text-gray-500 animate-pulse py-8 text-center">
            Loading Finnhub…
          </p>
        )}
        {error && items.length === 0 && (
          <p className="rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-3 text-sm text-amber-100">
            {error}. Chart trading is unaffected — try Refresh.
          </p>
        )}
        {!loading && items.length === 0 && !error && (
          <p className="rounded-lg border border-white/10 bg-surface-800/60 px-3 py-6 text-center text-sm text-gray-500">
            No headlines in this window. Widen to 24h or turn off session filter.
          </p>
        )}

        <div className="space-y-2">
          {items.map((card) => (
            <NewsCard
              key={card.id}
              card={card}
              nowMs={nowMs}
              brief={openBriefIds[card.id] ? briefs[card.id] || null : null}
              briefError={briefErrors[card.id] || null}
              loading={briefLoadingId === card.id}
              open={!!openBriefIds[card.id]}
              onExplain={() => void explainOne(card)}
            />
          ))}
        </div>

        <p className="pt-2 text-[10px] text-gray-600 leading-relaxed">
          {BRIEF_DISCLAIMER} Haiku briefs are optional context for bias —
          never an entry signal.
        </p>
      </section>
    </div>
  )
}

function NewsCard({
  card,
  nowMs,
  brief,
  briefError,
  loading,
  open,
  onExplain,
}: {
  card: DeskNewsCard
  nowMs: number
  brief: NewsImpactBrief | null
  briefError: string | null
  loading: boolean
  open: boolean
  onExplain: () => void
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-surface-800/70 px-3.5 py-3 hover:border-white/20 transition">
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className={`rounded border px-1.5 py-0.5 font-bold uppercase ${TAG_STYLE[card.tag]}`}>
          {card.tag}
        </span>
        {card.instruments.map((inst) => (
          <span
            key={inst}
            className="rounded bg-white/5 px-1.5 py-0.5 font-semibold text-gray-300"
          >
            {inst}
          </span>
        ))}
        <span className="text-gray-500">{card.source}</span>
        <span className="text-gray-600 tabular-nums">{formatClock(card.datetime)} Montreal</span>
        <span className="text-gray-600 tabular-nums">{formatAge(card.datetime, nowMs)}</span>
      </div>
      {card.url ? (
        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 block text-sm font-semibold text-white leading-snug hover:underline"
        >
          {card.headline}
        </a>
      ) : (
        <h3 className="mt-1.5 text-sm font-semibold text-white leading-snug">{card.headline}</h3>
      )}
      <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">{card.deskNote}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onExplain}
          disabled={loading}
          className="rounded border border-violet-500/35 bg-violet-600/15 px-2 py-0.5 text-[10px] font-semibold text-violet-100 hover:bg-violet-600/25 disabled:opacity-50"
        >
          {loading ? 'Haiku…' : open ? 'Hide brief' : 'Explain impact'}
        </button>
      </div>

      {briefError && (
        <p className="mt-2 text-[11px] text-amber-200/90">{briefError}</p>
      )}
      {brief && <BriefPanel brief={brief} />}
    </article>
  )
}

function BriefPanel({ brief }: { brief: NewsImpactBrief }) {
  return (
    <div className="mt-2 rounded-lg border border-violet-500/25 bg-black/30 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-violet-200/80">
        <span className="font-bold uppercase tracking-wide">Haiku impact</span>
        <span className="text-gray-500">· {brief.horizon.replace('_', ' ')}</span>
        {brief.cached && <span className="text-gray-600">· cached</span>}
      </div>
      <p className="text-[12px] text-gray-100 leading-relaxed">{brief.plainEnglish}</p>
      <div className="flex flex-wrap gap-2">
        {brief.deskImpacts.map((d) => (
          <span
            key={d.desk}
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px]"
            title={d.note}
          >
            <span className="font-semibold text-gray-200">{d.desk}</span>{' '}
            <span className={`uppercase font-bold ${BIAS_STYLE[d.bias] || ''}`}>
              {d.bias}
            </span>
          </span>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">
        <span className="text-gray-500">Why: </span>
        {brief.why}
      </p>
      {brief.koreaTransmission && (
        <p className="text-[11px] text-sky-200/90">
          <span className="font-semibold text-sky-100">Korea→US: </span>
          {brief.koreaTransmission}
        </p>
      )}
      <p className="text-[10px] text-gray-600">{brief.disclaimer}</p>
    </div>
  )
}

function CalendarCard({ event }: { event: DeskCalendarEvent }) {
  const high = /high/i.test(event.impact)
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        high
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-white/10 bg-black/20'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className="font-mono text-amber-100/90">{event.time}</span>
        <span className="text-gray-400">{event.country}</span>
        <span
          className={`rounded px-1 py-0.5 font-bold uppercase ${
            high ? 'bg-amber-500/30 text-amber-100' : 'bg-white/10 text-gray-400'
          }`}
        >
          {event.impact || 'low'}
        </span>
        {event.instruments.map((i) => (
          <span key={i} className="text-gray-500">
            {i}
          </span>
        ))}
      </div>
      <p className="mt-1 text-xs font-medium text-white leading-snug">{event.event}</p>
      <p className="mt-0.5 text-[10px] text-gray-500">{event.deskNote}</p>
    </div>
  )
}
