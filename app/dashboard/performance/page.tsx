'use client'

/**
 * Performance Analytics Dashboard
 * Dual view for (1) My CMC Markets CFD ($2,000 Capital) and (2) NYC Team Tape Desk.
 * Features full live analytics: KPI cards, Trade Duration & Win Rate analysis,
 * Daily P&L visualizers, Monthly P&L calendar, executed trades ledger, and CME exchange pricing tags.
 */

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import {
  calculatePerformanceMetrics,
  DEFAULT_CMC_TRADES,
  DURATION_BUCKETS,
  formatCmeExchangePrice,
  getExchangeTag,
  getSymbolMultiplier,
  getTradeDurationSec,
  type TradeRecord,
} from '@/lib/trading/performanceMetrics'

type AccountMode = 'cmc' | 'team'
type DateFilter = 'all' | 'today' | 'last_week' | 'last_month'

function formatSec(sec: number | null): string {
  if (sec == null || sec <= 0) return '—'
  if (sec < 60) return `${sec} sec`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h < 48) return rem > 0 ? `${h}h ${rem}m` : `${h}h`
  const days = Math.floor(h / 24)
  const remH = h % 24
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`
}

function etStartOfToday(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const y = Number(parts.find((p) => p.type === 'year')?.value)
  const m = Number(parts.find((p) => p.type === 'month')?.value)
  const d = Number(parts.find((p) => p.type === 'day')?.value)
  // 04:00 UTC is midnight EDT; EST is 05:00 UTC. Probe both via the formatter.
  const guess = Date.UTC(y, m - 1, d, 4, 0, 0)
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(guess))
  )
  return guess - hour * 60 * 60 * 1000
}

function tradeInFilter(t: TradeRecord, filter: DateFilter, now = new Date()): boolean {
  if (filter === 'all') return true
  const iso = t.status === 'closed' ? t.exitTime || t.entryTime : t.entryTime
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return false
  if (filter === 'today') return ms >= etStartOfToday(now)
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - (filter === 'last_week' ? 7 : 30))
  return ms >= start.getTime()
}

function pnlClass(val: number): string {
  if (val > 0) return 'text-emerald-400 font-bold'
  if (val < 0) return 'text-red-400 font-bold'
  return 'text-gray-300 font-bold'
}

export default function PerformancePage() {
  const [accountMode, setAccountMode] = useState<AccountMode>('team')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [copiedLink, setCopiedLink] = useState(false)

  const [cmcTrades, setCmcTrades] = useState<TradeRecord[]>(DEFAULT_CMC_TRADES)
  const [teamTrades, setTeamTrades] = useState<TradeRecord[]>([])
  const [teamEquity, setTeamEquity] = useState<{ equity: number; currency: string } | null>(null)
  const [teamNote, setTeamNote] = useState<string | null>(null)

  const isCmc = accountMode === 'cmc'
  const accountId = isCmc ? 'CMC-CFD-LIVE-2000' : '1.5KCHCR-LABS004-V2-675081-67067724'
  const accountTitle = isCmc ? 'My CMC Markets CFD Account' : 'NYC Team Tape Desk'
  const capitalLabel = isCmc ? 'Starting Capital: $2,000.00 · Live CFD Desk' : 'NYC Stocks & Options Team Book'

  // Fetch live trades from API on mount
  useEffect(() => {
    let cancelled = false

    async function loadTrades() {
      try {
        // Fetch CMC CFD trades from journal
        const jRes = await fetch('/api/trading/journal?limit=100', { cache: 'no-store' })
        if (jRes.ok) {
          const jData = await jRes.json()
          if (Array.isArray(jData.trades) && jData.trades.length > 0) {
            const mapped: TradeRecord[] = jData.trades.map((t: any) => ({
              id: String(t.id),
              symbol: String(t.instrument || 'MNQ'),
              direction: t.entry_direction === 'SELL' || t.entry_direction === 'SHORT' ? 'SELL' : 'BUY',
              entry: Number(t.entry_price || 0),
              exit: t.exit_price ? Number(t.exit_price) : null,
              stop: t.stop_loss_price ? Number(t.stop_loss_price) : null,
              target: t.profit_target_price ? Number(t.profit_target_price) : null,
              pnl: t.profit_loss != null ? Number(t.profit_loss) : null,
              quantity: Number(t.position_size || 1),
              status: t.exit_timestamp ? 'closed' : 'open',
              entryTime: t.entry_timestamp || t.created_at || new Date().toISOString(),
              exitTime: t.exit_timestamp || null,
              exchange: 'CME Globex',
            }))
            if (!cancelled) setCmcTrades(mapped)
          }
        }

        // Team Tape: closed round-trips with realized P&L + open positions with live mark P&L.
        // Never invent closed-trade P&L from take-profit targets.
        const tRes = await fetch('/api/trading/team-tape', { cache: 'no-store' })
        if (tRes.ok) {
          const tData = await tRes.json()
          const openPositions = Array.isArray(tData.open)
            ? tData.open.filter((s: any) => s.status === 'filled')
            : []
          const historyTrades = Array.isArray(tData.history)
            ? tData.history.filter(
                (s: any) =>
                  s.status !== 'cancelled' &&
                  (s.status === 'closed' || (typeof s.pnl === 'number' && s.exit != null))
              )
            : []

          const mappedTeam: TradeRecord[] = []

          for (const s of openPositions) {
            const sym = String(s.symbol || '')
            const mult =
              typeof s.multiplier === 'number' && s.multiplier > 0
                ? s.multiplier
                : getSymbolMultiplier(sym)
            const qty = Number(s.quantity || 1)
            const isBuy = s.side === 'BUY' || s.side === 'LONG'
            let calcPnl: number | null = null
            if (typeof s.livePnl === 'number' && Number.isFinite(s.livePnl)) {
              calcPnl = s.livePnl
            } else if (s.mark != null && s.entry != null) {
              calcPnl = (isBuy ? s.mark - s.entry : s.entry - s.mark) * qty * mult
            }
            const readable = typeof s.realName === 'string' && /\$/.test(s.realName) ? s.realName : sym
            mappedTeam.push({
              id: String(s.sourceId || s.id || Math.random()),
              symbol: readable,
              direction: (s.side === 'SELL' || s.side === 'SHORT' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
              entry: Number(s.entry || 0),
              exit: null,
              stop: s.stop || null,
              target: s.target || null,
              pnl: calcPnl != null ? Math.round(calcPnl * 100) / 100 : null,
              quantity: qty,
              multiplier: mult,
              status: 'open',
              entryTime: s.filledAt || new Date().toISOString(),
              exitTime: null,
              exchange: getExchangeTag(sym),
            })
          }

          for (const s of historyTrades) {
            const sym = String(s.symbol || '')
            const mult =
              typeof s.multiplier === 'number' && s.multiplier > 0
                ? s.multiplier
                : getSymbolMultiplier(sym)
            const qty = Number(s.quantity || 1)
            const isBuy = s.side === 'BUY' || s.side === 'LONG'
            let calcPnl: number | null = null
            if (typeof s.pnl === 'number' && Number.isFinite(s.pnl)) {
              calcPnl = s.pnl
            } else if (s.exit != null && s.entry != null) {
              calcPnl = (isBuy ? s.exit - s.entry : s.entry - s.exit) * qty * mult
            }
            if (calcPnl == null) continue
            const readable = typeof s.realName === 'string' && /\$/.test(s.realName) ? s.realName : sym
            mappedTeam.push({
              id: String(s.sourceId || s.id || Math.random()),
              symbol: readable,
              direction: (s.side === 'SELL' || s.side === 'SHORT' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
              entry: Number(s.entry || 0),
              exit: s.exit ?? null,
              stop: s.stop || null,
              target: s.target || null,
              pnl: Math.round(calcPnl * 100) / 100,
              quantity: qty,
              multiplier: mult,
              status: 'closed',
              entryTime: s.filledAt || new Date().toISOString(),
              exitTime: s.exitAt || s.filledAt || null,
              exchange: getExchangeTag(sym),
            })
          }

          if (!cancelled && (mappedTeam.length > 0 || tData.questrade?.ok)) {
            setTeamTrades(mappedTeam)
            if (tData.questrade?.ok) {
              setTeamEquity({
                equity: Number(tData.questrade.equity) || 0,
                currency: String(tData.questrade.currency || 'CAD'),
              })
              setTeamNote(null)
            }
          } else if (!cancelled && tData.questrade && tData.questrade.ok === false) {
            setTeamNote(String(tData.questrade.error || 'Questrade book unavailable'))
          }
        }
      } catch (err) {
        console.error('Failed to load live performance trades:', err)
      }
    }

    void loadTrades()
    return () => {
      cancelled = true
    }
  }, [])

  const activeTrades = isCmc ? cmcTrades : teamTrades
  const filteredTrades = useMemo(
    () => activeTrades.filter((t) => tradeInFilter(t, dateFilter)),
    [activeTrades, dateFilter]
  )
  // KPIs from closed / realized outcomes only — open mark-to-market stays in the ledger
  const metrics = useMemo(
    () =>
      calculatePerformanceMetrics(
        filteredTrades.filter((t) => t.status === 'closed' && typeof t.pnl === 'number')
      ),
    [filteredTrades]
  )
  const openPnl = useMemo(
    () =>
      filteredTrades
        .filter((t) => t.status === 'open' && typeof t.pnl === 'number')
        .reduce((sum, t) => sum + (t.pnl || 0), 0),
    [filteredTrades]
  )

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
            Comprehensive account metrics, trade duration analysis, P&amp;L calendar, and trade ledger with CME exchange pricing.
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
                  { id: 'all', label: 'ALL' },
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
            <div className="text-[10px] uppercase font-semibold text-gray-400">
              {isCmc ? 'Total P&L' : 'Realized P&L (USD)'}
            </div>
            <div className={`mt-1 text-xl font-bold price-mono ${pnlClass(metrics.totalPnl)}`}>
              {metrics.totalPnl >= 0 ? '+' : '-'}${Math.abs(metrics.totalPnl).toFixed(2)}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">{metrics.totalTrades} closed trades</div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Trade Win %</div>
            <div className="mt-1 text-xl font-bold price-mono text-emerald-400">
              {metrics.winRatePct.toFixed(1)}%
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              {metrics.winningTrades}W · {metrics.losingTrades}L
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Avg Win / Avg Loss</div>
            <div className="mt-1 text-base font-bold price-mono text-gray-200">
              Ratio: {metrics.winLossRatio.toFixed(2)}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              ${metrics.avgWin.toFixed(2)} / -${metrics.avgLoss.toFixed(2)}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Gross Profit / Loss</div>
            <div className="mt-1 text-sm font-bold text-emerald-400">
              +${metrics.grossProfit.toFixed(2)}
            </div>
            <div className="text-[10px] text-red-400 mt-0.5 font-semibold">
              -${metrics.grossLoss.toFixed(2)}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Profit Factor</div>
            <div className="mt-1 text-xl font-bold price-mono text-sky-300">
              {metrics.profitFactor > 0 ? metrics.profitFactor.toFixed(2) : 'N/A'}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">Gross / Loss Ratio</div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3">
            <div className="text-[10px] uppercase font-semibold text-gray-400">Total Lots Traded</div>
            <div className="mt-1 text-xl font-bold price-mono text-white">
              {metrics.totalLots}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">Active contracts</div>
          </div>
        </div>

        {/* Daily Account Balance Visualizer */}
        <div className="rounded-lg border border-white/10 bg-[#0d1117] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span className="font-semibold text-gray-300">Daily Account Performance &amp; Equity Track</span>
            <span className="font-mono text-[11px] text-sky-300">
              {metrics.totalTrades} total trades · Net P&amp;L {metrics.totalPnl >= 0 ? '+' : '-'}${Math.abs(metrics.totalPnl).toFixed(2)}
            </span>
          </div>
          <div className="h-28 w-full rounded border border-white/5 bg-black/40 flex items-center justify-between px-6 text-xs text-gray-300 font-mono">
            <div className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase block">
                {isCmc ? 'Starting Capital' : 'Account Equity'}
              </span>
              <span className="text-sm font-bold text-white">
                {isCmc
                  ? '$2,000.00'
                  : teamEquity
                    ? `${teamEquity.currency} ${teamEquity.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : '—'}
              </span>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase block">
                {isCmc ? 'Gross Profit' : 'Open P&L (USD)'}
              </span>
              <span className={`text-sm font-bold ${isCmc || openPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {isCmc
                  ? `+$${metrics.grossProfit.toFixed(2)}`
                  : `${openPnl >= 0 ? '+' : '-'}$${Math.abs(openPnl).toFixed(2)}`}
              </span>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase block">
                {isCmc ? 'Current Ending Balance' : 'Realized + Open (USD)'}
              </span>
              <span className="text-sm font-bold text-sky-300">
                {isCmc
                  ? `$${(2000 + metrics.totalPnl).toFixed(2)}`
                  : `${metrics.totalPnl + openPnl >= 0 ? '+' : '-'}$${Math.abs(metrics.totalPnl + openPnl).toFixed(2)}`}
              </span>
            </div>
          </div>
          {!isCmc && teamNote && (
            <p className="text-[11px] text-amber-300">{teamNote}</p>
          )}
        </div>

        {/* Detailed Trade Statistics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs font-mono">
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Total Trades</span>
            <span className="text-white font-bold text-sm">{metrics.totalTrades}</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Total Lots</span>
            <span className="text-white font-bold text-sm">{metrics.totalLots}</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Avg Duration</span>
            <span className="text-gray-300 text-sm">{metrics.timedTrades > 0 ? formatSec(metrics.avgDurationSec) : '—'}</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Win Duration</span>
            <span className="text-emerald-400 text-sm">{formatSec(metrics.avgWinDurationSec)}</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Loss Duration</span>
            <span className="text-red-400 text-sm">{formatSec(metrics.avgLossDurationSec)}</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Avg Win Trade</span>
            <span className="text-emerald-400 font-bold text-sm">+${metrics.avgWin.toFixed(2)}</span>
          </div>
          <div className="p-2.5 rounded bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase text-gray-500 block">Avg Loss Trade</span>
            <span className="text-red-400 font-bold text-sm">-${metrics.avgLoss.toFixed(2)}</span>
          </div>
        </div>

        {/* Direction % & Best/Worst Trade */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
          <div className="p-3 rounded-lg bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase font-semibold text-gray-400 block">Trade Direction % (Long)</span>
            <span className="text-lg font-bold text-white">{metrics.longPct.toFixed(1)}%</span>
            <span className="text-[10px] text-gray-500 block mt-0.5">
              {metrics.longPct > 0 ? `${metrics.longPct.toFixed(0)}% Long` : '0% Long'} · {metrics.shortPct.toFixed(0)}% Short
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase font-semibold text-gray-400 block">Best Trade</span>
            <span className="text-lg font-bold text-emerald-400">+${metrics.bestTrade.toFixed(2)}</span>
            <span className="text-[10px] text-gray-500 block mt-0.5">Highest single gain</span>
          </div>
          <div className="p-3 rounded-lg bg-[#0d1117] border border-white/10">
            <span className="text-[10px] uppercase font-semibold text-gray-400 block">Worst Trade</span>
            <span className="text-lg font-bold text-red-400">-${Math.abs(metrics.worstTrade).toFixed(2)}</span>
            <span className="text-[10px] text-gray-500 block mt-0.5">Max single drawdown</span>
          </div>
        </div>

        {/* Trade Duration Analysis & Win Rate Analysis Buckets */}
        <div className="rounded-lg border border-white/10 bg-[#0d1117] p-4 space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-2">
            <span>⏱️</span> Trade Duration Analysis &amp; Win Rate Distribution
          </h4>
          <div className="space-y-1.5 font-mono text-xs">
            {DURATION_BUCKETS.map((bucket) => {
              const count = metrics.durationCounts[bucket] || 0
              const wr = metrics.durationWinRates[bucket] || 0
              return (
                <div key={bucket} className="flex items-center justify-between py-1.5 px-3 rounded bg-black/40 border border-white/5 hover:bg-white/5 transition">
                  <span className="text-gray-300 font-medium">{bucket}</span>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-gray-400">{count} trade{count === 1 ? '' : 's'}</span>
                    <span className={`font-bold ${wr > 50 ? 'text-emerald-400' : wr > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                      {wr.toFixed(1)}% WR
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Monthly P&L Calendar Visualizer */}
        <div className="rounded-lg border border-white/10 bg-[#0d1117] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
              <span>📅</span> P/L by week ({metrics.calendarLabel})
            </h4>
            <span className={`text-xs font-extrabold px-2.5 py-1 rounded border ${metrics.totalPnl >= 0 ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50' : 'bg-red-950/60 text-red-300 border-red-700/50'}`}>
              Monthly P/L: {metrics.totalPnl >= 0 ? '+' : '-'}${Math.abs(metrics.totalPnl).toFixed(2)}
            </span>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase font-extrabold text-gray-400 border-b border-white/10 pb-2">
            <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
          </div>

          <div className="space-y-1.5 font-mono text-xs">
            {metrics.monthlyCalendar.length === 0 && (
              <p className="text-xs text-gray-500 italic py-2">No closed trades in this range.</p>
            )}
            {metrics.monthlyCalendar.map((w) => (
              <div key={w.week} className="flex items-center justify-between p-2.5 rounded bg-black/40 border border-white/5">
                <span className="text-gray-300 font-bold">{w.week}</span>
                <div className="flex items-center gap-3">
                  <span className={pnlClass(w.pnl)}>
                    {w.pnl > 0 ? '+' : w.pnl < 0 ? '-' : ''}${Math.abs(w.pnl).toFixed(2)}
                  </span>
                  <span className="text-gray-500 text-[11px]">{w.trades} trades</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Executed Trades Table */}
        <div className="rounded-lg border border-white/10 bg-[#0d1117] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-2">
              <span>📋</span> Executed Trades Ledger &amp; CME Real Exchange Prices
            </h4>
            <span className="text-[10px] font-mono text-sky-300 bg-sky-950/50 px-2 py-0.5 rounded border border-sky-800/40">
              {isCmc ? 'CME GLOBEX' : 'QUESTRADE USD'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-black/50 text-[10px] uppercase text-gray-400 border-b border-white/10">
                <tr>
                  <th className="py-2.5 px-3">Journal ID</th>
                  <th className="py-2.5 px-3">Exchange</th>
                  <th className="py-2.5 px-3">Contract</th>
                  <th className="py-2.5 px-3">Direction</th>
                  <th className="py-2.5 px-3">Size</th>
                  <th className="py-2.5 px-3">Exact Entry</th>
                  <th className="py-2.5 px-3">Stop Loss (SL)</th>
                  <th className="py-2.5 px-3">Take Profit (TP)</th>
                  <th className="py-2.5 px-3">Exit / Status</th>
                  <th className="py-2.5 px-3">Net P&amp;L</th>
                  <th className="py-2.5 px-3">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-gray-300">
                {filteredTrades.map((t) => {
                  const pnl = t.pnl ?? 0
                  const exTag = t.exchange || getExchangeTag(t.symbol)
                  const isCme = exTag === 'CME Globex'
                  const isOpen = t.status === 'open'
                  const isBuy = t.direction === 'BUY' || t.direction === 'LONG'
                  const mult =
                    typeof t.multiplier === 'number' && t.multiplier > 0
                      ? t.multiplier
                      : getSymbolMultiplier(t.symbol)

                  const projectedLoss =
                    t.stop != null && t.entry != null
                      ? Math.abs((isBuy ? t.entry - t.stop : t.stop - t.entry) * t.quantity * mult)
                      : null

                  const projectedProfit =
                    t.target != null && t.entry != null
                      ? Math.abs((isBuy ? t.target - t.entry : t.entry - t.target) * t.quantity * mult)
                      : null

                  return (
                    <tr key={t.id} className="hover:bg-white/[0.03] transition">
                      <td className="py-2.5 px-3 font-bold text-sky-300">
                        <div className="flex items-center gap-1.5">
                          {isOpen && (
                            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="Active Ongoing Position" />
                          )}
                          <span>{t.id}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${isCme ? 'bg-amber-950 text-amber-300 border border-amber-700/50' : 'bg-purple-950 text-purple-300 border border-purple-700/50'}`}>
                          {exTag}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-white">{t.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${isBuy ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' : 'bg-red-950 text-red-300 border border-red-700/50'}`}>
                          {t.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-200">{t.quantity}</td>
                      <td className="py-2.5 px-3 font-bold text-white">
                        {formatCmeExchangePrice(t.symbol, t.entry)}
                      </td>
                      <td className="py-2.5 px-3 text-red-300">
                        <div className="flex items-baseline gap-1 flex-wrap">
                          <span className="font-semibold">{formatCmeExchangePrice(t.symbol, t.stop)}</span>
                          {projectedLoss != null && (
                            <span className="text-red-400 text-[10px] font-bold">
                              (-${projectedLoss.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-emerald-300">
                        <div className="flex items-baseline gap-1 flex-wrap">
                          <span className="font-semibold">{formatCmeExchangePrice(t.symbol, t.target)}</span>
                          {projectedProfit != null && (
                            <span className="text-emerald-400 text-[10px] font-bold">
                              (+${projectedProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        {isOpen ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-700/50 uppercase">
                            OPEN (LIVE)
                          </span>
                        ) : (
                          <span className="text-gray-200">
                            {formatCmeExchangePrice(t.symbol, t.exit)}
                          </span>
                        )}
                      </td>
                      <td className={`py-2.5 px-3 ${pnlClass(pnl)}`}>
                        {pnl > 0 ? '+' : pnl < 0 ? '-' : ''}${Math.abs(pnl).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-gray-400">
                        {isOpen ? 'Ongoing' : formatSec(getTradeDurationSec(t))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
