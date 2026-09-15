'use client'

/**
 * Desk Notes & Alarms Page
 * Surfaces Desk Notifications & Leo Long-Term Memories, active level alarms,
 * trendline/range cross alerts, and triggered notifications created via Leo voice/chat.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  loadLongTermMemories,
  deleteLongTermMemory,
  loadMemoryNotifications,
  clearAllNotifications,
  type LeoLongTermMemory,
  type LeoMemoryNotification,
} from '@/lib/trading/leoLongTermMemory'
import { DashboardNotifications } from '../components/DashboardNotifications'
import { isArmedRuleExpired } from '@/lib/trading/sessionGate'

type MarketFilter = 'ALL' | 'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE'

export interface DeskArmedAlert {
  id: string
  instrument: string
  description: string
  targetReference?: string
  targetPrice?: number
  session?: string
  status: 'ARMED' | 'TRIGGERED' | 'EXECUTED' | 'SATISFIED' | 'CANCELLED' | 'EXPIRED'
  createdAt: number
}

const MARKETS = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const

export default function NotesPage() {
  const [market, setMarket] = useState<MarketFilter>('ALL')
  const [memories, setMemories] = useState<LeoLongTermMemory[]>([])
  const [notifications, setNotifications] = useState<LeoMemoryNotification[]>([])
  const [armedAlerts, setArmedAlerts] = useState<DeskArmedAlert[]>([])

  const refreshData = () => {
    setMemories(loadLongTermMemories())
    setNotifications(loadMemoryNotifications())

    // Load armed price/drawing alerts from localStorage across markets
    if (typeof window !== 'undefined') {
      const allAlerts: DeskArmedAlert[] = []
      for (const inst of MARKETS) {
        try {
          const raw = localStorage.getItem(`leo_armed_rules_${inst}`)
          if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
              const filtered = parsed
                .filter(
                  (r: any) =>
                    (r.type === 'DESK_ALERT' || r.type === 'TELEGRAM_ALERT') &&
                    !isArmedRuleExpired(r)
                )
                .map((r: any) => ({
                  id: r.id,
                  instrument: r.instrument || inst,
                  description: r.description || `Alert at ${r.targetReference || r.targetPrice}`,
                  targetReference: r.targetReference,
                  targetPrice: r.targetPrice,
                  session: r.session || 'NYC',
                  status: r.status,
                  createdAt: r.createdAt || Date.now(),
                }))
              allAlerts.push(...filtered)
            }
          }
        } catch {
          /* ignore */
        }
      }
      setArmedAlerts(allAlerts)
    }
  }

  useEffect(() => {
    refreshData()
    const handleUpdate = () => refreshData()
    window.addEventListener('leo-memories-updated', handleUpdate)
    window.addEventListener('leo-notifications-updated', handleUpdate)
    return () => {
      window.removeEventListener('leo-memories-updated', handleUpdate)
      window.removeEventListener('leo-notifications-updated', handleUpdate)
    }
  }, [])

  const filteredMemories = memories.filter((m) => {
    if (market === 'ALL') return true
    return m.instrument.toUpperCase() === market
  })

  const filteredAlerts = armedAlerts.filter((a) => {
    if (market === 'ALL') return true
    return a.instrument.toUpperCase() === market
  })

  const filteredNotifs = notifications.filter((n) => {
    if (market === 'ALL') return true
    return n.instrument.toUpperCase() === market
  })

  const handleDelete = (id: string) => {
    deleteLongTermMemory(id)
    refreshData()
  }

  const handleClearAlert = (inst: string, alertId: string) => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(`leo_armed_rules_${inst}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const updated = parsed.filter((r: any) => r.id !== alertId)
          localStorage.setItem(`leo_armed_rules_${inst}`, JSON.stringify(updated))
        }
      }
    } catch {}
    refreshData()
  }

  const handleClearNotifs = () => {
    clearAllNotifications()
    refreshData()
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-surface-600 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Desk Notes & Alarms</h1>
            <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-mono font-semibold text-amber-300 border border-amber-500/30">
              {filteredMemories.length + filteredAlerts.length} Active Alarm{filteredMemories.length + filteredAlerts.length === 1 ? '' : 's'}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-400 max-w-xl leading-relaxed">
            Live price visit alarms, HTF memory notes, and level alerts created when asking Leo for an alert across markets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/chart"
            className="rounded-lg border border-sky-600/40 bg-sky-950/40 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-900/50 hover:text-white transition"
          >
            Go to Chart →
          </Link>
        </div>
      </div>

      {/* Primary Component: Desk Notifications & Leo Long-Term Memories */}
      <section>
        <DashboardNotifications />
      </section>

      {/* Market Selector Tabs */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        {(['ALL', 'DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMarket(m)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border transition ${
              market === m
                ? 'border-brand-500/50 bg-brand-600/30 text-brand-100'
                : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
            }`}
          >
            {m === 'ALL' ? 'All Markets' : m}
          </button>
        ))}
      </div>

      {/* Active Price Alarms & Drawing Alerts */}
      {filteredAlerts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400">
            Active Desk Price &amp; Drawing Alarms ({filteredAlerts.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredAlerts.map((alt) => (
              <div
                key={alt.id}
                className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 space-y-2 transition"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-brand-500/20 px-2 py-0.5 text-xs font-bold text-brand-300 font-mono border border-brand-500/30">
                      {alt.instrument}
                    </span>
                    <span className="text-xs font-bold text-amber-200">
                      {alt.targetReference || 'Level Alert'}
                    </span>
                  </div>
                  <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-500/30 text-amber-200 border border-amber-500/40">
                    {alt.status}
                  </span>
                </div>
                <p className="text-xs text-gray-300 leading-snug">{alt.description}</p>
                <div className="flex items-center justify-between pt-2 border-t border-surface-600/50 text-[10px] text-gray-500 font-mono">
                  <span>Target: {alt.targetPrice ? alt.targetPrice.toLocaleString() : 'Dynamic'}</span>
                  <button
                    type="button"
                    onClick={() => handleClearAlert(alt.instrument, alt.id)}
                    className="text-red-400 hover:text-red-300 font-medium transition"
                  >
                    Delete Alert
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active Alarm Notes List */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400">
          Active Long-Term Memory Notes ({filteredMemories.length})
        </h2>

        {filteredMemories.length === 0 ? (
          <div className="rounded-xl border border-surface-600/60 bg-surface-800/40 p-8 text-center text-sm text-gray-500">
            No active memory notes for this market. Ask Leo in chat or voice:
            <p className="mt-1 text-xs text-gray-400 italic">
              &quot;Leo, notify me when NASDAQ tests 29,500&quot; or &quot;Leo, sound alarm at Yesterday POC&quot;
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredMemories.map((mem) => {
              const isTriggered = mem.status === 'TRIGGERED'
              const low = Math.min(mem.priceLow, mem.priceHigh)
              const high = Math.max(mem.priceLow, mem.priceHigh)
              const rangeStr = low === high ? low.toLocaleString() : `${low.toLocaleString()} – ${high.toLocaleString()}`

              return (
                <div
                  key={mem.id}
                  className={`rounded-xl border p-4 transition space-y-2 ${
                    isTriggered
                      ? 'border-amber-500/50 bg-amber-950/20'
                      : 'border-surface-600 bg-surface-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-brand-500/20 px-2 py-0.5 text-xs font-bold text-brand-300 font-mono border border-brand-500/30">
                        {mem.instrument}
                      </span>
                      <span className="text-sm font-bold text-white font-mono">{rangeStr}</span>
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        isTriggered
                          ? 'bg-amber-500/30 text-amber-200 border border-amber-500/40 animate-pulse'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {isTriggered ? '🔔 Triggered' : 'Active Alarm'}
                    </span>
                  </div>

                  <p className="text-xs text-gray-300 leading-snug">{mem.purpose}</p>

                  <div className="flex items-center justify-between pt-2 border-t border-surface-600/50 text-[10px] text-gray-500 font-mono">
                    <span>Triggers: {mem.triggerCount || 0}</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(mem.id)}
                      className="text-red-400 hover:text-red-300 font-medium transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Alarm Notification Log */}
      {filteredNotifs.length > 0 && (
        <section className="space-y-3 pt-4 border-t border-surface-600">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400">
              Alarm Activity Log ({filteredNotifs.length})
            </h2>
            <button
              type="button"
              onClick={handleClearNotifs}
              className="text-[10px] font-mono text-gray-500 hover:text-gray-300"
            >
              Clear Log
            </button>
          </div>

          <div className="space-y-2">
            {filteredNotifs.slice(0, 10).map((n) => (
              <div
                key={n.id}
                className="rounded-lg border border-surface-600/60 bg-surface-800/40 px-3 py-2 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-amber-400 font-bold">🔔 {n.instrument}</span>
                  <span className="text-white">Price hit {n.price.toLocaleString()}</span>
                  <span className="text-gray-500 text-[11px]">({n.purpose})</span>
                </div>
                <span className="text-[10px] font-mono text-gray-500">
                  {new Date(n.timestamp).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
