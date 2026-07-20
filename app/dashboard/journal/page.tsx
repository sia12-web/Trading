'use client'

/**
 * Order history — Live (`trades_journal`) and Simulation (`simulation_trades`).
 * Prefer ?tab=live (default) or ?tab=sim.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { entrySourceLabel, entrySourceTone } from '@/lib/trading/entrySourceBadge'
import { formatDeskMoney, deskCurrencyLabel } from '@/lib/trading/currency'

type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI' | 'ALL'
type HistoryTab = 'live' | 'sim'

interface JournalEntry {
  id: string
  instrument: string
  market?: 'NY' | 'TOKYO'
  trade_date: string
  entry_window: number
  direction: string
  status: 'open' | 'closed'
  fill: {
    time: string
    price: number
    level: number | null
    reason: string
    source?: string | null
  }
  risk: {
    stop_loss: number
    take_profit: number | null
    position_size: number
    risk_amount: number
    account_size: number
  }
  equity?: { before: number; after: number }
  exit: {
    time: string
    price: number | null
    reason_code: string | null
    notes: string
    early_exit?: boolean
    tp_hit?: boolean
  } | null
  stops: { hit_count: number; hit_at: string | null }
  pnl: { dollars: number | null; percent: number | null }
  regime: { type: string | null; confidence: number | null }
  decisions: Array<{
    type: string | null
    notes: string | null
    time: string | null
    price: number | null
  }>
}

interface Summary {
  trades: number
  open: number
  closed: number
  wins: number
  losses: number
  stop_outs: number
  take_profits: number
  ai_exits?: number
  manuals?: number
  win_rate: number | null
  total_pnl: number
  starting_account?: number
  ending_equity?: number
  equity_change?: number
  days: number
}

interface DayMarketGroup {
  date: string
  market: string
  instrument: string
  trades: JournalEntry[]
  dayPnl: number
}

function marketFor(e: JournalEntry): string {
  return e.market || (e.instrument === 'NIKKEI' ? 'TOKYO' : 'NY')
}

function fmtTime(iso: string | null | undefined, market?: string): string {
  if (!iso) return '—'
  const tz = market === 'TOKYO' ? 'Asia/Tokyo' : 'America/New_York'
  const label = market === 'TOKYO' ? 'JST' : 'ET'
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(iso))
    return `${s} ${label}`
  } catch {
    return iso
  }
}

function fmtMoney(n: number | null | undefined, signed = false): string {
  return formatDeskMoney(n, { signed })
}

function exitBadge(code: string | null | undefined): { label: string; className: string } {
  switch (code) {
    case 'stop_hit':
      return { label: 'STOP LOSS', className: 'bg-red-900/40 text-red-300 border-red-800' }
    case 'take_profit':
      return { label: 'TAKE PROFIT', className: 'bg-emerald-900/40 text-emerald-300 border-emerald-800' }
    case 'ai_signal':
      return {
        label: 'AI EXIT (TP NOT HIT)',
        className: 'bg-violet-900/40 text-violet-300 border-violet-800',
      }
    case 'lunch_close':
      return { label: 'LUNCH FLAT', className: 'bg-amber-900/40 text-amber-300 border-amber-800' }
    case 'manual':
      return { label: 'MANUAL', className: 'bg-slate-800 text-slate-300 border-slate-600' }
    default:
      return {
        label: code?.toUpperCase() || 'OPEN',
        className: 'bg-sky-900/40 text-sky-300 border-sky-800',
      }
  }
}

function formatDayLabel(date: string): string {
  try {
    const d = new Date(`${date}T12:00:00Z`)
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d)
  } catch {
    return date
  }
}

function mapSimEntry(raw: Record<string, unknown>): JournalEntry {
  const fill = (raw.fill || {}) as Record<string, unknown>
  const risk = (raw.risk || {}) as Record<string, unknown>
  const exit = (raw.exit || {}) as Record<string, unknown>
  const pnl = (raw.pnl || {}) as Record<string, unknown>
  const fillUnix = Number(fill.time_unix) || 0
  const exitUnix = Number(exit.time_unix) || 0
  const reason = String(exit.reason_code || 'manual')
  return {
    id: String(raw.id),
    instrument: String(raw.instrument),
    market: raw.market === 'TOKYO' ? 'TOKYO' : 'NY',
    trade_date: String(raw.replay_date),
    entry_window: 1,
    direction: String(raw.direction),
    status: 'closed',
    fill: {
      time: fillUnix > 0 ? new Date(fillUnix * 1000).toISOString() : String(raw.created_at || ''),
      price: Number(fill.price) || 0,
      level: fill.level != null ? Number(fill.level) : null,
      reason: String(fill.reason || 'Sim level limit fill'),
      source: fill.source != null ? String(fill.source) : null,
    },
    risk: {
      stop_loss: Number(risk.stop_loss) || 0,
      take_profit: risk.take_profit != null ? Number(risk.take_profit) : null,
      position_size: Number(risk.position_size) || 0,
      risk_amount: Number(risk.risk_amount) || 0,
      account_size: Number(risk.account_size) || 100000,
    },
    exit: {
      time: exitUnix > 0 ? new Date(exitUnix * 1000).toISOString() : '',
      price: exit.price != null ? Number(exit.price) : null,
      reason_code: reason,
      notes: '',
      tp_hit: reason === 'take_profit',
    },
    stops: {
      hit_count: reason === 'stop_hit' ? 1 : 0,
      hit_at:
        reason === 'stop_hit' && exitUnix > 0
          ? new Date(exitUnix * 1000).toISOString()
          : null,
    },
    pnl: {
      dollars: pnl.dollars != null ? Number(pnl.dollars) : null,
      percent: pnl.percent != null ? Number(pnl.percent) : null,
    },
    regime: { type: 'sim', confidence: null },
    decisions: [],
  }
}

function JournalPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab: HistoryTab = searchParams.get('tab') === 'sim' ? 'sim' : 'live'

  const [instrument, setInstrument] = useState<Instrument>('ALL')
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  const setTab = useCallback(
    (next: HistoryTab) => {
      const q = new URLSearchParams(searchParams.toString())
      if (next === 'live') q.delete('tab')
      else q.set('tab', 'sim')
      const qs = q.toString()
      router.replace(qs ? `/dashboard/journal?${qs}` : '/dashboard/journal')
    },
    [router, searchParams]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setExpanded(null)
    try {
      const q = new URLSearchParams({
        days: String(days),
        limit: tab === 'sim' ? '80' : '120',
      })
      if (instrument !== 'ALL') q.set('instrument', instrument)
      const url =
        tab === 'sim' ? `/api/trading/sim-journal?${q}` : `/api/trading/journal?${q}`
      const res = await fetch(url)
      const json = await res.json()
      if (!res.ok || (tab === 'live' && !json.success)) {
        setError(json.error || json.detail || 'Failed to load order history')
        setEntries([])
        setSummary(null)
        return
      }
      if (tab === 'sim') {
        setEntries((json.entries || []).map((e: Record<string, unknown>) => mapSimEntry(e)))
        setSummary(json.summary || null)
      } else {
        setSummary(json.summary)
        setEntries(json.entries || [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load order history')
      setEntries([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [days, instrument, tab])

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => {
    const map = new Map<string, DayMarketGroup>()
    for (const e of entries) {
      const market = marketFor(e)
      const key = `${e.trade_date}|${market}|${e.instrument}`
      let g = map.get(key)
      if (!g) {
        g = {
          date: e.trade_date,
          market,
          instrument: e.instrument,
          trades: [],
          dayPnl: 0,
        }
        map.set(key, g)
      }
      g.trades.push(e)
      if (e.pnl.dollars != null) g.dayPnl += e.pnl.dollars
    }
    for (const g of map.values()) {
      g.trades.sort(
        (a, b) => new Date(a.fill.time).getTime() - new Date(b.fill.time).getTime()
      )
      g.dayPnl = Math.round(g.dayPnl * 100) / 100
    }
    return [...map.values()].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
      if (a.market !== b.market) return a.market.localeCompare(b.market)
      return a.instrument.localeCompare(b.instrument)
    })
  }, [entries])

  const dayHeaders = useMemo(() => {
    const dates = [...new Set(groups.map((g) => g.date))]
    return dates
  }, [groups])

  const equityChange = summary?.equity_change ?? summary?.total_pnl ?? 0
  const madeMoney = equityChange > 0
  const lostMoney = equityChange < 0
  const isSim = tab === 'sim'

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p
              className={`text-[10px] uppercase tracking-[0.2em] ${
                isSim ? 'text-violet-400/90' : 'text-amber-500/90'
              }`}
            >
              {isSim ? 'Practice paper' : 'Live trading'}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-white">Order history</h1>
            <p className="mt-1 text-sm text-gray-500 max-w-xl">
              {isSim
                ? 'Paper fills from simulation mornings — entry, SL/TP, exit reason, and P&L by replay day.'
                : 'Closed and open live fills by day and market — entries, SL/TP, level reasons, AI exits, and equity.'}
            </p>
          </div>
          <Link
            href={isSim ? '/dashboard/simulation' : '/dashboard/chart'}
            className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-[#161b22]"
          >
            {isSim ? '← Simulation' : '← Live Trading'}
          </Link>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[#30363d] bg-[#161b22] p-0.5">
            <button
              type="button"
              onClick={() => setTab('live')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                !isSim ? 'bg-brand-600/30 text-brand-200' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Live
            </button>
            <button
              type="button"
              onClick={() => setTab('sim')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                isSim ? 'bg-violet-600/30 text-violet-200' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Simulation
            </button>
          </div>
          {(['ALL', 'DOW', 'NASDAQ', 'NIKKEI'] as Instrument[]).map((inst) => (
            <button
              key={inst}
              type="button"
              onClick={() => setInstrument(inst)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                instrument === inst
                  ? isSim
                    ? 'bg-violet-600/30 text-violet-200 border border-violet-700/40'
                    : 'bg-brand-600/30 text-brand-200 border border-brand-700/40'
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
            {/* Equity / margin tracker */}
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
                Desk equity (ticket account ± realized P&amp;L)
              </div>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase">Starting account</div>
                  <div className="price-mono text-lg text-white">
                    {fmtMoney(summary.starting_account ?? 100000)}
                  </div>
                </div>
                <div className="text-gray-600 text-xl pb-0.5">→</div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase">After closed trades</div>
                  <div className="price-mono text-lg text-white">
                    {fmtMoney(summary.ending_equity ?? summary.starting_account)}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[10px] text-gray-500 uppercase">
                    {madeMoney ? 'You made money' : lostMoney ? 'You lost money' : 'Flat'}
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
              <p className="mt-2 text-[11px] text-gray-600">
                Risk per trade is ~5% of ticket account size (shown as risk {deskCurrencyLabel()} on each order). Broker
                fills and journal P&L are in {deskCurrencyLabel()} (OANDA account currency).
                margin lives on OANDA; this trail is your desk bookkeeping from live fills.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-2">
              {[
                { label: 'Orders', value: summary.trades },
                { label: 'Open', value: summary.open },
                { label: 'Wins', value: summary.wins },
                { label: 'Losses', value: summary.losses },
                { label: 'Stops', value: summary.stop_outs },
                { label: 'TPs', value: summary.take_profits },
                { label: 'AI exits', value: summary.ai_exits ?? 0 },
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

        {loading && <p className="text-sm text-gray-500">Loading order history…</p>}
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#30363d] px-6 py-12 text-center text-sm text-gray-500">
            {isSim ? (
              <>
                No paper closes yet. Open{' '}
                <Link href="/dashboard/simulation" className="text-violet-400 hover:underline">
                  Simulation
                </Link>
                , fill a level, then hit SL/TP or CLOSE — orders land under the Simulation tab.
              </>
            ) : (
              <>
                No live orders yet. Clock in, place a limit on Live Trading — fills land here with
                entry and exit reasons.
              </>
            )}
          </div>
        )}

        <div className="space-y-8">
          {dayHeaders.map((date) => {
            const dayGroups = groups.filter((g) => g.date === date)
            const dayPnl = Math.round(
              dayGroups.reduce((s, g) => s + g.dayPnl, 0) * 100
            ) / 100
            return (
              <section key={date} className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#30363d] pb-2">
                  <h2 className="text-sm font-semibold text-white tracking-tight">
                    {isSim ? `Replay day · ${formatDayLabel(date)}` : formatDayLabel(date)}
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
                      <span className="rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-300">
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
                        const badge = exitBadge(
                          e.status === 'open' ? null : e.exit?.reason_code
                        )
                        const open = expanded === e.id
                        const pnl = e.pnl.dollars
                        const early =
                          e.exit?.early_exit || e.exit?.reason_code === 'ai_signal'
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
                                {e.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'}
                              </span>
                              {e.fill.source && (
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${entrySourceTone(e.fill.source)}`}
                                  title="How this limit was chosen"
                                >
                                  {entrySourceLabel(e.fill.source)}
                                </span>
                              )}
                              <span className="text-xs text-gray-400">
                                Entry{' '}
                                <span className="price-mono text-sky-300">
                                  {e.fill.price.toLocaleString()}
                                </span>
                              </span>
                              <span className="text-[10px] text-gray-600">
                                {fmtTime(e.fill.time, marketFor(e))}
                              </span>
                              <span className="text-xs text-gray-500">
                                SL{' '}
                                <span className="price-mono text-red-400/90">
                                  {e.risk.stop_loss.toLocaleString()}
                                </span>
                                {' · '}TP{' '}
                                <span className="price-mono text-emerald-400/90">
                                  {e.risk.take_profit?.toLocaleString() ?? '—'}
                                </span>
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${badge.className}`}
                              >
                                {e.status === 'open' ? 'OPEN' : badge.label}
                              </span>
                              {pnl != null && (
                                <span
                                  className={`ml-auto text-sm font-bold price-mono ${
                                    pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                                  }`}
                                >
                                  {fmtMoney(pnl, true)}
                                </span>
                              )}
                              {pnl == null && e.status === 'open' && (
                                <span className="ml-auto text-xs text-amber-300/80">In trade</span>
                              )}
                            </button>

                            {open && (
                              <div className="border-t border-[#30363d] px-4 py-4 space-y-4 text-sm">
                                {/* Equity delta for this order */}
                                {e.equity && (
                                  <div className="flex flex-wrap gap-4 text-xs rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2">
                                    <span className="text-gray-500">
                                      Account before{' '}
                                      <span className="price-mono text-gray-300">
                                        {fmtMoney(e.equity.before)}
                                      </span>
                                    </span>
                                    <span className="text-gray-500">
                                      After{' '}
                                      <span className="price-mono text-white">
                                        {fmtMoney(e.equity.after)}
                                      </span>
                                    </span>
                                    <span className="text-gray-500">
                                      Risk margin{' '}
                                      <span className="price-mono text-amber-300">
                                        {fmtMoney(e.risk.risk_amount)}
                                      </span>
                                      <span className="text-gray-600">
                                        {' '}
                                        ({e.risk.position_size.toFixed(2)} u)
                                      </span>
                                    </span>
                                  </div>
                                )}

                                <section>
                                  <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                                    Why this level / entry
                                  </h3>
                                  {e.fill.source && (
                                    <p className="mb-1.5">
                                      <span
                                        className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${entrySourceTone(e.fill.source)}`}
                                      >
                                        {entrySourceLabel(e.fill.source)}
                                        {e.fill.source === 'manual'
                                          ? ' · 1% risk'
                                          : ' · desk risk'}
                                      </span>
                                    </p>
                                  )}
                                  <p className="text-gray-300 leading-relaxed">{e.fill.reason}</p>
                                  <p className="mt-1 text-xs text-gray-500">
                                    {e.fill.level != null && (
                                      <>
                                        Level {e.fill.level.toLocaleString()} ·{' '}
                                      </>
                                    )}
                                    Window {e.entry_window} · Regime {e.regime.type || '—'}
                                    {e.regime.confidence != null
                                      ? ` (${e.regime.confidence}%)`
                                      : ''}
                                  </p>
                                </section>

                                <div className="grid sm:grid-cols-3 gap-3 text-xs">
                                  <div className="rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2">
                                    <div className="text-gray-500">Entry</div>
                                    <div className="price-mono text-sky-300 mt-0.5">
                                      {e.fill.price.toLocaleString()}
                                    </div>
                                  </div>
                                  <div className="rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2">
                                    <div className="text-gray-500">Stop loss</div>
                                    <div className="price-mono text-red-400 mt-0.5">
                                      {e.risk.stop_loss.toLocaleString()}
                                    </div>
                                    {e.stops.hit_count > 0 && (
                                      <div className="mt-1 text-red-300/80">
                                        Hit ×{e.stops.hit_count}
                                        {e.stops.hit_at ? ` · ${fmtTime(e.stops.hit_at, marketFor(e))}` : ''}
                                      </div>
                                    )}
                                  </div>
                                  <div className="rounded-lg bg-[#0d1117] border border-[#30363d] px-3 py-2">
                                    <div className="text-gray-500">Take profit</div>
                                    <div className="price-mono text-emerald-400 mt-0.5">
                                      {e.risk.take_profit?.toLocaleString() ?? '—'}
                                    </div>
                                    {e.exit?.tp_hit && (
                                      <div className="mt-1 text-emerald-300/80">Target hit</div>
                                    )}
                                    {early && e.exit && !e.exit.tp_hit && (
                                      <div className="mt-1 text-violet-300/80">
                                        Closed before TP
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {e.exit && (
                                  <section
                                    className={
                                      early
                                        ? 'rounded-lg border border-violet-800/40 bg-violet-950/20 px-3 py-3'
                                        : ''
                                    }
                                  >
                                    <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                                      {early
                                        ? 'Why system exited before take-profit'
                                        : 'Why we exited'}
                                    </h3>
                                    <p className="text-gray-200 leading-relaxed">
                                      {e.exit.notes}
                                    </p>
                                    <p className="mt-1 text-xs text-gray-500">
                                      Exit{' '}
                                      <span className="price-mono text-gray-300">
                                        {e.exit.price?.toLocaleString() ?? '—'}
                                      </span>
                                      {' · '}
                                      {fmtTime(e.exit.time, marketFor(e))}
                                      {e.pnl.percent != null && (
                                        <span className="ml-2">
                                          vs risk{' '}
                                          {e.pnl.percent >= 0 ? '+' : ''}
                                          {e.pnl.percent.toFixed(2)}%
                                        </span>
                                      )}
                                    </p>
                                  </section>
                                )}

                                {e.decisions.length > 0 && (
                                  <section>
                                    <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
                                      Manage trail
                                    </h3>
                                    <ul className="space-y-1.5">
                                      {e.decisions.map((d, i) => (
                                        <li
                                          key={i}
                                          className="text-xs rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 flex flex-wrap gap-2"
                                        >
                                          <span className="font-semibold text-amber-300">
                                            {String(d.type || 'NOTE')}
                                          </span>
                                          <span className="text-gray-500">
                                            {fmtTime(d.time, marketFor(e))}
                                          </span>
                                          {d.notes && (
                                            <span className="text-gray-400 w-full">
                                              {String(d.notes)}
                                            </span>
                                          )}
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
                  </div>
                ))}
              </section>
            )
          })}
        </div>

        <p className="text-[11px] text-gray-600 leading-relaxed">
          {isSim
            ? 'Simulation tab reads paper closes from simulation_trades only — never mixes with live fills. Resetting a replay day clears that day’s paper history.'
            : 'Live desk only. After the entry window, levels leave the chart; open books stay in MANAGE until stop, target, AI exit, or lunch flatten. Equity above is reconstructed from your ticket account size and closed-trade P&L in CAD (OANDA account currency) — not a live OANDA margin feed.'}
        </p>
      </div>
    </div>
  )
}

export default function JournalPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0d1117] px-4 py-8 text-sm text-gray-500">
          Loading order history…
        </div>
      }
    >
      <JournalPageInner />
    </Suspense>
  )
}
