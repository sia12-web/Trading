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
} from '@/lib/trading/sessionGate'

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
        setNextHint(
          next === 'TOKYO'
            ? 'No live session. Live Trading unlocks 30 minutes before Tokyo open (08:30 JST).'
            : 'No live session. Live Trading unlocks 30 minutes before NY open (09:00 ET).'
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
            title="Unlocks 30 minutes before NY or Tokyo cash open"
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
      </div>

      <p className="mt-10 text-xs text-gray-600 leading-relaxed max-w-md">
        Clock in during prep (15 minutes before cash open). Late after the open means that
        session is skipped — no AI, no trades. Tip and desk unlock 30 minutes before the next
        open.
      </p>
    </div>
  )
}
