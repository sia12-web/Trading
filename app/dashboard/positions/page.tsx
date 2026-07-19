'use client'

/**
 * Live Positions — manage open books with path meters, AI, and clear exits.
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { PositionStatusCard } from './components/PositionStatusCard'
import { LunchCloseCountdown } from './components/LunchCloseCountdown'
import type { PositionStatusResponse, PositionStatus } from '@/types/positionManagement'
import type { Instrument } from '@/types/trading'

const INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']

export default function PositionsPage() {
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument>('DOW')
  const [position, setPosition] = useState<PositionStatus | null>(null)
  const [openByInstrument, setOpenByInstrument] = useState<Partial<Record<Instrument, boolean>>>(
    {}
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOpenFlags = useCallback(async () => {
    const flags: Partial<Record<Instrument, boolean>> = {}
    await Promise.all(
      INSTRUMENTS.map(async (inst) => {
        try {
          const res = await fetch(
            `/api/trading/positions/management-status?instrument=${inst}`,
            { cache: 'no-store' }
          )
          if (!res.ok) return
          const data: PositionStatusResponse = await res.json()
          flags[inst] = !!(data.success && data.position)
        } catch {
          /* ignore */
        }
      })
    )
    setOpenByInstrument(flags)
  }, [])

  const fetchPosition = useCallback(async (opts?: { soft?: boolean }) => {
    try {
      if (!opts?.soft) {
        setLoading(true)
        setError(null)
      }

      await fetch('/api/trading/positions/cleanup-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => {})

      const response = await fetch(
        `/api/trading/positions/management-status?instrument=${selectedInstrument}`,
        { cache: 'no-store' }
      )

      if (!response.ok) throw new Error('Failed to fetch position')

      const data: PositionStatusResponse = await response.json()
      if (data.success) {
        setPosition(data.position)
        setOpenByInstrument((prev) => ({
          ...prev,
          [selectedInstrument]: !!data.position,
        }))
      } else {
        setError(data.message || 'Could not load position')
        setPosition(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      if (!opts?.soft) setPosition(null)
    } finally {
      setLoading(false)
    }
  }, [selectedInstrument])

  useEffect(() => {
    void fetchPosition()
  }, [fetchPosition])

  useEffect(() => {
    void fetchOpenFlags()
  }, [fetchOpenFlags])

  // Soft refresh while managing
  useEffect(() => {
    if (!position) return
    const id = setInterval(() => void fetchPosition({ soft: true }), 30_000)
    return () => clearInterval(id)
  }, [position, fetchPosition])

  // On first open-flags load, jump to an instrument that actually has a book
  useEffect(() => {
    const openInst = INSTRUMENTS.find((i) => openByInstrument[i])
    if (!openInst) return
    if (openByInstrument[selectedInstrument]) return
    setSelectedInstrument(openInst)
    // intentionally once when flags populate for another market
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openByInstrument])

  const anyOpen = INSTRUMENTS.some((i) => openByInstrument[i])

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-amber-500/90">
              Live trading only
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-white">Live positions</h1>
            <p className="mt-1 text-sm text-gray-500 max-w-lg">
              Manage today’s open live book (path to TP, room to SL, AI, take profit). Simulation
              paper trades stay on the Simulation desk — they never show here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/chart"
              className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-[#161b22]"
            >
              Live Trading
            </Link>
            <Link
              href="/dashboard/journal"
              className="rounded-lg border border-[#30363d] px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-[#161b22]"
            >
              Order History
            </Link>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          {INSTRUMENTS.map((instrument) => {
            const open = !!openByInstrument[instrument]
            const selected = selectedInstrument === instrument
            return (
              <button
                key={instrument}
                type="button"
                onClick={() => setSelectedInstrument(instrument)}
                className={`relative rounded-lg px-3.5 py-2 text-xs font-semibold border transition ${
                  selected
                    ? 'bg-brand-600/30 text-brand-200 border-brand-700/40'
                    : 'bg-[#161b22] text-gray-500 border-[#30363d] hover:text-gray-300'
                }`}
              >
                {instrument}
                {open && (
                  <span
                    className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                    title="Open position"
                  />
                )}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => {
              void fetchPosition()
              void fetchOpenFlags()
            }}
            className="ml-auto rounded-lg border border-[#30363d] px-3 py-1.5 text-xs text-gray-400 hover:text-white"
          >
            Refresh
          </button>
        </div>

        {!loading && anyOpen && (
          <p className="text-[11px] text-emerald-400/90">
            Green dot = open book on that market. You can only manage one instrument’s desk day at a
            time.
          </p>
        )}

        <LunchCloseCountdown
          instrument={selectedInstrument}
          marketDisabled={(position?.stop_loss_hit_count ?? 0) >= 2}
          stopLossHitCount={position?.stop_loss_hit_count ?? 0}
          hasOpenPosition={!!position}
        />

        {loading && (
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] px-6 py-12 text-center">
            <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            <p className="text-sm text-gray-500">Loading {selectedInstrument}…</p>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-4">
            <p className="text-sm font-semibold text-red-300">Couldn’t load position</p>
            <p className="mt-1 text-xs text-red-400/80">{error}</p>
            <button
              type="button"
              onClick={() => void fetchPosition()}
              className="mt-3 rounded-lg border border-red-800/60 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-950/50"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <PositionStatusCard
            position={position}
            onClosed={() => {
              setPosition(null)
              setOpenByInstrument((prev) => ({ ...prev, [selectedInstrument]: false }))
            }}
            onRefresh={() => {
              void fetchPosition({ soft: true })
              void fetchOpenFlags()
            }}
          />
        )}

        <p className="text-[11px] text-gray-600 leading-relaxed">
          Prefer managing from the chart while price is moving — this page is the dedicated manage
          desk when you leave the chart. Fills, stops, and AI exits land in Order History.
        </p>
      </div>
    </div>
  )
}
