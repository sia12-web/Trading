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
import { buildDeskNewsHazards, type DeskNewsHazard } from '@/lib/trading/deskNewsHazard'

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
  GOLD: [],
  CRUDE: [],
}

const TABS: { id: DeskTab; label: string }[] = [
  { id: 'ALL', label: 'All desks' },
  { id: 'DOW', label: 'DOW' },
  { id: 'NASDAQ', label: 'NASDAQ' },
  { id: 'GOLD', label: 'GOLD' },
  { id: 'CRUDE', label: 'CRUDE' },
]

const WINDOWS: DeskNewsWindowHours[] = [2, 12, 24]

const TAG_STYLE: Record<DeskNewsTag, string> = {
  MACRO: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  EARNINGS: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  GEO: 'bg-red-500/20 text-red-200 border-red-500/40',
  FLOW: 'bg-sky-500/20 text-sky-200 border-sky-500/40',
  OTHER: 'bg-white/10 text-gray-300 border-white/15',
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


import { DeskNewsAiAssistant } from './components/DeskNewsAiAssistant'

export default function DeskNewsPage() {
  const [tab, setTab] = useState<DeskTab>('DOW')
  const [windowHours, setWindowHours] = useState<DeskNewsWindowHours>(12)
  const [sessionFilter, setSessionFilter] = useState(true)
  const [data, setData] = useState<NewsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
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

  const deskNotesHazards = useMemo(() => {
    const rows = data?.calendar || []
    if (rows.length === 0) return []
    const activeInstruments: DeskNewsInstrument[] = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE']
    const targetMarkets = tab === 'ALL' ? activeInstruments : [tab]
    const all: DeskNewsHazard[] = []
    const seen = new Set<string>()

    for (const inst of targetMarkets) {
      const hazards = buildDeskNewsHazards({
        calendar: rows,
        instrument: inst,
        includeUpcomingDay: true,
        nowMs,
      })
      for (const h of hazards) {
        if (!seen.has(h.id)) {
          seen.add(h.id)
          all.push(h)
        }
      }
    }

    all.sort((a, b) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity))
    return all
  }, [data?.calendar, tab, nowMs])

  const updatedLabel = data?.updatedAt
    ? formatAge(Math.floor(new Date(data.updatedAt).getTime() / 1000), nowMs)
    : null

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
            className="rounded border border-sky-600/40 bg-sky-950/40 px-2 py-1 text-sky-200 hover:bg-sky-900/50 hover:text-white transition-colors"
          >
            TradePulse — Level Intelligence →
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

      {/* Desk News & Market Reaction AI Assistant */}
      <DeskNewsAiAssistant tab={tab} />

      {/* Desk Notes & Catalyst Warnings */}
      {deskNotesHazards.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-amber-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-amber-200">
                Desk Notes · High-Impact Catalysts
              </h2>
            </div>
            <span className="text-[10px] text-amber-200/60 font-mono">Finnhub Economic Feed</span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {deskNotesHazards.map((h) => {
              const isStandAside = h.level === 'stand_aside'
              const isCareful = h.level === 'careful'
              const badgeTone = isStandAside
                ? 'bg-red-500/30 text-red-100 border-red-500/40'
                : isCareful
                  ? 'bg-amber-500/30 text-amber-100 border-amber-500/40'
                  : 'bg-violet-500/20 text-violet-100 border-violet-500/30'

              return (
                <div
                  key={h.id}
                  className={`rounded-lg border p-3 space-y-1.5 ${
                    isStandAside
                      ? 'border-red-600/40 bg-red-950/30'
                      : isCareful
                        ? 'border-amber-600/40 bg-amber-950/30'
                        : 'border-white/10 bg-black/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-bold uppercase ${badgeTone}`}
                    >
                      {isStandAside
                        ? 'Stand Aside'
                        : isCareful
                          ? 'Careful'
                          : 'High Impact'}
                    </span>
                    <span className="font-mono text-gray-300">
                      {h.montrealHms ? `${h.montrealHms} MTL` : 'Today'}
                    </span>
                  </div>

                  <div className="text-xs font-bold text-white leading-snug">
                    {h.country} · {h.event}
                  </div>

                  <div className="flex items-center gap-1 text-[10px] text-gray-400 font-mono">
                    <span>Target:</span>
                    <span className="text-gray-200 font-semibold">
                      {h.instruments.join(' · ')}
                    </span>
                  </div>

                  <p className="text-[10px] text-gray-400 leading-relaxed pt-0.5 border-t border-white/5">
                    {h.body}
                  </p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {calendar.length > 0 && (
        <section className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-amber-200">
              Economic calendar
            </h2>
            <span className="text-[10px] text-amber-200/60">Next 7 Days · Finnhub</span>
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
            <span className="text-[10px] text-gray-600">{data?.disclaimer}</span>
          </div>
        </div>

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
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function NewsCard({
  card,
  nowMs,
}: {
  card: DeskNewsCard
  nowMs: number
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
    </article>
  )
}

function CalendarCard({ event }: { event: DeskCalendarEvent }) {
  const high = /high/i.test(event.impact)
  const isReleased = !!(event.isReleased || (event.actual != null && String(event.actual).trim() !== ''))

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 transition-all ${
        isReleased
          ? 'border-emerald-500/50 bg-emerald-950/20'
          : high
            ? 'border-amber-500/40 bg-amber-500/10'
            : 'border-white/10 bg-black/20'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className="font-mono text-amber-100/90">{event.time}</span>
        <span className="text-gray-400 font-semibold">{event.country}</span>
        <span
          className={`rounded px-1 py-0.5 font-bold uppercase ${
            high ? 'bg-amber-500/30 text-amber-100' : 'bg-white/10 text-gray-400'
          }`}
        >
          {event.impact || 'low'}
        </span>
        {isReleased && (
          <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 text-emerald-300 font-bold uppercase tracking-wider border border-emerald-500/40">
            🎯 Released
          </span>
        )}
        {event.outcome && (
          <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-cyan-200 font-bold uppercase">
            {event.outcome}
            {event.changeBps
              ? ` (${event.changeBps > 0 ? `+${event.changeBps}` : event.changeBps}bps)`
              : ''}
          </span>
        )}
        {event.instruments.map((i) => (
          <span key={i} className="text-gray-500 font-mono">
            {i}
          </span>
        ))}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-white leading-snug">{event.event}</p>
        {event.resultUrl && (
          <a
            href={event.resultUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-sky-400 hover:underline shrink-0"
          >
            Source Wire ↗
          </a>
        )}
      </div>

      {/* Actual / Forecast / Previous data strip */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] font-mono border-t border-white/5 pt-1.5">
        <div className="flex items-center gap-1">
          <span className="text-gray-500">Actual:</span>
          <span className={`font-bold ${isReleased ? 'text-emerald-300' : 'text-gray-400'}`}>
            {event.actual != null ? String(event.actual) : 'Pending'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">Exp:</span>
          <span className="text-gray-300">{event.estimate != null ? String(event.estimate) : '—'}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">Prev:</span>
          <span className="text-gray-400">{event.prev != null ? String(event.prev) : '—'}</span>
        </div>
        {event.targetRange && (
          <div className="flex items-center gap-1 text-[10px] text-gray-400">
            <span>Range:</span>
            <span className="text-sky-300">{event.targetRange}</span>
          </div>
        )}
      </div>

      <p className="mt-1.5 text-[10px] text-gray-400 leading-relaxed">{event.deskNote}</p>
    </div>
  )
}
