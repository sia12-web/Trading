'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { buildDeskNewsHazards } from '@/lib/trading/deskNewsHazard'
import type { DeskCalendarEvent, DeskNewsInstrument } from '@/lib/trading/deskNews'

type NavItem = {
  href: string
  label: string
  hint?: string
  icon: React.ReactNode
}

const LIVE_ITEMS: NavItem[] = [
  {
    href: '/dashboard/chart',
    label: 'Chart',
    hint: 'Trading desk',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16l4-4 3 3 5-5" />
      </svg>
    ),
  },
  {
    href: '/dashboard/positions',
    label: 'Live Positions',
    hint: 'Open book now',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
        />
      </svg>
    ),
  },
  {
    href: '/dashboard/journal',
    label: 'Order History',
    hint: 'Live fills',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
        />
      </svg>
    ),
  },
  {
    href: '/dashboard/news',
    label: 'Desk News',
    hint: 'YM · NQ · GC · CL',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5"
        />
      </svg>
    ),
  },
  {
    href: '/dashboard/swing',
    label: 'Team tape',
    hint: 'NYC stocks + Questrade book',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
        />
      </svg>
    ),
  },
]



function NavLink({
  item,
  active,
}: {
  item: NavItem
  active: boolean
}) {
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${active
        ? 'bg-brand-600/20 text-brand-300 border border-brand-700/30'
        : 'text-gray-500 hover:text-gray-200 hover:bg-surface-700 border border-transparent'
        }`}
    >
      <span className={active ? 'text-brand-400' : 'text-gray-600'}>{item.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block leading-tight">{item.label}</span>
        {item.hint && (
          <span className="block text-[10px] font-normal text-gray-600 leading-tight mt-0.5">
            {item.hint}
          </span>
        )}
      </span>
    </Link>
  )
}

function pathMatches(pathname: string, search: string, href: string): boolean {
  const [hrefPath, hrefQuery = ''] = href.split('?')
  if (pathname !== hrefPath && !pathname.startsWith(`${hrefPath}/`)) return false
  if (!hrefQuery) {
    return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`)
  }
  const want = new URLSearchParams(hrefQuery)
  const have = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  for (const [k, v] of want.entries()) {
    if (have.get(k) !== v) return false
  }
  return true
}

function NavSection({
  title,
  items,
  pathname,
  search,
}: {
  title: string
  items: NavItem[]
  pathname: string
  search: string
}) {
  if (!items.length) return null

  return (
    <div className="space-y-0.5">
      <p className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
        {title}
      </p>
      {items.map((item) => {
        const matches = items
          .filter((i) => pathMatches(pathname, search, i.href))
          .sort((a, b) => b.href.length - a.href.length)
        const active = matches[0]?.href === item.href
        return (
          <NavLink
            key={item.href}
            item={item}
            active={active}
          />
        )
      })}
    </div>
  )
}

type CompactHazard = {
  id: string
  event: string
  country: string
  impact: string
  montrealHms: string | null
  level: 'none' | 'careful' | 'stand_aside'
  instruments: DeskNewsInstrument[]
  body: string
}

function SidebarDeskNotes() {
  const [hazards, setHazards] = useState<CompactHazard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const fetchDeskNotes = async () => {
      try {
        const res = await fetch(
          `/api/trading/desk-news?window=24&session=0&calendarOnly=1&_=${Date.now()}`,
          { cache: 'no-store' }
        )
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean
          calendar?: DeskCalendarEvent[]
        } | null
        if (cancelled) return
        if (!json?.ok || !Array.isArray(json.calendar)) {
          setHazards([])
          setLoading(false)
          return
        }

        const activeInstruments: DeskNewsInstrument[] = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE']
        const allHazards: CompactHazard[] = []
        const seenIds = new Set<string>()

        for (const inst of activeInstruments) {
          const instHazards = buildDeskNewsHazards({
            calendar: json.calendar,
            instrument: inst,
            includeUpcomingDay: true,
          })

          for (const h of instHazards) {
            if (!seenIds.has(h.id)) {
              seenIds.add(h.id)
              allHazards.push({
                id: h.id,
                event: h.event,
                country: h.country,
                impact: h.impact,
                montrealHms: h.montrealHms,
                level: h.level,
                instruments: h.instruments.filter((i): i is DeskNewsInstrument =>
                  activeInstruments.includes(i)
                ),
                body: h.body,
              })
            }
          }
        }

        allHazards.sort((a, b) => {
          const priority = { stand_aside: 0, careful: 1, none: 2 }
          return (priority[a.level] ?? 2) - (priority[b.level] ?? 2)
        })

        setHazards(allHazards)
      } catch {
        if (!cancelled) setHazards([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchDeskNotes()
    const interval = setInterval(fetchDeskNotes, 120_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="pt-3 px-1 border-t border-surface-600/60 mt-3 space-y-2">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-amber-400"
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
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">
            Desk Notes
          </span>
        </div>
        <Link
          href="/dashboard/news"
          className="text-[10px] text-gray-500 hover:text-brand-300 font-medium transition-colors"
        >
          View all →
        </Link>
      </div>

      {loading ? (
        <div className="px-2 py-2 text-[11px] text-gray-500 font-mono animate-pulse">
          Loading notes…
        </div>
      ) : hazards.length === 0 ? (
        <div className="rounded-lg border border-surface-600/50 bg-surface-700/40 p-2 text-center">
          <span className="text-[11px] text-gray-400 block font-medium">Clean calendar</span>
          <span className="text-[9px] text-gray-500">No high-impact prints today</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {hazards.slice(0, 4).map((h) => {
            const isStandAside = h.level === 'stand_aside'
            const isCareful = h.level === 'careful'
            const badgeTone = isStandAside
              ? 'bg-red-500/25 text-red-200 border-red-500/40'
              : isCareful
                ? 'bg-amber-500/25 text-amber-200 border-amber-500/40'
                : 'bg-violet-500/20 text-violet-200 border-violet-500/30'

            return (
              <Link
                key={h.id}
                href="/dashboard/news"
                className={`block rounded-lg border p-2 text-xs transition hover:brightness-110 ${
                  isStandAside
                    ? 'border-red-600/40 bg-red-950/30'
                    : isCareful
                      ? 'border-amber-600/40 bg-amber-950/20'
                      : 'border-surface-600 bg-surface-700/50'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${badgeTone}`}
                  >
                    {isStandAside
                      ? 'Stand Aside'
                      : isCareful
                        ? 'Careful'
                        : 'High Impact'}
                  </span>
                  <span className="text-[10px] font-mono text-gray-400">
                    {h.montrealHms ? `${h.montrealHms} MTL` : 'Today'}
                  </span>
                </div>
                <div className="font-semibold text-white text-[11px] leading-snug truncate">
                  {h.country} · {h.event}
                </div>
                <div className="flex items-center gap-1 mt-1 text-[9px] text-gray-400 font-mono">
                  <span>Target:</span>
                  <span className="text-gray-300 font-semibold">
                    {h.instruments.join(' · ')}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SidebarNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()

  return (
    <div className="space-y-3">
      <NavSection
        title="Live desk"
        items={LIVE_ITEMS}
        pathname={pathname}
        search={search}
      />
      <SidebarDeskNotes />
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-full w-60 bg-surface-800 border-r border-surface-600 flex flex-col z-40">
      <div className="px-5 py-5 border-b border-surface-600">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-brand-900/50 flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
              <path
                d="M3 17l6-6 4 4 8-9"
                stroke="white"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-none">TradePulse</div>
            <div className="text-xs text-gray-500 mt-0.5">Morning desk</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-3 overflow-y-auto scrollbar-dark">
        <Suspense fallback={null}>
          <SidebarNav />
        </Suspense>
      </nav>

      <div className="px-5 py-4 border-t border-surface-600 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
          <span className="text-xs text-gray-500">Desk ready</span>
        </div>
        <p className="text-[10px] text-gray-600 leading-snug">
          Order History is live fills only.
        </p>
        <LogoutButton />
      </div>
    </aside>
  )
}

function LogoutButton() {
  const [busy, setBusy] = useState(false)

  async function logout() {
    if (busy) return
    setBusy(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* still leave */
    }
    window.location.href = '/login'
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="mt-1 w-full rounded-lg border border-surface-600 px-2.5 py-1.5 text-left text-xs font-medium text-gray-500 transition hover:border-surface-500 hover:text-gray-300 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
