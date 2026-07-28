'use client'

/**
 * Desk home — default landing when no live focus window (−30m → cash close).
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  isAnyLiveFocusWindowActive,
  liveFocusMarket,
  nextLiveDeskMarket,
  TOKYO_SESSION,
  NY_SESSION,
} from '@/lib/trading/sessionGate'
import {
  TRADER_DISPLAY_LABEL,
  deskLocalHmsAsTraderDisplay,
} from '@/lib/chart/traderDisplayTz'

/** Focus unlock = cash open − 30m, shown in Montreal (ET). */
function focusUnlockMontreal(market: 'NY' | 'TOKYO', now: Date): string {
  if (market === 'TOKYO') {
    // Tokyo open 09:00 JST → focus 08:30 JST → Montreal ET
    return `${deskLocalHmsAsTraderDisplay('08:30:00', TOKYO_SESSION.tz, now)} ${TRADER_DISPLAY_LABEL}`
  }
  // NY open 09:30 → focus 09:00 America/New_York (= Montreal ET)
  return `${deskLocalHmsAsTraderDisplay('09:00:00', NY_SESSION.tz, now)} ${TRADER_DISPLAY_LABEL}`
}

export default function DashboardHomePage() {
  const [focusLive, setFocusLive] = useState(false)
  const [nextHint, setNextHint] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const live = isAnyLiveFocusWindowActive(now)
      setFocusLive(live)
      if (live) {
        const m = liveFocusMarket(now)
        setNextHint(
          m === 'TOKYO'
            ? 'Tokyo focus is open — Live Trading unlocked.'
            : 'NY focus is open — Live Trading unlocked.'
        )
      } else {
        const next = nextLiveDeskMarket(now)
        const unlockAt = focusUnlockMontreal(next === 'TOKYO' ? 'TOKYO' : 'NY', now)
        setNextHint(
          next === 'TOKYO'
            ? `No live session. Live Trading unlocks 30 minutes before Tokyo open (${unlockAt}).`
            : `No live session. Live Trading unlocks 30 minutes before NY open (${unlockAt}).`
        )
      }
    }
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight text-white">Desk</h1>
      <p className="mt-2 text-sm text-gray-400 leading-relaxed">{nextHint}</p>

      <div className="mt-8 flex flex-wrap gap-3">
        {focusLive ? (
          <Link
            href="/dashboard/chart"
            className="rounded-lg bg-brand-600/90 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500"
          >
            Open Live Trading →
          </Link>
        ) : (
          <span
            className="rounded-lg border border-surface-600 bg-surface-800/80 px-4 py-2.5 text-sm font-semibold text-gray-500"
            title="Unlocks 30 minutes before NY or Tokyo cash open (Montreal / ET)"
          >
            Live Trading locked
          </span>
        )}
        <Link
          href="/dashboard/simulation"
          className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-4 py-2.5 text-sm font-semibold text-violet-200 hover:bg-violet-500/25"
        >
          Simulation →
        </Link>
        <Link
          href="/dashboard/positions"
          className="rounded-lg border border-surface-600 px-4 py-2.5 text-sm font-semibold text-gray-300 hover:border-surface-500 hover:text-white"
        >
          Positions
        </Link>
        <Link
          href="/dashboard/journal"
          className="rounded-lg border border-surface-600 px-4 py-2.5 text-sm font-semibold text-gray-300 hover:border-surface-500 hover:text-white"
        >
          Order History
        </Link>
        <Link
          href="/dashboard/news"
          className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-500/20"
        >
          Desk News →
        </Link>
      </div>

      <p className="mt-10 text-xs text-gray-600 leading-relaxed max-w-md">
        Clock in during prep (15 minutes before cash open). Late after the open means that
        session is skipped — no AI, no trades. Tip and desk unlock 30 minutes before the next
        open. All desk clocks show Montreal time ({TRADER_DISPLAY_LABEL}).
      </p>
    </div>
  )
}
