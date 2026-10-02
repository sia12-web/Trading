'use client'

/**
 * Performance Analytics Dashboard
 * Dual view for (1) My CMC Markets CFD ($2,000 Capital) and (2) NYC Team Tape Desk.
 * Features full analytics: KPI cards, Trade Duration & Win Rate analysis,
 * Daily P&L visualizers, Monthly P&L calendar, and executed trades ledger.
 */

import { useState } from 'react'
import Link from 'next/link'

type AccountMode = 'cmc' | 'team'
type DateFilter = 'today' | 'last_week' | 'last_month' | 'custom'

const DURATION_BUCKETS = [
  'Under 15 sec',
  '15-45 sec',
  '45 sec - 1 min',
  '1 min - 2 min',
  '2 min - 5 min',
  '5 min - 10 min',
  '10 min - 30 min',
  '30 min - 1 hour',
  '1 hour - 2 hours',
  '2 hours - 4 hours',
  '4 hours and up',
]

const MONTHLY_WEEKS = [
  { week: 'Week 1', pnl: 0, trades: 0 },
  { week: 'Week 2', pnl: 0, trades: 0 },
  { week: 'Week 3', pnl: 0, trades: 0 },
  { week: 'Week 4', pnl: 0, trades: 0 },
  { week: 'Week 5', pnl: 0, trades: 0 },
]

export default function PerformancePage() {
  const [accountMode, setAccountMode] = useState<AccountMode>('cmc')
  const [dateFilter, setDateFilter] = useState<DateFilter>('custom')
  const [copiedLink, setCopiedLink] = useState(false)

  const isCmc = accountMode === 'cmc'
  const accountId = isCmc ? 'CMC-CFD-LIVE-2000' : '1.5KCHCR-LABS004-V2-675081-67067724'
  const accountTitle = isCmc ? 'My CMC Markets CFD Account' : 'NYC Team Tape Desk'
  const capitalLabel = isCmc ? 'Starting Capital: $2,000.00 · Live CFD Desk' : 'NYC Stocks & Options Team Book'

  const handleCopyLink = () => {
    try {
      void navigator.clipboard.writeText(window.location.href)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {}
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
      {/* Top Header & Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>📊</span> Performance Analytics Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Comprehensive account metrics, trade duration analysis, P&amp;L calendar, and trade ledger.
          </p>
        </div>
        <Link href="/dashboard/chart" className="text-xs text-gray-400 hover:text-white transition">
          ← Return to Chart Desk
        </Link>
      </div>

      {/* Account Switcher Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#161b22] p-2 rounded-xl border border-white/10 shadow-lg">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAccountMode('cmc')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              accountMode === 'cmc'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>💳</span>
            <span>My CMC Markets CFD ($2,000)</span>
          </button>
          <button
            type="button"
            onClick={() => setAccountMode('team')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              accountMode === 'team'
                ? 'bg-sky-600 text-white shadow-md'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>👥</span>
            <span>NYC Team Tape (Options &amp; Stocks)</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
          <span className="text-gray-500">Account ID:</span>
          <span className="font-bold text-white bg-black/50 px-2.5 py-1 rounded border border-white/10">
            {accountId}
          </span>
        </div>
      </div>

      {/* Account Identifier & Date Range Controls Bar */}
      <div className="rounded-xl border border-white/10 bg-[#161b22] p-4 space-y-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              {accountTitle}
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${isCmc ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' : 'bg-sky-950 text-sky-300 border border-sky-700/50'}`}>
                {isCmc ? 'LIVE CFD DESK' : 'TEAM TAPE'}
              </span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{capitalLabel}</p>
          </div>

          {/* Date Range Filter Controls */}
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg bg-black/50 p-1 border border-white/10 text-xs">
              {(
                [
                  { id: 'custom', label: '09/30/2026 – 10/01/2026' },
                  { id: 'today', label: 'TODAY' },
                  { id: 'last_week', label: 'LAST WEEK' },
                  { id: 'last_month', label: 'LAST MONTH' },
                ] as const
              ).map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setDateFilter(btn.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition ${
                    dateFilter === btn.id
                      ? 'bg-sky-600 text-white font-bold'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleCopyLink}
              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-gray-300 font-semibold transition flex items-center gap-1.5"
            >
              <span>🔗</span>
              <span>{copiedLink ? 'Copied!' : 'Share'}</span>
            </button>
          </div>
        </div>

        {/* Primary KPI Metrics Row 1 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Total P&amp;L</div>
            <div className="mt-1 text-xl font-bold price-mono text-white">$0.00</div>
            <div className="text-[10px] text-gray-500 mt-0.5">0 active days</div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Trade Win %</div>
            <div className="mt-1 text-xl font-bold price-mono text-white">0.00%</div>
            <div className="text-[10px] text-gray-500 mt-0.5">0.00 avg trades/day</div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Avg Win / Avg Loss</div>
            <div className="mt-1 text-xl font-bold price-mono text-gray-300">N/A</div>
            <div className="text-[10px] text-gray-500 mt-0.5">$0.00 / $0.00</div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Day Win %</div>
            <div className="mt-1 text-base font-bold text-gray-400">No trades</div>
            <div className="text-[10px] text-gray-500 mt-0.5">0 active days</div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Profit Factor</div>
            <div className="mt-1 text-xl font-bold price-mono text-sky-300">N/A</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Gross / Loss</div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Best Day % Total</div>
            <div className="mt-1 text-xl font-bold price-mono text-white">0.00%</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Peak concentration</div>
          </div>
        </div>

        {/* Daily Account Balance Visualizer */}
        <div className="rounded-lg border border-white/10 bg-[#0d1117] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span className="font-semibold text-gray-300">Daily Account Balance</span>
            <span className="font-mono text-[11px]">0 active days · 0 total trades</span>
          </div>
          <div className="h-28 w-full rounded border border-white/5 bg-black/40 flex items-center justify-center text-xs text-gray-600 font-mono">
            [ Balance Curve Chart — Equity $2,000.00 Baseline ]
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-1">
            <div className="p-2 rounded bg-white/[0.02] border border-white/5">
              <span className="text-[10px] text-gray-500 block">Most Active Day</span>
              <span className="text-gray-300 font-semibold">No active days</span>
            </div>
            <div className="p-2 rounded bg-white/[0.02] border border-white/5">
              <span className="text-[10px] text-gray-500 block">Most Profitable Day</span>
              <span className="text-emerald-400 font-bold">$0.00</span>
            </div>
            <div className="p-2 rounded bg-white/[0.02] border border-white/5">
              <span className="text-[10px] text-gray-500 block">Least Profitable Day</span>
              <span className="text-red-400 font-bold">$0.00</span>
            </div>
          </div>
        </div>

        {/* Detailed Trade Statistics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs font-mono">
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Total Trades</span>
            <span className="text-white font-bold text-sm">0</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Total Lots</span>
            <span className="text-white font-bold text-sm">0</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Avg Duration</span>
            <span className="text-gray-300 text-sm">0 sec</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Win Duration</span>
            <span className="text-emerald-400 text-sm">0 sec</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Loss Duration</span>
            <span className="text-red-400 text-sm">0 sec</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Avg Win Trade</span>
            <span className="text-emerald-400 font-bold text-sm">$0.00</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Avg Loss Trade</span>
            <span className="text-red-400 font-bold text-sm">$0.00</span>
          </div>
        </div>

        {/* Direction % & Best/Worst Trade */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
          <div className="p-3 rounded-lg bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase font-semibold text-gray-400 block">Trade Direction % (Long)</span>
            <span className="text-lg font-bold text-white">0.00%</span>
            <span className="text-[10px] text-gray-500 block mt-0.5">0 Long · 0 Short</span>
          </div>
          <div className="p-3 rounded-lg bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase font-semibold text-gray-400 block">Best Trade</span>
            <span className="text-lg font-bold text-emerald-400">N/A</span>
            <span className="text-[10px] text-gray-500 block mt-0.5">Highest single win</span>
          </div>
          <div className="p-3 rounded-lg bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase font-semibold text-gray-400 block">Worst Trade</span>
            <span className="text-lg font-bold text-red-400">N/A</span>
            <span className="text-[10px] text-gray-500 block mt-0.5">Largest single drawdown</span>
          </div>
        </div>

        {/* Dual Visualizers: Daily Net Cumulative P&L & Net Daily P&L */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3.5 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
              📈 Daily Net Cumulative P&amp;L
            </h4>
            <div className="h-28 w-full rounded border border-white/5 bg-black/40 flex items-center justify-center text-xs text-gray-600 font-mono">
              [ Cumulative P&amp;L Growth — $0.00 Baseline ]
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3.5 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
              📊 Net Daily P&amp;L
            </h4>
            <div className="h-28 w-full rounded border border-white/5 bg-black/40 flex items-center justify-center text-xs text-gray-600 font-mono">
              [ Daily P&amp;L Bars — $0.00 Baseline ]
            </div>
          </div>
        </div>

        {/* Trade Duration Analysis & Win Rate Analysis Buckets */}
        <div className="rounded-lg border border-white/10 bg-[#0d1117] p-4 space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-2">
            <span>⏱️</span> Trade Duration Analysis &amp; Win Rate Distribution
          </h4>
          <div className="space-y-1.5 font-mono text-xs">
            {DURATION_BUCKETS.map((bucket) => (
              <div key={bucket} className="flex items-center justify-between py-1 px-2 rounded bg-black/30 border border-white/5 hover:bg-white/5 transition">
                <span className="text-gray-300 font-medium">{bucket}</span>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-gray-400">0 trades</span>
                  <span className="text-sky-300 font-bold">0.00% WR</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly P&L Calendar Visualizer */}
        <div className="rounded-lg border border-white/10 bg-[#0d1117] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
              <span>📅</span> Monthly P/L Calendar (Oct 2026)
            </h4>
            <span className="text-xs font-extrabold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded border border-emerald-700/50">
              Monthly P/L: $0.00
            </span>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase font-extrabold text-gray-400 border-b border-white/10 pb-2">
            <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
          </div>

          <div className="space-y-1.5 font-mono text-xs">
            {MONTHLY_WEEKS.map((w) => (
              <div key={w.week} className="flex items-center justify-between p-2.5 rounded bg-black/40 border border-white/5">
                <span className="text-gray-300 font-bold">{w.week}</span>
                <div className="flex items-center gap-3">
                  <span className="text-emerald-400 font-bold">${w.pnl.toFixed(2)}</span>
                  <span className="text-gray-500 text-[11px]">{w.trades} trades</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Executed Trades Table */}
        <div className="rounded-lg border border-white/10 bg-[#0d1117] p-4 space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-2">
            <span>📋</span> Executed Trades Ledger
          </h4>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-black/50 text-[10px] uppercase text-gray-400 border-b border-white/10">
                <tr>
                  <th className="py-2 px-2">Journal ID</th>
                  <th className="py-2 px-2">Contract</th>
                  <th className="py-2 px-2">Size</th>
                  <th className="py-2 px-2">Entry Time</th>
                  <th className="py-2 px-2">Exit Time</th>
                  <th className="py-2 px-2">Duration</th>
                  <th className="py-2 px-2">Entry Price</th>
                  <th className="py-2 px-2">Exit Price</th>
                  <th className="py-2 px-2">P&amp;L</th>
                  <th className="py-2 px-2">Commissions</th>
                  <th className="py-2 px-2">Direction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-gray-300">
                <tr>
                  <td colSpan={11} className="py-6 text-center text-gray-500 italic">
                    No executed trades recorded in this period.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
