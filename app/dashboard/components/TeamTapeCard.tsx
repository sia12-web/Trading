'use client'

/**
 * NYC Team Tape & Live Desk Book
 * Clean, interactive view of Ongoing Positions, Working Limits, Past Orders (Fills),
 * and Performance Analytics (Monthly P&L Calendar, Trade Duration & Win Rate Analysis)
 * with CME Globex real exchange price formatting.
 */

import { useCallback, useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import {
  teamTapeTarget1_5R,
  type TeamTapeSignal,
} from '@/lib/trading/teamTape'
import type { QuestradeBookPayload } from '@/lib/trading/questradeBook'
import type { QuestradeBookRow } from '@/lib/trading/questradeOrders'
import { getSymbolRealName } from '@/lib/trading/symbolNames'
import {
  calculatePerformanceMetrics,
  DURATION_BUCKETS,
  formatCmeExchangePrice,
  getExchangeTag,
  getSymbolMultiplier,
} from '@/lib/trading/performanceMetrics'

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

function pnlClass(n: number | null | undefined): string {
  if (n == null) return 'text-gray-400'
  if (n > 0) return 'text-emerald-400 font-bold'
  if (n < 0) return 'text-red-400 font-bold'
  return 'text-gray-400 font-bold'
}

function signalToBookRow(s: TeamTapeSignal, kind: 'open_position' | 'entry_limit'): QuestradeBookRow {
  const mult = s.multiplier ?? getSymbolMultiplier(s.symbol)
  return {
    sourceId: s.sourceId,
    symbol: s.symbol,
    label: s.realName && /\$/.test(s.realName) ? s.realName : s.symbol,
    companyName: s.companyName || s.symbol,
    realName: s.realName || s.companyName || s.symbol,
    underlying: s.symbol,
    asset: s.multiplier === 100 ? 'option' : 'stock',
    side: s.side === 'SELL' ? 'SELL' : 'BUY',
    quantity: s.quantity,
    entry: s.entry,
    stop: s.stop,
    target: s.target,
    stopStatus: s.stop ? 'working' : null,
    targetStatus: s.target ? 'working' : null,
    mark: s.mark ?? null,
    livePnl: s.livePnl ?? null,
    status: s.status === 'working' ? 'working' : 'filled',
    orderType: 'LIMIT',
    kind,
    notional: (s.mark ?? s.entry) * s.quantity * mult,
    stockRiskDollars: s.stop ? Math.abs(s.entry - s.stop) * s.quantity * mult : null,
    multiplier: mult,
    filledAt: s.filledAt ?? null,
  }
}

/** 🟢 Ongoing Position Card */
function OngoingPositionCard({ row }: { row: QuestradeBookRow }) {
  const isBuy = row.side === 'BUY'
  const mult = row.multiplier ?? getSymbolMultiplier(row.symbol, row.asset)

  // Calculate live PnL accurately
  const pnl =
    row.livePnl != null
      ? row.livePnl
      : row.mark != null && row.entry != null
      ? (isBuy ? row.mark - row.entry : row.entry - row.mark) * row.quantity * mult
      : null

  const sign = pnl != null && pnl > 0 ? '+' : pnl != null && pnl < 0 ? '-' : ''
  const pnlFormatted =
    pnl == null
      ? '—'
      : `${sign}$${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const meta = getSymbolRealName(row.symbol)
  const displayName = row.companyName || meta.name
  const exTag = getExchangeTag(row.symbol)

  // Calculate projected stop loss and take profit
  const effectiveTarget =
    row.target ??
    (row.stop != null ? teamTapeTarget1_5R({ side: row.side, entry: row.entry, stop: row.stop }) : null)

  const projectedLoss =
    row.stop != null && row.entry != null
      ? Math.abs((isBuy ? row.entry - row.stop : row.stop - row.entry) * row.quantity * mult)
      : row.stockRiskDollars != null
      ? row.stockRiskDollars
      : null

  const projectedProfit =
    effectiveTarget != null && row.entry != null
      ? Math.abs((isBuy ? effectiveTarget - row.entry : row.entry - effectiveTarget) * row.quantity * mult)
      : null

  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 p-3 transition hover:border-sky-500/50">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className={`text-xs font-extrabold px-1.5 py-0.5 rounded ${isBuy ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' : 'bg-red-950 text-red-300 border border-red-700/50'}`}>
            {row.side}
          </span>
          <span className="text-sm font-bold text-white">{row.label || row.symbol}</span>
          <span className="text-[10px] font-mono text-amber-300 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
            {exTag}
          </span>
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
          <span className="text-white font-bold">{formatCmeExchangePrice(row.symbol, row.entry)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Mark</span>
          <span className="text-gray-200">{formatCmeExchangePrice(row.symbol, row.mark)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Stop Loss (SL)</span>
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-red-300 font-semibold">{formatCmeExchangePrice(row.symbol, row.stop)}</span>
            {projectedLoss != null && (
              <span className="text-red-400 text-[11px] font-bold">
                (-${projectedLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
              </span>
            )}
          </div>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Take Profit (TP)</span>
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-emerald-300 font-semibold">{formatCmeExchangePrice(row.symbol, effectiveTarget)}</span>
            {projectedProfit != null && (
              <span className="text-emerald-400 text-[11px] font-bold">
                (+${projectedProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** ⚡ Working Limit Order Card */
function WorkingLimitCard({ row }: { row: QuestradeBookRow }) {
  const isBuy = row.side === 'BUY'
  const mult = row.multiplier ?? getSymbolMultiplier(row.symbol, row.asset)
  const meta = getSymbolRealName(row.symbol)
  const displayName = row.companyName || meta.name
  const exTag = getExchangeTag(row.symbol)

  const effectiveTarget =
    row.target ??
    (row.stop != null ? teamTapeTarget1_5R({ side: row.side, entry: row.entry, stop: row.stop }) : null)

  const projectedLoss =
    row.stop != null && row.entry != null
      ? Math.abs((isBuy ? row.entry - row.stop : row.stop - row.entry) * row.quantity * mult)
      : row.stockRiskDollars != null
      ? row.stockRiskDollars
      : null

  const projectedProfit =
    effectiveTarget != null && row.entry != null
      ? Math.abs((isBuy ? effectiveTarget - row.entry : row.entry - effectiveTarget) * row.quantity * mult)
      : null

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 transition hover:border-amber-500/50">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-extrabold px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-600/50">
            LIMIT {row.side}
          </span>
          <span className="text-sm font-bold text-white">{row.label || row.symbol}</span>
          <span className="text-[10px] font-mono text-amber-300 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
            {exTag}
          </span>
          {displayName && displayName !== row.label && displayName !== row.symbol && (
            <span className="text-xs text-amber-200/70">· {displayName}</span>
          )}
        </div>
        <span className="text-[11px] font-mono text-amber-400 font-semibold uppercase">WORKING ORDER</span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-mono bg-black/40 p-2 rounded border border-white/5">
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Target Entry</span>
          <span className="text-amber-200 font-bold">{formatCmeExchangePrice(row.symbol, row.entry)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">SL</span>
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-red-300 font-semibold">{formatCmeExchangePrice(row.symbol, row.stop)}</span>
            {projectedLoss != null && (
              <span className="text-red-400 text-[11px] font-bold">
                (-${projectedLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
              </span>
            )}
          </div>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">TP</span>
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-emerald-300 font-semibold">{formatCmeExchangePrice(row.symbol, effectiveTarget)}</span>
            {projectedProfit != null && (
              <span className="text-emerald-400 text-[11px] font-bold">
                (+${projectedProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 📜 Closed trade / realized outcome card (never invents WIN from take-profit). */
function PastOrderCard({ signal }: { signal: TeamTapeSignal }) {
  const isBuy = signal.side === 'BUY'
  const meta = getSymbolRealName(signal.symbol)
  const displayName = signal.companyName || meta.name
  const exTag = getExchangeTag(signal.symbol)
  const mult = signal.multiplier ?? getSymbolMultiplier(signal.symbol)

  // Realized P&L only — do not fall back to projected target
  let realizedPnl: number | null = null
  if (typeof signal.pnl === 'number' && Number.isFinite(signal.pnl)) {
    realizedPnl = signal.pnl
  } else if (signal.exit != null && signal.entry != null && signal.status === 'closed') {
    realizedPnl =
      (isBuy ? signal.exit - signal.entry : signal.entry - signal.exit) * signal.quantity * mult
  }

  const isCancelled = signal.status === 'cancelled'
  const isClosed = signal.status === 'closed' || realizedPnl != null
  const outcomeLabel = isCancelled
    ? 'CANCELLED'
    : !isClosed
    ? 'FILL'
    : realizedPnl == null
    ? 'CLOSED'
    : realizedPnl >= 0
    ? 'WIN'
    : 'LOSS'

  const effectiveTarget =
    signal.target ??
    (signal.stop != null ? teamTapeTarget1_5R({ side: signal.side, entry: signal.entry, stop: signal.stop }) : null)

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 transition hover:border-white/20">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-extrabold px-1.5 py-0.5 rounded ${isBuy ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50' : 'bg-red-950 text-red-300 border border-red-700/50'}`}>
            {signal.side}
          </span>
          <span className="text-sm font-bold text-white">
            {signal.realName && /\$/.test(signal.realName) ? signal.realName : signal.symbol}
          </span>
          <span className="text-[10px] font-mono text-amber-300 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
            {exTag}
          </span>
          {displayName && displayName !== signal.symbol && (
            <span className="text-xs text-gray-400">· {displayName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">
            {montrealStamp(signal.exitAt || signal.filledAt)}
          </span>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                outcomeLabel === 'WIN'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60'
                  : outcomeLabel === 'LOSS'
                  ? 'bg-red-950/80 text-red-300 border border-red-700/60'
                  : 'bg-gray-800 text-gray-400 border border-gray-700'
              }`}
            >
              {outcomeLabel}
            </span>
            {realizedPnl != null && (
              <span className={`text-xs font-mono font-bold ${realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {realizedPnl >= 0 ? '+' : '-'}${Math.abs(realizedPnl).toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-black/40 p-2 rounded border border-white/5">
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Exact Entry</span>
          <span className="text-white font-bold">{formatCmeExchangePrice(signal.symbol, signal.entry)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Exit</span>
          <span className="text-gray-200">{formatCmeExchangePrice(signal.symbol, signal.exit)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Stop Loss (SL)</span>
          <span className="text-red-300">{formatCmeExchangePrice(signal.symbol, signal.stop)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Take Profit (TP)</span>
          <span className="text-emerald-300">{formatCmeExchangePrice(signal.symbol, effectiveTarget)}</span>
        </div>
      </div>
    </div>
  )
}

/** 📊 Performance Analytics Panel — closed trades with realized P&L only */
function PerformanceAnalyticsPanel({
  signals,
  openRows,
}: {
  signals?: TeamTapeSignal[]
  openRows?: QuestradeBookRow[]
}) {
  const tradeRecords = useMemo(() => {
    if (signals && signals.length > 0) {
      return signals
        .filter((s) => s.status === 'closed' || (typeof s.pnl === 'number' && s.exit != null))
        .filter((s) => s.status !== 'cancelled')
        .map((s) => {
          const sym = String(s.symbol || '')
          const mult = typeof s.multiplier === 'number' && s.multiplier > 0 ? s.multiplier : getSymbolMultiplier(sym)
          const qty = Number(s.quantity || 1)
          let calcPnl: number | null = null
          if (typeof s.pnl === 'number' && Number.isFinite(s.pnl)) {
            calcPnl = s.pnl
          } else if (s.exit != null && s.entry != null) {
            calcPnl = (s.side === 'BUY' ? s.exit - s.entry : s.entry - s.exit) * qty * mult
          }
          return {
            id: String(s.sourceId || Math.random()),
            symbol: sym,
            direction: (s.side === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
            entry: Number(s.entry || 0),
            exit: s.exit ?? null,
            stop: s.stop || null,
            target: s.target || null,
            pnl: calcPnl,
            quantity: qty,
            status: 'closed' as const,
            entryTime: s.filledAt || new Date().toISOString(),
            exitTime: s.exitAt || s.filledAt || null,
            exchange: getExchangeTag(sym),
          }
        })
        .filter((t) => typeof t.pnl === 'number')
    }
    return []
  }, [signals])

  const metrics = useMemo(() => calculatePerformanceMetrics(tradeRecords), [tradeRecords])
  const openPnl = (openRows || []).reduce((sum, row) => {
    return sum + (typeof row.livePnl === 'number' && Number.isFinite(row.livePnl) ? row.livePnl : 0)
  }, 0)
  const openCount = (openRows || []).filter((row) => typeof row.livePnl === 'number').length

  return (
    <div className="space-y-4">
      {/* Header Info Banner */}
      <div className="rounded-lg border border-sky-600/40 bg-sky-950/30 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white">NYC Desk Account:</span>
          <span className="font-mono text-sky-300 bg-sky-900/40 px-2 py-0.5 rounded border border-sky-600/30">
            Questrade Team Tape (realized closes)
          </span>
        </div>
        <div className="text-gray-400 font-mono">
          {tradeRecords.length} closed trade{tradeRecords.length === 1 ? '' : 's'} with realized P&amp;L
        </div>
      </div>

      {tradeRecords.length === 0 && (
        <p className="text-xs text-gray-500 italic py-2">
          No closed round-trips yet. Open positions and working limits are excluded from win-rate / P&amp;L until they exit.
        </p>
      )}

      {/* Primary Key Performance Indicators Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-400">Realized P&amp;L (USD)</div>
          <div className={`mt-1 text-lg font-bold price-mono ${metrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {metrics.totalPnl >= 0 ? '+' : ''}${metrics.totalPnl.toFixed(2)}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">{metrics.totalTrades} closed trades</div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-400">Open P&amp;L (USD)</div>
          <div className={`mt-1 text-lg font-bold price-mono ${openPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {openPnl >= 0 ? '+' : ''}${openPnl.toFixed(2)}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">{openCount} open position{openCount === 1 ? '' : 's'}</div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-400">Trade Win %</div>
          <div className="mt-1 text-lg font-bold price-mono text-emerald-400">
            {metrics.winRatePct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            {metrics.winningTrades}W · {metrics.losingTrades}L
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-400">Profit Factor</div>
          <div className="mt-1 text-lg font-bold price-mono text-sky-300">
            {metrics.profitFactor > 0 ? metrics.profitFactor.toFixed(2) : 'N/A'}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            +${metrics.grossProfit.toFixed(0)} / -${metrics.grossLoss.toFixed(0)}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-400">Avg Win / Avg Loss</div>
          <div className="mt-1 text-lg font-bold price-mono text-white">
            Ratio: {metrics.winLossRatio.toFixed(2)}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            ${metrics.avgWin.toFixed(0)} / -${metrics.avgLoss.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-black/30 p-3 rounded-lg border border-white/5">
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Total Trades</span>
          <span className="text-white font-bold">{metrics.totalTrades}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Total Lots Traded</span>
          <span className="text-gray-200">{metrics.totalLots}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Avg Duration</span>
          <span className="text-gray-200">{metrics.timedTrades > 0 ? `${metrics.avgDurationSec}s` : '—'}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-gray-500 block">Trade Direction (Long)</span>
          <span className="text-gray-200">{metrics.longPct.toFixed(0)}%</span>
        </div>
      </div>

      {/* Trade Duration Analysis */}
      <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
          ⏱️ Trade Duration &amp; Win Rate Analysis
        </h4>
        <div className="space-y-1.5 pt-1">
          {DURATION_BUCKETS.map((bucket) => {
            const count = metrics.durationCounts[bucket] || 0
            const wr = metrics.durationWinRates[bucket] || 0
            return (
              <div key={bucket} className="flex items-center justify-between text-[11px] font-mono py-1 px-2 rounded bg-black/20 border border-white/5">
                <span className="text-gray-400">{bucket}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">{count} trade{count === 1 ? '' : 's'}</span>
                  <span className={`font-semibold ${wr > 50 ? 'text-emerald-400' : wr > 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                    {wr.toFixed(1)}% WR
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Monthly P&L Calendar */}
      <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">
            📅 P/L by week ({metrics.calendarLabel})
          </h4>
          <span className={`text-xs font-bold ${metrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            Monthly P/L: {metrics.totalPnl >= 0 ? '+' : ''}${metrics.totalPnl.toFixed(2)}
          </span>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase font-bold text-gray-500 pt-2 border-b border-white/10 pb-1">
          <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
        </div>

        <div className="space-y-1 text-xs font-mono">
          {metrics.monthlyCalendar.map((w) => (
            <div key={w.week} className="flex items-center justify-between p-2 rounded bg-white/[0.02] border border-white/5">
              <span className="text-gray-400 text-[11px]">{w.week}</span>
              <div className="flex items-center gap-2">
                <span className={`font-bold ${w.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  ${w.pnl.toFixed(2)}
                </span>
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

  const ongoingPositions = useMemo(() => {
    if (book?.ok) {
      return book.openPositions || []
    }
    if (data?.open) {
      return data.open
        .filter((s) => s.status === 'filled')
        .map((s) => signalToBookRow(s, 'open_position'))
    }
    return []
  }, [book, data?.open])

  const workingLimits = useMemo(() => {
    if (book?.ok) {
      return book.workingLimits || []
    }
    if (data?.open) {
      return data.open
        .filter((s) => s.status === 'working')
        .map((s) => signalToBookRow(s, 'entry_limit'))
    }
    return []
  }, [book, data?.open])

  const historySignals: TeamTapeSignal[] = useMemo(() => {
    if (!data?.history) return []
    return data.history.filter((s) => s.status !== 'cancelled')
  }, [data?.history])

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
            Questrade stocks and options — entry, mark, and realized P&amp;L from the team account.
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
        {activeTab === 'performance' && (
          <PerformanceAnalyticsPanel signals={historySignals} openRows={ongoingPositions} />
        )}

        {/* 🟢 Ongoing Positions */}
        {(activeTab === 'all' || activeTab === 'open') && (
          <div>
            {!compact && <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-sky-400">🟢 Ongoing Positions ({totalOngoing})</h3>}
            {totalOngoing === 0 ? (
              activeTab === 'open' && <p className="text-xs text-gray-500 italic py-2">No active ongoing positions in market.</p>
            ) : (
              <div className="space-y-2">
                {ongoingPositions.map((pos: QuestradeBookRow, idx: number) => (
                  <OngoingPositionCard key={`${pos.symbol}-${idx}`} row={pos} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ⚡ Working Limits */}
        {(activeTab === 'all' || activeTab === 'limits') && (
          <div>
            {!compact && <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400">⚡ Working Limit Orders ({totalLimits})</h3>}
            {totalLimits === 0 ? (
              activeTab === 'limits' && <p className="text-xs text-gray-500 italic py-2">No working limit orders pending.</p>
            ) : (
              <div className="space-y-2">
                {workingLimits.map((limit: QuestradeBookRow, idx: number) => (
                  <WorkingLimitCard key={`${limit.symbol}-${idx}`} row={limit} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 📜 Past Orders / Fills */}
        {(activeTab === 'all' || activeTab === 'history') && (
          <div>
            {!compact && <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">📜 Past Orders &amp; Executed Fills ({totalHistory})</h3>}
            {totalHistory === 0 ? (
              <p className="text-xs text-gray-500 italic py-2">No past order fills recorded on team tape.</p>
            ) : (
              <div className="space-y-2">
                {historySignals.map((signal) => (
                  <PastOrderCard key={signal.sourceId} signal={signal} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
