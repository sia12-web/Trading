'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildTradovateMirrorTicket,
  tradovateMirrorStorageKey,
  tradingViewChartUrl,
  type DeskIndex,
} from '@/lib/trading/tradovateMirror'
import { tradeifyMustFlatten } from '@/lib/trading/tradeifyGrowth50k'
import { CopyChip, CopyChipRow } from '@/app/dashboard/components/CopyChip'

type Props = {
  instrument: DeskIndex
  direction: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  riskDollars: number
  bookId?: string | null
  accountName?: string | null
  phase: 'working' | 'filled'
}

export function TradovateMirrorCard(props: Props) {
  const ticket = useMemo(
    () =>
      buildTradovateMirrorTicket({
        instrument: props.instrument,
        direction: props.direction,
        entry: props.entry,
        stop: props.stop,
        target: props.target,
        riskDollars: props.riskDollars,
        accountName: props.accountName,
      }),
    [
      props.instrument,
      props.direction,
      props.entry,
      props.stop,
      props.target,
      props.riskDollars,
      props.accountName,
    ]
  )
  const storageKey = props.bookId
    ? tradovateMirrorStorageKey(props.bookId)
    : tradovateMirrorStorageKey(
        `${props.instrument}:${props.direction}:${props.entry}:${props.stop}`
      )
  const [mirrored, setMirrored] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      setMirrored(sessionStorage.getItem(storageKey) === '1')
    } catch {
      setMirrored(false)
    }
  }, [storageKey])

  const copyTicket = useCallback(async () => {
    if (!ticket) return
    try {
      await navigator.clipboard.writeText(ticket.copyText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [ticket])

  const markMirrored = useCallback(() => {
    try {
      sessionStorage.setItem(storageKey, '1')
    } catch {
      /* ignore */
    }
    setMirrored(true)
  }, [storageKey])

  if (!ticket) return null

  const riskMismatch = Math.abs(ticket.riskDeltaDollars) > 1

  return (
    <div className="absolute bottom-28 left-4 z-30 w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-amber-500/40 bg-[#0d1117]/95 px-3 py-2.5 text-[11px] text-amber-50 shadow-xl backdrop-blur-md">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-300">
            TradingView ticket
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400">
            TradePulse already has this {props.phase === 'filled' ? 'fill' : 'working limit'}.
            Paste Price, Units, SL, and TP into TradingView Limit (Day).
          </p>
        </div>
        {mirrored && (
          <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-200">
            Mirrored
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-amber-100/90">{ticket.contractLabel}</p>
      <p className="mt-0.5 font-mono text-[12px] text-white">
        {ticket.side} {ticket.qty > 0 ? ticket.qty : '—'} {ticket.symbol} {ticket.orderType} ·{' '}
        {ticket.tif}
      </p>
      <CopyChipRow>
        <CopyChip
          label="Units"
          value={ticket.qty > 0 ? ticket.qty : null}
          display={ticket.qty > 0 ? ticket.sizeLabel : undefined}
          tone="size"
        />
        <CopyChip label="SL" value={ticket.stop} tone="sl" />
        <CopyChip label="TP" value={ticket.target} tone="tp" />
        <CopyChip label="Entry" value={ticket.entry} />
      </CopyChipRow>
      <p className="mt-1 text-[10px] text-gray-500">
        Click Units, Entry, SL, or TP — paste into the TradingView order ticket.
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-gray-400">
        TradePulse ${ticket.pulseRiskDollars.toFixed(0)}
        {ticket.qty > 0
          ? ` → ${ticket.symbol} $${ticket.tradovateRiskDollars.toFixed(0)} (${ticket.stopPts} pts)`
          : ' — set qty so stop $ matches'}
      </p>
      {riskMismatch && ticket.qty > 0 && (
        <p className="mt-0.5 text-[10px] text-amber-200">
          Integer contracts cannot match ${ticket.pulseRiskDollars.toFixed(0)} exactly — closest
          size shown.
        </p>
      )}
      {ticket.snapped && (
        <p className="mt-0.5 text-[10px] text-amber-200">
          Prices snapped to {ticket.symbol} tick so TradingView accepts the same side/SL/TP.
        </p>
      )}
      {ticket.overCap && (
        <p className="mt-0.5 text-[10px] text-red-300">
          Qty capped at Tradeify 50k max for {ticket.symbol}.
        </p>
      )}
      <p className="mt-0.5 text-[10px] text-gray-500">
        Front month only. Micro only — do not add YM or NQ. One name this session.
      </p>
      {tradeifyMustFlatten() && (
        <p className="mt-1 text-[10px] font-semibold text-red-300">
          Flatten now — close the TradingView / Tradeify position and cancel leftover working
          orders (16:59 ET / 12:59 ET holiday).
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void copyTicket()}
          className="rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[10px] font-bold uppercase text-amber-100 hover:bg-amber-500/25"
        >
          {copied ? 'Copied' : 'Copy ticket'}
        </button>
        <a
          href={tradingViewChartUrl(ticket.symbol)}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-white/15 px-2 py-1 text-[10px] font-bold uppercase text-gray-200 hover:bg-white/10"
        >
          Open TradingView
        </a>
        {!mirrored && (
          <button
            type="button"
            onClick={markMirrored}
            className="rounded border border-emerald-500/40 px-2 py-1 text-[10px] font-bold uppercase text-emerald-200 hover:bg-emerald-500/15"
          >
            Placed on TradingView
          </button>
        )}
      </div>
    </div>
  )
}
