'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { AsianEdgePanel } from '../chart/components/AsianEdgePanel'

interface CashPrice {
  price: number
  bid: number
  ask: number
  label: string
}

export default function AsianEdgeDashboardPage() {
  const [cashPrices, setCashPrices] = useState<Record<string, CashPrice>>({})
  const [loadingPrices, setLoadingPrices] = useState(true)

  const fetchPrices = async () => {
    try {
      const res = await fetch('/api/trading/asian-edge/prices')
      const data = await res.json()
      if (data.success && data.prices) {
        setCashPrices(data.prices)
      }
    } catch {
      // ignore poll error
    } finally {
      setLoadingPrices(false)
    }
  }

  useEffect(() => {
    fetchPrices()
    const interval = setInterval(fetchPrices, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-neutral-950 text-white font-sans overflow-y-auto">
      {/* Top Banner */}
      <header className="px-6 py-4 border-b border-neutral-800 bg-neutral-900/60 backdrop-blur-md sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🌙</span>
            <h1 className="text-base font-bold font-mono tracking-wide text-amber-200">
              Asian Edge Institutional Desk
            </h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              CMC Markets Cash Edition
            </span>
          </div>
          <p className="text-xs text-neutral-400 font-mono mt-0.5">
            Overnight Box Breakout & Prior POC Reversion • Live OANDA Cash Feeds
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard/chart"
            className="px-3.5 py-1.5 rounded-lg bg-surface-900 hover:bg-surface-800 border border-neutral-700 text-xs font-mono font-semibold transition flex items-center gap-1.5"
          >
            <span>📈</span>
            <span>Open Chart View</span>
          </Link>
          <a
            href="https://t.me/AsianEdge1bot"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-mono font-bold transition flex items-center gap-1.5 shadow"
          >
            <span>📱</span>
            <span>Telegram Bot (@AsianEdge1bot)</span>
          </a>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Live CMC Markets / OANDA Cash Ticker Cards */}
        <section className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-neutral-400 px-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE CMC MARKETS CASH PRICES (OANDA CFD FEED)</span>
            </span>
            <span>{loadingPrices ? 'Connecting feed...' : 'Updated live (5s polling)'}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Gold Cash */}
            <div className="p-3.5 rounded-xl bg-surface-900/90 border border-neutral-800 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                <span>Gold - Cash (MGC)</span>
                <span className="text-[10px] text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/60">
                  XAU/USD
                </span>
              </div>
              <div className="text-xl font-mono font-bold text-amber-300">
                {cashPrices.GOLD?.price != null ? `$${cashPrices.GOLD.price.toFixed(2)}` : 'Connecting...'}
              </div>
              <div className="text-[10px] font-mono text-neutral-400 flex justify-between">
                <span>Bid: {cashPrices.GOLD?.bid?.toFixed(2) ?? '—'}</span>
                <span>Ask: {cashPrices.GOLD?.ask?.toFixed(2) ?? '—'}</span>
              </div>
            </div>

            {/* US 30 Cash */}
            <div className="p-3.5 rounded-xl bg-surface-900/90 border border-neutral-800 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                <span>US 30 - Cash (MYM)</span>
                <span className="text-[10px] text-blue-400 bg-blue-950/80 px-1.5 py-0.5 rounded border border-blue-800/60">
                  US30
                </span>
              </div>
              <div className="text-xl font-mono font-bold text-blue-300">
                {cashPrices.DOW?.price != null ? cashPrices.DOW.price.toFixed(1) : 'Connecting...'}
              </div>
              <div className="text-[10px] font-mono text-neutral-400 flex justify-between">
                <span>Bid: {cashPrices.DOW?.bid?.toFixed(1) ?? '—'}</span>
                <span>Ask: {cashPrices.DOW?.ask?.toFixed(1) ?? '—'}</span>
              </div>
            </div>

            {/* US NDAQ 100 Cash */}
            <div className="p-3.5 rounded-xl bg-surface-900/90 border border-neutral-800 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                <span>US NDAQ 100 - Cash (MNQ)</span>
                <span className="text-[10px] text-purple-400 bg-purple-950/80 px-1.5 py-0.5 rounded border border-purple-800/60">
                  NAS100
                </span>
              </div>
              <div className="text-xl font-mono font-bold text-purple-300">
                {cashPrices.NASDAQ?.price != null ? cashPrices.NASDAQ.price.toFixed(1) : 'Connecting...'}
              </div>
              <div className="text-[10px] font-mono text-neutral-400 flex justify-between">
                <span>Bid: {cashPrices.NASDAQ?.bid?.toFixed(1) ?? '—'}</span>
                <span>Ask: {cashPrices.NASDAQ?.ask?.toFixed(1) ?? '—'}</span>
              </div>
            </div>

            {/* Crude Oil West Texas Cash */}
            <div className="p-3.5 rounded-xl bg-surface-900/90 border border-neutral-800 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400">
                <span>Crude Oil WTI - Cash (MCL)</span>
                <span className="text-[10px] text-red-400 bg-red-950/80 px-1.5 py-0.5 rounded border border-red-800/60">
                  GATED (AVOID)
                </span>
              </div>
              <div className="text-xl font-mono font-bold text-neutral-300">
                {cashPrices.OIL?.price != null ? `$${cashPrices.OIL.price.toFixed(2)}` : 'Connecting...'}
              </div>
              <div className="text-[10px] font-mono text-red-400">
                <span>⛔ Asia Gated: Confine to NY Cash</span>
              </div>
            </div>
          </div>
        </section>

        {/* Asian Edge Core Execution & Outing Console */}
        <section className="bg-neutral-900/80 border border-neutral-800 rounded-2xl p-4 shadow-xl">
          <div className="max-w-2xl mx-auto">
            <AsianEdgePanel
              instrument="GOLD"
              currentPrice={cashPrices.GOLD?.price}
              onAskLeo={(prompt) => {
                window.location.href = `/dashboard/chart?prompt=${encodeURIComponent(prompt)}`
              }}
            />
          </div>
        </section>
      </main>
    </div>
  )
}
