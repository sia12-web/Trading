'use client'

/**
 * NYC Team Tape & Live Desk Book
 * Clean, interactive view of Ongoing Positions, Working Limits, and Past Orders (Fills)
 * with exact CME Futures Exchange prices, SL/TP levels, and Win/Loss P&L outcomes.
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

type TabType = 'all' | 'open' | 'limits' | 'history'

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
