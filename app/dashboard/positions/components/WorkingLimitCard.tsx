'use client'

/**
 * Live working (unfilled) limit — desk book waiting for fill.
 * Shown on Live Positions so traders can see/cancel even when chart overlay is missing.
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { usePositionPriceSubscription } from '@/lib/hooks/usePositionPriceSubscription'
import { errorToast, successToast } from '@/lib/utils/toastUtils'
import type { WorkingLimitStatus } from '@/types/positionManagement'
import { entrySourceLabel, entrySourceTone } from '@/lib/trading/entrySourceBadge'
import { formatDeskMoney } from '@/lib/trading/currency'
import { setDeskInstrumentPreference } from '@/lib/trading/deskInstrumentPreference'

interface Props {
  working: WorkingLimitStatus
  /** Selected tab may differ from working instrument (desk allows one working at a time). */
  viewingInstrument?: string
  onCancelled?: () => void
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function WorkingLimitCard({ working, viewingInstrument, onCancelled }: Props) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const isLong = working.entry_direction === 'LONG'
  const onOtherTab = viewingInstrument && viewingInstrument !== working.instrument

  const applyPrice = useCallback((price: number) => {
    if (!Number.isFinite(price) || price <= 0) return
    setCurrentPrice(price)
  }, [])

  usePositionPriceSubscription(working.instrument, applyPrice)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/trading/quote?instrument=${encodeURIComponent(working.instrument)}`,
          { cache: 'no-store' }
        )
        if (!res.ok || cancelled) return
        const j = await res.json()
        const px = Number(j?.price ?? j?.mid ?? j?.last)
        if (Number.isFinite(px) && px > 0) applyPrice(px)
      } catch {
        /* soft-fail */
      }
    }
    void poll()
    const id = window.setInterval(poll, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [working.instrument, applyPrice])

  const cancelWorking = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/trading/positions/cancel-working', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument: working.instrument }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Cancel failed')
      }
      successToast('Working limit cancelled')
      onCancelled?.()
    } catch (e) {
      errorToast(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  const px = currentPrice
  const waiting =
    px == null
      ? null
      : isLong
        ? px > working.entry_price
          ? 'Waiting for price ≤ limit'
          : 'At/through limit — may fill soon'
        : px < working.entry_price
          ? 'Waiting for price ≥ limit'
          : 'At/through limit — may fill soon'

  const srcTone = entrySourceTone(working.entry_source)
  const chartHref = `/dashboard/chart?instrument=${encodeURIComponent(working.instrument)}`

  return (
    <div className="rounded-xl border border-sky-800/50 bg-gradient-to-b from-sky-950/40 to-[#161b22] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-900/40 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-sky-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-sky-300">
            Working limit
          </span>
          <span className="text-sm font-semibold text-white">
            {working.instrument} · {working.entry_direction}
          </span>
          {working.entry_source && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${srcTone}`}
            >
              {entrySourceLabel(working.entry_source)}
            </span>
          )}
        </div>
        <span className="text-[11px] text-sky-300/80">Not filled — not on Order History yet</span>
      </div>

      {onOtherTab && (
        <div className="border-b border-sky-900/30 bg-sky-950/30 px-5 py-2 text-xs text-sky-200">
          Active working limit is on{' '}
          <strong className="text-white">{working.instrument}</strong> (you are viewing{' '}
          {viewingInstrument}).
        </div>
      )}

      <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
        <div className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Limit entry</p>
            <p className="price-mono text-2xl font-bold text-sky-100">
              {fmt(working.entry_price)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-red-400/80">Stop loss</p>
              <p className="price-mono font-semibold text-red-300">
                {fmt(working.stop_loss_price)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-emerald-400/80">
                Profit target
              </p>
              <p className="price-mono font-semibold text-emerald-300">
                {fmt(working.profit_target_price)}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Size</p>
              <p className="font-semibold text-gray-200">{working.position_size}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Risk</p>
              <p className="font-semibold text-gray-200">
                {formatDeskMoney(working.risk_amount)}
              </p>
            </div>
          </div>
          {px != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Last price</p>
              <p className="price-mono font-semibold text-white">{fmt(px)}</p>
              {waiting && <p className="mt-1 text-xs text-gray-400">{waiting}</p>}
            </div>
          )}
          {working.entry_reason && (
            <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
              {working.entry_reason}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[#30363d] bg-[#0d1117]/60 px-5 py-4">
        <Link
          href={chartHref}
          onClick={() => setDeskInstrumentPreference(working.instrument)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-500"
        >
          View on chart
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={() => void cancelWorking()}
          className="rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-950/70 disabled:opacity-50"
        >
          {busy ? 'Cancelling…' : 'Cancel working limit'}
        </button>
      </div>
    </div>
  )
}
