'use client'

/**
 * Simulation paper order history — by replay day & market.
 * Live trades never appear here (see Live History).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI' | 'ALL'

interface SimEntry {
  id: string
  instrument: string
  market: 'NY' | 'TOKYO'
  replay_date: string
  direction: string
  status: 'closed'
  fill: {
    time_unix: number
    price: number
    level: number
    reason: string
    conviction: number | null
  }
  risk: {
    stop_loss: number
    take_profit: number | null
    position_size: number
    risk_amount: number
    account_size: number
  }
  exit: {
    time_unix: number
    price: number
    reason_code: string
  }
  pnl: { dollars: number; percent: number | null }
  created_at: string
}

interface Summary {
  trades: number
  closed: number
  wins: number
  losses: number
  stop_outs: number
  take_profits: number
  manuals: number
  win_rate: number | null
  total_pnl: number
  starting_account: number
  ending_equity: number
  equity_change: number
  days: number
}

interface DayGroup {
  date: string
  market: string
  instrument: string
  trades: SimEntry[]
  dayPnl: number
}

function fmtSimClock(unix: number, market: string): string {
  if (!unix) return '—'
  const tz = market === 'TOKYO' ? 'Asia/Tokyo' : 'America/New_York'
  const label = market === 'TOKYO' ? 'JST' : 'ET'
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(unix * 1000))
    return `${s} ${label}`
  } catch {
    return String(unix)
  }
}

function fmtMoney(n: number | null | undefined, signed = false): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  if (signed) return `${n >= 0 ? '+' : '−'}$${abs}`
  return `$${abs}`
}

function exitBadge(code: string): { label: string; className: string } {
  switch (code) {
    case 'stop_hit':
      return { label: 'STOP LOSS', className: 'bg-red-900/40 text-red-300 border-red-800' }
    case 'take_profit':
      return { label: 'TAKE PROFIT', className: 'bg-emerald-900/40 text-emerald-300 border-emerald-800' }
    case 'manual':
      return { label: 'MANUAL', className: 'bg-slate-800 text-slate-300 border-slate-600' }
    default:
      return { label: code.toUpperCase(), className: 'bg-slate-800 text-slate-400 border-slate-600' }
  }
}

function formatDayLabel(date: string): string {
  try {
    const [y, m, d] = date.split('-').map(Number)
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(y!, m! - 1, d!)))
  } catch {
    return date
  }
}

export default function SimHistoryPage() {
  const [instrument, setInstrument] = useState<Instrument>('ALL')
  const [days, setDays] = useState(30)
  const [entries, setEntries] = useState<SimEntry[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ days: String(days), limit: '80' })
      if (instrument !== 'ALL') q.set('instrument', instrument)
      const res = await fetch(`/api/trading/sim-journal?${q}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || json.detail || 'Failed to load sim history')
        setEntries([])
        setSummary(null)
        return
      }
      setEntries(json.entries || [])
      setSummary(json.summary || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sim history')
      setEntries([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [days, instrument])

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => {
    const map = new Map<string, DayGroup>()
    for (const e of entries) {
      const key = `${e.replay_date}|${e.market}|${e.instrument}`
      let g = map.get(key)
      if (!g) {
        g = {
          date: e.replay_date,
          market: e.market,
          instrument: e.instrument,
          trades: [],
          dayPnl: 0,
        }
        map.set(key, g)
      }
      g.trades.push(e)
      g.dayPnl += e.pnl.dollars
    }
    for (const g of map.values()) {
      g.trades.sort((a, b) => a.fill.time_unix - b.fill.time_unix)
      g.dayPnl = Math.round(g.dayPnl * 100) / 100
    }
    return [...map.values()].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
      if (a.market !== b.market) return a.market.localeCompare(b.market)
      return a.instrument.localeCompare(b.instrument)
    })
  }, [entries])

  const dayHeaders = useMemo(() => [...new Set(groups.map((g) => g.date))], [groups])

  const equityChange = summary?.equity_change ?? summary?.total_pnl ?? 0
  const madeMoney = equityChange > 0
  const lostMoney = equityChange < 0

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-violet-400/90">
              Practice only
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-white">Sim order history</h1>
            <p className="mt-1 text-sm text-gray-500 max-w-xl">
              Paper fills from replay mornings — entry, SL/TP, exit reason, and P&amp;L by day.
              Does not include live trades.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/simulation"
              className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-[#161b22]"
            >
              ← Simulation
            </Link>
            <Link
              href="/dashboard/journal"
              className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-300 hover:bg-[#161b22]"
            >
              Live History
            </Link>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', 'DOW', 'NASDAQ', 'NIKKEI'] as Instrument[]).map((inst) => (
            <button
              key={inst}
              type="button"
              onClick={() => setInstrument(inst)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                instrument === inst
                  ? 'bg-violet-600/30 text-violet-200 border border-violet-700/40'
                  : 'bg-[#161b22] text-gray-500 border border-[#30363d]'
              }`}
            >
              {inst}
            </button>
          ))}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="ml-auto rounded-lg border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-gray-300"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs text-gray-400 hover:text-white"
          >
            Refresh
          </button>
        </div>

        {summary && (
          <div className="space-y-3">
            <div
              className={`rounded-xl border px-4 py-4 ${
                madeMoney
                  ? 'border-emerald-800/50 bg-emerald-950/20'
                  : lostMoney
                    ? 'border-red-800/50 bg-red-950/20'
                    : 'border-[#30363d] bg-[#161b22]'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
                Paper equity (ticket ± realized P&amp;L)
              </div>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase">Starting account</div>
                  <div className="price-mono text-lg text-white">
                    {fmtMoney(summary.starting_account)}
                  </div>
                </div>
                <div className="text-gray-600 text-xl pb-0.5">→</div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase">After closed paper</div>
                  <div className="price-mono text-lg text-white">
                    {fmtMoney(summary.ending_equity)}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[10px] text-gray-500 uppercase">
                    {madeMoney ? 'Paper profit' : lostMoney ? 'Paper loss' : 'Flat'}
                  </div>
                  <div
                    className={`price-mono text-2xl font-bold ${
                      madeMoney ? 'text-emerald-400' : lostMoney ? 'text-red-400' : 'text-gray-300'
                    }`}
                  >
                    {fmtMoney(equityChange, true)}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              {[
                { label: 'Orders', value: summary.trades },
                { label: 'Wins', value: summary.wins },
                { label: 'Losses', value: summary.losses },
                { label: 'Stops', value: summary.stop_outs },
                { label: 'TPs', value: summary.take_profits },
                { label: 'Manual', value: summary.manuals },
                {
                  label: 'Win %',
                  value: summary.win_rate != null ? `${summary.win_rate}%` : '—',
                },
                {
                  label: 'Net P&L',
                  value: fmtMoney(summary.total_pnl, true),
                  hot: summary.total_pnl,
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-[#30363d] bg-[#161b22] px-3 py-2.5"
                >
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">{s.label}</div>
                  <div
                    className={`mt-1 text-sm font-semibold price-mono ${
                      typeof s.hot === 'number'
                        ? s.hot >= 0
                          ? 'text-emerald-400'
                          : 'text-red-400'
                        : 'text-white'
                    }`}
                  >
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading && <p className="text-sm text-gray-500">Loading sim history…</p>}
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#30363d] px-6 py-12 text-center text-sm text-gray-500">
            No paper closes yet. Open{' '}
            <Link href="/dashboard/simulation" className="text-violet-400 hover:underline">
              Simulation
            </Link>
            , replay a morning, fill a level — stops and targets land here.
          </div>
        )}

        <div className="space-y-8">
          {dayHeaders.map((date) => {
            const dayGroups = groups.filter((g) => g.date === date)
            const dayPnl =
              Math.round(dayGroups.reduce((s, g) => s + g.dayPnl, 0) * 100) / 100
            return (
              <section key={date} className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#30363d] pb-2">
                  <h2 className="text-sm font-semibold text-white tracking-tight">
                    Replay day · {formatDayLabel(date)}
                  </h2>
                  <span
                    className={`text-xs font-semibold price-mono ${
                      dayPnl > 0
                        ? 'text-emerald-400'
                        : dayPnl < 0
                          ? 'text-red-400'
                          : 'text-gray-500'
                    }`}
                  >
                    Day P&amp;L {fmtMoney(dayPnl, true)}
                  </span>
                </div>

                {dayGroups.map((g) => (
                  <div key={`${g.date}-${g.market}-${g.instrument}`} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 px-0.5">
                      <span className="rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-300">
                        {g.market}
                      </span>
                      <span className="text-xs font-semibold text-gray-300">{g.instrument}</span>
                      <span className="text-[10px] text-gray-600">
                        {g.trades.length} order{g.trades.length === 1 ? '' : 's'}
                      </span>
                      <span
                        className={`ml-auto text-[11px] price-mono font-semibold ${
                          g.dayPnl > 0
                            ? 'text-emerald-400'
                            : g.dayPnl < 0
                              ? 'text-red-400'
                              : 'text-gray-600'
                        }`}
                      >
                        {fmtMoney(g.dayPnl, true)}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {g.trades.map((e) => {
                        const badge = exitBadge(e.exit.reason_code)
                        const open = expanded === e.id
                        const pnl = e.pnl.dollars
                        return (
                          <article
                            key={e.id}
                            className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden"
                          >
                            <button
                              type="button"
                              onClick={() => setExpanded(open ? null : e.id)}
                              className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 hover:bg-[#1c2128]"
                            >
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded border ${
                                  e.direction === 'LONG'
                                    ? 'text-emerald-400 border-emerald-800 bg-emerald-950/40'
                                    : 'text-red-400 border-red-800 bg-red-950/40'
                                }`}
                              >
                                {e.direction}
                              </span>
                              <span className="price-mono text-sm text-white">
                                {e.fill.price.toLocaleString()}
                              </span>
                              <span className="text-gray-600 text-xs">→</span>
                              <span className="price-mono text-sm text-gray-300">
                                {e.exit.price.toLocaleString()}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                              <span
                                className={`ml-auto price-mono text-sm font-semibold ${
                                  pnl > 0
                                    ? 'text-emerald-400'
                                    : pnl < 0
                                      ? 'text-red-400'
                                      : 'text-gray-400'
                                }`}
                              >
                                {fmtMoney(pnl, true)}
                              </span>
                            </button>

                            {open && (
                              <div className="border-t border-[#30363d] px-4 py-3 grid gap-2 text-xs text-gray-400 sm:grid-cols-2">
                                <div>
                                  <span className="text-gray-600">Fill </span>
                                  {fmtSimClock(e.fill.time_unix, e.market)}
                                </div>
                                <div>
                                  <span className="text-gray-600">Exit </span>
                                  {fmtSimClock(e.exit.time_unix, e.market)}
                                </div>
                                <div>
                                  <span className="text-gray-600">SL </span>
                                  <span className="price-mono text-red-300">
                                    {e.risk.stop_loss.toLocaleString()}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-600">TP </span>
                                  <span className="price-mono text-emerald-300">
                                    {e.risk.take_profit != null
                                      ? e.risk.take_profit.toLocaleString()
                                      : '—'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-600">Size </span>
                                  <span className="price-mono text-gray-300">
                                    {e.risk.position_size}
                                  </span>
                                  <span className="text-gray-600"> · risk </span>
                                  <span className="price-mono text-gray-300">
                                    {fmtMoney(e.risk.risk_amount)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-600">P&amp;L % </span>
                                  <span className="price-mono text-gray-300">
                                    {e.pnl.percent != null ? `${e.pnl.percent}%` : '—'}
                                  </span>
                                  {e.fill.conviction != null && (
                                    <>
                                      <span className="text-gray-600"> · conv </span>
                                      <span className="price-mono text-violet-300">
                                        {e.fill.conviction}
                                      </span>
                                    </>
                                  )}
                                </div>
                                <div className="sm:col-span-2">
                                  <span className="text-gray-600">Level reason </span>
                                  <span className="text-gray-300">{e.fill.reason || '—'}</span>
                                </div>
                              </div>
                            )}
                          </article>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
