'use client'

/**
 * Trade Journal — structured history of fills, exits, stops, and reasons.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI' | 'ALL'

interface JournalEntry {
  id: string
  instrument: string
  trade_date: string
  entry_window: number
  direction: string
  status: 'open' | 'closed'
  fill: { time: string; price: number; level: number | null; reason: string }
  risk: {
    stop_loss: number
    take_profit: number | null
    position_size: number
    risk_amount: number
    account_size: number
  }
  exit: {
    time: string
    price: number | null
    reason_code: string | null
    notes: string
  } | null
  stops: { hit_count: number; hit_at: string | null }
  pnl: { dollars: number | null; percent: number | null }
  regime: { type: string | null; confidence: number | null }
  decisions: Array<{ type: string | null; notes: string | null; time: string | null; price: number | null }>
}

interface Summary {
  trades: number
  open: number
  closed: number
  wins: number
  losses: number
  stop_outs: number
  take_profits: number
  win_rate: number | null
  total_pnl: number
  days: number
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function exitBadge(code: string | null | undefined): { label: string; className: string } {
  switch (code) {
    case 'stop_hit':
      return { label: 'STOP', className: 'bg-red-900/40 text-red-300 border-red-800' }
    case 'take_profit':
      return { label: 'TAKE PROFIT', className: 'bg-emerald-900/40 text-emerald-300 border-emerald-800' }
    case 'ai_signal':
      return { label: 'AI EXIT', className: 'bg-violet-900/40 text-violet-300 border-violet-800' }
    case 'lunch_close':
      return { label: 'LUNCH FLAT', className: 'bg-amber-900/40 text-amber-300 border-amber-800' }
    case 'manual':
      return { label: 'MANUAL', className: 'bg-slate-800 text-slate-300 border-slate-600' }
    default:
      return { label: code?.toUpperCase() || 'OPEN', className: 'bg-sky-900/40 text-sky-300 border-sky-800' }
  }
}

export default function JournalPage() {
  const [instrument, setInstrument] = useState<Instrument>('ALL')
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ days: String(days), limit: '80' })
      if (instrument !== 'ALL') q.set('instrument', instrument)
      const res = await fetch(`/api/trading/journal?${q}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error || json.detail || 'Failed to load journal')
        setEntries([])
        setSummary(null)
        return
      }
      setSummary(json.summary)
      setEntries(json.entries || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load journal')
    } finally {
      setLoading(false)
    }
  }, [days, instrument])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Desk record</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">Trade Journal</h1>
            <p className="mt-1 text-sm text-gray-500">
              Fills, stops, take-profits, and the reasons behind every morning decision.
            </p>
          </div>
          <Link
            href="/dashboard/chart"
            className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-[#161b22]"
          >
            ← Live Trading
          </Link>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', 'DOW', 'NASDAQ', 'NIKKEI'] as Instrument[]).map((inst) => (
            <button
              key={inst}
              type="button"
              onClick={() => setInstrument(inst)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                instrument === inst
                  ? 'bg-brand-600/30 text-brand-200 border border-brand-700/40'
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
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {[
              { label: 'Trades', value: summary.trades },
              { label: 'Open', value: summary.open },
              { label: 'Wins', value: summary.wins },
              { label: 'Losses', value: summary.losses },
              { label: 'Stops', value: summary.stop_outs },
              { label: 'TPs', value: summary.take_profits },
              { label: 'Win %', value: summary.win_rate != null ? `${summary.win_rate}%` : '—' },
              {
                label: 'Net P&L',
                value: `${summary.total_pnl >= 0 ? '+' : ''}$${summary.total_pnl.toLocaleString()}`,
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
        )}

        {loading && <p className="text-sm text-gray-500">Loading journal…</p>}
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#30363d] px-6 py-12 text-center text-sm text-gray-500">
            No trades yet. Fills from Live Trading appear here with entry and exit reasons.
          </div>
        )}

        <div className="space-y-3">
          {entries.map((e) => {
            const badge = exitBadge(e.status === 'open' ? null : e.exit?.reason_code)
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
                  className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 hover:bg-[#1c2128]"
                >
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded border ${
                      e.direction === 'LONG'
                        ? 'text-emerald-400 border-emerald-800 bg-emerald-950/40'
                        : 'text-red-400 border-red-800 bg-red-950/40'
                    }`}
                  >
                    {e.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'} {e.instrument}
                  </span>
                  <span className="text-xs text-gray-500">{e.trade_date}</span>
                  <span className="text-xs text-gray-400">
                    Fill{' '}
                    <span className="price-mono text-sky-300">{e.fill.price.toLocaleString()}</span>
                    <span className="text-gray-600 ml-1">{fmtTime(e.fill.time)}</span>
                  </span>
                  {e.exit && (
                    <span className="text-xs text-gray-400">
                      Exit{' '}
                      <span className="price-mono text-white">
                        {e.exit.price?.toLocaleString() ?? '—'}
                      </span>
                      <span className="text-gray-600 ml-1">{fmtTime(e.exit.time)}</span>
                    </span>
                  )}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${badge.className}`}>
                    {e.status === 'open' ? 'OPEN' : badge.label}
                  </span>
                  {pnl != null && (
                    <span
                      className={`ml-auto text-sm font-bold price-mono ${
                        pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}
                    </span>
                  )}
                </button>

                {open && (
                  <div className="border-t border-[#30363d] px-4 py-4 space-y-4 text-sm">
                    <section>
                      <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                        Why we entered
                      </h3>
                      <p className="text-gray-300 leading-relaxed">{e.fill.reason}</p>
                      {e.fill.level != null && (
                        <p className="mt-1 text-xs text-gray-500">
                          Level {e.fill.level.toLocaleString()} · window {e.entry_window} · regime{' '}
                          {e.regime.type || '—'}
                          {e.regime.confidence != null ? ` (${e.regime.confidence}%)` : ''}
                        </p>
                      )}
                    </section>

                    <div className="grid sm:grid-cols-3 gap-3 text-xs">
                      <div className="rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2">
                        <div className="text-gray-500">Stop loss</div>
                        <div className="price-mono text-red-400 mt-0.5">
                          {e.risk.stop_loss.toLocaleString()}
                        </div>
                        {e.stops.hit_count > 0 && (
                          <div className="mt-1 text-red-300/80">
                            Hit ×{e.stops.hit_count}
                            {e.stops.hit_at ? ` · ${fmtTime(e.stops.hit_at)}` : ''}
                          </div>
                        )}
                      </div>
                      <div className="rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2">
                        <div className="text-gray-500">Take profit</div>
                        <div className="price-mono text-emerald-400 mt-0.5">
                          {e.risk.take_profit?.toLocaleString() ?? '—'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2">
                        <div className="text-gray-500">Size / risk</div>
                        <div className="price-mono text-white mt-0.5">
                          {e.risk.position_size.toFixed(2)} u · ${e.risk.risk_amount.toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {e.exit && (
                      <section>
                        <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                          Why we exited
                        </h3>
                        <p className="text-gray-300 leading-relaxed">{e.exit.notes}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Code: {e.exit.reason_code || '—'} · {fmtTime(e.exit.time)}
                          {e.pnl.percent != null && (
                            <span className="ml-2">
                              P&L {e.pnl.percent >= 0 ? '+' : ''}
                              {e.pnl.percent.toFixed(2)}%
                            </span>
                          )}
                        </p>
                      </section>
                    )}

                    {e.decisions.length > 0 && (
                      <section>
                        <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
                          Management decisions
                        </h3>
                        <ul className="space-y-1.5">
                          {e.decisions.map((d, i) => (
                            <li
                              key={i}
                              className="text-xs rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 flex flex-wrap gap-2"
                            >
                              <span className="font-semibold text-amber-300">{String(d.type || 'NOTE')}</span>
                              <span className="text-gray-500">{fmtTime(d.time)}</span>
                              {d.notes && <span className="text-gray-400 w-full">{String(d.notes)}</span>}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>

        <p className="text-[11px] text-gray-600 leading-relaxed">
          After the entry window (10:15 ET / 09:45 JST), trade levels leave the live chart. Open
          positions stay in MANAGE. Flat books wait for lunch. Afternoon trading stays off — AI still
          grades morning levels into memory for a future afternoon session.
        </p>
      </div>
    </div>
  )
}
