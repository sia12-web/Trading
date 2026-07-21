'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { isAnyLiveFocusWindowActive } from '@/lib/trading/sessionGate'

type NavItem = {
  href: string
  label: string
  hint?: string
  icon: React.ReactNode
}

const LIVE_ITEMS: NavItem[] = [
  {
    href: '/dashboard/chart',
    label: 'Live Trading',
    hint: 'Clock-in desk',
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
    hint: 'Live & sim fills',
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
]

const PRACTICE_ITEMS: NavItem[] = [
  {
    href: '/dashboard/simulation',
    label: 'Simulation',
    hint: 'Paper replay desk',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/journal?tab=sim',
    label: 'Sim History',
    hint: 'Paper fills & P&L',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
  },
]

const TOOL_ITEMS: NavItem[] = [
  {
    href: '/dashboard/usage',
    label: 'LLM Usage',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
        />
      </svg>
    ),
  },
]

function NavLink({
  item,
  active,
  locked,
  lockedHint,
}: {
  item: NavItem
  active: boolean
  locked?: boolean
  lockedHint?: string
}) {
  if (locked) {
    return (
      <div
        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium border border-transparent text-gray-600 opacity-70 cursor-not-allowed"
        title={lockedHint}
      >
        <span className="text-gray-700">{item.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block leading-tight">{item.label}</span>
          <span className="block text-[10px] font-normal text-gray-600 leading-tight mt-0.5">
            {lockedHint || 'Locked'}
          </span>
        </span>
      </div>
    )
  }
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
        active
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
    // Bare /dashboard/journal should not match when tab=sim is active
    if (hrefPath === '/dashboard/journal') {
      const tab = new URLSearchParams(search).get('tab')
      return tab !== 'sim'
    }
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
  liveDeskOpen,
}: {
  title: string
  items: NavItem[]
  pathname: string
  search: string
  liveDeskOpen: boolean
}) {
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
        const isLiveChart = item.href === '/dashboard/chart'
        return (
          <NavLink
            key={item.href}
            item={item}
            active={active}
            locked={isLiveChart && !liveDeskOpen}
            lockedHint="No session now — unlocks 30 min before NY or Tokyo open"
          />
        )
      })}
    </div>
  )
}

function SidebarNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const [liveDeskOpen, setLiveDeskOpen] = useState(false)

  useEffect(() => {
    const tick = () => setLiveDeskOpen(isAnyLiveFocusWindowActive())
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <>
      <NavSection
        title="Live desk"
        items={LIVE_ITEMS}
        pathname={pathname}
        search={search}
        liveDeskOpen={liveDeskOpen}
      />
      <NavSection
        title="Practice"
        items={PRACTICE_ITEMS}
        pathname={pathname}
        search={search}
        liveDeskOpen={true}
      />
      <NavSection
        title="Tools"
        items={TOOL_ITEMS}
        pathname={pathname}
        search={search}
        liveDeskOpen={true}
      />
    </>
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
          Order History has Live + Simulation tabs.
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
