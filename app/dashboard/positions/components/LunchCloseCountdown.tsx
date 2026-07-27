'use client'

/**
 * Desk countdown — morning ends at lunch (confirm-to-close); cash-close auto-flat for leftovers / lunch-range.
 */

import { useEffect, useState } from 'react'
import { sessionFor } from '@/lib/trading/sessionGate'
import type { Instrument } from '@/types/trading'

interface LunchCloseCountdownProps {
  instrument: Instrument
  marketDisabled: boolean
  stopLossHitCount: number
  hasOpenPosition: boolean
}

function localParts(tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
  let hour = parseInt(get('hour'), 10)
  if (hour === 24) hour = 0
  return {
    weekday: get('weekday'),
    mins: hour * 60 + parseInt(get('minute'), 10),
    secs: parseInt(get('second'), 10),
  }
}

function parseHms(hms: string): number {
  const [h, m] = hms.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function LunchCloseCountdown({
  instrument,
  marketDisabled,
  stopLossHitCount,
  hasOpenPosition,
}: LunchCloseCountdownProps) {
  const sess = sessionFor(instrument)
  const tzLabel = instrument === 'NIKKEI' ? 'JST' : 'ET'
  const lunchLabel = `${sess.lunchClose.slice(0, 5)} ${tzLabel}`
  const cashLabel = `${sess.marketClose.slice(0, 5)} ${tzLabel}`
  const [label, setLabel] = useState('—')
  const [phase, setPhase] = useState<'pre' | 'morning' | 'afternoon' | 'closed'>('closed')

  useEffect(() => {
    const tick = () => {
      const { weekday, mins, secs } = localParts(sess.tz)
      if (weekday === 'Sat' || weekday === 'Sun') {
        setPhase('closed')
        setLabel('Weekend')
        return
      }
      const open = parseHms(sess.marketOpen)
      const lunch = parseHms(sess.lunchClose)
      const cash = parseHms(sess.marketClose)
      const nowSec = mins * 60 + secs
      if (mins < open) {
        setPhase('pre')
        const left = open * 60 - nowSec
        const m = Math.floor(left / 60)
        const s = left % 60
        setLabel(`Opens in ${m}:${s.toString().padStart(2, '0')}`)
        return
      }
      if (mins < lunch) {
        setPhase('morning')
        const left = lunch * 60 - nowSec
        const m = Math.floor(left / 60)
        const s = left % 60
        setLabel(`${m}:${s.toString().padStart(2, '0')}`)
        return
      }
      if (mins < cash) {
        setPhase('afternoon')
        const left = cash * 60 - nowSec
        const m = Math.floor(left / 60)
        const s = left % 60
        setLabel(`${m}:${s.toString().padStart(2, '0')}`)
        return
      }
      setPhase('closed')
      setLabel('Cash closed')
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [sess.tz, sess.marketOpen, sess.lunchClose, sess.marketClose])

  if (marketDisabled) {
    return (
      <div className="rounded-xl border border-red-800/50 bg-red-950/30 px-4 py-3">
        <p className="text-sm font-semibold text-red-300">Desk locked — 2 stops today</p>
        <p className="mt-1 text-xs text-red-400/80">
          No new entries on {instrument} for the rest of this session (max 2 attempts).
        </p>
      </div>
    )
  }

  const border =
    phase === 'morning'
      ? 'border-amber-800/40 bg-amber-950/20'
      : phase === 'afternoon'
        ? 'border-orange-800/40 bg-orange-950/20'
        : phase === 'pre'
          ? 'border-sky-800/40 bg-sky-950/20'
          : 'border-[#30363d] bg-[#161b22]'

  const title =
    phase === 'morning'
      ? `Until morning desk end · ${lunchLabel}`
      : phase === 'afternoon'
        ? `Until cash-close auto-flat · ${cashLabel}`
        : phase === 'pre'
          ? `Pre-open · ${instrument}`
          : `Session · ${instrument}`

  const subtitle =
    phase === 'morning'
      ? hasOpenPosition
        ? 'At lunch you will be asked to confirm close — not auto-flattened'
        : 'No open book — place limits on Live Trading'
      : phase === 'afternoon'
        ? hasOpenPosition
          ? 'Open book auto-liquidates at cash close (lunch-range + leftovers)'
          : 'Afternoon — lunch-range entries 13:30–15:15 (Tokyo to 15:00), then manage-only'
        : hasOpenPosition
          ? 'Open book on this desk'
          : 'No open book — place limits on Live Trading'

  return (
    <div className={`rounded-xl border px-4 py-3 ${border}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">{title}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            {subtitle}
            {stopLossHitCount > 0 ? ` · Stops ${stopLossHitCount}/2` : ''}
          </p>
        </div>
        <div
          className={`price-mono text-2xl font-bold tabular-nums ${
            phase === 'morning'
              ? 'text-amber-300'
              : phase === 'afternoon'
                ? 'text-orange-300'
                : phase === 'pre'
                  ? 'text-sky-300'
                  : 'text-gray-500'
          }`}
        >
          {label}
        </div>
      </div>
    </div>
  )
}
