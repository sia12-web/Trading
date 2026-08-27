'use client'

/**
 * Live Positions — manage open books with path meters, AI, and clear exits.
 * Also surfaces unfilled working limits (cancel + view on chart).
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { PositionStatusCard } from './components/PositionStatusCard'
import { WorkingLimitCard } from './components/WorkingLimitCard'
import { LunchCloseCountdown } from './components/LunchCloseCountdown'
import { MorningLunchFlatConfirm } from '@/app/dashboard/chart/components/MorningLunchFlatConfirm'
import type {
  PositionStatusResponse,
  PositionStatus,
  WorkingLimitStatus,
} from '@/types/positionManagement'
import type { Instrument } from '@/types/trading'
import { workingRowToPending, type WorkingLimitRow } from '@/lib/trading/workingLimitGate'
import { isAfternoonWatchWindow, sessionFor } from '@/lib/trading/sessionGate'
import {
  clearLunchFlatKeepOpen,
  hasLunchFlatKeepOpen,
  isMorningOrIbEntry,
  isPastCashCloseNow,
  liveLunchFlatKeepOpenKey,
  markLunchFlatKeepOpen,
} from '@/lib/trading/morningLunchConfirm'
import { getDeskRiskProfile, isTradeifyGrowth50k } from '@/lib/trading/tradeifyProfile'
import {
  tradeifyFlattenOverridesKeepOpen,
  tradeifyMustFlatten,
} from '@/lib/trading/tradeifyGrowth50k'
import {
  TRADER_DISPLAY_LABEL,
  deskLocalHmsAsTraderDisplay,
} from '@/lib/chart/traderDisplayTz'

const INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ']

function mapWorkingRow(row: WorkingLimitRow & { id?: string }): WorkingLimitStatus {
  const p = workingRowToPending(row)
  return {
    id: String(row.id || ''),
    instrument: p.instrument,
    trade_date: String((row as { trade_date?: string }).trade_date || ''),
    entry_price: p.level,
    entry_direction: p.direction,
    stop_loss_price: p.stopLoss,
    profit_target_price: p.profitTarget,
    position_size: p.positionSize,
    risk_amount: p.riskAmount,
    account_size: p.accountSize,
    entry_timestamp:
      row.entry_timestamp || new Date(p.placedAt).toISOString(),
    entry_reason: p.entryReason ?? row.entry_reason,
    entry_source: p.entrySource,
  }
}

export default function PositionsPage() {
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument>('DOW')
  const [position, setPosition] = useState<PositionStatus | null>(null)
  const [openByInstrument, setOpenByInstrument] = useState<Partial<Record<Instrument, boolean>>>(
    {}
  )
  const [workingLimit, setWorkingLimit] = useState<WorkingLimitStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lunchFlatPrompt, setLunchFlatPrompt] = useState(false)
  const [lunchFlatBusy, setLunchFlatBusy] = useState(false)

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

  const fetchWorkingLimit = useCallback(async () => {
    try {
      const res = await fetch('/api/trading/positions/working', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { working?: WorkingLimitRow | null }
      if (data.working?.id) {
        setWorkingLimit(mapWorkingRow(data.working))
      } else {
        setWorkingLimit(null)
      }
    } catch {
      /* soft-fail */
    }
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
    void fetchWorkingLimit()
  }, [fetchPosition, fetchWorkingLimit])

  useEffect(() => {
    void fetchOpenFlags()
  }, [fetchOpenFlags])

  // Soft refresh while managing or working
  useEffect(() => {
    if (!position && !workingLimit) return
    const id = setInterval(() => {
      void fetchPosition({ soft: true })
      void fetchWorkingLimit()
    }, 30_000)
    return () => clearInterval(id)
  }, [position, workingLimit, fetchPosition, fetchWorkingLimit])

  // Past morning lunch with morning/IB open book → confirm close
  useEffect(() => {
    if (!position) {
      setLunchFlatPrompt(false)
      return
    }
    if (!isAfternoonWatchWindow(new Date(), position.instrument)) {
      setLunchFlatPrompt(false)
      return
    }
    if (!isMorningOrIbEntry(position.instrument, position.entry_timestamp)) {
      setLunchFlatPrompt(false)
      return
    }
    const tradeifyOn = isTradeifyGrowth50k(getDeskRiskProfile())
    if (tradeifyOn && tradeifyFlattenOverridesKeepOpen()) {
      setLunchFlatPrompt(false)
      void fetch('/api/trading/positions/cleanup-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force_expire_working: true,
          force_cash_close: true,
        }),
      }).catch(() => {})
      return
    }
    if (hasLunchFlatKeepOpen(liveLunchFlatKeepOpenKey(position.id))) {
      setLunchFlatPrompt(false)
      return
    }
    setLunchFlatPrompt(true)
  }, [position])

  useEffect(() => {
    if (!position) return
    const tick = () => {
      const tradeifyOn = isTradeifyGrowth50k(getDeskRiskProfile())
      if (
        (tradeifyOn && tradeifyMustFlatten()) ||
        isPastCashCloseNow(position.instrument)
      ) {
        void fetch('/api/trading/positions/cleanup-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            force_expire_working: true,
            force_cash_close: true,
          }),
        }).catch(() => {})
      }
    }
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [position])

  const confirmLunchFlatClose = useCallback(async () => {
    if (!position || lunchFlatBusy) return
    setLunchFlatBusy(true)
    try {
      const res = await fetch('/api/trading/positions/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: position.id,
          instrument: position.instrument,
          exit_price: position.entry_price,
          exit_reason: 'manual',
          exit_notes: 'Confirmed close after morning lunch (trader confirm — not auto flatten)',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.message || j.error || 'Close failed')
        return
      }
      clearLunchFlatKeepOpen(liveLunchFlatKeepOpenKey(position.id))
      setLunchFlatPrompt(false)
      setPosition(null)
      setOpenByInstrument((prev) => ({ ...prev, [selectedInstrument]: false }))
    } catch {
      setError('Close failed')
    } finally {
      setLunchFlatBusy(false)
    }
  }, [position, lunchFlatBusy, selectedInstrument])

  // On first load, jump to instrument with open book or working limit
  useEffect(() => {
    const openInst = INSTRUMENTS.find((i) => openByInstrument[i])
    const workingInst = workingLimit?.instrument
    if (openByInstrument[selectedInstrument]) return
    if (workingInst && selectedInstrument === workingInst) return
    if (openInst) {
      setSelectedInstrument(openInst)
      return
    }
    if (workingInst) setSelectedInstrument(workingInst)
    // intentionally when flags / working populate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openByInstrument, workingLimit?.instrument])

  const anyOpen = INSTRUMENTS.some((i) => openByInstrument[i])
  const hasWorking = !!workingLimit

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
              Manage today’s open live book (path to TP, room to SL, take profit). Unfilled
              working limits show here too — cancel or open the chart.
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
            const working =
              !!workingLimit && workingLimit.instrument === instrument
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
                {!open && working && (
                  <span
                    className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]"
                    title="Working limit"
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
              void fetchWorkingLimit()
            }}
            className="ml-auto rounded-lg border border-[#30363d] px-3 py-1.5 text-xs text-gray-400 hover:text-white"
          >
            Refresh
          </button>
        </div>

        {!loading && (anyOpen || hasWorking) && (
          <p className="text-[11px] text-gray-400">
            <span className="text-emerald-400/90">Green dot</span> = filled open book ·{' '}
            <span className="text-sky-400/90">Blue dot</span> = working limit (unfilled). One
            working limit per desk session at a time.
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

        {!loading && !error && workingLimit && !position && (
          <WorkingLimitCard
            working={workingLimit}
            viewingInstrument={selectedInstrument}
            onCancelled={() => {
              setWorkingLimit(null)
              void fetchWorkingLimit()
            }}
          />
        )}

        {!loading && !error && (
          <PositionStatusCard
            position={position}
            onClosed={() => {
              if (position?.id) clearLunchFlatKeepOpen(liveLunchFlatKeepOpenKey(position.id))
              setPosition(null)
              setLunchFlatPrompt(false)
              setOpenByInstrument((prev) => ({ ...prev, [selectedInstrument]: false }))
            }}
            onRefresh={() => {
              void fetchPosition({ soft: true })
              void fetchOpenFlags()
              void fetchWorkingLimit()
            }}
            hideEmptyWhenWorking={!!workingLimit && !position}
          />
        )}

        {position && (
          <MorningLunchFlatConfirm
            open={lunchFlatPrompt}
            instrument={position.instrument}
            direction={position.entry_direction}
            entryPrice={position.entry_price}
            cashCloseLabel={`${(() => {
              const s = sessionFor(position.instrument)
              return `${deskLocalHmsAsTraderDisplay(s.marketClose, s.tz)} ${TRADER_DISPLAY_LABEL}`
            })()}`}
            busy={lunchFlatBusy}
            onConfirm={() => void confirmLunchFlatClose()}
            onKeepOpen={() => {
              markLunchFlatKeepOpen(liveLunchFlatKeepOpenKey(position.id))
              setLunchFlatPrompt(false)
            }}
          />
        )}

        <p className="text-[11px] text-gray-600 leading-relaxed">
          Prefer managing from the chart while price is moving — this page is the dedicated manage
          desk when you leave the chart. Working limits and fills both appear here; cancel unfilled
          limits or manage after fill. Stops and AI exits land in Order History.
        </p>
      </div>
    </div>
  )
}
