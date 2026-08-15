'use client'

import Link from 'next/link'
import { TradeifyProgressPanel } from '../components/TradeifyProgressPanel'

export default function TradeifyDashboardPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Tradeify $50k</h1>
          <p className="mt-1 text-sm text-gray-400">
            Growth eval progress — shared daily budget across Nikkei, NASDAQ, and DOW.
          </p>
        </div>
        <Link href="/dashboard" className="text-xs text-gray-500 hover:text-white">
          ← Desk
        </Link>
      </div>
      <TradeifyProgressPanel />
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/dashboard/chart"
          className="rounded-lg bg-brand-600/90 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500"
        >
          Live Trading →
        </Link>
        <Link
          href="/dashboard/journal"
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-300 hover:text-white"
        >
          Journal
        </Link>
      </div>
    </div>
  )
}
