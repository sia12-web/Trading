'use client'

/**
 * NYC team tape — see only. A team stock fill is not a Tradeify attempt.
 * Click size / SL / TP to copy that number.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { TeamCopyAdvice, TeamTapeSignal } from '@/lib/trading/teamTape'
import type { QuestradeAccountSnapshot } from '@/lib/trading/questradeReadOnly'
import type { QuestradeBookPayload } from '@/lib/trading/questradeBook'
import type { QuestradeBookRow, QuestradeProtectiveLevel } from '@/lib/trading/questradeOrders'
import { CopyChip, CopyChipRow } from '@/app/dashboard/components/CopyChip'

type Payload = {
  ok?: boolean
  advice?: TeamCopyAdvice
  open?: TeamTapeSignal[]
  history?: TeamTapeSignal[]
  questrade?: QuestradeAccountSnapshot | { ok: false; error: string }
  error?: string
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
  if (n == null) return 'text-gray-500'
  if (n > 0) return 'text-emerald-300'
  if (n < 0) return 'text-red-300'
  return 'text-gray-400'
}

function TicketRow({ signal }: { signal: TeamTapeSignal }) {
  const buy = signal.side === 'BUY'
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-white">
          <span className={buy ? 'text-emerald-300' : 'text-red-300'}>{signal.side}</span>{' '}
          {signal.symbol}
        </div>
        <div className="text-[11px] text-gray-500">
          {montrealStamp(signal.filledAt)} Montreal · {signal.status}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">Entry {signal.entry}</p>
      <CopyChipRow>
        <CopyChip label="Size" value={signal.quantity} tone="size" />
        <CopyChip label="SL" value={signal.stop} tone="sl" />
        <CopyChip label="TP" value={signal.target} tone="tp" />
      </CopyChipRow>
    </div>
  )
}

function LivePositionCard({ row }: { row: QuestradeBookRow }) {
  const buy = row.side === 'BUY'
  const pnl = row.livePnl
  const pnlTxt =
    pnl == null
      ? '—'
      : `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-white">
          <span className={buy ? 'text-emerald-300' : 'text-red-300'}>{row.side}</span>{' '}
          {row.label}
        </div>
        <div className={`text-[11px] font-medium ${pnlClass(pnl)}`}>live {pnlTxt}</div>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        {row.asset === 'option' ? 'option' : 'stock'}
        {row.entry != null ? ` · entry ${row.entry}` : ''}
        {row.mark != null ? ` · mark ${row.mark}` : ''}
        {row.stopStatus && row.stopStatus !== 'working' ? ` · SL ${row.stopStatus}` : ''}
        {row.targetStatus && row.targetStatus !== 'working' ? ` · TP ${row.targetStatus}` : ''}
      </p>
      <CopyChipRow>
        <CopyChip label="Size" value={row.quantity} tone="size" />
        <CopyChip label="SL" value={row.stop} tone="sl" />
        <CopyChip label="TP" value={row.target} tone="tp" />
      </CopyChipRow>
    </div>
  )
}

function LevelCard({ level }: { level: QuestradeProtectiveLevel }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-gray-200">
          <span className={level.kind === 'sl' ? 'text-red-300' : 'text-emerald-300'}>
            {level.kind === 'sl' ? 'SL' : 'TP'}
          </span>{' '}
          {level.label}
        </p>
        <p className="text-[11px] text-gray-500">{level.status}</p>
      </div>
      <CopyChipRow>
        <CopyChip label="Size" value={level.quantity} tone="size" />
        <CopyChip
          label={level.kind === 'sl' ? 'SL' : 'TP'}
          value={level.price}
          tone={level.kind === 'sl' ? 'sl' : 'tp'}
        />
      </CopyChipRow>
    </div>
  )
}

export function TeamTapeCard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Payload | null>(null)
  const [book, setBook] = useState<QuestradeBookPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const advice = data?.advice
  const open = data?.open ?? []
  const history = data?.history ?? []
  const last = open[0]
  const levels = compact ? (book?.levels ?? []).slice(0, 8) : book?.levels ?? []

  return (
    <section className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-sky-100">Team tape</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            NYC stocks and options — see only. Click size, SL, or TP to copy that number.
            Their fill is not your 3/3.
          </p>
        </div>
        {compact ? (
          <Link href="/dashboard/swing" className="text-xs text-sky-300 hover:text-white">
            Open →
          </Link>
        ) : (
          <Link href="/dashboard" className="text-xs text-gray-500 hover:text-white">
            ← Desk
          </Link>
        )}
      </div>

      {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}

      {data?.questrade?.ok ? (
        <p className="mt-3 text-xs text-gray-300">
          Questrade {data.questrade.account} · {data.questrade.currency} equity{' '}
          <span className="font-semibold text-white">
            ${data.questrade.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
          {' · '}cash ${data.questrade.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          {' · '}
          {data.questrade.positions} open
        </p>
      ) : data?.questrade && !data.questrade.ok ? (
        <p className="mt-3 text-xs text-amber-200">Questrade: {data.questrade.error}</p>
      ) : null}

      {advice ? (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            advice.canCopy
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100'
              : 'border-amber-500/35 bg-amber-500/10 text-amber-100'
          }`}
        >
          <div className="font-semibold">{advice.headline}</div>
          {!compact ? (
            <p className="mt-1 text-xs leading-relaxed text-gray-300">{advice.detail}</p>
          ) : null}
          <p className="mt-1 text-[11px] text-gray-400">
            {advice.fillsUsed}/3 used · {advice.fillsLeft} left
            {advice.clockedIn ? '' : ' · not clocked in'}
          </p>
        </div>
      ) : null}

      {book?.openPositions.length ? (
        <div className="mt-3 space-y-2">
          {book.openPositions.map((p) => (
            <LivePositionCard key={p.sourceId} row={p} />
          ))}
        </div>
      ) : null}

      {levels.length ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            All stops & targets
          </p>
          <div className="mt-1.5 space-y-1.5">
            {levels.map((l) => (
              <LevelCard key={`${l.kind}-${l.sourceId}`} level={l} />
            ))}
          </div>
        </div>
      ) : null}

      {compact ? (
        <p className="mt-3 text-xs text-gray-400">
          {book?.openPositions.length
            ? `${book.openPositions.length} live position${book.openPositions.length === 1 ? '' : 's'}`
            : open.length === 0
              ? 'No team tickets yet.'
              : `Open now: ${open.length}${last ? ` · last ${last.symbol} ${last.side.toLowerCase()}` : ''}`}
        </p>
      ) : (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Recent tape
          </h3>
          <div className="mt-2 space-y-2">
            {open.length === 0 ? (
              <p className="text-xs text-gray-500">No open team tickets.</p>
            ) : (
              open.map((s) => <TicketRow key={s.sourceId} signal={s} />)
            )}
          </div>
          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-gray-500">
            History
          </h3>
          <div className="mt-2 space-y-2">
            {history.length === 0 ? (
              <p className="text-xs text-gray-500">No closed team tickets in the last 14 days.</p>
            ) : (
              history.map((s) => <TicketRow key={s.sourceId} signal={s} />)
            )}
          </div>
        </>
      )}
    </section>
  )
}
