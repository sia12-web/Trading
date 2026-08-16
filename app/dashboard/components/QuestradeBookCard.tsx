'use client'

/**
 * Questrade book — see only. Transfer preview is Tradeify $ on DOW/NASDAQ.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { QuestradeBookPayload } from '@/lib/trading/questradeBook'
import type { QuestradeBookRow, QuestradeProtectiveLevel } from '@/lib/trading/questradeOrders'
import type { QuestradeTradeifyTransfer } from '@/lib/trading/questradeTransfer'
import { deskFuturesTitle } from '@/lib/trading/tradovateMirror'
import { CopyChip, CopyChipRow } from '@/app/dashboard/components/CopyChip'

function money(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: digits })}`
}

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
  if (n > 0) return 'text-emerald-300'
  if (n < 0) return 'text-red-300'
  return 'text-gray-400'
}

function Ticket({ row }: { row: QuestradeBookRow }) {
  const buy = row.side === 'BUY'
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-white">
          <span className={buy ? 'text-emerald-300' : 'text-red-300'}>{row.side}</span>{' '}
          {row.label}
        </div>
        <div className="text-[11px] text-gray-500">
          {row.asset === 'option' ? 'option' : 'stock'} ·{' '}
          {row.kind === 'entry_limit' ? 'LIMIT' : row.status} · {montrealStamp(row.filledAt)}
        </div>
      </div>
      <div className="mt-1 text-xs text-gray-400">
        Entry {row.entry}
        {row.mark != null ? ` · mark ${row.mark}` : ''}
        {' · '}risk {money(row.stockRiskDollars, 2)}
        {row.kind === 'open_position' ? (
          <>
            {' · '}live{' '}
            <span className={pnlClass(row.livePnl)}>{money(row.livePnl, 2)}</span>
          </>
        ) : null}
        {row.stopStatus && row.stopStatus !== 'working' ? ` · SL ${row.stopStatus}` : ''}
        {row.targetStatus && row.targetStatus !== 'working' ? ` · TP ${row.targetStatus}` : ''}
      </div>
      <CopyChipRow>
        <CopyChip label="Size" value={row.quantity} tone="size" />
        <CopyChip label="SL" value={row.stop} tone="sl" />
        <CopyChip label="TP" value={row.target} tone="tp" />
      </CopyChipRow>
    </div>
  )
}

function LevelRow({ level }: { level: QuestradeProtectiveLevel }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-gray-200">
          <span className={level.kind === 'sl' ? 'text-red-300' : 'text-emerald-300'}>
            {level.kind === 'sl' ? 'SL' : 'TP'}
          </span>{' '}
          {level.label}
        </p>
        <p className="text-[11px] text-gray-500">
          {level.status}
          {level.updatedAt ? ` · ${montrealStamp(level.updatedAt)}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <CopyChip label="Size" value={level.quantity} tone="size" />
        <CopyChip
          label={level.kind === 'sl' ? 'SL' : 'TP'}
          value={level.price}
          tone={level.kind === 'sl' ? 'sl' : 'tp'}
        />
      </div>
    </div>
  )
}

function TransferCard({ item }: { item: QuestradeTradeifyTransfer }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    if (!item.ticket?.copyText) return
    try {
      await navigator.clipboard.writeText(item.ticket.copyText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [item.ticket])

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-amber-100">
          {item.symbol} → {deskFuturesTitle(item.instrument)} {item.side}
        </div>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            item.canSize
              ? 'bg-amber-500/20 text-amber-100'
              : 'bg-white/10 text-gray-300'
          }`}
        >
          {item.riskLabel}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-gray-400">{item.note}</p>
      <p className="mt-2 text-xs text-gray-300">
        Stock {item.stockEntry}
        {item.stockStop != null ? ` / SL ${item.stockStop}` : ''}
        {item.stockTarget != null ? ` / 1.5R ${item.stockTarget}` : ''}
        {item.indexEntry != null
          ? ` · ${item.instrument} ${item.indexEntry}${item.indexStop != null ? ` / SL ${item.indexStop}` : ''}${item.indexTarget != null ? ` / TP ${item.indexTarget}` : ''}`
          : ''}
      </p>
      <CopyChipRow>
        <CopyChip
          label="Size"
          value={item.ticket?.qty ?? item.stockQty}
          display={item.ticket ? item.ticket.sizeLabel : String(item.stockQty)}
          tone="size"
        />
        <CopyChip label="SL" value={item.ticket?.stop ?? item.stockStop} tone="sl" />
        <CopyChip label="TP" value={item.ticket?.target ?? item.stockTarget} tone="tp" />
      </CopyChipRow>
      <p className="mt-1 text-[11px] text-gray-500">{item.advice.headline}</p>
      {item.ticket ? (
        <button
          type="button"
          onClick={() => void copy()}
          className="mt-2 rounded-md border border-amber-400/40 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
        >
          {copied
            ? 'Copied'
            : item.canSize
              ? `Copy ${item.ticket.sizeLabel} Tradovate ticket`
              : `Next session: ${item.ticket.sizeLabel}`}
        </button>
      ) : (
        <p className="mt-2 text-[11px] text-gray-500">
          {item.canSize
            ? 'Index last not available (weekend / outside focus). Look at SL/TP here, place at NY open.'
            : item.riskLabel}
        </p>
      )}
    </div>
  )
}

export function QuestradeBookCard() {
  const [data, setData] = useState<QuestradeBookPayload | { ok: false; error: string } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trading/questrade/book', { cache: 'no-store' })
      const json = (await res.json()) as QuestradeBookPayload | { ok: false; error: string }
      if (!res.ok || !json.ok) {
        setError(('error' in json && json.error) || 'Could not load Questrade book')
        setData(json.ok === false ? json : null)
        return
      }
      setError(null)
      setData(json)
    } catch {
      setError('Could not load Questrade book')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(id)
  }, [load])

  const book = data && data.ok ? data : null
  const acct = book?.account && book.account.ok ? book.account : null
  const curve = (book?.equityCurve || []).map((p) => ({
    t: montrealStamp(p.t),
    equity: p.equity,
  }))

  return (
    <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-4">
      <h2 className="text-sm font-semibold text-emerald-100">Questrade book</h2>
      <p className="mt-0.5 text-xs text-gray-400">
        Read-only. Their share count is not your Tradeify size. Copy on DOW or NASDAQ at NY
        open — $400 → $250 → $150, flatten 16:59 ET.
      </p>

      {error ? <p className="mt-3 text-xs text-amber-200">{error}</p> : null}

      {acct ? (
        <p className="mt-3 text-xs text-gray-300">
          {acct.account} · {acct.currency} equity{' '}
          <span className="font-semibold text-white">{money(acct.equity)}</span>
          {' · '}cash {money(acct.cash)}
          {' · '}
          {acct.positions} open
        </p>
      ) : null}

      {curve.length > 0 ? (
        <div className="mt-4 h-36">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curve}>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip
                contentStyle={{
                  background: '#0f172a',
                  border: '1px solid #334155',
                  fontSize: 12,
                }}
                formatter={(value) => [money(Number(value) || 0), 'Equity']}
              />
              <Line type="monotone" dataKey="equity" stroke="#34d399" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Working limits — transfer for Tradeify
      </h3>
      <div className="mt-2 space-y-2">
        {book?.workingLimits.length ? (
          book.workingLimits.map((r) => <Ticket key={r.sourceId} row={r} />)
        ) : (
          <p className="text-xs text-gray-500">No working limits.</p>
        )}
      </div>

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Tradeify look-book
      </h3>
      <p className="mt-1 text-[11px] text-gray-500">
        Click size, SL, or TP to copy the Tradovate number.
      </p>
      <div className="mt-2 space-y-2">
        {book?.transfers.length ? (
          book.transfers.map((t) => <TransferCard key={t.sourceId} item={t} />)
        ) : (
          <p className="text-xs text-gray-500">Nothing to transfer until a limit or open stock prints.</p>
        )}
      </div>

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        All stops & targets
      </h3>
      <p className="mt-1 text-[11px] text-gray-500">
        Working, filled, and cancelled — they often flatten before SL/TP prints.
      </p>
      <div className="mt-2 space-y-1.5">
        {book?.levels.length ? (
          book.levels.map((l) => <LevelRow key={`${l.kind}-${l.sourceId}`} level={l} />)
        ) : (
          <p className="text-xs text-gray-500">No stop or target orders in the lookback.</p>
        )}
      </div>

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Open positions — live P&L · SL/TP
      </h3>
      <div className="mt-2 space-y-2">
        {book?.openPositions.length ? (
          book.openPositions.map((r) => <Ticket key={r.sourceId} row={r} />)
        ) : (
          <p className="text-xs text-gray-500">No open positions.</p>
        )}
      </div>

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Order history
      </h3>
      <div className="mt-2 space-y-2">
        {book?.history.length ? (
          book.history.map((r) => <Ticket key={`${r.sourceId}-${r.filledAt}`} row={r} />)
        ) : (
          <p className="text-xs text-gray-500">No fills in the lookback.</p>
        )}
      </div>
    </section>
  )
}
