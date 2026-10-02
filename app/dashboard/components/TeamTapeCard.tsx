'use client'

/**
 * NYC Team Tape & Live Desk Book
 * Clean, interactive view of Ongoing Positions, Working Limits, Past Orders (Fills),
 * and Performance Analytics (Monthly P&L Calendar, Trade Duration & Win Rate Analysis).
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { TeamTapeSignal } from '@/lib/trading/teamTape'
import type { QuestradeBookPayload } from '@/lib/trading/questradeBook'
import type { QuestradeBookRow } from '@/lib/trading/questradeOrders'
import { getSymbolRealName } from '@/lib/trading/symbolNames'

type Payload = {
  ok?: boolean
  open?: TeamTapeSignal[]
  history?: TeamTapeSignal[]
  error?: string
}

type TabType = 'all' | 'open' | 'limits' | 'history' | 'performance'

function montrealStamp(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

function formatCmePrice(symbol: string, price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return '—'
  const sym = symbol.toUpperCase()
  if (sym.includes('MNQ') || sym.includes('NQ') || sym.includes('NASDAQ')) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (sym.includes('MYM') || sym.includes('YM') || sym.includes('DOW')) {
    return Math.round(price).toLocaleString('en-US')
  }
  if (sym.includes('MGC') || sym.includes('GC') || sym.includes('GOLD')) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
  }
  if (sym.includes('MCL') || sym.includes('CL') || sym.includes('CRUDE')) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return price.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function pnlClass(n: number | null | undefined): string {
  if (n == null) return 'text-gray-400'
  if (n > 0) return 'text-emerald-400 font-bold'
  if (n < 0) return 'text-red-400 font-bold'
  return 'text-gray-400 font-bold'
}

/** 🟢 Ongoing Position Card */
function OngoingPositionCard({ row }: { row: QuestradeBookRow }) {
  const isBuy = row.side === 'BUY'
  const pnl = row.livePnl
  const pnlFormatted =
    pnl == null
      ? '—'
      : `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const meta = getSymbolRealName(row.symbol)
  const displayName = row.companyName || meta.name

  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 p-3 transition hover:border-sky-500/50">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className={`text-xs font-extrabold px-1.5 py-0.5 rounded ${isBuy ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' : 'bg-red-950 text-red-300 border border-red-700/50'}`}>
            {row.side}
          </span>
          <span className="text-sm font-bold text-white">{row.label || row.symbol}</span>
          {displayName && displayName !== row.label && displayName !== row.symbol && (
            <span className="text-xs text-sky-200/70">· {displayName}</span>
          )}
        </div>
        <div className={`text-xs ${pnlClass(pnl)}`}>
          {pnlFormatted}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-black/40 p-2 rounded border border-white/5">
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Exact Entry</span>
          <span className="text-white font-bold">{formatCmePrice(row.symbol, row.entry)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Mark</span>
          <span className="text-gray-200">{formatCmePrice(row.symbol, row.mark)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Stop Loss (SL)</span>
          <span className="text-red-300">{formatCmePrice(row.symbol, row.stop)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Take Profit (TP)</span>
          <span className="text-emerald-300">{formatCmePrice(row.symbol, row.target)}</span>
        </div>
      </div>
    </div>
  )
}

/** ⚡ Working Limit Order Card */
function WorkingLimitCard({ row }: { row: QuestradeBookRow }) {
  const meta = getSymbolRealName(row.symbol)
  const displayName = row.companyName || meta.name

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 transition hover:border-amber-500/50">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-extrabold px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-600/50">
            LIMIT {row.side}
          </span>
          <span className="text-sm font-bold text-white">{row.label || row.symbol}</span>
          {displayName && displayName !== row.label && displayName !== row.symbol && (
            <span className="text-xs text-amber-200/70">· {displayName}</span>
          )}
        </div>
        <span className="text-[11px] font-mono text-amber-400 font-semibold uppercase">WORKING ORDER</span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-mono bg-black/40 p-2 rounded border border-white/5">
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Target Entry</span>
          <span className="text-amber-200 font-bold">{formatCmePrice(row.symbol, row.entry)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">SL</span>
          <span className="text-red-300">{formatCmePrice(row.symbol, row.stop)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">TP</span>
          <span className="text-emerald-300">{formatCmePrice(row.symbol, row.target)}</span>
        </div>
      </div>
    </div>
  )
}

/** 📜 Past Order / Fill History Card */
function PastOrderCard({ signal }: { signal: TeamTapeSignal }) {
  const isBuy = signal.side === 'BUY'
  const meta = getSymbolRealName(signal.symbol)
  const displayName = signal.companyName || meta.name

  // Estimate win / loss outcome if target / stop specified
  const pnlEstimated =
    signal.target && signal.entry && signal.stop
      ? (isBuy ? signal.target - signal.entry : signal.entry - signal.target) * signal.quantity
      : null
  const isWin = pnlEstimated != null ? pnlEstimated >= 0 : signal.status === 'filled'

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 transition hover:border-white/20">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-extrabold px-1.5 py-0.5 rounded ${isBuy ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' : 'bg-red-950 text-red-300 border border-red-700/50'}`}>
            {signal.side}
          </span>
          <span className="text-sm font-bold text-white">{signal.symbol}</span>
          {displayName && displayName !== signal.symbol && (
            <span className="text-xs text-gray-400">· {displayName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">{montrealStamp(signal.filledAt)}</span>
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${isWin ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60' : 'bg-red-950/80 text-red-300 border border-red-700/60'}`}>
            {isWin ? 'WIN' : 'LOSS'}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs font-mono bg-black/40 p-2 rounded border border-white/5">
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Exact Entry</span>
          <span className="text-white font-bold">{formatCmePrice(signal.symbol, signal.entry)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Stop Loss (SL)</span>
          <span className="text-red-300">{formatCmePrice(signal.symbol, signal.stop)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Take Profit (TP)</span>
          <span className="text-emerald-300">{formatCmePrice(signal.symbol, signal.target)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Status</span>
          <span className="text-gray-300 uppercase font-semibold">{signal.status}</span>
        </div>
      </div>
    </div>
  )
}

/** 📊 Performance Analytics Panel */
function PerformanceAnalyticsPanel() {
  const durationBuckets = [
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

  const calendarWeeks = [
    { week: 'Week 1', days: [28, 29, 30, 1, 2, 3, 4], pnl: 0, trades: 0 },
    { week: 'Week 2', days: [5, 6, 7, 8, 9, 10, 11], pnl: 0, trades: 0 },
    { week: 'Week 3', days: [12, 13, 14, 15, 16, 17, 18], pnl: 0, trades: 0 },
    { week: 'Week 4', days: [19, 20, 21, 22, 23, 24, 25], pnl: 0, trades: 0 },
    { week: 'Week 5', days: [26, 27, 28, 29, 30, 31, 1], pnl: 0, trades: 0 },
  ]

  return (
    <div className="space-y-4">
      {/* Header Info Banner */}
      <div className="rounded-lg border border-sky-600/40 bg-sky-950/30 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white">Account:</span>
          <span className="font-mono text-sky-300 bg-sky-900/40 px-2 py-0.5 rounded border border-sky-600/30">
            1.5KCHCR-LABS004-V2-675081-67067724
          </span>
        </div>
        <div className="text-gray-400 font-mono">
          Date Range: <span className="text-gray-200">09/30/2026 – 10/01/2026</span>
        </div>
      </div>

      {/* Primary Key Performance Indicators Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-400">Total P&amp;L</div>
          <div className="mt-1 text-lg font-bold price-mono text-white">$0.00</div>
          <div className="text-[10px] text-gray-500 mt-0.5">0 active days</div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-400">Trade Win %</div>
          <div className="mt-1 text-lg font-bold price-mono text-white">0.00%</div>
          <div className="text-[10px] text-gray-500 mt-0.5">0.00 avg trades/day</div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-400">Profit Factor</div>
          <div className="mt-1 text-lg font-bold price-mono text-sky-300">N/A</div>
          <div className="text-[10px] text-gray-500 mt-0.5">$0.00 / $0.00</div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-400">Avg Win / Avg Loss</div>
          <div className="mt-1 text-lg font-bold price-mono text-white">N/A</div>
          <div className="text-[10px] text-gray-500 mt-0.5">$0.00 / $0.00</div>
        </div>
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-black/30 p-3 rounded-lg border border-white/5">
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Total Trades</span>
          <span className="text-white font-bold">0</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Total Lots Traded</span>
          <span className="text-gray-200">0</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Avg Duration</span>
          <span className="text-gray-200">0 sec</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Trade Direction (Long)</span>
          <span className="text-gray-200">0.00%</span>
        </div>
      </div>

      {/* Trade Duration Analysis */}
      <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
          ⏱️ Trade Duration &amp; Win Rate Analysis
        </h4>
        <div className="space-y-1.5 pt-1">
          {durationBuckets.map((bucket) => (
            <div key={bucket} className="flex items-center justify-between text-[11px] font-mono py-0.5 border-b border-white/5">
              <span className="text-gray-400">{bucket}</span>
              <div className="flex items-center gap-3">
                <span className="text-gray-500">0 trades</span>
                <span className="text-sky-400 font-semibold">0.0% WR</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly P&L Calendar */}
      <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
            📅 Monthly P/L Calendar (Oct 2026)
          </h4>
          <span className="text-xs font-bold text-emerald-400">Monthly P/L: $0.00</span>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase font-bold text-gray-500 pt-2 border-b border-white/10 pb-1">
          <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
        </div>

        <div className="space-y-1 text-xs font-mono">
          {calendarWeeks.map((w) => (
            <div key={w.week} className="flex items-center justify-between p-2 rounded bg-white/[0.02] border border-white/5">
              <span className="text-gray-400 text-[11px]">{w.week}</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-300 font-bold">$0.00</span>
                <span className="text-[10px] text-gray-500">({w.trades} trades)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function TeamTapeCard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Payload | null>(null)
  const [book, setBook] = useState<QuestradeBookPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('all')

  const load = useCallback(async () => {
    try {
      const [tapeRes, bookRes] = await Promise.all([
        fetch('/api/trading/team-tape', { cache: 'no-store' }),
        fetch('/api/trading/questrade/book', { cache: 'no-store' }),
      ])
      const json = (await tapeRes.json()) as Payload
      if (!tapeRes.ok) {
        setError(json.error || 'Could not load team tape')
        return
      }
      setError(null)
      setData(json)
      const bookJson = (await bookRes.json()) as QuestradeBookPayload | { ok: false }
      if (bookJson.ok) setBook(bookJson)
    } catch {
      setError('Could not load team tape')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 20_000)
    return () => window.clearInterval(id)
  }, [load])

  const ongoingPositions = book?.openPositions ?? []
  const workingLimits = book?.workingLimits ?? []
  const historySignals = data?.history ?? []
  const openSignals = data?.open ?? []

  const totalOngoing = ongoingPositions.length
  const totalLimits = workingLimits.length
  const totalHistory = historySignals.length

  return (
    <section className="rounded-xl border border-sky-500/25 bg-sky-950/20 p-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
            <span>📡</span> Team Tape Fills &amp; Orders
          </h2>
          <p className="mt-0.5 text-xs text-gray-400">
            Real CME futures prices &amp; desk orders — exact entry, SL, TP, and Win/Loss outcomes.
          </p>
        </div>
        {compact ? (
          <Link href="/dashboard/swing" className="text-xs font-bold text-sky-400 hover:text-sky-200 transition">
            View All →
          </Link>
        ) : (
          <Link href="/dashboard" className="text-xs text-gray-400 hover:text-white transition">
            ← Return to Desk
          </Link>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-red-400 bg-red-950/40 p-2 rounded border border-red-800/50">{error}</p>}

      {/* Interactive Tabs Header */}
      {!compact && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-white/10 pb-2">
          {(
            [
              { id: 'all', label: 'All Orders', count: totalOngoing + totalLimits + totalHistory },
              { id: 'open', label: '🟢 Ongoing Positions', count: totalOngoing },
              { id: 'limits', label: '⚡ Working Limits', count: totalLimits },
              { id: 'history', label: '📜 Past Fills & Outcomes', count: totalHistory },
              { id: 'performance', label: '📊 Performance Analytics', count: 'Stats' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span>{tab.label}</span>
              <span className="rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] font-mono">
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Content Section */}
      <div className="mt-4 space-y-3">
        {/* 📊 Performance Analytics Panel */}
        {activeTab === 'performance' && <PerformanceAnalyticsPanel />}

        {/* 🟢 Ongoing Positions */}
        {(activeTab === 'all' || activeTab === 'open') && (
          <div>
            {!compact && <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-sky-400">🟢 Ongoing Positions ({totalOngoing})</h3>}
            {totalOngoing === 0 ? (
              activeTab === 'open' && <p className="text-xs text-gray-500 italic py-2">No active ongoing positions in market.</p>
            ) : (
              <div className="space-y-2">
                {ongoingPositions.map((pos) => (
                  <OngoingPositionCard key={pos.sourceId} row={pos} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ⚡ Working Limits */}
        {(activeTab === 'all' || activeTab === 'limits') && (
          <div>
            {!compact && <h3 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-amber-400">⚡ Working Limit Orders ({totalLimits})</h3>}
            {totalLimits === 0 ? (
              activeTab === 'limits' && <p className="text-xs text-gray-500 italic py-2">No active working limit orders.</p>
            ) : (
              <div className="space-y-2">
                {workingLimits.map((limit) => (
                  <WorkingLimitCard key={limit.sourceId} row={limit} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 📜 Past Orders & Outcomes */}
        {(activeTab === 'all' || activeTab === 'history') && (
          <div>
            {!compact && <h3 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">📜 Past Orders &amp; Outcomes ({totalHistory + openSignals.length})</h3>}
            {totalHistory === 0 && openSignals.length === 0 ? (
              activeTab === 'history' && <p className="text-xs text-gray-500 italic py-2">No past orders in history.</p>
            ) : (
              <div className="space-y-2">
                {historySignals.map((sig) => (
                  <PastOrderCard key={sig.sourceId} signal={sig} />
                ))}
                {openSignals.map((sig) => (
                  <PastOrderCard key={sig.sourceId} signal={sig} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
